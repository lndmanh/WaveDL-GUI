"""Browser fixture import/runtime scratch state never pollutes report parents."""

import asyncio
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

from tools.browser_daemon_fixture import fixture_temporary_storage


def test_owned_temporary_storage_replaces_cached_parent_and_restores(
    tmp_path, monkeypatch
):
    root = tmp_path / "owned"
    root.mkdir(mode=0o700)
    for key in ("TMPDIR", "TEMP", "TMP"):
        monkeypatch.setenv(key, str(tmp_path))
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    with (
        pytest.raises(RuntimeError, match="controlled failure"),
        fixture_temporary_storage(root) as scratch,
    ):
        assert scratch == root / ".runtime-tmp"
        assert tempfile.gettempdir() == str(scratch)
        assert {os.environ[key] for key in ("TMPDIR", "TEMP", "TMP")} == {str(scratch)}
        with tempfile.TemporaryDirectory(suffix="wandb-artifacts") as created:
            assert Path(created).parent == scratch
        raise RuntimeError("controlled failure")
    assert tempfile.tempdir == str(tmp_path)
    assert {os.environ[key] for key in ("TMPDIR", "TEMP", "TMP")} == {str(tmp_path)}
    assert set(tmp_path.iterdir()) == {root}


def test_fixture_temporary_storage_rejects_nonempty_root_without_mutation(tmp_path):
    sentinel = tmp_path / "keep"
    sentinel.write_bytes(b"private existing data")
    before = dict(os.environ), tempfile.tempdir
    with (
        pytest.raises(ValueError, match="dedicated empty"),
        fixture_temporary_storage(tmp_path),
    ):
        pytest.fail("Existing files must never be accepted as fixture storage")
    assert sentinel.read_bytes() == b"private existing data"
    assert set(tmp_path.iterdir()) == {sentinel}
    assert (dict(os.environ), tempfile.tempdir) == before


def test_fixture_temporary_storage_restores_unset_environment(tmp_path, monkeypatch):
    for key in ("TMPDIR", "TEMP", "TMP"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(tempfile, "tempdir", None)
    with fixture_temporary_storage(tmp_path):
        assert tempfile.gettempdir() == str(tmp_path / ".runtime-tmp")
    assert all(key not in os.environ for key in ("TMPDIR", "TEMP", "TMP"))
    assert tempfile.tempdir is None


@pytest.mark.parametrize("fails", [False, True])
def test_serve_fixture_restores_temporary_scope_on_exit(tmp_path, monkeypatch, fails):
    from tools import browser_daemon_fixture as fixture

    before = {key: os.environ.get(key) for key in ("TMPDIR", "TEMP", "TMP")}
    cached = tempfile.tempdir
    calls = []

    async def serve(root, epochs, port):
        calls.append((root, epochs, port))
        assert tempfile.gettempdir() == str(root / ".runtime-tmp")
        if fails:
            raise RuntimeError("fixture shutdown failure")

    monkeypatch.setattr(fixture, "_serve_fixture", serve)
    if fails:
        with pytest.raises(RuntimeError, match="fixture shutdown failure"):
            asyncio.run(fixture.serve_fixture(tmp_path, 1, 0))
    else:
        asyncio.run(fixture.serve_fixture(tmp_path, 1, 0))
    assert calls == [(tmp_path, 1, 0)]
    assert {key: os.environ.get(key) for key in before} == before
    assert tempfile.tempdir == cached


def test_fixture_temporary_storage_rejects_symlink_root(tmp_path):
    target = tmp_path / "target"
    target.mkdir(mode=0o700)
    link = tmp_path / "link"
    try:
        link.symlink_to(target, target_is_directory=True)
    except OSError as error:
        if os.name == "nt" and getattr(error, "winerror", None) == 1314:
            pytest.skip("Windows symlink privilege unavailable")
        raise
    with (
        pytest.raises(ValueError, match="dedicated empty"),
        fixture_temporary_storage(link),
    ):
        pytest.fail("Symlink roots must not grant fixture write authority")
    assert not list(target.iterdir())


def test_abrupt_wandb_import_temporary_files_stay_under_owned_root(tmp_path):
    if importlib.util.find_spec("wandb") is None:
        pytest.skip("Optional real W&B import witness requires installed W&B")
    root = tmp_path / "owned"
    root.mkdir(mode=0o700)
    script = """
import json, os, sys, tempfile
from pathlib import Path
from tools.browser_daemon_fixture import fixture_temporary_storage
assert tempfile.gettempdir() == str(Path(sys.argv[1]))
with fixture_temporary_storage(Path(sys.argv[2])) as scratch:
    import wandb
    entries = sorted(path.name for path in scratch.iterdir())
    assert any(name.endswith('wandb-artifacts') for name in entries), entries
    assert any(name.endswith('wandb-media') for name in entries), entries
    print(json.dumps({'scratch': str(scratch), 'entries': entries}), flush=True)
    os._exit(73)
"""
    repo = Path(__file__).resolve().parents[2]
    result = subprocess.run(
        [sys.executable, "-c", script, str(tmp_path), str(root)],
        cwd=repo,
        env=os.environ
        | {
            "PYTHONPATH": str(repo / "src"),
            "TMPDIR": str(tmp_path),
            "TEMP": str(tmp_path),
            "TMP": str(tmp_path),
        },
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 73, result.stderr
    proof = json.loads(result.stdout)
    assert proof["scratch"] == str(root / ".runtime-tmp")
    assert set(tmp_path.iterdir()) == {root}
    assert {path.name for path in (root / ".runtime-tmp").iterdir()} == set(
        proof["entries"]
    )
