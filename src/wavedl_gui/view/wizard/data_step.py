"""
WaveDL GUI - Wizard Step 2: Data Input & Output Configuration

Shows a prominent drag-and-drop file picker first. Only after a valid file
is selected does the rest of the UI (output directory, data info, plots)
become visible.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QVBoxLayout,
    QWidget,
)
from qfluentwidgets import (
    BodyLabel,
    FluentIcon as FIF,
    IndeterminateProgressRing,
    InfoBar,
    InfoBarPosition,
    PushButton,
    SmoothScrollArea,
)

from ...common.config import cfg
from ...components.data_info_card import DataInfoCard
from ...components.data_plots_card import DataPlotsCard
from ...components.drop_single_file_widget import DropSingleFileWidgetPro
from ...components.hint_widget import HintWidget
from ...components.shared import (
    FolderPickerCard,
    SettingCardGroup,
    add_step_header,
)
from ...service.data_parse_worker import DataParseWorker


if TYPE_CHECKING:
    from ...common.utils import DataInfo

# Allowed extensions for the drop widget
_ALLOWED_EXTENSIONS = [".npz", ".mat", ".h5", ".hdf5"]


class DataStep(QWidget):
    """Step 2: data input/output configuration.

    Displays a drag-and-drop file picker prominently. Output configuration
    and data inspection cards are revealed only after a valid file is loaded.
    """

    dataValidated = Signal(object)  # DataInfo

    def __init__(self, parent=None):
        super().__init__(parent)
        self._data_info: DataInfo | None = None
        self._worker: DataParseWorker | None = None
        self._workers = []
        self.path_selection = None
        self._server_path = ""
        self._init_ui()

    @property
    def data_info(self) -> DataInfo | None:
        return self._data_info

    def _init_ui(self):
        # Outer layout just holds the scroll area
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        self._scroll = SmoothScrollArea(self)
        self._scroll.setWidgetResizable(True)
        self._scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self._scroll.setStyleSheet(
            "QScrollArea { background: transparent; border: none; }"
        )

        scroll_widget = QWidget()
        scroll_widget.setStyleSheet("background: transparent;")
        root = QVBoxLayout(scroll_widget)
        root.setContentsMargins(60, 36, 60, 36)
        root.setSpacing(0)

        # Title
        add_step_header(
            root,
            "Configure Your Data",
            "Select your training data file and choose where to save results.",
            scroll_widget,
        )

        # ── Info tip ──
        info_box = HintWidget(
            FIF.INFO,
            "Supported formats: NPZ, MAT, HDF5. The file must contain "
            "input (X) and output (Y) arrays. Samples are along the first axis.",
            word_wrap=True,
        )
        root.addWidget(info_box)

        root.addSpacing(20)

        # ── Drop zone (always visible) ──
        self._drop_widget = DropSingleFileWidgetPro(
            allowed_extensions=_ALLOWED_EXTENSIONS,
            parent=scroll_widget,
        )
        self._drop_widget.fileChanged.connect(self._on_file_changed)
        root.addWidget(self._drop_widget)
        self._daemon_path_button = PushButton(
            self.tr("Browse files on the daemon"), self
        )
        self._daemon_path_button.clicked.connect(self._browseDaemon)
        root.addWidget(self._daemon_path_button)
        self._server_path_label = BodyLabel("", self)
        self._server_path_label.setTextFormat(Qt.TextFormat.PlainText)
        self._server_path_label.setWordWrap(True)
        root.addWidget(self._server_path_label)

        root.addSpacing(20)

        # ── Container for everything that appears after file selection ──
        self._post_file_container = QWidget(scroll_widget)
        post_layout = QVBoxLayout(self._post_file_container)
        post_layout.setContentsMargins(0, 0, 0, 0)
        post_layout.setSpacing(0)

        # ── Output Directory card group ──
        self._output_group = SettingCardGroup(
            "Output Configuration", self._post_file_container
        )
        self._folder_card = FolderPickerCard(
            title="Local download folder",
            description=cfg.get(cfg.outputFolder)
            or "Choose where to download verified checkpoints and plots",
            default_dir=cfg.get(cfg.outputFolder) or "",
            dialog_title="Select Local Download Folder",
            parent=self._output_group,
        )
        self._output_group.addSettingCard(self._folder_card)
        post_layout.addWidget(self._output_group)

        post_layout.addSpacing(20)

        # ── Spinner ──
        self._spinner = IndeterminateProgressRing(self._post_file_container)
        self._spinner.setFixedSize(36, 36)
        self._spinner.hide()
        post_layout.addWidget(self._spinner, 0, Qt.AlignCenter)

        # ── Reuse the production DataInfoCard ──
        self._data_card = DataInfoCard(self._post_file_container)
        post_layout.addWidget(self._data_card)

        post_layout.addSpacing(12)

        # ── Data plots card ──
        self._plots_card = DataPlotsCard(self._post_file_container)
        post_layout.addWidget(self._plots_card)

        # Initially hidden — revealed when a file is loaded
        self._post_file_container.hide()
        root.addWidget(self._post_file_container)

        root.addStretch()

        self._scroll.setWidget(scroll_widget)
        outer.addWidget(self._scroll)

    # ── slots ─────────────────────────────────────────────────────────────

    def _on_file_changed(self, path: str):
        """Handle file selection or clear from the drop widget."""
        self.path_selection = None
        self._server_path = ""
        self._server_path_label.setText("")
        if not path:
            # File cleared
            if self._worker is not None:
                self._worker.stop()
                self._worker = None
            self._data_info = None
            self._post_file_container.hide()
            self._data_card.hide()
            self._plots_card.clear()
            return
        self._parse_file(path)

    def _browseDaemon(self):
        from ...components.daemon_path_dialog import DaemonPathDialog

        dialog = DaemonPathDialog(self.window())
        if dialog.exec():
            self.path_selection = dialog.selection
            self._server_path = dialog.selection.path
            self._server_path_label.setText(self._server_path)
            self._parse_file(self._server_path)

    def _parse_file(self, path: str):
        if self._worker is not None and self._worker.isRunning():
            self._worker.stop()
        self._data_card.hide()
        self._spinner.show()
        self._data_info = None

        # Show the post-file container so spinner is visible
        self._post_file_container.show()

        worker = DataParseWorker(path, self, path_selection=self.path_selection)
        self._worker = worker
        self._workers.append(worker)
        worker.resultReady.connect(self._inspectionReady)
        worker.errorOccurred.connect(self._inspectionError)
        worker.finished.connect(self._finish_parse)
        worker.start()

    def _inspectionReady(self, info):
        if self.sender() is self._worker:
            self._on_parse_success(info)

    def _inspectionError(self, error):
        if self.sender() is self._worker:
            self._on_parse_error(error)

    def _finish_parse(self):
        worker = self.sender()
        if worker is self._worker:
            self._spinner.hide()
        if worker in self._workers:
            self._workers.remove(worker)

    def _on_parse_success(self, info: DataInfo):
        self._data_info = info
        self._data_card.set_data_info(info)
        if cfg.get(cfg.daemonPathRealm) == "same_host":
            self._plots_card.set_data_path(info.path)
        else:
            if self.path_selection is not None:
                self._plots_card.set_data_path(
                    info.path, path_selection=self.path_selection
                )
            else:
                self._plots_card.clear()
        self._post_file_container.show()
        self.dataValidated.emit(info)

    def _on_parse_error(self, error: str):
        self._data_info = None
        # Keep post-file container visible for output dir, hide data cards
        self._data_card.hide()
        self._plots_card.hide()
        w = self.window()
        InfoBar.error(
            title="Data Error",
            content=error,
            parent=w if w else self,
            position=InfoBarPosition.TOP,
            duration=5000,
        )

    # ── public API ────────────────────────────────────────────────────────

    def get_data_path(self) -> str:
        return self._server_path or self._drop_widget.getFile()

    def get_output_dir(self) -> str:
        return self._folder_card.folder

    def is_valid(self) -> bool:
        return (
            self._data_info is not None
            and not self._data_info.error
            and (
                self.path_selection is not None or os.path.isfile(self.get_data_path())
            )
        )
