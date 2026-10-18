"""Authenticated lifecycle route assembly; no stores, threads, or listeners."""

from __future__ import annotations

import inspect
import sqlite3
from typing import TYPE_CHECKING

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.routing import Route

from wavedl_daemon.execution.budget import BudgetExhausted, StorageWorkError
from wavedl_daemon.execution.pool import WorkCancelled
from wavedl_daemon.http.app import read_json
from wavedl_daemon.storage.ownership import DispatchRequired
from wavedl_daemon.storage.plans import IdempotencyConflict, PlanRecoveryRequired
from wavedl_daemon.storage.settings import UnsupportedStorage


if TYPE_CHECKING:
    from collections.abc import Callable

    from wavedl_daemon.execution.service_host import AsyncRunService
    from wavedl_daemon.runs.service import RunService


async def _call(callback: Callable, *args, **kwargs):
    """Await the bounded owner adapter, retaining inert synchronous test facades."""
    try:
        result = callback(*args, **kwargs)
        return await result if inspect.isawaitable(result) else result
    except IdempotencyConflict:
        raise HTTPException(409, "Idempotency conflict") from None
    except KeyError:
        raise HTTPException(404, "Not found") from None
    except (
        BudgetExhausted,
        StorageWorkError,
        WorkCancelled,
        DispatchRequired,
        PermissionError,
        PlanRecoveryRequired,
        UnsupportedStorage,
        sqlite3.DatabaseError,
        OSError,
    ):
        raise HTTPException(503, "Lifecycle service unavailable") from None
    except (ValueError, TypeError):
        raise HTTPException(400, "Invalid lifecycle request") from None


def lifecycle_routes(service: RunService | AsyncRunService) -> list[Route]:
    """SecurityBoundary in the enclosing app authenticates every API route."""

    async def plan(request):
        body = await read_json(request, max_bytes=65536)
        if len(request.headers.getlist("idempotency-key")) != 1:
            raise HTTPException(400, "One idempotency key is required")
        key = request.headers.get("idempotency-key")
        result = await _call(service.plan, body, key)
        return JSONResponse(result.to_dict(), headers={"Cache-Control": "no-store"})

    async def submit(request):
        body = await read_json(request, max_bytes=4096)
        if set(body) != {"plan_id"} or type(body["plan_id"]) is not str:
            raise HTTPException(400, "Invalid submit request")
        result = await _call(service.submit, body["plan_id"])
        return JSONResponse(
            result.to_dict(), 202, headers={"Cache-Control": "no-store"}
        )

    async def cancel(request):
        result = await _call(service.cancel, request.path_params["run_id"])
        return JSONResponse(
            result.to_dict(), 202, headers={"Cache-Control": "no-store"}
        )

    async def get(request):
        result = await _call(service.get, request.path_params["run_id"])
        return JSONResponse(result.to_dict(), headers={"Cache-Control": "no-store"})

    async def attempts(request):
        query = request.query_params
        if set(query) - {"limit", "offset"} or any(
            len(query.getlist(key)) != 1 for key in query
        ):
            raise HTTPException(400, "Invalid attempts query")
        try:
            limit, offset = int(query.get("limit", "50")), int(query.get("offset", "0"))
        except ValueError:
            raise HTTPException(400, "Invalid pagination") from None
        result = await _call(
            service.attempts, request.path_params["run_id"], limit=limit, offset=offset
        )
        return JSONResponse(result, headers={"Cache-Control": "no-store"})

    async def list_runs(request):
        query = request.query_params
        if set(query) - {"limit", "offset", "state"} or any(
            len(query.getlist(key)) != 1 for key in query
        ):
            raise HTTPException(400, "Invalid list query")
        try:
            limit, offset = int(query.get("limit", "50")), int(query.get("offset", "0"))
        except ValueError:
            raise HTTPException(400, "Invalid pagination") from None
        result = await _call(service.list, limit, offset, query.get("state"))
        return JSONResponse(
            {"runs": [item.to_dict() for item in result]},
            headers={"Cache-Control": "no-store"},
        )

    return [
        Route("/api/runs/plan", plan, methods=["POST"]),
        Route("/api/runs", submit, methods=["POST"]),
        Route("/api/runs", list_runs, methods=["GET"]),
        Route("/api/runs/{run_id}/cancel", cancel, methods=["POST"]),
        Route("/api/runs/{run_id}/attempts", attempts, methods=["GET"]),
        Route("/api/runs/{run_id}", get, methods=["GET"]),
    ]
