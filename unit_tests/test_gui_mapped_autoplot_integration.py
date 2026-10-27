"""Qt automatic plotting across declared, distinct host/runtime storage views.

Scheduler commands and storage visibility are simulated explicitly: complete
directories are copied before/after actual CPU batch execution. This is NOT a
real Slurm/shared-filesystem certificate or browser AutoPlotController proof.
Training is approved by public HTTP (Qt's training editor has no mapping field),
then a genuine Qt worker resumes that run and triggers the ordinary auto-plot
completion slot. No runtime, PNG, transport or source-publication substitute.
"""

import asyncio
import hashlib
import json
import os
import shutil
import socket
import sys
import threading
import time
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import httpx
import numpy as np
import pytest

from wavedl_daemon.backends.slurm import SlurmBackend
from wavedl_daemon.backends.slurm_plan import SlurmSite
from wavedl_daemon.execution.budget import WorkBudget
from wavedl_daemon.execution.commands import run_command
from wavedl_daemon.supervision.base import ProcessResult, ProcessSpec


pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(os.name != "posix", reason="POSIX scheduler execution"),
]


class CopyVisibilityScheduler:
    """Fake native commands; real batch execution with explicit copy barriers."""

    def __init__(self, owner, host, execution):
        self.owner, self.host, self.execution = owner, host, execution
        self.jobs, self.threads, self.results = {}, [], []
        self.lock = threading.Lock()

    def _execute(self, job_id, script):
        run = script.parent.parent.parent
        compute = self.execution / run.relative_to(self.host)
        try:
            # These are separate real directories, not aliases or mock bytes.
            shutil.copytree(run, compute)
            environment = {
                key: value
                for key, value in os.environ.items()
                if not key.startswith(
                    ("WAVEDL_", "SLURM_", "RANK", "LOCAL_RANK", "WORLD_SIZE")
                )
            }
            environment.update(
                SLURM_JOB_ID=job_id,
                SLURM_RESTART_COUNT="0",
                SLURM_CLUSTER_NAME="test-cluster",
                SLURM_JOB_USER=self.owner,
            )
            result = run_command(
                ProcessSpec(("/bin/bash", str(script)), self.host, environment),
                WorkBudget(timeout_seconds=90, max_output_bytes=1024 * 1024),
            )
            self.results.append(result)
            # Publish the complete runtime view only once execution has ended.
            # No claim is made about live NFS/Lustre coherence or mount latency.
            shutil.copytree(compute, run, dirs_exist_ok=True)
            with self.lock:
                self.jobs[job_id]["state"] = (
                    "COMPLETED" if result.returncode == 0 else "FAILED"
                )
                self.jobs[job_id]["exit"] = result.returncode
        except BaseException as error:
            self.results.append(error)
            with self.lock:
                self.jobs[job_id].update(state="FAILED", exit=1)

    def run(self, argv):
        with self.lock:
            if argv[0] == "sbatch":
                job_id = str(12000 + len(self.jobs))
                request = next(
                    value.split("=", 1)[1]
                    for value in argv
                    if value.startswith("--comment=")
                )
                self.jobs[job_id] = {"request": request, "state": "RUNNING", "exit": 0}
                thread = threading.Thread(
                    target=self._execute, args=(job_id, Path(argv[-1])), daemon=True
                )
                self.threads.append(thread)
                thread.start()
                return ProcessResult(0, f"{job_id};test-cluster\n".encode(), b"")
            if argv[0] == "scontrol" and "config" in argv:
                return ProcessResult(
                    0,
                    b"MinJobAge = 300\nAccountingStorageType = accounting_storage/none\n",
                    b"",
                )
            if argv[0] == "sacct":
                return ProcessResult(1, b"", b"Accounting storage is disabled")
            assert argv[0] in {"squeue", "scontrol"}, argv
            if argv[0] == "squeue":
                output = "".join(
                    f"{job}|{self.owner}|wavedl-{item['request']}|{item['state']}|None|{item['request']}\n"
                    for job, item in self.jobs.items()
                )
            else:
                selected = argv[-1].split("=", 1)[-1]
                items = [
                    (job, item)
                    for job, item in self.jobs.items()
                    if selected == "jobs" or job == selected
                ]
                output = "".join(
                    f"JobId={job} UserId={self.owner}({os.getuid()}) JobName=wavedl-{item['request']} Comment={item['request']} Cluster=test-cluster JobState={item['state']} Restarts=0 ExitCode={item['exit']}:0 Reason=None\n"
                    for job, item in items
                )
            return ProcessResult(0, output.encode(), b"")


