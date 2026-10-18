"""Owned one-shot catalogue/header response faults; not remote certification."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import stat
from pathlib import Path
from urllib.parse import parse_qs


try:
    from tools import browser_daemon_fixture as base
    from tools.browser_preview_fault_fixture import snapshot
except ModuleNotFoundError:
    import browser_daemon_fixture as base
    from browser_preview_fault_fixture import snapshot


MODES = {
    "roots": ("GET", "/api/browse"),
    "traversal": ("GET", "/api/browse"),
    "claim": ("GET", "/api/models"),
    "malformed-model": ("GET", "/api/models"),
    "outage": ("GET", "/api/models"),
    "header": ("POST", "/api/datasets/inspect"),
    "shape": ("POST", "/api/datasets/inspect"),
}
NATIVE = {"unreadable": "unreadable-location", "oversized": "oversized-location"}


def create_native_locations(root):
    """Create only owned child locations, never alter datasets or browse roots."""
    if not hasattr(os, "getuid") or os.getuid() == 0:
        raise RuntimeError("Native unreadable proof requires a non-root POSIX user")
    for name in NATIVE.values():
        (root / name).mkdir(mode=0o700)
    for index in range(1001):
        (root / NATIVE["oversized"] / f"entry-{index:04d}.empty").touch()
    (root / NATIVE["unreadable"]).chmod(0)


def native_proof(root, mode):
    location = root / NATIVE[mode]
    info = location.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
        raise ValueError("Native location must be an owned ordinary directory")
    proof = {
        "child": NATIVE[mode],
        "uid": os.getuid(),
        "owner": info.st_uid,
        "mode": stat.S_IMODE(info.st_mode),
        "ordinaryDirectory": True,
        "maxEntries": 1000,
    }
    if mode == "unreadable":
        try:
            with os.scandir(location) as entries:
                next(entries, None)
        except PermissionError:
            proof["permissionDenied"] = True
        else:
            raise RuntimeError("chmod000 did not deny native directory access")
    else:
        entries = list(location.iterdir())
        proof["entryCount"] = len(entries)
        proof["ordinaryEmptyFiles"] = all(
            stat.S_ISREG(p.lstat().st_mode)
            and p.lstat().st_size == 0
            and p.lstat().st_uid == os.getuid()
            for p in entries
        )
    return proof


def corrupt(mode, value):
    """Change only an explicit bounded successful response, never source state."""
    if mode == "roots":
        value = {"roots": [{"id": "../outside"}]}
    elif mode == "traversal":
        value["entries"][0]["name"] = "../outside.npz"
    elif mode == "claim":
        value["runtime_verified"] = True
    elif mode == "malformed-model":
        value["models"][0]["id"] = 37
    elif mode == "outage":
        value = {"error": "Unavailable"}
    elif mode == "header":
        value["schema_version"] = 999
    elif mode == "shape":
        value["variables"][0]["sample_count"] += 1
    else:
        raise ValueError("Unknown response fault")
    return value


def response_fault(app, root, services=None):
    control = root / ".catalogue-control"
    evidence = root / ".catalogue-responses.jsonl"

    async def wrapped(scope, receive, send):
        mode = None
        query = scope.get("query_string", b"")
        native = None
        if (scope.get("type"), scope.get("method"), scope.get("path")) == (
            "http",
            "GET",
            "/api/browse",
        ):
            params = parse_qs(query.decode("ascii"))
            if params.get("root") == ["datasets"]:
                native = next(
                    (
                        key
                        for key, value in NATIVE.items()
                        if params.get("path") == [value]
                    ),
                    None,
                )
        proof = native_proof(root, native) if native else None
        if native and services is not None:
            proof["maxEntries"] = await services.host.call(
                lambda session: session.catalog.max_entries
            )
        if scope.get("type") == "http" and control.is_file():
            if control.is_symlink() or control.stat().st_size > 32:
                raise ValueError("Bounded ordinary control required")
            candidate = control.read_text(encoding="ascii")
            if candidate not in MODES:
                raise ValueError("Unknown response fault")
            query = scope.get("query_string", b"")
            if (scope.get("method"), scope.get("path")) == MODES[candidate] and (
                candidate not in {"roots", "traversal"}
                or bool(query) == (candidate == "traversal")
            ):
                mode = candidate
        if mode is None and native is None:
            return await app(scope, receive, send)
        messages = []

        async def capture(message):
            messages.append(message)
            if sum(len(m.get("body", b"")) for m in messages) > 262144:
                raise ValueError("Response exceeds bound")

        await app(scope, receive, capture)
        start = next(m for m in messages if m["type"] == "http.response.start")
        if start["status"] != 200 and native is None:
            for message in messages:
                await send(message)
            return
        original = b"".join(m.get("body", b"") for m in messages)
        body = (
            original
            if native
            else json.dumps(corrupt(mode, json.loads(original))).encode()
        )
        status = start["status"] if native else 503 if mode == "outage" else 200
        if not native:
            control.unlink()
        record = {
            "mode": native or mode,
            "method": scope["method"],
            "endpoint": scope["path"],
            "query": scope.get("query_string", b"").decode("ascii"),
            "realStatus": start["status"],
            "status": status,
            "original": original.decode(),
            "response": body.decode(),
            "originalSha256": hashlib.sha256(original).hexdigest(),
            "responseSha256": hashlib.sha256(body).hexdigest(),
        }
        if native:
            record["native"] = proof
            record["responseModified"] = False
            record["browser"] = any(
                k.lower() == b"user-agent" and b"Chrome/" in v
                for k, v in scope.get("headers", [])
            )
        if evidence.exists() and evidence.stat().st_size > 2 * 1024 * 1024:
            raise ValueError("Evidence exceeds bound")
        with evidence.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record) + "\n")
        headers = [
            (k, v) for k, v in start["headers"] if k.lower() != b"content-length"
        ]
        headers.append((b"content-length", str(len(body)).encode()))
        await send({**start, "status": status, "headers": headers})
        await send({"type": "http.response.body", "body": body})

    return wrapped


async def serve(root, token_file):
    original = base.create_app

    def create_app(*args, **kwargs):
        app = original(*args, **kwargs)
        create_native_locations(root)
        return response_fault(app, root, kwargs["services"])

    base.create_app = create_app
    try:
        await base.serve_fixture(root, 1, 0, seed_run=False, token_file=token_file)
    finally:
        base.create_app = original
        location = root / NATIVE["unreadable"]
        if location.is_dir() and not location.is_symlink():
            location.chmod(0o700)
            print("Fixture: native-permissions-restored", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--token-file", type=Path)
    parser.add_argument("--inspect", action="store_true")
    args = parser.parse_args()
    if args.inspect:
        print(json.dumps(snapshot(args.root)))
    else:
        asyncio.run(serve(args.root, args.token_file))


if __name__ == "__main__":
    main()
