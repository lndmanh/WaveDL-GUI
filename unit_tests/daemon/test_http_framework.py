"""The FastAPI shell preserves the daemon's HTTP boundary and client routing."""

from __future__ import annotations

import asyncio

import httpx
import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict

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
