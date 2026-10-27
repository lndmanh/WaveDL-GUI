"""Authenticated bounded remote plot previews on a cancellable Qt thread."""

from __future__ import annotations

import asyncio
import json
import math
from contextlib import AsyncExitStack

import numpy as np
from PySide6.QtCore import Signal

from .daemon_contracts import PathSelectionRef, RequestContractError
from .data_parse_worker import DataParseWorker
from .data_plots_worker import DataBundle


def preview_bundle(value):
    """Reject oversized or malformed numeric payloads before plotting them."""
    if (
        type(value) is not dict
        or type(value.get("schema_version")) is not int
        or value["schema_version"] != 1
    ):
        raise RequestContractError("Invalid preview schema")
    if (
        len(json.dumps(value, allow_nan=False, separators=(",", ":")).encode())
        > 1024 * 1024
    ):
        raise RequestContractError("Preview exceeds response bounds")
    fields = {
        "schema_version",
        "identity",
        "format",
        "input_key",
        "output_key",
        "input_shape",
        "output_shape",
        "sample_indices",
        "input_histograms",
        "output_histograms",
        "correlation",
        "input_statistics",
        "scatter",
        "samples",
        "limits",
    }
    if set(value) not in (fields, fields | {"selection", "view"}):
        raise RequestContractError("Invalid preview fields")
    if value["format"] not in {"npz", "mat", "h5", "hdf5"} or any(
        type(value[key]) is not str or not value[key] or len(value[key].encode()) > 1024
        for key in ("input_key", "output_key")
    ):
        raise RequestContractError("Invalid preview metadata")
    identity = value.get("identity")
    if (
        type(identity) is not dict
        or set(identity) != {"st_dev", "st_ino", "st_size", "st_mtime_ns"}
        or any(type(item) is not int or item < 0 for item in identity.values())
    ):
        raise RequestContractError("Invalid preview identity")

    def array(data, shape):
        if not shape:
            if data is not None and (
                type(data) not in {int, float} or not math.isfinite(data)
            ):
                raise RequestContractError("Invalid preview number")
            return
        if type(data) is not list or len(data) != shape[0]:
            raise RequestContractError("Invalid preview dimensions")
        for item in data:
            array(item, shape[1:])

    def indices(data, maximum, width):
        if (
            type(data) is not list
            or not 1 <= len(data) <= maximum
            or any(type(item) is not int or not 0 <= item < width for item in data)
            or data != sorted(set(data))
        ):
            raise RequestContractError("Invalid preview indices")
        return data

    widths = []
    for key in ("input_shape", "output_shape"):
        shape = value[key]
        if (
            type(shape) is not list
            or not 1 <= len(shape) <= 16
            or any(type(item) is not int or item < 1 for item in shape)
            or math.prod(shape) > 8 * 1024 * 1024
        ):
            raise RequestContractError("Invalid dataset shape")
        widths.append(math.prod(shape[1:]))
    if value["input_shape"][0] != value["output_shape"][0]:
        raise RequestContractError("Unaligned preview")
    if widths[0] > 65536 or widths[1] > 256:
        raise RequestContractError("Preview feature bounds exceeded")
    count = len(indices(value["sample_indices"], 512, value["input_shape"][0]))
    for key, width in zip(
        ("input_histograms", "output_histograms"), widths, strict=True
    ):
        histograms = value[key]
        if type(histograms) is not list or not 1 <= len(histograms) <= 8:
            raise RequestContractError("Invalid preview histograms")
        indices([item["feature_index"] for item in histograms], 8, width)
        for item in histograms:
            array(item["counts"], [32])
            array(item["edges"], [33])
            if (
                any(type(number) is not int or number < 0 for number in item["counts"])
                or sum(item["counts"]) > count
                or any(number is None for number in item["edges"])
                or item["edges"] != sorted(item["edges"])
            ):
                raise RequestContractError("Invalid preview histogram")
    corr = value["correlation"]
    corr_indices = indices(corr["feature_indices"], 30, widths[1])
    if corr["matrix"] is not None:
        array(corr["matrix"], [len(corr_indices)] * 2)
        if any(
            number is not None and abs(number) > 1
            for row in corr["matrix"]
            for number in row
        ):
            raise RequestContractError("Invalid correlation coefficient")
    stats = value["input_statistics"]
    stat_indices = indices(stats["feature_indices"], 40, widths[0])
    array(stats["means"], [len(stat_indices)])
    array(stats["stds"], [len(stat_indices)])
    if any(number is not None and number < 0 for number in stats["stds"]):
        raise RequestContractError("Invalid preview standard deviation")
    scatter = value["scatter"]
    scatter_indices = indices(scatter["feature_indices"], 8, widths[0])
    array(scatter["x"], [count, len(scatter_indices)])
    array(scatter["y"], [count])
    if scatter["output_index"] != 0:
        raise RequestContractError("Invalid scatter output")
    samples = value["samples"]
    if type(samples) is not list or not 1 <= len(samples) <= 3:
        raise RequestContractError("Invalid preview samples")
    elements = 0
    sample_indices = []
    for sample in samples:
        shape = sample["shape"]
        if (
            type(shape) is not list
            or not 1 <= len(shape) <= 15
            or any(type(size) is not int or size < 1 for size in shape)
        ):
            raise RequestContractError("Invalid sample shape")
        elements += math.prod(shape)
        if (
            elements > 16384
            or type(sample["sample_index"]) is not int
            or sample["sample_index"] not in value["sample_indices"]
            or sample["sample_index"] in sample_indices
        ):
            raise RequestContractError("Invalid sample bounds")
        sample_indices.append(sample["sample_index"])
        original = value["input_shape"][1:] or [1]
        if (
            sample["feature_shape"] != value["input_shape"][1:]
            or len(shape) != len(original)
            or any(size > bound for size, bound in zip(shape, original, strict=True))
        ):
            raise RequestContractError("Invalid sample dimensions")
        array(sample["values"], shape)
    return DataBundle(
        np.empty((0, 0)),
        np.empty((0, 0)),
        np.empty((0, 0)),
        np.array([]),
        remote_preview=value,
    )


