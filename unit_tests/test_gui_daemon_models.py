"""Daemon descriptions never certify runtime support or probe frontend GPUs."""

import asyncio
import copy
import threading
import time
from types import SimpleNamespace

import pytest


pytest.importorskip("PySide6")
pytest.importorskip("qfluentwidgets")

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QApplication

from wavedl_daemon.runs.catalog import CatalogService
from wavedl_gui.components.model_selector_dialog import ModelBrowserPanel
from wavedl_gui.service.daemon_models_worker import (
    DaemonModelsWorker,
    validate_catalogue,
)
from wavedl_gui.view.wizard.model_step import _get_recommended_model


def catalogue():
    return CatalogService({}).models()


class Transport:
    def __init__(self, *, peer="daemon", data=None, after=None):
        self.peer, self.after = peer, after or peer
        self.data = catalogue() if data is None else data
        self.bound, self.calls = None, []
        self.health_calls = 0

    def bind_daemon_id(self, value):
        self.bound = value

    async def request(self, method, path):
        self.calls.append(path)
        if path == "/api/health":
            self.health_calls += 1
            return {
                "daemon_id": self.peer if self.health_calls == 1 else self.after,
                "protocol_min": 1,
                "protocol_max": 1,
            }
        assert self.bound == self.peer
        return self.data


def worker(transport, reads=None):
    def credential():
        if reads is not None:
            reads.append(threading.get_ident())
        return "private-secret"

    connection = SimpleNamespace(
        url="http://localhost:8420", daemon_id="daemon", read_credential=credential
    )
    return DaemonModelsWorker(
        connection, transport_factory=lambda *args, **kwargs: transport
    )


def test_catalogue_worker_is_inert_then_pins_authenticated_peer_off_qt_thread():
    app = QApplication.instance() or QApplication([])
    reads, results = [], []
    transport = Transport()
    request = worker(transport, reads)
    request.resultSig.connect(results.append)
    assert reads == [] and transport.calls == []
    request.start()
    assert request.wait(5000)
    app.processEvents()
    assert results[0]["daemon_id"] == "daemon"
    assert results[0]["catalogue"]["runtime_verified"] is False
    assert reads and reads[0] != threading.get_ident()
    assert transport.calls == ["/api/health", "/api/models", "/api/health"]


@pytest.mark.parametrize(
    "bad",
    [
        {"runtime_verified": True},
        {"source": "runtime"},
        {"models": [{}]},
        {
            "models": [
                {"id": "cnn", "display_name": "bad\ncontrol", "supported_dims": [1]}
            ]
        },
    ],
)
def test_invalid_catalogue_claims_and_control_text_are_refused(bad):
    with pytest.raises((ValueError, TypeError)):
        validate_catalogue(catalogue() | bad)


@pytest.mark.parametrize("changes", [{"peer": "foreign"}, {"after": "foreign"}])
def test_foreign_or_changed_peer_never_returns_catalogue(changes):
    request = worker(Transport(**changes))
    with pytest.raises(ValueError):
        asyncio.run(request._execute())


def test_duplicate_model_ids_nonfinite_numbers_and_huge_catalogue_refused():
    value = catalogue()
    value["models"].append(copy.deepcopy(value["models"][0]))
    with pytest.raises(ValueError):
        validate_catalogue(value)
    value = catalogue()
    value["models"][0]["params_m"] = float("nan")
    with pytest.raises(ValueError):
        validate_catalogue(value)
    value = catalogue()
    value["models"][0]["description"] = "x" * 262145
    with pytest.raises(ValueError):
        validate_catalogue(value)


def test_unicode_direction_controls_and_invalid_dimension_objects_are_refused():
    value = catalogue()
    value["models"][0]["display_name"] = "Model\u202eidentity"
    with pytest.raises(ValueError):
        validate_catalogue(value)
    value = catalogue()
    value["models"][0]["supported_dims"] = [{}]
    with pytest.raises(ValueError):
        validate_catalogue(value)


def test_cancellable_dns_style_wait_does_not_block_request_thread_or_emit_late_result():
    app = QApplication.instance() or QApplication([])
    entered, release = threading.Event(), threading.Event()

    class DnsTransport(Transport):
        async def request(self, *args):
            entered.set()
            await asyncio.to_thread(release.wait, 3)
            return await super().request(*args)

    request = worker(DnsTransport())
    results = []
    request.resultSig.connect(results.append)
    try:
        request.start()
        assert entered.wait(2)
        before = time.monotonic()
        request.stop()
        assert request.wait(1000)
        assert time.monotonic() - before < 1
        app.processEvents()
        assert results == []
    finally:
        release.set()


def test_browser_preserves_manual_offline_choices_then_uses_daemon_inventory_plaintext(
    monkeypatch,
):
    QApplication.instance() or QApplication([])
    panel = ModelBrowserPanel()
    assert panel.model_count > 0
    original = panel.selected_key
    assert "Offline" in panel._catalogue_status.text()
    value = catalogue()
    item = copy.deepcopy(next(item for item in value["models"] if item["id"] == "cnn"))
    item["display_name"] = "<b>Plain text CNN</b>"
    value["models"] = [item]
    value["categories"] = {
        "Server descriptions": {
            "models": ["cnn"],
            "short_description": "Descriptive only",
        }
    }
    panel._accept_catalogue(
        {"daemon_id": "daemon", "catalogue": validate_catalogue(value)}
    )
    assert panel.model_count == 1 and panel.selected_key == "cnn"
    assert panel._cards["cnn"].nameLabel.textFormat() == Qt.TextFormat.PlainText
    assert "not verified" in panel._catalogue_status.text()
    assert original
    panel._catalogue_failure("Offline catalogue; runtime support not verified")
    assert panel.model_count > 1
    assert "Offline" in panel._catalogue_status.text()
    panel.deleteLater()


