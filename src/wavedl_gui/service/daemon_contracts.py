"""Immutable, Qt-free GUI request/path contracts for the daemon boundary.

No construction reads credentials, imports ML packages, or resolves client paths
against the filesystem. User export preferences never become daemon output paths.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from dataclasses import asdict, dataclass, field, fields, is_dataclass
from pathlib import Path, PurePosixPath, PureWindowsPath
from types import MappingProxyType
from typing import TYPE_CHECKING
from uuid import UUID

from wavedl.core.credentials import read_credential
from wavedl.core.inference_cli import build_inference_parser, validate_import_modules
from wavedl.core.live_push import LivePushConfig
from wavedl.core.training_cli import build_training_parser


if TYPE_CHECKING:
    from collections.abc import Mapping

    from wavedl_gui.common.constants.index import TestConfig, TrainingConfig


class RequestContractError(ValueError):
    """A GUI option cannot be represented safely in the approved daemon schema."""


def _text(value, *, empty=False):
    if (
        type(value) is not str
        or (not empty and not value)
        or len(value) > 8192
        or "\0" in value
    ):
        raise RequestContractError("Invalid request text")
    return value


def _absolute(value):
    _text(value)
    if not (PurePosixPath(value).is_absolute() or PureWindowsPath(value).is_absolute()):
        raise RequestContractError("A daemon-side absolute path is required")
    return value


def _identity(value):
    try:
        valid = type(value) is str and str(UUID(value)) == value
    except ValueError:
        valid = False
    if not valid:
        raise RequestContractError("A canonical run identity is required")


@dataclass(frozen=True)
class DaemonConnection:
    url: str
    credential_file: Path = field(repr=False)
    python: str
    backend: str = "local"
    device: str = "cpu"
    path_realm: str = "same_host"
    environment: Mapping[str, str] = field(default_factory=dict, repr=False)
    daemon_id: str | None = None
    server_platform: str | None = None

    def __post_init__(self):
        LivePushConfig(self.url, "connection-validation")
        if self.credential_file is None or str(self.credential_file) in {"", ".", ".."}:
            raise RequestContractError("Select a private credential file")
        object.__setattr__(self, "credential_file", Path(self.credential_file))
        _absolute(self.python)
        if (
            self.backend not in {"local", "slurm"}
            or self.device not in {"cpu", "cuda", "auto", "mps"}
            or self.path_realm not in {"same_host", "remote"}
        ):
            raise RequestContractError("Invalid daemon connection profile")
        if self.daemon_id is not None:
            _text(self.daemon_id)
        if self.server_platform not in {None, "posix", "windows"} or (
            self.backend == "slurm" and self.server_platform == "windows"
        ):
            raise RequestContractError("Invalid daemon platform")
        _server_path(self.python, self)
        values = dict(self.environment)
        if len(values) > 128:
            raise RequestContractError("Too many explicit environment overrides")
        for key, value in values.items():
            if (
                type(key) is not str
                or re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key) is None
                or key.upper().startswith(
                    (
                        "WAVEDL_",
                        "SLURM_",
                        "SRUN_",
                        "SBATCH_",
                        "SCANCEL_",
                        "SQUEUE_",
                        "SACCT_",
                        "SCONTROL_",
                    )
                )
                or key.upper()
                in {
                    "RANK",
                    "LOCAL_RANK",
                    "WORLD_SIZE",
                    "LOCAL_WORLD_SIZE",
                    "GROUP_RANK",
                    "ROLE_RANK",
                    "ROLE_WORLD_SIZE",
                    "MASTER_ADDR",
                    "MASTER_PORT",
                }
            ):
                raise RequestContractError(
                    "Environment cannot override execution identity"
                )
            _text(value, empty=True)
        if self.backend == "slurm" and any(
            key.upper() == "CUDA_VISIBLE_DEVICES" for key in values
        ):
            raise RequestContractError(
                "CUDA visibility belongs to the Slurm allocation"
            )
        object.__setattr__(self, "environment", MappingProxyType(values))

    def read_credential(self) -> str:
        """Explicit worker-only IO; never call during UI construction/serialization."""
        return read_credential(self.credential_file)


@dataclass(frozen=True)
class PathSelectionRef:
    path: str
    realm: str = "daemon"
    daemon_id: str | None = None
    browse_root: str | None = None
    browse_path: str | None = None

    def __post_init__(self):
        _absolute(self.path)
        if self.realm not in {"daemon", "local"}:
            raise RequestContractError("Invalid path selection realm")
        if self.daemon_id is not None:
            _text(self.daemon_id)
        if (self.browse_root is None) != (self.browse_path is None):
            raise RequestContractError("Incomplete browse selection")
        if self.browse_root is not None:
            _text(self.browse_root)
            _text(self.browse_path, empty=True)
            path = PurePosixPath(self.browse_path)
            if path.is_absolute() or ".." in path.parts or "\\" in self.browse_path:
                raise RequestContractError("Invalid browse-relative path")


def _pure_path(value):
    _absolute(value)
    path = (
        PurePosixPath(value)
        if PurePosixPath(value).is_absolute()
        else PureWindowsPath(value)
    )
    if ".." in path.parts:
        raise RequestContractError("Approved paths must be normalized")
    return path


@dataclass(frozen=True)
class ApprovedStorageMapping:
    host_root: str
    execution_root: str

    def __post_init__(self):
        host, execution = _pure_path(self.host_root), _pure_path(self.execution_root)
        if type(host) is not type(execution):
            raise RequestContractError("Storage mapping path platforms differ")


def _validate_mappings(mappings):
    if (
        type(mappings) is not tuple
        or len(mappings) > 32
        or any(not isinstance(item, ApprovedStorageMapping) for item in mappings)
    ):
        raise RequestContractError("Invalid approved storage map")
    if len({_pure_path(item.host_root) for item in mappings}) != len(mappings):
        raise RequestContractError("Duplicate approved storage roots")


def _mapped_path(value, mappings, *, inverse=False):
    """Mirror the core longest-host-prefix rule without client filesystem IO."""
    path = _pure_path(value)
    matches = []
    for mapping in mappings:
        source = _pure_path(mapping.execution_root if inverse else mapping.host_root)
        target = _pure_path(mapping.host_root if inverse else mapping.execution_root)
        try:
            relative = path.relative_to(source)
        except ValueError:
            continue
        matches.append((len(str(source)), str(target / relative)))
    if not matches:
        return value
    best = max(length for length, _ in matches)
    candidates = {candidate for length, candidate in matches if length == best}
    if len(candidates) != 1:
        raise RequestContractError("Ambiguous inverse storage mapping")
    result = candidates.pop()
    if inverse and _pure_path(_mapped_path(result, mappings)) != path:
        raise RequestContractError("Inverse storage mapping does not round trip")
    return result


@dataclass(frozen=True)
class RunRef:
    daemon_id: str
    plan_id: str
    run_id: str
    request_id: str
    attempt: int | None
    operation: str
    run_directory: str
    data_path: str
    storage_map: tuple[ApprovedStorageMapping, ...] = ()
    working_directory: str = ""
    backend: str | None = None
    import_modules: tuple[str, ...] = ()
    checkpoint_generation: str | None = None

    def __post_init__(self):
        _text(self.daemon_id)
        for value in (self.plan_id, self.run_id, self.request_id):
            _identity(value)
        if self.attempt is not None and (
            type(self.attempt) is not int or self.attempt < 1
        ):
            raise RequestContractError("Invalid run attempt")
        if self.operation not in {"train", "test", "plot"}:
            raise RequestContractError("Invalid run operation")
        _absolute(self.run_directory)
        _absolute(self.data_path)
        _validate_mappings(self.storage_map)
        if type(self.import_modules) is not tuple:
            raise RequestContractError("Invalid approved registration modules")
        try:
            validate_import_modules(list(self.import_modules))
        except ValueError:
            raise RequestContractError(
                "Invalid approved registration modules"
            ) from None
        if self.checkpoint_generation is not None and (
            self.operation != "train"
            or type(self.checkpoint_generation) is not str
            or re.fullmatch(r"gen-\d{6,}", self.checkpoint_generation) is None
            or len(self.checkpoint_generation) > 64
        ):
            raise RequestContractError("Invalid approved checkpoint generation")
        if self.backend not in {None, "local", "slurm"}:
            raise RequestContractError("Invalid approved backend")
        if self.working_directory:
            _pure_path(self.working_directory)
            if _pure_path(
                _mapped_path(self.run_directory, self.storage_map)
            ) != _pure_path(self.working_directory):
                raise RequestContractError("Approved run directory mapping differs")

    @classmethod
    def from_preview(
        cls, daemon_id: str, preview: dict, *, attempt: int | None = None
    ) -> RunRef:
        try:
            manifest = json.loads(preview["preview"]["manifest_json"])
            if manifest["run_id"] != preview["run_id"]:
                raise RequestContractError("Preview run identity differs")
            mappings = manifest.get("storage_map", [])
            if (
                type(mappings) is not list
                or len(mappings) > 32
                or any(
                    type(item) is not dict
                    or set(item) != {"host_root", "execution_root"}
                    for item in mappings
                )
            ):
                raise RequestContractError("Invalid approved storage map")
            return cls(
                daemon_id,
                preview["plan_id"],
                preview["run_id"],
                preview["request_id"],
                attempt,
                manifest["operation"],
                manifest["run_directory"],
                manifest["resolved_config"]["data_path"],
                tuple(ApprovedStorageMapping(**item) for item in mappings),
                manifest.get("working_directory", ""),
                preview["preview"].get("target"),
                tuple(
                    validate_import_modules(
                        manifest["resolved_config"].get("import_modules", [])
                    )
                ),
            )
        except (KeyError, TypeError, ValueError):
            raise RequestContractError("Invalid approved plan response") from None


@dataclass(frozen=True)
class RequestSnapshot:
    _canonical_json: str = field(repr=False)
    warnings: tuple[str, ...] = ()
    output_directory: str = field(default="", repr=False)
    export_path: str = field(default="", repr=False)
    expected_daemon_id: str | None = None

    @property
    def payload(self) -> dict:
        return json.loads(self._canonical_json)

    @property
    def metadata(self) -> dict:
        return {
            "payload_sha256": hashlib.sha256(self._canonical_json.encode()).hexdigest(),
            "warnings": list(self.warnings),
            "expected_daemon_id": self.expected_daemon_id,
        }


TRAINING_FIELDS = frozenset(
    {
        "data_path",
        "output_dir",
        "model",
        "pretrained",
        "batch_size",
        "lr",
        "epochs",
        "patience",
        "weight_decay",
        "grad_clip",
        "grad_accum_steps",
        "loss",
        "huber_delta",
        "loss_weights",
        "optimizer",
        "momentum",
        "nesterov",
        "betas",
        "scheduler",
        "scheduler_patience",
        "scheduler_factor",
        "min_lr",
        "warmup_epochs",
        "step_size",
        "milestones",
        "precision",
        "compile",
        "deterministic",
        "seed",
        "workers",
        "cache_validate",
        "single_channel",
        "no_cache",
        "cv",
        "cv_stratify",
        "cv_bins",
        "resume",
        "save_every",
        "fresh",
        "wandb",
        "num_gpus",
        "mixed_precision",
    }
)
TEST_FIELDS = frozenset(
    {
        "checkpoint",
        "data_path",
        "model",
        "format",
        "input_key",
        "output_key",
        "param_names",
        "batch_size",
        "workers",
        "output_dir",
        "save_predictions",
        "plot",
        "plot_format",
        "export_format",
        "export_path",
    }
)


def _config(config, expected):
    if (
        not is_dataclass(config)
        or isinstance(config, type)
        or {item.name for item in fields(config)} != expected
    ):
        raise RequestContractError(
            "GUI configuration fields require an explicit adapter"
        )
    return asdict(config)


def _path(value, connection, selection):
    _server_path(value, connection)
    if selection is not None:
        if not isinstance(selection, PathSelectionRef) or selection.path != value:
            raise RequestContractError("Path selection differs from configuration")
        if (
            selection.daemon_id is not None
            and connection.daemon_id is not None
            and selection.daemon_id != connection.daemon_id
        ):
            raise RequestContractError("Path belongs to another daemon")
    if connection.path_realm == "remote" and (
        selection is None or selection.realm != "daemon"
    ):
        raise RequestContractError(
            "Remote execution requires an explicit daemon-side path selection"
        )
    return value


def _expected_daemon(connection, *references):
    identities = {connection.daemon_id} if connection.daemon_id is not None else set()
    for reference in references:
        if reference is not None and reference.daemon_id is not None:
            identities.add(reference.daemon_id)
    if len(identities) > 1:
        raise RequestContractError("Selected paths belong to different daemons")
    return next(iter(identities), None)


def _server_path(value, connection):
    _absolute(value)
    platform = "posix" if connection.backend == "slurm" else connection.server_platform
    if platform == "posix" and not PurePosixPath(value).is_absolute():
        raise RequestContractError("Path does not belong to the POSIX daemon")
    if platform == "windows" and not PureWindowsPath(value).is_absolute():
        raise RequestContractError("Path does not belong to the Windows daemon")
    return value


def _parser_values(config, parser):
    actions = {action.dest: action for action in parser._actions}
    for name, value in config.items():
        action = actions[name]
        if isinstance(action, argparse._StoreTrueAction):
            if type(value) is not bool:
                raise RequestContractError("Training flag must be boolean")
        elif action.nargs == "+":
            if (
                type(value) is not list
                or not value
                or any(type(item) is not action.type for item in value)
            ):
                raise RequestContractError("Option requires a typed nonempty list")
        elif action.type is int and type(value) is not int:
            raise RequestContractError("Training option must be an integer")
        elif action.type is float and type(value) not in {int, float}:
            raise RequestContractError("Training option must be numeric")
        elif action.type is str and type(value) is not str:
            raise RequestContractError("Training option must be text")
        if action.choices is not None and value not in action.choices:
            raise RequestContractError("Invalid training option choice")


def _snapshot(
    config,
    connection,
    operation,
    *,
    processes=1,
    warnings=(),
    output_directory="",
    export_path="",
    submission_cwd=None,
    expected_daemon_id=None,
    storage_map=(),
    checkpoint_source=None,
):
    payload = {
        "backend": connection.backend,
        "operation": operation,
        "config": config,
        "runtime": {
            "python": connection.python,
            "mode": "selected",
            "device": connection.device,
            "environment": dict(connection.environment),
        },
        "topology": {
            "num_machines": 1,
            "processes_per_machine": processes,
            "machine_rank": 0,
        },
    }
    if submission_cwd is not None:
        payload["submission_cwd"] = _server_path(submission_cwd, connection)
    _validate_mappings(storage_map)
    if storage_map:
        payload["storage_map"] = [asdict(item) for item in storage_map]
    if checkpoint_source is not None:
        payload["checkpoint_source"] = dict(checkpoint_source)
    try:
        encoded = json.dumps(
            payload, sort_keys=True, separators=(",", ":"), allow_nan=False
        )
    except (ValueError, TypeError, RecursionError):
        raise RequestContractError(
            "Configuration must contain finite JSON values"
        ) from None
    if len(encoded.encode()) > 65536:
        raise RequestContractError("Request exceeds the daemon byte bound")
    return RequestSnapshot(
        encoded, tuple(warnings), output_directory, export_path, expected_daemon_id
    )


def build_training_request(
    config: TrainingConfig,
    connection: DaemonConnection,
    *,
    data_selection: PathSelectionRef | None = None,
    resume_selection: PathSelectionRef | None = None,
    submission_cwd: str | None = None,
) -> RequestSnapshot:
    values = _config(config, TRAINING_FIELDS)
    values["data_path"] = _path(values["data_path"], connection, data_selection)
    output = _text(values.pop("output_dir"), empty=True)
    processes = values.pop("num_gpus")
    if type(processes) is not int or not 1 <= processes <= 1024:
        raise RequestContractError(
            "Process topology must be a positive bounded integer"
        )
    mixed = values.pop("mixed_precision")
    warnings = []
    if mixed != values["precision"]:
        if mixed != "bf16":
            raise RequestContractError(
                "Conflicting precision and mixed_precision selections"
            )
        warnings.append(
            "Legacy default mixed_precision is ignored; precision is authoritative."
        )
    no_cache = values.pop("no_cache")
    if type(no_cache) is not bool:
        raise RequestContractError("no_cache must be boolean")
    if no_cache:
        warnings.append(
            "Daemon UUID runs have isolated caches; no client or export files will be deleted."
        )
    if values["resume"]:
        values["resume"] = _path(values["resume"], connection, resume_selection)
    elif resume_selection is not None:
        raise RequestContractError("Resume selection requires a resume path")
    values = {name: value for name, value in values.items() if value != ""}
    _parser_values(values, build_training_parser())
    return _snapshot(
        values,
        connection,
        "train",
        processes=processes,
        warnings=warnings,
        output_directory=output,
        submission_cwd=submission_cwd,
        expected_daemon_id=_expected_daemon(
            connection, data_selection, resume_selection
        ),
    )


def build_test_request(
    config: TestConfig,
    connection: DaemonConnection,
    *,
    data_selection: PathSelectionRef | None = None,
    checkpoint_selection: PathSelectionRef | None = None,
    checkpoint_run_ref: RunRef | None = None,
    submission_cwd: str | None = None,
) -> RequestSnapshot:
    values = _config(config, TEST_FIELDS)
    values["data_path"] = _path(values["data_path"], connection, data_selection)
    if checkpoint_run_ref is not None:
        _source_run(checkpoint_run_ref, connection)
        if checkpoint_selection is None:
            checkpoint_selection = PathSelectionRef(
                values["checkpoint"], "daemon", checkpoint_run_ref.daemon_id
            )
    values["checkpoint"] = _path(values["checkpoint"], connection, checkpoint_selection)
    mappings = ()
    if checkpoint_run_ref is not None:
        checkpoint = _pure_path(values["checkpoint"])
        host_root = _pure_path(checkpoint_run_ref.run_directory)
        try:
            checkpoint.relative_to(host_root)
        except ValueError:
            raise RequestContractError(
                "Checkpoint differs from the approved source run"
            ) from None
        mappings = checkpoint_run_ref.storage_map
    output, export_path = values.pop("output_dir"), values.pop("export_path")
    _text(output, empty=True)
    _text(export_path, empty=True)
    export = values.pop("export_format")
    if export_path and not export:
        raise RequestContractError(
            "An explicit export destination requires ONNX export"
        )
    if export:
        if export != "onnx":
            raise RequestContractError("Unsupported export format")
        values["export"] = export
    if export_path:
        # This is a CLIENT destination. Freeze its lexical absolute spelling now,
        # without resolving links or sending it to the remote operation.
        export_path = str(Path(export_path).expanduser().absolute())
        if (
            not Path(export_path).name
            or Path(export_path).name in {".", ".."}
            or ".." in Path(export_path).parts
        ):
            raise RequestContractError("Export destination must name a file")
    values = {
        name: value for name, value in values.items() if value != "" and value != []
    }
    _parser_values(values, build_inference_parser())
    return _snapshot(
        values,
        connection,
        "test",
        output_directory=output,
        export_path=export_path,
        submission_cwd=submission_cwd,
        expected_daemon_id=_expected_daemon(
            connection, data_selection, checkpoint_selection, checkpoint_run_ref
        ),
        storage_map=mappings,
    )


def build_plot_request(
    config: TrainingConfig, run_ref: RunRef, connection: DaemonConnection
) -> RequestSnapshot:
    values = _config(config, TRAINING_FIELDS)
    output = _text(values["output_dir"], empty=True)
    _source_run(run_ref, connection)
    if (
        not isinstance(run_ref, RunRef)
        or run_ref.operation != "train"
        or (
            connection.daemon_id is not None
            and connection.daemon_id != run_ref.daemon_id
        )
    ):
        raise RequestContractError(
            "Plots require a training run on the selected daemon"
        )
    _server_path(run_ref.run_directory, connection)
    _server_path(run_ref.data_path, connection)
    if (
        type(values["batch_size"]) is not int
        or values["batch_size"] < 1
        or type(values["workers"]) is not int
        or values["workers"] < -1
    ):
        raise RequestContractError("Invalid plot batch or worker count")
    values = {
        "data_path": _mapped_path(run_ref.data_path, run_ref.storage_map, inverse=True),
        "batch_size": values["batch_size"],
        "workers": max(0, values["workers"]),
        "plot": True,
        "plot_format": ["png"],
        "import_modules": [
            _mapped_path(item, run_ref.storage_map, inverse=True)
            if item.endswith(".py")
            else item
            for item in run_ref.import_modules
        ],
    }
    source = None
    if run_ref.checkpoint_generation is None:
        # Compatibility for explicit legacy PlotWorker callers. Automatic
        # plotting carries the verified publication selected during delivery.
        values["checkpoint"] = run_ref.run_directory
    else:
        source = {"run_id": run_ref.run_id, "generation": run_ref.checkpoint_generation}
    return _snapshot(
        values,
        connection,
        "plot",
        output_directory=output,
        expected_daemon_id=_expected_daemon(connection, run_ref),
        storage_map=run_ref.storage_map,
        checkpoint_source=source,
    )


def _source_run(run_ref, connection):
    if not isinstance(run_ref, RunRef) or run_ref.operation != "train":
        raise RequestContractError("Consumer requires an approved training source")
    if run_ref.backend is not None and run_ref.backend != connection.backend:
        raise RequestContractError("Consumer backend differs from the approved source")
    _expected_daemon(connection, run_ref)


@dataclass(frozen=True)
class InspectionInfo:
    path: str
    format: str
    num_samples: int
    input_shape: tuple[int, ...]
    output_shape: tuple[int, ...]
    input_dtype: str
    output_dtype: str
    input_key: str
    output_key: str
    file_size: int | None = None


def inspect_to_data_info(
    metadata: dict, path_selection: PathSelectionRef, *, input_key="X", output_key="y"
) -> InspectionInfo:
    try:
        if (
            type(metadata) is not dict
            or type(metadata.get("schema_version")) is not int
            or metadata["schema_version"] != 1
            or type(metadata.get("variables")) is not list
            or len(metadata["variables"]) > 128
        ):
            raise RequestContractError("Invalid inspection metadata")
        variables = {item["name"]: item for item in metadata["variables"]}
        if len(variables) != len(metadata["variables"]):
            raise RequestContractError("Ambiguous dataset variable names")
        inputs, outputs = variables[input_key], variables[output_key]
        for variable in (inputs, outputs):
            shape = variable["shape"]
            if (
                type(shape) is not list
                or not shape
                or len(shape) > 8
                or any(type(size) is not int or size < 1 for size in shape)
                or type(variable.get("sample_count")) is not int
                or variable.get("sample_count") != shape[0]
                or type(variable.get("dtype")) is not str
            ):
                raise RequestContractError("Invalid dataset shape metadata")
        if inputs["sample_count"] != outputs["sample_count"]:
            raise RequestContractError("Dataset input/output sample counts differ")
        return InspectionInfo(
            path_selection.path,
            _text(metadata["format"]),
            inputs["sample_count"],
            tuple(inputs["shape"]),
            tuple(outputs["shape"]),
            inputs["dtype"],
            outputs["dtype"],
            input_key,
            output_key,
        )
    except (KeyError, TypeError, AttributeError, ValueError):
        raise RequestContractError(
            "Inspection cannot map to the selected dataset fields"
        ) from None
