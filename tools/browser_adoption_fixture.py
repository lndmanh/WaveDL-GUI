"""Dedicated real adoption fixture and bounded immutable source evidence.

The ASGI app is the real create_app application from browser_daemon_fixture.
Only its first successful adoption acknowledgement is lost after registration.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import sqlite3
from pathlib import Path


def digest(path: Path, limit=64 * 1024 * 1024) -> dict:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > limit:
        raise ValueError("Source evidence must be a bounded ordinary file")
    raw = path.read_bytes()
    return {"size": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def source_evidence(root: Path) -> dict:
    run = root / "standalone"
    manifest = json.loads((run / "manifest.json").read_bytes())
    request = json.loads((run / "attempts/1/runtime_request.json").read_bytes())
    identity = json.loads((run / "attempts/1/runtime_identity.json").read_bytes())
    journal = [
        json.loads(line)
        for line in (run / "attempts/1/events.jsonl").read_bytes().splitlines()
    ]
    assert identity["run_id"] == manifest["run_id"] == request["run_id"]
    assert identity["attempt"] == 1 and journal[-1]["type"] == "exit"
    assert journal[-1]["payload"]["status"] == "completed"
    names = [
        "manifest.json",
        "attempts/1/runtime_request.json",
        "attempts/1/runtime_identity.json",
        "attempts/1/events.jsonl",
    ]
    checkpoints = []
    for marker in sorted((run / "checkpoints").glob("*/COMPLETE.json")):
        complete = json.loads(marker.read_bytes())
        assert complete["run_id"] == manifest["run_id"] and complete["attempt"] == 1
        assert complete["manifest_sha256"] == digest(run / "manifest.json")["sha256"]
        for name, entry in complete["files"].items():
            assert Path(name).name == name and name not in {".", ".."}
            assert digest(marker.parent / name) == entry
            names.append(str((marker.parent / name).relative_to(run)))
        names.append(str(marker.relative_to(run)))
        checkpoints.append(complete)
    assert checkpoints
    return {
        "runId": manifest["run_id"],
        "requestId": identity["request_id"],
        "attempt": 1,
        "manifest": manifest,
        "runtimeRequest": request,
        "runtimeIdentity": identity,
        "journalExit": journal[-1],
        "files": {name: digest(run / name) for name in sorted(names)},
        "checkpoints": checkpoints,
    }


def registry_evidence(root: Path, run_id: str) -> dict:
    connection = sqlite3.connect(
        (root / "state/registry.db").resolve().as_uri() + "?mode=ro", uri=True
    )
    connection.row_factory = sqlite3.Row
    try:
        rows = list(
            connection.execute(
                "SELECT p.*,c.submission_requested,c.cancellation_requested FROM plans p JOIN plan_control c USING(plan_id) WHERE json_extract(json_extract(p.plan_json,'$.manifest_json'),'$.run_id')=?",
                (run_id,),
            )
        )
        assert len(rows) == 1
        plan = dict(rows[0])
        execution = dict(
            connection.execute(
                "SELECT * FROM execution_control WHERE plan_id=?", (plan["plan_id"],)
            ).fetchone()
        )
        submission = connection.execute(
            "SELECT * FROM submission_control WHERE plan_id=?", (plan["plan_id"],)
        ).fetchone()
        return {
            "plan": plan,
            "execution": execution,
            "submission": dict(submission) if submission else None,
        }
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--token-file", type=Path)
    parser.add_argument("--inspect", action="store_true")
    args = parser.parse_args()
    if args.inspect:
        source = source_evidence(args.root)
        print(
            json.dumps(
                {
                    "source": source,
                    "registry": registry_evidence(args.root, source["runId"]),
                }
            )
        )
        return
    if args.token_file is None:
        parser.error("A private credential file outside the browse root is required")
    from browser_daemon_fixture import serve_fixture

    asyncio.run(
        serve_fixture(
            args.root,
            1,
            0,
            seed_run=False,
            token_file=args.token_file,
            standalone_adoption=True,
            drop_adoption_ack=True,
        )
    )


if __name__ == "__main__":
    main()
