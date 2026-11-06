"""
Authenticated dataset preview polling endpoint.
Author: Ngo Duc Manh Le (manh@nnsvn.me)
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.routing import APIRoute
from starlette.responses import JSONResponse, Response

from wavedl_daemon.execution.budget import BudgetExhausted, StorageWorkError
from wavedl_daemon.execution.pool import WorkCancelled
from wavedl_daemon.http.app import PublicHTTPException, strict_json_route
from wavedl_daemon.http.schemas.common import JSON_BODY_ERRORS, NO_STORE
from wavedl_daemon.http.schemas.datasets import (
    PreviewPending,
    PreviewRequest,
    PreviewResponse,
)
from wavedl_daemon.runs.dataset_preview import PickleRequired, PreviewRefused


def preview_routes(previewer):
    async def preview_dataset(body: PreviewRequest, response: Response):
        try:
            result = await previewer.preview(body.model_dump(mode="json"))
        except PickleRequired:
            raise PublicHTTPException(
                409, "Dataset contains pickled arrays", headers=NO_STORE
            ) from None
        except PreviewRefused:
            raise PublicHTTPException(
                400, "Could not preview this dataset", headers=NO_STORE
            ) from None
        except (BudgetExhausted, StorageWorkError, WorkCancelled, OSError):
            raise PublicHTTPException(
                503,
                "Dataset preview is busy or unavailable; try again",
                headers=NO_STORE,
            ) from None
        if result.get("status") == "pending":
            return JSONResponse(result, status_code=202, headers=NO_STORE)
        response.headers.update(NO_STORE)
        return result

    router = APIRouter()
    router.add_api_route(
        "/api/datasets/preview",
        preview_dataset,
        operation_id="preview_dataset",
        responses={
            **JSON_BODY_ERRORS,
            202: {
                "model": PreviewPending,
                "description": "Preview is running; repeat the same request to poll",
            },
        },
        methods=["POST"],
        response_model=PreviewResponse,
        route_class_override=strict_json_route(65536),
    )
    return [route for route in router.routes if isinstance(route, APIRoute)]
