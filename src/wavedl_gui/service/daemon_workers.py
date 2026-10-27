"""Qt thread boundary for daemon-owned operations; never launches a process.

Only confirmed derived daemon state finishes an operation. A disconnected worker
retains its frozen preview identity, submission key and attempt-aware cursor and
can be restarted. Stop records durable cancellation concurrently with an idle
stream or in-flight submit; it never guesses cancellation from local intent.
"""

from __future__ import annotations

import asyncio
import inspect
import math
import threading
from contextlib import AsyncExitStack, suppress
from dataclasses import replace
from typing import TYPE_CHECKING
from uuid import uuid4

from PySide6.QtCore import QThread, Signal

from wavedl.core.protocol import Envelope
from wavedl.core.scheduler_attempt import SchedulerIdentity


if TYPE_CHECKING:
    from .daemon_contracts import DaemonConnection, RequestSnapshot, RunRef


class _Disconnected(RuntimeError):
    """No authoritative result; retain identity for an explicit resume."""


class DaemonOperationWorker(QThread):
    """Emit core events and confirmed results for thin existing GUI adapters."""

    eventSig = Signal(object)
    runChangedSig = Signal(object)
    nativeScopeChangedSig = Signal(bool)
    statusSig = Signal(str)
    outputSig = Signal(str)
    finishedSig = Signal(bool, str, object)
    connectionSig = Signal(str)

    def __init__(
        self,
        connection: DaemonConnection,
        snapshot: RequestSnapshot,
        *,
        transport_factory=None,
        run_ref: RunRef | None = None,
        idempotency_key=None,
        poll_interval=1.0,
        max_retries=3,
        request_timeout=15.0,
        backoff_base=0.25,
        result_handler=None,
        parent=None,
    ):
        super().__init__(parent)
        if (
            not all(
                math.isfinite(value)
                for value in (poll_interval, request_timeout, backoff_base)
            )
            or not 0 < poll_interval <= 60
            or type(max_retries) is not int
            or not 0 <= max_retries <= 10
            or not 0 < request_timeout <= 120
            or not 0 <= backoff_base <= 10
        ):
            raise ValueError("Invalid worker timing policy")
        self.connection, self.snapshot = connection, snapshot
        self.run_ref = run_ref
        self.idempotency_key = idempotency_key or str(uuid4())
        self.cursor = (0, -1)
        self.metrics = {}
        self.nativePending = False
        self._native_identity = None
        self._transport_factory = transport_factory
        self._result_handler = result_handler
        self._poll_interval, self._max_retries = poll_interval, max_retries
        self._request_timeout, self._backoff_base = request_timeout, backoff_base
        self._stop_requested = threading.Event()
        self._detach_requested = threading.Event()
        self._loop = self._wake = None
        self._owner_task = None
        self._cancel_acknowledged = False
        self._submitted = run_ref is not None
        self._submission_probe = run_ref is not None
        self._terminal = False
        connection_id = getattr(connection, "daemon_id", None)
        snapshot_id = getattr(snapshot, "expected_daemon_id", None)
        if (
            connection_id is not None
            and snapshot_id is not None
            and connection_id != snapshot_id
        ):
            raise ValueError(
                "Request snapshot and connection identify different daemons"
            )
        self._known_daemon_id = snapshot_id or connection_id
        self._event_progress = None

    def stop(self):
        """Schedule cancellation on the owner loop; never block the GUI thread."""
        self._stop_requested.set()
        self._notify()

    def detach(self):
        """Cancel local socket waits, never the daemon-owned operation.

        A synchronous credential read cannot be interrupted. A cancelled stdlib
        DNS lookup can finish later in the executor; it is not forcibly killed.
        """
        self._detach_requested.set()
        loop, task = self._loop, self._owner_task
        if loop is not None and task is not None:
            with suppress(RuntimeError):
                loop.call_soon_threadsafe(task.cancel)

    def _notify(self):
        loop, wake = self._loop, self._wake
        if loop is not None and wake is not None:
            with suppress(RuntimeError):
                loop.call_soon_threadsafe(wake.set)

    def resume(self):
        """Resume the same request/ref/cursor after uncertainty, never resubmit anew."""
        if self.isRunning() or self._terminal:
            return False
        self._detach_requested.clear()
        self.start()
        return True

    def run(self):
        if self._terminal:
            return
        loop = asyncio.new_event_loop()
        try:
            self._owner_task = loop.create_task(self._execute())
            loop.run_until_complete(self._owner_task)
        except asyncio.CancelledError:
            # Detach is a local lifecycle event, never failure/cancellation proof.
            self.connectionSig.emit("Local monitoring detached; reconnect to resume")
        except Exception:
            # Neither a transport error nor invalid remote data proves run failure.
            self.connectionSig.emit("Daemon connection uncertain; reconnect to resume")
        finally:
            pending = asyncio.all_tasks(loop)
            for task in pending:
                task.cancel()
            if pending:
                loop.run_until_complete(
                    asyncio.gather(*pending, return_exceptions=True)
                )
            loop.run_until_complete(loop.shutdown_asyncgens())
            # Deliberately do not join shutdown_default_executor: cancelled DNS
            # calls are non-cooperative OS work and may finish later. Python can
            # still join executor threads at process shutdown; no kill guarantee.
            loop.close()
            self._loop = self._wake = self._owner_task = None

    async def _rpc(self, transport, method, path, **kwargs):
        for attempt in range(self._max_retries + 1):
            if self._detach_requested.is_set():
                raise _Disconnected()
            try:
                if path != "/api/health" and self._known_daemon_id is not None:
                    async with asyncio.timeout(self._request_timeout):
                        identity = await transport.request("GET", "/api/health")
                    self._validate_health(identity)
                if self._detach_requested.is_set():
                    raise asyncio.CancelledError()
                async with asyncio.timeout(self._request_timeout):
                    result = await transport.request(method, path, **kwargs)
                if self._detach_requested.is_set():
                    raise asyncio.CancelledError()
                return result
            except asyncio.CancelledError:
                raise
            except Exception as error:
                status = getattr(error, "status_code", None)
                if status is not None and status < 500:
                    raise _Disconnected() from None
                if attempt == self._max_retries:
                    raise _Disconnected() from None
                self.connectionSig.emit("Daemon connection interrupted; retrying")
                await asyncio.sleep(min(10.0, self._backoff_base * 2**attempt))
        raise _Disconnected()

    async def _health(self, transport):
        health = await self._rpc(transport, "GET", "/api/health")
        self._validate_health(health)
        self._known_daemon_id = health["daemon_id"]
        return health["daemon_id"]

    def _validate_health(self, health):
        if (
            not isinstance(health, dict)
            or type(health.get("daemon_id")) is not str
            or not health["daemon_id"]
            or len(health["daemon_id"]) > 256
            or any(ord(char) < 32 for char in health["daemon_id"])
        ):
            raise _Disconnected()
        lower, upper = health.get("protocol_min"), health.get("protocol_max")
        if (
            type(lower) is not int
            or type(upper) is not int
            or not 1 <= lower <= 1 <= upper
        ):
            self.connectionSig.emit(
                "Daemon protocol mismatch; update the daemon or client before reconnecting"
            )
            raise _Disconnected()
        if self.run_ref is not None and health["daemon_id"] != self.run_ref.daemon_id:
            self.connectionSig.emit(
                "Daemon identity changed; existing run was not retargeted"
            )
            raise _Disconnected()
        if (
            self._known_daemon_id is not None
            and health["daemon_id"] != self._known_daemon_id
        ):
            raise _Disconnected()

    async def _execute(self):
        from .daemon_contracts import RunRef

        self._loop, self._wake = asyncio.get_running_loop(), asyncio.Event()
        self._owner_task = asyncio.current_task()
        if self._detach_requested.is_set():
            raise asyncio.CancelledError()
        self._event_progress = asyncio.Event()
        self.statusSig.emit("starting")
        factory = self._transport_factory
        if factory is None:
            from wavedl.core.client_transport import HttpTransport

            factory = HttpTransport
        # Credential access is worker-owned, never constructor/GUI-thread I/O.
        token = self.connection.read_credential()
        transport = factory(self.connection.url, token)
        async with AsyncExitStack() as stack:
            if hasattr(transport, "__aenter__"):
                transport = await stack.enter_async_context(transport)
            elif hasattr(transport, "aclose"):
                stack.push_async_callback(transport.aclose)
            daemon_id = await self._health(transport)
            if hasattr(transport, "bind_daemon_id"):
                transport.bind_daemon_id(daemon_id)
            if self.run_ref is None:
                preview = await self._rpc(
                    transport,
                    "POST",
                    "/api/runs/plan",
                    body=self.snapshot.payload,
                    idempotency_key=self.idempotency_key,
                )
                self.run_ref = RunRef.from_preview(daemon_id, preview)
                self.runChangedSig.emit(self.run_ref)
            cancel = asyncio.create_task(self._cancel_watch(transport))
            events = None
            try:
                if self._submission_probe:
                    prior = await self._rpc(
                        transport, "GET", f"/api/runs/{self.run_ref.run_id}"
                    )
                    self._accept_view(prior)
                    if type(prior.get("submission_requested")) is not bool:
                        raise _Disconnected()
                    self._submitted = prior["submission_requested"]
                    self._submission_probe = False
                if not self._submitted:
                    view = await self._rpc(
                        transport,
                        "POST",
                        "/api/runs",
                        body={"plan_id": self.run_ref.plan_id},
                    )
                    self._submitted = True
                    self._accept_view(view)
                self.connectionSig.emit("connected")
                events = asyncio.create_task(self._events(transport))
                while not self._detach_requested.is_set():
                    if cancel.done():
                        cancel.result()
                    view = await self._rpc(
                        transport, "GET", f"/api/runs/{self.run_ref.run_id}"
                    )
                    self._accept_view(view)
                    state = view["state"]
                    self.statusSig.emit(state)
                    if view["uncertainty"]:
                        self.connectionSig.emit("Daemon execution state is uncertain")
                    if (
                        state in {"completed", "failed", "cancelled"}
                        and view["uncertainty"] is False
                    ):
                        await self._drain_terminal_events(view, events)
                        # A terminal observation while native replacement is
                        # pending has no current runtime; old telemetry remains
                        # replayable history but cannot become this result.
                        result = {} if self.nativePending else dict(self.metrics)
                        if state == "completed" and self._result_handler is not None:
                            result = self._result_handler(
                                transport, self.run_ref, view, dict(self.metrics)
                            )
                            if inspect.isawaitable(result):
                                result = await result
                        self._terminal = True
                        self.finishedSig.emit(
                            state == "completed", f"Operation {state}", result
                        )
                        return
                    self._wake.clear()
                    try:
                        async with asyncio.timeout(self._poll_interval):
                            await self._wake.wait()
                    except TimeoutError:
                        pass
            finally:
                for task in (events, cancel):
                    if task is not None:
                        task.cancel()
                for task in (events, cancel):
                    if task is not None:
                        with suppress(asyncio.CancelledError, _Disconnected):
                            await task

    def _accept_view(self, view):
        if not isinstance(view, dict) or self.run_ref is None:
            raise _Disconnected()
        if any(
            view.get(key) != getattr(self.run_ref, key)
            for key in ("run_id", "plan_id", "request_id", "operation")
        ):
            raise _Disconnected()
        if (
            type(view.get("uncertainty")) is not bool
            or type(view.get("state")) is not str
            or view["state"]
            not in {
                "planned",
                "pending",
                "submission_unknown",
                "submitted",
                "queued",
                "held",
                "running",
                "stopping",
                "completed",
                "failed",
                "cancelled",
                "terminal_unknown",
                "observation_unavailable",
                "supervision_lost",
            }
        ):
            raise _Disconnected()
        attempt = view.get("attempt")
        if attempt is not None and (type(attempt) is not int or attempt < 1):
            raise _Disconnected()
        if (
            self.run_ref.attempt is not None
            and attempt is not None
            and attempt < self.run_ref.attempt
        ):
            raise _Disconnected()
        if attempt is None and self.run_ref.attempt is not None:
            raise _Disconnected()
        evidence = view.get("evidence", {})
        if not isinstance(evidence, dict):
            raise _Disconnected()
        native_pending = evidence.get("native_pending", False)
        if type(native_pending) is not bool:
            raise _Disconnected()
        identity = evidence.get("native_identity")
        identity_changed = False
        if identity is not None:
            if not isinstance(identity, dict):
                raise _Disconnected()
            try:
                identity = SchedulerIdentity(**identity)
            except (TypeError, ValueError):
                raise _Disconnected()
            if (
                identity.run_id != self.run_ref.run_id
                or identity.request_id != self.run_ref.request_id
            ):
                raise _Disconnected()
            if self._native_identity is not None:
                prior = self._native_identity
                if (identity.cluster, identity.job_id, identity.owner) != (
                    prior.cluster,
                    prior.job_id,
                    prior.owner,
                ) or identity.restart_count < prior.restart_count:
                    raise _Disconnected()
            identity_changed = identity != self._native_identity
        attempt_changed = attempt != self.run_ref.attempt
        if attempt_changed:
            self.run_ref = replace(self.run_ref, attempt=attempt)
            self.metrics.clear()
            self.runChangedSig.emit(self.run_ref)
        if identity is not None:
            self._native_identity = identity
        if (
            attempt_changed
            or identity_changed
            or (native_pending and not self.nativePending)
        ):
            self._cancel_acknowledged = False
        if native_pending != self.nativePending or identity_changed:
            self.nativePending = native_pending
            self.metrics.clear()
            # A newer native allocation can be pending without a runtime
            # attempt. Retain the last proven RunRef as history, not authority
            # for current progress or evaluation.
            self.nativeScopeChangedSig.emit(native_pending)

    async def _drain_terminal_events(self, view, events):
        if self.nativePending:
            return
        runtime = (view.get("evidence") or {}).get("runtime") or {}
        sequence = runtime.get("exit_seq", -1)
        attempt = view.get("attempt")
        if type(sequence) is not int or sequence < 0 or attempt is None:
            return
        target = (attempt, sequence)

        async def drain():
            while self.cursor < target:
                if events.done():
                    raise _Disconnected()
                self._event_progress.clear()
                await self._event_progress.wait()

        try:
            async with asyncio.timeout(self._request_timeout):
                await drain()
        except TimeoutError:
            raise _Disconnected() from None

    async def _cancel_watch(self, transport):
        while not self._detach_requested.is_set():
            if self._stop_requested.is_set() and not self._cancel_acknowledged:
                self.statusSig.emit("stopping")
                view = await self._rpc(
                    transport, "POST", f"/api/runs/{self.run_ref.run_id}/cancel"
                )
                self._accept_view(view)
                if view.get("cancellation_requested") is not True:
                    raise _Disconnected()
                self._cancel_acknowledged = True
                self._wake.set()
            await asyncio.sleep(min(0.1, self._poll_interval))

    async def _events(self, transport):
        for reconnect in range(self._max_retries + 1):
            try:
                await self._health(transport)
                if self._detach_requested.is_set():
                    return
                async for event in transport.events(
                    self.run_ref.run_id, cursor=self.cursor
                ):
                    if self._detach_requested.is_set():
                        return
                    if not isinstance(event, Envelope):
                        self.connectionSig.emit("Daemon event stream requires replay")
                        break
                    if event.run_id != self.run_ref.run_id:
                        raise _Disconnected()
                    position = (event.attempt, event.seq)
                    if position <= self.cursor:
                        continue
                    if (
                        self.run_ref.attempt is None
                        or event.attempt > self.run_ref.attempt
                    ):
                        # Telemetry is not authority for the active allocation.
                        # Synchronize from the derived view before accepting an
                        # evaluation for a newer attempt; never invent a RunRef.
                        self._wake.set()
                        view = await self._rpc(
                            transport, "GET", f"/api/runs/{self.run_ref.run_id}"
                        )
                        self._accept_view(view)
                        if (
                            self.run_ref.attempt is None
                            or event.attempt > self.run_ref.attempt
                        ):
                            raise _Disconnected()
                    self.eventSig.emit(event)
                    if (
                        event.type == "metric"
                        and event.payload.get("name") == "evaluation"
                        and event.attempt == self.run_ref.attempt
                        and not self.nativePending
                    ):
                        values = event.payload.get("metrics", {})
                        if not isinstance(values, dict):
                            raise _Disconnected()
                        self.metrics.update(values)
                    elif event.type == "log":
                        message = event.payload.get("message", "")
                        if isinstance(message, str):
                            self.outputSig.emit(message)
                    # Exit is telemetry only. Wake derived-state polling.
                    if event.type == "exit":
                        self._wake.set()
                    self.cursor = position
                    self._event_progress.set()
            except asyncio.CancelledError:
                raise
            except Exception:
                pass
            self.connectionSig.emit(
                "Daemon event stream disconnected; polling authoritative state"
            )
            await asyncio.sleep(min(10.0, self._backoff_base * 2**reconnect))
