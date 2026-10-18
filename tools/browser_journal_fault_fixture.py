"""Actual journal-byte fixture; numerical supervisor terminal result is controlled.

No API JSON or SSE frame is replaced. All four runs use genuine submission,
startup binding, HELLO, owner pumping and SQLite. Private write-once commands
advance four immutable snapshots; this is not shared-filesystem certification.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import socket
import stat
import sys
import time
from dataclasses import asdict
from pathlib import Path
from uuid import uuid4

import uvicorn

from wavedl import __version__
from wavedl.core.events import HelloPayload
from wavedl.core.journal_writer import JournalWriter
from wavedl.core.layout import RunLayout
from wavedl.core.persistence import sync_directory, write_once
from wavedl.core.protocol import Envelope, encode
from wavedl.local_startup import prepare_local_startup
from wavedl_daemon.backends.local import LocalBackend
from wavedl_daemon.http.app import create_app
from wavedl_daemon.http.bootstrap import BootstrapCredentials
from wavedl_daemon.runs.runtime_service import HostedServices
from wavedl_daemon.storage.settings import Settings
from wavedl_daemon.supervision.base import ProcessResult


try:
    from tools.browser_daemon_fixture import read_fixture_token
except ModuleNotFoundError:
    from browser_daemon_fixture import read_fixture_token


FAULTS = ("torn-tail", "abandoned-tail", "oversized-line", "oversized-tail")
MAX_JOURNAL_BYTES = 128 * 1024
MAX_SNAPSHOT_BYTES = 1024 * 1024
LIMITATION = (
    "Controlled terminal numerical supervisor and pid; genuine local submission, "
    "startup binding, HELLO/journal bytes, owner ingestion, SQLite, HTTP and SSE. "
    "No ML training, shared-filesystem, native-process or full F02 certification."
)


class CompletedProcess:
    pid = 12345

    def wait(self):
        return ProcessResult(0, b"", b"")

    def cancel(self, grace_seconds=5):
        return None


class StartupSupervisor:
    def start(self, spec, *, output_limit):
        prepare_local_startup(spec.cwd, spec.environment)
        return CompletedProcess()


class TerminalLocal(LocalBackend):
    def _probe(self, plan):
        return {
            "interpreter": sys.executable,
            "prefix": sys.prefix,
            "base_prefix": sys.base_prefix,
        }


def private_root(root: Path, *, empty=False) -> tuple[int, int]:
    if os.name != "posix":
        raise ValueError("Journal fixture requires POSIX ownership and no-follow IO")
    if not root.is_absolute() or root.is_symlink():
        raise ValueError("Fixture requires an absolute ordinary private root")
    for ancestor in root.parents:
        metadata = ancestor.lstat()
        if not stat.S_ISDIR(metadata.st_mode) or (
            metadata.st_mode & 0o022 and not metadata.st_mode & stat.S_ISVTX
        ):
            raise ValueError(
                "Fixture root ancestor must be an ordinary protected directory"
            )
    metadata = root.stat()
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or stat.S_IMODE(metadata.st_mode) != 0o700
        or metadata.st_uid != os.getuid()
        or (empty and any(root.iterdir()))
    ):
        raise ValueError("Fixture requires an owned empty mode-700 root")
    return metadata.st_dev, metadata.st_ino


def bounded_read(path: Path, maximum: int) -> bytes:
    if type(maximum) is not int or maximum < 1:
        raise ValueError("Evidence size bound must be positive")
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
        raise ValueError("Evidence requires an ordinary single-link file")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        opened = os.fstat(descriptor)
        if (
            (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino)
            or not stat.S_ISREG(opened.st_mode)
            or opened.st_nlink != 1
            or opened.st_uid != os.getuid()
            or opened.st_mode & 0o022
            or opened.st_size > maximum
        ):
            raise ValueError("Evidence identity/size bound")
        data = os.read(descriptor, maximum + 1)
        after = os.fstat(descriptor)
        named_after = path.lstat()
        fields = (
            "st_dev",
            "st_ino",
            "st_size",
            "st_mtime_ns",
            "st_ctime_ns",
            "st_mode",
            "st_uid",
            "st_nlink",
        )
        if len(data) != opened.st_size or any(
            getattr(opened, field) != getattr(metadata, field)
            for metadata in (before, after, named_after)
            for field in fields
        ):
            raise ValueError("Evidence changed while read")
        return data
    finally:
        os.close(descriptor)


def publication_ready(path: Path) -> bool:
    """A directory marker appears only after the payload's temporary link is gone."""
    private_root(path.parent)
    marker = path.with_name(path.name + ".ready")
    try:
        metadata = marker.lstat()
    except FileNotFoundError:
        return False
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or stat.S_IMODE(metadata.st_mode) != 0o700
        or metadata.st_uid != os.getuid()
        or any(marker.iterdir())
    ):
        raise ValueError("Invalid publication completion marker")
    return True


