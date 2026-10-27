"""The GUI console entry point is inert until called and keeps Qt launch args."""

import builtins
import os
import subprocess
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest


@pytest.mark.parametrize("mode", ["import", "help"])
def test_entrypoint_is_lightweight_outside_checkout(tmp_path, mode):
    script = r"""
import importlib.abc
import os
import sys

class NoOptionalImports(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, *args, **kwargs):
        if fullname.split(".")[0] in {"PySide6", "qfluentwidgets", "AppKit", "torch", "numpy", "scipy"}:
            raise AssertionError("Optional import on lightweight entry point: " + fullname)

sys.meta_path.insert(0, NoOptionalImports())
before = os.getcwd()
import wavedl_gui.main as entry
assert callable(entry.main)
assert os.getcwd() == before
assert not os.path.exists("AppData")
if MODE == "help":
    try:
        entry.main(["--help"])
    except SystemExit as error:
        assert error.code == 0
    else:
        raise AssertionError("Help did not exit")
assert os.getcwd() == before
assert not os.path.exists("AppData")
print("lightweight-entrypoint-ok")
"""
    environment = os.environ.copy()
    environment["PYTHONPATH"] = str(Path(__file__).resolve().parents[1] / "src")
    environment.pop("QT_QPA_PLATFORM", None)
    result = subprocess.run(
        [sys.executable, "-c", f"MODE = {mode!r}\n" + script],
        env=environment,
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "lightweight-entrypoint-ok" in result.stdout
    if mode == "help":
        assert "WaveDL daemon" in result.stdout
    assert not (tmp_path / "AppData").exists()


@pytest.mark.parametrize("scale", ["Auto", 1.5])
def test_main_launches_once_preserves_args_and_returns_event_loop_code(
    monkeypatch, tmp_path, scale
):
    import wavedl_gui.main as entry

    actions = []

    def module(name, **members):
        value = ModuleType(name)
        value.__dict__.update(members)
        monkeypatch.setitem(sys.modules, name, value)
        return value

    class Translator:
        def __init__(self, *args):
            actions.append(("translator", args))

        def load(self, *args):
            actions.append(("load", args))

    class Application:
        def __init__(self, args, key):
            actions.append(("application", args, key))
            self.aboutToQuit = SimpleNamespace(
                connect=lambda callback: actions.append(("connect", callback))
            )

        def setAttribute(self, value):
            actions.append(("attribute", value))

        def installTranslator(self, value):
            actions.append(("install", value))

        def exec(self):
            actions.append(("exec",))
            return 17

    class Window:
        def __init__(self):
            actions.append(("window",))

        def onExit(self):
            pass

        def show(self):
            actions.append(("show",))

    module("PySide6", __path__=[])
    module(
        "PySide6.QtCore",
        Qt=SimpleNamespace(AA_DontCreateNativeWidgetSiblings=42),
        QTranslator=Translator,
    )
    module("qfluentwidgets", FluentTranslator=Translator)
    resource = module("wavedl_gui.common.resource")
    module("wavedl_gui.common", __path__=[], resource=resource)
    module("wavedl_gui.common.application", SingletonApplication=Application)
    cfg = SimpleNamespace(dpiScale="dpi", language="locale")
    cfg.get = lambda item: scale if item == "dpi" else SimpleNamespace(value="en")
    module("wavedl_gui.common.config", cfg=cfg)
    module("wavedl_gui.view", __path__=[])
    module("wavedl_gui.view.main_window", MainWindow=Window)
    module(
        "AppKit",
        NSApplication=SimpleNamespace(
            sharedApplication=lambda: actions.append(("mac-application",))
        ),
    )
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("QT_ENABLE_HIGHDPI_SCALING", "unchanged")
    monkeypatch.setenv("QT_SCALE_FACTOR", "unchanged")
    monkeypatch.setattr(entry.os, "chdir", lambda path: actions.append(("chdir", path)))
    monkeypatch.setattr(sys, "argv", ["wavedl-gui", "ignored-global"])
    original_import = builtins.__import__

    def tracked_import(name, *args, **kwargs):
        if name == "wavedl_gui.common.config":
            actions.append(("config-import", Path.cwd()))
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", tracked_import)
    assert entry.main(["-platform", "offscreen", "/daemon/data.npz"]) == 17
    assert actions[:2] == [
        ("config-import", tmp_path),
        ("chdir", Path(entry.__file__).resolve().parent),
    ]
    assert (
        "application",
        ["wavedl-gui", "-platform", "offscreen", "/daemon/data.npz"],
        "WaveDL-GUI",
    ) in actions
    assert sum(action[0] == "application" for action in actions) == 1
    assert sum(action[0] == "window" for action in actions) == 1
    assert sum(action[0] == "connect" for action in actions) == 1
    assert actions[-2:] == [("show",), ("exec",)]
    assert not (tmp_path / "AppData").exists()
    assert os.environ["QT_SCALE_FACTOR"] == ("unchanged" if scale == "Auto" else "1.5")
    assert os.environ["QT_ENABLE_HIGHDPI_SCALING"] == (
        "unchanged" if scale == "Auto" else "0"
    )
