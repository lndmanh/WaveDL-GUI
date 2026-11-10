"""
Authenticated run lifecycle routes; creates no stores, threads or listeners.
Author: Ngo Duc Manh Le (manh@nnsvn.me)
"""

from __future__ import annotations

import sqlite3
from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.routing import APIRoute
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import Response

from wavedl_daemon.execution.budget import BudgetExhausted, StorageWorkError
from wavedl_daemon.execution.pool import WorkCancelled
from wavedl_daemon.http.app import strict_json_route
from wavedl_daemon.http.schemas.common import (
    API_ERRORS,
    JSON_BODY_ERRORS,
    NO_STORE,
    exact_query,
)
from wavedl_daemon.http.schemas.runs import (
    PlanRequest,
    PlanView,
    RunList,
    RunListFilter,
    RunOperationFilter,
    RunResponse,
    RunSourceFilter,
    SubmitRequest,
)
from wavedl_daemon.storage.ownership import DispatchRequired
from wavedl_daemon.storage.plans import IdempotencyConflict, RunAlreadyStarted
from wavedl_daemon.storage.settings import UnsupportedStorage


if TYPE_CHECKING:
    from collections.abc import Callable

    from wavedl_daemon.execution.service_host import AsyncRunService


async def _call(callback: Callable, *args, **kwargs):
    """Await the bounded owner adapter with lifecycle-specific error mapping."""
    try:
        return await callback(*args, **kwargs)
    except IdempotencyConflict:
        raise HTTPException(409, "Idempotency conflict") from None
    except RunAlreadyStarted:
        raise HTTPException(409, "Run already started") from None
    except KeyError:
        raise HTTPException(404, "Not found") from None
    except (
        BudgetExhausted,
        StorageWorkError,
        WorkCancelled,
        DispatchRequired,
        PermissionError,
        UnsupportedStorage,
        sqlite3.DatabaseError,
        OSError,
    ):
        raise HTTPException(503, "Lifecycle service unavailable") from None
    except (ValueError, TypeError):
        raise HTTPException(400, "Invalid lifecycle request") from None


def lifecycle_routes(service: AsyncRunService) -> list[APIRoute]:
    """SecurityBoundary in the enclosing app authenticates every API route."""

    async def plan(body: PlanRequest, request: Request, response: Response):
        if len(request.headers.getlist("idempotency-key")) != 1:
            raise HTTPException(400, "One idempotency key is required")
        key = request.headers.get("idempotency-key")
        result = await _call(
            service.plan, body.model_dump(mode="json", exclude_unset=True), key
        )
        response.headers.update(NO_STORE)
        return result.to_dict()

    async def replan(
        run_id: str, body: PlanRequest, request: Request, response: Response
    ):
        if len(request.headers.getlist("idempotency-key")) != 1:
            raise HTTPException(400, "One idempotency key is required")
        key = request.headers.get("idempotency-key")
        result = await _call(
            service.replan,
            run_id,
            body.model_dump(mode="json", exclude_unset=True),
            key,
        )
        response.headers.update(NO_STORE)
        return result.to_dict()

    async def delete(run_id: str):
        await _call(service.delete, run_id)
        return Response(status_code=204, headers=NO_STORE)

    async def submit(body: SubmitRequest, response: Response):
        result = await _call(service.submit, body.plan_id)
        response.headers.update(NO_STORE)
        return result.to_dict()

    async def cancel(run_id: str, response: Response):
        result = await _call(service.cancel, run_id)
        response.headers.update(NO_STORE)
        return result.to_dict()

    async def get(run_id: str, response: Response):
        result = await _call(service.get, run_id)
        response.headers.update(NO_STORE)
        return result.to_dict()

    async def get_plan(run_id: str, response: Response):
        result = await _call(service.get_plan, run_id)
        response.headers.update(NO_STORE)
        return result.to_dict()

    async def list_runs(
        response: Response,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        offset: Annotated[int, Query(ge=0, le=10000)] = 0,
        state: RunListFilter | None = None,
        operation: Annotated[list[RunOperationFilter] | None, Query()] = None,
        source_run_id: Annotated[RunSourceFilter | None, Query()] = None,
    ):
        """List runs newest first, applying filters before pagination."""
        result = await _call(
            service.list, limit, offset, state, tuple(operation or ()), source_run_id
        )
        response.headers.update(NO_STORE)
        return {"runs": [item.to_dict() for item in result]}

    router = APIRouter()
    router.add_api_route(
        "/api/runs/plan",
        plan,
        operation_id="plan_run",
        responses=JSON_BODY_ERRORS,
        methods=["POST"],
        response_model=PlanView,
        route_class_override=strict_json_route(65536),
    )
    router.add_api_route(
        "/api/runs",
        submit,
        operation_id="submit_run",
        responses=JSON_BODY_ERRORS,
        methods=["POST"],
        response_model=RunResponse,
        status_code=202,
        route_class_override=strict_json_route(4096),
    )
    router.add_api_route(
        "/api/runs",
        list_runs,
        operation_id="list_runs",
        responses=API_ERRORS,
        methods=["GET", "HEAD"],
        response_model=RunList,
        dependencies=[
            Depends(
                exact_query(
                    "limit",
                    "offset",
                    "state",
                    "operation",
                    "source_run_id",
                    repeatable=("operation",),
                )
            )
        ],
    )
    router.add_api_route(
        "/api/runs/{run_id}/cancel",
        cancel,
        operation_id="cancel_run",
        responses=API_ERRORS,
        methods=["POST"],
        response_model=RunResponse,
        status_code=202,
    )
    router.add_api_route(
        "/api/runs/{run_id}/plan",
        replan,
        operation_id="replan_run",
        responses=JSON_BODY_ERRORS,
        methods=["PUT"],
        response_model=PlanView,
        route_class_override=strict_json_route(65536),
    )
    router.add_api_route(
        "/api/runs/{run_id}",
        delete,
        operation_id="delete_run",
        responses=API_ERRORS,
        methods=["DELETE"],
        status_code=204,
    )
    router.add_api_route(
        "/api/runs/{run_id}/plan",
        get_plan,
        operation_id="get_run_plan",
        responses=API_ERRORS,
        methods=["GET", "HEAD"],
        response_model=PlanView,
    )
    router.add_api_route(
        "/api/runs/{run_id}",
        get,
        operation_id="get_run",
        responses=API_ERRORS,
        methods=["GET", "HEAD"],
        response_model=RunResponse,
    )
    return [route for route in router.routes if isinstance(route, APIRoute)]
