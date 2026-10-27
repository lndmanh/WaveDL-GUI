"""CV exports retain verified fold identity without inventing a best model."""

import asyncio
import hashlib
import json
import sys
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import pytest


pytest.importorskip("PySide6")
pytest.importorskip("qfluentwidgets")

from wavedl.core.checkpoint_selection import validate_selection_metadata
from wavedl.core.client_transport import ArtifactRef, ClientTransportError
from wavedl_gui.common.constants.index import TrainingConfig
from wavedl_gui.service.daemon_contracts import DaemonConnection, RunRef
from wavedl_gui.service.training_service import TrainingService, TrainingWorker


class CVTransport:
    def __init__(self, *, invalid=None, oversized=False):
        self.blobs = {}
        self.generations = []
        self.downloads = []
        for number, attempt, kind, fold in (
            (1, 1, "cross_validation_fold", 99),
            (2, 2, "cross_validation_fold", 1),
            (3, 2, "cross_validation_fold", 2),
            (4, 2, "cross_validation_summary", None),
            (5, 3, "cross_validation_fold", 100),
        ):
            generation = f"gen-{number:06}"
            metadata = {"schema_version": 1, "kind": kind}
            if fold is not None:
                metadata["fold"] = fold
            if number == 4 and invalid is not None:
                metadata.update(invalid)
            payloads = {
                "checkpoint_selection.json": json.dumps(metadata).encode(),
                "cv_summary.json" if fold is None else "model_weights.pth": (
                    b'{"folds":2}'
                    if fold is None
                    else f"verified payload {number}".encode()
                ),
            }
            self.blobs.update(
                {(generation, name): data for name, data in payloads.items()}
            )
            files = {
                name: {"size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
                for name, data in payloads.items()
            }
            if oversized and number == 2:
                files["model_weights.pth"]["size"] = 512 * 1024**2 + 1
            self.generations.append(
                {"generation": generation, "attempt": attempt, "files": files}
            )

    async def request(self, *args, **kwargs):
        return {"generations": self.generations}

    async def download(self, ref, destination, *, max_bytes):
        assert isinstance(ref, ArtifactRef)
        content = self.blobs[ref.generation, ref.path]
        if (
            ref.size != len(content)
            or ref.sha256 != hashlib.sha256(content).hexdigest()
            or len(content) > max_bytes
        ):
            raise ClientTransportError("Integrity mismatch")
        self.downloads.append(ref)
        Path(destination).write_bytes(content)
        return Path(destination)


def worker_for(tmp_path):
    source = RunRef(
        "daemon-a",
        str(uuid4()),
        str(uuid4()),
        str(uuid4()),
        2,
        "train",
        "/daemon/run",
        "/daemon/data.npz",
    )
    config = TrainingConfig(output_dir=str(tmp_path), data_path=source.data_path, cv=2)
    worker = TrainingWorker(
        config,
        connection=DaemonConnection(
            "http://localhost:8420",
            "/private/token",
            sys.executable,
        ),
    )
    return worker, source


def test_cv_exports_current_verified_folds_and_summary_without_epoch_metrics(tmp_path):
    worker, source = worker_for(tmp_path)
    transport = CVTransport()
    result = asyncio.run(worker._collect_result(transport, source, {}, {"epoch": 99}))
    assert result["cross_validation"] is True
    assert result["trained_run_ref"] == source
    assert "epoch" not in result
    assert set(result["fold_paths"]) == {1, 2}
    assert {Path(path).name for path in result["summary_paths"]} == {
        "checkpoint_selection.json",
        "cv_summary.json",
    }
    assert len(result["artifact_paths"]) == 6
    assert {
        ref.generation
        for ref in transport.downloads
        if ref.path != "checkpoint_selection.json"
    } == {
        "gen-000002",
        "gen-000003",
        "gen-000004",
    }
    assert all(Path(path).is_file() for path in result["artifact_paths"])
    assert not any(ref.generation == "gen-000005" for ref in transport.downloads)


@pytest.mark.parametrize(
    "metadata",
    [
        {"kind": "best", "fold": 1},
        {"kind": "cross_validation_summary", "fold": 1},
        {"kind": "cross_validation_fold", "fold": True},
        {"kind": "cross_validation_fold", "fold": 0},
        {"kind": "cross_validation_fold", "fold": 2**63},
        {"kind": "cross_validation_fold", "fold": 1, "scope": "source"},
        {"kind": "best", "source_seq": True},
    ],
)
def test_metadata_scope_and_fold_identity_are_strict(metadata):
    with pytest.raises(ValueError):
        validate_selection_metadata({"schema_version": 1} | metadata)


def test_cv_export_budget_and_invalid_classification_do_not_fake_failure(tmp_path):
    for transport in (CVTransport(invalid={"fold": 1}), CVTransport(oversized=True)):
        worker, source = worker_for(tmp_path)
        with pytest.raises(ClientTransportError):
            asyncio.run(worker._collect_result(transport, source, {}, {}))
        assert not worker._terminal
        assert not any(ref.path == "model_weights.pth" for ref in transport.downloads)


def test_cv_completion_does_not_dispatch_automatic_plot(tmp_path, monkeypatch):
    worker, source = worker_for(tmp_path)
    result = asyncio.run(worker._collect_result(CVTransport(), source, {}, {}))
    worker.run_ref = source
    worker._on_finished(True, "Completed", result)
    service = TrainingService()
    service._training_worker = worker
    service._current_config = worker.config
    monkeypatch.setattr(
        service,
        "_start_plot_generation",
        lambda *args: pytest.fail("CV has no automatic best checkpoint"),
    )
    service._on_training_finished(True, "Completed")
    assert service._training_worker is None


def test_normal_metadata_source_cursor_remains_supported():
    metadata = {"schema_version": 1, "kind": "best", "source_seq": 0}
    assert validate_selection_metadata(metadata) == metadata


@pytest.mark.parametrize(
    "problem", ["missing_fold", "extra_fold", "wrong_summary", "normal_request"]
)
def test_cv_export_requires_exact_captured_request_fold_set(tmp_path, problem):
    worker, source = worker_for(tmp_path)
    transport = CVTransport()
    if problem == "missing_fold":
        transport.generations = [
            item for item in transport.generations if item["generation"] != "gen-000003"
        ]
    elif problem == "extra_fold":
        transport.generations[0]["attempt"] = 2
    elif problem == "normal_request":
        worker = TrainingWorker(
            TrainingConfig(output_dir=str(tmp_path), data_path=source.data_path, cv=0),
            connection=worker.connection,
        )
    else:
        key = ("gen-000004", "cv_summary.json")
        content = b'{"folds":3}'
        transport.blobs[key] = content
        transport.generations[3]["files"][key[1]] = {
            "size": len(content),
            "sha256": hashlib.sha256(content).hexdigest(),
        }
    with pytest.raises(ClientTransportError):
        asyncio.run(worker._collect_result(transport, source, {}, {}))
    assert not worker._terminal


def test_cv_no_export_keeps_captured_mode_and_source_without_artifact_inspection(
    tmp_path,
):
    worker, source = worker_for(tmp_path)
    worker._snapshot = replace(worker._snapshot, output_directory=None)
    worker.config.cv = 0
    transport = CVTransport()
    result = asyncio.run(worker._collect_result(transport, source, {}, {"epoch": 9}))
    assert result["cross_validation"] is True
    assert result["trained_run_ref"] == source
    assert result["artifact_paths"] == []
    assert "epoch" not in result
    assert transport.downloads == []
