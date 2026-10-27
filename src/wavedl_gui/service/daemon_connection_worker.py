"""Connection checks run off the Qt event thread and never expose secrets."""

import asyncio

from PySide6.QtCore import Signal

from .async_request_worker import AsyncRequestWorker, requireDaemonProtocol


class DaemonConnectionWorker(AsyncRequestWorker):
    resultSig = Signal(object)
    errorSig = Signal(str)

    def __init__(self, connection, parent=None, *, transport_factory=None):
        super().__init__(parent)
        self.connection = connection
        self.transport_factory = transport_factory

    async def _execute(self):
        from wavedl.core.client_transport import HttpTransport

        transport = (self.transport_factory or HttpTransport)(
            self.connection.url, self.connection.read_credential(), deadline=5
        )
        async with asyncio.timeout(5):
            health = await transport.request("GET", "/api/health")
            requireDaemonProtocol(health)
            if (
                type(health.get("daemon_id")) is not str
                or not health["daemon_id"]
                or len(health["daemon_id"]) > 256
                or any(ord(char) < 32 for char in health["daemon_id"])
                or (
                    self.connection.daemon_id is not None
                    and health["daemon_id"] != self.connection.daemon_id
                )
            ):
                raise ValueError("Incompatible daemon")
            return health

    def _on_result(self, result):
        self.resultSig.emit(result)

    def _on_error(self):
        self.errorSig.emit(
            self._error_message(
                "Cannot connect. Check that the daemon is running and the private credential file matches it."
            )
        )
