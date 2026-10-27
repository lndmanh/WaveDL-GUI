"""Qt-free parity, immutable retry snapshots and explicit remote path authority."""

import json
import subprocess
import sys
from dataclasses import FrozenInstanceError, asdict, dataclass, fields, replace
from pathlib import Path
from uuid import uuid4

import pytest

from wavedl.core.training_cli import build_training_parser, training_defaults
from wavedl_gui.common.constants.index import (
    TestConfig as InferenceConfig,
    TrainingConfig,
)
from wavedl_gui.service.daemon_contracts import (
    TEST_FIELDS,
    TRAINING_FIELDS,
    ApprovedStorageMapping,
    DaemonConnection,
    PathSelectionRef,
    RequestContractError,
    RunRef,
    build_plot_request,
    build_test_request,
    build_training_request,
    inspect_to_data_info,
)


def connection(**changes):
    return DaemonConnection(
        "http://localhost:8420",
        Path("/private/user/token"),
        changes.pop("python", sys.executable),
        **changes,
    )


def training(**changes):
    return TrainingConfig(
        data_path="/data/train.npz", output_dir="/client/export", **changes
    )


def reference(daemon_id="daemon-a"):
    return RunRef(
        daemon_id,
        str(uuid4()),
        str(uuid4()),
        str(uuid4()),
        1,
        "train",
        "/daemon/runs/owned-uuid",
        "/daemon/data/train.npz",
    )


