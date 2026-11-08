"""The host profile probes accelerators in a child, never the daemon interpreter."""

import asyncio
import json
import sys
from pathlib import Path

import httpx
import pytest

from wavedl_daemon.execution.budget import WorkBudget
from wavedl_daemon.execution.pool import BoundedThreadPool
from wavedl_daemon.http.app import create_app
from wavedl_daemon.http.host import host_routes
from wavedl_daemon.runs import host_profile
from wavedl_daemon.runs.host_profile import HostProfiler, validate_accelerators
from wavedl_daemon.storage.settings import Settings


def test_actual_probe_reports_the_daemon_interpreter():
    with BoundedThreadPool(WorkBudget(timeout_seconds=60)) as pool:
        profiler = HostProfiler(sys.executable, Path.cwd(), pool, {"local": None})
        result = asyncio.run(profiler.profile())
    assert result["python"] == sys.executable
    assert result["backends"] == ["local"]
    assert result["cpu_count"] is None or result["cpu_count"] > 0
    assert result["accelerators"] is not None
    assert set(result["accelerators"]) == {"torch", "cuda", "mps"}


@pytest.mark.parametrize(
    "content",
    [
        b"",
        b"[]",
        b'{"torch": null, "cuda": [], "mps": 1}',
        b'{"torch": null, "cuda": [{"name": "x"}], "mps": false}',
        b'{"torch": null, "cuda": [], "mps": false, "extra": 1}',
        b'{"torch": 2, "cuda": [], "mps": false}',
        b'{"torch": null, "cuda": [{"name": "x", "memory_bytes": -1}], "mps": false}',
    ],
)
def test_probe_output_is_strict(content):
    assert validate_accelerators(content) is None


def test_probe_output_accepts_devices():
    content = json.dumps(
        {"torch": "2.5.1", "cuda": [{"name": "A100", "memory_bytes": 8}], "mps": False}
    ).encode()
    assert validate_accelerators(content)["cuda"][0]["name"] == "A100"


def test_failed_probe_is_unknown_and_retried(monkeypatch):
    calls = []

    def failing(spec, budget, *, token):
        calls.append(spec)
        raise OSError("cannot start")

    monkeypatch.setattr(host_profile, "run_command", failing)
    with BoundedThreadPool(WorkBudget(timeout_seconds=10)) as pool:
        profiler = HostProfiler(sys.executable, Path.cwd(), pool, ())
        first = asyncio.run(profiler.profile())
        asyncio.run(profiler.profile())
    assert first["accelerators"] is None
    assert len(calls) == 2


def test_concurrent_cold_requests_share_one_probe(monkeypatch):
    async def scenario(pool):
        profiler = HostProfiler(sys.executable, Path.cwd(), pool, ())
        started = asyncio.Event()
        release = asyncio.Event()
        calls = []

        async def probe():
            calls.append(True)
            started.set()
            await release.wait()
            return {"torch": None, "cuda": None, "mps": None}

        monkeypatch.setattr(profiler, "_accelerators", probe)
        requests = [asyncio.create_task(profiler.profile()) for _ in range(3)]
        await started.wait()
        release.set()
        results = await asyncio.gather(*requests)
        assert len(calls) == 1
        assert results[0] is results[1] is results[2]

    with BoundedThreadPool(WorkBudget(timeout_seconds=10)) as pool:
        asyncio.run(scenario(pool))


def test_cancelled_waiter_does_not_cancel_shared_probe(monkeypatch):
    async def scenario(pool):
        profiler = HostProfiler(sys.executable, Path.cwd(), pool, ())
        started = asyncio.Event()
        release = asyncio.Event()
        calls = []

        async def probe():
            calls.append(True)
            started.set()
            await release.wait()
            return {"torch": None, "cuda": None, "mps": None}

        monkeypatch.setattr(profiler, "_accelerators", probe)
        cancelled = asyncio.create_task(profiler.profile())
        survivor = asyncio.create_task(profiler.profile())
        await started.wait()
        cancelled.cancel()
        with pytest.raises(asyncio.CancelledError):
            await cancelled
        release.set()
        result = await survivor
        assert result["accelerators"] is not None
        assert await profiler.profile() is result
        assert len(calls) == 1

    with BoundedThreadPool(WorkBudget(timeout_seconds=10)) as pool:
        asyncio.run(scenario(pool))


def test_relative_interpreter_is_refused():
    with BoundedThreadPool(WorkBudget()) as pool, pytest.raises(ValueError):
        HostProfiler("python3", Path.cwd(), pool, ())


def test_http_requires_auth_and_rejects_queries(tmp_path):
    class Services:
        async def host_profile(self):
            return {
                "hostname": "test",
                "os": "test",
                "os_release": "test",
                "arch": "test",
                "cpu_count": None,
                "memory_bytes": None,
                "python": "/usr/bin/python3",
                "python_version": "3.11",
                "accelerators": None,
                "backends": [],
            }

    app = create_app(
        Settings(tmp_path / "state", tmp_path / "runs"),
        token="host-test-token",
        daemon_id="test",
        build_id="test",
    )
    app.router.routes.extend(host_routes(Services()))

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://localhost:8420"
        ) as client:
            assert (await client.get("/api/host")).status_code == 401
            client.headers["Authorization"] = "Bearer host-test-token"
            response = await client.get("/api/host")
            assert response.status_code == 200
            assert response.headers["cache-control"] == "no-store"
            assert response.json() == await Services().host_profile()
            assert (await client.get("/api/host?x=1")).status_code == 400

    asyncio.run(run())
