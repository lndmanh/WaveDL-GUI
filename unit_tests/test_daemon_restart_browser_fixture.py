from dataclasses import replace
from pathlib import Path

import psutil
import pytest

from tools.daemon_restart_browser_fixture import ProcessFingerprint, _matches


class ObservedProcess:
    """Read-only process observations; this double cannot send signals."""

    pid = 731

    def is_running(self):
        return True

    def create_time(self):
        return 123.5

    def cmdline(self):
        return ["python", "owned.py"]

    def cwd(self):
        return "/private/tmp/owned-fixture/runs/one"

    def environ(self):
        return {"BROWSER_RESTART_FIXTURE_TAG": "unique-tag"}


def owned_fingerprint():
    return ProcessFingerprint(
        731,
        123.5,
        ("python", "owned.py"),
        "/private/tmp/owned-fixture/runs/one",
        "/private/tmp/owned-fixture/runs",
        "unique-tag",
    )


def test_complete_observed_identity_matches():
    assert _matches(ObservedProcess(), owned_fingerprint())


@pytest.mark.parametrize(
    "change",
    [
        {"pid": 732},
        {"create_time": 123.6},
        {"argv": ("python", "foreign.py")},
        {"cwd": "/tmp/foreign"},
        {"run_root": "/tmp/foreign"},
        {"tag": "foreign-tag"},
    ],
)
def test_every_ownership_field_is_required(change):
    assert not _matches(ObservedProcess(), replace(owned_fingerprint(), **change))


def test_unavailable_environment_fails_closed():
    class Inaccessible(ObservedProcess):
        def environ(self):
            raise psutil.AccessDenied(self.pid)

    assert not _matches(Inaccessible(), owned_fingerprint())


def test_fingerprint_rejects_pid_reuse_or_foreign_cwd(tmp_path: Path):
    process = psutil.Process()
    expected = ProcessFingerprint(
        process.pid,
        process.create_time(),
        tuple(process.cmdline()),
        str(tmp_path / "foreign"),
        str(tmp_path),
        "fixture-tag",
    )
    assert not _matches(process, expected)


@pytest.mark.parametrize("bad", [0, -1])
def test_cleanup_requires_positive_grace(bad):
    from tools.daemon_restart_browser_fixture import terminate_owned

    with pytest.raises(ValueError):
        terminate_owned([], grace_seconds=bad)
