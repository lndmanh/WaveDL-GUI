"""
Supervised preview jobs with short polling requests and a small completed-result LRU.
Author: Ngo Duc Manh Le (manh@nnsvn.me)
"""

from __future__ import annotations

import asyncio
import json
from collections import OrderedDict
from dataclasses import replace
from pathlib import Path
from time import monotonic

from wavedl_daemon.execution.budget import BudgetExhausted
from wavedl_daemon.execution.commands import run_command
from wavedl_daemon.paths import file_identity
from wavedl_daemon.runs.catalog import BrowseForbidden, BrowseMissing
from wavedl_daemon.runs.dataset_preview import PickleRequired, PreviewRefused
from wavedl_daemon.supervision.base import ProcessSpec


class DatasetPreviewService:
    """Jobs belong to the hosted owner loop, not an individual HTTP request."""

    def __init__(self, python: str, cwd: Path, pool, catalog, *, wait_seconds=15.0):
        if not Path(python).is_absolute() or "\0" in python:
            raise ValueError("Preview requires a server-selected absolute interpreter")
        self.python, self.cwd, self.pool, self.catalog = (
            python,
            Path(cwd),
            pool,
            catalog,
        )
        self.wait_seconds = wait_seconds
        self._jobs = {}
        self._cache = OrderedDict()
        self._failures = OrderedDict()

    def _selection(self, request):
        try:
            selected = self.catalog.resolve(request["root"], request["path"])
            if selected["kind"] != "file":
                raise PreviewRefused("Choose a dataset file")
            path = Path(selected["path"]).resolve()
            info = path.stat()
            return path, (
                str(path),
                *file_identity(info).values(),
                request["allow_pickle"],
            )
        except (BrowseForbidden, BrowseMissing, OSError, ValueError):
            raise PreviewRefused("Could not read this dataset") from None

    async def preview(self, request: dict) -> dict:
        path, key = await self.pool.submit(
            lambda token: self._selection(request)
        ).wait()
        now = monotonic()
        for failed_key, (expiry, _) in list(self._failures.items()):
            if expiry <= now:
                self._failures.pop(failed_key)
        failure = self._failures.pop(key, None)
        if failure is not None:
            failure[1].result()
        if key in self._cache:
            self._cache.move_to_end(key)
            value = self._cache[key]
        else:
            task = self._jobs.get(key)
            if task is None:
                if len(self._jobs) >= 2:
                    raise BudgetExhausted("Dataset preview is busy")
                task = asyncio.create_task(self._run(path, request["allow_pickle"]))
                self._jobs[key] = task
                task.add_done_callback(lambda done: self._complete(key, done))
            done, _ = await asyncio.wait({task}, timeout=self.wait_seconds)
            if not done:
                return {"status": "pending"}
            failure = self._failures.get(key)
            if failure is not None and failure[1] is task:
                self._failures.pop(key)
            value = task.result()
        return {
            **value,
            "selection": {"root": request["root"], "path": request["path"]},
        }

    def _complete(self, key, task):
        self._jobs.pop(key, None)
        if task.cancelled():
            return
        error = task.exception()
        if error is not None:
            # A poll that already returned pending must still observe this failure.
            self._failures[key] = (monotonic() + 30, task)
            while len(self._failures) > 8:
                self._failures.popitem(last=False)
        else:
            self._cache[key] = task.result()
            while len(self._cache) > 8:
                self._cache.popitem(last=False)

    async def _run(self, path, allow_pickle):
        def work(token):
            argv = [
                self.python,
                "-I",
                "-m",
                "wavedl_daemon.runs.dataset_preview_worker",
                "--path",
                str(path),
            ]
            if allow_pickle:
                argv.append("--allow-pickle")
            budget = replace(
                self.pool.budget, timeout_seconds=600, max_output_bytes=4 * 1024 * 1024
            )
            result = run_command(
                ProcessSpec(tuple(argv), self.cwd), budget, token=token
            )
            if result.timed_out or result.cancelled or result.stdout_truncated:
                raise BudgetExhausted("Dataset preview timed out or is unavailable")
            try:
                value = json.loads(result.stdout)
            except ValueError:
                raise BudgetExhausted("Dataset preview worker is unavailable") from None
            if result.returncode:
                if value.get("status") == 409:
                    raise PickleRequired("Dataset contains pickled arrays")
                raise PreviewRefused("Could not preview this dataset")
            return value

        handle = self.pool.submit(work, timeout_seconds=600)
        try:
            return await handle.wait()
        except asyncio.CancelledError:
            handle.cancel()
            await asyncio.gather(handle.wait(), return_exceptions=True)
            raise

    async def close(self):
        tasks = list(self._jobs.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self._cache.clear()
        self._failures.clear()
