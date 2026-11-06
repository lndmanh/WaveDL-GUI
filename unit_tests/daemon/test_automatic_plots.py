"""Automatic plots use the existing planner on the daemon's owner thread."""

import asyncio
import json
from uuid import uuid4

import httpx
import pytest

from wavedl_daemon.backends.local import LocalBackend
from wavedl_daemon.backends.slurm_plan import SlurmPlanner, SlurmSite
from wavedl_daemon.http.app import create_app
from wavedl_daemon.runs import training_options
from wavedl_daemon.runs.automatic_plots import AutomaticPlots
from wavedl_daemon.runs.model import (
    CancelRequested,
    Exited,
    LocalHandle,
    Operation,
    Outcome,
    RunId,
    SlurmHandle,
    Submitted,
    Submitting,
)
from wavedl_daemon.runs.runtime_service import HostedServices
from wavedl_daemon.runs.service import RunService
from wavedl_daemon.storage.automatic_plots import AutomaticPlotStore
from wavedl_daemon.storage.database import (
    UnsupportedDatabase,
    database_generation,
    open_database,
)
from wavedl_daemon.storage.plans import PlanStore
from wavedl_daemon.storage.run_log import Expect, RunLog
from wavedl_daemon.storage.settings import Settings

from . import test_lifecycle_api, test_run_log
from .test_hosted_app import (
    AUTH,
    TOKEN,
    StubSupervisor,
    stub_backends,
    train_payload,
    until,
)
from .test_lifecycle_api import (
    ended_train_run,
    from_checkpoint,
    request,
)


# Shared fixtures, bound by name so pytest discovers them in this module.
environment = test_lifecycle_api.environment
state = test_run_log.state


@pytest.fixture
def automatic(environment):
    store = environment.service.automatic_plots
    assert store is not None
    return AutomaticPlots(environment.service, store)


def completed(
    environment,
    body,
    key="source",
    *,
    outcome=Outcome.COMPLETED,
    confirmed=True,
    cancelled=False,
):
    """A terminal log entry without requiring an actual local/Slurm process."""
    plan = environment.service.plan(body, key)
    environment.service.submit(plan.plan_id)
    handle = (
        SlurmHandle("123", "alpha", "tester")
        if body["backend"] == "slurm"
        else LocalHandle(123, "test")
    )
    events = [Submitting(), Submitted(handle)]
    if cancelled:
        events.append(CancelRequested())
    events.append(Exited(outcome, confirmed, exit_code=0))
    environment.log.append(RunId(plan.run_id), events, expect=Expect())
    return plan.run_id


def test_success_automatically_submits_one_best_checkpoint_plot(environment, automatic):
    source = ended_train_run(environment, "source")
    checkpoint = environment.service.layout(source).output / "best_checkpoint"
    checkpoint.mkdir(parents=True)
    automatic.tick()
    view = environment.service.get(source)
    assert view.auto_plot is not None
    assert view.auto_plot.status == "submitted"
    plot_id = view.auto_plot.run_id
    plot = environment.plans.by_run(plot_id)
    assert plot is not None
    assert plot.plan.operation is Operation.PLOT
    assert plot.plan.spec.checkpoint_source.run_id == source
    assert plot.plan.spec.checkpoint_source.checkpoint == "best_checkpoint"
    assert plot.plan.spec.resolved_config["checkpoint"] == str(checkpoint)
    assert plot.plan.spec.resolved_config["workers"] == 0
    assert plot.plan.spec.resolved_config["batch_size"] == 128
    assert plot.plan.spec.resolved_config["plot"] is True
    assert set(plot.plan.spec.resolved_config) == set(training_options.TEST)
    for name in ("epochs", "cv", "optimizer", "precision", "resume"):
        assert name not in plot.plan.spec.resolved_config
    for _ in range(5):
        automatic.tick()
    assert len(environment.plans.page(limit=100, offset=0)) == 2
    assert environment.service.get(plot_id).submission_requested is True
    assert automatic.store.get(source, 1).plot_run_id == plot_id
    assert environment.log.head(RunId(plot_id)).attempt == 1


