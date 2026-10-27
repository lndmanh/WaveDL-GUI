"""Metadata-only daemon inspection on a cancellable Qt worker thread."""

from __future__ import annotations

import asyncio
import inspect
from contextlib import AsyncExitStack
from pathlib import PurePosixPath, PureWindowsPath

from PySide6.QtCore import Signal

from wavedl.core.client_transport import HttpTransport
from wavedl.core.data_keys import INPUT_KEYS, OUTPUT_KEYS

from ..common.data_info import DataInfo
from .async_request_worker import AsyncRequestWorker, requireDaemonProtocol
from .daemon_contracts import (
    PathSelectionRef,
    RequestContractError,
    inspect_to_data_info,
)


class DataParseWorker(AsyncRequestWorker):
    """Read bounded authenticated headers only; no local numerical file loading."""

    resultReady = Signal(object)  # DataInfo
    errorOccurred = Signal(str)

    def __init__(
        self,
        file_path: str,
        parent=None,
        connection=None,
        path_selection=None,
        transport_factory=None,
    ):
        super().__init__(parent)
        self._file_path = file_path
        self._connection_error = False
        if connection is None:
            try:
                from ..common.config import daemonConnection

                connection = daemonConnection()
            except Exception:
                self._connection_error = True
        self.connection = connection
        self.path_selection = path_selection
        self.transport_factory = transport_factory or HttpTransport

    def _on_result(self, result):
        self.resultReady.emit(result)

    def _on_error(self):
        self.errorOccurred.emit(
            self._error_message(
                "Dataset inspection unavailable. Check daemon connection, private credentials, and the selected daemon-side dataset path."
            )
        )

    async def _execute(self) -> DataInfo:
        with self._lock:
            self._loop, self._task = asyncio.get_running_loop(), asyncio.current_task()
        if self._stop_requested.is_set():
            raise asyncio.CancelledError
        if self._connection_error or self.connection is None:
            raise RequestContractError("Configure a daemon connection")
        selected = self.path_selection
        if selected is None:
            if self.connection.path_realm != "same_host":
                raise RequestContractError("Select an explicit daemon-side path")
            selected = PathSelectionRef(self._file_path, "local")
        if (
            not isinstance(selected, PathSelectionRef)
            or selected.path != self._file_path
        ):
            raise RequestContractError("Dataset path differs from the selection")
        if self.connection.path_realm == "remote" and selected.realm != "daemon":
            raise RequestContractError(
                "Remote inspection cannot read client-local data"
            )
        platform = (
            "posix"
            if self.connection.backend == "slurm"
            else self.connection.server_platform
        )
        if (platform == "posix" and not PurePosixPath(selected.path).is_absolute()) or (
            platform == "windows" and not PureWindowsPath(selected.path).is_absolute()
        ):
            raise RequestContractError("Dataset path belongs to another platform")
        # Private credential IO occurs only after the worker has started.
        transport = self.transport_factory(
            self.connection.url, self.connection.read_credential(), deadline=10
        )
        async with AsyncExitStack() as stack:
            if hasattr(transport, "__aenter__"):
                transport = await stack.enter_async_context(transport)
            elif hasattr(transport, "aclose"):
                stack.push_async_callback(transport.aclose)
            elif hasattr(transport, "close"):

                async def close_transport():
                    result = transport.close()
                    if inspect.isawaitable(result):
                        await result

                stack.push_async_callback(close_transport)
            async with asyncio.timeout(10):
                health = await transport.request("GET", "/api/health")
            self._health(health, selected)
            if hasattr(transport, "bind_daemon_id"):
                transport.bind_daemon_id(health["daemon_id"])
            async with asyncio.timeout(10):
                metadata = await transport.request(
                    "POST", "/api/datasets/inspect", body={"path": selected.path}
                )
            # A forwarded port can change daemons between requests. Do not attach
            # a dataset response to the old server's path namespace.
            async with asyncio.timeout(10):
                following = await transport.request("GET", "/api/health")
            self._health(following, selected)
            if following["daemon_id"] != health["daemon_id"]:
                raise RequestContractError("Daemon changed during inspection")
            return self._data_info(metadata, selected)

    def _health(self, health, selection):
        if (
            type(health) is not dict
            or type(health.get("daemon_id")) is not str
            or not health["daemon_id"]
            or len(health["daemon_id"]) > 256
            or any(ord(char) < 32 for char in health["daemon_id"])
        ):
            raise RequestContractError("Invalid daemon identity")
        requireDaemonProtocol(health)
        for expected in (self.connection.daemon_id, selection.daemon_id):
            if expected is not None and health["daemon_id"] != expected:
                raise RequestContractError("Dataset path belongs to another daemon")

    @staticmethod
    def _data_info(metadata, selection):
        try:
            if (
                type(metadata) is not dict
                or type(metadata.get("variables")) is not list
                or len(metadata["variables"]) > 128
            ):
                raise RequestContractError("Dataset inventory exceeds metadata bounds")
            names = {item["name"] for item in metadata["variables"]}
            input_key = next(name for name in INPUT_KEYS if name in names)
            output_key = next(name for name in OUTPUT_KEYS if name in names)
        except (KeyError, TypeError, StopIteration):
            raise RequestContractError("Dataset keys cannot be mapped") from None
        value = inspect_to_data_info(
            metadata, selection, input_key=input_key, output_key=output_key
        )
        spatial = len(value.input_shape) - 1
        dimensionality = "1D" if spatial <= 2 else "2D" if spatial == 3 else "3D"
        return DataInfo(
            path=value.path,
            format="hdf5" if value.format in {"h5", "hdf5"} else value.format,
            file_size=None,
            num_samples=value.num_samples,
            input_shape=value.input_shape[1:],
            output_shape=value.output_shape[1:] or (1,),
            input_dtype=value.input_dtype,
            output_dtype=value.output_dtype,
            input_key=input_key,
            output_key=output_key,
            dimensionality=dimensionality,
        )
