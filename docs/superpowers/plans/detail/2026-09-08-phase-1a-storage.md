# Phase 1A storage and registry — TDD implementation detail

**Date:** 2026-09-08  
**Status:** implementation instructions; source changes have not been applied  
**Scope:** T7a, T8a, T8b, T7b, in that order  
**Gate contribution:** storage/registry portion of milestone 1A, not the complete
1A control and supervision milestone and not a functioning daemon.

The [settled structure](../2026-09-06-daemon-migration-structure.md) is the task
contract. This detail follows [spec revision 2](../../specs/2026-09-05-wavedl-daemon-architecture-design.md)
and consumes the [shared contracts](2026-09-06-phase-1a-contracts.md) unchanged:
`RunLayout`, `Manifest`, `OperationKind`, `Envelope` and `JournalReader` are
imported from `wavedl.core`, never redefined.

All commands below run from `/Users/myt/Documents/GitHub/WaveDL-GUI` with a
Python 3.11+ `python3` and already installed pytest/Ruff. Every Python command
sets `PYTHONPATH=src` because the current editable install is dangling.
`--confcutdir=unit_tests/daemon` excludes the parent ML fixture module, whose
unconditional NumPy/Torch/matplotlib imports would obscure a package that must
not depend on any of them.

Each Python block below is the complete content of the path in its first-line
comment. Step 1 writes only the new tests. Step 3 creates exactly its listed
implementation files. Each task is one commit. Do not execute these
implementation or commit steps merely to deliver this planning document.

`wavedl_daemon` may import `wavedl.core`. `wavedl` must never import
`wavedl_daemon`. Neither may import `wavedl_gui`, PySide6, torch or NumPy, and
T7b's final test enforces that by import-blocking a fresh interpreter.

## What was verified before this was written

Every design decision below was settled by running code, not by reasoning about
documentation. The results that changed the task contract:

| Claim | Result |
|---|---|
| `flock` is released when the holder is `SIGKILL`ed | confirmed — while held, acquisition raised `BlockingIOError [Errno 35]`; after the kill it acquired immediately |
| One SQLite transaction covering two writes is atomic under `SIGKILL` | confirmed — neither write applied |
| `PRAGMA user_version` and DDL roll back together | confirmed — version and table both reverted |
| `psutil` is a declared dependency | **false** — only transitively present, so detection is stdlib-only |
| macOS exposes a filesystem type to the standard library | confirmed, via `statfs(2)` through `ctypes` |
| The GUI's legacy database holds data worth migrating | **false** — T7b imports nothing; `T41d` deletes the layer |

Every test below was additionally **red-checked**: its fix reverted, the test
confirmed failing, the fix restored. A test that stays green when its property
is removed is decorative. Two tests here were rewritten after failing that
check, and one of them is discussed in T8a because the failure is instructive.

### Task T7a: Settings and storage validation

**Files:**

- Create: `src/wavedl_daemon/__init__.py`
- Create: `src/wavedl_daemon/storage/__init__.py`
- Create: `src/wavedl_daemon/storage/filesystems.py`
- Create: `src/wavedl_daemon/storage/settings.py`
- Test (create): `unit_tests/daemon/test_settings.py`

**Interfaces:**

Consumes: no earlier task. Standard library only.

Produces:

- `Settings(state_root: Path, run_root: Path, shared_execution: bool = False)`,
  frozen; `Settings.resolved(...)` builds and validates in one step.
- `UnsupportedStorage(RuntimeError)`.
- `default_state_dir() -> Path`, `default_run_dir() -> Path`.
- `filesystem_type(path) -> str | None`, `is_network_filesystem(path) -> bool | None`,
  `is_ephemeral_filesystem(path) -> bool | None`.

The daemon owns two roots with opposite requirements. The **state root** holds
the SQLite registry and the dispatch lock, so it must be local. The **run root**
holds run directories that compute nodes read and write, so it is normally on
exactly the network filesystem the state root forbids. Conflating them is the
defect this task exists to prevent.

Detection is tri-state on purpose. `None` means "this platform will not tell
us", which is not grounds to refuse a root: treating unknown as network would
make the daemon unusable wherever detection is unavailable.

`default_state_dir()` deliberately does not reproduce the GUI's
`CONFIG_FOLDER = Path("AppData").absolute()` (`common/setting.py:22`), which
resolves relative to the working directory and so puts application data wherever
the process happened to start.

`shared_execution` is an explicit input rather than something inferred, because
the daemon cannot discover from the filesystem whether a backend will run work
on another machine.

**Acceptance and gate (1A):**

| Structure failure case | Test |
|---|---|
| Network mount refused for the daemon-state root | `test_network_state_root_is_refused`, with `test_network_run_root_is_accepted` proving the run root's opposite requirement |
| Unwritable dir | `test_unwritable_root_is_refused` writes a probe file rather than trusting `os.access`, which lies for root and under ACLs |
| Run root not visible to compute nodes | `test_shared_execution_refuses_a_run_root_inside_the_state_root` and `test_shared_execution_refuses_an_ephemeral_run_root` |
| Detection is stdlib-only | `test_detection_does_not_depend_on_psutil` import-blocks `psutil` in a fresh interpreter; `test_filesystem_type_is_answered_for_a_real_path` proves the mechanism works |
| Unknown filesystem treated as failure | `test_undetectable_filesystem_is_not_treated_as_a_failure` |
| Application data follows the working directory | `test_default_state_dir_is_absolute_and_independent_of_cwd` |

Visibility to compute nodes cannot be proven from the daemon host: no local call
answers "can another machine read this path". The two cases above are the ones
that *are* decidable locally, and this document says so rather than implying a
guarantee the code cannot make.

- [ ] **Step 1: Write the failing tests**

```python
# unit_tests/daemon/test_settings.py
import os
import subprocess
import sys
from pathlib import Path

import pytest

from wavedl_daemon.storage import filesystems, settings as settings_module
from wavedl_daemon.storage.settings import (
    Settings,
    UnsupportedStorage,
    default_run_dir,
    default_state_dir,
)


def roots(tmp_path):
    return {"state_root": tmp_path / "state", "run_root": tmp_path / "runs"}


def test_default_state_dir_is_absolute_and_independent_of_cwd(tmp_path, monkeypatch):
    """The GUI resolved AppData relative to cwd; application data moved with it."""
    before = default_state_dir()
    monkeypatch.chdir(tmp_path)

    assert default_state_dir() == before
    assert before.is_absolute()
    assert Path("AppData").absolute() != before


def test_filesystem_type_is_answered_for_a_real_path():
    """The per-platform mechanism actually works on this machine."""
    assert filesystems.filesystem_type(Path.home())
    assert filesystems.is_network_filesystem(Path.home()) is False


def test_detection_does_not_depend_on_psutil():
    """psutil is not a declared dependency; detection must not reach for it."""
    script = """
import importlib.abc
import sys
class Block(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split(".")[0] in {"psutil", "PySide6", "torch", "numpy"}:
            raise AssertionError(fullname)
sys.meta_path.insert(0, Block())
from pathlib import Path
from wavedl_daemon.storage.filesystems import filesystem_type
assert filesystem_type(Path.home())
"""
    result = subprocess.run(
        [sys.executable, "-S", "-c", script],
        env=os.environ | {"PYTHONPATH": str(Path("src").resolve())},
        capture_output=True,
        text=True,
        timeout=15,
    )

    assert result.returncode == 0, result.stderr


def test_filesystem_type_walks_up_to_an_existing_ancestor(tmp_path):
    """Roots are validated before they exist."""
    missing = tmp_path / "not" / "created" / "yet"

    assert filesystems.filesystem_type(missing) == filesystems.filesystem_type(tmp_path)


def test_network_state_root_is_refused(tmp_path, monkeypatch):
    """SQLite and flock are both unreliable over the network."""
    paths = roots(tmp_path)
    monkeypatch.setattr(
        settings_module,
        "is_network_filesystem",
        lambda path: path == paths["state_root"],
    )

    with pytest.raises(UnsupportedStorage, match="network filesystem"):
        Settings.resolved(**paths)


def test_network_run_root_is_accepted(tmp_path, monkeypatch):
    """The run root has the opposite requirement: shared storage is the point."""
    paths = roots(tmp_path)
    monkeypatch.setattr(
        settings_module, "is_network_filesystem", lambda path: path == paths["run_root"]
    )

    resolved = Settings.resolved(**paths, shared_execution=True)

    assert resolved.run_root == paths["run_root"]


def test_undetectable_filesystem_is_not_treated_as_a_failure(tmp_path, monkeypatch):
    """None means "the platform will not say", which is not grounds to refuse."""
    monkeypatch.setattr(settings_module, "is_network_filesystem", lambda path: None)
    monkeypatch.setattr(settings_module, "is_ephemeral_filesystem", lambda path: None)

    assert Settings.resolved(**roots(tmp_path), shared_execution=True)


def test_unwritable_root_is_refused(tmp_path):
    """Checked by writing, not by os.access, which lies for root and on ACLs."""
    if os.geteuid() == 0:
        pytest.skip("root bypasses the permission bits this test relies on")
    locked = tmp_path / "locked"
    locked.mkdir(mode=0o500)

    with pytest.raises(UnsupportedStorage, match=r"not writable|not creatable"):
        Settings.resolved(state_root=locked / "state", run_root=tmp_path / "runs")


def test_shared_execution_refuses_a_run_root_inside_the_state_root(tmp_path):
    """The default layout is local-only; a cluster forces an explicit choice."""
    state = tmp_path / "state"

    with pytest.raises(UnsupportedStorage, match="inside the state root"):
        Settings.resolved(
            state_root=state, run_root=state / "runs", shared_execution=True
        )


def test_shared_execution_refuses_an_ephemeral_run_root(tmp_path, monkeypatch):
    """tmpfs cannot be visible to another machine however the cluster is set up."""
    monkeypatch.setattr(settings_module, "is_ephemeral_filesystem", lambda path: True)

    with pytest.raises(UnsupportedStorage, match="ephemeral"):
        Settings.resolved(**roots(tmp_path), shared_execution=True)


def test_local_execution_accepts_the_nested_default_layout(tmp_path):
    """Without shared execution the defaults are fine, including runs/ nesting."""
    state = tmp_path / "state"

    resolved = Settings.resolved(state_root=state, run_root=state / "runs")

    assert resolved.run_root.is_relative_to(resolved.state_root)
    assert default_run_dir().is_relative_to(default_state_dir())


def test_relative_root_is_refused(tmp_path):
    with pytest.raises(UnsupportedStorage, match="must be absolute"):
        Settings(state_root=Path("state"), run_root=tmp_path / "runs")


def test_identical_roots_are_refused(tmp_path):
    with pytest.raises(UnsupportedStorage, match="distinct"):
        Settings.resolved(state_root=tmp_path / "one", run_root=tmp_path / "one")
```