def test_import_and_request_construction_are_qt_ml_and_credential_io_free():
    program = "from wavedl_gui.service.daemon_contracts import DaemonConnection, build_training_request; from wavedl_gui.common.constants.index import TrainingConfig; import sys; c=DaemonConnection('http://localhost:8420','/does/not/exist',sys.executable); build_training_request(TrainingConfig(data_path='/data/file.npz'), c); assert not any(name.startswith(('torch','PySide6','qfluentwidgets')) for name in sys.modules)"
    result = subprocess.run(
        [sys.executable, "-c", program],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    assert result.returncode == 0, result.stderr


def test_every_current_gui_dataclass_field_has_an_explicit_adapter_disposition():
    assert {item.name for item in fields(TrainingConfig)} == TRAINING_FIELDS
    assert {item.name for item in fields(InferenceConfig)} == TEST_FIELDS
    config = training()
    snapshot = build_training_request(config, connection())
    posted = snapshot.payload["config"]
    removed = {"output_dir", "no_cache", "num_gpus", "mixed_precision"}
    optional_empty = {name for name, value in asdict(config).items() if value == ""}
    assert set(posted) == TRAINING_FIELDS - removed - optional_empty
    assert snapshot.output_directory == config.output_dir
    assert snapshot.payload["topology"]["processes_per_machine"] == config.num_gpus
    assert snapshot.payload["runtime"]["mode"] == "selected"


def test_snapshot_freezes_configuration_environment_and_retry_payload_copies():
    environment = {"WANDB_API_KEY": "raw-private-token"}
    profile = connection(environment=environment)
    config = training(epochs=7, no_cache=True)
    original_yaml = config.to_dict()
    snapshot = build_training_request(config, profile)
    config.epochs = 9
    environment["WANDB_API_KEY"] = "changed"
    first = snapshot.payload
    first["config"]["epochs"] = 99
    first["runtime"]["environment"]["WANDB_API_KEY"] = "changed-again"
    assert snapshot.payload["config"]["epochs"] == 7
    assert (
        snapshot.payload["runtime"]["environment"]["WANDB_API_KEY"]
        == "raw-private-token"
    )
    assert "raw-private-token" not in repr(snapshot)
    assert "raw-private-token" not in repr(profile)
    assert "raw-private-token" not in json.dumps(snapshot.metadata)
    assert len(snapshot.metadata["payload_sha256"]) == 64
    assert "isolated caches" in snapshot.warnings[0]
    assert "no_cache" not in snapshot.payload["config"]
    assert snapshot.payload["config"]["fresh"] is False
    # Neither adapter changes the user's legacy export representation.
    config.epochs = 7
    assert config.to_dict() == original_yaml
    with pytest.raises(TypeError):
        profile.environment["WANDB_API_KEY"] = "mutation"
    with pytest.raises(FrozenInstanceError):
        snapshot.warnings = ()


def test_training_cli_scalar_types_not_guessed_into_lists():
    config = training(
        loss_weights="1,2",
        betas="0.8,0.99",
        milestones="10,20",
        resume="/daemon/generation",
        grad_accum_steps=3,
    )
    profile = connection()
    snapshot = build_training_request(config, profile)
    values = snapshot.payload["config"]
    parser = build_training_parser()
    defaults = training_defaults()
    for name in ("loss_weights", "betas", "milestones"):
        action = next(action for action in parser._actions if action.dest == name)
        assert action.type is str
        assert type(values[name]) is str
        assert name in defaults
    assert values["grad_accum_steps"] == 3 and values["resume"] == "/daemon/generation"
    assert "output_dir" not in values


def test_legacy_precision_alias_and_true_conflicts_are_explicit():
    snapshot = build_training_request(training(precision="no"), connection())
    assert snapshot.payload["config"]["precision"] == "no"
    assert "Legacy default mixed_precision" in snapshot.warnings[0]
    with pytest.raises(RequestContractError, match="Conflicting"):
        build_training_request(
            training(precision="fp16", mixed_precision="no"), connection()
        )
    assert not build_training_request(
        training(precision="fp16", mixed_precision="fp16"), connection()
    ).warnings


@pytest.mark.parametrize(
    "changes",
    [
        {"epochs": True},
        {"loss": "invalid"},
        {"num_gpus": 0},
        {"num_gpus": True},
        {"loss_weights": [1, 2]},
        {"no_cache": "yes"},
    ],
)
def test_invalid_typed_training_values_refused(changes):
    with pytest.raises(RequestContractError):
        build_training_request(training(**changes), connection())


def test_dataclass_schema_extension_cannot_silently_drop_new_fields():
    @dataclass
    class NewTrainingConfig(TrainingConfig):
        unsupported_new_option: int = 1

    with pytest.raises(RequestContractError, match="explicit adapter"):
        build_training_request(
            NewTrainingConfig(data_path="/data/file.npz"), connection()
        )


def test_remote_loopback_forwarding_never_proves_local_path_authority():
    profile = connection(path_realm="remote", daemon_id="daemon-a")
    config = training(resume="/daemon/gen-000001")
    with pytest.raises(RequestContractError, match="daemon-side"):
        build_training_request(config, profile)
    data = PathSelectionRef(config.data_path, "daemon", "daemon-a")
    with pytest.raises(RequestContractError, match="daemon-side"):
        build_training_request(config, profile, data_selection=data)
    resumed = PathSelectionRef(config.resume, "daemon", "daemon-a")
    snapshot = build_training_request(
        config, profile, data_selection=data, resume_selection=resumed
    )
    assert snapshot.payload["config"]["resume"] == config.resume
    with pytest.raises(RequestContractError, match="another daemon"):
        build_training_request(
            config,
            profile,
            data_selection=replace(data, daemon_id="daemon-b"),
            resume_selection=resumed,
        )
    with pytest.raises(RequestContractError):
        build_training_request(
            config,
            profile,
            data_selection=replace(data, realm="local"),
            resume_selection=resumed,
        )


def test_same_host_profile_accepts_absolute_user_paths_without_io(tmp_path):
    config = training()
    config.output_dir = str(tmp_path / "exports")
    profile = connection()
    snapshot = build_training_request(config, profile)
    assert snapshot.payload["config"]["data_path"] == config.data_path
    assert not (tmp_path / "exports").exists()
    assert not tmp_path.joinpath("created").exists()


@pytest.mark.parametrize(
    "variable", ["WAVEDL_RUN_ID", "SLURM_JOB_ID", "RANK", "SBATCH_PARTITION"]
)
def test_explicit_environment_cannot_override_identity(variable):
    with pytest.raises(RequestContractError):
        connection(environment={variable: "value"})


def test_test_and_export_paths_are_daemon_inputs_and_client_preferences():
    config = InferenceConfig(
        checkpoint="/daemon/gen",
        data_path="/daemon/data.npz",
        output_dir="/client/reports",
        export_format="onnx",
        export_path="/client/model.onnx",
    )
    snapshot = build_test_request(config, connection(device="cuda"))
    assert snapshot.payload["config"]["export"] == "onnx"
    assert snapshot.payload["runtime"]["device"] == "cuda"
    assert snapshot.output_directory == config.output_dir
    assert snapshot.export_path == config.export_path
    assert "export_path" not in snapshot.payload["config"]
    assert "output_dir" not in snapshot.payload["config"]
    assert "input_key" not in snapshot.payload["config"]
    assert "param_names" not in snapshot.payload["config"]


def test_plot_uses_approved_training_run_not_client_output_or_changed_dataset():
    run_ref = reference()
    config = training(workers=-1)
    config.data_path = "/client/changed-data.npz"
    profile = connection(path_realm="remote", daemon_id=run_ref.daemon_id)
    snapshot = build_plot_request(config, run_ref, profile)
    assert snapshot.payload["config"]["checkpoint"] == run_ref.run_directory
    assert snapshot.payload["config"]["data_path"] == run_ref.data_path
    assert snapshot.payload["config"]["workers"] == 0
    assert snapshot.output_directory == config.output_dir
    with pytest.raises(RequestContractError):
        build_plot_request(config, run_ref, replace(profile, daemon_id="different"))


def test_approved_plan_constructs_minimal_frozen_run_reference():
    run_ref = reference()
    preview = {
        "plan_id": run_ref.plan_id,
        "run_id": run_ref.run_id,
        "request_id": run_ref.request_id,
        "preview": {
            "manifest_json": json.dumps(
                {
                    "run_id": run_ref.run_id,
                    "operation": "train",
                    "run_directory": run_ref.run_directory,
                    "resolved_config": {"data_path": run_ref.data_path},
                    "runtime": {"environment": {"SECRET": "private"}},
                }
            )
        },
    }
    restored = RunRef.from_preview(run_ref.daemon_id, preview, attempt=1)
    assert restored == run_ref
    assert "private" not in repr(restored)
    assert "private" not in json.dumps(asdict(restored))
    preview["run_id"] = str(uuid4())
    with pytest.raises(RequestContractError):
        RunRef.from_preview("daemon-a", preview)


def test_credential_is_read_only_by_explicit_worker_method(monkeypatch):
    calls = []
    monkeypatch.setattr(
        "wavedl_gui.service.daemon_contracts.read_credential",
        lambda path: calls.append(path) or "private-token",
    )
    profile = connection()
    build_training_request(training(), profile)
    assert calls == []
    assert profile.read_credential() == "private-token"
    assert calls == [profile.credential_file]


def test_inspection_adapter_uses_only_declared_metadata_never_invents_file_bytes():
    metadata = {
        "schema_version": 1,
        "format": "npz",
        "variables": [
            {
                "name": "X",
                "shape": [20, 32],
                "dtype": "float32",
                "sample_count": 20,
                "declared_bytes": 2560,
            },
            {
                "name": "y",
                "shape": [20, 1],
                "dtype": "float32",
                "sample_count": 20,
                "declared_bytes": 80,
            },
        ],
    }
    info = inspect_to_data_info(metadata, PathSelectionRef("/daemon/data.npz"))
    assert info.file_size is None
    assert info.num_samples == 20
    assert info.input_shape == (20, 32) and info.output_shape == (20, 1)
    assert info.input_dtype == info.output_dtype == "float32"
    assert info.path == "/daemon/data.npz"
    metadata["variables"][1]["sample_count"] = 2
    with pytest.raises(RequestContractError):
        inspect_to_data_info(metadata, PathSelectionRef("/daemon/data.npz"))


def test_remote_paths_use_server_platform_not_client_filesystem():
    profile = connection(
        path_realm="remote",
        backend="slurm",
        server_platform="posix",
        python="/venv/bin/python",
    )
    config = training()
    config.data_path = "/cluster/data.npz"
    snapshot = build_training_request(
        config, profile, data_selection=PathSelectionRef(config.data_path)
    )
    assert snapshot.payload["runtime"]["python"] == "/venv/bin/python"
    assert snapshot.payload["config"]["data_path"] == "/cluster/data.npz"
    config.data_path = r"C:\client\data.npz"
    with pytest.raises(RequestContractError, match="POSIX"):
        build_training_request(
            config, profile, data_selection=PathSelectionRef(config.data_path)
        )
    windows = connection(
        path_realm="remote", server_platform="windows", python=r"C:\Python\python.exe"
    )
    assert (
        build_training_request(
            config, windows, data_selection=PathSelectionRef(config.data_path)
        ).payload["config"]["data_path"]
        == config.data_path
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"format": "invalid"},
        {"workers": True},
        {"plot": "yes"},
        {"param_names": [1]},
        {"plot_format": "png"},
    ],
)
def test_inference_configuration_uses_shared_parser_types(changes):
    config = InferenceConfig(
        checkpoint="/daemon/gen", data_path="/daemon/data.npz", **changes
    )
    with pytest.raises(RequestContractError):
        build_test_request(config, connection())