def test_payload_reuses_host_paths_runtime_and_inference_defaults(
    environment, automatic, tmp_path
):
    body = train_payload(
        data_path="datasets/train.npz",
        model="cnn",
        import_modules=["custom.py"],
        batch_size=17,
        workers=3,
        epochs=8,
        single_channel=True,
    )
    body["backend"] = "slurm"
    body["submission_cwd"] = str(tmp_path)
    body["runtime"]["python"] = "venv/bin/python"
    body["runtime"]["environment"] = {"CUSTOM": "kept"}
    body["storage_map"] = [{"host_root": str(tmp_path), "execution_root": "/execution"}]
    source = completed(environment, body)
    (environment.service.layout(source).output / "best_checkpoint").mkdir(parents=True)
    automatic.tick()
    row = automatic.store.get(source, 1)
    assert row.status == "submitted", row.failure
    plot = environment.plans.by_run(row.plot_run_id)
    original = json.loads(plot.request_json)
    assert original["backend"] == body["backend"]
    assert original["runtime"] == body["runtime"]
    assert original["storage_map"] == body["storage_map"]
    assert original["submission_cwd"] == body["submission_cwd"]
    assert original["topology"] == {
        "num_machines": 1,
        "processes_per_machine": 1,
        "machine_rank": 0,
    }
    assert original["config"]["data_path"] == "datasets/train.npz"
    assert original["config"]["import_modules"] == ["custom.py"]
    config = plot.plan.spec.resolved_config
    assert config["data_path"] == "/execution/datasets/train.npz"
    assert config["import_modules"] == ["/execution/custom.py"]
    assert config["checkpoint"].startswith("/execution/runs/")
    assert plot.plan.spec.runtime.python == "/execution/venv/bin/python"
    assert config["model"] == "cnn"
    assert config["batch_size"] == 17 and config["workers"] == 3
    for name, option in training_options.TEST.items():
        if name not in {
            "checkpoint",
            "data_path",
            "model",
            "import_modules",
            "batch_size",
            "workers",
            "plot",
        }:
            assert config[name] == option.default


def test_slurm_rejection_is_failed_without_changing_device_or_allocation(
    environment, automatic
):
    environment.service.backends["slurm"] = SlurmPlanner(
        SlurmSite("debug", cluster="alpha", gpus_per_node=2)
    )
    body = train_payload(model="cnn")
    body["backend"] = "slurm"
    body["runtime"]["device"] = "cuda"
    body["topology"]["processes_per_machine"] = 2
    source = completed(environment, body)
    (environment.service.layout(source).output / "best_checkpoint").mkdir(parents=True)
    automatic.tick()
    row = automatic.store.get(source, 1)
    assert row.status == "failed"
    assert "GPU allocation" in row.failure
    assert row.plot_run_id is None
    assert len(environment.plans.page(limit=100, offset=0)) == 1
    assert environment.plans.by_run(source).plan.spec.runtime.device == "cuda"


@pytest.mark.parametrize(
    ("outcome", "confirmed", "cancelled"),
    [
        (Outcome.FAILED, True, False),
        (Outcome.CANCELLED, True, True),
        (Outcome.COMPLETED, True, True),
        (Outcome.COMPLETED, False, False),
        (Outcome.LOST, False, False),
        (Outcome.UNKNOWN, False, False),
    ],
)
def test_ineligible_endings_are_not_discovered(
    environment, automatic, outcome, confirmed, cancelled
):
    source = completed(
        environment,
        train_payload(),
        outcome=outcome,
        confirmed=confirmed,
        cancelled=cancelled,
    )
    automatic.tick()
    assert automatic.store.get(source, 1) is None
    assert environment.service.get(source).auto_plot is None
    assert len(environment.plans.page(limit=100, offset=0)) == 1


