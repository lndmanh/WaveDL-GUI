"""Explicit temporary daemon for real browser acceptance, never user storage.

The supplied root must already exist and be empty. This fixture starts a real
local CPU training run; the browser uses the same public API and built assets as
the desktop client. Stop with SIGINT; jobs are owned by the daemon supervisor.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import secrets
import socket
import sqlite3
import stat
import sys
import time
from pathlib import Path
from urllib.parse import parse_qsl
from uuid import UUID

import numpy as np
import uvicorn
from scipy.io import savemat

from wavedl import __version__
from wavedl.core.generations import publish_generation, published_generations
from wavedl.core.layout import RunLayout
from wavedl_daemon.backends.local import LocalBackend
from wavedl_daemon.execution.budget import WorkBudget
from wavedl_daemon.execution.commands import run_command
from wavedl_daemon.http.app import create_app
from wavedl_daemon.http.auth import credential_bytes
from wavedl_daemon.http.bootstrap import BootstrapCredentials
from wavedl_daemon.runs.runtime_service import HostedServices
from wavedl_daemon.storage.settings import Settings
from wavedl_daemon.supervision.base import ProcessSpec


def publish_partial_best_fault(root: Path, run_id: str, mode: str) -> dict:
    """Publish real incomplete inference sources only in an owned terminal fixture."""
    if mode not in {"fallback", "refusal"}:
        raise ValueError("Invalid partial best fault")
    if str(UUID(run_id)) != run_id:
        raise ValueError("Invalid fixture run")
    with sqlite3.connect(
        (root / "state" / "registry.db").as_uri() + "?mode=ro", uri=True
    ) as connection:
        row = connection.execute(
            "SELECT state FROM runs WHERE run_id=?", (run_id,)
        ).fetchone()
    if row != ("completed",):
        raise ValueError("Partial publication requires completed training")
    layout = RunLayout(root / "runs" / run_id, run_id)
    if json.loads(layout.manifest.read_text())["operation"] != "train":
        raise ValueError("Partial publication requires training")
    original = published_generations(layout)
    required = {"training_meta.pkl", "scaler.pkl"}
    weights = {
        "model_weights.pth",
        "model.safetensors",
        "model.bin",
        "pytorch_model.bin",
    }
    complete_best = [
        item
        for item in original
        if required.issubset(item.files)
        and weights.intersection(item.files)
        and (item.path / "checkpoint_selection.json").is_file()
        and json.loads((item.path / "checkpoint_selection.json").read_text())["kind"]
        == "best"
    ]
    if not complete_best:
        raise ValueError("Genuine training best source missing")
    selected = max(complete_best, key=lambda item: int(item.generation[4:]))
    original_completions = {
        item.generation: hashlib.sha256(
            (item.path / "COMPLETE.json").read_bytes()
        ).hexdigest()
        for item in original
    }
    staging = root / ".partial-best-staging"
    staging.mkdir(mode=0o700)
    (staging / "checkpoint_selection.json").write_text(
        json.dumps({"schema_version": 1, "kind": "best"})
    )
    partial = publish_generation(
        layout, staging, attempt=selected.attempt, step=selected.step + 1
    )
    if mode == "refusal":
        quarantine = root / ".partial-best-quarantine"
        quarantine.mkdir(mode=0o700)
        for item in original:
            item.path.rename(quarantine / item.generation)
    proof = {
        "mode": mode,
        "runId": run_id,
        "attempt": selected.attempt,
        "olderCompleteBest": selected.generation,
        "originalCompleteSha256": original_completions,
        "partialGeneration": partial.generation,
        "partialComplete": json.loads((partial.path / "COMPLETE.json").read_text()),
        "visibleGenerations": [
            item.generation for item in published_generations(layout)
        ],
        "quarantined": [item.generation for item in original]
        if mode == "refusal"
        else [],
    }
    (root / ".partial-best-proof.json").write_text(json.dumps(proof))
    return proof


def metadata_integrity_fault(app, root: Path):
    """Corrupt one real selection response; retain bounded secret-free receipts."""
    claimed = False
    receipts = root / ".metadata-integrity-requests.jsonl"

    async def wrapped(scope, receive, send):
        nonlocal claimed
        match = re.fullmatch(
            r"/api/runs/([0-9a-f-]{36})/artifacts/(gen-[0-9]{6,})/"
            r"([A-Za-z0-9_.-]+)",
            scope.get("path", ""),
        )
        if scope.get("type") != "http" or scope.get("method") != "GET" or not match:
            await app(scope, receive, send)
            return
        receipt = {"path": scope["path"], "status": None, "tampered": False}
        proof_path = root / ".partial-best-proof.json"
        proof = json.loads(proof_path.read_bytes()) if proof_path.exists() else None
        target = bool(
            not claimed
            and proof
            and match.groups()
            == (proof["runId"], proof["partialGeneration"], "checkpoint_selection.json")
        )
        if target:
            claimed = True
        original = bytearray()
        altered = bytearray()

        def identity(raw):
            return {"size": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}

        async def observed(message):
            if message["type"] == "http.response.start":
                receipt["status"] = message["status"]
            if (
                target
                and receipt["status"] == 200
                and message["type"] == "http.response.body"
            ):
                body = message.get("body", b"")
                original.extend(body)
                if len(original) > 4096:
                    raise ValueError("Selection metadata evidence exceeds budget")
                if b" " in body and not receipt["tampered"]:
                    changed = bytearray(body)
                    # JSON whitespace substitution preserves parsed content:
                    # the refusal witnesses checksum, not malformed JSON.
                    changed[body.index(b" ")] = 9
                    message = {**message, "body": bytes(changed)}
                    receipt["tampered"] = True
                altered.extend(message.get("body", b""))
                if not message.get("more_body", False):
                    receipt["original"] = identity(original)
                    receipt["wire"] = identity(altered)
                    receipt["published"] = proof["partialComplete"]["files"][
                        "checkpoint_selection.json"
                    ]
                    disk = (
                        root / "runs" / match[1] / "checkpoints" / match[2] / match[3]
                    )
                    receipt["diskAfter"] = identity(disk.read_bytes())
                    receipt["parsedOriginal"] = json.loads(original)
                    receipt["parsedWire"] = json.loads(altered)
            await send(message)

        # Arrival receipt survives response abortion. Final outcome is appended
        # separately so an uncompleted request cannot masquerade as absence.
        with receipts.open("a") as stream:
            if receipts.stat().st_size > 1048576:
                raise ValueError("Integrity request evidence exceeds budget")
            stream.write(json.dumps({"phase": "arrival", "path": scope["path"]}) + "\n")
        await app(scope, receive, observed)
        with receipts.open("a") as stream:
            stream.write(json.dumps({"phase": "complete", **receipt}) + "\n")

    return wrapped


def request_cursor_metadata(query_string: bytes) -> dict[str, int]:
    """Retain only bounded numeric replay fields for fixture diagnostics."""
    if len(query_string) > 4096:
        return {}
    try:
        query = parse_qsl(query_string.decode("ascii"), max_num_fields=16)
    except (UnicodeDecodeError, ValueError):
        return {}
    return {
        key: int(value)
        for key, value in query
        if key in {"attempt", "seq"} and re.fullmatch(r"-?[0-9]{1,19}", value)
    }


def request_path_metadata(path: str) -> str:
    """Keep only fixed API paths and UUID run identity, never authored paths."""
    if path in {
        "/api/health",
        "/api/runs",
        "/api/runs/plan",
        "/api/browse/resolve",
        "/api/datasets/inspect",
    }:
        return path
    if len(path) > 4096:
        return "/api/[unrecorded]"
    run_path = re.fullmatch(
        r"(/api/runs/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(/.*)?", path
    )
    if run_path:
        suffix = run_path.group(2)
        return run_path.group(1) + (
            ""
            if suffix is None
            else "/events"
            if suffix == "/events"
            else "/[endpoint]"
        )
    return "/api/[unrecorded]"


def cancellation_ack_fault(application, evidence_path: Path):
    """Record real run responses; suppress one committed cancellation ACK only."""
    descriptor = os.open(evidence_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(descriptor)
    dropped = False
    sequence = 0

    async def wrapped(scope, receive, send):
        nonlocal dropped, sequence
        matched = scope["type"] == "http" and re.fullmatch(
            r"/api/runs/[0-9a-f-]{36}(?:/cancel)?", scope.get("path", "")
        )
        matched = matched or (
            scope["type"] == "http"
            and scope.get("path", "").startswith("/api/")
            and scope.get("path") != "/api/bootstrap"
            and scope.get("method") not in {"GET", "HEAD"}
        )
        if not matched:
            return await application(scope, receive, send)
        body = bytearray()
        original_status = None
        suppress = False

        async def recorded_send(message):
            nonlocal dropped, sequence, original_status, suppress
            if message["type"] == "http.response.start":
                original_status = message["status"]
                suppress = (
                    not dropped
                    and scope["method"] == "POST"
                    and scope["path"].endswith("/cancel")
                    and 200 <= original_status < 300
                )
                if suppress:
                    dropped = True
                    message = {
                        **message,
                        "status": 503,
                        "headers": [(b"content-length", b"0")],
                    }
            if message["type"] == "http.response.body":
                body.extend(message.get("body", b""))
                if len(body) > 65536:
                    raise RuntimeError("Cancellation response exceeds evidence bound")
                if not message.get("more_body", False):
                    sequence += 1
                    record = {
                        "sequence": sequence,
                        "atMs": time.time_ns() / 1000000,
                        "method": scope["method"],
                        "path": scope["path"],
                        "originalStatus": original_status,
                        "deliveredStatus": 503 if suppress else original_status,
                        "authenticated": any(
                            k.lower() == b"authorization"
                            for k, _ in scope.get("headers", [])
                        ),
                        "scoped": any(
                            k.lower() == b"x-wavedl-daemon-id"
                            for k, _ in scope.get("headers", [])
                        ),
                        "rawBody": body.decode("utf-8"),
                        "bodyBytes": len(body),
                        "bodySha256": hashlib.sha256(body).hexdigest(),
                        "deliveredRawBody": "" if suppress else body.decode("utf-8"),
                        "deliveredBodyBytes": 0 if suppress else len(body),
                        "deliveredBodySha256": hashlib.sha256(
                            b"" if suppress else body
                        ).hexdigest(),
                        "browser": any(
                            k.lower() == b"user-agent" and b"Chrome/" in v
                            for k, v in scope.get("headers", [])
                        ),
                    }
                    line = json.dumps(record) + "\n"
                    if evidence_path.stat().st_size + len(line.encode()) > 1048576:
                        raise RuntimeError(
                            "Cancellation recorder exceeds evidence bound"
                        )
                    with evidence_path.open("a", encoding="utf-8") as stream:
                        stream.write(line)
                if suppress:
                    message = {**message, "body": b""}
            await send(message)

        await application(scope, receive, recorded_send)

    return wrapped


def read_fixture_token(path: Path, root: Path) -> str:
    """Read a private test credential, never a CLI literal or a dataset file."""
    if path.is_symlink() or path.resolve().is_relative_to(root.resolve()):
        raise ValueError(
            "Fixture credential must be private and outside its empty root"
        )
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode):
        raise ValueError("Fixture credential must be an ordinary private file")
    descriptor = os.open(
        path,
        os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0),
    )
    try:
        metadata = os.fstat(descriptor)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or (metadata.st_dev, metadata.st_ino) != (before.st_dev, before.st_ino)
            or stat.S_IMODE(metadata.st_mode) != 0o600
            or (hasattr(os, "getuid") and metadata.st_uid != os.getuid())
            or metadata.st_nlink != 1
            or not 1 <= metadata.st_size <= 4096
        ):
            raise ValueError(
                "Fixture credential requires an owned private mode-600 file"
            )
        content = os.read(descriptor, 4097)
        if len(content) != metadata.st_size:
            raise ValueError("Fixture credential changed while being read")
        try:
            token = content.decode("ascii")
        except UnicodeDecodeError:
            raise ValueError("Invalid fixture credential") from None
        credential_bytes(token)
        return token
    finally:
        os.close(descriptor)


async def serve_fixture(
    root: Path,
    epochs: int,
    port: int,
    cv: int = 0,
    output_grid: bool = False,
    seed_run: bool = True,
    drop_submit_ack: bool = False,
    tamper_artifact: bool = False,
    token_file: Path | None = None,
    request_metadata: bool = False,
    record_process_results: bool = False,
    web_assets: Path | None = None,
    standalone_adoption: bool = False,
    drop_adoption_ack: bool = False,
    drop_cancel_ack: bool = False,
    partial_best: str | None = None,
    autoplot_metadata_integrity: bool = False,
) -> None:
    """Use a dedicated empty root, genuine backend and normal runtime allocation."""
    if root.is_symlink() or not root.is_dir() or list(root.iterdir()):
        raise ValueError("Browser fixture requires a dedicated empty directory")
    root = root.resolve()
    token = (
        read_fixture_token(token_file, root)
        if token_file
        else secrets.token_urlsafe(32)
    )
    # Every run authored in this uninstalled fixture uses the checkout runtime,
    # even though a child starts in its daemon-owned working directory.
    os.environ["PYTHONPATH"] = str(Path(__file__).resolve().parents[1] / "src")
    data = root / "samples.npz"
    rng = np.random.default_rng(42)
    inputs = rng.normal(size=(96, 32)).astype(np.float32)
    outputs = inputs.mean(axis=1).reshape(-1, 1)
    if output_grid:
        # Numerical preview supports tensor outputs; the training scaler requires
        # a 2-D target matrix. Seed both through ordinary dataset files.
        np.savez(root / "grid.npz", X=inputs, y=inputs[:, :12].reshape(-1, 3, 4))
        outputs = inputs[:, :12]
    np.savez(data, X=inputs, y=outputs)
    savemat(root / "samples.mat", {"X": inputs, "y": outputs})
    # Optional runtime format dependencies are installed for real browser QA.
    import h5py

    with h5py.File(root / "samples.h5", "w") as stream:
        stream.create_dataset("X", data=inputs)
        stream.create_dataset("y", data=outputs)
    if standalone_adoption:
        standalone = root / "standalone"
        standalone.mkdir(mode=0o700)
        environment = dict(os.environ)
        environment["PYTHONPATH"] = str(Path(__file__).resolve().parents[1] / "src")
        completed = run_command(
            ProcessSpec(
                (
                    sys.executable,
                    "-m",
                    "wavedl.launcher",
                    "--cpu",
                    "--mixed_precision",
                    "no",
                    "--model",
                    "cnn",
                    "--data_path",
                    str(data),
                    "--output_dir",
                    str(standalone),
                    "--epochs",
                    "1",
                    "--workers",
                    "0",
                    "--batch_size",
                    "8",
                ),
                standalone,
                environment,
            ),
            WorkBudget(timeout_seconds=120),
        )
        if completed.returncode != 0:
            raise RuntimeError("Standalone launcher failed before browser acceptance")
        print(f"Standalone: {standalone}", flush=True)
        from browser_adoption_fixture import source_evidence

        source_before = root / ".adoption-source-before.json"
        descriptor = os.open(source_before, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(
                {
                    "returncode": completed.returncode,
                    "timedOut": completed.timed_out,
                    "cancelled": completed.cancelled,
                    "source": source_evidence(root),
                },
                stream,
            )
    if output_grid:
        # Dedicated P2 cases exercise both HDF5 extensions and missing numerical
        # cells through real ordinary files, never fabricated HTTP responses.
        with h5py.File(root / "samples.hdf5", "w") as stream:
            stream.create_dataset("X", data=inputs)
            stream.create_dataset("y", data=outputs)
        nonfinite_inputs = inputs.copy()
        nonfinite_outputs = outputs.copy()
        nonfinite_inputs[0, 0] = np.nan
        nonfinite_inputs[1, 1] = np.inf
        nonfinite_outputs[0, 0] = np.nan
        np.savez(root / "nonfinite.npz", X=nonfinite_inputs, y=nonfinite_outputs)
        np.savez(root / "one-row.npz", X=inputs[:1], y=outputs[:1])
    settings = Settings(root / "state", root / "runs")
    backend_factory = None
    if record_process_results:

        class ProofLocalBackend(LocalBackend):
            """Record genuine owned futures after normal close, before lock release."""

            def close(self):
                with self._lock:
                    handles = [
                        record.runtime_handle or record.handle
                        for record in self._records.values()
                    ]
                super().close()
                for handle in handles:
                    # This still runs under the ordinary host dispatch owner.
                    # Errors from the genuine result future propagate, never
                    # become a claimed successful teardown acknowledgment.
                    result = self.process_result(handle)
                    if result is None:
                        raise RuntimeError("Fixture owned process result unavailable")
                    print(
                        "Fixture process-result: "
                        + json.dumps(
                            {
                                "runId": handle.run_id,
                                "attempt": getattr(handle, "attempt", None),
                                "pid": handle.pid,
                                "returncode": result.returncode,
                                "cancelled": result.cancelled,
                                "timedOut": result.timed_out,
                            }
                        ),
                        flush=True,
                    )

        def backend_factory(lock):
            return {"local": ProofLocalBackend(dispatch_lock=lock)}

    services = HostedServices(
        settings, browse_roots={"datasets": root}, backend_factory=backend_factory
    )
    bootstrap = BootstrapCredentials(token)
    with socket.socket() as listener:
        if token_file:
            # Both members of the explicit replacement test must permit a
            # same-port bind after TCP TIME_WAIT, without opening a public port.
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", port))
        listener.listen(128)
        listener.setblocking(False)
        authority = f"127.0.0.1:{listener.getsockname()[1]}"
        app = create_app(
            settings,
            token=token,
            daemon_id="before-startup",
            build_id=__version__,
            services=services,
            bootstrap_credentials=bootstrap,
            allowed_hosts=(authority, f"localhost:{listener.getsockname()[1]}"),
            web_assets=web_assets,
        )
        if partial_best:
            partial_application = app
            fault_applied = False

            async def partial_best_application(scope, receive, send):
                nonlocal fault_applied
                match = re.fullmatch(
                    r"/api/runs/([0-9a-f-]{36})/artifacts", scope.get("path", "")
                )
                authenticated = any(
                    key.lower() == b"authorization"
                    and secrets.compare_digest(value, f"Bearer {token}".encode())
                    for key, value in scope.get("headers", [])
                )
                if (
                    not fault_applied
                    and scope["type"] == "http"
                    and scope.get("method") == "GET"
                    and match
                    and authenticated
                ):
                    with sqlite3.connect(
                        (root / "state" / "registry.db").as_uri() + "?mode=ro",
                        uri=True,
                    ) as connection:
                        terminal = connection.execute(
                            "SELECT state FROM runs WHERE run_id=?", (match[1],)
                        ).fetchone()
                    if terminal == ("completed",):
                        publish_partial_best_fault(root, match[1], partial_best)
                        fault_applied = True
                        print("Fault: partial-best-published", flush=True)
                body = bytearray()
                status = None

                async def observe_send(message):
                    nonlocal status
                    if match and authenticated and fault_applied:
                        if message["type"] == "http.response.start":
                            status = message["status"]
                        if message["type"] == "http.response.body":
                            body.extend(message.get("body", b""))
                            if len(body) > 262144:
                                raise RuntimeError(
                                    "Partial inventory evidence budget exceeded"
                                )
                            if not message.get("more_body", False):
                                evidence_path = root / ".partial-best-inventory.jsonl"
                                with evidence_path.open("a") as stream:
                                    if evidence_path.stat().st_size > 1048576:
                                        raise RuntimeError(
                                            "Partial inventory log budget exceeded"
                                        )
                                    stream.write(
                                        json.dumps(
                                            {
                                                "status": status,
                                                "path": scope["path"],
                                                "body": json.loads(body),
                                            }
                                        )
                                        + "\n"
                                    )
                    await send(message)

                await partial_application(scope, receive, observe_send)

            app = partial_best_application
        if autoplot_metadata_integrity:
            if partial_best != "fallback":
                raise ValueError(
                    "Metadata integrity requires real older complete sources"
                )
            app = metadata_integrity_fault(app, root)
        # Fixture-only response fault: the real public handler performs the
        # submission first. Replace one successful acknowledgment with an empty
        # proxy-style 503, not the request. This models lost ACK evidence without a debug endpoint
        # or replacing backend behavior with an API mock.
        if drop_submit_ack or tamper_artifact:
            application = app
            ack_dropped = False
            artifact_arm = root / ".artifact-tamper-arm"

            async def faulty_app(scope, receive, send):
                nonlocal ack_dropped
                target = (
                    drop_submit_ack
                    and not ack_dropped
                    and scope["type"] == "http"
                    and scope["method"] == "POST"
                    and scope["path"] == "/api/runs"
                )
                dropping = False
                artifact_target = (
                    tamper_artifact
                    and artifact_arm.is_file()
                    and not artifact_arm.is_symlink()
                    and scope["type"] == "http"
                    and scope["method"] == "GET"
                    and scope["path"].startswith("/api/runs/")
                    and "/artifacts/" in scope["path"]
                )
                artifact_success = False
                tampered = False

                async def fault_send(message):
                    nonlocal ack_dropped, dropping, artifact_success, tampered
                    if message["type"] == "http.response.start":
                        artifact_success = 200 <= message["status"] < 300
                    if target and message["type"] == "http.response.start":
                        if 200 <= message["status"] < 300:
                            ack_dropped = True
                            dropping = True
                            message = {
                                **message,
                                "status": 503,
                                "headers": [
                                    (key, value)
                                    for key, value in message.get("headers", [])
                                    if key.lower() != b"content-length"
                                ]
                                + [(b"content-length", b"0")],
                            }
                    if dropping and message["type"] == "http.response.body":
                        message = {**message, "body": b""}
                    elif (
                        artifact_target
                        and artifact_success
                        and not tampered
                        and message["type"] == "http.response.body"
                        and message.get("body")
                    ):
                        # Real backend bytes, same byte length, wrong SHA-256.
                        body = bytearray(message["body"])
                        body[0] ^= 1
                        message = {**message, "body": bytes(body)}
                        tampered = True
                        print("Fault: artifact-tampered", flush=True)
                    await send(message)

                await application(scope, receive, fault_send)

            app = faulty_app

        if request_metadata:
            monitored_application = app
            metadata_path = root / ".request-metadata.jsonl"
            planning_receipts = root / ".plan-request-receipts.jsonl"
            descriptor = os.open(
                metadata_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600
            )
            os.close(descriptor)
            descriptor = os.open(
                planning_receipts, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600
            )
            os.close(descriptor)
            planning_sequence = 0

            async def metadata_app(scope, receive, send):
                nonlocal planning_sequence
                # Test-owned boundary evidence, including rejected scope checks.
                # No credentials, request bodies, raw queries or header values.
                target = (
                    scope["type"] == "http"
                    and scope["path"].startswith("/api/")
                    and scope["path"] != "/api/bootstrap"
                )
                if (
                    target
                    and scope["method"] == "POST"
                    and scope["path"] == "/api/runs/plan"
                ):
                    # Arrival evidence does not depend on response completion:
                    # an aborted caller cannot conceal a planning request.
                    line = (
                        json.dumps(
                            {
                                "sequence": planning_sequence,
                                "method": "POST",
                                "path": "/api/runs/plan",
                            }
                        )
                        + "\n"
                    )
                    if planning_receipts.stat().st_size + len(line.encode()) > 1048576:
                        raise RuntimeError("Planning receipt evidence exceeds budget")
                    with planning_receipts.open("a", encoding="utf-8") as stream:
                        stream.write(line)
                    planning_sequence += 1

                async def metadata_send(message):
                    if target and message["type"] == "http.response.start":
                        cursor = request_cursor_metadata(scope.get("query_string", b""))
                        safe_path = request_path_metadata(scope["path"])
                        record = {
                            "method": (
                                scope["method"]
                                if scope["method"]
                                in {
                                    "GET",
                                    "HEAD",
                                    "POST",
                                    "PUT",
                                    "PATCH",
                                    "DELETE",
                                    "OPTIONS",
                                }
                                else "OTHER"
                            ),
                            "path": safe_path,
                            "cursor": cursor,
                            "status": message["status"],
                            "scopeHeaderPresent": any(
                                key.lower() == b"x-wavedl-daemon-id"
                                for key, _ in scope.get("headers", [])
                            ),
                        }
                        line = json.dumps(record) + "\n"
                        if (
                            metadata_path.stat().st_size + len(line.encode())
                            > 1024 * 1024
                        ):
                            raise RuntimeError(
                                "Fixture request metadata exceeds budget"
                            )
                        with metadata_path.open("a", encoding="utf-8") as stream:
                            stream.write(line)
                    await send(message)

                await monitored_application(scope, receive, metadata_send)

            app = metadata_app

        if drop_cancel_ack:
            app = cancellation_ack_fault(app, root / ".cancellation-wire.jsonl")

        if standalone_adoption:
            wrapped_application = app
            adoption_capture = root / ".adoption-response.json"
            descriptor = os.open(
                adoption_capture, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600
            )
            os.close(descriptor)
            adoption_ack_dropped = False

            async def adoption_capture_app(scope, receive, send):
                nonlocal adoption_ack_dropped
                if scope["type"] != "http" or scope["path"] != "/api/runs/adopt":
                    await wrapped_application(scope, receive, send)
                    return
                chunks = []
                request = {
                    "method": scope["method"],
                    "path": scope["path"],
                    "idempotencyKeyPresent": False,
                }
                request["idempotencyKeyPresent"] = any(
                    k.lower() == b"idempotency-key" for k, _ in scope.get("headers", [])
                )

                async def replay():
                    message = await receive()
                    if message["type"] == "http.request":
                        chunks.append(message.get("body", b""))
                        if sum(len(chunk) for chunk in chunks) > 65536:
                            raise RuntimeError("Adoption request capture exceeds bound")
                    return message

                response = []

                async def capture(message):
                    response.append(message)
                    if sum(len(item.get("body", b"")) for item in response) > 65536:
                        raise RuntimeError("Adoption response capture exceeds bound")

                await wrapped_application(scope, replay, capture)
                body = b"".join(
                    m.get("body", b"")
                    for m in response
                    if m["type"] == "http.response.body"
                )
                status = next(
                    (
                        m["status"]
                        for m in response
                        if m["type"] == "http.response.start"
                    ),
                    500,
                )
                request_bytes = b"".join(chunks)
                record = {
                    "request": {
                        **request,
                        "idempotencyKeySha256": hashlib.sha256(
                            next(
                                (
                                    v
                                    for k, v in scope.get("headers", [])
                                    if k.lower() == b"idempotency-key"
                                ),
                                b"",
                            )
                        ).hexdigest(),
                        "json": json.loads(request_bytes),
                        "bodySha256": hashlib.sha256(request_bytes).hexdigest(),
                        "bodyBytes": len(request_bytes),
                    },
                    "response": {
                        "status": status,
                        "bodyText": body.decode("utf-8"),
                        "bodySha256": hashlib.sha256(body).hexdigest(),
                        "bodyBytes": len(body),
                        "json": json.loads(body) if body else None,
                    },
                }
                record["deliveredStatus"] = (
                    503
                    if drop_adoption_ack
                    and not adoption_ack_dropped
                    and 200 <= status < 300
                    else status
                )
                with adoption_capture.open("a", encoding="utf-8") as stream:
                    if adoption_capture.stat().st_size > 262144:
                        raise RuntimeError("Adoption response evidence exceeds bound")
                    stream.write(json.dumps(record, sort_keys=True) + "\n")
                if (
                    drop_adoption_ack
                    and not adoption_ack_dropped
                    and 200 <= status < 300
                ):
                    adoption_ack_dropped = True
                    for message in response:
                        if message["type"] == "http.response.start":
                            await send(
                                {
                                    **message,
                                    "status": 503,
                                    "headers": [
                                        (k, v)
                                        for k, v in message.get("headers", [])
                                        if k.lower() != b"content-length"
                                    ]
                                    + [(b"content-length", b"0")],
                                }
                            )
                        elif message["type"] == "http.response.body":
                            await send({**message, "body": b""})
                    return
                for message in response:
                    await send(message)

            app = adoption_capture_app

        class SeededServer(uvicorn.Server):
            async def startup(self, sockets=None):
                await super().startup(sockets=sockets)
                if not self.started:
                    return
                if not seed_run:
                    print(
                        f"Browser: http://{authority}/?bootstrap={bootstrap.mint()}",
                        flush=True,
                    )
                    return
                planned = await services.run_service.plan(
                    {
                        "backend": "local",
                        "operation": "train",
                        "config": {
                            "model": "cnn",
                            "data_path": str(data),
                            "epochs": epochs,
                            "batch_size": 16,
                            "workers": 0,
                            "patience": epochs,
                            "save_every": epochs,
                            "cv": cv,
                        },
                        "runtime": {
                            "python": sys.executable,
                            "mode": "existing",
                            "device": "cpu",
                            "environment": {
                                # The fixture supports an uninstalled checkout;
                                # child cwd is the exclusively allocated run,
                                # so inherited relative PYTHONPATH is unsafe.
                                "PYTHONPATH": str(
                                    Path(__file__).resolve().parents[1] / "src"
                                ),
                                "OMP_NUM_THREADS": "1",
                                "MKL_NUM_THREADS": "1",
                            },
                        },
                        "topology": {
                            "num_machines": 1,
                            "processes_per_machine": 1,
                            "machine_rank": 0,
                        },
                    },
                    "browser-fixture-training",
                )
                await services.run_service.submit(planned.plan_id)
                print(f"Run: {planned.run_id}", flush=True)
                print(
                    f"Browser: http://{authority}/?bootstrap={bootstrap.mint()}",
                    flush=True,
                )

        server = SeededServer(
            uvicorn.Config(
                app,
                loop="asyncio",
                lifespan="on",
                log_level="error",
                access_log=False,
                timeout_graceful_shutdown=10,
            )
        )
        try:
            await server.serve(sockets=[listener])
        finally:
            await services.close()
            print("Fixture: services-closed", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--cv", type=int, default=0, help="Optional real CPU CV folds")
    parser.add_argument(
        "--web-assets",
        type=Path,
        help="Fixture-only: explicit generated build directory for upgrade acceptance",
    )
    parser.add_argument(
        "--token-file",
        type=Path,
        help="Fixture-only: owned mode-600 bearer file outside the empty dataset root",
    )
    parser.add_argument(
        "--request-metadata",
        action="store_true",
        help="Fixture-only: secret-free API boundary method/path/cursor/status evidence",
    )
    parser.add_argument(
        "--record-process-results",
        action="store_true",
        help="Fixture-only: emit sanitized genuine owned results after normal close",
    )
    parser.add_argument(
        "--unseeded", action="store_true", help="Author the run through the browser UI"
    )
    parser.add_argument(
        "--standalone-adoption",
        action="store_true",
        help="Create one real wavedl.launcher run for standalone adoption acceptance",
    )
    parser.add_argument("--drop-adoption-ack", action="store_true")
    parser.add_argument("--partial-best", choices=("fallback", "refusal"))
    parser.add_argument("--autoplot-metadata-integrity", action="store_true")
    parser.add_argument(
        "--drop-cancel-ack",
        action="store_true",
        help="Record genuine run responses; suppress one accepted cancel ACK as 503",
    )
    parser.add_argument(
        "--drop-submit-ack",
        action="store_true",
        help="Fixture-only: replace one accepted submit ACK with a proxy-style 503",
    )
    parser.add_argument(
        "--tamper-artifact",
        action="store_true",
        help="Fixture-only: private .artifact-tamper-arm file enables byte corruption",
    )
    parser.add_argument(
        "--output-grid",
        action="store_true",
        help="Seed tensor preview and 12-output targets",
    )
    args = parser.parse_args()
    if not 1 <= args.epochs <= 10000 or not 0 <= args.port <= 65535:
        parser.error("Invalid fixture epochs or port")
    if args.cv != 0 and not 2 <= args.cv <= 10:
        parser.error("Fixture CV must be zero or between two and ten folds")
    asyncio.run(
        serve_fixture(
            args.root,
            args.epochs,
            args.port,
            args.cv,
            args.output_grid,
            not args.unseeded,
            args.drop_submit_ack,
            args.tamper_artifact,
            args.token_file,
            args.request_metadata,
            args.record_process_results,
            args.web_assets,
            args.standalone_adoption,
            args.drop_adoption_ack,
            args.drop_cancel_ack,
            args.partial_best,
            args.autoplot_metadata_integrity,
        )
    )


if __name__ == "__main__":
    main()
