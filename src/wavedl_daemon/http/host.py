"""Authenticated host profile used to prefill an automatic Local runtime."""

from __future__ import annotations

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.routing import Route

from wavedl_daemon.execution.budget import BudgetExhausted, StorageWorkError
from wavedl_daemon.execution.pool import WorkCancelled


def host_routes(services):
    async def host(request):
        if request.query_params:
            raise HTTPException(400, "Host profile has no query parameters")
        try:
            result = await services.host_profile()
        except (BudgetExhausted, StorageWorkError, WorkCancelled, OSError):
            raise HTTPException(503, "Host profile unavailable") from None
        return JSONResponse(result, headers={"Cache-Control": "no-store"})

    return [Route("/api/host", host, methods=["GET"])]