def test_cv_is_skipped_without_planning(environment, automatic):
    source = completed(environment, train_payload(cv=3))
    automatic.tick()
    assert automatic.store.get(source, 1).status == "skipped"
    assert environment.service.get(source).auto_plot is None
    assert len(environment.plans.page(limit=100, offset=0)) == 1
    with pytest.raises(ValueError):
        environment.service.retry_automatic_plot(source)


def test_completed_test_and_plot_do_not_schedule_more_plots(
    environment, automatic, tmp_path
):
    source = ended_train_run(environment, "source")
    (environment.service.layout(source).output / "best_checkpoint").mkdir(parents=True)
    automatic.store.add(source, 1, "skipped")
    for operation in ("test", "plot"):
        body = from_checkpoint(source, tmp_path, operation=operation)
        run_id = completed(environment, body, operation)
        automatic.tick()
        assert automatic.store.get(run_id, 1) is None
    assert len(environment.plans.page(limit=100, offset=0)) == 3


def test_missing_best_fails_and_retry_submits_without_checkpoint_fallback(
    environment, automatic
):
    source = ended_train_run(environment, "source")
    output = environment.service.layout(source).output
    (output / "last_checkpoint").mkdir(parents=True)
    automatic.tick()
    row = automatic.store.get(source, 1)
    assert row.status == "failed"
    assert "best_checkpoint" in row.failure and len(row.failure) <= 300
    assert row.plot_run_id is None
    assert len(environment.plans.page(limit=100, offset=0)) == 1
    (output / "best_checkpoint").mkdir()
    retried = environment.service.retry_automatic_plot(source)
    assert retried.auto_plot.status == "pending"
    assert retried.auto_plot.failure is None
    automatic.tick()
    assert automatic.store.get(source, 1).status == "submitted"
    assert len(environment.plans.page(limit=100, offset=0)) == 2


def test_pending_recovers_the_existing_plan_after_a_crash(
    environment, automatic, monkeypatch
):
    source = ended_train_run(environment, "source")
    (environment.service.layout(source).output / "best_checkpoint").mkdir(parents=True)
    submit = environment.service.submit

    def crash(plan_id):
        raise SystemExit("crash after planning")

    monkeypatch.setattr(environment.service, "submit", crash)
    with pytest.raises(SystemExit):
        automatic.tick()
    row = automatic.store.get(source, 1)
    assert row.status == "pending"
    existing = environment.plans.get_by_key(f"daemon-autoplot:{source}:1")
    assert existing is not None
    assert environment.log.head(RunId(existing.run_id)) is None
    monkeypatch.setattr(environment.service, "submit", submit)
    automatic.tick()
    assert automatic.store.get(source, 1).plot_run_id == existing.run_id
    assert environment.service.get(existing.run_id).submission_requested is True
    assert len(environment.plans.page(limit=100, offset=0)) == 2


def test_pending_recovers_after_submission_before_recording(
    environment, automatic, monkeypatch
):
    source = ended_train_run(environment, "source")
    (environment.service.layout(source).output / "best_checkpoint").mkdir(parents=True)
    update = automatic.store.update

    def crash(*args, **kwargs):
        raise SystemExit("crash after submission")

    monkeypatch.setattr(automatic.store, "update", crash)
    with pytest.raises(SystemExit):
        automatic.tick()
    plot = environment.plans.get_by_key(f"daemon-autoplot:{source}:1")
    head = environment.log.head(RunId(plot.run_id))
    monkeypatch.setattr(automatic.store, "update", update)
    automatic.tick()
    assert automatic.store.get(source, 1).plot_run_id == plot.run_id
    assert environment.log.head(RunId(plot.run_id)) == head
    assert len(environment.plans.page(limit=100, offset=0)) == 2