def test_empty_credentials_configuration_is_refused_without_io():
    with pytest.raises(RequestContractError, match="credential"):
        DaemonConnection("http://localhost:8420", "", sys.executable)


def test_remote_browse_selection_binds_snapshot_when_connection_identity_is_unknown():
    profile = connection(path_realm="remote")
    config = training(resume="/daemon/gen")
    data = PathSelectionRef(config.data_path, "daemon", "daemon-a")
    resumed = PathSelectionRef(config.resume, "daemon", "daemon-a")
    snapshot = build_training_request(
        config, profile, data_selection=data, resume_selection=resumed
    )
    assert snapshot.expected_daemon_id == "daemon-a"
    assert snapshot.metadata["expected_daemon_id"] == "daemon-a"
    assert "expected_daemon_id" not in snapshot.payload
    with pytest.raises(RequestContractError, match="different daemons"):
        build_training_request(
            config,
            profile,
            data_selection=data,
            resume_selection=replace(resumed, daemon_id="daemon-b"),
        )


def test_inference_checkpoint_and_dataset_must_share_frozen_daemon_identity():
    profile = connection(path_realm="remote")
    config = InferenceConfig(checkpoint="/daemon/gen", data_path="/daemon/data.npz")
    data = PathSelectionRef(config.data_path, "daemon", "daemon-a")
    checkpoint = PathSelectionRef(config.checkpoint, "daemon", "daemon-a")
    assert (
        build_test_request(
            config, profile, data_selection=data, checkpoint_selection=checkpoint
        ).expected_daemon_id
        == "daemon-a"
    )
    with pytest.raises(RequestContractError, match="different daemons"):
        build_test_request(
            config,
            profile,
            data_selection=data,
            checkpoint_selection=replace(checkpoint, daemon_id="daemon-b"),
        )


