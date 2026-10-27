"""PlotWorker preserves daemon checkpoint authority and the local image UI."""

import asyncio
import hashlib
import json
import subprocess
import sys
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import pytest

from wavedl.core.client_transport import ArtifactRef, ClientTransportError
from wavedl.core.generations import publish_generation
from wavedl.core.layout import OperationKind, RunLayout, allocate_attempt
from wavedl.core.manifest import RuntimeSelection, build_manifest, write_manifest
from wavedl_gui.common.constants.index import TrainingConfig
from wavedl_gui.service.daemon_contracts import (
    DaemonConnection,
    RequestContractError,
    RunRef,
)


@pytest.mark.parametrize("failure", [None, "metadata", "export", "cancel"])
@pytest.mark.parametrize("onnx_only", [False, True])
def test_metadata_only_training_owns_and_cleans_scratch_on_every_exit(
    tmp_path, monkeypatch, failure, onnx_only
):
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
    worker = TrainingWorker(
        TrainingConfig(data_path="/host/data.npz", output_dir=""),
        connection=DaemonConnection(
            "http://localhost:8420",
            Path("/credential"),
            sys.executable,
            daemon_id="daemon",
        ),
        run_ref=source,
    )
    if onnx_only:
        worker._snapshot = replace(
            worker._snapshot, export_path=str(tmp_path / "model.onnx")
        )
    directories = []
    user_export = tmp_path / "existing-user-export"
    user_export.mkdir()
    preserved = user_export / "preserved"
    preserved.write_bytes(b"user bytes")

    async def selection(transport, run_ref, *, metadata_directory=None):
        assert metadata_directory is not None and metadata_directory.is_dir()
        assert not metadata_directory.is_relative_to(user_export)
        directories.append(metadata_directory)
        worker._download_directory = metadata_directory
        (metadata_directory / "checkpoint_selection.json").write_bytes(
            b"bounded metadata"
        )
        if failure == "cancel":
            raise asyncio.CancelledError()
        if failure is not None:
            raise ClientTransportError(f"{failure} refusal")
        worker._best_checkpoint_generation = "gen-000001"
        return []

    monkeypatch.setattr(worker, "_download_artifacts_into", selection)
    if failure is None:
        assert asyncio.run(worker._download_artifacts(object(), source)) == []
    elif failure == "cancel":
        with pytest.raises(asyncio.CancelledError):
            asyncio.run(worker._download_artifacts(object(), source))
    else:
        with pytest.raises(ClientTransportError, match="refusal"):
            asyncio.run(worker._download_artifacts(object(), source))
    assert len(directories) == 1 and not directories[0].exists()
    assert worker._download_directory is None
    assert preserved.read_bytes() == b"user bytes"


def test_actual_metadata_helper_cancel_never_queues_late_filesystem_writer(monkeypatch):
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
    worker = TrainingWorker(
        TrainingConfig(data_path="/host/data.npz", output_dir=""),
        connection=DaemonConnection(
            "http://localhost:8420",
            Path("/credential"),
            sys.executable,
            daemon_id="daemon",
        ),
        run_ref=source,
    )
    paths = []

    class CancelTransport:
        async def request(self, method, path):
            raw = b'{"schema_version":1,"kind":"best"}'
            return {
                "generations": [
                    {
                        "generation": "gen-000001",
                        "attempt": 1,
                        "files": {
                            "checkpoint_selection.json": {
                                "size": len(raw),
                                "sha256": hashlib.sha256(raw).hexdigest(),
                            }
                        },
                    }
                ]
            }

        async def download(self, ref, destination, *, max_bytes):
            assert destination.parent.is_dir()
            paths.append(destination.parent.parent)
            await asyncio.Event().wait()

    async def no_background_filesystem_work(*args, **kwargs):
        pytest.fail(
            "Metadata creation must not enqueue a cancellable background writer"
        )

    monkeypatch.setattr(asyncio, "to_thread", no_background_filesystem_work)

    async def cancel_real_helper():
        task = asyncio.create_task(
            worker._download_artifacts(CancelTransport(), source)
        )
        for _ in range(20):
            await asyncio.sleep(0)
            if paths:
                break
        assert paths
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        await asyncio.sleep(0)
        assert not paths[0].exists()
        assert worker._download_directory is None

    asyncio.run(cancel_real_helper())