class DaemonDataPreviewWorker(DataParseWorker):
    """Read daemon-side summaries; never open the selected path locally."""

    dataReady = Signal(object)

    def _on_result(self, result):
        self.dataReady.emit(result)

    def _on_error(self):
        self.errorOccurred.emit(
            self._error_message(
                "Dataset preview unavailable. Check daemon connection, browse selection, and dataset size limits."
            )
        )

    async def _execute(self):
        selection = self.path_selection
        if (
            self.connection is None
            or not isinstance(selection, PathSelectionRef)
            or selection.realm != "daemon"
            or selection.path != self._file_path
            or selection.browse_root is None
        ):
            raise RequestContractError("Select a dataset from daemon browse locations")
        if self._stop_requested.is_set():
            raise asyncio.CancelledError
        transport = self.transport_factory(
            self.connection.url, self.connection.read_credential(), deadline=30
        )
        async with AsyncExitStack() as stack:
            if hasattr(transport, "__aenter__"):
                transport = await stack.enter_async_context(transport)
            elif hasattr(transport, "aclose"):
                stack.push_async_callback(transport.aclose)
            async with asyncio.timeout(35):
                health = await transport.request("GET", "/api/health")
                self._health(health, selection)
                if hasattr(transport, "bind_daemon_id"):
                    transport.bind_daemon_id(health["daemon_id"])
                value = await transport.request(
                    "POST",
                    "/api/datasets/preview",
                    body={
                        "root": selection.browse_root,
                        "path": selection.browse_path,
                        "view": "all",
                    },
                )
                following = await transport.request("GET", "/api/health")
                self._health(following, selection)
                if following["daemon_id"] != health["daemon_id"]:
                    raise RequestContractError("Daemon changed during preview")
                if (
                    type(value) is not dict
                    or value.get("selection")
                    != {"root": selection.browse_root, "path": selection.browse_path}
                    or value.get("view") != "all"
                ):
                    raise RequestContractError("Preview belongs to another selection")
                return preview_bundle(value)
