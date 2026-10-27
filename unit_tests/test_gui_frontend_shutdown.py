"""Closing the frontend detaches monitoring without cancelling remote work."""

import asyncio
import sys
import threading
from pathlib import Path
from uuid import uuid4

import pytest


pytest.importorskip("PySide6")

from PySide6.QtWidgets import QApplication

from wavedl_gui.common.constants.index import TrainingConfig
from wavedl_gui.service.daemon_contracts import DaemonConnection, RunRef
from wavedl_gui.service.training_service import TrainingService, TrainingWorker


@pytest.fixture(scope="module")
def application():
    app = QApplication.instance() or QApplication([])
    yield app
    app.processEvents()


def test_detach_monitoring_closes_running_bridge_without_cancel_rpc(
    application, monkeypatch
):
    entered = threading.Event()
    calls = []
    ref = RunRef(
        "daemon-a",
        str(uuid4()),
        str(uuid4()),
        str(uuid4()),
        1,
        "train",
        "/daemon/run",
        "/daemon/train.npz",
    )

    class Transport:
        async def request(self, method, path, **kwargs):
            calls.append((method, path))
            if path == "/api/health":
                return {"daemon_id": "daemon-a", "protocol_min": 1, "protocol_max": 1}
            entered.set()
            await asyncio.Event().wait()

        async def events(self, *args, **kwargs):
            await asyncio.Event().wait()
            yield None

    monkeypatch.setattr(DaemonConnection, "read_credential", lambda self: "test-token")
    connection = DaemonConnection(
        "http://127.0.0.1:8420", Path("/no-constructor-io"), sys.executable
    )
    worker = TrainingWorker(
        TrainingConfig(data_path="/daemon/train.npz"),
        connection=connection,
        transport_factory=lambda *args, **kwargs: Transport(),
        run_ref=ref,
    )
    service = TrainingService()
    service._training_worker = worker
    service._retain(worker)
    try:
        worker.start()
        assert entered.wait(2)
        assert service.activeMonitoringWorkers() == (worker,)
        service.detachMonitoring()
        assert worker.wait(1000)
        application.processEvents()
        assert service._closing
        assert not service.activeMonitoringWorkers()
        assert not any(method == "POST" for method, _ in calls)
        assert worker.run_ref == ref
        assert not worker._terminal
    finally:
        worker.detach()
        worker.wait(2000)
        application.processEvents()


def test_late_training_success_after_shutdown_cannot_start_plot_or_new_work(
    application, monkeypatch
):
    service = TrainingService()
    created = []

    def forbidden(*args, **kwargs):
        created.append(True)
        raise AssertionError("Shutdown created a new worker")

    monkeypatch.setattr("wavedl_gui.service.training_service.TrainingWorker", forbidden)
    monkeypatch.setattr("wavedl_gui.service.training_service.TestWorker", forbidden)
    monkeypatch.setattr("wavedl_gui.service.training_service.PlotWorker", forbidden)
    service._training_worker = object()
    service._current_config = TrainingConfig(data_path="/daemon/train.npz")
    service.detachMonitoring()
    service._on_training_finished(True, "Completed on daemon")
    service.start_training(service._current_config)
    service.start_test(object())
    service._start_plot_generation(service._current_config)
    assert not created
    assert service._training_worker is None
    application.processEvents()
