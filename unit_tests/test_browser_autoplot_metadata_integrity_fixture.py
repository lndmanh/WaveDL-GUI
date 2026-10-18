"""One-shot selection corruption preserves publications and records all arrivals."""

import asyncio
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest


@pytest.fixture
def fixture_module():
    path = Path(__file__).parents[1] / "tools/browser_daemon_fixture.py"
    spec = importlib.util.spec_from_file_location("integrity_fixture", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("split", [False, True])
def test_real_bytes_corrupted_once_and_disk_preserved(tmp_path, fixture_module, split):
    run = "11111111-1111-4111-8111-111111111111"
    generation = "gen-000002"
    original = b'{"schema_version": 1, "kind": "best"}'
    identity = {"size": len(original), "sha256": hashlib.sha256(original).hexdigest()}
    directory = tmp_path / "runs" / run / "checkpoints" / generation
    directory.mkdir(parents=True)
    (directory / "checkpoint_selection.json").write_bytes(original)
    (tmp_path / ".partial-best-proof.json").write_text(
        json.dumps(
            {
                "runId": run,
                "partialGeneration": generation,
                "partialComplete": {"files": {"checkpoint_selection.json": identity}},
            }
        )
    )

    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        chunks = [original[:2], original[2:]] if split else [original]
        for index, chunk in enumerate(chunks):
            await send(
                {
                    "type": "http.response.body",
                    "body": chunk,
                    "more_body": index < len(chunks) - 1,
                }
            )

    wrapped = fixture_module.metadata_integrity_fault(app, tmp_path)

    async def request(generation):
        messages = []

        async def send(message):
            messages.append(message)

        await wrapped(
            {
                "type": "http",
                "method": "GET",
                "path": f"/api/runs/{run}/artifacts/{generation}/checkpoint_selection.json",
            },
            None,
            send,
        )
        return b"".join(message.get("body", b"") for message in messages)

    async def exercise():
        first = await request(generation)
        assert len(first) == len(original) and first != original
        assert first == original.replace(b" ", b"\t", 1)
        assert json.loads(first) == json.loads(original)
        assert await request(generation) == original
        assert await request("gen-000001") == original

    asyncio.run(exercise())
    assert (directory / "checkpoint_selection.json").read_bytes() == original
    rows = [
        json.loads(line)
        for line in (tmp_path / ".metadata-integrity-requests.jsonl")
        .read_text()
        .splitlines()
    ]
    assert [row["phase"] for row in rows] == ["arrival", "complete"] * 3
    assert (
        rows[1]["original"] == rows[1]["published"] == rows[1]["diskAfter"] == identity
    )
    assert rows[1]["wire"]["size"] == identity["size"]
    assert rows[1]["wire"]["sha256"] != identity["sha256"]
    assert rows[1]["parsedOriginal"] == rows[1]["parsedWire"] == json.loads(original)
    assert [row["tampered"] for row in rows if row["phase"] == "complete"] == [
        True,
        False,
        False,
    ]
