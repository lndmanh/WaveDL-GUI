"""Bounded stream faults preserve real identities and do not duplicate bodies."""

import asyncio
import json
from uuid import uuid4

import pytest

from tools.stream_sparse_browser_fixture import MARKER, sparse_observer


def test_sparse_fixture_records_real_ids_and_split_unicode(tmp_path):
    run = str(uuid4())
    evidence = tmp_path / "evidence.json"
    release = tmp_path / "release"
    bodies = []

    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        for seq in range(5):
            event = {"run_id": run, "attempt": 1, "seq": seq, "payload": {}}
            frame = f"id: 1:{seq}\ndata: {json.dumps(event)}\n\n".encode()
            await send({"type": "http.response.body", "body": frame, "more_body": True})
        await send({"type": "http.response.body", "body": b"", "more_body": False})

    async def receive():
        return {"type": "http.disconnect"}

    async def send(message):
        if message["type"] == "http.response.body":
            bodies.append(message)

    wrapper = sparse_observer(app, evidence, release)
    scope = {
        "type": "http",
        "method": "GET",
        "path": f"/api/runs/{run}/events",
        "query_string": b"attempt=0&seq=-1",
    }
    asyncio.run(wrapper(scope, receive, send))
    record = json.loads(evidence.read_text())["records"][0]
    assert record["sourceIds"] == [[1, 0], [1, 1], [1, 2]]
    assert record["forwardedIds"] == [[1, 0], [1, 2]]
    assert record["omittedIds"] == [[1, 1]]
    assert record["nonAsciiBytes"] > 0
    assert record["markerCodepointSplits"] == 6
    assert all(len(message["body"]) == 1 for message in bodies[:-1])
    assert bodies[-1]["more_body"] is False
    wire = b"".join(message["body"] for message in bodies).decode("utf-8")
    assert MARKER in wire
    assert "id: 1:1\n" not in wire
    assert "id: 1:2\n" in wire
    assert wire.count("event: overflow") == 1
    bodies.clear()
    scope["query_string"] = b"attempt=1&seq=2"

    async def release_after_observation():
        task = asyncio.create_task(wrapper(scope, receive, send))
        await asyncio.sleep(0.06)
        assert bodies == []
        release.write_bytes(b"observed\n")
        await task

    asyncio.run(release_after_observation())
    record = json.loads(evidence.read_text())["records"][1]
    assert record["cursor"] == {"attempt": 1, "seq": 2}
    assert record["controlResume"] == {"attempt": 1, "seq": 1002}
    assert record["sourceIds"] == []
    assert record["forwardedIds"] == []
    assert record["controlFault"] == "ahead-uncommitted-cursor"
    assert record["markerCodepointSplits"] == 0
    assert len([message for message in bodies if not message["more_body"]]) == 1
    with pytest.raises(RuntimeError, match="request fault budget"):
        asyncio.run(wrapper(scope, receive, send))


def test_non_stream_body_is_forwarded_once(tmp_path):
    sent = []

    async def app(scope, receive, send):
        await send({"type": "http.response.body", "body": b"tail", "more_body": False})

    async def send(message):
        sent.append(message)

    asyncio.run(
        sparse_observer(app, tmp_path / "evidence")(
            {"type": "http", "method": "GET", "path": "/api/health"}, None, send
        )
    )
    assert len(sent) == 1
    assert sent[0]["body"] == b"tail"


@pytest.mark.parametrize("status", [200, 401])
def test_stream_tail_is_not_duplicated(tmp_path, status):
    sent = []

    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": status, "headers": []})
        await send({"type": "http.response.body", "body": b"tail", "more_body": False})

    async def send(message):
        if message["type"] == "http.response.body":
            sent.append(message)

    scope = {"type": "http", "method": "GET", "path": f"/api/runs/{uuid4()}/events"}
    asyncio.run(sparse_observer(app, tmp_path / "evidence")(scope, None, send))
    assert sent == [{"type": "http.response.body", "body": b"tail", "more_body": False}]
