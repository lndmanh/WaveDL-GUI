"""Durable automatic-plot work, owned by the database thread."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

from wavedl_daemon.storage.run_log import _now


if TYPE_CHECKING:
    import sqlite3


AutomaticPlotStatus = Literal["pending", "submitted", "failed", "skipped"]

AUTOMATIC_PLOTS_SCHEMA = (
    "CREATE TABLE automatic_plots ("
    "source_run_id TEXT NOT NULL, source_attempt INTEGER NOT NULL "
    "CHECK(source_attempt >= 1), plot_run_id TEXT, "
    "status TEXT NOT NULL CHECK(status IN ('pending', 'submitted', 'failed', 'skipped')), "
    "failure TEXT CHECK(failure IS NULL OR length(failure) <= 300), "
    "created_at TEXT NOT NULL, updated_at TEXT NOT NULL, "
    "PRIMARY KEY(source_run_id, source_attempt)) WITHOUT ROWID",
    "CREATE INDEX automatic_plots_pending ON automatic_plots(created_at) "
    "WHERE status = 'pending'",
)


@dataclass(frozen=True)
class AutomaticPlot:
    source_run_id: str
    source_attempt: int
    plot_run_id: str | None
    status: AutomaticPlotStatus
    failure: str | None
    created_at: str
    updated_at: str


class AutomaticPlotStore:
    def __init__(self, connection: sqlite3.Connection):
        self._connection = connection

    def get(self, run_id: str, attempt: int) -> AutomaticPlot | None:
        row = self._connection.execute(
            "SELECT * FROM automatic_plots WHERE source_run_id = ? "
            "AND source_attempt = ?",
            (run_id, attempt),
        ).fetchone()
        return None if row is None else AutomaticPlot(**row)

    def undiscovered(self) -> tuple[str, int] | None:
        row = self._connection.execute(
            "SELECT h.run_id, h.attempt FROM run_heads h "
            "WHERE h.state = 'completed' "
            "AND json_extract(h.head_json, '$.operation') = 'train' "
            "AND json_extract(h.head_json, '$.stage.exit.confirmed') = 1 "
            "AND json_extract(h.head_json, '$.cancel_requested') = 0 "
            "AND NOT EXISTS (SELECT 1 FROM automatic_plots a "
            "WHERE a.source_run_id = h.run_id AND a.source_attempt = h.attempt) "
            "ORDER BY h.updated_at, h.run_id LIMIT 1"
        ).fetchone()
        return None if row is None else (row["run_id"], row["attempt"])

    def add(self, run_id: str, attempt: int, status: AutomaticPlotStatus) -> None:
        now = _now()
        self._connection.execute(
            "INSERT INTO automatic_plots "
            "(source_run_id, source_attempt, status, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(source_run_id, source_attempt) DO NOTHING",
            (run_id, attempt, status, now, now),
        )

    def pending(self) -> AutomaticPlot | None:
        row = self._connection.execute(
            "SELECT * FROM automatic_plots WHERE status = 'pending' "
            "ORDER BY created_at, source_run_id LIMIT 1"
        ).fetchone()
        return None if row is None else AutomaticPlot(**row)

    def update(
        self,
        run_id: str,
        attempt: int,
        status: AutomaticPlotStatus,
        *,
        plot_run_id: str | None = None,
        failure: str | None = None,
    ) -> None:
        self._connection.execute(
            "UPDATE automatic_plots SET status = ?, plot_run_id = ?, failure = ?, "
            "updated_at = ? WHERE source_run_id = ? AND source_attempt = ?",
            (status, plot_run_id, failure, _now(), run_id, attempt),
        )
