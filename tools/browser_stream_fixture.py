"""Real daemon fixture with a bounded first-frame disconnect for browser QA.

This is a thin wrapper over ``browser_daemon_fixture``. The first complete SSE
runtime frame is copied from the real handler, then a fixture-injected overflow
control advertises that frame's real cursor and the connection ends. This is
not genuine broker capacity overflow. Requests and frame IDs are retained as boundary
evidence for the runner. Browser parsing/rendering remains an explicit runner
assertion and is never inferred here.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
from pathlib import Path


try:
    from tools import browser_daemon_fixture as base
except ModuleNotFoundError:
    import browser_daemon_fixture as base


_EVENT = re.compile(rb"(?:^|\n)id: ([1-9][0-9]{0,18}):([0-9]{1,19})\n")


def boundary_wrapper(app, evidence: Path):
    state = {"interrupted": False, "records": []}

    async def wrapped(scope, receive, send):
        is_stream = (
            scope.get("type") == "http"
            and scope.get("method") == "GET"
            and scope.get("path", "").startswith("/api/runs/")
            and scope.get("path", "").endswith("/events")
        )
        if not is_stream:
            await app(scope, receive, send)
            return
        if len(state["records"]) >= 2:
            raise RuntimeError(
                "Stream fixture request count exceeds controlled fault budget"
            )
        pending = b""
        status = None
        ended = False
        selected_fault = not state["interrupted"]
        record = {
            "path": scope["path"],
            "cursor": base.request_cursor_metadata(scope.get("query_string", b"")),
            "status": None,
            "forwardedIds": [],
            "interrupted": False,
            "browserObserved": False,
            "splitBytes": 0,
            "nonAsciiBytes": 0,
        }
        state["records"].append(record)

        def persist():
            evidence.write_text(
                json.dumps({"scope": "asgi-only", "records": state["records"]}),
                encoding="utf-8",
            )

        async def observed_receive():
            if ended:
                return {"type": "http.disconnect"}
            return await receive()

        async def capture(message):
            nonlocal status, pending, ended
            if ended:
                return
            if message["type"] == "http.response.start":
                status = message["status"]
                record["status"] = status
                await send(message)
                return
            if message["type"] != "http.response.body" or status != 200:
                await send(message)
                return
            pending += message.get("body", b"")
            if len(pending) > 262144:
                raise RuntimeError("Stream fixture frame exceeds budget")
            while b"\n\n" in pending:
                frame, pending = pending.split(b"\n\n", 1)
                frame += b"\n\n"
                identities = [
                    [int(match[1]), int(match[2])] for match in _EVENT.finditer(frame)
                ]
                if len(record["forwardedIds"]) + len(identities) > 4096:
                    raise RuntimeError("Stream fixture event count exceeds budget")
                if record["splitBytes"] + len(frame) > 16 * 1024 * 1024:
                    raise RuntimeError("Stream fixture byte evidence exceeds budget")
                record["forwardedIds"].extend(identities)
                for value in frame:
                    await send(
                        {
                            "type": "http.response.body",
                            "body": bytes((value,)),
                            "more_body": True,
                        }
                    )
                    await asyncio.sleep(0)
                record["splitBytes"] += len(frame)
                record["nonAsciiBytes"] += sum(value >= 128 for value in frame)
                if selected_fault and identities:
                    state["interrupted"] = True
                    record["interrupted"] = True
                    ended = True
                    last_attempt, last_seq = identities[-1]
                    control = (
                        b"event: overflow\ndata: "
                        + json.dumps(
                            {
                                "resumePosition": {
                                    "attempt": last_attempt,
                                    "seq": last_seq,
                                }
                            }
                        ).encode("ascii")
                        + b"\n\n"
                    )
                    await send(
                        {
                            "type": "http.response.body",
                            "body": control,
                            "more_body": True,
                        }
                    )
                    record["controlResume"] = {"attempt": last_attempt, "seq": last_seq}
                    await send(
                        {"type": "http.response.body", "body": b"", "more_body": False}
                    )
                    persist()
                    return
                persist()
            if not message.get("more_body", False):
                await send({**message, "body": pending})

        await app(scope, observed_receive, capture)
        persist()

    return wrapped


def create_stream_app(*args, evidence: Path, **kwargs):
    return boundary_wrapper(base.create_app(*args, **kwargs), evidence)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", type=Path, required=True)
    args, rest = parser.parse_known_args()
    original = base.create_app

    def factory(*values, **options):
        return boundary_wrapper(original(*values, **options), args.evidence)

    base.create_app = factory
    # Invoke the unmodified fixture CLI parser while retaining our wrapper.
    import sys

    sys.argv = [sys.argv[0], *rest]
    base.main()


if __name__ == "__main__":
    main()
