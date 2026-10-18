"""Independent evidence for the real-browser ONNX export subgate."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import sys
from pathlib import Path


def main() -> None:
    root, source_id, source_generation, result_id, generation, artifact, download = (
        Path(sys.argv[1]),
        sys.argv[2],
        sys.argv[3],
        sys.argv[4],
        sys.argv[5],
        sys.argv[6],
        Path(sys.argv[7]),
    )
    db = sqlite3.connect(
        (root / "state" / "registry.db").resolve().as_uri() + "?mode=ro", uri=True
    )
    db.row_factory = sqlite3.Row
    source_path = root / "runs" / source_id / "manifest.json"
    result_manifest_path = root / "runs" / result_id / "manifest.json"
    result_manifest = json.loads(result_manifest_path.read_text())
    assert result_manifest["operation"] == "test"
    assert result_manifest["resolved_config"]["export"] == "onnx"
    assert result_manifest["resolved_config"]["export_opset"] == 17
    assert result_manifest["runtime"]["device"] == "cpu"
    assert result_manifest["checkpoint_source"]["run_id"] == source_id
    assert result_manifest["checkpoint_source"]["generation"] == source_generation
    complete_path = (
        root / "runs" / result_id / "checkpoints" / generation / "COMPLETE.json"
    )
    complete = json.loads(complete_path.read_text())
    identity = complete["files"][artifact]
    published = complete_path.parent / artifact
    body = published.read_bytes()
    digest = hashlib.sha256(body).hexdigest()
    assert {"size": len(body), "sha256": digest} == identity
    downloaded = download.read_bytes()
    browser_identity = {
        "generation": generation,
        "path": artifact,
        "size": len(downloaded),
        "sha256": hashlib.sha256(downloaded).hexdigest(),
    }
    assert downloaded == body
    source_complete_path = (
        root / "runs" / source_id / "checkpoints" / source_generation / "COMPLETE.json"
    )

    def publications(run_id):
        result = []
        for marker in sorted(
            (root / "runs" / run_id / "checkpoints").glob("*/COMPLETE.json")
        ):
            publication = json.loads(marker.read_text())
            verified = {}
            for name, wanted in publication["files"].items():
                content = (marker.parent / name).read_bytes()
                actual = {
                    "size": len(content),
                    "sha256": hashlib.sha256(content).hexdigest(),
                }
                assert actual == wanted
                verified[name] = actual
            result.append(
                {
                    "generation": marker.parent.name,
                    "completeSha256": hashlib.sha256(marker.read_bytes()).hexdigest(),
                    "complete": publication,
                    "verifiedFiles": verified,
                }
            )
        return result

    import onnx
    import onnxruntime as ort

    onnx_model = onnx.load_model_from_string(body)
    onnx.checker.check_model(onnx_model)
    if not any(
        item.domain == "" and item.version == 17 for item in onnx_model.opset_import
    ):
        raise ValueError("Actual ONNX opset differs from approved supported opset 17")
    session = ort.InferenceSession(body, providers=["CPUExecutionProvider"])
    import numpy as np

    from wavedl.test import load_checkpoint, load_data_for_inference

    inputs, _ = load_data_for_inference(str(root / "samples.npz"))
    input_name = session.get_inputs()[0].name
    output = session.run(None, {input_name: inputs[:1].numpy().astype(np.float32)})
    assert output and all(np.isfinite(value).all() for value in output)
    import torch

    model, scaler = load_checkpoint(
        str(source_complete_path.parent), tuple(inputs.shape[2:]), 1, None
    )
    model.eval()
    with torch.no_grad():
        expected = scaler.inverse_transform(model(inputs[:1]).numpy())
    assert output[0].shape == expected.shape
    assert np.allclose(output[0], expected, rtol=1e-4, atol=1e-5)
    events = [
        json.loads(line)
        for line in (root / "runs" / result_id / "attempts" / "1" / "events.jsonl")
        .read_text()
        .splitlines()
    ]
    exit_event = next(event for event in reversed(events) if event["type"] == "exit")
    assert exit_event["payload"]["status"] == "completed"
    hello = next(event for event in events if event["type"] == "hello")
    assert hello["payload"]["device"] == "cpu"
    plans = []
    for row in db.execute(
        "SELECT p.plan_id,p.plan_json,pc.submission_requested,pc.cancellation_requested FROM plans p JOIN plan_control pc ON pc.plan_id=p.plan_id ORDER BY p.plan_id"
    ):
        value = dict(row)
        value["manifest"] = json.loads(
            json.loads(value.pop("plan_json"))["manifest_json"]
        )
        plans.append(value)
    durable_runs = []
    for run_id in (source_id, result_id):
        durable_runs.append(
            {
                "runId": run_id,
                "state": db.execute(
                    "SELECT state FROM runs WHERE run_id=?", (run_id,)
                ).fetchone()[0],
                "publications": publications(run_id),
            }
        )
    print(
        json.dumps(
            {
                "sourceManifestSha256": hashlib.sha256(
                    source_path.read_bytes()
                ).hexdigest(),
                "resultManifestSha256": hashlib.sha256(
                    result_manifest_path.read_bytes()
                ).hexdigest(),
                "sourceRunId": source_id,
                "sourceGeneration": source_generation,
                "resultRunId": result_id,
                "publication": {
                    "generation": generation,
                    "completeSha256": hashlib.sha256(
                        complete_path.read_bytes()
                    ).hexdigest(),
                    "identity": identity,
                },
                "plans": plans,
                "runs": durable_runs,
                "sourceCompleteSha256": hashlib.sha256(
                    source_complete_path.read_bytes()
                ).hexdigest(),
                "artifact": browser_identity,
                "onnx": {
                    "checker": "passed",
                    "provider": "CPUExecutionProvider",
                    "providers": session.get_providers(),
                    "inputName": input_name,
                    "outputCount": len(output),
                    "outputShape": list(output[0].shape),
                    "sourceOutputShape": list(expected.shape),
                    "allclose": True,
                    "finite": True,
                    "opsets": [
                        {"domain": item.domain, "version": item.version}
                        for item in onnx_model.opset_import
                    ],
                    "rtol": 1e-4,
                    "atol": 1e-5,
                    "comparedWithSource": True,
                    "maxAbsoluteDifference": float(
                        np.max(np.abs(output[0] - expected))
                    ),
                },
                "hello": hello,
                "events": events,
                "exit": exit_event,
            }
        )
    )


if __name__ == "__main__":
    main()
