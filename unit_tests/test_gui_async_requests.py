"""One-shot Qt requests retain ownership and cancel without false UI results."""

import asyncio
import gc
import socket
import sys
import threading
import time
import weakref

import pytest


pytest.importorskip("PySide6")
pytest.importorskip("qfluentwidgets")

from PySide6.QtCore import QObject, Qt
from PySide6.QtWidgets import QApplication, QWidget
from shiboken6 import delete

from wavedl_gui.components.daemon_path_dialog import DaemonPathDialog, _BrowseWorker
from wavedl_gui.service.async_request_worker import (
    AsyncRequestWorker,
    activeRequestWorkers,
)
from wavedl_gui.service.daemon_connection_worker import DaemonConnectionWorker
from wavedl_gui.service.daemon_contracts import DaemonConnection
from wavedl_gui.service.daemon_models_worker import DaemonModelsWorker
from wavedl_gui.service.data_parse_worker import DataParseWorker


@pytest.fixture(scope="module")
def application():
    app = QApplication.instance() or QApplication([])
    yield app
    app.processEvents()


def pump_until(application, predicate, timeout=2):
    deadline = time.monotonic() + timeout
    while not predicate() and time.monotonic() < deadline:
        application.processEvents()
        threading.Event().wait(0.005)
    application.processEvents()
    assert predicate()


@pytest.fixture
def connection(tmp_path):
    credential = tmp_path / "credential"
    credential.write_text("secret-never-show-this", encoding="utf-8")
    credential.chmod(0o600)
    return DaemonConnection("http://127.0.0.1:8420", credential, sys.executable)


class WaitingWorker(AsyncRequestWorker):
    def __init__(self, entered, parent=None):
        super().__init__(parent)
        self.entered = entered
        self.results = []
        self.errors = []

    async def _execute(self):
        self.entered.set()
        await asyncio.Event().wait()

    def _on_result(self, result):
        self.results.append(result)

    def _on_error(self):
        self.errors.append(True)


@pytest.mark.parametrize("kind", ["connection", "inspection", "models", "browse"])
@pytest.mark.parametrize(
    ("low", "high", "mismatch"),
    [(2, 3, True), (True, 3, False), (0, 3, False), (3, 2, False)],
)
def test_one_shot_protocol_feedback_is_typed_and_secret_free(
    application, connection, monkeypatch, kind, low, high, mismatch
):
    calls = []

    class Transport:
        async def request(self, method, path, **kwargs):
            calls.append((method, path))
            assert path == "/api/health"
            return {
                "daemon_id": "daemon-a",
                "protocol_min": low,
                "protocol_max": high,
                "untrusted": "secret-never-show-this",
            }

        def bind_daemon_id(self, daemon_id):
            raise AssertionError("Invalid protocol must not bind a daemon")

    def factory(*args, **kwargs):
        return Transport()

    if kind == "browse":
        monkeypatch.setattr(
            "wavedl_gui.components.daemon_path_dialog.HttpTransport", factory
        )
        worker = _BrowseWorker(connection)
    elif kind == "inspection":
        worker = DataParseWorker(
            "/daemon/data.npz", connection=connection, transport_factory=factory
        )
    elif kind == "models":
        worker = DaemonModelsWorker(connection, transport_factory=factory)
    else:
        worker = DaemonConnectionWorker(connection, transport_factory=factory)
    errors, results = [], []
    error_signal = worker.errorOccurred if kind == "inspection" else worker.errorSig
    result_signal = worker.resultReady if kind == "inspection" else worker.resultSig
    error_signal.connect(errors.append, Qt.ConnectionType.DirectConnection)
    result_signal.connect(results.append, Qt.ConnectionType.DirectConnection)
    worker.run()
    assert not results
    assert calls == [("GET", "/api/health")]
    assert len(errors) == 1
    assert ("protocol mismatch" in errors[0]) is mismatch
    assert "secret-never-show-this" not in errors[0]


