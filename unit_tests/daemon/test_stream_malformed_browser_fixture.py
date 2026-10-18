"""Malformed control is recorded without inventing event identities."""

import asyncio
import json
from uuid import uuid4

import pytest

from tools.stream_malformed_browser_fixture import malformed_observer


@pytest.mark.parametrize("invalid_utf8", [False, True])
def test_malformed_control_is_explicit_and_does_not_add_events(tmp_path, invalid_utf8):
    run = str(uuid4())
    evidence = tmp_path / "evidence.json"
    release = tmp_path / "release"
    bodies = []

    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        for seq in range(3):
            event = {"run_id": run, "attempt": 1, "seq": seq, "payload": {}}
            frame = f"id: 1:{seq}\ndata: {json.dumps(event)}\n\n".encode()
            await send({"type": "http.response.body", "body": frame, "more_body": True})
        await send({"type": "http.response.body", "body": b"", "more_body": False})

    async def send(message):
        if message["type"] == "http.response.body":
            bodies.append(message)

    scope = {
        "type": "http",
        "method": "GET",
        "path": f"/api/runs/{run}/events",
        "query_string": b"attempt=0&seq=-1",
    }
    wrapper = malformed_observer(app, evidence, release, invalid_utf8=invalid_utf8)
    asyncio.run(wrapper(scope, None, send))
    release.write_bytes(b"observed\n")
    scope["query_string"] = b"attempt=1&seq=2"
    second_response = len(bodies)
    asyncio.run(wrapper(scope, None, send))
    records = json.loads(evidence.read_text())["records"]
    assert records[1]["controlFault"] == (
        "invalid-utf8-control" if invalid_utf8 else "malformed-json-truncated-object"
    )
    assert records[1]["sourceIds"] == []
    assert records[1]["forwardedIds"] == []
    assert records[1]["controlResume"] == {"attempt": 1, "seq": 1002}
    emitted = b"".join(body["body"] for body in bodies[second_response:])
    assert records[1]["splitBytes"] == len(emitted)
    assert records[1]["nonAsciiBytes"] == sum(byte >= 128 for byte in emitted)
    if invalid_utf8:
        wire = bytes.fromhex(records[1]["wireHex"])
        assert records[1]["controlWire"] is None
        assert bytes((0xC3, 0x28)) in wire
        assert wire in b"".join(body["body"] for body in bodies)
        with pytest.raises(UnicodeDecodeError):
            wire.decode("utf-8", errors="strict")
        parsed = json.loads(wire.decode("utf-8", errors="replace").split("data: ")[1])
        assert parsed["resumePosition"] == {"attempt": 1, "seq": 1002}
    else:
        assert records[1]["controlWire"].count("{") == 2
        assert records[1]["controlWire"].count("}") == 1
    with pytest.raises(RuntimeError, match="request fault budget"):
        asyncio.run(wrapper(scope, None, send))
    assert json.loads(evidence.read_text())["rejectedRequests"] == 1