def test_explicit_qt_plot_pin_inverse_maps_approved_file_registration_once():
    from wavedl_gui.common.constants.index import TrainingConfig
    from wavedl_gui.service.daemon_contracts import (
        ApprovedStorageMapping,
        DaemonConnection,
        RunRef,
        build_plot_request,
    )

    run_id = str(uuid4())
    source = RunRef(
        "daemon",
        str(uuid4()),
        run_id,
        str(uuid4()),
        1,
        "train",
        "/host/runs/" + run_id,
        "/exec/data.npz",
        (ApprovedStorageMapping("/host", "/exec"),),
        "/exec/runs/" + run_id,
        "slurm",
        ("/exec/registration.py", "package.registration"),
        "gen-000007",
    )
    connection = DaemonConnection(
        "http://127.0.0.1:8420",
        Path("/credential"),
        "/venv/bin/python",
        backend="slurm",
        daemon_id="daemon",
    )
    snapshot = build_plot_request(TrainingConfig(), source, connection)
    assert snapshot.payload["checkpoint_source"] == {
        "run_id": run_id,
        "generation": "gen-000007",
    }
    assert "checkpoint" not in snapshot.payload["config"]
    assert snapshot.payload["config"]["import_modules"] == [
        "/host/registration.py",
        "package.registration",
    ]
    assert snapshot.payload["config"]["data_path"] == "/host/data.npz"
    assert source.import_modules == ("/exec/registration.py", "package.registration")


def test_qt_plot_registration_inverse_rejects_non_roundtripping_mapping():
    from wavedl_gui.common.constants.index import TrainingConfig
    from wavedl_gui.service.daemon_contracts import (
        ApprovedStorageMapping,
        DaemonConnection,
        RequestContractError,
        RunRef,
        build_plot_request,
    )

    run_id = str(uuid4())
    source = RunRef(
        "daemon",
        str(uuid4()),
        run_id,
        str(uuid4()),
        1,
        "train",
        "/host/runs/" + run_id,
        "/exec/data.npz",
        (
            ApprovedStorageMapping("/host", "/exec"),
            ApprovedStorageMapping("/host/code", "/elsewhere"),
        ),
        "/exec/runs/" + run_id,
        "slurm",
        ("/exec/code/registration.py",),
        "gen-000007",
    )
    connection = DaemonConnection(
        "http://127.0.0.1:8420",
        Path("/credential"),
        "/venv/bin/python",
        backend="slurm",
        daemon_id="daemon",
    )
    with pytest.raises(RequestContractError, match="does not round trip"):
        build_plot_request(TrainingConfig(), source, connection)


