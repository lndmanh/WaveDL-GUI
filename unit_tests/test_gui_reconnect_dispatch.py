"""Dashboard reconnect bypasses editable project validation, not identity fences."""

import sys
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest


pytest.importorskip("PySide6")

from wavedl_gui.common.constants.index import TrainingConfig
from wavedl_gui.service.daemon_contracts import DaemonConnection, RunRef
from wavedl_gui.service.training_service import (
    ProcessState,
    TrainingService,
    TrainingWorker,
)
from wavedl_gui.view.main_window import MainWindow


def test_plot_retry_button_dispatch_retains_run_after_transport_uncertainty(
    tmp_path, monkeypatch
):
    import time

    from PySide6.QtWidgets import QApplication

    import wavedl_gui.view.main_window as module
    from unit_tests.test_gui_training_service_daemon import (
        Transport,
        connection,
        reference,
    )
    from wavedl_gui.common.signal_bus import signalBus
    from wavedl_gui.view.dashboard_interface import DashboardInterface

    qt = QApplication.instance() or QApplication([])
    monkeypatch.setattr(DaemonConnection, "read_credential", lambda self: "token")
    monkeypatch.setattr(module.InfoBar, "success", lambda **kwargs: None)
    service = TrainingService()
    monkeypatch.setattr(module, "trainingService", service)
    dashboard = DashboardInterface()

    def dispatch():
        MainWindow.onResumePlots(SimpleNamespace())

    signalBus.requestResumePlotsSig.connect(dispatch)
    transport = Transport("plot", failing_download=True)

    def until(predicate):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            qt.processEvents()
            if predicate():
                return
            time.sleep(0.005)
        pytest.fail("Timed out waiting for plot monitor")

    try:
        service._start_plot_generation(
            TrainingConfig(output_dir=str(tmp_path)),
            reference(),
            connection(),
            lambda *args: transport,
        )
        plot = service._plot_worker
        until(lambda: plot._state is ProcessState.UNCERTAIN and not plot.isRunning())
        card = dashboard.resultPlotsCard
        assert not card.retryButton.isHidden()
        assert card._spinner.isHidden()
        retained_ref, key = plot.run_ref, plot._bridge.idempotency_key
        transport.failing_download = False
        card.retryButton.click()
        assert service._plot_worker is plot
        assert card.retryButton.isHidden() and not card._spinner.isHidden()
        until(lambda: service._plot_worker is None and not plot.isRunning())
        assert plot.run_ref == retained_ref and plot._bridge.idempotency_key == key
        assert service._training_worker is None and service._current_config is None
        assert sum(path.endswith("/plan") for _, path, _ in transport.calls) == 1
        assert card._spinner_widget.isHidden() and card.retryButton.isHidden()
        assert card._image_paths
    finally:
        signalBus.requestResumePlotsSig.disconnect(dispatch)
        service.detachMonitoring()
        for worker in service._retained_workers:
            assert worker.wait(5000)
        dashboard.deleteLater()
        qt.processEvents()


@pytest.mark.parametrize("fence", ["terminal", "retired", "closing", "running"])
def test_plot_retry_identity_fences(fence):
    calls = []
    service = TrainingService()
    service._closing = fence == "closing"
    service._plot_worker = SimpleNamespace(
        _terminal=fence == "terminal",
        _monitoring_retired=fence == "retired",
        _state=ProcessState.UNCERTAIN,
        isRunning=lambda: fence == "running",
        resume=lambda: calls.append("resume") or True,
    )
    assert not service.resume_plot_if_needed()
    assert calls == []


def test_plot_uncertainty_enables_retry_only_after_thread_exit_and_ignores_late_state():
    from wavedl_gui.common.signal_bus import signalBus

    service = TrainingService()
    worker = SimpleNamespace(_terminal=False, isRunning=lambda: True)
    service._plot_worker = worker
    states = []

    def observed(*args):
        states.append(args)

    signalBus.plotStateChangedSig.connect(observed)
    try:
        service._on_plot_state(worker, ProcessState.UNCERTAIN)
        worker.isRunning = lambda: False
        service._on_plot_state(worker, ProcessState.UNCERTAIN)
        worker._monitoring_retired = True
        service._on_plot_state(worker, ProcessState.UNCERTAIN)
        worker._monitoring_retired = False
        service._closing = True
        service._on_plot_state(worker, ProcessState.UNCERTAIN)
        service._closing = False
        service._plot_worker = None
        service._on_plot_state(worker, ProcessState.UNCERTAIN)
        assert states == [
            (ProcessState.UNCERTAIN, False),
            (ProcessState.UNCERTAIN, True),
        ]
    finally:
        signalBus.plotStateChangedSig.disconnect(observed)


