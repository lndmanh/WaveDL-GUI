"""T41d removes downloader code, never installed user databases."""

import os
import subprocess
import sys
from pathlib import Path

import pytest


GUI = Path(__file__).resolve().parents[1] / "src" / "wavedl_gui"


def test_downloader_modules_and_sql_hooks_are_removed():
    for folder in (GUI / "common" / "database", GUI / "common" / "speed_badge"):
        assert not list(folder.rglob("*.py"))
    for name in ("download_task_service.py", "speed_service.py"):
        assert not (GUI / "service" / name).exists()
    forbidden = (
        "QSqlDatabase",
        "sqlRequest",
        "DatabaseThread",
        "DBInitializer",
        "SqlResponse",
        "sqlSignalBus",
        "speedService",
        "SpeedBadge",
        "DownloadTaskService",
        "SpeedService",
    )
    for source in GUI.rglob("*.py"):
        text = source.read_text(encoding="utf-8")
        assert not any(symbol in text for symbol in forbidden), source
    main = (GUI / "view" / "main_window.py").read_text(encoding="utf-8")
    assert "initDatabase" not in main
    assert "onDataFetched" not in main
    # Keep the unrelated concurrency utility, not the downloader Task entity.
    assert (GUI / "common" / "concurrent" / "task.py").is_file()


STARTUP = """
import sqlite3
import sys
from pathlib import Path

from PySide6.QtCore import QCoreApplication, QEvent
from PySide6.QtWidgets import QApplication
from shiboken6 import isValid

app = QApplication([])
# Offscreen Qt has no Cocoa NSWindow. Bypass only the native titlebar bridge,
# not MainWindow initialization, its interfaces, preferences, or lifecycle.
if sys.platform == "darwin":
    from qframelesswindow.mac import MacFramelessWindowBase
    MacFramelessWindowBase.updateFrameless = lambda self: None
    MacFramelessWindowBase._updateSystemTitleBar = lambda self: None
    MacFramelessWindowBase._updateSystemButtonRect = lambda self: None
    MacFramelessWindowBase.setSystemTitleBarButtonVisible = lambda self, visible: None
from wavedl_gui.common.setting import CONFIG_FOLDER
assert CONFIG_FOLDER == Path.cwd() / "AppData"
database = CONFIG_FOLDER / "database.db"
preserve = {preserve!r}
if preserve:
    CONFIG_FOLDER.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TABLE user_data (value TEXT)")
        connection.execute("INSERT INTO user_data VALUES ('keep me')")
    before = database.read_bytes()
else:
    assert not database.exists()

from wavedl_gui.common.config import cfg
cfg.set(cfg.checkUpdateAtStartUp, False, save=False)
cfg.set(cfg.showWizardOnStartup, False, save=False)
cfg.set(cfg.outputFolder, str(Path.cwd()), save=False)
from wavedl_gui.view.main_window import MainWindow

window = MainWindow()
app.processEvents()
assert window.projectInterface is not None
assert window.dashboardInterface is not None
assert not hasattr(window, "databaseThread")
assert not hasattr(window, "_wizard")
if preserve:
    assert database.read_bytes() == before
else:
    assert not database.exists()
window.onExit()
window.hide()
window.deleteLater()
QCoreApplication.sendPostedEvents(None, QEvent.Type.DeferredDelete)
assert not isValid(window)
app.processEvents()
if preserve:
    assert database.read_bytes() == before
else:
    assert not database.exists()
print("isolated actual MainWindow startup: no legacy database writes")
app.quit()
"""


@pytest.mark.parametrize("preserve", [False, True])
def test_actual_startup_neither_creates_nor_changes_legacy_database(tmp_path, preserve):
    pytest.importorskip("PySide6")
    pytest.importorskip("qfluentwidgets")
    environment = os.environ | {
        "QT_QPA_PLATFORM": "offscreen",
        "PYTHONPATH": str(GUI.parent),
        "PYTHONUNBUFFERED": "1",
        "PYTHONFAULTHANDLER": "1",
    }
    result = subprocess.run(
        [sys.executable, "-c", STARTUP.format(preserve=preserve)],
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "isolated actual MainWindow startup" in result.stdout
