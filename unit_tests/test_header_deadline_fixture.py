"""Focused real supervisor acceptance for the fixture-only HEADER seam."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest

from tools.browser_header_deadline_fixture import install
from wavedl.core.dataset_headers import InspectionRefused
from wavedl_daemon.execution.budget import WorkBudget
from wavedl_daemon.execution.pool import BoundedThreadPool
from wavedl_daemon.runs import inspection
from wavedl_daemon.runs.catalog import CatalogService


def test_real_child_deadline_reaped_before_slot_release_then_genuine_retry(tmp_path):
    """The actual supervised child expires; an actual parser retry succeeds."""
    np.savez(tmp_path / "samples.npz", X=np.zeros((96, 32)), y=np.zeros((96, 1)))
    (tmp_path / ".header-deadline-control").write_bytes(b"stall-once")
    with BoundedThreadPool(WorkBudget(max_workers=1, max_pending=0)) as pool:
        inspector = inspection.DatasetInspector(
            sys.executable,
            Path.cwd(),
            pool,
            catalog=CatalogService({"datasets": tmp_path}),
        )
        controlled = install(tmp_path, inspection.run_command, pool)
        with patch.object(inspection, "run_command", controlled):
            with pytest.raises(InspectionRefused):
                asyncio.run(inspector.inspect("datasets", "samples.npz"))
            assert pool.outstanding == 0
            result = asyncio.run(inspector.inspect("datasets", "samples.npz"))
            assert result["schema_version"] == 1
            assert [v["shape"] for v in result["variables"]] == [[96, 32], [96, 1]]
            assert pool.outstanding == 0
    records = [
        json.loads(line)
        for line in (tmp_path / ".header-deadline-commands.jsonl")
        .read_text()
        .splitlines()
    ]
    stall, retry = records
    assert stall["controlled"] and stall["timedOut"] and stall["pidAbsent"]
    assert stall["cancelled"] and stall["returncode"] < 0
    assert stall["elapsed"] >= 2
    assert stall["stdout"] == "owned-header-stall-child-ready\n"
    assert stall["poolOutstandingBeforeReturn"] == 1
    assert not retry["controlled"] and not retry["timedOut"] and retry["pidAbsent"]
    assert retry["returncode"] == 0
    assert retry["poolOutstandingBeforeReturn"] == 1
    assert stall["authorityIdentityPresent"] and retry["authorityIdentityPresent"]
    assert not (tmp_path / ".header-deadline-control").exists()
