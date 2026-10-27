"""Local plot preview cancellation never force-kills or blocks the GUI."""

import threading
import time
from types import SimpleNamespace

import numpy as np
import pytest


pytest.importorskip("PySide6")
pytest.importorskip("qfluentwidgets")

from PySide6.QtCore import QCoreApplication, QEvent
from PySide6.QtWidgets import QApplication
from qfluentwidgets import CaptionLabel

from wavedl_gui.components.data_plots_card import DataPlotsCard
from wavedl_gui.service import data_plots_worker as workers


@pytest.fixture
def app():
    return QApplication.instance() or QApplication([])


def spin(app, predicate):
    deadline = time.monotonic() + 5
    while not predicate():
        app.processEvents()
        if time.monotonic() > deadline:
            pytest.fail("Worker did not reach expected state")
        time.sleep(0.001)
    app.processEvents()


class BlockingSource:
    def __init__(self):
        self.entered = threading.Event()
        self.release = threading.Event()
        self.closed = threading.Event()

    def load_mmap(self, _path):
        self.entered.set()
        if not self.release.wait(5):
            raise TimeoutError("Test load gate did not open")
        return SimpleNamespace(
            inputs=np.ones((10, 2)), outputs=np.ones((10, 1)), close=self.closed.set
        )


def install_source(monkeypatch, source):
    monkeypatch.setattr(workers.DataSource, "detect_format", lambda _path: "test")
    monkeypatch.setattr(workers, "get_data_source", lambda _fmt: source)


def forbid_blocking(worker):
    def forbidden(*_args, **_kwargs):
        pytest.fail("UI cancellation must not terminate or wait")

    worker.terminate = forbidden
    worker.wait = forbidden


@pytest.mark.parametrize("action", ["replace", "clear"])
def test_blocked_load_cancel_does_not_block_or_apply_stale_results(
    app, monkeypatch, action
):
    source = BlockingSource()
    install_source(monkeypatch, source)
    card = DataPlotsCard()
    monkeypatch.setattr(card, "_show_plot", lambda _name: None)
    try:
        card.set_data_path("first.npz")
        old = card._worker
        spin(app, source.entered.is_set)
        forbid_blocking(old)
        assert old.parent() is None
        assert old in workers.activeDataPlotWorkers()
        # Emit off the GUI thread so these signals are genuinely queued, then
        # replace/clear before the GUI event loop delivers them.
        producer = threading.Thread(
            target=lambda: (
                old.dataReady.emit(object()),
                old.errorOccurred.emit("stale error"),
            )
        )
        producer.start()
        producer.join(timeout=1)
        assert not producer.is_alive()
        if action == "replace":
            card.set_data_path("second.npz")
            assert card._worker is not old
        else:
            card.clear()
            assert card._worker is None
        assert old in workers.activeDataPlotWorkers()
        # Simulate signals already queued before cancellation as well as late
        # producer signals. The card must guard both success and error paths.
        old.dataReady.emit(object())
        old.errorOccurred.emit("stale error")
        app.processEvents()
        assert card._bundle is None
        assert not any(
            "stale error" in label.text() for label in card.findChildren(CaptionLabel)
        )
    finally:
        card.clear()
        source.release.set()
        spin(app, lambda: not workers.activeDataPlotWorkers())
        card.deleteLater()
        app.processEvents()
    assert source.closed.is_set()


def test_worker_stop_closes_handle_and_suppresses_results(app, monkeypatch):
    source = BlockingSource()
    install_source(monkeypatch, source)
    worker = workers.DataPlotsWorker("data.npz")
    observed = []
    worker.dataReady.connect(lambda _value: observed.append("ready"))
    worker.errorOccurred.connect(lambda _value: observed.append("error"))
    worker.start()
    try:
        spin(app, source.entered.is_set)
        worker.stop()
    finally:
        source.release.set()
        spin(app, lambda: not workers.activeDataPlotWorkers())
    assert source.closed.is_set()
    assert observed == []


def test_parent_destruction_requests_stop_without_destroying_thread(app, monkeypatch):
    source = BlockingSource()
    install_source(monkeypatch, source)
    card = DataPlotsCard()
    card.set_data_path("data.npz")
    worker = card._worker
    try:
        spin(app, source.entered.is_set)
        card.deleteLater()
        QCoreApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
        assert worker._stop_requested.is_set()
        assert worker in workers.activeDataPlotWorkers()
    finally:
        source.release.set()
        spin(app, lambda: not workers.activeDataPlotWorkers())
    assert source.closed.is_set()


def test_subsample_is_bounded_and_checks_stop_between_rows():
    reads = []

    class Rows:
        def __getitem__(self, index):
            reads.append(index)
            return np.ones(2)

    result = workers._subsample_from_handle(Rows(), 100_000)
    assert result.shape == (5_000, 2)
    assert len(reads) == 5_000
    checked = []

    def cancel():
        checked.append(True)
        if len(checked) == 3:
            raise workers._LoadCancelled

    reads.clear()
    with pytest.raises(workers._LoadCancelled):
        workers._subsample_from_handle(Rows(), 100_000, cancel)
    assert len(reads) == 1
