"""Bounded same-origin static client reads; construction never touches disk."""

from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import re
from contextlib import ExitStack
from pathlib import Path

import anyio
from starlette.exceptions import HTTPException
from starlette.responses import Response
from starlette.routing import Match, Route

from wavedl.core.safe_files import open_directory


MAX_ASSET_BYTES = 32 * 1024 * 1024
_INLINE_SCRIPT = re.compile(rb"<script\b([^>]*)>(.*?)</script\s*>", re.I | re.S)


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate metadata key")
        result[key] = value
    return result


def _headers(raw: bytes, *, html: bool, immutable: bool) -> dict[str, str]:
    scripts = []
    if html:
        for attributes, content in _INLINE_SCRIPT.findall(raw):
            if not re.search(rb"\bsrc\s*=", attributes, re.I):
                digest = base64.b64encode(hashlib.sha256(content).digest()).decode()
                scripts.append(f"'sha256-{digest}'")
    return {
        "Cache-Control": (
            "no-store"
            if html
            else "public, max-age=31536000, immutable"
            if immutable
            else "no-cache"
        ),
        "Content-Security-Policy": (
            "default-src 'self'; script-src 'self' "
            + " ".join(scripts)
            + "; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
            "font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; "
            "object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
        ),
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
    }


class _ClientRoute(Route):
    """Do not consume unknown API routes, including subsequently added routes."""

    def matches(self, scope):
        path = scope.get("path", "")
        if path == "/api" or path.startswith("/api/"):
            return Match.NONE, {}
        return super().matches(scope)


