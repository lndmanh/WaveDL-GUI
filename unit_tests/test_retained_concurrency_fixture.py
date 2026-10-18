"""HTTP fixture checks, not a substitute for native-browser acceptance."""

from __future__ import annotations

import asyncio
import hashlib
import json
import signal
import subprocess
import sys
from pathlib import Path

import httpx
import pytest

from tools.retained_concurrency_fixture import MAX_TRACE, Fixture, ordinary_bytes


@pytest.fixture
def source(tmp_path):
    tmp_path = tmp_path.resolve()
    root = tmp_path / "task"
    root.mkdir()
    token = tmp_path / "private-token"
    token.write_text("fixture-private-token")
    token.chmod(0o600)
    builds = []
    for namespace in ("g1", "g2", "g3", "g4"):
        directory = root / namespace
        (directory / "_nuxt" / namespace).mkdir(parents=True)
        raw = f"console.log('{namespace}')".encode()
        worker = f"// unchanged compiled worker {namespace}".encode()
        (directory / "sw.js").write_bytes(worker)
        (directory / "index.html").write_bytes(raw)
        (directory / "_nuxt" / namespace / "entry.js").write_bytes(raw)
        inventory = {
            "generation": namespace,
            "build_key": namespace,
            "assets": [
                {
                    "url": "/",
                    "sha256": hashlib.sha256(raw).hexdigest(),
                    "size": len(raw),
                },
                {
                    "url": f"/_nuxt/{namespace}/entry.js",
                    "sha256": hashlib.sha256(raw).hexdigest(),
                    "size": len(raw),
                },
            ],
        }
        metadata = json.dumps(inventory).encode()
        (directory / "offline-build.json").write_bytes(metadata)
        builds.append(
            {
                "namespace": namespace,
                "assetsDir": str(directory),
                "generation": namespace,
                "buildKey": namespace,
                "offlineInventorySha256": hashlib.sha256(metadata).hexdigest(),
                "workerSha256": hashlib.sha256(worker).hexdigest(),
            }
        )
    summary = root / "summary.json"
    summary.write_text(json.dumps({"status": "passed", "builds": builds}))
    return summary, root, token


def fixture(source):
    obj = Fixture(*source)
    obj.origin = "http://127.0.0.1:48001"
    return obj


def test_exact_scripts_and_namespace_routing(source):
    obj = fixture(source)

    async def check():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=obj.app()), base_url=obj.origin
        ) as client:
            for namespace in ("g1", "g2", "g3"):
                path = "/sw.js" if namespace == "g1" else f"/qa/{namespace}/sw.js"
                response = await client.get(path)
                assert response.content == obj.workers[namespace]
                if namespace in ("g2", "g3"):
                    assert response.headers["referrer-policy"] == "same-origin"
                else:
                    assert "referrer-policy" not in response.headers
            response = await client.get("/_nuxt/g3/entry.js")
            assert response.content == obj.assets["g3"]["/_nuxt/g3/entry.js"][0]
            assert response.headers["content-type"].startswith("text/javascript")
            for namespace in ("g2", "g3"):
                response = await client.get(
                    "/offline-build.json",
                    headers={"referer": f"{obj.origin}/qa/{namespace}/sw.js"},
                )
                assert response.content == obj.inventories[namespace]
            response = await client.get(
                "/offline-build.json",
                headers={"referer": "http://evil.test/qa/g3/sw.js"},
            )
            assert response.content == obj.inventories["g1"]
            for role in ("g4a", "g4b"):
                response = await client.get(f"/qa/{role}/sw.js")
                assert response.status_code == 200
                assert response.content == obj.workers["g4"]
                assert response.headers["referrer-policy"] == "same-origin"
                inventory = await client.get(
                    "/offline-build.json",
                    headers={"referer": f"{obj.origin}/qa/{role}/sw.js"},
                )
                assert inventory.content == obj.inventories["g4"]
            assert (await client.get("/qa/g4/sw.js")).status_code == 404
            assert (await client.get("/summary.json")).status_code == 404

    asyncio.run(check())


