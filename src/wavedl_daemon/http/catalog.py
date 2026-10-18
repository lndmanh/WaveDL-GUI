"""Authenticated bounded model/browse routes assembled from explicit services."""

from __future__ import annotations

import inspect
from typing import TYPE_CHECKING

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.routing import Route

from wavedl_daemon.execution.budget import BudgetExhausted, StorageWorkError
from wavedl_daemon.execution.pool import WorkCancelled
from wavedl_daemon.http.app import read_json
from wavedl_daemon.runs.catalog import BrowseForbidden, BrowseMissing


if TYPE_CHECKING:
    from wavedl_daemon.runs.catalog import AsyncCatalogService, CatalogService


async def _call(callback, *args):
    try:
        result = callback(*args)
        return await result if inspect.isawaitable(result) else result
    except BrowseForbidden:
        raise HTTPException(403, "Browse location is not allowed") from None
    except BrowseMissing:
        raise HTTPException(404, "Browse location does not exist") from None
    except PermissionError:
        raise HTTPException(403, "Browse location is unreadable") from None
    except FileNotFoundError:
        raise HTTPException(404, "Browse location does not exist") from None
    except (BudgetExhausted, WorkCancelled, StorageWorkError, OSError):
        raise HTTPException(503, "Catalog service unavailable") from None
    except (ValueError, TypeError):
        raise HTTPException(400, "Invalid catalog request") from None


def catalog_routes(service: CatalogService | AsyncCatalogService) -> list[Route]:
    async def models(request):
        if request.query_params:
            raise HTTPException(400, "Model catalog has no query parameters")
        try:
            result = await _call(service.models)
        except HTTPException:
            # Metadata belongs to the installed package, not the browse caller.
            raise HTTPException(503, "Bundled model metadata unavailable") from None
        return JSONResponse(result, headers={"Cache-Control": "no-store"})

    async def browse(request):
        query = request.query_params
        if set(query) - {"root", "path", "limit", "offset"} or any(
            len(query.getlist(key)) != 1 for key in query
        ):
            raise HTTPException(400, "Invalid browse query")
        try:
            limit, offset = (
                int(query.get("limit", "100")),
                int(query.get("offset", "0")),
            )
        except ValueError:
            raise HTTPException(400, "Invalid browse pagination") from None
        result = await _call(
            service.browse, query.get("root"), query.get("path", ""), limit, offset
        )
        return JSONResponse(result, headers={"Cache-Control": "no-store"})

    async def resolve(request):
        body = await read_json(request, max_bytes=8192)
        if (
            set(body) != {"root", "path"}
            or type(body["root"]) is not str
            or type(body["path"]) is not str
        ):
            raise HTTPException(400, "Invalid browse selection")
        result = await _call(service.resolve, body["root"], body["path"])
        return JSONResponse(result, headers={"Cache-Control": "no-store"})

    return [
        Route("/api/models", models, methods=["GET"]),
        Route("/api/browse", browse, methods=["GET"]),
        Route("/api/browse/resolve", resolve, methods=["POST"]),
    ]