class StaticClient:
    """Read an optional packaged build through retained no-follow ancestry."""

    def __init__(self, root: Path):
        self.root = Path(root)
        self.limiter = anyio.CapacityLimiter(4)

    def _read(self, parts: tuple[str, ...], *, limit: int | None = None) -> bytes:
        with ExitStack() as stack:
            directory = stack.enter_context(open_directory(self.root))
            for part in parts[:-1]:
                directory = stack.enter_context(directory.open_directory(part))
            return directory.read_file(
                parts[-1], limit=MAX_ASSET_BYTES if limit is None else limit
            )

    def _nuxt_immutable(self, parts: tuple[str, ...], digest: str) -> bool:
        """Generated Nuxt hash names also need their vendored byte inventory."""
        if len(parts) < 2 or parts[0] != "_nuxt":
            return False
        try:
            raw = self._read((".wavedl-assets.json",), limit=1024 * 1024)
        except FileNotFoundError:
            return False
        except (OSError, ValueError):
            raise HTTPException(404, "Not found") from None
        try:
            inventory = json.loads(raw, object_pairs_hook=_unique_object)
            if not isinstance(inventory, dict):
                raise ValueError("Invalid asset inventory")
            marker_digest = inventory.get(".wavedl-immutable.json")
            if marker_digest is not None:
                marker_raw = self._read((".wavedl-immutable.json",), limit=1024 * 1024)
                if hashlib.sha256(marker_raw).hexdigest() != marker_digest:
                    raise ValueError("Immutable inventory does not match its build")
                marker = json.loads(marker_raw, object_pairs_hook=_unique_object)
                if (
                    not isinstance(marker, dict)
                    or set(marker) != {"version", "paths"}
                    or type(marker.get("version")) is not int
                    or marker.get("version") != 1
                    or not isinstance(marker.get("paths"), list)
                    or not 0 < len(marker["paths"]) <= min(len(inventory), 10000)
                ):
                    raise ValueError("Invalid immutable inventory")
                paths = set()
                for path in marker["paths"]:
                    if (
                        not isinstance(path, str)
                        or len(path) > 1024
                        or len(path.split("/")) > 32
                        or re.fullmatch(
                            r"_nuxt/(?:[A-Za-z0-9_.@+-]+/)*[A-Za-z0-9_.@+-]+", path
                        )
                        is None
                        or any(part in {".", ".."} for part in path.split("/"))
                        or path in paths
                        or not isinstance(inventory.get(path), str)
                        or re.fullmatch(r"[a-f0-9]{64}", inventory[path]) is None
                    ):
                        raise ValueError("Invalid immutable inventory path")
                    paths.add(path)
                if "/".join(parts) not in paths:
                    return False
            else:
                # Compatibility for previously vendored builds. Lowercase-only
                # names require explicit producer provenance in the new marker.
                match = re.search(
                    r"(?:^|\.)([A-Za-z0-9_-]{8,})\.(?:js|css)$", parts[-1]
                )
                if (
                    len(parts) != 2
                    or match is None
                    or not any(c.isupper() or c.isdigit() for c in match[1])
                ):
                    return False
            if inventory.get("/".join(parts)) != digest:
                raise ValueError("Asset does not match its vendored build")
        except (ValueError, OSError):
            raise HTTPException(404, "Not found") from None
        return True

    def _load(self, parts: tuple[str, ...], navigation: bool):
        try:
            raw = self._read(parts)
            name = parts[-1]
        except FileNotFoundError:
            if not navigation:
                raise HTTPException(404, "Not found") from None
            try:
                raw = self._read(("index.html",))
                name = "index.html"
            except FileNotFoundError:
                raise HTTPException(
                    503,
                    "Web client build unavailable",
                    headers={"Cache-Control": "no-store"},
                ) from None
            except (OSError, ValueError):
                raise HTTPException(404, "Not found") from None
        except (OSError, ValueError):
            raise HTTPException(404, "Not found") from None
        media_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
        html = media_type == "text/html"
        # Only content-verified digest names are immutable; arbitrary filenames,
        # the manifest and worker must remain revalidated across upgrades.
        digest = hashlib.sha256(raw).hexdigest()
        hashes = re.findall(r"(?:^|[.-])([a-f0-9]{12,64})(?=\.)", name)
        immutable = not html and (
            self._nuxt_immutable(parts, digest)
            if parts[0] == "_nuxt"
            else any(digest.startswith(value) for value in hashes)
        )
        return raw, media_type, _headers(raw, html=html, immutable=immutable)

    async def serve(self, request):
        path = request.path_params["path"]
        if path.endswith("/"):
            path = path[:-1]
        parts = tuple(path.split("/")) if path else ("index.html",)
        if any(
            not part
            or part in (".", "..")
            or any(char in part for char in "\\:\0")
            or any(ord(char) < 32 or ord(char) == 127 for char in part)
            for part in parts
        ):
            raise HTTPException(404, "Not found")
        # Missing asset URLs are never the shell. Navigation must explicitly
        # accept HTML, while / is always a shell request.
        navigation = not path or (
            "text/html" in request.headers.get("accept", "") and "." not in parts[-1]
        )
        try:
            raw, media_type, headers = await anyio.to_thread.run_sync(
                self._load, parts, navigation, limiter=self.limiter
            )
        except HTTPException as error:
            if error.status_code != 503:
                raise
            response = Response(
                "Web client build unavailable. Generate and vendor the web client "
                "before building the daemon package.",
                status_code=503,
                media_type="text/plain",
                headers={
                    "Cache-Control": "no-store",
                    "Referrer-Policy": "no-referrer",
                    "X-Content-Type-Options": "nosniff",
                    "Content-Security-Policy": (
                        "default-src 'none'; base-uri 'none'; frame-ancestors 'none'"
                    ),
                },
            )
        else:
            response = Response(raw, media_type=media_type, headers=headers)
        if request.method == "HEAD":
            response.body = b""
        return response


def static_routes(root: Path | None = None) -> list[Route]:
    """Register the final public route without resolving or opening assets."""
    client = StaticClient(
        root if root is not None else Path(__file__).parent.parent / "web_assets"
    )
    return [_ClientRoute("/{path:path}", client.serve, methods=["GET", "HEAD"])]
