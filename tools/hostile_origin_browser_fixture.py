"""F13 real local-loopback security boundary, with no execution or ML claim.

Only an unsubmitted CPU plan is seeded. The outer ASGI observer forwards every
request/response unchanged; it neither adds routes nor injects responses. The
runner owns its second-port hostile website. Evidence is private and write-once
except for append-only sanitized receipts. Snapshots can be taken while serving
with ``--snapshot-root ROOT --snapshot-name PHASE``; no daemon debug API exists.
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
from pathlib import Path
from urllib.parse import parse_qs

import numpy as np
import uvicorn

from wavedl import __version__
from wavedl_daemon.http.app import create_app
from wavedl_daemon.http.bootstrap import BootstrapCredentials
from wavedl_daemon.runs.runtime_service import HostedServices
from wavedl_daemon.storage.settings import Settings


try:
    from tools import browser_journal_fault_fixture as private_io
except ModuleNotFoundError:
    import browser_journal_fault_fixture as private_io


def write_private_once(path: Path, value: bytes) -> None:
    """Refuse replacement, including a preexisting symlink."""
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(value)
        stream.flush()
        os.fsync(stream.fileno())


def private_root(root: Path, *, empty: bool = False) -> Path:
    """Require an explicitly owned private directory, never user defaults."""
    private_io.private_root(root, empty=empty)
    return root


def safe_origin(value: bytes) -> str:
    """Record only controlled loopback origins, never arbitrary header text."""
    origin = value.decode("ascii", errors="replace")
    if re.fullmatch(r"http://(?:127\.0\.0\.1|localhost):[1-9][0-9]{0,4}", origin):
        if int(origin.rsplit(":", 1)[1]) <= 65535:
            return origin
    return "[unrecorded]"


def receipt_observer(application, path: Path):
    """Observe the actual security boundary without changing ASGI messages."""
    write_private_once(path, b"")
    receipt_identity = path.stat()
    sequence = 0
    pending = {}
    written = 0

    async def observed(scope, receive, send):
        nonlocal sequence
        target = scope.get("type") == "http" and (
            scope.get("path") in {"/api/runs", "/api/runs/plan"}
            or re.fullmatch(
                r"/api/runs/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/cancel",
                scope.get("path", ""),
            )
        )
        if not target:
            return await application(scope, receive, send)
        sequence += 1
        arrival = sequence
        messages = []
        digest = hashlib.sha256()
        size = 0
        while True:
            message = await receive()
            messages.append(message)
            if message["type"] != "http.request":
                break
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > 1024 * 1024:
                raise RuntimeError("Fixture request evidence exceeds bound")
            digest.update(chunk)
            if not message.get("more_body", False):
                break
        iterator = iter(messages)

        async def replay():
            return next(iterator, None) or await receive()

        async def recorded_send(message):
            nonlocal written
            if message["type"] == "http.response.start":
                headers = scope.get("headers", [])
                requested = set()
                for key, value in headers:
                    if key.lower() == b"access-control-request-headers":
                        requested.update(
                            item.strip().lower() for item in value.split(b",")
                        )
                record = {
                    "sequence": arrival,
                    "method": scope["method"]
                    if scope["method"] in {"GET", "POST", "OPTIONS", "HEAD"}
                    else "OTHER",
                    "path": scope["path"],
                    "status": message["status"],
                    "setCookiePresent": any(
                        key.lower() == b"set-cookie"
                        for key, _ in message.get("headers", [])
                    ),
                    "allowOriginPresent": any(
                        key.lower() == b"access-control-allow-origin"
                        for key, _ in message.get("headers", [])
                    ),
                    "origin": next(
                        (safe_origin(v) for k, v in headers if k.lower() == b"origin"),
                        None,
                    ),
                    "cookiePresent": any(k.lower() == b"cookie" for k, _ in headers),
                    "authHeaderPresent": any(
                        k.lower() == b"authorization" for k, _ in headers
                    ),
                    "bodyBytes": size,
                    "bodySha256": digest.hexdigest(),
                    "requestedHeaders": sorted(
                        item.decode("ascii")
                        for item in requested
                        if item
                        in {b"authorization", b"content-type", b"x-wavedl-daemon-id"}
                    ),
                }
                query = scope.get("query_string", b"")
                query_valid = len(query) <= 4096
                try:
                    cases = (
                        parse_qs(
                            query.decode("ascii", errors="replace"), max_num_fields=16
                        )
                        if len(query) <= 4096
                        else {}
                    )
                except ValueError:
                    cases = {}
                    query_valid = False
                case = cases.get("acceptance_case", [])
                if len(case) == 1 and case[0] in {
                    "node-get",
                    "simple-get",
                    "simple-post",
                    "form-post",
                    "json-post",
                    "cookie-only",
                    "node-cancel",
                }:
                    record["case"] = case[0]
                elif query_valid and "acceptance_case" not in cases:
                    header_cases = [
                        value
                        for key, value in headers
                        if key.lower() == b"x-wavedl-acceptance-case"
                    ]
                    if header_cases == [b"node-get"]:
                        record["case"] = "node-get"
                line = (json.dumps(record, sort_keys=True) + "\n").encode()
                pending[arrival] = line
                while written + 1 in pending:
                    line = pending.pop(written + 1)
                    descriptor = os.open(
                        path, os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW | os.O_NONBLOCK
                    )
                    with os.fdopen(descriptor, "ab") as stream:
                        info = os.fstat(stream.fileno())
                        if (
                            (info.st_dev, info.st_ino)
                            != (receipt_identity.st_dev, receipt_identity.st_ino)
                            or info.st_nlink != 1
                            or stat.S_IMODE(info.st_mode) != 0o600
                            or info.st_size + len(line) > 1024 * 1024
                        ):
                            raise RuntimeError("Fixture receipt identity/size changed")
                        stream.write(line)
                        stream.flush()
                    written += 1
            await send(message)

        await application(scope, replay, recorded_send)

    return observed


def storage_snapshot(root: Path) -> dict:
    """Hash logical SQLite and every ordinary owned storage file, without writes.

    SQLite transport files and the dispatch lock are not durable application
    content; the complete logical dump covers every SQLite table instead. Tree
    hashes include names, file modes, sizes and contents, and empty directories.
    Only allowlisted public identities and control flags leave the SQLite reader.
    settingsSha256 hashes the configured Settings values, not a persisted settings
    file (this fixture has none). Actual persisted files are covered by trees.
    """
    root = private_root(root)
    private_root(root / "state")
    private_root(root / "runs")
    registry_path = root / "state" / "registry.db"
    registry_before = registry_path.lstat()
    private_io.bounded_read(registry_path, 64 * 1024 * 1024)
    with sqlite3.connect(f"{registry_path.as_uri()}?mode=ro", uri=True) as db:
        db.execute("BEGIN")
        logical = "\n".join(db.iterdump()).encode()
        tables = [
            row[0]
            for row in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            )
        ]
        counts = {
            table: db.execute(
                'SELECT COUNT(*) FROM "' + table.replace('"', '""') + '"'
            ).fetchone()[0]
            for table in tables
        }
        cancellation = [
            row[0]
            for row in db.execute(
                "SELECT cancellation_requested FROM plan_control ORDER BY plan_id"
            )
        ]
        plans = [
            {
                "planId": row[0],
                "requestId": row[1],
                "runId": json.loads(json.loads(row[2])["manifest_json"])["run_id"],
                "submissionRequested": row[3],
                "cancellationRequested": row[4],
            }
            for row in db.execute(
                "SELECT p.plan_id, p.request_id, p.plan_json, "
                "c.submission_requested, c.cancellation_requested "
                "FROM plans p JOIN plan_control c ON p.plan_id=c.plan_id ORDER BY p.plan_id"
            )
        ]
        executions = [
            {
                "planId": row[0],
                "attempt": row[1],
                "state": row[2],
                "cancelDelivered": bool(row[3]),
            }
            for row in db.execute(
                "SELECT plan_id,attempt,state,cancel_delivered FROM execution_control ORDER BY plan_id"
            )
        ]
        submission_controls = [
            {"planId": row[0], "state": row[1], "cancelDelivered": bool(row[2])}
            for row in db.execute(
                "SELECT plan_id,state,cancel_delivered FROM submission_control ORDER BY plan_id"
            )
        ]
    registry_after = registry_path.lstat()
    if (registry_before.st_dev, registry_before.st_ino) != (
        registry_after.st_dev,
        registry_after.st_ino,
    ):
        raise ValueError("Registry identity changed")
    trees = {}
    for name in ("state", "runs"):
        entries = []
        for path in sorted((root / name).rglob("*")):
            relative = path.relative_to(root / name).as_posix()
            if name == "state" and relative in {
                "registry.db",
                "registry.db-wal",
                "registry.db-shm",
                "dispatch.lock",
            }:
                continue
            if path.is_symlink():
                raise ValueError("Unexpected fixture storage symlink")
            info = path.stat()
            entries.append(
                [
                    relative,
                    stat.S_IMODE(info.st_mode),
                    "directory"
                    if path.is_dir()
                    else hashlib.sha256(
                        private_io.bounded_read(path, 64 * 1024 * 1024)
                    ).hexdigest(),
                    0 if path.is_dir() else info.st_size,
                ]
            )
        trees[name] = hashlib.sha256(json.dumps(entries).encode()).hexdigest()
    settings = {
        "state_root": str(root / "state"),
        "run_root": str(root / "runs"),
        "shared_execution": False,
    }
    return {
        "registry": {
            "sha256": hashlib.sha256(logical).hexdigest(),
            "tables": counts,
            "cancellationRequested": cancellation,
            "plans": plans,
            "executions": executions,
            "submissionControls": submission_controls,
        },
        "trees": trees,
        "settingsSha256": hashlib.sha256(
            json.dumps(settings, sort_keys=True).encode()
        ).hexdigest(),
    }


async def serve_fixture(root: Path, port: int = 0, web_assets: Path | None = None):
    root = private_root(root, empty=True)
    token = secrets.token_urlsafe(32)
    write_private_once(root / "token", token.encode("ascii"))
    data = root / "samples.npz"
    np.savez(
        data,
        X=np.zeros((4, 32), dtype=np.float32),
        y=np.zeros((4, 1), dtype=np.float32),
    )
    settings = Settings(root / "state", root / "runs")
    services = HostedServices(settings, browse_roots={"datasets": root})
    bootstrap = BootstrapCredentials(token)
    with socket.socket() as listener:
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
            allowed_hosts=(authority,),
            web_assets=web_assets,
        )
        observed = receipt_observer(app, root / "receipts.jsonl")

        class SeededServer(uvicorn.Server):
            async def startup(self, sockets=None):
                await super().startup(sockets=sockets)
                if not self.started:
                    return
                planned = await services.run_service.plan(
                    {
                        "backend": "local",
                        "operation": "train",
                        "config": {
                            "model": "cnn",
                            "data_path": str(data),
                            "epochs": 1,
                            "batch_size": 2,
                            "workers": 0,
                        },
                        "runtime": {
                            "python": sys.executable,
                            "mode": "existing",
                            "device": "cpu",
                            "environment": {},
                        },
                        "topology": {
                            "num_machines": 1,
                            "processes_per_machine": 1,
                            "machine_rank": 0,
                        },
                    },
                    "hostile-origin-unsubmitted-plan",
                )
                public = {
                    "daemonOrigin": f"http://{authority}",
                    "runId": planned.run_id,
                    "planId": planned.plan_id,
                    "requestId": planned.request_id,
                    "daemonId": services.daemon_id,
                    "buildId": __version__,
                    "cancelPath": f"/api/runs/{planned.run_id}/cancel",
                    "scope": "local-loopback-unsubmitted-plan-no-ML",
                }
                private = {
                    **public,
                    "bootstrapUrl": f"http://{authority}/?bootstrap={bootstrap.mint()}",
                    "tokenFile": str(root / "token"),
                }
                write_private_once(root / "ready.json", json.dumps(private).encode())
                print("Ready: " + json.dumps(public), flush=True)

        server = SeededServer(
            uvicorn.Config(
                observed,
                loop="asyncio",
                lifespan="on",
                log_level="error",
                access_log=False,
            )
        )
        try:
            await server.serve(sockets=[listener])
        finally:
            await services.close()
            print("Fixture: services-closed", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path)
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--web-assets", type=Path)
    parser.add_argument("--snapshot-root", type=Path)
    parser.add_argument("--snapshot-name")
    args = parser.parse_args()
    if args.snapshot_root is not None:
        if not args.snapshot_name or not re.fullmatch(
            r"[a-z][a-z0-9-]{0,63}", args.snapshot_name
        ):
            parser.error("Snapshot name requires a bounded lowercase phase name")
        root = private_root(args.snapshot_root)
        write_private_once(
            root / f"snapshot-{args.snapshot_name}.json",
            json.dumps(storage_snapshot(root), sort_keys=True).encode(),
        )
    elif args.root is not None:
        asyncio.run(serve_fixture(args.root, args.port, args.web_assets))
    else:
        parser.error("Specify --root or --snapshot-root with --snapshot-name")


if __name__ == "__main__":
    main()
