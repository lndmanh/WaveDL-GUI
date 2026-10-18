"""Focused contracts for the genuine broker-overflow fixture."""

import asyncio
import json
import sqlite3
import threading
from types import SimpleNamespace

from tools.genuine_broker_overflow_browser_fixture import (
    OverflowProofBroker,
    controlled_ingestor,
    overflow_boundary,
)
from wavedl.core.protocol import Envelope
from wavedl_daemon.events.ingestion import Ingestor
from wavedl_daemon.events.streaming import stream_events


def test_proof_broker_records_real_queue_full_without_injection():
    async def scenario():
        broker = OverflowProofBroker()
        subscription = broker.subscribe("run")
        broker.notify("run")
        await asyncio.sleep(0)
        broker.notify("run")
        await asyncio.sleep(0)
        assert broker.overflow_proof is not None
        assert broker.overflow_proof["capacity"] == 1
        assert broker.overflow_proof["fullBefore"] is True
        assert broker.overflow_proof["closedAfter"] is True
        assert broker.overflow_proof["overflowedAfter"] is True
        assert subscription not in broker._subscribers

    asyncio.run(scenario())


def test_reconnect_subscription_has_bounded_nonfault_capacity():
    async def scenario():
        broker = OverflowProofBroker()
        first = broker.subscribe("run")
        broker.unsubscribe(first)
        reconnect = broker.subscribe("run")
        assert reconnect.queue.maxsize == 4096
        broker.unsubscribe(reconnect)

    asyncio.run(scenario())


def test_gate_forwards_original_frames_and_real_production_overflow(tmp_path):
    (tmp_path / "state").mkdir()
    with sqlite3.connect(tmp_path / "state/registry.db") as db:
        db.execute("CREATE TABLE cursors(run_id TEXT,attempt INTEGER,seq INTEGER)")
        db.execute(
            "INSERT INTO cursors VALUES('00000000-0000-4000-8000-000000000001',1,0)"
        )
    run_id = "00000000-0000-4000-8000-000000000001"
    event = Envelope(
        run_id,
        1,
        "log",
        0,
        "2026-10-15T00:00:00Z",
        {"message": "real frame", "level": "info", "stream": "stdout"},
    )
    released = threading.Event()
    broker = OverflowProofBroker()
    store = SimpleNamespace(read_after=lambda *args, **kwargs: [])
    original_messages, forwarded_messages = [], []

    async def app(scope, receive, send):
        start = {"type": "http.response.start", "status": 200}
        original_messages.append(start)
        await send(start)
        async for frame in stream_events(store, broker, run_id, initial_page=[event]):
            message = {"type": "http.response.body", "body": frame, "more_body": True}
            original_messages.append(message)
            await send(message)

    async def scenario():
        boundary = overflow_boundary(
            app,
            SimpleNamespace(broker=broker),
            tmp_path,
            tmp_path / "proof.json",
            released,
        )

        async def produce():
            while not released.is_set():
                await asyncio.sleep(0)
            broker.notify(run_id)
            broker.notify(run_id)

        async def send(message):
            forwarded_messages.append(message)

        await asyncio.gather(
            boundary(
                {
                    "method": "GET",
                    "path": f"/api/runs/{run_id}/events",
                    "query_string": b"attempt=0&seq=-1",
                },
                None,
                send,
            ),
            produce(),
        )

    asyncio.run(scenario())
    assert all(
        a is b for a, b in zip(original_messages, forwarded_messages, strict=True)
    )
    assert (
        b'event: overflow\ndata: {"resumePosition":{"attempt":1,"seq":0}}'
        in forwarded_messages[-1]["body"]
    )
    proof = json.loads((tmp_path / "proof.json").read_text())
    assert proof["queueFull"]["fullBefore"] is True
    assert proof["records"][0]["forwardedIds"] == [[1, 0]]
    assert proof["records"][0]["overflowResume"] == {"attempt": 1, "seq": 0}


def test_ingestion_gate_preserves_order_without_fabricating_records(
    tmp_path, monkeypatch
):
    released = threading.Event()
    calls = []
    cursors = {(1): -1, (2): -1}

    async def poll(self, plan_id, run_id, attempt, path, **kwargs):
        calls.append(attempt)
        cursors[attempt] += 1
        return cursors[attempt]

    monkeypatch.setattr(Ingestor, "poll_once", poll)
    registry = SimpleNamespace(cursor=lambda run_id, attempt: cursors[attempt])
    ingestor = controlled_ingestor(released)(registry, None, None, None)
    (tmp_path / "1").mkdir()
    (tmp_path / "1/events.jsonl").write_text('{"seq":1}\n')
    path = tmp_path / "2/events.jsonl"

    async def scenario():
        await ingestor.poll_once("plan", "run", 2, path)
        await ingestor.poll_once("plan", "run", 1, tmp_path / "1/events.jsonl")
        await ingestor.poll_once("plan", "run", 1, tmp_path / "1/events.jsonl")
        assert calls == [1]
        released.set()
        await ingestor.poll_once("plan", "run", 2, path)
        assert calls == [1]
        await ingestor.poll_once("plan", "run", 1, tmp_path / "1/events.jsonl")
        await ingestor.poll_once("plan", "run", 2, path)
        assert calls == [1, 1, 2]

    asyncio.run(scenario())
