"""Small executable contracts for mapped browser fixture primitives."""

import os
import shlex
from pathlib import Path

import pytest


pytestmark = pytest.mark.skipif(os.name == "nt", reason="POSIX bash fixture")


@pytest.fixture
def scheduler_type(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).parents[2] / "tools"))
    try:
        from browser_mapped_autoplot_fixture import CopyScheduler
    except ModuleNotFoundError as error:
        if (error.name or "").split(".", 1)[0] not in {"numpy", "uvicorn", "starlette"}:
            raise
        pytest.skip(f"optional fixture dependency unavailable: {error.name}")
    return CopyScheduler


def make_script(root, body):
    script = root / "runs/run-1/attempts/1/script.sh"
    script.parent.mkdir(parents=True)
    script.write_text(f"#!/bin/bash\nset -eu\n{body}\n")
    script.chmod(0o700)
    return script


def test_scheduler_executes_and_copies_marker(tmp_path, scheduler_type):
    host, compute = tmp_path / "host", tmp_path / "compute"
    host.mkdir()
    compute.mkdir()
    runtime = compute / "runs/run-1"
    script = make_script(
        host,
        f"cd {shlex.quote(str(runtime))}\n"
        "printf '%s' \"$SLURM_JOB_ID\" > runtime-marker.txt",
    )
    scheduler = scheduler_type(host, compute)
    scheduler.jobs["22000"] = {"request": "request-1", "state": "RUNNING", "exit": 0}
    scheduler.execute("22000", script)
    assert scheduler.jobs["22000"]["state"] == "COMPLETED"
    assert scheduler.results[0]["copiedRuntimePublication"] is True
    assert scheduler.results[0]["returncode"] == 0
    assert (runtime / "runtime-marker.txt").read_text() == "22000"
    assert (host / "runs/run-1/runtime-marker.txt").read_text() == "22000"
    assert not (host / "runtime-marker.txt").exists()
    assert scheduler.results[0]["requestId"] == "request-1"


def test_scheduler_nonzero_exit_is_not_completion(tmp_path, scheduler_type):
    host, compute = tmp_path / "host", tmp_path / "compute"
    host.mkdir()
    compute.mkdir()
    runtime = compute / "runs/run-1"
    script = make_script(
        host,
        f"cd {shlex.quote(str(runtime))}\nprintf failed > runtime-marker.txt\nexit 7",
    )
    scheduler = scheduler_type(host, compute)
    scheduler.jobs["22000"] = {"request": "request-2", "state": "RUNNING", "exit": 0}
    scheduler.execute("22000", script)
    assert scheduler.jobs["22000"]["state"] == "FAILED"
    assert scheduler.results[0]["returncode"] == 7
    assert scheduler.results[0]["copiedRuntimePublication"] is True
    assert (runtime / "runtime-marker.txt").read_text() == "failed"
    assert (host / "runs/run-1/runtime-marker.txt").read_text() == "failed"


def test_scheduler_requires_registered_request_comment(tmp_path, scheduler_type):
    host, compute = tmp_path / "host", tmp_path / "compute"
    host.mkdir()
    compute.mkdir()
    scheduler = scheduler_type(host, compute)
    with pytest.raises(StopIteration):
        scheduler.run(["sbatch", "script.sh"])
    assert scheduler.jobs == {}
    assert scheduler.results == []


def test_scheduler_scontrol_exposes_identity(tmp_path, scheduler_type):
    host, compute = tmp_path / "host", tmp_path / "compute"
    host.mkdir()
    compute.mkdir()
    scheduler = scheduler_type(host, compute)
    scheduler.jobs["22000"] = {"request": "request-3", "state": "COMPLETED", "exit": 0}
    result = scheduler.run(["scontrol", "show", "job", "22000"])
    text = result.stdout.decode()
    assert result.returncode == 0
    assert "JobId=22000" in text
    assert "Comment=request-3" in text
    assert "Cluster=test-cluster" in text