class PlotTransport:
    """Only network responses are fake; the actual plot adapter consumes them."""

    def __init__(self, *, daemon_id="training-daemon", corrupt=False):
        self.ids = {name: str(uuid4()) for name in ("plan_id", "run_id", "request_id")}
        self.daemon_id, self.corrupt = daemon_id, corrupt
        self.calls, self.downloads = [], []
        self.closed = False
        self.blobs = {
            ("gen-000001", "scatter_all.png"): b"old-attempt plot",
            ("gen-000002", "error_histogram.png"): b"new histogram PNG bytes",
            ("gen-000002", "scatter_all.png"): b"new scatter PNG bytes",
            ("gen-000002", "predictions.csv"): b"x,y\n1,2\n",
            ("gen-000003", "scatter_all.png"): b"future-attempt plot",
        }
        self.inventory = {
            "generations": [
                self.generation(1, 1),
                self.generation(2, 2),
                self.generation(3, 3),
            ]
        }

    def generation(self, number, attempt):
        generation = f"gen-{number:06}"
        return {
            "generation": generation,
            "attempt": attempt,
            "step": 1,
            "files": {
                path: {
                    "size": len(content),
                    "sha256": hashlib.sha256(content).hexdigest(),
                }
                for (name, path), content in self.blobs.items()
                if name == generation
            },
        }

    def view(self, state="completed"):
        return self.ids | {
            "operation": "plot",
            "attempt": 2,
            "state": state,
            "uncertainty": False,
            "submission_requested": True,
        }

    async def request(self, method, path, body=None, **kwargs):
        self.calls.append((method, path, body, kwargs))
        if path == "/api/health":
            return {"daemon_id": self.daemon_id, "protocol_min": 1, "protocol_max": 1}
        if path == "/api/runs/plan":
            manifest = {
                "run_id": self.ids["run_id"],
                "operation": "plot",
                "run_directory": "/daemon/plot-run",
                "resolved_config": {"data_path": "/daemon/data.npz"},
            }
            return self.ids | {"preview": {"manifest_json": json.dumps(manifest)}}
        if path == "/api/runs":
            return self.view("running")
        if path.endswith("/artifacts"):
            return self.inventory
        return self.view()

    async def events(self, run_id, *, cursor):
        await asyncio.Event().wait()
        yield None

    async def download(self, reference, destination, *, max_bytes):
        assert isinstance(reference, ArtifactRef)
        assert reference.run_id == self.ids["run_id"]
        content = self.blobs[(reference.generation, reference.path)]
        assert len(content) <= max_bytes
        self.downloads.append(reference)
        if (
            self.corrupt
            or hashlib.sha256(content).hexdigest() != reference.sha256
            or len(content) != reference.size
        ):
            raise ClientTransportError("Artifact verification failed")
        Path(destination).write_bytes(content)
        return Path(destination)

    async def aclose(self):
        self.closed = True


@pytest.fixture
def plot_worker_factory(monkeypatch):
    pytest.importorskip("PySide6")
    pytest.importorskip("qfluentwidgets")
    from wavedl_gui.service.training_service import PlotWorker

    monkeypatch.setattr(
        DaemonConnection, "read_credential", lambda self: "worker-private-token"
    )

    def forbidden_spawn(*args, **kwargs):
        raise AssertionError("GUI plot consumers must not launch a process")

    monkeypatch.setattr(subprocess, "Popen", forbidden_spawn)

    def create(config, source, transport):
        return PlotWorker(
            config,
            connection=DaemonConnection(
                "http://localhost:8420",
                "/private/token",
                sys.executable,
                path_realm="remote",
            ),
            run_ref=source,
            transport_factory=lambda *args: transport,
        )

    return create


def training_reference(*, daemon="training-daemon"):
    return RunRef(
        daemon,
        str(uuid4()),
        str(uuid4()),
        str(uuid4()),
        1,
        "train",
        "/daemon/training-run",
        "/daemon/data.npz",
    )


