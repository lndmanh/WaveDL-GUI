"""Bounded JSON replay of the frozen run-event envelopes."""

from pydantic import JsonValue

from wavedl_daemon.http.schemas.common import WireModel


class EventCursor(WireModel):
    attempt: int
    seq: int


class EventPage(WireModel):
    events: list[dict[str, JsonValue]]
    next_cursor: EventCursor
    more: bool
