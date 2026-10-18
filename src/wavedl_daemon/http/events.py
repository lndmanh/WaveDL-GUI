"""Attempt-aware event routes; outer app supplies the authentication boundary."""

from __future__ import annotations

import inspect
import json
import re
from uuid import UUID

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route

from wavedl.core.protocol import ProtocolError, decode
from wavedl_daemon.events.streaming import EVENT_SERVICE_ERRORS, stream_events
from wavedl_daemon.storage.event_log import validate_cursor


def _identity(request):
    run_id = request.path_params["run_id"]
    try:
        canonical = str(UUID(run_id))
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(400, "Invalid run identity") from None
    if canonical != run_id:
        raise HTTPException(400, "Invalid run identity")
    return run_id


def _number(value, minimum):
    if not isinstance(value, str) or not re.fullmatch(r"-?[0-9]{1,19}", value):
        raise ValueError("Invalid cursor")
    number = int(value)
    if not minimum <= number <= 2**63 - 1:
        raise ValueError("Invalid cursor")
    return number


class _OwnedStreamingResponse(StreamingResponse):
    """Release pre-admitted subscription even if ASGI fails before iteration."""

    def __init__(self, *args, broker, subscription, **kwargs):
        super().__init__(*args, **kwargs)
        self.broker, self.subscription = broker, subscription

    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            self.broker.unsubscribe(self.subscription)


def event_routes(*, ingestor, event_log, broker, resolve_plan):
    """resolve_plan(run_id) supplies the daemon-approved active plan identity."""
    from wavedl_daemon.http.app import read_json

    async def resolve(value):
        return await value if inspect.isawaitable(value) else value

    async def push(request):
        run_id = _identity(request)
        body = await read_json(request, max_bytes=1024 * 1024)
        attempt, values = body.get("attempt"), body.get("events")
        if type(attempt) is not int or not 1 <= attempt <= 2**63 - 1:
            raise HTTPException(400, "Invalid attempt")
        if not isinstance(values, list) or not 1 <= len(values) <= 1024:
            raise HTTPException(400, "Invalid event batch")
        try:
            plan_id = await resolve(resolve_plan(run_id))
            try:
                batch = [decode(json.dumps(value, allow_nan=False)) for value in values]
            except (ProtocolError, ValueError) as error:
                await resolve(
                    ingestor.reject_runtime_events(plan_id, run_id, attempt, str(error))
                )
                raise
            position = await resolve(ingestor.push(plan_id, run_id, attempt, batch))
        except KeyError:
            raise HTTPException(404, "Unknown run") from None
        except (ProtocolError, ValueError):
            raise HTTPException(409, "Runtime events rejected") from None
        except EVENT_SERVICE_ERRORS:
            raise HTTPException(503, "Event service unavailable") from None
        return JSONResponse({"attempt": attempt, "seq": position})

    async def events(request):
        run_id = _identity(request)
        try:
            await resolve(resolve_plan(run_id))
        except KeyError:
            raise HTTPException(404, "Unknown run") from None
        except EVENT_SERVICE_ERRORS:
            raise HTTPException(503, "Event service unavailable") from None
        try:
            query = request.query_params
            if any(len(query.getlist(key)) > 1 for key in ("attempt", "seq")):
                raise ValueError("Duplicate cursor")
            if bool("attempt" in query) != bool("seq" in query):
                raise ValueError("Both cursor coordinates required")
            cursor = validate_cursor(
                (
                    _number(query.get("attempt", "0"), 0),
                    _number(query.get("seq", "-1"), -1),
                )
            )
            last = request.headers.get("last-event-id")
            if last and "attempt" not in query:
                pieces = last.split(":")
                if len(pieces) != 2:
                    raise ValueError("Invalid Last-Event-ID")
                cursor = validate_cursor(
                    (_number(pieces[0], 0), _number(pieces[1], -1))
                )
        except ValueError:
            raise HTTPException(400, "Invalid event cursor") from None
        subscription = None
        try:
            # Admit and perform the first bounded DB query BEFORE headers. The
            # subscription is installed first, preserving the replay/live race.
            subscription = broker.subscribe(run_id)
            page = await resolve(event_log.read_after(run_id, cursor, limit=256))
            return _OwnedStreamingResponse(
                stream_events(
                    event_log,
                    broker,
                    run_id,
                    cursor,
                    subscription=subscription,
                    initial_page=page,
                ),
                broker=broker,
                subscription=subscription,
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )
        except EVENT_SERVICE_ERRORS:
            if subscription is not None:
                broker.unsubscribe(subscription)
            raise HTTPException(503, "Event service unavailable") from None
        except BaseException:
            if subscription is not None:
                broker.unsubscribe(subscription)
            raise

    return [
        Route("/api/runs/{run_id}/events", push, methods=["POST"]),
        Route("/api/runs/{run_id}/events", events, methods=["GET"]),
    ]
