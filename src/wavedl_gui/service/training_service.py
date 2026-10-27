"""Daemon-backed GUI workflows with legacy progress and auto-plot signals.

The daemon owns execution, cancellation and publication. Client export paths
remain local preferences; connection uncertainty never becomes run failure.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import re
import tempfile
from dataclasses import dataclass, field, replace
from enum import Enum, auto
from pathlib import Path
from uuid import uuid4

from PySide6.QtCore import QObject, Signal

from wavedl.core.checkpoint_selection import validate_selection_metadata
from wavedl.core.metric_history import MetricHistory
from wavedl.core.protocol import ProtocolError, strict_loads

from ..common.signal_bus import signalBus
from .daemon_contracts import (
    RequestContractError,
    build_plot_request,
    build_test_request,
    build_training_request,
)
from .daemon_workers import DaemonOperationWorker


class ProcessState(Enum):
    """States for training/test processes."""

    IDLE = auto()
    STARTING = auto()
    RUNNING = auto()
    STOPPING = auto()
    COMPLETED = auto()
    FAILED = auto()
    CANCELLED = auto()
    UNCERTAIN = auto()
    QUEUED = auto()
    HELD = auto()


@dataclass
class TrainingProgress:
    """Real-time training progress information."""

    epoch: int = 0
    total_epochs: int = 0
    train_loss: float = 0.0
    val_loss: float = 0.0
    learning_rate: float = 0.0
    best_val_loss: float = float("inf")
    patience_counter: int = 0
    max_patience: int = 0
    r2_score: float = 0.0
    pearson: float = 0.0
    grad_norm: float = 0.0
    mae_avg: float = 0.0
    mae_per_param: list[float] = field(default_factory=list)
    time_per_epoch: float = 0.0
    total_time: float = 0.0
    eta_seconds: float = 0.0

    @property
    def progress_percent(self) -> float:
        """Overall progress percentage."""
        if self.total_epochs == 0:
            return 0.0
        return (self.epoch / self.total_epochs) * 100


_METRICS_PREFIX = "##METRICS##"


class OutputParser:
    """Parses structured ##METRICS## JSON lines emitted by train.py."""

    def __init__(self):
        self.progress = TrainingProgress()

    def parse_line(self, line: str) -> tuple[TrainingProgress, bool]:
        """Parse a single line of output and update progress.

        Returns:
            Tuple of (progress, is_metrics_line). When is_metrics_line is True,
            the caller should suppress this line from the visible log.
        """
        stripped = line.strip()
        if not stripped:
            return self.progress, False

        if stripped.startswith(_METRICS_PREFIX):
            self._parse_metrics_json(stripped[len(_METRICS_PREFIX) :])
            return self.progress, True

        return self.progress, False

    @staticmethod
    def _number(data: dict, key: str, fallback):
        """Read a numeric field, treating an explicit null as 'unavailable'.

        train.py emits null rather than Infinity/NaN so the metrics line is valid
        JSON (RFC 8259 has no such tokens, and JSON.parse rejects them). A plain
        ``data.get(key, fallback)`` returns None when the key is present with a
        null value, which would then reach format strings and comparisons in the
        views. Falling back to the previous value keeps every consumer numeric --
        and for best_val_loss reproduces the infinity it carried before.
        """
        value = data.get(key)
        if value is None:
            return fallback
        if isinstance(value, list):
            # Element-level nulls become NaN rather than the fallback: the
            # fallback is the previous *list* and cannot stand in for one entry.
            # NaN is also what these entries carried before sanitisation, and it
            # formats and compares without raising.
            return [float("nan") if item is None else item for item in value]
        return value

    def _parse_metrics_json(self, json_str: str) -> None:
        try:
            data = json.loads(json_str)
        except (json.JSONDecodeError, ValueError):
            return

        p = self.progress
        num = self._number
        p.epoch = num(data, "epoch", p.epoch)
        p.total_epochs = num(data, "total_epochs", p.total_epochs)
        p.train_loss = num(data, "train_loss", p.train_loss)
        p.val_loss = num(data, "val_loss", p.val_loss)
        p.best_val_loss = num(data, "best_val_loss", p.best_val_loss)
        p.r2_score = num(data, "r2", p.r2_score)
        p.pearson = num(data, "pearson", p.pearson)
        p.grad_norm = num(data, "grad_norm", p.grad_norm)
        p.learning_rate = num(data, "lr", p.learning_rate)
        p.mae_avg = num(data, "mae_avg", p.mae_avg)
        p.mae_per_param = num(data, "mae_per_param", p.mae_per_param)
        p.time_per_epoch = num(data, "epoch_time", p.time_per_epoch)
        p.total_time = num(data, "total_time", p.total_time)
        p.patience_counter = num(data, "patience_counter", p.patience_counter)
        p.max_patience = num(data, "max_patience", p.max_patience)

        remaining = p.total_epochs - p.epoch
        p.eta_seconds = remaining * p.time_per_epoch if p.time_per_epoch > 0 else 0.0


