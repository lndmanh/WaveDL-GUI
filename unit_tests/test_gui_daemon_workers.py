"""Daemon GUI workers retain durable identity across cancellation and outages."""

import asyncio
import json
import threading
from types import SimpleNamespace
from uuid import uuid4

import pytest


pytest.importorskip("PySide6")

from wavedl.core.protocol import Envelope
from wavedl_gui.service.daemon_contracts import RequestSnapshot, RunRef
from wavedl_gui.service.daemon_workers import DaemonOperationWorker


def identities():
    return {name: str(uuid4()) for name in ("run_id", "plan_id", "request_id")}


class Transport:
    def __init__(self, *, states=None, stream=None):
        self.ids = identities()
        self.calls, self.cursors = [], []
        self.states = states or [("completed", False)]
        self.stream = stream or []
        self.get_count = 0
        self.submit_failures = 0
        self.plan_failures = 0
        self.get_failures = 0
        self.cancelled = False
        self.daemon_id = "daemon-one"
        self.worker = None
        self.submit_wait = False
        self.closed = False
        self.exit_seq = -1

    def view(self, state="running", uncertainty=False):
        return self.ids | {
            "operation": "test",
            "attempt": 1,
            "state": state,
            "uncertainty": uncertainty,
            "cancellation_requested": self.cancelled,
            "submission_requested": True,
            "evidence": {"runtime": {"exit_seq": self.exit_seq}},
        }

    async def request(self, method, path, body=None, **kwargs):
        self.calls.append((method, path, body, kwargs))
        if path == "/api/health":
            return {"daemon_id": self.daemon_id, "protocol_min": 1, "protocol_max": 1}
        if path.endswith("/plan"):
            if self.plan_failures:
                self.plan_failures -= 1
                raise OSError("secret credential must not escape")
            manifest = {
                "run_id": self.ids["run_id"],
                "operation": "test",
                "run_directory": "/daemon/runs/approved",
                "resolved_config": {"data_path": "/daemon/dataset.npz"},
            }
            return self.ids | {"preview": {"manifest_json": json.dumps(manifest)}}
        if path.endswith("/cancel"):
            self.cancelled = True
            return self.view("stopping")
        if path == "/api/runs" and method == "POST":
            if self.submit_wait:
                self.worker.stop()
                while not self.cancelled:
                    await asyncio.sleep(0)
            if self.submit_failures:
                self.submit_failures -= 1
                raise OSError("lost submit ack")
            return self.view()
        if self.get_failures:
            self.get_failures -= 1
            raise OSError("daemon unavailable")
        if self.cancelled:
            return self.view("cancelled")
        state, uncertainty = self.states[min(self.get_count, len(self.states) - 1)]
        self.get_count += 1
        return self.view(state, uncertainty)

    async def events(self, run_id, *, cursor):
        self.cursors.append(cursor)
        for value in self.stream:
            if isinstance(value, Exception):
                raise value
            yield value
            await asyncio.sleep(0)
        await asyncio.Event().wait()

    async def aclose(self):
        self.closed = True

    def event(self, seq, *, kind="metric", attempt=1, payload=None):
        return Envelope(
            self.ids["run_id"],
            attempt,
            kind,
            seq,
            "2026-10-04T00:00:00Z",
            payload
            or {
                "name": "evaluation",
                "value": 0.5,
                "step": 1,
                "metrics": {"mae": 0.1, "r2_score": 0.5},
            },
        )


def worker_for(transport, **kwargs):
    reads = []
    connection = SimpleNamespace(
        url="http://localhost:8420",
        read_credential=lambda: reads.append(threading.get_ident()) or "token-private",
    )
    snapshot = RequestSnapshot(
        json.dumps({"operation": "test", "config": {"data_path": "/selected.npz"}})
    )
    worker = DaemonOperationWorker(
        connection,
        snapshot,
        transport_factory=lambda url, token: transport,
        poll_interval=0.001,
        max_retries=1,
        backoff_base=0,
        request_timeout=0.5,
        **kwargs,
    )
    transport.worker = worker
    finished, connections, events = [], [], []
    worker.finishedSig.connect(lambda *args: finished.append(args))
    worker.connectionSig.connect(connections.append)
    worker.eventSig.connect(events.append)
    return worker, reads, finished, connections, events