def test_pending_rechecks_eligibility(environment, automatic):
    source = completed(environment, train_payload(), confirmed=False)
    automatic.store.add(source, 1, "pending")
    automatic.tick()
    row = automatic.store.get(source, 1)
    assert row.status == "failed"
    assert "eligible" in row.failure
    assert len(environment.plans.page(limit=100, offset=0)) == 1


def test_discovery_and_submission_are_bounded(environment, automatic):
    sources = [completed(environment, train_payload(), str(i)) for i in range(3)]
    for source in sources:
        (environment.service.layout(source).output / "best_checkpoint").mkdir(
            parents=True
        )
    automatic.tick()
    assert sum(automatic.store.get(source, 1) is not None for source in sources) == 1
    assert len(environment.plans.page(limit=100, offset=0)) == 4


def test_auto_plot_wire_shape_and_retry_statuses(environment, automatic):
    source = ended_train_run(environment, "source")
    route = f"/api/runs/{source}/automatic-plots/retry"
    # Owed before the pump records it, so clients keep watching the finished run.
    assert request(environment.app, "GET", f"/api/runs/{source}").json()[
        "auto_plot"
    ] == {"status": "pending", "run_id": None, "failure": None}
    assert request(environment.app, "POST", route).status_code == 400
    automatic.tick()
    failed = request(environment.app, "GET", f"/api/runs/{source}").json()
    assert failed["auto_plot"] == {
        "status": "failed",
        "run_id": None,
        "failure": automatic.store.get(source, 1).failure,
    }
    assert request(environment.app, "POST", route, headers={}).status_code == 401
    retry = request(environment.app, "POST", route)
    assert retry.status_code == 202
    assert retry.headers["cache-control"] == "no-store"
    assert retry.json()["auto_plot"] == {
        "status": "pending",
        "run_id": None,
        "failure": None,
    }
    assert request(environment.app, "POST", route).json() == retry.json()
    (environment.service.layout(source).output / "best_checkpoint").mkdir(parents=True)
    automatic.tick()
    submitted = request(environment.app, "POST", route)
    assert submitted.status_code == 202
    value = submitted.json()["auto_plot"]
    assert value == {
        "status": "submitted",
        "run_id": automatic.store.get(source, 1).plot_run_id,
        "failure": None,
    }
    listed = request(environment.app, "GET", "/api/runs").json()["runs"]
    assert next(run for run in listed if run["run_id"] == source)["auto_plot"] == value
    assert (
        next(run for run in listed if run["operation"] == "plot")["auto_plot"] is None
    )
    assert (
        request(
            environment.app, "POST", f"/api/runs/{uuid4()}/automatic-plots/retry"
        ).status_code
        == 404
    )
    assert (
        request(
            environment.app, "POST", "/api/runs/invalid/automatic-plots/retry"
        ).status_code
        == 400
    )
    failed_source = completed(
        environment, train_payload(), "failed", outcome=Outcome.FAILED
    )
    automatic.store.add(failed_source, 1, "failed")
    assert (
        request(
            environment.app, "POST", f"/api/runs/{failed_source}/automatic-plots/retry"
        ).status_code
        == 400
    )


