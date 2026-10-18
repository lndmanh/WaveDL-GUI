"""Fixture boundary must not fault rejected requests or skip the real handler."""

import asyncio
import json

from tools.browser_auth_skew_fixture import response_boundary_fault


def test_boundary_401_requires_explicit_arm_after_real_health_calls(tmp_path):
    calls = []

    async def real(scope, receive, send):
        calls.append(scope)
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b'{"build_id":"real"}'})

    control = tmp_path / "control"
    app = response_boundary_fault(real, control)

    async def exercise():
        messages = []

        async def send(message):
            messages.append(message)

        scope = {
            "type": "http",
            "method": "GET",
            "path": "/api/health",
            "headers": [(b"authorization", b"Bearer test")],
        }
        await app(scope, None, send)
        await app(scope, None, send)
        control.write_text("401", encoding="ascii")
        await app(scope, None, send)
        await app(scope, None, send)
        return messages

    messages = asyncio.run(exercise())
    assert len(calls) == 4
    assert [m["status"] for m in messages if "status" in m] == [200, 200, 401, 200]
    assert [m["body"] for m in messages if "body" in m] == [
        b'{"build_id":"real"}',
        b'{"build_id":"real"}',
        b"",
        b'{"build_id":"real"}',
    ]


def test_skew_fault_preserves_daemon_identity_and_real_handler(tmp_path):
    control = tmp_path / "control"
    control.write_text("protocol", encoding="ascii")
    calls = []

    async def real(scope, receive, send):
        calls.append(scope)
        body = json.dumps(
            {
                "daemon_id": "same",
                "build_id": "real",
                "protocol_min": 1,
                "protocol_max": 1,
            }
        ).encode()
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": body})

    app = response_boundary_fault(real, control)

    async def exercise():
        messages = []

        async def send(message):
            messages.append(message)

        await app(
            {
                "type": "http",
                "method": "GET",
                "path": "/api/health",
                "headers": [(b"authorization", b"Bearer test")],
            },
            None,
            send,
        )
        return messages

    messages = asyncio.run(exercise())
    health = json.loads(messages[1]["body"])
    assert len(calls) == 1
    assert health == {
        "daemon_id": "same",
        "build_id": "real",
        "protocol_min": 2,
        "protocol_max": 2,
    }
    assert not control.exists()