def test_constructor_is_inert_and_single_key_is_reused_across_lost_plan_ack():
    transport = Transport()
    transport.plan_failures = 1
    worker, reads, finished, _, _ = worker_for(transport)
    assert not reads and not transport.calls
    key = worker.idempotency_key
    worker.run()
    plans = [call for call in transport.calls if call[1].endswith("/plan")]
    assert len(plans) == 2
    assert all(call[3]["idempotency_key"] == key for call in plans)
    assert plans[0][2] == plans[1][2] == worker.snapshot.payload
    assert len(finished) == 1 and finished[0][0]
    assert transport.closed


def test_frozen_preview_ref_exists_before_first_submission_and_cancel_lost_ack():
    transport = Transport()
    transport.submit_wait = True
    transport.submit_failures = 1
    worker, _, finished, _, _ = worker_for(transport)
    refs = []
    worker.runChangedSig.connect(refs.append)
    worker.run()
    assert refs and refs[0].run_id == transport.ids["run_id"]
    assert refs[0].attempt is None
    assert any(call[1].endswith("/cancel") for call in transport.calls)
    assert len([call for call in transport.calls if call[1] == "/api/runs"]) == 2
    assert finished == [(False, "Operation cancelled", {})]


def test_stop_before_start_is_not_reset_and_durable_cancel_is_observed():
    transport = Transport(states=[("running", False)])
    worker, _, finished, _, _ = worker_for(transport)
    worker.stop()
    worker.run()
    assert transport.cancelled
    assert finished == [(False, "Operation cancelled", {})]


def test_telemetry_exit_never_finishes_uncertain_derived_state():
    transport = Transport(
        states=[("completed", True), ("terminal_unknown", True), ("completed", False)]
    )
    transport.stream = [
        transport.event(0, kind="exit", payload={"code": 0, "status": "completed"})
    ]
    transport.exit_seq = 0
    worker, _, finished, connections, _ = worker_for(transport)
    worker.run()
    assert transport.get_count == 3
    assert len(finished) == 1 and finished[0][0]
    assert "Daemon execution state is uncertain" in connections


def test_terminal_result_drains_metric_and_exit_events_before_emitting_results():
    transport = Transport()
    transport.stream = [
        transport.event(0),
        transport.event(1, kind="exit", payload={"code": 0, "status": "completed"}),
    ]
    transport.exit_seq = 1
    worker, _, finished, _, events = worker_for(transport)
    worker.run()
    assert [event.seq for event in events] == [0, 1]
    assert finished[0][2] == {"mae": 0.1, "r2_score": 0.5}


def test_disconnection_retains_ref_key_and_restart_never_replans_or_resubmits():
    transport = Transport()
    transport.get_failures = 2
    worker, _, finished, connections, _ = worker_for(transport)
    worker.run()
    assert not finished and worker.run_ref is not None
    assert not worker._terminal
    reference, key = worker.run_ref, worker.idempotency_key
    worker.run()
    assert len(finished) == 1 and finished[0][0]
    assert worker.run_ref == reference and worker.idempotency_key == key
    assert len([call for call in transport.calls if call[1].endswith("/plan")]) == 1
    assert len([call for call in transport.calls if call[1] == "/api/runs"]) == 1
    assert all("token-private" not in value for value in connections)


def test_restart_rejects_daemon_identity_change_without_control_requests():
    transport = Transport()
    worker, _, finished, connections, _ = worker_for(transport)
    worker.run_ref = RunRef(
        "previous-daemon",
        **transport.ids,
        attempt=1,
        operation="test",
        run_directory="/approved",
        data_path="/data",
    )
    worker.run()
    assert not finished
    assert all(path == "/api/health" for _, path, _, _ in transport.calls)
    assert any("identity changed" in value for value in connections)


@pytest.mark.parametrize("requested", [True, False])
def test_external_saved_reference_probes_durable_submission_intent(requested):
    transport = Transport()
    original_view = transport.view

    def view(*args, **kwargs):
        return original_view(*args, **kwargs) | {"submission_requested": requested}

    transport.view = view
    ref = RunRef(
        "daemon-one",
        **transport.ids,
        attempt=1,
        operation="test",
        run_directory="/approved",
        data_path="/data",
    )
    worker, _, finished, _, _ = worker_for(transport, run_ref=ref)
    worker.run()
    assert len(finished) == 1
    assert not any(path.endswith("/plan") for _, path, _, _ in transport.calls)
    submits = [call for call in transport.calls if call[1] == "/api/runs"]
    assert len(submits) == (0 if requested else 1)
    if submits:
        assert submits[0][2] == {"plan_id": ref.plan_id}