class _DaemonWorker(QObject):
    """Retained QObject adapter; the bridge owns all network work and threads."""

    outputSig = Signal(str)
    stateSig = Signal(object)
    runChangedSig = Signal(object)
    nativeScopeChangedSig = Signal(bool)
    connectionSig = Signal(str)
    finished = Signal()

    def __init__(
        self, config, parent=None, connection=None, transport_factory=None, run_ref=None
    ):
        super().__init__(parent)
        from ..common.config import daemonConnection

        self.config = config
        self.connection = connection or daemonConnection()
        self.run_ref = run_ref
        self.nativePending = False
        self._terminal = False
        self._state = ProcessState.IDLE
        self._pending_terminal_state = None
        self._download_directory = None
        self._snapshot = self._build_snapshot(config, run_ref)
        self._bridge = DaemonOperationWorker(
            self.connection,
            self._snapshot,
            transport_factory=transport_factory,
            run_ref=run_ref if self.operation != "plot" else None,
            result_handler=self._collect_result,
            parent=self,
        )
        self._bridge.outputSig.connect(self.outputSig.emit)
        self._bridge.statusSig.connect(self._on_status)
        self._bridge.connectionSig.connect(self._on_connection)
        self._bridge.runChangedSig.connect(self._on_run_changed)
        self._bridge.nativeScopeChangedSig.connect(self._on_native_scope_changed)
        self._bridge.eventSig.connect(self._on_event)
        self._bridge.finishedSig.connect(self._on_finished)
        self._bridge.finished.connect(self.finished.emit)

    def start(self):
        for warning in self._snapshot.warnings:
            self.outputSig.emit(warning)
        self._bridge.start()

    def run(self):
        """Compatibility for direct execution in tests; GUI callers use start."""
        self._bridge.run()

    def isRunning(self):
        return self._bridge.isRunning()

    def wait(self, *args):
        return self._bridge.wait(*args)

    def resume(self):
        return self._bridge.resume()

    def detach(self):
        self._bridge.detach()

    def stop(self):
        self._bridge.stop()

    def _on_status(self, state):
        states = {
            "pending": ProcessState.STARTING,
            "starting": ProcessState.STARTING,
            "running": ProcessState.RUNNING,
            "stopping": ProcessState.STOPPING,
            "queued": ProcessState.QUEUED,
            "held": ProcessState.HELD,
            "completed": ProcessState.COMPLETED,
            "failed": ProcessState.FAILED,
            "cancelled": ProcessState.CANCELLED,
        }
        self._state = states.get(state, ProcessState.UNCERTAIN)
        if self._state in {
            ProcessState.COMPLETED,
            ProcessState.FAILED,
            ProcessState.CANCELLED,
        }:
            self._pending_terminal_state = self._state
            return
        self.stateSig.emit(self._state)

    def _on_connection(self, message):
        self.connectionSig.emit(message)
        if message != "connected":
            self._state = ProcessState.UNCERTAIN
            self.stateSig.emit(self._state)
            self.outputSig.emit(message)

    def _on_run_changed(self, run_ref):
        self.run_ref = run_ref
        self.runChangedSig.emit(run_ref)

    def _on_event(self, event):
        pass

    def _on_native_scope_changed(self, native_pending):
        self.nativePending = native_pending
        self.nativeScopeChangedSig.emit(native_pending)

    async def _download_artifacts(self, transport, run_ref):
        metadata_only = (
            self.operation == "train"
            and not self._snapshot.output_directory
            and not self._snapshot.payload.get("config", {}).get("cv", 0)
        )
        if not metadata_only:
            return await self._download_artifacts_into(transport, run_ref)
        # Own only this newly created scratch tree, never an export preference.
        # The context cleans verified metadata on success, refusal, exception or
        # cancellation; weights are never delivered into this metadata-only tree.
        with tempfile.TemporaryDirectory(
            prefix=f"wavedl-selection-{run_ref.run_id}-"
        ) as scratch:
            try:
                return await self._download_artifacts_into(
                    transport, run_ref, metadata_directory=Path(scratch)
                )
            finally:
                self._download_directory = None

    async def _download_artifacts_into(
        self, transport, run_ref, *, metadata_directory=None
    ):
        from wavedl.core.client_transport import ArtifactRef, ClientTransportError

        expected_folds = (
            self._snapshot.payload.get("config", {}).get("cv", 0)
            if self.operation == "train"
            else 0
        )
        self._cross_validation_exports = None
        # Non-CV training always verifies bounded source classification for
        # automatic plotting, even when no bulk client export is requested.
        if (
            self.operation != "plot"
            and (self.operation != "train" or expected_folds)
            and not self._snapshot.output_directory
            and not self._snapshot.export_path
        ):
            return []
        inventory = await transport.request(
            "GET", f"/api/runs/{run_ref.run_id}/artifacts"
        )
        if (
            not isinstance(inventory, dict)
            or not isinstance(inventory.get("generations"), list)
            or len(inventory["generations"]) > 4096
        ):
            raise ClientTransportError(
                "Published artifact catalog exceeds inspection budget"
            )

        def generation_number(item):
            if (
                not isinstance(item, dict)
                or type(item.get("attempt")) is not int
                or item["attempt"] < 1
                or not isinstance(item.get("generation"), str)
                or not re.fullmatch(r"gen-[0-9]{6,19}", item["generation"])
            ):
                raise ClientTransportError("Invalid published artifact generation")
            return int(item["generation"][4:])

        eligible = []
        names = set()
        for item in inventory["generations"]:
            generation_number(item)
            if item["generation"] in names:
                raise ClientTransportError("Ambiguous published artifact generation")
            names.add(item["generation"])
            if item["attempt"] <= run_ref.attempt:
                eligible.append(item)

        base = (
            Path(self._snapshot.output_directory)
            if self._snapshot.output_directory
            else Path(tempfile.gettempdir())
        )

        def create_directory():
            if metadata_directory is not None:
                return metadata_directory
            base.mkdir(parents=True, exist_ok=True)
            directory = base / f"wavedl-{run_ref.run_id}-{uuid4()}"
            directory.mkdir(mode=0o700)
            return directory

        def references(generation):
            files = generation.get("files")
            if not isinstance(files, dict) or len(files) > 128:
                raise ClientTransportError(
                    "Selected generation exceeds file-count budget"
                )
            result = []
            for path, record in files.items():
                if not isinstance(record, dict):
                    raise ClientTransportError("Invalid published artifact record")
                result.append(
                    ArtifactRef(
                        run_ref.run_id,
                        generation["generation"],
                        path,
                        record.get("size"),
                        record.get("sha256"),
                    )
                )
            return result

        downloaded = {}
        self._cross_validation_exports = None
        export_ref = None
        if self._snapshot.export_path:
            current = [item for item in eligible if item["attempt"] == run_ref.attempt]
            if len(current) > 128:
                raise ClientTransportError("Published export generations exceed budget")
            exports = [
                ref
                for item in current
                for ref in references(item)
                if ref.path.lower().endswith(".onnx")
            ]
            if len(exports) != 1:
                raise ClientTransportError(
                    "Exactly one current-attempt ONNX export is required"
                )
            ref = exports[0]
            export_ref = ref
            if ref.size > 512 * 1024 * 1024:
                raise ClientTransportError("Export exceeds download byte budget")
            destination = Path(self._snapshot.export_path)

            def create_export_parent():
                import os
                from contextlib import ExitStack

                from wavedl.core.safe_files import open_directory

                # Retain every ancestor before creating a descendant. Existing
                # user directories are never chmodded; new directories are private.
                with ExitStack() as stack:
                    current = stack.enter_context(
                        open_directory(Path(destination.anchor))
                    )
                    for part in destination.parent.parts[1:]:
                        try:
                            child = current.open_directory(part)
                        except FileNotFoundError:
                            current.guard()
                            try:
                                if current.api is None:
                                    os.mkdir(part, mode=0o700, dir_fd=current.handle)
                                else:
                                    (current.path / part).mkdir(mode=0o700)
                            except FileExistsError:
                                pass
                            current.guard()
                            child = current.open_directory(part)
                        current = stack.enter_context(child)
                    current.verify_private_owner()
                    current.guard()

            async def export_onnx():
                await asyncio.to_thread(create_export_parent)
                return await transport.download(
                    export_ref, destination, max_bytes=512 * 1024 * 1024
                )

            if not self._snapshot.output_directory and (
                self.operation != "train" or expected_folds
            ):
                return [str(await export_onnx())]

        # Owned metadata paths are tiny worker-thread-local bookkeeping. Do not
        # queue filesystem writers that can outlive cancellation and recreate
        # the TemporaryDirectory after its context has already removed it.
        directory = (
            create_directory()
            if metadata_directory is not None
            else await asyncio.to_thread(create_directory)
        )
        self._download_directory = directory

        async def download(ref, max_bytes):
            key = (ref.generation, ref.path)
            if key not in downloaded:
                destination = directory / ref.generation / ref.path
                if metadata_directory is not None:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                else:
                    await asyncio.to_thread(
                        destination.parent.mkdir, parents=True, exist_ok=True
                    )
                downloaded[key] = await transport.download(
                    ref, destination, max_bytes=max_bytes
                )
            return downloaded[key]

        if self.operation == "train":
            selected = None
            cv_folds = {}
            cv_summary = None
            # Bound classification downloads independently of total periodic bytes.
            # Publication sequence, not step or an event label, orders candidates.
            for candidate in sorted(eligible, key=generation_number, reverse=True):
                files = candidate.get("files")
                if not isinstance(files, dict):
                    raise ClientTransportError("Invalid checkpoint inventory")
                record = files.get("checkpoint_selection.json")
                if record is None:
                    continue
                if not isinstance(record, dict):
                    raise ClientTransportError("Invalid checkpoint selection record")
                ref = ArtifactRef(
                    run_ref.run_id,
                    candidate["generation"],
                    "checkpoint_selection.json",
                    record.get("size"),
                    record.get("sha256"),
                )
                if ref.size > 4096:
                    raise ClientTransportError(
                        "Checkpoint classification exceeds byte budget"
                    )
                path = await download(ref, 4096)

                def read_selection(path=path, ref=ref):
                    with Path(path).open("rb") as stream:
                        content = stream.read(4097)
                    if (
                        len(content) != ref.size
                        or hashlib.sha256(content).hexdigest() != ref.sha256
                    ):
                        raise ClientTransportError(
                            "Checkpoint classification integrity mismatch"
                        )

                    def pairs(values):
                        result = {}
                        for key, value in values:
                            if key in result:
                                raise ClientTransportError(
                                    "Ambiguous checkpoint classification"
                                )
                            result[key] = value
                        return result

                    metadata = strict_loads(content)
                    json.loads(content, object_pairs_hook=pairs)
                    try:
                        validate_selection_metadata(metadata)
                    except ValueError as exc:
                        raise ClientTransportError(
                            "Invalid checkpoint classification"
                        ) from exc
                    if (
                        metadata["kind"] == "cross_validation_fold"
                        and "fold" not in metadata
                    ):
                        raise ClientTransportError(
                            "Cross-validation fold identity missing"
                        )
                    return metadata

                metadata = await asyncio.to_thread(read_selection)
                if metadata["kind"].startswith("cross_validation_"):
                    # CV exports are current-attempt publications, never a best
                    # checkpoint inferred from a fold or an older attempt.
                    if candidate["attempt"] == run_ref.attempt:
                        if not expected_folds:
                            raise ClientTransportError(
                                "Unexpected cross-validation publication"
                            )
                        if metadata["kind"] == "cross_validation_fold":
                            cv_folds.setdefault(metadata["fold"], candidate)
                        elif cv_summary is None:
                            cv_summary = candidate
                    continue
                if metadata["kind"] == "best":
                    if expected_folds and candidate["attempt"] == run_ref.attempt:
                        raise ClientTransportError(
                            "Unexpected best checkpoint in cross-validation run"
                        )
                    selected = candidate
                    if not expected_folds and not cv_folds and cv_summary is None:
                        break
            if expected_folds:
                if (
                    set(cv_folds) != set(range(1, expected_folds + 1))
                    or cv_summary is None
                ):
                    raise ClientTransportError(
                        "Complete cross-validation publications unavailable"
                    )
                generations = [cv_folds[fold] for fold in sorted(cv_folds)] + [
                    cv_summary
                ]
                chosen = [ref for item in generations for ref in references(item)]
                summary_ref = next(
                    (
                        ref
                        for ref in references(cv_summary)
                        if ref.path == "cv_summary.json"
                    ),
                    None,
                )
                if summary_ref is None or summary_ref.size > 64 * 1024:
                    raise ClientTransportError(
                        "Cross-validation summary unavailable or exceeds budget"
                    )
                summary_path = await download(summary_ref, 64 * 1024)

                def read_summary():
                    with Path(summary_path).open("rb") as stream:
                        content = stream.read(64 * 1024 + 1)
                    if (
                        len(content) != summary_ref.size
                        or hashlib.sha256(content).hexdigest() != summary_ref.sha256
                    ):
                        raise ClientTransportError(
                            "Cross-validation summary integrity mismatch"
                        )
                    summary = strict_loads(content)
                    if (
                        not isinstance(summary, dict)
                        or type(summary.get("folds")) is not int
                        or summary["folds"] != expected_folds
                    ):
                        raise ClientTransportError(
                            "Cross-validation summary fold count mismatch"
                        )

                await asyncio.to_thread(read_summary)
                self._cross_validation_exports = {
                    "fold_generations": {
                        fold: item["generation"] for fold, item in cv_folds.items()
                    },
                    "summary_generation": cv_summary["generation"],
                }
            elif selected is None:
                self.connectionSig.emit(
                    "Remote training completed; no verified best checkpoint is published"
                )
                raise ClientTransportError("Verified best checkpoint unavailable")
            else:
                chosen = references(selected)
                self._best_checkpoint_generation = selected["generation"]
                if not self._snapshot.output_directory:
                    # Source selection is independent of bulk export preferences.
                    # Classification metadata is bounded and verified above;
                    # weights stay daemon-owned when client export is disabled.
                    return [str(await export_onnx())] if export_ref else []
        else:
            current = [item for item in eligible if item["attempt"] == run_ref.attempt]
            if len(current) > 128:
                raise ClientTransportError(
                    "Published operation generations exceed download budget"
                )
            chosen = [ref for item in current for ref in references(item)]
            if self.operation == "plot":
                chosen = [ref for ref in chosen if ref.path.lower().endswith(".png")]
                if not chosen:
                    raise ClientTransportError("No published plot images are available")
        if (
            len(chosen) > 128
            or sum(ref.size for ref in chosen) > 1024**3
            or any(ref.size > 512 * 1024 * 1024 for ref in chosen)
        ):
            self.connectionSig.emit(
                "Remote operation completed; selected artifact generation exceeds the client export budget"
            )
            raise ClientTransportError("Selected artifacts exceed download budget")
        paths = [
            str(await download(ref, 512 * 1024 * 1024))
            for ref in chosen
            if ref != export_ref
        ]
        if export_ref is not None:
            # Publish the user-selected no-overwrite destination only after every
            # other artifact has verified successfully. A retry after earlier
            # delivery failure cannot be blocked by this worker's own export.
            paths.append(str(await export_onnx()))
        return paths

    async def _collect_result(self, transport, run_ref, view, metrics):
        paths = await self._download_artifacts(transport, run_ref)
        if self.operation == "train" and self._snapshot.payload.get("config", {}).get(
            "cv", 0
        ):
            exports = self._cross_validation_exports or {
                "fold_generations": {},
                "summary_generation": None,
            }
            return {
                "cross_validation": True,
                "trained_run_ref": run_ref,
                "artifact_paths": paths,
                "fold_paths": {
                    fold: [
                        path
                        for path in paths
                        if Path(path).is_relative_to(
                            self._download_directory / generation
                        )
                    ]
                    for fold, generation in exports["fold_generations"].items()
                },
                "summary_paths": [
                    path
                    for path in paths
                    if Path(path).is_relative_to(
                        self._download_directory / exports["summary_generation"]
                    )
                ],
            }
        result = dict(metrics) | {"artifact_paths": paths}
        if self.operation == "train":
            result["checkpoint_generation"] = self._best_checkpoint_generation
        return result

    def _on_finished(self, success, message, result):
        self._terminal = True
        self._state = self._pending_terminal_state or (
            ProcessState.COMPLETED if success else ProcessState.FAILED
        )
        self.stateSig.emit(self._state)


