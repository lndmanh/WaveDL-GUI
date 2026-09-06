# Phase 1A shared contracts — TDD implementation detail

**Date:** 2026-09-06  
**Status:** implementation instructions; source changes have not been applied  
**Scope:** T1, T2, T5, T6, T3, T4, T20a, in that order  
**Gate contribution:** shared-contracts portion of milestone 1A, not the complete
1A storage/supervision milestone and not a functioning daemon.

The [settled structure](../2026-09-06-daemon-migration-structure.md) is the task
contract. This detail follows [spec revision 2](../../specs/2026-09-05-wavedl-daemon-architecture-design.md),
the [F1–F17 review](../2026-09-05-codex-review-migration-plan.md), and the
[structure review](../2026-09-06-codex-review-structure.md). The old migration
plan supplies only the Files/test/run/implementation/run/commit house format.
No old implementation code is reused.

All commands below run from `/Users/myt/Documents/GitHub/WaveDL-GUI` with a
Python 3.11+ `python3` and already installed pytest/Ruff. No installation or
network step is required. Every Python command sets `PYTHONPATH=src` because
the current editable install is dangling. `--confcutdir=unit_tests/core` excludes
the parent ML fixture module, whose unconditional NumPy/Torch/matplotlib imports
would obscure the dependency-light contracts. The repository's pytest
configuration still supplies verbose output, short tracebacks, strict markers,
and the `slow`, `gpu`, and `integration` registrations. These focused tests
require none of those markers and run on CPU without Qt.

Each Python block below is the complete content of the path in its first-line
comment. Create the named parent directories when writing files. Step 1 writes
only the new tests. Step 3 creates/replaces exactly its listed implementation
files. Each task is one commit; explicit `git commit --only` path lists exclude
unrelated staged work. Do not execute these implementation or commit steps
merely to deliver this planning document.

All shared contracts live under `wavedl.core` and use the standard library.
Neither standalone nor daemon-side callers need to duplicate serializers,
manifest construction, or publication. `wavedl` must never import
`wavedl_daemon`. The T1 lazy-export change preserves existing public names while
making that package boundary useful without loading ML/GUI dependencies.

### Task T1: Protocol envelope

**Files:**

- Modify: `src/wavedl/__init__.py`
- Create: `src/wavedl/core/__init__.py`
- Create: `src/wavedl/core/protocol.py`
- Test (create): `unit_tests/core/test_protocol.py`

**Interfaces:**

Consumes: no earlier task. Uses Python 3.11 standard-library modules only.

Produces in `wavedl.core.protocol`:

- `ProtocolError(ValueError)` and `MalformedJSON(ProtocolError)`.
- `Envelope(run_id: str, attempt: int, type: str, seq: int, ts: str, payload: dict[str, object], protocol: str = "wavedl-jsonl", version: int = 1)`; frozen dataclass.
- `encode(envelope: Envelope) -> bytes`: UTF-8, exactly one trailing LF.
- `decode(data: bytes | str) -> Envelope`.
- `finite_or_none(value: object) -> object` and `strict_loads(data: bytes | str) -> object`.

The default envelope version is 1; `attempt >= 1`, `seq >= 0`, and booleans are
not integers at these boundaries. UUID identity and UTC RFC 3339 timestamps are
validated. The envelope accepts extension fields and extension event names;
T2 supplies payload validation. Direct construction can contain non-finite
payload floats so that `encode` can sanitize them recursively. Decoding rejects
non-finite wire constants and exponent overflow instead of sanitizing input.

`wavedl.__init__` retains its public export names and version metadata through
lazy attribute resolution. This is necessary because importing
`wavedl.core.protocol` otherwise imports the package's ML stack first.

**Acceptance and gate (1A):**

| Structure failure case | Test |
|---|---|
| Unsupported version | `test_invalid_known_field[version-2]` and boolean-version case |
| Non-finite in payload | `test_nonfinite_input_is_rejected` and `test_recursive_sanitizing_produces_strict_json` |
| Negative seq/attempt | `test_invalid_known_field`, including zero attempt and bool seq |
| Malformed JSON | `test_malformed_or_missing_envelope` |
| Unknown fields tolerated | `test_round_trip_and_unknown_fields` |

The subprocess test blocks heavy imports in a fresh interpreter; the lazy-export
test separately checks that the existing public import remains usable.

- [ ] **Step 1: Write the failing tests**

```python
# unit_tests/core/test_protocol.py
import json
import os
import subprocess
import sys
from dataclasses import asdict
from pathlib import Path

import pytest

from wavedl.core.protocol import Envelope, ProtocolError, decode, encode, finite_or_none


RUN_ID = "00000000-0000-4000-8000-000000000001"


def event(**changes):
    values = {
        "run_id": RUN_ID,
        "attempt": 1,
        "type": "hello",
        "seq": 0,
        "ts": "2026-09-06T00:00:00Z",
        "payload": {},
    }
    return Envelope(**(values | changes))


def test_round_trip_and_unknown_fields():
    """Extra envelope fields survive decoding as ignored extensions."""
    original = event(payload={"future": {"label": "café"}})
    wire = asdict(original) | {"future_envelope": True}
    assert decode(json.dumps(wire)) == original
    assert decode(encode(original)) == original
    assert encode(original).endswith(b"\n")


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("version", 2),
        ("version", True),
        ("protocol", "other"),
        ("seq", -1),
        ("seq", True),
        ("attempt", -1),
        ("attempt", 0),
        ("ts", "yesterday"),
        ("ts", "2026-02-30T00:00:00Z"),
        ("run_id", "not-a-uuid"),
        ("payload", []),
    ],
)
def test_invalid_known_field(field, value):
    """Invalid known fields raise the shared exception, without coercion."""
    wire = asdict(event()) | {field: value}
    with pytest.raises(ProtocolError):
        decode(json.dumps(wire))


@pytest.mark.parametrize("wire", [b"{", b"\xff\n", b"[]", b"{}"])
def test_malformed_or_missing_envelope(wire):
    with pytest.raises(ProtocolError):
        decode(wire)


@pytest.mark.parametrize("token", ["NaN", "Infinity", "-Infinity", "1e999"])
def test_nonfinite_input_is_rejected(token):
    wire = encode(event(payload={"loss": 0})).replace(
        b'"loss":0', f'"loss":{token}'.encode()
    )
    with pytest.raises(ProtocolError):
        decode(wire)


def test_recursive_sanitizing_produces_strict_json():
    """Epoch-one infinity and nested non-finite metrics become null."""
    payload = {
        "best_val_loss": float("inf"),
        "nested": [float("nan"), {"negative": -float("inf")}],
    }
    expected = {"best_val_loss": None, "nested": [None, {"negative": None}]}
    assert finite_or_none(payload) == expected
    wire = encode(event(payload=payload))
    assert decode(wire).payload == expected
    assert b"Infinity" not in wire and b"NaN" not in wire
    assert payload["best_val_loss"] == float("inf")


def test_shared_import_loads_no_ml_gui_or_daemon():
    """A fresh interpreter can import contracts with every heavy import blocked."""
    script = """
import importlib.abc
import sys
class Block(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split(".")[0] in {
            "torch", "numpy", "PySide6", "wavedl_daemon", "wavedl_gui"
        } or fullname in {"wavedl.models", "wavedl.utils"}:
            raise AssertionError(fullname)
sys.meta_path.insert(0, Block())
from wavedl.core.protocol import Envelope
import wavedl
assert callable(wavedl.__getattr__)
assert "build_model" in dir(wavedl)
"""
    env = os.environ | {"PYTHONPATH": str(Path("src").resolve())}
    result = subprocess.run(
        [sys.executable, "-S", "-c", script],
        env=env,
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert result.returncode == 0, result.stderr


def test_public_exports_remain_lazy(monkeypatch):
    """The existing top-level export names still resolve to their owner."""
    import wavedl

    calls = []
    sentinel = object()

    class Module:
        build_model = sentinel

    def load(name):
        calls.append(name)
        return Module()

    monkeypatch.setattr(wavedl, "import_module", load)
    wavedl.__dict__.pop("build_model", None)
    assert wavedl.build_model is sentinel
    assert wavedl.build_model is sentinel
    assert calls == ["wavedl.models"]
    monkeypatch.delattr(wavedl, "build_model")
    with pytest.raises(AttributeError):
        wavedl.__getattr__("missing")
```

- [ ] **Step 2: Run the tests and verify the failure**

```bash
PYTHONPATH=src python3 -m pytest unit_tests/core/test_protocol.py \
  --confcutdir=unit_tests/core -v
```

Expected: collection fails with `ModuleNotFoundError: No module named 'wavedl.core'` because this task
has not introduced its implementation. An unrelated dependency/import error
is not the intended red result; resolve the interpreter/PYTHONPATH setup first.

- [ ] **Step 3: Write the minimal implementation**

```python
# src/wavedl/__init__.py
"""WaveDL public API; importing shared contracts does not load the ML stack."""

from importlib import import_module


__version__ = "1.8.1"
__author__ = "Ductho Le"
__email__ = "ductho.le@outlook.com"
__all__ = [
    "__version__",
    "build_model",
    "get_model",
    "list_models",
    "load_test_data",
    "load_training_data",
    "prepare_data",
    "register_model",
]
_EXPORTS = {
    "build_model": "wavedl.models",
    "get_model": "wavedl.models",
    "list_models": "wavedl.models",
    "register_model": "wavedl.models",
    "load_test_data": "wavedl.utils",
    "load_training_data": "wavedl.utils",
    "prepare_data": "wavedl.utils",
}


def __getattr__(name: str):
    if name not in _EXPORTS:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    value = getattr(import_module(_EXPORTS[name]), name)
    globals()[name] = value
    return value


def __dir__() -> list[str]:
    return sorted(set(globals()) | set(__all__))
```

```python
# src/wavedl/core/__init__.py
"""Dependency-light contracts shared by standalone runtimes and clients."""
```

```python
# src/wavedl/core/protocol.py
"""Strict UTF-8 JSON envelopes. Sequence numbers belong to one attempt."""

from __future__ import annotations

import json
import math
import re
from dataclasses import asdict, dataclass, fields
from datetime import datetime, timedelta
from uuid import UUID


class ProtocolError(ValueError):
    """A record violates the supported protocol."""


class MalformedJSON(ProtocolError):
    """Invalid UTF-8 or JSON syntax; readers may retain a bounded diagnostic."""


def finite_or_none(value: object) -> object:
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {key: finite_or_none(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [finite_or_none(item) for item in value]
    return value


def _reject_constant(token: str):
    raise ProtocolError(f"Non-finite JSON number: {token}")


def _finite_float(token: str) -> float:
    value = float(token)
    if not math.isfinite(value):
        raise ProtocolError(f"JSON number out of range: {token}")
    return value


def strict_loads(data: bytes | str) -> object:
    try:
        if isinstance(data, bytes):
            data = data.decode("utf-8")
        return json.loads(
            data, parse_constant=_reject_constant, parse_float=_finite_float
        )
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise MalformedJSON(str(exc)) from exc


@dataclass(frozen=True)
class Envelope:
    run_id: str
    attempt: int
    type: str
    seq: int
    ts: str
    payload: dict[str, object]
    protocol: str = "wavedl-jsonl"
    version: int = 1

    def __post_init__(self):
        if self.protocol != "wavedl-jsonl":
            raise ProtocolError("Unsupported protocol")
        if type(self.version) is not int or self.version != 1:
            raise ProtocolError("Unsupported version")
        for name, minimum in (("attempt", 1), ("seq", 0)):
            value = getattr(self, name)
            if type(value) is not int or value < minimum:
                raise ProtocolError(f"Invalid {name}")
        try:
            if not isinstance(self.run_id, str):
                raise ValueError("run_id must be a UUID string")
            UUID(self.run_id)
        except ValueError as exc:
            raise ProtocolError("Invalid run_id") from exc
        if not isinstance(self.type, str) or not self.type:
            raise ProtocolError("Invalid event type")
        if not isinstance(self.payload, dict):
            raise ProtocolError("payload must be an object")
        if not all(isinstance(key, str) for key in self.payload):
            raise ProtocolError("payload keys must be strings")
        if not isinstance(self.ts, str) or not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)",
            self.ts,
        ):
            raise ProtocolError("ts must be UTC RFC 3339")
        try:
            stamp = datetime.fromisoformat(self.ts.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ProtocolError("Invalid timestamp") from exc
        if stamp.utcoffset() != timedelta(0):
            raise ProtocolError("ts must be UTC")


def decode(data: bytes | str) -> Envelope:
    value = strict_loads(data)
    if not isinstance(value, dict):
        raise ProtocolError("Envelope must be an object")
    names = {item.name for item in fields(Envelope)}
    if not names <= value.keys():
        raise ProtocolError(f"Missing envelope fields: {sorted(names - value.keys())}")
    try:
        return Envelope(**{name: value[name] for name in names})
    except (TypeError, ValueError) as exc:
        raise ProtocolError(str(exc)) from exc


def encode(envelope: Envelope) -> bytes:
    try:
        data = json.dumps(
            finite_or_none(asdict(envelope)),
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        decode(data)
    except (TypeError, ValueError, UnicodeError) as exc:
        raise ProtocolError(str(exc)) from exc
    return data + b"\n"
```

- [ ] **Step 4: Run the tests and verify the pass count**

```bash
PYTHONPATH=src python3 -m pytest unit_tests/core/test_protocol.py \
  --confcutdir=unit_tests/core -v
```

Expected: **23 passed**, no failures or skips.

Run the focused style checks before committing:

