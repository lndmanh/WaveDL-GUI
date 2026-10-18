"""F13 observer preserves the real boundary and never exports secrets."""

import asyncio
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest

from tools.hostile_origin_browser_fixture import (
    private_root,
    receipt_observer,
    safe_origin,
    storage_snapshot,
    write_private_once,
)
from wavedl_daemon.http.app import create_app
from wavedl_daemon.storage.settings import Settings


pytestmark = pytest.mark.skipif(
    os.name != "posix", reason="Owned no-follow POSIX fixture"
)


def test_real_boundary_records_foreign_origin_and_cookie_auth_without_secrets(tmp_path):
    token = "private-test-token"
    app = create_app(
        Settings(tmp_path / "state", tmp_path / "runs"),
        token=token,
        daemon_id="test-daemon",
        build_id="test-build",
        allowed_hosts=("127.0.0.1:8420",),
    )
    evidence = tmp_path / "receipts.jsonl"
    observed = receipt_observer(app, evidence)
    cancel = "/api/runs/12345678-1234-1234-1234-123456789abc/cancel"

    async def exercise():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=observed),
            base_url="http://127.0.0.1:8420",
        ) as client:
            responses = []
            for method, path, headers, content in [
                ("GET", "/api/runs", {"Origin": "http://127.0.0.1:8421"}, b""),
                (
                    "POST",
                    cancel,
                    {"Origin": "http://127.0.0.1:8421", "Cookie": "token=" + token},
                    b"secret-form-value",
                ),
                (
                    "OPTIONS",
                    cancel,
                    {
                        "Origin": "http://127.0.0.1:8421",
                        "Access-Control-Request-Headers": "authorization,content-type,secret",
                    },
                    b"",
                ),
                ("GET", "/api/runs", {"Cookie": "token=" + token}, b""),
            ]:
                responses.append(
                    await client.request(method, path, headers=headers, content=content)
                )
            return responses

    responses = asyncio.run(exercise())
    assert [response.status_code for response in responses] == [403, 403, 403, 401]
    text = evidence.read_text()
    assert token not in text and "secret" not in text
    records = [json.loads(line) for line in text.splitlines()]
    assert [record["sequence"] for record in records] == [1, 2, 3, 4]
    assert [record["method"] for record in records] == ["GET", "POST", "OPTIONS", "GET"]
    assert [record["authHeaderPresent"] for record in records] == [False] * 4
    assert records[1]["cookiePresent"]
    assert records[1]["bodySha256"] == hashlib.sha256(b"secret-form-value").hexdigest()
    assert records[1]["bodyBytes"] == len(b"secret-form-value")
    assert records[2]["requestedHeaders"] == ["authorization", "content-type"]
    assert records[3]["origin"] is None
    assert all(
        not record["setCookiePresent"] and not record["allowOriginPresent"]
        for record in records
    )


@pytest.mark.parametrize("query", [b"", b"&".join([b"secret=hidden"] * 17)])
def test_observer_replays_identical_request_messages_and_response(tmp_path, query):
    messages = [
        {"type": "http.request", "body": b"one", "more_body": True},
        {"type": "http.request", "body": b"two", "more_body": False},
    ]
    output = [
        {
            "type": "http.response.start",
            "status": 202,
            "headers": [(b"x-untouched", b"same")],
        },
        {"type": "http.response.body", "body": b"unchanged"},
    ]
    seen = []

    async def real(scope, receive, send):
        seen.extend([await receive(), await receive()])
        for message in output:
            await send(message)

    app = receipt_observer(real, tmp_path / "receipt")

    async def exercise():
        incoming = iter(messages)
        outgoing = []

        async def receive():
            return next(incoming)

        async def send(message):
            outgoing.append(message)

        await app(
            {
                "type": "http",
                "path": "/api/runs/plan",
                "method": "POST",
                "headers": [(b"authorization", b"Bearer hidden")],
                "query_string": query,
            },
            receive,
            send,
        )
        return outgoing

    assert asyncio.run(exercise()) == output
    assert all(
        actual is expected for actual, expected in zip(seen, messages, strict=True)
    )