- [ ] **Step 2: Run the tests and verify the failure**

```bash
PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_settings.py \
  --confcutdir=unit_tests/daemon -v
```

Expected: collection fails with `ModuleNotFoundError: No module named
'wavedl_daemon'`. An unrelated dependency/import error is not the intended red
result; resolve the interpreter/PYTHONPATH setup first.

- [ ] **Step 3: Write the minimal implementation**

```python
# src/wavedl_daemon/__init__.py
"""The WaveDL daemon. Imports wavedl.core; never imported by it."""
```

```python
# src/wavedl_daemon/storage/__init__.py
"""Durable daemon state: settings, registry, ownership, schema."""
```

```python
# src/wavedl_daemon/storage/filesystems.py
"""Filesystem identification, using only the standard library.

``psutil`` is not a declared dependency of this project, and ``os.statvfs``
reports no filesystem type, so each platform needs its own mechanism. Every
function here answers "what kind of storage is this path on" on a best-effort
basis and says so honestly: ``filesystem_type`` returns ``None`` when the
platform cannot tell us, and callers must decide what to do about that rather
than being handed a confident wrong answer.
"""

from __future__ import annotations

import ctypes
import sys
from pathlib import Path


# Filesystems whose locking is unsafe for SQLite. SQLite's own documentation
# warns that POSIX advisory locks are unreliable over NFS, and the same applies
# to the other network filesystems here.
NETWORK_FILESYSTEMS = frozenset(
    {
        "9p",
        "afpfs",
        "afs",
        "beegfs",
        "ceph",
        "cifs",
        "fuse.glusterfs",
        "fuse.sshfs",
        "gpfs",
        "lustre",
        "nfs",
        "nfs3",
        "nfs4",
        "panfs",
        "smb2",
        "smb3",
        "smbfs",
        "webdav",
    }
)

# Filesystems that do not outlive the machine, so a shared run root on one is
# invisible to every other node no matter how the cluster is configured.
EPHEMERAL_FILESYSTEMS = frozenset({"devtmpfs", "ramfs", "tmpfs"})


class _MacStatfs(ctypes.Structure):
    """darwin ``struct statfs``; only the trailing name fields are of interest."""

    _fields_ = (
        ("f_bsize", ctypes.c_uint32),
        ("f_iosize", ctypes.c_int32),
        ("f_blocks", ctypes.c_uint64),
        ("f_bfree", ctypes.c_uint64),
        ("f_bavail", ctypes.c_uint64),
        ("f_files", ctypes.c_uint64),
        ("f_ffree", ctypes.c_uint64),
        ("f_fsid", ctypes.c_int32 * 2),
        ("f_owner", ctypes.c_uint32),
        ("f_type", ctypes.c_uint32),
        ("f_flags", ctypes.c_uint32),
        ("f_fssubtype", ctypes.c_uint32),
        ("f_fstypename", ctypes.c_char * 16),
        ("f_mntonname", ctypes.c_char * 1024),
        ("f_mntfromname", ctypes.c_char * 1024),
        ("f_flags_ext", ctypes.c_uint32),
        ("f_reserved", ctypes.c_uint32 * 7),
    )


def _macos_filesystem_type(path: Path) -> str | None:
    library = ctypes.CDLL("libc.dylib", use_errno=True)
    buffer = _MacStatfs()
    if library.statfs(ctypes.c_char_p(bytes(path)), ctypes.byref(buffer)) != 0:
        return None
    return buffer.f_fstypename.decode("utf-8", "replace").lower() or None


def _linux_filesystem_type(path: Path) -> str | None:
    """The longest mount point in /proc/self/mountinfo that contains ``path``."""
    best_type, best_length = None, -1
    try:
        with open("/proc/self/mountinfo", encoding="utf-8") as stream:
            for line in stream:
                before, separator, after = line.partition(" - ")
                if not separator:
                    continue
                fields, rest = before.split(), after.split()
                if len(fields) < 5 or not rest:
                    continue
                mount_point = Path(fields[4])
                if path != mount_point and mount_point not in path.parents:
                    continue
                if len(str(mount_point)) > best_length:
                    best_type, best_length = rest[0].lower(), len(str(mount_point))
    except OSError:
        return None
    return best_type


def _windows_filesystem_type(path: Path) -> str | None:
    """``GetDriveTypeW``: 4 is DRIVE_REMOTE. UNC paths are network by definition."""
    text = str(path)
    if text.startswith("\\\\") or text.startswith("//"):
        return "unc"
    anchor = path.anchor or text[:3]
    drive_type = ctypes.windll.kernel32.GetDriveTypeW(ctypes.c_wchar_p(anchor))
    return {2: "removable", 3: "local", 4: "remote", 5: "cdrom", 6: "ramdisk"}.get(
        drive_type
    )


def filesystem_type(path: Path) -> str | None:
    """The filesystem backing ``path``, or ``None`` when it cannot be determined.

    ``path`` need not exist; the nearest existing ancestor is probed, because a
    root is usually validated before it is created.
    """
    probe = Path(path)
    while not probe.exists():
        parent = probe.parent
        if parent == probe:
            return None
        probe = parent
    try:
        if sys.platform == "darwin":
            return _macos_filesystem_type(probe)
        if sys.platform.startswith("linux"):
            return _linux_filesystem_type(probe)
        if sys.platform == "win32":
            return _windows_filesystem_type(probe)
    except OSError:
        return None
    return None


def is_network_filesystem(path: Path) -> bool | None:
    """Tri-state: True, False, or None when the platform will not say."""
    name = filesystem_type(path)
    if name is None:
        return None
    if sys.platform == "win32":
        return name in {"remote", "unc"}
    return name in NETWORK_FILESYSTEMS


def is_ephemeral_filesystem(path: Path) -> bool | None:
    name = filesystem_type(path)
    if name is None:
        return None
    if sys.platform == "win32":
        return name == "ramdisk"
    return name in EPHEMERAL_FILESYSTEMS
```