@pytest.mark.parametrize("onnx_only", [False, True], ids=["no-output", "onnx-only"])
def test_training_pin_selection_without_bulk_output_preferences(tmp_path, onnx_only):
    from wavedl_gui.common.constants.index import TrainingConfig
    from wavedl_gui.service.daemon_contracts import DaemonConnection, RunRef
    from wavedl_gui.service.training_service import TrainingWorker

    source = RunRef(
        "daemon",
        str(uuid4()),
        str(uuid4()),
        str(uuid4()),
        1,
        "train",
        "/host/run",
        "/host/data.npz",
    )
    connection = DaemonConnection(
        "http://127.0.0.1:8420", Path("/credential"), sys.executable, daemon_id="daemon"
    )
    worker = TrainingWorker(
        TrainingConfig(data_path="/host/data.npz", output_dir=""),
        connection=connection,
        run_ref=source,
    )
    if onnx_only:
        worker._snapshot = replace(
            worker._snapshot, export_path=str(tmp_path / "model.onnx")
        )
    metadata = b'{"schema_version":1,"kind":"best"}'
    model = b"actual test-owned ONNX bytes"

    class MetadataTransport:
        def __init__(self):
            self.downloads = []
            self.metadata_paths = []

        async def request(self, method, path):
            assert method == "GET" and path == f"/api/runs/{source.run_id}/artifacts"
            return {
                "generations": [
                    {
                        "generation": "gen-000001",
                        "attempt": 1,
                        "files": {
                            "checkpoint_selection.json": {
                                "size": len(metadata),
                                "sha256": hashlib.sha256(metadata).hexdigest(),
                            }
                        },
                    },
                    {
                        "generation": "gen-000002",
                        "attempt": 1,
                        "files": {
                            "checkpoint_selection.json": {
                                "size": len(metadata),
                                "sha256": hashlib.sha256(metadata).hexdigest(),
                            },
                            "pytorch_model.bin": {
                                "size": 600 * 1024 * 1024,
                                "sha256": "a" * 64,
                            },
                        },
                    },
                    {
                        "generation": "gen-000003",
                        "attempt": 1,
                        "files": {
                            "model.onnx": {
                                "size": len(model),
                                "sha256": hashlib.sha256(model).hexdigest(),
                            }
                        },
                    },
                ]
            }

        async def download(self, ref, destination, *, max_bytes):
            assert ref.path in {"checkpoint_selection.json", "model.onnx"}
            content = metadata if ref.path == "checkpoint_selection.json" else model
            assert (
                len(content) <= max_bytes
                and hashlib.sha256(content).hexdigest() == ref.sha256
            )
            self.downloads.append(ref.path)
            if ref.path == "checkpoint_selection.json":
                self.metadata_paths.append(destination)
            destination.write_bytes(content)
            return destination

    transport = MetadataTransport()
    result = asyncio.run(worker._collect_result(transport, source, {}, {}))
    assert result["checkpoint_generation"] == "gen-000002"
    assert transport.metadata_paths and all(
        not path.exists() for path in transport.metadata_paths
    )
    assert worker._download_directory is None
    assert transport.downloads == (
        ["checkpoint_selection.json", "model.onnx"]
        if onnx_only
        else ["checkpoint_selection.json"]
    )
    assert result["artifact_paths"] == (
        [str(tmp_path / "model.onnx")] if onnx_only else []
    )
    worker._on_finished(True, "complete", result)
    assert worker.run_ref.checkpoint_generation == "gen-000002"


def test_automatic_plot_refuses_success_without_verified_publication(monkeypatch):
    from wavedl_gui.common.constants.index import TrainingConfig
    from wavedl_gui.service.daemon_contracts import DaemonConnection, RunRef
    from wavedl_gui.service.training_service import TrainingService, TrainingWorker

    source = RunRef(
        "daemon",
        str(uuid4()),
        str(uuid4()),
        str(uuid4()),
        1,
        "train",
        "/host/run",
        "/host/data.npz",
    )
    connection = DaemonConnection(
        "http://127.0.0.1:8420", Path("/credential"), sys.executable, daemon_id="daemon"
    )
    worker = TrainingWorker(
        TrainingConfig(data_path="/host/data.npz", output_dir=""),
        connection=connection,
        run_ref=source,
    )
    worker.result = {"artifact_paths": []}
    service = TrainingService()
    service._training_worker, service._current_config = worker, worker.config

    def forbidden(*args):
        pytest.fail("Automatic plotting must never fall back to a mutable run root")

    monkeypatch.setattr(service, "_start_plot_generation", forbidden)
    service._on_training_finished(True, "complete")
    assert service._training_worker is None and service._plot_worker is None