def test_recommendation_never_uses_frontend_hardware(monkeypatch):
    from wavedl_gui.common import utils

    monkeypatch.setattr(
        utils,
        "detect_gpus",
        lambda: pytest.fail("No client GPU proof for remote runtime"),
    )
    assert _get_recommended_model(SimpleNamespace(dimensionality="1D")) == "tcn_small"
    assert _get_recommended_model(SimpleNamespace(dimensionality="2D")) == "resnet18"
    assert _get_recommended_model(SimpleNamespace(dimensionality="3D")) == "resnet3d_18"


def test_invalid_response_error_is_redacted_and_never_emits_catalogue():
    app = QApplication.instance() or QApplication([])

    class FailedTransport(Transport):
        async def request(self, *args):
            raise OSError("private-secret /private/credential")

    request = worker(FailedTransport())
    results, errors = [], []
    request.resultSig.connect(results.append)
    request.errorSig.connect(errors.append)
    request.start()
    assert request.wait(5000)
    app.processEvents()
    assert results == [] and errors
    assert "private-secret" not in errors[0] and "/private" not in errors[0]


def test_model_browser_constructor_does_not_read_credential_or_make_network(
    monkeypatch,
):
    QApplication.instance() or QApplication([])
    from wavedl_gui.service.daemon_contracts import DaemonConnection

    monkeypatch.setattr(
        DaemonConnection,
        "read_credential",
        lambda *args: pytest.fail("Constructor must remain inert"),
    )
    panel = ModelBrowserPanel()
    assert panel._catalogue_worker is None
    assert panel.model_count > 0
    panel.deleteLater()


def test_model_step_populates_offline_without_hardware_or_bad_connection_crash(
    monkeypatch,
):
    app = QApplication.instance() or QApplication([])
    from wavedl_gui.common import config
    from wavedl_gui.view.wizard.model_step import ModelStep

    monkeypatch.setattr(
        config,
        "daemonConnection",
        lambda: (_ for _ in ()).throw(ValueError("No profile")),
    )
    step = ModelStep()
    step.populate(SimpleNamespace(dimensionality="2D"))
    assert step.get_selected_model() == "resnet18"
    assert step.is_valid()
    assert "not verified" in step._rec_label.text()
    assert "offline" in step._browser._catalogue_status.text()
    step.deleteLater()
    app.processEvents()


def test_narrower_daemon_inventory_clears_previous_choice_instead_of_ghost_selection():
    QApplication.instance() or QApplication([])
    panel = ModelBrowserPanel()
    panel.select_model("resnet18")
    assert panel.selected_key == "resnet18"
    value = catalogue()
    value["models"] = [next(item for item in value["models"] if item["id"] == "cnn")]
    value["categories"] = {
        "Models": {"models": ["cnn"], "short_description": "Descriptions"}
    }
    choices = []
    panel.modelSelected.connect(choices.append)
    panel._accept_catalogue({"daemon_id": "daemon", "catalogue": value})
    assert panel.selected_key == "" and choices[-1] == ""
    assert "resnet18" not in panel._cards
    panel.select_model("cnn")
    assert panel.selected_key == "cnn"
    panel.deleteLater()


def test_destroyed_browser_cancels_blocked_worker_without_late_ui_callback(monkeypatch):
    from PySide6.QtCore import QCoreApplication, QEvent
    from shiboken6 import isValid

    from wavedl_gui.service import daemon_models_worker as module

    app = QApplication.instance() or QApplication([])
    entered, release = threading.Event(), threading.Event()

    class BlockedTransport(Transport):
        async def request(self, *args):
            entered.set()
            await asyncio.to_thread(release.wait, 3)
            return await super().request(*args)

    created = []
    original = module.DaemonModelsWorker

    def factory(connection, parent):
        request = original(
            connection,
            parent,
            transport_factory=lambda *args, **kwargs: BlockedTransport(),
        )
        created.append(request)
        return request

    monkeypatch.setattr(module, "DaemonModelsWorker", factory)
    connection = SimpleNamespace(
        url="http://localhost:8420",
        daemon_id="daemon",
        read_credential=lambda: "secret",
    )
    panel = ModelBrowserPanel()
    try:
        panel.refresh_catalogue(connection)
        assert entered.wait(2)
        panel.deleteLater()
        QCoreApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
        assert not isValid(panel)
        assert created[0].wait(1000)
        app.processEvents()
    finally:
        release.set()


def test_failed_profile_refresh_ignores_previously_queued_catalogue_result(monkeypatch):
    from PySide6.QtCore import QObject, Signal

    from wavedl_gui.common import config
    from wavedl_gui.service import daemon_models_worker as module

    QApplication.instance() or QApplication([])

    class Pending(QObject):
        resultSig = Signal(object)
        errorSig = Signal(str)
        finished = Signal()

        def start(self):
            pass

        def isRunning(self):
            return True

        def stop(self):
            pass

    pending = Pending()
    monkeypatch.setattr(module, "DaemonModelsWorker", lambda *args: pending)
    panel = ModelBrowserPanel()
    panel.refresh_catalogue(object())
    monkeypatch.setattr(
        config,
        "daemonConnection",
        lambda: (_ for _ in ()).throw(ValueError("No profile")),
    )
    panel.refresh_catalogue()
    status = panel._catalogue_status.text()
    pending.resultSig.emit({"daemon_id": "daemon", "catalogue": catalogue()})
    assert panel._catalogue_status.text() == status
    assert panel._catalogue_worker is None
    panel.deleteLater()
