"""Daemon-suite collection policy and isolated process fixtures."""

import subprocess
import sys
from contextlib import contextmanager
from queue import Queue
from threading import Thread

import pytest


# ``pytest unit_tests/daemon --confcutdir=unit_tests/daemon`` intentionally
# prevents the repository-level conftest from loading. Keep the retired Qt
# wheel smoke out of that focused daemon invocation as well; the supported
# daemon/browser suite must remain dependency-light and runnable without Qt.
collect_ignore = ["test_installed_gui_http.py"]


@pytest.fixture
def paused_process():
    """Provide a bounded readiness handshake with deterministic cleanup."""

    @contextmanager
    def start(script, expected):
        process = subprocess.Popen(
            [sys.executable, "-c", script],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        ready = Queue()

        def read_ready():
            assert process.stdout is not None
            ready.put(process.stdout.readline().strip())

        reader = Thread(target=read_ready, daemon=True)
        reader.start()
        try:
            assert ready.get(timeout=10) == expected
            yield process
        finally:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=10)
            reader.join(timeout=2)
            process.communicate(timeout=2)
            if process.stdout is not None:
                process.stdout.close()
            if process.stderr is not None:
                process.stderr.close()

    return start
