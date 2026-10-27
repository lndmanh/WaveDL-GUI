"""Explicit daemon-side path selection through authenticated browse authority."""

import asyncio

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import QHBoxLayout, QListWidgetItem
from qfluentwidgets import (
    BodyLabel,
    ComboBox,
    ListWidget,
    MessageBoxBase,
    PushButton,
    SubtitleLabel,
)

from wavedl.core.client_transport import HttpTransport

from ..common.config import daemonConnection
from ..service.async_request_worker import AsyncRequestWorker, requireDaemonProtocol
from ..service.daemon_contracts import PathSelectionRef


class _BrowseWorker(AsyncRequestWorker):
    resultSig = Signal(object)
    errorSig = Signal(str)

    def __init__(
        self, connection, root=None, path="", resolve=False, parent=None, offset=0
    ):
        super().__init__(parent)
        self.connection, self.root, self.path, self.resolve = (
            connection,
            root,
            path,
            resolve,
        )
        self.offset = offset

    def _on_result(self, result):
        self.resultSig.emit(result)

    def _on_error(self):
        self.errorSig.emit(
            self._error_message(
                "Browse unavailable. Check connection and configured browse locations."
            )
        )

    async def _execute(self):
        async with asyncio.timeout(15):
            return await self._request()

    async def _request(self):
        transport = HttpTransport(
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
        if self.resolve:
            value = await transport.request(
                "POST",
                "/api/browse/resolve",
                body={"root": self.root, "path": self.path},
            )
        else:
            query = (
                {
                    "root": self.root,
                    "path": self.path,
                    "offset": self.offset,
                    "limit": 100,
                }
                if self.root is not None
                else {}
            )
            value = await transport.request("GET", "/api/browse", query=query)
        after = await transport.request("GET", "/api/health")
        self._health(after)
        if before["daemon_id"] != after.get("daemon_id"):
            raise ValueError("Daemon identity changed")
        return {
            "value": value,
            "daemon_id": before["daemon_id"],
            "resolved": self.resolve,
            "root": self.root,
            "path": self.path,
        }

    @staticmethod
    def _health(value):
        requireDaemonProtocol(value)
        if (
            type(value.get("daemon_id")) is not str
            or not value["daemon_id"]
            or len(value["daemon_id"]) > 256
            or any(ord(char) < 32 for char in value["daemon_id"])
        ):
            raise ValueError("Invalid daemon identity")


class DaemonPathDialog(MessageBoxBase):
    """Browse selected configured roots without treating local paths as remote."""

    def __init__(self, parent=None, *, kind="file"):
        super().__init__(parent)
        self.kind = kind
        self.selection = None
        self._path = ""
        self._offset = 0
        self._workers = []
        self._current = None
        self._closed = False
        self._daemon_id = None
        self.viewLayout.addWidget(
            SubtitleLabel(self.tr("Choose a path on the daemon host"), self)
        )
        self.viewLayout.addWidget(
            BodyLabel(
                self.tr(
                    "Only configured browse locations are shown. Local files are not uploaded."
                ),
                self,
            )
        )
        row = QHBoxLayout()
        self.rootBox = ComboBox(self)
        self.rootBox.setAccessibleName(self.tr("Browse location"))
        self.upButton = PushButton(self.tr("Up"), self)
        row.addWidget(self.rootBox, 1)
        row.addWidget(self.upButton)
        self.previousButton = PushButton(self.tr("Previous"), self)
        self.nextButton = PushButton(self.tr("Next"), self)
        row.addWidget(self.previousButton)
        row.addWidget(self.nextButton)
        self.viewLayout.addLayout(row)
        self.pathLabel = BodyLabel("", self)
        self.pathLabel.setTextFormat(Qt.TextFormat.PlainText)
        self.viewLayout.addWidget(self.pathLabel)
        self.entries = ListWidget(self)
        self.entries.setAccessibleName(self.tr("Files on the daemon host"))
        self.entries.setMinimumHeight(260)
        self.viewLayout.addWidget(self.entries)
        self.statusLabel = BodyLabel(self.tr("Loading browse locations…"), self)
        self.statusLabel.setTextFormat(Qt.TextFormat.PlainText)
        self.statusLabel.setWordWrap(True)
        self.viewLayout.addWidget(self.statusLabel)
        self.yesButton.setText(self.tr("Use selected path"))
        self.yesButton.setEnabled(False)
        self.cancelButton.setText(self.tr("Cancel"))
        self.widget.setMinimumWidth(560)
        self.rootBox.currentIndexChanged.connect(self._rootChanged)
        self.upButton.clicked.connect(self._goUp)
        self.previousButton.clicked.connect(lambda: self._page(-100))
        self.nextButton.clicked.connect(lambda: self._page(100))
        self.entries.itemDoubleClicked.connect(self._openEntry)
        self.entries.currentItemChanged.connect(self._selectEntry)
        self.finished.connect(self._dialogClosed)
        try:
            self.connection = daemonConnection()
            self._browse()
        except (ValueError, TypeError):
            self.statusLabel.setText(
                self.tr("Configure the daemon connection in Settings first")
            )

    def _browse(self, *, resolve=False, path=None):
        if self._current is not None and self._current.isRunning():
            self._current.stop()
        root = self.rootBox.currentData()
        worker = _BrowseWorker(
            self.connection,
            root,
            self._path if path is None else path,
            resolve,
            self,
            self._offset,
        )
        self._workers.append(worker)
        self._current = worker
        self.yesButton.setEnabled(False)
        worker.resultSig.connect(self._browseReady)
        worker.errorSig.connect(self._browseError)
        worker.finished.connect(self._browseFinished)
        worker.start()

    def _browseReady(self, result):
        if self.sender() is self._current and not self._closed:
            self._ready(result)

    def _browseError(self, error):
        if self.sender() is self._current and not self._closed:
            self.statusLabel.setText(error)

    def _browseFinished(self):
        worker = self.sender()
        if worker in self._workers:
            self._workers.remove(worker)

    @staticmethod
    def _browseText(value, *, empty=False):
        if (
            type(value) is not str
            or (not empty and not value)
            or len(value.encode("utf-8")) > 4096
            or any(ord(char) < 32 or ord(char) == 127 for char in value)
        ):
            raise ValueError("Invalid browse text")
        return value

    def _validateBrowseResult(self, result):
        if (
            type(result) is not dict
            or type(result.get("resolved")) is not bool
            or type(result.get("value")) is not dict
        ):
            raise ValueError("Invalid browse response")
        identity = self._browseText(result.get("daemon_id"))
        if len(identity) > 256:
            raise ValueError("Invalid browse identity")
        value = result["value"]
        if result["resolved"]:
            if value.get("kind") not in {"file", "directory"}:
                raise ValueError("Invalid selected kind")
            path = self._browseText(value.get("path"))
            PathSelectionRef(
                path, "daemon", identity, result.get("root"), result.get("path")
            )
            return
        if "roots" in value:
            roots = value["roots"]
            if type(roots) is not list or len(roots) > 128:
                raise ValueError("Invalid browse locations")
            names = []
            for root in roots:
                if type(root) is not dict:
                    raise ValueError("Invalid browse location")
                names.append(self._browseText(root.get("id")))
            if len(set(names)) != len(names):
                raise ValueError("Duplicate browse locations")
            return
        path = self._browseText(value.get("path"), empty=True)
        if path and any(
            part in {"", ".", ".."} or any(char in part for char in "\\:")
            for part in path.split("/")
        ):
            raise ValueError("Invalid browse relative path")
        entries, total = value.get("entries"), value.get("total")
        if (
            type(entries) is not list
            or len(entries) > 100
            or type(total) is not int
            or not len(entries) <= total <= 2**31 - 1
        ):
            raise ValueError("Invalid browse page")
        names = []
        for entry in entries:
            if type(entry) is not dict or entry.get("kind") not in {
                "file",
                "directory",
            }:
                raise ValueError("Invalid browse member")
            name = self._browseText(entry.get("name"))
            if name in {".", ".."} or any(char in name for char in "/\\:"):
                raise ValueError("Invalid browse member name")
            names.append(name)
        if len(set(names)) != len(names):
            raise ValueError("Duplicate browse members")

    def _ready(self, result):
        try:
            self._validateBrowseResult(result)
        except (ValueError, TypeError):
            self.selection = None
            self.entries.clear()
            self.yesButton.setEnabled(False)
            self.statusLabel.setText(
                self.tr(
                    "Invalid browse response. Check the daemon version and reconnect."
                )
            )
            return
        if self._daemon_id is not None and self._daemon_id != result["daemon_id"]:
            self.statusLabel.setText(
                self.tr(
                    "The daemon changed. Close this dialog and select a path again."
                )
            )
            self.entries.clear()
            self.selection = None
            self.yesButton.setEnabled(False)
            return
        self._daemon_id = result["daemon_id"]
        value = result["value"]
        if result["resolved"]:
            if value.get("kind") != self.kind:
                self.statusLabel.setText(
                    self.tr("Choose the expected file or directory type")
                )
                return
            self.selection = PathSelectionRef(
                value["path"],
                "daemon",
                result["daemon_id"],
                result.get("root"),
                result.get("path"),
            )
            self.yesButton.setEnabled(True)
            self.statusLabel.setText(value["path"])
            return
        if "roots" in value:
            self.rootBox.blockSignals(True)
            self.rootBox.clear()
            for root in value["roots"]:
                self.rootBox.addItem(root["id"], userData=root["id"])
            self.rootBox.blockSignals(False)
            if self.rootBox.count():
                self._rootChanged()
            else:
                self.statusLabel.setText(
                    self.tr("Configure a browse root when starting the daemon")
                )
            return
        self.entries.clear()
        self.selection = None
        self.pathLabel.setText(value["path"] or "/")
        self.previousButton.setEnabled(self._offset > 0)
        self.nextButton.setEnabled(
            self._offset + len(value["entries"]) < value["total"]
        )
        for entry in value["entries"]:
            item = QListWidgetItem(
                entry["name"] + ("/" if entry["kind"] == "directory" else "")
            )
            item.setData(Qt.ItemDataRole.UserRole, entry)
            self.entries.addItem(item)
        self.statusLabel.setText(
            self.tr("Select a file; double-click a directory to open it")
        )

    def _rootChanged(self, *_):
        self._path = ""
        self._offset = 0
        self._browse()

    def _goUp(self):
        self._path = self._path.rpartition("/")[0]
        self._offset = 0
        self._browse()

    def _memberPath(self, entry):
        return f"{self._path}/{entry['name']}" if self._path else entry["name"]

    def _openEntry(self, item):
        entry = item.data(Qt.ItemDataRole.UserRole)
        if entry["kind"] == "directory":
            self._path = self._memberPath(entry)
            self._offset = 0
            self._browse()

    def _page(self, step):
        self._offset = max(0, self._offset + step)
        self._browse()

    def _selectEntry(self, item, _previous=None):
        self.selection = None
        self.yesButton.setEnabled(False)
        if item is not None:
            entry = item.data(Qt.ItemDataRole.UserRole)
            if entry["kind"] == self.kind:
                self._browse(resolve=True, path=self._memberPath(entry))

    def validate(self):
        return self.selection is not None

    def _dialogClosed(self, *_):
        self._closed = True
        for worker in self._workers:
            worker.stop()
