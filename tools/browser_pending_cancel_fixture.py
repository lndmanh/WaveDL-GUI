"""Genuine Local cancellation boundaries; POSIX sentinel, not ML/site proof.

Only backend latency is controlled. Public lifecycle responses, durable intents,
submission receipts and process supervision are the ordinary daemon's outputs.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import socket
import sys
import threading
import time
from pathlib import Path

import uvicorn

from wavedl import __version__
from wavedl_daemon.backends.local import LocalBackend
from wavedl_daemon.execution.budget import WorkBudget
from wavedl_daemon.http.app import create_app
from wavedl_daemon.http.bootstrap import BootstrapCredentials
from wavedl_daemon.runs.runtime_service import HostedServices
from wavedl_daemon.storage.settings import Settings


def public_wire(application, evidence_path):
    """Record actual bounded response bytes; lose only the first committed ACK."""
    evidence_path.touch(exist_ok=False, mode=0o600)
    sequence = 0
    dropped = False

    async def wrapped(scope, receive, send):
        nonlocal sequence, dropped
        path = scope.get("path", "")
        if scope["type"] != "http" or not (
            re.fullmatch(r"/api/runs/[0-9a-f-]{36}(?:/cancel|/attempts)?", path)
            or (path.startswith("/api/runs") and scope["method"] != "GET")
        ):
            return await application(scope, receive, send)
        body = bytearray()
        status = None
        suppress = False

        async def captured(message):
            nonlocal sequence, dropped, status, suppress
            if message["type"] == "http.response.start":
                status = message["status"]
                suppress = (
                    not dropped
                    and scope["method"] == "POST"
                    and path.endswith("/cancel")
                    and status == 202
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
                    raise ValueError("Response evidence bound")
                if not message.get("more_body", False):
                    sequence += 1
                    headers = dict(scope.get("headers", []))
                    raw = bytes(body)
                    delivered = b"" if suppress else raw
                    record = {
                        "sequence": sequence,
                        "method": scope["method"],
                        "path": path,
                        "originalStatus": status,
                        "deliveredStatus": 503 if suppress else status,
                        "authenticated": b"authorization" in headers,
                        "scoped": b"x-wavedl-daemon-id" in headers,
                        "browser": b"Chrome/" in headers.get(b"user-agent", b""),
                        "rawBody": raw.decode("utf-8"),
                        "bodyBytes": len(raw),
                        "bodySha256": hashlib.sha256(raw).hexdigest(),
                        "deliveredRawBody": delivered.decode("utf-8"),
                        "deliveredBodyBytes": len(delivered),
                        "deliveredBodySha256": hashlib.sha256(delivered).hexdigest(),
                    }
                    line = json.dumps(record) + "\n"
                    if evidence_path.stat().st_size + len(line.encode()) > 1048576:
                        raise ValueError("Wire evidence bound")
                    with evidence_path.open("a", encoding="utf-8") as stream:
                        stream.write(line)
                if suppress:
                    message = {**message, "body": b""}
            await send(message)

        await application(scope, receive, captured)

    return wrapped


class BoundaryLocalBackend(LocalBackend):
    """Bound only the real pre-receipt probe and cancellation dispatch latency."""

    def __init__(self, root, **kwargs):
        super().__init__(**kwargs)
        self.root = root
        self.evidence_lock = threading.Lock()
        self.receipts = []
        self.reaped = set()

    def record(self, kind, **fields):
        with self.evidence_lock:
            path = self.root / "backend.jsonl"
            if path.exists() and path.stat().st_size > 65536:
                raise ValueError("Backend evidence bound")
            with path.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps({"kind": kind, **fields}) + "\n")

    def barrier(self, name):
        deadline = time.monotonic() + 240
        while not (self.root / f"release-{name}").exists():
            if time.monotonic() >= deadline:
                raise TimeoutError(f"Fixture {name} barrier deadline")
            time.sleep(0.02)

    def _probe(self, plan):
        self.record("probe-entered", run_id=plan.run_id)
        self.barrier("probe")
        return super()._probe(plan)

    def submit(self, plan, **kwargs):
        self.record("submit-entered", run_id=plan.run_id)
        handle = super().submit(plan, **kwargs)
        self.receipts.append(handle)
        self.record("receipt", run_id=handle.run_id, pid=handle.pid)
        return handle

    def request_cancel(self, handle):
        self.record("cancel-entered", run_id=handle.run_id, pid=handle.pid)
        self.barrier("cancel")
        deadline = time.monotonic() + 5
        while not (self.root / "spawned").exists():
            if time.monotonic() >= deadline:
                raise TimeoutError("Real Local child did not reach sentinel")
            time.sleep(0.02)
        result = super().request_cancel(handle)
        self.record("cancel-completed", run_id=handle.run_id, pid=handle.pid)
        return result

    def record_reaped(self, handle):
        if handle.run_id not in self.reaped:
            result = self.process_result(handle)
            if result is None:
                raise RuntimeError("Owned child result absent after Local close")
            try:
                os.kill(handle.pid, 0)
                absent = False
            except ProcessLookupError:
                absent = True
            self.record(
                "child-reaped",
                run_id=handle.run_id,
                pid=handle.pid,
                pidAbsent=absent,
                returncode=result.returncode,
            )
            self.reaped.add(handle.run_id)

    def release(self, handle):
        # The ordinary controller can release terminal diagnostics before close.
        self.record_reaped(handle)
        return super().release(handle)

    def close(self):
        super().close()
        for handle in self.receipts:
            self.record_reaped(handle)


def create_sentinel(root):
    """An executable selected-interpreter probe and supervised process sentinel."""
    executable = root / "selected-python"
    executable.write_text(
        f"#!{sys.executable}\n"
        "import json,os,sys,time\n"
        "from pathlib import Path\n"
        "if sys.argv[1] == '-c':\n"
        "    print(json.dumps({'interpreter':sys.executable,"
        "'prefix':sys.prefix,'base_prefix':sys.base_prefix}))\n"
        "else:\n"
        f"    Path({str(root / 'spawned')!r}).write_text(str(os.getpid()))\n"
        "    time.sleep(240)\n",
        encoding="utf-8",
    )
    executable.chmod(0o700)
    return executable


async def serve(root, token_file):
    from tools.browser_daemon_fixture import read_fixture_token

    if root.is_symlink() or not root.is_dir() or list(root.iterdir()):
        raise ValueError("Dedicated empty ordinary fixture root required")
    root = root.resolve()
    token = read_fixture_token(token_file, root)
    executable = create_sentinel(root)
    settings = Settings(root / "state", root / "runs")
    services = HostedServices(
        settings,
        budget=WorkBudget(max_workers=1, max_pending=0),
        backend_factory=lambda lock: {
            "local": BoundaryLocalBackend(root, dispatch_lock=lock, cancel_grace=0.05)
        },
    )
    bootstrap = BootstrapCredentials(token)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
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
        )
        wrapped = public_wire(app, root / "wire.jsonl")

        class SeededServer(uvicorn.Server):
            async def startup(self, sockets=None):
                await super().startup(sockets=sockets)
                if not self.started:
                    return
                for index in range(2):
                    plan = await services.run_service.plan(
                        {
                            "backend": "local",
                            "operation": "train",
                            "config": {"model": "cnn", "epochs": 1, "precision": "no"},
                            "runtime": {
                                "python": str(executable),
                                "mode": "selected",
                                "device": "cpu",
                                "environment": {},
                            },
                            "topology": {
                                "num_machines": 1,
                                "processes_per_machine": 1,
                                "machine_rank": 0,
                            },
                        },
                        f"boundary-{index}",
                    )
                    await services.run_service.submit(plan.plan_id)
                    print(f"Run{index}: {plan.run_id}", flush=True)
                    if index == 0:
                        deadline = time.monotonic() + 10
                        while not (root / "backend.jsonl").exists() or (
                            '"probe-entered"'
                            not in (root / "backend.jsonl").read_text()
                        ):
                            if time.monotonic() >= deadline:
                                raise TimeoutError(
                                    "First submission did not reach probe"
                                )
                            await asyncio.sleep(0.02)
                print(
                    f"Browser: http://{authority}/?bootstrap={bootstrap.mint()}",
                    flush=True,
                )
                print(
                    f"Reconnect: http://{authority}/?bootstrap={bootstrap.mint()}",
                    flush=True,
                )

        server = SeededServer(
            uvicorn.Config(
                wrapped,
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
            # Shutdown must also drain an interrupted/failed browser gate.
            for name in ("probe", "cancel"):
                (root / f"release-{name}").touch(exist_ok=True)
            await services.close()
            print("Fixture: services-closed", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--token-file", type=Path, required=True)
    args = parser.parse_args()
    if sys.platform == "win32":
        raise ValueError("POSIX selected-interpreter sentinel only")
    asyncio.run(serve(args.root, args.token_file))


if __name__ == "__main__":
    main()
