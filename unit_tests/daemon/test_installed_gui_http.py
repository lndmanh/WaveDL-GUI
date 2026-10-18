"""Installed-wheel Qt/public-HTTP CPU smoke acceptance.

This is intentionally separate from the source-tree GUI integration test.  The
test copies that scenario to a temporary directory, removes its source
``PYTHONPATH`` injection, and executes it with the installed wheel's Python.
Qt/ML dependencies are inherited from the host (the isolated resolver gate is
covered by ``test_installed_cli``); this test is skipped when that optional
stack is unavailable.

Set ``WAVEDL_REQUIRE_INSTALLED_GUI_SMOKE=1`` for an acceptance job that must fail
instead of skipping when optional dependencies are missing.
"""

import importlib.util
import os
from pathlib import Path

import pytest

from .test_installed_cli import build_installed, checked


# This module exercises the retired Qt desktop client. The supported product
# is the daemon/browser application, so keep the historical smoke available in
# the checkout without allowing an explicit path invocation to run it.
pytestmark = pytest.mark.skip(
    reason="retired Qt desktop smoke; daemon/browser product is headless"
)


@pytest.fixture(scope="module")
def installed_gui(tmp_path_factory):
    """Build a wheel in staging and install it with host GUI/ML dependencies."""

    if os.name != "posix":
        reason = "installed GUI watchdog cleanup requires owned POSIX sessions"
        if os.environ.get("WAVEDL_REQUIRE_INSTALLED_GUI_SMOKE") == "1":
            pytest.fail(reason)
        pytest.skip(reason)
    missing = [
        name
        for name in ("PySide6", "qfluentwidgets", "torch", "numpy", "uvicorn")
        if importlib.util.find_spec(name) is None
    ]
    if missing:
        reason = "installed Qt/CPU smoke requires host extras: " + ", ".join(missing)
        if os.environ.get("WAVEDL_REQUIRE_INSTALLED_GUI_SMOKE") == "1":
            pytest.fail(reason)
        pytest.skip(reason)
    return build_installed(tmp_path_factory)


def test_installed_gui_public_http_cpu_smoke(installed_gui, tmp_path):
    """Installed Qt workers train, test, and plot through the public daemon API."""

    outside, _venv, _binary, python, environment = installed_gui
    source = Path(__file__).resolve().parents[1] / "test_gui_daemon_http_integration.py"
    checkout = Path(__file__).resolve().parents[2]
    scenario = tmp_path / source.name
    content = source.read_text()
    needle = '        source = Path(__file__).resolve().parents[1] / "src"\n'
    assert content.count(needle) == 1
    content = content.replace(
        needle,
        "        import wavedl\n"
        "        installed_prefix = Path(sys.prefix).resolve()\n"
        "        assert Path(wavedl.__file__).resolve().is_relative_to(installed_prefix)\n"
        '        gui_spec = importlib.util.find_spec("wavedl_gui.common.config")\n'
        "        assert gui_spec and gui_spec.origin\n"
        "        assert Path(gui_spec.origin).resolve().is_relative_to(installed_prefix)\n"
        f"        checkout = Path({str(checkout)!r})\n"
        "        assert not any(Path(value).resolve().is_relative_to(checkout) for value in sys.path if value)\n"
        '        assert not os.environ.get("PYTHONPATH")\n',
    )
    assert '                "PYTHONPATH": str(source),\n' in content
    content = content.replace('                "PYTHONPATH": str(source),\n', "")
    content = content.replace(
        "    def spawn(*args, **kwargs):\n",
        "    owned_processes = []\n"
        "    owned_lock = threading.Lock()\n"
        "    stopping = threading.Event()\n"
        "    def cleanup_owned():\n"
        "        stopping.set()\n"
        "        with owned_lock:\n"
        "            for process in owned_processes:\n"
        "                if process.poll() is None:\n"
        "                    try:\n"
        "                        if os.getpgid(process.pid) == process.pid:\n"
        "                            os.killpg(process.pid, signal.SIGKILL)\n"
        "                        else:\n"
        "                            process.kill()\n"
        "                    except ProcessLookupError:\n"
        "                        pass\n"
        "            deadline = time.monotonic() + 5\n"
        "            for process in owned_processes:\n"
        "                try:\n"
        "                    process.wait(timeout=max(0.01, deadline-time.monotonic()))\n"
        "                except subprocess.TimeoutExpired:\n"
        "                    pass\n"
        "    def watchdog_exit():\n"
        "        cleanup_owned()\n"
        "        os._exit(124)\n"
        "    watchdog = threading.Timer(40, watchdog_exit)\n"
        "    watchdog.daemon = True\n"
        "    def spawn(*args, **kwargs):\n"
        '        child_env = kwargs.get("env", os.environ)\n'
        '        assert not child_env.get("PYTHONPATH")\n'
        f"        checkout = {str(checkout)!r}\n"
        "        assert checkout not in str(args)\n"
        '        assert checkout not in str(kwargs.get("args", ""))\n'
        '        assert checkout not in str(kwargs.get("cwd", ""))\n',
    )
    spawn_return = "        return original_spawn(*args, **kwargs)\n"
    assert content.count(spawn_return) == 1
    content = content.replace(
        spawn_return,
        "        with owned_lock:\n"
        "            if stopping.is_set():\n"
        '                raise RuntimeError("Installed smoke watchdog expired")\n'
        "            process = original_spawn(*args, **kwargs)\n"
        "            owned_processes.append(process)\n"
        "            return process\n",
    )
    content = content.replace(
        "    thread.start()\n", "    watchdog.start()\n    thread.start()\n"
    )
    content = content.replace(
        "    finally:\n        for worker in workers:\n",
        "    finally:\n        watchdog.cancel()\n        cleanup_owned()\n        for worker in workers:\n",
    )
    content = content.replace("import hashlib\n", "import hashlib\nimport os\n")
    content = content.replace("import hashlib\n", "import hashlib\nimport signal\n")
    content = content.replace(
        "import hashlib\n", "import hashlib\nimport importlib.util\n"
    )
    scenario.write_text(content)

    env = dict(environment)
    env.pop("PYTHONPATH", None)
    env.update(
        QT_QPA_PLATFORM="offscreen",
        MPLBACKEND="Agg",
        OMP_NUM_THREADS="1",
        MKL_NUM_THREADS="1",
    )
    env["PYTEST_DISABLE_PLUGIN_AUTOLOAD"] = "1"
    # The child watchdog retains actual Popen handles and kills/reaps live owned
    # POSIX runtime sessions at 40s, before checked's separate 60s outer deadline.
    output = checked(
        [
            str(python),
            "-c",
            "import subprocess,sys; "
            "p=subprocess.run([sys.executable,'-m','pytest',*sys.argv[1:]], "
            "stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True); "
            "print(p.stdout,file=sys.stderr if p.returncode else sys.stdout); "
            "sys.exit(p.returncode)",
            str(scenario),
            "--confcutdir",
            str(tmp_path),
            "--basetemp",
            str(tmp_path / "scenario-state"),
            "-o",
            "markers=integration: local CPU integration",
            "-q",
        ],
        cwd=outside,
        environment=env,
    )
    assert "1 passed" in output and "skipped" not in output, output