def test_plot_source_daemon_is_frozen_before_planning_a_new_plot_run():
    profile = connection(path_realm="remote")
    snapshot = build_plot_request(training(), reference("training-daemon"), profile)
    assert snapshot.expected_daemon_id == "training-daemon"
    assert snapshot.metadata["expected_daemon_id"] == "training-daemon"
    assert snapshot.payload["config"]["checkpoint"] == "/daemon/runs/owned-uuid"


def mapped_preview():
    source = reference()
    return {
        "plan_id": source.plan_id,
        "run_id": source.run_id,
        "request_id": source.request_id,
        "preview": {
            "target": "slurm",
            "topology": {
                "num_machines": 2,
                "processes_per_machine": 4,
                "machine_rank": 0,
            },
            "manifest_json": json.dumps(
                {
                    "run_id": source.run_id,
                    "operation": "train",
                    "run_directory": "/host/runs/uuid",
                    "working_directory": "/exec/runs/uuid",
                    "resolved_config": {"data_path": "/exec/data/train.npz"},
                    "storage_map": [{"host_root": "/host", "execution_root": "/exec"}],
                    "runtime": {
                        "python": "/venv/python",
                        "device": "cuda",
                        "environment": {"API_SECRET": "never-copy-token"},
                    },
                }
            ),
        },
    }


def test_mapped_source_preview_survives_plot_roundtrip_without_secret_copy(tmp_path):
    from wavedl.core.layout import OperationKind, RunLayout
    from wavedl.core.manifest import RuntimeSelection, StorageMapping, build_manifest

    source = RunRef.from_preview("daemon-a", mapped_preview(), attempt=1)
    profile = connection(backend="slurm", path_realm="remote", python="/venv/python")
    snapshot = build_plot_request(training(), source, profile)
    payload = snapshot.payload
    assert source.backend == "slurm" and source.working_directory == "/exec/runs/uuid"
    assert payload["config"]["checkpoint"] == "/host/runs/uuid"
    assert payload["config"]["data_path"] == "/host/data/train.npz"
    assert payload["storage_map"] == [{"host_root": "/host", "execution_root": "/exec"}]
    assert payload["topology"] == {
        "num_machines": 1,
        "processes_per_machine": 1,
        "machine_rank": 0,
    }
    assert payload["runtime"]["device"] == "cpu"
    assert "never-copy-token" not in json.dumps(asdict(source))
    assert "never-copy-token" not in json.dumps(snapshot.metadata)
    mapped = build_manifest(
        RunLayout(tmp_path / "new-run", str(uuid4())),
        operation=OperationKind.PLOT,
        resolved_config=payload["config"],
        runtime=RuntimeSelection("/venv/python", "selected", "cpu", {}),
        submission_cwd=tmp_path,
        storage_map=tuple(StorageMapping(**item) for item in payload["storage_map"]),
    )
    assert mapped.resolved_config["checkpoint"] == "/exec/runs/uuid"
    assert mapped.resolved_config["data_path"] == "/exec/data/train.npz"
    edited = snapshot.payload
    edited["storage_map"][0]["host_root"] = "/foreign"
    assert snapshot.payload["storage_map"][0]["host_root"] == "/host"
    with pytest.raises(FrozenInstanceError):
        source.storage_map[0].host_root = "/foreign"


