"""Stage a verified static build into the daemon package, retaining old output.

Run from any directory with ``python tools/vendor_web_assets.py`` after generating
the web client. Only the repository's explicit .output/public is accepted.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "web" / ".output" / "public"
TARGET = ROOT / "src" / "wavedl_daemon" / "web_assets"
WORK_AREA = ROOT / "web" / ".vendor-backups"
MANIFEST = ".wavedl-assets.json"
IMMUTABLE = ".wavedl-immutable.json"
OFFLINE_BUILD = "offline-build.json"
CLIENT_MANIFEST = (
    ROOT / "web/node_modules/.cache/nuxt/.nuxt/dist/server/client.manifest.mjs"
)
MAX_FILE = 32 * 1024 * 1024
MAX_OFFLINE_ASSETS = 128
MAX_OFFLINE_FILE = 8 * 1024 * 1024
MAX_OFFLINE_TOTAL = 16 * 1024 * 1024
MAX_OFFLINE_MANIFEST = 128 * 1024
ASSET_SUFFIXES = {
    ".css",
    ".html",
    ".ico",
    ".js",
    ".json",
    ".png",
    ".svg",
    ".webmanifest",
    ".woff2",
}


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate Nuxt client manifest key")
        result[key] = value
    return result


def inventory(directory: Path, *, managed: bool = False) -> dict[str, str]:
    """Reject links, backend output and unbounded files before packaging."""
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError("Static build directory is missing or is a symlink")
    result = {}
    for path in sorted(directory.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"Symlink is not a static asset: {path}")
        relative = path.relative_to(directory).as_posix()
        if path.is_dir():
            continue
        if not path.is_file() or path.stat().st_size > MAX_FILE:
            raise ValueError(f"Invalid or oversized static asset: {relative}")
        if managed and relative == MANIFEST:
            continue
        if managed and relative == IMMUTABLE:
            result[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
            continue
        if not managed and relative == OFFLINE_BUILD:
            raise ValueError(f"Unexpected static asset: {relative}")
        if path.suffix not in ASSET_SUFFIXES or any(
            part.startswith(".") for part in path.relative_to(directory).parts
        ):
            raise ValueError(f"Unexpected static asset: {relative}")
        if relative.split("/")[0] in {"api", "server", "node_modules"}:
            raise ValueError(f"Backend output is not a static asset: {relative}")
        result[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
    if not {"index.html", "sw.js", "manifest.webmanifest"}.issubset(result):
        raise ValueError("Expected generated SPA, service worker and manifest")
    return result


def immutable_paths(assets: dict[str, str]) -> list[str]:
    """Use Nuxt's generated client manifest, not guesses about hash spelling."""
    if (
        CLIENT_MANIFEST.is_symlink()
        or not CLIENT_MANIFEST.is_file()
        or CLIENT_MANIFEST.stat().st_size > MAX_FILE
    ):
        raise ValueError("Generated Nuxt client manifest is missing or a symlink")
    # Nuxt deletes Vite's JSON manifest after emitting this normalized module.
    # Import only this explicit build artifact, never a public source file.
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            "const m = await import(process.argv[1]); "
            "const raw = JSON.stringify(m.default); "
            "if (Buffer.byteLength(raw) > 1048576) throw Error('Manifest too large'); "
            "process.stdout.write(raw);",
            CLIENT_MANIFEST.as_uri(),
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if len(result.stdout.encode()) > 1024 * 1024:
        raise ValueError("Generated Nuxt client manifest is oversized")
    manifest = json.loads(result.stdout, object_pairs_hook=unique_object)
    if not isinstance(manifest, dict):
        raise ValueError("Invalid Nuxt client manifest")
    paths = set()
    for entry in manifest.values():
        if not isinstance(entry, dict):
            raise ValueError("Invalid Nuxt client manifest entry")
        filenames = [entry["file"]] if "file" in entry else []
        for field in ("css", "assets"):
            values = entry.get(field, [])
            if not isinstance(values, list):
                raise ValueError("Invalid Nuxt client manifest assets")
            filenames.extend(values)
        for name in filenames:
            if (
                not isinstance(name, str)
                or len(name) > 1018
                or len(name.split("/")) > 31
                or re.fullmatch(r"(?:[A-Za-z0-9_.@+-]+/)*[A-Za-z0-9_.@+-]+", name)
                is None
                or any(part in {".", ".."} for part in name.split("/"))
            ):
                raise ValueError("Invalid Nuxt client manifest path")
            relative = "_nuxt/" + name
            if relative not in assets:
                raise ValueError(f"Generated client asset is missing: {relative}")
            paths.add(relative)
    if not paths:
        raise ValueError("Generated Nuxt client manifest is empty")
    if len(paths) > 10000:
        raise ValueError("Generated Nuxt client manifest has too many assets")
    return sorted(paths)


