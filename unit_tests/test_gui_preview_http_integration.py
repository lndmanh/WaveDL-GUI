"""Real Qt preview adapter reaches daemon-owned bounded numerical summaries."""

import socket
import sys
import threading
import time

import httpx
import numpy as np
import pytest


pytestmark = pytest.mark.integration


@pytest.mark.parametrize("extension", ["npz", "mat", "h5"])
def test_real_qthread_remote_preview_and_six_views(tmp_path, monkeypatch, extension):
    monkeypatch.setenv("QT_QPA_PLATFORM", "offscreen")
    pytest.importorskip("PySide6")
    pytest.importorskip("qfluentwidgets")
    uvicorn = pytest.importorskip("uvicorn")
    from PySide6.QtWidgets import QApplication

    from wavedl_daemon.http.app import create_app
    from wavedl_daemon.runs.runtime_service import HostedServices
    from wavedl_daemon.storage.settings import Settings
    from wavedl_gui.components.data_plots_card import _plot_remote_preview
    from wavedl_gui.service.daemon_contracts import DaemonConnection, PathSelectionRef
    from wavedl_gui.service.data_plots_worker import DataPlotsWorker
    from wavedl_gui.service.data_preview_worker import DaemonDataPreviewWorker

    qt = QApplication.instance() or QApplication([])
    data = tmp_path / f"samples.{extension}"
    arrays = {"X": np.arange(48).reshape(12, 4), "y": np.arange(24).reshape(12, 2)}
    if extension == "npz":
        np.savez(data, **arrays)
    elif extension == "mat":
        pytest.importorskip("scipy.io").savemat(data, arrays)
    else:
        with pytest.importorskip("h5py").File(data, "w") as file:
            for name, values in arrays.items():
                file.create_dataset(name, data=values)
    token = "temporary-qt-preview-token"
    credential = tmp_path / "credential"
    credential.write_text(token)
    credential.chmod(0o600)
    settings = Settings(tmp_path / "state", tmp_path / "runs")
    services = HostedServices(settings, browse_roots={"datasets": tmp_path})
    app = create_app(
        settings,
        token=token,
        daemon_id="before-startup",
        build_id="qt-preview-test",
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
        name="qt-preview-daemon",
        daemon=True,
    )
    thread.start()
    worker = None
    try:
        deadline = time.monotonic() + 15
        while not server.started and thread.is_alive() and time.monotonic() < deadline:
            qt.processEvents()
            time.sleep(0.01)
        assert server.started and thread.is_alive()
        url = f"http://127.0.0.1:{port}"
        with httpx.Client(base_url=url, timeout=10) as client:
            assert client.get("/api/health").status_code == 401
            health = client.get(
                "/api/health", headers={"Authorization": f"Bearer {token}"}
            )
            health.raise_for_status()
        daemon_id = health.json()["daemon_id"]
        connection = DaemonConnection(
            url,
            credential,
            sys.executable,
            path_realm="remote",
            daemon_id=daemon_id,
            server_platform="posix",
        )
        selection = PathSelectionRef(
            str(data), "daemon", daemon_id, "datasets", data.name
        )
        worker = DaemonDataPreviewWorker(
            str(data), connection=connection, path_selection=selection
        )
        results, errors = [], []
        worker.dataReady.connect(results.append)
        worker.errorOccurred.connect(errors.append)
        worker.start()
        deadline = time.monotonic() + 20
        while not results and not errors and time.monotonic() < deadline:
            qt.processEvents()
            time.sleep(0.01)
        assert results and not errors, errors
        assert worker.wait(5000)
        value = results[0].remote_preview
        assert value["selection"] == {"root": "datasets", "path": data.name}
        assert value["input_shape"] == [12, 4]
        assert value["scatter"]["y"] == list(range(0, 24, 2))
        assert value["identity"]["st_ino"] == data.stat().st_ino
        for name in DataPlotsWorker.PLOT_NAMES:
            figure = _plot_remote_preview(name, results[0], False)
            assert figure.axes
            figure.clear()
    finally:
        if worker is not None and worker.isRunning():
            worker.stop()
            assert worker.wait(5000)
        server.should_exit = True
        thread.join(10)
        listener.close()
        assert not thread.is_alive(), "Preview daemon did not stop"
        qt.processEvents()
