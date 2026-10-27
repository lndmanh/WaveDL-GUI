"""Pending native replacements keep old telemetry as history, never current UI."""

import asyncio
import json
import sys
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest


pytest.importorskip("PySide6")

from wavedl.core.protocol import Envelope
from wavedl_gui.common.constants.index import TrainingConfig
from wavedl_gui.service.daemon_contracts import (
    DaemonConnection,
    RequestSnapshot,
    RunRef,
)
from wavedl_gui.service.daemon_workers import DaemonOperationWorker, _Disconnected
from wavedl_gui.service.training_service import TrainingWorker


def reference():
    return RunRef(
        "daemon-a",
        str(uuid4()),
        str(uuid4()),
        str(uuid4()),
        1,
        "train",
        "/daemon/run",
        "/daemon/data.npz",
    )


def view(ref, *, pending=False, attempt=1, state="running"):
    return {
        "run_id": ref.run_id,
        "plan_id": ref.plan_id,
        "request_id": ref.request_id,
        "operation": ref.operation,
        "attempt": attempt,
        "state": state,
        "uncertainty": False,
        "submission_requested": True,
        "evidence": {
            "native_pending": pending,
            "current_runtime_attempt": None if pending else attempt,
            "last_runtime_attempt": attempt,
            "runtime": {} if pending else {"exit_seq": -1},
        },
    }


def metric(ref, seq, *, attempt=1, epoch=1, name="epoch"):
    return Envelope(
        ref.run_id,
        attempt,
        "metric",
        seq,
        "2026-10-05T00:00:00Z",
        {
            "name": name,
            "value": 0.5,
            "step": epoch,
            "metrics": {"epoch": epoch, "total_epochs": 5, "train_loss": 0.5},
        },
    )


def test_training_scope_reset_retains_history_and_proven_identity():
    ref = reference()
    worker = TrainingWorker(
        TrainingConfig(data_path=ref.data_path),
        connection=DaemonConnection(
            "http://localhost:8420", Path("/no-read"), sys.executable
        ),
        run_ref=ref,
    )
    worker._on_run_changed(ref)
    histories, progress, refs = [], [], []
    worker.historySig.connect(histories.append)
    worker.progressSig.connect(progress.append)
    worker.runChangedSig.connect(refs.append)
    worker._on_event(metric(ref, 0))
    assert progress[-1].epoch == 1

    bridge = worker._bridge
    bridge.metrics["mae"] = 0.1
    bridge._accept_view(view(ref, pending=True))
    assert worker.nativePending and bridge.nativePending
    assert worker.run_ref == ref and bridge.run_ref == ref and worker._attempt == 1
    assert refs == [] and bridge.metrics == {}
    assert progress[-1].epoch == 0 and histories[-1] == []
    old_history = worker._history
    count = len(progress)
    worker._on_event(metric(ref, 1, epoch=2))
    assert worker._history is old_history
    assert len(old_history.records) == 2
    assert len(progress) == count and histories[-1] == []

    bridge._accept_view(view(ref, attempt=2))
    assert not worker.nativePending and refs == [replace(ref, attempt=2)]
    worker._on_event(metric(ref, 0, attempt=2, epoch=3))
    assert progress[-1].epoch == 3 and histories[-1][-1].epoch == 3
    assert worker._history is old_history and len(old_history.records) == 3


