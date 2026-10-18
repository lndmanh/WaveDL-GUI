"""Real two-attempt CPU journals, controlled ingestion, genuine broker overflow.

Only journal ingestion timing and subscriber capacity are controlled. HTTP frames
and cursor values are never manufactured, replaced, fragmented, or suppressed.
The public adoption API authorizes historical lineage; this is not live requeue.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sqlite3
import threading
import time
from pathlib import Path

from wavedl_daemon.events.broker import EventBroker
from wavedl_daemon.events.ingestion import Ingestor
from wavedl_daemon.runs import runtime_service


try:
    from tools import (
        browser_adoption_fixture as adoption,
        browser_daemon_fixture as base,
    )
    from tools.browser_adoption_rollover_fixture import rollover_source
except ModuleNotFoundError:
    import browser_adoption_fixture as adoption
    import browser_daemon_fixture as base
    from browser_adoption_rollover_fixture import rollover_source


class OverflowProofBroker(EventBroker):
    """Observe the production QueueFull branch without setting its state."""

    def __init__(self):
        super().__init__(queue_size=1)
        self.overflow_proof = None
        self.subscriptions = 0

    def subscribe(self, run_id):
        # Exactly the first subscriber is capacity constrained. A reconnect is
        # still bounded, but cannot repeatedly fail during controlled replay.
        self.queue_size = 1 if self.subscriptions == 0 else 4096
        subscription = super().subscribe(run_id)
        self.subscriptions += 1
        return subscription

    def _enqueue(self, subscription):
        before = {
            "capacity": subscription.queue.maxsize,
            "sizeBefore": subscription.queue.qsize(),
            "fullBefore": subscription.queue.full(),
            "memberBefore": subscription in self._subscribers,
            "closedBefore": subscription.closed,
            "overflowedBefore": subscription.overflowed,
        }
        super()._enqueue(subscription)
        if before["fullBefore"] and not before["closedBefore"]:
            if self.overflow_proof is not None:
                raise RuntimeError("Only one genuine overflow is permitted")
            self.overflow_proof = {
                **before,
                "closedAfter": subscription.closed,
                "overflowedAfter": subscription.overflowed,
                "memberAfter": subscription in self._subscribers,
            }


def controlled_ingestor(released: threading.Event):
    """Delay real immutable journal ingestion until one frame is forwarded."""

    class ControlledIngestor(Ingestor):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs, page_size=1, max_pages=1)

        async def poll_once(self, plan_id, run_id, attempt, path, **kwargs):
            # Preflight can read exactly attempt-1 HELLO. Every subsequent row
            # still goes through normal full journal verification, negotiation,
            # owner-thread SQLite transaction, and production broker.notify.
            if not released.is_set() and (
                attempt != 1 or self.registry.cursor(run_id, 1) >= 0
            ):
                return self.registry.cursor(run_id, attempt)
            if attempt == 2:
                historical = Path(path).parent.parent / "1/events.jsonl"
                if historical.is_symlink() or historical.stat().st_size > 8388608:
                    raise ValueError("Historical journal exceeds fixture bound")
                last = json.loads(historical.read_bytes().splitlines()[-1])
                if self.registry.cursor(run_id, 1) != last["seq"]:
                    return self.registry.cursor(run_id, attempt)
            return await super().poll_once(plan_id, run_id, attempt, path, **kwargs)

    return ControlledIngestor


def overflow_boundary(app, services, root, evidence, released):
    """Pass through every original ASGI message; pause only first data send."""
    records = []

    def persist():
        evidence.write_text(
            json.dumps(
                {
                    "scope": "genuine-broker-capacity-overflow",
                    "records": records,
                    "queueFull": services.broker.overflow_proof,
                }
            ),
            encoding="utf-8",
        )

    async def wrapped(scope, receive, send):
        if not (
            scope.get("method") == "GET"
            and re.fullmatch(r"/api/runs/[0-9a-f-]{36}/events", scope.get("path", ""))
        ):
            return await app(scope, receive, send)
        if len(records) >= 2:
            raise RuntimeError("Stream connection count exceeds controlled budget")
        run_id = scope["path"].split("/")[3]
        deadline = time.monotonic() + 20
        while not released.is_set():
            with sqlite3.connect(
                (root / "state/registry.db").as_uri() + "?mode=ro", uri=True
            ) as connection:
                row = connection.execute(
                    "SELECT seq FROM cursors WHERE run_id=? AND attempt=1", (run_id,)
                ).fetchone()
            if row == (0,):
                break
            if time.monotonic() > deadline:
                raise RuntimeError("First genuine historical HELLO did not commit")
            await asyncio.sleep(0.02)
        headers = dict(scope.get("headers", []))
        record = {
            "path": scope["path"],
            "cursor": base.request_cursor_metadata(scope.get("query_string", b"")),
            "authenticated": b"authorization" in headers,
            "scoped": b"x-wavedl-daemon-id" in headers,
            "browser": b"Chrome/" in headers.get(b"user-agent", b""),
            "status": None,
            "forwardedIds": [],
            "overflowResume": None,
            "gate": None,
            "bytes": 0,
        }
        records.append(record)
        pending = b""

        async def observed_send(message):
            nonlocal pending
            await send(message)
            if message["type"] == "http.response.start":
                record["status"] = message["status"]
            if message["type"] != "http.response.body":
                return
            body = message.get("body", b"")
            record["bytes"] += len(body)
            if record["bytes"] > 16 * 1024 * 1024:
                raise RuntimeError("Stream evidence byte limit exceeded")
            pending += body
            if len(pending) > 262144:
                raise RuntimeError("Stream evidence frame limit exceeded")
            while b"\n\n" in pending:
                frame, pending = pending.split(b"\n\n", 1)
                # Protocol encoding may leave a blank separator before the
                # next control. This normalizes observation only, never send.
                frame = frame.lstrip(b"\n")
                match = re.search(rb"^id: ([0-9]+):([0-9]+)$", frame, re.M)
                if match:
                    record["forwardedIds"].append([int(match[1]), int(match[2])])
                if len(record["forwardedIds"]) > 4096:
                    raise RuntimeError("Stream event evidence limit exceeded")
                if frame.startswith(b"event: overflow\n"):
                    record["overflowResume"] = json.loads(frame.split(b"data: ")[1])[
                        "resumePosition"
                    ]
                if match and len(records) == 1 and not released.is_set():
                    if record["forwardedIds"] != [[1, 0]]:
                        raise RuntimeError("Initial replay must contain only HELLO")
                    record["gate"] = "original-first-frame-forwarded-generator-paused"
                    released.set()
                    deadline = time.monotonic() + 20
                    while services.broker.overflow_proof is None:
                        if time.monotonic() > deadline:
                            raise RuntimeError(
                                "Actual broker capacity was not exhausted"
                            )
                        await asyncio.sleep(0.01)
            persist()

        await app(scope, receive, observed_send)
        persist()

    return wrapped


def authority(root: Path):
    """Require the complete real journals to equal committed SQLite rows."""
    source = rollover_source(root)
    run_id = source["runId"]
    journals = []
    for number in (1, 2):
        path = root / "standalone/attempts" / str(number) / "events.jsonl"
        if path.is_symlink() or path.stat().st_size > 8 * 1024 * 1024:
            raise ValueError("Journal exceeds bounded ordinary file contract")
        journals.extend(json.loads(line) for line in path.read_bytes().splitlines())
    with sqlite3.connect(
        (root / "state/registry.db").as_uri() + "?mode=ro", uri=True
    ) as db:
        events = [
            json.loads(row[0])
            for row in db.execute(
                "SELECT event_json FROM event_log WHERE run_id=? ORDER BY attempt,seq",
                (run_id,),
            )
        ]
        cursors = dict(
            db.execute("SELECT attempt,seq FROM cursors WHERE run_id=?", (run_id,))
        )
    if events != journals:
        raise ValueError("Complete journal and durable event log disagree")
    return {
        "runId": run_id,
        "journalIds": [[event["attempt"], event["seq"]] for event in events],
        "cursors": cursors,
        "journalMatches": True,
        "metricCount": sum(event["type"] == "metric" for event in events),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--token-file", type=Path)
    parser.add_argument("--evidence", type=Path)
    parser.add_argument("--inspect", action="store_true")
    args = parser.parse_args()
    if args.inspect:
        print(json.dumps(authority(args.root)))
        return
    if not args.token_file or not args.evidence:
        parser.error("Private token file and evidence path required")
    original_command = base.run_command
    launched = False

    def launch_twice(spec, budget):
        nonlocal launched
        result = original_command(spec, budget)
        if not launched and result.returncode == 0:
            launched = True
            if original_command(spec, budget).returncode != 0:
                raise RuntimeError("Second real CPU launcher failed")
        return result

    released = threading.Event()
    base.run_command = launch_twice
    adoption.source_evidence = rollover_source
    runtime_service.EventBroker = OverflowProofBroker
    runtime_service.Ingestor = controlled_ingestor(released)
    original_app = base.create_app

    def create_app(*values, **options):
        return overflow_boundary(
            original_app(*values, **options),
            options["services"],
            args.root.resolve(),
            args.evidence,
            released,
        )

    base.create_app = create_app
    asyncio.run(
        base.serve_fixture(
            args.root,
            1,
            0,
            seed_run=False,
            token_file=args.token_file,
            standalone_adoption=True,
        )
    )


if __name__ == "__main__":
    main()