def test_attempt_aware_reconnect_cursor_and_deduplication():
    transport = Transport()
    transport.exit_seq = 2
    transport.stream = [
        transport.event(0),
        transport.event(0),
        transport.event(1),
        transport.event(2, kind="exit", payload={"code": 0, "status": "completed"}),
    ]
    worker, _, finished, _, events = worker_for(transport)
    worker.run()
    assert len(finished) == 1
    assert [event.seq for event in events] == [0, 1, 2]
    assert worker.cursor == (1, 2)


def test_stream_reconnect_uses_last_committed_attempt_cursor_and_controls_do_not_advance():
    transport = Transport()
    transport.exit_seq = 2
    calls = []

    async def events(run_id, *, cursor):
        calls.append(cursor)
        if len(calls) == 1:
            yield transport.event(0)
            yield SimpleNamespace(kind="overflow", cursor=(99, 99))
            return
        yield transport.event(0)
        yield transport.event(1)
        yield transport.event(
            2, kind="exit", payload={"code": 0, "status": "completed"}
        )
        await asyncio.Event().wait()

    transport.events = events
    worker, _, finished, _, delivered = worker_for(transport)
    worker.run()
    assert calls == [(0, -1), (1, 0)]
    assert [event.seq for event in delivered] == [0, 1, 2]
    assert len(finished) == 1


def test_stop_remains_responsive_while_poll_and_sse_await_network():
    transport = Transport()
    original = transport.request
    blocked = threading.Event()

    async def waiting(method, path, body=None, **kwargs):
        if method == "GET" and path != "/api/health":
            blocked.set()
            while not transport.cancelled:
                await asyncio.sleep(0.001)
        return await original(method, path, body, **kwargs)

    transport.request = waiting
    worker, _, _, _, _ = worker_for(transport)
    worker.start()
    assert blocked.wait(1)
    worker.stop()
    assert worker.wait(2000)
    assert transport.cancelled and worker._terminal


def test_result_handler_async_download_callback_controls_success_payload():
    transport = Transport()
    invoked = []

    async def handler(client, ref, view, metrics):
        invoked.append(ref)
        return ["/verified/download.png"]

    worker, _, finished, _, _ = worker_for(transport, result_handler=handler)
    worker.run()
    assert invoked == [worker.run_ref]
    assert finished == [(True, "Operation completed", ["/verified/download.png"])]


def test_absent_daemon_never_falls_back_to_local_process(monkeypatch):
    import subprocess

    monkeypatch.setattr(
        subprocess,
        "Popen",
        lambda *args, **kwargs: pytest.fail("No local execution fallback"),
    )
    transport = Transport()

    async def unavailable(*args, **kwargs):
        raise OSError("offline")

    transport.request = unavailable
    worker, _, finished, connections, _ = worker_for(transport)
    worker.run()
    assert not finished and worker.run_ref is None
    assert connections


def test_real_qthread_reads_credential_off_gui_thread_and_cleans_up():
    transport = Transport()
    worker, reads, _, _, _ = worker_for(transport)
    owner = threading.get_ident()
    worker.start()
    assert worker.wait(2000)
    assert reads and reads[0] != owner
    assert not worker.isRunning()
    assert worker._loop is None and worker._wake is None
    assert transport.closed


@pytest.mark.parametrize(
    "kwargs",
    [
        {"poll_interval": float("nan")},
        {"request_timeout": float("inf")},
        {"max_retries": True},
        {"max_retries": 11},
        {"backoff_base": -1},
    ],
)
def test_worker_rejects_unbounded_or_nonfinite_retry_policy(kwargs):
    with pytest.raises(ValueError, match="timing"):
        DaemonOperationWorker(None, None, **kwargs)


def test_historical_evaluation_does_not_populate_active_requeued_attempt():
    transport = Transport()
    original = transport.view
    transport.view = lambda *args, **kwargs: original(*args, **kwargs) | {"attempt": 2}
    transport.exit_seq = 0
    transport.stream = [
        transport.event(0, attempt=1),
        transport.event(
            0, attempt=2, kind="exit", payload={"code": 0, "status": "completed"}
        ),
    ]
    worker, _, finished, _, _ = worker_for(transport)
    worker.metrics.update({"mae": 999})
    worker.run()
    assert worker.run_ref.attempt == 2
    assert finished == [(True, "Operation completed", {})]