```bash
PYTHONPATH=src ruff check --config pyproject.toml \
  src/wavedl/__init__.py \
  src/wavedl/core/__init__.py \
  src/wavedl/core/protocol.py \
  unit_tests/core/test_protocol.py
PYTHONPATH=src ruff format --config pyproject.toml --check \
  src/wavedl/__init__.py \
  src/wavedl/core/__init__.py \
  src/wavedl/core/protocol.py \
  unit_tests/core/test_protocol.py
```

Expected: Ruff reports no violations and all listed Python files are
already formatted. The implementation blocks use 88-column formatting.

- [ ] **Step 5: Commit this task only**

```bash
git add -- \
  src/wavedl/__init__.py \
  src/wavedl/core/__init__.py \
  src/wavedl/core/protocol.py \
  unit_tests/core/test_protocol.py
git commit --only -m "feat(core): define strict daemon-independent event envelopes" -- \
  src/wavedl/__init__.py \
  src/wavedl/core/__init__.py \
  src/wavedl/core/protocol.py \
  unit_tests/core/test_protocol.py
```

### Task T2: Per-type payload schemas + supersession event

**Files:**

- Create: `src/wavedl/core/events.py`
- Test (create): `unit_tests/core/test_events.py`

**Interfaces:**

Consumes T1: `Envelope`, `ProtocolError`, `decode(data: bytes | str) -> Envelope`,
and `encode(envelope: Envelope) -> bytes`.

Produces in `wavedl.core.events`:

- `HelloPayload`, `StatePayload`, `MetricPayload`, `ArtifactPayload`,
  `ExitPayload`, and `SupersedePayload`: frozen dataclasses, with every field and
  its type defined in the implementation below.
- `LogPayload`, `WarningPayload`, and `ErrorPayload` cover the remaining event
  kinds inherited by spec revision 2 from the Aug 2 spec §2.2.
- `Payload.from_dict(value: object) -> Self`: concrete subclasses return an
  instance of that subclass, strictly checking known fields and ignoring extras.
- `decode_payload(envelope: Envelope) -> Payload | None` and
  `UnknownEventWarning(RuntimeWarning)`; unknown types return `None` and warn.
- `validate_supersession(payload: SupersedePayload, known_steps: set[tuple[int, int]]) -> None`.

Validate external input through `decode` then `decode_payload`; dataclass
constructors are for already validated internal values. Numeric metric values
allow `None` for unavailable measurements; known integer counters reject bools
and strings. Unknown metric keys remain extension data.

Supersession is a logical rollback, never a deletion from the journal.
`SupersedePayload(source_attempt: int, step: int, generation: str,
reason: str = "resume")` identifies the published checkpoint being restored.
`step` is the completed epoch count, matching the existing CSV truncation at
`start_epoch`, not journal `seq`. The envelope belongs to the new execution;
`source_attempt` identifies the checkpoint's execution. Its effect is to
invalidate the active logical metric history strictly after `step`, including
inherited history, before accepting recomputed epochs from the new execution.

The caller supplies known `(attempt, step)` pairs from validated history or
published checkpoint metadata. Thus a checkpoint at step 0 is valid when its
published metadata establishes `(source_attempt, 0)`, even without an epoch-0
metric. An absent pair raises `ProtocolError` and changes nothing. T20b owns
checkpoint/step verification and the in-memory projection; T23 owns durable
projection application. T2 defines and validates their shared marker only.

**Acceptance and gate (1A):**

| Structure failure case | Test |
|---|---|
| Wrong type for known field | `test_known_field_wrong_type` covers all nine schemas; `test_existing_epoch_metric_types_are_enforced` covers current training fields |
| Unknown event type warns, not fatal | `test_unknown_event_warns_without_rejecting_envelope` |
| Supersession referencing absent step | `test_supersession_rejects_absent_attempt_step_without_mutation` includes the same step in a different attempt |

`test_supersession_accepts_exact_restored_step` supplies the positive control.
The parser preserves runtime-exit evidence; confirmation against scheduler or
process outcomes belongs to T9, not payload validation.

- [ ] **Step 1: Write the failing tests**

```python
# unit_tests/core/test_events.py
import pytest

from wavedl.core.events import (
    PAYLOADS,
    SupersedePayload,
    UnknownEventWarning,
    decode_payload,
    validate_supersession,
)
from wavedl.core.protocol import Envelope, ProtocolError, decode, encode


CASES = [
    (
        "hello",
        {
            "protocol_min": 1,
            "protocol_max": 1,
            "runtime_version": "1.8.1",
            "python": "3.11.9",
            "device": "cpu",
            "capabilities": ["journal"],
            "interpreter": "/runtime/python",
        },
        "protocol_min",
        "1",
    ),
    ("state", {"state": "running"}, "state", 1),
    ("metric", {"name": "epoch", "value": None, "step": 1}, "step", True),
    (
        "artifact",
        {
            "kind": "checkpoint",
            "path": "checkpoints/gen-000001",
            "sha256": "a" * 64,
            "size": 12,
        },
        "size",
        "12",
    ),
    ("exit", {"code": 0, "status": "completed"}, "code", False),
    (
        "supersede",
        {"source_attempt": 1, "step": 90, "generation": "gen-000001"},
        "step",
        "90",
    ),
    ("log", {"stream": "stderr", "level": "info", "message": "saved"}, "message", 42),
    ("warning", {"code": "late", "message": "retry"}, "details", []),
    ("error", {"code": "io", "message": "full"}, "recoverable", "false"),
]


def envelope(kind, payload):
    return Envelope(
        run_id="00000000-0000-4000-8000-000000000001",
        attempt=1,
        type=kind,
        seq=0,
        ts="2026-09-06T00:00:00Z",
        payload=payload,
    )


@pytest.mark.parametrize(("kind", "payload", "field", "bad"), CASES)
def test_known_payload_and_extension_fields(kind, payload, field, bad):
    parsed = decode_payload(decode(encode(envelope(kind, payload | {"future": 7}))))
    assert isinstance(parsed, PAYLOADS[kind])
    assert not hasattr(parsed, "future")


@pytest.mark.parametrize(("kind", "payload", "field", "bad"), CASES)
def test_known_field_wrong_type(kind, payload, field, bad):
    with pytest.raises(ProtocolError):
        decode_payload(envelope(kind, payload | {field: bad}))


def test_unknown_event_warns_without_rejecting_envelope():
    original = envelope("future-event", {"arbitrary": [1, 2]})
    with pytest.warns(UnknownEventWarning, match="future-event"):
        assert decode_payload(decode(encode(original))) is None
    assert decode(encode(original)) == original


def test_supersession_rejects_absent_attempt_step_without_mutation():
    payload = SupersedePayload.from_dict(
        {"source_attempt": 1, "step": 90, "generation": "gen-000001"}
    )
    known = {(1, 89), (2, 90)}
    with pytest.raises(ProtocolError, match="absent step"):
        validate_supersession(payload, known)
    assert known == {(1, 89), (2, 90)}


def test_supersession_accepts_exact_restored_step():
    payload = SupersedePayload(1, 90, "gen-000001")
    assert validate_supersession(payload, {(1, 90), (1, 100)}) is None


@pytest.mark.parametrize(
    "payload",
    [
        {"name": "epoch", "value": 1, "step": -1},
        {"name": "epoch", "value": 1, "step": 1, "metrics": {"lr": "fast"}},
        {"name": "epoch", "value": 1, "step": 1, "metrics": {"per_param_mae": []}},
    ],
)
def test_metric_known_semantics(payload):
    with pytest.raises(ProtocolError):
        decode_payload(envelope("metric", payload))


def test_nested_exit_artifact_is_validated():
    with pytest.raises(ProtocolError):
        decode_payload(
            envelope(
                "exit",
                {
                    "code": 0,
                    "status": "completed",
                    "artifacts": [{"size": "wrong"}],
                },
            )
        )


@pytest.mark.parametrize(
    "name",
    [
        "grad_norm",
        "mae_avg",
        "val_r2",
        "val_pearson",
        "val_mae_avg",
        "total_time",
        "epoch",
        "total_epochs",
        "patience_counter",
        "max_patience",
        "mae_per_param",
        "MAE_Phys_P0",
    ],
)
def test_existing_epoch_metric_types_are_enforced(name):
    with pytest.raises(ProtocolError):
        decode_payload(
            envelope(
                "metric",
                {
                    "name": "epoch",
                    "value": 1,
                    "step": 1,
                    "metrics": {name: "wrong"},
                },
            )
        )


def test_existing_epoch_metric_shapes_accept_unavailable_values():
    parsed = decode_payload(
        envelope(
            "metric",
            {
                "name": "epoch",
                "value": 1,
                "step": 1,
                "metrics": {
                    "epoch": 1,
                    "total_epochs": 20,
                    "patience_counter": 0,
                    "max_patience": 5,
                    "mae_per_param": [None, 0.5],
                    "MAE_Phys_P0": None,
                    "best_val_loss": None,
                },
            },
        )
    )
    assert parsed.metrics["mae_per_param"] == [None, 0.5]
```

- [ ] **Step 2: Run the tests and verify the failure**

```bash
PYTHONPATH=src python3 -m pytest unit_tests/core/test_events.py \
  --confcutdir=unit_tests/core -v
```

Expected: collection fails with `ModuleNotFoundError: No module named 'wavedl.core.events'` because this task
has not introduced its implementation. An unrelated dependency/import error
is not the intended red result; resolve the interpreter/PYTHONPATH setup first.

- [ ] **Step 3: Write the minimal implementation**

```python
# src/wavedl/core/events.py
"""Typed payloads and the resume rollback marker; no projection side effects."""

from __future__ import annotations

import math
import types
import warnings
from dataclasses import dataclass, field, fields, is_dataclass
from typing import Literal, Self, get_args, get_origin, get_type_hints

from wavedl.core.protocol import Envelope, ProtocolError


class UnknownEventWarning(RuntimeWarning):
    """An extension event was retained but has no local payload schema."""


def _typed(value: object, annotation: object) -> object:
    origin = get_origin(annotation)
    args = get_args(annotation)
    if origin is types.UnionType:
        for option in args:
            try:
                return _typed(value, option)
            except ProtocolError:
                continue
        raise ProtocolError("Value does not match any allowed type")
    if origin is Literal:
        if any(type(value) is type(item) and value == item for item in args):
            return value
    elif origin is list and isinstance(value, list):
        return [_typed(item, args[0]) for item in value]
    elif origin is dict and isinstance(value, dict):
        return {
            _typed(key, args[0]): _typed(item, args[1]) for key, item in value.items()
        }
    elif annotation is object:
        return value
    elif annotation is float and type(value) in (int, float):
        if math.isfinite(value):
            return float(value)
    elif isinstance(annotation, type) and is_dataclass(annotation):
        return annotation.from_dict(value)
    elif type(value) is annotation:
        return value
    raise ProtocolError(f"Expected {annotation}, got {type(value).__name__}")


class Payload:
    @classmethod
    def from_dict(cls, value: object) -> Self:
        if not isinstance(value, dict):
            raise ProtocolError("Payload must be an object")
        annotations = get_type_hints(cls)
        try:
            result = cls(
                **{
                    item.name: _typed(value[item.name], annotations[item.name])
                    for item in fields(cls)
                    if item.name in value
                }
            )
        except (TypeError, ValueError) as exc:
            raise ProtocolError(f"Invalid {cls.__name__}: {exc}") from exc
        for name in ("step", "size", "protocol_min", "protocol_max", "source_attempt"):
            number = getattr(result, name, None)
            minimum = (
                1 if name in {"protocol_min", "protocol_max", "source_attempt"} else 0
            )
            if number is not None and number < minimum:
                raise ProtocolError(f"Invalid {name}")
        if (
            isinstance(result, HelloPayload)
            and result.protocol_min > result.protocol_max
        ):
            raise ProtocolError("Reversed protocol range")
        if isinstance(result, SupersedePayload) and not result.generation:
            raise ProtocolError("Missing restored generation")
        return result


@dataclass(frozen=True)
class HelloPayload(Payload):
    protocol_min: int
    protocol_max: int
    runtime_version: str
    python: str
    device: Literal["cpu", "mps", "cuda"]
    capabilities: list[str]
    interpreter: str
    container: str | None = None
    allocated_devices: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class StatePayload(Payload):
    state: Literal[
        "starting", "running", "stopping", "completed", "failed", "cancelled"
    ]
    message: str = ""


@dataclass(frozen=True)
class MetricPayload(Payload):
    name: str
    value: float | None
    step: int
    unit: str = ""
    metrics: dict[str, object] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, value: object) -> Self:
        result = super().from_dict(value)
        for name in (
            "train_loss",
            "val_loss",
            "best_val_loss",
            "lr",
            "r2",
            "pearson",
            "patience",
            "patience_ctr",
            "epoch_time",
            "elapsed_time",
            "grad_norm",
            "mae_avg",
            "val_r2",
            "val_pearson",
            "val_mae_avg",
            "total_time",
        ):
            if name in result.metrics:
                _typed(result.metrics[name], float | None)
        for name in ("epoch", "total_epochs", "patience_counter", "max_patience"):
            if name in result.metrics:
                _typed(result.metrics[name], int)
        if "mae_per_param" in result.metrics:
            _typed(result.metrics["mae_per_param"], list[float | None])
        for name, metric in result.metrics.items():
            if name.startswith("MAE_Phys_P"):
                _typed(metric, float | None)
        if "per_param_mae" in result.metrics:
            _typed(result.metrics["per_param_mae"], dict[str, float | None])
        return result


@dataclass(frozen=True)
class ArtifactPayload(Payload):
    kind: Literal["checkpoint", "plot", "history", "other"]
    path: str
    sha256: str
    size: int
    label: str = ""
    generation: str | None = None
    step: int | None = None


@dataclass(frozen=True)
class ExitPayload(Payload):
    code: int
    status: Literal["completed", "failed", "cancelled"]
    message: str = ""
    artifacts: list[ArtifactPayload] = field(default_factory=list)


@dataclass(frozen=True)
class SupersedePayload(Payload):
    source_attempt: int
    step: int
    generation: str
    reason: str = "resume"


@dataclass(frozen=True)
class LogPayload(Payload):
    stream: Literal["stdout", "stderr", "system"]
    level: Literal["debug", "info", "warning", "error"]
    message: str


@dataclass(frozen=True)
class WarningPayload(Payload):
    code: str
    message: str
    details: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class ErrorPayload(WarningPayload):
    recoverable: bool = False


PAYLOADS = {
    "hello": HelloPayload,
    "state": StatePayload,
    "metric": MetricPayload,
    "artifact": ArtifactPayload,
    "exit": ExitPayload,
    "supersede": SupersedePayload,
    "log": LogPayload,
    "warning": WarningPayload,
    "error": ErrorPayload,
}


def decode_payload(envelope: Envelope) -> Payload | None:
    schema = PAYLOADS.get(envelope.type)
    if schema is None:
        warnings.warn(
            f"Unknown event type: {envelope.type}", UnknownEventWarning, stacklevel=2
        )
        return None
    return schema.from_dict(envelope.payload)


def validate_supersession(
    payload: SupersedePayload, known_steps: set[tuple[int, int]]
) -> None:
    if (payload.source_attempt, payload.step) not in known_steps:
        raise ProtocolError("Supersession references an absent step")
```

