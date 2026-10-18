"""Unseeded public browser fixture: simulated Slurm and explicit copy visibility.

Batch scripts, CPU runtimes, mapped data/imports, journals and PNGs are real.
This fixture is NOT a real cluster, mounted shared storage or site certificate.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import pwd
import secrets
import shutil
import socket
import sys
import threading
from dataclasses import replace
from pathlib import Path

import numpy as np
import uvicorn

from wavedl import __version__
from wavedl_daemon.backends.slurm import SlurmBackend
from wavedl_daemon.backends.slurm_plan import SlurmSite
from wavedl_daemon.execution.budget import WorkBudget
from wavedl_daemon.execution.commands import run_command
from wavedl_daemon.http.app import create_app
from wavedl_daemon.http.bootstrap import BootstrapCredentials
from wavedl_daemon.runs.runtime_service import HostedServices
from wavedl_daemon.storage.settings import Settings
from wavedl_daemon.supervision.base import ProcessResult, ProcessSpec


class CopyScheduler:
    """Only native scheduler responses and shared-storage visibility are fake."""

    def __init__(self, host, compute, training_fault=None):
        self.host, self.compute = host, compute
        self.training_fault = training_fault
        self.owner = pwd.getpwuid(os.getuid()).pw_name
        self.lock = threading.Lock()
        self.jobs, self.threads, self.results = {}, [], []

    def execute(self, job, script):
        run = script.parent.parent.parent
        target = self.compute / run.relative_to(self.host)
        result = None
        try:
            shutil.copytree(run, target)
            environment = {
                key: value
                for key, value in os.environ.items()
                if not key.startswith(
                    ("WAVEDL_", "SLURM_", "RANK", "LOCAL_RANK", "WORLD_SIZE")
                )
            }
            environment.update(
                SLURM_JOB_ID=job,
                SLURM_RESTART_COUNT="0",
                SLURM_CLUSTER_NAME="test-cluster",
                SLURM_JOB_USER=self.owner,
            )
            result = run_command(
                ProcessSpec(("/bin/bash", str(script)), self.host, environment),
                WorkBudget(timeout_seconds=120, max_output_bytes=1024 * 1024),
            )
            shutil.copytree(target, run, dirs_exist_ok=True)
            proof = {
                "job": job,
                "requestId": self.jobs[job]["request"],
                "returncode": result.returncode,
                "timedOut": result.timed_out,
                "cancelled": result.cancelled,
                "hostRun": str(run),
                "runtimeRun": str(target),
                "copiedRuntimePublication": True,
            }
        except BaseException as error:
            proof = {
                "job": job,
                "errorType": type(error).__name__,
                "copiedRuntimePublication": False,
            }
        with self.lock:
            proof["requestId"] = self.jobs[job]["request"]
            self.results.append(proof)
            self.jobs[job].update(
                state="COMPLETED"
                if result is not None
                and result.returncode == 0
                and proof["copiedRuntimePublication"]
                else "FAILED",
                exit=0 if result is not None and result.returncode == 0 else 1,
            )
        print("Batch: " + json.dumps(proof), flush=True)

    def run(self, argv):
        with self.lock:
            if (
                self.training_fault == "uncertain"
                and self.results
                and argv[0] in {"squeue", "scontrol", "sacct"}
                and "config" not in argv
            ):
                print("Fault: scheduler-read-unavailable", flush=True)
                return ProcessResult(1, b"", b"Fixture-owned scheduler read outage")
            if argv[0] == "sbatch":
                job = str(22000 + len(self.jobs))
                request = next(
                    value.split("=", 1)[1]
                    for value in argv
                    if value.startswith("--comment=")
                )
                self.jobs[job] = {"request": request, "state": "RUNNING", "exit": 0}
                thread = threading.Thread(
                    target=self.execute, args=(job, Path(argv[-1])), daemon=True
                )
                self.threads.append(thread)
                thread.start()
                return ProcessResult(0, f"{job};test-cluster\n".encode(), b"")
            if argv[0] == "scontrol" and "config" in argv:
                return ProcessResult(
                    0,
                    b"MinJobAge = 300\nAccountingStorageType = accounting_storage/none\n",
                    b"",
                )
            if argv[0] == "sacct":
                return ProcessResult(1, b"", b"Accounting storage is disabled")
            if argv[0] == "squeue":
                output = "".join(
                    f"{job}|{self.owner}|wavedl-{item['request']}|{item['state']}|None|{item['request']}\n"
                    for job, item in self.jobs.items()
                )
            elif argv[0] == "scontrol":
                selected = argv[-1]
                output = "".join(
                    f"JobId={job} UserId={self.owner}({os.getuid()}) JobName=wavedl-{item['request']} Comment={item['request']} Cluster=test-cluster JobState={item['state']} Restarts=0 ExitCode={item['exit']}:0 Reason=None\n"
                    for job, item in self.jobs.items()
                    if selected == "jobs" or job == selected
                )
            else:
                raise AssertionError("Unexpected scheduler mutation")
            return ProcessResult(0, output.encode(), b"")


async def serve(root, training_fault=None):
    if root.is_symlink() or not root.is_dir() or list(root.iterdir()):
        raise ValueError("Dedicated empty ordinary root required")
    root = root.resolve()
    host, compute = root / "host", root / "compute"
    host.mkdir(mode=0o700)
    compute.mkdir(mode=0o700)
    data = host / "samples.npz"
    rng = np.random.default_rng(42)
    values = rng.normal(size=(32, 32)).astype("float32")
    np.savez(data, X=values, y=values.mean(axis=1).reshape(-1, 1))
    registration = host / "registration.py"
    registration.write_text(
        "import json\nfrom pathlib import Path\nfrom wavedl.models import list_models\n"
        "assert list_models()\nPath('approved-registration-loaded.json').write_text("
        "json.dumps({'module': __file__, 'cwd': str(Path.cwd())}))\n"
        + (
            "raise RuntimeError('Fixture-owned training registration failure')\n"
            if training_fault == "failed"
            else ""
        )
    )
    shutil.copy2(data, compute / data.name)
    shutil.copy2(registration, compute / registration.name)
    os.environ["PYTHONPATH"] = str(Path(__file__).resolve().parents[1] / "src")
    scheduler = CopyScheduler(host, compute, training_fault)
    services = HostedServices(
        Settings(root / "state", host / "runs"),
        browse_roots={"datasets": host},
        backend_factory=lambda lock: {
            "slurm": SlurmBackend(
                SlurmSite(partition="cpu", cluster="test-cluster", requeue=True),
                scheduler,
                owner=scheduler.owner,
                dispatch_lock=lock,
            )
        },
    )
    token = secrets.token_urlsafe(32)
    bootstrap = BootstrapCredentials(token)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen(128)
        listener.setblocking(False)
        authority = f"127.0.0.1:{listener.getsockname()[1]}"
        app = create_app(
            Settings(root / "state", host / "runs"),
            token=token,
            daemon_id="startup",
            build_id=__version__,
            services=services,
            bootstrap_credentials=bootstrap,
            allowed_hosts=(authority,),
        )
        ordinary_app = app
        submit_responses = 0

        async def lost_plot_ack(scope, receive, send):
            nonlocal submit_responses
            target = (
                scope["type"] == "http"
                and scope["method"] == "POST"
                and scope["path"] == "/api/runs"
            )
            dropping = False
            captured = bytearray()
            observed_body = bytearray()
            observed_status = None
            observe_run = (
                scope["type"] == "http"
                and scope["method"] == "GET"
                and scope["path"].startswith("/api/runs/")
                and scope["path"].count("/") == 3
            )
            recorded = (
                scope["type"] == "http"
                and scope["method"] == "POST"
                and scope["path"] in {"/api/runs/plan", "/api/runs"}
            )

            async def capture_receive():
                message = await receive()
                if recorded and message["type"] == "http.request":
                    captured.extend(message.get("body", b""))
                    if len(captured) > 65536:
                        raise ValueError("Bounded plan request evidence exceeded")
                return message

            async def fault_send(message):
                nonlocal submit_responses, dropping, observed_status
                if observe_run and message["type"] == "http.response.start":
                    observed_status = message["status"]
                if observe_run and message["type"] == "http.response.body":
                    observed_body.extend(message.get("body", b""))
                    if len(observed_body) > 65536:
                        raise ValueError("Bounded run observation exceeded")
                    if not message.get("more_body") and observed_status == 200:
                        with (root / ".run-observations.jsonl").open("a") as stream:
                            stream.write(json.dumps(json.loads(observed_body)) + "\n")
                if (
                    target
                    and message["type"] == "http.response.start"
                    and 200 <= message["status"] < 300
                ):
                    submit_responses += 1
                    if submit_responses == 2 and training_fault is None:
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
                        print("Fault: plot-submit-ack-dropped", flush=True)
                if dropping and message["type"] == "http.response.body":
                    message = {**message, "body": b""}
                if recorded and message["type"] == "http.response.start":
                    headers = dict(scope.get("headers", []))
                    evidence = {
                        "method": scope["method"],
                        "path": scope["path"],
                        "body": json.loads(captured),
                        "bodySha256": hashlib.sha256(captured).hexdigest(),
                        "bodyText": captured.decode("utf-8"),
                        "idempotencyKey": headers.get(b"idempotency-key", b"").decode(
                            "ascii"
                        ),
                        "deliveredStatus": message["status"],
                        "originalAccepted": 200 <= message["status"] < 300 or dropping,
                        "droppedAck": dropping,
                    }
                    with (root / ".boundary.jsonl").open(
                        "a", encoding="utf-8"
                    ) as stream:
                        stream.write(json.dumps(evidence) + "\n")
                await send(message)

            await ordinary_app(scope, capture_receive, fault_send)

        class ReadyServer(uvicorn.Server):
            async def startup(self, sockets=None):
                await super().startup(sockets=sockets)
                if not self.started:
                    return

                def speed(session):
                    fleet = session.controller._fleets["slurm"]
                    fleet.policy = replace(
                        fleet.policy,
                        interval=0.02,
                        backoff_initial=0.02,
                        backoff_max=0.02,
                    )

                await services.host.call(speed)
                print(
                    f"Browser: http://{authority}/?bootstrap={bootstrap.mint()}",
                    flush=True,
                )
                print(
                    "Fixture: "
                    + json.dumps(
                        {
                            "host": str(host),
                            "compute": str(compute),
                            "registration": str(registration),
                            "python": sys.executable,
                            "simulatedScheduler": True,
                            "copyVisibility": True,
                            "trainingFault": training_fault,
                        }
                    ),
                    flush=True,
                )

        server = ReadyServer(
            uvicorn.Config(
                lost_plot_ack,
                host="127.0.0.1",
                port=listener.getsockname()[1],
                loop="asyncio",
                lifespan="on",
                log_level="error",
                access_log=False,
                timeout_graceful_shutdown=5,
            )
        )
        try:
            await server.serve(sockets=[listener])
        finally:
            server.should_exit = True
            await services.close()
            for thread in scheduler.threads:
                # The scheduler worker is owned by this fixture.  A zero-time
                # join can report a false cleanup failure while the already
                # completed CPU process is unwinding its copy barrier.
                thread.join(timeout=10)
            if (
                any(thread.is_alive() for thread in scheduler.threads)
                or services.host.outstanding
            ):
                raise RuntimeError("Owned fixture work remained alive")
            print("Fixture: services-closed", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--training-fault", choices=("failed", "uncertain"))
    try:
        args = parser.parse_args()
        asyncio.run(serve(args.root, args.training_fault))
    except KeyboardInterrupt:
        pass
