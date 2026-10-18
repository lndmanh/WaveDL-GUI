"""Bounded fixture for a real two-attempt standalone run.

This deliberately composes the existing browser daemon fixture rather than
changing product code.  The launcher's normal writer allocation creates
attempt 1 and, on a second invocation against the same output directory,
attempt 2 with the same manifest/run identity.  The daemon's public adoption
API is then free to verify the active attempt while its stream service reads
the registered historical lineage.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sqlite3
import time
from pathlib import Path


try:
    from tools import (
        browser_adoption_fixture as adoption,
        browser_daemon_fixture as base,
    )
    from tools.browser_stream_fixture import boundary_wrapper
except ModuleNotFoundError:
    import browser_adoption_fixture as adoption
    import browser_daemon_fixture as base
    from browser_stream_fixture import boundary_wrapper


def rollover_source(root: Path) -> dict:
    """Return secret-free evidence for both real launcher attempts."""
    run = root / "standalone"
    manifest = json.loads((run / "manifest.json").read_bytes())
    attempts = {}
    for number in (1, 2):
        directory = run / "attempts" / str(number)
        identity = json.loads((directory / "runtime_identity.json").read_bytes())
        request = json.loads((directory / "runtime_request.json").read_bytes())
        journal = [
            json.loads(line)
            for line in (directory / "events.jsonl").read_bytes().splitlines()
        ]
        if identity["run_id"] != manifest["run_id"] or identity["attempt"] != number:
            raise ValueError("launcher attempt identity mismatch")
        if request["run_id"] != manifest["run_id"] or journal[-1]["type"] != "exit":
            raise ValueError("launcher attempt is not complete")
        attempts[str(number)] = {
            "runtimeRequest": request,
            "runtimeIdentity": identity,
            "journalExit": journal[-1],
            "eventIds": [[event["attempt"], event["seq"]] for event in journal],
        }
    return {"runId": manifest["run_id"], "manifest": manifest, "attempts": attempts}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--token-file", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    args = parser.parse_args()
    original = base.run_command
    launched = False

    def launch_twice(spec, budget):
        nonlocal launched
        result = original(spec, budget)
        if not launched and result.returncode == 0:
            launched = True
            second = original(spec, budget)
            if second.returncode != 0:
                raise RuntimeError("second standalone launcher attempt failed")
        return result

    base.run_command = launch_twice
    adoption.source_evidence = rollover_source
    original_app = base.create_app

    def create_app(*values, **options):
        app = boundary_wrapper(original_app(*values, **options), args.evidence)

        async def ready_history(scope, receive, send):
            if scope.get("method") == "GET" and scope.get("path", "").endswith(
                "/events"
            ):
                # Wait for genuine committed replay before the first stream. The
                # normal pump tails active before history; without this bounded
                # setup barrier the first live subscription can precede history.
                deadline = time.monotonic() + 15
                while True:
                    with sqlite3.connect(
                        (args.root / "state/registry.db").as_uri() + "?mode=ro",
                        uri=True,
                    ) as connection:
                        rows = connection.execute(
                            "SELECT attempt,seq FROM cursors WHERE run_id=?",
                            (scope["path"].split("/")[3],),
                        ).fetchall()
                    if {number for number, _ in rows} == {1, 2}:
                        break
                    if time.monotonic() >= deadline:
                        raise RuntimeError(
                            "genuine historical replay was not committed"
                        )
                    await asyncio.sleep(0.05)
            await app(scope, receive, send)

        return ready_history

    base.create_app = create_app
    asyncio.run(
        base.serve_fixture(
            args.root,
            1,
            0,
            seed_run=False,
            token_file=args.token_file,
            standalone_adoption=True,
            drop_adoption_ack=True,
        )
    )


if __name__ == "__main__":
    main()
