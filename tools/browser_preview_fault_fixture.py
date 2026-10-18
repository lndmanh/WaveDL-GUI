"""Real supervised preview child with bounded fixture-only phase barriers."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import sys
import time
from pathlib import Path


def phase_child(root, phase, argv):
    ready = root / f".preview-ready-{phase}.json"
    ready.write_text(json.dumps({"phase": phase, "pid": os.getpid(), "argv": argv}))
    deadline = time.monotonic() + 45
    while phase in (1, 2, 5) and not (root / f".preview-release-{phase}").exists():
        if time.monotonic() >= deadline:
            raise TimeoutError("Fixture preview phase deadline")
        time.sleep(0.05)
    os.execv(argv[0], argv)


def snapshot(root, names=("samples.npz", "samples.mat", "samples.h5")):
    import sqlite3

    with sqlite3.connect(
        (root / "state/registry.db").resolve().as_uri() + "?mode=ro", uri=True
    ) as db:
        counts = {
            name: db.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]
            for name in (
                "plans",
                "plan_control",
                "execution_control",
                "submission_control",
                "runs",
                "runtime_provenance",
                "event_log",
            )
        }
    sources = {}
    for name in names:
        path = root / name
        before = path.lstat()
        if path.is_symlink() or not path.is_file() or before.st_size > 64 * 1024 * 1024:
            raise ValueError("Bounded ordinary source required")
        with os.fdopen(
            os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb"
        ) as stream:
            opened = os.fstat(stream.fileno())
            if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
                raise ValueError("Source changed before open")
            raw = stream.read(64 * 1024 * 1024 + 1)
            after = os.fstat(stream.fileno())
            if (len(raw), after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (
                opened.st_size,
                opened.st_size,
                opened.st_mtime_ns,
                opened.st_ctime_ns,
            ):
                raise ValueError("Source changed while reading")
        sources[name] = {"size": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    stat = (root / "samples.npz").stat()
    return {
        "counts": counts,
        "sources": sources,
        "identity": {
            "st_dev": stat.st_dev,
            "st_ino": stat.st_ino,
            "st_size": stat.st_size,
            "st_mtime_ns": stat.st_mtime_ns,
        },
    }


async def serve(
    root,
    token_file,
    *,
    command_factory=None,
    configure=None,
    capture_output=False,
    max_phases=6,
):
    """Serve supervised previews with optional fixture-only instrumentation hooks."""
    from dataclasses import replace
    from threading import Lock

    import browser_daemon_fixture

    from wavedl_daemon.runs import preview_service

    original_command = preview_service.run_command
    phase = 0
    lock = Lock()

    def controlled_command(spec, budget, *, token):
        nonlocal phase
        with lock:
            phase += 1
            current = phase
        original_argv = list(spec.argv)
        if current > max_phases:
            raise ValueError("Fixture preview phase count exceeded")
        if command_factory is not None:
            spec = replace(spec, argv=command_factory(root, current, original_argv))
        elif current <= 6:
            spec = replace(
                spec,
                argv=(
                    sys.executable,
                    str(Path(__file__).resolve()),
                    "--phase-child",
                    str(root),
                    str(current),
                    json.dumps(original_argv),
                ),
            )
        result = original_command(spec, budget, token=token)
        ready = root / f".preview-ready-{current}.json"
        proof = {
            "phase": current,
            "returncode": result.returncode,
            "cancelled": result.cancelled,
            "timedOut": result.timed_out,
            "stdoutTruncated": result.stdout_truncated,
            "originalArgv": original_argv,
            "stdoutSha256": hashlib.sha256(result.stdout).hexdigest(),
            "stdoutBytes": len(result.stdout),
        }
        if capture_output:
            proof["stdoutText"] = result.stdout.decode("utf-8", errors="strict")
        if ready.exists():
            proof["pid"] = json.loads(ready.read_bytes())["pid"]
            try:
                os.kill(proof["pid"], 0)
                proof["pidAbsent"] = False
            except ProcessLookupError:
                proof["pidAbsent"] = True
        with lock, (root / ".preview-processes.jsonl").open("a") as stream:
            stream.write(json.dumps(proof) + "\n")
        return result

    preview_service.run_command = controlled_command
    original_app = browser_daemon_fixture.create_app

    def capture_app(*args, **kwargs):
        if configure is not None:
            configure(root)
        app = original_app(*args, **kwargs)
        services = kwargs["services"]
        ordinary_close = services.close

        async def capacity_probe():
            while True:
                (root / ".preview-capacity.json").write_text(
                    json.dumps(
                        {"phase": phase, "outstanding": services.pool.outstanding}
                    )
                )
                await asyncio.sleep(0.05)

        capacity_task = asyncio.create_task(capacity_probe())

        async def proven_close():
            await ordinary_close()
            capacity_task.cancel()
            # No await after ordinary_close: Uvicorn re-raises SIGINT after
            # lifespan shutdown, cancelling this outer fixture task. The
            # observer owns no resources and its cancellation is drained by
            # asyncio.run; a second await here can mask the closure marker.
            (root / ".preview-drained.json").write_text(
                json.dumps({"outstanding": services.pool.outstanding})
            )

        services.close = proven_close

        async def captured(scope, receive, send):
            if scope["type"] != "http" or scope["path"] != "/api/datasets/preview":
                return await app(scope, receive, send)
            request, response = bytearray(), bytearray()
            status = None
            request_complete = response_complete = False

            async def capture_receive():
                nonlocal request_complete
                message = await receive()
                if message["type"] == "http.request":
                    request_complete = not message.get("more_body", False)
                    request.extend(message.get("body", b""))
                    if len(request) > 65536:
                        raise ValueError("Request bound")
                return message

            async def capture_send(message):
                nonlocal status, response_complete
                if message["type"] == "http.response.start":
                    status = message["status"]
                if message["type"] == "http.response.body":
                    response_complete = not message.get("more_body", False)
                    response.extend(message.get("body", b""))
                    if len(response) > 1048576:
                        raise ValueError("Response bound")
                await send(message)

            try:
                await app(scope, capture_receive, capture_send)
            finally:
                try:
                    request_value = json.loads(request) if request else None
                except (ValueError, TypeError):
                    request_value = None
                try:
                    response_value = json.loads(response) if response else None
                except (ValueError, TypeError):
                    response_value = None
                with (root / ".preview-responses.jsonl").open("a") as stream:
                    if stream.tell() > 2 * 1024 * 1024:
                        raise ValueError("Fixture capture exceeds bound")
                    stream.write(
                        json.dumps(
                            {
                                "method": scope["method"],
                                "path": scope["path"],
                                "request": request_value,
                                "requestText": request.decode("utf-8", errors="strict"),
                                "requestSha256": hashlib.sha256(request).hexdigest(),
                                "requestBytes": len(request),
                                "requestComplete": request_complete,
                                "status": status,
                                "response": response_value,
                                "responseText": response.decode(
                                    "utf-8", errors="strict"
                                ),
                                "responseSha256": hashlib.sha256(response).hexdigest(),
                                "responseBytes": len(response),
                                "responseComplete": response_complete,
                            }
                        )
                        + "\n"
                    )

        return captured

    browser_daemon_fixture.create_app = capture_app
    await browser_daemon_fixture.serve_fixture(
        root, 1, 0, seed_run=False, token_file=token_file
    )


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--phase-child":
        phase_child(Path(sys.argv[2]), int(sys.argv[3]), json.loads(sys.argv[4]))
        return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--token-file", type=Path)
    parser.add_argument("--inspect", action="store_true")
    args = parser.parse_args()
    if args.inspect:
        print(json.dumps(snapshot(args.root)))
    else:
        asyncio.run(serve(args.root, args.token_file))


if __name__ == "__main__":
    main()