```python
# src/wavedl_daemon/storage/settings.py
"""Daemon roots and the storage guarantees each one has to provide.

The daemon owns two roots with opposite requirements. The *state root* holds the
SQLite registry and the dispatch lock, so it must be local: SQLite's locking is
unreliable over NFS, and so is ``flock``. The *run root* holds run directories
that compute nodes read and write, so it is normally on exactly the kind of
network filesystem the state root forbids.

Nothing here inherits the GUI's ``Path("AppData").absolute()`` behaviour, which
resolves relative to the working directory and therefore puts application data
wherever the process happened to start.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path

from wavedl_daemon.storage.filesystems import (
    is_ephemeral_filesystem,
    is_network_filesystem,
)


APP_NAME = "WaveDL"


class UnsupportedStorage(RuntimeError):
    """A root cannot provide the guarantee its purpose requires."""


def default_state_dir() -> Path:
    """Per-user, absolute, and independent of the working directory."""
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA")
        return Path(base or Path.home() / "AppData" / "Local") / APP_NAME
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_NAME
    base = os.environ.get("XDG_STATE_HOME")
    return Path(base or Path.home() / ".local" / "state") / APP_NAME.lower()


def default_run_dir() -> Path:
    """Runs default beside the state root but are expected to be relocated."""
    return default_state_dir() / "runs"


def _require_writable(path: Path, purpose: str) -> None:
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise UnsupportedStorage(f"{purpose} is not creatable: {path} ({exc})") from exc
    probe = path / f".wavedl-write-probe-{os.getpid()}"
    try:
        probe.write_bytes(b"")
    except OSError as exc:
        raise UnsupportedStorage(f"{purpose} is not writable: {path} ({exc})") from exc
    finally:
        probe.unlink(missing_ok=True)


@dataclass(frozen=True)
class Settings:
    """Validated daemon roots.

    ``shared_execution`` records whether any configured backend runs work on a
    different machine. It changes what the run root must satisfy, and it is an
    explicit input because the daemon cannot discover it from the filesystem.
    """

    state_root: Path
    run_root: Path
    shared_execution: bool = False

    def __post_init__(self):
        object.__setattr__(self, "state_root", Path(self.state_root).expanduser())
        object.__setattr__(self, "run_root", Path(self.run_root).expanduser())
        for name in ("state_root", "run_root"):
            if not getattr(self, name).is_absolute():
                raise UnsupportedStorage(f"{name} must be absolute")

    @classmethod
    def resolved(
        cls,
        *,
        state_root: Path | None = None,
        run_root: Path | None = None,
        shared_execution: bool = False,
    ) -> Settings:
        settings = cls(
            state_root=state_root or default_state_dir(),
            run_root=run_root or default_run_dir(),
            shared_execution=shared_execution,
        )
        settings.validate()
        return settings

    def validate(self) -> None:
        _require_writable(self.state_root, "state root")
        _require_writable(self.run_root, "run root")

        if self.state_root == self.run_root:
            raise UnsupportedStorage("state root and run root must be distinct")

        # The registry and the dispatch lock both depend on POSIX advisory
        # locking, which is unreliable over the network.
        if is_network_filesystem(self.state_root):
            raise UnsupportedStorage(
                f"state root is on a network filesystem, where SQLite and lock "
                f"ownership are unreliable: {self.state_root}"
            )

        if self.shared_execution:
            # A run root nested in the state root cannot be relocated to shared
            # storage without dragging the registry onto the network with it.
            if self.run_root.is_relative_to(self.state_root):
                raise UnsupportedStorage(
                    f"run root is inside the state root, so it cannot be shared "
                    f"with compute nodes: {self.run_root}"
                )
            if is_ephemeral_filesystem(self.run_root):
                raise UnsupportedStorage(
                    f"run root is on an ephemeral filesystem and cannot be "
                    f"visible to another machine: {self.run_root}"
                )
```

- [ ] **Step 4: Run the tests and verify the pass count**

```bash
PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_settings.py \
  --confcutdir=unit_tests/daemon -v
```

Expected: **13 passed**, no failures or skips.

Run the focused style checks before committing:

```bash
PYTHONPATH=src ruff check --config pyproject.toml \
  src/wavedl_daemon unit_tests/daemon/test_settings.py
PYTHONPATH=src ruff format --config pyproject.toml --check \
  src/wavedl_daemon unit_tests/daemon/test_settings.py
```

Expected: Ruff reports no violations and all listed Python files are already
formatted. The implementation blocks use 88-column formatting.

- [ ] **Step 5: Commit this task only**

```bash
git add -- \
  src/wavedl_daemon/__init__.py \
  src/wavedl_daemon/storage/__init__.py \
  src/wavedl_daemon/storage/filesystems.py \
  src/wavedl_daemon/storage/settings.py \
  unit_tests/daemon/test_settings.py
git commit --only -m "feat(daemon): validate the two storage roots separately" -- \
  src/wavedl_daemon/__init__.py \
  src/wavedl_daemon/storage/__init__.py \
  src/wavedl_daemon/storage/filesystems.py \
  src/wavedl_daemon/storage/settings.py \
  unit_tests/daemon/test_settings.py
```

### Task T8a: Registry transactions and cursors

**Files:**

- Create: `src/wavedl_daemon/storage/registry.py`
- Test (create): `unit_tests/daemon/test_registry.py`

**Interfaces:**

Consumes: T7a for the state root. `wavedl.core.protocol.Envelope` and
`ProtocolError`, `wavedl.core.journal_reader.JournalReader` for the rebuild.

Produces:

- `RunRecord(run_id, operation, state, attempt, event_count, last_type, updated_at)`, frozen.
- `Registry(path)` with `cursor(run_id, attempt)`, `get(run_id)`,
  `list_runs(state=None, limit=50, offset=0)`, `apply_events(run_id, attempt, events, *, project=default_projection)`,
  `rebuild_from_journals(run_root)`, and context-manager support.
- `default_projection(record, event) -> RunRecord`.
- `SCHEMA_VERSION = 1`.

`events.jsonl` is the source of truth; this registry is a **durable local index**
of it. It exists because two things are impractical over a tree of journal
files: transactional uniqueness for submission idempotency (T22a), and
relational queries across runs. It is not a cache — losing it costs a rebuild,
which is why `rebuild_from_journals` is part of the contract rather than an
operational afterthought.

The projection is injectable and `default_projection` is deliberately small.
T8a owns transactions and cursors, not semantics; T9's reducer supersedes the
default. Keeping the seam here means the reducer can be built and reviewed on
its own instead of being smuggled into the storage layer.

Cursors are keyed `(run_id, attempt)`. A requeued Slurm job reuses its job id
and restarts `seq` at zero, so a per-run cursor would silently discard the new
attempt's early events as already seen.

**Acceptance and gate (1A):**

| Structure failure case | Test |
|---|---|
| Projection and cursor commit in one transaction | `test_projection_and_cursor_commit_atomically` kills a real subprocess between the two writes and asserts neither landed |
| Duplicate apply | `test_partial_redelivery_applies_only_what_is_new` is the test that establishes this; `test_duplicate_apply_is_a_no_op` covers exact re-delivery |
| Cursor per attempt not per run | `test_cursor_is_per_attempt_not_per_run` replays attempt 2 from `seq 0` after attempt 1 reached `seq 2` |
| Registry deleted mid-flight | `test_rebuild_from_journals_restores_a_lost_registry` deletes the file and refolds; `test_rebuild_is_idempotent_and_discards_stale_rows` and `test_rebuild_keeps_going_past_a_damaged_journal_tail` cover repeat and damage |
| Events from another run | `test_events_belonging_to_another_run_are_refused`, asserting nothing was written |

**On the two tests that failed their red-check.** The first version of the
atomicity test paused inside `apply_events` *before* either write and was green
against a deliberately split transaction — it could not distinguish the two
implementations because neither committed. Extracting `_write_cursor` as a named
method, symmetric with `_write_record`, gave the test a real boundary to pause
at: the projection row written, the cursor not yet. It is now red against the
split version.

The second was a mapping error rather than a coverage gap.
`test_duplicate_apply_is_a_no_op` stayed green when the `seq <= position` skip
was deleted, because exact re-delivery is also caught by the outer
`applied != position` guard. The property is genuinely established by
`test_partial_redelivery_applies_only_what_is_new`, which is red without the
skip. The acceptance table above names that test, not the weaker one.

- [ ] **Step 1: Write the failing tests**

