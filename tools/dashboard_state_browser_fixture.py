"""Authenticated boundary-injected dashboard states; not real Slurm acceptance.

The ordinary daemon owns real CPU work, authentication, static assets and SSE.
Only successful list/detail lifecycle JSON is replaced with pure-reducer output.
The private stage file advances monotonically after each public DOM observation.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path

from wavedl.core.layout import OperationKind
from wavedl.core.protocol import Envelope
from wavedl_daemon.backends.contracts import (
    BackendObservation,
    Handle,
    ObservationStatus,
)
from wavedl_daemon.runs.reducer import RunIntent, SubmissionState, reduce


STAGES = (
    ("queued", "queued", 1, False, True),
    ("held", "held", 1, False, True),
    ("running", "running", 1, False, False),
    ("accounting-unavailable", "error", 1, False, False),
    ("accounting-absent", "absent", 1, False, False),
    ("delayed-terminal", "running", 1, True, False),
    ("lifecycle-stale", "error", 1, False, False),
    ("restart-pending", "queued", 2, False, True),
    ("restart-running", "running", 2, False, False),
    ("supervision-lost", "supervision_lost", 2, False, False),
)


def project(source, stage):
    name, status, attempt, exited, pending = STAGES[stage]
    run_id, request_id = source["run_id"], source["request_id"]
    handle = Handle("slurm", run_id, request_id, attempt, "qa", "/unused", job_id="123")
    intent = RunIntent(
        run_id, OperationKind.TRAIN, attempt, "slurm", SubmissionState.SUBMITTED, handle
    )
    observation = BackendObservation(attempt, ObservationStatus(status), detail=name)
    events = (
        [
            Envelope(
                run_id,
                attempt,
                "exit",
                1,
                "2026-10-13T00:00:00Z",
                {"code": 0, "status": "completed"},
            )
        ]
        if exited
        else []
    )
    derived = reduce(intent, events, observation)
    evidence = {
        "native_pending": pending,
        "native_identity": {
            "cluster": "qa",
            "job_id": "123",
            "owner": "qa",
            "restart_count": attempt - 1,
            "run_id": run_id,
            "request_id": request_id,
        },
        "current_runtime_attempt": None if pending else attempt,
        "confidence": derived.confidence,
        "reason": derived.reason,
        "runtime": asdict(derived.runtime),
        "backend": asdict(derived.backend) if derived.backend else None,
        "last_observation": None,
        "batch": None,
        "stage_out": None,
    }
    return {
        **source,
        "backend": "slurm",
        "attempt": attempt,
        "state": derived.state.value,
        "uncertainty": derived.confidence != "confirmed",
        "evidence": evidence,
    }


def boundary_wrapper(app, stage_file: Path, evidence_file: Path):
    records = []
    mutations = []
    current = 0

    async def wrapped(scope, receive, send):
        nonlocal current
        path = scope.get("path", "")
        if (
            scope.get("type") == "http"
            and scope.get("method") != "GET"
            and path.startswith("/api/runs")
        ):
            mutations.append({"method": scope["method"], "path": path})
            evidence_file.write_text(
                json.dumps(
                    {
                        "scope": "authenticated-response-injection",
                        "records": records,
                        "mutations": mutations,
                    }
                ),
                encoding="utf-8",
            )
        lifecycle = (
            scope.get("type") == "http"
            and scope.get("method") == "GET"
            and (
                path == "/api/runs"
                or (path.startswith("/api/runs/") and path.count("/") == 3)
            )
        )
        if not lifecycle:
            await app(scope, receive, send)
            return
        messages = []

        async def capture(message):
            messages.append(message)

        await app(scope, receive, capture)
        if not messages or messages[0].get("status") != 200:
            for message in messages:
                await send(message)
            return
        raw = b"".join(message.get("body", b"") for message in messages)
        if len(raw) > 1048576:
            raise ValueError("Lifecycle response budget")
        stage = int(stage_file.read_text(encoding="ascii"))
        if not current <= stage <= min(current + 1, len(STAGES) - 1):
            raise ValueError("Dashboard stage regressed or skipped")
        current = stage
        body = json.loads(raw)
        if path == "/api/runs":
            body["runs"] = [project(run, stage) for run in body["runs"]]
        else:
            body = project(body, stage)
            if len(records) >= 512:
                raise ValueError("Dashboard evidence budget")
            records.append(
                {
                    "stage": stage,
                    "name": STAGES[stage][0],
                    "path": path,
                    "status": 200,
                    "view": body,
                }
            )
            if STAGES[stage][0] == "lifecycle-stale":
                records[-1]["status"] = 503
            evidence_file.write_text(
                json.dumps(
                    {
                        "scope": "authenticated-response-injection",
                        "records": records,
                        "mutations": mutations,
                    }
                ),
                encoding="utf-8",
            )
        if STAGES[stage][0] == "lifecycle-stale" and path != "/api/runs":
            await send(
                {
                    "type": "http.response.start",
                    "status": 503,
                    "headers": [(b"content-type", b"application/json")],
                }
            )
            await send(
                {
                    "type": "http.response.body",
                    "body": b'{"error":"controlled lifecycle timeout"}',
                }
            )
            return
        payload = json.dumps(body).encode("utf-8")
        headers = [
            (key, value)
            for key, value in messages[0]["headers"]
            if key.lower() != b"content-length"
        ]
        headers.append((b"content-length", str(len(payload)).encode("ascii")))
        await send({**messages[0], "headers": headers})
        await send({"type": "http.response.body", "body": payload})

    return wrapped


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    args, rest = parser.parse_known_args()
    import browser_daemon_fixture as base

    original = base.create_app
    base.create_app = lambda *values, **options: boundary_wrapper(
        original(*values, **options), args.stage, args.evidence
    )
    import sys

    sys.argv = [sys.argv[0], *rest]
    base.main()


if __name__ == "__main__":
    main()