- [ ] **Step 4: Run the tests and verify the pass count**

```bash
PYTHONPATH=src python3 -m pytest unit_tests/core/test_events.py \
  --confcutdir=unit_tests/core -v
```

Expected: **38 passed**, no failures or skips.

Run the focused style checks before committing:

```bash
PYTHONPATH=src ruff check --config pyproject.toml \
  src/wavedl/core/events.py \
  unit_tests/core/test_events.py
PYTHONPATH=src ruff format --config pyproject.toml --check \
  src/wavedl/core/events.py \
  unit_tests/core/test_events.py
```

Expected: Ruff reports no violations and all listed Python files are
already formatted. The implementation blocks use 88-column formatting.

- [ ] **Step 5: Commit this task only**

```bash
git add -- \
  src/wavedl/core/events.py \
  unit_tests/core/test_events.py
git commit --only -m "feat(core): validate event payloads and resume supersession" -- \
  src/wavedl/core/events.py \
  unit_tests/core/test_events.py
```

### Task T5: Run layout, attempt allocation, operation identity

**Files:**

- Create: `src/wavedl/core/layout.py`
- Test (create): `unit_tests/core/test_layout.py`

**Interfaces:**

Consumes: no earlier domain contract. The `wavedl.core` package initializer
already exists from T1 in this execution order.

Produces in `wavedl.core.layout`:

- `OperationKind(StrEnum)` with `TRAIN = "train"`, `TEST = "test"`,
  and `PLOT = "plot"`.
- `RunLayout(run_dir: Path, run_id: str)`; frozen dataclass.
- `RunLayout.create(root: Path, run_id: str) -> RunLayout`: exclusively creates
  `<root>/<run_id>` and its `attempts`, `checkpoints`, and `plots` directories.
- `RunLayout.manifest: Path`, `RunLayout.attempts: Path`,
  `RunLayout.checkpoints: Path`.
- `RunLayout.attempt_dir(attempt: int) -> Path` and
  `RunLayout.journal(attempt: int) -> Path`.
- `allocate_attempt(layout: RunLayout) -> int`: atomically reserves a positive
  integer directory and creates its `rank` diagnostics directory.

A reservation is never recycled, including after a crash leaves an empty
numeric directory. Numeric files and leading-zero directory names also reserve
numbers; unrelated names do not. `mkdir` provides cross-process exclusion;
the barrier test forces the collision at that filesystem operation. No process
or scheduler identifier participates in attempt numbering. The launcher/main
rank calls allocation once for each execution, then propagates the number to
its ranks in T19. The same SLURM job id can therefore own attempts 1 and 2.

Scheduler log filenames do not go under this numeric namespace; T15 owns their
separate precreated log directory. `stderr.log` and `rank/<rank>.log` are paths
inside an attempt; T19 creates/writes those diagnostic files.

**Acceptance and gate (1A):**

| Structure failure case | Test |
|---|---|
| Concurrent allocation race | `test_allocation_collision_at_mkdir`, with a barrier before either caller creates attempt 1 |
| Existing numeric dirs | `test_existing_numeric_entries_are_never_reused` |
| Requeue creating attempt 2 | `test_requeue_allocates_second_execution_with_same_job_id` |

`test_run_is_exclusive_and_operations_are_stable` also prevents output-directory
reuse and locks the train/test/plot identity values before backend planning.

- [ ] **Step 1: Write the failing tests**

```python
# unit_tests/core/test_layout.py
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

import pytest

from wavedl.core.layout import OperationKind, RunLayout, allocate_attempt


RUN_ID = "00000000-0000-4000-8000-000000000001"


def test_run_is_exclusive_and_operations_are_stable(tmp_path):
    layout = RunLayout.create(tmp_path, RUN_ID)
    assert layout.manifest == layout.run_dir / "manifest.json"
    assert [kind.value for kind in OperationKind] == ["train", "test", "plot"]
    with pytest.raises(FileExistsError):
        RunLayout.create(tmp_path, RUN_ID)


def test_allocation_collision_at_mkdir(tmp_path, monkeypatch):
    """Both writers choose 1 before either mkdir; only one can reserve it."""
    layout = RunLayout.create(tmp_path, RUN_ID)
    barrier = Barrier(2)
    original = Path.mkdir

    def synchronized(path, *args, **kwargs):
        if path == layout.attempt_dir(1):
            barrier.wait(timeout=5)
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "mkdir", synchronized)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(allocate_attempt, layout) for _ in range(2)]
        allocated = sorted(future.result(timeout=10) for future in futures)
    assert allocated == [1, 2]
    assert all((layout.attempt_dir(number) / "rank").is_dir() for number in allocated)


def test_existing_numeric_entries_are_never_reused(tmp_path):
    layout = RunLayout.create(tmp_path, RUN_ID)
    (layout.attempts / "2").mkdir()
    (layout.attempts / "009").mkdir()
    (layout.attempts / "11").write_text("reserved", encoding="utf-8")
    (layout.attempts / "notes").mkdir()
    assert allocate_attempt(layout) == 12


def test_requeue_allocates_second_execution_with_same_job_id(tmp_path, monkeypatch):
    layout = RunLayout.create(tmp_path, RUN_ID)
    monkeypatch.setenv("SLURM_JOB_ID", "1234")
    first = allocate_attempt(layout)
    monkeypatch.setenv("SLURM_RESTART_COUNT", "1")
    second = allocate_attempt(layout)
    assert (first, second) == (1, 2)
    assert layout.journal(first) != layout.journal(second)


@pytest.mark.parametrize("attempt", [-1, 0, True])
def test_invalid_attempt(tmp_path, attempt):
    layout = RunLayout.create(tmp_path, RUN_ID)
    with pytest.raises(ValueError):
        layout.attempt_dir(attempt)
```

- [ ] **Step 2: Run the tests and verify the failure**

```bash
PYTHONPATH=src python3 -m pytest unit_tests/core/test_layout.py \
  --confcutdir=unit_tests/core -v
```

Expected: collection fails with `ModuleNotFoundError: No module named 'wavedl.core.layout'` because this task
has not introduced its implementation. An unrelated dependency/import error
is not the intended red result; resolve the interpreter/PYTHONPATH setup first.

- [ ] **Step 3: Write the minimal implementation**

```python
# src/wavedl/core/layout.py
"""Exclusive run directories and per-execution attempt reservations."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING
from uuid import UUID


if TYPE_CHECKING:
    from pathlib import Path


class OperationKind(StrEnum):
    TRAIN = "train"
    TEST = "test"
    PLOT = "plot"


@dataclass(frozen=True)
class RunLayout:
    run_dir: Path
    run_id: str

    def __post_init__(self):
        UUID(self.run_id)
        object.__setattr__(self, "run_dir", self.run_dir.resolve())

    @classmethod
    def create(cls, root: Path, run_id: str) -> RunLayout:
        UUID(run_id)
        layout = cls(root / run_id, run_id)
        root.mkdir(parents=True, exist_ok=True)
        layout.run_dir.mkdir(mode=0o700)
        layout.attempts.mkdir()
        layout.checkpoints.mkdir()
        (layout.run_dir / "plots").mkdir()
        return layout

    @property
    def manifest(self) -> Path:
        return self.run_dir / "manifest.json"

    @property
    def attempts(self) -> Path:
        return self.run_dir / "attempts"

    @property
    def checkpoints(self) -> Path:
        return self.run_dir / "checkpoints"

    def attempt_dir(self, attempt: int) -> Path:
        if type(attempt) is not int or attempt < 1:
            raise ValueError("attempt must be a positive integer")
        return self.attempts / str(attempt)

    def journal(self, attempt: int) -> Path:
        return self.attempt_dir(attempt) / "events.jsonl"


def allocate_attempt(layout: RunLayout) -> int:
    """Reserve by mkdir; gaps are reservations and are never recycled."""
    layout.attempts.mkdir(exist_ok=True)
    numbers = [
        int(path.name) for path in layout.attempts.iterdir() if path.name.isdecimal()
    ]
    attempt = max(numbers, default=0) + 1
    while True:
        try:
            layout.attempt_dir(attempt).mkdir(mode=0o700)
        except FileExistsError:
            attempt += 1
            continue
        (layout.attempt_dir(attempt) / "rank").mkdir()
        return attempt
```

- [ ] **Step 4: Run the tests and verify the pass count**

```bash
PYTHONPATH=src python3 -m pytest unit_tests/core/test_layout.py \
  --confcutdir=unit_tests/core -v
```

Expected: **7 passed**, no failures or skips.

Run the focused style checks before committing:

```bash
PYTHONPATH=src ruff check --config pyproject.toml \
  src/wavedl/core/layout.py \
  unit_tests/core/test_layout.py
PYTHONPATH=src ruff format --config pyproject.toml --check \
  src/wavedl/core/layout.py \
  unit_tests/core/test_layout.py
```

Expected: Ruff reports no violations and all listed Python files are
already formatted. The implementation blocks use 88-column formatting.

- [ ] **Step 5: Commit this task only**

```bash
git add -- \
  src/wavedl/core/layout.py \
  unit_tests/core/test_layout.py
git commit --only -m "feat(core): allocate exclusive runs and execution attempts" -- \
  src/wavedl/core/layout.py \
  unit_tests/core/test_layout.py
```

### Task T6: Resolved manifest in wavedl.core

**Files:**

- Create: `src/wavedl/core/persistence.py`
- Create: `src/wavedl/core/manifest.py`
- Test (create): `unit_tests/core/test_manifest.py`

**Interfaces:**

Consumes T5: `RunLayout`, its `manifest: Path` and `run_dir: Path`,
`OperationKind`, and `allocate_attempt(layout: RunLayout) -> int` in tests.

Produces in `wavedl.core.manifest`:

- `RuntimeSelection(python: str, mode: str, device: str, environment: dict[str, str], container: str | None = None)`.
- `StorageMapping(host_root: str, execution_root: str)`; roots are absolute.
- `Manifest`: frozen record containing `run_id: str`,
  `operation: OperationKind`, `resolved_config: dict[str, object]`,
  `runtime: RuntimeSelection`, `submission_directory: str`,
  `working_directory: str`, `run_directory: str`,
  `storage_map: tuple[StorageMapping, ...]`, `path_fields: tuple[str, ...]`,
  `schema_version: int = 1`, and `attempt_index: str = "attempts"`.
- `build_manifest(layout: RunLayout, *, operation: OperationKind, resolved_config: dict[str, object], runtime: RuntimeSelection, submission_cwd: Path, storage_map: tuple[StorageMapping, ...] = (), path_fields: tuple[str, ...] = PATH_FIELDS) -> Manifest`.
- `write_manifest(layout: RunLayout, manifest: Manifest) -> None`.
- `read_manifest(path: Path) -> Manifest`.
- `PATH_FIELDS: tuple[str, ...]` enumerates dataset, config, resume, checkpoint,
  constraint, and export paths in the code below; callers can supply additional
  normalized configuration path keys explicitly.

Produces in `wavedl.core.persistence`:

- `sync_directory(path: Path) -> None`.
- `write_once(path: Path, content: bytes) -> None`: temporary file in the same
  directory, file flush/fsync, atomic exclusive hard link to the final name,
  then directory sync. No `exists()` check controls publication.

`resolved_config` is the full effective configuration after defaults, YAML,
and explicit CLI overrides have been merged by the planning caller. This
function takes a detached snapshot of that object; it neither stores raw argv
nor imports the ML configuration loader. Relative paths use `submission_cwd`,
matching CLI path semantics, before a Local backend changes cwd. Longest host
root mapping wins. `working_directory` and managed `output_dir` are the mapped
run directory; `run_directory` is its host location. Runtime environment values
and container identity are explicit input, not inferred from the daemon's
process. Container wrappers and environment activation are rendered in T13/T15;
container identity here is an identifier, not a shell command to execute.

The immutable manifest's `attempt_index` points to its append-only `attempts/`
namespace. This makes the spec's attempt index compatible with manifest
immutability: new execution reservations update the index directory, never
rewrite the submitted plan. Runtime provenance still belongs to `hello`.

The no-replace publication requires filesystem hard-link support. Directory
sync uses POSIX fsync or Windows `FlushFileBuffers` on a directory handle;
unsupported operations propagate `OSError`, without a weaker fallback.
If directory sync fails after linking, the complete file may be visible but
crash durability is unconfirmed. Callers must read/reconcile that existing
manifest, never overwrite it. A process killed before linking can leave a hidden
temporary file; readers use only `manifest.json` and ignore these remnants.