def test_two_candidates_hold_until_authenticated_release(source):
    obj = fixture(source)

    async def check():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=obj.app()), base_url=obj.origin
        ) as client:
            for ns in ("g2", "g3"):
                await client.get(
                    "/offline-build.json",
                    headers={"referer": f"{obj.origin}/qa/{ns}/sw.js"},
                )
            tasks = [
                asyncio.create_task(
                    client.get("/", headers={"referer": f"{obj.origin}/qa/{ns}/sw.js"})
                )
                for ns in ("g2", "g3")
            ]
            await asyncio.wait_for(obj.barrier.wait(), 2)
            status = (await client.get("/qa/status")).json()
            assert status["barrierArrived"] == ["g2", "g3"]
            assert status["inventorySeen"] == ["g2", "g3"]
            assert all(not task.done() for task in tasks)
            assert (
                len(
                    [t for t in status["trace"] if t["barrier"] and t["endISO"] is None]
                )
                == 2
            )
            assert "fixture-private-token" not in json.dumps(status)
            assert (
                await client.post("/qa/release", headers={"origin": obj.origin})
            ).status_code == 403
            response = await client.post(
                "/qa/release",
                headers={"origin": obj.origin, "authorization": f"Bearer {obj.token}"},
            )
            assert response.status_code == 200
            assert all(r.status_code == 200 for r in await asyncio.gather(*tasks))
            assert all(
                t["endISO"] and t["status"] == 200 for t in obj.trace if t["barrier"]
            )

    asyncio.run(check())


def test_loopback_host_origin_and_early_release_rejected(source):
    obj = fixture(source)

    async def check():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=obj.app()), base_url=obj.origin
        ) as client:
            assert (
                await client.get("/", headers={"host": "evil.test"})
            ).status_code == 403
            assert (
                await client.get("/", headers={"origin": "http://evil.test"})
            ).status_code == 403
            assert (
                await client.post(
                    "/qa/release",
                    headers={
                        "origin": obj.origin,
                        "authorization": f"Bearer {obj.token}",
                    },
                )
            ).status_code == 409

    asyncio.run(check())


def test_file_security_and_digest_validation(source):
    summary, root, token = source
    token.chmod(0o644)
    with pytest.raises(ValueError, match="mode 600"):
        Fixture(*source)
    token.chmod(0o600)
    (root / "g2" / "sw.js").write_bytes(b"changed")
    with pytest.raises(ValueError, match="digest mismatch"):
        Fixture(*source)
    link = root / "link"
    link.symlink_to(token)
    with pytest.raises(ValueError, match="symlink"):
        ordinary_bytes(link, 512)
    with pytest.raises(ValueError, match="bounded"):
        ordinary_bytes(summary, 1)


def test_shutdown_releases_held_handlers_and_trace_is_bounded(source):
    obj = fixture(source)

    async def check():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=obj.app()), base_url=obj.origin
        ) as client:
            await client.get(
                "/offline-build.json", headers={"referer": f"{obj.origin}/qa/g2/sw.js"}
            )
            task = asyncio.create_task(
                client.get("/", headers={"referer": f"{obj.origin}/qa/g2/sw.js"})
            )
            for _ in range(100):
                if obj.arrived:
                    break
                await asyncio.sleep(0)
            assert obj.arrived == {"g2"}
            obj.shutting_down = True
            obj.release.set()
            assert (await asyncio.wait_for(task, 2)).status_code == 503
            obj.trace_bytes = MAX_TRACE
            before = len(obj.trace)
            await obj._record({"safe": "bounded"})
            assert len(obj.trace) == before and obj.trace_dropped == 1

    asyncio.run(check())


def test_real_server_ready_and_sigint_servicesclose(source):
    summary, root, token = source
    process = subprocess.Popen(
        [
            sys.executable,
            str(Path(__file__).parents[1] / "tools/retained_concurrency_fixture.py"),
            "--fixtures",
            str(summary),
            "--root",
            str(root),
            "--token-file",
            str(token),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        ready = json.loads(process.stdout.readline())
        assert set(ready) == {"origin"}
        response = httpx.get(ready["origin"] + "/sw.js", timeout=3)
        assert response.status_code == 200
        assert response.content == b"// unchanged compiled worker g1"
        process.send_signal(signal.SIGINT)
        stdout, stderr = process.communicate(timeout=5)
        assert process.returncode == 0, stderr
        assert stdout.strip() == "servicesclose"
        assert "fixture-private-token" not in stdout + stderr
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=5)