def test_reconnect_dispatch_does_not_read_empty_or_changed_draft(monkeypatch):
    import wavedl_gui.view.main_window as module

    class UnreadableDraft:
        @property
        def data_path(self):
            raise AssertionError("Reconnect read the fresh draft")

    calls = []
    service = TrainingService()
    service._training_worker = SimpleNamespace(
        _terminal=False,
        _state=ProcessState.UNCERTAIN,
        isRunning=lambda: False,
        resume=lambda: calls.append("resume") or True,
    )
    monkeypatch.setattr(module, "trainingService", service)
    window = SimpleNamespace(
        projectInterface=UnreadableDraft(),
        dashboardInterface=object(),
        switchTo=lambda view: calls.append(view),
    )

    MainWindow.onStartTraining(window)

    assert calls == ["resume", window.dashboardInterface]


@pytest.mark.parametrize("retired,terminal", [(False, True), (True, False)])
def test_terminal_or_retired_reconnect_cannot_submit_empty_draft(
    monkeypatch, retired, terminal
):
    import wavedl_gui.view.main_window as module

    calls = []
    service = TrainingService()
    service._training_worker = SimpleNamespace(
        _terminal=terminal,
        _monitoring_retired=retired,
        _state=ProcessState.UNCERTAIN,
        isRunning=lambda: False,
        resume=lambda: calls.append("resume") or True,
    )
    monkeypatch.setattr(module, "trainingService", service)
    monkeypatch.setattr(
        module.InfoBar, "warning", lambda **kwargs: calls.append("warn")
    )
    monkeypatch.setattr(
        service, "start_training", lambda config: calls.append("submit")
    )
    window = SimpleNamespace(
        projectInterface=SimpleNamespace(data_path="", output_dir=""),
        dashboardInterface=object(),
        switchTo=lambda view: calls.append(view),
        tr=lambda text: text,
    )

    MainWindow.onStartTraining(window)

    assert calls == ["warn", window.projectInterface]


@pytest.mark.parametrize("acknowledged", [False, True])
def test_reconnect_dispatch_preserves_actual_worker_identity_fence(
    monkeypatch, acknowledged
):
    import wavedl_gui.view.main_window as module

    requests = []

    class ChangedDaemon:
        async def request(self, method, path, **kwargs):
            requests.append((method, path))
            return {"daemon_id": "replacement", "protocol_min": 1, "protocol_max": 1}

    connection = DaemonConnection(
        "http://localhost:8420", Path("/unused"), sys.executable, daemon_id="original"
    )
    monkeypatch.setattr(DaemonConnection, "read_credential", lambda self: "private")
    ref = (
        RunRef(
            "original",
            str(uuid4()),
            str(uuid4()),
            str(uuid4()),
            1,
            "train",
            "/daemon/run",
            "/daemon/train.npz",
        )
        if acknowledged
        else None
    )
    worker = TrainingWorker(
        TrainingConfig(data_path="/daemon/train.npz"),
        connection=connection,
        transport_factory=lambda *args, **kwargs: ChangedDaemon(),
        run_ref=ref,
    )
    worker._state = ProcessState.UNCERTAIN
    monkeypatch.setattr(worker._bridge, "start", worker._bridge.run)
    service = TrainingService()
    service._training_worker = worker
    monkeypatch.setattr(module, "trainingService", service)
    window = SimpleNamespace(dashboardInterface=object(), switchTo=lambda view: None)
    key = worker._bridge.idempotency_key

    MainWindow.onStartTraining(window)

    assert requests and all(path == "/api/health" for _, path in requests)
    assert worker.run_ref == ref and not worker._terminal
    assert worker._bridge.idempotency_key == key
