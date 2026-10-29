"""The FastAPI shell preserves the daemon's HTTP boundary and client routing."""

from __future__ import annotations

import asyncio

import httpx
import pytest
from fastapi import APIRouter, FastAPI
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict
from starlette.requests import Request  # noqa: TC002 - FastAPI resolves it at runtime

from wavedl_daemon.http import app as http_app
from wavedl_daemon.http.app import create_app
from wavedl_daemon.storage.settings import Settings


TOKEN = "private-test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


class ProbeBody(BaseModel):
    model_config = ConfigDict(strict=True)

    n: int


@pytest.fixture
def app(tmp_path):
    settings = Settings(state_root=tmp_path / "state", run_root=tmp_path / "runs")
    return create_app(
        settings,
        token=TOKEN,
        daemon_id="daemon-test",
        build_id="build-test",
        web_assets=None,
    )


def request(app, method="GET", path="/api/health", *, content=None):
    async def run():
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://localhost:8420"
        ) as client:
            return await client.request(
                method,
                path,
                headers=AUTH | {"Content-Type": "application/json"},
                content=content,
            )

    return asyncio.run(run())


def test_create_app_is_fastapi(app):
    assert isinstance(app, FastAPI)


@pytest.mark.parametrize("path", ["/openapi.json", "/docs", "/redoc"])
def test_no_public_openapi_or_docs(app, path):
    response = request(app, path=path)
    if response.headers.get("content-type", "").startswith("application/json"):
        assert "openapi" not in response.json()
    assert "swagger-ui" not in response.text.lower()
    assert "redoc" not in response.text.lower()


def test_request_validation_error_is_bad_request(app):
    async def probe(body: ProbeBody):
        return {"n": body.n}

    app.router.routes.append(APIRoute("/api/probe", probe, methods=["POST"]))
    response = request(app, method="POST", path="/api/probe", content='{"n":"x"}')
    assert response.status_code == 400
    assert response.json() == {"error": "Bad request"}


def test_api_route_wins_over_client_catch_all(app):
    response = request(app)
    assert response.status_code == 200
    assert response.json() == {
        "daemon_id": "daemon-test",
        "build_id": "build-test",
        "protocol_min": 1,
        "protocol_max": 1,
    }
    assert response.headers["cache-control"] == "no-store"


def strict_probe(app, endpoint):
    router = APIRouter()
    router.add_api_route(
        "/api/probe",
        endpoint,
        methods=["POST"],
        route_class_override=http_app.strict_json_route(32),
    )
    app.router.routes.extend(router.routes)


@pytest.mark.parametrize(
    ("body", "content_type", "status"),
    [
        (b'{"n":1,"n":2}', "application/json", 400),
        (b'{"n":NaN}', "application/json", 400),
        (b'{"n":Infinity}', "application/json", 400),
        (b'{"n":1e999}', "application/json", 400),
        (b"[1]", "application/json", 400),
        (b'{"n":"\xff"}', "application/json", 400),
        (b'{"private-secret":', "application/json", 400),
        (b'{"n":"1"}', "application/json", 400),
        (b'{"n":1}' + b" " * 26, "application/json", 413),
        (b'{"n":1}', "text/plain", 415),
        (b'{"n":1}', "application/json", 200),
    ],
)
def test_strict_route_json_body(app, body, content_type, status):
    received = []

    async def probe(body: ProbeBody):
        received.append(body.n)
        return {"n": body.n}

    strict_probe(app, probe)

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://localhost:8420"
        ) as client:
            return await client.post(
                "/api/probe",
                headers=AUTH | {"Content-Type": content_type},
                content=body,
            )

    response = asyncio.run(run())
    assert response.status_code == status
    if status == 200:
        assert response.json() == {"n": 1}
        assert received == [1]  # The endpoint only consumes the Pydantic model.
    else:
        assert received == []
        assert response.json() == {
            "error": {
                400: "Bad request",
                413: "Request too large",
                415: "Expected JSON",
            }[status]
        }


async def call_probe(app, receive, *, content_type=b"application/json"):
    messages = []

    async def send(message):
        messages.append(message)

    await app(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/api/probe",
            "query_string": b"",
            "headers": [
                (b"host", b"localhost:8420"),
                (b"authorization", f"Bearer {TOKEN}".encode()),
                (b"content-type", content_type),
            ],
        },
        receive,
        send,
    )
    return messages


@pytest.mark.parametrize(
    ("mode", "status", "error"),
    [
        ("content-type", 415, "Expected JSON"),
        ("oversize", 413, "Request too large"),
        ("timeout", 408, "Request timeout"),
        ("disconnect", 408, "Request timeout"),
    ],
)
def test_strict_route_body_timeout_is_408(app, monkeypatch, mode, status, error):
    original = http_app.read_json_bytes

    async def short_read(incoming, *, max_bytes):
        return await original(incoming, max_bytes=max_bytes, timeout_seconds=0.001)

    monkeypatch.setattr(http_app, "read_json_bytes", short_read)

    async def probe(body: ProbeBody):
        pytest.fail("Invalid body reached endpoint")

    strict_probe(app, probe)
    calls = []

    async def receive():
        calls.append(True)
        if mode == "content-type":
            pytest.fail("Content type must be checked before receiving")
        if len(calls) == 1:
            return {
                "type": "http.request",
                "body": b"x" * 33 if mode == "oversize" else b'{"private-secret":',
                "more_body": True,
            }
        if mode == "disconnect":
            return {"type": "http.disconnect"}
        await asyncio.Event().wait()

    messages = asyncio.run(
        call_probe(
            app,
            receive,
            content_type=b"text/plain"
            if mode == "content-type"
            else b"application/json",
        )
    )
    assert messages[0]["status"] == status
    assert messages[1]["body"] == ('{"error":"' + error + '"}').encode()
    assert len(calls) == {"content-type": 0, "oversize": 1}.get(mode, 2)


def test_strict_route_replays_body_once_then_delegates_disconnect(app):
    received = []

    async def probe(incoming: Request):
        received.append(await incoming.receive())
        received.append(await incoming.receive())
        return {"ok": True}

    strict_probe(app, probe)
    messages = iter(
        [
            {"type": "http.request", "body": b'{"n":', "more_body": True},
            {"type": "http.request", "body": b"1}", "more_body": False},
            {"type": "http.disconnect"},
        ]
    )

    async def receive():
        return next(messages)

    response = asyncio.run(call_probe(app, receive))
    assert response[0]["status"] == 200
    assert received == [
        {"type": "http.request", "body": b'{"n":1}', "more_body": False},
        {"type": "http.disconnect"},
    ]