class TrainingWorker(_DaemonWorker):
    """Existing progress signals over a daemon-owned training operation."""

    operation = "train"
    progressSig = Signal(object)
    historySig = Signal(list)
    finishedSig = Signal(bool, str)

    def __init__(
        self, config, parent=None, connection=None, transport_factory=None, run_ref=None
    ):
        self._parser = OutputParser()
        self._history = None
        self._attempt = None
        self._best_checkpoint_generation = None
        super().__init__(config, parent, connection, transport_factory, run_ref)

    def _build_snapshot(self, config, run_ref):
        return build_training_request(
            config,
            self.connection,
            data_selection=getattr(config, "data_selection", None),
            resume_selection=getattr(config, "resume_selection", None),
        )

    def _on_run_changed(self, run_ref):
        if run_ref.attempt != self._attempt:
            self._parser = OutputParser()
            self._attempt = run_ref.attempt
            self.progressSig.emit(replace(self._parser.progress))
            self.historySig.emit([])
        if self._history is None or self._history.run_id != run_ref.run_id:
            self._history = MetricHistory(run_ref.run_id)
        super()._on_run_changed(run_ref)

    def _on_event(self, event):
        if self._history is None:
            self._history = MetricHistory(event.run_id)
        try:
            self._history.apply(event)
        except ProtocolError:
            self._on_connection("Metric history requires authoritative replay")
            return
        if self.nativePending:
            return
        if event.type not in {"metric", "supersede"}:
            return
        history = []
        parser = OutputParser()
        for record in self._history.metrics(active_only=True):
            if record.name != "epoch":
                continue
            if (
                record.attempt != self._attempt
                and self._attempt not in self._history.lineage
            ):
                continue
            parser._parse_metrics_json(json.dumps(record.metrics, allow_nan=False))
            history.append(replace(parser.progress))
        self._parser = parser
        self.historySig.emit(history)
        if history:
            self.progressSig.emit(replace(history[-1]))
        elif event.type == "supersede":
            self.progressSig.emit(replace(parser.progress))

    def _on_native_scope_changed(self, native_pending):
        if native_pending:
            self._parser = OutputParser()
            self.progressSig.emit(replace(self._parser.progress))
            self.historySig.emit([])
        super()._on_native_scope_changed(native_pending)

    def _on_finished(self, success, message, result):
        self.result = result if isinstance(result, dict) else {}
        if success and self.result.get("checkpoint_generation") and self.run_ref:
            self.run_ref = replace(
                self.run_ref, checkpoint_generation=self.result["checkpoint_generation"]
            )
            self._bridge.run_ref = self.run_ref
        super()._on_finished(success, message, result)
        self.finishedSig.emit(success, message)


