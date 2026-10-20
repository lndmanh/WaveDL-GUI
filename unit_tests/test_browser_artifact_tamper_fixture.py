"""Exact download fault leaves background consumers and publications untouched."""

import asyncio
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest


@pytest.mark.parametrize("split", [False, True])
def test_exact_history_download_corrupted_once(tmp_path, split):
    spec = importlib.util.spec_from_file_location(
        "artifact_fixture",
        Path(__file__).parents[1] / "tools/browser_daemon_fixture.py",
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    run = "11111111-1111-4111-8111-111111111111"
    generation = "gen-000001"
    endpoint = f"/api/runs/{run}/artifacts/{generation}/training_history.csv"
    original = b"epoch,loss\n1,0.125\n"
    identity = {"size": len(original), "sha256": hashlib.sha256(original).hexdigest()}
    directory = tmp_path / "runs" / run / "checkpoints" / generation
    directory.mkdir(parents=True)
    artifact = directory / "training_history.csv"
    artifact.write_bytes(original)
    (directory / "COMPLETE.json").write_text(
        json.dumps({"files": {"training_history.csv": identity}})
    )
    (tmp_path / ".artifact-tamper-arm").write_text(json.dumps({"path": endpoint}))

    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        chunks = [b"", original[:1], original[1:]] if split else [original]
        for index, chunk in enumerate(chunks):
            await send(
                {
                    "type": "http.response.body",
                    "body": chunk,
                    "more_body": index < len(chunks) - 1,
                }
            )

    wrapped = module.artifact_download_fault(app, tmp_path)

    async def request(path, method="GET"):
        messages = []

        async def send(message):
            messages.append(message)

        await wrapped({"type": "http", "method": method, "path": path}, None, send)
        return b"".join(message.get("body", b"") for message in messages)

    async def exercise():
        # The old broad arm could consume these background metadata requests.
        assert (
            await request(
                endpoint.replace("training_history.csv", "checkpoint_selection.json")
            )
            == original
        )
        assert await request(endpoint.replace(generation, "gen-000002")) == original
        assert (
            await request(endpoint.replace(run, "22222222-2222-4222-8222-222222222222"))
            == original
        )
        assert await request(endpoint, "POST") == original
        changed = bytearray(original)
        changed[0] ^= 1
        assert await request(endpoint) == bytes(changed)
        assert await request(endpoint) == original

    asyncio.run(exercise())
    assert artifact.read_bytes() == original
    receipts = [
        json.loads(line)
        for line in (tmp_path / ".artifact-tamper-receipts.jsonl")
        .read_text()
        .splitlines()
    ]
    assert receipts[0] == {"phase": "arrival", "path": endpoint}
    assert len(receipts) == 2
    receipt = receipts[1]
    assert receipt["phase"] == "complete" and receipt["status"] == 200
    assert receipt["tampered"] is True and receipt["path"] == endpoint
    assert (
        receipt["original"] == receipt["published"] == receipt["diskAfter"] == identity
    )
    assert receipt["wire"]["size"] == identity["size"]
    assert receipt["wire"]["sha256"] != identity["sha256"]
