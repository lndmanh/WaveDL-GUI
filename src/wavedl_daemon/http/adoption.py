"""Strict authenticated-app adoption endpoint, with no filesystem disclosures."""

from __future__ import annotations

import inspect
import sqlite3

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.routing import Route

from wavedl.core.safe_files import UnsafeOwnership
from wavedl_daemon.execution.budget import BudgetExhausted, StorageWorkError
from wavedl_daemon.execution.pool import WorkCancelled
from wavedl_daemon.http.app import read_json
from wavedl_daemon.storage.ownership import DispatchRequired
from wavedl_daemon.storage.plans import IdempotencyConflict, PlanRecoveryRequired


def adoption_routes(service):
    """Enclosing SecurityBoundary must authenticate this explicit operation."""

    async def adopt(request):
        body = await read_json(request, max_bytes=8192)
        if (
            set(body) - {"path", "attempt"}
            or "path" not in body
            or type(body["path"]) is not str
            or (
                "attempt" in body
                and (type(body["attempt"]) is not int or body["attempt"] < 1)
            )
            or len(request.headers.getlist("idempotency-key")) != 1
        ):
            raise HTTPException(400, "Invalid adoption request")
        try:
            result = service.adopt(
                body["path"],
                attempt=body.get("attempt"),
                idempotency_key=request.headers["idempotency-key"],
            )
            if inspect.isawaitable(result):
                result = await result
        except IdempotencyConflict:
            raise HTTPException(409, "Adoption conflict") from None
        except (UnsafeOwnership, PermissionError):
            raise HTTPException(403, "Forbidden") from None
        except StorageWorkError as error:
            status = 403 if isinstance(error.__cause__, PermissionError) else 503
            raise HTTPException(status, "Adoption storage unavailable") from None
        except (
            BudgetExhausted,
            WorkCancelled,
            DispatchRequired,
            PlanRecoveryRequired,
            sqlite3.DatabaseError,
            OSError,
        ):
            raise HTTPException(503, "Adoption service unavailable") from None
        except (ValueError, TypeError, KeyError):
            raise HTTPException(400, "Invalid adoption request") from None
        return JSONResponse(result.to_dict(), headers={"Cache-Control": "no-store"})

    return [Route("/api/runs/adopt", adopt, methods=["POST"])]
