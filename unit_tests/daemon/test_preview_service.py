"""
Supervised polling jobs, root authority and authenticated HTTP contracts.
Author: Ngo Duc Manh Le (manh@nnsvn.me)
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import pytest
from starlette.testclient import TestClient

from unit_tests.daemon.conftest import route_app
from wavedl_daemon.execution.budget import BudgetExhausted, WorkBudget
from wavedl_daemon.execution.pool import BoundedThreadPool
from wavedl_daemon.http.app import create_app
from wavedl_daemon.http.preview import preview_routes
from wavedl_daemon.runs.catalog import CatalogService
from wavedl_daemon.runs.dataset_preview import (
    PickleRequired,
    PreviewRefused,
    preview_dataset,
)
from wavedl_daemon.runs.preview_service import DatasetPreviewService
from wavedl_daemon.runs.runtime_service import HostedServices
from wavedl_daemon.storage.settings import Settings
from wavedl_daemon.supervision.base import ProcessResult


def request(path="data.npz", allow_pickle=False):
    return {"root": "data", "path": path, "allow_pickle": allow_pickle}


def write_dataset(path):
    np.savez(
        path, inputs=np.arange(24).reshape(6, 4), outputs=np.arange(12).reshape(6, 2)
    )


def make_service(tmp_path, pool, **options):
    return DatasetPreviewService(
        sys.executable, Path.cwd(), pool, CatalogService({"data": tmp_path}), **options
    )


def test_real_worker_and_per_call_deadline(tmp_path, monkeypatch):
    write_dataset(tmp_path / "data.npz")
    import wavedl_daemon.runs.preview_service as module

    original = module.run_command
    observed = []

    def run(spec, budget, *, token):
        observed.append((spec, budget, token))
        return original(spec, budget, token=token)

    monkeypatch.setattr(module, "run_command", run)
    with BoundedThreadPool(WorkBudget(timeout_seconds=0.05)) as pool:
        service = make_service(tmp_path, pool)
        value = asyncio.run(service.preview(request()))
        assert value["selection"] == {"root": "data", "path": "data.npz"}
        assert value["input_shape"] == [6, 4]
        assert value["scatter"]["y"] == [0, 2, 4, 6, 8, 10]
    spec, budget, token = observed[0]
    assert "wavedl_daemon.runs.dataset_preview_worker" in spec.argv
    assert budget.timeout_seconds == 600
    assert token.deadline > time.monotonic() + 590
    assert not {"identity", "fingerprint", "view", "limits"} & value.keys()


def test_polling_deduplicates_jobs_and_caches_only_success(tmp_path):
    write_dataset(tmp_path / "data.npz")
    value = preview_dataset(tmp_path / "data.npz")
    with BoundedThreadPool(WorkBudget()) as pool:
        service = make_service(tmp_path, pool, wait_seconds=0.001)

        async def run():
            gate = asyncio.Event()
            calls = []

            async def compute(path, allow_pickle):
                calls.append((path, allow_pickle))
                await gate.wait()
                return value

            service._run = compute
            assert await service.preview(request()) == {"status": "pending"}
            assert await service.preview(request()) == {"status": "pending"}
            assert len(calls) == 1
            gate.set()
            assert (await service.preview(request()))["input_shape"] == [6, 4]
            assert (await service.preview(request()))["input_shape"] == [6, 4]
            assert len(calls) == 1
            await service.close()

        asyncio.run(run())


def test_failures_retry_and_allow_pickle_is_a_separate_cache_key(tmp_path):
    write_dataset(tmp_path / "data.npz")
    with BoundedThreadPool(WorkBudget()) as pool:
        service = make_service(tmp_path, pool)

        async def run():
            calls = []

            async def compute(path, allow_pickle):
                calls.append(allow_pickle)
                if not allow_pickle:
                    raise PickleRequired("Dataset contains pickled arrays")
                return {"ok": True}

            service._run = compute
            for _ in range(2):
                with pytest.raises(PickleRequired):
                    await service.preview(request())
            assert (await service.preview(request(allow_pickle=True)))["ok"]
            assert (await service.preview(request(allow_pickle=True)))["ok"]
            assert calls == [False, False, True]
            await service.close()

        asyncio.run(run())


@pytest.mark.parametrize(
    "error_type", [PickleRequired, PreviewRefused, BudgetExhausted]
)
def test_failure_between_polls_is_reported_once_then_retried(tmp_path, error_type):
    write_dataset(tmp_path / "data.npz")
    with BoundedThreadPool(WorkBudget()) as pool:
        service = make_service(tmp_path, pool, wait_seconds=0.001)

        async def run():
            gate = asyncio.Event()
            calls = []
            failure = error_type("Failed between polls")

            async def compute(path, allow_pickle):
                calls.append(path)
                if len(calls) == 1:
                    await gate.wait()
                    raise failure
                return {"ok": True}

            service._run = compute
            try:
                assert await service.preview(request()) == {"status": "pending"}
                task = next(iter(service._jobs.values()))
                gate.set()
                await asyncio.wait({task}, timeout=1)
                assert not service._jobs
                with pytest.raises(error_type, match="Failed between polls") as error:
                    await service.preview(request())
                assert error.value is failure
                assert len(calls) == 1
                service.wait_seconds = 1
                assert (await service.preview(request()))["ok"]
                assert len(calls) == 2
            finally:
                await service.close()

        asyncio.run(run())


def test_retained_failures_are_bounded_expire_and_do_not_use_job_slots(
    tmp_path, monkeypatch
):
    for index in range(12):
        (tmp_path / f"{index}.npz").write_bytes(b"fixture")
    now = [0.0]
    monkeypatch.setattr("wavedl_daemon.runs.preview_service.monotonic", lambda: now[0])
    with BoundedThreadPool(WorkBudget()) as pool:
        service = make_service(tmp_path, pool, wait_seconds=0.001)

        async def run():
            gate = asyncio.Event()
            calls = []
            retry = False

            async def compute(path, allow_pickle):
                calls.append(path)
                await gate.wait()
                if not retry:
                    raise PreviewRefused("Failed between polls")
                return {"ok": True}

            service._run = compute
            try:
                for index in range(9):
                    gate.clear()
                    assert await service.preview(request(f"{index}.npz")) == {
                        "status": "pending"
                    }
                    task = next(iter(service._jobs.values()))
                    gate.set()
                    await asyncio.wait({task}, timeout=1)
                    assert not service._jobs
                assert len(service._failures) == 8
                retry = True
                gate.clear()
                for index in (9, 10):
                    assert await service.preview(request(f"{index}.npz")) == {
                        "status": "pending"
                    }
                with pytest.raises(BudgetExhausted):
                    await service.preview(request("11.npz"))
                with pytest.raises(PreviewRefused, match="Failed between polls"):
                    await service.preview(request("8.npz"))
                assert len(calls) == 11
                gate.set()
                await asyncio.wait(set(service._jobs.values()), timeout=1)
                service.wait_seconds = 1
                assert (await service.preview(request("0.npz")))["ok"]
                now[0] = 31
                assert (await service.preview(request("7.npz")))["ok"]
                assert len(calls) == 13
                assert not service._failures
            finally:
                await service.close()
            assert not service._failures

        asyncio.run(run())


def test_cache_invalidates_on_file_change_and_evicts_old_entries(tmp_path):
    with BoundedThreadPool(WorkBudget()) as pool:
        service = make_service(tmp_path, pool)

        async def run():
            calls = []

            async def compute(path, allow_pickle):
                calls.append(path)
                return {"ok": True}

            service._run = compute
            for index in range(9):
                (tmp_path / f"{index}.npz").write_bytes(b"fixture")
                await service.preview(request(f"{index}.npz"))
            assert len(service._cache) == 8
            await service.preview(request("0.npz"))
            (tmp_path / "0.npz").write_bytes(b"changed fixture")
            await service.preview(request("0.npz"))
            assert len(calls) == 11
            await service.close()

        asyncio.run(run())


def test_cache_invalidates_on_atomic_replace_with_preserved_size_and_mtime(tmp_path):
    with BoundedThreadPool(WorkBudget()) as pool:
        service = make_service(tmp_path, pool)
        path = tmp_path / "data.npz"
        path.write_bytes(b"original")
        original = path.stat()

        async def run():
            calls = []

            async def compute(path, allow_pickle):
                calls.append(path)
                return {"content": path.read_text()}

            service._run = compute
            first = await service.preview(request("data.npz"))
            replacement = tmp_path / "replacement.npz"
            replacement.write_bytes(b"replaced")
            os.utime(replacement, ns=(original.st_atime_ns, original.st_mtime_ns))
            replacement.replace(path)
            second = await service.preview(request("data.npz"))
            assert first["content"] == "original"
            assert second["content"] == "replaced"
            assert len(calls) == 2
            await service.close()

        asyncio.run(run())


def test_concurrency_cap_is_503_and_cancelled_poll_does_not_cancel_job(tmp_path):
    for index in range(3):
        (tmp_path / f"{index}.npz").write_bytes(b"fixture")
    with BoundedThreadPool(WorkBudget()) as pool:
        service = make_service(tmp_path, pool, wait_seconds=0.001)

        async def run():
            gate = asyncio.Event()
            calls = []

            async def compute(path, allow_pickle):
                calls.append(path)
                await gate.wait()
                return {"ok": True}

            service._run = compute
            try:
                assert await service.preview(request("0.npz")) == {"status": "pending"}
                assert await service.preview(request("1.npz")) == {"status": "pending"}
                with pytest.raises(BudgetExhausted):
                    await service.preview(request("2.npz"))
                service.wait_seconds = 10
                poll = asyncio.create_task(service.preview(request("0.npz")))
                await asyncio.sleep(0.01)
                poll.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await poll
                assert len(service._jobs) == 2
                gate.set()
                assert (await service.preview(request("0.npz")))["ok"]
                assert len(calls) == 2
            finally:
                await service.close()

        asyncio.run(run())


@pytest.mark.parametrize("selected", ["../outside.npz", "/tmp/outside.npz", "link.npz"])
def test_root_escape_and_symlink_escape_refused(tmp_path, selected):
    root = tmp_path / "root"
    root.mkdir()
    outside = tmp_path / "outside.npz"
    write_dataset(outside)
    (root / "link.npz").symlink_to(outside)
    with BoundedThreadPool(WorkBudget()) as pool:
        service = make_service(root, pool)
        with pytest.raises(PreviewRefused):
            asyncio.run(service.preview(request(selected)))


def test_worker_timeout_and_crash_are_unavailable(tmp_path, monkeypatch):
    (tmp_path / "data.npz").write_bytes(b"fixture")
    import wavedl_daemon.runs.preview_service as module

    for result in (
        ProcessResult(-9, b"", b"", timed_out=True),
        ProcessResult(-9, b"", b""),
    ):
        monkeypatch.setattr(
            module, "run_command", lambda *args, res=result, **kwargs: res
        )
        with BoundedThreadPool(WorkBudget()) as pool, pytest.raises(BudgetExhausted):
            asyncio.run(make_service(tmp_path, pool).preview(request()))


def test_http_202_then_200_and_busy_is_503(tmp_path, monkeypatch):
    import threading

    for name in ("data.npz", "second.npz", "third.npz"):
        write_dataset(tmp_path / name)
    value = preview_dataset(tmp_path / "data.npz")
    release = threading.Event()
    calls = []

    def command(spec, budget, *, token):
        calls.append(spec)
        assert release.wait(5)
        return ProcessResult(0, json.dumps(value).encode(), b"")

    monkeypatch.setattr("wavedl_daemon.runs.preview_service.run_command", command)
    with BoundedThreadPool(WorkBudget()) as pool:
        service = make_service(tmp_path, pool, wait_seconds=0.001)
        with TestClient(route_app(routes=preview_routes(service))) as client:
            try:
                pending = client.post("/api/datasets/preview", json=request())
                assert pending.status_code == 202
                assert pending.json() == {"status": "pending"}
                assert pending.headers["cache-control"] == "no-store"
                assert (
                    client.post(
                        "/api/datasets/preview", json=request("second.npz")
                    ).status_code
                    == 202
                )
                assert (
                    client.post(
                        "/api/datasets/preview", json=request("third.npz")
                    ).status_code
                    == 503
                )
                assert (
                    client.post("/api/datasets/preview", json=request()).status_code
                    == 202
                )
                release.set()
                for name in ("data.npz", "second.npz"):
                    deadline = time.monotonic() + 3
                    while True:
                        complete = client.post(
                            "/api/datasets/preview", json=request(name)
                        )
                        if complete.status_code != 202 or time.monotonic() >= deadline:
                            break
                    assert complete.status_code == 200
                    assert complete.headers["cache-control"] == "no-store"
                assert len(calls) == 2
                assert (
                    client.post(
                        "/api/datasets/preview", json={**request(), "view": "all"}
                    ).status_code
                    == 400
                )
                assert (
                    client.post(
                        "/api/datasets/preview",
                        json={**request(), "allow_pickle": "true"},
                    ).status_code
                    == 400
                )
            finally:
                release.set()


def test_hosted_routes_preserve_auth_no_store_and_pickle_required(tmp_path):
    write_dataset(tmp_path / "data.npz")
    np.savez(
        tmp_path / "object.npz",
        inputs=np.array([np.ones(2)], dtype=object),
        outputs=np.zeros((1, 1)),
    )
    settings = Settings(tmp_path / "state", tmp_path / "runs")
    services = HostedServices(settings, browse_roots={"data": tmp_path})
    token = "dataset-acceptance-token"
    app = create_app(
        settings,
        token=token,
        daemon_id="initial",
        build_id="dataset-test",
        services=services,
    )
    with TestClient(app, base_url="http://localhost:8420") as client:
        for endpoint in ("inspect", "preview"):
            assert (
                client.post(f"/api/datasets/{endpoint}", json=request()).status_code
                == 401
            )
        client.headers["Authorization"] = f"Bearer {token}"
        client.headers["X-WaveDL-Daemon-ID"] = client.get("/api/health").json()[
            "daemon_id"
        ]
        inspected = client.post(
            "/api/datasets/inspect", json={"root": "data", "path": "object.npz"}
        )
        assert inspected.status_code == 200
        assert inspected.headers["cache-control"] == "no-store"
        assert inspected.json()["variables"][0]["dtype"] == "object"
        response = client.post(
            "/api/datasets/preview", json={"root": "data", "path": "data.npz"}
        )
        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == "no-store"
        assert token not in response.text and str(tmp_path) not in response.text
        response = client.post("/api/datasets/preview", json=request("object.npz"))
        assert response.status_code == 409
        assert response.json() == {"error": "Dataset contains pickled arrays"}
        assert response.headers["cache-control"] == "no-store"
        assert (
            client.post(
                "/api/datasets/preview", json=request("../data.npz")
            ).status_code
            == 400
        )
        assert (
            client.post(
                "/api/datasets/preview",
                json=request(),
                headers={"Origin": "http://foreign.example"},
            ).status_code
            == 403
        )


def test_close_terminates_real_worker_and_drains_pool(tmp_path, monkeypatch):
    import os

    from wavedl_daemon.execution.commands import run_command
    from wavedl_daemon.supervision.base import ProcessSpec

    write_dataset(tmp_path / "data.npz")
    marker = tmp_path / "worker.pid"
    script = "import os, pathlib, sys, time; pathlib.Path(sys.argv[1]).write_text(str(os.getpid())); time.sleep(60)"
    completed = []

    def command(spec, budget, *, token):
        result = run_command(
            ProcessSpec((sys.executable, "-I", "-c", script, str(marker)), Path.cwd()),
            budget,
            token=token,
        )
        completed.append(result)
        return result

    monkeypatch.setattr("wavedl_daemon.runs.preview_service.run_command", command)
    with BoundedThreadPool(WorkBudget()) as pool:
        service = make_service(tmp_path, pool, wait_seconds=0.001)

        async def run():
            try:
                assert await service.preview(request()) == {"status": "pending"}
                async with asyncio.timeout(3):
                    while not marker.exists():
                        await asyncio.sleep(0.005)
            finally:
                await service.close()
            assert completed and completed[0].cancelled
            assert pool.outstanding == 0
            if os.name != "nt":
                with pytest.raises(ProcessLookupError):
                    os.kill(int(marker.read_text()), 0)

        asyncio.run(run())


def test_full_size_image_samples_fit_worker_output_budget(tmp_path):
    rng = np.random.default_rng(0)
    np.savez(
        tmp_path / "data.npz",
        inputs=rng.normal(size=(3, 500, 500)),
        outputs=np.zeros((3, 1)),
    )
    with BoundedThreadPool(WorkBudget()) as pool:
        value = asyncio.run(make_service(tmp_path, pool).preview(request()))
    size = len(json.dumps(value, separators=(",", ":")).encode())
    assert 512 * 1024 < size < 2 * 1024 * 1024
    assert [sample["shape"] for sample in value["samples"]] == [[125, 125]] * 3
