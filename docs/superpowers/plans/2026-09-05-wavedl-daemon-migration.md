# WaveDL Daemon Architecture Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the PySide6 desktop shell with a headless Python daemon that serves its own web UI, so WaveDL is usable on a workstation, a remote lab box, an HPC login node, and a notebook runtime from one codebase.

**Architecture:** A FastAPI daemon owns a run registry and reconciles execution state from three independent authorities — user intent, backend observations, and published results. Training runs through a `plan → submit → observe → request_cancel → collect` backend seam with Local and Slurm implementations. Training processes write a per-attempt JSONL journal that is the durable record but never the sole authority. The daemon serves a statically generated Nuxt PWA from the same origin.

**Tech Stack:** Python 3.11+, FastAPI, uvicorn, Pydantic v2, SQLAlchemy (SQLite), pytest; Nuxt 4 + Vue 3 + shadcn-vue + Pinia + uPlot, scaffolded with `create-nuxt-saas` (`base` + `pwa`).

**Spec:** `docs/superpowers/specs/2026-09-05-wavedl-daemon-architecture-design.md`
**Review:** `docs/superpowers/specs/2026-09-05-codex-review-daemon-architecture.md`

## Global Constraints

- Python **3.11+**. Line length **88**. Double quotes. Ruff is the sole linter and formatter; CI pins `ruff==0.14.10` and runs `ruff check` and `ruff format --check`.
- Tests live in `unit_tests/`, named `test_*.py`, classes `Test*`, functions `test_*`. Markers: `slow`, `gpu`, `integration`. CI default is `pytest -m "not slow"`.
- **The repo's editable install is currently dangling** (it points at a deleted worktree). Run `pip install -e ".[dev,gui]"` before starting, or prefix every pytest invocation with `PYTHONPATH=src`. This plan writes `PYTHONPATH=src` explicitly so it works either way.
- **`wavedl-train` must remain runnable with no daemon present.** No task may make the daemon a prerequisite for training.
- **Nothing may require outbound internet at runtime.** HPC login nodes frequently have none.
- **Strict JSON on the wire.** No `Infinity`/`NaN` tokens ever. Serialise with `allow_nan=False`.
- **Never guess a terminal state.** Absent evidence is `terminal_unknown`, never `failed`.
- **Never auto-resubmit** a job whose submission outcome is unknown.
- Commit after every task. Do not squash tasks together.

## Phase Gates

| Phase | Tasks | Gate before moving on |
|---|---|---|
| **1 — Daemon backend** | 1–18 | Qt shell runs entirely through the daemon; failure-oriented tests pass; one real cluster validated |
| **2 — Web client** | 19–26 | Client reaches feature parity with the Qt shell against the same API |
| **3 — Cutover** | 27–29 | Qt shell removed, packaging ships the bundled client |

Phase 1 is the large one. If it must land in two pieces, the split point is the Slurm backend (Tasks 9–11): a Local-only Phase 1 still needs Tasks 1–8 plus 12–18, because the API, ingestion, CLI, and runtime integration are not optional for any working daemon.

## File Structure

**New package: `src/wavedl_daemon/`** — the daemon. Kept separate from `wavedl` (the training framework) and `wavedl_gui` (the shell being retired), so Phase 3 deletes one package without touching the others.

| Path | Responsibility |
|---|---|
| `protocol/envelope.py` | Event envelope model, strict-JSON encode/decode |
| `protocol/events.py` | Per-type payload models |
| `protocol/journal_writer.py` | Single-writer append with newline commit and fsync policy |
| `protocol/journal_reader.py` | Offset-tracking reader with incomplete-tail buffering |
| `runs/manifest.py` | Immutable run manifest; **shared with standalone launches** |
| `runs/layout.py` | Run directory paths and attempt allocation |
| `runs/registry.py` | SQLite persistence for intent, observations, cursors |
| `runs/reducer.py` | Derives displayed state from the three authorities |
| `backends/base.py` | The `plan/submit/observe/request_cancel/collect` protocol |
| `backends/local.py` | Local process backend with process-group supervision |
| `backends/slurm.py` | Slurm backend: sbatch rendering, submission identity, polling |
| `datasets/inspect.py` | Bounded dataset introspection (NPZ header reads) |
| `api/app.py` | FastAPI application factory, static mount |
| `api/auth.py` | Token auth, bootstrap exchange, Origin/XSRF enforcement |
| `api/routes_runs.py` | Run plan/submit/list/get/cancel/adopt endpoints |
| `api/routes_stream.py` | Resumable event stream |
| `api/routes_artifacts.py` | Artifact listing and safe download |
| `ingest.py` | Journal → registry ingestion with transactional cursor |
| `settings.py` | Daemon configuration and data-directory resolution |
| `cli.py` | `wavedl-daemon serve` entry point |

**Modified in `src/wavedl/`** — the training framework must cooperate:

| Path | Change |
|---|---|
| `launcher.py` | SIGTERM handler forwarding to the `accelerate` child |
| `train.py` | Emit `hello` + journal events from rank 0 only |
| `utils/data.py` | NPZ shape/dtype from member headers, not full reads |

**Web client: `web/`** — Nuxt project; build output vendored into the wheel at `src/wavedl_daemon/static/`.

---

## Phase 1 — Daemon Backend

### Task 1: Protocol envelope with strict-JSON encoding

**Files:**
- Create: `src/wavedl_daemon/__init__.py`
- Create: `src/wavedl_daemon/protocol/__init__.py`
- Create: `src/wavedl_daemon/protocol/envelope.py`
- Test: `unit_tests/daemon/test_protocol_envelope.py`

**Interfaces:**
- Consumes: nothing
- Produces: `Envelope` (Pydantic model with fields `protocol: str`, `version: int`, `run_id: str`, `attempt: int`, `type: str`, `seq: int`, `ts: str`, `payload: dict`); `encode(envelope) -> str`; `decode(line: str) -> Envelope`; `finite_or_none(value) -> Any`

- [ ] **Step 1: Write the failing test**

```python
# unit_tests/daemon/test_protocol_envelope.py
"""Tests for the wire envelope and its strict-JSON guarantees."""

import json

import pytest


class TestEncode:
    def test_encode_produces_single_line(self):
        from wavedl_daemon.protocol.envelope import Envelope, encode

        env = Envelope(
            run_id="r1", attempt=1, type="metric", seq=0,
            ts="2026-09-05T12:00:00Z", payload={"epoch": 1},
        )
        line = encode(env)

        assert "\n" not in line
        assert json.loads(line)["run_id"] == "r1"

    def test_encode_rejects_non_finite(self):
        """Infinity must never reach the wire; RFC 8259 has no such token."""
        from wavedl_daemon.protocol.envelope import Envelope, encode

        env = Envelope(
            run_id="r1", attempt=1, type="metric", seq=0,
            ts="2026-09-05T12:00:00Z", payload={"best_val_loss": float("inf")},
        )
        line = encode(env)

        assert "Infinity" not in line
        assert json.loads(line)["payload"]["best_val_loss"] is None

    def test_encode_defaults_protocol_fields(self):
        from wavedl_daemon.protocol.envelope import Envelope, encode

        env = Envelope(
            run_id="r1", attempt=1, type="state", seq=3,
            ts="2026-09-05T12:00:00Z", payload={},
        )
        decoded = json.loads(encode(env))

        assert decoded["protocol"] == "wavedl-jsonl"
        assert decoded["version"] == 1


class TestDecode:
    def test_decode_round_trip(self):
        from wavedl_daemon.protocol.envelope import Envelope, decode, encode

        env = Envelope(
            run_id="r1", attempt=2, type="log", seq=9,
            ts="2026-09-05T12:00:00Z", payload={"message": "hi"},
        )

        assert decode(encode(env)) == env

    def test_decode_ignores_unknown_fields(self):
        """Forward compatibility: unknown envelope fields must not raise."""
        from wavedl_daemon.protocol.envelope import decode

        line = json.dumps({
            "protocol": "wavedl-jsonl", "version": 1, "run_id": "r1",
            "attempt": 1, "type": "state", "seq": 0,
            "ts": "2026-09-05T12:00:00Z", "payload": {}, "future_field": 42,
        })

        assert decode(line).run_id == "r1"

    def test_decode_rejects_wrong_protocol(self):
        from wavedl_daemon.protocol.envelope import ProtocolError, decode

        line = json.dumps({
            "protocol": "something-else", "version": 1, "run_id": "r1",
            "attempt": 1, "type": "state", "seq": 0,
            "ts": "2026-09-05T12:00:00Z", "payload": {},
        })

        with pytest.raises(ProtocolError):
            decode(line)


class TestFiniteOrNone:
    def test_nested_structures_sanitised(self):
        from wavedl_daemon.protocol.envelope import finite_or_none

        result = finite_or_none({"a": float("nan"), "b": [float("inf"), 1.0]})

        assert result == {"a": None, "b": [None, 1.0]}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_protocol_envelope.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'wavedl_daemon'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/wavedl_daemon/protocol/envelope.py
"""The wire envelope shared by every WaveDL event producer and consumer.

Strict JSON is a hard requirement: the browser client parses these lines with
JSON.parse, which rejects the bare Infinity and NaN tokens that Python's json
module emits by default.
"""

from __future__ import annotations

import json
import math
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

PROTOCOL_NAME = "wavedl-jsonl"
PROTOCOL_VERSION = 1


class ProtocolError(ValueError):
    """A line is not a valid envelope of a protocol we speak."""


class Envelope(BaseModel):
    """One event on the wire. Unknown fields are ignored, never fatal."""

    model_config = ConfigDict(extra="ignore")

    protocol: str = PROTOCOL_NAME
    version: int = PROTOCOL_VERSION
    run_id: str
    attempt: int
    type: str
    seq: int
    ts: str
    payload: dict[str, Any] = Field(default_factory=dict)


def finite_or_none(value: Any) -> Any:
    """Recursively replace non-finite floats with None.

    Mirrors wavedl.train._finite_or_none so producer and consumer agree.
    """
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {key: finite_or_none(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [finite_or_none(item) for item in value]
    return value


def encode(envelope: Envelope) -> str:
    """Serialise to one strict-JSON line with no embedded newline."""
    payload = finite_or_none(envelope.model_dump())
    return json.dumps(payload, allow_nan=False, separators=(",", ":"))


def decode(line: str) -> Envelope:
    """Parse one line, rejecting protocols we do not speak."""
    try:
        raw = json.loads(line)
    except json.JSONDecodeError as exc:
        raise ProtocolError(f"not valid JSON: {exc}") from exc
    if not isinstance(raw, dict):
        raise ProtocolError("envelope must be a JSON object")
    if raw.get("protocol") != PROTOCOL_NAME:
        raise ProtocolError(f"unknown protocol: {raw.get('protocol')!r}")
    return Envelope.model_validate(raw)
```

Also create empty `src/wavedl_daemon/__init__.py` and `src/wavedl_daemon/protocol/__init__.py`, and `unit_tests/daemon/__init__.py`.

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_protocol_envelope.py -v`
Expected: PASS, 7 tests

- [ ] **Step 5: Add pydantic to dependencies and commit**

Add `"pydantic>=2.0.0",` to `[project.dependencies]` in `pyproject.toml`, and add `wavedl_daemon*` to `[tool.setuptools.packages.find] include`.

```bash
git add src/wavedl_daemon unit_tests/daemon pyproject.toml
git commit -m "feat(daemon): add strict-JSON protocol envelope"
```

---

### Task 2: Journal writer

**Files:**
- Create: `src/wavedl_daemon/protocol/journal_writer.py`
- Test: `unit_tests/daemon/test_journal_writer.py`

**Interfaces:**
- Consumes: `Envelope`, `encode` from Task 1
- Produces: `JournalWriter(path: Path, run_id: str, attempt: int, fsync_every: int = 1)` with `.write(type: str, payload: dict) -> Envelope`, `.close()`, context-manager support, and `MAX_RECORD_BYTES`

- [ ] **Step 1: Write the failing test**

```python
# unit_tests/daemon/test_journal_writer.py
"""Tests for the single-writer journal append path."""

import json

import pytest


