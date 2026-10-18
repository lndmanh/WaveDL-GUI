"""The browser reconnect fixture reads a genuine committed journal prefix."""

import importlib.util
import json
import sqlite3
import sys
from pathlib import Path

import pytest


def fixture_module():
    tools = Path(__file__).resolve().parents[1] / "tools"
    sys.path.insert(0, str(tools))
    try:
        spec = importlib.util.spec_from_file_location(
            "reconnect_fixture", tools / "browser_reconnect_fixture.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.remove(str(tools))


def seed(root):
    (root / "state").mkdir()
    journal = root / "runs" / "owned" / "attempts/1/events.jsonl"
    journal.parent.mkdir(parents=True)
    event = {"attempt": 1, "seq": 0, "type": "metric", "payload": {"step": 1}}
    journal.write_bytes(json.dumps(event).encode() + b"\n")
    with sqlite3.connect(root / "state/registry.db") as db:
        db.executescript(
            "CREATE TABLE runs(run_id,state);CREATE TABLE plans(plan_id);CREATE TABLE plan_control(plan_id,submission_requested,cancellation_requested);CREATE TABLE execution_control(plan_id);CREATE TABLE event_log(run_id,attempt,seq,event_json);CREATE TABLE cursors(run_id,attempt,seq);"
        )
        db.execute("INSERT INTO runs VALUES ('owned','running')")
        db.execute("INSERT INTO plans VALUES ('plan')")
        db.execute("INSERT INTO plan_control VALUES ('plan',1,0)")
        db.execute("INSERT INTO execution_control VALUES ('plan')")
        db.execute("INSERT INTO event_log VALUES ('owned',1,0,?)", (json.dumps(event),))
        db.execute("INSERT INTO cursors VALUES ('owned',1,0)")
    return journal


def test_accepts_only_complete_committed_prefix(tmp_path):
    journal = seed(tmp_path)
    with journal.open("ab") as stream:
        stream.write(b'{"attempt":1')
    evidence = fixture_module().snapshot(tmp_path)
    assert evidence["eventIds"] == [[1, 0]]
    assert evidence["cursors"] == [[1, 0]]
    assert evidence["journalMatches"] is True


def test_refuses_journal_mismatch(tmp_path):
    journal = seed(tmp_path)
    journal.write_text('{"attempt":1,"seq":9}\n')
    with pytest.raises(ValueError, match="disagree"):
        fixture_module().snapshot(tmp_path)