def test_pending_native_failure_finishes_without_old_evaluation_or_new_submission():
    ref = reference()

    class Transport:
        def __init__(self):
            self.calls = []
            self.stage = 0

        async def request(self, method, path, **kwargs):
            self.calls.append((method, path))
            if path == "/api/health":
                return {
                    "daemon_id": ref.daemon_id,
                    "protocol_min": 1,
                    "protocol_max": 1,
                }
            return view(
                ref,
                pending=self.stage >= 1,
                state="failed" if self.stage >= 2 else "running",
            )

        async def events(self, run_id, *, cursor):
            yield metric(ref, 0, name="evaluation")
            assert worker.metrics["epoch"] == 1
            self.stage = 1
            while not worker.nativePending:
                await asyncio.sleep(0)
            assert worker.metrics == {}
            yield metric(ref, 1, epoch=2, name="evaluation")
            assert worker.metrics == {}
            self.stage = 2
            await asyncio.Event().wait()

    transport = Transport()
    worker = DaemonOperationWorker(
        SimpleNamespace(url="http://localhost:8420", read_credential=lambda: "token"),
        RequestSnapshot(json.dumps({"operation": "train", "config": {}})),
        run_ref=ref,
        transport_factory=lambda *args: transport,
        poll_interval=0.001,
        request_timeout=0.1,
        max_retries=0,
    )
    finished, events, refs, scopes = [], [], [], []
    worker.finishedSig.connect(lambda *args: finished.append(args))
    worker.eventSig.connect(events.append)
    worker.runChangedSig.connect(refs.append)
    worker.nativeScopeChangedSig.connect(scopes.append)
    key = worker.idempotency_key
    worker.run()
    assert finished == [(False, "Operation failed", {})]
    assert len(events) == 2 and worker.cursor == (1, 1)
    assert worker.nativePending and scopes == [True] and refs == []
    assert worker.run_ref == ref and worker.idempotency_key == key
    assert not any(method == "POST" for method, _ in transport.calls)


def test_pending_native_counter_advance_rearms_stop_without_new_runtime_ref():
    ref = reference()
    worker = DaemonOperationWorker(None, None, run_ref=ref)
    scopes, refs = [], []
    worker.nativeScopeChangedSig.connect(scopes.append)
    worker.runChangedSig.connect(refs.append)

    def pending(counter):
        value = view(ref, pending=True)
        value["evidence"]["native_identity"] = {
            "run_id": ref.run_id,
            "request_id": ref.request_id,
            "cluster": "cluster-a",
            "job_id": "123",
            "owner": "owner-a",
            "restart_count": counter,
        }
        return value

    worker._accept_view(pending(1))
    worker._cancel_acknowledged = True
    worker._accept_view(pending(2))
    assert not worker._cancel_acknowledged
    assert scopes == [True, True] and refs == [] and worker.run_ref == ref
    worker._cancel_acknowledged = True
    worker._accept_view(pending(2))
    assert worker._cancel_acknowledged and scopes == [True, True]
    bound = pending(2)
    bound["attempt"] = 2
    bound["evidence"]["native_pending"] = False
    worker._accept_view(bound)
    assert not worker._cancel_acknowledged and worker.run_ref.attempt == 2


@pytest.mark.parametrize("invalid", ["regression", "foreign", "scope", "malformed"])
def test_invalid_native_identity_never_mutates_proven_source(invalid):
    ref = reference()
    worker = DaemonOperationWorker(None, None, run_ref=ref)
    identity = {
        "run_id": ref.run_id,
        "request_id": ref.request_id,
        "cluster": "cluster-a",
        "job_id": "123",
        "owner": "owner-a",
        "restart_count": 2,
    }
    initial = view(ref, pending=True)
    initial["evidence"]["native_identity"] = identity
    worker._accept_view(initial)
    worker._cancel_acknowledged = True
    bad = view(ref, pending=True, attempt=2)
    bad["evidence"]["native_identity"] = dict(identity)
    if invalid == "regression":
        bad["evidence"]["native_identity"]["restart_count"] = 1
    elif invalid == "foreign":
        bad["evidence"]["native_identity"]["request_id"] = str(uuid4())
    elif invalid == "scope":
        bad["evidence"]["native_identity"]["owner"] = "owner-b"
    else:
        bad["evidence"] = []
    with pytest.raises(_Disconnected):
        worker._accept_view(bad)
    assert worker.run_ref == ref and worker._cancel_acknowledged
    assert worker._native_identity.restart_count == 2