def test_overlapping_mapping_uses_longest_prefix_once():
    source = replace(
        reference(),
        run_directory="/host/runs/uuid",
        data_path="/host/shared/data.npz",
        storage_map=(
            ApprovedStorageMapping("/host", "/exec"),
            ApprovedStorageMapping("/host/data", "/host/shared"),
        ),
        working_directory="/exec/runs/uuid",
        backend="slurm",
    )
    payload = build_plot_request(
        training(), source, connection(backend="slurm")
    ).payload
    assert payload["config"]["data_path"] == "/host/data/data.npz"
    assert payload["config"]["checkpoint"] == "/host/runs/uuid"


def test_ambiguous_inverse_map_and_foreign_working_directory_fail_closed():
    with pytest.raises(RequestContractError, match="mapping differs"):
        replace(
            reference(),
            storage_map=(ApprovedStorageMapping("/daemon", "/execution"),),
            working_directory="/foreign/run",
        )
    source = replace(
        reference(),
        data_path="/exec/file.npz",
        storage_map=(
            ApprovedStorageMapping("/host-a", "/exec"),
            ApprovedStorageMapping("/host-b", "/exec"),
        ),
    )
    with pytest.raises(RequestContractError, match="Ambiguous"):
        build_plot_request(training(), source, connection())
    with pytest.raises(RequestContractError, match="Duplicate"):
        replace(
            reference(),
            storage_map=(
                ApprovedStorageMapping("/host", "/exec-a"),
                ApprovedStorageMapping("/host/", "/exec-b"),
            ),
        )


def test_test_source_map_is_preserved_only_for_an_approved_contained_checkpoint():
    source = RunRef.from_preview("daemon-a", mapped_preview(), attempt=1)
    profile = connection(backend="slurm", path_realm="remote")
    config = InferenceConfig(
        checkpoint="/host/runs/uuid/checkpoints/gen-000001",
        data_path="/host/data/test.npz",
    )
    data = PathSelectionRef(config.data_path, "daemon", "daemon-a")
    payload = build_test_request(
        config, profile, data_selection=data, checkpoint_run_ref=source
    ).payload
    assert payload["storage_map"] == [{"host_root": "/host", "execution_root": "/exec"}]
    config.checkpoint = "/foreign/checkpoints/gen-000001"
    with pytest.raises(RequestContractError, match="source run"):
        build_test_request(
            config, profile, data_selection=data, checkpoint_run_ref=source
        )
    with pytest.raises(RequestContractError, match="backend"):
        build_plot_request(training(), source, connection(backend="local"))


@pytest.mark.parametrize(
    "variable",
    [
        "wavedl_run_id",
        "slurm_job_id",
        "Rank",
        "local_world_size",
        "Master_Port",
        "scancel_signal",
    ],
)
def test_reserved_environment_checks_match_case_insensitive_backend_semantics(variable):
    with pytest.raises(RequestContractError):
        connection(environment={variable: "value"})
    with pytest.raises(RequestContractError):
        connection(backend="slurm", environment={"cuda_visible_devices": "0"})


def test_explicit_client_export_requires_export_format_and_frozen_local_path(
    tmp_path, monkeypatch
):
    config = InferenceConfig(
        checkpoint="/daemon/gen", data_path="/daemon/data.npz", export_path="model.onnx"
    )
    with pytest.raises(RequestContractError, match="requires ONNX"):
        build_test_request(config, connection())
    config.export_format = "onnx"
    monkeypatch.chdir(tmp_path)
    snapshot = build_test_request(config, connection())
    assert snapshot.export_path == str(tmp_path / "model.onnx")
    assert snapshot.output_directory == ""
    assert snapshot.payload["config"]["export"] == "onnx"
    assert "export_path" not in snapshot.payload["config"]
    assert not (tmp_path / "model.onnx").exists()
    config.export_path = "changed.onnx"
    assert snapshot.export_path == str(tmp_path / "model.onnx")
