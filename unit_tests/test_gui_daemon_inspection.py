"""Qt metadata workers use authenticated bounded HTTP, never local ML loaders."""

import asyncio
import json
import subprocess
import sys
import threading
from pathlib import Path

import pytest


pytest.importorskip("PySide6")

from PySide6.QtCore import Qt

from wavedl_gui.service.daemon_contracts import (
    DaemonConnection,
    PathSelectionRef,
    RequestContractError,
)
from wavedl_gui.service.data_parse_worker import DataParseWorker


def metadata():
    return {
        "schema_version": 1,
        "format": "npz",
        "variables": [
            {
                "name": "X",
                "shape": [20, 32],
                "dtype": "float32",
                "sample_count": 20,
                "declared_bytes": 2560,
            },
            {
                "name": "y",
                "shape": [20, 1],
                "dtype": "float32",
                "sample_count": 20,
                "declared_bytes": 80,
            },
        ],
    }


class Transport:
    def __init__(self, *, response=None, daemon="daemon-a", protocol=1, block=False):
        self.calls = []
        self.response = response or metadata()
        self.daemon = daemon
        self.protocol = protocol
        self.block = block
        self.closed = False
        self.entered = None

    async def request(self, method, path, body=None):
        self.calls.append((method, path, body))
        if path == "/api/health":
            return {
                "daemon_id": self.daemon,
                "protocol_min": self.protocol,
                "protocol_max": self.protocol,
            }
        if self.block:
            self.entered.set()
            await asyncio.Event().wait()
        return self.response

    async def aclose(self):
        self.closed = True


def connection(**changes):
    return DaemonConnection(
        "http://localhost:8420", Path("/private/token"), sys.executable, **changes
    )


def worker(transport, monkeypatch, **kwargs):
    monkeypatch.setattr(
        DaemonConnection, "read_credential", lambda self: "private-token"
    )
    return DataParseWorker(
        "/daemon/data.npz",
        connection=connection(**kwargs),
        transport_factory=lambda *args, **kw: transport,
    )


def test_worker_maps_metadata_excludes_batch_and_never_invents_file_size(monkeypatch):
    transport = Transport()
    inspection = worker(transport, monkeypatch)
    info = asyncio.run(inspection._execute())
    assert transport.calls == [
        ("GET", "/api/health", None),
        ("POST", "/api/datasets/inspect", {"path": "/daemon/data.npz"}),
        ("GET", "/api/health", None),
    ]
    assert info.input_shape == (32,) and info.output_shape == (1,)
    assert info.num_samples == 20 and info.num_outputs == 1
    assert info.file_size is None and info.file_size_str == "Not reported"
    assert info.input_key == "X" and info.output_key == "y"
    assert info.dimensionality == "1D"
    assert transport.closed


def test_key_priority_matches_actual_runtime_loader(monkeypatch):
    value = metadata()
    value["variables"].extend(
        [
            value["variables"][0] | {"name": "input_train"},
            value["variables"][1] | {"name": "output_train"},
        ]
    )
    info = asyncio.run(worker(Transport(response=value), monkeypatch)._execute())
    assert (info.input_key, info.output_key) == ("input_train", "output_train")


@pytest.mark.parametrize(
    "shape,dimension",
    [([20, 1, 32], "1D"), ([20, 1, 16, 16], "2D"), ([20, 1, 4, 16, 16], "3D")],
)
def test_dataset_dimensionality_preserves_existing_ui_contract(
    monkeypatch, shape, dimension
):
    value = metadata()
    value["variables"][0]["shape"] = shape
    value["format"] = "h5"
    info = asyncio.run(worker(Transport(response=value), monkeypatch)._execute())
    assert info.input_shape == tuple(shape[1:])
    assert info.dimensionality == dimension and info.format == "hdf5"


def test_remote_profile_requires_explicit_daemon_path_before_http(monkeypatch):
    transport = Transport()
    inspection = worker(transport, monkeypatch, path_realm="remote")
    with pytest.raises(RequestContractError):
        asyncio.run(inspection._execute())
    assert transport.calls == []
    inspection.path_selection = PathSelectionRef(
        "/daemon/data.npz", "daemon", "daemon-a"
    )
    assert asyncio.run(inspection._execute()).num_samples == 20


