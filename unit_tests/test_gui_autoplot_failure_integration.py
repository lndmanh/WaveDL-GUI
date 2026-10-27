"""Automatic plotting survives a real local export fault without resubmission.

Uses the supported unmapped Local backend, public HTTP, real QThreads, CPU
training and runtime-produced PNGs; no transport or raster substitutes.
"""

import hashlib
import socket
import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import httpx
import numpy as np
import pytest


pytestmark = pytest.mark.integration


def test_autoplot_export_fault_retains_completed_run_and_retries_without_duplicate(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("QT_QPA_PLATFORM", "offscreen")
    pytest.importorskip("PySide6")
    pytest.importorskip("qfluentwidgets")
    uvicorn = pytest.importorskip("uvicorn")
    from PySide6.QtGui import QImage
    from PySide6.QtWidgets import QApplication

    from wavedl_daemon.http.app import create_app
    from wavedl_daemon.runs.runtime_service import HostedServices
    from wavedl_daemon.storage.settings import Settings
    from wavedl_gui.common import config as gui_config
    from wavedl_gui.common.constants.index import TrainingConfig
    from wavedl_gui.common.signal_bus import signalBus
    from wavedl_gui.service.daemon_contracts import DaemonConnection
    from wavedl_gui.service.training_service import ProcessState, TrainingService
    from wavedl_gui.view import main_window
    from wavedl_gui.view.dashboard_interface import DashboardInterface

    qt = QApplication.instance() or QApplication([])
    state = tmp_path / "state"
    state.mkdir(mode=0o700)
    settings = Settings(state, tmp_path / "runs")
    token = "temporary-autoplot-fault-token"
    credential = tmp_path / "credential"
    credential.write_text(token)
    credential.chmod(0o600)
    data = tmp_path / "samples.npz"
    random = np.random.default_rng(9)
    np.savez(
        data,
        X=random.normal(size=(20, 32)).astype("float32"),
        y=random.normal(size=(20, 1)).astype("float32"),
    )
    services = HostedServices(settings)
    app = create_app(
        settings,
        token=token,
        daemon_id="before-startup",
        build_id="autoplot-fault-test",
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
        target=server.run,
        kwargs={"sockets": [listener]},
        name="autoplot-fault-daemon",
        daemon=True,
    )
    service = TrainingService()
    monkeypatch.setattr(main_window, "trainingService", service)
    dashboard = DashboardInterface()
    gallery = dashboard.resultPlotsCard

    def retry_plots():
        main_window.MainWindow.onResumePlots(SimpleNamespace())

    signalBus.requestResumePlotsSig.connect(retry_plots)
    workers, completed, plotted, fault_errors = [], [], [], []
    export = tmp_path / "client-export"
    retained_export = tmp_path / "retained-training-export"
    blocker = tmp_path / "retained-export-blocker"
    blocker_content = b"User file now occupies the export directory path"

    def training_completed(success, message):
        completed.append((success, message))
        if success:
            # Training exported successfully. A real filesystem change then
            # makes the same preference unusable for automatic plot delivery.
            # Preserve both the training export and the conflicting user file.
            try:
                export.rename(retained_export)
                export.write_bytes(blocker_content)
            except OSError as error:
                fault_errors.append(str(error))

    def plot_completed(success, message, paths):
        plotted.append((success, message, paths))

    signalBus.trainingCompletedSig.connect(training_completed)
    signalBus.plotGeneratedSig.connect(plot_completed)

    def until(predicate, *, timeout=90):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            qt.processEvents()
            if predicate():
                return
            time.sleep(0.01)
        pytest.fail("Timed out waiting for assembled Qt/daemon workflow")

    thread.start()
    try:
        until(lambda: server.started or not thread.is_alive(), timeout=20)
        assert server.started and thread.is_alive()
        url = f"http://127.0.0.1:{port}"
        headers = {"Authorization": f"Bearer {token}"}
        with httpx.Client(base_url=url, headers=headers, timeout=10) as client:
            health = client.get("/api/health")
            health.raise_for_status()
            daemon_id = health.json()["daemon_id"]
            assert daemon_id != "before-startup"
            connection = DaemonConnection(
                url,
                credential,
                sys.executable,
                device="cpu",
                daemon_id=daemon_id,
                environment={
                    "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "src"),
                    "OMP_NUM_THREADS": "1",
                    "MKL_NUM_THREADS": "1",
                },
            )
            # Replace only the UI connection preference, not any transport,
            # worker, runtime, result handler or plot implementation.
            monkeypatch.setattr(gui_config, "daemonConnection", lambda: connection)
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
            service.start_training(config)
            training = service._training_worker
            assert training is not None
            workers.append(training)
            until(lambda: bool(completed) and service._plot_worker is not None)
            assert completed[0][0] and not fault_errors, (completed, fault_errors)
            assert training.wait(5000)
            assert retained_export.is_dir()
            assert list(retained_export.rglob("checkpoint_selection.json"))
            assert export.read_bytes() == blocker_content
            plot = service._plot_worker
            workers.append(plot)
            connections = []
            plot.connectionSig.connect(connections.append)
            until(lambda: not plot.isRunning())
            assert plot.wait(5000)
            qt.processEvents()
            assert any("uncertain" in value.lower() for value in connections)
            assert plot._state == ProcessState.UNCERTAIN
            assert not plot._terminal and service._plot_worker is plot
            assert plot in service._retained_workers
            assert plotted == [], "Failed local delivery must not emit success"
            assert gallery._image_paths == [] and not gallery.isHidden()
            assert (
                not gallery.retryButton.isHidden() and gallery.retryButton.isEnabled()
            )
            assert gallery._spinner.isHidden()
            reference = plot.run_ref
            assert reference is not None and reference.operation == "plot"
            assert reference.run_id != training.run_ref.run_id
            assert plot.training_run_ref == training.run_ref
            runs_before = client.get("/api/runs")
            runs_before.raise_for_status()
            run_ids = {item["run_id"] for item in runs_before.json()["runs"]}
            assert run_ids == {training.run_ref.run_id, reference.run_id}
            remote = client.get(f"/api/runs/{reference.run_id}")
            remote.raise_for_status()
            assert remote.json()["state"] == "completed"
            assert remote.json()["uncertainty"] is False
            inventory = client.get(f"/api/runs/{reference.run_id}/artifacts")
            inventory.raise_for_status()
            pngs = {
                Path(name).name: record
                for generation in inventory.json()["generations"]
                if generation["attempt"] == reference.attempt
                for name, record in generation["files"].items()
                if name.endswith(".png")
            }
            assert pngs, "The real runtime did not publish PNG plots"
            assert export.read_bytes() == blocker_content

            # Repair only the local preference. The service resumes its retained
            # operation, rather than planning/submitting another inference job.
            export.rename(blocker)
            retained_export.rename(export)
            gallery.retryButton.click()
            assert service._plot_worker is plot
            assert gallery.retryButton.isHidden() and not gallery._spinner.isHidden()
            until(lambda: bool(plotted))
            assert plot.wait(5000)
            qt.processEvents()
            assert len(plotted) == 1 and plotted[0][0], plotted
            assert plot.run_ref == reference
            assert service._plot_worker is None and plot._terminal
            assert plot not in service._retained_workers
            assert gallery._image_paths == plotted[0][2]
            assert not gallery._image_label._original_pixmap.isNull()
            for selected in plotted[0][2]:
                path = Path(selected)
                raw = path.read_bytes()
                assert path.is_relative_to(export)
                assert raw.startswith(b"\x89PNG\r\n\x1a\n")
                assert len(raw) == pngs[path.name]["size"]
                assert hashlib.sha256(raw).hexdigest() == pngs[path.name]["sha256"]
                assert not QImage(str(path)).isNull()
            runs_after = client.get("/api/runs")
            runs_after.raise_for_status()
            assert {item["run_id"] for item in runs_after.json()["runs"]} == run_ids
            assert blocker.read_bytes() == blocker_content
    finally:
        cleanup_errors = []

        def cleanup(label, action):
            try:
                action()
            except BaseException as error:  # preserve the remaining teardown
                cleanup_errors.append(f"{label}: {type(error).__name__}")

        def wait_for_worker(worker):
            assert worker.wait(5000), "Qt worker failed to terminate"

        cleanup(
            "retry signal disconnect",
            lambda: signalBus.requestResumePlotsSig.disconnect(retry_plots),
        )
        cleanup(
            "training signal disconnect",
            lambda: signalBus.trainingCompletedSig.disconnect(training_completed),
        )
        cleanup(
            "plot signal disconnect",
            lambda: signalBus.plotGeneratedSig.disconnect(plot_completed),
        )
        cleanup("detach monitoring", service.detachMonitoring)
        for index, worker in enumerate(workers):
            cleanup(
                f"worker {index} detach",
                lambda worker=worker: worker.detach() if worker.isRunning() else None,
            )
            cleanup(
                f"worker {index} wait",
                lambda worker=worker: wait_for_worker(worker),
            )

        # Always request and reap the public server, even when an earlier
        # disconnect/detach/wait check failed; otherwise a negative edge can
        # strand a uvicorn thread and leave the port occupied for later tests.
        cleanup("server stop request", lambda: setattr(server, "should_exit", True))
        cleanup("server thread join", lambda: thread.join(timeout=15))
        cleanup("listener close", listener.close)
        cleanup("dashboard delete", dashboard.deleteLater)
        cleanup("Qt event drain", qt.processEvents)

        if thread.is_alive():
            cleanup_errors.append("server thread remained alive after teardown")
        if services.host.outstanding != 0:
            cleanup_errors.append(
                f"host outstanding work remained: {services.host.outstanding}"
            )
        if services.host._thread is not None and services.host._thread.is_alive():
            cleanup_errors.append("service host thread remained alive after teardown")
        probe = socket.socket()
        try:
            probe.settimeout(1)
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                cleanup_errors.append("public daemon port still accepted connections")
        finally:
            probe.close()
        if cleanup_errors:
            pytest.fail("; ".join(cleanup_errors))
