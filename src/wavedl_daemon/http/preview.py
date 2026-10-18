"""Authenticated dataset preview endpoint."""

from __future__ import annotations

import asyncio

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.routing import Route

from wavedl_daemon.execution.budget import BudgetExhausted, StorageWorkError
from wavedl_daemon.execution.pool import WorkCancelled
from wavedl_daemon.http.app import read_json
from wavedl_daemon.runs.preview_authority import (
    PreviewChanged,
    PreviewForbidden,
    PreviewMissing,
)
from wavedl_daemon.runs.preview_service import (
    PreviewBadRequest,
    PreviewIdentityChanged,
    PreviewRefused,
    PreviewTooLarge,
)


def preview_routes(previewer):
    async def preview_dataset(request):
        body = await read_json(request, max_bytes=65536)

        async def disconnected():
            while True:
                message = await request.receive()
                if message["type"] == "http.disconnect":
                    return

        operation = asyncio.create_task(previewer.preview(body))
        disconnect = asyncio.create_task(disconnected())
        try:
            done, _ = await asyncio.wait(
                {operation, disconnect}, return_when=asyncio.FIRST_COMPLETED
            )
            if operation not in done:
                operation.cancel()
                try:
                    await operation
                except asyncio.CancelledError:
                    pass
                raise HTTPException(503, "Dataset preview unavailable")
            result = await operation
        except (PreviewIdentityChanged, PreviewChanged):
            raise HTTPException(409, "Dataset identity changed") from None
        except PreviewTooLarge:
            raise HTTPException(413, "Preview exceeds limit") from None
        except (PreviewBadRequest, PreviewForbidden, PreviewMissing):
            raise HTTPException(400, "Invalid preview request") from None
        except PreviewRefused:
            raise HTTPException(422, "Dataset preview refused") from None
        except (BudgetExhausted, StorageWorkError, WorkCancelled, OSError):
            raise HTTPException(503, "Dataset preview unavailable") from None
        finally:
            disconnect.cancel()
            if not operation.done():
                operation.cancel()
            await asyncio.gather(disconnect, operation, return_exceptions=True)
        return JSONResponse(result, headers={"Cache-Control": "no-store"})

    return [Route("/api/datasets/preview", preview_dataset, methods=["POST"])]
