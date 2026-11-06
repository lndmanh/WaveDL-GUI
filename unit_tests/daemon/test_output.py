"""Bounded, authenticated trainer-output reads and persisted attempt selection."""

from __future__ import annotations

import threading
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import httpx
import pytest

from wavedl_daemon.execution.budget import WorkBudget
from wavedl_daemon.execution.pool import BoundedThreadPool
from wavedl_daemon.http import output as http_output
from wavedl_daemon.http.app import create_app
from wavedl_daemon.http.output import output_routes
from wavedl_daemon.runs.layout import RunPaths
from wavedl_daemon.runs.lifecycle import Ended, Live
from wavedl_daemon.runs.model import (
    BackendKind,
    Exited,
    LocalHandle,
    Outcome,
    SlurmHandle,
)
from wavedl_daemon.runs.output import OUTPUT_CHUNK_BYTES, read_output, resolve_output


RUN = "aaaaaaaa-0000-4000-8000-000000000001"
TOKEN = "output-route-test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


class OutputService:
    def __init__(self, root):
        self.paths = RunPaths(root / RUN)
        self.log = Mock()
        self.log.head.return_value = SimpleNamespace(
            attempt=2,
            ref=SimpleNamespace(backend=BackendKind.LOCAL),
            stage=Live(LocalHandle(123, "owned")),
        )
        self.log.read_after.return_value = []

    def layout(self, run_id):
        if run_id != RUN:
            raise KeyError(run_id)
        return self.paths


@pytest.fixture
def service(tmp_path):
    return OutputService(tmp_path)


@pytest.fixture
def output_http(service):
    pool = BoundedThreadPool(WorkBudget())
    app = create_app(None, token=TOKEN, daemon_id="output-test", build_id="test")
    app.router.routes.extend(output_routes(pool, service))
    try:
        yield app
    finally:
        pool.shutdown()


def client(app):
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1"
    )


def write_output(service, content, attempt=2):
    location = service.paths.output_log(attempt)
    location.parent.mkdir(parents=True, exist_ok=True)
    location.write_bytes(content)
    return location


@pytest.mark.anyio
async def test_output_defaults_to_current_attempt_tail_and_supports_head(
    service, output_http
):
    write_output(service, b"old attempt", attempt=1)
    content = b"old" * OUTPUT_CHUNK_BYTES + b"recent output\n"
    write_output(service, content)
    async with client(output_http) as http:
        response = await http.get(f"/api/runs/{RUN}/output", headers=AUTH)
        head = await http.head(f"/api/runs/{RUN}/output", headers=AUTH)
    assert response.status_code == head.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert head.content == b""
    body = response.json()
    assert body == {
        "attempt": 2,
        "offset": len(content) - OUTPUT_CHUNK_BYTES,
        "next_offset": len(content),
        "size": len(content),
        "text": content[-OUTPUT_CHUNK_BYTES:].decode(),
        "eof": True,
    }


@pytest.mark.anyio
async def test_output_cursor_round_trip_and_attempt_selection(service, output_http):
    content = b"a" * (OUTPUT_CHUNK_BYTES - 1) + "€漢🙂".encode() + b"end"
    write_output(service, content, attempt=1)
    async with client(output_http) as http:
        first = await http.get(
            f"/api/runs/{RUN}/output?attempt=1&offset=0", headers=AUTH
        )
        page = first.json()
        second = await http.get(
            f"/api/runs/{RUN}/output?attempt=1&offset={page['next_offset']}",
            headers=AUTH,
        )
    assert page["next_offset"] == OUTPUT_CHUNK_BYTES - 1
    assert page["eof"] is False
    assert page["text"] + second.json()["text"] == content.decode()
    assert second.json()["next_offset"] == len(content)
    assert second.json()["eof"] is True


@pytest.mark.parametrize("character", ["é", "漢", "🙂"])
def test_tail_and_explicit_offsets_never_start_inside_utf8(
    service, monkeypatch, character
):
    encoded = character.encode()
    content = b"first" + encoded + b"last"
    write_output(service, content)
    source = resolve_output(service, RUN)
    for inside in range(1, len(encoded)):
        offset = len(b"first") + inside
        chunk = read_output(source, offset)
        assert chunk.offset == len(b"first") + len(encoded)
        assert chunk.text == "last"
        monkeypatch.setattr(
            "wavedl_daemon.runs.output.OUTPUT_CHUNK_BYTES", len(content) - offset
        )
        assert read_output(source).text == "last"


@pytest.mark.anyio
async def test_missing_file_and_unknown_run_are_distinct(service, output_http):
    async with client(output_http) as http:
        missing = await http.get(f"/api/runs/{RUN}/output?attempt=1", headers=AUTH)
        unknown = await http.get(f"/api/runs/{uuid4()}/output", headers=AUTH)
    assert missing.status_code == 200
    assert missing.json() == {
        "attempt": 1,
        "offset": 0,
        "next_offset": 0,
        "size": 0,
        "text": "",
        "eof": True,
    }
    assert unknown.status_code == 404 and set(unknown.json()) == {"error"}


