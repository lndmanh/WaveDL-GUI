"""
Resolve persisted attempt output and read bounded, UTF-8-aligned byte windows.
Author: Ngo Duc Manh Le (manh@nnsvn.me)
"""

from __future__ import annotations

import codecs
import os
from dataclasses import dataclass
from typing import TYPE_CHECKING, BinaryIO

from wavedl_daemon import paths
from wavedl_daemon.runs.lifecycle import Ended, Live
from wavedl_daemon.runs.model import BackendKind, RunId, SlurmHandle


if TYPE_CHECKING:
    from pathlib import Path

    from wavedl_daemon.runs.service import RunService


OUTPUT_CHUNK_BYTES = 64 * 1024
MAX_OUTPUT_OFFSET = 2**63 - 1


@dataclass(frozen=True)
class OutputSource:
    attempt: int
    root: Path
    parts: tuple[str, ...] | None
    sealed: bool = False


@dataclass(frozen=True)
class OutputChunk:
    attempt: int
    offset: int
    next_offset: int
    size: int
    text: str
    eof: bool


def resolve_output(
    service: RunService, run_id: str, attempt: int | None = None
) -> OutputSource:
    """Runs on the lifecycle owner, before file work goes to the I/O pool."""
    layout = service.layout(run_id)
    identity = RunId(run_id)
    head = service.log.head(identity)
    number = attempt if attempt is not None else (1 if head is None else head.attempt)
    if type(number) is not int or not 1 <= number <= MAX_OUTPUT_OFFSET:
        raise ValueError("Invalid output attempt")
    sealed = head is not None and isinstance(head.stage, Ended)
    if head is None or head.ref.backend == BackendKind.LOCAL:
        return OutputSource(
            number, layout.run_dir, ("attempts", str(number), "output.log"), sealed
        )

    handle = None
    # Slurm attempts are requeues of one job, not fresh submissions. The fold
    # retains that same stored handle across every attempt (including Ended).
    if number <= head.attempt and isinstance(head.stage, (Live, Ended)):
        handle = head.stage.handle
    if (
        isinstance(handle, SlurmHandle)
        and handle.job_id.isascii()
        and handle.job_id.isdecimal()
    ):
        return OutputSource(
            number, layout.run_dir, ("logs", f"slurm-{handle.job_id}.out"), sealed
        )
    return OutputSource(number, layout.run_dir, None)


def _aligned_start(stream: BinaryIO, offset: int, size: int) -> int:
    """Skip a character only when the requested offset is inside valid UTF-8."""
    beginning = max(0, offset - 3)
    stream.seek(beginning)
    nearby = stream.read(min(size - beginning, offset - beginning + 3))
    for index in range(offset - beginning):
        first = nearby[index]
        if 0xC2 <= first <= 0xDF:
            length = 2
        elif 0xE0 <= first <= 0xEF:
            length = 3
        elif 0xF0 <= first <= 0xF4:
            length = 4
        else:
            continue
        if not beginning + index < offset < beginning + index + length:
            continue
        candidate = nearby[index : index + length]
        try:
            candidate.decode("utf-8")
        except UnicodeDecodeError:
            continue
        return beginning + index + length
    return offset


def read_output(source: OutputSource, offset: int | None = None) -> OutputChunk:
    """File access is bounded and belongs on a blocking worker, not the loop."""
    if offset is not None and (
        type(offset) is not int or not 0 <= offset <= MAX_OUTPUT_OFFSET
    ):
        raise ValueError("Invalid output offset")
    empty = OutputChunk(source.attempt, 0, 0, 0, "", True)
    if source.parts is None:
        return empty
    try:
        location = paths.inside(source.root, source.parts)
        stream = paths.open_regular(location)
    except FileNotFoundError:
        return empty
    with stream:
        size = os.fstat(stream.fileno()).st_size
        start = (
            max(0, size - OUTPUT_CHUNK_BYTES) if offset is None else min(offset, size)
        )
        start = _aligned_start(stream, start, size)
        stream.seek(start)
        chunk = stream.read(min(OUTPUT_CHUNK_BYTES, size - start))
        decoder = codecs.getincrementaldecoder("utf-8")("replace")
        # A live writer may be halfway through one UTF-8 character. Retain its
        # prefix in the byte cursor until the next poll, rather than lose it.
        text = decoder.decode(chunk, final=source.sealed and start + len(chunk) == size)
        pending, _ = decoder.getstate()
        end = start + len(chunk) - len(pending)
        return OutputChunk(source.attempt, start, end, size, text, end >= size)