**Acceptance and gate (1A):**

| Structure failure case | Test |
|---|---|
| Overwrite refused | `test_overwrite_refused_and_attempt_index_does_not_mutate_plan`; simultaneous publishers also race at `os.link` |
| Interrupted write leaves no partial file | `test_partial_temporary_write_never_exposes_manifest` writes half the JSON before ENOSPC; file-fsync failure and process-death tests cover the next boundaries |
| Relative paths resolved before submission | `test_relative_paths_resolve_before_execution_changes_cwd` changes cwd before asserting dataset/config/resume/interpreter paths |

The concurrent test inspects both complete temporary files before releasing
either link operation. The killed-process test uses `os._exit(73)` so cleanup
handlers cannot make the assertion pass artificially.

- [ ] **Step 1: Write the failing tests**

```python
# unit_tests/core/test_manifest.py
import errno
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from pathlib import Path
from threading import Barrier

import pytest

from wavedl.core import persistence
from wavedl.core.layout import OperationKind, RunLayout, allocate_attempt
from wavedl.core.manifest import (
    RuntimeSelection,
    StorageMapping,
    build_manifest,
    read_manifest,
    write_manifest,
)


RUN_ID = "00000000-0000-4000-8000-000000000001"


def plan(tmp_path, **changes):
    layout = RunLayout.create(tmp_path / "runs", RUN_ID)
    options = {
        "operation": OperationKind.TRAIN,
        "resolved_config": {
            "data_path": "dataset.npz",
            "config": "config.yaml",
            "lr": 0.01,
        },
        "runtime": RuntimeSelection("venv/python", "existing", "cpu", {}),
        "submission_cwd": tmp_path,
    }
    return layout, build_manifest(layout, **(options | changes))


def test_relative_paths_resolve_before_execution_changes_cwd(tmp_path, monkeypatch):
    config = {
        "data_path": "data/train.npz",
        "config": "cfg/train.yaml",
        "resume": "old/best",
        "lr": 0.02,
    }
    layout, manifest = plan(tmp_path, resolved_config=config)
    monkeypatch.chdir(layout.run_dir)
    assert manifest.resolved_config["data_path"] == str(tmp_path / "data/train.npz")
    assert manifest.resolved_config["config"] == str(tmp_path / "cfg/train.yaml")
    assert manifest.resolved_config["resume"] == str(tmp_path / "old/best")
    assert manifest.resolved_config["lr"] == 0.02
    assert manifest.runtime.python == str(tmp_path / "venv/python")
    assert manifest.working_directory == str(layout.run_dir)
    assert manifest.resolved_config["output_dir"] == str(layout.run_dir)
    assert config["data_path"] == "data/train.npz"


def test_storage_mapping_and_runtime_selection_are_persisted(tmp_path):
    runtime = RuntimeSelection(
        "venv/python", "container", "cuda", {"CUDA_VISIBLE_DEVICES": "0,1"}, "image.sif"
    )
    execution_root = str(tmp_path / "execution")
    layout, manifest = plan(
        tmp_path,
        runtime=runtime,
        storage_map=(StorageMapping(str(tmp_path), execution_root),),
    )
    write_manifest(layout, manifest)
    restored = read_manifest(layout.manifest)
    assert restored == manifest
    assert restored.runtime.environment == {"CUDA_VISIBLE_DEVICES": "0,1"}
    assert restored.runtime.container == "image.sif"
    assert restored.resolved_config["data_path"] == str(
        Path(execution_root) / "dataset.npz"
    )
    assert restored.working_directory == str(Path(execution_root) / "runs" / RUN_ID)


def test_overwrite_refused_and_attempt_index_does_not_mutate_plan(tmp_path):
    layout, manifest = plan(tmp_path)
    write_manifest(layout, manifest)
    original = layout.manifest.read_bytes()
    assert allocate_attempt(layout) == 1
    assert allocate_attempt(layout) == 2
    assert manifest.attempt_index == "attempts"
    with pytest.raises(FileExistsError):
        write_manifest(layout, manifest)
    assert layout.manifest.read_bytes() == original


def test_interruption_before_link_exposes_no_partial_manifest(tmp_path, monkeypatch):
    """An fsync error after bytes are written cannot expose manifest.json."""
    layout, manifest = plan(tmp_path)

    def fail(fd):
        raise OSError(errno.ENOSPC, "full at file fsync")

    monkeypatch.setattr(persistence.os, "fsync", fail)
    with pytest.raises(OSError, match="full at file fsync"):
        write_manifest(layout, manifest)
    assert not layout.manifest.exists()
    assert not list(layout.run_dir.glob(".manifest.json-*"))


def test_simultaneous_publication_has_one_complete_winner(tmp_path, monkeypatch):
    """Two publishers race at the exclusive link boundary, not at exists()."""
    layout, manifest = plan(tmp_path)
    barrier = Barrier(2)
    real_link = os.link
    observed = []

    def link(source, destination):
        assert not layout.manifest.exists()
        observed.append(json.loads(Path(source).read_bytes())["run_id"])
        barrier.wait(timeout=5)
        return real_link(source, destination)

    monkeypatch.setattr(persistence.os, "link", link)

    def publish():
        try:
            write_manifest(layout, manifest)
        except FileExistsError:
            return "exists"
        return "created"

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(publish) for _ in range(2)]
        results = sorted(future.result(timeout=10) for future in futures)
    assert results == ["created", "exists"]
    assert observed == [RUN_ID, RUN_ID]
    assert read_manifest(layout.manifest) == manifest


def test_process_death_before_publication_leaves_only_hidden_temporary(tmp_path):
    """Abrupt death bypasses finally, yet readers cannot see a partial manifest."""
    layout, manifest = plan(tmp_path)
    input_path = tmp_path / "input.json"
    input_path.write_text(json.dumps(asdict(manifest)), encoding="utf-8")
    script = """
import os
import sys
from pathlib import Path
from wavedl.core import persistence
from wavedl.core.layout import RunLayout
from wavedl.core.manifest import read_manifest, write_manifest
manifest = read_manifest(Path(sys.argv[1]))
layout = RunLayout(Path(manifest.run_directory), manifest.run_id)
def die(source, target):
    os._exit(73)
persistence.os.link = die
write_manifest(layout, manifest)
"""
    result = subprocess.run(
        [sys.executable, "-S", "-c", script, str(input_path)],
        env=os.environ | {"PYTHONPATH": str(Path("src").resolve())},
        timeout=15,
        capture_output=True,
    )
    assert result.returncode == 73, result.stderr
    assert not layout.manifest.exists()
    temporary = list(layout.run_dir.glob(".manifest.json-*"))
    assert len(temporary) == 1
    assert json.loads(temporary[0].read_bytes())["run_id"] == RUN_ID
    write_manifest(layout, manifest)
    assert read_manifest(layout.manifest) == manifest


def test_invalid_configuration_does_not_create_manifest(tmp_path):
    with pytest.raises(ValueError):
        plan(tmp_path, resolved_config={"lr": float("inf")})
    assert not list(tmp_path.rglob("manifest.json"))


def test_partial_temporary_write_never_exposes_manifest(tmp_path, monkeypatch):
    """Fail inside writing after half the JSON bytes reached the temporary file."""
    layout, manifest = plan(tmp_path)
    real_fdopen = persistence.os.fdopen
    observed = []

    class InterruptedFile:
        def __init__(self, stream):
            self.stream = stream

        def __enter__(self):
            return self

        def __exit__(self, *args):
            self.stream.close()

        def write(self, data):
            self.stream.write(data[: len(data) // 2])
            self.stream.flush()
            temporary = list(layout.run_dir.glob(".manifest.json-*"))
            observed.append(temporary[0].read_bytes())
            assert not layout.manifest.exists()
            raise OSError(errno.ENOSPC, "interrupted JSON write")

    def fdopen(fd, mode):
        return InterruptedFile(real_fdopen(fd, mode))

    monkeypatch.setattr(persistence.os, "fdopen", fdopen)
    with pytest.raises(OSError, match="interrupted JSON write"):
        write_manifest(layout, manifest)
    assert len(observed) == 1 and observed[0]
    with pytest.raises(json.JSONDecodeError):
        json.loads(observed[0])
    assert not layout.manifest.exists()
    assert not list(layout.run_dir.glob(".manifest.json-*"))
```

- [ ] **Step 2: Run the tests and verify the failure**

```bash
PYTHONPATH=src python3 -m pytest unit_tests/core/test_manifest.py \
  --confcutdir=unit_tests/core -v
```

Expected: collection fails with `ImportError: cannot import name 'persistence' from 'wavedl.core'` because this task
has not introduced its implementation. An unrelated dependency/import error
is not the intended red result; resolve the interpreter/PYTHONPATH setup first.

- [ ] **Step 3: Write the minimal implementation**

```python
# src/wavedl/core/persistence.py
"""Exclusive publication of complete files on storage supporting durable sync."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path


def sync_directory(path: Path) -> None:
    """Flush a directory entry; unsupported storage raises, never degrades silently."""
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        create = kernel.CreateFileW
        create.argtypes = [
            wintypes.LPCWSTR,
            wintypes.DWORD,
            wintypes.DWORD,
            wintypes.LPVOID,
            wintypes.DWORD,
            wintypes.DWORD,
            wintypes.HANDLE,
        ]
        create.restype = wintypes.HANDLE
        flush = kernel.FlushFileBuffers
        flush.argtypes = [wintypes.HANDLE]
        flush.restype = wintypes.BOOL
        close = kernel.CloseHandle
        close.argtypes = [wintypes.HANDLE]
        close.restype = wintypes.BOOL
        handle = create(str(path), 0xC0000000, 7, None, 3, 0x02000000, None)
        if handle == wintypes.HANDLE(-1).value:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            if not flush(handle):
                raise ctypes.WinError(ctypes.get_last_error())
        finally:
            close(handle)
        return
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_once(path: Path, content: bytes) -> None:
    """Publish with atomic no-replace link after the temporary file is fsynced."""
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}-", dir=path.parent)
    temporary = Path(temporary)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, path)
        sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)
```

```python
# src/wavedl/core/manifest.py
"""Resolved execution plans, shared by standalone runtimes and the daemon."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

from wavedl.core.layout import OperationKind, RunLayout
from wavedl.core.persistence import write_once


PATH_FIELDS = (
    "data_path",
    "config",
    "resume",
    "checkpoint",
    "constraint_file",
    "export_path",
)


def _json_bytes(value: object) -> bytes:
    return (
        json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        + b"\n"
    )


def _bad_constant(value: str):
    raise ValueError(f"Invalid JSON constant: {value}")


@dataclass(frozen=True)
class RuntimeSelection:
    python: str
    mode: str
    device: str
    environment: dict[str, str]
    container: str | None = None

    def __post_init__(self):
        if self.mode not in {"existing", "selected", "bundled", "container"}:
            raise ValueError("Invalid runtime mode")
        if self.device not in {"cpu", "mps", "cuda", "auto"}:
            raise ValueError("Invalid device")
        if not isinstance(self.python, str) or not self.python:
            raise ValueError("Runtime interpreter is required")
        if not isinstance(self.environment, dict) or not all(
            isinstance(key, str) and isinstance(value, str)
            for key, value in self.environment.items()
        ):
            raise ValueError("Runtime environment must contain strings")
        if self.container is not None and not isinstance(self.container, str):
            raise ValueError("Invalid container")


@dataclass(frozen=True)
class StorageMapping:
    host_root: str
    execution_root: str

    def __post_init__(self):
        if (
            not Path(self.host_root).is_absolute()
            or not Path(self.execution_root).is_absolute()
        ):
            raise ValueError("Storage mapping roots must be absolute")


@dataclass(frozen=True)
class Manifest:
    run_id: str
    operation: OperationKind
    resolved_config: dict[str, object]
    runtime: RuntimeSelection
    submission_directory: str
    working_directory: str
    run_directory: str
    storage_map: tuple[StorageMapping, ...]
    path_fields: tuple[str, ...]
    schema_version: int = 1
    attempt_index: str = "attempts"

    def __post_init__(self):
        RunLayout(Path(self.run_directory), self.run_id)
        if type(self.schema_version) is not int or self.schema_version != 1:
            raise ValueError("Unsupported manifest schema")
        if self.attempt_index != "attempts":
            raise ValueError("Invalid attempt index")
        if not isinstance(self.operation, OperationKind):
            raise ValueError("Invalid operation")
        for path in (
            self.submission_directory,
            self.working_directory,
            self.run_directory,
        ):
            if not Path(path).is_absolute():
                raise ValueError("Manifest directories must be absolute")
        if not Path(self.runtime.python).is_absolute():
            raise ValueError("Runtime interpreter must be resolved")
        if not isinstance(self.resolved_config, dict):
            raise ValueError("resolved_config must be an object")
        for name in self.path_fields:
            value = self.resolved_config.get(name)
            if value is not None and (
                not isinstance(value, str) or not Path(value).is_absolute()
            ):
                raise ValueError(f"Unresolved path: {name}")
        if self.resolved_config.get("output_dir") != self.working_directory:
            raise ValueError("Output directory must belong to this run")
        _json_bytes(asdict(self))


def build_manifest(
    layout: RunLayout,
    *,
    operation: OperationKind,
    resolved_config: dict[str, object],
    runtime: RuntimeSelection,
    submission_cwd: Path,
    storage_map: tuple[StorageMapping, ...] = (),
    path_fields: tuple[str, ...] = PATH_FIELDS,
) -> Manifest:
    """Snapshot already merged defaults/YAML/CLI values; resolve before changing cwd."""
    base = submission_cwd.resolve()
    mappings = tuple(
        sorted(storage_map, key=lambda item: len(item.host_root), reverse=True)
    )
    if len({item.host_root for item in mappings}) != len(mappings):
        raise ValueError("Duplicate storage mapping")

    def resolve(value: str) -> str:
        path = Path(value).expanduser()
        host = (base / path).resolve()
        for mapping in mappings:
            try:
                relative = host.relative_to(Path(mapping.host_root).resolve())
            except ValueError:
                continue
            return str(Path(mapping.execution_root) / relative)
        return str(host)

    config = json.loads(_json_bytes(resolved_config))
    for name in path_fields:
        if config.get(name) is not None:
            if not isinstance(config[name], str) or not config[name]:
                raise ValueError(f"Invalid path: {name}")
            config[name] = resolve(config[name])
    working_directory = resolve(str(layout.run_dir))
    config["output_dir"] = working_directory
    runtime = RuntimeSelection(
        python=resolve(runtime.python),
        mode=runtime.mode,
        device=runtime.device,
        environment=dict(runtime.environment),
        container=runtime.container,
    )
    return Manifest(
        run_id=layout.run_id,
        operation=operation,
        resolved_config=config,
        runtime=runtime,
        submission_directory=str(base),
        working_directory=working_directory,
        run_directory=str(layout.run_dir),
        storage_map=mappings,
        path_fields=tuple(path_fields),
    )


def write_manifest(layout: RunLayout, manifest: Manifest) -> None:
    if manifest.run_id != layout.run_id or manifest.run_directory != str(
        layout.run_dir
    ):
        raise ValueError("Manifest/layout identity mismatch")
    Manifest(
        **asdict(manifest)
        | {
            "operation": manifest.operation,
            "runtime": manifest.runtime,
            "storage_map": manifest.storage_map,
        }
    )
    write_once(layout.manifest, _json_bytes(asdict(manifest)))


def read_manifest(path: Path) -> Manifest:
    data = json.loads(path.read_bytes(), parse_constant=_bad_constant)
    return Manifest(
        **(
            data
            | {
                "operation": OperationKind(data["operation"]),
                "runtime": RuntimeSelection(**data["runtime"]),
                "storage_map": tuple(
                    StorageMapping(**item) for item in data["storage_map"]
                ),
                "path_fields": tuple(data["path_fields"]),
            }
        )
    )
```

