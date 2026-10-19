import asyncio
import errno
import threading

import pytest

from wavedl_daemon.execution import (
    BoundedThreadPool,
    BudgetExhausted,
    StorageWorkError,
    WorkBudget,
    WorkCancelled,
    WorkDeadlineExceeded,
)
from wavedl_daemon.execution.pool import CancellationToken


@pytest.mark.parametrize("timeout,expected", [(None, True), (0.25, False)])
def test_token_wait_rechecks_early_native_timeout(monkeypatch, timeout, expected):
    clock = [0.0]
    waits = []
    monkeypatch.setattr("wavedl_daemon.execution.pool.time.monotonic", lambda: clock[0])
    token = CancellationToken(1.0)

    class EarlyTimeout:
        def is_set(self):
            return False

        def wait(self, remaining):
            waits.append(remaining)
            clock[0] += remaining / 2 if len(waits) == 1 else remaining
            return False

    token._event = EarlyTimeout()
    assert token.wait(timeout) is expected
    assert len(waits) == 2
    assert clock[0] == (1.0 if timeout is None else timeout)


def test_exhaustion_and_cancel_does_not_release_running_slot():
    started = threading.Event()
    release = threading.Event()
    with BoundedThreadPool(WorkBudget(max_workers=1, max_pending=1)) as pool:

        def blocked(token):
            started.set()
            release.wait(2)

        first = pool.submit(blocked)
        assert started.wait(1)
        second = pool.submit(lambda token: 42)
        try:
            first.cancel()
            second.cancel()
            with pytest.raises(BudgetExhausted):
                pool.submit(lambda token: 0)
            assert pool.outstanding == 2
            assert not first.done()
        finally:
            release.set()
        with pytest.raises(WorkCancelled):
            first.result(2)
        with pytest.raises(WorkCancelled):
            second.result(2)
        assert pool.outstanding == 0
        assert pool.submit(lambda token: 7).result(1) == 7


def test_deadline_observed_by_callback():
    observed = threading.Event()
    with BoundedThreadPool(WorkBudget(timeout_seconds=0.04)) as pool:

        def cooperate(token):
            token.wait()
            observed.set()
            token.check()

        handle = pool.submit(cooperate)
        with pytest.raises(WorkDeadlineExceeded):
            handle.result(1)
        assert observed.is_set()
        assert pool.outstanding == 0


def test_wait_timeout_is_not_cancellation():
    release = threading.Event()
    with BoundedThreadPool(WorkBudget(max_workers=1, max_pending=0)) as pool:
        handle = pool.submit(lambda token: release.wait(2))
        try:
            with pytest.raises(TimeoutError):
                handle.result(0.01)
            assert not handle.token.cancelled
            assert pool.outstanding == 1
        finally:
            release.set()
        assert handle.result(1)


def test_task_exceptions_and_storage_failure_are_explicit():
    with BoundedThreadPool(WorkBudget(max_workers=1)) as pool:

        def fail(token):
            raise ValueError("invalid")

        with pytest.raises(ValueError, match="invalid"):
            pool.submit(fail).result(1)

        def disk_full(token):
            raise OSError(errno.ENOSPC, "disk full")

        with pytest.raises(StorageWorkError) as captured:
            pool.submit(disk_full).result(1)
        assert captured.value.__cause__.errno == errno.ENOSPC
        assert pool.outstanding == 0


def test_async_handle_does_not_block_event_loop():
    async def exercise():
        with BoundedThreadPool(WorkBudget()) as pool:
            handle = pool.submit(lambda token: 42)
            assert await handle.wait() == 42

    asyncio.run(exercise())


def test_shutdown_refuses_new_admission():
    pool = BoundedThreadPool(WorkBudget())
    pool.shutdown()
    with pytest.raises(RuntimeError, match="closed"):
        pool.submit(lambda token: 0)


def test_noncooperative_deadline_keeps_slot_until_callback_stops():
    release = threading.Event()
    with BoundedThreadPool(
        WorkBudget(max_workers=1, max_pending=0, timeout_seconds=0.02)
    ) as pool:
        handle = pool.submit(lambda token: release.wait(2))
        try:
            assert handle.token.wait(1)
            assert not handle.done()
            with pytest.raises(BudgetExhausted):
                pool.submit(lambda token: 0)
        finally:
            release.set()
        with pytest.raises(WorkDeadlineExceeded):
            handle.result(1)


def test_async_cancel_requests_cooperative_stop():
    started = threading.Event()
    stopped = threading.Event()

    def cooperate(token):
        started.set()
        token.wait()
        stopped.set()
        token.check()

    async def exercise():
        with BoundedThreadPool(WorkBudget()) as pool:
            handle = pool.submit(cooperate)
            assert started.wait(1)
            waiter = asyncio.create_task(handle.wait())
            await asyncio.sleep(0)
            waiter.cancel()
            with pytest.raises(asyncio.CancelledError):
                await waiter
            assert stopped.wait(1)
            with pytest.raises(WorkCancelled):
                handle.result(1)

    asyncio.run(exercise())
