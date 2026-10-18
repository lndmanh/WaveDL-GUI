"""Read-only trusted owned CPU-run artifacts for epoch browser acceptance."""

import csv
import hashlib
import json
import os
import pickle
import sqlite3
import sys
from pathlib import Path

from browser_numerical_failure_fixture import evidence


def collect(root):
    result = evidence(root)
    for run in result["runs"]:
        directory = root / "runs" / run["run_id"]
        run["checkpointMetadata"] = {}
        for path in sorted(directory.glob("*_checkpoint/training_meta.pkl")):
            # Files are produced by this owned explicit CPU plan, never user input.
            with path.open("rb") as stream:
                metadata = pickle.load(stream)
            run["checkpointMetadata"][path.parent.name] = {
                key: metadata[key]
                for key in ("best_val_loss", "patience_ctr", "epoch")
                if key in metadata
            }
        for publication in run["publications"]:
            path = (
                directory
                / "checkpoints"
                / publication["generation"]
                / "training_meta.pkl"
            )
            with path.open("rb") as stream:
                metadata = pickle.load(stream)
            publication["trainingMetadata"] = {
                key: metadata[key] for key in ("epoch", "best_val_loss", "patience_ctr")
            }
        history = directory / "training_history.csv"
        with history.open() as stream:
            run["history"] = list(csv.DictReader(stream))
        process = json.loads((root / ".epoch-process.json").read_text())
        run["consoleMetrics"] = [
            json.loads(line.split("##METRICS##", 1)[1])
            for line in process["stdout"].splitlines()
            if "##METRICS##" in line
        ]
        run["completionFlag"] = (directory / "training_complete.flag").read_text()
        with sqlite3.connect(
            (root / "state/registry.db").resolve().as_uri() + "?mode=ro", uri=True
        ) as db:
            rows = db.execute(
                "SELECT seq,metrics_json FROM metric_history WHERE run_id=? AND active=1 ORDER BY step",
                (run["run_id"],),
            ).fetchall()
        current = json.loads(rows[-1][1])
        current["source_seq"] = rows[-1][0]
        run["projection"] = {"current": current, "rows": rows}
        journal_bytes = (directory / "attempts/1/events.jsonl").read_bytes()
        run["runtimeJournalRaw"] = journal_bytes.decode("utf-8")
        run["runtimeJournalSha256"] = hashlib.sha256(journal_bytes).hexdigest()
    result["authoring"] = json.loads((root / ".epoch-authoring.json").read_text())
    result["boundary"] = [
        json.loads(line)
        for line in (root / ".epoch-wire.jsonl").read_text().splitlines()
    ]
    plan = result["plans"][0]
    result["planId"] = plan["plan_id"]
    result["requestId"] = plan["request_id"]
    model_path = result["authoring"]["request"]["config"]["import_modules"][0]
    process = json.loads((root / ".epoch-process.json").read_text())
    # This attests unchanged owned source, not production TOCTOU pinning.
    assert model_path in process["stdout"] or model_path in process["stderr"]
    result["importedModelPath"] = model_path
    result["importedModelSha256"] = result["authoring"]["modelSha256"]
    result["modelSha256Postflight"] = hashlib.sha256(
        Path(model_path).read_bytes()
    ).hexdigest()
    try:
        os.kill(process["pid"], 0)
        process["pidAbsent"] = False
    except ProcessLookupError:
        process["pidAbsent"] = True
    result["process"] = process
    mutations = root / ".epoch-mutations.jsonl"
    result["mutations"] = (
        [json.loads(line) for line in mutations.read_text().splitlines()]
        if mutations.exists()
        else []
    )
    return result


if __name__ == "__main__":
    print(json.dumps(collect(Path(sys.argv[1]))))
