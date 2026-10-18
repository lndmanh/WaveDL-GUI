"""Two release barriers force native Fetch reads across UTF-8 and CRLF splits."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import re
import sys
from pathlib import Path


try:
    from tools import browser_daemon_fixture as base
except ModuleNotFoundError:
    import browser_daemon_fixture as base


MARKER = "QA native split: sóng 波 🌊"
PADDING = b": native-split-padding " + b" " * 4096 + b"\r\n"


def split_observer(app, evidence: Path, release: Path):
    records = []

    def persist():
        evidence.write_text(
            json.dumps({"scope": "instrumented-native-sse-split", "records": records})
        )

    async def wrapped(scope, receive, send):
        if (
            scope.get("type") != "http"
            or scope.get("method") != "GET"
            or not re.fullmatch(
                r"/api/runs/[0-9a-f-]{36}/events", scope.get("path", "")
            )
        ):
            return await app(scope, receive, send)
        if len(records) >= 2:
            raise RuntimeError("Native split request budget exceeded")
        record = {
            "index": len(records),
            "cursor": base.request_cursor_metadata(scope.get("query_string", b"")),
            "status": None,
            "sourceIds": [],
            "pieces": [],
            "releases": [],
            "suppressedCommentCount": 0,
            "suppressedCommentBytes": 0,
            "suppressedCommentSha256": hashlib.sha256(b"").hexdigest(),
        }
        records.append(record)
        record["authenticated"] = any(
            key.lower() == b"authorization" for key, _ in scope.get("headers", [])
        )
        record["scoped"] = any(
            key.lower() == b"x-wavedl-daemon-id" for key, _ in scope.get("headers", [])
        )
        pending = b""
        ended = False

        async def disconnected():
            if ended:
                return {"type": "http.disconnect"}
            return await receive()

        async def capture(message):
            nonlocal pending, ended
            if ended:
                return
            if message["type"] == "http.response.start":
                record["status"] = message["status"]
                await send(message)
                return
            if message["type"] != "http.response.body" or record["status"] != 200:
                return await send(message)
            pending += message.get("body", b"")
            if len(pending) > 262144:
                raise ValueError("Native split frame budget")
            while b"\n\n" in pending:
                frame, pending = pending.split(b"\n\n", 1)
                frame += b"\n\n"
                match = re.search(rb"(?:^|\n)id: ([1-9][0-9]*):([0-9]+)\n", frame)
                if (
                    record["index"] == 0
                    and not match
                    and not record["sourceIds"]
                    and frame == b": heartbeat\n\n"
                ):
                    record["suppressedCommentCount"] += 1
                    if record["suppressedCommentCount"] > 64:
                        raise ValueError("Native split prelude budget")
                    record["suppressedCommentBytes"] += len(frame)
                    record["suppressedCommentSha256"] = hashlib.sha256(
                        frame * record["suppressedCommentCount"]
                    ).hexdigest()
                    persist()
                    continue
                if match:
                    if len(record["sourceIds"]) >= 4096:
                        raise ValueError("Native split event budget")
                    record["sourceIds"].append([int(match[1]), int(match[2])])
                if record["index"] == 0 and match:
                    lines = frame.split(b"\n")
                    for index, line in enumerate(lines):
                        if line.startswith(b"data: "):
                            event = json.loads(line[6:])
                            event["payload"]["message"] = MARKER
                            lines[index] = (
                                b"data: "
                                + json.dumps(
                                    event, ensure_ascii=False, allow_nan=False
                                ).encode()
                            )
                    frame = PADDING + b"\r\n".join(lines)
                    record["paddingSize"] = len(PADDING)
                    record["paddingSha256"] = hashlib.sha256(PADDING).hexdigest()
                    offset = frame.index("ó".encode()) + 1
                    pieces = [frame[:offset], frame[offset:-1], frame[-1:]]
                    record["frameSize"] = len(frame)
                    record["frameSha256"] = hashlib.sha256(frame).hexdigest()
                    record["splitOffsets"] = [offset, len(frame) - 1]
                    record["splitBytes"] = [
                        [frame[offset - 1], frame[offset]],
                        [frame[-2], frame[-1]],
                    ]
                    for index, piece in enumerate(pieces):
                        prefix = b"".join(pieces[: index + 1])
                        record["pieces"].append(
                            {
                                "index": index,
                                "size": len(piece),
                                "sha256": hashlib.sha256(piece).hexdigest(),
                                "prefixSize": len(prefix),
                                "prefixSha256": hashlib.sha256(prefix).hexdigest(),
                            }
                        )
                        record["stage"] = index + 1
                        persist()
                        await send(
                            {
                                "type": "http.response.body",
                                "body": piece,
                                "more_body": True,
                            }
                        )
                        if index < 2:
                            barrier = release.with_name(release.name + str(index + 1))
                            async with asyncio.timeout(60):
                                while not barrier.exists():
                                    await asyncio.sleep(0.05)
                            if (
                                barrier.is_symlink()
                                or barrier.read_bytes() != b"observed\n"
                            ):
                                raise ValueError("Invalid native-read release")
                            record["releases"].append(index + 1)
                    cursor = {"attempt": int(match[1]), "seq": int(match[2])}
                    record["controlResume"] = cursor
                    control = (
                        b"event: overflow\ndata: "
                        + json.dumps({"resumePosition": cursor}).encode()
                        + b"\n\n"
                    )
                    record["wireSize"] = len(frame + control)
                    record["wireSha256"] = hashlib.sha256(frame + control).hexdigest()
                    await send(
                        {
                            "type": "http.response.body",
                            "body": control,
                            "more_body": True,
                        }
                    )
                    ended = True
                    await send(
                        {"type": "http.response.body", "body": b"", "more_body": False}
                    )
                    persist()
                    return
                await send(
                    {"type": "http.response.body", "body": frame, "more_body": True}
                )
                persist()
            if not message.get("more_body", False):
                await send({**message, "body": pending})

        try:
            await app(scope, disconnected, capture)
        finally:
            persist()

    return wrapped


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--release", type=Path, required=True)
    args, rest = parser.parse_known_args()
    ordinary = base.create_app

    def factory(*values, **options):
        return split_observer(ordinary(*values, **options), args.evidence, args.release)

    base.create_app = factory
    sys.argv = [sys.argv[0], *rest]
    base.main()


if __name__ == "__main__":
    main()
