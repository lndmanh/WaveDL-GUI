"""Lazy console entry point for the Qt client of the WaveDL daemon."""

import argparse
import os
import sys
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    """Launch the client, preserving Qt arguments and legacy config ownership."""
    arguments = list(sys.argv[1:] if argv is None else argv)
    parser = argparse.ArgumentParser(
        prog="wavedl-gui",
        description="Open the WaveDL desktop client and connect to a WaveDL daemon.",
    )
    # Qt arguments and existing launch-data arguments belong to the application.
    # Help must work without importing optional GUI or numerical dependencies.
    parser.parse_known_args(arguments)

    from PySide6.QtCore import Qt, QTranslator
    from qfluentwidgets import FluentTranslator

    from wavedl_gui.common import resource  # noqa: F401
    from wavedl_gui.common.application import SingletonApplication
    from wavedl_gui.common.config import cfg
    from wavedl_gui.view.main_window import MainWindow

    # Settings resolve AppData relative to the original launch directory, as
    # before. Import them before changing cwd; never migrate user preferences.
    os.chdir(Path(__file__).resolve().parent)

    if cfg.get(cfg.dpiScale) != "Auto":
        os.environ["QT_ENABLE_HIGHDPI_SCALING"] = "0"
        os.environ["QT_SCALE_FACTOR"] = str(cfg.get(cfg.dpiScale))

    app = SingletonApplication([sys.argv[0], *arguments], "WaveDL-GUI")
    app.setAttribute(Qt.AA_DontCreateNativeWidgetSiblings)

    if sys.platform == "darwin":
        from AppKit import NSApplication

        NSApplication.sharedApplication()

    locale = cfg.get(cfg.language).value
    translator = FluentTranslator(locale)
    galleryTranslator = QTranslator()
    galleryTranslator.load(locale, "src/wavedl_gui", ".", ":/src/wavedl_gui/i18n")
    app.installTranslator(translator)
    app.installTranslator(galleryTranslator)

    window = MainWindow()
    app.aboutToQuit.connect(window.onExit)
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
