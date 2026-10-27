"""Ordinary daemon shutdown/reopen with real Qt, HTTP, and CPU execution.

This is not a daemon-process crash/orphan/PID-reuse acceptance test. HostedServices
shutdown deliberately stops its owned Local child, without recording user cancel
intent; reopening must not invent live supervision or a fresh submission.
"""

import socket
import sqlite3
import subprocess
import sys
import threading
import time
from pathlib import Path

import httpx
import numpy as np
import pytest


pytestmark = pytest.mark.integration


def test_real_qt_public_http_shutdown_reopen_preserves_identity_and_intent(
    tmp_path, monkeypatch
):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("QT_QPA_PLATFORM", "offscreen")
    monkeypatch.setenv("MPLBACKEND", "Agg")
    pytest.importorskip("PySide6")
    pytest.importorskip("qfluentwidgets")
    uvicorn = pytest.importorskip("uvicorn")
    from PySide6.QtWidgets import QApplication

    from wavedl_daemon.http.app import create_app
    from wavedl_daemon.runs.runtime_service import HostedServices
    from wavedl_daemon.storage.settings import Settings
    from wavedl_gui.common import config as gui_config, setting as gui_setting
    from wavedl_gui.common.constants.index import TrainingConfig
    from wavedl_gui.service.daemon_contracts import DaemonConnection
    from wavedl_gui.service.training_service import ProcessState, TrainingWorker

    # Also isolate modules already imported by another test in this process.
    preference = tmp_path / "AppData" / "config.json"
    monkeypatch.setattr(gui_setting, "CONFIG_FOLDER", preference.parent)
    monkeypatch.setattr(gui_setting, "CONFIG_FILE", preference)
    monkeypatch.setattr(gui_config, "CONFIG_FILE", preference)
    monkeypatch.setattr(gui_config.cfg, "file", preference)
    qt = QApplication.instance() or QApplication([])
    settings = Settings(tmp_path / "state", tmp_path / "runs")
    token = "temporary-qt-restart-test-token"
    credential = tmp_path / "credential"
    credential.write_text(token)
    credential.chmod(0o600)
    generator = np.random.default_rng(29)
    data = tmp_path / "data.npz"
    np.savez(
        data,
        X=generator.normal(size=(256, 32)).astype("float32"),
        y=generator.normal(size=(256, 1)).astype("float32"),
    )
    servers, workers, children = [], [], []
    original_spawn = subprocess.Popen

    def spawn(*args, **kwargs):
        child = original_spawn(*args, **kwargs)
        children.append(child)
        return child

    monkeypatch.setattr(subprocess, "Popen", spawn)

    def until(predicate, *, timeout=60):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            qt.processEvents()
            if predicate():
                return
            time.sleep(0.01)
        pytest.fail("Timed out waiting for real Qt/HTTP shutdown/reopen acceptance")

    def start_daemon(port=0):
        services = HostedServices(settings)
        app = create_app(
            settings,
            token=token,
            daemon_id="before-owned-startup",
            build_id="qt-restart-acceptance",
            services=services,
        )
        listener = socket.socket()
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", port))
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
                timeout_graceful_shutdown=1,
            )
        )
        thread = threading.Thread(
            target=server.run,
            kwargs={"sockets": [listener]},
            name="qt-restart-public-daemon",
            daemon=True,
        )
        owned = (server, thread, listener, services, port)
        servers.append(owned)
        thread.start()
        until(lambda: server.started or not thread.is_alive(), timeout=20)
        assert server.started and thread.is_alive(), "Public daemon startup failed"
        return owned, port

    def shutdown(owned):
        server, thread, listener, _, _ = owned
        server.should_exit = True
        try:
            until(lambda: not thread.is_alive(), timeout=30)
        finally:
            listener.close()
        thread.join(timeout=1)
        assert_stopped(owned)

    def assert_stopped(owned):
        _, thread, _, services, port = owned
        assert not thread.is_alive(), "Temporary server retained its state lock"
        assert services.host.outstanding == 0, "Service host retained admitted work"
        owner = services.host._thread
        assert owner is None or not owner.is_alive(), "Service owner did not stop"
        with socket.socket() as probe:
            probe.settimeout(1)
            assert probe.connect_ex(("127.0.0.1", port)) != 0, (
                "Closed public daemon port still accepted connections"
            )

    def durable_identity_and_intent():
        with sqlite3.connect(
            (settings.state_root / "registry.db").as_uri() + "?mode=ro", uri=True
        ) as database:
            return (
                database.execute("SELECT * FROM plans ORDER BY plan_id").fetchall(),
                database.execute(
                    "SELECT * FROM plan_control ORDER BY plan_id"
                ).fetchall(),
            )

    try:
        first, port = start_daemon()
        url = f"http://127.0.0.1:{port}"
        headers = {"Authorization": f"Bearer {token}"}
        with httpx.Client(base_url=url, headers=headers, timeout=5) as client:
            health = client.get("/api/health")
            health.raise_for_status()
            daemon_id = health.json()["daemon_id"]
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
                "MPLBACKEND": "Agg",
            },
        )
        config = TrainingConfig(
            data_path=str(data),
            output_dir=str(tmp_path / "client-export"),
            model="cnn",
            epochs=10000,
            patience=10000,
            batch_size=8,
            workers=0,
            precision="no",
            mixed_precision="no",
            pretrained=False,
        )
        worker = TrainingWorker(config, connection=connection)
        workers.append(worker)
        # Timing policies do not replace the real HTTP transport or child.
        worker._bridge._poll_interval = 0.05
        worker._bridge._request_timeout = 2
        worker._bridge._max_retries = 0
        events, history, states, finished, connections = [], [], [], [], []
        worker._bridge.eventSig.connect(events.append)
        worker.historySig.connect(lambda values: history.append(list(values)))
        worker.stateSig.connect(states.append)
        worker.finishedSig.connect(lambda *values: finished.append(values))
        worker.connectionSig.connect(connections.append)
        worker.start()
        until(
            lambda: (
                worker.run_ref is not None
                and any(event.type == "hello" for event in events)
                and any(values and values[-1].epoch >= 1 for values in history)
                and ProcessState.RUNNING in states
            )
        )
        reference = worker.run_ref
        key, cursor = worker._bridge.idempotency_key, worker._bridge.cursor
        assert reference.daemon_id == daemon_id
        assert Path(reference.run_directory).is_relative_to(settings.run_root)
        assert cursor[0] >= 1 and cursor[1] >= 0
        assert children and any(child.poll() is None for child in children)
        with httpx.Client(base_url=url, headers=headers, timeout=5) as client:
            before = client.get(f"/api/runs/{reference.run_id}")
            before.raise_for_status()
            assert before.json()["state"] == "running", before.text
            assert before.json()["submission_requested"] is True
            assert before.json()["cancellation_requested"] is False
        durable = durable_identity_and_intent()
        assert len(durable[0]) == len(durable[1]) == 1

        shutdown(first)
        until(lambda: not worker.isRunning(), timeout=10)
        assert worker.wait(1000)
        qt.processEvents()
        assert not finished, "Server loss must not emit a terminal training result"
        assert worker._state == ProcessState.UNCERTAIN
        assert worker.run_ref == reference
        assert worker._bridge.idempotency_key == key
        assert durable_identity_and_intent() == durable
        assert all(child.poll() is not None for child in children), (
            "Ordinary daemon close retained an owned CPU child"
        )

        second, reopened_port = start_daemon(port)
        assert reopened_port == port
        with httpx.Client(base_url=url, headers=headers, timeout=5) as client:
            health = client.get("/api/health")
            health.raise_for_status()
            # Identity belongs to the durable state DB, not a daemon PID.
            assert health.json()["daemon_id"] == daemon_id
            current = client.get(f"/api/runs/{reference.run_id}")
            current.raise_for_status()
            assert current.json()["state"] == "supervision_lost", current.text
            assert current.json()["uncertainty"] is True
            assert current.json()["submission_requested"] is True
            assert current.json()["cancellation_requested"] is False
            assert current.json()["attempt"] == reference.attempt
        observed = len(connections)
        spawned = len(children)
        assert worker.resume(), "Explicit same-identity reconnection was rejected"
        until(
            lambda: (
                "connected" in connections[observed:]
                and "Daemon execution state is uncertain" in connections[observed:]
            )
        )
        assert worker._state == ProcessState.UNCERTAIN
        assert not finished
        assert worker.run_ref == reference
        assert worker._bridge.idempotency_key == key
        assert worker._bridge.cursor >= cursor
        assert durable_identity_and_intent() == durable
        assert len(children) == spawned, "Reconnection relaunched real execution"
        worker.detach()
        until(lambda: not worker.isRunning(), timeout=5)
        assert worker.wait(1000)
        shutdown(second)
        assert durable_identity_and_intent() == durable
    finally:
        cleanup_errors = []

        def cleanup(label, action):
            try:
                action()
            except BaseException as error:
                cleanup_errors.append(f"{label}: {type(error).__name__}: {error}")

        def wait_for_worker(worker):
            assert worker.wait(5000), "Temporary Qt worker did not stop"

        def reap_child(child):
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=5)
            assert child.poll() is not None

        # A failing worker wait must not skip daemon shutdown and child reaping.
        # Request all owners to stop before doing any bounded waiting.
        for index, worker in enumerate(workers):
            cleanup(f"worker {index} detach", worker.detach)
        for index, owned in enumerate(servers):
            cleanup(
                f"server {index} stop request",
                lambda owned=owned: setattr(owned[0], "should_exit", True),
            )
        for index, worker in enumerate(workers):
            cleanup(
                f"worker {index} wait",
                lambda worker=worker: wait_for_worker(worker),
            )
        for index, owned in enumerate(reversed(servers)):
            cleanup(
                f"server {index} join", lambda owned=owned: owned[1].join(timeout=30)
            )
            cleanup(f"server {index} listener close", owned[2].close)
        for index, child in enumerate(children):
            cleanup(f"child {index} reap", lambda child=child: reap_child(child))
        cleanup("Qt event drain", qt.processEvents)
        for index, owned in enumerate(servers):
            cleanup(
                f"server {index} stopped checks",
                lambda owned=owned: assert_stopped(owned),
            )
        if cleanup_errors:
            pytest.fail("; ".join(cleanup_errors))