def test_v1_upgrade_preserves_data_identity_and_skips_completed_history(
    state, tmp_path
):
    root, lock = state
    settings = Settings(root, tmp_path / "runs")
    settings.validate()
    path = root / "registry.db"
    connection = open_database(path, dispatch_lock=lock)
    log, plans = RunLog(connection), PlanStore(connection)
    local = LocalBackend(dispatch_lock=lock, supervisor=StubSupervisor())
    runs = RunService(settings, plans, log, {"local": local})
    source = runs.plan(train_payload(), "old")
    runs.submit(source.plan_id)
    log.append(
        RunId(source.run_id),
        [
            Submitting(),
            Submitted(LocalHandle(123, "test")),
            Exited(Outcome.COMPLETED, True, 0),
        ],
        expect=Expect(),
    )
    (runs.layout(source.run_id).output / "best_checkpoint").mkdir(parents=True)
    original_head = log.head(RunId(source.run_id))
    original_plan = plans.by_run(source.run_id)
    future = runs.plan(train_payload(), "finishes-after-upgrade")
    runs.submit(future.plan_id)
    events = list(connection.execute("SELECT * FROM run_events ORDER BY run_id, seq"))
    generation = database_generation(connection)
    inode = path.stat().st_ino
    connection.execute("DROP TABLE automatic_plots")
    connection.execute("PRAGMA user_version=1")
    connection.close()
    upgraded = open_database(path, dispatch_lock=lock)
    try:
        assert upgraded.execute("PRAGMA user_version").fetchone()[0] == 2
        assert path.stat().st_ino == inode
        assert database_generation(upgraded) == generation
        assert RunLog(upgraded).head(RunId(source.run_id)) == original_head
        assert PlanStore(upgraded).by_run(source.run_id) == original_plan
        assert (
            list(upgraded.execute("SELECT * FROM run_events ORDER BY run_id, seq"))
            == events
        )
        store = AutomaticPlotStore(upgraded)
        assert store.get(source.run_id, 1).status == "skipped"
        runs = RunService(
            settings,
            PlanStore(upgraded),
            RunLog(upgraded),
            {"local": local},
            automatic_plots=store,
        )
        for _ in range(3):
            AutomaticPlots(runs, store).tick()
        assert len(runs.plans.page(limit=100, offset=0)) == 2
        assert runs.get(source.run_id).auto_plot is None
        assert store.get(future.run_id, 1) is None
        runs.log.append(
            RunId(future.run_id),
            [
                Submitting(),
                Submitted(LocalHandle(124, "test")),
                Exited(Outcome.COMPLETED, True, 0),
            ],
            expect=Expect(),
        )
        (runs.layout(future.run_id).output / "best_checkpoint").mkdir(parents=True)
        AutomaticPlots(runs, store).tick()
        assert store.get(future.run_id, 1).status == "submitted"
        assert len(runs.plans.page(limit=100, offset=0)) == 3
    finally:
        upgraded.close()
        local.close()
    reopened = open_database(path, dispatch_lock=lock)
    assert database_generation(reopened) == generation
    reopened.execute("PRAGMA user_version=99")
    reopened.close()
    with pytest.raises(UnsupportedDatabase):
        open_database(path, dispatch_lock=lock)


def test_hosted_pump_submits_without_a_browser_and_retry_uses_owner_lane(tmp_path):
    settings = Settings(tmp_path / "state", tmp_path / "runs")
    supervisor = StubSupervisor()
    services = HostedServices(settings, backend_factory=stub_backends(supervisor))
    app = create_app(
        settings, token=TOKEN, daemon_id="host", build_id="test", services=services
    )

    async def run():
        async with (
            app.router.lifespan_context(app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://localhost:8420",
                headers=AUTH,
            ) as client,
        ):
            plan = await services.run_service.plan(train_payload(), "source")
            await services.run_service.submit(plan.plan_id)

            async def running():
                return (await services.run_service.get(plan.run_id)).state == "running"

            await until(running)
            supervisor.launches[0].finish(0)

            async def failed():
                view = await services.run_service.get(plan.run_id)
                return view.auto_plot is not None and view.auto_plot.status == "failed"

            await until(failed)
            (settings.run_root / plan.run_id / "output" / "best_checkpoint").mkdir(
                parents=True
            )
            response = await client.post(
                f"/api/runs/{plan.run_id}/automatic-plots/retry"
            )
            assert response.status_code == 202, response.text

            async def submitted():
                view = await services.run_service.get(plan.run_id)
                return (
                    view.auto_plot is not None and view.auto_plot.status == "submitted"
                )

            await until(submitted)
            listed = await services.run_service.list()
            assert [view.operation for view in listed] == ["train", "plot"]
            assert listed[0].auto_plot.run_id == listed[1].run_id

    asyncio.run(run())