def compact_json(value) -> bytes:
    """Match UTF-8 JSON.stringify for the inventory's ASCII-only values."""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def workbox_entries(worker: str) -> list[dict]:
    """Decode the single injected JSON array without relying on minified names.

    Workbox serializes its injected manifest as JSON. Decode candidate array
    literals independently rather than matching through arbitrary JS brackets.
    Exactly one nonempty array of url/revision records must be present.
    """
    decoder = json.JSONDecoder(object_pairs_hook=unique_object)
    candidates = []
    for match in re.finditer(r"\[\s*\{\s*\"(?:url|revision)\"\s*:", worker):
        try:
            entries, _end = decoder.raw_decode(worker, match.start())
        except (ValueError, json.JSONDecodeError):
            continue
        if (
            isinstance(entries, list)
            and entries
            and all(
                isinstance(entry, dict) and set(entry) == {"url", "revision"}
                for entry in entries
            )
        ):
            candidates.append(entries)
    if len(candidates) != 1:
        raise ValueError("Expected one actual injected Workbox precache manifest")
    return candidates[0]


def offline_inventory(assets: dict[str, str], immutable: list[str]) -> bytes:
    """Certify every required static dependency against the injected precache."""
    entries = workbox_entries((SOURCE / "sw.js").read_text(encoding="utf-8"))
    if len(entries) > MAX_OFFLINE_ASSETS:
        raise ValueError("Offline inventory has too many assets")
    records = []
    seen = set()
    total = 0
    for entry in entries:
        url, revision = entry["url"], entry["revision"]
        if not isinstance(url, str) or not (
            revision is None or isinstance(revision, str)
        ):
            raise ValueError("Invalid Workbox precache entry")
        relative = "index.html" if url == "/" else url.removeprefix("/")
        if (
            len(url) > 1024
            or len(relative.split("/")) > 32
            or re.fullmatch(r"(?:[A-Za-z0-9_.@+-]+/)*[A-Za-z0-9_.@+-]+", relative)
            is None
            or any(part.startswith(".") for part in relative.split("/"))
            or relative.split("/")[0].lower()
            in {
                "api",
                "v1",
                "v2",
                "auth",
                "events",
                "state",
                "token",
                "tokens",
                "server",
                "node_modules",
            }
            or relative in {"sw.js", "sw.mjs", OFFLINE_BUILD}
            or (relative == "index.html" and url != "/")
            or not (
                url == "/"
                or relative == "manifest.webmanifest"
                or (relative.startswith("_nuxt/") and relative.endswith(".json"))
                or Path(relative).suffix.lower()
                in {
                    ".js",
                    ".mjs",
                    ".css",
                    ".svg",
                    ".png",
                    ".jpg",
                    ".jpeg",
                    ".webp",
                    ".avif",
                    ".gif",
                    ".ico",
                    ".woff",
                    ".woff2",
                    ".ttf",
                    ".otf",
                }
            )
            or relative not in assets
        ):
            raise ValueError(f"Invalid or missing Workbox precache asset: {url}")
        normalized = "/" if relative == "index.html" else "/" + relative
        if normalized in seen:
            raise ValueError(f"Duplicate Workbox precache URL: {normalized}")
        seen.add(normalized)
        content = (SOURCE / relative).read_bytes()
        if hashlib.sha256(content).hexdigest() != assets[relative]:
            raise ValueError("Static build changed while creating offline inventory")
        size = len(content)
        if not 0 < size <= MAX_OFFLINE_FILE:
            raise ValueError(f"Invalid or oversized offline asset: {relative}")
        total += size
        if total > MAX_OFFLINE_TOTAL:
            raise ValueError("Offline build exceeds its byte budget")
        records.append(
            {
                "url": normalized,
                "sha256": assets[relative],
                "size": size,
                "immutable": relative in immutable,
            }
        )
    required = {
        "/" if relative == "index.html" else "/" + relative
        for relative in assets
        if relative in immutable
        or relative
        in {"index.html", "favicon.svg", "favicon.ico", "manifest.webmanifest"}
        or (
            Path(relative).suffix in {".js", ".css", ".woff2"}
            and relative not in {"sw.js", "sw.mjs"}
        )
    }
    missing = sorted(required - seen)
    if missing:
        raise ValueError(
            f"Required static assets missing from Workbox precache: {missing}"
        )
    records.sort(key=lambda record: record["url"])
    build_key = hashlib.sha256(
        compact_json(sorted([[entry["url"], entry["revision"]] for entry in entries]))
    ).hexdigest()
    generation = hashlib.sha256(
        compact_json(
            [
                [record["url"], record["sha256"], record["size"], record["immutable"]]
                for record in records
            ]
        )
    ).hexdigest()
    encoded = compact_json(
        {
            "schema_version": 1,
            "build_key": build_key,
            "generation": generation,
            "assets": records,
        }
    )
    if len(encoded) > MAX_OFFLINE_MANIFEST:
        raise ValueError("Offline inventory metadata is oversized")
    return encoded


