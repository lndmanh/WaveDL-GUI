"""Owned fault copies of genuine launcher evidence; never fabricate HTTP outcomes."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import shutil
import sqlite3
from pathlib import Path
from uuid import uuid4

from browser_adoption_fixture import source_evidence

from wavedl.core.safe_files import open_directory


MODES = ("corrupt-provenance", "conflicting-identity", "missing-provenance")


def files(run):
    result = {}
    for path in sorted(run.rglob("*")):
        if path.is_symlink():
            raise ValueError("No symlink evidence")
        if path.is_file():
            before = path.stat()
            if before.st_size > 64 * 1024 * 1024:
                raise ValueError("Evidence file exceeds bound")
            with (
                open_directory(path.parent) as directory,
                directory.open_file(path.name) as stream,
            ):
                opened = path.stat()
                if (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino):
                    raise ValueError("Evidence changed before open")
                pieces = []
                total = 0
                while piece := stream.read():
                    total += len(piece)
                    if total > 64 * 1024 * 1024:
                        raise ValueError("Evidence file exceeds bound")
                    pieces.append(piece)
                raw = b"".join(pieces)
                stream.guard()
                after = path.stat()
                if (len(raw), after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (
                    opened.st_size,
                    opened.st_size,
                    opened.st_mtime_ns,
                    opened.st_ctime_ns,
                ):
                    raise ValueError("Evidence changed while reading")
            result[path.relative_to(run).as_posix()] = {
                "size": len(raw),
                "sha256": hashlib.sha256(raw).hexdigest(),
            }
    return result


def prepare(root):
    from wavedl_daemon.runs.adoption import verify_standalone_run

    original = source_evidence(root)
    cases = []
    for mode in MODES:
        target = root / mode
        shutil.copytree(root / "standalone", target)
        # A real copy needs its own immutable pathname authority before faults.
        for path in (
            target / "manifest.json",
            target / "attempts/1/runtime_request.json",
        ):
            value = json.loads(path.read_bytes())
            value["run_directory"] = value["working_directory"] = str(target)
            value["resolved_config"]["output_dir"] = str(target)
            path.write_text(json.dumps(value), encoding="utf-8")
        with verify_standalone_run(target) as verified:
            assert verified.layout.run_id == original["runId"]
        before = files(target)
        identity = target / "attempts/1/runtime_identity.json"
        if mode == "missing-provenance":
            identity.unlink()
        elif mode == "corrupt-provenance":
            identity.write_bytes(b"{broken")
        else:
            value = json.loads(identity.read_bytes())
            value["run_id"] = str(uuid4())
            identity.write_text(json.dumps(value), encoding="utf-8")
        cases.append(
            {
                "mode": mode,
                "path": str(target),
                "validBeforeFault": True,
                "beforeFault": before,
                "faulted": files(target),
            }
        )
    return {"original": original, "cases": cases}


def inspect(root):
    with sqlite3.connect(
        (root / "state/registry.db").resolve().as_uri() + "?mode=ro", uri=True
    ) as db:
        tables = (
            "plans",
            "plan_control",
            "execution_control",
            "submission_control",
            "runs",
            "runtime_provenance",
            "event_log",
        )
        counts = {
            table: db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in tables
        }
    return {
        "original": source_evidence(root),
        "originalFiles": files(root / "standalone"),
        "counts": counts,
        "cases": [{"mode": mode, "files": files(root / mode)} for mode in MODES],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--token-file", type=Path)
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--inspect", action="store_true")
    args = parser.parse_args()
    if args.prepare:
        print(json.dumps(prepare(args.root)))
    elif args.inspect:
        print(json.dumps(inspect(args.root)))
    else:
        from browser_daemon_fixture import serve_fixture

        if args.token_file is None:
            parser.error("Private token file required")
        asyncio.run(
            serve_fixture(
                args.root,
                1,
                0,
                seed_run=False,
                token_file=args.token_file,
                standalone_adoption=True,
            )
        )


if __name__ == "__main__":
    main()
