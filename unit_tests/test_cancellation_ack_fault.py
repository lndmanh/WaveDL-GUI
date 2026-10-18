"""ASGI boundary tests only; not a substitute for the real browser gate."""

import asyncio
import json

from tools.browser_daemon_fixture import cancellation_ack_fault


def test_only_one_successful_committed_cancel_ack_is_suppressed(tmp_path):
    path = tmp_path / "wire.jsonl"
    committed = []

    async def application(scope, receive, send):
        # The real acceptance uses the public handler. This unit sentinel checks
        # wrapper ordering and transparent unsuccessful/read/repeated responses.
        committed.append(scope["path"])
        status = 403 if scope.get("reject") else 202
        await send({"type": "http.response.start", "status": status, "headers": []})
        await send({"type": "http.response.body", "body": b'{"committed":true}'})

    wrapped = cancellation_ack_fault(application, path)
    run = "/api/runs/12345678-1234-4234-8234-123456789012"

    async def exercise():
        responses = []
        for method, suffix, reject in [
            ("POST", "/cancel", True),
            ("GET", "", False),
            ("POST", "/cancel", False),
            ("POST", "/cancel", False),
        ]:
            messages = []

            async def send(message, messages=messages):
                assert committed
                messages.append(message)

            await wrapped(
                {
                    "type": "http",
                    "method": method,
                    "path": run + suffix,
                    "reject": reject,
                    "headers": [(b"authorization", b"Bearer secret")],
                },
                None,
                send,
            )
            responses.append(messages)
        return responses

    responses = asyncio.run(exercise())
    assert [messages[0]["status"] for messages in responses] == [403, 202, 503, 202]
    assert responses[2][1]["body"] == b""
    assert responses[3][1]["body"] == b'{"committed":true}'
    records = [json.loads(line) for line in path.read_text().splitlines()]
    assert [row["sequence"] for row in records] == [1, 2, 3, 4]
    assert records[2]["originalStatus"] == 202
    assert records[2]["deliveredStatus"] == 503
    assert records[2]["rawBody"] == '{"committed":true}'
    assert "secret" not in path.read_text()
