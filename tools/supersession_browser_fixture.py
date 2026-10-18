"""Genuine same-run checkpoint resume fixture for T35 browser acceptance."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import sqlite3
import sys
from dataclasses import replace
from pathlib import Path

from tools import browser_adoption_fixture as adoption, browser_daemon_fixture as base
from wavedl.core.checkpoint_selection import read_selection_metadata
from wavedl.core.generations import published_generations
from wavedl.core.layout import RunLayout
from wavedl.core.safe_files import open_directory


def bounded_bytes(path: Path, limit: int = 64 * 1024 * 1024) -> bytes:
    """Keep evidence reads bounded and reject special or linked source files."""
    try:
        with open_directory(path.parent) as directory:
            return directory.read_file(path.name, limit=limit)
    except ValueError as exc:
        raise ValueError("source proof requires a bounded ordinary file") from exc


def source_evidence(root: Path) -> dict:
    run = root.resolve() / "standalone"
    # A supplied fixture root may use macOS's /var alias; its owned standalone
    # directory and descendants must never be resolved through replacements.
    with open_directory(run):
        pass
    manifest = json.loads(bounded_bytes(run / "manifest.json", 1024 * 1024))
    layout = RunLayout(run, manifest["run_id"])
    generation = next(
        (
            item
            for item in published_generations(layout)
            if item.attempt == 1 and item.step == 1
        ),
        None,
    )
    if generation is None:
        raise ValueError("verified epoch-1 publication missing")
    selection = read_selection_metadata(generation)
    if selection is None or type(selection.get("source_seq")) is not int:
        raise ValueError("exact checkpoint source cursor missing")
    if layout.run_id != manifest["run_id"]:
        raise ValueError("manifest/layout run identity mismatch")
    journals = {}
    files = {}
    requests = {}
    identities = {}
    raw_documents = {
        "manifest.json": bounded_bytes(run / "manifest.json", 1024 * 1024).decode(
            "utf-8"
        )
    }
    manifest_path = run / "manifest.json"
    manifest_raw = bounded_bytes(manifest_path, 1024 * 1024)
    files["manifest.json"] = {
        "size": len(manifest_raw),
        "sha256": hashlib.sha256(manifest_raw).hexdigest(),
    }
    for attempt in (1, 2):
        raw = bounded_bytes(layout.journal(attempt), 1024 * 1024)
        events = [json.loads(line) for line in raw.splitlines()]
        if not raw.endswith(b"\n") or not events or events[-1]["type"] != "exit":
            raise ValueError("launcher journal incomplete")
        if events[-1]["payload"].get("status") != "completed":
            raise ValueError("launcher attempt did not genuinely complete")
        for seq, event in enumerate(events):
            if not isinstance(event, dict) or event.get("type") not in {
                "hello",
                "metric",
                "artifact",
                "supersede",
                "exit",
                "log",
                "state",
            }:
                raise ValueError("journal contains an unknown event type")
            if (event["run_id"], event["attempt"], event["seq"]) != (
                layout.run_id,
                attempt,
                seq,
            ):
                raise ValueError("journal identity/order mismatch")
            if type(event["seq"]) is not int or event["seq"] < 0:
                raise ValueError("journal sequence is not a nonnegative integer")
        journals[str(attempt)] = {
            "sha256": hashlib.sha256(raw).hexdigest(),
            "size": len(raw),
            "raw": raw.decode("utf-8"),
            "events": events,
        }
        files[f"attempts/{attempt}/events.jsonl"] = {
            "size": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
        }
        for name in ("runtime_request.json", "runtime_identity.json"):
            path = layout.attempt_dir(attempt) / name
            if not path.is_file() or path.is_symlink():
                raise ValueError(
                    f"runtime identity artifact missing for attempt {attempt}"
                )
            content = bounded_bytes(path, 1024 * 1024)
            files[f"attempts/{attempt}/{name}"] = {
                "size": len(content),
                "sha256": hashlib.sha256(content).hexdigest(),
            }
            document = json.loads(content)
            raw_documents[f"attempts/{attempt}/{name}"] = content.decode("utf-8")
            if document.get("run_id") != layout.run_id:
                raise ValueError("runtime proof references a foreign run")
            if name == "runtime_identity.json":
                if document.get("attempt") != attempt or not document.get("request_id"):
                    raise ValueError("runtime identity references a foreign attempt")
                identities[str(attempt)] = document
            else:
                requests[str(attempt)] = document
    if identities["1"]["request_id"] == identities["2"]["request_id"]:
        raise ValueError(
            "distinct attempts require distinct runtime request identities"
        )
    metric_steps = {
        str(attempt): [
            e["payload"].get("step")
            for e in journals[str(attempt)]["events"]
            if e["type"] == "metric"
        ]
        for attempt in (1, 2)
    }
    if metric_steps != {"1": [1, 2, 3], "2": [2, 3]}:
        raise ValueError("genuine expected epoch metrics missing")
    for published in published_generations(layout):
        complete = published.path / "COMPLETE.json"
        if not complete.is_file() or complete.is_symlink():
            raise ValueError("published checkpoint marker missing")
        marker = bounded_bytes(complete, 1024 * 1024)
        raw_documents[str(complete.relative_to(run))] = marker.decode("utf-8")
        files[str(complete.relative_to(run))] = {
            "size": len(marker),
            "sha256": hashlib.sha256(marker).hexdigest(),
        }
        for name, record in published.files.items():
            path = published.path / name
            raw = bounded_bytes(path)
            observed = hashlib.sha256(raw).hexdigest()
            if len(raw) != record.size or observed != record.sha256:
                raise ValueError("published checkpoint file changed after COMPLETE")
            files[str(path.relative_to(run))] = {"size": len(raw), "sha256": observed}
            if name == "checkpoint_selection.json":
                raw_documents[str(path.relative_to(run))] = raw.decode("utf-8")
    boundary = [e for e in journals["2"]["events"] if e["type"] == "supersede"]
    expected = {
        "source_attempt": 1,
        "step": 1,
        "generation": generation.generation,
        "source_seq": selection["source_seq"],
        "reason": "resume",
    }
    if len(boundary) != 1 or boundary[0]["payload"] != expected:
        raise ValueError("resume boundary does not match verified publication")
    return {
        "runId": layout.run_id,
        "journals": journals,
        "boundary": boundary[0],
        "generation": generation.generation,
        "selection": selection,
        "files": files,
        "manifest": manifest,
        "runtimeRequests": requests,
        "runtimeIdentities": identities,
        "completeRaw": bounded_bytes(
            generation.path / "COMPLETE.json", 1024 * 1024
        ).decode("utf-8"),
        "selectionRaw": bounded_bytes(
            generation.path / "checkpoint_selection.json", 4096
        ).decode("utf-8"),
        "rawDocuments": raw_documents,
    }


def paused_app(application, root: Path):
    """One bounded pause after forwarding a genuine supersede SSE frame."""
    stream_lock = asyncio.Lock()
    source = source_evidence(root)
    run_id = source["runId"]
    expected_cursors = [
        (attempt, source["journals"][str(attempt)]["events"][-1]["seq"])
        for attempt in (1, 2)
    ]

    async def app(scope, receive, send):
        if (
            scope.get("type") != "http"
            or scope.get("method") != "GET"
            or scope.get("path") != f"/api/runs/{run_id}/events"
        ):
            return await application(scope, receive, send)
        pending = bytearray()
        forwarded = []
        frames = []
        frame_bytes = 0

        async def wait_for_ingestion():
            deadline = asyncio.get_running_loop().time() + 60
            while asyncio.get_running_loop().time() < deadline:
                try:
                    with sqlite3.connect(
                        (root / "state/registry.db").resolve().as_uri() + "?mode=ro",
                        uri=True,
                    ) as db:
                        rows = db.execute(
                            "SELECT attempt,seq FROM cursors WHERE run_id=? AND attempt IN (1,2) ORDER BY attempt",
                            (run_id,),
                        ).fetchall()
                    if rows == expected_cursors:
                        return rows
                except sqlite3.Error:
                    pass
                await asyncio.sleep(0.05)
            raise TimeoutError(
                "both attempt cursors were not ingested before streaming"
            )

        cursors = await wait_for_ingestion()

        async def checkpoint(stage, release):
            (root / ".supersession-stage.json").write_text(
                json.dumps(
                    {
                        "stage": stage,
                        "path": scope["path"],
                        "forwarded": forwarded,
                        "frames": frames,
                        "cursors": cursors,
                    }
                )
            )
            async with asyncio.timeout(60):
                while not (root / release).exists():
                    await asyncio.sleep(0.05)

        async def forward(message):
            nonlocal frame_bytes
            if message["type"] != "http.response.body":
                return await send(message)
            pending.extend(message.get("body", b""))
            if len(pending) > 1024 * 1024:
                raise ValueError("public fixture SSE pending frame exceeds byte bound")
            while b"\n\n" in pending:
                end = pending.index(b"\n\n") + 2
                frame = bytes(pending[:end])
                del pending[:end]
                frame_bytes += len(frame)
                if frame_bytes > 1024 * 1024 or len(frames) >= 4096:
                    raise ValueError("public fixture SSE exceeds bounded proof size")
                payload = b"\n".join(
                    line[6:]
                    for line in frame.splitlines()
                    if line.startswith(b"data: ")
                )
                event = json.loads(payload) if payload else None
                await send({**message, "body": frame, "more_body": True})
                frames.append(
                    {
                        "raw": frame.decode("utf-8"),
                        "sha256": hashlib.sha256(frame).hexdigest(),
                    }
                )
                if event and "seq" in event:
                    forwarded.append([event["attempt"], event["seq"]])
                if event and event.get("type") == "supersede":
                    await checkpoint("restored", ".supersession-release")
                if (
                    event
                    and event.get("type") == "metric"
                    and event.get("attempt") == 2
                    and event.get("payload", {}).get("step") == 2
                ):
                    await checkpoint("first_current", ".supersession-release-final")
                if event and event.get("type") == "exit" and event.get("attempt") == 2:
                    (root / ".supersession-stage.json").write_text(
                        json.dumps(
                            {
                                "stage": "complete",
                                "path": scope["path"],
                                "forwarded": forwarded,
                                "frames": frames,
                                "cursors": cursors,
                            }
                        )
                    )
            if not message.get("more_body", False):
                await send({**message, "body": bytes(pending), "more_body": False})
                pending.clear()

        # One owned target stream at a time. Reconnects cannot pass the gates
        # while another connection is paused; the real app owns disconnect
        # cancellation and releases this lock when its task drains.
        async with asyncio.timeout(180), stream_lock:
            await application(scope, receive, forward)

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--token-file", type=Path)
    parser.add_argument("--inspect", action="store_true")
    parser.add_argument("--release", action="store_true")
    args = parser.parse_args()
    if args.inspect:
        source = source_evidence(args.root)
        with sqlite3.connect(
            (args.root / "state/registry.db").as_uri() + "?mode=ro", uri=True
        ) as db:
            db.row_factory = sqlite3.Row
            db.execute("BEGIN")
            source["projection"] = [
                dict(row)
                for row in db.execute(
                    "SELECT run_id,attempt,seq,step,name,value,active,metrics_json FROM metric_history "
                    "WHERE run_id=? ORDER BY attempt,seq",
                    (source["runId"],),
                )
            ]
            if not source["projection"]:
                raise ValueError("SQLite metric projection is empty")
            if any(row["run_id"] != source["runId"] for row in source["projection"]):
                raise ValueError("SQLite projection contains a foreign run")
            active = [row for row in source["projection"] if row["active"]]
            if {(row["attempt"], row["step"]) for row in active} != {
                (1, 1),
                (2, 2),
                (2, 3),
            }:
                raise ValueError("SQLite active projection is not the resumed attempt")
            source["projectionSha256"] = hashlib.sha256(
                json.dumps(
                    source["projection"], sort_keys=True, separators=(",", ":")
                ).encode()
            ).hexdigest()
            source["cursors"] = [
                list(row)
                for row in db.execute(
                    "SELECT attempt,seq FROM cursors WHERE run_id=? ORDER BY attempt",
                    (source["runId"],),
                )
            ]
        stage = args.root / ".supersession-stage.json"
        source["stream"] = json.loads(stage.read_bytes()) if stage.exists() else None
        source["registry"] = adoption.registry_evidence(args.root, source["runId"])
        print(json.dumps(source))
        return
    if args.release:
        (args.root / ".supersession-release").touch(exist_ok=False)
        return
    if args.token_file is None:
        parser.error("private token file required")
    # The daemon modules use top-level imports when launched as scripts. Alias
    # the package-qualified modules so adoption and daemon share this fixture's
    # patched source evidence and real ASGI app.
    sys.modules["browser_adoption_fixture"] = adoption
    sys.modules["browser_daemon_fixture"] = base
    original = base.run_command
    launched = False

    def launch_twice(spec, budget):
        nonlocal launched
        argv = list(spec.argv)
        argv[argv.index("--epochs") + 1] = "3"
        if "--save_every" not in argv:
            argv.extend(("--save_every", "1"))
        if launched:
            return original(replace(spec, argv=tuple(argv)), budget)
        launched = True
        first = original(replace(spec, argv=tuple(argv)), budget)
        if first.returncode != 0:
            return first
        output = Path(argv[argv.index("--output_dir") + 1])
        manifest = json.loads((output / "manifest.json").read_bytes())
        layout = RunLayout(output, manifest["run_id"])
        generation = next(
            (
                item
                for item in published_generations(layout)
                if item.attempt == 1 and item.step == 1
            ),
            None,
        )
        if (
            generation is None
            or (read_selection_metadata(generation) or {}).get("source_seq") is None
        ):
            raise RuntimeError("verified epoch-1 generation/source cursor missing")
        resumed = tuple(argv) + ("--resume", str(generation.path))
        second = original(replace(spec, argv=resumed), budget)
        if second.returncode != 0:
            raise RuntimeError("genuine resumed launcher failed")
        return first

    base.run_command = launch_twice
    adoption.source_evidence = source_evidence
    original_app = base.create_app
    base.create_app = lambda *a, **kw: paused_app(original_app(*a, **kw), args.root)
    asyncio.run(
        base.serve_fixture(
            args.root,
            1,
            0,
            seed_run=False,
            token_file=args.token_file,
            standalone_adoption=True,
            drop_adoption_ack=True,
        )
    )


if __name__ == "__main__":
    main()
