"""Real daemon fixture with one response-boundary authentication fault.

The wrapped handler executes the normal authenticated health endpoint first.
An explicit owned control file arms exactly one successful response fault.
Bootstrap and unarmed health responses retain the ordinary daemon contract.
"""

from __future__ import annotations

import argparse
import json
from typing import TYPE_CHECKING, Any


try:
    from tools import browser_daemon_fixture as base
except ModuleNotFoundError:
    import browser_daemon_fixture as base


if TYPE_CHECKING:
    from pathlib import Path


_create_app = base.create_app


def response_boundary_fault(app: Any, control: Path | None = None):
    async def wrapped(scope, receive, send):
        target = (
            scope.get("type") == "http"
            and scope.get("method") == "GET"
            and scope.get("path") == "/api/health"
            and any(
                key.lower() == b"authorization" for key, _ in scope.get("headers", [])
            )
        )
        if not target:
            await app(scope, receive, send)
            return
        messages = []

        async def capture(message):
            messages.append(message)

        await app(scope, receive, capture)
        status = next(
            (m.get("status") for m in messages if m["type"] == "http.response.start"),
            None,
        )
        mode = None
        if (
            status == 200
            and control is not None
            and control.is_file()
            and not control.is_symlink()
        ):
            mode = control.read_text(encoding="ascii")
            if mode not in {"401", "build", "protocol"}:
                raise ValueError("Invalid fixture fault mode")
            control.unlink()
        fault = status == 200 and mode is not None
        body = b"".join(m.get("body", b"") for m in messages)
        if fault and control is not None:
            real_health = json.loads(body)
            evidence = {
                "mode": mode,
                "endpoint": scope["path"],
                "realStatus": status,
                "faultStatus": 401 if mode == "401" else 200,
                "daemonId": real_health.get("daemon_id"),
                "buildId": real_health.get("build_id"),
                "protocolMin": real_health.get("protocol_min"),
                "protocolMax": real_health.get("protocol_max"),
            }
            with control.with_name(".auth-skew-evidence.jsonl").open(
                "a", encoding="utf-8"
            ) as stream:
                stream.write(json.dumps(evidence) + "\n")
        if fault and mode != "401":
            health = json.loads(body)
            if mode == "build":
                health["build_id"] += "-fixture-skew"
            else:
                health["protocol_min"] = 2
                health["protocol_max"] = 2
            body = json.dumps(health).encode("utf-8")
        body_sent = False
        for message in messages:
            if fault and message["type"] == "http.response.start":
                headers = [
                    (key, value)
                    for key, value in message.get("headers", [])
                    if key.lower() != b"content-length"
                ]
                headers.append(
                    (
                        b"content-length",
                        str(len(body) if mode != "401" else 0).encode("ascii"),
                    )
                )
                await send(
                    {
                        **message,
                        "status": 401 if mode == "401" else 200,
                        "headers": headers,
                    }
                )
            elif fault and message["type"] == "http.response.body":
                await send(
                    {
                        **message,
                        "body": body if not body_sent and mode != "401" else b"",
                    }
                )
                body_sent = True
            else:
                await send(message)

    return wrapped


def create_fault_app(*args, **kwargs):
    settings = args[0]
    return response_boundary_fault(
        _create_app(*args, **kwargs), settings.state_root.parent / ".auth-skew-control"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True)
    parser.add_argument("--token-file", required=True)
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--unseeded", action="store_true")
    args = parser.parse_args()
    original = base.create_app
    base.create_app = create_fault_app
    try:
        # Reuse the normal fixture's owned root, bootstrap, backend and cleanup.
        import sys

        sys.argv = [
            "browser_daemon_fixture.py",
            "--root",
            args.root,
            "--token-file",
            args.token_file,
            "--port",
            str(args.port),
            *(["--unseeded"] if args.unseeded else []),
        ]
        base.main()
    finally:
        base.create_app = original


if __name__ == "__main__":
    main()
