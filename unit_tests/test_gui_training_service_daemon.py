"""Legacy UI workers are daemon clients, not process owners."""

import asyncio
import hashlib
import json
import sys
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import pytest


pytest.importorskip("PySide6")

from wavedl.core.protocol import Envelope
from wavedl_gui.common.constants.index import (
    TestConfig as InferenceConfig,
    TrainingConfig,
)
from wavedl_gui.service.daemon_contracts import DaemonConnection, RunRef
from wavedl_gui.service.training_service import (
    PlotWorker,
    ProcessState,
    TestWorker as InferenceWorker,
    TrainingProgress,
    TrainingService,
    TrainingWorker,
)


def connection():
    return DaemonConnection(
        "http://localhost:8420", Path("/no-credential-read"), sys.executable
    )


def reference(operation="train"):
    return RunRef(
        "daemon-a",
        str(uuid4()),
        str(uuid4()),
        str(uuid4()),
        1,
        operation,
        "/daemon/owned-run",
        "/daemon/train.npz",
    )


class Transport:
    def __init__(self, operation, *, failing_download=False):
        self.operation = operation
        self.ref = reference(operation)
        self.calls, self.downloads = [], []
        self.failing_download = failing_download
        self.payload = b"verified image"

    async def request(self, method, path, body=None, **kwargs):
        self.calls.append((method, path, body))
        if path == "/api/health":
            return {"daemon_id": "daemon-a", "protocol_min": 1, "protocol_max": 1}
        if path.endswith("/plan"):
            return {
                "plan_id": self.ref.plan_id,
                "run_id": self.ref.run_id,
                "request_id": self.ref.request_id,
                "preview": {
                    "manifest_json": json.dumps(
                        {
                            "run_id": self.ref.run_id,
                            "operation": self.operation,
                            "run_directory": self.ref.run_directory,
                            "resolved_config": {"data_path": self.ref.data_path},
                        }
                    )
                },
            }
        if path.endswith("/artifacts"):
            files = {
                "plots/scatter_all.png": {
                    "size": len(self.payload),
                    "sha256": hashlib.sha256(self.payload).hexdigest(),
                }
            }
            if self.operation == "train":
                content = b'{"schema_version":1,"kind":"best"}'
                files["checkpoint_selection.json"] = {
                    "size": len(content),
                    "sha256": hashlib.sha256(content).hexdigest(),
                }
            return {
                "generations": [
                    {
                        "generation": "gen-000001",
                        "attempt": 1,
                        "step": 1,
                        "files": files,
                    }
                ]
            }
        return {
            "plan_id": self.ref.plan_id,
            "run_id": self.ref.run_id,
            "request_id": self.ref.request_id,
            "operation": self.operation,
            "attempt": 1,
            "state": "completed",
            "uncertainty": False,
            "submission_requested": True,
            "cancellation_requested": False,
            "evidence": {"runtime": {"exit_seq": -1}},
        }

    async def events(self, run_id, cursor):
        await asyncio.Event().wait()
        yield None

    async def download(self, ref, path, *, max_bytes):
        if self.failing_download:
            raise RuntimeError("download unavailable")
        self.downloads.append((ref, path))
        content = (
            b'{"schema_version":1,"kind":"best"}'
            if ref.path == "checkpoint_selection.json"
            else self.payload
        )
        assert not path.exists() and ref.sha256 == hashlib.sha256(content).hexdigest()
        path.write_bytes(content)
        return path


def test_training_constructor_is_inert_and_snapshot_excludes_client_output(tmp_path):
    config = TrainingConfig(
        data_path="/daemon/train.npz", output_dir=str(tmp_path), no_cache=True
    )
    worker = TrainingWorker(config, connection=connection())
    assert worker.run_ref is None
    assert "output_dir" not in worker._snapshot.payload["config"]
    assert "no_cache" not in worker._snapshot.payload["config"]
    assert not list(tmp_path.iterdir())


class OnnxTransport(Transport):
    def __init__(self, *, artifacts=1, wrong_attempt=False):
        super().__init__("test")
        self.artifacts, self.wrong_attempt = artifacts, wrong_attempt

    async def request(self, method, path, body=None, **kwargs):
        value = await super().request(method, path, body, **kwargs)
        if path.endswith("/artifacts"):
            files = value["generations"][0]["files"]
            files.update(
                {
                    f"model-{index}.onnx": {
                        "size": len(self.payload),
                        "sha256": hashlib.sha256(self.payload).hexdigest(),
                    }
                    for index in range(self.artifacts)
                }
            )
            if self.wrong_attempt:
                value["generations"][0]["attempt"] = 2
        return value


