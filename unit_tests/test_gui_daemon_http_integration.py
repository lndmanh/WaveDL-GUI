"""Real Qt worker → public HTTP → daemon-owned CPU train/test/plot acceptance."""

import hashlib
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

import httpx
import numpy as np
import pytest


pytestmark = pytest.mark.integration


def test_real_qthread_public_http_cpu_training_inference_and_verified_plot_downloads(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("QT_QPA_PLATFORM", "offscreen")
    pytest.importorskip("PySide6")
    pytest.importorskip("qfluentwidgets")
    uvicorn = pytest.importorskip("uvicorn")
    from PySide6.QtGui import QImage
    from PySide6.QtWidgets import QApplication

    from wavedl.core.generations import published_generations
    from wavedl.core.layout import RunLayout
    from wavedl_daemon.http.app import create_app
    from wavedl_daemon.runs.runtime_service import HostedServices
    from wavedl_daemon.storage.settings import Settings
    from wavedl_gui.common.constants.index import (
        TestConfig as InferenceConfig,
        TrainingConfig,
    )
    from wavedl_gui.service.daemon_contracts import DaemonConnection
    from wavedl_gui.service.training_service import (
        PlotWorker,
        TestWorker as InferenceWorker,
        TrainingWorker,
    )

    qt = QApplication.instance() or QApplication([])
    state, runs = tmp_path / "state", tmp_path / "runs"
    state.mkdir(mode=0o700)
    settings = Settings(state, runs)
    token = "temporary-real-gui-integration-token"
    credential = tmp_path / "credential"
    credential.write_text(token)
    credential.chmod(0o600)
    data = tmp_path / "samples.npz"
    generator = np.random.default_rng(9)
    np.savez(
        data,
        X=generator.normal(size=(20, 32)).astype("float32"),
        y=generator.normal(size=(20, 1)).astype("float32"),
    )
    services = HostedServices(settings, browse_roots={"data": tmp_path, "runs": runs})
    app = create_app(
        settings,
        token=token,
        daemon_id="before-owned-startup",
        build_id="integration",
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
        name="real-public-daemon",
        daemon=True,
    )
    workers, process_calls, frontend_threads = [], [], set()
    original_credential_read = DaemonConnection.read_credential

    def credential_read(self):
        frontend_threads.add(threading.get_ident())
        return original_credential_read(self)

    monkeypatch.setattr(DaemonConnection, "read_credential", credential_read)
    # Load UI preferences before measuring runtime-spawn ownership. On Linux,
    # qfluentwidgets' theme detection invokes gsettings during qconfig.load;
    # that native appearance probe is not a WaveDL execution subprocess.
    from wavedl_gui.common.config import cfg

    assert cfg is not None
    original_spawn = subprocess.Popen

    def spawn(*args, **kwargs):
        process_calls.append(
            (threading.get_ident(), args[0] if args else kwargs.get("args"))
        )
        assert threading.get_ident() != threading.main_thread().ident, (
            "GUI main thread must not spawn runtime children"
        )
        assert threading.get_ident() not in frontend_threads, (
            "GUI network worker must not launch subprocesses"
        )
        return original_spawn(*args, **kwargs)

    monkeypatch.setattr(subprocess, "Popen", spawn)
    thread.start()
    url = f"http://127.0.0.1:{port}"
    headers = {"Authorization": f"Bearer {token}"}

    def drive(worker, *, timeout=60):
        workers.append(worker)
        finished, errors = [], []
        worker.finishedSig.connect(lambda *values: finished.append(values))
        worker.connectionSig.connect(errors.append)
        worker.start()
        deadline = time.monotonic() + timeout
        while not finished and time.monotonic() < deadline:
            qt.processEvents()
            time.sleep(0.01)
        assert finished, f"No terminal Qt signal: {errors[-5:]} run={worker.run_ref}"
        assert worker.wait(5000), "Qt network worker did not finish"
        qt.processEvents()
        assert finished[0][0], (finished, errors[-5:])
        return finished[0]

    try:
        deadline = time.monotonic() + 20
        while not server.started and thread.is_alive() and time.monotonic() < deadline:
            qt.processEvents()
            time.sleep(0.01)
        assert server.started and thread.is_alive(), "Real public daemon startup failed"
        with httpx.Client(base_url=url, headers=headers, timeout=10) as client:
            health = client.get("/api/health")
            health.raise_for_status()
            daemon_id = health.json()["daemon_id"]
            assert daemon_id != "before-owned-startup"
            assert client.get("/api/models").json()["runtime_verified"] is False
            metadata = client.post(
                "/api/datasets/inspect",
                json={"root": "data", "path": data.name},
            )
            assert metadata.status_code == 200, metadata.text
            assert metadata.json()["format"] == "npz"
            shapes = {
                item["name"]: item["shape"] for item in metadata.json()["variables"]
            }
            assert shapes == {"X": [20, 32], "y": [20, 1]}
        source = Path(__file__).resolve().parents[1] / "src"
        connection = DaemonConnection(
            url,
            credential,
            sys.executable,
            device="cpu",
            daemon_id=daemon_id,
            environment={
                "PYTHONPATH": str(source),
                "OMP_NUM_THREADS": "1",
                "MKL_NUM_THREADS": "1",
            },
        )
        config = TrainingConfig(
            data_path=str(data),
            output_dir=str(tmp_path / "user-export"),
            model="cnn",
            epochs=1,
            batch_size=8,
            workers=0,
            precision="no",
            mixed_precision="no",
            pretrained=False,
        )
        training = TrainingWorker(config, connection=connection)
        history = []
        training.historySig.connect(lambda values: history.append(values))
        drive(training)
        reference = training.run_ref
        assert (
            reference is not None
            and reference.daemon_id == daemon_id
            and reference.operation == "train"
        )
        assert any(values and values[-1].epoch == 1 for values in history), (
            "No structured epoch progress reached Qt"
        )
        layout = RunLayout(Path(reference.run_directory), reference.run_id)
        generations = published_generations(layout)
        assert generations and all("scaler.pkl" in item.files for item in generations)
        assert layout.run_dir.is_relative_to(runs)
        assert layout.run_dir != Path(config.output_dir), (
            "Client export directory must not become daemon runtime output"
        )
        inference = InferenceWorker(
            InferenceConfig(
                checkpoint=reference.run_directory,
                data_path=str(data),
                batch_size=8,
                workers=0,
                plot=False,
                output_dir=str(tmp_path / "inference-export"),
            ),
            connection=connection,
        )
        tested = drive(inference)
        assert tested[2], "No authoritative structured inference metrics returned"
        plots = PlotWorker(config, connection=connection, run_ref=reference)
        plotted = drive(plots)
        assert plotted[2], "No verified plot downloads returned"
        assert (
            plots.run_ref.operation == "plot"
            and plots.run_ref.run_id != reference.run_id
        )
        with httpx.Client(base_url=url, headers=headers, timeout=10) as client:
            manifest = client.get(f"/api/runs/{plots.run_ref.run_id}/artifacts")
            manifest.raise_for_status()
        files = {
            Path(name).name: record
            for generation in manifest.json()["generations"]
            for name, record in generation["files"].items()
            if name.endswith(".png")
        }
        for selected in plotted[2]:
            path = Path(selected)
            raw = path.read_bytes()
            assert path.is_file() and raw.startswith(b"\x89PNG\r\n\x1a\n")
            assert len(raw) == files[path.name]["size"]
            assert hashlib.sha256(raw).hexdigest() == files[path.name]["sha256"]
            assert not QImage(str(path)).isNull(), (
                "Downloaded artifact is not a decodable PNG"
            )
        assert process_calls, "The daemon never launched real CPU training"
        assert all(owner != threading.main_thread().ident for owner, _ in process_calls)
    finally:
        for worker in workers:
            if worker.isRunning():
                worker.detach()
                worker.wait(5000)
        server.should_exit = True
        thread.join(timeout=15)
        listener.close()
        assert not thread.is_alive(), "Temporary daemon server did not shut down"