- [ ] **Step 4: Run the tests and verify the pass count**

```bash
PYTHONPATH=src python3 -m pytest unit_tests/core/test_manifest.py \
  --confcutdir=unit_tests/core -v
```

Expected: **8 passed**, no failures or skips.

Run the focused style checks before committing:

```bash
PYTHONPATH=src ruff check --config pyproject.toml \
  src/wavedl/core/persistence.py \
  src/wavedl/core/manifest.py \
  unit_tests/core/test_manifest.py
PYTHONPATH=src ruff format --config pyproject.toml --check \
  src/wavedl/core/persistence.py \
  src/wavedl/core/manifest.py \
  unit_tests/core/test_manifest.py
```

Expected: Ruff reports no violations and all listed Python files are
already formatted. The implementation blocks use 88-column formatting.

- [ ] **Step 5: Commit this task only**

```bash
git add -- \
  src/wavedl/core/persistence.py \
  src/wavedl/core/manifest.py \
  unit_tests/core/test_manifest.py
git commit --only -m "feat(core): publish immutable resolved execution manifests" -- \
  src/wavedl/core/persistence.py \
  src/wavedl/core/manifest.py \
  unit_tests/core/test_manifest.py
```

### Task T3: Journal writer

**Files:**

- Create: `src/wavedl/core/journal_writer.py`
- Test (create): `unit_tests/core/test_journal_writer.py`

**Interfaces:**

Consumes T1: `Envelope`, `encode(envelope: Envelope) -> bytes`,
`decode(data: bytes | str) -> Envelope`. Consumes T5: `RunLayout`,
`RunLayout.journal(attempt: int) -> Path`, and
`allocate_attempt(layout: RunLayout) -> int`.

Produces in `wavedl.core.journal_writer`:

- `RecordTooLarge(ValueError)` and `AbandonedTail(FileExistsError)`;
  `AbandonedTail.path: Path` identifies the abandoned journal.
- `JournalWriter(layout: RunLayout, *, attempt: int | None = None, max_record_bytes: int = 65536, fsync_every: int = 1)`.
- `JournalWriter.restart(layout: RunLayout, previous_attempt: int, *, max_record_bytes: int = 65536, fsync_every: int = 1) -> JournalWriter`.
- `JournalWriter.append(event_type: str, payload: dict[str, object]) -> Envelope`.
- `JournalWriter.flush() -> None`, `close() -> None`, context-manager methods.
- `JournalWriter.attempt: int`, `seq: int` (next sequence), `path: Path`,
  and `abandoned_tail: AbandonedTail | None`.

`attempt=None` allocates one execution. Supplying an attempt consumes a T5
reservation and exclusively creates its previously absent journal. Existing
journals are never opened for append. An unfinished tail raises `AbandonedTail`;
`restart` inspects it for diagnostics and starts a new physical journal segment
at `attempts/<new-attempt>/events.jsonl`, with sequence zero. Even an intact old
journal gets a new attempt on restart. There is no line-count recovery.

The byte bound includes the trailing LF and is checked before any write.
Short writes are completed in a loop. An I/O or fsync error is surfaced and
poisons the writer: continuing that instance raises `RuntimeError`. The caller
must visibly fail/degrade telemetry under the later runtime/storage policy,
not retry an append into the same tail. The raw fragment remains for diagnosis.

The default fsync cadence is every event. With `fsync_every=N`, at most `N-1`
recent successful appends await the next sync; explicit `flush`, an `exit`, or
normal close syncs pending bytes. A returned append on a batched cadence is a
newline commit, not yet a durable commit. File fsync covers file contents;
these tests do not certify run-root directory durability or remote visibility.
Storage validation/bootstrap must establish those deployment properties.
T19 owns the main-rank guard, payload-validation call, first `hello`, and
identity propagation. This writer is the shared byte transport underneath it.

**Acceptance and gate (1A):**

| Structure failure case | Test |
|---|---|
| Oversized record leaves no partial bytes | `test_oversize_leaves_bytes_and_sequence_unchanged` checks both bytes and the next accepted sequence |
| Reopen over unfinished tail starts a new segment | `test_abandoned_tail_rolls_to_new_attempt_without_appending` verifies old fragment byte-for-byte and attempt 2 seq 0 |
| Fsync policy | `test_fsync_cadence_exit_and_close`, `test_default_fsync_and_sanitized_return`, `test_fsync_failure_is_visible_and_writer_cannot_continue` |
| Disk-full | `test_disk_full_after_short_write_poisoned_and_recovered` writes 17 bytes before ENOSPC, then checks refusal and rollover |

- [ ] **Step 1: Write the failing tests**

```python
# unit_tests/core/test_journal_writer.py
import errno

import pytest

from wavedl.core import journal_writer
from wavedl.core.journal_writer import AbandonedTail, JournalWriter, RecordTooLarge
from wavedl.core.layout import RunLayout, allocate_attempt
from wavedl.core.protocol import decode


RUN_ID = "00000000-0000-4000-8000-000000000001"


def test_oversize_leaves_bytes_and_sequence_unchanged(tmp_path):
    layout = RunLayout.create(tmp_path, RUN_ID)
    with JournalWriter(layout, max_record_bytes=512) as writer:
        writer.append("hello", {})
        before = writer.path.read_bytes()
        with pytest.raises(RecordTooLarge):
            writer.append("log", {"message": "x" * 1000})
        assert writer.path.read_bytes() == before
        assert writer.seq == 1
        assert writer.append("state", {}).seq == 1


def test_abandoned_tail_rolls_to_new_attempt_without_appending(tmp_path):
    """Restart preserves the crash fragment and emits seq zero in attempt 2."""
    layout = RunLayout.create(tmp_path, RUN_ID)
    first = allocate_attempt(layout)
    fragment = b'{"seq":0,"payload":'
    layout.journal(first).write_bytes(fragment)
    with pytest.raises(AbandonedTail):
        JournalWriter(layout, attempt=first)
    with JournalWriter.restart(layout, first) as writer:
        assert isinstance(writer.abandoned_tail, AbandonedTail)
        assert writer.abandoned_tail.path == layout.journal(first)
        event = writer.append("hello", {})
        assert (event.attempt, event.seq) == (2, 0)
        assert decode(writer.path.read_bytes()) == event
    assert layout.journal(first).read_bytes() == fragment


def test_intact_journal_is_not_counted_and_resumed(tmp_path):
    layout = RunLayout.create(tmp_path, RUN_ID)
    with JournalWriter(layout) as writer:
        writer.append("hello", {})
    before = writer.path.read_bytes()
    with pytest.raises(FileExistsError):
        JournalWriter(layout, attempt=1)
    with JournalWriter.restart(layout, 1) as replacement:
        assert replacement.abandoned_tail is None
        assert replacement.append("hello", {}).seq == 0
        assert replacement.attempt == 2
    assert writer.path.read_bytes() == before


def test_fsync_cadence_exit_and_close(tmp_path, monkeypatch):
    layout = RunLayout.create(tmp_path, RUN_ID)
    calls = []
    real_fsync = journal_writer.os.fsync

    def sync(fd):
        calls.append(fd)
        real_fsync(fd)

    monkeypatch.setattr(journal_writer.os, "fsync", sync)
    writer = JournalWriter(layout, fsync_every=3)
    writer.append("hello", {})
    writer.append("state", {})
    assert len(calls) == 0
    writer.append("metric", {})
    assert len(calls) == 1
    writer.append("exit", {})
    assert len(calls) == 2
    writer.append("log", {})
    writer.close()
    assert len(calls) == 3
    writer.close()
    assert len(calls) == 3


def test_disk_full_after_short_write_poisoned_and_recovered(tmp_path):
    """A partial write followed by ENOSPC cannot be joined to a later record."""
    layout = RunLayout.create(tmp_path, RUN_ID)
    writer = JournalWriter(layout)
    original = writer._stream

    class ShortThenFull:
        closed = False
        calls = 0

        def write(self, data):
            self.calls += 1
            if self.calls == 1:
                return original.write(data[:17])
            raise OSError(errno.ENOSPC, "disk full")

        def close(self):
            self.closed = True
            original.close()

    writer._stream = ShortThenFull()
    with pytest.raises(OSError) as caught:
        writer.append("hello", {})
    assert caught.value.errno == errno.ENOSPC
    assert writer.seq == 0
    assert len(writer.path.read_bytes()) == 17
    with pytest.raises(RuntimeError, match="new attempt"):
        writer.append("state", {})
    writer.close()
    with JournalWriter.restart(layout, 1) as replacement:
        assert replacement.append("hello", {}).attempt == 2
    assert len(writer.path.read_bytes()) == 17


def test_fsync_failure_is_visible_and_writer_cannot_continue(tmp_path, monkeypatch):
    layout = RunLayout.create(tmp_path, RUN_ID)
    writer = JournalWriter(layout)

    def fail(fd):
        raise OSError(errno.EIO, "sync failed")

    monkeypatch.setattr(journal_writer.os, "fsync", fail)
    with pytest.raises(OSError, match="sync failed"):
        writer.append("hello", {})
    assert writer.path.read_bytes().endswith(b"\n")
    with pytest.raises(RuntimeError):
        writer.append("state", {})
    writer.close()


def test_default_fsync_and_sanitized_return(tmp_path, monkeypatch):
    layout = RunLayout.create(tmp_path, RUN_ID)
    calls = []
    monkeypatch.setattr(journal_writer.os, "fsync", calls.append)
    with JournalWriter(layout) as writer:
        event = writer.append("metric", {"best_val_loss": float("inf")})
        assert event.payload == {"best_val_loss": None}
        assert decode(writer.path.read_bytes()) == event
        assert len(calls) == 1
```

- [ ] **Step 2: Run the tests and verify the failure**

```bash
PYTHONPATH=src python3 -m pytest unit_tests/core/test_journal_writer.py \
  --confcutdir=unit_tests/core -v
```

Expected: collection fails with `ImportError: cannot import name 'journal_writer' from 'wavedl.core'` because this task
has not introduced its implementation. An unrelated dependency/import error
is not the intended red result; resolve the interpreter/PYTHONPATH setup first.

- [ ] **Step 3: Write the minimal implementation**