def test_snapshot_is_read_only_detects_control_and_tree_changes(tmp_path):
    tmp_path.chmod(0o700)
    (tmp_path / "state").mkdir(mode=0o700)
    (tmp_path / "runs").mkdir(mode=0o700)
    db_path = tmp_path / "state" / "registry.db"
    with sqlite3.connect(db_path) as db:
        db.executescript(
            "CREATE TABLE plans(plan_id TEXT, request_id TEXT, plan_json TEXT); CREATE TABLE plan_control(plan_id TEXT, submission_requested INTEGER, cancellation_requested INTEGER); CREATE TABLE execution_control(plan_id TEXT,attempt INTEGER,state TEXT,cancel_delivered INTEGER); CREATE TABLE submission_control(plan_id TEXT,state TEXT,cancel_delivered INTEGER); INSERT INTO plan_control VALUES('p',0,0);"
        )
        db.execute(
            "INSERT INTO plans VALUES(?,?,?)",
            ("p", "q", json.dumps({"manifest_json": json.dumps({"run_id": "r"})})),
        )
    file = tmp_path / "runs" / "manifest.json"
    file.write_text("private-config")
    original = {
        path: path.read_bytes() for path in tmp_path.rglob("*") if path.is_file()
    }
    before = storage_snapshot(tmp_path)
    assert before == storage_snapshot(tmp_path)
    assert original == {
        path: path.read_bytes() for path in tmp_path.rglob("*") if path.is_file()
    }
    assert before["registry"]["plans"] == [
        {
            "planId": "p",
            "requestId": "q",
            "runId": "r",
            "submissionRequested": 0,
            "cancellationRequested": 0,
        }
    ]
    assert "private-config" not in json.dumps(before)
    with sqlite3.connect(db_path) as db:
        db.execute("UPDATE plan_control SET cancellation_requested=1")
    after = storage_snapshot(tmp_path)
    assert before["registry"]["sha256"] != after["registry"]["sha256"]
    assert before["trees"] == after["trees"]
    file.write_text("mutated-config")
    assert storage_snapshot(tmp_path)["trees"] != after["trees"]


def test_private_root_and_write_once_fail_closed(tmp_path):
    tmp_path.chmod(0o700)
    assert private_root(tmp_path, empty=True) == tmp_path
    target = tmp_path / "evidence"
    write_private_once(target, b"initial")
    assert target.stat().st_mode & 0o777 == 0o600
    with pytest.raises(FileExistsError):
        write_private_once(target, b"replacement")
    assert target.read_bytes() == b"initial"
    with pytest.raises(ValueError):
        private_root(tmp_path, empty=True)
    tmp_path.chmod(0o755)
    with pytest.raises(ValueError):
        private_root(tmp_path)
    assert safe_origin(b"http://127.0.0.1:9999") == "http://127.0.0.1:9999"
    assert safe_origin(b"http://secret@127.0.0.1:9999") == "[unrecorded]"


