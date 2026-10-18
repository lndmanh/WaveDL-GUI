"""Real preview phase children preserve fingerprint and supervised cancellation."""

import json
import os
import select
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest


pytestmark = pytest.mark.skipif(os.name == "nt", reason="POSIX phase-child fixture")


def test_readiness_is_invisible_until_complete_payload_is_closed(tmp_path, monkeypatch):
    from tools import browser_preview_fault_fixture as fixture

    partial = threading.Event()
    release = threading.Event()
    failures = []
    ready = tmp_path / ".preview-ready-5.json"
    argv = [sys.executable, "-m", "wavedl.core.dataset_preview"]

    def paused_dump(value, stream):
        encoded = json.dumps(value)
        stream.write(encoded[:1])
        stream.flush()
        partial.set()
        assert release.wait(timeout=5)
        stream.write(encoded[1:])

    def writer():
        try:
            fixture.publish_ready(tmp_path, 5, argv)
        except BaseException as error:
            failures.append(error)

    monkeypatch.setattr(fixture.json, "dump", paused_dump)
    thread = threading.Thread(target=writer)
    thread.start()
    try:
        assert partial.wait(timeout=5)
        assert not ready.exists()
    finally:
        release.set()
        thread.join(timeout=5)
    assert not thread.is_alive()
    assert not failures
    assert json.loads(ready.read_bytes()) == {
        "phase": 5,
        "pid": os.getpid(),
        "argv": argv,
    }
    assert sorted(tmp_path.iterdir()) == [ready]


def test_sigint_shutdown_preserves_services_closed_marker(tmp_path):
    """Uvicorn SIGINT replay must not mask completed fixture-service closure."""
    pytest.importorskip("numpy")
    pytest.importorskip("scipy")
    pytest.importorskip("h5py")
    pytest.importorskip("uvicorn")
    repo = Path(__file__).parents[2]
    process = subprocess.Popen(
        [
            sys.executable,
            str(repo / "tools/browser_preview_fault_fixture.py"),
            "--root",
            str(tmp_path),
        ],
        cwd=repo,
        env={**os.environ, "PYTHONPATH": str(repo / "src")},
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        deadline = time.monotonic() + 20
        ready = False
        while time.monotonic() < deadline and process.poll() is None:
            if select.select([process.stdout], [], [], 0.1)[0]:
                if process.stdout.readline().startswith("Browser:"):
                    ready = True
                    break
        assert ready, "Fixture did not become ready within its bounded startup"
        process.send_signal(signal.SIGINT)
        stdout, _ = process.communicate(timeout=20)
        assert "Fixture: services-closed" in stdout
        assert json.loads((tmp_path / ".preview-drained.json").read_bytes()) == {
            "outstanding": 0
        }
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=5)


@pytest.mark.parametrize("mode,phase", [("mutate", 1), ("cancel", 1), ("cancel", 5)])
def test_phase_child_identity_refusal_and_cancel_reap(tmp_path, mode, phase):
    np = pytest.importorskip("numpy")
    from wavedl_daemon.execution.budget import WorkBudget
    from wavedl_daemon.execution.commands import run_command
    from wavedl_daemon.execution.pool import BoundedThreadPool, WorkCancelled
    from wavedl_daemon.runs.preview_authority import PreviewAuthority
    from wavedl_daemon.supervision.base import ProcessSpec

    path = tmp_path / "samples.npz"
    np.savez(path, X=np.arange(24).reshape(6, 4), y=np.arange(6).reshape(6, 1))
    with PreviewAuthority({"datasets": tmp_path}).open_preview_selection(
        "datasets", "samples.npz"
    ) as selected:
        argv = [
            sys.executable,
            "-m",
            "wavedl.core.dataset_preview",
            "--path",
            str(path),
            "--expected-identity",
            json.dumps(selected.expected),
        ]
    fixture = Path(__file__).parents[2] / "tools/browser_preview_fault_fixture.py"
    environment = {**os.environ, "PYTHONPATH": str(Path(__file__).parents[2] / "src")}
    spec = ProcessSpec(
        (
            sys.executable,
            str(fixture),
            "--phase-child",
            str(tmp_path),
            str(phase),
            json.dumps(argv),
        ),
        tmp_path,
        environment,
    )
    budget = WorkBudget(timeout_seconds=10, max_output_bytes=2 * 1024 * 1024)
    observed = []

    def work(token):
        result = run_command(spec, budget, token=token)
        observed.append(result)
        return result

    with BoundedThreadPool(budget) as pool:
        handle = pool.submit(work)
        ready_path = tmp_path / f".preview-ready-{phase}.json"
        deadline = time.monotonic() + 5
        while not ready_path.is_file() and time.monotonic() < deadline:
            time.sleep(0.02)
        ready = json.loads(ready_path.read_bytes())
        assert ready["phase"] == phase
        assert ready["argv"] == argv
        os.kill(ready["pid"], 0)
        if mode == "mutate":
            with path.open("ab") as stream:
                stream.write(b"ordinary-file-mutation")
            (tmp_path / ".preview-release-1").write_text("release")
        else:
            handle.cancel()
        if mode == "cancel":
            with pytest.raises(WorkCancelled):
                handle.result(10)
            result = observed[0]
        else:
            result = handle.result(10)
        assert result.timed_out is False
        assert result.cancelled is (mode == "cancel")
        if mode == "mutate":
            assert result.returncode != 0
            assert json.loads(result.stdout)["code"] == "identity_changed"
        with pytest.raises(ProcessLookupError):
            os.kill(ready["pid"], 0)
        assert pool.outstanding == 0
        if phase == 5:
            retry = ProcessSpec(tuple(argv), tmp_path, environment)
            recovered = pool.submit(
                lambda token: run_command(retry, budget, token=token)
            ).result(10)
            assert recovered.returncode == 0
            assert recovered.cancelled is False
            summary = json.loads(recovered.stdout)
            assert summary["format"] == "npz"
            assert summary["input_shape"] == [6, 4]
            assert summary["output_shape"] == [6, 1]
            assert pool.outstanding == 0
