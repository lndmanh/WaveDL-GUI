"""Real daemon replay of a controlled numerical journal, not ML training.

The backend is the existing assembled-contract fixture with genuine immutable
local submission/startup proof. No HTTP response, event or lifecycle is replaced.
The normal daemon pump ingests JournalWriter bytes into Registry/EventLogStore.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import secrets
import socket
import sqlite3
import sys
import time
from pathlib import Path

import uvicorn

from wavedl import __version__
from wavedl.core.events import MetricPayload
from wavedl.core.journal_writer import JournalWriter
from wavedl.core.layout import RunLayout
from wavedl.core.local_attempt import (
    LocalStartupIdentity,
    coordinate_local_attempt,
    read_local_binding,
)
from wavedl.core.submission import (
    create_submission,
    identity_for_submission,
    publish_submission_file,
)
from wavedl_daemon.backends.contracts import (
    BackendObservation,
    ObservationStatus,
    SubmissionHandle,
    SubmissionObservation,
)
from wavedl_daemon.backends.local import LocalBackend
from wavedl_daemon.http.app import create_app
from wavedl_daemon.http.bootstrap import BootstrapCredentials
from wavedl_daemon.runs.runtime_service import HostedServices
from wavedl_daemon.storage.settings import Settings


POINTS = 100_000


class Backend:
    """Controlled RUNNING backend; immutable submission and writer proof are real."""

    owner = "history-fixture"

    def __init__(self):
        self.handle = None
        self.startup = None

    def plan(self, manifest, **kwargs):
        return LocalBackend().plan(manifest, **kwargs)

    def submit(self, plan, *, request_id, attempt):
        if attempt is not None or plan.allocation_mode != "writer":
            raise ValueError("Fixture requires writer allocation")
        digest = hashlib.sha256(plan.to_json().encode()).hexdigest()
        identity = identity_for_submission(
            Path(plan.run_dir),
            request_id=request_id,
            backend="local",
            owner=self.owner,
            plan_sha256=digest,
        )
        create_submission(Path(plan.run_dir), identity)
        publish_submission_file(
            Path(plan.run_dir), identity, "plan.json", plan.to_json().encode()
        )
        supervisor = "history-fixture-supervisor"
        publish_submission_file(
            Path(plan.run_dir),
            identity,
            "local-submission.json",
            json.dumps(
                {
                    "schema_version": 1,
                    "run_id": plan.run_id,
                    "request_id": request_id,
                    "owner": self.owner,
                    "supervisor_id": supervisor,
                    "plan_sha256": digest,
                }
            ).encode(),
        )
        self.startup = LocalStartupIdentity(
            identity.run_id,
            identity.request_id,
            identity.owner,
            supervisor,
            identity.run_directory,
            identity.manifest_sha256,
            digest,
        )
        self.handle = SubmissionHandle(
            "local",
            plan.run_id,
            request_id,
            self.owner,
            plan.run_dir,
            pid=12345,
            supervisor_id=supervisor,
        )
        return self.handle

    def discover_initial(self, handle):
        try:
            return read_local_binding(Path(handle.run_dir), self.startup)
        except FileNotFoundError:
            return None

    def runtime_startup(self):
        return coordinate_local_attempt(Path(self.handle.run_dir), self.startup)

    def observe(self, handle):
        if isinstance(handle, SubmissionHandle):
            return SubmissionObservation(ObservationStatus.RUNNING)
        return BackendObservation(handle.attempt, ObservationStatus.RUNNING)

    def request_cancel(self, handle):
        raise ValueError("This numerical fixture does not implement cancellation")


def metric(step: int) -> dict:
    value = step / 100_000
    payload = {
        "name": "loss",
        "value": value,
        "step": step,
        "metrics": {
            "epoch": step,
            "total_epochs": POINTS,
            "train_loss": value,
            "val_loss": value + 1,
            "best_val_loss": 1.00001,
            "r2": value,
            "pearson": value,
            "lr": 0.001,
            "grad_norm": 2,
            "mae_avg": value + 2,
            "epoch_time": 3,
            "total_time": step * 3,
            "patience_counter": step % 10,
            "max_patience": 10,
            "mae_per_param": [value + 4, value + 5],
        },
    }
    MetricPayload.from_dict(payload)
    return payload


def authority(root: Path, run_id: str) -> dict:
    journal = root / "runs" / run_id / "attempts/1/events.jsonl"
    if journal.is_symlink() or journal.stat().st_size > 128 * 1024 * 1024:
        raise ValueError("Journal evidence bound")
    digest = hashlib.sha256()
    count = 0
    last = None
    with journal.open("rb") as stream:
        for line in stream:
            digest.update(line)
            event = json.loads(line)
            if event["run_id"] != run_id or event["attempt"] != 1:
                raise ValueError("Journal identity mismatch")
            if event["seq"] != count:
                raise ValueError("Journal cursor discontinuity")
            if event["type"] == "metric":
                last = event
            count += 1
    with sqlite3.connect(
        (root / "state/registry.db").resolve().as_uri() + "?mode=ro", uri=True
    ) as connection:
        metrics = connection.execute(
            "SELECT COUNT(*),MAX(step) FROM metric_history WHERE run_id=? AND active=1",
            (run_id,),
        ).fetchone()
        cursors = connection.execute(
            "SELECT attempt,seq FROM cursors WHERE run_id=?", (run_id,)
        ).fetchall()
        event_count = connection.execute(
            "SELECT COUNT(*) FROM event_log WHERE run_id=?", (run_id,)
        ).fetchone()[0]
    return {
        "journalSha256": digest.hexdigest(),
        "journalBytes": journal.stat().st_size,
        "journalEvents": count,
        "journalMetrics": count - 1,
        "lastMetric": last,
        "activeMetrics": metrics[0],
        "lastStep": metrics[1],
        "cursors": cursors,
        "eventLogEvents": event_count,
        "requests": json.loads((root / "requests.json").read_text())
        if (root / "requests.json").exists()
        else [],
    }


async def serve(root: Path):
    if root.is_symlink() or not root.is_dir() or list(root.iterdir()):
        raise ValueError("History fixture requires a dedicated empty root")
    settings = Settings(root / "state", root / "runs")
    backend = Backend()
    services = HostedServices(settings, backend_factory=lambda lock: {"local": backend})
    token = secrets.token_urlsafe(32)
    bootstrap = BootstrapCredentials(token)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen(128)
        listener.setblocking(False)
        host = f"127.0.0.1:{listener.getsockname()[1]}"
        app = create_app(
            settings,
            token=token,
            daemon_id="before-startup",
            build_id=__version__,
            services=services,
            bootstrap_credentials=bootstrap,
            allowed_hosts=(host,),
        )
        application = app
        requests = []

        async def observed(scope, receive, send):
            if (
                scope.get("type") == "http"
                and scope.get("path", "").startswith("/api/")
                and scope.get("path") != "/api/bootstrap"
            ):
                if len(requests) >= 4096:
                    raise ValueError("Request evidence capacity")
                requests.append({"method": scope["method"], "path": scope["path"]})
                (root / "requests.json").write_text(json.dumps(requests))
            await application(scope, receive, send)

        app = observed

        class Server(uvicorn.Server):
            async def startup(self, sockets=None):
                await super().startup(sockets=sockets)
                plan = await services.run_service.plan(
                    {
                        "backend": "local",
                        "operation": "train",
                        "config": {"epochs": POINTS},
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
                    "history-numerical-fixture",
                )
                await services.run_service.submit(plan.plan_id)
                async with asyncio.timeout(15):
                    while backend.handle is None:
                        await asyncio.sleep(0.01)
                binding = await services.host.call(lambda _: backend.runtime_startup())
                layout = RunLayout(Path(backend.handle.run_dir), plan.run_id)

                def produce():
                    with JournalWriter(
                        layout, attempt=binding.attempt, fsync_every=256
                    ) as writer:
                        writer.append(
                            "hello",
                            {
                                "protocol_min": 1,
                                "protocol_max": 1,
                                "runtime_version": __version__,
                                "python": sys.version.split()[0],
                                "device": "cpu",
                                "capabilities": ["train"],
                                "interpreter": sys.executable,
                            },
                        )
                        for step in range(1, POINTS + 1):
                            writer.append("metric", metric(step))

                started = time.monotonic()
                await asyncio.to_thread(produce)
                print(f"Source seconds: {time.monotonic() - started}", flush=True)
                async with asyncio.timeout(300):
                    while True:
                        cursor = await services.host.call(
                            lambda session: session.registry.cursor(plan.run_id, 1)
                        )
                        if cursor == POINTS:
                            break
                        await asyncio.sleep(0.05)
                print(f"Run: {plan.run_id}", flush=True)
                print(f"Ingest seconds: {time.monotonic() - started}", flush=True)
                print(
                    f"Browser: http://{host}/?bootstrap={bootstrap.mint()}", flush=True
                )

        server = Server(
            uvicorn.Config(
                app, log_level="error", access_log=False, timeout_graceful_shutdown=10
            )
        )
        try:
            await server.serve(sockets=[listener])
        finally:
            await services.close()
            print("Fixture: services-closed", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--inspect", metavar="RUN_ID")
    args = parser.parse_args()
    if args.inspect:
        print(json.dumps(authority(args.root, args.inspect)))
    else:
        asyncio.run(serve(args.root))


if __name__ == "__main__":
    main()