def test_future_telemetry_never_retargets_authoritative_active_attempt():
    transport = Transport()
    transport.stream = [transport.event(0, attempt=2)]
    transport.exit_seq = 0
    worker, _, finished, _, _ = worker_for(transport)
    worker.run()
    assert not finished
    assert worker.run_ref.attempt == 1
    assert worker.cursor == (0, -1)
    assert worker.metrics == {}


@pytest.mark.parametrize("identity", ["", None, 1, "x\n", "x" * 257])
def test_invalid_health_identity_prevents_all_control_requests(identity):
    transport = Transport()
    transport.daemon_id = identity
    worker, _, finished, _, _ = worker_for(transport)
    worker.run()
    assert not finished and worker.run_ref is None
    assert all(path == "/api/health" for _, path, _, _ in transport.calls)


def test_snapshot_source_peer_binding_prevents_mutation_before_plan():
    transport = Transport()
    worker, reads, finished, _, _ = worker_for(transport)
    bound = RequestSnapshot("{}", expected_daemon_id="source-daemon")
    connection = worker.connection
    worker = DaemonOperationWorker(
        connection, bound, transport_factory=lambda *args: transport, max_retries=0
    )
    assert not reads and not transport.calls
    worker.run()
    assert worker.run_ref is None and not worker._terminal
    assert not finished
    assert all(path == "/api/health" for _, path, _, _ in transport.calls)


def test_conflicting_snapshot_and_connection_peer_refused_without_io():
    connection = SimpleNamespace(
        daemon_id="connection-peer",
        read_credential=lambda: pytest.fail("Constructor must be inert"),
    )
    with pytest.raises(ValueError, match="different daemons"):
        DaemonOperationWorker(
            connection, RequestSnapshot("{}", expected_daemon_id="snapshot-peer")
        )


def test_malformed_preview_never_submits_or_allocates_run_reference():
    transport = Transport()
    original = transport.request

    async def request(method, path, body=None, **kwargs):
        result = await original(method, path, body, **kwargs)
        if path.endswith("/plan"):
            result["preview"]["manifest_json"] = "{}"
        return result

    transport.request = request
    worker, _, finished, _, _ = worker_for(transport)
    worker.run()
    assert not finished and worker.run_ref is None
    assert not any(path == "/api/runs" for _, path, _, _ in transport.calls)


@pytest.mark.parametrize("lower,upper", [(2, 3), (1, 0), (True, 1), (None, 1)])
def test_protocol_mismatch_is_visible_without_mutation_or_false_terminal(lower, upper):
    transport = Transport()
    original = transport.request

    async def request(method, path, **kwargs):
        if path == "/api/health":
            transport.calls.append((method, path, None, kwargs))
            return {
                "daemon_id": transport.daemon_id,
                "protocol_min": lower,
                "protocol_max": upper,
            }
        return await original(method, path, **kwargs)

    transport.request = request
    worker, _, finished, _, _ = worker_for(transport)
    messages = []
    worker.connectionSig.connect(messages.append)
    worker.run()
    assert any("protocol mismatch" in message.lower() for message in messages)
    assert not finished and not worker._terminal and worker.run_ref is None
    assert worker.cursor == (0, -1)
    assert all(path == "/api/health" for _, path, _, _ in transport.calls)


def test_confirmed_native_failure_without_runtime_exit_finishes_without_drain():
    transport = Transport(states=[("failed", False)])
    worker, _, finished, _, _ = worker_for(transport)
    worker.run()
    assert finished == [(False, "Operation failed", {})]


def test_derived_terminal_missing_expected_exit_stays_resumable():
    transport = Transport()
    transport.exit_seq = 50
    worker, _, finished, _, _ = worker_for(transport)
    worker._request_timeout = 0.02
    worker.run()
    assert not finished and not worker._terminal
    assert worker.run_ref is not None


