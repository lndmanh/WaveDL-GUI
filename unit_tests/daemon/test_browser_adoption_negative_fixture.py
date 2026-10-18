"""Fault preparation verifies genuine standalone lineage before targeted changes."""

import importlib
import os
import sys
from pathlib import Path

import pytest

from wavedl.core.events import HelloPayload
from wavedl.core.generations import publish_generation
from wavedl.core.manifest import RuntimeSelection
from wavedl.journal import RunJournal, bootstrap_run


def test_negative_copies_change_only_target_provenance(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).parents[2] / "tools"))
    fixture = importlib.import_module("browser_adoption_negative_fixture")
    run = tmp_path / "standalone"
    run.mkdir(mode=0o700)
    bootstrap = bootstrap_run(
        run,
        resolved_config={},
        runtime=RuntimeSelection(sys.executable, "existing", "cpu", {}),
        environment={},
    )
    with RunJournal(
        bootstrap,
        hello=HelloPayload(1, 1, "actual", "3.11", "cpu", ["train"], sys.executable),
    ) as journal:
        journal.emit("exit", {"status": "completed", "code": 0})
    staging = tmp_path / "staging"
    staging.mkdir()
    (staging / "checkpoint.bin").write_bytes(b"genuine-publication")
    bootstrap.layout.checkpoints.mkdir()
    publish_generation(bootstrap.layout, staging, attempt=1, step=0)
    original = fixture.files(run)
    prepared = fixture.prepare(tmp_path)
    assert fixture.files(run) == original
    assert len(prepared["cases"]) == 3
    member = "attempts/1/runtime_identity.json"
    for case in prepared["cases"]:
        assert case["validBeforeFault"]
        prior, changed = dict(case["beforeFault"]), dict(case["faulted"])
        before = prior.pop(member)
        after = changed.pop(member, None)
        assert prior == changed
        assert before != after
        if case["mode"] == "missing-provenance":
            assert after is None


@pytest.mark.skipif(
    os.name == "nt", reason="POSIX symlink fixture; native Windows separate"
)
def test_negative_snapshot_refuses_symlink(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).parents[2] / "tools"))
    fixture = importlib.import_module("browser_adoption_negative_fixture")
    (tmp_path / "real").write_bytes(b"evidence")
    (tmp_path / "link").symlink_to(tmp_path / "real")
    with pytest.raises(ValueError, match="symlink"):
        fixture.files(tmp_path)