@pytest.mark.parametrize(
    "options", [{"daemon": "daemon-b"}, {"protocol": 2}, {"protocol": True}]
)
def test_health_binds_selection_identity_and_protocol_before_inspection(
    monkeypatch, options
):
    transport = Transport(**options)
    inspection = worker(transport, monkeypatch, daemon_id="daemon-a")
    with pytest.raises(RequestContractError):
        asyncio.run(inspection._execute())
    assert len(transport.calls) == 1 and transport.closed


def test_reused_forwarding_port_during_inspection_refuses_result(monkeypatch):
    class ChangedDaemon(Transport):
        async def request(self, method, path, body=None):
            value = await super().request(method, path, body)
            if path == "/api/datasets/inspect":
                self.daemon = "new-daemon"
            return value

    transport = ChangedDaemon()
    with pytest.raises(RequestContractError, match="changed"):
        asyncio.run(worker(transport, monkeypatch)._execute())
    assert transport.closed


def test_stop_cancels_actual_async_request_and_closes_transport(monkeypatch):
    transport = Transport(block=True)
    inspection = worker(transport, monkeypatch)

    async def run():
        transport.entered = asyncio.Event()
        task = asyncio.create_task(inspection._execute())
        await transport.entered.wait()
        inspection.stop()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert transport.closed

    asyncio.run(run())


def test_real_qthread_reads_credentials_off_ui_and_emits_sanitized_failure(monkeypatch):
    threads = []

    def credential(self):
        threads.append(threading.get_ident())
        raise ValueError("raw-private-token /private/secret/path")

    monkeypatch.setattr(DaemonConnection, "read_credential", credential)
    inspection = DataParseWorker("/daemon/data.npz", connection=connection())
    errors = []
    inspection.errorOccurred.connect(errors.append, Qt.DirectConnection)
    inspection.start()
    assert inspection.wait(2000)
    assert threads and threads[0] != threading.get_ident()
    assert (
        len(errors) == 1
        and "raw-private-token" not in errors[0]
        and "/private/secret" not in errors[0]
    )


def test_import_worker_does_not_import_numerical_packages():
    program = "import sys; from wavedl_gui.service.data_parse_worker import DataParseWorker; assert not any(name.startswith(('torch','numpy','h5py','scipy')) for name in sys.modules)"
    result = subprocess.run(
        [sys.executable, "-c", program],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    assert result.returncode == 0, result.stderr


def test_real_http_socket_cancel_closes_idle_inspection_connection(monkeypatch):
    monkeypatch.setattr(
        DaemonConnection, "read_credential", lambda self: "inspection-token"
    )

    async def run():
        entered, closed = asyncio.Event(), asyncio.Event()

        async def respond(reader, writer):
            try:
                header = await reader.readuntil(b"\r\n\r\n")
                if b"/api/health " in header:
                    value = json.dumps(
                        {"daemon_id": "daemon-a", "protocol_min": 1, "protocol_max": 1}
                    ).encode()
                    writer.write(
                        b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "
                        + str(len(value)).encode()
                        + b"\r\n\r\n"
                        + value
                    )
                    await writer.drain()
                else:
                    length = int(
                        next(
                            line.split(b":", 1)[1]
                            for line in header.splitlines()
                            if line.lower().startswith(b"content-length:")
                        )
                    )
                    assert json.loads(await reader.readexactly(length)) == {
                        "path": "/daemon/data.npz"
                    }
                    entered.set()
                    assert await reader.read() == b""
                    closed.set()
            finally:
                writer.close()
                await writer.wait_closed()

        server = await asyncio.start_server(respond, "127.0.0.1", 0)
        async with server:
            port = server.sockets[0].getsockname()[1]
            profile = replace_connection_url(connection(), f"http://127.0.0.1:{port}")
            inspection = DataParseWorker("/daemon/data.npz", connection=profile)
            results = []
            inspection.resultReady.connect(results.append, Qt.DirectConnection)
            inspection.start()
            await asyncio.wait_for(entered.wait(), 2)
            inspection.requestInterruption()
            await asyncio.wait_for(closed.wait(), 2)
            assert await asyncio.to_thread(inspection.wait, 2000)
            assert results == []

    asyncio.run(run())


def replace_connection_url(profile, url):
    from dataclasses import replace

    return replace(profile, url=url)
