"""Real bounded storage exhaustion must not silently skip in Linux CI."""

import subprocess
from pathlib import Path

import pytest
import yaml


WORKFLOW = (
    Path(__file__).resolve().parents[1] / ".github/workflows/daemon-foundations.yml"
)


def test_linux_tmpfs_acceptance_mount_is_bounded_and_always_cleaned():
    """Use an owned mount with kernel limits rather than filling runner storage."""
    workflow = yaml.safe_load(WORKFLOW.read_text())
    job = workflow["jobs"]["storage-enospc"]
    assert job["runs-on"] == "ubuntu-latest"
    assert job["strategy"]["matrix"]["python"] == ["3.11", "3.13"]
    assert job["timeout-minutes"] <= 10
    step = next(
        item
        for item in job["steps"]
        if "WAVEDL_TEST_EMPTY_TMPFS=" in item.get("run", "")
    )
    assert step["shell"] == "bash"
    assert not step.get("continue-on-error", False)
    command = step["run"]
    assert 'mktemp -d "$RUNNER_TEMP/wavedl-tmpfs.XXXXXX"' in command
    assert "trap cleanup EXIT" in command
    assert 'sudo umount "$tmpfs_root"' in command
    assert 'rmdir "$tmpfs_root"' in command
    assert (
        'sudo mount -t tmpfs -o "size=4m,mode=700,uid=$(id -u),gid=$(id -g)"' in command
    )
    assert "--junitxml=tmpfs-acceptance.xml" in command
    assert 'test -z "$(ls -A "$tmpfs_root")"' in command
    assert "rm -r" not in command
    assert "test_status=$?" in command
    assert "cleanup_status=0" in command
    assert 'exit "$test_status"' in command
    assert 'exit "$cleanup_status"' in command


def test_linux_tmpfs_report_guard_is_mandatory_and_triggered():
    """A skipped, missing or unsuccessful report must fail the required lane."""
    workflow = yaml.safe_load(WORKFLOW.read_text())
    job = workflow["jobs"]["storage-enospc"]
    step = next(
        item
        for item in job["steps"]
        if "python tools/verify_tmpfs_acceptance_report.py" in item.get("run", "")
    )
    assert step["if"] == "always()"
    assert not step.get("continue-on-error", False)
    assert (
        step["run"]
        == "python tools/verify_tmpfs_acceptance_report.py tmpfs-acceptance.xml"
    )
    assert any(
        "unit_tests/test_tmpfs_acceptance_report.py unit_tests/test_tmpfs_workflow.py"
        in item.get("run", "")
        for item in job["steps"]
    )
    triggers = workflow.get("on", workflow.get(True))
    for event in ("push", "pull_request"):
        assert "unit_tests/test_tmpfs_acceptance_report.py" in triggers[event]["paths"]
        assert "unit_tests/test_tmpfs_workflow.py" in triggers[event]["paths"]
        assert "unit_tests/daemon/**" in triggers[event]["paths"]
        assert "tools/**" in triggers[event]["paths"]


@pytest.mark.parametrize(
    ("test_status", "unmount_status", "directory_status", "expected"),
    [(0, 0, 0, 0), (7, 0, 0, 7), (0, 9, 0, 9), (0, 0, 4, 4), (7, 9, 4, 7)],
)
def test_tmpfs_cleanup_attempts_both_operations_and_preserves_failure(
    test_status, unmount_status, directory_status, expected
):
    """Exercise EXIT semantics with command doubles, never an actual mount."""
    workflow = yaml.safe_load(WORKFLOW.read_text())
    step = next(
        item
        for item in workflow["jobs"]["storage-enospc"]["steps"]
        if "WAVEDL_TEST_EMPTY_TMPFS=" in item.get("run", "")
    )
    command = step["run"]
    cleanup = command[command.index("cleanup() {") : command.index("trap cleanup EXIT")]
    script = (
        "set -e\n"
        "mounted=1\n"
        "tmpfs_root=unused-command-double\n"
        f"sudo() {{ echo unmount-attempted; return {unmount_status}; }}\n"
        f"rmdir() {{ echo directory-attempted; return {directory_status}; }}\n"
        f"{cleanup}\n"
        "trap cleanup EXIT\n"
        f"exit {test_status}\n"
    )
    result = subprocess.run(
        ["bash", "-c", script], capture_output=True, text=True, timeout=5, check=False
    )
    assert result.returncode == expected
    assert result.stdout.splitlines() == ["unmount-attempted", "directory-attempted"]