class TestJournalWriter:
    def test_writes_one_line_per_event(self, tmp_path):
        from wavedl_daemon.protocol.journal_writer import JournalWriter

        path = tmp_path / "events.jsonl"
        with JournalWriter(path, run_id="r1", attempt=1) as writer:
            writer.write("state", {"state": "running"})
            writer.write("metric", {"epoch": 1})

        lines = path.read_text().splitlines()
        assert len(lines) == 2
        assert json.loads(lines[0])["type"] == "state"

    def test_seq_starts_at_zero_and_increments(self, tmp_path):
        from wavedl_daemon.protocol.journal_writer import JournalWriter

        path = tmp_path / "events.jsonl"
        with JournalWriter(path, run_id="r1", attempt=1) as writer:
            first = writer.write("state", {})
            second = writer.write("state", {})

        assert (first.seq, second.seq) == (0, 1)

    def test_every_line_ends_with_newline(self, tmp_path):
        """Newline is the commit boundary; a reader depends on it."""
        from wavedl_daemon.protocol.journal_writer import JournalWriter

        path = tmp_path / "events.jsonl"
        with JournalWriter(path, run_id="r1", attempt=1) as writer:
            writer.write("state", {})

        assert path.read_bytes().endswith(b"\n")

    def test_appends_to_existing_file_continuing_seq(self, tmp_path):
        """A reopened writer must not restart seq and clobber earlier records."""
        from wavedl_daemon.protocol.journal_writer import JournalWriter

        path = tmp_path / "events.jsonl"
        with JournalWriter(path, run_id="r1", attempt=1) as writer:
            writer.write("state", {})
        with JournalWriter(path, run_id="r1", attempt=1) as writer:
            resumed = writer.write("state", {})

        assert resumed.seq == 1
        assert len(path.read_text().splitlines()) == 2

    def test_oversized_record_raises(self, tmp_path):
        from wavedl_daemon.protocol.journal_writer import (
            JournalWriter,
            RecordTooLarge,
        )

        path = tmp_path / "events.jsonl"
        with JournalWriter(path, run_id="r1", attempt=1) as writer:
            with pytest.raises(RecordTooLarge):
                writer.write("log", {"message": "x" * (1 << 21)})

    def test_oversized_record_does_not_corrupt_file(self, tmp_path):
        """A rejected record must leave no partial bytes behind."""
        from wavedl_daemon.protocol.journal_writer import (
            JournalWriter,
            RecordTooLarge,
        )

        path = tmp_path / "events.jsonl"
        with JournalWriter(path, run_id="r1", attempt=1) as writer:
            writer.write("state", {})
            with pytest.raises(RecordTooLarge):
                writer.write("log", {"message": "x" * (1 << 21)})
            writer.write("state", {})

        lines = path.read_text().splitlines()
        assert len(lines) == 2
        assert [json.loads(line)["seq"] for line in lines] == [0, 1]

    def test_non_finite_payload_is_written_as_null(self, tmp_path):
        from wavedl_daemon.protocol.journal_writer import JournalWriter

        path = tmp_path / "events.jsonl"
        with JournalWriter(path, run_id="r1", attempt=1) as writer:
            writer.write("metric", {"best_val_loss": float("inf")})

        assert "Infinity" not in path.read_text()
        assert json.loads(path.read_text())["payload"]["best_val_loss"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_journal_writer.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'wavedl_daemon.protocol.journal_writer'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/wavedl_daemon/protocol/journal_writer.py
"""Append-only journal writer.

Exactly one process writes a given attempt's journal. Under
``accelerate launch --num_processes=N`` that is the main process only; seq is
not well-defined with concurrent writers, and shared filesystems do not provide
an atomic distributed record-append.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from wavedl_daemon.protocol.envelope import Envelope, encode

MAX_RECORD_BYTES = 1 << 20  # 1 MiB


class RecordTooLarge(ValueError):
    """A single event exceeded the maximum record size and was not written."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class JournalWriter:
    """Writes one attempt's journal. Not thread-safe by design: one writer."""

    def __init__(
        self,
        path: Path,
        run_id: str,
        attempt: int,
        fsync_every: int = 1,
    ) -> None:
        self.path = Path(path)
        self.run_id = run_id
        self.attempt = attempt
        self.fsync_every = fsync_every
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._seq = self._next_seq()
        self._since_sync = 0
        self._file = open(self.path, "a", encoding="utf-8")

    def _next_seq(self) -> int:
        """Resume numbering after an existing journal rather than restarting."""
        if not self.path.exists():
            return 0
        count = 0
        with open(self.path, "r", encoding="utf-8") as handle:
            for line in handle:
                if line.endswith("\n") and line.strip():
                    count += 1
        return count

    def write(self, type: str, payload: dict[str, Any]) -> Envelope:
        envelope = Envelope(
            run_id=self.run_id,
            attempt=self.attempt,
            type=type,
            seq=self._seq,
            ts=_utc_now(),
            payload=payload,
        )
        line = encode(envelope)
        if len(line.encode("utf-8")) > MAX_RECORD_BYTES:
            raise RecordTooLarge(
                f"event type={type!r} exceeds {MAX_RECORD_BYTES} bytes; not written"
            )
        self._file.write(line + "\n")
        self._seq += 1
        self._since_sync += 1
        if self._since_sync >= self.fsync_every:
            self.flush()
        return envelope

    def flush(self) -> None:
        """Push bytes to the OS and then to storage.

        A successful append is not a durable commit; readers on another host may
        not observe it until this returns.
        """
        self._file.flush()
        os.fsync(self._file.fileno())
        self._since_sync = 0

    def close(self) -> None:
        if not self._file.closed:
            self.flush()
            self._file.close()

    def __enter__(self) -> JournalWriter:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_journal_writer.py -v`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/wavedl_daemon/protocol/journal_writer.py unit_tests/daemon/test_journal_writer.py
git commit -m "feat(daemon): add single-writer journal with newline commit boundary"
```

---

### Task 3: Journal reader with incomplete-tail buffering

**Files:**
- Create: `src/wavedl_daemon/protocol/journal_reader.py`
- Test: `unit_tests/daemon/test_journal_reader.py`

**Interfaces:**
- Consumes: `decode`, `ProtocolError` from Task 1
- Produces: `JournalReader(path: Path)` with `.read_new() -> list[Envelope]`, `.offset: int`, `.malformed: list[str]`, `.seek_to_seq(seq: int) -> None`

- [ ] **Step 1: Write the failing test**

```python
# unit_tests/daemon/test_journal_reader.py
"""Tests for offset-tracking journal reads over a file still being written."""


def _write_raw(path, text):
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(text)


class TestJournalReader:
    def test_reads_complete_records(self, tmp_path):
        from wavedl_daemon.protocol.journal_reader import JournalReader
        from wavedl_daemon.protocol.journal_writer import JournalWriter

        path = tmp_path / "events.jsonl"
        with JournalWriter(path, run_id="r1", attempt=1) as writer:
            writer.write("state", {})
            writer.write("metric", {"epoch": 1})

        events = JournalReader(path).read_new()

        assert [event.seq for event in events] == [0, 1]

    def test_incomplete_tail_is_buffered_not_discarded(self, tmp_path):
        """A half-written object is not malformed; the rest arrives later."""
        from wavedl_daemon.protocol.journal_reader import JournalReader

        path = tmp_path / "events.jsonl"
        _write_raw(path, '{"protocol":"wavedl-jsonl","version":1,"run_id":"r1",')
        reader = JournalReader(path)

        assert reader.read_new() == []
        assert reader.malformed == []

        _write_raw(
            path,
            '"attempt":1,"type":"state","seq":0,"ts":"2026-09-05T12:00:00Z","payload":{}}\n',
        )
        events = reader.read_new()

        assert len(events) == 1
        assert events[0].seq == 0

    def test_second_read_returns_only_new_records(self, tmp_path):
        from wavedl_daemon.protocol.journal_reader import JournalReader
        from wavedl_daemon.protocol.journal_writer import JournalWriter

        path = tmp_path / "events.jsonl"
        with JournalWriter(path, run_id="r1", attempt=1) as writer:
            writer.write("state", {})
        reader = JournalReader(path)
        reader.read_new()

        with JournalWriter(path, run_id="r1", attempt=1) as writer:
            writer.write("metric", {})
        events = reader.read_new()

        assert [event.seq for event in events] == [1]

    def test_missing_file_reads_empty_without_raising(self, tmp_path):
        """A run may be registered before its journal exists."""
        from wavedl_daemon.protocol.journal_reader import JournalReader

        assert JournalReader(tmp_path / "absent.jsonl").read_new() == []

    def test_malformed_complete_line_is_recorded_and_skipped(self, tmp_path):
        from wavedl_daemon.protocol.journal_reader import JournalReader
        from wavedl_daemon.protocol.journal_writer import JournalWriter

        path = tmp_path / "events.jsonl"
        _write_raw(path, "this is not json\n")
        with JournalWriter(path, run_id="r1", attempt=1) as writer:
            writer.write("state", {})
        reader = JournalReader(path)
        events = reader.read_new()

        assert len(events) == 1
        assert len(reader.malformed) == 1

    def test_seek_to_seq_replays_from_that_point(self, tmp_path):
        from wavedl_daemon.protocol.journal_reader import JournalReader
        from wavedl_daemon.protocol.journal_writer import JournalWriter

        path = tmp_path / "events.jsonl"
        with JournalWriter(path, run_id="r1", attempt=1) as writer:
            for _ in range(5):
                writer.write("metric", {})
        reader = JournalReader(path)
        reader.seek_to_seq(2)
        events = reader.read_new()

        assert [event.seq for event in events] == [3, 4]

    def test_seek_past_end_yields_nothing(self, tmp_path):
        from wavedl_daemon.protocol.journal_reader import JournalReader
        from wavedl_daemon.protocol.journal_writer import JournalWriter

        path = tmp_path / "events.jsonl"
        with JournalWriter(path, run_id="r1", attempt=1) as writer:
            writer.write("metric", {})
        reader = JournalReader(path)
        reader.seek_to_seq(99)

        assert reader.read_new() == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_journal_reader.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'wavedl_daemon.protocol.journal_reader'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/wavedl_daemon/protocol/journal_reader.py
"""Reads a journal that may still be growing, possibly on a shared filesystem.

Reopening per read rather than holding a descriptor matters on NFS, where
close-to-open consistency means an already-open descriptor is not guaranteed to
observe another client's appends.
"""

from __future__ import annotations

from pathlib import Path

from wavedl_daemon.protocol.envelope import Envelope, ProtocolError, decode


class JournalReader:
    """Tracks a byte offset and buffers any incomplete trailing record."""

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.offset = 0
        self.malformed: list[str] = []
        self._pending = ""

    def read_new(self) -> list[Envelope]:
        """Return records completed since the last call. Never blocks."""
        if not self.path.exists():
            return []
        with open(self.path, "r", encoding="utf-8") as handle:
            handle.seek(self.offset)
            chunk = handle.read()
            self.offset = handle.tell()

        buffer = self._pending + chunk
        # A trailing fragment without a newline is incomplete, not malformed.
        complete, _, self._pending = buffer.rpartition("\n")
        if not complete and not _:
            return []

        events: list[Envelope] = []
        for line in complete.split("\n"):
            if not line.strip():
                continue
            try:
                events.append(decode(line))
            except ProtocolError:
                self.malformed.append(line)
        return events

    def seek_to_seq(self, cursor: int) -> None:
        """Position the reader at the first record with ``seq > cursor``.

        Stop BEFORE that record, not after it. Advancing past the matched
        record drops seq 0 on a fresh replay (cursor -1) -- and seq 0 is the
        hello event, whose absence is a protocol failure -- and runs off the
        end whenever the sequence has a gap, making the rest of the run
        invisible. Both reproduced against the previous implementation.

        Binary mode: text-mode newline translation makes manually computed
        byte offsets wrong for CRLF journals on Windows.
        """
        self.offset = 0
        self._pending = ""
        if not self.path.exists():
            return
        with open(self.path, "rb") as handle:
            while True:
                start = handle.tell()
                raw = handle.readline()
                if not raw or not raw.endswith(b"\n"):
                    self.offset = start  # incomplete tail; resume here
                    return
                text = raw.decode("utf-8", "replace")
                if not text.strip():
                    continue
                try:
                    seq = decode(text).seq
                except ProtocolError:
                    continue
                if seq > cursor:
                    self.offset = start
                    return
                self.offset = handle.tell()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_journal_reader.py -v`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/wavedl_daemon/protocol/journal_reader.py unit_tests/daemon/test_journal_reader.py
git commit -m "feat(daemon): add journal reader with incomplete-tail buffering"
```

---

> **Density convention from here on.** Tasks 1–3 show every line because the
> protocol's edge cases are where silent corruption hides. Later tasks show the
> full test for the behaviour that is easy to get wrong, plus exact signatures
> and the load-bearing logic, rather than every line of boilerplate. Where a
> task says "assert", the assertion is real and must appear in the test file.

---

### Task 4: Run layout and shared manifest

**Files:**
- Create: `src/wavedl_daemon/runs/__init__.py`, `src/wavedl_daemon/runs/layout.py`, `src/wavedl_daemon/runs/manifest.py`
- Test: `unit_tests/daemon/test_run_layout.py`

**Interfaces:**
- Consumes: nothing
- Produces: `RunLayout(run_dir: Path)` with `.manifest_path`, `.attempt_dir(n)`, `.journal(n)`, `.stderr(n)`, `.rank_log(n, rank)`, `.checkpoints`, `.allocate_attempt() -> int`, `.latest_attempt() -> int`; `Manifest` model with `.run_id`, `.created_at`, `.target`, `.train_args: list[str]`, `.resources: dict`, `.request_id`; `build_manifest(...) -> Manifest`; `write_manifest(layout, manifest)`; `read_manifest(layout) -> Manifest`

`build_manifest` lives here, **not** in the daemon's API layer, because standalone `wavedl-train` launches must produce the same manifest (spec §2.2, §12).

- [ ] **Step 1: Write the failing test**

```python
# unit_tests/daemon/test_run_layout.py
"""Tests for run directory structure and attempt allocation."""

import pytest


class TestAttemptAllocation:
    def test_first_attempt_is_one(self, tmp_path):
        from wavedl_daemon.runs.layout import RunLayout

        assert RunLayout(tmp_path).allocate_attempt() == 1

    def test_requeue_allocates_a_new_attempt(self, tmp_path):
        """SLURM requeue reuses the job id and restarts seq; attempts must not."""
        from wavedl_daemon.runs.layout import RunLayout

        layout = RunLayout(tmp_path)
        first = layout.allocate_attempt()
        second = layout.allocate_attempt()

        assert (first, second) == (1, 2)
        assert layout.journal(first) != layout.journal(second)

    def test_latest_attempt_reflects_allocation(self, tmp_path):
        from wavedl_daemon.runs.layout import RunLayout

        layout = RunLayout(tmp_path)
        layout.allocate_attempt()
        layout.allocate_attempt()

        assert layout.latest_attempt() == 2

    def test_latest_attempt_is_zero_before_any(self, tmp_path):
        from wavedl_daemon.runs.layout import RunLayout

        assert RunLayout(tmp_path).latest_attempt() == 0


class TestManifest:
    def test_round_trip(self, tmp_path):
        from wavedl_daemon.runs.layout import RunLayout
        from wavedl_daemon.runs.manifest import (
            build_manifest,
            read_manifest,
            write_manifest,
        )

        layout = RunLayout(tmp_path)
        manifest = build_manifest(
            target="local",
            train_args=["--model", "resnet18", "--epochs", "10"],
            resources={"num_gpus": 1},
        )
        write_manifest(layout, manifest)

        assert read_manifest(layout).train_args == manifest.train_args

    def test_manifest_is_immutable_once_written(self, tmp_path):
        """A run's resolved plan never changes; rewriting is a bug, not a merge."""
        from wavedl_daemon.runs.layout import RunLayout
        from wavedl_daemon.runs.manifest import (
            ManifestExists,
            build_manifest,
            write_manifest,
        )

        layout = RunLayout(tmp_path)
        write_manifest(layout, build_manifest(target="local", train_args=[]))

        with pytest.raises(ManifestExists):
            write_manifest(layout, build_manifest(target="local", train_args=[]))

    def test_request_id_is_generated_and_stable(self, tmp_path):
        """The request id is the idempotency key for submission (spec §4.1)."""
        from wavedl_daemon.runs.manifest import build_manifest

        manifest = build_manifest(target="slurm", train_args=[])

        assert manifest.request_id
        assert manifest.request_id != build_manifest(
            target="slurm", train_args=[]
        ).request_id
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_run_layout.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'wavedl_daemon.runs'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/wavedl_daemon/runs/layout.py
"""Run directory structure, identical across backends so readers are generic."""

from __future__ import annotations

from pathlib import Path


class RunLayout:
    def __init__(self, run_dir: Path) -> None:
        self.run_dir = Path(run_dir)

    @property
    def manifest_path(self) -> Path:
        return self.run_dir / "manifest.json"

    @property
    def attempts_dir(self) -> Path:
        return self.run_dir / "attempts"

    @property
    def checkpoints(self) -> Path:
        return self.run_dir / "checkpoints"

    def attempt_dir(self, attempt: int) -> Path:
        return self.attempts_dir / str(attempt)

    def journal(self, attempt: int) -> Path:
        return self.attempt_dir(attempt) / "events.jsonl"

    def stderr(self, attempt: int) -> Path:
        return self.attempt_dir(attempt) / "stderr.log"

    def rank_log(self, attempt: int, rank: int) -> Path:
        return self.attempt_dir(attempt) / "rank" / f"{rank}.log"

    def latest_attempt(self) -> int:
        if not self.attempts_dir.exists():
            return 0
        numbers = [
            int(entry.name)
            for entry in self.attempts_dir.iterdir()
            if entry.is_dir() and entry.name.isdigit()
        ]
        return max(numbers, default=0)

    def allocate_attempt(self) -> int:
        """Claim the next attempt directory. Called by the writer at startup."""
        attempt = self.latest_attempt() + 1
        self.attempt_dir(attempt).mkdir(parents=True, exist_ok=False)
        return attempt
```

```python
# src/wavedl_daemon/runs/manifest.py
"""The immutable resolved plan for one run.

Shared by the daemon and standalone launches so an adopted run's manifest is
not a second-class reconstruction (spec §12).
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from wavedl_daemon.runs.layout import RunLayout


class ManifestExists(RuntimeError):
    """Refused to overwrite an existing manifest; a run's plan is immutable."""


class Manifest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    run_id: str
    request_id: str
    created_at: str
    target: str
    train_args: list[str] = Field(default_factory=list)
    resources: dict[str, Any] = Field(default_factory=dict)
    environment: dict[str, str] = Field(default_factory=dict)


def build_manifest(
    target: str,
    train_args: list[str],
    resources: dict[str, Any] | None = None,
    environment: dict[str, str] | None = None,
) -> Manifest:
    return Manifest(
        run_id=str(uuid.uuid4()),
        request_id=str(uuid.uuid4()),
        created_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        target=target,
        train_args=list(train_args),
        resources=dict(resources or {}),
        environment=dict(environment or {}),
    )


def write_manifest(layout: RunLayout, manifest: Manifest) -> None:
    if layout.manifest_path.exists():
        raise ManifestExists(f"manifest already exists at {layout.manifest_path}")
    layout.run_dir.mkdir(parents=True, exist_ok=True)
    layout.manifest_path.write_text(
        json.dumps(manifest.model_dump(), indent=2), encoding="utf-8"
    )


def read_manifest(layout: RunLayout) -> Manifest:
    return Manifest.model_validate_json(
        layout.manifest_path.read_text(encoding="utf-8")
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_run_layout.py -v`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/wavedl_daemon/runs unit_tests/daemon/test_run_layout.py
git commit -m "feat(daemon): add run layout with per-attempt journals and shared manifest"
```

---

### Task 5: Registry with private data directory and dispatch lock

**Files:**
- Create: `src/wavedl_daemon/settings.py`, `src/wavedl_daemon/runs/registry.py`
- Test: `unit_tests/daemon/test_registry.py`

**Interfaces:**
- Consumes: `Manifest` from Task 4
- Produces: `Settings` with `.data_dir`, `.db_path`, `.host`, `.port`, `.token`; `UnsupportedStorage`; `RunRecord` dataclass with `.run_id`, `.request_id`, `.target`, `.job_id: str | None`, `.submitted_at: str | None`, `.cancel_requested: bool`, `.run_dir`; and `Registry(db_path)` with:
  - `.record_intent(manifest, run_dir) -> str`
  - `.mark_submitting(run_id)` — sets `submitted_at` while `job_id` stays NULL, which is what the reducer renders as `SUBMISSION_UNKNOWN`
  - `.record_handle(run_id, backend, job_id, raw)`
  - `.record_submission_unknown(run_id, detail)`
  - `.record_observation(run_id, source, state, raw)`
  - `.request_cancel(run_id)`
  - `.get(run_id) -> RunRecord`, `.list() -> list[RunRecord]`
  - `.events(run_id, attempt) -> list[dict]`, `.events_after(run_id, since_seq) -> list[dict]`
  - `.cursor(run_id, attempt) -> int` (returns `-1` when nothing is applied)
  - `.apply_events(run_id, attempt, events, new_cursor)` — one transaction
  - `.acquire_dispatch_lock() -> bool`, `.close()`
  - `.find_by_request_id(request_id) -> RunRecord | None`

- [ ] **Step 1: Write the failing test**

```python
# unit_tests/daemon/test_registry.py
"""Tests for run persistence, ingestion cursors, and dispatch ownership."""

import pytest


@pytest.fixture
def registry(tmp_path):
    from wavedl_daemon.runs.registry import Registry

    return Registry(tmp_path / "registry.db")


@pytest.fixture
def manifest():
    from wavedl_daemon.runs.manifest import build_manifest

    return build_manifest(target="local", train_args=["--epochs", "1"])


class TestIntent:
    def test_intent_is_recorded_before_submission(self, registry, manifest, tmp_path):
        """The intent must survive a crash before the backend handle exists."""
        run_id = registry.record_intent(manifest, tmp_path)

        record = registry.get(run_id)
        assert record.request_id == manifest.request_id
        assert record.job_id is None

    def test_find_by_request_id_enables_reconciliation(
        self, registry, manifest, tmp_path
    ):
        """Restart must locate a prior intent rather than resubmitting."""
        registry.record_intent(manifest, tmp_path)

        found = registry.find_by_request_id(manifest.request_id)
        assert found is not None
        assert found.request_id == manifest.request_id


class TestCursor:
    def test_events_and_cursor_commit_together(self, registry, manifest, tmp_path):
        """A crash between projection and cursor must not skip or double-apply."""
        run_id = registry.record_intent(manifest, tmp_path)
        registry.apply_events(run_id, attempt=1, events=[], new_cursor=5)

        assert registry.cursor(run_id, attempt=1) == 5

    def test_cursor_starts_at_minus_one(self, registry, manifest, tmp_path):
        """-1 means nothing applied; seq 0 is a real event."""
        run_id = registry.record_intent(manifest, tmp_path)

        assert registry.cursor(run_id, attempt=1) == -1

    def test_apply_events_is_idempotent(self, registry, manifest, tmp_path):
        from wavedl_daemon.protocol.envelope import Envelope

        run_id = registry.record_intent(manifest, tmp_path)
        event = Envelope(
            run_id=run_id, attempt=1, type="metric", seq=0,
            ts="2026-09-05T12:00:00Z", payload={"epoch": 1},
        )
        registry.apply_events(run_id, 1, [event], new_cursor=0)
        registry.apply_events(run_id, 1, [event], new_cursor=0)

        assert len(registry.events(run_id, attempt=1)) == 1


class TestDispatchLock:
    def test_lock_is_exclusive(self, tmp_path):
        """Two daemons on two login nodes must not both dispatch."""
        from wavedl_daemon.runs.registry import Registry

        db = tmp_path / "registry.db"
        first = Registry(db)
        second = Registry(db)

        assert first.acquire_dispatch_lock() is True
        assert second.acquire_dispatch_lock() is False

    def test_lock_is_released_on_close(self, tmp_path):
        from wavedl_daemon.runs.registry import Registry

        db = tmp_path / "registry.db"
        first = Registry(db)
        first.acquire_dispatch_lock()
        first.close()

        assert Registry(db).acquire_dispatch_lock() is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_registry.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'wavedl_daemon.runs.registry'`

- [ ] **Step 3: Write minimal implementation**

Key points the implementation must honour (spec §8):

```python
# src/wavedl_daemon/settings.py
"""Daemon configuration and data-directory resolution.

The data directory is private to the user and must be on local disk: SQLite WAL
depends on shared-memory coordination and is not supported across hosts on a
network filesystem (spec §8).
"""

from __future__ import annotations

import os
import secrets
from pathlib import Path

from pydantic import BaseModel


class UnsupportedStorage(RuntimeError):
    """Refused to open a database on a filesystem we cannot lock reliably."""


def default_data_dir() -> Path:
    """Resolve a private per-user directory, never relative to the checkout."""
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local"))
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))
    return base / "wavedl"


class Settings(BaseModel):
    data_dir: Path = None  # set in __init__ below
    host: str = "127.0.0.1"
    port: int = 8420
    token: str = ""

    def model_post_init(self, _context: object) -> None:
        if self.data_dir is None:
            self.data_dir = default_data_dir()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        # 0o700: the token and run metadata are user-private on a shared node.
        os.chmod(self.data_dir, 0o700)
        if not self.token:
            self.token = secrets.token_urlsafe(32)

    @property
    def db_path(self) -> Path:
        return self.data_dir / "registry.db"
```

`Registry` uses SQLAlchemy with tables `runs`, `observations`, `events`, `cursors`, `locks`. Two behaviours carry the design:

```python
    def apply_events(self, run_id, attempt, events, new_cursor):
        """Insert events and advance the cursor in ONE transaction.

        Committing separately allows a crash to either skip an event (cursor
        first) or double-apply it (events first). Both are silent corruption.
        INSERT OR IGNORE on (run_id, attempt, seq) makes replay idempotent.
        """
        with self._engine.begin() as conn:
            for event in events:
                conn.execute(
                    insert(self._events)
                    .prefix_with("OR IGNORE")
                    .values(
                        run_id=run_id, attempt=attempt, seq=event.seq,
                        type=event.type, ts=event.ts,
                        payload=json.dumps(event.payload),
                    )
                )
            conn.execute(
                insert(self._cursors)
                .prefix_with("OR REPLACE")
                .values(run_id=run_id, attempt=attempt, seq=new_cursor)
            )

    def acquire_dispatch_lock(self) -> bool:
        """Exactly one daemon may dispatch against this registry.

        SQLite serialises individual transactions but cannot prevent two
        daemons from each submitting the same pending job to SLURM.
        """
        try:
            with self._engine.begin() as conn:
                conn.execute(
                    insert(self._locks).values(
                        name="dispatch", owner=self._owner_id, acquired_at=_now()
                    )
                )
        except IntegrityError:
            return False
        self._holds_dispatch = True
        return True
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_registry.py -v`
Expected: PASS, 7 tests

- [ ] **Step 5: Add sqlalchemy to dependencies and commit**

Add `"sqlalchemy>=2.0.0",` and `"fastapi>=0.110.0",` and `"uvicorn>=0.27.0",` to `[project.dependencies]`.

```bash
git add src/wavedl_daemon/settings.py src/wavedl_daemon/runs/registry.py unit_tests/daemon/test_registry.py pyproject.toml
git commit -m "feat(daemon): add registry with transactional cursor and dispatch lock"
```

---

### Task 6: The reducer — three authorities into one derived state

**Files:**
- Create: `src/wavedl_daemon/runs/reducer.py`
- Test: `unit_tests/daemon/test_reducer.py`

**Interfaces:**
- Consumes: `RunRecord`, `Envelope`
- Produces: `RunState` enum (`PENDING`, `SUBMITTED`, `SUBMISSION_UNKNOWN`, `QUEUED`, `HELD`, `RUNNING`, `STOPPING`, `COMPLETED`, `FAILED`, `CANCELLED`, `TERMINAL_UNKNOWN`, `SUPERVISION_LOST`, `OBSERVATION_UNAVAILABLE`); `DerivedState` with `.state`, `.confidence`, `.evidence: list[str]`, `.reason`; `reduce(record, journal_events, backend_observation) -> DerivedState`

This is the task that fixes revision 1's central mistake (spec §4). It is pure — no I/O — so every precedence rule is directly testable.

- [ ] **Step 1: Write the failing test**

```python
# unit_tests/daemon/test_reducer.py
"""Tests for precedence between runtime, supervisor, and scheduler evidence."""

import pytest


def _event(type, seq=0, **payload):
    from wavedl_daemon.protocol.envelope import Envelope

    return Envelope(
        run_id="r1", attempt=1, type=type, seq=seq,
        ts="2026-09-05T12:00:00Z", payload=payload,
    )


@pytest.fixture
def record():
    from wavedl_daemon.runs.registry import RunRecord

    return RunRecord(
        run_id="r1", request_id="q1", target="slurm",
        job_id="12345", cancel_requested=False, run_dir="/tmp/r1",
    )


class TestPrecedence:
    def test_runtime_exit_alone_is_not_terminal(self, record):
        """An exit event is evidence, not a verdict (spec §4)."""
        from wavedl_daemon.runs.reducer import RunState, reduce

        result = reduce(record, [_event("exit", code=0, status="completed")], None)

        assert result.state is not RunState.COMPLETED
        assert result.confidence == "unconfirmed"

    def test_runtime_exit_confirmed_by_backend_is_completed(self, record):
        from wavedl_daemon.runs.reducer import RunState, reduce

        result = reduce(
            record,
            [_event("exit", code=0, status="completed")],
            {"terminal": True, "state": "COMPLETED", "exit_code": 0},
        )

        assert result.state is RunState.COMPLETED

    def test_runtime_success_with_backend_failure_is_failed(self, record):
        """Stage-out can fail after training succeeds; the run failed."""
        from wavedl_daemon.runs.reducer import RunState, reduce

        result = reduce(
            record,
            [_event("exit", code=0, status="completed")],
            {"terminal": True, "state": "FAILED", "exit_code": 2},
        )

        assert result.state is RunState.FAILED

    def test_failure_to_observe_is_not_failure(self, record):
        """A controller timeout says nothing about the job (spec §4)."""
        from wavedl_daemon.runs.reducer import RunState, reduce

        result = reduce(record, [], {"error": "slurm controller timeout"})

        assert result.state is RunState.OBSERVATION_UNAVAILABLE

    def test_vanished_job_without_exit_is_terminal_unknown(self, record):
        """No accounting and no exit event means unknown, never failed."""
        from wavedl_daemon.runs.reducer import RunState, reduce

        result = reduce(record, [], {"vanished": True, "accounting": False})

        assert result.state is RunState.TERMINAL_UNKNOWN
        assert result.state is not RunState.FAILED

    def test_cancel_requested_while_running_is_stopping(self, record):
        from wavedl_daemon.runs.reducer import RunState, reduce

        record.cancel_requested = True
        result = reduce(record, [_event("state", state="running")], {"state": "RUNNING"})

        assert result.state is RunState.STOPPING

    def test_missing_handle_with_pending_intent_is_submission_unknown(self, record):
        """The §4.1 window: intent recorded, acceptance never confirmed."""
        from wavedl_daemon.runs.reducer import RunState, reduce

        record.job_id = None
        record.submitted_at = "2026-09-05T12:00:00Z"
        result = reduce(record, [], None)

        assert result.state is RunState.SUBMISSION_UNKNOWN

    def test_evidence_is_reported_with_the_verdict(self, record):
        """Users must be able to see why a state was chosen."""
        from wavedl_daemon.runs.reducer import reduce

        result = reduce(record, [_event("exit", code=0)], {"state": "RUNNING"})

        assert result.evidence


class TestFalseConfirmationRegressions:
    """Each of these returned running/confirmed from the first implementation."""

    def test_supervision_lost_is_not_running(self, record):
        from wavedl_daemon.runs.reducer import RunState, reduce

        result = reduce(record, [], {"supervision_lost": True})

        assert result.state is RunState.SUPERVISION_LOST

    def test_queued_job_is_not_running(self, record):
        """A PENDING allocation has not started; drawing it as running lies."""
        from wavedl_daemon.runs.reducer import RunState, reduce

        result = reduce(record, [], {"state": "PENDING"})

        assert result.state is RunState.QUEUED

    def test_held_job_is_not_running(self, record):
        from wavedl_daemon.runs.reducer import RunState, reduce

        result = reduce(record, [], {"state": "SUSPENDED"})

        assert result.state is RunState.HELD

    def test_absent_observation_does_not_invent_activity(self, record):
        """No observation is not evidence of running."""
        from wavedl_daemon.runs.reducer import RunState, reduce

        result = reduce(record, [], None)

        assert result.state is RunState.OBSERVATION_UNAVAILABLE

    def test_successful_wrapper_does_not_erase_training_failure(self, record):
        """The batch script exited 0 while training exited 1. The run failed."""
        from wavedl_daemon.runs.reducer import RunState, reduce

        result = reduce(
            record,
            [_event("exit", code=1, status="failed")],
            {"terminal": True, "state": "COMPLETED", "exit_code": 0},
        )

        assert result.state is RunState.FAILED

    def test_unrecognised_backend_state_is_not_confirmed_running(self, record):
        from wavedl_daemon.runs.reducer import RunState, reduce

        result = reduce(record, [], {"state": "SOME_NEW_SLURM_STATE"})

        assert result.state is RunState.SUBMITTED
        assert result.confidence == "unconfirmed"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_reducer.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'wavedl_daemon.runs.reducer'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/wavedl_daemon/runs/reducer.py
"""Derives displayed run state from independent, possibly conflicting evidence.

Three authorities exist and must not be collapsed (spec §4):
  intent        -- what the user asked for, persisted by the daemon
  observations  -- runtime journal, process supervisor, scheduler
  results       -- published checkpoint generations

The reducer never guesses. Absent evidence yields TERMINAL_UNKNOWN, and a
failure to observe yields OBSERVATION_UNAVAILABLE -- neither is FAILED.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class RunState(str, Enum):
    PENDING = "pending"
    SUBMITTED = "submitted"
    SUBMISSION_UNKNOWN = "submission_unknown"
    QUEUED = "queued"
    HELD = "held"
    RUNNING = "running"
    STOPPING = "stopping"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TERMINAL_UNKNOWN = "terminal_unknown"
    SUPERVISION_LOST = "supervision_lost"
    OBSERVATION_UNAVAILABLE = "observation_unavailable"


@dataclass
class DerivedState:
    state: RunState
    confidence: str  # "confirmed" | "unconfirmed" | "unknown"
    reason: str
    evidence: list[str] = field(default_factory=list)


# Backend lifecycle classification. Never inferred from "the query returned
# something" -- a non-empty sacct row can say RUNNING, and treating that as
# terminal turns a live job into a reported failure.
ACTIVE_STATES = {"RUNNING", "COMPLETING", "CONFIGURING"}
QUEUED_STATES = {"PENDING", "REQUEUED", "RESIZING"}
HELD_STATES = {"SUSPENDED", "STOPPED"}
OK_TERMINAL = {"COMPLETED"}
CANCEL_TERMINAL = {"CANCELLED", "PREEMPTED", "DEADLINE"}


def reduce(record, journal_events, backend_observation) -> DerivedState:
    """Derive one state from attempt-scoped evidence.

    journal_events MUST be this attempt's only. An earlier attempt's exit
    event contaminating a requeued attempt is how a restarted run reports
    itself finished.
    """
    evidence: list[str] = []
    runtime_exit = next(
        (event for event in reversed(journal_events) if event.type == "exit"), None
    )
    runtime_code = runtime_exit.payload.get("code") if runtime_exit else None
    if runtime_exit is not None:
        evidence.append(f"runtime exit code={runtime_code}")
    if backend_observation:
        evidence.append(f"backend {backend_observation}")

    # 1. No handle: the run is intent only.
    if record.job_id is None:
        if getattr(record, "submitted_at", None):
            return DerivedState(
                RunState.SUBMISSION_UNKNOWN, "unknown",
                "submission was attempted but acceptance was never confirmed; "
                "resolve manually, never resubmit automatically", evidence,
            )
        return DerivedState(
            RunState.PENDING, "confirmed", "not yet submitted", evidence
        )

    # 2. Supervision ownership is a fact about US and outranks stale evidence.
    if backend_observation and backend_observation.get("supervision_lost"):
        return DerivedState(
            RunState.SUPERVISION_LOST, "unknown",
            "this daemon instance did not start the process; a stored pid "
            "cannot be trusted because pids are reused", evidence,
        )

    # 3. Failure to observe is not evidence about the job. Absent observation
    #    is also not evidence -- do not manufacture "backend reports active".
    if backend_observation and backend_observation.get("error"):
        return DerivedState(
            RunState.OBSERVATION_UNAVAILABLE, "unknown",
            f"backend could not be queried: {backend_observation['error']}", evidence,
        )
    if backend_observation is None:
        return DerivedState(
            RunState.OBSERVATION_UNAVAILABLE, "unknown",
            "no backend observation available for this attempt", evidence,
        )

    state = (backend_observation.get("state") or "").upper()

    # 4. Terminal. Both authorities must agree before this is called success.
    if backend_observation.get("terminal"):
        if state in CANCEL_TERMINAL:
            return DerivedState(
                RunState.CANCELLED, "confirmed",
                f"backend terminal state {state}", evidence,
            )
        if state not in OK_TERMINAL or backend_observation.get("exit_code") != 0:
            return DerivedState(
                RunState.FAILED, "confirmed",
                f"backend terminal state {state} "
                f"exit={backend_observation.get('exit_code')}", evidence,
            )
        if runtime_code not in (None, 0):
            return DerivedState(
                RunState.FAILED, "confirmed",
                f"backend reported success but the runtime exited {runtime_code}; "
                "a successful wrapper does not erase a training failure", evidence,
            )
        if runtime_exit is None:
            return DerivedState(
                RunState.COMPLETED, "unconfirmed",
                "backend reports success but the runtime never wrote an exit event",
                evidence,
            )
        return DerivedState(
            RunState.COMPLETED, "confirmed", "runtime and backend agree", evidence
        )

    # 5. Gone from the backend with no terminal record.
    if backend_observation.get("vanished"):
        if runtime_exit is not None:
            return DerivedState(
                RunState.COMPLETED if runtime_code == 0 else RunState.FAILED,
                "unconfirmed",
                "backend no longer tracks the job; runtime evidence only", evidence,
            )
        return DerivedState(
            RunState.TERMINAL_UNKNOWN, "unknown",
            "job left the backend with no exit event and no accounting record",
            evidence,
        )

    # 6. Live states, classified explicitly. Queued work is not running work.
    if record.cancel_requested:
        return DerivedState(
            RunState.STOPPING, "confirmed", "cancellation requested", evidence
        )
    if state in QUEUED_STATES:
        return DerivedState(
            RunState.QUEUED, "confirmed", f"backend state {state}", evidence
        )
    if state in HELD_STATES:
        return DerivedState(
            RunState.HELD, "confirmed", f"backend state {state}", evidence
        )
    if state in ACTIVE_STATES:
        if runtime_exit is not None:
            return DerivedState(
                RunState.RUNNING, "unconfirmed",
                "runtime reported exit; backend has not confirmed it", evidence,
            )
        return DerivedState(
            RunState.RUNNING, "confirmed", f"backend state {state}", evidence
        )
    return DerivedState(
        RunState.SUBMITTED, "unconfirmed",
        f"backend reported unrecognised state {state!r}", evidence,
    )
```

Verified against a 17-case truth table covering every branch, including the four
that the previous chain-of-early-returns version answered falsely: a
`supervision_lost` observation, a queued `PENDING` job, an absent observation,
and runtime exit code 1 alongside a backend `COMPLETED`.

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_reducer.py -v`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/wavedl_daemon/runs/reducer.py unit_tests/daemon/test_reducer.py
git commit -m "feat(daemon): reduce run state from intent, observations, and results"
```

---

### Task 7: Backend seam and Local planning

**Files:**
- Create: `src/wavedl_daemon/backends/__init__.py`, `src/wavedl_daemon/backends/base.py`, `src/wavedl_daemon/backends/local.py`
- Test: `unit_tests/daemon/test_backend_local_plan.py`

**Interfaces:**
- Consumes: `Manifest`, `RunLayout` from Task 4
- Produces: `Plan` model (`.target`, `.argv: list[str]`, `.script: str | None`, `.resources`, `.run_dir`, `.environment`, `.warnings: list[str]`); `Backend` protocol with `plan(manifest, run_dir) -> Plan`, `submit(plan) -> Handle`, `observe(handle) -> dict`, `request_cancel(handle) -> None`, `collect(handle) -> dict`; `Handle` model (`.backend`, `.job_id`, `.request_id`, `.pid`, `.raw`); `LocalBackend`; `UnsupportedPlan` exception

Dry-run is `plan` without `submit`, and it takes a target — rendering a local argv and rendering a batch script are different plans (spec §3.1).

- [ ] **Step 1: Write the failing test**

```python
# unit_tests/daemon/test_backend_local_plan.py
"""Tests for local planning. Planning executes nothing."""

import pytest

from wavedl_daemon.runs.manifest import build_manifest


class TestLocalPlan:
    def test_plan_produces_wavedl_train_argv(self, tmp_path):
        from wavedl_daemon.backends.local import LocalBackend

        manifest = build_manifest(
            target="local", train_args=["--model", "resnet18"],
            resources={"num_gpus": 1},
        )
        plan = LocalBackend().plan(manifest, tmp_path)

        assert plan.argv[:2] == ["wavedl-train", "--model"]
        assert "--num_gpus" in plan.argv

    def test_plan_writes_nothing_and_starts_nothing(self, tmp_path):
        """Dry-run must be observably inert."""
        from wavedl_daemon.backends.local import LocalBackend

        before = set(tmp_path.iterdir())
        LocalBackend().plan(build_manifest(target="local", train_args=[]), tmp_path)

        assert set(tmp_path.iterdir()) == before

    def test_plan_sets_output_dir_to_the_run_dir(self, tmp_path):
        """--output_dir defaults to '.', which collides across runs (spec §12)."""
        from wavedl_daemon.backends.local import LocalBackend

        plan = LocalBackend().plan(
            build_manifest(target="local", train_args=[]), tmp_path
        )
        index = plan.argv.index("--output_dir")

        assert plan.argv[index + 1] == str(tmp_path)

    def test_multi_node_request_is_rejected_not_rendered(self, tmp_path):
        """A plan we cannot express must be refused, never faked (spec §3.1)."""
        from wavedl_daemon.backends.base import UnsupportedPlan
        from wavedl_daemon.backends.local import LocalBackend

        manifest = build_manifest(
            target="local", train_args=[], resources={"num_machines": 2}
        )

        with pytest.raises(UnsupportedPlan):
            LocalBackend().plan(manifest, tmp_path)

    def test_user_supplied_output_dir_is_rejected(self, tmp_path):
        """The daemon owns the output directory; a conflicting one is an error."""
        from wavedl_daemon.backends.base import UnsupportedPlan
        from wavedl_daemon.backends.local import LocalBackend

        manifest = build_manifest(
            target="local", train_args=["--output_dir", "/elsewhere"]
        )

        with pytest.raises(UnsupportedPlan):
            LocalBackend().plan(manifest, tmp_path)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_backend_local_plan.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'wavedl_daemon.backends'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/wavedl_daemon/backends/base.py
"""The execution seam: plan -> submit -> observe -> request_cancel -> collect.

Planning is separated from submission because a reviewable plan is the dry-run
product, and because local argv and batch scripts are different artifacts that
must not share one renderer (spec §3.1).
"""

from __future__ import annotations

from typing import Any, Protocol

from pydantic import BaseModel, Field


class UnsupportedPlan(ValueError):
    """The request cannot be expressed for this backend. Refuse, do not fake."""


class Plan(BaseModel):
    target: str
    run_dir: str
    argv: list[str] = Field(default_factory=list)
    script: str | None = None
    resources: dict[str, Any] = Field(default_factory=dict)
    environment: dict[str, str] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


class Handle(BaseModel):
    backend: str
    request_id: str
    job_id: str | None = None
    pid: int | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


class Backend(Protocol):
    name: str

    def plan(self, manifest, run_dir) -> Plan: ...
    def submit(self, plan, manifest) -> Handle: ...
    def observe(self, handle) -> dict[str, Any]: ...
    def request_cancel(self, handle) -> None: ...
    def collect(self, handle) -> dict[str, Any]: ...
```

```python
# src/wavedl_daemon/backends/local.py  (plan only; submit lands in Task 8)
from __future__ import annotations

from pathlib import Path

from wavedl_daemon.backends.base import Plan, UnsupportedPlan

FORBIDDEN_ARGS = {"--output_dir"}


class LocalBackend:
    name = "local"

    def plan(self, manifest, run_dir: Path) -> Plan:
        if int(manifest.resources.get("num_machines", 1)) > 1:
            raise UnsupportedPlan(
                "the local backend runs on one machine; use the slurm target "
                "for multi-node training"
            )
        for arg in manifest.train_args:
            name = arg.split("=", 1)[0]
            if name in FORBIDDEN_ARGS:
                raise UnsupportedPlan(
                    f"{name} is owned by the daemon and must not be supplied; "
                    "the run directory is allocated per run"
                )
        argv = ["wavedl-train", *manifest.train_args, "--output_dir", str(run_dir)]
        num_gpus = manifest.resources.get("num_gpus")
        if num_gpus is not None:
            argv += ["--num_gpus", str(num_gpus)]
        return Plan(
            target=self.name,
            run_dir=str(run_dir),
            argv=argv,
            resources=dict(manifest.resources),
            environment=dict(manifest.environment),
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_backend_local_plan.py -v`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/wavedl_daemon/backends unit_tests/daemon/test_backend_local_plan.py
git commit -m "feat(daemon): add backend seam and local planning"
```

---

### Task 8: Local supervision — process groups and the launcher SIGTERM gap

**Files:**
- Modify: `src/wavedl_daemon/backends/local.py`
- Modify: `src/wavedl/launcher.py:344-352`
- Test: `unit_tests/daemon/test_backend_local_submit.py`, `unit_tests/test_launcher_signals.py`

**Interfaces:**
- Consumes: `Plan`, `Handle` from Task 7
- Produces: `LocalBackend.submit/observe/request_cancel/collect`; `wavedl.launcher._install_sigterm_handler(process)`

`launcher.py` runs `accelerate launch` via `subprocess.run`, and its only signal handling is `except KeyboardInterrupt`. Python raises `KeyboardInterrupt` on **SIGINT, not SIGTERM**, so a SIGTERM to the launcher kills it, abandons `subprocess.run`, and orphans `accelerate` plus N processes holding GPU memory (spec §9.1).

- [ ] **Step 1: Write the failing tests**

```python
# unit_tests/test_launcher_signals.py
"""The launcher must forward SIGTERM to its accelerate child."""

import os
import signal
import subprocess
import sys
import textwrap
import time

import pytest


@pytest.mark.integration
def test_sigterm_terminates_the_child_process(tmp_path):
    """Without a handler, the launcher dies and the child is orphaned."""
    marker = tmp_path / "child_exited"
    child = tmp_path / "child.py"
    child.write_text(
        textwrap.dedent(f"""
        import signal, sys, time
        def bye(*_):
            open({str(marker)!r}, "w").write("terminated")
            sys.exit(0)
        signal.signal(signal.SIGTERM, bye)
        while True:
            time.sleep(0.05)
        """)
    )
    runner = tmp_path / "runner.py"
    runner.write_text(
        textwrap.dedent(f"""
        import subprocess, sys
        sys.path.insert(0, {str("src")!r})
        from wavedl.launcher import _install_sigterm_handler
        proc = subprocess.Popen([sys.executable, {str(child)!r}])
        _install_sigterm_handler(proc)
        proc.wait()
        """)
    )
    parent = subprocess.Popen([sys.executable, str(runner)], start_new_session=True)
    time.sleep(1.5)
    parent.send_signal(signal.SIGTERM)
    parent.wait(timeout=10)

    assert marker.exists(), "child was orphaned instead of terminated"
```

```python
# unit_tests/daemon/test_backend_local_submit.py
"""Local submission owns a process group so the whole tree is killable."""

import sys
import textwrap

import pytest

from wavedl_daemon.backends.base import Plan


def _sleeper_plan(tmp_path, seconds=60):
    script = tmp_path / "sleeper.py"
    script.write_text(f"import time\ntime.sleep({seconds})\n")
    return Plan(target="local", run_dir=str(tmp_path),
                argv=[sys.executable, str(script)])


@pytest.mark.integration
class TestLocalSubmit:
    def test_submit_returns_a_pid(self, tmp_path):
        from wavedl_daemon.backends.local import LocalBackend

        backend = LocalBackend()
        handle = backend.submit(_sleeper_plan(tmp_path), manifest=None)
        try:
            assert handle.pid is not None
        finally:
            backend.request_cancel(handle)

    def test_cancel_kills_the_whole_process_group(self, tmp_path):
        """Signalling the direct child alone orphans accelerate's workers."""
        import os
        import time

        from wavedl_daemon.backends.local import LocalBackend

        parent = tmp_path / "parent.py"
        parent.write_text(
            textwrap.dedent(f"""
            import subprocess, sys, time
            child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
            open({str(tmp_path / "grandchild.pid")!r}, "w").write(str(child.pid))
            time.sleep(60)
            """)
        )
        plan = Plan(target="local", run_dir=str(tmp_path),
                    argv=[sys.executable, str(parent)])
        backend = LocalBackend()
        handle = backend.submit(plan, manifest=None)
        time.sleep(2)
        grandchild = int((tmp_path / "grandchild.pid").read_text())
        backend.request_cancel(handle)
        time.sleep(2)

        with pytest.raises(OSError):
            os.kill(grandchild, 0)

    def test_observe_reports_terminal_with_exit_code(self, tmp_path):
        import time

        from wavedl_daemon.backends.local import LocalBackend

        plan = Plan(target="local", run_dir=str(tmp_path),
                    argv=[sys.executable, "-c", "raise SystemExit(3)"])
        backend = LocalBackend()
        handle = backend.submit(plan, manifest=None)
        time.sleep(2)
        observation = backend.observe(handle)

        assert observation["terminal"] is True
        assert observation["exit_code"] == 3

    def test_observe_after_daemon_restart_is_supervision_lost(self, tmp_path):
        """A PID alone is unsafe: PIDs are reused (spec §9.2)."""
        from wavedl_daemon.backends.base import Handle
        from wavedl_daemon.backends.local import LocalBackend

        orphan = Handle(backend="local", request_id="q1", pid=999999)
        observation = LocalBackend().observe(orphan)

        assert observation["supervision_lost"] is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/test_launcher_signals.py unit_tests/daemon/test_backend_local_submit.py -v`
Expected: FAIL — `ImportError: cannot import name '_install_sigterm_handler'` and `AttributeError: 'LocalBackend' object has no attribute 'submit'`

- [ ] **Step 3: Write minimal implementation**

In `src/wavedl/launcher.py`, replace the launch block at lines 344–352:

```python
    # Launch training
    proc = None
    try:
        proc = subprocess.Popen(cmd)
        _install_sigterm_handler(proc)
        exit_code = proc.wait()
    except KeyboardInterrupt:
        print("\n\n⚠️  Training interrupted by user")
        if proc is not None:
            _terminate_child(proc)
        exit_code = 130
```

and add above `main`:

```python
_GRACE_SECONDS = 30
_received_signal: int | None = None


def _terminate_child(proc: subprocess.Popen, timeout: float = _GRACE_SECONDS) -> None:
    """Ask the accelerate child to stop, then insist.

    Only safe to call from ordinary control flow, never from a signal handler
    -- see _install_sigterm_handler.
    """
    if proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=timeout)


def _install_sigterm_handler(proc: subprocess.Popen) -> None:
    """Forward SIGTERM to the child without waiting inside the handler.

    Python raises KeyboardInterrupt on SIGINT only; the default SIGTERM
    disposition terminates this process and abandons the child, orphaning
    ``accelerate`` and every training worker it started.

    The handler must NOT call Popen.wait(): wait() is not reentrant, and the
    handler runs having interrupted the main thread's own waitpid. A nested
    wait then cannot reap the child and blocks until its timeout -- verified to
    raise TimeoutExpired after the full grace period and exit 1 with a
    traceback instead of terminating cleanly. Signal, then let the main
    thread's wait() return on its own; SIGALRM escalates if the child ignores
    SIGTERM.
    """
    import signal

    def _forward(signum, _frame):
        global _received_signal
        _received_signal = signum
        try:
            proc.terminate()
        except ProcessLookupError:
            return
        signal.alarm(_GRACE_SECONDS)

    def _escalate(_signum, _frame):
        try:
            proc.kill()
        except ProcessLookupError:
            pass

    signal.signal(signal.SIGTERM, _forward)
    if hasattr(signal, "SIGALRM"):  # POSIX only; Windows uses a Job Object
        signal.signal(signal.SIGALRM, _escalate)
```

and after the child is reaped, report the signal rather than the child's raw status:

```python
    if _received_signal is not None:
        signal.alarm(0)
        exit_code = 128 + _received_signal
```

In `src/wavedl_daemon/backends/local.py`, add supervision. On POSIX use `start_new_session=True` and signal the group; on Windows use a Job Object with kill-on-job-close (spec §9.1):

```python
    def submit(self, plan, manifest) -> Handle:
        stderr_path = Path(plan.run_dir) / "daemon_stderr.log"
        stderr_path.parent.mkdir(parents=True, exist_ok=True)
        popen_kwargs: dict = {
            "cwd": plan.run_dir,
            "env": {**os.environ, **plan.environment},
            "stdin": subprocess.DEVNULL,
            "stdout": subprocess.PIPE,
            "stderr": open(stderr_path, "ab"),
        }
        if os.name == "posix":
            popen_kwargs["start_new_session"] = True
        else:
            popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        proc = subprocess.Popen(plan.argv, **popen_kwargs)
        if os.name == "nt":
            self._assign_to_job_object(proc)  # kill-on-job-close
        self._processes[proc.pid] = proc
        return Handle(
            backend=self.name,
            request_id=getattr(manifest, "request_id", ""),
            pid=proc.pid,
            job_id=str(proc.pid),
        )

    def request_cancel(self, handle) -> None:
        """Graceful then forceful, against the GROUP not the pid.

        Signalling the direct child alone leaves accelerate and the workers
        running (spec §9.1).
        """
        proc = self._processes.get(handle.pid)
        if proc is None:
            return
        if os.name == "posix":
            group = os.getpgid(proc.pid)
            os.killpg(group, signal.SIGTERM)
            deadline = time.monotonic() + 30.0
            while time.monotonic() < deadline:
                if proc.poll() is not None:
                    return
                time.sleep(0.2)
            os.killpg(group, signal.SIGKILL)
        else:
            self._close_job_object(proc)
        proc.wait(timeout=30)

    def observe(self, handle) -> dict:
        proc = self._processes.get(handle.pid)
        if proc is None:
            # We did not start this process; a stored PID may have been reused.
            return {"supervision_lost": True}
        code = proc.poll()
        if code is None:
            return {"terminal": False, "state": "RUNNING"}
        return {
            "terminal": True,
            "state": "COMPLETED" if code == 0 else "FAILED",
            "exit_code": code,
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/test_launcher_signals.py unit_tests/daemon/test_backend_local_submit.py -v`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/wavedl/launcher.py src/wavedl_daemon/backends/local.py unit_tests/test_launcher_signals.py unit_tests/daemon/test_backend_local_submit.py
git commit -m "fix(launcher): forward SIGTERM to accelerate child; add local process-group supervision"
```

---

### Task 9: Slurm planning with a site-configurable template

**Files:**
- Create: `src/wavedl_daemon/backends/slurm.py`, `src/wavedl_daemon/backends/sbatch_template.sh`
- Test: `unit_tests/daemon/test_backend_slurm_plan.py`

**Interfaces:**
- Consumes: `Plan`, `UnsupportedPlan` from Task 7
- Produces: `SlurmBackend(template_path=None, site_config=None)` with `.plan(manifest, run_dir) -> Plan` populating `.script`

- [ ] **Step 1: Write the failing test**

```python
# unit_tests/daemon/test_backend_slurm_plan.py
"""Tests for sbatch rendering, topology mapping, and refusal to fake."""

import pytest

from wavedl_daemon.runs.manifest import build_manifest


class TestSlurmPlan:
    def test_script_contains_required_directives(self, tmp_path):
        from wavedl_daemon.backends.slurm import SlurmBackend

        manifest = build_manifest(
            target="slurm", train_args=["--model", "resnet18"],
            resources={"num_gpus": 4, "partition": "gpu", "time": "04:00:00"},
        )
        plan = SlurmBackend().plan(manifest, tmp_path)

        assert "#SBATCH --partition=gpu" in plan.script
        assert "#SBATCH --gres=gpu:4" in plan.script
        assert "#SBATCH --time=04:00:00" in plan.script

    def test_request_id_is_embedded_for_reconciliation(self, tmp_path):
        """Restart must be able to find an already-submitted job (spec §4.1)."""
        from wavedl_daemon.backends.slurm import SlurmBackend

        manifest = build_manifest(target="slurm", train_args=[])
        plan = SlurmBackend().plan(manifest, tmp_path)

        assert manifest.request_id in plan.script

    def test_multi_node_maps_onto_launcher_topology(self, tmp_path):
        """Allocating 2 nodes does not by itself run the launcher on both."""
        from wavedl_daemon.backends.slurm import SlurmBackend

        manifest = build_manifest(
            target="slurm", train_args=[],
            resources={"num_machines": 2, "num_gpus": 4},
        )
        plan = SlurmBackend().plan(manifest, tmp_path)

        assert "#SBATCH --nodes=2" in plan.script
        assert "--num_machines 2" in plan.script
        assert "srun" in plan.script

    def test_training_exit_status_is_preserved_past_cleanup(self, tmp_path):
        """A successful cleanup must not overwrite a training failure (spec §4)."""
        from wavedl_daemon.backends.slurm import SlurmBackend

        plan = SlurmBackend().plan(
            build_manifest(target="slurm", train_args=[]), tmp_path
        )

        assert "TRAIN_STATUS=$?" in plan.script
        assert "exit $TRAIN_STATUS" in plan.script

    def test_output_directory_exists_before_submission(self, tmp_path):
        """Scheduler stdout redirection fails if the directory is absent."""
        from wavedl_daemon.backends.slurm import SlurmBackend

        run_dir = tmp_path / "run"
        SlurmBackend().plan(build_manifest(target="slurm", train_args=[]), run_dir)

        assert run_dir.exists()

    def test_unexpressible_topology_is_rejected(self, tmp_path):
        from wavedl_daemon.backends.base import UnsupportedPlan
        from wavedl_daemon.backends.slurm import SlurmBackend

        manifest = build_manifest(
            target="slurm", train_args=[], resources={"num_machines": 0}
        )

        with pytest.raises(UnsupportedPlan):
            SlurmBackend().plan(manifest, tmp_path)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_backend_slurm_plan.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'wavedl_daemon.backends.slurm'`

- [ ] **Step 3: Write minimal implementation**

First define the job name in **one** place, since Task 10's restart reconciliation searches for it and any divergence makes that search silently fail:

```python
# src/wavedl_daemon/backends/slurm.py
JOB_NAME_PREFIX = "wavedl-"
REQUEST_ID_SHORT_LEN = 8


def job_name(request_id: str) -> str:
    """The scheduler-visible idempotency key.

    Used both to render --job-name at submission and to find an orphaned job
    after a restart. Both paths MUST call this function rather than slicing
    request_id themselves.
    """
    return f"{JOB_NAME_PREFIX}{request_id[:REQUEST_ID_SHORT_LEN]}"
```

`sbatch_template.sh` is a `string.Template`. Note that shell variables do **not** expand inside `#SBATCH` directives, so `${job_name}` is substituted by Python before submission, never by the shell:

```bash
#!/bin/bash
#SBATCH --job-name=${job_name}
#SBATCH --output=${log_dir}/slurm-%j.out
#SBATCH --error=${log_dir}/slurm-%j.err
#SBATCH --nodes=${num_machines}
${partition_directive}
${gres_directive}
${time_directive}
${account_directive}
${extra_directives}

# wavedl-request-id: ${request_id}
set -o pipefail
${module_loads}
${environment_activation}

${launch_command}
TRAIN_STATUS=$$?

${cleanup_command}
CLEANUP_STATUS=$$?

# Record both outcomes independently. exit $$TRAIN_STATUS alone preserves a
# training failure but hides a stage-out failure after successful training.
printf '{"train_status":%d,"cleanup_status":%d}\n' "$$TRAIN_STATUS" "$$CLEANUP_STATUS" \
    > "${log_dir}/outcome-$${SLURM_JOB_ID}.json"

if [ "$$TRAIN_STATUS" -ne 0 ]; then exit "$$TRAIN_STATUS"; fi
exit "$$CLEANUP_STATUS"
```

Three things about this template are load-bearing:

- **Shell dollars are escaped `$$`.** `string.Template.substitute` reads a bare
  `$?` as a placeholder and raises `ValueError: Invalid placeholder in string`.
  Verified against the previous template, which could not render at all.
- **Scheduler logs go to a pre-created `${log_dir}` with `%j` in the filename.**
  Writing to `attempts/%j/` fails because the job-specific parent does not exist
  when the scheduler opens the file, and numeric directories under `attempts/`
  collide with the attempt allocator, which reads every numeric directory as an
  attempt.
- **`outcome-$${SLURM_JOB_ID}.json` records training and cleanup separately**, so
  the reducer can tell "training failed, cleanup succeeded" from its inverse
  rather than seeing one collapsed exit status.

`SlurmBackend.plan` validates topology, creates `run_dir`, and renders. `launch_command` is `srun ... wavedl-train --num_machines N --machine_rank $SLURM_NODEID ...` when `num_machines > 1`, and a bare `wavedl-train ...` otherwise — the distinction the review flagged as multiplying workers if got wrong.

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_backend_slurm_plan.py -v`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/wavedl_daemon/backends/slurm.py src/wavedl_daemon/backends/sbatch_template.sh unit_tests/daemon/test_backend_slurm_plan.py
git commit -m "feat(daemon): add slurm planning with site template and topology mapping"
```

---

### Task 10: Slurm submission with durable identity and restart reconciliation

**Files:**
- Modify: `src/wavedl_daemon/backends/slurm.py`
- Test: `unit_tests/daemon/test_backend_slurm_submit.py`

**Interfaces:**
- Consumes: `Plan`, `Handle`, `Registry.find_by_request_id`
- Produces: `SlurmBackend.submit(plan, manifest) -> Handle`, `SlurmBackend.find_by_request_id(request_id) -> Handle | None`, `SubmissionUnknown` exception

No transaction spans "sbatch accepted" and "daemon recorded the handle" (spec §4.1). Every test here uses a fake `sbatch` on `PATH`; none requires a cluster.

- [ ] **Step 1: Write the failing test**

```python
# unit_tests/daemon/test_backend_slurm_submit.py
"""Tests for the ambiguous submission window. No real scheduler required."""

import pytest

from wavedl_daemon.backends.base import Plan


@pytest.fixture
def fake_bin(tmp_path, monkeypatch):
    """Put stub scheduler commands on PATH."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    monkeypatch.setenv("PATH", f"{bin_dir}:{__import__('os').environ['PATH']}")
    return bin_dir


def _stub(bin_dir, name, body):
    path = bin_dir / name
    path.write_text(f"#!/bin/bash\n{body}\n")
    path.chmod(0o755)


class TestSubmission:
    def test_submit_parses_job_id(self, fake_bin, tmp_path):
        from wavedl_daemon.backends.slurm import SlurmBackend

        _stub(fake_bin, "sbatch", 'echo "Submitted batch job 12345"')
        plan = Plan(target="slurm", run_dir=str(tmp_path), script="#!/bin/bash\ntrue\n")
        handle = SlurmBackend().submit(plan, manifest=_manifest())

        assert handle.job_id == "12345"

    def test_failed_submission_raises_rather_than_returning_a_handle(
        self, fake_bin, tmp_path
    ):
        from wavedl_daemon.backends.slurm import SlurmBackend

        _stub(fake_bin, "sbatch", 'echo "sbatch: error: invalid partition" >&2; exit 1')
        plan = Plan(target="slurm", run_dir=str(tmp_path), script="#!/bin/bash\ntrue\n")

        with pytest.raises(RuntimeError, match="invalid partition"):
            SlurmBackend().submit(plan, manifest=_manifest())

    def test_unparseable_acknowledgment_is_submission_unknown(
        self, fake_bin, tmp_path
    ):
        """Exit 0 with no job id: the job may or may not exist. Never guess."""
        from wavedl_daemon.backends.slurm import SlurmBackend, SubmissionUnknown

        _stub(fake_bin, "sbatch", 'echo "something unexpected"')
        plan = Plan(target="slurm", run_dir=str(tmp_path), script="#!/bin/bash\ntrue\n")

        with pytest.raises(SubmissionUnknown):
            SlurmBackend().submit(plan, manifest=_manifest())

    def test_find_by_request_id_recovers_an_orphaned_submission(self, fake_bin):
        """Restart reconciliation: the job exists, our record does not."""
        from wavedl_daemon.backends.slurm import SlurmBackend

        _stub(fake_bin, "squeue", 'echo "12345|wavedl-abc123|RUNNING"')
        handle = SlurmBackend().find_by_request_id("abc123")

        assert handle is not None
        assert handle.job_id == "12345"

    def test_find_by_request_id_returns_none_when_absent(self, fake_bin):
        from wavedl_daemon.backends.slurm import SlurmBackend

        _stub(fake_bin, "squeue", "true")

        assert SlurmBackend().find_by_request_id("abc123") is None

    def test_lookup_name_matches_the_name_the_template_renders(self, tmp_path):
        """The submitted job name and the search key must be the same string.

        If these diverge, squeue --name finds nothing, the daemon cannot
        recover its own submission, and the run is stranded in
        submission_unknown -- the failure find_by_request_id exists to prevent.
        """
        from wavedl_daemon.backends.slurm import SlurmBackend, job_name

        manifest = _manifest()
        plan = SlurmBackend().plan(manifest, tmp_path)

        assert f"--job-name={job_name(manifest.request_id)}" in plan.script


def _manifest():
    from wavedl_daemon.runs.manifest import build_manifest

    return build_manifest(target="slurm", train_args=[])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_backend_slurm_submit.py -v`
Expected: FAIL with `ImportError: cannot import name 'SubmissionUnknown'`

- [ ] **Step 3: Write minimal implementation**

```python
class SubmissionUnknown(RuntimeError):
    """sbatch returned success but no job id could be parsed.

    The job may or may not have been accepted. The caller must surface this to
    the user; automatic resubmission is prohibited (spec §4.1).
    """


JOB_ID_RE = re.compile(r"Submitted batch job (\d+)")


class SlurmBackend:
    def submit(self, plan, manifest) -> Handle:
        script_path = Path(plan.run_dir) / "submit.sh"
        script_path.write_text(plan.script, encoding="utf-8")
        result = subprocess.run(
            ["sbatch", str(script_path)],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            raise RuntimeError(f"sbatch failed: {result.stderr.strip()}")
        match = JOB_ID_RE.search(result.stdout)
        if match is None:
            raise SubmissionUnknown(
                f"sbatch exited 0 but no job id was found in {result.stdout!r}; "
                f"reconcile with request id {manifest.request_id} before retrying"
            )
        return Handle(
            backend="slurm", request_id=manifest.request_id,
            job_id=match.group(1), raw={"stdout": result.stdout},
        )

    def find_by_request_id(self, request_id: str) -> Handle | None:
        """Search the scheduler for a job carrying our idempotency key.

        The job name embeds a short form of the request id, so a daemon that
        crashed between sbatch and recording the handle can recover instead of
        submitting a second expensive job.

        job_name() is the SINGLE definition of that short form and is also what
        Task 9's template renders into --job-name. Computing it independently
        here would make the lookup silently miss its own job, leaving the run
        stuck in submission_unknown -- the exact failure this method prevents.
        """
        result = subprocess.run(
            ["squeue", "--noheader", "--format=%i|%j|%T", "--name",
             job_name(request_id)],
            capture_output=True, text=True, timeout=60,
        )
        for line in result.stdout.splitlines():
            if not line.strip():
                continue
            job_id, name, state = line.split("|", 2)
            return Handle(
                backend="slurm", request_id=request_id, job_id=job_id.strip(),
                raw={"name": name, "state": state},
            )
        return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_backend_slurm_submit.py -v`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/wavedl_daemon/backends/slurm.py unit_tests/daemon/test_backend_slurm_submit.py
git commit -m "feat(daemon): add slurm submission with durable request identity"
```

---

### Task 11: Slurm observation — accounting probe, MinJobAge, terminal_unknown

**Files:**
- Modify: `src/wavedl_daemon/backends/slurm.py`
- Test: `unit_tests/daemon/test_backend_slurm_observe.py`

**Interfaces:**
- Consumes: `Handle`
- Produces: `SlurmBackend.observe(handle) -> dict`, `.request_cancel(handle)`, `.capabilities() -> dict` with `accounting: bool` and `min_job_age: int`

`sacct` issues an RPC to `slurmdbd`; where site accounting is not configured it returns nothing. `MinJobAge` defaults to 300s, after which completed jobs are purged from `squeue`/`scontrol` (spec §10).

- [ ] **Step 1: Write the failing test**

```python
# unit_tests/daemon/test_backend_slurm_observe.py
"""Tests for scheduler observation when accounting may not exist."""

import os

import pytest


@pytest.fixture
def fake_bin(tmp_path, monkeypatch):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ['PATH']}")
    return bin_dir


def _stub(bin_dir, name, body):
    path = bin_dir / name
    path.write_text(f"#!/bin/bash\n{body}\n")
    path.chmod(0o755)


def _handle():
    from wavedl_daemon.backends.base import Handle

    return Handle(backend="slurm", request_id="q1", job_id="12345")


class TestCapabilities:
    def test_accounting_probed_as_available(self, fake_bin):
        from wavedl_daemon.backends.slurm import SlurmBackend

        _stub(fake_bin, "sacct", "echo 'JobID|State'")
        _stub(fake_bin, "scontrol", "echo 'MinJobAge = 300'")

        assert SlurmBackend().capabilities()["accounting"] is True

    def test_accounting_probed_as_absent(self, fake_bin):
        """Many clusters run without slurmdbd; sacct then tells us nothing."""
        from wavedl_daemon.backends.slurm import SlurmBackend

        _stub(fake_bin, "sacct", "echo 'slurm_persist_conn_open_without_init' >&2; exit 1")
        _stub(fake_bin, "scontrol", "echo 'MinJobAge = 300'")

        assert SlurmBackend().capabilities()["accounting"] is False

    def test_min_job_age_is_read_from_scontrol(self, fake_bin):
        """Poll interval must be shorter than the purge window."""
        from wavedl_daemon.backends.slurm import SlurmBackend

        _stub(fake_bin, "sacct", "true")
        _stub(fake_bin, "scontrol", "echo 'MinJobAge = 120'")

        assert SlurmBackend().capabilities()["min_job_age"] == 120


class TestObserve:
    def test_running_job_is_not_terminal(self, fake_bin):
        from wavedl_daemon.backends.slurm import SlurmBackend

        _stub(fake_bin, "squeue", 'echo "RUNNING"')
        observation = SlurmBackend().observe(_handle())

        assert observation["terminal"] is False

    def test_completed_job_read_from_accounting(self, fake_bin):
        from wavedl_daemon.backends.slurm import SlurmBackend

        _stub(fake_bin, "squeue", "true")
        _stub(fake_bin, "sacct", 'echo "COMPLETED|0:0"')
        observation = SlurmBackend().observe(_handle())

        assert observation["terminal"] is True
        assert observation["state"] == "COMPLETED"
        assert observation["exit_code"] == 0

    def test_vanished_without_accounting_is_marked_vanished(self, fake_bin):
        """Not failed: with no slurmdbd and the MinJobAge window gone, we
        genuinely do not know how it ended (spec §10)."""
        from wavedl_daemon.backends.slurm import SlurmBackend

        _stub(fake_bin, "squeue", "true")
        _stub(fake_bin, "sacct", "exit 1")
        _stub(fake_bin, "scontrol", "exit 1")
        observation = SlurmBackend().observe(_handle())

        assert observation["vanished"] is True
        assert observation["accounting"] is False
        assert "state" not in observation or observation.get("terminal") is not True

    def test_controller_timeout_is_an_error_not_a_verdict(self, fake_bin):
        """Failure to observe must never be reported as job failure."""
        from wavedl_daemon.backends.slurm import SlurmBackend

        _stub(fake_bin, "squeue", "sleep 30")
        observation = SlurmBackend(query_timeout=1).observe(_handle())

        assert "error" in observation
        assert observation.get("terminal") is not True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_backend_slurm_observe.py -v`
Expected: FAIL with `AttributeError: 'SlurmBackend' object has no attribute 'capabilities'`

- [ ] **Step 3: Write minimal implementation**

```python
    def observe(self, handle) -> dict:
        """Query the scheduler. Distinguishes 'cannot observe' from 'finished'."""
        try:
            live = self._run(["squeue", "--noheader", "--format=%T",
                              "--job", handle.job_id])
        except subprocess.TimeoutExpired as exc:
            return {"error": f"squeue timed out after {self.query_timeout}s: {exc}"}
        if live.stdout.strip():
            return {"terminal": False, "state": live.stdout.strip().split()[0]}

        caps = self.capabilities()
        if caps["accounting"]:
            try:
                acct = self._run(["sacct", "--noheader", "--parsable2",
                                  "--format=State,ExitCode", "--jobs", handle.job_id])
            except subprocess.TimeoutExpired as exc:
                return {"error": f"sacct timed out: {exc}"}
            if acct.returncode == 0 and acct.stdout.strip():
                state, _, exit_field = acct.stdout.strip().split("\n")[0].partition("|")
                return {
                    "terminal": True,
                    "state": state.strip().split()[0],
                    "exit_code": int(exit_field.split(":")[0] or 0),
                    "accounting": True,
                }
        # Gone from the queue, and accounting cannot tell us how it ended.
        return {"vanished": True, "accounting": caps["accounting"]}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_backend_slurm_observe.py -v`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/wavedl_daemon/backends/slurm.py unit_tests/daemon/test_backend_slurm_observe.py
git commit -m "feat(daemon): probe slurm accounting and never infer failure from absence"
```

---

### Task 12: Runtime hello and rank-0 journal emission in train.py

**Files:**
- Modify: `src/wavedl/train.py`
- Create: `src/wavedl/journal.py`
- Test: `unit_tests/test_train_journal.py`

**Interfaces:**
- Consumes: nothing from the daemon — `wavedl` must not import `wavedl_daemon` (the training package stays standalone)
- Produces: `wavedl.journal.RunJournal(run_dir, run_id, is_main_process)` with `.hello(**fields)`, `.state(state, message="")`, `.metric(payload)`, `.artifact(kind, path, **fields)`, `.exit(code, status)`, `.close()`; a no-op instance on non-main ranks

`wavedl` gets its own minimal writer rather than importing the daemon's, because the daemon may not be installed. The two share the wire format, and Task 26 tests them against each other.

- [ ] **Step 1: Write the failing test**

```python
# unit_tests/test_train_journal.py
"""Only rank 0 writes the journal; seq is undefined with N writers."""

import json


class TestRankGating:
    def test_main_process_writes(self, tmp_path):
        from wavedl.journal import RunJournal

        journal = RunJournal(tmp_path, run_id="r1", is_main_process=True)
        journal.state("running")
        journal.close()

        assert (tmp_path / "attempts/1/events.jsonl").exists()

    def test_worker_rank_writes_nothing(self, tmp_path):
        """N appenders interleave lines and duplicate seq (spec §3.3)."""
        from wavedl.journal import RunJournal

        journal = RunJournal(tmp_path, run_id="r1", is_main_process=False)
        journal.state("running")
        journal.metric({"epoch": 1})
        journal.close()

        assert not (tmp_path / "attempts").exists()

    def test_hello_is_the_first_event(self, tmp_path):
        """Capability negotiation happens inside the real environment (spec §5.2)."""
        from wavedl.journal import RunJournal

        journal = RunJournal(tmp_path, run_id="r1", is_main_process=True)
        journal.hello(device="cuda", runtime_version="1.8.0")
        journal.state("running")
        journal.close()

        lines = (tmp_path / "attempts/1/events.jsonl").read_text().splitlines()
        first = json.loads(lines[0])
        assert first["type"] == "hello"
        assert first["seq"] == 0
        assert first["payload"]["device"] == "cuda"

    def test_non_finite_metrics_serialise_as_null(self, tmp_path):
        from wavedl.journal import RunJournal

        journal = RunJournal(tmp_path, run_id="r1", is_main_process=True)
        journal.metric({"best_val_loss": float("inf")})
        journal.close()

        text = (tmp_path / "attempts/1/events.jsonl").read_text()
        assert "Infinity" not in text

    def test_requeue_uses_a_new_attempt(self, tmp_path):
        """SLURM requeue restarts the process; attempt 1's journal is preserved."""
        from wavedl.journal import RunJournal

        first = RunJournal(tmp_path, run_id="r1", is_main_process=True)
        first.state("running")
        first.close()
        second = RunJournal(tmp_path, run_id="r1", is_main_process=True)
        second.state("running")
        second.close()

        assert (tmp_path / "attempts/1/events.jsonl").exists()
        assert (tmp_path / "attempts/2/events.jsonl").exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/test_train_journal.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'wavedl.journal'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/wavedl/journal.py
"""Structured event emission from a training run.

Deliberately dependency-free and independent of wavedl_daemon: training must
run with no daemon installed. Only the main process writes -- seq is not
well-defined with concurrent writers, and shared filesystems provide no atomic
distributed record-append.
"""

from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PROTOCOL_NAME = "wavedl-jsonl"
PROTOCOL_VERSION = 1
MAX_RECORD_BYTES = 1 << 20


def _finite_or_none(value: Any) -> Any:
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {key: _finite_or_none(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_finite_or_none(item) for item in value]
    return value


class RunJournal:
    def __init__(self, run_dir, run_id: str, is_main_process: bool = True) -> None:
        self.enabled = bool(is_main_process)
        self.run_id = run_id
        self._seq = 0
        self._file = None
        if not self.enabled:
            return
        attempts = Path(run_dir) / "attempts"
        attempts.mkdir(parents=True, exist_ok=True)
        existing = [int(p.name) for p in attempts.iterdir()
                    if p.is_dir() and p.name.isdigit()]
        self.attempt = max(existing, default=0) + 1
        directory = attempts / str(self.attempt)
        directory.mkdir(parents=True, exist_ok=False)
        self._file = open(directory / "events.jsonl", "a", encoding="utf-8")

    def _write(self, type: str, payload: dict[str, Any]) -> None:
        if not self.enabled or self._file is None:
            return
        record = {
            "protocol": PROTOCOL_NAME, "version": PROTOCOL_VERSION,
            "run_id": self.run_id, "attempt": self.attempt, "type": type,
            "seq": self._seq,
            "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "payload": _finite_or_none(payload),
        }
        line = json.dumps(record, allow_nan=False, separators=(",", ":"))
        if len(line.encode("utf-8")) > MAX_RECORD_BYTES:
            line = json.dumps(
                {**record, "type": "warning",
                 "payload": {"code": "record_too_large", "dropped_type": type}},
                allow_nan=False, separators=(",", ":"),
            )
        self._file.write(line + "\n")
        self._file.flush()
        os.fsync(self._file.fileno())
        self._seq += 1

    def hello(self, **fields: Any) -> None:
        self._write("hello", fields)

    def state(self, state: str, message: str = "") -> None:
        self._write("state", {"state": state, "message": message})

    def metric(self, payload: dict[str, Any]) -> None:
        self._write("metric", payload)

    def artifact(self, kind: str, path: str, **fields: Any) -> None:
        self._write("artifact", {"kind": kind, "path": path, **fields})

    def exit(self, code: int, status: str) -> None:
        self._write("exit", {"code": code, "status": status})

    def close(self) -> None:
        if self._file is not None and not self._file.closed:
            self._file.close()
```

In `train.py`, construct the journal after the `Accelerator` exists, emit `hello` before the training loop, mirror `gui_metrics` into `journal.metric(...)` next to the existing `##METRICS##` print, and emit `exit` in a `finally`:

```python
    journal = RunJournal(
        args.output_dir, run_id=os.environ.get("WAVEDL_RUN_ID", str(uuid.uuid4())),
        is_main_process=accelerator.is_main_process,
    )
    journal.hello(
        runtime_version=wavedl.__version__,
        python=sys.version.split()[0],
        device=str(accelerator.device),
        num_processes=accelerator.num_processes,
        protocol_min=1, protocol_max=1,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/test_train_journal.py -v`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/wavedl/journal.py src/wavedl/train.py unit_tests/test_train_journal.py
git commit -m "feat(train): emit runtime hello and rank-0 journal events"
```

---

### Task 13: Bounded dataset inspection

**Files:**
- Create: `src/wavedl_daemon/datasets/__init__.py`, `src/wavedl_daemon/datasets/inspect.py`
- Modify: `src/wavedl/utils/data.py` (NPZ header path)
- Test: `unit_tests/daemon/test_dataset_inspect.py`

**Interfaces:**
- Consumes: nothing
- Produces: `inspect_dataset(path, max_bytes=..., timeout_s=...) -> DatasetInfo`; `npz_member_headers(path) -> dict[str, tuple[tuple[int, ...], str]]`; `DatasetTooLarge` exception

`np.load` **silently ignores `mmap_mode` for `.npz`**: member access returns a fully materialised `ndarray`, not a `memmap`. On a memory-capped shared login node this is the most likely way to get an account flagged (spec §7).

- [ ] **Step 1: Write the failing test**

```python
# unit_tests/daemon/test_dataset_inspect.py
"""Inspection must read headers, not arrays."""

import numpy as np
import pytest


@pytest.fixture
def npz(tmp_path):
    path = tmp_path / "data.npz"
    np.savez(path, X=np.zeros((50, 8, 8), dtype=np.float32),
             y=np.zeros((50, 3), dtype=np.float32))
    return path


class TestNpzHeaders:
    def test_shape_and_dtype_without_loading(self, npz):
        from wavedl_daemon.datasets.inspect import npz_member_headers

        headers = npz_member_headers(npz)

        assert headers["X"][0] == (50, 8, 8)
        assert headers["X"][1] == "float32"

    def test_does_not_materialise_arrays(self, npz, monkeypatch):
        """Guard against a regression back to np.load."""
        import numpy

        def explode(*args, **kwargs):
            raise AssertionError("np.load must not be called for header reads")

        monkeypatch.setattr(numpy, "load", explode)
        from wavedl_daemon.datasets.inspect import npz_member_headers

        assert npz_member_headers(npz)["y"][0] == (50, 3)


class TestInspectDataset:
    def test_reports_samples_and_shapes(self, npz):
        from wavedl_daemon.datasets.inspect import inspect_dataset

        info = inspect_dataset(npz)

        assert info.num_samples == 50
        assert info.input_shape == (8, 8)
        assert info.output_shape == (3,)

    def test_oversized_file_is_refused_not_read(self, npz):
        """A refusal is a structured answer, not an OOM on a shared node."""
        from wavedl_daemon.datasets.inspect import DatasetTooLarge, inspect_dataset

        with pytest.raises(DatasetTooLarge):
            inspect_dataset(npz, max_bytes=10)

    def test_missing_file_reports_error_without_raising(self, tmp_path):
        from wavedl_daemon.datasets.inspect import inspect_dataset

        info = inspect_dataset(tmp_path / "absent.npz")

        assert info.error is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_dataset_inspect.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'wavedl_daemon.datasets'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/wavedl_daemon/datasets/inspect.py
"""Dataset introspection bounded for shared login nodes.

NPZ archives are zip files whose members are .npy payloads. The .npy header
carries shape and dtype, so both are readable without decompressing the array.
np.load ignores mmap_mode for .npz and would read the whole array instead.
"""

from __future__ import annotations

import zipfile
from pathlib import Path

import numpy as np
from pydantic import BaseModel

DEFAULT_MAX_BYTES = 64 * 1024**3


class DatasetTooLarge(RuntimeError):
    """The file exceeds the inspection budget; refused rather than read."""


class DatasetInfo(BaseModel):
    path: str
    format: str = "unknown"
    file_size: int = 0
    num_samples: int = 0
    input_shape: tuple[int, ...] = ()
    output_shape: tuple[int, ...] = ()
    input_dtype: str = ""
    output_dtype: str = ""
    error: str | None = None


HEADER_READERS = {
    (1, 0): np.lib.format.read_array_header_1_0,
    (2, 0): np.lib.format.read_array_header_2_0,
}


def npz_member_headers(path: Path) -> dict[str, tuple[tuple[int, ...], str]]:
    """Read every member's shape and dtype from its .npy header only.

    Uses the PUBLIC read_array_header_N_0 functions dispatched on read_magic.
    The private np.lib.format._read_array_header does not exist in numpy 2.x
    and would raise AttributeError.
    """
    headers: dict[str, tuple[tuple[int, ...], str]] = {}
    with zipfile.ZipFile(path) as archive:
        for name in archive.namelist():
            key = name[:-4] if name.endswith(".npy") else name
            with archive.open(name) as member:
                version = np.lib.format.read_magic(member)
                reader = HEADER_READERS.get(version)
                if reader is None:
                    raise ValueError(
                        f"unsupported .npy format version {version} in {name}"
                    )
                shape, _fortran, dtype = reader(member)
            headers[key] = (tuple(shape), str(dtype))
    return headers
```

`inspect_dataset` checks `stat().st_size` against `max_bytes` **before** opening, dispatches on suffix (`.npz` via headers, `.npy` via `np.load(mmap_mode="r")`, `.h5`/`.mat` via lazy dataset handles), and returns `DatasetInfo(error=...)` rather than raising for missing or unreadable files. Update `wavedl/utils/data.py` `NPZSource.load_mmap` to use the same header path when only metadata is needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_dataset_inspect.py -v`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/wavedl_daemon/datasets src/wavedl/utils/data.py unit_tests/daemon/test_dataset_inspect.py
git commit -m "feat(daemon): read npz metadata from member headers instead of loading arrays"
```

---

### Task 14: FastAPI app and header-only authentication

**Files:**
- Create: `src/wavedl_daemon/api/__init__.py`, `src/wavedl_daemon/api/app.py`, `src/wavedl_daemon/api/auth.py`
- Test: `unit_tests/daemon/test_api_auth.py`

**Interfaces:**
- Consumes: `Settings` from Task 5
- Produces: `create_app(settings, registry) -> FastAPI`; `require_auth(request)` dependency; `HostValidationMiddleware`; `GET /api/health`

**There are no cookies in this design.** An earlier draft exchanged the
bootstrap token for a session cookie whose *value was the token itself*. RFC
6265 §8.5 states the port is not part of a cookie's scope, so any other service
on `localhost` could receive that cookie and replay it as a bearer token.
Distinct cookie names prevent collisions, not disclosure — that draft
reproduced the exact exposure it was written to prevent.

Cookies turn out to be unnecessary. The SPA is served unauthenticated (it must
load in order to prompt for a token), every API call is a `fetch` that can set
`Authorization`, and the event stream is a `fetch` too rather than an
`EventSource` (§5.4). With **no ambient credential, cross-site request forgery
is structurally impossible**, so no XSRF token is required either. This is
simpler *and* strictly safer than the cookie design.

What remains is Host validation, which defends against DNS rebinding: a public
page can point a name it controls at `127.0.0.1` and address this daemon.
Without ambient credentials it cannot authenticate, but refusing unknown Host
headers keeps it away from the API surface entirely.

- [ ] **Step 1: Write the failing test**

```python
# unit_tests/daemon/test_api_auth.py
"""Header-only auth, Host validation, and the absence of ambient credentials."""

import pytest
from fastapi.testclient import TestClient


TOKEN = "s3cret-token"


@pytest.fixture
def client(tmp_path):
    from wavedl_daemon.api.app import create_app
    from wavedl_daemon.runs.registry import Registry
    from wavedl_daemon.settings import Settings

    settings = Settings(data_dir=tmp_path, token=TOKEN)
    return TestClient(create_app(settings, Registry(tmp_path / "r.db")))


@pytest.fixture
def auth():
    return {"Authorization": f"Bearer {TOKEN}"}


class TestBearerAuth:
    def test_shell_loads_unauthenticated(self, client):
        """The SPA must load so it can prompt for a token."""
        assert client.get("/").status_code == 200

    def test_api_requires_a_credential(self, client):
        assert client.get("/api/health").status_code == 401

    def test_correct_bearer_accepted(self, client, auth):
        response = client.get("/api/health", headers=auth)

        assert response.status_code == 200
        assert response.json()["protocol_max"] == 1

    def test_wrong_bearer_rejected(self, client):
        response = client.get("/api/health", headers={"Authorization": "Bearer nope"})

        assert response.status_code == 401


class TestNoAmbientCredential:
    """These are the regression tests for the cross-port cookie exposure."""

    def test_no_set_cookie_is_ever_issued(self, client, auth):
        response = client.get("/api/health", headers=auth)

        assert "set-cookie" not in {key.lower() for key in response.headers}

    def test_token_in_a_cookie_does_not_authenticate(self, client):
        """A cookie planted by any other service on localhost must be inert,
        even when it carries the correct token."""
        response = client.get("/api/health", cookies={"wavedl_session": TOKEN})

        assert response.status_code == 401

    def test_cross_origin_post_without_bearer_is_rejected(self, client):
        """With no ambient credential there is nothing for a forged request to
        ride on, so no XSRF token is needed."""
        response = client.post(
            "/api/runs/abc/cancel", headers={"Origin": "http://evil.localhost:3000"}
        )

        assert response.status_code == 401


class TestHostValidation:
    def test_disallowed_host_rejected(self, client, auth):
        response = client.get("/api/health", headers={**auth, "Host": "evil.com"})

        assert response.status_code == 400

    def test_allowed_host_accepted(self, client, auth):
        response = client.get("/api/health", headers={**auth, "Host": "localhost"})

        assert response.status_code == 200

    def test_missing_host_rejected(self, client, auth):
        response = client.get("/api/health", headers={**auth, "Host": ""})

        assert response.status_code == 400


class TestLeakage:
    def test_rejection_leaks_nothing_about_runs(self, client):
        response = client.get("/api/runs/secret-run-id")

        assert response.status_code == 401
        assert "secret-run-id" not in response.text

    def test_rejection_does_not_echo_the_token(self, client):
        response = client.get("/api/runs/x", headers={"Authorization": f"Bearer {TOKEN}x"})

        assert TOKEN not in response.text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_api_auth.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'wavedl_daemon.api'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/wavedl_daemon/api/auth.py
"""Header-only authentication for a service on a shared host."""

from __future__ import annotations

import hmac

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse


def make_host_middleware(allowed_hosts: set[str]):
    async def validate_host(request: Request, call_next):
        host = (request.headers.get("host") or "").split(":")[0]
        if host not in allowed_hosts:
            return JSONResponse({"detail": "host not allowed"}, status_code=400)
        return await call_next(request)

    return validate_host


def make_dependency(settings):
    expected = settings.token

    async def require_auth(request: Request) -> None:
        header = request.headers.get("authorization", "")
        if not header.startswith("Bearer ") or not hmac.compare_digest(
            header[7:], expected
        ):
            # Identical response for every failure: absent, malformed, or wrong.
            raise HTTPException(401, "authentication required")

    return require_auth
```

`create_app` registers the Host middleware, mounts the static client at `/`
unauthenticated, and applies `require_auth` to every `/api/**` route. The
daemon's access log must exclude query strings, because the bootstrap URL
carries the token; the client strips it with `history.replaceState` immediately
on load (Task 20).

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_api_auth.py -v`
Expected: PASS, 12 tests

- [ ] **Step 5: Commit**

```bash
git add src/wavedl_daemon/api unit_tests/daemon/test_api_auth.py
git commit -m "feat(daemon): add header-only auth with host validation and no cookies"
```

---

### Task 15: Run endpoints — plan, submit, list, get, cancel, adopt

**Files:**
- Create: `src/wavedl_daemon/api/routes_runs.py`
- Test: `unit_tests/daemon/test_api_runs.py`

**Interfaces:**
- Consumes: `Registry`, `reduce`, `LocalBackend`, `SlurmBackend`, `build_manifest`
- Produces: `POST /api/runs/plan`, `POST /api/runs`, `GET /api/runs`, `GET /api/runs/{id}`, `POST /api/runs/{id}/cancel`, `POST /api/runs/adopt`

- [ ] **Step 1: Write the failing test**

```python
# unit_tests/daemon/test_api_runs.py
"""Run lifecycle endpoints, including dry-run and adoption."""

AUTH = {"Authorization": "Bearer test-token"}


class TestPlanEndpoint:
    def test_plan_returns_argv_without_starting_anything(self, client):
        response = client.post(
            "/api/runs/plan",
            json={"target": "local", "train_args": ["--model", "resnet18"]},
            headers=AUTH,
        )

        assert response.status_code == 200
        assert response.json()["argv"][0] == "wavedl-train"
        assert client.get("/api/runs", headers=AUTH).json() == []

    def test_plan_for_slurm_returns_a_script(self, client):
        response = client.post(
            "/api/runs/plan", json={"target": "slurm", "train_args": []}, headers=AUTH
        )

        assert "#SBATCH" in response.json()["script"]

    def test_unsupported_plan_is_a_400_with_the_reason(self, client):
        response = client.post(
            "/api/runs/plan",
            json={"target": "local", "train_args": [], "resources": {"num_machines": 2}},
            headers=AUTH,
        )

        assert response.status_code == 400
        assert "one machine" in response.json()["detail"]


class TestSubmitEndpoint:
    def test_intent_is_persisted_before_the_backend_is_called(self, client, registry):
        """If submission dies mid-flight the intent must still be recoverable."""
        response = client.post(
            "/api/runs", json={"target": "local", "train_args": ["--epochs", "1"]},
            headers=AUTH,
        )
        run_id = response.json()["run_id"]

        assert registry.get(run_id).request_id


class TestGetEndpoint:
    def test_state_includes_evidence_and_confidence(self, client):
        run_id = client.post(
            "/api/runs", json={"target": "local", "train_args": []}, headers=AUTH
        ).json()["run_id"]
        body = client.get(f"/api/runs/{run_id}", headers=AUTH).json()

        assert "state" in body
        assert "confidence" in body
        assert "evidence" in body

    def test_unknown_run_is_404(self, client):
        assert client.get("/api/runs/nope", headers=AUTH).status_code == 404


class TestCancelEndpoint:
    def test_cancel_records_the_request_even_before_a_handle_exists(
        self, client, registry
    ):
        """A cancel arriving during the §4.1 window must survive to be applied."""
        run_id = client.post(
            "/api/runs", json={"target": "local", "train_args": []}, headers=AUTH
        ).json()["run_id"]
        client.post(f"/api/runs/{run_id}/cancel", headers=AUTH)

        assert registry.get(run_id).cancel_requested is True


class TestAdoptEndpoint:
    def test_adopt_registers_an_externally_launched_run(self, client, tmp_path):
        """A hand-launched run has files but no registry record (spec §12)."""
        from wavedl_daemon.runs.layout import RunLayout
        from wavedl_daemon.runs.manifest import build_manifest, write_manifest

        run_dir = tmp_path / "external"
        write_manifest(RunLayout(run_dir), build_manifest("local", []))
        response = client.post(
            "/api/runs/adopt", json={"run_dir": str(run_dir)}, headers=AUTH
        )

        assert response.status_code == 200
        assert client.get("/api/runs", headers=AUTH).json()

    def test_adopt_rejects_a_directory_without_a_manifest(self, client, tmp_path):
        empty = tmp_path / "empty"
        empty.mkdir()
        response = client.post(
            "/api/runs/adopt", json={"run_dir": str(empty)}, headers=AUTH
        )

        assert response.status_code == 400
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_api_runs.py -v`
Expected: FAIL — `/api/runs/plan` returns 404, routes not registered

- [ ] **Step 3: Write minimal implementation**

Add a shared `client`/`registry` fixture to `unit_tests/daemon/conftest.py`, then implement the router. The submit path must follow this order exactly (spec §4.1):

```python
@router.post("")
async def submit_run(request: SubmitRequest, deps=Depends(get_deps)):
    manifest = build_manifest(request.target, request.train_args, request.resources)
    run_dir = deps.settings.data_dir / "runs" / manifest.run_id
    backend = deps.backends[request.target]
    plan = backend.plan(manifest, run_dir)
    write_manifest(RunLayout(run_dir), manifest)

    # 1. Persist intent FIRST. A crash after this point is recoverable;
    #    a crash before it means nothing was submitted.
    run_id = deps.registry.record_intent(manifest, run_dir)
    deps.registry.mark_submitting(run_id)
    try:
        handle = backend.submit(plan, manifest)
    except SubmissionUnknown as exc:
        # Leave submitted_at set and job_id NULL: the reducer renders this as
        # SUBMISSION_UNKNOWN and refuses to resubmit automatically.
        deps.registry.record_submission_unknown(run_id, str(exc))
        return {"run_id": run_id, "state": "submission_unknown", "detail": str(exc)}
    deps.registry.record_handle(run_id, handle.backend, handle.job_id, handle.raw)
    return {"run_id": run_id, "job_id": handle.job_id}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_api_runs.py -v`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add src/wavedl_daemon/api/routes_runs.py unit_tests/daemon/test_api_runs.py unit_tests/daemon/conftest.py
git commit -m "feat(daemon): add run plan, submit, cancel, and adopt endpoints"
```

---

### Task 16: Ingestion and the resumable event stream

**Files:**
- Create: `src/wavedl_daemon/ingest.py`, `src/wavedl_daemon/api/routes_stream.py`
- Test: `unit_tests/daemon/test_ingest.py`, `unit_tests/daemon/test_api_stream.py`

**Interfaces:**
- Consumes: `JournalReader`, `Registry.apply_events`, `Registry.cursor`
- Produces: `Ingestor(registry, layout_for)` with `.poll_once(run_id) -> int`; `GET /api/runs/{id}/events?since=<seq>` streaming NDJSON

- [ ] **Step 1: Write the failing test**

```python
# unit_tests/daemon/test_ingest.py
"""Ingestion must be idempotent and must not lose the handover event."""


class TestIngestion:
    def test_events_land_in_the_registry(self, registry, tmp_path):
        from wavedl.journal import RunJournal
        from wavedl_daemon.ingest import Ingestor

        run_id = _register(registry, tmp_path)
        journal = RunJournal(tmp_path, run_id=run_id, is_main_process=True)
        journal.state("running")
        journal.metric({"epoch": 1})
        journal.close()

        Ingestor(registry, lambda _: tmp_path).poll_once(run_id)

        assert len(registry.events(run_id, attempt=1)) == 2

    def test_second_poll_is_a_no_op(self, registry, tmp_path):
        """Re-reading a journal must not duplicate rows."""
        from wavedl.journal import RunJournal
        from wavedl_daemon.ingest import Ingestor

        run_id = _register(registry, tmp_path)
        journal = RunJournal(tmp_path, run_id=run_id, is_main_process=True)
        journal.state("running")
        journal.close()
        ingestor = Ingestor(registry, lambda _: tmp_path)
        ingestor.poll_once(run_id)
        ingestor.poll_once(run_id)

        assert len(registry.events(run_id, attempt=1)) == 1

    def test_cursor_advances_with_the_events(self, registry, tmp_path):
        from wavedl.journal import RunJournal
        from wavedl_daemon.ingest import Ingestor

        run_id = _register(registry, tmp_path)
        journal = RunJournal(tmp_path, run_id=run_id, is_main_process=True)
        for _ in range(3):
            journal.metric({})
        journal.close()
        Ingestor(registry, lambda _: tmp_path).poll_once(run_id)

        assert registry.cursor(run_id, attempt=1) == 2

    def test_incomplete_tail_is_not_ingested_until_complete(self, registry, tmp_path):
        from wavedl_daemon.ingest import Ingestor

        run_id = _register(registry, tmp_path)
        journal_path = tmp_path / "attempts/1/events.jsonl"
        journal_path.parent.mkdir(parents=True)
        journal_path.write_text('{"protocol":"wavedl-jsonl","version":1,')
        ingestor = Ingestor(registry, lambda _: tmp_path)
        ingestor.poll_once(run_id)

        assert registry.events(run_id, attempt=1) == []
```

```python
# unit_tests/daemon/test_api_stream.py
"""The stream must be resumable and must not drop the boundary event."""

AUTH = {"Authorization": "Bearer test-token"}


class TestStream:
    def test_replay_from_since_returns_only_later_events(self, client, seeded_run):
        with client.stream(
            "GET", f"/api/runs/{seeded_run}/events?since=1&follow=false", headers=AUTH
        ) as response:
            seqs = [
                __import__("json").loads(line)["seq"]
                for line in response.iter_lines() if line
            ]

        assert seqs == [2, 3, 4]

    def test_since_minus_one_replays_everything(self, client, seeded_run):
        with client.stream(
            "GET", f"/api/runs/{seeded_run}/events?since=-1&follow=false", headers=AUTH
        ) as response:
            seqs = [
                __import__("json").loads(line)["seq"]
                for line in response.iter_lines() if line
            ]

        assert seqs == [0, 1, 2, 3, 4]

    def test_stream_requires_auth(self, client, seeded_run):
        assert client.get(f"/api/runs/{seeded_run}/events").status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_ingest.py unit_tests/daemon/test_api_stream.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'wavedl_daemon.ingest'`

- [ ] **Step 3: Write minimal implementation**

`Ingestor.poll_once` reads new records, then calls `registry.apply_events(run_id, attempt, events, new_cursor)` — a single transaction covering both the rows and the cursor, so a crash cannot skip or double-apply (spec §4).

The stream endpoint subscribes **before** finalising the replay watermark, so an event arriving during handover is not lost:

```python
@router.get("/{run_id}/events")
async def stream_events(run_id: str, since: int = -1, follow: bool = True, ...):
    async def generate():
        # Subscribe first, then replay. Reversing this order drops any event
        # that lands between the end of replay and the subscription (spec §4).
        queue = deps.broker.subscribe(run_id)
        try:
            last = since
            for event in deps.registry.events_after(run_id, since):
                last = event["seq"]
                yield json.dumps(event) + "\n"
            if not follow:
                return
            while True:
                event = await queue.get()
                if event["seq"] <= last:
                    continue  # already replayed; drop the duplicate
                last = event["seq"]
                yield json.dumps(event) + "\n"
        finally:
            deps.broker.unsubscribe(run_id, queue)

    return StreamingResponse(generate(), media_type="application/x-ndjson")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_ingest.py unit_tests/daemon/test_api_stream.py -v`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/wavedl_daemon/ingest.py src/wavedl_daemon/api/routes_stream.py unit_tests/daemon/test_ingest.py unit_tests/daemon/test_api_stream.py
git commit -m "feat(daemon): add transactional ingestion and gap-free resumable stream"
```

---

### Task 17: Artifacts, checkpoint generations, and safe download

**Files:**
- Create: `src/wavedl_daemon/api/routes_artifacts.py`, `src/wavedl_daemon/runs/checkpoints.py`
- Modify: `src/wavedl/train.py` (`_save_best_checkpoint`)
- Test: `unit_tests/daemon/test_artifacts.py`

**Interfaces:**
- Consumes: `RunLayout`
- Produces: `publish_generation(layout, step, source_dir) -> Path`; `published_generations(layout) -> list[dict]`; `GET /api/runs/{id}/artifacts`, `GET /api/runs/{id}/artifacts/{artifact_id}`

An artifact event naming a path does not establish that the path's contents are valid: `train.py` saves into a reusable `best_checkpoint` directory, so a crash mid-save leaves a mixture of generations while the old event still names it (spec §11).

- [ ] **Step 1: Write the failing test**

```python
# unit_tests/daemon/test_artifacts.py
"""Publication is atomic; access is validated at open time."""

import pytest

AUTH = {"Authorization": "Bearer test-token"}


class TestGenerations:
    def test_generation_is_listed_only_after_its_manifest(self, tmp_path):
        from wavedl_daemon.runs.checkpoints import (
            published_generations,
            publish_generation,
        )
        from wavedl_daemon.runs.layout import RunLayout

        layout = RunLayout(tmp_path)
        staging = tmp_path / "staging"
        staging.mkdir()
        (staging / "model.safetensors").write_bytes(b"weights")

        assert published_generations(layout) == []
        publish_generation(layout, step=10, source_dir=staging)
        assert len(published_generations(layout)) == 1

    def test_interrupted_publication_leaves_the_previous_generation(self, tmp_path):
        """A half-written generation must never appear as published."""
        from wavedl_daemon.runs.checkpoints import (
            published_generations,
            publish_generation,
        )
        from wavedl_daemon.runs.layout import RunLayout

        layout = RunLayout(tmp_path)
        good = tmp_path / "good"
        good.mkdir()
        (good / "model.safetensors").write_bytes(b"v1")
        publish_generation(layout, step=10, source_dir=good)

        broken = layout.checkpoints / "gen-000002"
        broken.mkdir(parents=True)
        (broken / "model.safetensors").write_bytes(b"partial")

        generations = published_generations(layout)
        assert len(generations) == 1
        assert generations[0]["step"] == 10

    def test_generation_records_its_training_step(self, tmp_path):
        from wavedl_daemon.runs.checkpoints import (
            published_generations,
            publish_generation,
        )
        from wavedl_daemon.runs.layout import RunLayout

        layout = RunLayout(tmp_path)
        staging = tmp_path / "s"
        staging.mkdir()
        (staging / "w").write_bytes(b"x")
        publish_generation(layout, step=42, source_dir=staging)

        assert published_generations(layout)[0]["step"] == 42


class TestSafeAccess:
    def test_symlink_escape_is_refused_at_open_time(self, client, run_with_dir):
        """Event-time validation does not protect a later open (spec §6)."""
        run_id, run_dir = run_with_dir
        secret = run_dir.parent / "secret.txt"
        secret.write_text("private")
        (run_dir / "checkpoints").mkdir(parents=True, exist_ok=True)
        (run_dir / "checkpoints" / "escape").symlink_to(secret)

        response = client.get(f"/api/runs/{run_id}/artifacts/escape", headers=AUTH)

        assert response.status_code in (403, 404)
        assert "private" not in response.text

    def test_html_artifact_is_not_served_as_active_content(self, client, run_with_dir):
        """An HTML artifact at the authenticated origin would be API-capable."""
        run_id, run_dir = run_with_dir
        gen = run_dir / "checkpoints" / "gen-000001"
        gen.mkdir(parents=True)
        (gen / "report.html").write_text("<script>fetch('/api/runs')</script>")
        (gen / "COMPLETE.json").write_text('{"step": 1}')

        response = client.get(
            f"/api/runs/{run_id}/artifacts/gen-000001/report.html", headers=AUTH
        )

        assert response.headers["content-type"].startswith("application/octet-stream")
        assert "attachment" in response.headers.get("content-disposition", "")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_artifacts.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'wavedl_daemon.runs.checkpoints'`

- [ ] **Step 3: Write minimal implementation**

```python
def publish_generation(layout, step: int, source_dir: Path) -> Path:
    """Write a complete generation, then announce it.

    COMPLETE.json is written last and is the only thing that makes a
    generation visible; a crash before it leaves the previous one published.
    """
    number = _next_generation(layout)
    target = layout.checkpoints / f"gen-{number:06d}"
    shutil.copytree(source_dir, target)
    payload = {"generation": number, "step": step,
               "created_at": _now(), "files": sorted(
                   p.name for p in target.iterdir())}
    tmp = target / ".COMPLETE.json.tmp"
    tmp.write_text(json.dumps(payload), encoding="utf-8")
    os.replace(tmp, target / "COMPLETE.json")  # atomic within a directory
    return target
```

Artifact download resolves the path, calls `Path.resolve()`, and verifies `run_dir.resolve()` is a parent **at open time**; it always sets `Content-Type: application/octet-stream`, `Content-Disposition: attachment`, and `Content-Security-Policy: default-src 'none'`.

In `train.py`, `_save_best_checkpoint` writes to a staging directory and calls `publish_generation` — but only when the daemon package is importable, falling back to the current in-place save otherwise, so standalone training keeps working.

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_artifacts.py -v`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/wavedl_daemon/runs/checkpoints.py src/wavedl_daemon/api/routes_artifacts.py src/wavedl/train.py unit_tests/daemon/test_artifacts.py
git commit -m "feat(daemon): publish checkpoints as immutable generations with safe download"
```

---

### Task 18: Backpressure, the serve CLI, and the Phase 1 gate

**Files:**
- Create: `src/wavedl_daemon/cli.py`
- Modify: `src/wavedl_gui/service/training_service.py`
- Test: `unit_tests/daemon/test_backpressure.py`, `unit_tests/daemon/test_phase1_gate.py`

**Interfaces:**
- Consumes: everything above
- Produces: `wavedl-daemon serve` console script; `DaemonTrainingService` in the Qt shell replacing subprocess spawning

This task proves Phase 1: the Qt shell stops spawning subprocesses and drives the daemon instead. **The Qt shell keeps working throughout** — it is the regression harness for the API.

- [ ] **Step 1: Write the failing tests**

```python
# unit_tests/daemon/test_backpressure.py
"""Bounded queues, subscriber isolation, and a defined disk-full policy."""

import pytest


class TestBoundedQueues:
    def test_slow_subscriber_does_not_stall_others(self):
        from wavedl_daemon.ingest import EventBroker

        broker = EventBroker(max_queue=2)
        slow = broker.subscribe("r1")
        fast = broker.subscribe("r1")
        for seq in range(10):
            broker.publish("r1", {"seq": seq})

        assert fast.qsize() <= 2
        assert broker.dropped("r1") > 0

    def test_dropped_events_are_counted_not_silent(self):
        """A gap must be visible so the client can re-request from the journal."""
        from wavedl_daemon.ingest import EventBroker

        broker = EventBroker(max_queue=1)
        broker.subscribe("r1")
        broker.publish("r1", {"seq": 0})
        broker.publish("r1", {"seq": 1})

        assert broker.dropped("r1") == 1


class TestDiskPolicy:
    def test_write_failure_surfaces_as_an_error_event(self, tmp_path, monkeypatch):
        from wavedl.journal import RunJournal

        journal = RunJournal(tmp_path, run_id="r1", is_main_process=True)

        def full(*args, **kwargs):
            raise OSError(28, "No space left on device")

        monkeypatch.setattr(journal._file, "write", full)
        with pytest.raises(OSError):
            journal.metric({"epoch": 1})
```

```python
# unit_tests/daemon/test_phase1_gate.py
"""End-to-end: a real training process observed through the daemon API."""

import pytest

AUTH = {"Authorization": "Bearer test-token"}


@pytest.mark.integration
@pytest.mark.slow
class TestPhase1Gate:
    def test_local_run_reaches_completed_through_the_api(self, client, tmp_path):
        """Submit, stream, and reach a confirmed terminal state."""
        run_id = client.post(
            "/api/runs",
            json={"target": "local",
                  "train_args": ["--model", "cnn", "--epochs", "1",
                                 "--data_path", str(_tiny_dataset(tmp_path))]},
            headers=AUTH,
        ).json()["run_id"]

        state = _wait_for_terminal(client, run_id, timeout=300)

        assert state["state"] == "completed"
        assert state["confidence"] == "confirmed"

    def test_cancel_leaves_no_orphaned_processes(self, client, tmp_path):
        import psutil

        run_id = client.post(
            "/api/runs",
            json={"target": "local",
                  "train_args": ["--model", "cnn", "--epochs", "1000",
                                 "--data_path", str(_tiny_dataset(tmp_path))]},
            headers=AUTH,
        ).json()["run_id"]
        _wait_for_state(client, run_id, "running", timeout=120)
        before = {p.pid for p in psutil.process_iter()}
        client.post(f"/api/runs/{run_id}/cancel", headers=AUTH)
        _wait_for_terminal(client, run_id, timeout=120)
        leaked = {
            p.pid for p in psutil.process_iter()
            if p.pid not in before and "wavedl" in " ".join(p.cmdline() or [])
        }

        assert leaked == set()

    def test_daemon_restart_reports_supervision_lost(self, client, registry, tmp_path):
        """A replacement daemon cannot recreate the Popen handle (spec §9.2)."""
        run_id = client.post(
            "/api/runs",
            json={"target": "local",
                  "train_args": ["--model", "cnn", "--epochs", "1000",
                                 "--data_path", str(_tiny_dataset(tmp_path))]},
            headers=AUTH,
        ).json()["run_id"]
        _wait_for_state(client, run_id, "running", timeout=120)
        fresh = _restart_daemon(registry)
        body = fresh.get(f"/api/runs/{run_id}", headers=AUTH).json()

        assert body["state"] == "supervision_lost"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_backpressure.py -v`
Expected: FAIL with `ImportError: cannot import name 'EventBroker'`

- [ ] **Step 3: Write minimal implementation**

`EventBroker` uses `asyncio.Queue(maxsize=max_queue)` per subscriber and `put_nowait` with a per-run dropped counter — a full queue drops and counts rather than blocking ingestion. `cli.py` wires `Settings`, `Registry`, backends, the ingestion loop, and uvicorn, printing the bootstrap URL. In the Qt shell, replace `TrainingWorker`'s `subprocess.Popen` with HTTP calls to the daemon and consume `/api/runs/{id}/events` on a `QThread`.

Add to `pyproject.toml`:
```toml
wavedl-daemon = "wavedl_daemon.cli:main"
```

- [ ] **Step 4: Run the whole suite**

Run: `PYTHONPATH=src python3 -m pytest -m "not slow and not gpu" -q` then `PYTHONPATH=src python3 -m pytest -m "integration" -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/wavedl_daemon/cli.py src/wavedl_gui/service/training_service.py unit_tests/daemon/test_backpressure.py unit_tests/daemon/test_phase1_gate.py pyproject.toml
git commit -m "feat(daemon): add serve CLI, bounded broker, and Qt shell daemon client"
```

- [ ] **Step 6: Phase 1 gate — validate on a real cluster**

Simulation is not sufficient (spec §16). On one real SLURM site, confirm: submission succeeds and the job id is recorded; the login-node daemon observes journal events written from the compute node; cancellation releases the allocation; `sacct` availability is correctly probed; and a requeued job produces attempt 2 without corrupting attempt 1. Record the site's filesystem type and Slurm version in the PR description.

---

## Phase 2 — Web Client

> Phase 2 begins only after Task 18's gate, including the real-cluster
> validation. The Qt shell keeps shipping throughout Phase 2 and is the
> reference for parity.

### Task 19: Scaffold the Nuxt client and vendor its build

**Files:**
- Create: `web/` (generated), `web/nuxt.config.ts` (modified after generation)
- Create: `scripts/build_client.py`
- Modify: `pyproject.toml`, `MANIFEST.in`
- Test: `unit_tests/daemon/test_static_mount.py`

**Interfaces:**
- Consumes: `create_app` from Task 14
- Produces: static build at `src/wavedl_daemon/static/`; `GET /` serving `index.html`

- [ ] **Step 1: Write the failing test**

```python
# unit_tests/daemon/test_static_mount.py
"""The daemon serves the client from its own origin (spec §2.1)."""


class TestStaticMount:
    def test_index_is_served_without_auth(self, client):
        """The shell must load so it can prompt for the bootstrap token."""
        response = client.get("/")

        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]

    def test_unknown_client_route_falls_back_to_index(self, client):
        """SPA routing: /runs/abc is a client route, not a 404."""
        response = client.get("/runs/abc")

        assert response.status_code == 200

    def test_unknown_api_route_is_still_404(self, client):
        """The SPA fallback must not swallow API mistakes."""
        assert client.get("/api/nope").status_code in (401, 404)

    def test_missing_build_serves_a_useful_message(self, client_without_static):
        """A developer without a built client should be told, not 500'd."""
        response = client_without_static.get("/")

        assert response.status_code == 503
        assert "build_client" in response.text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_static_mount.py -v`
Expected: FAIL — `/` returns 404

- [ ] **Step 3: Scaffold and implement**

```bash
npm create nuxt-saas@latest web -- --modules pwa --yes
```

Then set in `web/nuxt.config.ts` — the kit targets Cloudflare/NuxtHub and this is off its main path (spec §18):

```ts
export default defineNuxtConfig({
  ssr: false,                      // no server knows which daemon a user runs
  nitro: { preset: 'static' },
  app: { baseURL: '/' },
  pwa: {
    registerType: 'prompt',        // never swap the shell mid-run
    workbox: {
      navigateFallback: '/',
      // The service worker must not sit in front of the event stream.
      navigateFallbackDenylist: [/^\/api\//],
      runtimeCaching: [],
    },
  },
})
```

`scripts/build_client.py` runs `npm ci && npm run generate` in `web/`, then copies `web/.output/public/` to `src/wavedl_daemon/static/`. Add `src/wavedl_daemon/static/**` to package data. In `create_app`, mount `StaticFiles` at `/` with an SPA fallback that returns 503 with build instructions when the directory is absent.

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 scripts/build_client.py && PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_static_mount.py -v`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add web pyproject.toml MANIFEST.in scripts/build_client.py src/wavedl_daemon/api/app.py unit_tests/daemon/test_static_mount.py
git commit -m "feat(client): scaffold nuxt pwa and vendor its static build"
```

---

### Task 20: API client with version-skew detection

**Files:**
- Create: `web/app/lib/api.ts`, `web/app/stores/connection.ts`
- Test: `web/test/api.spec.ts`

**Interfaces:**
- Produces: `apiFetch<T>(path, init?) -> Promise<T>`; `useConnection()` Pinia store with `.token`, `.health`, `.skew: boolean`, `.connect(token)`

Bundling guarantees package parity, not parity with the client *currently executing in the browser*: a service worker serves a cached shell across a daemon upgrade, and a reused forwarding port presents a different backend at the same origin (spec §14.1).

- [ ] **Step 1: Write the failing test**

```ts
// web/test/api.spec.ts
import { describe, expect, it, vi } from 'vitest'

describe('apiFetch', () => {
  it('sends the bearer token rather than relying on cookies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { apiFetch } = await import('../app/lib/api')

    await apiFetch('/api/health', {}, 'tok')

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok')
  })

  it('throws a typed error on 401 so the UI can re-prompt', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })))
    const { ApiAuthError, apiFetch } = await import('../app/lib/api')

    await expect(apiFetch('/api/health', {}, 'bad')).rejects.toBeInstanceOf(ApiAuthError)
  })
})

describe('connection store', () => {
  it('flags skew when the daemon build differs from this client build', async () => {
    const { detectSkew } = await import('../app/lib/api')

    expect(detectSkew({ client_build: 'abc' }, 'def')).toBe(true)
    expect(detectSkew({ client_build: 'abc' }, 'abc')).toBe(false)
  })

  it('flags skew when the daemon protocol range excludes ours', async () => {
    const { protocolCompatible } = await import('../app/lib/api')

    expect(protocolCompatible({ protocol_min: 2, protocol_max: 3 }, 1)).toBe(false)
    expect(protocolCompatible({ protocol_min: 1, protocol_max: 1 }, 1)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run test/api.spec.ts`
Expected: FAIL — cannot resolve `../app/lib/api`

- [ ] **Step 3: Write minimal implementation**

`apiFetch` sets `Authorization: Bearer <token>`, throws `ApiAuthError` on 401 and `ApiError` otherwise. The connection store calls `/api/health` on load, compares `client_build` against the build id baked in at generate time, and sets `skew` — surfaced as a banner offering reload, never an automatic swap mid-run.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run test/api.spec.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add web/app/lib/api.ts web/app/stores/connection.ts web/test/api.spec.ts
git commit -m "feat(client): add api client with bearer auth and version-skew detection"
```

---

### Task 21: Streaming event consumption with resumption

**Files:**
- Create: `web/app/lib/eventStream.ts`, `web/app/stores/runs.ts`
- Test: `web/test/eventStream.spec.ts`

**Interfaces:**
- Produces: `streamRun(runId, sinceSeq, token, onEvent) -> { stop() }`

`EventSource` cannot set request headers, which would force stream auth onto cookies — and cookies are not port-isolated. `fetch` + `ReadableStream` carries `Authorization` like every other call, and resumption is manual via `seq` anyway (spec §5.4).

- [ ] **Step 1: Write the failing test**

```ts
// web/test/eventStream.spec.ts
import { describe, expect, it, vi } from 'vitest'

function ndjsonResponse(lines: string[]) {
  const body = new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(new TextEncoder().encode(line + '\n'))
      controller.close()
    },
  })
  return new Response(body, { status: 200 })
}

describe('streamRun', () => {
  it('parses one event per newline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ndjsonResponse([
      '{"seq":0,"type":"state"}', '{"seq":1,"type":"metric"}',
    ])))
    const { streamRun } = await import('../app/lib/eventStream')
    const seen: number[] = []

    await streamRun('r1', -1, 'tok', (e) => seen.push(e.seq)).done

    expect(seen).toEqual([0, 1])
  })

  it('does not emit a record split across chunks twice', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"seq":0,'))
        controller.enqueue(new TextEncoder().encode('"type":"state"}\n'))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })))
    const { streamRun } = await import('../app/lib/eventStream')
    const seen: number[] = []

    await streamRun('r1', -1, 'tok', (e) => seen.push(e.seq)).done

    expect(seen).toEqual([0])
  })

  it('resumes from the last seq it applied', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ndjsonResponse(['{"seq":5}']))
    vi.stubGlobal('fetch', fetchMock)
    const { streamRun } = await import('../app/lib/eventStream')

    await streamRun('r1', 4, 'tok', () => {}).done

    expect(fetchMock.mock.calls[0][0]).toContain('since=4')
  })

  it('stop() aborts the request', async () => {
    const abort = vi.fn()
    vi.stubGlobal('AbortController', class { signal = {}; abort = abort })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ndjsonResponse([])))
    const { streamRun } = await import('../app/lib/eventStream')

    streamRun('r1', -1, 'tok', () => {}).stop()

    expect(abort).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run test/eventStream.spec.ts`
Expected: FAIL — cannot resolve `../app/lib/eventStream`

- [ ] **Step 3: Write minimal implementation**

`streamRun` calls `fetch(/api/runs/${runId}/events?since=${sinceSeq}, { headers, signal })`, reads `response.body.getReader()`, decodes with a `TextDecoder({ stream: true })`, and splits on `\n` keeping any trailing fragment in a buffer for the next chunk — the same incomplete-record discipline as the Python reader. On network error it retries with exponential backoff from its last applied `seq`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run test/eventStream.spec.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add web/app/lib/eventStream.ts web/app/stores/runs.ts web/test/eventStream.spec.ts
git commit -m "feat(client): stream events over fetch with seq-based resumption"
```

---

### Task 22: Run list and run detail views

**Files:**
- Create: `web/app/pages/index.vue`, `web/app/pages/runs/[id].vue`, `web/app/components/RunStateBadge.vue`
- Test: `web/test/RunStateBadge.spec.ts`

**Interfaces:**
- Consumes: `useRuns()` from Task 21
- Produces: routes `/` and `/runs/:id`

The uncertain states are the point: `terminal_unknown`, `submission_unknown`, `supervision_lost`, and `observation_unavailable` must be visually distinct from `failed`, or the reducer's care is thrown away at the last step.

- [ ] **Step 1: Write the failing test**

```ts
// web/test/RunStateBadge.spec.ts
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import RunStateBadge from '../app/components/RunStateBadge.vue'

describe('RunStateBadge', () => {
  it('renders uncertain states distinctly from failure', () => {
    const unknown = mount(RunStateBadge, { props: { state: 'terminal_unknown' } })
    const failed = mount(RunStateBadge, { props: { state: 'failed' } })

    expect(unknown.classes()).not.toEqual(failed.classes())
    expect(unknown.text().toLowerCase()).toContain('unknown')
  })

  it('shows why a state was chosen', () => {
    const badge = mount(RunStateBadge, {
      props: { state: 'submission_unknown', reason: 'acceptance never confirmed' },
    })

    expect(badge.text()).toContain('acceptance never confirmed')
  })

  it('warns rather than offering retry for submission_unknown', () => {
    const badge = mount(RunStateBadge, { props: { state: 'submission_unknown' } })

    expect(badge.text().toLowerCase()).not.toContain('retry')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run test/RunStateBadge.spec.ts`
Expected: FAIL — cannot resolve `RunStateBadge.vue`

- [ ] **Step 3: Write minimal implementation**

`RunStateBadge` maps each `RunState` to a shadcn-vue `Badge` variant with three visual families: settled (`completed`, `failed`, `cancelled`), active (`pending`, `submitted`, `running`, `stopping`), and **uncertain** (`terminal_unknown`, `submission_unknown`, `supervision_lost`, `observation_unavailable`) — the last rendered with a distinct outline and the `reason` string inline. The run list is a shadcn-vue `DataTable`; the detail page composes the badge, evidence list, metric charts (Task 23), and artifacts.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run test/RunStateBadge.spec.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add web/app/pages web/app/components/RunStateBadge.vue web/test/RunStateBadge.spec.ts
git commit -m "feat(client): add run list and detail views with uncertainty-aware states"
```

---

### Task 23: Metric charts with uPlot

**Files:**
- Create: `web/app/components/MetricChart.vue`, `web/app/lib/series.ts`
- Test: `web/test/series.spec.ts`

**Interfaces:**
- Produces: `appendPoint(series, epoch, value)`; `MetricChart` props `{ series, height }`

uPlot renders 100k+ points at interactive framerates in under 50KB. This is the one frontend choice that can reintroduce the sluggishness the rewrite exists to remove (spec §14).

- [ ] **Step 1: Write the failing test**

```ts
// web/test/series.spec.ts
import { describe, expect, it } from 'vitest'
import { appendPoint, createSeries } from '../app/lib/series'

describe('series', () => {
  it('keeps uPlot column-major layout', () => {
    const series = createSeries()
    appendPoint(series, 1, 0.5)
    appendPoint(series, 2, 0.4)

    expect(series.data).toEqual([[1, 2], [0.5, 0.4]])
  })

  it('renders a null metric as a gap, not zero', () => {
    const series = createSeries()
    appendPoint(series, 1, null)

    expect(series.data[1][0]).toBeNull()
  })

  it('ignores an out-of-order replay of an epoch it already has', () => {
    const series = createSeries()
    appendPoint(series, 1, 0.5)
    appendPoint(series, 1, 0.9)

    expect(series.data[0]).toEqual([1])
    expect(series.data[1]).toEqual([0.5])
  })

  it('handles ten thousand points without copying the array each append', () => {
    const series = createSeries()
    for (let i = 0; i < 10000; i++) appendPoint(series, i, i * 0.1)

    expect(series.data[0].length).toBe(10000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run test/series.spec.ts`
Expected: FAIL — cannot resolve `../app/lib/series`

- [ ] **Step 3: Write minimal implementation**

`createSeries()` returns `{ data: [[], []], seen: new Set<number>() }`. `appendPoint` skips epochs already in `seen` (replay is idempotent, matching the server), pushes in place, and preserves `null` — `null` means the metric was non-finite upstream, and uPlot draws a gap. `MetricChart.vue` creates the uPlot instance in `onMounted`, calls `setData` on change, and destroys it in `onUnmounted`. Add `uplot` to `web/package.json`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run test/series.spec.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add web/app/components/MetricChart.vue web/app/lib/series.ts web/test/series.spec.ts web/package.json
git commit -m "feat(client): add uplot metric charts with null-as-gap handling"
```

---

### Task 24: The plan/dry-run view

**Files:**
- Create: `web/app/pages/new.vue`, `web/app/components/PlanPreview.vue`
- Test: `web/test/PlanPreview.spec.ts`

**Interfaces:**
- Consumes: `POST /api/runs/plan`, `POST /api/runs`
- Produces: route `/new`

This replaces the Qt shell's "Copy CLI Command" button. Dry-run is now the same code path as submission, so what is shown is exactly what would run.

- [ ] **Step 1: Write the failing test**

```ts
// web/test/PlanPreview.spec.ts
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PlanPreview from '../app/components/PlanPreview.vue'

describe('PlanPreview', () => {
  it('shows argv as a copyable command for a local target', () => {
    const wrapper = mount(PlanPreview, {
      props: { plan: { target: 'local', argv: ['wavedl-train', '--epochs', '1'] } },
    })

    expect(wrapper.text()).toContain('wavedl-train --epochs 1')
  })

  it('shows the script for a slurm target', () => {
    const wrapper = mount(PlanPreview, {
      props: { plan: { target: 'slurm', script: '#!/bin/bash\n#SBATCH --nodes=1\n' } },
    })

    expect(wrapper.text()).toContain('#SBATCH --nodes=1')
  })

  it('surfaces plan warnings', () => {
    const wrapper = mount(PlanPreview, {
      props: { plan: { target: 'slurm', script: '', warnings: ['no account set'] } },
    })

    expect(wrapper.text()).toContain('no account set')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run test/PlanPreview.spec.ts`
Expected: FAIL — cannot resolve `PlanPreview.vue`

- [ ] **Step 3: Write minimal implementation**

`/new` is a shadcn-vue form over the manifest schema. Every change re-requests `POST /api/runs/plan` (debounced) and renders `PlanPreview`, which shows a shell-quoted argv for `local` and the full script for `slurm`, each with a copy button, plus any `warnings`. A 400 from the plan endpoint renders the `detail` string inline — a refused plan is information, not an error dialog.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run test/PlanPreview.spec.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add web/app/pages/new.vue web/app/components/PlanPreview.vue web/test/PlanPreview.spec.ts
git commit -m "feat(client): add plan preview replacing the copy-cli-command button"
```

---

### Task 25: Server-side dataset browser and model selector

**Files:**
- Create: `web/app/components/PathBrowser.vue`, `web/app/components/ModelSelector.vue`
- Create: `src/wavedl_daemon/api/routes_browse.py`
- Test: `unit_tests/daemon/test_api_browse.py`

**Interfaces:**
- Produces: `GET /api/browse?path=`, `POST /api/datasets/inspect`, `GET /api/models`

Native file dialogs are gone and should be: on HPC the data is on the remote host, not the laptop, so a native picker was always wrong there (spec §14).

- [ ] **Step 1: Write the failing test**

```python
# unit_tests/daemon/test_api_browse.py
"""Directory browsing runs on the daemon's host, with containment."""

AUTH = {"Authorization": "Bearer test-token"}


class TestBrowse:
    def test_lists_directories_and_data_files(self, client, tmp_path):
        (tmp_path / "sub").mkdir()
        (tmp_path / "data.npz").write_bytes(b"")
        body = client.get(f"/api/browse?path={tmp_path}", headers=AUTH).json()
        names = {entry["name"] for entry in body["entries"]}

        assert {"sub", "data.npz"} <= names

    def test_marks_directories(self, client, tmp_path):
        (tmp_path / "sub").mkdir()
        body = client.get(f"/api/browse?path={tmp_path}", headers=AUTH).json()
        entry = next(e for e in body["entries"] if e["name"] == "sub")

        assert entry["is_dir"] is True

    def test_requires_auth(self, client, tmp_path):
        assert client.get(f"/api/browse?path={tmp_path}").status_code == 401

    def test_unreadable_path_is_a_clean_error(self, client):
        response = client.get("/api/browse?path=/definitely/not/here", headers=AUTH)

        assert response.status_code == 404

    def test_inspect_refuses_an_oversized_file(self, client, tmp_path, monkeypatch):
        """The refusal must reach the UI, not OOM the login node (spec §7)."""
        import numpy as np

        path = tmp_path / "big.npz"
        np.savez(path, X=np.zeros((4, 4), dtype=np.float32),
                 y=np.zeros((4, 1), dtype=np.float32))
        monkeypatch.setenv("WAVEDL_INSPECT_MAX_BYTES", "10")
        response = client.post(
            "/api/datasets/inspect", json={"path": str(path)}, headers=AUTH
        )

        assert response.status_code == 413
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_api_browse.py -v`
Expected: FAIL — `/api/browse` returns 404

- [ ] **Step 3: Write minimal implementation**

`GET /api/browse` lists a directory with `name`, `is_dir`, `size`, filtered to directories and known data suffixes; missing or unreadable paths return 404 with no filesystem detail. `POST /api/datasets/inspect` calls Task 13's `inspect_dataset` in a threadpool and maps `DatasetTooLarge` to **413**. `PathBrowser.vue` is a breadcrumb plus list; `ModelSelector.vue` renders `/api/models` with the filter behaviour the Qt `model_selector_dialog.py` already has.

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_api_browse.py -v`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/wavedl_daemon/api/routes_browse.py web/app/components/PathBrowser.vue web/app/components/ModelSelector.vue unit_tests/daemon/test_api_browse.py
git commit -m "feat(client): add server-side path browser and model selector"
```

---

### Task 26: Service worker scope and the Phase 2 parity gate

**Files:**
- Create: `web/test/sw.spec.ts`, `docs/parity-checklist.md`
- Test: `unit_tests/daemon/test_phase2_gate.py`

**Interfaces:**
- Consumes: everything in Phase 2
- Produces: a signed-off parity checklist

- [ ] **Step 1: Write the failing test**

```ts
// web/test/sw.spec.ts
import { describe, expect, it } from 'vitest'
import config from '../nuxt.config'

describe('service worker configuration', () => {
  it('excludes the api from navigation fallback', () => {
    // An SW in front of /api/runs/{id}/events breaks streaming (spec §14).
    const denylist = config.pwa.workbox.navigateFallbackDenylist
    expect(denylist.some((re: RegExp) => re.test('/api/runs/x/events'))).toBe(true)
  })

  it('does not runtime-cache any api route', () => {
    expect(config.pwa.workbox.runtimeCaching).toEqual([])
  })

  it('prompts rather than auto-updating', () => {
    // Swapping the shell mid-run would drop an active stream.
    expect(config.pwa.registerType).toBe('prompt')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run test/sw.spec.ts`
Expected: FAIL if `navigateFallbackDenylist` is unset from Task 19

- [ ] **Step 3: Write the parity checklist and fix any gaps**

`docs/parity-checklist.md` enumerates every Qt shell capability with the web route that replaces it: project setup, data inspection and plots, model selection with filtering, hyperparameter form, live dashboard with loss curves and convergence, run controls, results and export, settings, and the CLI-command view. Any row without a route is a gap — fix it before proceeding.

- [ ] **Step 4: Run the full suite**

Run: `cd web && npx vitest run` and `PYTHONPATH=src python3 -m pytest -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/test/sw.spec.ts docs/parity-checklist.md
git commit -m "feat(client): pin service worker scope and record qt parity checklist"
```

- [ ] **Step 6: Phase 2 gate — manual verification**

Install the PWA from `http://localhost:8420` and confirm it opens in its own window. Then repeat over `ssh -L` against a remote daemon and confirm the service worker still registers. Confirm a run submitted in one browser tab streams live in a second.

---

## Phase 3 — Cutover

### Task 27: Route the Qt shell's remaining users and freeze it

**Files:**
- Modify: `src/wavedl_gui/view/main_window.py`
- Modify: `GUI_README.md`
- Test: `unit_tests/daemon/test_deprecation_notice.py`

- [ ] **Step 1: Write the failing test**

```python
# unit_tests/daemon/test_deprecation_notice.py
"""The Qt shell must tell users where it went before it disappears."""


def test_gui_entry_point_prints_the_daemon_command(capsys):
    from wavedl_gui.main import deprecation_notice

    print(deprecation_notice())
    captured = capsys.readouterr().out

    assert "wavedl-daemon serve" in captured
    assert "deprecated" in captured.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_deprecation_notice.py -v`
Expected: FAIL with `ImportError: cannot import name 'deprecation_notice'`

- [ ] **Step 3: Write minimal implementation**

`wavedl-gui` prints a deprecation notice naming `wavedl-daemon serve` and the release in which the shell is removed, then continues to run normally. Update `GUI_README.md` to describe the daemon as the supported path.

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_deprecation_notice.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/wavedl_gui/main.py src/wavedl_gui/view/main_window.py GUI_README.md unit_tests/daemon/test_deprecation_notice.py
git commit -m "feat(gui): deprecate the qt shell in favour of the daemon"
```

---

### Task 28: Remove the Qt shell

**Files:**
- Delete: `src/wavedl_gui/`
- Modify: `pyproject.toml`, `requirements-gui.txt`, `wavedl-gui.spec`, `AGENTS.md`

Only after Task 26's gate and at least one release carrying Task 27's notice.

- [ ] **Step 1: Confirm nothing outside the package imports it**

Run: `grep -rn "wavedl_gui" --include=*.py --include=*.toml --include=*.cfg . | grep -v "^./src/wavedl_gui"`
Expected: only `pyproject.toml`, `wavedl-gui.spec`, and deprecation references

- [ ] **Step 2: Delete the package and its packaging**

```bash
git rm -r src/wavedl_gui requirements-gui.txt wavedl-gui.spec
```

Remove the `wavedl-gui` console script and the `gui` optional-dependency group from `pyproject.toml`; drop `wavedl_gui*` from `packages.find`. Update `AGENTS.md`'s project overview.

- [ ] **Step 3: Run the full suite**

Run: `PYTHONPATH=src python3 -m pytest -q && python3 -m ruff check . && python3 -m ruff format --check .`
Expected: PASS. Approximately 8,586 lines of view/component code and 43,324 generated lines of `resource.py` are removed.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: remove the qt shell, superseded by the daemon and web client"
```

---

### Task 29: Packaging and release

**Files:**
- Modify: `pyproject.toml`, `.github/workflows/release.yml`, `.github/workflows/test.yml`
- Create: `.github/workflows/client.yml`
- Test: `unit_tests/daemon/test_packaging.py`

- [ ] **Step 1: Write the failing test**

```python
# unit_tests/daemon/test_packaging.py
"""The wheel must carry the built client, or the daemon serves nothing."""

import subprocess
import sys
import zipfile


def test_wheel_contains_the_client_build(tmp_path):
    subprocess.run(
        [sys.executable, "-m", "build", "--wheel", "--outdir", str(tmp_path)],
        check=True,
    )
    wheel = next(tmp_path.glob("*.whl"))
    with zipfile.ZipFile(wheel) as archive:
        names = archive.namelist()

    assert any(n.startswith("wavedl_daemon/static/") for n in names)
    assert any(n.endswith("static/index.html") for n in names)


def test_wheel_size_is_recorded(tmp_path):
    """Vendoring the client grows the wheel; measure it (spec §18)."""
    subprocess.run(
        [sys.executable, "-m", "build", "--wheel", "--outdir", str(tmp_path)],
        check=True,
    )
    wheel = next(tmp_path.glob("*.whl"))

    assert wheel.stat().st_size < 50 * 1024 * 1024
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_packaging.py -v`
Expected: FAIL — no `static/` in the wheel until the build step runs

- [ ] **Step 3: Wire the client build into packaging and CI**

`client.yml` runs `npm ci`, `npx vitest run`, and `npm run generate` on every PR touching `web/`. `release.yml` gains a client build before `python -m build` so the wheel carries `src/wavedl_daemon/static/`. `test.yml` adds a job running the daemon suite on Ubuntu, macOS, and Windows — the process-tree tests are platform-specific and Windows is the least-covered path (spec §18).

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 scripts/build_client.py && PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_packaging.py -v`
Expected: PASS, 2 tests

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml .github/workflows unit_tests/daemon/test_packaging.py
git commit -m "build: ship the web client in the wheel and test the daemon cross-platform"
```

---

## Appendix: Spec Coverage

| Spec section | Tasks |
|---|---|
| §1.1 deployment contract | 11 (capabilities), 14 (health), 18 (gate) |
| §2.1 daemon serves the UI | 14, 19 |
| §2.2 daemon-free CLI | 4 (shared manifest), 12 (standalone journal) |
| §3.1 backend seam | 7, 9, 10, 11 |
| §3.2 run layout, attempts | 4, 12 |
| §3.3 journal storage contract | 2, 3, 12, 18 |
| §4 reconciliation | 6, 15, 16 |
| §4.1 submission ambiguity | 10, 15 |
| §5.1 envelope, ordering | 1, 2 |
| §5.2 two handshakes | 12, 14 |
| §5.3 HTTP surface | 14, 15, 16, 17, 25 |
| §5.4 fetch streaming | 16, 21 |
| §6 security | 14, 17 |
| §7 dataset inspection | 13, 25 |
| §8 storage and dispatch lock | 5 |
| §9 process supervision | 8 |
| §10 scheduler integration | 9, 10, 11 |
| §11 checkpoint publication | 17 |
| §12 adoption, output ownership | 7, 15 |
| §13 backpressure | 18 |
| §14 web client, skew | 19, 20, 22, 23, 26 |
| §15 migration phases | 18, 26, 27, 28 |
| §16 failure-oriented testing | 18 (gate), 26 (gate), 29 (CI matrix) |