def publish(path: Path, value: dict) -> None:
    private_root(path.parent)
    raw = json.dumps(value, sort_keys=True).encode()
    if len(raw) > MAX_SNAPSHOT_BYTES:
        raise ValueError("Snapshot byte bound")
    write_once(path, raw)
    # write_once exposes its destination before unlinking the temporary name.
    # Keep strict single-link reads and signal completion separately, without
    # another hardlink-published file introducing the same readiness race.
    if bounded_read(path, MAX_SNAPSHOT_BYTES) != raw:
        raise ValueError("Published evidence differs from owned bytes")
    path.with_name(path.name + ".ready").mkdir(mode=0o700)
    sync_directory(path.parent)


def damage(fault: str, completed: bytes) -> bytes:
    if fault not in FAULTS or not completed.endswith(b"\n"):
        raise ValueError("Unknown fault or incomplete completion")
    if fault in {"torn-tail", "abandoned-tail"}:
        return completed[: len(completed) // 2]
    if fault == "oversized-line":
        return b"x" * (64 * 1024) + b"\n" + completed
    return b"x" * (64 * 1024)


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def latest(root: Path) -> dict:
    private_root(root)
    marker = json.loads(bounded_read(root / "fixture.json", 4096))
    if list(private_root(root)) != marker["rootIdentity"]:
        raise ValueError("Fixture root replaced")
    snapshots = [
        phase
        for phase in range(4)
        if publication_ready(root / f"snapshot-{phase}.json")
    ]
    if not snapshots or snapshots != list(range(max(snapshots) + 1)):
        raise ValueError("Missing monotone fixture snapshots")
    value = json.loads(
        bounded_read(root / f"snapshot-{max(snapshots)}.json", MAX_SNAPSHOT_BYTES)
    )
    if (
        value["fixtureId"] != marker["fixtureId"]
        or type(value["phase"]) is not int
        or value["phase"] != max(snapshots)
    ):
        raise ValueError("Snapshot ownership/phase mismatch")
    return value


def queue_command(root: Path, phase: int) -> dict:
    if type(phase) is not int or phase not in {1, 2, 3}:
        raise ValueError("Invalid private command phase")
    previous = latest(root)
    if previous["phase"] != phase - 1:
        raise ValueError("Private command would regress or skip phase")
    request = {
        "fixtureId": previous["fixtureId"],
        "phase": phase,
        "previousSha256": digest(
            bounded_read(root / f"snapshot-{phase - 1}.json", MAX_SNAPSHOT_BYTES)
        ),
    }
    publish(root / f"command-{phase}.json", request)
    return {"queuedPhase": phase}


def install_lap_counter(session):
    original = session.controller.reconcile_once
    session.journal_fixture_laps = 0

    def counted():
        result = original()
        session.journal_fixture_laps += 1
        return result

    session.controller.reconcile_once = counted


async def until(predicate, *, seconds=15):
    async with asyncio.timeout(seconds):
        while not await predicate():
            await asyncio.sleep(0.02)


class JournalScenario:
    def __init__(self, root: Path, services: HostedServices, fixture_id: str):
        self.root, self.services, self.fixture_id = root, services, fixture_id
        self.sources = {}
        self.phase = -1
        self.identity = private_root(root)

    def guard(self):
        if private_root(self.root) != self.identity:
            raise ValueError("Owned fixture root changed")

    async def laps(self):
        return await self.services.host.call(lambda s: s.journal_fixture_laps)

    async def wait_laps(self):
        start = await self.laps()

        async def reached():
            return await self.laps() >= start + 3

        await until(reached)
        return start

    async def seed(self):
        await self.services.host.call(install_lap_counter)
        for fault in FAULTS:
            plan = await self.services.run_service.plan(
                {
                    "backend": "local",
                    "operation": "train",
                    "config": {},
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
                f"journal-browser-{fault}",
            )
            await self.services.run_service.submit(plan.plan_id)

            async def bound(run_id=plan.run_id):
                view = await self.services.run_service.get(run_id)
                return view.attempt == 1 and view.state == "terminal_unknown"

            await until(bound)
            layout = RunLayout(self.root / "runs" / plan.run_id, plan.run_id)
            with JournalWriter(layout, attempt=1) as writer:
                hello = writer.append(
                    "hello",
                    asdict(
                        HelloPayload(
                            1,
                            1,
                            "fixture",
                            sys.version.split()[0],
                            "cpu",
                            ["train"],
                            sys.executable,
                            prefix=sys.prefix,
                            base_prefix=sys.base_prefix,
                        )
                    ),
                )

            async def committed(run_id=plan.run_id):
                return await self.services.host.call(
                    lambda s: s.registry.cursor(run_id, 1) == 0
                )

            await until(committed)
            prefix = bounded_read(layout.journal(1), MAX_JOURNAL_BYTES)
            completed = encode(
                Envelope(
                    plan.run_id,
                    1,
                    "exit",
                    1,
                    "2026-10-13T00:00:00Z",
                    {"status": "completed", "code": 0},
                )
            )
            self.sources[fault] = {
                "plan": plan,
                "layout": layout,
                "hello": hello,
                "prefix": prefix,
                "completion": completed,
                "damaged": damage(fault, completed),
            }
            await self.services.host.call(
                lambda _, source=self.sources[fault]: self.append(
                    source, source["damaged"], source["prefix"]
                )
            )
        start = await self.wait_laps()
        return await self.snapshot(0, start)

    def append(self, source, suffix: bytes, expected: bytes):
        self.guard()
        path = source["layout"].journal(1)
        if bounded_read(path, MAX_JOURNAL_BYTES) != expected:
            raise ValueError("Journal append proof differs from owned source")
        before = path.lstat()
        descriptor = os.open(
            path, os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW | os.O_NONBLOCK
        )
        try:
            opened = os.fstat(descriptor)
            if (
                (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino)
                or opened.st_size != len(expected)
                or opened.st_nlink != 1
                or opened.st_uid != os.getuid()
                or opened.st_mode & 0o022
                or len(expected) + len(suffix) > MAX_JOURNAL_BYTES
            ):
                raise ValueError("Journal replaced before append")
            with os.fdopen(descriptor, "ab", closefd=False) as stream:
                stream.write(suffix)
                stream.flush()
                os.fsync(descriptor)
        finally:
            os.close(descriptor)
        if bounded_read(path, MAX_JOURNAL_BYTES) != expected + suffix:
            raise ValueError("Journal append did not retain exact owned bytes")

    async def snapshot(self, phase, start):
        self.guard()
        cases = {}
        for fault, source in self.sources.items():
            plan = source["plan"]

            def owner(session, plan=plan):
                bookmark = session.ingestor._bookmarks.get((plan.run_id, 1))
                connection = session.registry._connection
                return {
                    "registry": asdict(session.registry.get(plan.run_id)),
                    "cursors": [
                        list(row)
                        for row in connection.execute(
                            "SELECT attempt,seq FROM cursors WHERE run_id=? ORDER BY attempt",
                            (plan.run_id,),
                        )
                    ],
                    "events": [
                        json.loads(row[0])
                        for row in connection.execute(
                            "SELECT event_json FROM event_log WHERE run_id=? ORDER BY attempt,seq LIMIT 4",
                            (plan.run_id,),
                        )
                    ],
                    "bookmark": asdict(bookmark) if bookmark else None,
                    "execution": asdict(session.runs.execution_store.get(plan.plan_id)),
                    "publicRunView": session.runs.get(plan.run_id).to_dict(),
                }

            case = await self.services.host.call(owner)
            raw = bounded_read(source["layout"].journal(1), MAX_JOURNAL_BYTES)
            prefix, completion, damaged = (
                source[key] for key in ("prefix", "completion", "damaged")
            )
            expected = prefix + (
                completion if phase >= 2 and fault == "torn-tail" else damaged
            )
            if raw != expected:
                raise ValueError(
                    "Journal changed outside exact fault/recovery operation"
                )
            recovered = phase >= 2 and fault == "torn-tail"
            if (
                case["cursors"] != [[1, 1 if recovered else 0]]
                or case["registry"]["event_count"] != (2 if recovered else 1)
                or case["publicRunView"]["state"]
                != ("completed" if recovered else "terminal_unknown")
                or case["events"]
                != [asdict(source["hello"])]
                + (
                    [
                        asdict(
                            Envelope(
                                plan.run_id,
                                1,
                                "exit",
                                1,
                                "2026-10-13T00:00:00Z",
                                {"status": "completed", "code": 0},
                            )
                        )
                    ]
                    if recovered
                    else []
                )
            ):
                raise ValueError(
                    "Authoritative state/cursor/events differ from fault expectation"
                )
            case["registry"] = {
                "state": case["registry"]["state"],
                "eventCount": case["registry"]["event_count"],
                "attempt": case["registry"]["attempt"],
            }
            case.update(
                {
                    "runId": plan.run_id,
                    "planId": plan.plan_id,
                    "requestId": plan.request_id,
                }
            )
            case["journal"] = {
                "bytes": len(raw),
                "sha256": digest(raw),
                "rawHex": raw.hex(),
                "prefixBytes": len(prefix),
                "prefixSha256": digest(prefix),
                "completionHex": completion.hex(),
                "damagedBytes": len(damaged),
                "faultSha256": digest(prefix + damaged),
            }
            cases[fault] = case
        health = await self.services.health()
        for fault, case in cases.items():
            has_error = {"source": case["planId"], "error": "ProtocolError"} in health[
                "monitoring_errors"
            ]
            if has_error != fault.startswith("oversized"):
                raise ValueError(
                    "Monitoring error differs from journal framing expectation"
                )
        snapshot = {
            "scope": "real-journal-bytes",
            "limitation": LIMITATION,
            "fixtureId": self.fixture_id,
            "phase": phase,
            "laps": await self.laps(),
            "phaseStartLaps": start,
            "atMs": time.time_ns() / 1000000,
            "cases": cases,
            "health": health,
        }
        publish(self.root / f"snapshot-{phase}.json", snapshot)
        self.phase = phase
        return snapshot

    async def advance(self, phase):
        self.guard()
        if phase != self.phase + 1 or phase not in {1, 2, 3}:
            raise ValueError("Private control regressed or skipped")
        if phase == 1:
            await self.services.host.call(lambda s: s.ingestor._readers.clear())
        elif phase == 2:
            source = self.sources["torn-tail"]
            await self.services.host.call(
                lambda _: self.append(
                    source,
                    source["completion"][len(source["completion"]) // 2 :],
                    source["prefix"] + source["damaged"],
                )
            )

            async def completed():
                return (
                    await self.services.run_service.get(source["plan"].run_id)
                ).state == "completed"

            await until(completed)
        elif phase == 3:
            await self.services.run_service.submit(
                self.sources["torn-tail"]["plan"].plan_id
            )
        return await self.snapshot(phase, await self.wait_laps())

    async def controls(self):
        for phase in range(1, 4):
            path = self.root / f"command-{phase}.json"
            while not publication_ready(path):
                self.guard()
                await asyncio.sleep(0.05)
            request = json.loads(bounded_read(path, 4096))
            previous = bounded_read(
                self.root / f"snapshot-{phase - 1}.json", MAX_SNAPSHOT_BYTES
            )
            if (
                not isinstance(request, dict)
                or type(request.get("phase")) is not int
                or request
                != {
                    "fixtureId": self.fixture_id,
                    "phase": phase,
                    "previousSha256": digest(previous),
                }
            ):
                raise ValueError("Foreign or changed private fixture command")
            await self.advance(phase)
            print(f"Phase: {phase}", flush=True)


async def serve(root: Path, token_file: Path, port=0):
    if type(port) is not int or not 0 <= port <= 65535:
        raise ValueError("Port bound")
    identity = private_root(root, empty=True)
    credential = bounded_read(token_file, 4096)
    token = read_fixture_token(token_file, root)
    if credential != token.encode("ascii"):
        raise ValueError("Fixture credential changed while being read")
    fixture_id = str(uuid4())
    publish(
        root / "fixture.json",
        {
            "fixtureId": fixture_id,
            "rootIdentity": list(identity),
            "buildId": __version__,
            "scope": "real-journal-bytes",
            "limitation": LIMITATION,
        },
    )
    settings = Settings(root / "state", root / "runs")
    services = HostedServices(
        settings,
        backend_factory=lambda lock: {
            "local": TerminalLocal(
                dispatch_lock=lock,
                owner="journal-browser",
                supervisor=StartupSupervisor(),
            )
        },
    )
    scenario = JournalScenario(root, services, fixture_id)
    bootstrap = BootstrapCredentials(token)
    control_task = None
    failure = None
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", port))
        listener.listen(128)
        listener.setblocking(False)
        host = f"127.0.0.1:{listener.getsockname()[1]}"
        app = create_app(
            settings,
            token=token,
            daemon_id="journal-browser",
            build_id=__version__,
            services=services,
            bootstrap_credentials=bootstrap,
            allowed_hosts=(host,),
        )

        class Server(uvicorn.Server):
            async def startup(self, sockets=None):
                nonlocal control_task
                await super().startup(sockets=sockets)
                await scenario.seed()
                control_task = asyncio.create_task(scenario.controls())
                for fault, source in scenario.sources.items():
                    print(f"Run: {fault} {source['plan'].run_id}", flush=True)
                print(f"Evidence: {root / 'snapshot-0.json'}", flush=True)
                print(
                    f"Browser: http://{host}/?bootstrap={bootstrap.mint()}", flush=True
                )
                print("Phase: 0", flush=True)

        server = Server(
            uvicorn.Config(
                app, log_level="error", access_log=False, timeout_graceful_shutdown=5
            )
        )

        async def guarded():
            nonlocal failure
            if control_task is not None:
                try:
                    await control_task
                except asyncio.CancelledError:
                    raise
                except Exception as error:
                    failure = type(error).__name__
                    server.should_exit = True

        monitor = None
        try:

            async def monitor_after_start():
                while control_task is None:
                    await asyncio.sleep(0.02)
                await guarded()

            monitor = asyncio.create_task(monitor_after_start())
            await server.serve(sockets=[listener])
        finally:
            for task in (control_task, monitor):
                if task is not None:
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
            print("Fixture: control-drained", flush=True)
            await services.close()
            print("Fixture: services-closed", flush=True)
        if failure:
            raise RuntimeError(f"Private fixture control failed: {failure}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--token-file", type=Path)
    parser.add_argument("--port", type=int, default=0)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--inspect", action="store_true")
    mode.add_argument("--clear-readers", action="store_true")
    mode.add_argument("--recover-torn", action="store_true")
    mode.add_argument("--stabilize", action="store_true")
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("Port bound")
    if args.inspect:
        print(json.dumps(latest(args.root)))
    elif args.clear_readers or args.recover_torn or args.stabilize:
        print(
            json.dumps(
                queue_command(
                    args.root,
                    1 if args.clear_readers else 2 if args.recover_torn else 3,
                )
            )
        )
    else:
        if args.token_file is None:
            parser.error("--token-file is required when serving")
        try:
            asyncio.run(serve(args.root, args.token_file, args.port))
        except KeyboardInterrupt:
            return


if __name__ == "__main__":
    main()