```python
# unit_tests/daemon/test_registry.py
import signal
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import pytest

from wavedl.core.protocol import Envelope, ProtocolError, encode
from wavedl_daemon.storage.registry import Registry


RUN_ID = "00000000-0000-4000-8000-000000000001"
OTHER_ID = "00000000-0000-4000-8000-000000000002"


def event(seq, *, run_id=RUN_ID, attempt=1, type="metric", **payload):
    return Envelope(
        run_id=run_id,
        attempt=attempt,
        type=type,
        seq=seq,
        ts=datetime(2026, 9, 8, 12, seq % 60, tzinfo=UTC).isoformat(),
        payload=payload,
    )


# A writer that pauses between the two writes: the projection row has been
# written, the cursor has not. Killing it there is the only way to tell an
# atomic implementation from one that commits the projection separately.
VICTIM = """
import sys, time
sys.path.insert(0, {src!r})
from datetime import UTC, datetime
from wavedl.core.protocol import Envelope
from wavedl_daemon.storage.registry import Registry

def pause(self, run_id, attempt, seq):
    print("record written, cursor pending", flush=True)
    time.sleep(300)
Registry._write_cursor = pause

registry = Registry({path!r})
registry.apply_events({run_id!r}, 1, [Envelope({run_id!r}, 1, "hello", 0,
    datetime.now(UTC).isoformat(), {{}})])
"""


def test_projection_and_cursor_commit_atomically(tmp_path):
    """A crash between the two writes must leave NEITHER applied."""
    path = tmp_path / "registry.db"
    Registry(path).close()  # create the schema first

    victim = subprocess.Popen(
        [
            sys.executable,
            "-c",
            VICTIM.format(
                src=str(Path("src").resolve()), path=str(path), run_id=RUN_ID
            ),
        ],
        stdout=subprocess.PIPE,
        text=True,
    )
    assert victim.stdout.readline().strip() == "record written, cursor pending"
    victim.send_signal(signal.SIGKILL)
    victim.wait()
    time.sleep(0.1)

    with Registry(path) as registry:
        assert registry.get(RUN_ID) is None, "projection committed without its cursor"
        assert registry.cursor(RUN_ID, 1) == -1


def test_duplicate_apply_is_a_no_op(tmp_path):
    """Re-delivering a batch after a lost response must change nothing."""
    with Registry(tmp_path / "registry.db") as registry:
        batch = [event(0, type="hello"), event(1), event(2)]

        assert registry.apply_events(RUN_ID, 1, batch) == 2
        first = registry.get(RUN_ID)
        assert registry.apply_events(RUN_ID, 1, batch) == 2

        assert registry.get(RUN_ID) == first
        assert first.event_count == 3


def test_partial_redelivery_applies_only_what_is_new(tmp_path):
    with Registry(tmp_path / "registry.db") as registry:
        registry.apply_events(RUN_ID, 1, [event(0, type="hello"), event(1)])

        assert registry.apply_events(RUN_ID, 1, [event(1), event(2), event(3)]) == 3
        assert registry.get(RUN_ID).event_count == 4


def test_cursor_is_per_attempt_not_per_run(tmp_path):
    """A requeued Slurm job reuses its id and restarts seq at zero."""
    with Registry(tmp_path / "registry.db") as registry:
        registry.apply_events(RUN_ID, 1, [event(0, type="hello"), event(1), event(2)])

        assert registry.cursor(RUN_ID, 1) == 2
        assert registry.cursor(RUN_ID, 2) == -1

        applied = registry.apply_events(
            RUN_ID, 2, [event(0, attempt=2, type="hello"), event(1, attempt=2)]
        )

        assert applied == 1  # attempt 2's own seq, not continued from attempt 1
        assert registry.cursor(RUN_ID, 1) == 2
        assert registry.get(RUN_ID).attempt == 2


def test_events_belonging_to_another_run_are_refused(tmp_path):
    with Registry(tmp_path / "registry.db") as registry:
        with pytest.raises(ProtocolError, match="does not belong"):
            registry.apply_events(RUN_ID, 1, [event(0, run_id=OTHER_ID)])

        assert registry.get(RUN_ID) is None
        assert registry.cursor(RUN_ID, 1) == -1


def test_list_runs_filters_and_orders(tmp_path):
    with Registry(tmp_path / "registry.db") as registry:
        registry.apply_events(RUN_ID, 1, [event(0, type="hello")])
        registry.apply_events(
            OTHER_ID, 1, [event(0, run_id=OTHER_ID, type="exit", state="failed")]
        )

        assert [r.run_id for r in registry.list_runs(state="running")] == [RUN_ID]
        assert [r.run_id for r in registry.list_runs(state="failed")] == [OTHER_ID]
        assert len(registry.list_runs()) == 2
        assert registry.list_runs(limit=1) == registry.list_runs(limit=1, offset=0)


def write_journal(root, run_id, attempt, events):
    path = root / run_id / "attempts" / str(attempt) / "events.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("ab") as stream:
        for item in events:
            stream.write(encode(item))
    return path


def test_rebuild_from_journals_restores_a_lost_registry(tmp_path):
    """Losing the index costs a rebuild, not data. events.jsonl is the truth."""
    run_root = tmp_path / "runs"
    write_journal(run_root, RUN_ID, 1, [event(0, type="hello"), event(1), event(2)])
    write_journal(
        run_root,
        OTHER_ID,
        1,
        [event(0, run_id=OTHER_ID, type="hello"), event(1, run_id=OTHER_ID)],
    )

    path = tmp_path / "registry.db"
    with Registry(path) as registry:
        registry.apply_events(RUN_ID, 1, [event(0, type="hello"), event(1), event(2)])
        before = registry.get(RUN_ID)

    path.unlink()  # the index is gone
    with Registry(path) as rebuilt:
        assert rebuilt.get(RUN_ID) is None

        assert rebuilt.rebuild_from_journals(run_root) == 2

        assert rebuilt.get(RUN_ID) == before
        assert rebuilt.cursor(RUN_ID, 1) == 2
        assert rebuilt.get(OTHER_ID).event_count == 2


def test_rebuild_is_idempotent_and_discards_stale_rows(tmp_path):
    run_root = tmp_path / "runs"
    write_journal(run_root, RUN_ID, 1, [event(0, type="hello"), event(1)])

    with Registry(tmp_path / "registry.db") as registry:
        registry.apply_events(OTHER_ID, 1, [event(0, run_id=OTHER_ID, type="hello")])

        registry.rebuild_from_journals(run_root)
        once = registry.list_runs()
        registry.rebuild_from_journals(run_root)

        assert registry.list_runs() == once
        assert [r.run_id for r in once] == [RUN_ID]  # the stale row is gone


def test_rebuild_keeps_going_past_a_damaged_journal_tail(tmp_path):
    run_root = tmp_path / "runs"
    damaged = write_journal(run_root, RUN_ID, 1, [event(0, type="hello"), event(1)])
    with damaged.open("ab") as stream:
        stream.write(b'{"not a valid envelope"}\n')
    write_journal(run_root, OTHER_ID, 1, [event(0, run_id=OTHER_ID, type="hello")])

    with Registry(tmp_path / "registry.db") as registry:
        registry.rebuild_from_journals(run_root)

        assert registry.get(RUN_ID).event_count == 2  # the good prefix survives
        assert registry.get(OTHER_ID) is not None  # and the next run still folds
```

- [ ] **Step 2: Run the tests and verify the failure**

```bash
PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_registry.py \
  --confcutdir=unit_tests/daemon -v
```

Expected: collection fails with `ModuleNotFoundError: No module named
'wavedl_daemon.storage.registry'`.

- [ ] **Step 3: Write the minimal implementation**

