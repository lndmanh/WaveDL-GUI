"""Task-owned genuine plateau plan and read-only authenticated GET evidence."""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

import browser_daemon_fixture as fixture


def main():
    root = Path(sys.argv[sys.argv.index("--root") + 1]).resolve()
    model = Path(__file__).with_name("epoch_metric_plateau_model.py").resolve()
    model_sha = hashlib.sha256(model.read_bytes()).hexdigest()
    original = fixture.create_app
    original_backend = fixture.LocalBackend

    class RecordingBackend(original_backend):
        def process_result(self, handle):
            result = super().process_result(handle)
            if result is None:
                return None
            path = root / ".epoch-process.json"
            if not path.exists():
                path.write_text(
                    json.dumps(
                        {
                            "runId": handle.run_id,
                            "pid": handle.pid,
                            "returncode": result.returncode,
                            "cancelled": result.cancelled,
                            "timedOut": result.timed_out,
                            "stdout": result.stdout.decode("utf-8", "replace"),
                            "stderr": result.stderr.decode("utf-8", "replace"),
                        }
                    )
                )
                path.chmod(0o600)
            return result

        def release(self, handle):
            if self.process_result(handle) is None:
                raise RuntimeError("Terminal owned process result is unavailable")
            return super().release(handle)

    fixture.LocalBackend = RecordingBackend

    def application(*args, **kwargs):
        services = kwargs["services"]
        original_plan = services.run_service.plan

        async def approved_plan(request, request_id):
            assert hashlib.sha256(model.read_bytes()).hexdigest() == model_sha
            request = {
                **request,
                "config": {
                    **request["config"],
                    "model": "epoch_metric_plateau",
                    "import_modules": [str(model)],
                    "epochs": 7,
                    "patience": 2,
                    "save_every": 1,
                    "precision": "no",
                },
            }
            (root / ".epoch-authoring.json").write_text(
                json.dumps({"request": request, "modelSha256": model_sha})
            )
            return await original_plan(request, request_id)

        services.run_service.plan = approved_plan
        app = original(*args, **kwargs)
        path = root / ".epoch-wire.jsonl"
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(descriptor)

        async def wrapped(scope, receive, send):
            if (
                scope["type"] == "http"
                and scope.get("path", "").startswith("/api/")
                and scope.get("path") != "/api/bootstrap"
                and scope.get("method") not in {"GET", "HEAD"}
            ):
                mutation_path = root / ".epoch-mutations.jsonl"
                with mutation_path.open("a", encoding="utf-8") as stream:
                    stream.write(
                        json.dumps({"method": scope["method"], "path": scope["path"]})
                        + "\n"
                    )
            target = (
                scope["type"] == "http"
                and scope.get("method") == "GET"
                and re.fullmatch(r"/api/runs/[0-9a-f-]{36}", scope.get("path", ""))
            )
            body, status = bytearray(), None

            async def recorded(message):
                nonlocal status
                if target and message["type"] == "http.response.start":
                    status = message["status"]
                if target and message["type"] == "http.response.body":
                    body.extend(message.get("body", b""))
                    if len(body) > 262144:
                        raise RuntimeError("GET exceeds owned evidence bound")
                    if not message.get("more_body", False):
                        headers = dict(scope.get("headers", []))
                        record = {
                            "atMs": time.time_ns() // 1000000,
                            "path": scope["path"],
                            "method": "GET",
                            "status": status,
                            "authenticated": b"authorization" in headers,
                            "scoped": b"x-wavedl-daemon-id" in headers,
                            "browser": b"Chrome/" in headers.get(b"user-agent", b""),
                            "rawBody": body.decode(),
                            "bodyBytes": len(body),
                            "bodySha256": hashlib.sha256(body).hexdigest(),
                        }
                        line = json.dumps(record) + "\n"
                        if path.stat().st_size + len(line.encode()) > 2097152:
                            raise RuntimeError("GET recorder exceeds evidence bound")
                        with path.open("a") as stream:
                            stream.write(line)
                await send(message)

            await app(scope, receive, recorded)

        return wrapped

    fixture.create_app = application
    fixture.main()


if __name__ == "__main__":
    main()
