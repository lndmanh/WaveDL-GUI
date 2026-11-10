"""
Shared strict request and response models for the HTTP boundary.
Author: Ngo Duc Manh Le (manh@nnsvn.me)
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import HTTPException, Request
from pydantic import BaseModel, ConfigDict


if TYPE_CHECKING:
    from collections.abc import Callable


class WireModel(BaseModel):
    """Strict, immutable model base for values crossing the HTTP boundary."""

    model_config = ConfigDict(
        extra="forbid",
        strict=True,
        allow_inf_nan=False,
        frozen=True,
    )


def exact_query(
    *allowed: str, repeatable: tuple[str, ...] = ()
) -> Callable[[Request], None]:
    """Reject unknown query keys and repeats unless explicitly allowed."""
    allowed_keys = frozenset(allowed)
    repeatable_keys = frozenset(repeatable)

    def validate_query(request: Request) -> None:
        query = request.query_params
        if set(query) - allowed_keys or any(
            len(query.getlist(key)) != 1 for key in query if key not in repeatable_keys
        ):
            raise HTTPException(400)

    return validate_query


class ErrorResponse(WireModel):
    """Every daemon error body; details never echo submitted values."""

    error: str


NO_STORE = {"Cache-Control": "no-store"}
# Request validation maps to 400 (never FastAPI's 422); see app._validation_error.
API_ERRORS = {status: {"model": ErrorResponse} for status in (400, 401, 404, 409, 503)}
JSON_BODY_ERRORS = API_ERRORS | {
    status: {"model": ErrorResponse} for status in (408, 413, 415)
}