def test_worker_real_http_hosted_lifecycle_and_durable_sse(tmp_path):
    """Real socket/transport/routes/stores; only execution backend is simulated."""
    import socket
    import sys
    import time
    from dataclasses import asdict

    uvicorn = pytest.importorskip("uvicorn")
    from unit_tests.daemon.test_hosted_app import Backend as WriterBackend
    from wavedl.core.client_transport import HttpTransport
    from wavedl.core.events import ExitPayload, HelloPayload, MetricPayload
    from wavedl_daemon.backends.contracts import (
        BackendObservation,
        ObservationStatus,
        SubmissionHandle,
        SubmissionObservation,
    )
    from wavedl_daemon.http.app import create_app
    from wavedl_daemon.runs.runtime_service import HostedServices
    from wavedl_daemon.storage.settings import Settings

    terminal = threading.Event()

    class Backend(WriterBackend):
        owner = "integration-test-owner"

        def submit(self, plan, *, request_id, attempt):
            handle = super().submit(plan, request_id=request_id, attempt=attempt)
            # The simulated runtime publishes full immutable startup proof;
            # neither the API nor the manually pushed hello may allocate it.
            self.runtime_startup()
            return handle

        def observe(self, handle):
            if isinstance(handle, SubmissionHandle):
                return SubmissionObservation(ObservationStatus.RUNNING)
            return BackendObservation(
                handle.attempt,
                ObservationStatus.TERMINAL
                if terminal.is_set()
                else ObservationStatus.RUNNING,
                exit_code=1 if terminal.is_set() else None,
            )

        def request_cancel(self, handle):
            terminal.set()

    async def integration():
        settings = Settings(tmp_path / "state", tmp_path / "runs")
        services = HostedServices(
            settings, backend_factory=lambda lock: {"local": Backend()}
        )
        app = create_app(
            settings,
            token="integration-token",
            daemon_id="initial",
            build_id="test",
            services=services,
        )
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen(16)
        listener.setblocking(False)
        port = listener.getsockname()[1]
        server = uvicorn.Server(
            uvicorn.Config(app, log_config=None, access_log=False, lifespan="on")
        )
        server.install_signal_handlers = lambda: None
        serving = asyncio.create_task(server.serve(sockets=[listener]))
        operation = None
        try:
            deadline = time.monotonic() + 5
            while not server.started and time.monotonic() < deadline:
                await asyncio.sleep(0.01)
            assert server.started
            connection = SimpleNamespace(
                url=f"http://127.0.0.1:{port}",
                read_credential=lambda: "integration-token",
            )
            payload = {
                "backend": "local",
                "operation": "train",
                "config": {"epochs": 1, "data_path": str(tmp_path / "data.npz")},
                "runtime": {
                    "python": sys.executable,
                    "mode": "existing",
                    "device": "cpu",
                    "environment": {},
                },
                "topology": {
                    "num_machines": 1,
                    "processes_per_machine": 1,
                    "machine_rank": 0,
                },
            }
            worker = DaemonOperationWorker(
                connection,
                RequestSnapshot(json.dumps(payload)),
                poll_interval=0.02,
                max_retries=1,
                request_timeout=3,
                backoff_base=0,
            )
            done, received = [], []
            worker.finishedSig.connect(lambda *args: done.append(args))
            worker.eventSig.connect(received.append)
            operation = asyncio.create_task(worker._execute())
            deadline = time.monotonic() + 5
            while (
                (worker.run_ref is None or worker.run_ref.attempt is None)
                and not operation.done()
                and time.monotonic() < deadline
            ):
                await asyncio.sleep(0.01)
            assert worker.run_ref is not None and worker.run_ref.attempt is not None
            ref = worker.run_ref
            events = [
                Envelope(
                    ref.run_id,
                    ref.attempt,
                    kind,
                    seq,
                    "2026-10-04T00:00:00Z",
                    asdict(value),
                )
                for seq, (kind, value) in enumerate(
                    [
                        (
                            "hello",
                            HelloPayload(
                                1,
                                1,
                                "integration-runtime",
                                "3.11",
                                "cpu",
                                ["train"],
                                sys.executable,
                            ),
                        ),
                        ("metric", MetricPayload("loss", 0.5, 1)),
                        ("exit", ExitPayload(1, "failed")),
                    ]
                )
            ]
            client = HttpTransport(connection.url, "integration-token")
            ack = await client.request(
                "POST",
                f"/api/runs/{ref.run_id}/events",
                {"attempt": ref.attempt, "events": [asdict(event) for event in events]},
            )
            assert ack == {"attempt": ref.attempt, "seq": 2}
            terminal.set()
            await asyncio.wait_for(operation, 5)
            assert done == [(False, "Operation failed", {})]
            assert received == events
            assert worker.cursor == (ref.attempt, 2)
            committed = await services.event_log.read_after(ref.run_id)
            assert committed == events
        finally:
            if operation is not None and not operation.done():
                operation.cancel()
                try:
                    await operation
                except asyncio.CancelledError:
                    pass
            server.should_exit = True
            await asyncio.wait_for(serving, 5)
            listener.close()

    asyncio.run(integration())