```python
# src/wavedl/core/journal_writer.py
"""One exclusive writer per attempt; failed writers must roll over."""

from __future__ import annotations

import errno
import os
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from wavedl.core.layout import RunLayout, allocate_attempt
from wavedl.core.protocol import Envelope, encode


if TYPE_CHECKING:
    from pathlib import Path


class RecordTooLarge(ValueError):
    """A record was rejected before writing any bytes."""


class AbandonedTail(FileExistsError):
    """An existing attempt ends before its newline commit boundary."""

    def __init__(self, path: Path):
        super().__init__(f"Abandoned tail at {path}; start a new attempt")
        self.path = path


class JournalWriter:
    def __init__(
        self,
        layout: RunLayout,
        *,
        attempt: int | None = None,
        max_record_bytes: int = 64 * 1024,
        fsync_every: int = 1,
    ):
        if max_record_bytes < 1 or fsync_every < 1:
            raise ValueError("Positive record bound and fsync cadence required")
        self.layout = layout
        self.attempt = allocate_attempt(layout) if attempt is None else attempt
        self.path = layout.journal(self.attempt)
        self.max_record_bytes = max_record_bytes
        self.fsync_every = fsync_every
        self.abandoned_tail: AbandonedTail | None = None
        self.seq = 0
        self._unsynced = 0
        self._failed = False
        try:
            self._stream = self.path.open("xb", buffering=0)
        except FileExistsError:
            with self.path.open("rb") as stream:
                size = stream.seek(0, os.SEEK_END)
                if size:
                    stream.seek(-1, os.SEEK_END)
                    if stream.read(1) != b"\n":
                        raise AbandonedTail(self.path) from None
            raise

    @classmethod
    def restart(
        cls,
        layout: RunLayout,
        previous_attempt: int,
        *,
        max_record_bytes: int = 64 * 1024,
        fsync_every: int = 1,
    ) -> JournalWriter:
        """Inspect the old tail for diagnostics, always allocate a new execution."""
        old = layout.journal(previous_attempt)
        abandoned = None
        with old.open("rb") as stream:
            size = stream.seek(0, os.SEEK_END)
            if size:
                stream.seek(-1, os.SEEK_END)
                if stream.read(1) != b"\n":
                    abandoned = AbandonedTail(old)
        writer = cls(layout, max_record_bytes=max_record_bytes, fsync_every=fsync_every)
        writer.abandoned_tail = abandoned
        return writer

    def append(self, event_type: str, payload: dict[str, object]) -> Envelope:
        if self._failed or self._stream.closed:
            raise RuntimeError("Writer unavailable; start a new attempt")
        event = Envelope(
            run_id=self.layout.run_id,
            attempt=self.attempt,
            type=event_type,
            seq=self.seq,
            ts=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            payload=payload,
        )
        data = encode(event)
        if len(data) > self.max_record_bytes:
            raise RecordTooLarge(f"{len(data)} exceeds {self.max_record_bytes} bytes")
        try:
            remaining = memoryview(data)
            while remaining:
                written = self._stream.write(remaining)
                if not written:
                    raise OSError(errno.EIO, "Journal write made no progress")
                remaining = remaining[written:]
            self.seq += 1
            self._unsynced += 1
            if self._unsynced >= self.fsync_every or event_type == "exit":
                self.flush()
        except OSError:
            self._failed = True
            raise
        # Return the same sanitized representation that was committed to disk.
        from wavedl.core.protocol import decode

        return decode(data)

    def flush(self) -> None:
        try:
            self._stream.flush()
            os.fsync(self._stream.fileno())
            self._unsynced = 0
        except OSError:
            self._failed = True
            raise

    def close(self) -> None:
        if self._stream.closed:
            return
        try:
            if self._unsynced and not self._failed:
                self.flush()
        finally:
            self._stream.close()

    def __enter__(self) -> JournalWriter:
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        self.close()
```

- [ ] **Step 4: Run the tests and verify the pass count**

```bash
PYTHONPATH=src python3 -m pytest unit_tests/core/test_journal_writer.py \
  --confcutdir=unit_tests/core -v
```

Expected: **7 passed**, no failures or skips.

Run the focused style checks before committing:

```bash
PYTHONPATH=src ruff check --config pyproject.toml \
  src/wavedl/core/journal_writer.py \
  unit_tests/core/test_journal_writer.py
PYTHONPATH=src ruff format --config pyproject.toml --check \
  src/wavedl/core/journal_writer.py \
  unit_tests/core/test_journal_writer.py
```

Expected: Ruff reports no violations and all listed Python files are
already formatted. The implementation blocks use 88-column formatting.

- [ ] **Step 5: Commit this task only**

```bash
git add -- \
  src/wavedl/core/journal_writer.py \
  unit_tests/core/test_journal_writer.py
git commit --only -m "feat(core): write bounded journals with explicit attempt rollover" -- \
  src/wavedl/core/journal_writer.py \
  unit_tests/core/test_journal_writer.py
```

### Task T4: Journal reader

**Files:**

- Create: `src/wavedl/core/journal_reader.py`
- Test (create): `unit_tests/core/test_journal_reader.py`

**Interfaces:**

Consumes T1: `Envelope`, `ProtocolError`, `MalformedJSON`,
`decode(data: bytes | str) -> Envelope`, and `encode(envelope: Envelope) -> bytes`
in tests. Consumes T3: its bounded UTF-8 newline journal format and
`JournalWriter.append(event_type: str, payload: dict[str, object]) -> Envelope`
for the producer/reader conformance test. That fixture obtains its `RunLayout`
from T3's T5 dependency.

Produces in `wavedl.core.journal_reader`:

- `JournalReader(path: Path, *, run_id: str, attempt: int, read_bytes: int = 262144, max_record_bytes: int = 65536, max_diagnostics: int = 16, diagnostic_bytes: int = 160)`.
- `JournalReader.read(*, max_records: int = 256) -> list[Envelope]`.
- `JournalReader.seek_to_seq(cursor: int, *, max_scan_bytes: int = 67108864) -> None`.
- `seek_to_seq(reader: JournalReader, cursor: int, *, max_scan_bytes: int = 67108864) -> None` as a module-level adapter with the same semantics.
- `offset: int` (physical byte position), `last_record_start: int`,
  `diagnostics: deque[tuple[int, bytes]]`, and `malformed_count: int`.

Each reader is bound to one `(run_id, attempt)`. A persisted delivery cursor is
`(attempt, seq)`; the owner chooses the attempt before calling this seek API.
`offset` can include prefetched bytes and must never be persisted as an applied
event cursor. Seek stops **before** the first record whose sequence exceeds the
cursor. A fresh cursor of -1 resets directly to byte zero. Gaps are legal;
duplicate or decreasing sequence values within an attempt are protocol errors.

Reads use binary mode, reopen on every poll, and retain incomplete tails with
`rpartition(b"\n")`. UTF-8 decoding happens only after a full line is available.
CRLF remains two bytes in offset calculations. A read performs at most one
bounded filesystem read, returns at most `max_records`, and retains only a
bounded chunk plus a bounded fragment and diagnostic deque. Seek has a separate
scan budget; exceeding it raises instead of silently claiming replay is done.

Malformed UTF-8/JSON syntax is retained as a truncated diagnostic and counted;
later valid lines remain readable. Known envelope/schema violations raise
`ProtocolError` and poison the reader until explicit seek/recovery. No Pydantic
exception is part of the shared API. T2 payload validation follows this transport
reader in the ingesting caller. EOF is only "nothing newly visible"; it has no
runtime-state or heartbeat meaning. Reopening improves close-to-open visibility
but makes no bound on an actual site's visibility delay.

**Acceptance and gate (1A):**

| Structure failure case | Test |
|---|---|
| Incomplete tail buffered | Five parameterized `test_newline_commit_cases` plus `test_pending_completes_on_later_reopened_poll` cover the six verified cases |
| Cursor -1 replays seq 0 | `test_cursor_minus_one_replays_hello_seq_zero` checks that the replayed type is `hello` |
| Gap still replays rest | `test_missing_cursor_sequence_keeps_later_records` asserts seq 2 and 5 after cursor 1 |
| Schema-invalid line raises ProtocolError | `test_schema_invalid_line_raises_shared_error_and_cannot_be_skipped` |
| CRLF offsets | `test_crlf_offsets_are_bytes_with_multibyte_utf8` combines CRLF with café's multi-byte UTF-8 |
| Malformed-line bound | `test_malformed_diagnostics_and_io_are_bounded` instruments actual read sizes and processes 200 malformed lines |

Additional tests enforce record/fragment bounds, retained prefetched events,
seek budgets, attempt identity, and a tail completed after seeking beyond the
visible records.

- [ ] **Step 1: Write the failing tests**

```python
# unit_tests/core/test_journal_reader.py
import json
from pathlib import Path

import pytest

from wavedl.core.journal_reader import JournalReader, seek_to_seq
from wavedl.core.journal_writer import JournalWriter
from wavedl.core.layout import RunLayout
from wavedl.core.protocol import Envelope, ProtocolError, encode


RUN_ID = "00000000-0000-4000-8000-000000000001"


def record(seq, **changes):
    values = {
        "run_id": RUN_ID,
        "attempt": 1,
        "seq": seq,
        "type": "hello" if seq == 0 else "metric",
        "ts": "2026-09-06T00:00:00Z",
        "payload": {"label": "café"},
    }
    return encode(Envelope(**(values | changes)))


def reader_for(tmp_path, data, **options):
    path = tmp_path / "events.jsonl"
    path.write_bytes(data)
    return JournalReader(path, run_id=RUN_ID, attempt=1, **options)


@pytest.mark.parametrize(
    ("data", "expected"),
    [
        (b"", []),
        (record(0), [0]),
        (record(0) + record(1), [0, 1]),
        (record(0)[:-1], []),
        (record(0) + record(1)[:-1], [0]),
    ],
)
def test_newline_commit_cases(tmp_path, data, expected):
    reader = reader_for(tmp_path, data)
    assert [event.seq for event in reader.read()] == expected
    assert reader.read() == []
    assert reader.malformed_count == 0


def test_pending_completes_on_later_reopened_poll(tmp_path):
    reader = reader_for(tmp_path, record(0) + record(1)[:-5])
    assert [event.seq for event in reader.read()] == [0]
    assert reader.read() == []
    with reader.path.open("ab") as stream:
        stream.write(record(1)[-5:])
    assert [event.seq for event in reader.read()] == [1]
    assert reader.malformed_count == 0


def test_cursor_minus_one_replays_hello_seq_zero(tmp_path):
    reader = reader_for(tmp_path, record(0) + record(1))
    seek_to_seq(reader, -1)
    events = reader.read()
    assert [(event.seq, event.type) for event in events] == [
        (0, "hello"),
        (1, "metric"),
    ]


def test_missing_cursor_sequence_keeps_later_records(tmp_path):
    reader = reader_for(tmp_path, record(0) + record(2) + record(5))
    reader.seek_to_seq(1)
    assert reader.offset == len(record(0))
    assert [event.seq for event in reader.read()] == [2, 5]


def test_crlf_offsets_are_bytes_with_multibyte_utf8(tmp_path):
    first = record(0).replace(b"\n", b"\r\n")
    rest = (record(2) + record(3)).replace(b"\n", b"\r\n")
    reader = reader_for(tmp_path, first + rest)
    reader.seek_to_seq(1)
    assert reader.offset == len(first)
    assert [event.seq for event in reader.read()] == [2, 3]


def test_schema_invalid_line_raises_shared_error_and_cannot_be_skipped(tmp_path):
    invalid = json.loads(record(0)) | {"attempt": -1}
    reader = reader_for(tmp_path, json.dumps(invalid).encode() + b"\n" + record(1))
    for _ in range(2):
        with pytest.raises(ProtocolError, match="attempt"):
            reader.read()
    assert reader.malformed_count == 0


def test_malformed_diagnostics_and_io_are_bounded(tmp_path, monkeypatch):
    reader = reader_for(
        tmp_path,
        b"{bad json and diagnostic text}\n" * 200 + record(0),
        read_bytes=47,
        max_diagnostics=3,
        diagnostic_bytes=12,
    )
    real_open = Path.open
    reads = []

    class Tracked:
        def __init__(self, stream):
            self.stream = stream

        def __enter__(self):
            return self

        def __exit__(self, *args):
            self.stream.close()

        def seek(self, *args):
            return self.stream.seek(*args)

        def read(self, size):
            reads.append(size)
            return self.stream.read(size)

    def tracked_open(path, *args, **kwargs):
        stream = real_open(path, *args, **kwargs)
        return Tracked(stream) if path == reader.path else stream

    monkeypatch.setattr(Path, "open", tracked_open)
    events = []
    for _ in range(200):
        events.extend(reader.read(max_records=1))
    assert [event.seq for event in events] == [0]
    assert reader.malformed_count == 200
    assert len(reader.diagnostics) == 3
    assert all(len(raw) <= 12 for offset, raw in reader.diagnostics)
    assert reads and max(reads) <= 47


@pytest.mark.parametrize("data", [b"x" * 512, b"x" * 512 + b"\n"])
def test_oversized_tail_or_line_fails_with_bounded_buffer(tmp_path, data):
    reader = reader_for(tmp_path, data, read_bytes=64, max_record_bytes=128)
    with pytest.raises(ProtocolError, match="bound"):
        for _ in range(4):
            reader.read()
    assert len(reader._pending) <= 128


def test_record_count_bound_does_not_drop_buffered_events(tmp_path):
    reader = reader_for(tmp_path, b"".join(record(seq) for seq in range(20)))
    batches = [reader.read(max_records=3) for _ in range(7)]
    assert all(len(batch) <= 3 for batch in batches)
    assert [event.seq for batch in batches for event in batch] == list(range(20))


def test_writer_reader_conformance_and_eof_is_not_terminal(tmp_path):
    layout = RunLayout.create(tmp_path, RUN_ID)
    with JournalWriter(layout) as writer:
        first = writer.append("hello", {})
        reader = JournalReader(writer.path, run_id=RUN_ID, attempt=writer.attempt)
        assert reader.read() == [first]
        assert reader.read() == []
        second = writer.append("metric", {"loss": float("inf")})
        assert reader.read() == [second]
        assert second.payload["loss"] is None


def test_seek_past_visible_records_keeps_incomplete_tail(tmp_path):
    reader = reader_for(tmp_path, record(0) + record(2)[:-1])
    reader.seek_to_seq(0)
    assert reader.offset == len(record(0))
    with reader.path.open("ab") as stream:
        stream.write(b"\n")
    assert [event.seq for event in reader.read()] == [2]


def test_seek_budget_and_attempt_identity(tmp_path):
    reader = reader_for(tmp_path, record(0) + record(2))
    with pytest.raises(ProtocolError, match="budget"):
        reader.seek_to_seq(10, max_scan_bytes=10)
    reader = reader_for(tmp_path, record(0, attempt=2))
    with pytest.raises(ProtocolError, match="identity"):
        reader.read()
```

- [ ] **Step 2: Run the tests and verify the failure**

```bash
PYTHONPATH=src python3 -m pytest unit_tests/core/test_journal_reader.py \
  --confcutdir=unit_tests/core -v
```

