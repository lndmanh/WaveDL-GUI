"""Inspection routes live inside the app's existing authentication boundary."""

from __future__ import annotations

import asyncio

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.routing import Route

from wavedl.core.dataset_headers import InspectionRefused
from wavedl_daemon.execution.budget import BudgetExhausted, StorageWorkError
from wavedl_daemon.execution.pool import WorkCancelled
from wavedl_daemon.http.app import read_json


def inspection_routes(inspector):
    async def inspect_dataset(request):
        body = await read_json(request, max_bytes=16384)
        if (
            set(body) != {"root", "path"}
            or type(body["root"]) is not str
            or type(body["path"]) is not str
        ):
            raise HTTPException(400, "Invalid inspection request")

        async def disconnected():
            while True:
                message = await request.receive()
                if message["type"] == "http.disconnect":
                    return

        operation = asyncio.create_task(inspector.inspect(body["root"], body["path"]))
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
                raise HTTPException(503, "Dataset inspection unavailable")
            result = await operation
        except InspectionRefused:
            raise HTTPException(422, "Dataset inspection refused") from None
        except (BudgetExhausted, StorageWorkError, WorkCancelled, OSError):
            raise HTTPException(503, "Dataset inspection unavailable") from None
        finally:
            disconnect.cancel()
            if not operation.done():
                operation.cancel()
            await asyncio.gather(disconnect, operation, return_exceptions=True)
        return JSONResponse(result, headers={"Cache-Control": "no-store"})

    return [Route("/api/datasets/inspect", inspect_dataset, methods=["POST"])]
