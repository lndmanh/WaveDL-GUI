"""
Best-effort, bounded tee of supervised stdout and stderr.
Author: Ngo Duc Manh Le (manh@nnsvn.me)
"""

from __future__ import annotations

import logging
import os
import threading
from typing import TYPE_CHECKING


if TYPE_CHECKING:
    from pathlib import Path


OUTPUT_LOG_LIMIT = 64 * 1024 * 1024
OUTPUT_LOG_TRUNCATED = b"\n[WaveDL: output log truncated at its byte limit]\n"
_LOG = logging.getLogger(__name__)


class OutputLog:
    """A shared sink; its failure must never stop either pipe being drained."""

    def __init__(self, path: Path | None):
        self._lock = threading.Lock()
        self._fd: int | None = None
        self._size = 0
        if path is not None:
            try:
                # Attempt directories are exclusively claimed, owner-private
                # directories. Never follow or replace a preexisting file.
                self._fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            except OSError:
                _LOG.warning("Could not create trainer output log", exc_info=True)

    def write(self, chunk: bytes) -> None:
        with self._lock:
            if self._fd is None:
                return
            try:
                remaining = OUTPUT_LOG_LIMIT - self._size
                self._write(chunk[:remaining])
                self._size += min(len(chunk), remaining)
                if len(chunk) > remaining:
                    self._write(OUTPUT_LOG_TRUNCATED)
                    self._close()
            except OSError:
                _LOG.warning("Could not write trainer output log", exc_info=True)
                self._close()

    def _write(self, chunk: bytes) -> None:
        view = memoryview(chunk)
        while view and self._fd is not None:
            written = os.write(self._fd, view)
            if written <= 0:
                raise OSError("Output log write made no progress")
            view = view[written:]

    def _close(self) -> None:
        fd, self._fd = self._fd, None
        if fd is not None:
            try:
                os.close(fd)
            except OSError:
                _LOG.warning("Could not close trainer output log", exc_info=True)

    def close(self) -> None:
        with self._lock:
            self._close()
