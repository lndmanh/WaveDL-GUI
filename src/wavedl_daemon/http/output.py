"""
Authenticated, bounded reads of persisted trainer output.
Author: Ngo Duc Manh Le (manh@nnsvn.me)
"""

from __future__ import annotations

from dataclasses import asdict
from typing import TYPE_CHECKING, Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.routing import APIRoute
from starlette.exceptions import HTTPException
from starlette.responses import Response

from wavedl_daemon.execution.budget import BudgetExhausted, StorageWorkError
from wavedl_daemon.execution.pool import WorkCancelled
from wavedl_daemon.execution.service_host import AsyncRunService
from wavedl_daemon.http.runs import _call
from wavedl_daemon.http.schemas.common import API_ERRORS, NO_STORE, exact_query
from wavedl_daemon.http.schemas.output import OutputChunk
from wavedl_daemon.runs.output import (
    MAX_OUTPUT_OFFSET,
    OutputSource,
    read_output,
    resolve_output,
)


if TYPE_CHECKING:
    from wavedl_daemon.execution.pool import BoundedThreadPool


def output_routes(pool: BoundedThreadPool, service) -> list[APIRoute]:
    """Mount inside the same bearer boundary as run events and artifacts."""

    async def resolve(run_id: str, attempt: int | None) -> OutputSource:
        if isinstance(service, AsyncRunService):
            return await service.output_source(run_id, attempt)
        return resolve_output(service, run_id, attempt)

    async def output(
        run_id: str,
        response: Response,
        attempt: Annotated[int | None, Query(ge=1, le=MAX_OUTPUT_OFFSET)] = None,
        offset: Annotated[int | None, Query(ge=0, le=MAX_OUTPUT_OFFSET)] = None,
    ):
        try:
            if str(UUID(run_id)) != run_id:
                raise ValueError("Invalid run identity")
        except ValueError:
            raise HTTPException(400, "Invalid run identity") from None
        source = await _call(resolve, run_id, attempt)
        try:
            chunk = await pool.submit(lambda token: read_output(source, offset)).wait()
        except ValueError:
            raise HTTPException(400, "Invalid output request") from None
        except (BudgetExhausted, StorageWorkError, WorkCancelled, OSError):
            raise HTTPException(503, "Output service unavailable") from None
        response.headers.update(NO_STORE)
        return asdict(chunk)

    router = APIRouter()
    router.add_api_route(
        "/api/runs/{run_id}/output",
        output,
        operation_id="read_run_output",
        methods=["GET", "HEAD"],
        response_model=OutputChunk,
        responses=API_ERRORS,
        dependencies=[Depends(exact_query("attempt", "offset"))],
    )
    return [route for route in router.routes if isinstance(route, APIRoute)]
