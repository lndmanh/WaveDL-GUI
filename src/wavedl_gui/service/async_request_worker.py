"""Cancellable one-shot Qt requests with retained, parent-independent lifetime."""

from __future__ import annotations

import asyncio
import threading
from contextlib import suppress

from PySide6.QtCore import QThread

from .daemon_contracts import RequestContractError


_live_workers = set()


class DaemonProtocolMismatch(RequestContractError):
    """A valid daemon protocol range excludes this client's protocol."""


def requireDaemonProtocol(health):
    """Distinguish unsupported versions from malformed, untrusted health data."""
    if type(health) is not dict:
        raise RequestContractError("Invalid daemon health")
    low, high = health.get("protocol_min"), health.get("protocol_max")
    if (
        type(low) is not int
        or type(high) is not int
        or not 1 <= low <= high <= 2**31 - 1
    ):
        raise RequestContractError("Invalid daemon protocol range")
    if not low <= 1 <= high:
        raise DaemonProtocolMismatch("Unsupported daemon protocol")


def activeRequestWorkers():
    """Return running requests for orderly frontend shutdown on the UI thread."""
    return tuple(worker for worker in _live_workers if worker.isRunning())


class AsyncRequestWorker(QThread):
    """Cancel socket waits without joining non-cooperative DNS executor work.

    The application retains started workers until their real thread finishes.
    An optional UI owner only requests stop when destroyed; it does not own the
    native QThread, which must never be destroyed while running. Synchronous
    credential IO and OS DNS work remain cooperative, not forcibly terminated.
    """

    def __init__(self, parent=None):
        super().__init__()
        self._lock = threading.Lock()
        self._stop_requested = threading.Event()
        self._loop = self._task = None
        self._protocol_mismatch = False
        if parent is not None:
            parent.destroyed.connect(self.stop)
        self.finished.connect(self._release)

    def start(self, *args):
        _live_workers.add(self)
        try:
            super().start(*args)
        except BaseException:
            _live_workers.discard(self)
            raise

    def _release(self):
        _live_workers.discard(self)

    def stop(self):
        self.requestInterruption()

    def requestInterruption(self):
        self._stop_requested.set()
        super().requestInterruption()
        with self._lock:
            loop, task = self._loop, self._task
        if loop is not None and task is not None:
            with suppress(RuntimeError):
                loop.call_soon_threadsafe(task.cancel)

    def run(self):
        loop = asyncio.new_event_loop()
        self._protocol_mismatch = False
        try:
            with self._lock:
                self._loop = loop
                self._task = loop.create_task(self._execute())
                task = self._task
            if self._stop_requested.is_set():
                task.cancel()
            result = loop.run_until_complete(task)
            if not self._stop_requested.is_set():
                self._on_result(result)
        except asyncio.CancelledError:
            pass
        except Exception as error:
            self._protocol_mismatch = isinstance(error, DaemonProtocolMismatch)
            if not self._stop_requested.is_set():
                self._on_error()
        finally:
            pending = asyncio.all_tasks(loop)
            for task in pending:
                task.cancel()
            if pending:
                loop.run_until_complete(
                    asyncio.gather(*pending, return_exceptions=True)
                )
            loop.run_until_complete(loop.shutdown_asyncgens())
            # asyncio.run() joins the default executor, even for cancelled DNS.
            # Keep the Qt thread responsive; the OS call can finish later.
            loop.close()
            with self._lock:
                self._loop = self._task = None

    async def _execute(self):
        raise NotImplementedError

    def _error_message(self, fallback):
        """Never display server-controlled exception messages or credentials."""
        if self._protocol_mismatch:
            return "Daemon protocol mismatch; update the daemon or client before reconnecting."
        return fallback

    def _on_result(self, result):
        raise NotImplementedError

    def _on_error(self):
        raise NotImplementedError
