"""Shared strict request and response models for the daemon HTTP boundary."""

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


def exact_query(*allowed: str) -> Callable[[Request], None]:
    """Reject unknown and repeated query keys before route execution."""
    allowed_keys = frozenset(allowed)

    def validate_query(request: Request) -> None:
        query = request.query_params
        if set(query) - allowed_keys or any(
            len(query.getlist(key)) != 1 for key in query
        ):
            raise HTTPException(400)

    return validate_query


NO_STORE = {"Cache-Control": "no-store"}
