"""One real supervised HEADER deadline, followed by an unmodified inspector.

Only the first inspector command is replaced, at the fixture's command seam.
No HTTP response, authentication, authority, pool, or supervisor is mocked.
The controlled child deliberately spawns no descendants.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import threading
import time
from dataclasses import replace
from pathlib import Path


def absent(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return True
    return False


def install(root, original, pool):
    """Return an observed real-command wrapper; caller owns restoration."""
    from wavedl_daemon.supervision.posix import POSIXSupervisor

    control = root / ".header-deadline-control"
    evidence = root / ".header-deadline-commands.jsonl"
    lock = threading.Lock()
    sequence = 0

    def controlled(spec, budget, *, token):
        nonlocal sequence
        assert spec.argv[1:3] == ("-m", "wavedl.core.dataset_headers")
        with lock:
            sequence += 1
            current = sequence
            stall = control.exists()
            if stall:
                if control.is_symlink() or control.read_bytes() != b"stall-once":
                    raise ValueError("Invalid owned deadline control")
                control.unlink()
        # Real retries retain their original argv and normal production budget.
        deadline = 2.0 if stall else budget.timeout_seconds
        authority_identity_present = "--expected-identity" in spec.argv
        if stall:
            spec = replace(
                spec,
                argv=(sys.executable, str(Path(__file__).resolve()), "--stall-child"),
            )
        started = time.monotonic()
        receipt = {
            "sequence": current,
            "controlled": stall,
            "deadline": deadline,
            "originalModule": "wavedl.core.dataset_headers",
            "authorityIdentityPresent": authority_identity_present,
        }

        class Observer:
            def start(self, child_spec, *, output_limit):
                child = POSIXSupervisor().start(child_spec, output_limit=output_limit)
                receipt["pid"] = child.pid
                return child

        result = original(
            spec,
            replace(budget, timeout_seconds=deadline),
            token=token,
            supervisor=Observer(),
        )
        receipt.update(
            elapsed=time.monotonic() - started,
            timedOut=result.timed_out,
            cancelled=result.cancelled,
            returncode=result.returncode,
            pidAbsent=absent(receipt["pid"]),
            poolOutstandingBeforeReturn=pool.outstanding,
            stdout=result.stdout.decode("utf-8"),
            stderr=result.stderr.decode("utf-8"),
            descendantsSpawned=False,
        )
        with lock, evidence.open("a", encoding="utf-8") as stream:
            if evidence.stat().st_size > 262144:
                raise ValueError("Deadline evidence exceeds bound")
            stream.write(json.dumps(receipt) + "\n")
        return result

    return controlled


def observe_http(app, root, services):
    async def wrapped(scope, receive, send):
        if scope.get("type") != "http" or not scope.get("path", "").startswith("/api/"):
            return await app(scope, receive, send)
        endpoint = scope["path"]
        inspect = endpoint == "/api/datasets/inspect"
        mutation = (
            scope.get("method") not in {"GET", "HEAD"} and endpoint != "/api/bootstrap"
        )
        if not inspect and not mutation:
            return await app(scope, receive, send)
        record = {
            "endpoint": endpoint,
            "method": scope["method"],
            "browser": any(
                k.lower() == b"user-agent" and b"Chrome/" in v
                for k, v in scope.get("headers", [])
            ),
        }
        body = bytearray()

        async def observed(message):
            if message["type"] == "http.response.start":
                record["status"] = message["status"]
            if message["type"] == "http.response.body":
                body.extend(message.get("body", b""))
                if len(body) > 262144:
                    raise ValueError("HTTP evidence exceeds bound")
            await send(message)

        await app(scope, receive, observed)
        record["response"] = json.loads(body) if inspect else None
        record["poolOutstandingAfterResponse"] = await services.host.call(
            lambda s: s.pool.outstanding
        )
        with (root / ".header-deadline-http.jsonl").open(
            "a", encoding="utf-8"
        ) as stream:
            stream.write(json.dumps(record) + "\n")

    return wrapped


async def serve(root, token_file):
    try:
        from tools import browser_daemon_fixture as base
    except ModuleNotFoundError:
        import browser_daemon_fixture as base
    from wavedl_daemon.runs import inspection

    original_app, original_command = base.create_app, inspection.run_command

    def create_app(*args, **kwargs):
        app = original_app(*args, **kwargs)
        services = kwargs["services"]

        async def wrapped(scope, receive, send):
            # Host initializes on lifespan startup; install only after startup.
            if (
                scope.get("type") == "http"
                and inspection.run_command is original_command
            ):
                pool = await services.host.call(lambda s: s.pool)
                inspection.run_command = install(root, original_command, pool)
            await observe_http(app, root, services)(scope, receive, send)

        return wrapped

    base.create_app = create_app
    try:
        await base.serve_fixture(root, 1, 0, seed_run=False, token_file=token_file)
    finally:
        base.create_app, inspection.run_command = original_app, original_command


def main():
    if sys.argv[1:] == ["--stall-child"]:
        # Sentinel proves the actual child executed, not a synthetic timeout.
        print("owned-header-stall-child-ready", flush=True)
        time.sleep(60)
        raise RuntimeError("Finite deadline failed to terminate controlled child")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--token-file", type=Path)
    parser.add_argument("--inspect", action="store_true")
    args = parser.parse_args()
    if args.inspect:
        try:
            from tools.browser_preview_fault_fixture import snapshot
        except ModuleNotFoundError:
            from browser_preview_fault_fixture import snapshot
        print(json.dumps(snapshot(args.root)))
    else:
        asyncio.run(serve(args.root, args.token_file))


if __name__ == "__main__":
    main()
