import hashlib
import json
import os
import sys
from pathlib import Path

import numpy as np
import pytest

from tools.supersession_browser_fixture import bounded_bytes, source_evidence
from wavedl.core.generations import published_generations
from wavedl.core.layout import RunLayout
from wavedl_daemon.execution.budget import WorkBudget
from wavedl_daemon.execution.commands import run_command
from wavedl_daemon.supervision.base import ProcessSpec


def test_supersession_fixture_requires_verified_published_generation(tmp_path: Path):
    (tmp_path / "standalone").mkdir()
    (tmp_path / "standalone" / "manifest.json").write_text(
        '{"run_id":"00000000-0000-4000-8000-000000000001"}'
    )
    with pytest.raises((FileNotFoundError, ValueError)):
        source_evidence(tmp_path)


def test_source_proof_rejects_unbounded_and_symlink_files(tmp_path: Path):
    source = tmp_path / "source"
    source.write_bytes(b"12345")
    link = tmp_path / "link"
    link.symlink_to(source)
    with pytest.raises(ValueError, match="bounded ordinary"):
        bounded_bytes(source, 4)
    with pytest.raises(ValueError, match="bounded ordinary"):
        bounded_bytes(link)
    parent_link = tmp_path / "parent-link"
    parent_link.symlink_to(tmp_path, target_is_directory=True)
    with pytest.raises(ValueError, match="bounded ordinary"):
        bounded_bytes(parent_link / "source")


def test_source_proof_rejects_linked_standalone_root(tmp_path: Path):
    ordinary = tmp_path / "ordinary"
    ordinary.mkdir()
    (tmp_path / "standalone").symlink_to(ordinary, target_is_directory=True)
    with pytest.raises(ValueError, match="no-follow"):
        source_evidence(tmp_path)


@pytest.mark.integration
def test_genuine_three_epoch_checkpoint_resume_source(tmp_path: Path):
    """Owned bounded CPU launch proves publication and same-run resume bytes."""
    run = tmp_path / "standalone"
    run.mkdir()
    data = tmp_path / "samples.npz"
    inputs = np.random.default_rng(42).normal(size=(96, 32)).astype(np.float32)
    np.savez(data, X=inputs, y=inputs.mean(axis=1).reshape(-1, 1))
    argv = (
        sys.executable,
        "-m",
        "wavedl.launcher",
        "--cpu",
        "--mixed_precision",
        "no",
        "--model",
        "cnn",
        "--data_path",
        str(data),
        "--output_dir",
        str(run),
        "--epochs",
        "3",
        "--workers",
        "0",
        "--batch_size",
        "8",
        "--save_every",
        "1",
    )
    env = dict(os.environ)
    env["PYTHONPATH"] = str(Path(__file__).resolve().parents[1] / "src")
    env["OMP_NUM_THREADS"] = env["MKL_NUM_THREADS"] = "1"
    first = run_command(ProcessSpec(argv, run, env), WorkBudget(timeout_seconds=120))
    assert first.returncode == 0 and not first.timed_out and not first.cancelled
    manifest = json.loads((run / "manifest.json").read_bytes())
    layout = RunLayout(run, manifest["run_id"])
    generation = next(
        item
        for item in published_generations(layout)
        if item.attempt == 1 and item.step == 1
    )
    second = run_command(
        ProcessSpec(argv + ("--resume", str(generation.path)), run, env),
        WorkBudget(timeout_seconds=120),
    )
    assert second.returncode == 0 and not second.timed_out and not second.cancelled
    source = source_evidence(tmp_path)
    assert (
        source["boundary"]["payload"]["source_seq"] == source["selection"]["source_seq"]
    )
    for journal in source["journals"].values():
        raw = journal["raw"].encode()
        assert len(raw) == journal["size"]
        assert hashlib.sha256(raw).hexdigest() == journal["sha256"]
    for name, proof in source["files"].items():
        raw = (run / name).read_bytes()
        assert len(raw) == proof["size"]
        assert hashlib.sha256(raw).hexdigest() == proof["sha256"]
    assert source_evidence(tmp_path) == source
    selection = generation.path / "checkpoint_selection.json"
    selection.write_bytes(b"{}\n")
    with pytest.raises(ValueError, match="resume boundary"):
        source_evidence(tmp_path)