Expected: collection fails with `ModuleNotFoundError: No module named 'wavedl.core.journal_reader'` because this task
has not introduced its implementation. An unrelated dependency/import error
is not the intended red result; resolve the interpreter/PYTHONPATH setup first.

- [ ] **Step 3: Write the minimal implementation**

```python
# src/wavedl/core/journal_reader.py
"""Bounded binary replay; EOF never implies runtime completion."""

from __future__ import annotations

from collections import deque
from typing import TYPE_CHECKING

from wavedl.core.protocol import Envelope, MalformedJSON, ProtocolError, decode


if TYPE_CHECKING:
    from pathlib import Path


class JournalReader:
    def __init__(
        self,
        path: Path,
        *,
        run_id: str,
        attempt: int,
        read_bytes: int = 256 * 1024,
        max_record_bytes: int = 64 * 1024,
        max_diagnostics: int = 16,
        diagnostic_bytes: int = 160,
    ):
        if min(read_bytes, max_record_bytes, max_diagnostics, diagnostic_bytes) < 1:
            raise ValueError("Reader bounds must be positive")
        self.path = path
        self.run_id = run_id
        self.attempt = attempt
        self.read_bytes = read_bytes
        self.max_record_bytes = max_record_bytes
        self.diagnostic_bytes = diagnostic_bytes
        self.diagnostics: deque[tuple[int, bytes]] = deque(maxlen=max_diagnostics)
        self.malformed_count = 0
        self._reset(0)

    def _reset(self, offset: int) -> None:
        self.offset = offset
        self._pending = b""
        self._ready: deque[tuple[int, bytes]] = deque()
        self._error: ProtocolError | None = None
        self.last_record_start = offset
        self._last_seq = -1

    def _fill(self) -> None:
        # Reopening on every poll also serves close-to-open shared filesystems.
        with self.path.open("rb") as stream:
            if stream.seek(0, 2) < self.offset:
                raise ProtocolError("Journal truncated; select a new attempt")
            stream.seek(self.offset)
            chunk = stream.read(self.read_bytes)
        start = self.offset - len(self._pending)
        self.offset += len(chunk)
        data = self._pending + chunk
        complete, newline, pending = data.rpartition(b"\n")
        if newline:
            self._pending = pending
            for line in complete.split(b"\n"):
                self._ready.append((start, line))
                start += len(line) + 1
        else:
            self._pending = data
        if len(self._pending) >= self.max_record_bytes:
            raise ProtocolError("Unterminated record exceeds byte bound")

    def read(self, *, max_records: int = 256) -> list[Envelope]:
        if max_records < 1:
            raise ValueError("max_records must be positive")
        if self._error is not None:
            raise self._error
        events = []
        filled = False
        try:
            while len(events) < max_records:
                if not self._ready:
                    if filled:
                        break
                    self._fill()
                    filled = True
                    if not self._ready:
                        break
                start, line = self._ready[0]
                if len(line) + 1 > self.max_record_bytes:
                    raise ProtocolError("Record exceeds byte bound")
                try:
                    event = decode(line)
                except MalformedJSON:
                    self.diagnostics.append((start, line[: self.diagnostic_bytes]))
                    self.malformed_count += 1
                    self._ready.popleft()
                    continue
                if (event.run_id, event.attempt) != (self.run_id, self.attempt):
                    raise ProtocolError("Journal identity mismatch")
                if event.seq <= self._last_seq:
                    raise ProtocolError("Sequence must increase within an attempt")
                self._ready.popleft()
                self._last_seq = event.seq
                self.last_record_start = start
                events.append(event)
        except ProtocolError as exc:
            self._error = exc
            raise
        return events

    def seek_to_seq(
        self, cursor: int, *, max_scan_bytes: int = 64 * 1024 * 1024
    ) -> None:
        """Position BEFORE the first seq > cursor, with bounded binary scanning."""
        if type(cursor) is not int or cursor < -1 or max_scan_bytes < 1:
            raise ValueError("Invalid cursor or scan budget")
        self._reset(0)
        if cursor == -1:
            return
        original_read_bytes = self.read_bytes
        try:
            while True:
                remaining = max_scan_bytes - self.offset
                if remaining <= 0 and not self._ready:
                    raise ProtocolError("Seek scan budget exhausted")
                self.read_bytes = min(original_read_bytes, max(1, remaining))
                before = self.offset
                events = self.read(max_records=1)
                if events and events[0].seq > cursor:
                    self._reset(self.last_record_start)
                    return
                if not events and self.offset == before:
                    # Preserve the incomplete record for the next poll.
                    self._reset(self.offset - len(self._pending))
                    return
        finally:
            self.read_bytes = original_read_bytes


def seek_to_seq(
    reader: JournalReader, cursor: int, *, max_scan_bytes: int = 64 * 1024 * 1024
) -> None:
    reader.seek_to_seq(cursor, max_scan_bytes=max_scan_bytes)
```

- [ ] **Step 4: Run the tests and verify the pass count**

```bash
PYTHONPATH=src python3 -m pytest unit_tests/core/test_journal_reader.py \
  --confcutdir=unit_tests/core -v
```

Expected: **17 passed**, no failures or skips.

Run the focused style checks before committing:

```bash
PYTHONPATH=src ruff check --config pyproject.toml \
  src/wavedl/core/journal_reader.py \
  unit_tests/core/test_journal_reader.py
PYTHONPATH=src ruff format --config pyproject.toml --check \
  src/wavedl/core/journal_reader.py \
  unit_tests/core/test_journal_reader.py
```

Expected: Ruff reports no violations and all listed Python files are
already formatted. The implementation blocks use 88-column formatting.

- [ ] **Step 5: Commit this task only**

```bash
git add -- \
  src/wavedl/core/journal_reader.py \
  unit_tests/core/test_journal_reader.py
git commit --only -m "feat(core): replay journals with bounded binary cursors" -- \
  src/wavedl/core/journal_reader.py \
  unit_tests/core/test_journal_reader.py
```

### Task T20a: Shared generation publication

**Files:**

- Create: `src/wavedl/core/generations.py`
- Test (create): `unit_tests/core/test_generations.py`

**Interfaces:**

Consumes T5: `RunLayout`, its `checkpoints: Path`,
`attempt_dir(attempt: int) -> Path`, and `allocate_attempt(layout: RunLayout) -> int`.
Consumes T6: `read_manifest(path: Path) -> Manifest`,
`write_manifest(layout: RunLayout, manifest: Manifest) -> None` in fixtures,
`sync_directory(path: Path) -> None`, and
`write_once(path: Path, content: bytes) -> None`.

Produces in `wavedl.core.generations`:

- `FileRecord(size: int, sha256: str)`.
- `PublishedGeneration(path: Path, generation: str, attempt: int, step: int, manifest_sha256: str, files: dict[str, FileRecord])`.
- `publish_generation(layout: RunLayout, source: Path, *, attempt: int, step: int) -> PublishedGeneration`.
- `published_generations(layout: RunLayout) -> list[PublishedGeneration]`.
- `<run_dir>/checkpoints/gen-NNNNNN/COMPLETE.json`, containing
  `schema_version: int = 1`, `run_id: str`, `generation: str`, `attempt: int`,
  `step: int`, `manifest_sha256: str`, and
  `files: dict[str, {size: int, sha256: str}]`.

The caller supplies a complete, quiescent staging tree with ordinary files.
The primitive copies opaque bytes; it imports neither NumPy nor ML/daemon code
and never examines an NPY header. All ranks must finish staging before the main
rank calls it for a normal save in T20c. T20d supplies its independently completed
rank-zero emergency tree without adding collective participation.

A generation directory is reserved exclusively; failed numbers are not reused.
Contents are written and fsynced, child directories synced before parents,
then `COMPLETE.json` is published last using T6's file-fsync/exclusive-link/
directory-sync operation. A rename alone never constitutes success here.
No event should announce the generation until this function returns.

Without a valid completion marker the directory is invisible to discovery.
Discovery validates manifest identity and every listed file's size/hash using
bounded reads, so delayed visibility or incomplete content does not become a
usable checkpoint. Malformed, missing, or mismatched completion data is ignored;
other storage errors propagate. This scan is blocking; later callers submit it
to T29a's bounded work facility. The completion marker is capped at 1 MiB in both
publication and discovery. Safe HTTP opening and adoption ownership remain T25
and T22c responsibilities.

If final directory sync fails after the complete marker has linked, publication
raises: a fully written generation may already be visible, but crash durability
was not established. The caller reconciles discovery and does not claim a
successful durable save based on that exception. Prior generations are never
rewritten or removed by any failure path.

This task adds the shared primitive only. It does not switch any training save,
resume, or Qt plot path. T20b updates consumers while retaining `best_checkpoint`
compatibility before T20c/T20d change producers.

**Acceptance and gate (1A):**

| Structure failure case | Test |
|---|---|
| Interrupted mid-copy leaves prior generation published | `test_failure_during_real_copy_keeps_previous_generation` writes a real fragment into the second file, injects ENOSPC, and checks discovery |
| Contents fsync precedes completion manifest | `test_contents_sync_before_marker_and_directory_sync_after_link` traces real content/marker fsync and final directory sync; the pre-marker sync-failure test checks invisibility |
| Works with no daemon installed | `test_standalone_process_publishes_without_daemon_or_ml` runs Python with `-S`, blocks daemon/ML imports, and builds a real manifest and generation |

The post-link failure test distinguishes visibility from confirmed durability.
These local fault-injection tests establish ordering and behavior; actual
power-loss/shared-filesystem guarantees and Windows execution require the later
platform/site gates and are not certified by this document.

- [ ] **Step 1: Write the failing tests**