def test_started_worker_is_retained_without_ui_parent(application):
    entered = threading.Event()
    worker = WaitingWorker(entered)
    reference = weakref.ref(worker)
    worker.start()
    assert entered.wait(1)
    assert worker.parent() is None
    assert worker in activeRequestWorkers()
    del worker
    gc.collect()
    retained = reference()
    assert retained is not None
    retained.stop()
    assert retained.wait(1000)
    pump_until(application, lambda: retained not in activeRequestWorkers())
    assert not retained.results and not retained.errors


@pytest.mark.parametrize("kind", ["health", "inspect", "browse"])
def test_destroyed_parent_cancels_real_pending_socket_without_ui_result(
    application, connection, kind
):
    received, eof = threading.Event(), threading.Event()
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    listener.settimeout(3)
    errors = []

    def serve():
        try:
            stream, _ = listener.accept()
            with stream:
                stream.settimeout(3)
                request = bytearray()
                while b"\r\n\r\n" not in request:
                    chunk = stream.recv(4096)
                    if not chunk:
                        return
                    request.extend(chunk)
                received.set()
                while stream.recv(4096):
                    pass
                eof.set()
        except Exception as error:
            errors.append(error)

    server = threading.Thread(target=serve, daemon=True)
    server.start()
    profile = DaemonConnection(
        f"http://127.0.0.1:{listener.getsockname()[1]}",
        connection.credential_file,
        sys.executable,
    )
    parent = QObject()
    if kind == "health":
        worker = DaemonConnectionWorker(profile, parent)
        result_signal, error_signal = worker.resultSig, worker.errorSig
    elif kind == "inspect":
        worker = DataParseWorker("/daemon/data.npz", parent, connection=profile)
        result_signal, error_signal = worker.resultReady, worker.errorOccurred
    else:
        worker = _BrowseWorker(profile, parent=parent)
        result_signal, error_signal = worker.resultSig, worker.errorSig
    results, failures = [], []
    result_signal.connect(results.append, Qt.ConnectionType.DirectConnection)
    error_signal.connect(failures.append, Qt.ConnectionType.DirectConnection)
    try:
        worker.start()
        assert received.wait(2)
        assert worker.parent() is None
        delete(parent)
        assert worker.wait(1000)
        assert eof.wait(1)
        application.processEvents()
        assert not results and not failures
    finally:
        worker.stop()
        worker.wait(2000)
        listener.close()
        server.join(3)
    assert not errors


