"""Remote previews remain bounded, authenticated and daemon-scoped."""

import asyncio
import copy
import sys
from pathlib import Path

import numpy as np
import pytest


pytest.importorskip("PySide6")
pytest.importorskip("qfluentwidgets")

from PySide6.QtWidgets import QApplication

from wavedl.core.dataset_preview import preview_dataset
from wavedl_gui.components.data_plots_card import DataPlotsCard, _plot_remote_preview
from wavedl_gui.service.daemon_contracts import (
    DaemonConnection,
    PathSelectionRef,
    RequestContractError,
)
from wavedl_gui.service.data_plots_worker import DataPlotsWorker
from wavedl_gui.service.data_preview_worker import (
    DaemonDataPreviewWorker,
    preview_bundle,
)


@pytest.fixture
def payload(tmp_path):
    path = tmp_path / "data.npz"
    np.savez(path, X=np.arange(48).reshape(12, 4), y=np.arange(24).reshape(12, 2))
    stat = path.stat()
    identity = {
        key: getattr(stat, key)
        for key in ("st_dev", "st_ino", "st_size", "st_mtime_ns")
    }
    return preview_dataset(path, expected_identity=identity)


def connection():
    return DaemonConnection(
        "http://127.0.0.1:8765",
        Path("/private/token"),
        sys.executable,
        path_realm="remote",
        daemon_id="server",
        server_platform="posix",
    )


def selection():
    return PathSelectionRef(
        "/remote/data.npz", "daemon", "server", "datasets", "data.npz"
    )


class Transport:
    def __init__(self, value, *, changed=False, blocked=False):
        self.value, self.changed, self.blocked = value, changed, blocked
        self.calls = []
        self.closed = False
        self.health_calls = 0

    async def aclose(self):
        self.closed = True

    async def request(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        if path == "/api/health":
            self.health_calls += 1
            return {
                "daemon_id": "other"
                if self.changed and self.health_calls > 1
                else "server",
                "protocol_min": 1,
                "protocol_max": 1,
            }
        if self.blocked:
            await asyncio.Event().wait()
        return {
            **self.value,
            "selection": {"root": "datasets", "path": "data.npz"},
            "view": "all",
        }


def worker(monkeypatch, transport, selected=None):
    monkeypatch.setattr(DaemonConnection, "read_credential", lambda _self: "secret")
    return DaemonDataPreviewWorker(
        "/remote/data.npz",
        connection=connection(),
        path_selection=selected or selection(),
        transport_factory=lambda *_args, **_kwargs: transport,
    )


def test_remote_worker_uses_explicit_browse_selection(monkeypatch, payload):
    transport = Transport(payload)
    result = asyncio.run(worker(monkeypatch, transport)._execute())
    assert result.remote_preview["samples"] == payload["samples"]
    assert transport.calls[1] == (
        "POST",
        "/api/datasets/preview",
        {"body": {"root": "datasets", "path": "data.npz", "view": "all"}},
    )
    assert transport.closed


def test_remote_worker_rejects_changed_daemon(monkeypatch, payload):
    transport = Transport(payload, changed=True)
    with pytest.raises(RequestContractError):
        asyncio.run(worker(monkeypatch, transport)._execute())
    assert transport.closed


def test_remote_worker_does_not_open_unscoped_local_path(monkeypatch, payload):
    transport = Transport(payload)
    with pytest.raises(RequestContractError):
        asyncio.run(
            worker(
                monkeypatch, transport, PathSelectionRef("/remote/data.npz", "local")
            )._execute()
        )
    assert not transport.calls


def test_remote_worker_cancel_closes_transport(monkeypatch, payload):
    transport = Transport(payload, blocked=True)
    preview = worker(monkeypatch, transport)

    async def run():
        task = asyncio.create_task(preview._execute())
        while len(transport.calls) < 2:
            await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(run())
    assert transport.closed


@pytest.mark.parametrize("scope", ["root", "path", "view"])
def test_remote_worker_rejects_wrong_selection(monkeypatch, payload, scope):
    class WrongScope(Transport):
        async def request(self, method, path, **kwargs):
            value = await super().request(method, path, **kwargs)
            if path == "/api/datasets/preview":
                if scope == "view":
                    value["view"] = "sample"
                else:
                    value["selection"][scope] = "other"
            return value

    transport = WrongScope(payload)
    with pytest.raises(RequestContractError):
        asyncio.run(worker(monkeypatch, transport)._execute())
    assert transport.closed


@pytest.mark.parametrize(
    "mutation",
    [
        "huge",
        "nonfinite",
        "index",
        "negative",
        "schema",
        "duplicate",
        "boolean",
        "correlation",
    ],
)
def test_remote_parser_refuses_malformed_payload(payload, mutation):
    value = copy.deepcopy(payload)
    if mutation == "huge":
        value["samples"][0]["shape"] = [1000000]
    elif mutation == "nonfinite":
        value["scatter"]["y"][0] = float("nan")
    elif mutation == "index":
        value["scatter"]["feature_indices"][0] = 1000000
    elif mutation == "negative":
        value["input_histograms"][0]["counts"][0] = -1
    elif mutation == "schema":
        value["schema_version"] = True
    elif mutation == "duplicate":
        value["samples"][1]["sample_index"] = value["samples"][0]["sample_index"]
    elif mutation == "boolean":
        value["samples"][0]["sample_index"] = False
    else:
        value["correlation"]["matrix"][0][0] = 2
    with pytest.raises((RequestContractError, ValueError)):
        preview_bundle(value)


@pytest.mark.parametrize("name", DataPlotsWorker.PLOT_NAMES)
def test_six_remote_views_render_bounded_payload(payload, name):
    app = QApplication.instance() or QApplication([])
    figure = _plot_remote_preview(name, preview_bundle(payload), False)
    assert figure.axes
    figure.clear()
    app.processEvents()


def test_card_remote_invalid_selection_never_uses_local_loader(monkeypatch):
    app = QApplication.instance() or QApplication([])
    monkeypatch.setattr(DaemonDataPreviewWorker, "start", lambda _self: None)
    card = DataPlotsCard()
    card.set_data_path(
        "/remote/data.npz",
        connection=connection(),
        path_selection=PathSelectionRef("/remote/data.npz", "local"),
    )
    assert isinstance(card._worker, DaemonDataPreviewWorker)
    card.clear()
    app.processEvents()


def test_remote_statistics_handles_null_finite_contract(payload):
    payload["input_statistics"]["means"] = [None] * len(
        payload["input_statistics"]["means"]
    )
    payload["input_statistics"]["stds"] = [None] * len(
        payload["input_statistics"]["stds"]
    )
    figure = _plot_remote_preview("Input Statistics", preview_bundle(payload), False)
    assert "No finite statistics" in figure.axes[0].texts[0].get_text()
    figure.clear()


def test_card_retry_restores_height_and_removes_error(monkeypatch):
    app = QApplication.instance() or QApplication([])
    monkeypatch.setattr(DaemonDataPreviewWorker, "start", lambda _self: None)
    card = DataPlotsCard()
    card.clear()
    card.set_data_path(
        "/remote/data.npz", connection=connection(), path_selection=selection()
    )
    assert card.maximumHeight() >= card.minimumHeight() >= 520
    card._worker.errorOccurred.emit("failed")
    assert card._error_widget is not None
    card.set_data_path(
        "/remote/data.npz", connection=connection(), path_selection=selection()
    )
    assert card._error_widget is None
    old = card._worker
    card.clear()
    old.dataReady.emit(object())
    old.errorOccurred.emit("stale")
    assert card._bundle is None and card._error_widget is None
    app.processEvents()