```python
# src/wavedl_daemon/storage/registry.py
"""A SQLite projection of the journals: durable, queryable, and rebuildable.

``events.jsonl`` is the source of truth. This registry exists because two things
are impractical over a tree of journal files: transactional uniqueness for
submission idempotency, and relational queries across runs. It is an index, not
an authority, and `rebuild_from_journals` restores it from the journals whenever
it is lost or suspect.

The projection and the cursor that records how far it has consumed are written
in ONE transaction. That is the whole durability argument: a crash cannot leave
the projection ahead of the cursor (double-applying on restart) or behind it
(silently dropping events), because neither is committed without the other.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, replace
from pathlib import Path
from typing import TYPE_CHECKING

from wavedl.core.journal_reader import JournalReader
from wavedl.core.protocol import ProtocolError


if TYPE_CHECKING:
    from collections.abc import Callable, Iterable, Sequence

    from wavedl.core.protocol import Envelope


SCHEMA_VERSION = 1

_SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    run_id        TEXT PRIMARY KEY,
    operation     TEXT NOT NULL DEFAULT '',
    state         TEXT NOT NULL DEFAULT 'unknown',
    attempt       INTEGER NOT NULL DEFAULT 0,
    event_count   INTEGER NOT NULL DEFAULT 0,
    last_type     TEXT NOT NULL DEFAULT '',
    updated_at    TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS cursors (
    run_id  TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    seq     INTEGER NOT NULL,
    PRIMARY KEY (run_id, attempt)
);
CREATE INDEX IF NOT EXISTS runs_by_state ON runs (state, updated_at DESC);
"""


@dataclass(frozen=True)
class RunRecord:
    run_id: str
    operation: str = ""
    state: str = "unknown"
    attempt: int = 0
    event_count: int = 0
    last_type: str = ""
    updated_at: str = ""


def default_projection(record: RunRecord | None, event: Envelope) -> RunRecord:
    """A deliberately small fold; T9's reducer supersedes it.

    T8a owns transactions and cursors, not semantics. Keeping the projection
    injectable means the reducer can be developed and reviewed on its own rather
    than being smuggled in here.
    """
    current = record or RunRecord(run_id=event.run_id)
    state = current.state
    if event.type == "hello":
        state = "running"
    elif event.type == "state":
        state = str(event.payload.get("state", state))
    elif event.type == "exit":
        state = str(event.payload.get("state", "exited"))
    return replace(
        current,
        operation=str(event.payload.get("operation", current.operation)),
        state=state,
        attempt=max(current.attempt, event.attempt),
        event_count=current.event_count + 1,
        last_type=event.type,
        updated_at=event.ts,
    )


class Registry:
    """Owns one SQLite file. Not shared between processes; T8b gates writers."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # isolation_level=None puts transaction boundaries under our control
        # instead of the driver's implicit-commit heuristics.
        self._connection = sqlite3.connect(self.path, isolation_level=None)
        self._connection.row_factory = sqlite3.Row
        self._connection.execute("PRAGMA journal_mode=WAL")
        self._connection.execute("PRAGMA synchronous=FULL")
        self._connection.execute("PRAGMA foreign_keys=ON")
        self._connection.executescript(_SCHEMA)

    def close(self) -> None:
        self._connection.close()

    def __enter__(self) -> Registry:
        return self

    def __exit__(self, *exc_info) -> None:
        self.close()

    # -- reads ---------------------------------------------------------------

    def cursor(self, run_id: str, attempt: int) -> int:
        """Highest applied seq for THIS attempt; -1 when nothing has been applied.

        Cursors are per attempt because a requeued Slurm job reuses its job id
        and restarts seq at zero. A per-run cursor would discard the new
        attempt's early events as already seen.
        """
        row = self._connection.execute(
            "SELECT seq FROM cursors WHERE run_id = ? AND attempt = ?",
            (run_id, attempt),
        ).fetchone()
        return -1 if row is None else int(row["seq"])

    def get(self, run_id: str) -> RunRecord | None:
        row = self._connection.execute(
            "SELECT * FROM runs WHERE run_id = ?", (run_id,)
        ).fetchone()
        return None if row is None else RunRecord(**dict(row))

    def list_runs(
        self, *, state: str | None = None, limit: int = 50, offset: int = 0
    ) -> list[RunRecord]:
        if state is None:
            rows = self._connection.execute(
                "SELECT * FROM runs ORDER BY updated_at DESC, run_id LIMIT ? OFFSET ?",
                (limit, offset),
            )
        else:
            rows = self._connection.execute(
                "SELECT * FROM runs WHERE state = ? "
                "ORDER BY updated_at DESC, run_id LIMIT ? OFFSET ?",
                (state, limit, offset),
            )
        return [RunRecord(**dict(row)) for row in rows]

    # -- writes --------------------------------------------------------------

    def apply_events(
        self,
        run_id: str,
        attempt: int,
        events: Iterable[Envelope],
        *,
        project: Callable[[RunRecord | None, Envelope], RunRecord] = default_projection,
    ) -> int:
        """Fold events into the projection and advance the cursor, atomically.

        Events at or below the stored cursor are skipped, so re-delivering a
        batch after a lost response changes nothing. Returns the new cursor.
        """
        batch: Sequence[Envelope] = list(events)
        for event in batch:
            if event.run_id != run_id or event.attempt != attempt:
                raise ProtocolError(
                    f"event {event.run_id}/{event.attempt} does not belong to "
                    f"{run_id}/{attempt}"
                )

        self._connection.execute("BEGIN IMMEDIATE")
        try:
            position = self.cursor(run_id, attempt)
            record = self.get(run_id)
            applied = position
            for event in batch:
                if event.seq <= position:
                    continue  # already folded in; re-delivery is a no-op
                record = project(record, event)
                applied = event.seq
            if applied != position:
                self._write_record(record)
                self._write_cursor(run_id, attempt, applied)
            self._connection.execute("COMMIT")
        except BaseException:
            self._connection.execute("ROLLBACK")
            raise
        return applied

    def _write_record(self, record: RunRecord) -> None:
        self._connection.execute(
            "INSERT INTO runs (run_id, operation, state, attempt, event_count, "
            "last_type, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(run_id) DO UPDATE SET operation = excluded.operation, "
            "state = excluded.state, attempt = excluded.attempt, "
            "event_count = excluded.event_count, last_type = excluded.last_type, "
            "updated_at = excluded.updated_at",
            (
                record.run_id,
                record.operation,
                record.state,
                record.attempt,
                record.event_count,
                record.last_type,
                record.updated_at,
            ),
        )

    def _write_cursor(self, run_id: str, attempt: int, seq: int) -> None:
        self._connection.execute(
            "INSERT INTO cursors (run_id, attempt, seq) VALUES (?, ?, ?) "
            "ON CONFLICT(run_id, attempt) DO UPDATE SET seq = excluded.seq",
            (run_id, attempt, seq),
        )

    # -- recovery ------------------------------------------------------------

    def rebuild_from_journals(self, run_root: Path) -> int:
        """Discard the projection and refold it from the journals.

        This is the reason the registry may be treated as disposable: losing it
        costs a rebuild, not data. Returns the number of attempts folded.
        """
        self._connection.execute("BEGIN IMMEDIATE")
        try:
            self._connection.execute("DELETE FROM runs")
            self._connection.execute("DELETE FROM cursors")
            self._connection.execute("COMMIT")
        except BaseException:
            self._connection.execute("ROLLBACK")
            raise

        folded = 0
        for journal in sorted(Path(run_root).glob("*/attempts/*/events.jsonl")):
            run_id = journal.parents[2].name
            try:
                attempt = int(journal.parents[0].name)
            except ValueError:
                continue
            reader = JournalReader(journal, run_id=run_id, attempt=attempt)
            batch: list[Envelope] = []
            while True:
                try:
                    events = reader.read()
                except ProtocolError:
                    break  # a damaged tail stops this attempt, not the rebuild
                if not events:
                    break
                batch.extend(events)
            if batch:
                self.apply_events(run_id, attempt, batch)
                folded += 1
        return folded
```

- [ ] **Step 4: Run the tests and verify the pass count**

```bash
PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_registry.py \
  --confcutdir=unit_tests/daemon -v
```

Expected: **9 passed**, no failures or skips.

Run the focused style checks before committing:

```bash
PYTHONPATH=src ruff check --config pyproject.toml \
  src/wavedl_daemon/storage/registry.py unit_tests/daemon/test_registry.py
PYTHONPATH=src ruff format --config pyproject.toml --check \
  src/wavedl_daemon/storage/registry.py unit_tests/daemon/test_registry.py
```

Expected: Ruff reports no violations and both files are already formatted.

- [ ] **Step 5: Commit this task only**

```bash
git add -- \
  src/wavedl_daemon/storage/registry.py \
  unit_tests/daemon/test_registry.py
git commit --only -m "feat(daemon): project journals into a rebuildable registry" -- \
  src/wavedl_daemon/storage/registry.py \
  unit_tests/daemon/test_registry.py
```

### Task T8b: Dispatch ownership

**Files:**

- Create: `src/wavedl_daemon/storage/ownership.py`
- Test (create): `unit_tests/daemon/test_ownership.py`