@pytest.mark.skipif(os.name != "posix", reason="Owned no-follow POSIX fixture")
def test_real_loopback_fixture_no_mutation_then_authorized_cancel(tmp_path):
    root = (tmp_path / "fixture").resolve()
    root.mkdir(mode=0o700)
    checkout = Path(__file__).resolve().parents[1]
    environment = {
        **os.environ,
        "PYTHONPATH": str(checkout / "src") + os.pathsep + str(checkout),
    }
    process = subprocess.Popen(
        [
            sys.executable,
            str(checkout / "tools/hostile_origin_browser_fixture.py"),
            "--root",
            str(root),
        ],
        cwd=checkout,
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    try:
        deadline = time.monotonic() + 15
        while not (root / "ready.json").exists():
            assert process.poll() is None, "Real fixture failed before readiness"
            assert time.monotonic() < deadline, "Real fixture startup timeout"
            time.sleep(0.025)
        ready = json.loads((root / "ready.json").read_text())
        assert ready["cancelPath"] == f"/api/runs/{ready['runId']}/cancel"
        assert ready["scope"] == "local-loopback-unsubmitted-plan-no-ML"
        assert ready["daemonOrigin"].startswith("http://127.0.0.1:")
        assert ready["daemonId"] and ready["buildId"]
        before = storage_snapshot(root)
        assert before["registry"]["submissionControls"] == []
        assert before["registry"]["executions"] == []
        with httpx.Client(base_url=ready["daemonOrigin"], timeout=5) as client:
            token = (root / "token").read_text()
            authenticated = client.get(
                "/api/runs",
                headers={
                    "Authorization": "Bearer " + token,
                    "X-WaveDL-Acceptance-Case": "node-get",
                },
            )
            assert authenticated.status_code == 200
            assert storage_snapshot(root) == before
            foreign = client.post(
                ready["cancelPath"] + "?acceptance_case=simple-post",
                headers={"Origin": "http://127.0.0.1:43210"},
            )
            assert foreign.status_code == 403
            assert storage_snapshot(root) == before
            positive = client.post(
                ready["cancelPath"] + "?acceptance_case=node-cancel",
                headers={"Authorization": "Bearer " + token},
            )
            assert positive.status_code == 202
        after = storage_snapshot(root)
        assert after["registry"]["cancellationRequested"] == [1]
        assert after["registry"]["executions"] == []
        assert after["registry"]["submissionControls"] == [
            {"planId": ready["planId"], "state": "pending", "cancelDelivered": False}
        ]
        assert {
            key: (value, after["registry"]["tables"][key])
            for key, value in before["registry"]["tables"].items()
            if value != after["registry"]["tables"][key]
        } == {"submission_control": (0, 1)}
        assert after["registry"]["sha256"] != before["registry"]["sha256"]
        assert after["trees"]["state"] == before["trees"]["state"]
        assert after["trees"]["runs"] != before["trees"]["runs"]
        receipts = [
            json.loads(line)
            for line in (root / "receipts.jsonl").read_text().splitlines()
        ]
        assert [item["status"] for item in receipts] == [200, 403, 202]
        assert [item["case"] for item in receipts] == [
            "node-get",
            "simple-post",
            "node-cancel",
        ]
        assert token not in json.dumps(receipts)
    finally:
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
            pytest.fail("Fixture failed bounded graceful teardown")
        if process.stderr is not None:
            process.stderr.close()


@pytest.mark.skipif(os.name != "posix", reason="Owned no-follow POSIX fixture")
def test_rejects_symlink_parent_storage_and_receipt_replacement(tmp_path):
    tmp_path.chmod(0o700)
    with pytest.raises(ValueError):
        private_root(Path("relative"))
    real = tmp_path / "real"
    real.mkdir(mode=0o700)
    alias = tmp_path / "alias"
    alias.symlink_to(real, target_is_directory=True)
    child = real / "child"
    child.mkdir(mode=0o700)
    with pytest.raises(ValueError):
        private_root(alias / "child")
    (tmp_path / "state").symlink_to(real, target_is_directory=True)
    with pytest.raises(ValueError):
        storage_snapshot(tmp_path)
    evidence = tmp_path / "receipts"

    async def app(scope, receive, send):
        evidence.unlink()
        evidence.symlink_to(tmp_path / "untouched")
        await send({"type": "http.response.start", "status": 403, "headers": []})

    observed = receipt_observer(app, evidence)

    async def exercise():
        async def receive():
            return {"type": "http.request", "body": b""}

        async def send(message):
            pass

        await observed(
            {"type": "http", "method": "GET", "path": "/api/runs", "headers": []},
            receive,
            send,
        )

    with pytest.raises(OSError):
        asyncio.run(exercise())
    assert not (tmp_path / "untouched").exists()


def test_snapshot_rejects_fifo_and_symlinked_registry(tmp_path):
    tmp_path.chmod(0o700)
    (tmp_path / "state").mkdir(mode=0o700)
    (tmp_path / "runs").mkdir(mode=0o700)
    registry = tmp_path / "state" / "registry.db"
    os.mkfifo(registry, mode=0o600)
    with pytest.raises(ValueError):
        storage_snapshot(tmp_path)
    registry.unlink()
    outside = tmp_path / "outside.db"
    outside.write_bytes(b"not-read")
    registry.symlink_to(outside)
    with pytest.raises(ValueError):
        storage_snapshot(tmp_path)
