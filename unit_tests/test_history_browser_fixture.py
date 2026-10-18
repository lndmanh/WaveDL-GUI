"""The 100k browser source is controlled numerical telemetry, not ML claims."""

import hashlib

import pytest

from tools.history_browser_fixture import POINTS, authority, metric
from wavedl.core.journal_writer import JournalWriter
from wavedl.core.layout import RunLayout
from wavedl.core.protocol import decode
from wavedl_daemon.storage.registry import Registry


def test_metric_fixture_matches_all_current_summary_fields():
    payload = metric(POINTS)
    assert payload["step"] == POINTS
    assert payload["value"] == 1
    assert payload["metrics"] == {
        "epoch": POINTS,
        "total_epochs": POINTS,
        "train_loss": 1,
        "val_loss": 2,
        "best_val_loss": 1.00001,
        "r2": 1,
        "pearson": 1,
        "lr": 0.001,
        "grad_norm": 2,
        "mae_avg": 3,
        "epoch_time": 3,
        "total_time": 300_000,
        "patience_counter": 0,
        "max_patience": 10,
        "mae_per_param": [5, 6],
    }


def test_authority_reads_real_committed_journal_and_registry(tmp_path):
    run_id = "00000000-0000-4000-8000-000000000001"
    layout = RunLayout(tmp_path / "runs" / run_id, run_id)
    layout.run_dir.mkdir(parents=True)
    with JournalWriter(layout, fsync_every=2) as writer:
        writer.append("log", {"message": "controlled source"})
        for step in range(1, 4):
            writer.append("metric", metric(step))
    raw = layout.journal(1).read_bytes()
    with Registry(tmp_path / "state/registry.db") as registry:
        registry.apply_events(run_id, 1, [decode(line) for line in raw.splitlines()])
    evidence = authority(tmp_path, run_id)
    assert evidence["journalSha256"] == hashlib.sha256(raw).hexdigest()
    assert evidence["journalEvents"] == 4
    assert evidence["activeMetrics"] == evidence["journalMetrics"] == 3
    assert evidence["eventLogEvents"] == 4
    assert evidence["cursors"] == [(1, 3)]
    assert evidence["lastMetric"]["payload"]["step"] == 3
    journal = layout.journal(1)
    saved = tmp_path / "source.jsonl"
    journal.rename(saved)
    journal.symlink_to(saved)
    with pytest.raises(ValueError, match="bound"):
        authority(tmp_path, run_id)
