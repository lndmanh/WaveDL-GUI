"""Native service-worker storage-install concurrency fixture.

This serves the immutable producer outputs from ``summary.json`` over loopback.
It deliberately uses ordinary HTTP and the browser's real service-worker/cache
and IndexedDB implementations; it contains no storage mocks.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import mimetypes
import re
import secrets
import socket
import stat
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

import uvicorn
from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response
from starlette.routing import Route


if TYPE_CHECKING:
    from starlette.requests import Request

MAX_ASSETS = 64
MAX_FILE = 8 * 1024 * 1024
MAX_TRACE = 2 * 1024 * 1024
MAX_METADATA = 128 * 1024


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def ordinary_bytes(path: Path, limit: int) -> bytes:
    """Reject symlink components and non-ordinary/oversized source files."""
    absolute = path.absolute()
    if any(p.is_symlink() for p in (absolute, *absolute.parents)):
        raise ValueError("source contains a symlink")
    info = absolute.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
        raise ValueError("source is not a bounded ordinary file")
    with absolute.open("rb") as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise ValueError("source exceeds byte limit")
    return raw


class Fixture:
    def __init__(self, summary: Path, root: Path, token_file: Path) -> None:
        data = json.loads(ordinary_bytes(summary, MAX_METADATA))
        builds = {b["namespace"]: b for b in data["builds"]}
        if set(builds) != {"g1", "g2", "g3", "g4"} or data.get("status") != "passed":
            raise ValueError("summary must contain g1, g2, and g3")
        self.builds = builds
        self.root = root.resolve()
        token_path = token_file.absolute()
        if (
            token_path.resolve().is_relative_to(self.root)
            or stat.S_IMODE(token_path.stat().st_mode) != 0o600
        ):
            raise ValueError("token must be private mode 600 outside task root")
        self.token = ordinary_bytes(token_path, 512).decode("utf-8").strip()
        if not re.fullmatch(r"[A-Za-z0-9._~-]{16,512}", self.token):
            raise ValueError("invalid private token file")
        self.origin = ""
        self.trace: list[dict[str, Any]] = []
        self.trace_bytes = 2
        self.trace_dropped = 0
        self.inventory_seen: set[str] = set()
        self.arrived: set[str] = set()
        self.released = False
        self.shutting_down = False
        self.barrier = asyncio.Event()
        self.release = asyncio.Event()
        self._lock = asyncio.Lock()
        self.asset_seen: set[str] = set()
        self.assets: dict[str, dict[str, tuple[bytes, dict[str, Any]]]] = {}
        self.workers: dict[str, bytes] = {}
        self.inventories: dict[str, bytes] = {}
        for namespace, build in builds.items():
            assets_dir = Path(build["assetsDir"]).absolute()
            metadata = ordinary_bytes(assets_dir / "offline-build.json", MAX_METADATA)
            worker = ordinary_bytes(assets_dir / "sw.js", MAX_FILE)
            if (
                hashlib.sha256(metadata).hexdigest() != build["offlineInventorySha256"]
                or hashlib.sha256(worker).hexdigest() != build["workerSha256"]
            ):
                raise ValueError("producer metadata/worker digest mismatch")
            self.workers[namespace] = worker
            self.inventories[namespace] = metadata
            inv = json.loads(metadata)
            if (
                inv["generation"] != build["generation"]
                or inv["build_key"] != build["buildKey"]
            ):
                raise ValueError("producer identity mismatch")
            if (
                len(json.dumps(inv)) > MAX_METADATA
                or len(inv.get("assets", [])) > MAX_ASSETS
            ):
                raise ValueError("producer inventory exceeds fixture bounds")
            mapping: dict[str, tuple[bytes, dict[str, Any]]] = {}
            for item in inv["assets"]:
                url = item["url"]
                if (
                    not isinstance(url, str)
                    or len(url) > 256
                    or not re.fullmatch(r"/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]*", url)
                    or any(p in {".", ".."} for p in url.split("/"))
                    or url in mapping
                ):
                    raise ValueError("invalid inventory URL")
                if url.startswith("/_nuxt/g") and not url.startswith(
                    f"/_nuxt/{namespace}/"
                ):
                    raise ValueError("inventory namespace mismatch")
                rel = url.lstrip("/")
                path = assets_dir / rel
                if url == "/":
                    path = assets_dir / "index.html"
                raw = ordinary_bytes(path, MAX_FILE)
                if (
                    len(raw) != item["size"]
                    or hashlib.sha256(raw).hexdigest() != item["sha256"]
                ):
                    raise ValueError(f"inventory mismatch: {path}")
                mapping[url] = (raw, item)
            self.assets[namespace] = mapping

    def _namespace(self, request: Request) -> str:
        referer = request.headers.get("referer", "")
        for namespace in ("g2", "g3", "g4a", "g4b"):
            if referer == f"{self.origin}/qa/{namespace}/sw.js":
                return "g4" if namespace in ("g4a", "g4b") else namespace
        path = request.url.path
        for namespace in ("g2", "g3", "g4a", "g4b"):
            if path.startswith(f"/qa/{namespace}/"):
                return "g4" if namespace in ("g4a", "g4b") else namespace
        owners = [ns for ns, mapping in self.assets.items() if path in mapping]
        if len(owners) == 1:
            return owners[0]
        return "g1"

    async def _record(self, item: dict[str, Any]) -> None:
        async with self._lock:
            # Completion adds an ISO timestamp to an initially held entry.
            size = len(json.dumps(item, separators=(",", ":")).encode()) + 65
            if self.trace_bytes + size <= MAX_TRACE:
                self.trace.append(item)
                self.trace_bytes += size
            else:
                self.trace_dropped += 1

    async def status(self, request: Request) -> JSONResponse:
        return JSONResponse(
            {
                "schemaVersion": 1,
                "mode": "native-storage-install-concurrency",
                "limitations": [
                    "QA-scoped worker scripts send explicit Referrer-Policy:same-origin"
                ],
                "inventorySeen": sorted(self.inventory_seen),
                "barrierArrived": sorted(self.arrived),
                "released": self.released,
                "shuttingDown": self.shutting_down,
                "trace": self.trace,
                "traceDropped": self.trace_dropped,
            }
        )

    async def release_handler(self, request: Request) -> JSONResponse:
        origin = request.headers.get("origin", "")
        auth = request.headers.get("authorization", "")
        if origin != self.origin or not secrets.compare_digest(
            auth.encode("utf-8"), f"Bearer {self.token}".encode("ascii")
        ):
            return JSONResponse({"error": "unauthorized"}, status_code=403)
        if self.arrived != {"g2", "g3"}:
            return JSONResponse({"error": "candidates not both held"}, status_code=409)
        self.released = True
        self.release.set()
        return JSONResponse({"released": True})

    async def asset(self, request: Request) -> Response:
        namespace = self._namespace(request)
        path = request.url.path
        if path.startswith(f"/qa/{namespace}/"):
            path = path[len(f"/qa/{namespace}") :]
        mapping = self.assets[namespace]
        if path not in mapping:
            return Response(status_code=404)
        raw, item = mapping[path]
        kind = "asset"
        start = _now()
        held = (
            namespace in ("g2", "g3")
            and namespace in self.inventory_seen
            and namespace not in self.asset_seen
        )
        entry = {
            "namespace": namespace,
            "path": path,
            "startISO": start,
            "endISO": None,
            "status": "held" if held else "started",
            "sha256": item["sha256"],
            "size": item["size"],
            "kind": kind,
            "barrier": held,
        }
        await self._record(entry)
        if held:
            self.asset_seen.add(namespace)
            self.arrived.add(namespace)
            if self.arrived == {"g2", "g3"}:
                self.barrier.set()
            try:
                await asyncio.wait_for(self.release.wait(), 30)
            except TimeoutError:
                entry.update(endISO=_now(), status=504)
                return Response(status_code=504)
        if self.shutting_down:
            entry.update(endISO=_now(), status=503)
            return Response(status_code=503)
        end = _now()
        entry.update(endISO=end, status=200)
        return Response(
            raw,
            media_type="text/html" if path == "/" else mimetypes.guess_type(path)[0],
            headers={"Cache-Control": "no-store"},
        )

    async def worker(self, request: Request) -> Response:
        namespace = request.path_params.get("namespace", "g1")
        route_namespace = namespace
        if namespace in ("g4a", "g4b"):
            namespace = "g4"
        elif namespace == "g4":
            return Response(status_code=404)
        if namespace not in ("g1", "g2", "g3", "g4"):
            return Response(status_code=404)
        raw = self.workers[namespace]
        await self._record(
            {
                "namespace": namespace,
                "path": request.url.path,
                "startISO": _now(),
                "endISO": _now(),
                "status": 200,
                "sha256": hashlib.sha256(raw).hexdigest(),
                "size": len(raw),
                "kind": "worker",
                "barrier": False,
            }
        )
        return Response(
            raw,
            media_type="application/javascript",
            headers={
                "Cache-Control": "no-store",
                **(
                    {"Referrer-Policy": "same-origin"}
                    if route_namespace in ("g2", "g3", "g4a", "g4b")
                    else {}
                ),
            },
        )

    async def offline(self, request: Request) -> Response:
        namespace = self._namespace(request)
        raw = self.inventories[namespace]
        self.inventory_seen.add(namespace)
        await self._record(
            {
                "namespace": namespace,
                "path": "/offline-build.json",
                "startISO": _now(),
                "endISO": _now(),
                "status": 200,
                "sha256": hashlib.sha256(raw).hexdigest(),
                "size": len(raw),
                "kind": "inventory",
                "barrier": False,
            }
        )
        return Response(
            raw, media_type="application/json", headers={"Cache-Control": "no-store"}
        )

    def app(self) -> Starlette:
        app = Starlette(
            routes=[
                Route("/qa/status", self.status),
                Route("/qa/release", self.release_handler, methods=["POST"]),
                Route("/qa/{namespace}/sw.js", self.worker),
                Route("/sw.js", self.worker),
                Route("/offline-build.json", self.offline),
                Route("/{path:path}", self.asset),
            ]
        )

        async def scoped(request: Request, call_next):
            if request.headers.get("host") != self.origin.removeprefix("http://") or (
                request.headers.get("origin")
                and request.headers["origin"] != self.origin
            ):
                return Response(status_code=403)
            return await call_next(request)

        app.add_middleware(BaseHTTPMiddleware, dispatch=scoped)
        return app


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--token-file", type=Path, required=True)
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args()
    fixture = Fixture(args.fixtures, args.root, args.token_file)
    config = uvicorn.Config(
        fixture.app(), host="127.0.0.1", port=args.port, log_level="warning"
    )

    class FixtureServer(uvicorn.Server):
        def handle_exit(self, sig, frame):
            fixture.shutting_down = True
            fixture.release.set()
            super().handle_exit(sig, frame)

        async def startup(self, sockets=None):
            await super().startup(sockets=sockets)
            print(json.dumps({"origin": fixture.origin}), flush=True)

    server = FixtureServer(config)

    async def run() -> None:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", args.port))
            fixture.origin = f"http://127.0.0.1:{sock.getsockname()[1]}"
            try:
                await server.serve(sockets=[sock])
            finally:
                fixture.shutting_down = True
                fixture.release.set()
                if server.started:
                    print("servicesclose", flush=True)

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
