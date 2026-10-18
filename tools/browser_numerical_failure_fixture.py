"""Owned real-data fault files and bounded public GET recording; no API mocks."""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import sys
from pathlib import Path

import browser_daemon_fixture as fixture
import numpy as np


def evidence(root: Path) -> dict:
    connection = sqlite3.connect(
        (root / "state/registry.db").resolve().as_uri() + "?mode=ro", uri=True
    )
    connection.row_factory = sqlite3.Row
    runs = []
    for row in connection.execute("SELECT * FROM runs ORDER BY run_id"):
        run = dict(row)
        directory = root / "runs" / run["run_id"]
        run["files"] = {
            str(path.relative_to(directory)): {
                "size": path.stat().st_size,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            }
            for path in sorted(directory.rglob("*"))
            if path.is_file() and not path.is_symlink()
        }
        run["events"] = [
            json.loads(value[0])
            for value in connection.execute(
                "SELECT event_json FROM event_log WHERE run_id=? ORDER BY attempt,seq",
                (run["run_id"],),
            )
        ]
        run["manifest"] = json.loads((directory / "manifest.json").read_text())
        run["directories"] = [
            str(path.relative_to(directory))
            for path in sorted(directory.rglob("*"))
            if path.is_dir()
        ]
        run["publications"] = []
        for complete in sorted(directory.glob("checkpoints/*/COMPLETE.json")):
            publication = json.loads(complete.read_text())
            verified = {}
            for name, expected in publication["files"].items():
                body = (complete.parent / name).read_bytes()
                actual = {"size": len(body), "sha256": hashlib.sha256(body).hexdigest()}
                assert actual == expected
                verified[name] = actual
            run["publications"].append(
                {
                    "generation": complete.parent.name,
                    "complete": publication,
                    "completeSha256": hashlib.sha256(complete.read_bytes()).hexdigest(),
                    "verifiedFiles": verified,
                    "selectionMetadata": json.loads(
                        (complete.parent / "checkpoint_selection.json").read_text()
                    )
                    if (complete.parent / "checkpoint_selection.json").is_file()
                    else None,
                }
            )
        runtime = directory / "attempts/1/events.jsonl"
        run["runtimeEvents"] = (
            [json.loads(line) for line in runtime.read_text().splitlines()]
            if runtime.is_file()
            else []
        )
        runs.append(run)
    result = {
        "runs": runs,
        "plans": [dict(row) for row in connection.execute("SELECT * FROM plans")],
        "control": [
            dict(row) for row in connection.execute("SELECT * FROM plan_control")
        ],
        "executions": [
            dict(row) for row in connection.execute("SELECT * FROM execution_control")
        ],
        "provenance": [
            dict(row) for row in connection.execute("SELECT * FROM runtime_provenance")
        ],
    }
    connection.close()
    return result


def dataset_identity(path: Path) -> dict:
    with np.load(path) as archive:
        inputs = archive["X"]
        return {
            "size": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "shape": list(inputs.shape),
            "nanCount": int(np.isnan(inputs).sum()),
            "infCount": int(np.isinf(inputs).sum()),
            "keys": list(archive.files),
        }


if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "evidence":
    print(json.dumps(evidence(Path(sys.argv[2]))))
elif __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "datasets":
    root = Path(sys.argv[2]).resolve(strict=True)
    assert (root / "samples.npz").is_file()
    for name, value in [("nan", np.nan), ("inf", np.inf)]:
        inputs = np.ones((4, 32), dtype=np.float32)
        inputs[0, 0] = value
        with (root / f"{name}.npz").open("xb") as stream:
            np.savez(stream, X=inputs)
    with (root / "empty.npz").open("xb") as stream:
        np.savez(stream, X=np.empty((0, 32), dtype=np.float32))
    print(
        json.dumps(
            {
                name: dataset_identity(root / f"{name}.npz")
                for name in ["nan", "inf", "empty"]
            }
        )
    )
elif __name__ == "__main__":
    original = fixture.create_app
    original_backend = fixture.LocalBackend

    class ResultRecordingBackend(original_backend):
        """Record real terminal owned process futures before normal pruning."""

        def process_result(self, handle):
            result = super().process_result(handle)
            if result is not None:
                root = Path(sys.argv[sys.argv.index("--root") + 1])
                path = root / ".numerical-process.jsonl"
                row = {
                    "runId": handle.run_id,
                    "attempt": handle.attempt,
                    "pid": handle.pid,
                    "returncode": result.returncode,
                    "cancelled": result.cancelled,
                    "timedOut": result.timed_out,
                }
                existing = (
                    [json.loads(line) for line in path.read_text().splitlines()]
                    if path.exists()
                    else []
                )
                if not any(item["pid"] == row["pid"] for item in existing):
                    with path.open("a") as stream:
                        stream.write(json.dumps(row) + "\n")
            return result

        def release(self, handle):
            self.process_result(handle)
            return super().release(handle)

    fixture.LocalBackend = ResultRecordingBackend

    def recording_app(*args, **kwargs):
        app = original(*args, **kwargs)
        # Settings is implementation-owned; derive our explicitly supplied root.
        root = Path(sys.argv[sys.argv.index("--root") + 1])
        path = root / ".numerical-wire.jsonl"
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(descriptor)

        async def wrapped(scope, receive, send):
            target = (
                scope["type"] == "http"
                and scope.get("method") == "GET"
                and re.fullmatch(r"/api/runs/[0-9a-f-]{36}", scope.get("path", ""))
            )
            body = bytearray()
            status = None

            async def recorded(message):
                nonlocal status
                if target and message["type"] == "http.response.start":
                    status = message["status"]
                if target and message["type"] == "http.response.body":
                    body.extend(message.get("body", b""))
                    if len(body) > 262144:
                        raise RuntimeError("GET evidence exceeds bound")
                    if not message.get("more_body", False):
                        headers = dict(scope.get("headers", []))
                        record = {
                            "path": scope["path"],
                            "method": "GET",
                            "status": status,
                            "authenticated": b"authorization" in headers,
                            "scoped": b"x-wavedl-daemon-id" in headers,
                            "browser": b"Chrome/" in headers.get(b"user-agent", b""),
                            "rawBody": body.decode(),
                            "bodySha256": hashlib.sha256(body).hexdigest(),
                        }
                        line = json.dumps(record) + "\n"
                        if path.stat().st_size + len(line.encode()) > 2097152:
                            raise RuntimeError("Wire evidence exceeds bound")
                        with path.open("a") as stream:
                            stream.write(line)
                await send(message)

            await app(scope, receive, recorded)

        return wrapped

    fixture.create_app = recording_app
    fixture.main()