def test_mapped_cpu_training_auto_plot_pins_source_and_retries_public_qt_delivery(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("QT_QPA_PLATFORM", "offscreen")
    pytest.importorskip("PySide6")
    pytest.importorskip("qfluentwidgets")
    uvicorn = pytest.importorskip("uvicorn")
    import pwd

    from PySide6.QtGui import QImage
    from PySide6.QtWidgets import QApplication

    from wavedl_daemon.http.app import create_app
    from wavedl_daemon.runs.runtime_service import HostedServices
    from wavedl_daemon.storage.settings import Settings
    from wavedl_gui.common.constants.index import TrainingConfig
    from wavedl_gui.common.signal_bus import signalBus
    from wavedl_gui.service.daemon_contracts import DaemonConnection, RunRef
    from wavedl_gui.service.training_service import (
        ProcessState,
        TrainingService,
        TrainingWorker,
    )
    from wavedl_gui.view import main_window
    from wavedl_gui.view.dashboard_interface import DashboardInterface

    qt = QApplication.instance() or QApplication([])
    host, execution = tmp_path / "host", tmp_path / "compute"
    host.mkdir()
    execution.mkdir()
    data = host / "samples.npz"
    generator = np.random.default_rng(9)
    np.savez(
        data,
        X=generator.normal(size=(20, 32)).astype("float32"),
        y=generator.normal(size=(20, 1)).astype("float32"),
    )
    shutil.copy2(data, execution / data.name)
    # Exercise file-registration mapping without replacing model execution.
    registration = host / "registration.py"
    registration.write_text(
        "from wavedl.models import list_models\nassert list_models()\n"
    )
    shutil.copy2(registration, execution / registration.name)
    scheduler = CopyVisibilityScheduler(
        pwd.getpwuid(os.getuid()).pw_name, host, execution
    )
    settings = Settings(tmp_path / "state", host / "runs")
    services = HostedServices(
        settings,
        backend_factory=lambda lock: {
            "slurm": SlurmBackend(
                SlurmSite(partition="cpu", cluster="test-cluster", requeue=True),
                scheduler,
                owner=scheduler.owner,
                dispatch_lock=lock,
            )
        },
    )
    token = "mapped-qt-test-token"
    credential = tmp_path / "credential"
    credential.write_text(token)
    credential.chmod(0o600)
    app = create_app(
        settings,
        token=token,
        daemon_id="startup",
        build_id="mapped-qt-test",
        services=services,
    )
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(
            app,
            host="127.0.0.1",
            port=port,
            loop="asyncio",
            lifespan="on",
            log_level="error",
            access_log=False,
            timeout_graceful_shutdown=5,
        )
    )
    thread = threading.Thread(
        target=server.run, kwargs={"sockets": [listener]}, daemon=True
    )
    service = TrainingService()
    monkeypatch.setattr(main_window, "trainingService", service)
    dashboard = DashboardInterface()
    gallery = dashboard.resultPlotsCard
    completed, plotted, workers = [], [], []
    export, retained = tmp_path / "export", tmp_path / "retained-export"

    def completed_training(success, message):
        completed.append((success, message))
        if success:
            export.rename(retained)
            export.write_bytes(b"preserved conflicting user file")

    def completed_plot(*values):
        plotted.append(values)

    def retry():
        main_window.MainWindow.onResumePlots(SimpleNamespace())

    signalBus.trainingCompletedSig.connect(completed_training)
    signalBus.plotGeneratedSig.connect(completed_plot)
    signalBus.requestResumePlotsSig.connect(retry)

    def until(predicate, timeout=120):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            qt.processEvents()
            if predicate():
                return
            time.sleep(0.01)
        pytest.fail(f"Mapped workflow timeout; batch results: {scheduler.results!r}")

    thread.start()
    try:
        until(lambda: server.started, 20)

        def speed_fleet(session):
            fleet = session.controller._fleets["slurm"]
            fleet.policy = replace(
                fleet.policy, interval=0.02, backoff_initial=0.02, backoff_max=0.02
            )

        asyncio.run(services.host.call(speed_fleet))
        url = f"http://127.0.0.1:{port}"
        with httpx.Client(
            base_url=url, headers={"Authorization": f"Bearer {token}"}, timeout=10
        ) as client:
            health = client.get("/api/health")
            health.raise_for_status()
            connection = DaemonConnection(
                url,
                credential,
                sys.executable,
                backend="slurm",
                device="cpu",
                daemon_id=health.json()["daemon_id"],
                environment={
                    "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "src"),
                    "OMP_NUM_THREADS": "1",
                    "MKL_NUM_THREADS": "1",
                    "PATH": os.defpath,
                    "MPLBACKEND": "Agg",
                },
            )
            response = client.post(
                "/api/runs/plan",
                headers={"Idempotency-Key": "mapped-training"},
                json={
                    "backend": "slurm",
                    "operation": "train",
                    "topology": {
                        "num_machines": 1,
                        "processes_per_machine": 1,
                        "machine_rank": 0,
                    },
                    "config": {
                        "model": "cnn",
                        "epochs": 1,
                        "fresh": True,
                        "data_path": str(data),
                        "import_modules": [str(registration)],
                        "workers": 0,
                        "batch_size": 8,
                        "precision": "no",
                    },
                    "runtime": {
                        "python": connection.python,
                        "mode": "selected",
                        "device": "cpu",
                        "environment": dict(connection.environment),
                    },
                    "storage_map": [
                        {"host_root": str(host), "execution_root": str(execution)}
                    ],
                },
            )
            assert response.status_code == 200, response.text
            preview = response.json()
            source_ref = RunRef.from_preview(
                connection.daemon_id, preview, attempt=None
            )
            submitted = client.post("/api/runs", json={"plan_id": preview["plan_id"]})
            assert submitted.status_code == 202, submitted.text
            config = TrainingConfig(
                data_path=str(data),
                output_dir=str(export),
                model="cnn",
                epochs=1,
                batch_size=8,
                workers=0,
                precision="no",
                mixed_precision="no",
                pretrained=False,
            )
            training = TrainingWorker(config, connection=connection, run_ref=source_ref)
            workers.append(training)
            # Resume the HTTP-approved mapped run through actual worker signals.
            service._current_config, service._training_worker = config, training
            service._retain(training)
            training.finishedSig.connect(service._on_training_finished)
            training.start()
            until(lambda: completed and service._plot_worker is not None)
            assert len(completed) == 1 and completed[0][0], completed
            assert training.wait(5000)
            plot = service._plot_worker
            workers.append(plot)
            until(lambda: not plot.isRunning())
            qt.processEvents()
            assert plot._state == ProcessState.UNCERTAIN and not plot._terminal
            assert not plotted and not gallery.retryButton.isHidden()
            assert len(scheduler.jobs) == 2
            reference = plot.run_ref
            assert (
                reference is not None
                and reference.storage_map == training.run_ref.storage_map
            )
            assert reference.run_directory != reference.working_directory
            assert reference.data_path == str(execution / data.name)
            assert plot.training_run_ref == training.run_ref
            plot_host = Path(reference.run_directory)
            manifest = json.loads((plot_host / "manifest.json").read_bytes())
            source_manifest = json.loads(
                (Path(training.run_ref.run_directory) / "manifest.json").read_bytes()
            )
            assert manifest["resolved_config"]["import_modules"] == [
                str(execution / registration.name)
            ]
            assert (
                manifest["resolved_config"]["import_modules"]
                == source_manifest["resolved_config"]["import_modules"]
            )
            pin = manifest["checkpoint_source"]
            assert pin["run_id"] == training.run_ref.run_id
            source_publication = (
                Path(training.run_ref.run_directory) / "checkpoints" / pin["generation"]
            )
            assert source_publication.is_dir()
            assert (
                pin["complete_sha256"]
                == hashlib.sha256(
                    (source_publication / "COMPLETE.json").read_bytes()
                ).hexdigest()
            )
            assert (
                pin["manifest_sha256"]
                == hashlib.sha256(
                    (
                        Path(training.run_ref.run_directory) / "manifest.json"
                    ).read_bytes()
                ).hexdigest()
            )
            assert (
                json.loads((source_publication / "COMPLETE.json").read_bytes())[
                    "attempt"
                ]
                == 1
            )
            assert manifest["resolved_config"]["checkpoint"] == str(
                execution
                / "runs"
                / training.run_ref.run_id
                / "checkpoints"
                / pin["generation"]
            )
            response = client.get(f"/api/runs/{reference.run_id}/artifacts")
            response.raise_for_status()
            pngs = {
                Path(name).name: record
                for generation in response.json()["generations"]
                for name, record in generation["files"].items()
                if name.endswith(".png")
            }
            assert pngs
            before = client.get("/api/runs").json()["runs"]
            blocker = tmp_path / "preserved-blocker"
            export.rename(blocker)
            retained.rename(export)
            gallery.retryButton.click()
            assert service._plot_worker is plot
            until(lambda: plotted)
            assert plot.wait(5000) and len(plotted) == 1 and plotted[0][0]
            assert plot.run_ref == reference and plot._terminal
            assert service._plot_worker is None and len(scheduler.jobs) == 2
            assert {
                item["run_id"] for item in client.get("/api/runs").json()["runs"]
            } == {item["run_id"] for item in before}
            assert gallery._image_paths == plotted[0][2]
            for selected in plotted[0][2]:
                raw = Path(selected).read_bytes()
                record = pngs[Path(selected).name]
                assert (
                    raw.startswith(b"\x89PNG\r\n\x1a\n")
                    and not QImage(selected).isNull()
                )
                assert (
                    len(raw) == record["size"]
                    and hashlib.sha256(raw).hexdigest() == record["sha256"]
                )
            assert blocker.read_bytes() == b"preserved conflicting user file"
            assert len(scheduler.results) == 2
            assert all(
                isinstance(result, ProcessResult)
                and result.returncode == 0
                and not result.timed_out
                for result in scheduler.results
            ), scheduler.results
    finally:
        cleanup_errors = []

        def cleanup(label, action):
            try:
                action()
            except BaseException as error:
                cleanup_errors.append(f"{label}: {type(error).__name__}")

        cleanup(
            "training signal",
            lambda: signalBus.trainingCompletedSig.disconnect(completed_training),
        )
        cleanup(
            "plot signal", lambda: signalBus.plotGeneratedSig.disconnect(completed_plot)
        )
        cleanup(
            "retry signal", lambda: signalBus.requestResumePlotsSig.disconnect(retry)
        )
        cleanup("detach service", service.detachMonitoring)
        for worker in workers:
            cleanup("detach worker", worker.detach)
            cleanup("wait worker", lambda worker=worker: worker.wait(5000))
        # Batch subprocesses have a 90-second hard supervised deadline. Bound
        # individual joins so teardown can still request/reap the public server.
        for batch in scheduler.threads:
            cleanup("join batch", lambda batch=batch: batch.join(timeout=45))
        cleanup("stop server", lambda: setattr(server, "should_exit", True))
        cleanup("join server", lambda: thread.join(timeout=15))
        cleanup("close listener", listener.close)
        cleanup("delete dashboard", dashboard.deleteLater)
        cleanup("drain Qt", qt.processEvents)
        if thread.is_alive() or any(batch.is_alive() for batch in scheduler.threads):
            cleanup_errors.append("Owned server/batch thread remained alive")
        if any(worker.isRunning() for worker in workers):
            cleanup_errors.append("Owned Qt thread remained alive")
        if services.host.outstanding != 0 or (
            services.host._thread is not None and services.host._thread.is_alive()
        ):
            cleanup_errors.append("Owned service host work/thread remained alive")
        assert not cleanup_errors, cleanup_errors