@pytest.mark.anyio
@pytest.mark.parametrize(
    "query",
    [
        "attempt=0",
        "attempt=-1",
        "attempt=x",
        "attempt=1.5",
        "offset=-1",
        "offset=x",
        "offset=9223372036854775808",
        "attempt=1&attempt=2",
        "offset=0&offset=1",
        "unused=1",
    ],
)
async def test_output_rejects_bad_parameters_with_daemon_400(output_http, query):
    async with client(output_http) as http:
        response = await http.get(f"/api/runs/{RUN}/output?{query}", headers=AUTH)
    assert response.status_code == 400
    assert set(response.json()) == {"error"}


@pytest.mark.anyio
@pytest.mark.parametrize("run_id", ["bad-run", RUN.upper()])
async def test_output_rejects_noncanonical_run_identity(output_http, run_id):
    async with client(output_http) as http:
        response = await http.get(f"/api/runs/{run_id}/output", headers=AUTH)
    assert response.status_code == 400 and set(response.json()) == {"error"}


@pytest.mark.anyio
async def test_output_auth_and_file_io_run_on_worker(service, output_http, monkeypatch):
    write_output(service, b"hello\xffworld")
    loop_thread = threading.get_ident()
    actual = http_output.read_output
    threads = []

    def read(source, offset):
        threads.append(threading.get_ident())
        return actual(source, offset)

    monkeypatch.setattr(http_output, "read_output", read)
    async with client(output_http) as http:
        denied = await http.get(f"/api/runs/{RUN}/output")
        response = await http.get(f"/api/runs/{RUN}/output", headers=AUTH)
    assert denied.status_code == 401
    assert response.json()["text"] == "hello�world"
    assert threads and all(thread != loop_thread for thread in threads)


@pytest.mark.anyio
async def test_output_refuses_a_symlink_escaping_the_run(
    service, output_http, tmp_path
):
    outside = tmp_path / "private.txt"
    outside.write_text("secret")
    location = service.paths.output_log(2)
    location.parent.mkdir(parents=True)
    location.symlink_to(outside)
    async with client(output_http) as http:
        response = await http.get(f"/api/runs/{RUN}/output", headers=AUTH)
    assert response.status_code == 400
    assert "secret" not in response.text


def test_offset_past_end_and_rewritten_file_are_clamped(service):
    write_output(service, b"abc")
    source = resolve_output(service, RUN)
    assert read_output(source, 100).offset == 3
    assert read_output(source, 100).text == ""
    write_output(service, b"x")
    assert read_output(source, 3).next_offset == 1


@pytest.mark.parametrize("ended", [False, True])
def test_slurm_current_attempt_uses_the_stored_handle(service, ended):
    head = service.log.head.return_value
    handle = SlurmHandle("12345", "alpha", "tester")
    head.ref.backend = BackendKind.SLURM
    head.stage = (
        Ended(Exited(Outcome.COMPLETED, True), handle) if ended else Live(handle)
    )
    location = service.paths.logs / "slurm-12345.out"
    location.parent.mkdir(parents=True)
    location.write_bytes(b"slurm stdout")
    assert read_output(resolve_output(service, RUN)).text == "slurm stdout"


def test_slurm_requeued_attempts_use_the_same_stored_job_handle(service):
    head = service.log.head.return_value
    head.ref.backend = BackendKind.SLURM
    head.stage = Live(SlurmHandle("222", "alpha", "tester"))
    source = resolve_output(service, RUN, 1)
    assert source.parts == ("logs", "slurm-222.out")
    assert source.attempt == 1
    assert resolve_output(service, RUN, 3).parts is None
    assert read_output(resolve_output(service, RUN, 3)).text == ""


def test_slurm_missing_or_invalid_handle_returns_empty(service):
    head = service.log.head.return_value
    head.ref.backend = BackendKind.SLURM
    head.stage = Live(SlurmHandle("../../secret", "alpha", "tester"))
    assert read_output(resolve_output(service, RUN)).text == ""


def test_run_without_attempt_defaults_to_one(service):
    service.log.head.return_value = None
    assert resolve_output(service, RUN).attempt == 1


def test_incomplete_live_utf8_write_is_retained_until_the_next_poll(service):
    location = write_output(service, b"before\xe2")
    first = read_output(resolve_output(service, RUN), 0)
    assert first.text == "before"
    assert first.next_offset == 6 and first.eof is False
    with location.open("ab") as stream:
        stream.write(b"\x82\xacafter")
    second = read_output(resolve_output(service, RUN), first.next_offset)
    assert second.text == "€after"
    assert second.next_offset == location.stat().st_size
    assert second.eof is True


def test_truncated_utf8_is_replaced_once_the_writer_is_terminal(service):
    write_output(service, b"before\xe2")
    head = service.log.head.return_value
    head.stage = Ended(Exited(Outcome.COMPLETED, True), LocalHandle(123, "owned"))
    chunk = read_output(resolve_output(service, RUN), 0)
    assert chunk.text == "before�"
    assert chunk.next_offset == 7 and chunk.eof is True