**Interfaces:**

Consumes: T7a for the state root that holds the lock file. Independent of T8a at
runtime; ordered after it because every registry mutation is gated on it.

Produces:

- `DispatchLock(path)` with `acquire()`, `release()`, `held`, and context-manager
  support.
- `acquire_dispatch_lock(path)` context manager.
- `require_dispatch(lock)` guard.
- `DispatchHeld(RuntimeError)`, `DispatchRequired(RuntimeError)`.

Exactly one daemon may mutate run state at a time. The obvious implementation —
a row recording the owning pid — is not ownership: a pid is not liveness,
because the kernel reuses pids, so a table cannot distinguish "the owner is
still running" from "an unrelated process now has that number". A daemon killed
with `SIGKILL` runs no cleanup, so any scheme requiring the owner to tidy up
strands every future daemon.

An advisory file lock has the property that matters, and it was verified rather
than assumed: while a real holder lived, acquisition raised
`BlockingIOError [Errno 35]`; after `SIGKILL` it acquired immediately. The lock
is therefore the only authority. A pid is still written into the file for
operators reading logs, and this module never reads it back as a liveness
signal — a distinction `test_a_stale_lock_file_does_not_strand_the_successor`
pins down.

Windows gets `msvcrt.locking`, which the same process-death argument covers
because the handle closes with the process. That path is not exercised by this
machine's test run; `CI-1` is where it is validated, and this document does not
claim otherwise.

**Acceptance and gate (1A):**

| Structure failure case | Test |
|---|---|
| Killed daemon releases the lock | `test_killed_daemon_releases_the_lock` `SIGKILL`s a real holding subprocess, then acquires |
| Two daemons | `test_second_daemon_is_refused` with a real second process holding it |
| Every external mutation gated | `test_mutation_without_ownership_is_refused` covers not-yet-acquired, `None`, and released |
| A stale lock file strands the successor | `test_a_stale_lock_file_does_not_strand_the_successor` asserts the dead pid is present in the file and irrelevant |
| Ownership leaks on an exception | `test_context_manager_releases_on_exception` |

- [ ] **Step 1: Write the failing tests**

```python
# unit_tests/daemon/test_ownership.py
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest

from wavedl_daemon.storage.ownership import (
    DispatchHeld,
    DispatchLock,
    DispatchRequired,
    acquire_dispatch_lock,
    require_dispatch,
)


HOLDER = """
import sys, time
sys.path.insert(0, {src!r})
from wavedl_daemon.storage.ownership import DispatchLock
lock = DispatchLock({path!r})
lock.acquire()
print("held", flush=True)
time.sleep(300)
"""


def spawn_holder(path):
    """A real process holding the lock, so it can be really killed."""
    process = subprocess.Popen(
        [
            sys.executable,
            "-c",
            HOLDER.format(src=str(Path("src").resolve()), path=str(path)),
        ],
        stdout=subprocess.PIPE,
        text=True,
    )
    assert process.stdout.readline().strip() == "held"
    return process


def test_second_daemon_is_refused(tmp_path):
    path = tmp_path / "dispatch.lock"
    holder = spawn_holder(path)
    try:
        with pytest.raises(DispatchHeld, match="another process owns dispatch"):
            DispatchLock(path).acquire()
    finally:
        holder.kill()
        holder.wait()


def test_killed_daemon_releases_the_lock(tmp_path):
    """SIGKILL runs no cleanup, so the kernel must be the one releasing it."""
    path = tmp_path / "dispatch.lock"
    holder = spawn_holder(path)

    holder.send_signal(signal.SIGKILL)
    holder.wait()

    deadline = time.monotonic() + 5
    while True:
        successor = DispatchLock(path)
        try:
            successor.acquire()
            break
        except DispatchHeld:
            if time.monotonic() > deadline:
                raise
            time.sleep(0.02)
    assert successor.held
    successor.release()


def test_a_stale_lock_file_does_not_strand_the_successor(tmp_path):
    """The file surviving with a dead pid inside it must not block anyone."""
    path = tmp_path / "dispatch.lock"
    holder = spawn_holder(path)
    recorded = path.read_text().strip()
    holder.send_signal(signal.SIGKILL)
    holder.wait()
    time.sleep(0.05)

    assert recorded == str(holder.pid)  # the pid is recorded ...
    assert path.exists()  # ... and the file outlives its writer

    with acquire_dispatch_lock(path) as lock:  # ... and neither blocks ownership
        assert lock.held


def test_release_makes_ownership_available_again(tmp_path):
    path = tmp_path / "dispatch.lock"
    first = DispatchLock(path)
    first.acquire()
    first.release()

    with acquire_dispatch_lock(path) as second:
        assert second.held


def test_context_manager_releases_on_exception(tmp_path):
    path = tmp_path / "dispatch.lock"

    with pytest.raises(ZeroDivisionError), acquire_dispatch_lock(path):
        raise ZeroDivisionError

    with acquire_dispatch_lock(path) as lock:
        assert lock.held


def test_mutation_without_ownership_is_refused(tmp_path):
    """Every externally visible mutation is gated on this."""
    lock = DispatchLock(tmp_path / "dispatch.lock")

    with pytest.raises(DispatchRequired):
        require_dispatch(lock)
    with pytest.raises(DispatchRequired):
        require_dispatch(None)

    lock.acquire()
    require_dispatch(lock)
    lock.release()
    with pytest.raises(DispatchRequired):
        require_dispatch(lock)


def test_double_acquire_by_the_same_object_is_refused(tmp_path):
    lock = DispatchLock(tmp_path / "dispatch.lock")
    lock.acquire()
    try:
        with pytest.raises(DispatchHeld, match="already acquired"):
            lock.acquire()
    finally:
        lock.release()


def test_lock_directory_is_created_on_demand(tmp_path):
    path = tmp_path / "missing" / "dispatch.lock"

    with acquire_dispatch_lock(path) as lock:
        assert lock.held
        assert path.exists()
```

- [ ] **Step 2: Run the tests and verify the failure**

```bash
PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_ownership.py \
  --confcutdir=unit_tests/daemon -v
```

Expected: collection fails with `ModuleNotFoundError: No module named
'wavedl_daemon.storage.ownership'`.

- [ ] **Step 3: Write the minimal implementation**

```python
# src/wavedl_daemon/storage/ownership.py
"""Single-writer dispatch ownership, released by the kernel on process death.

Exactly one daemon may mutate run state at a time. The obvious implementation --
a row recording the owning pid -- is not ownership: a pid is not liveness,
because the kernel reuses pids, so a table cannot distinguish "the owner is
still running" from "an unrelated process now has that number". A daemon killed
with SIGKILL runs no cleanup, so any scheme requiring the owner to tidy up
strands every future daemon.

An advisory file lock has the property that matters: the kernel drops it when
the holding process dies, however it dies. The lock is therefore the only
authority, and no pid is consulted for liveness. A pid is still *recorded*, for
operators reading logs, and is explicitly not trusted by this module.
"""

from __future__ import annotations

import os
import sys
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING


if TYPE_CHECKING:
    from collections.abc import Iterator


if sys.platform == "win32":  # pragma: no cover - exercised on Windows CI
    import msvcrt

    def _try_lock(handle) -> bool:
        try:
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            return False
        return True

    def _unlock(handle) -> None:
        try:
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        except OSError:
            pass
else:
    import fcntl

    def _try_lock(handle) -> bool:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            return False
        return True

    def _unlock(handle) -> None:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass


class DispatchHeld(RuntimeError):
    """Another process already owns dispatch."""


class DispatchRequired(RuntimeError):
    """A state mutation was attempted without owning dispatch."""


class DispatchLock:
    """Ownership of the right to mutate run state.

    Not reentrant across open file descriptions: a second ``DispatchLock`` on
    the same path fails even inside the same process, because that is what a
    second daemon would look like.
    """

    def __init__(self, path: Path):
        self.path = Path(path)
        self._handle = None

    @property
    def held(self) -> bool:
        return self._handle is not None

    def acquire(self) -> DispatchLock:
        if self.held:
            raise DispatchHeld(f"dispatch already acquired by this object: {self.path}")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle = self.path.open("a+")
        if not _try_lock(handle):
            handle.close()
            raise DispatchHeld(f"another process owns dispatch: {self.path}")
        self._handle = handle
        # Recorded for operators only. Never read back as a liveness signal.
        try:
            handle.seek(0)
            handle.truncate()
            handle.write(f"{os.getpid()}\n")
            handle.flush()
        except OSError:
            pass
        return self

    def release(self) -> None:
        if not self.held:
            return
        handle, self._handle = self._handle, None
        _unlock(handle)
        handle.close()

    def __enter__(self) -> DispatchLock:
        return self.acquire()

    def __exit__(self, *exc_info) -> None:
        self.release()


@contextmanager
def acquire_dispatch_lock(path: Path) -> Iterator[DispatchLock]:
    """Own dispatch for the duration of the block."""
    lock = DispatchLock(path)
    lock.acquire()
    try:
        yield lock
    finally:
        lock.release()


def require_dispatch(lock: DispatchLock | None) -> None:
    """Gate every externally visible state mutation."""
    if lock is None or not lock.held:
        raise DispatchRequired("this operation requires dispatch ownership")
```

