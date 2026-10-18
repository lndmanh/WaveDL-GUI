"""Real fixture publications exercise partial sources without response mocks."""

import importlib.util
import json
import sqlite3
import sys
from pathlib import Path

import pytest

from wavedl.core.generations import publish_generation, published_generations
from wavedl.core.layout import OperationKind, RunLayout, allocate_attempt
from wavedl.core.manifest import RuntimeSelection, build_manifest, write_manifest


@pytest.fixture(scope="module")
def fixture_module():
    path = Path(__file__).resolve().parents[1] / "tools/browser_daemon_fixture.py"
    spec = importlib.util.spec_from_file_location("partial_best_fixture", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def source_run(root, state="completed"):
    run_id = "11111111-1111-4111-8111-111111111111"
    layout = RunLayout.create(root / "runs", run_id)
    write_manifest(
        layout,
        build_manifest(
            layout,
            operation=OperationKind.TRAIN,
            resolved_config={},
            runtime=RuntimeSelection(sys.executable, "existing", "cpu", {}),
            submission_cwd=root,
        ),
    )
    attempt = allocate_attempt(layout)
    staging = root / "real-source"
    staging.mkdir()
    for name in ("model.safetensors", "training_meta.pkl", "scaler.pkl"):
        (staging / name).write_bytes(b"original immutable publication")
    (staging / "checkpoint_selection.json").write_text(
        json.dumps({"schema_version": 1, "kind": "best", "source_seq": 7})
    )
    original = publish_generation(layout, staging, attempt=attempt, step=3)
    (root / "state").mkdir()
    with sqlite3.connect(root / "state/registry.db") as db:
        db.execute("CREATE TABLE runs (run_id TEXT, state TEXT)")
        db.execute("INSERT INTO runs VALUES (?,?)", (run_id, state))
    return layout, original


@pytest.mark.parametrize("mode", ["fallback", "refusal"])
def test_partial_publication_is_real_and_preserves_original_bytes(
    fixture_module, tmp_path, mode
):
    layout, original = source_run(tmp_path)
    before = {p.name: p.read_bytes() for p in original.path.iterdir()}
    proof = fixture_module.publish_partial_best_fault(tmp_path, layout.run_id, mode)
    visible = published_generations(layout)
    partial = next(p for p in visible if p.generation == proof["partialGeneration"])
    assert set(partial.files) == {"checkpoint_selection.json"}
    assert partial.attempt == original.attempt
    assert int(partial.generation[4:]) > int(original.generation[4:])
    assert proof["olderCompleteBest"] == original.generation
    preserved = (
        original.path
        if mode == "fallback"
        else tmp_path / ".partial-best-quarantine" / original.generation
    )
    assert {p.name: p.read_bytes() for p in preserved.iterdir()} == before
    assert len(visible) == (2 if mode == "fallback" else 1)
    assert json.loads((tmp_path / ".partial-best-proof.json").read_text()) == proof


def test_running_source_is_never_mutated(fixture_module, tmp_path):
    layout, original = source_run(tmp_path, "running")
    with pytest.raises(ValueError, match="completed"):
        fixture_module.publish_partial_best_fault(tmp_path, layout.run_id, "refusal")
    assert [p.generation for p in published_generations(layout)] == [
        original.generation
    ]
    assert not (tmp_path / ".partial-best-staging").exists()


def test_invalid_fault_mode_cannot_mutate_files(fixture_module, tmp_path):
    with pytest.raises(ValueError, match="Invalid partial"):
        fixture_module.publish_partial_best_fault(tmp_path, "invalid", "other")
    assert not list(tmp_path.iterdir())
