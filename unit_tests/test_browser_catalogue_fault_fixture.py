"""Response faults are one-shot, endpoint-bound and do not bypass the real app."""

import asyncio
import json
import os

import pytest

from tools.browser_catalogue_fault_fixture import corrupt, response_fault


@pytest.mark.parametrize(
    "mode",
    ["roots", "traversal", "claim", "malformed-model", "outage", "header", "shape"],
)
def test_explicit_success_fault_is_one_shot(tmp_path, mode):
    from tools.browser_catalogue_fault_fixture import MODES

    method, path = MODES[mode]
    value = {
        "roots": [{"id": "datasets"}],
        "entries": [{"name": "samples.npz", "kind": "file"}],
        "runtime_verified": False,
        "models": [{"id": "cnn", "description": "Real bundled metadata"}],
        "schema_version": 1,
        "variables": [{"sample_count": 96}],
    }
    calls = []

    async def app(scope, receive, send):
        calls.append(scope)
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": json.dumps(value).encode()})

    control = tmp_path / ".catalogue-control"
    control.write_text(mode)
    wrapped = response_fault(app, tmp_path)
    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "query_string": b"root=datasets" if mode == "traversal" else b"",
    }

    async def run():
        first, second = [], []

        async def first_send(message):
            first.append(message)

        async def second_send(message):
            second.append(message)

        await wrapped(scope, None, first_send)
        await wrapped(scope, None, second_send)
        return first, second

    first, second = asyncio.run(run())
    assert len(calls) == 2
    assert not control.exists()
    assert json.loads(first[1]["body"]) == corrupt(mode, json.loads(json.dumps(value)))
    assert json.loads(second[1]["body"]) == value
    assert first[0]["status"] == (503 if mode == "outage" else 200)
    assert len((tmp_path / ".catalogue-responses.jsonl").read_text().splitlines()) == 1


def test_failed_real_response_cannot_be_replaced(tmp_path):
    control = tmp_path / ".catalogue-control"
    control.write_text("claim")
    messages = []

    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 401, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    async def send(message):
        messages.append(message)

    asyncio.run(
        response_fault(app, tmp_path)(
            {"type": "http", "method": "GET", "path": "/api/models"}, None, send
        )
    )
    assert messages[0]["status"] == 401
    assert control.read_text() == "claim"
    assert not (tmp_path / ".catalogue-responses.jsonl").exists()


def test_fault_modes_are_closed():
    with pytest.raises(ValueError):
        corrupt("unknown", {})


def test_native_owned_locations_and_real_service_refusals(tmp_path):
    from tools.browser_catalogue_fault_fixture import (
        NATIVE,
        create_native_locations,
        native_proof,
    )
    from wavedl_daemon.execution.budget import BudgetExhausted
    from wavedl_daemon.runs.catalog import CatalogService

    if os.getuid() == 0:
        with pytest.raises(RuntimeError, match="non-root"):
            create_native_locations(tmp_path)
        return
    create_native_locations(tmp_path)
    try:
        catalogue = CatalogService({"datasets": tmp_path})
        assert catalogue.max_entries == 1000
        assert native_proof(tmp_path, "unreadable")["permissionDenied"] is True
        proof = native_proof(tmp_path, "oversized")
        assert proof["entryCount"] == 1001 and proof["ordinaryEmptyFiles"]
        with pytest.raises(PermissionError):
            catalogue.browse("datasets", NATIVE["unreadable"])
        with pytest.raises(BudgetExhausted):
            catalogue.browse("datasets", NATIVE["oversized"])
        assert len(catalogue.browse("datasets")["entries"]) == 2
    finally:
        (tmp_path / NATIVE["unreadable"]).chmod(0o700)


@pytest.mark.parametrize("mode,status", [("unreadable", 403), ("oversized", 503)])
def test_native_recorder_preserves_real_response(tmp_path, mode, status):
    from tools.browser_catalogue_fault_fixture import NATIVE, create_native_locations

    if os.getuid() == 0:
        pytest.fail("Native permission acceptance is unsupported as root")
    create_native_locations(tmp_path)
    messages = []

    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": status, "headers": []})
        await send({"type": "http.response.body", "body": b'{"error":"real"}'})

    async def send(message):
        messages.append(message)

    try:
        asyncio.run(
            response_fault(app, tmp_path)(
                {
                    "type": "http",
                    "method": "GET",
                    "path": "/api/browse",
                    "query_string": f"root=datasets&path={NATIVE[mode]}".encode(),
                    "headers": [(b"user-agent", b"Chrome/150")],
                },
                None,
                send,
            )
        )
        assert messages[0]["status"] == status
        assert messages[1]["body"] == b'{"error":"real"}'
        record = json.loads((tmp_path / ".catalogue-responses.jsonl").read_text())
        assert record["original"] == record["response"] == '{"error":"real"}'
        assert record["realStatus"] == record["status"] == status
        assert record["responseModified"] is False and record["browser"] is True
    finally:
        (tmp_path / NATIVE["unreadable"]).chmod(0o700)
