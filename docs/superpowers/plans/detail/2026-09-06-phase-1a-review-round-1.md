# Phase 1A detail — review round 1

**Date:** 2026-09-06
**Subject:** [Phase 1A shared contracts](2026-09-06-phase-1a-contracts.md)
**Reviewer verdict:** not ready to implement as written — six findings
**Outcome:** five defects confirmed by execution and fixed; one open decision

## How this round was run

The detail was written by Codex against the [settled structure](../2026-09-06-daemon-migration-structure.md),
then reviewed three ways at once:

| Reviewer | Method | Findings |
|---|---|---|
| Harness | extracts every fenced block whose first line names its path, materialises a scratch tree, runs pytest | **0** — 109/109 green |
| Targeted probes | scripted behaviour checks against the extracted tree | **0** new |
| Independent read | a fresh Codex context reading the document against the contract | **6** |

The harness result is the lesson of this round. 109 green tests were evidence
that the code *runs*, not that it is correct: every defect below sat inside a
fully passing suite. Execution and reading find different classes of defect, and
this round the reading pass carried it.

Each finding was then reproduced against the extracted tree before being
accepted, and each fix was red-checked — the fix reverted, the new test
confirmed failing — before being accepted as done.

## Findings

### 1. Shared package boundary — OPEN, needs a decision

The reviewer reads the corrected boundary as a separate top-level `src/wavedl_core/`
and treats the delivered `wavedl.core` plus a lazy `wavedl/__init__.py` as a
deviation that expands a protocol task into a public-API change.

Measured, the lazy-export approach works and is faster:

| | import cost | heavy packages pulled |
|---|---|---|
| current `wavedl/__init__.py` | 4.31 s | 7 |
| lazy `__getattr__` (PEP 562) | 0.023 s | 0 |

422 existing tests still pass under it. The technical objection does not hold;
the *scope* objection does — a task delivering the protocol envelope should not
quietly rewrite the shipping package's `__init__`. Resolution is to split that
change into its own task with its own review, not to add a second package.
**Deferred to the user.**

### 2. Interpreter symlink dereferenced — CONFIRMED, fixed

`build_manifest` passed `runtime.python` through `Path.resolve()`. A virtualenv's
`bin/python` is a symlink to the base interpreter, so resolving it selects a
different runtime:

```
selected interpreter : <tmp>/venv/bin/python
after .resolve()     : /opt/homebrew/Cellar/python@3.11/.../bin/python3.11
sys.prefix via venv path     : <tmp>/venv
sys.prefix via resolved path : /opt/homebrew/opt/python@3.11/...
```

The venv's `site-packages` — torch, wavedl, every pinned dependency — disappears,
and the manifest records a runtime that was never selected. The existing test
hid this by using a nonexistent relative path, where `resolve()` is a no-op.

**Fix:** `resolve_interpreter` normalises lexically (`os.path.normpath`) and maps
through the storage map, but never dereferences. Data paths keep `resolve()`.

### 3. Publication rejected under a storage map — CONFIRMED, fixed

`_manifest_digest` compared `layout.run_dir` against `manifest.run_directory`.
Under a storage map those are two different paths for the same run by design:
`run_directory` is where the daemon sees it, `working_directory` where the
compute node does. Every checkpoint publication on the execution side failed:

```
run_directory   (host) : .../home/user/runs/<id>
working_directory(exec): .../scratch/runs/<id>
publish_generation raised ValueError: Manifest/layout identity mismatch
```

This breaks the HPC/SLURM target completely — one of the four required
deployment targets.

**Fix:** a shared `describes_layout(manifest, layout)` predicate accepting either
side of a mapping, with both sides normalised so that `/var` and `/private/var`
spellings of one directory compare equal. A foreign manifest is still rejected.

### 4. Replay floor lost on seek — CONFIRMED, fixed

`seek_to_seq` at the visible end of the journal called `_reset(...)`, which set
`_last_seq = -1`, discarding the cursor. Seeking to 5 in a journal holding only
`seq 0`, then appending `[2, 5, 6]`:

```
read() returned [2, 5, 6]
expected        [6]
```

Earlier probes missed this because they used static files. The defect only
appears when records arrive *after* the seek — the live-tailing case that is the
reader's whole purpose.

**Fix:** `_reset` takes a `last_seq` floor, and both seek return sites pass the
cursor. A record at or below the cursor arriving afterwards now raises
`ProtocolError("Sequence must increase within an attempt")`, consistent with the
single-writer append-only contract, rather than being silently re-delivered.

### 5. Numeric conversion escaped the error boundary — CONFIRMED, fixed

CPython caps int/str conversion at `sys.get_int_max_str_digits()` (4300 by
default, CVE-2020-10735). An oversized integer literal made `int()` raise a bare
`ValueError` — neither `JSONDecodeError` nor `UnicodeError` — which escaped
`strict_loads` uncaught. The probe written to test this crashed while
*constructing* its own input, which demonstrated the finding more directly than
running it would have.

**Fix:** `parse_int=_bounded_int` for a precise message, plus a
`(ArithmeticError, ValueError)` safety net covering the rest of the numeric
surface. `ProtocolError` is re-raised first so classified errors keep their type.
Either mechanism alone covers the known case; the test is red only when both are
removed.

### 6. NumPy scalars not sanitised — CONFIRMED, fixed

The shared sanitiser used `isinstance(value, float)`, which is not the same test
the repo already relies on:

```
np.float64 is a subclass of float: True
np.float32 is a subclass of float: False
```

So `np.float32("nan")` passed through untouched and then failed at encode with
"Object of type float32 is not JSON serializable". This would break
`unit_tests/test_metrics_json.py::test_numpy_non_finite_becomes_none`.

**Fix:** dispatch on the `numbers` ABCs. NumPy registers its scalar types there
on import, so `np.float32`, `np.float64` and `np.int32` are all caught without
importing NumPy into the contracts package — and when NumPy is absent there are
no NumPy values for the check to miss. `bool` is handled before `Integral` so it
is not widened to `0`/`1`.

## Result

| | before | after |
|---|---|---|
| tests in the detail | 109 | 118 |
| ruff check / format | pass | pass |
| findings open | 6 | 1 (the package-boundary decision) |
