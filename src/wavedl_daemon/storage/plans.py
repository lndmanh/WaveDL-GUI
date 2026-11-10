"""
Plans and their replay identity, editable only until the run log starts them.

Author: Ngo Duc Manh Le (manh@nnsvn.me)
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from wavedl_daemon.backends.contracts import Plan
from wavedl_daemon.runs.lifecycle import LIVE_RUN_STATES


if TYPE_CHECKING:
    import sqlite3
    from collections.abc import Mapping


class IdempotencyConflict(ValueError):
    """An existing idempotency key was reused for a different request."""


class RunAlreadyStarted(ValueError):
    """A started run's approved plan cannot be edited or deleted."""


@dataclass(frozen=True)
class PlanRecord:
    plan_id: str
    run_id: str
    request_id: str
    idempotency_key: str
    request_json: str
    plan: Plan
    created_at: str


def canonical_request(payload: Mapping[str, object]) -> str:
    """The request as submitted JSON; files and environment are never re-read."""
    if type(payload) is not dict:
        raise ValueError("Request payload must be a JSON object, not a custom mapping")
    active: set[int] = set()

    def validate(value: object, depth: int = 0) -> None:
        if depth > 64:
            raise ValueError("Request payload exceeds maximum JSON nesting")
        if type(value) in {dict, list}:
            identity = id(value)
            if identity in active:
                raise ValueError("Request payload contains a JSON cycle")
            active.add(identity)
            try:
                if type(value) is dict:
                    if not all(type(key) is str for key in value):
                        raise ValueError("Request payload keys must be strings")
                    children = value.values()
                else:
                    children = value
                for child in children:
                    validate(child, depth + 1)
            finally:
                active.remove(identity)
        elif type(value) not in {str, int, float, bool, type(None)}:
            raise ValueError("Request payload must contain only JSON values")
        elif type(value) is float and not math.isfinite(value):
            raise ValueError("Request payload numbers must be finite")

    validate(payload)
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False)


_SELECT = (
    "SELECT plans.plan_id, plans.run_id, plans.request_id, plans.idempotency_key, "
    "plans.request_json, plans.plan_json, plans.created_at FROM plans "
)


def _record(row: sqlite3.Row | None) -> PlanRecord | None:
    if row is None:
        return None
    return PlanRecord(
        row["plan_id"],
        row["run_id"],
        row["request_id"],
        row["idempotency_key"],
        row["request_json"],
        Plan.from_json(row["plan_json"]),
        row["created_at"],
    )


class PlanStore:
    """Plan persistence on a connection from ``open_database``."""

    def __init__(self, connection: sqlite3.Connection):
        self._connection = connection

    def get(self, plan_id: str) -> PlanRecord | None:
        return _record(
            self._connection.execute(
                _SELECT + "WHERE plan_id = ?", (plan_id,)
            ).fetchone()
        )

    def get_by_key(self, idempotency_key: str) -> PlanRecord | None:
        return _record(
            self._connection.execute(
                _SELECT + "WHERE idempotency_key = ?", (idempotency_key,)
            ).fetchone()
        )

    def by_run(self, run_id: str) -> PlanRecord | None:
        return _record(
            self._connection.execute(_SELECT + "WHERE run_id = ?", (run_id,)).fetchone()
        )

    def page(
        self,
        *,
        limit: int,
        offset: int,
        state: str | None = None,
        operations: tuple[str, ...] = (),
        source_run_id: str | None = None,
    ) -> list[PlanRecord]:
        query, parameters = self._page_query(state, operations, source_run_id)
        rows = self._connection.execute(query, (*parameters, limit, offset))
        return [_record(row) for row in rows]

    def _page_query(
        self,
        state: str | None,
        operations: tuple[str, ...] = (),
        source_run_id: str | None = None,
    ) -> tuple[str, list[str | int]]:
        query = _SELECT
        parameters: list[str | int] = []
        clauses: list[str] = []
        if state == "live":
            query += "INNER JOIN run_heads ON plans.run_id = run_heads.run_id "
            clauses.append("run_heads.state IN (?, ?, ?, ?, ?, ?)")
            parameters.extend(sorted(item.value for item in LIVE_RUN_STATES))
        elif state is not None:
            query += "LEFT JOIN run_heads ON plans.run_id = run_heads.run_id "
            if state == "planned":
                clauses.append("run_heads.run_id IS NULL")
            else:
                clauses.append("run_heads.state = ?")
                parameters.append(state)
        if operations:
            placeholders = ", ".join("?" for _ in operations)
            clauses.append(
                f"json_extract(plans.plan_json, '$.spec.operation') IN ({placeholders})"
            )
            parameters.extend(operations)
        if source_run_id is not None:
            clauses.append(
                "json_extract(plans.plan_json, '$.spec.checkpoint_source.run_id') = ?"
            )
            parameters.append(source_run_id)
        if clauses:
            query += "WHERE " + " AND ".join(clauses) + " "
        query += "ORDER BY plans.created_at DESC, plans.plan_id DESC LIMIT ? OFFSET ?"
        return query, parameters

    def put(
        self, plan: Plan, *, idempotency_key: str, request_payload: Mapping[str, object]
    ) -> PlanRecord:
        """Insert the plan, or replay the one this key already names."""
        if not isinstance(idempotency_key, str) or not idempotency_key:
            raise ValueError("idempotency_key must be a nonempty string")
        request_json = canonical_request(request_payload)
        self._connection.execute("BEGIN IMMEDIATE")
        try:
            existing = self.get_by_key(idempotency_key)
            if existing is None:
                self._connection.execute(
                    "INSERT INTO plans (plan_id, run_id, request_id, idempotency_key, "
                    "request_json, plan_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        str(uuid4()),
                        plan.run_id,
                        str(uuid4()),
                        idempotency_key,
                        request_json,
                        plan.to_json(),
                        datetime.now(UTC).isoformat(),
                    ),
                )
            self._connection.execute("COMMIT")
        except BaseException:
            if self._connection.in_transaction:
                self._connection.execute("ROLLBACK")
            raise
        if existing is not None and existing.request_json != request_json:
            raise IdempotencyConflict("Key is bound to a different request")
        record = existing or self.get_by_key(idempotency_key)
        if record is None:
            raise RuntimeError("The plan insert did not commit")
        return record

    def replace(
        self, plan: Plan, *, idempotency_key: str, request_payload: Mapping[str, object]
    ) -> bool:
        """Rotate approval identity only if submit has not opened the run."""
        return (
            self._connection.execute(
                "UPDATE plans SET plan_id=?, request_id=?, idempotency_key=?, "
                "request_json=?, plan_json=? WHERE run_id=? "
                "AND run_id NOT IN (SELECT run_id FROM run_heads)",
                (
                    str(uuid4()),
                    str(uuid4()),
                    idempotency_key,
                    canonical_request(request_payload),
                    plan.to_json(),
                    plan.run_id,
                ),
            ).rowcount
            == 1
        )

    def delete(self, run_id: str) -> bool:
        return (
            self._connection.execute(
                "DELETE FROM plans WHERE run_id=? "
                "AND run_id NOT IN (SELECT run_id FROM run_heads)",
                (run_id,),
            ).rowcount
            == 1
        )
