"""Native Qt quit events use the registered asynchronous frontend coordinator."""

import os
import subprocess
import sys
from pathlib import Path

import pytest


pytest.importorskip("PySide6")


SCRIPT = r"""
import asyncio
import threading
from uuid import uuid4

from PySide6.QtCore import QEvent, QTimer

from wavedl_gui.common.application import SingletonApplication
from wavedl_gui.common.signal_bus import signalBus
from wavedl_gui.service.async_request_worker import AsyncRequestWorker, activeRequestWorkers

app = SingletonApplication([], "wavedl-quit-test-" + str(uuid4()))
app.setQuitOnLastWindowClosed(False)
managed = MODE != "unmanaged"
pending_worker = MODE == "managed"
calls, entered, release = [], threading.Event(), threading.Event()

class Worker(AsyncRequestWorker):
    async def _execute(self):
        entered.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            # Simulate cooperative native cleanup that finishes a little later.
            await asyncio.get_running_loop().run_in_executor(None, release.wait)

    def _on_result(self, result):
        raise AssertionError("Stopped request emitted a result")

    def _on_error(self):
        raise AssertionError("Stopped request emitted an error")

worker = Worker()
closing = False
released_before_quit = False

def drain():
    global released_before_quit
    if activeRequestWorkers():
        QTimer.singleShot(5, drain)
        return
    released_before_quit = release.is_set()
    app.setProperty("frontendShutdownComplete", True)
    app.quit()

def requested():
    global closing
    calls.append(worker.isRunning())
    if closing:
        return
    closing = True
    worker.stop()
    QTimer.singleShot(50, release.set)
    drain()

signalBus.requestExitSig.connect(requested)
app.setProperty("frontendShutdownManaged", managed)

def quit_event():
    if pending_worker:
        assert worker.isRunning()
    event = QEvent(QEvent.Type.Quit)
    app.sendEvent(app, event)
    if managed:
        assert not event.isAccepted()
    if pending_worker:
        assert worker.isRunning()
        # A second native quit must not bypass the outstanding coordinator.
        app.sendEvent(app, QEvent(QEvent.Type.Quit))

if pending_worker:
    worker.start()
    assert entered.wait(1)
QTimer.singleShot(0, quit_event)
# Fail-safe returns a nonzero status instead of hanging the test suite.
QTimer.singleShot(3000, lambda: app.exit(91))
try:
    result = app.exec()
finally:
    release.set()
    worker.stop()
    assert worker.wait(2000)
    app.server.close()
    app.memory.detach()
assert result == 0, result
if pending_worker:
    assert len(calls) == 2 and all(calls), calls
    assert released_before_quit
    assert not activeRequestWorkers()
elif managed:
    assert calls == [False], calls
    assert app.property("frontendShutdownComplete") is True
else:
    assert not calls
print("quit-dispatch-ok")
"""


@pytest.mark.parametrize("mode", ["managed", "managed_idle", "unmanaged"])
def test_native_quit_event_obeys_frontend_drain_registration(tmp_path, mode):
    environment = os.environ.copy()
    environment["QT_QPA_PLATFORM"] = "offscreen"
    environment["PYTHONPATH"] = str(Path(__file__).resolve().parents[1] / "src")
    completed = subprocess.run(
        [sys.executable, "-c", f"MODE = {mode!r}\n" + SCRIPT],
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert "quit-dispatch-ok" in completed.stdout
