"""Bounded cooperative threads; hard deadlines belong in supervised processes.

A deadline requests cancellation. A callback must check its token during work.
No Python thread can be forcibly stopped: admission remains occupied until the
callback actually returns, including when it ignores cancellation. A timeout on
result() only bounds that caller's wait, and does not cancel any work.
"""

from __future__ import annotations

import asyncio
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from typing import TYPE_CHECKING, Generic, TypeVar

from .budget import BudgetExhausted, StorageWorkError, WorkBudget


if TYPE_CHECKING:
    from collections.abc import Callable

T = TypeVar("T")


class WorkCancelled(RuntimeError):
    """Cooperative work acknowledged a cancellation request."""


class WorkDeadlineExceeded(WorkCancelled):
    """Cooperative work acknowledged its deadline."""


class CancellationToken:
    def __init__(self, deadline: float) -> None:
        self.deadline = deadline
        self._event = threading.Event()

    @property
    def cancelled(self) -> bool:
        return self._event.is_set() or time.monotonic() >= self.deadline

    @property
    def cancellation_requested(self) -> bool:
        """Explicit cancellation, distinct from expiry of the deadline."""
        return self._event.is_set()

    def cancel(self) -> None:
        """Request cancellation; this is not an acknowledgement of termination."""
        self._event.set()

    def check(self) -> None:
        if time.monotonic() >= self.deadline:
            raise WorkDeadlineExceeded("work deadline exceeded")
        if self._event.is_set():
            raise WorkCancelled("work cancellation requested")

    def wait(self, timeout: float | None = None) -> bool:
        """Wait interruptibly, waking at cancellation or the deadline."""
        remaining = max(0.0, self.deadline - time.monotonic())
        self._event.wait(remaining if timeout is None else min(timeout, remaining))
        return self.cancelled


class WorkHandle(Generic[T]):
    def __init__(self, future: Future[T], token: CancellationToken) -> None:
        self._future = future
        self.token = token

    def cancel(self) -> None:
        self.token.cancel()

    def done(self) -> bool:
        return self._future.done()

    def result(self, timeout: float | None = None) -> T:
        return self._future.result(timeout)

    async def wait(self) -> T:
        """Await without blocking an event loop; caller cancellation signals work."""
        wrapped = asyncio.wrap_future(self._future)
        wrapped.add_done_callback(
            lambda done: None if done.cancelled() else done.exception()
        )
        try:
            return await asyncio.shield(wrapped)
        except asyncio.CancelledError:
            self.cancel()
            raise


class BoundedThreadPool:
    def __init__(self, budget: WorkBudget) -> None:
        self.budget = budget
        self._executor = ThreadPoolExecutor(max_workers=budget.max_workers)
        self._lock = threading.Lock()
        self._tokens: set[CancellationToken] = set()
        self._closed = False

    @property
    def outstanding(self) -> int:
        with self._lock:
            return len(self._tokens)

    def submit(self, callback: Callable[[CancellationToken], T]) -> WorkHandle[T]:
        """Admit at most max_workers + max_pending uncompleted operations."""
        token = CancellationToken(time.monotonic() + self.budget.timeout_seconds)
        with self._lock:
            if self._closed:
                raise RuntimeError("pool is closed")
            if len(self._tokens) >= self.budget.max_workers + self.budget.max_pending:
                raise BudgetExhausted("blocking worker capacity exhausted")
            self._tokens.add(token)
            try:
                future = self._executor.submit(self._run, callback, token)
            except BaseException:
                self._tokens.remove(token)
                raise
        return WorkHandle(future, token)

    def _run(
        self, callback: Callable[[CancellationToken], T], token: CancellationToken
    ) -> T:
        try:
            token.check()
            try:
                result = callback(token)
            except OSError as error:
                raise StorageWorkError(
                    "blocking operation failed; durability unknown"
                ) from error
            token.check()
            return result
        finally:
            with self._lock:
                self._tokens.remove(token)

    def shutdown(self, *, wait: bool = True) -> None:
        """Request cooperative shutdown; wait=True waits for real termination."""
        with self._lock:
            self._closed = True
            for token in self._tokens:
                token.cancel()
        self._executor.shutdown(wait=wait)

    def __enter__(self) -> BoundedThreadPool:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.shutdown()