```python
# unit_tests/core/test_generations.py
import errno
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from wavedl.core import generations, persistence
from wavedl.core.generations import publish_generation, published_generations
from wavedl.core.layout import OperationKind, RunLayout, allocate_attempt
from wavedl.core.manifest import RuntimeSelection, build_manifest, write_manifest


RUN_ID = "00000000-0000-4000-8000-000000000001"


def setup_run(tmp_path):
    layout = RunLayout.create(tmp_path / "runs", RUN_ID)
    manifest = build_manifest(
        layout,
        operation=OperationKind.TRAIN,
        resolved_config={},
        runtime=RuntimeSelection(sys.executable, "existing", "cpu", {}),
        submission_cwd=tmp_path,
    )
    write_manifest(layout, manifest)
    attempt = allocate_attempt(layout)
    source = tmp_path / "staging"
    source.mkdir()
    (source / "model.bin").write_bytes(b"weights")
    (source / "rank").mkdir()
    (source / "rank" / "state.bin").write_bytes(b"optimizer")
    return layout, attempt, source


def test_publication_is_immutable_and_records_step(tmp_path):
    layout, attempt, source = setup_run(tmp_path)
    first = publish_generation(layout, source, attempt=attempt, step=10)
    original = (first.path / "model.bin").read_bytes()
    (source / "model.bin").write_bytes(b"new weights")
    second = publish_generation(layout, source, attempt=attempt, step=20)
    assert [item.step for item in published_generations(layout)] == [10, 20]
    assert (first.path / "model.bin").read_bytes() == original
    assert first.path != second.path
    marker = json.loads((first.path / "COMPLETE.json").read_bytes())
    assert marker["attempt"] == attempt
    assert marker["run_id"] == RUN_ID
    assert marker["files"]["model.bin"]["size"] == len(original)


def test_failure_during_real_copy_keeps_previous_generation(tmp_path, monkeypatch):
    """Interrupt the second content copy after writing a fragment into the new tree."""
    layout, attempt, source = setup_run(tmp_path)
    prior = publish_generation(layout, source, attempt=attempt, step=10)
    original_copy = generations._copy_file
    copied = []

    def interrupted(incoming, outgoing):
        copied.append(outgoing)
        if len(copied) == 2:
            with outgoing.open("xb") as stream:
                stream.write(b"partial")
            raise OSError(errno.ENOSPC, "mid-copy")
        return original_copy(incoming, outgoing)

    monkeypatch.setattr(generations, "_copy_file", interrupted)
    with pytest.raises(OSError, match="mid-copy"):
        publish_generation(layout, source, attempt=attempt, step=20)
    assert len(copied) == 2
    incomplete = layout.checkpoints / "gen-000002"
    assert (incomplete / "rank/state.bin").read_bytes() == b"partial"
    assert not (incomplete / "COMPLETE.json").exists()
    assert published_generations(layout) == [prior]


def test_contents_sync_before_marker_and_directory_sync_after_link(
    tmp_path, monkeypatch
):
    """Trace actual fsync/link calls while publication runs, including nested files."""
    layout, attempt, source = setup_run(tmp_path)
    events = []
    phase = ["other"]
    real_copy = generations._copy_file
    real_fsync = os.fsync
    real_link = os.link
    real_write_once = generations.write_once
    real_sync_directory = persistence.sync_directory

    def fsync(fd):
        events.append(("fsync", phase[0]))
        real_fsync(fd)

    def copy(incoming, outgoing):
        phase[0] = "content:" + incoming.relative_to(source).as_posix()
        try:
            assert not (
                outgoing.parents[len(incoming.relative_to(source).parts) - 1]
                / "COMPLETE.json"
            ).exists()
            return real_copy(incoming, outgoing)
        finally:
            phase[0] = "other"

    def sync_directory(path):
        events.append(("directory", str(path)))
        real_sync_directory(path)

    def link(incoming, outgoing):
        if outgoing.name == "COMPLETE.json":
            assert ("fsync", "marker") in events
            events.append(("link", str(outgoing)))
        return real_link(incoming, outgoing)

    def write_once(path, content):
        assert ("fsync", "content:model.bin") in events
        assert ("fsync", "content:rank/state.bin") in events
        assert ("directory", str(path.parent / "rank")) in events
        assert ("directory", str(path.parent)) in events
        assert not path.exists()
        phase[0] = "marker"
        try:
            return real_write_once(path, content)
        finally:
            phase[0] = "other"

    monkeypatch.setattr(persistence.os, "fsync", fsync)
    monkeypatch.setattr(persistence.os, "link", link)
    monkeypatch.setattr(persistence, "sync_directory", sync_directory)
    monkeypatch.setattr(generations, "sync_directory", sync_directory)
    monkeypatch.setattr(generations, "_copy_file", copy)
    monkeypatch.setattr(generations, "write_once", write_once)
    published = publish_generation(layout, source, attempt=attempt, step=1)
    marker = published.path / "COMPLETE.json"
    link_index = events.index(("link", str(marker)))
    assert ("directory", str(published.path)) in events[link_index + 1 :]
    assert published_generations(layout) == [published]


def test_sync_failure_before_marker_is_invisible(tmp_path, monkeypatch):
    layout, attempt, source = setup_run(tmp_path)
    prior = publish_generation(layout, source, attempt=attempt, step=1)
    original = generations.sync_directory

    def fail(path):
        if path.name == "gen-000002":
            raise OSError(errno.EIO, "content directory sync")
        original(path)

    monkeypatch.setattr(generations, "sync_directory", fail)
    with pytest.raises(OSError, match="content directory sync"):
        publish_generation(layout, source, attempt=attempt, step=2)
    assert not (layout.checkpoints / "gen-000002/COMPLETE.json").exists()
    assert published_generations(layout) == [prior]


def test_sync_failure_after_link_reports_uncertain_durability(tmp_path, monkeypatch):
    layout, attempt, source = setup_run(tmp_path)
    original = persistence.sync_directory

    def fail(path):
        if (path / "COMPLETE.json").exists():
            raise OSError(errno.EIO, "publication directory sync")
        original(path)

    monkeypatch.setattr(persistence, "sync_directory", fail)
    with pytest.raises(OSError, match="publication directory sync"):
        publish_generation(layout, source, attempt=attempt, step=2)
    assert len(published_generations(layout)) == 1


def test_incomplete_and_tampered_generations_are_not_discovered(tmp_path):
    layout, attempt, source = setup_run(tmp_path)
    result = publish_generation(layout, source, attempt=attempt, step=10)
    (layout.checkpoints / "gen-000002").mkdir()
    assert published_generations(layout) == [result]
    (result.path / "model.bin").write_bytes(b"corrupt")
    assert published_generations(layout) == []


def test_standalone_process_publishes_without_daemon_or_ml(tmp_path):
    """A fresh -S process builds a real manifest and generation using only core."""
    script = """
import importlib.abc
import sys
from pathlib import Path
class Block(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split(".")[0] in {
            "wavedl_daemon", "wavedl_gui", "torch", "numpy", "PySide6"
        }:
            raise AssertionError(fullname)
sys.meta_path.insert(0, Block())
from wavedl.core.layout import RunLayout, OperationKind, allocate_attempt
from wavedl.core.manifest import RuntimeSelection, build_manifest, write_manifest
from wavedl.core.generations import publish_generation, published_generations
base = Path(sys.argv[1])
layout = RunLayout.create(base / "runs", "00000000-0000-4000-8000-000000000001")
manifest = build_manifest(
    layout, operation=OperationKind.TRAIN, resolved_config={"lr": 0.01},
    runtime=RuntimeSelection(sys.executable, "existing", "cpu", {}),
    submission_cwd=base,
)
write_manifest(layout, manifest)
attempt = allocate_attempt(layout)
source = base / "stage"
source.mkdir()
(source / "model.bin").write_bytes(b"standalone weights")
published = publish_generation(layout, source, attempt=attempt, step=7)
assert published_generations(layout) == [published]
assert "wavedl_daemon" not in sys.modules
print(published.path)
"""
    result = subprocess.run(
        [sys.executable, "-S", "-c", script, str(tmp_path)],
        env=os.environ | {"PYTHONPATH": str(Path("src").resolve())},
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert result.returncode == 0, result.stderr
    generation = Path(result.stdout.strip())
    assert (generation / "COMPLETE.json").is_file()
    assert (generation / "model.bin").read_bytes() == b"standalone weights"


@pytest.mark.parametrize("step", [-1, True])
def test_invalid_step_refused_before_publication(tmp_path, step):
    layout, attempt, source = setup_run(tmp_path)
    with pytest.raises(ValueError):
        publish_generation(layout, source, attempt=attempt, step=step)
    assert list(layout.checkpoints.iterdir()) == []
```

- [ ] **Step 2: Run the tests and verify the failure**

```bash
PYTHONPATH=src python3 -m pytest unit_tests/core/test_generations.py \
  --confcutdir=unit_tests/core -v
```

Expected: collection fails with `ImportError: cannot import name 'generations' from 'wavedl.core'` because this task
has not introduced its implementation. An unrelated dependency/import error
is not the intended red result; resolve the interpreter/PYTHONPATH setup first.

- [ ] **Step 3: Write the minimal implementation**

```python
# src/wavedl/core/generations.py
"""Immutable checkpoint publication, independent of any daemon installation."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from wavedl.core.manifest import read_manifest
from wavedl.core.persistence import sync_directory, write_once


if TYPE_CHECKING:
    from wavedl.core.layout import RunLayout


@dataclass(frozen=True)
class FileRecord:
    size: int
    sha256: str


@dataclass(frozen=True)
class PublishedGeneration:
    path: Path
    generation: str
    attempt: int
    step: int
    manifest_sha256: str
    files: dict[str, FileRecord]


def _digest(path: Path) -> FileRecord:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
            size += len(chunk)
    return FileRecord(size, digest.hexdigest())


def _copy_file(source: Path, target: Path) -> FileRecord:
    import os

    digest = hashlib.sha256()
    size = 0
    with source.open("rb") as incoming, target.open("xb") as outgoing:
        while chunk := incoming.read(1024 * 1024):
            outgoing.write(chunk)
            digest.update(chunk)
            size += len(chunk)
        outgoing.flush()
        os.fsync(outgoing.fileno())
    return FileRecord(size, digest.hexdigest())


def _allocate_generation(layout: RunLayout) -> Path:
    numbers = [
        int(path.name[4:])
        for path in layout.checkpoints.iterdir()
        if re.fullmatch(r"gen-\d{6,}", path.name)
    ]
    number = max(numbers, default=0) + 1
    while True:
        target = layout.checkpoints / f"gen-{number:06d}"
        try:
            target.mkdir()
        except FileExistsError:
            number += 1
            continue
        sync_directory(layout.checkpoints)
        return target


def _manifest_digest(layout: RunLayout) -> str:
    manifest = read_manifest(layout.manifest)
    if manifest.run_id != layout.run_id or manifest.run_directory != str(
        layout.run_dir
    ):
        raise ValueError("Manifest/layout identity mismatch")
    return _digest(layout.manifest).sha256


def publish_generation(
    layout: RunLayout, source: Path, *, attempt: int, step: int
) -> PublishedGeneration:
    """Copy a quiesced staging tree, sync contents, then publish COMPLETE.json."""
    if (
        type(attempt) is not int
        or attempt < 1
        or not layout.attempt_dir(attempt).is_dir()
    ):
        raise ValueError("A reserved attempt is required")
    if type(step) is not int or step < 0:
        raise ValueError("step must be nonnegative")
    manifest_sha256 = _manifest_digest(layout)
    source = source.resolve()
    if not source.is_dir() or layout.checkpoints.is_relative_to(source):
        raise ValueError("Invalid staging directory")
    members = sorted(source.rglob("*"))
    if not members or not any(item.is_file() for item in members):
        raise ValueError("Empty generation")
    for item in members:
        if item.is_symlink() or not (item.is_file() or item.is_dir()):
            raise ValueError("Generation contents must be ordinary files/directories")
        if item.relative_to(source).as_posix() == "COMPLETE.json":
            raise ValueError("COMPLETE.json is reserved for publication")
    target = _allocate_generation(layout)
    directories = {target}
    files = {}
    for item in members:
        relative = item.relative_to(source)
        destination = target / relative
        if item.is_dir():
            destination.mkdir()
            directories.add(destination)
        else:
            files[relative.as_posix()] = _copy_file(item, destination)
    # Persist child entries before their parents and before the publication marker.
    for directory in sorted(
        directories, key=lambda item: len(item.parts), reverse=True
    ):
        sync_directory(directory)
    result = PublishedGeneration(
        target, target.name, attempt, step, manifest_sha256, files
    )
    completion = {
        "schema_version": 1,
        "run_id": layout.run_id,
        "generation": target.name,
        "attempt": attempt,
        "step": step,
        "manifest_sha256": manifest_sha256,
        "files": {name: asdict(record) for name, record in files.items()},
    }
    content = (
        json.dumps(completion, allow_nan=False, sort_keys=True).encode("utf-8") + b"\n"
    )
    if len(content) > 1024 * 1024:
        raise ValueError("Completion manifest exceeds discovery byte bound")
    write_once(target / "COMPLETE.json", content)
    return result


def _read_generation(
    layout: RunLayout, path: Path, manifest_sha256: str
) -> PublishedGeneration | None:
    marker = path / "COMPLETE.json"
    if path.is_symlink() or not marker.is_file() or marker.is_symlink():
        return None
    try:
        # Metadata is bounded; checkpoint contents are hashed in bounded chunks.
        with marker.open("rb") as stream:
            raw = stream.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            return None
        data = json.loads(raw)
        if (
            type(data["schema_version"]) is not int
            or data["schema_version"] != 1
            or data["run_id"] != layout.run_id
            or data["generation"] != path.name
            or data["manifest_sha256"] != manifest_sha256
            or type(data["attempt"]) is not int
            or data["attempt"] < 1
            or type(data["step"]) is not int
            or data["step"] < 0
            or not isinstance(data["files"], dict)
            or not data["files"]
        ):
            return None
        files = {}
        for name, record in data["files"].items():
            relative = Path(name)
            if (
                relative.is_absolute()
                or ".." in relative.parts
                or name == "COMPLETE.json"
            ):
                return None
            member = path / relative
            if any(
                (path / Path(*relative.parts[:index])).is_symlink()
                for index in range(1, len(relative.parts) + 1)
            ):
                return None
            if (
                not member.is_file()
                or type(record["size"]) is not int
                or record["size"] < 0
            ):
                return None
            if not isinstance(record["sha256"], str) or not re.fullmatch(
                r"[0-9a-f]{64}", record["sha256"]
            ):
                return None
            expected = FileRecord(record["size"], record["sha256"])
            if _digest(member) != expected:
                return None
            files[name] = expected
        return PublishedGeneration(
            path, path.name, data["attempt"], data["step"], manifest_sha256, files
        )
    except (KeyError, TypeError, ValueError, UnicodeError):
        return None
    except FileNotFoundError:
        return None


def published_generations(layout: RunLayout) -> list[PublishedGeneration]:
    manifest_sha256 = _manifest_digest(layout)
    paths = sorted(
        (
            path
            for path in layout.checkpoints.iterdir()
            if re.fullmatch(r"gen-\d{6,}", path.name)
        ),
        key=lambda path: int(path.name[4:]),
    )
    return [
        generation
        for path in paths
        if (generation := _read_generation(layout, path, manifest_sha256)) is not None
    ]
```

- [ ] **Step 4: Run the tests and verify the pass count**

```bash
PYTHONPATH=src python3 -m pytest unit_tests/core/test_generations.py \
  --confcutdir=unit_tests/core -v
```

Expected: **9 passed**, no failures or skips.

Run the focused style checks before committing:

```bash
PYTHONPATH=src ruff check --config pyproject.toml \
  src/wavedl/core/generations.py \
  unit_tests/core/test_generations.py
PYTHONPATH=src ruff format --config pyproject.toml --check \
  src/wavedl/core/generations.py \
  unit_tests/core/test_generations.py
```

Expected: Ruff reports no violations and all listed Python files are
already formatted. The implementation blocks use 88-column formatting.

- [ ] **Step 5: Commit this task only**

```bash
git add -- \
  src/wavedl/core/generations.py \
  unit_tests/core/test_generations.py
git commit --only -m "feat(core): publish durable standalone checkpoint generations" -- \
  src/wavedl/core/generations.py \
  unit_tests/core/test_generations.py
```

## Shared-contracts completion check

After all seven task commits, run this focused combined gate:

```bash
PYTHONPATH=src python3 -m pytest unit_tests/core \
  --confcutdir=unit_tests/core -v
PYTHONPATH=src ruff check --config pyproject.toml \
  src/wavedl/__init__.py src/wavedl/core unit_tests/core
PYTHONPATH=src ruff format --config pyproject.toml --check \
  src/wavedl/__init__.py src/wavedl/core unit_tests/core
```

Expected: **109 passed**, no failures or skips; Ruff check and format check pass.
This is the shared-contracts gate only. It does not claim the project-wide test
suite, runtime instrumentation, installed-wheel entry points, Windows storage,
process supervision, scheduler integration, or a real cluster were exercised.

The detail's code was extracted from this document and each task's expected
red failure and exact green pass count were replayed in order in an isolated
temporary copy of the original package. The combined suite also passed
on macOS with Python 3.11.16, pytest 8.3.4, and locally available Ruff 0.15.0.
The repository CI pins Ruff 0.14.10; that exact version was not downloaded or
executed during this offline authoring task. The tests use public Python 3.11
APIs and no Pydantic dependency. Source files in the repository were not changed
and the implementation commits above were not created.

Finding traceability for this group: **F8 → T5/T6**, **F9 → T3/T4**,
**F11 → T20a**, **F12 → T2**, **F15 → T1/T2**, and the operation-identity portion
of **F17 → T5/T6**. Remaining ownership stays with the settled structure.
