"""Bounded malformed control around real daemon SSE, not attempt fabrication.

First response annotates one real payload with Unicode, omits one real event,
then disconnects with a valid overflow at the next real cursor. Second response
injects syntactically malformed control JSON, or an opt-in invalid UTF-8
annotation in otherwise valid control JSON. Identities never change. ASGI
fragmentation is recorded; network/browser chunk boundaries are not inferred.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path


try:
    from tools import browser_daemon_fixture as base
except ModuleNotFoundError:
    import browser_daemon_fixture as base


MARKER = "QA split UTF-8: sóng 波 🌊"
_ID = re.compile(rb"(?:^|\n)id: ([1-9][0-9]{0,15}):([0-9]{1,16})\n")


def control(cursor):
    return (
        b"event: overflow\ndata: "
        + json.dumps({"resumePosition": cursor}).encode("ascii")
        + b"\n\n"
    )


def malformed_observer(
    app, evidence: Path, release: Path | None = None, *, invalid_utf8: bool = False
):
    if release is not None and release.parent != evidence.parent:
        raise ValueError("Release barrier must share the owned evidence directory")
    records = []
    rejected_requests = 0

    def persist():
        evidence.write_text(
            json.dumps(
                {
                    "scope": "bounded-qa-asgi-faults",
                    "records": records,
                    "rejectedRequests": rejected_requests,
                }
            ),
            encoding="utf-8",
        )

    async def wrapped(scope, receive, send):
        nonlocal rejected_requests
        if not (
            scope.get("type") == "http"
            and scope.get("method") == "GET"
            and scope.get("path", "").startswith("/api/runs/")
            and scope.get("path", "").endswith("/events")
        ):
            await app(scope, receive, send)
            return
        if len(records) >= 2:
            rejected_requests += 1
            persist()
            raise RuntimeError("Malformed fixture request fault budget exceeded")
        index = len(records)
        record = {
            "path": scope["path"],
            "cursor": base.request_cursor_metadata(scope.get("query_string", b"")),
            "status": None,
            "sourceIds": [],
            "forwardedIds": [],
            "omittedIds": [],
            "splitBytes": 0,
            "nonAsciiBytes": 0,
            "unicodeAnnotated": False,
            "controlResume": None,
            "controlFault": None,
            "browserObserved": False,
        }
        records.append(record)
        pending = b""
        ended = False

        async def observed_receive():
            if ended:
                return {"type": "http.disconnect"}
            return await receive()

        async def emit(frame):
            if record["splitBytes"] + len(frame) > 262144:
                raise RuntimeError("Malformed fixture byte budget exceeded")
            for value in frame:
                await send(
                    {
                        "type": "http.response.body",
                        "body": bytes((value,)),
                        "more_body": True,
                    }
                )
                record["splitBytes"] += 1
                record["nonAsciiBytes"] += value >= 128
                await asyncio.sleep(0)

        async def finish():
            nonlocal ended
            ended = True
            await send({"type": "http.response.body", "body": b"", "more_body": False})
            persist()

        async def capture(message):
            nonlocal pending
            if ended:
                return
            if message["type"] == "http.response.start":
                record["status"] = message["status"]
                await send(message)
                if index == 1 and record["status"] == 200:
                    # Controller releases ONLY after observing public rendered
                    # Unicode/sparse identities, never private browser state.
                    if release is not None:
                        async with asyncio.timeout(60):
                            while not release.exists():
                                await asyncio.sleep(0.05)
                        if (
                            release.is_symlink()
                            or release.stat().st_size != 9
                            or release.read_bytes() != b"observed\n"
                        ):
                            raise RuntimeError("Invalid fixture release barrier")
                    cursor = record["cursor"]
                    ahead = {"attempt": cursor["attempt"], "seq": cursor["seq"] + 1000}
                    record["controlResume"] = ahead
                    record["controlFault"] = "malformed-json-truncated-object"
                    # Deliberately invalid JSON with a named candidate cursor,
                    # never a fabricated runtime event or committed cursor.
                    malformed = control(ahead).replace(b"}}\n\n", b"}\n\n")
                    if invalid_utf8:
                        record["controlFault"] = "invalid-utf8-control"
                        # Valid JSON framing except for an invalid UTF-8 sequence
                        # inside an ignored annotation field. Fatal transport
                        # decoding must refuse it before any cursor advances.
                        malformed = control(ahead).replace(
                            b'{"resumePosition":',
                            b'{"annotation":"'
                            + bytes((0xC3, 0x28))
                            + b'","resumePosition":',
                        )
                        record["wireHex"] = malformed.hex()
                    record["controlWire"] = (
                        None if invalid_utf8 else malformed.decode("ascii")
                    )
                    await emit(malformed)
                    await finish()
                return
            if message["type"] != "http.response.body" or record["status"] != 200:
                await send(message)
                return
            pending += message.get("body", b"")
            if len(pending) > 262144:
                raise RuntimeError("Malformed fixture frame budget exceeded")
            while b"\n\n" in pending:
                frame, pending = pending.split(b"\n\n", 1)
                frame += b"\n\n"
                match = _ID.search(frame)
                if match:
                    identity = [int(match[1]), int(match[2])]
                    if any(value > 2**53 - 1 for value in identity):
                        raise RuntimeError("Unsafe fixture identity")
                    record["sourceIds"].append(identity)
                    if len(record["sourceIds"]) == 2:
                        record["omittedIds"].append(identity)
                        persist()
                        continue
                    if len(record["sourceIds"]) == 1:
                        lines = frame.split(b"\n")
                        for position, line in enumerate(lines):
                            if line.startswith(b"data: "):
                                event = json.loads(line[6:])
                                event["payload"]["message"] = MARKER
                                lines[position] = b"data: " + json.dumps(
                                    event, ensure_ascii=False, allow_nan=False
                                ).encode("utf-8")
                        frame = b"\n".join(lines)
                        record["unicodeAnnotated"] = True
                    record["forwardedIds"].append(identity)
                await emit(frame)
                if len(record["sourceIds"]) == 3:
                    last = record["forwardedIds"][-1]
                    record["controlResume"] = {"attempt": last[0], "seq": last[1]}
                    await emit(control(record["controlResume"]))
                    await finish()
                    return
                persist()
            if not message.get("more_body", False):
                await send({**message, "body": pending})
                pending = b""
                persist()

        try:
            await app(scope, observed_receive, capture)
        finally:
            persist()

    return wrapped


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--release", type=Path, required=True)
    parser.add_argument("--invalid-utf8", action="store_true")
    args, rest = parser.parse_known_args()
    original = base.create_app

    def factory(*values, **options):
        return malformed_observer(
            original(*values, **options),
            args.evidence,
            args.release,
            invalid_utf8=args.invalid_utf8,
        )

    base.create_app = factory
    sys.argv = [sys.argv[0], *rest]
    base.main()


if __name__ == "__main__":
    main()