class TestWorker(_DaemonWorker):
    """Test results are authoritative structured daemon metrics, not log scraping."""

    operation = "test"
    finishedSig = Signal(bool, str, dict)

    def _build_snapshot(self, config, run_ref):
        return build_test_request(
            config,
            self.connection,
            data_selection=getattr(config, "data_selection", None),
            checkpoint_selection=getattr(config, "checkpoint_selection", None),
            checkpoint_run_ref=getattr(config, "checkpoint_run_ref", None),
        )

    def _on_finished(self, success, message, result):
        super()._on_finished(success, message, result)
        self.finishedSig.emit(
            success, message, result if isinstance(result, dict) else {}
        )


class PlotWorker(_DaemonWorker):
    """Generate daemon plots using the completed training run's checkpoint."""

    operation = "plot"
    finishedSig = Signal(bool, str, list)
    _PLOT_BASENAMES = (
        "scatter_all",
        "error_histogram",
        "residuals",
        "bland_altman",
        "qq_plot",
        "error_correlation",
        "relative_error",
        "error_cdf",
        "prediction_vs_index",
        "error_boxplot",
    )

    def __init__(
        self, config, parent=None, connection=None, transport_factory=None, run_ref=None
    ):
        self.training_run_ref = run_ref
        super().__init__(config, parent, connection, transport_factory, run_ref)

    def _build_snapshot(self, config, run_ref):
        return build_plot_request(config, run_ref, self.connection)

    async def _collect_result(self, transport, run_ref, view, metrics):
        paths = await self._download_artifacts(transport, run_ref)
        order = {name: index for index, name in enumerate(self._PLOT_BASENAMES)}
        return sorted(
            paths, key=lambda path: (order.get(Path(path).stem, len(order)), path)
        )

    def _on_finished(self, success, message, result):
        super()._on_finished(success, message, result)
        self.finishedSig.emit(
            success, message, result if isinstance(result, list) else []
        )


