"""Native-read prefix barriers must withhold exact UTF-8 and CRLF suffixes."""

import asyncio
import importlib.util
import json
from pathlib import Path


def test_split_barriers_and_receipts_preserve_genuine_identity(tmp_path):
    path = Path(__file__).parents[1] / "tools/native_sse_split_fixture.py"
    spec = importlib.util.spec_from_file_location("native_split", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    event = {
        "run_id": "11111111-1111-4111-8111-111111111111",
        "attempt": 1,
        "type": "hello",
        "seq": 0,
        "timestamp": "2026-10-18T00:00:00Z",
        "payload": {"runtime": "real-source"},
    }
    raw = b"id: 1:0\nevent: runtime\ndata: " + json.dumps(event).encode() + b"\n\n"

    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200})
        for _ in range(3):
            await send(
                {
                    "type": "http.response.body",
                    "body": b": heartbeat\n\n",
                    "more_body": True,
                }
            )
        await send({"type": "http.response.body", "body": raw, "more_body": True})

    evidence = tmp_path / "evidence.json"
    release = tmp_path / "release"
    wrapped = module.split_observer(app, evidence, release)
    messages = []

    async def send(message):
        messages.append(message)

    async def exercise():
        scope = {
            "type": "http",
            "method": "GET",
            "path": f"/api/runs/{event['run_id']}/events",
            "headers": [
                (b"authorization", b"secret"),
                (b"x-wavedl-daemon-id", b"owned"),
            ],
            "query_string": b"attempt=0&seq=-1",
        }
        task = asyncio.create_task(wrapped(scope, None, send))
        for stage in (1, 2):
            async with asyncio.timeout(2):
                while (
                    not evidence.exists()
                    or json.loads(evidence.read_text())["records"][0].get("stage")
                    != stage
                ):
                    await asyncio.sleep(0.01)
            assert not task.done()
            bodies = [
                message["body"]
                for message in messages
                if message["type"] == "http.response.body"
            ]
            assert len(bodies) == stage
            assert bodies[-1][-1] == (195 if stage == 1 else 13)
            release.with_name(release.name + str(stage)).write_bytes(b"observed\n")
        await asyncio.wait_for(task, 2)

    asyncio.run(exercise())
    record = json.loads(evidence.read_text())["records"][0]
    assert record["paddingSize"] == len(module.PADDING) > 4096
    assert record["suppressedCommentCount"] == 3
    assert record["suppressedCommentBytes"] == 39
    assert record["sourceIds"] == [[1, 0]]
    assert record["releases"] == [1, 2]
    assert record["splitBytes"] == [[195, 179], [13, 10]]
    assert record["authenticated"] and record["scoped"]
    bodies = [
        message["body"]
        for message in messages
        if message["type"] == "http.response.body"
    ]
    frame = b"".join(bodies[:3])
    transformed = json.loads(
        next(line[6:] for line in frame.split(b"\r\n") if line.startswith(b"data: "))
    )
    assert transformed == {
        **event,
        "payload": {**event["payload"], "message": module.MARKER},
    }
    assert b"secret" not in evidence.read_bytes()