def test_cancelled_dns_executor_does_not_join_qt_thread(application, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    original = socket.getaddrinfo

    def native_dns(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        return original("127.0.0.1", 8420, type=socket.SOCK_STREAM)

    monkeypatch.setattr(socket, "getaddrinfo", native_dns)

    class DnsWorker(WaitingWorker):
        async def _execute(self):
            return await asyncio.get_running_loop().getaddrinfo(
                "localhost", 8420, type=socket.SOCK_STREAM
            )

    worker = DnsWorker(entered)
    try:
        worker.start()
        assert entered.wait(1)
        worker.stop()
        assert worker.wait(1000)
        assert not release.is_set()
        assert not worker.results and not worker.errors
    finally:
        release.set()
        worker.stop()
        worker.wait(2000)
        application.processEvents()


@pytest.mark.parametrize("fail", [False, True])
def test_late_result_or_exception_after_stop_is_suppressed(application, fail):
    entered = threading.Event()

    class LateWorker(WaitingWorker):
        async def _execute(self):
            self.entered.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                if fail:
                    raise ValueError("late error") from None
                return "late result"

    worker = LateWorker(entered)
    worker.start()
    assert entered.wait(1)
    worker.stop()
    assert worker.wait(1000)
    application.processEvents()
    assert not worker.results and not worker.errors


def test_stop_before_start_never_executes_request(application):
    entered = threading.Event()
    worker = WaitingWorker(entered)
    worker.stop()
    worker.start()
    assert worker.wait(1000)
    application.processEvents()
    assert not entered.is_set()
    assert not worker.results and not worker.errors


@pytest.mark.parametrize("kind", ["health", "inspect", "browse"])
def test_worker_constructors_do_not_read_credentials_or_open_transport(
    application, connection, monkeypatch, kind
):
    def forbidden(*args, **kwargs):
        raise AssertionError("Constructor performed IO")

    monkeypatch.setattr(DaemonConnection, "read_credential", forbidden)
    if kind == "health":
        worker = DaemonConnectionWorker(connection, transport_factory=forbidden)
    elif kind == "inspect":
        worker = DataParseWorker(
            "/daemon/data.npz", connection=connection, transport_factory=forbidden
        )
    else:
        monkeypatch.setattr(
            "wavedl_gui.components.daemon_path_dialog.HttpTransport", forbidden
        )
        worker = _BrowseWorker(connection)
    assert not worker.isRunning()
    assert worker not in activeRequestWorkers()


@pytest.mark.parametrize(
    "health",
    [
        {"daemon_id": "other", "protocol_min": 1, "protocol_max": 1},
        {"daemon_id": "expected\n", "protocol_min": 1, "protocol_max": 1},
        {"daemon_id": "expected", "protocol_min": True, "protocol_max": 1},
        {"daemon_id": "expected", "protocol_min": 2, "protocol_max": 3},
        {"daemon_id": "", "protocol_min": 1, "protocol_max": 1},
        [],
    ],
)
def test_invalid_health_never_emits_success_or_private_details(
    application, connection, health
):
    profile = DaemonConnection(
        connection.url, connection.credential_file, sys.executable, daemon_id="expected"
    )

    class Transport:
        async def request(self, *args):
            return health

    worker = DaemonConnectionWorker(
        profile, transport_factory=lambda *args, **kwargs: Transport()
    )
    results, errors = [], []
    worker.resultSig.connect(results.append, Qt.ConnectionType.DirectConnection)
    worker.errorSig.connect(errors.append, Qt.ConnectionType.DirectConnection)
    worker.start()
    assert worker.wait(1000)
    application.processEvents()
    assert not results and len(errors) == 1
    assert "secret-never-show-this" not in errors[0]
    assert str(connection.credential_file) not in errors[0]


def test_valid_health_emits_verified_identity(application, connection):
    health = {"daemon_id": "valid", "protocol_min": 1, "protocol_max": 2}
    calls = []

    class Transport:
        async def request(self, method, path):
            calls.append((method, path))
            return health

    worker = DaemonConnectionWorker(
        connection, transport_factory=lambda *args, **kwargs: Transport()
    )
    results = []
    worker.resultSig.connect(results.append, Qt.ConnectionType.DirectConnection)
    worker.start()
    assert worker.wait(1000)
    application.processEvents()
    assert results == [health]
    assert calls == [("GET", "/api/health")]


def test_transport_secret_exception_is_redacted(application, connection):
    def factory(*args, **kwargs):
        raise ValueError("secret-never-show-this /private/credential")

    worker = DaemonConnectionWorker(connection, transport_factory=factory)
    errors = []
    worker.errorSig.connect(errors.append, Qt.ConnectionType.DirectConnection)
    worker.start()
    assert worker.wait(1000)
    application.processEvents()
    assert len(errors) == 1
    assert "secret-never-show-this" not in errors[0]
    assert "/private/credential" not in errors[0]


def test_cancellation_cleans_up_cooperative_child_tasks(application):
    entered, child_cancelled = threading.Event(), threading.Event()

    class ChildWorker(WaitingWorker):
        async def _execute(self):
            async def child():
                try:
                    entered.set()
                    await asyncio.Event().wait()
                finally:
                    child_cancelled.set()

            self.child_task = asyncio.create_task(child())
            await asyncio.Event().wait()

    worker = ChildWorker(entered)
    try:
        worker.start()
        assert entered.wait(1)
        worker.stop()
        assert worker.wait(1000)
        assert child_cancelled.is_set()
        assert not worker.results and not worker.errors
    finally:
        worker.stop()
        worker.wait(2000)
        application.processEvents()


@pytest.mark.parametrize(
    "value,resolved",
    [
        ({"roots": None}, False),
        ({"roots": [{"id": "bad\nroot"}]}, False),
        ({"roots": [{"id": "r"}] * 129}, False),
        ({"path": "", "entries": None, "total": 0}, False),
        (
            {
                "path": "",
                "entries": [{"name": "../escape", "kind": "file"}],
                "total": 1,
            },
            False,
        ),
        (
            {
                "path": "",
                "entries": [{"name": "bad\nname", "kind": "file"}],
                "total": 1,
            },
            False,
        ),
        (
            {"path": "", "entries": [{"name": "f", "kind": "unknown"}], "total": 1},
            False,
        ),
        (
            {
                "path": "",
                "entries": [{"name": "f", "kind": "file"}] * 101,
                "total": 101,
            },
            False,
        ),
        ({"path": "", "entries": [], "total": True}, False),
        ({"path": "", "entries": [], "total": -1}, False),
        ({"kind": "file", "path": "relative.npz"}, True),
        ({"kind": "file", "path": "/daemon/bad\npath.npz"}, True),
        ({"kind": "file"}, True),
        ([], False),
    ],
)
def test_malformed_browse_payload_is_rejected_before_ui_mutation(
    application, monkeypatch, value, resolved
):
    def unavailable():
        raise ValueError("No configured connection in this isolated UI test")

    monkeypatch.setattr(
        "wavedl_gui.components.daemon_path_dialog.daemonConnection", unavailable
    )
    parent = QWidget()
    dialog = DaemonPathDialog(parent)
    initial_status = dialog.statusLabel.text()
    try:
        dialog._ready({"daemon_id": "daemon-a", "value": value, "resolved": resolved})
        assert dialog.selection is None
        assert not dialog.yesButton.isEnabled()
        assert dialog.entries.count() == 0
        assert dialog.rootBox.count() == 0
        assert dialog.statusLabel.text()
        assert dialog.statusLabel.text() != initial_status
    finally:
        delete(dialog)
        delete(parent)


def test_valid_browse_payload_and_resolved_path_preserve_daemon_binding(
    application, connection, monkeypatch
):
    monkeypatch.setattr(
        "wavedl_gui.components.daemon_path_dialog.daemonConnection", lambda: connection
    )
    monkeypatch.setattr(DaemonPathDialog, "_browse", lambda self, **kwargs: None)
    parent = QWidget()
    dialog = DaemonPathDialog(parent)
    try:
        dialog._ready(
            {
                "daemon_id": "daemon-a",
                "resolved": False,
                "value": {"roots": [{"id": "datasets"}]},
            }
        )
        assert dialog.rootBox.currentData() == "datasets"
        dialog._ready(
            {
                "daemon_id": "daemon-a",
                "resolved": False,
                "value": {
                    "path": "",
                    "entries": [{"name": "data.npz", "kind": "file"}],
                    "total": 1,
                },
            }
        )
        assert dialog.entries.count() == 1
        assert not dialog.yesButton.isEnabled()
        dialog._ready(
            {
                "daemon_id": "daemon-a",
                "resolved": True,
                "value": {"kind": "file", "path": "/daemon/data.npz"},
            }
        )
        assert dialog.selection.path == "/daemon/data.npz"
        assert dialog.selection.realm == "daemon"
        assert dialog.selection.daemon_id == "daemon-a"
        assert dialog.yesButton.isEnabled()
    finally:
        delete(dialog)
        delete(parent)