- [ ] **Step 4: Run the tests and verify the pass count**

```bash
PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_ownership.py \
  --confcutdir=unit_tests/daemon -v
```

Expected: **8 passed**, no failures or skips.

Run the focused style checks before committing:

```bash
PYTHONPATH=src ruff check --config pyproject.toml \
  src/wavedl_daemon/storage/ownership.py unit_tests/daemon/test_ownership.py
PYTHONPATH=src ruff format --config pyproject.toml --check \
  src/wavedl_daemon/storage/ownership.py unit_tests/daemon/test_ownership.py
```

Expected: Ruff reports no violations and both files are already formatted.

- [ ] **Step 5: Commit this task only**

```bash
git add -- \
  src/wavedl_daemon/storage/ownership.py \
  unit_tests/daemon/test_ownership.py
git commit --only -m "feat(daemon): own dispatch with a kernel-released lock" -- \
  src/wavedl_daemon/storage/ownership.py \
  unit_tests/daemon/test_ownership.py
```

### Task T7b: Schema versioning and recovery

**Files:**

- Create: `src/wavedl_daemon/storage/schema.py`
- Test (create): `unit_tests/daemon/test_schema.py`

**Interfaces:**

Consumes: T8a for the registry file this operates on.

Produces:

- `Migration(migration_id: str, to_version: int, apply: Callable[[Connection], None])`, frozen.
- `MIGRATIONS: tuple[Migration, ...]`, empty until the schema first changes.
- `schema_version(connection) -> int`, `applied_migrations(connection) -> set[str]`.
- `migrate(path, migrations=MIGRATIONS) -> list[str]`.
- `open_read_only(path) -> Connection`, `backup_path(path, migration_id) -> Path`,
  `restore_backup(path, migration_id)`.
- `MigrationFailed(RuntimeError)`.

**There is no legacy import.** The structure document originally required an
explicit disposition of the GUI `task` entity's download fields. Tracing the
code showed there is nothing to dispose of: `tbl_task` carries `url`, `isLive`,
`isBinaryMerge` and `isLiveRealTimeMerge` — a video downloader's schema reached
through a music-player template — its only consumer is imported by nobody and
would raise `AttributeError` if it were, no insert path exists anywhere, and no
`database.db` exists on the development machine. Importing it would carry a
foreign schema into the new system for zero users. `T41d` deletes it. This task
is therefore about the migrations the daemon will need *later*, when its own
schema changes under an installed user.

**Crash safety comes from the transaction, not the backup.** SQLite rolls back
DDL and `PRAGMA user_version` together — verified: a migration killed midway
leaves the database at its previous version with no partial table and no
bookkeeping row. Each migration runs in one transaction with its bookkeeping
insert and its version bump, so it is applied exactly once even if the daemon
dies between two migrations. The backup covers the case a transaction cannot: a
migration that *completed* and is afterwards found to be wrong.

`MIGRATIONS` is empty on purpose. The registry's initial schema is created by
`Registry`; inventing a migration for it would be bookkeeping theatre. The
runner is what future changes plug into, and the tests exercise it with real
migrations rather than leaving it unproven.

**Acceptance and gate (1A):**

| Structure failure case | Test |
|---|---|
| A future schema change is applied exactly once | `test_a_migration_is_applied_exactly_once` runs `migrate` three times |
| Interrupted migration restores backup | `test_an_interrupted_migration_leaves_the_database_unchanged` `SIGKILL`s mid-migration; `test_backup_restores_a_completed_migration` covers what the transaction cannot undo |
| Read-only recovery start | `test_read_only_recovery_start_cannot_write` asserts the write actually raises |
| Migration fails partway | `test_a_failing_migration_rolls_back_completely` checks the table, the version, and the bookkeeping |
| Migrations applied out of order | `test_migrations_apply_in_version_order`; `test_a_backward_migration_is_refused` rejects a target not ahead of the current version |
| The daemon reaches for the GUI database | `test_the_daemon_never_imports_the_gui_database` import-blocks `wavedl_gui`, PySide6, torch and NumPy in a fresh interpreter and asserts `MIGRATIONS == ()` |

- [ ] **Step 1: Write the failing tests**

```python
# unit_tests/daemon/test_schema.py
import signal
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

import pytest

from wavedl_daemon.storage.schema import (
    Migration,
    MigrationFailed,
    applied_migrations,
    migrate,
    open_read_only,
    restore_backup,
    schema_version,
)


def add_table(name):
    return lambda connection: connection.execute(f"CREATE TABLE {name}(run_id TEXT)")


def fresh(tmp_path):
    path = tmp_path / "registry.db"
    sqlite3.connect(path).close()
    return path


def tables(path):
    with sqlite3.connect(path) as connection:
        return {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }


def test_a_migration_is_applied_exactly_once(tmp_path):
    path = fresh(tmp_path)
    migration = Migration("0001_add_tags", 1, add_table("tags"))

    assert migrate(path, [migration]) == ["0001_add_tags"]
    assert migrate(path, [migration]) == []
    assert migrate(path, [migration]) == []

    with sqlite3.connect(path) as connection:
        assert schema_version(connection) == 1
        assert applied_migrations(connection) == {"0001_add_tags"}
    assert "tags" in tables(path)


def test_migrations_apply_in_version_order(tmp_path):
    path = fresh(tmp_path)
    order = []
    migrations = [
        Migration("0002_second", 2, lambda c: order.append(2)),
        Migration("0001_first", 1, lambda c: order.append(1)),
    ]

    assert migrate(path, migrations) == ["0001_first", "0002_second"]
    assert order == [1, 2]


def test_a_backward_migration_is_refused(tmp_path):
    path = fresh(tmp_path)
    migrate(path, [Migration("0001_first", 2, add_table("a"))])

    with pytest.raises(MigrationFailed, match="not ahead of"):
        migrate(path, [Migration("0002_backward", 1, add_table("b"))])

    assert "b" not in tables(path)


def test_a_failing_migration_rolls_back_completely(tmp_path):
    path = fresh(tmp_path)

    def half_then_fail(connection):
        connection.execute("CREATE TABLE partial(run_id TEXT)")
        raise RuntimeError("boom")

    with pytest.raises(MigrationFailed, match="rolled back"):
        migrate(path, [Migration("0001_broken", 1, half_then_fail)])

    assert "partial" not in tables(path)
    with sqlite3.connect(path) as connection:
        assert schema_version(connection) == 0
        assert applied_migrations(connection) == set()


VICTIM = """
import sys, time
sys.path.insert(0, {src!r})
from wavedl_daemon.storage.schema import Migration, migrate

def slow(connection):
    connection.execute("CREATE TABLE partial(run_id TEXT)")
    print("mid-migration", flush=True)
    time.sleep(300)

migrate({path!r}, [Migration("0001_slow", 1, slow)])
"""


def test_an_interrupted_migration_leaves_the_database_unchanged(tmp_path):
    """SIGKILL runs no rollback code; SQLite's own recovery must do it."""
    path = fresh(tmp_path)
    victim = subprocess.Popen(
        [
            sys.executable,
            "-c",
            VICTIM.format(src=str(Path("src").resolve()), path=str(path)),
        ],
        stdout=subprocess.PIPE,
        text=True,
    )
    assert victim.stdout.readline().strip() == "mid-migration"
    victim.send_signal(signal.SIGKILL)
    victim.wait()
    time.sleep(0.1)

    assert "partial" not in tables(path)
    with sqlite3.connect(path) as connection:
        assert schema_version(connection) == 0
        assert applied_migrations(connection) == set()


def test_backup_restores_a_completed_migration(tmp_path):
    """The transaction cannot undo a migration that succeeded and was wrong."""
    path = fresh(tmp_path)
    migrate(path, [Migration("0001_regrettable", 1, add_table("regret"))])
    assert "regret" in tables(path)

    restore_backup(path, "0001_regrettable")

    assert "regret" not in tables(path)
    with sqlite3.connect(path) as connection:
        assert schema_version(connection) == 0


def test_restoring_without_a_backup_is_refused(tmp_path):
    with pytest.raises(MigrationFailed, match="no backup"):
        restore_backup(fresh(tmp_path), "0001_never_ran")


def test_read_only_recovery_start_cannot_write(tmp_path):
    """A schema newer than this build is reportable, not writable."""
    path = fresh(tmp_path)
    migrate(path, [Migration("0001_add_tags", 1, add_table("tags"))])

    connection = open_read_only(path)
    try:
        assert schema_version(connection) == 1
        with pytest.raises(sqlite3.OperationalError, match="readonly"):
            connection.execute("CREATE TABLE nope(x INT)")
    finally:
        connection.close()


def test_the_daemon_never_imports_the_gui_database(tmp_path):
    """The legacy table is deleted by T41d, not imported. Enforce it."""
    script = """
import importlib.abc
import sys
class Block(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split(".")[0] in {"wavedl_gui", "PySide6", "torch", "numpy"}:
            raise AssertionError(fullname)
sys.meta_path.insert(0, Block())
from wavedl_daemon.storage import ownership, registry, schema, settings
assert schema.MIGRATIONS == ()
"""
    import os

    result = subprocess.run(
        [sys.executable, "-S", "-c", script],
        env=os.environ | {"PYTHONPATH": str(Path("src").resolve())},
        capture_output=True,
        text=True,
        timeout=15,
    )

    assert result.returncode == 0, result.stderr
```

