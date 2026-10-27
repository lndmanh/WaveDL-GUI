"""
WaveDL GUI - Wizard Step 3: Model Selection & Recommendation

Embeds the shared ModelBrowserPanel with a recommendation banner and
descriptive model suggestion based on data dimensionality, not client hardware.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from PySide6.QtCore import Signal
from PySide6.QtWidgets import (
    QHBoxLayout,
    QVBoxLayout,
    QWidget,
)
from qfluentwidgets import (
    CaptionLabel,
    FluentIcon as FIF,
    IconWidget,
    isDarkTheme,
)

from ...common.constants.models import MODEL_INFO
from ...components.model_selector_dialog import ModelBrowserPanel
from ...components.shared import add_step_header


if TYPE_CHECKING:
    from ...common.utils import DataInfo


# ─── Recommendation logic ────────────────────────────────────────────────────


def _get_recommended_model(data_info: DataInfo | None) -> str:
    """Suggest from descriptive dimensionality, never client/remote hardware."""
    dim = data_info.dimensionality if data_info else "2D"

    if dim == "1D":
        return "tcn_small"
    elif dim == "3D":
        return "resnet3d_18"
    else:  # 2D or default
        return "resnet18"


# ─── Model step widget ───────────────────────────────────────────────────────


class ModelStep(QWidget):
    """Step 3: model selection with smart recommendation.

    Wraps :class:`ModelBrowserPanel` with a step header,
    recommendation banner, and auto-selection logic.
    """

    modelSelected = Signal(str)  # model_id

    def __init__(self, parent=None):
        super().__init__(parent)
        self._data_info: DataInfo | None = None
        self._recommended: str = ""
        self._init_ui()

    def _init_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(40, 36, 40, 36)
        root.setSpacing(0)

        # Title
        _, self._sub = add_step_header(
            root,
            "Choose a Model",
            "Models are filtered by your data type. We've highlighted a recommendation.",
            self,
            bottom_spacing=16,
        )

        # ── Recommendation banner ──
        self._rec_banner = QWidget(self)
        rec_lay = QHBoxLayout(self._rec_banner)
        rec_lay.setContentsMargins(14, 10, 14, 10)
        rec_lay.setSpacing(8)
        rec_ic = IconWidget(FIF.INFO, self._rec_banner)
        rec_ic.setFixedSize(18, 18)
        rec_lay.addWidget(rec_ic)
        self._rec_label = CaptionLabel("", self._rec_banner)
        self._rec_label.setWordWrap(True)
        rec_lay.addWidget(self._rec_label, 1)
        if isDarkTheme():
            self._rec_banner.setStyleSheet(
                "background: rgba(0,159,170,0.12); border-radius: 8px;"
            )
        else:
            self._rec_banner.setStyleSheet(
                "background: rgba(0,159,170,0.06); border-radius: 8px;"
            )
        self._rec_banner.hide()
        root.addWidget(self._rec_banner)

        root.addSpacing(12)

        # ── Shared browser panel ──
        self._browser = ModelBrowserPanel(self)
        self._browser.modelSelected.connect(self.modelSelected)
        self._browser.modelCountChanged.connect(self._on_count_changed)
        root.addWidget(self._browser, 1)

    # ── Public API ───────────────────────────────────────────────────────

    def populate(self, data_info: DataInfo | None):
        """Populate the browser, filtering by data dimensionality."""
        self._data_info = data_info
        self._browser.refresh_catalogue()

        # Set dim filter
        dim: int | None = None
        if data_info and data_info.dimensionality:
            dim_map = {"1D": 1, "2D": 2, "3D": 3}
            dim = dim_map.get(data_info.dimensionality)
        self._browser.set_dim_filter(dim)

        # Recommendation
        self._recommended = _get_recommended_model(data_info)
        rec_info = MODEL_INFO.get(self._recommended, {})
        rec_name = rec_info.get("display_name", self._recommended)
        self._rec_label.setText(
            f"Suggested: {rec_name} — descriptive data dimensions only; daemon runtime support is not verified"
        )
        self._rec_banner.show()

        # Auto-select recommended
        if self._recommended:
            self._browser.select_model(self._recommended)
            self._browser.scroll_to(self._recommended)

    def _on_count_changed(self, shown: int, total: int):
        """Update subtitle when the browser filter changes."""
        if shown < total:
            self._sub.setText(
                f"Showing {shown} of {total} descriptions matching your data dimensions; runtime compatibility is not verified."
            )
        else:
            self._sub.setText(
                f"Showing all {total} descriptions. Runtime support must be established by the selected daemon."
            )

    def get_selected_model(self) -> str:
        return self._browser.selected_key

    def is_valid(self) -> bool:
        return bool(self._browser.selected_key)
