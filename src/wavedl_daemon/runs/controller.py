"""Durable, single-threaded control commits with bounded external work.

Call ticks on the thread that opened the stores. A tick never waits for backend
I/O. A lost submission reply is searched, never automatically submitted again.
"""

from __future__ import annotations

import getpass
import json
import threading
import time
from copy import deepcopy
from dataclasses import replace
from functools import partial
from pathlib import Path
from typing import TYPE_CHECKING

from wavedl.core.layout import RunLayout, allocate_attempt
from wavedl.core.manifest import read_manifest, write_manifest
from wavedl.core.protocol import ProtocolError, decode
from wavedl.core.safe_files import open_directory, read_first_line
from wavedl.core.scheduler_attempt import SchedulerIdentity
from wavedl_daemon.backends.contracts import (
    BackendObservation,
    ObservationStatus,
    OutcomeStatus,
    SubmissionHandle,
    SubmissionObservation,
    UnsupportedPlan,
)
from wavedl_daemon.backends.slurm_observation import RestartBindingUnavailable
from wavedl_daemon.backends.slurm_submission import SubmissionRejected
from wavedl_daemon.execution.budget import BudgetExhausted, WorkBudget
from wavedl_daemon.execution.pool import BoundedThreadPool
from wavedl_daemon.runs.negotiation import (
    NegotiationStatus,
    RuntimeNegotiation,
    StaleNegotiation,
)
from wavedl_daemon.runs.reconciliation import SchedulerReconciler
from wavedl_daemon.runs.reducer import RunIntent, RunState, SubmissionState, reduce
from wavedl_daemon.storage.executions import (
    ExecutionState,
    StaleExecution,
    native_runtime_pending,
)
from wavedl_daemon.storage.ownership import DispatchRequired, require_dispatch


if TYPE_CHECKING:
    from collections.abc import Callable, Iterable, Mapping

    from wavedl.core.protocol import Envelope
    from wavedl_daemon.backends.contracts import Backend
    from wavedl_daemon.execution.pool import WorkHandle
    from wavedl_daemon.runs.reducer import DerivedState, PublicationEvidence
    from wavedl_daemon.storage.executions import ExecutionRecord, ExecutionStore
    from wavedl_daemon.storage.ownership import DispatchLock
    from wavedl_daemon.storage.plans import PlanRecord, PlanStore
    from wavedl_daemon.storage.runtime_provenance import RuntimeProvenanceStore


def _first_runtime_event(path: Path, token):
    """Read only the bounded first record; never open a FIFO or follow a link."""
    token.check()
    try:
        data = read_first_line(path, limit=65536)
    except FileNotFoundError:
        return None
    except ValueError as error:
        if "exceeds byte bound" in str(error):
            raise ProtocolError(str(error)) from error
        raise OSError("Runtime journal is not a safe regular file") from error
    token.check()
    return decode(data[:-1]) if data.endswith(b"\n") else None