@pytest.mark.parametrize("published", [False, True])
def test_plot_worker_uses_daemon_source_not_client_legacy_or_published_checkpoint(
    tmp_path, plot_worker_factory, published
):
    # Both old forms remain intact; a client folder is not remote authority.
    legacy = tmp_path / "best_checkpoint"
    legacy.mkdir()
    (legacy / "weights").write_bytes(b"existing user checkpoint")
    if published:
        layout = RunLayout(tmp_path, str(uuid4()))
        write_manifest(
            layout,
            build_manifest(
                layout,
                operation=OperationKind.TRAIN,
                resolved_config={},
                runtime=RuntimeSelection(sys.executable, "existing", "cpu", {}),
                submission_cwd=tmp_path,
            ),
        )
        attempt = allocate_attempt(layout)
        layout.checkpoints.mkdir()
        staging = tmp_path / "staging"
        staging.mkdir()
        (staging / "checkpoint_selection.json").write_text(
            '{"schema_version":1,"kind":"best"}'
        )
        (staging / "weights").write_bytes(b"safe")
        publish_generation(layout, staging, attempt=attempt, step=1)
    before = {
        str(path.relative_to(tmp_path)): path.read_bytes()
        for path in tmp_path.rglob("*")
        if path.is_file()
    }
    source = training_reference()
    config = TrainingConfig(
        output_dir=str(tmp_path), data_path="/client/changed-data.npz", workers=0
    )
    transport = PlotTransport()
    worker = plot_worker_factory(config, source, transport)
    completed = []
    worker.finishedSig.connect(lambda *args: completed.append(args))
    assert worker.training_run_ref == source
    assert worker._bridge.run_ref is None, "Plot must plan a new operation"
    assert worker._snapshot.expected_daemon_id == source.daemon_id
    worker.run()
    assert len(completed) == 1 and completed[0][0] is True, completed
    plans = [call for call in transport.calls if call[1] == "/api/runs/plan"]
    assert len(plans) == 1
    request = plans[0][2]
    assert request["operation"] == "plot"
    assert request["config"]["checkpoint"] == source.run_directory
    assert request["config"]["data_path"] == source.data_path
    assert "output_dir" not in request["config"]
    assert request["runtime"]["device"] == "cpu"
    assert plans[0][3]["idempotency_key"] == worker._bridge.idempotency_key
    submissions = [call for call in transport.calls if call[1] == "/api/runs"]
    assert submissions[0][2] == {"plan_id": transport.ids["plan_id"]}
    assert submissions[0][2]["plan_id"] != source.plan_id
    assert worker.run_ref.run_id == transport.ids["run_id"] != source.run_id
    paths = [Path(value) for value in completed[0][2]]
    assert [path.name for path in paths] == ["scatter_all.png", "error_histogram.png"]
    assert all(path.is_relative_to(tmp_path) and path.is_file() for path in paths)
    assert [path.read_bytes() for path in paths] == [
        b"new scatter PNG bytes",
        b"new histogram PNG bytes",
    ]
    assert {ref.generation for ref in transport.downloads} == {"gen-000002"}
    assert all(ref.path.endswith(".png") for ref in transport.downloads)
    for relative, content in before.items():
        assert (tmp_path / relative).read_bytes() == content
    assert transport.closed


def test_plot_source_identity_checked_before_any_mutation(
    tmp_path, plot_worker_factory
):
    transport = PlotTransport(daemon_id="reused-forwarding-port-daemon")
    worker = plot_worker_factory(
        TrainingConfig(output_dir=str(tmp_path)), training_reference(), transport
    )
    completed, connections = [], []
    worker.finishedSig.connect(lambda *args: completed.append(args))
    worker.connectionSig.connect(connections.append)
    worker._bridge._max_retries = 0
    worker.run()
    assert completed == []
    assert connections and transport.closed
    assert not any(method == "POST" for method, *_ in transport.calls)
    assert not transport.downloads


def test_plot_requires_source_run_not_arbitrary_output_folder(
    tmp_path, plot_worker_factory
):
    config = TrainingConfig(output_dir=str(tmp_path), data_path="/client/data.npz")
    with pytest.raises(RequestContractError):
        plot_worker_factory(config, None, PlotTransport())
    with pytest.raises(RequestContractError):
        plot_worker_factory(
            config, replace(training_reference(), operation="test"), PlotTransport()
        )


def test_plot_without_export_preference_keeps_local_image_signal(
    tmp_path, plot_worker_factory, monkeypatch
):
    from wavedl_gui.service import training_service

    monkeypatch.setattr(training_service.tempfile, "gettempdir", lambda: str(tmp_path))
    transport = PlotTransport()
    worker = plot_worker_factory(TrainingConfig(), training_reference(), transport)
    completed = []
    worker.finishedSig.connect(lambda *args: completed.append(args))
    worker.run()
    assert completed[0][0] is True
    paths = [Path(value) for value in completed[0][2]]
    assert len(paths) == 2
    assert all(path.is_relative_to(tmp_path) and path.is_file() for path in paths)
    assert worker._snapshot.output_directory == ""
    planned = next(call[2] for call in transport.calls if call[1] == "/api/runs/plan")
    assert "output_dir" not in planned["config"]


@pytest.mark.parametrize("bad", ["absent", "corrupt", "unsafe", "too_large"])
def test_plot_delivery_requires_verified_bounded_current_attempt_images(
    tmp_path, plot_worker_factory, bad
):
    transport = PlotTransport(corrupt=bad == "corrupt")
    if bad == "absent":
        transport.inventory["generations"] = [
            transport.generation(1, 1),
            transport.generation(3, 3),
        ]
    elif bad == "unsafe":
        transport.inventory["generations"][1]["files"]["../scatter_all.png"] = {
            "size": 1,
            "sha256": "0" * 64,
        }
    elif bad == "too_large":
        transport.inventory["generations"][1]["files"]["scatter_all.png"]["size"] = (
            512 * 1024**2 + 1
        )
    worker = plot_worker_factory(
        TrainingConfig(output_dir=str(tmp_path)), training_reference(), transport
    )
    completed, connections = [], []
    worker.finishedSig.connect(lambda *args: completed.append(args))
    worker.connectionSig.connect(connections.append)
    worker._bridge._max_retries = 0
    worker.run()
    assert completed == [], "Remote success is not successful local plot delivery"
    assert connections and transport.closed
    assert not worker._terminal
    if bad != "corrupt":
        assert transport.downloads == []