def test_explicit_onnx_export_without_folder_downloads_only_selected_export(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(DaemonConnection, "read_credential", lambda self: "token")
    destination = tmp_path / "private-models" / "selected.onnx"
    transport = OnnxTransport()
    worker = InferenceWorker(
        InferenceConfig(
            checkpoint="/daemon/gen",
            data_path="/daemon/data.npz",
            output_dir="",
            export_format="onnx",
            export_path=str(destination),
        ),
        connection=connection(),
        transport_factory=lambda *args: transport,
    )
    finished = []
    worker.finishedSig.connect(lambda *args: finished.append(args))
    worker.run()
    assert len(finished) == 1 and finished[0][0] is True
    assert finished[0][2]["artifact_paths"] == [str(destination)]
    assert destination.read_bytes() == transport.payload
    assert len(transport.downloads) == 1
    assert transport.downloads[0][0].path == "model-0.onnx"
    assert transport.downloads[0][1] == destination
    assert worker._download_directory is None
    posted = next(body for _, path, body in transport.calls if path.endswith("/plan"))
    assert posted["config"]["export"] == "onnx"
    assert (
        "export_path" not in posted["config"] and "output_dir" not in posted["config"]
    )


def test_explicit_onnx_destination_never_overwrites_existing_user_file(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(DaemonConnection, "read_credential", lambda self: "token")
    destination = tmp_path / "existing.onnx"
    destination.write_bytes(b"existing user model")
    mode = tmp_path.stat().st_mode
    transport = OnnxTransport()
    worker = InferenceWorker(
        InferenceConfig(
            checkpoint="/daemon/gen",
            data_path="/daemon/data.npz",
            export_format="onnx",
            export_path=str(destination),
        ),
        connection=connection(),
        transport_factory=lambda *args: transport,
    )
    finished, states = [], []
    worker.finishedSig.connect(lambda *args: finished.append(args))
    worker.stateSig.connect(states.append)
    worker.run()
    assert finished == [] and worker._terminal is False
    assert states[-1] == ProcessState.UNCERTAIN
    assert ProcessState.COMPLETED not in states
    assert destination.read_bytes() == b"existing user model"
    assert tmp_path.stat().st_mode == mode


@pytest.mark.parametrize("artifacts,wrong_attempt", [(0, False), (2, False), (1, True)])
def test_explicit_export_requires_one_current_attempt_artifact(
    tmp_path, monkeypatch, artifacts, wrong_attempt
):
    monkeypatch.setattr(DaemonConnection, "read_credential", lambda self: "token")
    destination = tmp_path / "selected.onnx"
    transport = OnnxTransport(artifacts=artifacts, wrong_attempt=wrong_attempt)
    worker = InferenceWorker(
        InferenceConfig(
            checkpoint="/daemon/gen",
            data_path="/daemon/data.npz",
            export_format="onnx",
            export_path=str(destination),
        ),
        connection=connection(),
        transport_factory=lambda *args: transport,
    )
    finished = []
    worker.finishedSig.connect(lambda *args: finished.append(args))
    worker.run()
    assert finished == [] and worker._terminal is False
    assert transport.downloads == []
    assert not destination.exists()


def test_explicit_export_is_last_so_other_delivery_failure_can_retry(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(DaemonConnection, "read_credential", lambda self: "token")
    destination = tmp_path / "user-models" / "selected.onnx"
    transport = OnnxTransport()
    transport.failing_download = True
    worker = InferenceWorker(
        InferenceConfig(
            checkpoint="/daemon/gen",
            data_path="/daemon/data.npz",
            output_dir=str(tmp_path / "reports"),
            export_format="onnx",
            export_path=str(destination),
        ),
        connection=connection(),
        transport_factory=lambda *args: transport,
    )
    finished = []
    worker.finishedSig.connect(lambda *args: finished.append(args))
    worker.run()
    assert finished == [] and not destination.exists()
    assert not any(ref.path.endswith(".onnx") for ref, _ in transport.downloads)
    identity, key = worker.run_ref, worker._bridge.idempotency_key
    transport.failing_download = False
    worker.run()
    assert finished[0][0] is True
    assert destination.read_bytes() == transport.payload
    assert finished[0][2]["artifact_paths"][-1] == str(destination)
    assert transport.downloads[-1][0].path == "model-0.onnx"
    assert worker.run_ref == identity and worker._bridge.idempotency_key == key
    assert sum(path.endswith("/plan") for _, path, _ in transport.calls) == 1


def test_explicit_export_parent_symlink_is_refused_before_creating_children(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(DaemonConnection, "read_credential", lambda self: "token")
    outside = tmp_path / "outside"
    outside.mkdir()
    alias = tmp_path / "link"
    try:
        alias.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("Symlink creation unavailable")
    transport = OnnxTransport()
    worker = InferenceWorker(
        InferenceConfig(
            checkpoint="/daemon/gen",
            data_path="/daemon/data.npz",
            export_format="onnx",
            export_path=str(alias / "new-child" / "model.onnx"),
        ),
        connection=connection(),
        transport_factory=lambda *args: transport,
    )
    finished = []
    worker.finishedSig.connect(lambda *args: finished.append(args))
    worker.run()
    assert finished == [] and not worker._terminal
    assert list(outside.iterdir()) == [] and transport.downloads == []


def test_training_download_failure_retains_identity_without_false_terminal(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(
        DaemonConnection, "read_credential", lambda self: "private-token"
    )
    transport = Transport("train", failing_download=True)
    worker = TrainingWorker(
        TrainingConfig(data_path="/daemon/train.npz", output_dir=str(tmp_path)),
        connection=connection(),
        transport_factory=lambda *args: transport,
    )
    finished, states = [], []
    worker.finishedSig.connect(lambda *args: finished.append(args))
    worker.stateSig.connect(states.append)
    worker.run()
    assert not finished and not worker._terminal
    assert worker.run_ref.run_id == transport.ref.run_id
    assert states[-1] == ProcessState.UNCERTAIN
    assert ProcessState.COMPLETED not in states
    key = worker._bridge.idempotency_key
    transport.failing_download = False
    worker.run()
    assert worker._bridge.idempotency_key == key
    assert len([call for call in transport.calls if call[1].endswith("/plan")]) == 1
    assert finished == [(True, "Operation completed")]


def test_plot_uses_daemon_training_reference_and_verified_private_downloads(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(DaemonConnection, "read_credential", lambda self: "token")
    original = reference()
    transport = Transport("plot")
    worker = PlotWorker(
        TrainingConfig(data_path="/ignored/client-path.npz", output_dir=str(tmp_path)),
        connection=connection(),
        run_ref=original,
        transport_factory=lambda *args: transport,
    )
    posted = worker._snapshot.payload["config"]
    assert (
        posted["checkpoint"] == original.run_directory
        and posted["data_path"] == original.data_path
    )
    assert "output_dir" not in posted and worker._bridge.run_ref is None
    finished = []
    worker.finishedSig.connect(lambda *args: finished.append(args))
    worker.run()
    assert finished[0][0] is True
    path = Path(finished[0][2][0])
    assert path.read_bytes() == transport.payload
    root = path.parents[2]
    assert root.parent == tmp_path and root.name.startswith("wavedl-")
    assert root.stat().st_mode & 0o077 == 0


def test_training_active_history_resets_and_supersedes_without_mutable_progress_aliasing():
    worker = TrainingWorker(
        TrainingConfig(data_path="/daemon/train.npz"), connection=connection()
    )
    ref = reference()
    worker._on_run_changed(ref)
    histories, progress = [], []
    worker.historySig.connect(histories.append)
    worker.progressSig.connect(progress.append)
    for seq, epoch in enumerate((1, 2)):
        worker._on_event(
            Envelope(
                ref.run_id,
                1,
                "metric",
                seq,
                "2026-10-05T00:00:00Z",
                {
                    "name": "epoch",
                    "value": 1.0,
                    "step": epoch,
                    "metrics": {
                        "epoch": epoch,
                        "total_epochs": 3,
                        "train_loss": float(epoch),
                    },
                },
            )
        )
    assert progress[0].epoch == 1 and progress[1].epoch == 2
    worker._on_run_changed(replace(ref, attempt=2))
    assert progress[-1].epoch == 0
    worker._on_event(
        Envelope(
            ref.run_id,
            2,
            "supersede",
            0,
            "2026-10-05T00:00:00Z",
            {
                "source_attempt": 1,
                "step": 1,
                "source_seq": 0,
                "generation": "gen-000001",
            },
        )
    )
    assert [item.epoch for item in histories[-1]] == [1]
    assert isinstance(progress[-1], TrainingProgress)


def test_stop_only_delegates_durable_cancel(monkeypatch):
    worker = InferenceWorker(
        InferenceConfig(checkpoint="/daemon/checkpoint", data_path="/daemon/train.npz"),
        connection=connection(),
    )
    calls = []
    monkeypatch.setattr(worker._bridge, "stop", lambda: calls.append("cancel"))
    worker.stop()
    assert calls == ["cancel"]


def test_service_invalid_config_reports_app_error_instead_of_throwing(monkeypatch):
    import wavedl_gui.service.training_service as module
    from wavedl_gui.common.signal_bus import signalBus

    monkeypatch.setattr(
        module,
        "TrainingWorker",
        lambda *args: (_ for _ in ()).throw(ValueError("private config")),
    )
    errors = []
    signalBus.appErrorSig.connect(errors.append)
    try:
        TrainingService().start_training(TrainingConfig())
    finally:
        signalBus.appErrorSig.disconnect(errors.append)
    assert errors == ["Training configuration or daemon connection is invalid"]


@pytest.mark.parametrize("terminal", [False, True])
def test_reconnect_resumes_only_retained_uncertain_training(terminal):
    """Reconnect never creates a new plan from an empty or stale draft."""
    from types import SimpleNamespace

    service = TrainingService()
    calls = []
    worker = SimpleNamespace(
        _terminal=terminal,
        _monitoring_retired=False,
        _state=ProcessState.UNCERTAIN,
        isRunning=lambda: False,
        resume=lambda: calls.append("resume") or True,
    )
    service._training_worker = worker

    assert service.resume_training_if_needed() is (not terminal)
    assert calls == ([] if terminal else ["resume"])


def test_reconnect_ignores_retired_uncertain_training():
    from types import SimpleNamespace

    service = TrainingService()
    calls = []
    service._training_worker = SimpleNamespace(
        _terminal=False,
        _monitoring_retired=True,
        _state=ProcessState.UNCERTAIN,
        isRunning=lambda: False,
        resume=lambda: calls.append("resume") or True,
    )

    assert not service.resume_training_if_needed()
    assert calls == []


def test_shutdown_never_resumes_retained_uncertain_training():
    from types import SimpleNamespace

    service = TrainingService()
    calls = []
    service._closing = True
    service._training_worker = SimpleNamespace(
        _terminal=False,
        _state=ProcessState.UNCERTAIN,
        isRunning=lambda: False,
        resume=lambda: calls.append("resume") or True,
    )

    assert not service.resume_training_if_needed()
    assert calls == []


def test_training_auto_plot_transfers_daemon_reference_and_retains_thread(monkeypatch):
    service = TrainingService()
    worker = TrainingWorker(
        TrainingConfig(data_path="/daemon/train.npz"), connection=connection()
    )
    worker.run_ref = replace(reference(), checkpoint_generation="gen-000001")
    worker.result = {"checkpoint_generation": "gen-000001"}
    worker._terminal = True
    service._training_worker, service._current_config = worker, worker.config
    service._retain(worker)
    captured = []
    monkeypatch.setattr(
        service, "_start_plot_generation", lambda *args: captured.append(args)
    )
    service._on_training_finished(True, "completed")
    assert captured[0][1] == worker.run_ref
    assert worker in service._retained_workers
    worker.finished.emit()
    assert worker not in service._retained_workers


@pytest.mark.parametrize("old_running", [False, True])
def test_new_training_plot_detaches_old_monitor_and_ignores_its_late_result(
    monkeypatch, old_running
):
    from PySide6.QtCore import QObject, Signal

    import wavedl_gui.service.training_service as module
    from wavedl_gui.common.signal_bus import signalBus

    class FakePlot(QObject):
        finished = Signal()
        finishedSig = Signal(bool, str, list)
        outputSig = Signal(str)
        stateSig = Signal(object)

        def __init__(self, config, *, run_ref, **kwargs):
            super().__init__()
            self.training_run_ref = run_ref
            self._terminal = False
            self._state = ProcessState.STARTING
            self.started = self.detached = self.resumed = False

        def isRunning(self):
            return self.started

        def start(self):
            self.started = True

        def detach(self):
            self.detached = True

        def resume(self):
            self.resumed = True

    monkeypatch.setattr(module, "PlotWorker", FakePlot)
    service = TrainingService()
    outputs, starts, logs = [], [], []

    def on_result(*args):
        outputs.append(args)

    def on_start():
        starts.append(True)

    signalBus.plotGeneratedSig.connect(on_result)
    signalBus.plotStartedSig.connect(on_start)
    signalBus.trainingOutputSig.connect(logs.append)
    try:
        service._start_plot_generation(TrainingConfig(), reference())
        old = service._plot_worker
        old.started = old_running
        service._start_plot_generation(TrainingConfig(), reference())
        current = service._plot_worker
        assert current is not old and old.detached and not old.resumed
        assert (old in service._retained_workers) is old_running
        old.started = False
        old.finished.emit()
        assert old not in service._retained_workers and not old._terminal
        old.finishedSig.emit(True, "old", ["old.png"])
        old.outputSig.emit("old log")
        assert not outputs and service._plot_worker is current
        assert logs == []
        service._start_plot_generation(TrainingConfig(), reference())
        newest = service._plot_worker
        assert newest is not current and current.detached
        current.started = False
        current.finished.emit()
        assert current not in service._retained_workers
        current.finishedSig.emit(True, "old", ["old.png"])
        current.outputSig.emit("another old log")
        assert not outputs and service._plot_worker is newest
        newest.outputSig.emit("current log")
        assert logs == ["current log"]
        newest.finishedSig.emit(True, "new", ["new.png"])
        assert outputs == [(True, "new", ["new.png"])]
        assert service._plot_worker is None and starts == [True, True, True]
    finally:
        signalBus.plotGeneratedSig.disconnect(on_result)
        signalBus.plotStartedSig.disconnect(on_start)
        signalBus.trainingOutputSig.disconnect(logs.append)


def test_cv_success_does_not_start_dashboard_plot_spinner(monkeypatch):
    from types import SimpleNamespace

    from wavedl_gui.view.dashboard_interface import DashboardInterface, InfoBar

    calls = []
    monkeypatch.setattr(InfoBar, "success", lambda **kwargs: None)
    dashboard = SimpleNamespace(
        tr=lambda text: text,
        resultPlotsCard=SimpleNamespace(setGenerating=lambda: calls.append(True)),
    )
    DashboardInterface._on_completed(dashboard, True, "Cross-validation completed")
    assert calls == []
    DashboardInterface._on_plots_started(dashboard)
    assert calls == [True]


def test_empty_successful_plot_result_clears_dashboard_spinner(monkeypatch):
    from types import SimpleNamespace

    from wavedl_gui.view.dashboard_interface import DashboardInterface, InfoBar

    calls = []
    monkeypatch.setattr(InfoBar, "warning", lambda **kwargs: None)
    dashboard = SimpleNamespace(
        tr=lambda text: text,
        resultPlotsCard=SimpleNamespace(reset=lambda: calls.append("reset")),
    )
    DashboardInterface._on_plots_generated(dashboard, True, "No plots", [])
    assert calls == ["reset"]


class ExportTransport:
    def __init__(self, *, oversized_selected=False, tampered_selection=False):
        self.downloads = []
        self.messages = []
        self.payloads = {}
        self.generations = []
        self.tampered_selection = tampered_selection
        for number in range(1, 1001):
            kind = "best" if number in {997, 999} else "periodic"
            name = f"gen-{number:06d}"
            content = json.dumps(
                {"schema_version": 1, "kind": kind, "source_seq": number}
            ).encode()
            self.payloads[name, "checkpoint_selection.json"] = content
            weights = b"safe weights"
            self.payloads[name, "pytorch_model.bin"] = weights
            self.generations.append(
                {
                    "generation": name,
                    "attempt": 1,
                    "step": 1001 - number,
                    "files": {
                        "checkpoint_selection.json": {
                            "size": len(content),
                            "sha256": hashlib.sha256(content).hexdigest(),
                        },
                        "pytorch_model.bin": {
                            "size": (
                                2**31
                                if number != 999 or oversized_selected
                                else len(weights)
                            ),
                            "sha256": hashlib.sha256(weights).hexdigest(),
                        },
                    },
                }
            )

    async def request(self, method, path):
        return {"generations": self.generations}

    async def download(self, ref, destination, *, max_bytes):
        self.downloads.append(ref)
        content = self.payloads[ref.generation, ref.path]
        if self.tampered_selection and ref.path == "checkpoint_selection.json":
            content = b'{"schema_version":1,"kind":"best"}'
        else:
            assert (
                len(content) == ref.size
                and hashlib.sha256(content).hexdigest() == ref.sha256
            )
        assert ref.size <= max_bytes
        destination.write_bytes(content)
        return destination


def test_latest_verified_best_selected_without_download_of_gigabytes_of_periodics(
    tmp_path,
):
    worker = TrainingWorker(
        TrainingConfig(data_path="/daemon/train.npz", output_dir=str(tmp_path)),
        connection=connection(),
    )
    transport = ExportTransport()
    paths = asyncio.run(worker._download_artifacts(transport, reference()))
    assert len(paths) == 2
    assert all("gen-000999" in path for path in paths)
    assert [(ref.generation, ref.path) for ref in transport.downloads] == [
        ("gen-001000", "checkpoint_selection.json"),
        ("gen-000999", "checkpoint_selection.json"),
        ("gen-000999", "pytorch_model.bin"),
    ]
    assert max(Path(path).stat().st_size for path in paths) < 4096


def test_training_without_export_preference_verifies_only_best_metadata():
    worker = TrainingWorker(
        TrainingConfig(data_path="/daemon/train.npz"), connection=connection()
    )

    transport = Transport("train")
    assert asyncio.run(worker._download_artifacts(transport, reference())) == []
    assert [(ref.generation, ref.path) for ref, _ in transport.downloads] == [
        ("gen-000001", "checkpoint_selection.json")
    ]
    assert worker._best_checkpoint_generation == "gen-000001"


def test_checkpoint_classification_is_hash_verified_not_journal_or_filename(tmp_path):
    worker = TrainingWorker(
        TrainingConfig(data_path="/daemon/train.npz", output_dir=str(tmp_path)),
        connection=connection(),
    )
    from wavedl.core.client_transport import ClientTransportError

    with pytest.raises(ClientTransportError, match="integrity"):
        asyncio.run(
            worker._download_artifacts(
                ExportTransport(tampered_selection=True), reference()
            )
        )
    assert not worker._terminal


def test_oversized_selected_generation_is_explicit_export_uncertainty_not_training_failure(
    tmp_path,
):
    from wavedl.core.client_transport import ClientTransportError

    worker = TrainingWorker(
        TrainingConfig(data_path="/daemon/train.npz", output_dir=str(tmp_path)),
        connection=connection(),
    )
    messages = []
    worker.connectionSig.connect(messages.append)
    with pytest.raises(ClientTransportError, match="download budget"):
        asyncio.run(
            worker._download_artifacts(
                ExportTransport(oversized_selected=True), reference()
            )
        )
    assert messages == [
        "Remote operation completed; selected artifact generation exceeds the client export budget"
    ]
    assert not worker._terminal


def test_auto_plot_config_is_deep_copied_at_start(monkeypatch):
    import wavedl_gui.service.training_service as module

    real = TrainingWorker
    monkeypatch.setattr(
        module, "TrainingWorker", lambda config: real(config, connection=connection())
    )
    monkeypatch.setattr(real, "start", lambda self: None)
    config = TrainingConfig(
        data_path="/daemon/original.npz", output_dir="/client/original", epochs=7
    )
    service = TrainingService()
    service.start_training(config)
    config.data_path, config.output_dir, config.epochs = (
        "/daemon/changed.npz",
        "/client/changed",
        999,
    )
    assert service._current_config.data_path == "/daemon/original.npz"
    assert service._current_config.output_dir == "/client/original"
    assert service._current_config.epochs == 7
    assert service._training_worker._snapshot.payload["config"]["epochs"] == 7


def test_fresh_attempt_epoch_metrics_do_not_inherit_prior_progress():
    worker = TrainingWorker(
        TrainingConfig(data_path="/daemon/train.npz"), connection=connection()
    )
    ref = reference()
    worker._on_run_changed(ref)
    worker._on_event(
        Envelope(
            ref.run_id,
            1,
            "metric",
            0,
            "2026-10-05T00:00:00Z",
            {
                "name": "epoch",
                "value": 1.0,
                "step": 8,
                "metrics": {"epoch": 8, "total_epochs": 20, "train_loss": 9.0},
            },
        )
    )
    worker._on_run_changed(replace(ref, attempt=2))
    worker._on_event(
        Envelope(
            ref.run_id,
            2,
            "metric",
            0,
            "2026-10-05T00:00:00Z",
            {
                "name": "epoch",
                "value": 1.0,
                "step": 1,
                "metrics": {"epoch": 1, "train_loss": 1.0},
            },
        )
    )
    assert worker._parser.progress.epoch == 1
    assert worker._parser.progress.total_epochs == 0
    assert worker._parser.progress.train_loss == 1.0