class SubmissionController:
    """Drive one bounded page per tick; no SQLite connection enters a worker."""

    def __init__(
        self,
        plan_store: PlanStore,
        execution_store: ExecutionStore,
        backends: Mapping[str, Backend],
        dispatch_lock: DispatchLock,
        work_budget: WorkBudget | None = None,
        *,
        provenance_store: RuntimeProvenanceStore | None = None,
        collection_store=None,
        clock: Callable[[], float] = time.monotonic,
        handshake_timeout_seconds: float = 30,
        max_runtime_active: int = 1000,
    ) -> None:
        self.plan_store = plan_store
        self.execution_store = execution_store
        self.backends = dict(backends)
        self.dispatch_lock = dispatch_lock
        self.budget = work_budget or WorkBudget()
        if type(max_runtime_active) is not int or max_runtime_active < 1:
            raise ValueError("Runtime tracker capacity must be positive")
        self.provenance_store = provenance_store
        self.collection_store = collection_store
        self._collection_due = {}
        self._initial_due = {}
        self._clock = clock
        self._handshake_timeout = handshake_timeout_seconds
        self._runtime_capacity = max_runtime_active
        self._runtime: dict[str, RuntimeNegotiation] = {}
        self._runtime_errors: dict[str, str] = {}
        self._runtime_work: dict[str, tuple[int, WorkHandle]] = {}
        self._runtime_skip: set[str] = set()
        self._pool = BoundedThreadPool(self.budget)
        self._inflight: dict[str, tuple[str, WorkHandle]] = {}
        self._inflight_sources: dict[str, ExecutionRecord] = {}
        self._receipts: dict[str, dict] = {}
        self._fleets = {
            name: SchedulerReconciler(backend)
            for name, backend in self.backends.items()
            if hasattr(backend, "observe_many")
        }
        self._fleet_work: dict[str, tuple[WorkHandle, dict[str, ExecutionRecord]]] = {}
        self._fleet_active: dict[str, dict[str, ExecutionRecord]] = {
            name: {} for name in self._fleets
        }
        self._cancel_observe: set[str] = set()
        self._capability_work: dict[str, WorkHandle] = {}
        self._capability_due: dict[str, float] = {}
        self._restart_work: dict[str, tuple[ExecutionRecord, WorkHandle]] = {}
        self._restart_due: dict[str, float] = {}
        self.restart_errors: dict[str, str] = {}
        self.restart_watch_refusals = 0
        self.dispatch_errors = {}
        self.capability_errors: dict[str, str] = {}
        self._offset = 0
        self._thread = threading.get_ident()
        self._closed = False

    def _guard(self) -> None:
        if threading.get_ident() != self._thread:
            raise RuntimeError(
                "Controller/store commits must remain on their owner thread"
            )
        if self._closed:
            raise RuntimeError("Controller is closed")
        require_dispatch(self.dispatch_lock)
        stores = [self.plan_store, self.execution_store]
        if self.provenance_store is not None:
            stores.append(self.provenance_store)
        if self.collection_store is not None:
            stores.append(self.collection_store)
        for store in stores:
            if store.read_only:
                raise PermissionError("Read-only recovery cannot dispatch")
            if (
                store.path != self.plan_store.path
                or (
                    self.dispatch_lock.path.resolve()
                    != store.path.parent / "dispatch.lock"
                )
                or store.dispatch_lock is not self.dispatch_lock
            ):
                raise DispatchRequired(
                    "Controller requires matching store dispatch ownership"
                )

    def _tracker(self, record: ExecutionRecord) -> RuntimeNegotiation:
        if record.attempt is None:
            raise ProtocolError("Unbound submission has no accepted runtime attempt")
        tracker = self._runtime.get(record.plan_id)
        if tracker is not None and tracker.attempt == record.attempt:
            return tracker
        if tracker is None and len(self._runtime) >= self._runtime_capacity:
            # Accepted trackers are safely reconstructible from immutable SQLite
            # provenance. Waiting/failure clocks must never be silently reset.
            victim = next(
                (
                    key
                    for key, value in self._runtime.items()
                    if value.result.status == NegotiationStatus.ACCEPTED
                    and key not in self._runtime_work
                ),
                None,
            )
            if victim is None:
                raise BudgetExhausted("Runtime negotiation retention exhausted")
            del self._runtime[victim]
            self._runtime_errors.pop(victim, None)
            self._runtime_skip.discard(victim)
        tracker = RuntimeNegotiation(
            record.run_id,
            record.attempt,
            timeout_seconds=self._handshake_timeout,
        )
        if self.provenance_store is not None:
            persisted = self.provenance_store.get(record.plan_id, record.attempt)
            if persisted is not None:
                tracker.accept_event(persisted.event)
        self._runtime[record.plan_id] = tracker
        self._runtime_errors.pop(record.plan_id, None)
        return tracker

    def accept_runtime_events(self, plan_id: str, events: Iterable[Envelope]):
        """Validate actual attempt evidence and commit hello before exposing it.

        Projection and general journal replay belong to the future event ingestor.
        This acceptance path retains only negotiation evidence, not an event list.
        """
        self._guard()
        if self.provenance_store is None:
            raise RuntimeError("Runtime acceptance requires a provenance store")
        record = self.execution_store.get(plan_id)
        if record is None:
            raise KeyError(plan_id)
        if self._native_pending(record):
            raise ProtocolError(
                "Prior runtime telemetry is not current native execution"
            )
        tracker = self._tracker(record)
        for event in events:
            candidate = deepcopy(tracker)
            try:
                result = candidate.accept_event(event, now=self._clock())
            except StaleNegotiation:
                raise
            if (
                result.status == NegotiationStatus.ACCEPTED
                and tracker.result.status != NegotiationStatus.ACCEPTED
            ):
                try:
                    self.provenance_store.record(plan_id, event)
                except ProtocolError as error:
                    # The store also validates actual environment against the
                    # immutable approved request. Reject the original snapshot,
                    # not the candidate which briefly held uncommitted hello.
                    candidate = deepcopy(tracker)
                    result = candidate.reject(str(error))
            self._runtime[plan_id] = tracker = candidate
            if result.status == NegotiationStatus.FAILED:
                break
        return tracker.result

    def _observe_runtime(self, plan_id: str, observation) -> None:
        if self.provenance_store is not None:
            record = self.execution_store.get(plan_id)
            if record.attempt is not None and not self._native_pending(record):
                self._tracker(record).observe_backend(observation, now=self._clock())

    def reject_runtime_events(self, plan_id: str, reason: str):
        """Latch invalid actual evidence without fabricating a backend exit."""
        self._guard()
        if self.provenance_store is None:
            raise RuntimeError("Runtime rejection requires a provenance store")
        record = self.execution_store.get(plan_id)
        if record is None:
            raise KeyError(plan_id)
        return self._tracker(record).reject(reason)

    def _harvest_runtime(self) -> None:
        for plan_id, (attempt, work) in tuple(self._runtime_work.items()):
            if not work.done():
                continue
            record = self.execution_store.get(plan_id)
            if (
                record is None
                or record.attempt != attempt
                or self._native_pending(record)
            ):
                # Retrieving a finished old result must not latch errors or
                # skip clocks against the newly activated execution generation.
                try:
                    work.result()
                except Exception:
                    pass
                del self._runtime_work[plan_id]
                continue
            try:
                event = work.result()
            except ProtocolError as error:
                self._runtime_errors[plan_id] = str(error)[:8192]
            else:
                record = self.execution_store.get(plan_id)
                if (
                    record is not None
                    and record.attempt == attempt
                    and event is not None
                ):
                    try:
                        self.accept_runtime_events(plan_id, (event,))
                    except StaleNegotiation as error:
                        # The mismatch remains explicit protocol-failure evidence.
                        self._runtime_errors[plan_id] = str(error)
            # Storage/deadline failures intentionally propagate, never become a
            # fabricated runtime or backend exit.
            del self._runtime_work[plan_id]
            self._runtime_skip.add(plan_id)

    def _probe_runtime(self, record: ExecutionRecord) -> None:
        if (
            self.provenance_store is None
            or record.handle is None
            or self._native_pending(record)
        ):
            return
        # A missing journal must not monopolize a single-worker budget and
        # starve backend observations (or cancellation dispatch).
        if record.plan_id in self._runtime_skip:
            self._runtime_skip.discard(record.plan_id)
            return
        tracker = self._tracker(record)
        if (
            tracker.result.status != NegotiationStatus.WAITING
            or record.plan_id in self._runtime_errors
            or record.plan_id in self._runtime_work
        ):
            return
        path = RunLayout(Path(record.handle.run_dir), record.run_id).journal(
            record.attempt
        )
        try:
            work = self._pool.submit(partial(_first_runtime_event, path))
        except BudgetExhausted:
            return
        self._runtime_work[record.plan_id] = (record.attempt, work)

    def _ensure(self, plan_record: PlanRecord) -> ExecutionRecord:
        existing = self.execution_store.get(plan_record.plan_id)
        if existing is not None:
            return existing
        plan = plan_record.plan
        backend = self.backends[plan.target]
        layout = RunLayout(Path(plan.run_dir), plan.run_id)
        # Existing layouts are legitimate immutable previews, not proof of execution.
        if not layout.run_dir.exists():
            layout.run_dir.parent.mkdir(parents=True, exist_ok=True)
            layout.run_dir.mkdir(mode=0o700)
            for directory in (
                layout.attempts,
                layout.checkpoints,
                layout.run_dir / "plots",
            ):
                directory.mkdir(mode=0o700)
        if not layout.run_dir.is_dir():
            raise ValueError("Persisted run directory is not a directory")
        if layout.manifest.exists():
            if read_manifest(layout.manifest) != plan.manifest:
                raise ValueError("Published manifest differs from persisted plan")
        else:
            write_manifest(layout, plan.manifest)
        # Writer-mode plans deliberately leave the runtime generation unbound.
        # The owned backend supervisor/scheduler allocates the first positive
        # attempt only after its native submission has been accepted.
        attempt = None if plan.allocation_mode == "writer" else allocate_attempt(layout)
        try:
            owner = backend.owner
        except AttributeError:
            owner = getpass.getuser()
        return self.execution_store.ensure(
            plan_record.plan_id,
            attempt,
            owner=owner,
        )

    def request_submit(self, plan_id: str) -> ExecutionRecord:
        self._guard()
        plan = self.plan_store.request_submission(plan_id)
        record = self._ensure(plan)
        self._schedule(plan, record)
        return self.execution_store.get(plan_id)

    def request_cancel(self, plan_id: str) -> ExecutionRecord:
        self._guard()
        plan = self.plan_store.request_cancellation(plan_id)
        record = self._ensure(plan)
        self._schedule(plan, record)
        return self.execution_store.get(plan_id)

    def _schedule(self, plan_record: PlanRecord, record: ExecutionRecord) -> None:
        if record.plan_id in self._inflight:
            return
        if self._pool.outstanding >= self.budget.max_workers + self.budget.max_pending:
            return
        backend = self.backends[record.backend]
        plan = plan_record.plan
        if record.state == ExecutionState.PENDING:
            if not record.submission_requested or record.cancellation_requested:
                return
            record, claimed = self.execution_store.claim_submission(record.plan_id)
            if not claimed:
                return
            operation = "submit"
            callback = partial(
                backend.submit,
                plan,
                request_id=record.request_id,
                attempt=record.attempt,
            )
        elif (
            record.handle is None
            and record.submission_handle is None
            and record.state
            in {
                ExecutionState.SUBMITTING,
                ExecutionState.UNKNOWN,
            }
        ):
            if record.backend == "local":
                self.execution_store.mark_local_lost(
                    record.plan_id,
                    "Local submission supervision was lost; never adopt a PID",
                )
                return
            operation = "lookup"
            callback = partial(
                backend.find_by_request_id,
                plan,
                request_id=record.request_id,
                attempt=record.attempt,
            )
        elif (
            record.submission_handle is not None
            and record.attempt is None
            and record.state == ExecutionState.SUBMITTED
        ):
            terminal = (
                record.submission_observation is not None
                and record.submission_observation.status == ObservationStatus.TERMINAL
            )
            collected = self._submission_collection(record)
            if terminal and record.backend == "local":
                return
            if (
                terminal
                and self.collection_store is not None
                and collected is not None
                and dict(plan.resources).get("requeue") is not True
            ):
                self._initial_due.pop(record.plan_id, None)
                return
            if (
                record.cancellation_requested
                and not record.cancel_delivered
                and record.plan_id not in self._cancel_observe
            ):
                operation = "cancel"
                callback = partial(backend.request_cancel, record.submission_handle)
            elif (
                terminal
                and record.backend == "slurm"
                and self.collection_store is not None
                and collected is None
                and self._clock() >= self._collection_due.get(record.plan_id, 0)
            ):
                if hasattr(backend, "collect_submission"):
                    operation = "collect_generation"
                    callback = partial(
                        backend.collect_submission, record.submission_handle
                    )
                else:
                    operation = "collect_submission"
                    callback = partial(backend.collect, record.submission_handle)
                if (
                    record.plan_id not in self._collection_due
                    and len(self._collection_due) >= self._runtime_capacity
                ):
                    raise BudgetExhausted("Collected outcome retry retention exhausted")
                self._collection_due[record.plan_id] = self._clock() + 5
            else:
                if record.backend in self._fleets:
                    if self._clock() < self._initial_due.get(record.plan_id, 0):
                        return
                    if (
                        record.plan_id not in self._initial_due
                        and len(self._initial_due) >= self._runtime_capacity
                    ):
                        victim = next(
                            (
                                key
                                for key in self._initial_due
                                if key not in self._inflight
                                and (
                                    (old := self.execution_store.get(key)) is None
                                    or old.attempt is not None
                                    or (
                                        old.submission_observation is not None
                                        and old.submission_observation.status
                                        == ObservationStatus.TERMINAL
                                    )
                                )
                            ),
                            None,
                        )
                        if victim is None:
                            if terminal:
                                return
                            raise BudgetExhausted(
                                "Initial binding retry retention exhausted"
                            )
                        self._initial_due.pop(victim)
                    self._initial_due[record.plan_id] = self._clock() + 5
                operation = "startup"
                callback = partial(
                    self._discover_initial,
                    backend,
                    record.submission_handle,
                    batched=record.backend in self._fleets,
                )
        elif self._native_pending(record) and record.state == ExecutionState.SUBMITTED:
            native = record.native_observation
            terminal = (
                native is not None and native.status == ObservationStatus.TERMINAL
            )
            if (
                record.cancellation_requested
                and not record.cancel_delivered
                and not terminal
            ):
                operation = "cancel"
                callback = partial(backend.request_cancel, record.submission_handle)
            elif (
                self.collection_store is not None
                and self._submission_collection(record) is None
                and hasattr(backend, "collect_submission")
                and self._clock() >= self._collection_due.get(record.plan_id, 0)
            ):
                operation = "collect_generation"
                callback = partial(backend.collect_submission, record.submission_handle)
                if (
                    record.plan_id not in self._collection_due
                    and len(self._collection_due) >= self._runtime_capacity
                ):
                    raise BudgetExhausted("Collected outcome retry retention exhausted")
                self._collection_due[record.plan_id] = self._clock() + 5
            else:
                return
        elif record.handle is not None and record.state == ExecutionState.SUBMITTED:
            terminal = (
                record.observation
                and record.observation.status == ObservationStatus.TERMINAL
            )
            if terminal:
                if (
                    record.backend != "slurm"
                    or self.collection_store is None
                    or not hasattr(backend, "collect")
                    or self.collection_store.get(record.plan_id, record.attempt)
                    is not None
                    or self._clock() < self._collection_due.get(record.plan_id, 0)
                ):
                    return
                operation = "collect"
                callback = partial(backend.collect, record.handle)
                if (
                    record.plan_id not in self._collection_due
                    and len(self._collection_due) >= self._runtime_capacity
                ):
                    raise BudgetExhausted("Collected outcome retry retention exhausted")
                self._collection_due[record.plan_id] = self._clock() + 5
            elif (
                record.cancellation_requested
                and not record.cancel_delivered
                and record.plan_id not in self._cancel_observe
            ):
                operation = "cancel"
                callback = partial(backend.request_cancel, record.handle)
            elif (
                record.observation
                and record.observation.status == ObservationStatus.TERMINAL
            ):
                return
            else:
                if record.backend in self._fleets:
                    return
                operation = "observe"
                callback = partial(backend.observe, record.handle)
        else:
            return

        receipt = {}

        def work(token):
            token.check()
            self._guard_external()
            try:
                result = callback()
            except Exception as error:
                receipt["error"] = error
                raise
            # Preserve actual responses even when the pool's post-call deadline
            # check fires. Timeout is not proof that external acceptance failed.
            receipt["result"] = result
            return result

        try:
            handle = self._pool.submit(work)
        except BudgetExhausted:
            # A claimed but unstarted submit is still conservatively unknown.
            if operation == "submit":
                self.execution_store.mark_unknown(
                    record.plan_id, "Submission admission lost"
                )
            return
        self._inflight[record.plan_id] = (operation, handle)
        self._inflight_sources[record.plan_id] = record
        self._receipts[record.plan_id] = receipt

    @staticmethod
    def _same_generation(record, source):
        same = record is not None and (
            record.attempt,
            record.handle,
            record.submission_handle,
        ) == (
            source.attempt,
            source.handle,
            source.submission_handle,
        )
        if same:
            return SubmissionController._native_identity(
                record
            ) == SubmissionController._native_identity(source)
        return same

    @staticmethod
    def _native_pending(record):
        return native_runtime_pending(record)

    @staticmethod
    def _native_identity(record):
        # Native identity is monotonic authority, not a known-good lifecycle
        # snapshot or the latest (possibly identity-free) diagnostic.
        if record.native_identity is not None:
            return record.native_identity
        observation = record.submission_observation
        return observation.native_identity if observation is not None else None

    def _submission_collection(self, record):
        """Resolve exact native generation; never relabel older ACK collections."""
        if self.collection_store is None or record.backend != "slurm":
            return None
        identity = self._native_identity(record)
        if identity is not None:
            collected = self.collection_store.get_submission_generation(
                record.plan_id, identity
            )
            if collected is not None:
                return collected
            if identity.restart_count != 0:
                return None
        return self.collection_store.get_submission(record.plan_id)

    def _watch_submission(self, record):
        """Retain a bounded native watch for approved, still-unbound requeues."""
        if record.submission_handle is None:
            return False
        plan = self.plan_store.get(record.plan_id)
        return plan is not None and dict(plan.plan.resources).get("requeue") is True

    @staticmethod
    def _discover_initial(backend, receipt, *, batched=False):
        """Return native observation and proof; a journal is never activation proof."""
        if batched:
            if not SubmissionController._initial_hint(receipt):
                return None, None, None
            return None, backend.discover_initial(receipt), None
        observation = backend.observe(receipt)
        if not isinstance(observation, SubmissionObservation):
            raise ValueError("Unbound backend must return a submission observation")
        if observation.status == ObservationStatus.SUPERVISION_LOST:
            return observation, None, None
        try:
            binding = backend.discover_initial(receipt)
        except (OSError, ValueError, RuntimeError) as error:
            # Native lifecycle evidence remains independent of startup proof.
            # A torn/foreign binding does not erase a verified observation.
            return observation, None, error
        return observation, binding, None

    @staticmethod
    def _initial_hint(receipt):
        """Bounded visibility hint; native verification remains authoritative."""
        path = Path(receipt.run_dir) / "submissions" / receipt.request_id / "launchers"
        try:
            with open_directory(path) as launchers:
                launchers.verify_private_owner()
                for count, entry in enumerate(launchers.entries(), 1):
                    if count > 4096:
                        raise BudgetExhausted("Startup hint inventory exhausted")
                    if not entry.is_directory:
                        continue
                    with launchers.open_directory(entry.name) as claim:
                        try:
                            with claim.open_file("binding.json") as proof:
                                proof.verify_private_owner()
                                proof.guard()
                        except FileNotFoundError:
                            continue
                        launchers.guard()
                        return True
                launchers.guard()
        except FileNotFoundError:
            pass
        return False

    @staticmethod
    def _restart_hint(handle, token):
        """Filesystem hints only admit native discovery; never authorize CAS.

        Unchanged jobs do not add a per-run scheduler query to batched fleet
        polling. Abandoned reservations remain harmless hints, not executions.
        """
        with open_directory(Path(handle.run_dir) / "attempts") as attempts:
            attempts.verify_private_owner()
            for count, entry in enumerate(attempts.entries(), 1):
                token.check()
                if count > 4096:
                    raise BudgetExhausted("Scheduler attempt hint inventory exhausted")
                if entry.is_directory and entry.name.isdecimal():
                    if len(entry.name) > 19:
                        raise ValueError("Scheduler attempt hint integer exceeds bound")
                    if int(entry.name) > handle.attempt:
                        attempts.guard()
                        return True
            attempts.guard()
        return False

    def _guard_external(self) -> None:
        if self._closed:
            raise RuntimeError("Controller closed before external dispatch")
        require_dispatch(self.dispatch_lock)
        if (
            self.dispatch_lock.path.resolve()
            != self.plan_store.path.parent / "dispatch.lock"
        ):
            raise DispatchRequired(
                "External operation has mismatched dispatch ownership"
            )

    def _record_observation(self, plan_id, observation):
        """Contradictory receipts remain uncertainty, not infinite retry loops."""
        try:
            current = self.execution_store.get(plan_id)
            if (
                isinstance(observation, SubmissionObservation)
                and current.attempt is not None
            ):
                if observation != current.latest_native_observation:
                    self.execution_store.observe_native_generation(
                        plan_id, observation, expected_revision=current.revision
                    )
                updated = self.execution_store.get(plan_id)
                if (
                    observation.native_identity is not None
                    and observation.native_identity.restart_count
                    == json.loads(updated.handle.raw_json).get("restart_count")
                ):
                    bound = observation.bind_attempt(updated.attempt)
                    if bound != updated.latest_observation:
                        self.execution_store.record_observation(plan_id, bound)
            else:
                latest = (
                    current.latest_submission_observation
                    if isinstance(observation, SubmissionObservation)
                    else current.latest_observation
                )
                # Fleet terminal snapshots are re-delivered until their owner
                # persists them. Already durable evidence is not a new source
                # revision and must not churn revisions on every cached tick.
                if (
                    not isinstance(observation, SubmissionObservation)
                    or observation != latest
                ):
                    self.execution_store.record_observation(plan_id, observation)
        except StaleExecution:
            current = self.execution_store.get(plan_id)
            attempt = (
                current.attempt
                if isinstance(observation, SubmissionObservation)
                else observation.attempt
            )
            if current is None or current.attempt != attempt:
                raise
            expected = self._native_identity(current)
            identity = getattr(observation, "native_identity", None)
            if (
                expected is not None
                and identity is not None
                and identity.restart_count < expected.restart_count
            ):
                # Delayed native generation evidence is neither failure nor
                # uncertainty about the newer allocation already verified.
                return
            error = (
                SubmissionObservation(
                    ObservationStatus.ERROR,
                    detail="Contradictory native observation; retained prior evidence",
                )
                if isinstance(observation, SubmissionObservation)
                else self._observation_error(
                    current,
                    "Contradictory backend observation; retained prior evidence",
                )
            )
            if isinstance(error, SubmissionObservation) and current.attempt is not None:
                self.execution_store.observe_native_generation(
                    plan_id, error, expected_revision=current.revision
                )
                return
            self.execution_store.record_observation(
                plan_id,
                error,
            )

    @staticmethod
    def _observation_error(record, detail):
        if record.attempt is None or native_runtime_pending(record):
            return SubmissionObservation(ObservationStatus.ERROR, detail=detail)
        return BackendObservation(
            record.attempt, ObservationStatus.ERROR, detail=detail
        )

    def _harvest(self) -> None:
        for plan_id, (operation, work) in tuple(self._inflight.items()):
            if not work.done():
                continue
            record = self.execution_store.get(plan_id)
            source = self._inflight_sources[plan_id]
            receipt = self._receipts[plan_id]
            same_source = self._same_generation(record, source)
            if operation == "collect" and record is not None:
                # A completed positive runtime receipt remains historical proof
                # when the native job requeues during the collection call.
                same_source = (
                    record.attempt,
                    record.handle,
                    record.submission_handle,
                ) == (source.attempt, source.handle, source.submission_handle)
            if not same_source:
                try:
                    work.result()
                except Exception:
                    pass
                del self._inflight[plan_id]
                del self._inflight_sources[plan_id]
                del self._receipts[plan_id]
                continue
            try:
                if "error" in receipt:
                    raise receipt["error"]
                result = receipt["result"] if "result" in receipt else work.result()
            except Exception as error:
                detail = f"{operation} failed: {error}"[:8192]
                if operation == "submit" and isinstance(
                    error, (SubmissionRejected, UnsupportedPlan)
                ):
                    self.execution_store.mark_rejected(plan_id, detail)
                elif operation in {"submit", "lookup"}:
                    self.execution_store.mark_unknown(plan_id, detail)
                else:
                    if operation == "cancel":
                        self._cancel_observe.add(plan_id)
                    self._record_observation(
                        plan_id, self._observation_error(record, detail)
                    )
                    self._observe_runtime(
                        plan_id, self.execution_store.get(plan_id).latest_observation
                    )
                del self._inflight[plan_id]
                del self._inflight_sources[plan_id]
                del self._receipts[plan_id]
                continue
            # Persistence failures are deliberately not caught as backend errors.
            if operation in {"submit", "lookup"}:
                if result is None:
                    self.execution_store.mark_unknown(
                        plan_id, "No unique backend receipt; acceptance remains unknown"
                    )
                else:
                    if isinstance(result, SubmissionHandle):
                        self.execution_store.attach_submission(
                            plan_id, result, expected_revision=record.revision
                        )
                    else:
                        self.execution_store.record_handle(plan_id, result)
            elif operation == "cancel":
                self.execution_store.mark_cancel_delivered(plan_id)
            elif operation == "collect":
                collected = self.collection_store.record_collection(
                    plan_id, source.handle, result
                )
                if collected is not None:
                    self._collection_due.pop(plan_id, None)
            elif operation == "collect_submission":
                collected = self.collection_store.record_submission_collection(
                    plan_id, source.submission_handle, result
                )
                if collected is not None:
                    self._collection_due.pop(plan_id, None)
            elif operation == "collect_generation":
                if result is not None:
                    expected = self._native_identity(record)
                    if (
                        expected is None
                        or result.identity.restart_count >= expected.restart_count
                    ):
                        try:
                            self.execution_store.observe_native_generation(
                                plan_id,
                                result.observation,
                                expected_revision=record.revision,
                            )
                            current = self.execution_store.get(plan_id)
                            collected = (
                                self.collection_store.record_submission_generation(
                                    plan_id,
                                    source.submission_handle,
                                    result,
                                    expected_revision=current.revision,
                                )
                            )
                        except StaleExecution:
                            self._record_observation(
                                plan_id,
                                self._observation_error(
                                    record,
                                    "Native collection proof differs from current generation",
                                ),
                            )
                        else:
                            if collected is not None:
                                self._collection_due.pop(plan_id, None)
            elif operation == "startup":
                observation, binding, discovery_error = result
                if observation is not None:
                    self._record_observation(plan_id, observation)
                current = self.execution_store.get(plan_id)
                if discovery_error is not None:
                    self.execution_store.record_observation(
                        plan_id,
                        self._observation_error(
                            current,
                            f"Startup proof unavailable: {discovery_error}"[:8192],
                        ),
                    )
                if binding is not None:
                    try:
                        self.execution_store.activate_initial(
                            plan_id, binding, expected_revision=current.revision
                        )
                    except StaleExecution:
                        self._record_observation(
                            plan_id,
                            self._observation_error(
                                current,
                                "Startup binding differs from current native generation",
                            ),
                        )
                    else:
                        self._initial_due.pop(plan_id, None)
                elif (
                    observation is not None
                    and observation.status == ObservationStatus.SUPERVISION_LOST
                ):
                    self.execution_store.mark_local_lost(plan_id, observation.detail)
                    self._initial_due.pop(plan_id, None)
                elif (
                    observation is not None
                    and observation.status == ObservationStatus.TERMINAL
                    and record.backend == "local"
                ):
                    release = getattr(self.backends[record.backend], "release", None)
                    if release is not None:
                        release(record.submission_handle)
                self._cancel_observe.discard(plan_id)
            else:
                self._record_observation(plan_id, result)
                self._observe_runtime(
                    plan_id, self.execution_store.get(plan_id).latest_observation
                )
                if (
                    result.status == ObservationStatus.TERMINAL
                    and record.backend == "local"
                ):
                    release = getattr(self.backends[record.backend], "release", None)
                    if release is not None:
                        release(record.handle)
                if result.status == ObservationStatus.SUPERVISION_LOST:
                    self.execution_store.mark_local_lost(plan_id, result.detail)
                self._cancel_observe.discard(plan_id)
            del self._inflight[plan_id]
            del self._inflight_sources[plan_id]
            del self._receipts[plan_id]

    def _schedule_restart(self, plan, record):
        """Read native restart proposals only for an approved requeue plan."""
        if (
            dict(plan.plan.resources).get("requeue") is not True
            or record.backend != "slurm"
            or record.handle is None
            or record.state != ExecutionState.SUBMITTED
            or record.plan_id in self._restart_work
            or self._clock() < self._restart_due.get(record.plan_id, 0)
        ):
            return
        backend = self.backends[record.backend]
        if not hasattr(backend, "discover_restart"):
            return
        terminal = (
            record.observation is not None
            and record.observation.status == ObservationStatus.TERMINAL
        )
        if (
            record.plan_id not in self._restart_due
            and len(self._restart_due) >= self._runtime_capacity
        ):
            # Active executions take precedence over optional terminal watches.
            # Historical jobs cannot permanently occupy active admission.
            victim = None
            if not terminal:
                for key in self._restart_due:
                    if key in self._restart_work:
                        continue
                    old = self.execution_store.get(key)
                    if old is None or (
                        old.observation is not None
                        and old.observation.status == ObservationStatus.TERMINAL
                    ):
                        victim = key
                        break
            if victim is None:
                self.restart_watch_refusals = min(
                    2**63 - 1, self.restart_watch_refusals + 1
                )
                if terminal:
                    return
                raise BudgetExhausted("Scheduler restart retention exhausted")
            self._restart_due.pop(victim)
            self.restart_errors.pop(victim, None)
            self.restart_watch_refusals = min(
                2**63 - 1, self.restart_watch_refusals + 1
            )

        def discover(token):
            token.check()
            self._guard_external()
            mismatch = record.latest_observation is not None and (
                "Scheduler requeue changed execution identity"
                in record.latest_observation.detail
                or "Accounting contains a newer scheduler execution"
                in record.latest_observation.detail
            )
            if (
                not terminal
                and not mismatch
                and not self._restart_hint(record.handle, token)
            ):
                return None
            return backend.discover_restart(record.handle)

        try:
            work = self._pool.submit(discover)
        except BudgetExhausted:
            return
        self._restart_work[record.plan_id] = (record, work)
        self._restart_due[record.plan_id] = self._clock() + 5

    def _harvest_restarts(self):
        for plan_id, (source, work) in tuple(self._restart_work.items()):
            if not work.done():
                continue
            record = self.execution_store.get(plan_id)
            if not self._same_generation(record, source) or (
                self._native_identity(record) != self._native_identity(source)
            ):
                try:
                    work.result()
                except Exception:
                    pass
                del self._restart_work[plan_id]
                continue
            try:
                work.token.check()
                proposal = work.result()
            except Exception as error:
                self.restart_errors[plan_id] = type(error).__name__
                terminal = (
                    record.observation is not None
                    and record.observation.status == ObservationStatus.TERMINAL
                )
                native_restart = getattr(error, "native_restart_count", None)
                if (
                    isinstance(error, RestartBindingUnavailable)
                    and record.submission_handle is not None
                ):
                    receipt = record.submission_handle
                    job, cluster = receipt.job_id.split(";")
                    identity = SchedulerIdentity(
                        receipt.run_id,
                        receipt.request_id,
                        cluster,
                        job,
                        receipt.owner,
                        native_restart,
                    )
                    try:
                        self.execution_store.record_native_generation(
                            plan_id, identity, expected_revision=record.revision
                        )
                    except StaleExecution:
                        # A delayed native reply cannot regress the durable head.
                        pass
                if not terminal or type(native_restart) is int:
                    self.execution_store.record_observation(
                        plan_id,
                        BackendObservation(
                            record.attempt,
                            ObservationStatus.ERROR,
                            detail=f"Restart observation unavailable: {type(error).__name__}",
                        ),
                    )
            else:
                self.restart_errors.pop(plan_id, None)
                if proposal is not None:
                    binding, candidate = proposal
                    # Prepare before committing, but never publish new tracker
                    # state until native-backed CAS succeeds. Old workers remain
                    # admitted until their real completion and are harvest-fenced.
                    tracker = RuntimeNegotiation(
                        record.run_id,
                        candidate.attempt,
                        timeout_seconds=self._handshake_timeout,
                    )
                    if (
                        plan_id not in self._runtime
                        and len(self._runtime) >= self._runtime_capacity
                    ):
                        self.restart_errors[plan_id] = "BudgetExhausted"
                        del self._restart_work[plan_id]
                        continue
                    fleet = self._fleets.get(record.backend)
                    known = self._fleet_active.setdefault(record.backend, {})
                    if (
                        fleet is not None
                        and record.request_id not in known
                        and len(known) >= fleet.policy.max_active
                    ):
                        self.restart_errors[plan_id] = "BudgetExhausted"
                        del self._restart_work[plan_id]
                        continue
                    activated = self.execution_store.activate_requeue(
                        plan_id,
                        binding,
                        candidate,
                        expected_revision=record.revision,
                    )
                    if not self._same_generation(activated, record):
                        self._runtime[plan_id] = tracker
                        self._runtime_errors.pop(plan_id, None)
                        self._runtime_skip.discard(plan_id)
                        self._cancel_observe.discard(plan_id)
                        self._restart_due[plan_id] = self._clock() + 5
                        self._collection_due.pop(plan_id, None)
                        known[record.request_id] = activated
            del self._restart_work[plan_id]

    def reconcile_once(self) -> list[ExecutionRecord]:
        self._guard()
        self._harvest_runtime()
        self._harvest()
        self._harvest_restarts()
        for name, (work, identities) in tuple(self._fleet_work.items()):
            if not work.done():
                continue
            try:
                updates = work.result()
            except Exception as error:
                for source in identities.values():
                    plan_id = source.plan_id
                    record = self.execution_store.get(plan_id)
                    if not self._same_generation(record, source):
                        continue
                    self._record_observation(
                        plan_id, self._observation_error(record, str(error)[:8192])
                    )
                    self._observe_runtime(
                        plan_id, self.execution_store.get(plan_id).latest_observation
                    )
            else:
                for update in updates:
                    if update.observation is not None:
                        source = identities[update.handle.request_id]
                        if not self._same_generation(
                            self.execution_store.get(source.plan_id), source
                        ):
                            continue
                        self._record_observation(source.plan_id, update.observation)
                        self._observe_runtime(
                            source.plan_id,
                            self.execution_store.get(source.plan_id).latest_observation,
                        )
                        self._cancel_observe.discard(source.plan_id)
                        if update.observation.status == ObservationStatus.TERMINAL:
                            if not self._watch_submission(
                                self.execution_store.get(source.plan_id)
                            ):
                                self._fleet_active[name].pop(
                                    update.handle.request_id, None
                                )
            del self._fleet_work[name]
        for name, fleet in self._fleets.items():
            # Scheduler probes use the same bounded I/O pool. Never take the
            # reconciler's mutex while its scheduler tick is still running.
            if name in self._fleet_work:
                continue
            pending = self._capability_work.get(name)
            if pending is not None and pending.done():
                try:
                    fleet.set_capabilities(pending.result())
                    self.capability_errors.pop(name, None)
                except Exception as error:
                    self.capability_errors[name] = str(error)[:8192]
                del self._capability_work[name]
                self._capability_due[name] = time.monotonic() + 300
            backend = self.backends[name]
            if (
                hasattr(backend, "capabilities")
                and name not in self._capability_work
                and time.monotonic() >= self._capability_due.get(name, 0)
            ):

                def probe(token, backend=backend):
                    token.check()
                    self._guard_external()
                    return backend.capabilities()

                try:
                    self._capability_work[name] = self._pool.submit(probe)
                except BudgetExhausted:
                    pass
        limit = min(1000, self.budget.max_workers + self.budget.max_pending)
        plans = self.plan_store.list_pending(limit=limit, offset=self._offset)
        self._offset = self._offset + len(plans) if len(plans) == limit else 0
        records = []
        for plan in plans:
            record = self._ensure(plan)
            try:
                self._schedule_restart(plan, record)
                self._probe_runtime(record)
                self._schedule(plan, record)
            except BudgetExhausted:
                if (
                    plan.plan_id not in self.dispatch_errors
                    and len(self.dispatch_errors) >= self._runtime_capacity
                ):
                    self.dispatch_errors.pop(next(iter(self.dispatch_errors)))
                self.dispatch_errors[plan.plan_id] = "BudgetExhausted"
            else:
                self.dispatch_errors.pop(plan.plan_id, None)
            records.append(self.execution_store.get(plan.plan_id))
        for name, fleet in self._fleets.items():
            if name in self._fleet_work:
                continue
            known = self._fleet_active.setdefault(name, {})
            for record in records:
                native_handle = (
                    record.submission_handle
                    if self._watch_submission(record)
                    else record.handle or record.submission_handle
                )
                if record.backend != name or native_handle is None:
                    continue
                observation = (
                    record.observation
                    if record.attempt is not None
                    else record.submission_observation
                )
                if observation and observation.status == ObservationStatus.TERMINAL:
                    if not self._watch_submission(record):
                        known.pop(record.request_id, None)
                        continue
                if (
                    record.request_id not in known
                    and len(known) >= fleet.policy.max_active
                ):
                    victim = next(
                        (
                            key
                            for key, old in known.items()
                            if old.attempt is None
                            and old.submission_observation is not None
                            and old.submission_observation.status
                            == ObservationStatus.TERMINAL
                        ),
                        None,
                    )
                    if victim is not None:
                        known.pop(victim)
                        known[record.request_id] = record
                        continue
                    if (
                        len(self.dispatch_errors) >= self._runtime_capacity
                        and record.plan_id not in self.dispatch_errors
                    ):
                        self.dispatch_errors.pop(next(iter(self.dispatch_errors)))
                    self.dispatch_errors[record.plan_id] = "BudgetExhausted"
                    continue
                known[record.request_id] = record
            active = tuple(known.values())
            if not active:
                fleet.set_handles(())
                continue
            fleet.set_handles(
                tuple(
                    record.submission_handle
                    if self._watch_submission(record)
                    else record.handle or record.submission_handle
                    for record in active
                ),
                native_generations={
                    record.submission_handle: self._native_identity(record)
                    for record in active
                    if (record.attempt is None or self._watch_submission(record))
                    and self._native_identity(record) is not None
                },
                terminal_watch=tuple(
                    record.submission_handle
                    for record in active
                    if self._watch_submission(record)
                ),
            )
            try:
                work = fleet.submit_tick(self._pool)
            except BudgetExhausted:
                continue
            self._fleet_work[name] = (
                work,
                {record.request_id: record for record in active},
            )
        return records

    def startup(self) -> list[ExecutionRecord]:
        return self.reconcile_once()

    def derive(
        self,
        plan_id: str,
        events: Iterable[Envelope] = (),
        *,
        publication: PublicationEvidence | None = None,
    ) -> DerivedState:
        """Read-only binding: wrapper success never fabricates a runtime exit."""
        plan = self.plan_store.get(plan_id)
        record = self.execution_store.get(plan_id)
        if plan is None or record is None:
            raise KeyError(plan_id)
        state = SubmissionState.__members__.get(
            record.state.name, SubmissionState.PENDING
        )
        native_pending = self._native_pending(record)
        native_lifecycle = native_pending or (
            record.attempt is None
            and record.native_identity is not None
            and record.latest_native_observation is not None
        )
        last_observation = (
            record.native_observation
            if native_lifecycle
            else (
                record.observation
                if record.attempt is not None
                else record.submission_observation
            )
        )
        observation = (
            record.latest_native_observation
            if native_lifecycle
            else (
                record.latest_observation
                if record.attempt is not None
                else record.latest_submission_observation
            )
        )
        if record.state == ExecutionState.LOCAL_LOST:
            observation = (
                BackendObservation(
                    record.attempt,
                    ObservationStatus.SUPERVISION_LOST,
                    detail=record.detail,
                )
                if record.attempt is not None
                else SubmissionObservation(
                    ObservationStatus.SUPERVISION_LOST, detail=record.detail
                )
            )
        tracker = self._runtime.get(plan_id)
        provenance = None
        if (
            self.provenance_store is not None
            and record.attempt is not None
            and not native_pending
        ):
            provenance = self.provenance_store.get(plan_id, record.attempt)
        validation_error = []
        validator = None
        if (
            self.provenance_store is not None
            and record.attempt is not None
            and not native_pending
        ):
            validator = (
                deepcopy(tracker)
                if tracker is not None and tracker.attempt == record.attempt
                else RuntimeNegotiation(
                    record.run_id,
                    record.attempt,
                    timeout_seconds=self._handshake_timeout,
                )
            )
            if provenance is not None:
                validator.accept_event(provenance.event)

        def runtime_events():
            if record.attempt is None or native_pending:
                return
            if provenance is not None:
                yield provenance.event
            for event in events:
                if validator is not None:
                    checked = validator.accept_event(event)
                    if checked.status == NegotiationStatus.FAILED:
                        validation_error.append(checked.reason)
                        break
                    if provenance is None:
                        validation_error.append(
                            "Runtime hello must be durably accepted before derivation"
                        )
                        break
                yield event

        collected = None
        requires_collection = (
            self.collection_store is not None
            and record.backend == "slurm"
            and record.attempt is not None
            and not native_pending
        )
        if requires_collection:
            collected = self.collection_store.get(plan_id, record.attempt)
        elif self.collection_store is not None and record.backend == "slurm":
            collected = self._submission_collection(record)
        if collected is not None:
            collection_identity = None
            if not requires_collection:
                collection_identity = getattr(collected, "identity", None)
                if collection_identity is None:
                    from wavedl_daemon.storage.submission_generations import (
                        receipt_identity,
                    )

                    collection_identity = receipt_identity(
                        collected.handle, plan.plan, 0
                    )

            def matches_collection(observed):
                return requires_collection or (
                    isinstance(observed, SubmissionObservation)
                    and observed.native_identity == collection_identity
                )

            if (
                last_observation is not None
                and last_observation.status == ObservationStatus.TERMINAL
                and matches_collection(last_observation)
            ):
                last_observation = replace(
                    last_observation,
                    batch=collected.result.batch,
                    stage_out=collected.result.stage_out,
                )
            if (
                observation is not None
                and observation.status == ObservationStatus.TERMINAL
                and matches_collection(observation)
            ):
                observation = replace(
                    observation,
                    batch=collected.result.batch,
                    stage_out=collected.result.stage_out,
                )
        derived = reduce(
            RunIntent(
                record.run_id,
                plan.plan.operation,
                None if native_pending else record.attempt,
                record.backend,
                state,
                record.submission_handle
                if native_pending
                else record.handle or record.submission_handle,
                record.cancellation_requested,
            ),
            runtime_events(),
            observation,
            publication=publication,
            last_observation=last_observation,
        )
        if native_pending:
            return derived
        if requires_collection and derived.state == RunState.COMPLETED:
            if (
                collected is None
                or collected.result.runtime.status != OutcomeStatus.SUCCESS
            ):
                derived = replace(
                    derived,
                    state=RunState.TERMINAL_UNKNOWN,
                    confidence="unconfirmed",
                    reason="Independent runtime, batch and stage-out receipts are not fully successful",
                )
        if self.restart_errors.get(plan_id) == "RestartBindingUnavailable":
            return replace(
                derived,
                state=RunState.OBSERVATION_UNAVAILABLE,
                confidence="unconfirmed",
                reason="Native scheduler restart observed; validated startup binding unavailable",
            )
        if record.handle is not None and record.native_identity is not None:
            native_restart = json.loads(record.handle.raw_json).get("restart_count")
            if (
                type(native_restart) is int
                and record.native_identity.restart_count > native_restart
            ):
                return replace(
                    derived,
                    state=RunState.OBSERVATION_UNAVAILABLE,
                    confidence="unconfirmed",
                    reason="Verified newer native generation awaits a runtime binding",
                )
        if record.state == ExecutionState.REJECTED:
            return replace(
                derived,
                state=RunState.FAILED,
                confidence="confirmed",
                reason=record.detail,
            )
        error = self._runtime_errors.get(plan_id)
        if validation_error:
            error = validation_error[0]
        if (
            tracker is not None
            and tracker.attempt == record.attempt
            and tracker.result.status == NegotiationStatus.FAILED
        ):
            error = tracker.result.reason
        if error is not None:
            return replace(
                derived,
                state=RunState.FAILED,
                confidence="confirmed",
                reason=f"Runtime negotiation failed: {error}",
            )
        return derived

    def close(self) -> None:
        """Do not wait for uncooperative I/O or discard durable intent."""
        self._closed = True
        self._pool.shutdown(wait=False)

    def drain(self) -> None:
        """Finish admitted backend work before releasing dispatch/store ownership."""
        self._pool.shutdown(wait=True)
        self._harvest()