@pytest.mark.parametrize("stall", ["health", "poll", "sse"])
def test_detach_closes_real_pending_http_socket_without_terminal_signal(stall):
    from wavedl.core.client_transport import HttpTransport

    async def integration():
        entered, closed = asyncio.Event(), asyncio.Event()
        handlers = set()

        async def handle(reader, writer):
            handlers.add(asyncio.current_task())
            try:
                header = await reader.readuntil(b"\r\n\r\n")
                health = b"GET /api/health " in header
                if (health and stall in {"poll", "sse"}) or (
                    stall == "sse" and b"/events" not in header
                ):
                    value = (
                        {
                            "daemon_id": "daemon-one",
                            "protocol_min": 1,
                            "protocol_max": 1,
                        }
                        if health
                        else {
                            "run_id": reference.run_id,
                            "plan_id": reference.plan_id,
                            "request_id": reference.request_id,
                            "operation": reference.operation,
                            "attempt": reference.attempt,
                            "state": "running",
                            "uncertainty": False,
                            "submission_requested": True,
                            "cancellation_requested": False,
                        }
                    )
                    body = json.dumps(value).encode()
                    writer.write(
                        b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "
                        + str(len(body)).encode()
                        + b"\r\nConnection: close\r\n\r\n"
                        + body
                    )
                    await writer.drain()
                else:
                    if stall == "sse":
                        writer.write(
                            b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n"
                        )
                        await writer.drain()
                    entered.set()
                    try:
                        assert await reader.read() == b""
                    except ConnectionResetError:
                        # Aborting an SSE socket may send RST instead of FIN.
                        # Both prove the pending peer connection was closed.
                        pass
                    closed.set()
            finally:
                writer.close()
                try:
                    await writer.wait_closed()
                except ConnectionResetError:
                    pass
                finally:
                    handlers.discard(asyncio.current_task())

        server = await asyncio.start_server(handle, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        reference = RunRef(
            "daemon-one",
            **identities(),
            attempt=2,
            operation="test",
            run_directory="/approved",
            data_path="/data",
        )
        connection = SimpleNamespace(
            url=f"http://127.0.0.1:{port}", read_credential=lambda: "private-token"
        )
        worker = DaemonOperationWorker(
            connection,
            RequestSnapshot("{}"),
            run_ref=reference,
            transport_factory=HttpTransport,
            request_timeout=15,
        )
        done = []
        worker.finishedSig.connect(lambda *args: done.append(args))
        key = worker.idempotency_key
        try:
            worker.start()
            await asyncio.wait_for(entered.wait(), 2)
            worker.detach()
            assert await asyncio.to_thread(worker.wait, 1000)
            await asyncio.wait_for(closed.wait(), 1)
            assert worker.run_ref == reference and worker.idempotency_key == key
            assert not worker._terminal and not done
            assert worker._owner_task is None and worker._loop is None
        finally:
            worker.detach()
            assert await asyncio.to_thread(worker.wait, 2000)
            server.close()
            await server.wait_closed()
            await asyncio.gather(*handlers, return_exceptions=True)

    asyncio.run(integration())


def test_detach_does_not_join_noncooperative_default_executor_work():
    transport = Transport()
    entered, release = threading.Event(), threading.Event()

    def simulated_dns():
        entered.set()
        release.wait(5)

    async def request(*args, **kwargs):
        await asyncio.get_running_loop().run_in_executor(None, simulated_dns)
        raise OSError("DNS result irrelevant after detach")

    transport.request = request
    worker, _, _, _, _ = worker_for(transport)
    worker._request_timeout = 15
    try:
        worker.start()
        assert entered.wait(1)
        worker.detach()
        assert worker.wait(1000)
        assert not worker._terminal and worker.run_ref is None
        assert not release.is_set()
        assert transport.closed
    finally:
        release.set()
        worker.detach()
        assert worker.wait(2000)
