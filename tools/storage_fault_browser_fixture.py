"""Real SQLite refusal and recovery; numerical process result is controlled."""

from __future__ import annotations

import argparse
import asyncio
import json
import sqlite3
from dataclasses import asdict
from pathlib import Path

from wavedl.core.protocol import Envelope, encode


try:
    from tools import browser_journal_fault_fixture as base
except ModuleNotFoundError:
    import browser_journal_fault_fixture as base


LIMITATION = (
    "Controlled terminal numerical supervisor; genuine local submission, journal, "
    "owner ingestion, SQLite query_only/SQLITE_FULL, HTTP, SSE and native browser. "
    "Not native ENOSPC, filesystem permissions, ML training or site certification."
)


class StorageScenario(base.JournalScenario):
    async def seed(self):
        # Seed an accepted HELLO using the ordinary journal scenario, but append
        # nothing until the private SQLite refusal has been installed.
        await super().seed()
        return base.latest(self.root)

    def append(self, source, suffix, expected):
        if self.phase == -1:
            source["damaged"] = b""
            return
        return super().append(source, suffix, expected)

    async def snapshot(self, phase, start):
        cases = {}
        for fault, source in self.sources.items():
            plan = source["plan"]

            def owner(s, plan=plan):
                db = s.registry._connection
                record = s.registry.get(plan.run_id)
                return {
                    "registry": {
                        "state": record.state,
                        "eventCount": record.event_count,
                    },
                    "cursors": [
                        list(row)
                        for row in db.execute(
                            "SELECT attempt,seq FROM cursors WHERE run_id=? ORDER BY attempt",
                            (plan.run_id,),
                        )
                    ],
                    "events": [
                        json.loads(row[0])
                        for row in db.execute(
                            "SELECT event_json FROM event_log WHERE run_id=? ORDER BY attempt,seq",
                            (plan.run_id,),
                        )
                    ],
                    "bookmark": asdict(s.ingestor._bookmarks[(plan.run_id, 1)]),
                    "view": s.runs.get(plan.run_id).to_dict(),
                    "pageCount": db.execute("PRAGMA page_count").fetchone()[0],
                    "maxPages": db.execute("PRAGMA max_page_count").fetchone()[0],
                    "queryOnly": db.execute("PRAGMA query_only").fetchone()[0],
                }

            c = await self.services.host.call(owner)
            raw = base.bounded_read(source["layout"].journal(1), base.MAX_JOURNAL_BYTES)
            c.update(
                runId=plan.run_id,
                planId=plan.plan_id,
                journalHex=raw.hex(),
                journalSha256=base.digest(raw),
            )
            c["sqliteErrors"] = list(getattr(self, "sqlite_errors", []))
            cases[fault] = c
        result = {
            "scope": "real-sqlite-storage-refusal",
            "limitation": LIMITATION,
            "fixtureId": self.fixture_id,
            "phase": phase,
            "laps": await self.laps(),
            "phaseStartLaps": start,
            "cases": cases,
            "health": await self.services.health(),
        }
        base.publish(self.root / f"snapshot-{phase}.json", result)
        self.phase = phase
        return result

    async def advance(self, phase):
        if phase != self.phase + 1 or phase not in {1, 2, 3}:
            raise ValueError("Private control regressed or skipped")
        source = next(iter(self.sources.values()))
        fault = next(iter(self.sources))
        if phase == 1:
            self.sqlite_errors = []

            def refuse(s):
                db = s.registry._connection
                self.original_pages = db.execute("PRAGMA max_page_count").fetchone()[0]
                if fault == "query_only":
                    db.execute("PRAGMA query_only=ON")
                else:
                    pages = db.execute("PRAGMA page_count").fetchone()[0]
                    if (
                        db.execute(f"PRAGMA max_page_count={pages}").fetchone()[0]
                        != pages
                    ):
                        raise ValueError("Quota not installed")
                original = s.registry.apply_events

                def capture(*args):
                    try:
                        return original(*args)
                    except sqlite3.OperationalError as error:
                        proof = {
                            "code": error.sqlite_errorcode,
                            "name": error.sqlite_errorname,
                        }
                        if proof not in self.sqlite_errors:
                            self.sqlite_errors.append(proof)
                        raise

                s.registry.apply_events = capture
                middle = encode(
                    Envelope(
                        source["plan"].run_id,
                        1,
                        "log",
                        1,
                        "2026-10-15T00:00:00Z",
                        {
                            "stream": "stdout",
                            "level": "info",
                            "message": "quota-growth:" + "x" * 60000,
                        },
                    )
                )
                completed = encode(
                    Envelope(
                        source["plan"].run_id,
                        1,
                        "exit",
                        2,
                        "2026-10-15T00:00:00Z",
                        {"status": "completed", "code": 0},
                    )
                )
                self.append(source, middle + completed, source["prefix"])

            await self.services.host.call(refuse)

            async def refused():
                return bool(self.sqlite_errors)

            await base.until(refused)
        elif phase == 2:

            def recover(s):
                db = s.registry._connection
                db.execute(
                    "PRAGMA query_only=OFF"
                    if fault == "query_only"
                    else f"PRAGMA max_page_count={self.original_pages}"
                )

            await self.services.host.call(recover)

            async def completed():
                return (
                    await self.services.run_service.get(source["plan"].run_id)
                ).state == "completed"

            await base.until(completed)
        else:
            await self.services.host.call(lambda s: s.ingestor._readers.clear())
            await self.services.run_service.submit(source["plan"].plan_id)
        return await self.snapshot(phase, await self.wait_laps())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--token-file", type=Path)
    parser.add_argument("--mode", choices=("query_only", "page_quota"), required=True)
    parser.add_argument("--phase", type=int)
    args = parser.parse_args()
    base.FAULTS = (args.mode,)
    base.LIMITATION = LIMITATION
    base.JournalScenario = StorageScenario
    if args.phase is not None:
        print(json.dumps(base.queue_command(args.root, args.phase)))
    else:
        asyncio.run(base.serve(args.root, args.token_file))


if __name__ == "__main__":
    main()
