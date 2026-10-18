"""Owned-daemon restart harness primitives for browser acceptance.

This module deliberately contains no fake HTTP responses.  It only records
identity for processes started by the fixture and provides a conservative
cleanup routine: a process is signalled only when its PID, start time, command
line and private run-root still match the fingerprint captured at launch.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import signal
import socket
import sqlite3
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import psutil


if TYPE_CHECKING:
    from collections.abc import Iterable


@dataclass(frozen=True)
class ProcessFingerprint:
    pid: int
    create_time: float
    argv: tuple[str, ...]
    cwd: str
    run_root: str
    tag: str


def fingerprint(
    process: psutil.Process, *, run_root: Path, tag: str
) -> ProcessFingerprint:
    """Capture immutable ownership evidence for a fixture-owned process."""
    return ProcessFingerprint(
        process.pid,
        process.create_time(),
        tuple(process.cmdline()),
        str(Path(process.cwd()).resolve()),
        str(run_root.resolve()),
        tag,
    )


def _matches(process: psutil.Process, expected: ProcessFingerprint) -> bool:
    try:
        return (
            process.pid == expected.pid
            and process.is_running()
            and process.create_time() == expected.create_time
            and tuple(process.cmdline()) == expected.argv
            and str(Path(process.cwd()).resolve()) == expected.cwd
            and Path(expected.cwd).is_relative_to(expected.run_root)
            and process.environ().get("BROWSER_RESTART_FIXTURE_TAG") == expected.tag
        )
    except (psutil.Error, OSError, ValueError):
        return False


def terminate_owned(
    fingerprints: Iterable[ProcessFingerprint], *, grace_seconds: float = 5
) -> tuple[int, ...]:
    """Terminate only processes whose complete launch identity still matches.

    Returns PIDs reaped by this call.  Unknown, reused, or leader-dead PIDs are
    left untouched so the caller can report inconclusive cleanup evidence.
    """
    if grace_seconds <= 0:
        raise ValueError("grace_seconds must be positive")
    owned: list[tuple[psutil.Process, ProcessFingerprint]] = []
    for expected in fingerprints:
        try:
            process = psutil.Process(expected.pid)
        except psutil.Error:
            continue
        if _matches(process, expected):
            owned.append((process, expected))
    for process, _ in owned:
        try:
            process.send_signal(signal.SIGTERM)
        except psutil.Error:
            continue
    _, alive = psutil.wait_procs(
        [process for process, _ in owned], timeout=grace_seconds
    )
    identities = {expected.pid: expected for _, expected in owned}
    for process in alive:
        if not _matches(process, identities[process.pid]):
            raise RuntimeError("Owned identity changed before escalation")
        try:
            process.kill()
        except psutil.Error:
            pass
    _, still_alive = psutil.wait_procs(alive, timeout=min(1.0, grace_seconds))
    if still_alive:
        raise RuntimeError(
            "owned process cleanup inconclusive; refusing to signal unknown PIDs"
        )
    return tuple(process.pid for process, _ in owned)


async def serve(root: Path, token_file: Path, port: int, tag: str, reopen: bool):
    """Run genuine HostedServices with a recording-only POSIX supervisor."""
    import numpy as np
    import uvicorn
    from browser_daemon_fixture import read_fixture_token, request_cursor_metadata

    from wavedl import __version__
    from wavedl_daemon.backends.local import LocalBackend
    from wavedl_daemon.http.app import create_app
    from wavedl_daemon.http.bootstrap import BootstrapCredentials
    from wavedl_daemon.runs.runtime_service import HostedServices
    from wavedl_daemon.storage.settings import Settings
    from wavedl_daemon.supervision.posix import POSIXSupervisor

    if os.name != "posix" or root.is_symlink() or not root.is_dir():
        raise ValueError("Ordinary private POSIX fixture root required")
    root = root.resolve()
    if not reopen and list(root.iterdir()):
        raise ValueError("First daemon requires an empty owned root")
    if not tag or len(tag) > 128:
        raise ValueError("Bounded random fixture tag required")
    marker = root / ".restart-owner"
    if reopen:
        if marker.is_symlink() or marker.read_text() != tag:
            raise ValueError("Restart root ownership mismatch")
    else:
        marker.write_text(tag)
        marker.chmod(0o600)
    token = read_fixture_token(token_file, root)
    owned = root / ".owned-processes.jsonl"

    class RecordingSupervisor(POSIXSupervisor):
        def start(self, spec, *, output_limit=1048576):
            process = super().start(spec, output_limit=output_limit)
            if "-c" in spec.argv:
                return process
            # Only observe after real spawn. Never replace spec/runtime/process.
            observed = psutil.Process(process.pid)
            # macOS Python may rewrite argv[0] from the venv shim to its
            # framework executable immediately after exec; capture only after
            # that bounded startup transition, while retaining PID/create-time.
            time.sleep(0.05)
            proof = fingerprint(observed, run_root=root / "runs", tag=tag)
            if not _matches(observed, proof):
                process.cancel(grace_seconds=0.2)
                process.wait(timeout=2)
                raise RuntimeError("Spawned process lacks fixture ownership proof")
            with owned.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(asdict(proof)) + "\n")
            owned.chmod(0o600)
            return process

    def backend_factory(lock):
        return {
            "local": LocalBackend(dispatch_lock=lock, supervisor=RecordingSupervisor())
        }

    settings = Settings(root / "state", root / "runs")
    services = HostedServices(settings, backend_factory=backend_factory)
    bootstrap = BootstrapCredentials(token)
    with socket.socket() as listener:
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
            allowed_hosts=(authority,),
        )
        request_path = root / ".requests.jsonl"

        async def monitored(scope, receive, send):
            async def observed_send(message):
                if (
                    scope["type"] == "http"
                    and scope["path"].startswith("/api/")
                    and message["type"] == "http.response.start"
                ):
                    record = {
                        "method": scope["method"],
                        "path": scope["path"],
                        "status": message["status"],
                        "cursor": request_cursor_metadata(
                            scope.get("query_string", b"")
                        ),
                    }
                    if (
                        request_path.exists()
                        and request_path.stat().st_size > 1024 * 1024
                    ):
                        raise RuntimeError("Request proof exceeds fixture budget")
                    with request_path.open("a", encoding="utf-8") as stream:
                        stream.write(json.dumps(record) + "\n")
                    request_path.chmod(0o600)
                await send(message)

            await app(scope, receive, observed_send)

        class Server(uvicorn.Server):
            async def startup(self, sockets=None):
                await super().startup(sockets=sockets)
                if not self.started:
                    return
                if not reopen:
                    rng = np.random.default_rng(42)
                    x = rng.normal(size=(96, 32)).astype(np.float32)
                    data = root / "samples.npz"
                    np.savez(data, X=x, y=x.mean(axis=1).reshape(-1, 1))
                    plan = await services.run_service.plan(
                        {
                            "backend": "local",
                            "operation": "train",
                            "config": {
                                "model": "cnn",
                                "data_path": str(data),
                                "epochs": 100000,
                                "patience": 100000,
                                "save_every": 100000,
                                "batch_size": 16,
                                "workers": 0,
                            },
                            "runtime": {
                                "python": sys.executable,
                                "mode": "existing",
                                "device": "cpu",
                                "environment": {
                                    "BROWSER_RESTART_FIXTURE_TAG": tag,
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
                        "owned-restart-training",
                    )
                    await services.run_service.submit(plan.plan_id)
                    # Submission is durable intent; the HostedServices pump
                    # dispatches asynchronously once uvicorn startup yields.
                    # Browser readiness/inspect supplies the bounded runtime
                    # gate without starving that owner-loop pump in lifespan.
                print(
                    f"Browser: http://{authority}/?bootstrap={bootstrap.mint()}",
                    flush=True,
                )

        server = Server(
            uvicorn.Config(
                monitored,
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
            await services.close()
            print("Fixture: services-closed", flush=True)


def inspect(root: Path):
    from browser_reconnect_fixture import snapshot

    value = snapshot(root)
    proofs = read_rows(root / ".owned-processes.jsonl")
    value["processFingerprints"] = proofs
    value["requests"] = read_rows(root / ".requests.jsonl")
    with sqlite3.connect(
        (root / "state/registry.db").resolve().as_uri() + "?mode=ro", uri=True
    ) as db:
        events = [
            json.loads(row[0])
            for row in db.execute(
                "SELECT event_json FROM event_log WHERE run_id=? ORDER BY attempt,seq",
                (value["runId"],),
            )
        ]
    # Snapshot's committed prefix can advance while this read runs. Retain only
    # that earlier transaction's exact prefix, not a newly observed cursor.
    value["eventHashes"] = [
        hashlib.sha256(json.dumps(event, sort_keys=True).encode()).hexdigest()
        for event in events[: len(value["eventIds"])]
    ]
    return value


def read_rows(path: Path):
    if not path.exists():
        return []
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 1024 * 1024:
        raise ValueError("Bounded ordinary fixture evidence required")
    return [json.loads(line) for line in path.read_text().splitlines()]


def tagged_processes(tag: str):
    result = []
    for process in psutil.process_iter():
        try:
            if process.environ().get("BROWSER_RESTART_FIXTURE_TAG") == tag:
                result.append(process)
        except (psutil.NoSuchProcess, psutil.ZombieProcess):
            continue
        except psutil.AccessDenied:
            # Inaccessible processes cannot be proven owned and are never
            # included in the kill set.
            continue
    return result


def cleanup(root: Path, tag: str):
    if root.is_symlink() or (root / ".restart-owner").read_text() != tag:
        raise ValueError("Cleanup ownership mismatch")
    expected = [
        ProcessFingerprint(**{**row, "argv": tuple(row["argv"])})
        for row in read_rows(root / ".owned-processes.jsonl")
    ]
    proofs = []
    # RecordingSupervisor captures the leader; tagged enumeration also catches
    # accelerator descendants after their launcher leader has already exited.
    for process in tagged_processes(tag):
        try:
            if process.pid != os.getpid():
                proof = fingerprint(process, run_root=root / "runs", tag=tag)
                if not any(proof == item for item in expected):
                    raise RuntimeError(
                        "Tagged process lacks captured launch identity; refusing cleanup"
                    )
                if not _matches(process, proof):
                    raise RuntimeError("Tagged process has foreign working directory")
                proofs.append(proof)
        except (psutil.NoSuchProcess, psutil.ZombieProcess):
            continue
    signalled = terminate_owned(proofs)
    for item in expected:
        try:
            process = psutil.Process(item.pid)
            if process.create_time() == item.create_time:
                raise RuntimeError("Cached runtime PID has not been reaped")
        except psutil.NoSuchProcess:
            continue
    return {
        "signalled": list(signalled),
        "cachedRuntimeProcessesAbsent": True,
        "taggedProcessesAbsent": not any(
            process.pid != os.getpid() for process in tagged_processes(tag)
        ),
    }


def daemon_proof(root: Path, tag: str, pid: int):
    if (root / ".restart-owner").read_text() != tag:
        raise ValueError("Daemon owner marker mismatch")
    process = psutil.Process(pid)
    repo = Path(__file__).resolve().parents[1]
    proof = fingerprint(process, run_root=repo, tag=tag)
    if (
        not _matches(process, proof)
        or "tools/daemon_restart_browser_fixture.py" not in proof.argv
    ):
        raise ValueError("Daemon process identity refused")
    arguments = list(proof.argv)
    if (
        arguments[arguments.index("--tag") + 1] != tag
        or Path(arguments[arguments.index("--root") + 1]).resolve() != root.resolve()
    ):
        raise ValueError("Daemon private root/tag mismatch")
    return asdict(proof)


def capture_descendants(root: Path, tag: str, daemon_pid: int):
    path = root / ".owned-processes.jsonl"
    rows = read_rows(path)
    for row in list(rows):
        expected = ProcessFingerprint(**{**row, "argv": tuple(row["argv"])})
        try:
            leader = psutil.Process(expected.pid)
            if not _matches(leader, expected):
                continue
            for child in leader.children(recursive=True):
                proof = fingerprint(child, run_root=root / "runs", tag=tag)
                if not _matches(child, proof):
                    raise RuntimeError("Descendant ownership proof refused")
                encoded = json.loads(json.dumps(asdict(proof)))
                if encoded not in rows:
                    with path.open("a", encoding="utf-8") as stream:
                        stream.write(json.dumps(asdict(proof)) + "\n")
                    rows.append(encoded)
        except psutil.NoSuchProcess:
            continue
    # A tag alone is not ancestry. Every tagged runtime must already be in
    # the captured leader/descendant tree; refuse escaped or unrelated workers.
    for process in tagged_processes(tag):
        if process.pid in {os.getpid(), daemon_pid}:
            continue
        proof = fingerprint(process, run_root=root / "runs", tag=tag)
        if not Path(proof.cwd).is_relative_to((root / "runs").resolve()):
            raise RuntimeError("Tagged process escaped fixture run root")
        encoded = json.loads(json.dumps(asdict(proof)))
        if encoded not in rows:
            ancestor = process
            related = False
            for _ in range(32):
                if ancestor.ppid() <= 1:
                    break
                if ancestor.ppid() in {row["pid"] for row in rows}:
                    related = True
                    break
                ancestor = psutil.Process(ancestor.ppid())
            if not related:
                raise RuntimeError("Tagged process was not captured under owned leader")
            with path.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(encoded) + "\n")
            rows.append(encoded)
    expected = [
        ProcessFingerprint(**{**row, "argv": tuple(row["argv"])}) for row in rows
    ]
    if not expected:
        raise RuntimeError("No runtime process captured")
    for item in expected:
        observed = psutil.Process(item.pid)
        if not _matches(observed, item):
            raise RuntimeError(
                "Runtime process changed during capture: "
                + json.dumps(
                    {
                        "expected": asdict(item),
                        "observed": asdict(
                            fingerprint(observed, run_root=root / "runs", tag=tag)
                        ),
                        "tagMatches": observed.environ().get(
                            "BROWSER_RESTART_FIXTURE_TAG"
                        )
                        == tag,
                    },
                    sort_keys=True,
                )
            )
    return {
        "captured": len(rows),
        "processes": rows,
        "allLive": True,
        "daemon": daemon_proof(root, tag, daemon_pid),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--token-file", type=Path)
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--tag")
    parser.add_argument("--reopen", action="store_true")
    parser.add_argument("--inspect", action="store_true")
    parser.add_argument("--cleanup", action="store_true")
    parser.add_argument("--capture", action="store_true")
    parser.add_argument("--daemon-proof", action="store_true")
    parser.add_argument("--daemon-pid", type=int)
    args = parser.parse_args()
    if args.inspect:
        print(json.dumps(inspect(args.root)))
    elif args.cleanup:
        print(json.dumps(cleanup(args.root, args.tag)))
    elif args.capture:
        print(json.dumps(capture_descendants(args.root, args.tag, args.daemon_pid)))
    elif args.daemon_proof:
        print(json.dumps(daemon_proof(args.root, args.tag, args.daemon_pid)))
    else:
        asyncio.run(serve(args.root, args.token_file, args.port, args.tag, args.reopen))


if __name__ == "__main__":
    main()
