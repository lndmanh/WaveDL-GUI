"""
WaveDL GUI - DropSingleFileWidgetPro

A polished drag-and-drop file picker widget following PySide-Fluent-Widgets
aesthetics. Supports three visual states (normal, drag-hover, file-loaded),
file-extension filtering, and emits ``fileChanged`` on selection / clear.
"""

from __future__ import annotations

import os
from enum import Enum, auto

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import (
    QColor,
    QDragEnterEvent,
    QDragLeaveEvent,
    QDropEvent,
    QFont,
    QPainter,
    QPainterPath,
    QPen,
)
from PySide6.QtWidgets import (
    QFileDialog,
    QHBoxLayout,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)
from qfluentwidgets import (
    BodyLabel,
    CaptionLabel,
    FluentIcon as FIF,
    HyperlinkButton,
    IconWidget,
    TransparentToolButton,
    isDarkTheme,
    setFont,
    themeColor,
)


# ─── Internal state enum ─────────────────────────────────────────────────────


class _State(Enum):
    NORMAL = auto()
    DRAG_HOVER = auto()
    FILE_LOADED = auto()


# ─── Widget ───────────────────────────────────────────────────────────────────


class DropSingleFileWidgetPro(QWidget):
    """Drag-and-drop single-file picker with Fluent Design styling.

    Parameters
    ----------
    allowed_extensions : list[str]
        List of allowed lowercase file extensions including the dot,
        e.g. ``['.npz', '.mat', '.h5', '.hdf5']``.
    parent : QWidget | None
        Optional parent widget.
    """

    fileChanged = Signal(str)

    def __init__(
        self,
        allowed_extensions: list[str] | None = None,
        parent: QWidget | None = None,
    ):
        super().__init__(parent)
        self._state = _State.NORMAL
        self._file_path: str = ""
        self._allowed_extensions: list[str] = [
            ext.lower() for ext in (allowed_extensions or [])
        ]

        self.setAcceptDrops(True)
        self.setMinimumHeight(200)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)

        self._init_ui()

    # ── UI construction ───────────────────────────────────────────────────

    def _init_ui(self):
        self._root_layout = QVBoxLayout(self)
        self._root_layout.setContentsMargins(0, 0, 0, 0)
        self._root_layout.setSpacing(0)

        # --- Normal / drag-hover content ---
        self._normal_widget = QWidget(self)
        normal_layout = QVBoxLayout(self._normal_widget)
        normal_layout.setContentsMargins(24, 36, 24, 36)
        normal_layout.setSpacing(8)
        normal_layout.setAlignment(Qt.AlignmentFlag.AlignCenter)

        self._icon_widget = IconWidget(FIF.ADD, self._normal_widget)
        self._icon_widget.setFixedSize(48, 48)
        normal_layout.addWidget(self._icon_widget, 0, Qt.AlignmentFlag.AlignHCenter)

        normal_layout.addSpacing(4)

        self._label = BodyLabel("Drag & drop file here", self._normal_widget)
        self._label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._label.setTextColor(QColor(110, 110, 110), QColor(160, 160, 160))
        normal_layout.addWidget(self._label, 0, Qt.AlignmentFlag.AlignHCenter)

        self._browse_btn = HyperlinkButton("", "Browse file", self._normal_widget)
        self._browse_btn.clicked.connect(self._on_browse)
        normal_layout.addWidget(self._browse_btn, 0, Qt.AlignmentFlag.AlignHCenter)

        self._root_layout.addWidget(self._normal_widget)

        # --- File-loaded content ---
        self._loaded_widget = QWidget(self)
        loaded_layout = QHBoxLayout(self._loaded_widget)
        loaded_layout.setContentsMargins(24, 0, 24, 0)
        loaded_layout.setSpacing(14)
        loaded_layout.setAlignment(Qt.AlignmentFlag.AlignVCenter)

        self._file_icon = IconWidget(FIF.DOCUMENT, self._loaded_widget)
        self._file_icon.setFixedSize(36, 36)
        loaded_layout.addWidget(self._file_icon, 0, Qt.AlignmentFlag.AlignVCenter)

        info_col = QVBoxLayout()
        info_col.setSpacing(2)
        info_col.setContentsMargins(0, 0, 0, 0)

        self._file_name_label = BodyLabel("", self._loaded_widget)
        setFont(self._file_name_label, 14, QFont.Weight.DemiBold)
        info_col.addWidget(self._file_name_label)

        self._file_size_label = CaptionLabel("", self._loaded_widget)
        self._file_size_label.setTextColor(QColor(110, 110, 110), QColor(160, 160, 160))
        info_col.addWidget(self._file_size_label)

        loaded_layout.addLayout(info_col, 1)

        self._clear_btn = TransparentToolButton(FIF.CLOSE, self._loaded_widget)
        self._clear_btn.setFixedSize(32, 32)
        self._clear_btn.clicked.connect(self._on_clear)
        loaded_layout.addWidget(self._clear_btn, 0, Qt.AlignmentFlag.AlignVCenter)

        self._loaded_widget.hide()
        self._root_layout.addWidget(self._loaded_widget)

    # ── Paint ─────────────────────────────────────────────────────────────

    def paintEvent(self, _event):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)

        accent = themeColor()
        radius = 10

        # Determine colors & style based on state
        if self._state == _State.DRAG_HOVER:
            border_color = accent
            bg = QColor(accent)
            bg.setAlpha(18 if not isDarkTheme() else 12)
            dash = True
        elif self._state == _State.FILE_LOADED:
            border_color = accent
            bg = QColor(accent)
            bg.setAlpha(10 if not isDarkTheme() else 8)
            dash = False
        else:  # NORMAL
            border_color = (
                QColor(160, 160, 160, 120)
                if not isDarkTheme()
                else QColor(100, 100, 100, 120)
            )
            bg = QColor(0, 0, 0, 0)
            dash = True

        # Background
        path = QPainterPath()
        r = self.rect().adjusted(1, 1, -1, -1)
        path.addRoundedRect(r, radius, radius)

        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(bg)
        p.drawPath(path)

        # Border
        pen = QPen(border_color, 2)
        if dash:
            pen.setStyle(Qt.PenStyle.CustomDashLine)
            pen.setDashPattern([6, 4])
        else:
            pen.setStyle(Qt.PenStyle.SolidLine)
        p.setPen(pen)
        p.setBrush(Qt.BrushStyle.NoBrush)
        p.drawPath(path)

    # ── Drag events ───────────────────────────────────────────────────────

    def dragEnterEvent(self, event: QDragEnterEvent):
        if event.mimeData().hasUrls() and len(event.mimeData().urls()) == 1:
            url = event.mimeData().urls()[0]
            if url.isLocalFile() and self._is_extension_allowed(url.toLocalFile()):
                event.acceptProposedAction()
                self._state = _State.DRAG_HOVER
                self.update()
                return
        event.ignore()

    def dragLeaveEvent(self, _event: QDragLeaveEvent):
        if self._state == _State.DRAG_HOVER:
            self._state = _State.NORMAL if not self._file_path else _State.FILE_LOADED
            self.update()

    def dropEvent(self, event: QDropEvent):
        if event.mimeData().hasUrls() and len(event.mimeData().urls()) == 1:
            path = event.mimeData().urls()[0].toLocalFile()
            if self._is_extension_allowed(path):
                event.acceptProposedAction()
                self._set_file(path)
                return
        event.ignore()
        self._state = _State.NORMAL if not self._file_path else _State.FILE_LOADED
        self.update()

    # ── Browse ────────────────────────────────────────────────────────────

    def _on_browse(self):
        filter_str = self._build_filter_string()
        path, _ = QFileDialog.getOpenFileName(
            self.window(),
            "Select File",
            "",
            filter_str,
        )
        if path:
            self._set_file(path)

    # ── Clear ─────────────────────────────────────────────────────────────

    def _on_clear(self):
        self._file_path = ""
        self._state = _State.NORMAL
        self.setMinimumHeight(200)
        self.setMaximumHeight(16777215)
        self._normal_widget.show()
        self._loaded_widget.hide()
        self.update()
        self.fileChanged.emit("")

    # ── Internal helpers ──────────────────────────────────────────────────

    def _set_file(self, path: str):
        self._file_path = path
        self._state = _State.FILE_LOADED

        # Update loaded-state labels
        self._file_name_label.setText(os.path.basename(path))
        self._file_size_label.setText(self._format_size(path))

        # Shrink to compact row height
        self.setMinimumHeight(72)
        self.setMaximumHeight(72)

        # Swap visible widgets
        self._normal_widget.hide()
        self._loaded_widget.show()
        self.update()
        self.fileChanged.emit(path)

    def _is_extension_allowed(self, path: str) -> bool:
        if not self._allowed_extensions:
            return True
        _, ext = os.path.splitext(path)
        return ext.lower() in self._allowed_extensions

    def _build_filter_string(self) -> str:
        if not self._allowed_extensions:
            return "All Files (*)"
        exts = " ".join(f"*{e}" for e in self._allowed_extensions)
        return f"Supported Files ({exts});;All Files (*)"

    @staticmethod
    def _format_size(path: str) -> str:
        try:
            size = os.path.getsize(path)
        except OSError:
            return ""
        for unit in ("B", "KB", "MB", "GB"):
            if size < 1024:
                return f"{size:.1f} {unit}"
            size /= 1024
        return f"{size:.1f} TB"

    # ── Public API ────────────────────────────────────────────────────────

    def getFile(self) -> str:
        """Return the currently selected file path, or empty string."""
        return self._file_path

    def setAllowedExtensions(self, extensions: list[str]):
        """Update the list of allowed file extensions.

        Parameters
        ----------
        extensions : list[str]
            Lowercase extensions with the dot, e.g. ``['.npz', '.mat']``.
        """
        self._allowed_extensions = [ext.lower() for ext in extensions]
