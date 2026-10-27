"""Authenticated model descriptions, not remote runtime capability evidence."""

from __future__ import annotations

import asyncio
import json
import math
import re
import unicodedata

from PySide6.QtCore import Signal

from .async_request_worker import AsyncRequestWorker, requireDaemonProtocol


def _text(value, maximum=16384):
    if (
        type(value) is not str
        or len(value.encode("utf-8")) > maximum
        or any(ord(char) < 32 or 127 <= ord(char) < 160 for char in value)
        or any(unicodedata.category(char) in {"Cc", "Cf", "Cs"} for char in value)
    ):
        raise ValueError("Invalid catalogue text")
    return value


def validate_catalogue(value):
    """Validate the complete bounded presentation schema before Qt sees it."""
    if (
        type(value) is not dict
        or set(value) != {"source", "runtime_verified", "categories", "models"}
        or value["source"] != "bundled_metadata"
        or value["runtime_verified"] is not False
    ):
        raise ValueError("Catalogue is not bundled descriptive metadata")
    if (
        len(json.dumps(value, allow_nan=False, ensure_ascii=False).encode("utf-8"))
        > 262144
    ):
        raise ValueError("Catalogue exceeds byte bound")
    models, categories = value["models"], value["categories"]
    if (
        type(models) is not list
        or len(models) > 1000
        or type(categories) is not dict
        or len(categories) > 32
    ):
        raise ValueError("Catalogue exceeds inventory bound")
    fields = {
        "id",
        "display_name",
        "architecture_family",
        "author_institution",
        "best_for",
        "compute_tier",
        "description",
        "short_description",
        "is_pretrained",
        "params_m",
        "size_mb",
        "supported_dims",
        "tags",
        "pros",
        "cons",
        "year_published",
    }
    names = set()
    for item in models:
        if (
            type(item) is not dict
            or set(item) - fields
            or not {"id", "display_name", "supported_dims"} <= item.keys()
        ):
            raise ValueError("Invalid model metadata shape")
        if (
            type(item["id"]) is not str
            or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", item["id"])
            or item["id"] in names
        ):
            raise ValueError("Ambiguous model inventory identity")
        names.add(item["id"])
        dims = item["supported_dims"]
        if (
            type(dims) is not list
            or len(dims) > 3
            or any(type(dim) is not int or dim not in {1, 2, 3} for dim in dims)
            or len(set(dims)) != len(dims)
        ):
            raise ValueError("Invalid model dimensions")
        for key, item_value in item.items():
            if key in {"tags", "pros", "cons"}:
                if type(item_value) is not list or len(item_value) > 32:
                    raise ValueError("Invalid model description list")
                for text in item_value:
                    _text(text, 2048)
            elif key in {"params_m", "size_mb"}:
                if item_value is not None and (
                    type(item_value) not in {float, int}
                    or not 0 <= item_value <= 10**9
                    or not math.isfinite(item_value)
                ):
                    raise ValueError("Invalid model presentation number")
            elif key == "year_published":
                if item_value is not None and (
                    type(item_value) is not int or not 1900 <= item_value <= 2200
                ):
                    raise ValueError("Invalid model publication year")
            elif key == "is_pretrained":
                if type(item_value) is not bool:
                    raise ValueError("Invalid descriptive pretrained flag")
            elif key != "supported_dims":
                maximum = {
                    "id": 128,
                    "display_name": 256,
                    "architecture_family": 256,
                    "author_institution": 1024,
                    "compute_tier": 64,
                    "short_description": 2048,
                    "best_for": 2048,
                }.get(key, 16384)
                _text(item_value, maximum)
        if not item["display_name"]:
            raise ValueError("Model display name is required")
    assigned = set()
    for name, category in categories.items():
        _text(name, 128)
        if (
            not name
            or type(category) is not dict
            or set(category) != {"models", "short_description"}
            or type(category["models"]) is not list
            or len(category["models"]) > 1000
        ):
            raise ValueError("Invalid category metadata")
        _text(category["short_description"], 2048)
        for key in category["models"]:
            if type(key) is not str or key not in names or key in assigned:
                raise ValueError("Invalid category model identity")
            assigned.add(key)
    if assigned != names:
        raise ValueError("Model inventory has uncategorized entries")
    return value


class DaemonModelsWorker(AsyncRequestWorker):
    resultSig = Signal(object)
    errorSig = Signal(str)

    def __init__(self, connection, parent=None, *, transport_factory=None):
        super().__init__(parent)
        self.connection, self.transport_factory = connection, transport_factory

    async def _execute(self):
        from wavedl.core.client_transport import HttpTransport

        async with asyncio.timeout(10):
            transport = (self.transport_factory or HttpTransport)(
                self.connection.url, self.connection.read_credential(), deadline=5
            )
            before = await transport.request("GET", "/api/health")
            self._health(before)
            if (
                self.connection.daemon_id is not None
                and before["daemon_id"] != self.connection.daemon_id
            ):
                raise ValueError("Daemon identity changed")
            transport.bind_daemon_id(before["daemon_id"])
            catalogue = validate_catalogue(
                await transport.request("GET", "/api/models")
            )
            after = await transport.request("GET", "/api/health")
            self._health(after)
            if after["daemon_id"] != before["daemon_id"]:
                raise ValueError("Catalogue peer changed")
            return {"daemon_id": before["daemon_id"], "catalogue": catalogue}

    @staticmethod
    def _health(value):
        requireDaemonProtocol(value)
        if not _text(value.get("daemon_id"), 256):
            raise ValueError("Missing daemon identity")

    def _on_result(self, result):
        self.resultSig.emit(result)

    def _on_error(self):
        self.errorSig.emit(
            self._error_message(
                "Daemon catalogue unavailable. Offline descriptions remain selectable; runtime support is not verified."
            )
        )