def main() -> None:
    assets = inventory(SOURCE)
    immutable = immutable_paths(assets)
    marker = (
        json.dumps({"version": 1, "paths": immutable}, sort_keys=True) + "\n"
    ).encode()
    if len(marker) > 1024 * 1024:
        raise ValueError("Generated immutable inventory is oversized")
    offline = offline_inventory(assets, immutable)
    if TARGET.exists() or TARGET.is_symlink():
        previous = inventory(TARGET, managed=True)
        manifest = TARGET / MANIFEST
        if not manifest.is_file() or manifest.is_symlink():
            raise ValueError("Refusing to replace an unmanaged web_assets directory")
        if json.loads(manifest.read_text()) != previous:
            raise ValueError("Existing packaged assets differ from their manifest")
    if WORK_AREA.is_symlink():
        raise ValueError("Packaging work area must not be a symlink")
    WORK_AREA.mkdir(parents=True, exist_ok=True)
    if WORK_AREA.stat().st_dev != TARGET.parent.stat().st_dev:
        raise ValueError("Packaging stage and target must share a filesystem")
    stage = Path(tempfile.mkdtemp(prefix="stage-", dir=WORK_AREA))
    backup = None
    try:
        for relative in assets:
            destination = stage / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(SOURCE / relative, destination)
        if inventory(stage) != assets:
            raise ValueError("Static build changed while being staged")
        (stage / IMMUTABLE).write_bytes(marker)
        assets[IMMUTABLE] = hashlib.sha256(marker).hexdigest()
        (stage / OFFLINE_BUILD).write_bytes(offline)
        assets[OFFLINE_BUILD] = hashlib.sha256(offline).hexdigest()
        if inventory(stage, managed=True) != assets:
            raise ValueError("Generated metadata changed while being staged")
        (stage / MANIFEST).write_text(
            json.dumps(assets, indent=2, sort_keys=True) + "\n"
        )
        if TARGET.exists():
            backup = Path(tempfile.mkdtemp(prefix="backup-", dir=WORK_AREA))
            backup.rmdir()
            os.replace(TARGET, backup)
        try:
            os.replace(stage, TARGET)
        except BaseException:
            if backup is not None:
                os.replace(backup, TARGET)
            raise
        print(f"Packaged {len(assets)} verified static assets into {TARGET}")
        if backup is not None:
            print(f"Previous generated output retained for recovery: {backup}")
    finally:
        if stage.exists():
            shutil.rmtree(stage)


if __name__ == "__main__":
    main()
