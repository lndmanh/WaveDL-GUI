"""Read-only independent publication, CV fold identity and prediction byte evidence."""

from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import sqlite3
import sys
from pathlib import Path


def publication_evidence(root: Path, run_id: str) -> list[dict]:
    manifest_hash = hashlib.sha256(
        (root / "runs" / run_id / "manifest.json").read_bytes()
    ).hexdigest()
    items = []
    for marker in sorted(
        (root / "runs" / run_id / "checkpoints").glob("*/COMPLETE.json")
    ):
        complete = json.loads(marker.read_text())
        assert complete["run_id"] == run_id
        assert complete["manifest_sha256"] == manifest_hash
        verified_files = {}
        for name, expected in complete["files"].items():
            assert not Path(name).is_absolute() and ".." not in Path(name).parts
            body = (marker.parent / name).read_bytes()
            assert {
                "size": len(body),
                "sha256": hashlib.sha256(body).hexdigest(),
            } == expected
            verified_files[name] = expected
        classification_path = marker.parent / "checkpoint_selection.json"
        items.append(
            {
                "generation": marker.parent.name,
                "complete": complete,
                "completeText": marker.read_text(),
                "completeSha256": hashlib.sha256(marker.read_bytes()).hexdigest(),
                "verifiedFiles": verified_files,
                "classification": json.loads(classification_path.read_text())
                if classification_path.exists()
                else None,
                "classificationText": classification_path.read_text()
                if classification_path.exists()
                else None,
            }
        )
    return items


def main() -> None:
    root = Path(sys.argv[1])
    source_id, source_generation, result_id, generation, artifact = sys.argv[2:7]
    download = Path(sys.argv[7])
    source = publication_evidence(root, source_id)
    assert len(source) == 3
    kinds = [item["classification"]["kind"] for item in source]
    assert kinds.count("cross_validation_fold") == 2
    assert kinds.count("cross_validation_summary") == 1
    folds = sorted(
        item["classification"]["fold"]
        for item in source
        if item["classification"]["kind"] == "cross_validation_fold"
    )
    assert folds == [1, 2]
    selected = next(item for item in source if item["generation"] == source_generation)
    assert selected["classification"]["kind"] == "cross_validation_fold"
    assert selected["classification"]["fold"] == 2
    summary = next(
        item
        for item in source
        if item["classification"]["kind"] == "cross_validation_summary"
    )
    summary_bytes = (
        root
        / "runs"
        / source_id
        / "checkpoints"
        / summary["generation"]
        / "cv_summary.json"
    ).read_bytes()
    assert {
        "size": len(summary_bytes),
        "sha256": hashlib.sha256(summary_bytes).hexdigest(),
    } == summary["complete"]["files"]["cv_summary.json"]
    summary_body = json.loads(summary_bytes)
    assert summary_body["folds"] == 2
    assert [item["fold"] for item in summary_body["fold_results"]] == [1, 2]
    result = publication_evidence(root, result_id)
    chosen = next(item for item in result if item["generation"] == generation)
    expected = chosen["complete"]["files"][artifact]
    actual = (
        root / "runs" / result_id / "checkpoints" / generation / artifact
    ).read_bytes()
    assert actual == download.read_bytes()
    assert artifact == "predictions.csv"
    rows = list(csv.reader(io.StringIO(actual.decode())))
    assert rows[0] == ["True_P0", "Pred_P0", "Error_P0", "AbsError_P0"]
    assert len(rows) == 97
    assert all(
        len(row) == 4 and all(math.isfinite(float(value)) for value in row)
        for row in rows[1:]
    )
    manifest = json.loads((root / "runs" / result_id / "manifest.json").read_text())
    assert manifest["checkpoint_source"]["generation"] == source_generation
    assert manifest["checkpoint_source"]["run_id"] == source_id
    assert manifest["operation"] == "test" and manifest["runtime"]["device"] == "cpu"
    assert manifest["resolved_config"]["save_predictions"] is True
    events = [
        json.loads(line)
        for line in (root / "runs" / result_id / "attempts" / "1" / "events.jsonl")
        .read_text()
        .splitlines()
    ]
    assert (
        next(event for event in reversed(events) if event["type"] == "exit")["payload"][
            "status"
        ]
        == "completed"
    )
    db = sqlite3.connect(
        (root / "state" / "registry.db").resolve().as_uri() + "?mode=ro", uri=True
    )
    db.row_factory = sqlite3.Row
    plans = []
    for row in db.execute(
        "SELECT p.plan_id,p.plan_json,c.submission_requested,c.cancellation_requested,e.state,e.latest_observation_json,e.observation_json FROM plans p JOIN plan_control c ON c.plan_id=p.plan_id JOIN execution_control e ON e.plan_id=p.plan_id"
    ):
        item = dict(row)
        item["manifest"] = json.loads(
            json.loads(item.pop("plan_json"))["manifest_json"]
        )
        plans.append(item)
    assert len(plans) == 2
    print(
        json.dumps(
            {
                "sourcePublications": source,
                "resultPublications": result,
                "selectedFold": selected["classification"]["fold"],
                "summary": summary_body,
                "summaryText": summary_bytes.decode(),
                "durablePlans": plans,
                "predictionHeader": rows[0],
                "predictionText": actual.decode(),
                "resultManifest": manifest,
                "sourceManifestText": (
                    root / "runs" / source_id / "manifest.json"
                ).read_text(),
                "resultManifestText": (
                    root / "runs" / result_id / "manifest.json"
                ).read_text(),
                "sourceManifestSha256": hashlib.sha256(
                    (root / "runs" / source_id / "manifest.json").read_bytes()
                ).hexdigest(),
                "resultManifestSha256": hashlib.sha256(
                    (root / "runs" / result_id / "manifest.json").read_bytes()
                ).hexdigest(),
                "resultEvents": [
                    event
                    for event in events
                    if event["type"] in ("hello", "metric", "exit")
                ],
                "predictionRows": len(rows) - 1,
                "artifact": {"generation": generation, "path": artifact, **expected},
            }
        )
    )


if __name__ == "__main__":
    main()