- [ ] **Step 2: Run the tests and verify the failure**

```bash
PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_schema.py \
  --confcutdir=unit_tests/daemon -v
```

Expected: collection fails with `ModuleNotFoundError: No module named
'wavedl_daemon.storage.schema'`.

- [ ] **Step 3: Write the minimal implementation**

```python
# src/wavedl_daemon/storage/schema.py
"""Forward-only schema migrations for the daemon's own registry.

There is no import from the Qt GUI's database. That table is a video
downloader's schema reached through a music-player template, it has never held a
row, and its only consumer is unreferenced dead code; `T41d` deletes it. This
module exists for the migrations the daemon will need *later*, when its own
schema changes under an installed user.

Crash safety comes from the transaction, not from the backup. SQLite rolls back
DDL and ``PRAGMA user_version`` together, verified: a migration killed midway
leaves the database at its previous version with no partial table. The backup
covers the case a transaction cannot -- a migration that *completed* and is
afterwards found to be wrong -- and gives an operator a restore point.
"""

from __future__ import annotations

import shutil
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING


if TYPE_CHECKING:
    from collections.abc import Callable, Sequence


class MigrationFailed(RuntimeError):
    """A migration did not complete; the database is unchanged."""


_BOOKKEEPING = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    migration_id TEXT PRIMARY KEY,
    to_version   INTEGER NOT NULL,
    applied_at   TEXT NOT NULL DEFAULT (datetime('now'))
)
"""


@dataclass(frozen=True)
class Migration:
    """One forward step. ``migration_id`` is the identity, not the ordering."""

    migration_id: str
    to_version: int
    apply: Callable[[sqlite3.Connection], None]


MIGRATIONS: tuple[Migration, ...] = ()
"""Registered in ascending ``to_version``. Empty until the schema first changes.

Nothing is registered here yet on purpose: the registry's initial schema is
created by ``Registry``, and inventing a migration for it would be bookkeeping
theatre. The runner below is what future changes plug into.
"""


def schema_version(connection: sqlite3.Connection) -> int:
    return int(connection.execute("PRAGMA user_version").fetchone()[0])


def applied_migrations(connection: sqlite3.Connection) -> set[str]:
    connection.execute(_BOOKKEEPING)
    return {
        row[0]
        for row in connection.execute("SELECT migration_id FROM schema_migrations")
    }


def open_read_only(path: Path) -> sqlite3.Connection:
    """Open for recovery without risking a write or an implicit upgrade.

    Used when the schema is newer than this build understands: the daemon can
    still report what it sees instead of refusing to start blind.
    """
    connection = sqlite3.connect(f"file:{Path(path).as_uri()[7:]}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def backup_path(path: Path, migration_id: str) -> Path:
    return Path(f"{path}.backup-{migration_id}")


def migrate(path: Path, migrations: Sequence[Migration] = MIGRATIONS) -> list[str]:
    """Apply every unapplied migration in order. Returns the ids applied.

    Each migration runs in its own transaction together with its bookkeeping
    row and the new ``user_version``, so a migration is applied exactly once
    even if the daemon is killed between two of them.
    """
    path = Path(path)
    connection = sqlite3.connect(path, isolation_level=None)
    applied: list[str] = []
    try:
        seen = applied_migrations(connection)
        for migration in sorted(migrations, key=lambda item: item.to_version):
            if migration.migration_id in seen:
                continue
            if migration.to_version <= schema_version(connection):
                raise MigrationFailed(
                    f"{migration.migration_id} targets version "
                    f"{migration.to_version}, not ahead of "
                    f"{schema_version(connection)}"
                )
            backup = backup_path(path, migration.migration_id)
            connection.execute("PRAGMA wal_checkpoint(FULL)")
            shutil.copy2(path, backup)
            connection.execute("BEGIN IMMEDIATE")
            try:
                migration.apply(connection)
                connection.execute(
                    "INSERT INTO schema_migrations (migration_id, to_version) "
                    "VALUES (?, ?)",
                    (migration.migration_id, migration.to_version),
                )
                connection.execute(f"PRAGMA user_version = {int(migration.to_version)}")
                connection.execute("COMMIT")
            except BaseException as exc:
                connection.execute("ROLLBACK")
                raise MigrationFailed(
                    f"{migration.migration_id} failed and was rolled back: {exc}"
                ) from exc
            applied.append(migration.migration_id)
    finally:
        connection.close()
    return applied


def restore_backup(path: Path, migration_id: str) -> None:
    """Put back the pre-migration database. For a completed, wrong migration."""
    backup = backup_path(path, migration_id)
    if not backup.exists():
        raise MigrationFailed(f"no backup for {migration_id}: {backup}")
    for suffix in ("-wal", "-shm"):
        Path(f"{path}{suffix}").unlink(missing_ok=True)
    shutil.copy2(backup, path)
```

- [ ] **Step 4: Run the tests and verify the pass count**

```bash
PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_schema.py \
  --confcutdir=unit_tests/daemon -v
```

Expected: **9 passed**, no failures or skips.

Run the focused style checks before committing:

```bash
PYTHONPATH=src ruff check --config pyproject.toml \
  src/wavedl_daemon/storage/schema.py unit_tests/daemon/test_schema.py
PYTHONPATH=src ruff format --config pyproject.toml --check \
  src/wavedl_daemon/storage/schema.py unit_tests/daemon/test_schema.py
```

Expected: Ruff reports no violations and both files are already formatted.

- [ ] **Step 5: Commit this task only**

```bash
git add -- \
  src/wavedl_daemon/storage/schema.py \
  unit_tests/daemon/test_schema.py
git commit --only -m "feat(daemon): apply schema migrations exactly once" -- \
  src/wavedl_daemon/storage/schema.py \
  unit_tests/daemon/test_schema.py
```

## Storage and registry completion check

After all four task commits, run this focused combined gate:

```bash
PYTHONPATH=src python3 -m pytest unit_tests/daemon \
  --confcutdir=unit_tests/daemon -v
PYTHONPATH=src ruff check --config pyproject.toml \
  src/wavedl_daemon unit_tests/daemon
PYTHONPATH=src ruff format --config pyproject.toml --check \
  src/wavedl_daemon unit_tests/daemon
```

Expected: **39 passed**, no failures or skips; Ruff check and format check pass.

This is the storage/registry gate only. It does not claim the rest of milestone
1A: backend contracts (T13a), persisted plans and idempotency (T22a), the
reducer (T9), bounded execution (T29a), signal forwarding and the supervisors
(T10, T11, T12), local planning (T13b), or the cross-platform matrix (CI-1).
The Windows lock path in T8b is written but unexercised here; `CI-1` is where it
is validated.
