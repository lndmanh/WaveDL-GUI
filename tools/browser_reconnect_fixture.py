"""Read-only evidence and genuine seeded local training for reconnect acceptance."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import sqlite3
from pathlib import Path

from browser_daemon_fixture import serve_fixture


def snapshot(root: Path):
    with sqlite3.connect(
        (root / "state/registry.db").resolve().as_uri() + "?mode=ro", uri=True
    ) as db:
        db.row_factory = sqlite3.Row
        db.execute("BEGIN")
        runs = [dict(row) for row in db.execute("SELECT * FROM runs")]
        if len(runs) != 1:
            raise ValueError("Exactly one owned training run required")
        run_id = runs[0]["run_id"]
        rows = db.execute(
            "SELECT event_json FROM event_log WHERE run_id=? ORDER BY attempt,seq",
            (run_id,),
        ).fetchall()
        if not 0 < len(rows) <= 200000:
            raise ValueError("Bounded event evidence required")
        events = [json.loads(row[0]) for row in rows]
        journal = root / "runs" / run_id / "attempts/1/events.jsonl"
        if journal.is_symlink() or journal.stat().st_size > 32 * 1024 * 1024:
            raise ValueError("Bounded ordinary journal required")
        raw = journal.read_bytes()
        producer = [
            json.loads(line) for line in raw[: raw.rfind(b"\n") + 1].splitlines()
        ]
        # The live journal may have an uncommitted tail. Compare the complete
        # durable prefix, not a racing last-record assertion.
        if producer[: len(events)] != events:
            raise ValueError("Journal and committed events disagree")
        return {
            "runId": run_id,
            "runs": [{"run_id": row["run_id"], "state": row["state"]} for row in runs],
            "plans": db.execute("SELECT count(*) FROM plans").fetchone()[0],
            "controls": [
                dict(row)
                for row in db.execute(
                    "SELECT plan_id,submission_requested,cancellation_requested FROM plan_control"
                )
            ],
            "executions": db.execute(
                "SELECT count(*) FROM execution_control"
            ).fetchone()[0],
            "cursors": [
                list(row)
                for row in db.execute(
                    "SELECT attempt,seq FROM cursors WHERE run_id=? ORDER BY attempt",
                    (run_id,),
                )
            ],
            "eventIds": [[event["attempt"], event["seq"]] for event in events],
            "metricSteps": [
                event["payload"]["step"]
                for event in events
                if event["type"] == "metric"
            ],
            "journalMatches": True,
            "prefixSha256": hashlib.sha256(
                json.dumps(events, sort_keys=True).encode()
            ).hexdigest(),
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--token-file", type=Path)
    parser.add_argument("--inspect", action="store_true")
    args = parser.parse_args()
    if args.inspect:
        print(json.dumps(snapshot(args.root)))
    else:
        asyncio.run(
            serve_fixture(
                args.root,
                100000,
                0,
                token_file=args.token_file,
                request_metadata=True,
                record_process_results=True,
            )
        )


if __name__ == "__main__":
    main()