class TrainingService(QObject):
    """Maintain UI workflows while the daemon retains execution ownership."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._training_worker = self._test_worker = self._plot_worker = None
        self._current_config = None
        self._retained_workers = []
        self._closing = False

    @property
    def is_training(self):
        return self._training_worker is not None and not self._training_worker._terminal

    @property
    def is_testing(self):
        return self._test_worker is not None and not self._test_worker._terminal

    def resume_training_if_needed(self) -> bool:
        """Resume an uncertain retained training monitor without rebuilding a plan.

        The dashboard's ``Reconnect`` action must work even when the editable
        project draft is empty or has changed since submission.  Only a
        non-terminal, non-retired training worker may be resumed; terminal
        workers must never cause a new daemon submission.
        """
        worker = self._training_worker
        if (
            self._closing
            or worker is None
            or worker._terminal
            or getattr(worker, "_monitoring_retired", False)
            or worker.isRunning()
            or worker._state is not ProcessState.UNCERTAIN
        ):
            return False
        return bool(worker.resume())

    def _retain(self, worker):
        self._retained_workers.append(worker)
        worker.finished.connect(lambda: self._release(worker))

    def resume_plot_if_needed(self) -> bool:
        """Retry retained plot delivery/observation without planning another run."""
        worker = self._plot_worker
        if (
            self._closing
            or worker is None
            or worker._terminal
            or getattr(worker, "_monitoring_retired", False)
            or worker.isRunning()
            or worker._state is not ProcessState.UNCERTAIN
        ):
            return False
        signalBus.plotStartedSig.emit()
        resumed = bool(worker.resume())
        if not resumed:
            self._on_plot_state(worker, ProcessState.UNCERTAIN)
        return resumed

    def _release(self, worker):
        # A bridge finished signal means real QThread termination. Uncertain
        # operations retain their identity and can restart the same bridge.
        if (
            (worker._terminal or getattr(worker, "_monitoring_retired", False))
            and not worker.isRunning()
            and worker in self._retained_workers
        ):
            self._retained_workers.remove(worker)

    def start_training(self, config):
        if self._closing:
            return
        if self.is_training:
            if not self._training_worker.isRunning():
                self._training_worker.resume()
            else:
                signalBus.appErrorSig.emit("Training already in progress")
            return
        try:
            config = copy.deepcopy(config)
            worker = TrainingWorker(config)
        except (RequestContractError, ValueError, TypeError):
            signalBus.appErrorSig.emit(
                "Training configuration or daemon connection is invalid"
            )
            return
        self._current_config, self._training_worker = config, worker
        self._retain(worker)
        worker.progressSig.connect(signalBus.trainingProgressSig.emit)
        worker.historySig.connect(signalBus.historyUpdatedSig.emit)
        worker.outputSig.connect(signalBus.trainingOutputSig.emit)
        worker.stateSig.connect(signalBus.trainingStateChangedSig.emit)
        worker.finishedSig.connect(self._on_training_finished)
        worker.start()

    def stop_training(self):
        if self._training_worker:
            self._training_worker.stop()
            if not self._training_worker.isRunning():
                self._training_worker.resume()

    def start_test(self, config):
        if self._closing:
            return
        if self.is_testing:
            if not self._test_worker.isRunning():
                self._test_worker.resume()
            else:
                signalBus.appErrorSig.emit("Test already in progress")
            return
        try:
            worker = TestWorker(config)
        except (RequestContractError, ValueError, TypeError):
            signalBus.appErrorSig.emit(
                "Test configuration or daemon connection is invalid"
            )
            return
        self._test_worker = worker
        self._retain(worker)
        worker.outputSig.connect(signalBus.trainingOutputSig.emit)
        worker.stateSig.connect(signalBus.trainingStateChangedSig.emit)
        worker.finishedSig.connect(self._on_test_finished)
        worker.start()

    def stop_test(self):
        if self._test_worker:
            self._test_worker.stop()
            if not self._test_worker.isRunning():
                self._test_worker.resume()

    def _on_training_finished(self, success, message):
        signalBus.trainingCompletedSig.emit(success, message)
        worker, config = self._training_worker, self._current_config
        self._training_worker = None
        if (
            success
            and not self._closing
            and config is not None
            and worker is not None
            and not getattr(worker, "result", {}).get("cross_validation", False)
            and getattr(worker, "result", {}).get("checkpoint_generation")
        ):
            self._start_plot_generation(
                config,
                worker.run_ref,
                worker.connection,
                worker._bridge._transport_factory,
            )

    def _start_plot_generation(
        self, config, run_ref=None, connection=None, transport_factory=None
    ):
        if self._closing:
            return
        if self._plot_worker is not None and not self._plot_worker._terminal:
            existing = self._plot_worker
            if existing.training_run_ref == run_ref:
                self.resume_plot_if_needed()
                return
        try:
            worker = PlotWorker(
                config,
                run_ref=run_ref,
                connection=connection,
                transport_factory=transport_factory,
            )
        except (RequestContractError, ValueError, TypeError):
            signalBus.appErrorSig.emit(
                "Plot generation requires the completed daemon training run"
            )
            return
        if self._plot_worker is not None:
            # Retire local monitoring, not the daemon operation. Keep live
            # threads until finished, but release stopped monitors immediately.
            previous = self._plot_worker
            previous._monitoring_retired = True
            previous.detach()
            if not previous.isRunning():
                self._release(previous)
        self._plot_worker = worker
        self._retain(worker)
        worker.stateSig.connect(
            lambda state, worker=worker: self._on_plot_state(worker, state)
        )
        worker.finished.connect(
            lambda worker=worker: self._on_plot_state(worker, worker._state)
        )
        worker.outputSig.connect(
            lambda message, worker=worker: self._on_plot_output(worker, message)
        )
        worker.finishedSig.connect(
            lambda success, message, paths, worker=worker: self._on_plots_finished(
                worker, success, message, paths
            )
        )
        signalBus.plotStartedSig.emit()
        worker.start()

    def _on_plot_output(self, worker, message):
        if worker is self._plot_worker:
            signalBus.trainingOutputSig.emit(message)

    def _on_plot_state(self, worker, state):
        if (
            worker is self._plot_worker
            and not self._closing
            and not getattr(worker, "_monitoring_retired", False)
        ):
            signalBus.plotStateChangedSig.emit(
                state, not worker.isRunning() and not worker._terminal
            )

    def _on_plots_finished(self, worker, success, message, paths):
        if worker is not self._plot_worker:
            return
        signalBus.plotGeneratedSig.emit(success, message, paths)
        self._plot_worker = None

    def _on_test_finished(self, success, message, results):
        signalBus.testCompletedSig.emit(success, message, results)
        self._test_worker = None

    def detachMonitoring(self):
        """Stop frontend monitoring, never cancel daemon-owned operations."""
        self._closing = True
        for worker in tuple(self._retained_workers):
            worker.detach()

    def activeMonitoringWorkers(self):
        return tuple(worker for worker in self._retained_workers if worker.isRunning())


trainingService = TrainingService()
