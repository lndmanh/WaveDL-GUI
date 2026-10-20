"""The release fixture never rebuilds an explicitly supplied wheel."""

import zipfile
from types import SimpleNamespace

import pytest

from wavedl_daemon.supervision.base import ProcessResult

from . import test_installed_cli as acceptance


@pytest.mark.parametrize("resolved", [False, True])
def test_explicit_release_wheel_is_copied_unchanged(tmp_path, monkeypatch, resolved):
    wheel = tmp_path / "wavedl-1.0.0-py3-none-any.whl"
    with zipfile.ZipFile(wheel, "w") as archive:
        for name in (
            "wavedl/core/client_transport.py",
            "wavedl/distributed_launch.py",
            "wavedl/launcher.py",
            "wavedl/runtime.py",
            "wavedl/train.py",
            "wavedl_daemon/runs/catalog.py",
            "wavedl_daemon/runs/model_metadata.py",
        ):
            archive.writestr(name, b"# exact release bytes\n")
        archive.writestr("wavedl-1.0.0.dist-info/METADATA", "Version: 1.0.0\n")
        archive.writestr(
            "wavedl-1.0.0.dist-info/entry_points.txt",
            "[console_scripts]\nwavedl = wavedl.client:main\n",
        )
    monkeypatch.setenv("WAVEDL_ACCEPTANCE_WHEEL", str(wheel))
    calls = []
    options = []

    def capture(argv, **kwargs):
        calls.append(argv)
        options.append(kwargs)

    monkeypatch.setattr(acceptance, "checked", capture)

    class Factory:
        def mktemp(self, _name):
            outside = tmp_path / "outside"
            outside.mkdir()
            return outside

    outside, _venv, _binary, python, _environment = acceptance.build_installed(
        Factory(), wheelhouse=tmp_path if resolved else None
    )
    assert (outside / "wheels" / wheel.name).read_bytes() == wheel.read_bytes()
    assert not (outside / "source").exists()
    assert not any("wheel" in argv for argv in calls)
    assert ("--system-site-packages" not in calls[0]) is resolved
    assert "timeout" not in options[0]
    assert options[1]["timeout"] == (300 if resolved else 180)
    assert options[1]["pip_diagnostic"] is resolved
    # Dependency replacement is allowed only inside this freshly owned venv,
    # never the ambient build/runtime interpreter or inherited site packages.
    assert calls[1][0] == str(python)
    assert python.is_relative_to(outside / "venv")
    assert options[1]["cwd"] == outside
    assert "--no-index" in calls[1]
    assert ("--ignore-installed" not in calls[1]) is resolved
    if resolved:
        assert "--no-deps" not in calls[1]
        assert "--only-binary=:all:" in calls[1]
        assert calls[1][calls[1].index("--find-links") + 1] == str(tmp_path)
        assert f"{outside / 'wheels' / wheel.name}[daemon]" in calls[1]
    else:
        assert "--no-deps" in calls[1]
        assert str(outside / "wheels" / wheel.name) in calls[1]


def test_missing_explicit_wheel_fails_without_rebuilding(tmp_path, monkeypatch):
    monkeypatch.setenv("WAVEDL_ACCEPTANCE_WHEEL", str(tmp_path / "missing.whl"))
    monkeypatch.setattr(
        acceptance, "checked", lambda *_args, **_kwargs: pytest.fail("must not build")
    )

    class Factory:
        def mktemp(self, _name):
            outside = tmp_path / "outside"
            outside.mkdir()
            return outside

    with pytest.raises(AssertionError):
        acceptance.build_installed(Factory())


@pytest.mark.parametrize("platform", ["posix", "nt"])
def test_acceptance_timeout_defaults_to_60_and_is_bounded(
    monkeypatch, tmp_path, platform
):
    captured = []
    cleanup = []
    starts = []

    class Process:
        returncode = 0

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def communicate(self, *, timeout):
            captured.append(timeout)
            return "ok", ""

        def wait(self, timeout=None):
            if timeout is not None:
                captured.append(timeout)
            else:
                cleanup.append("wait")
            return ProcessResult(returncode=0, stdout=b"ok", stderr=b"")

        def cancel(self, *, grace_seconds):
            cleanup.append(("cancel", grace_seconds))

    def native(argv, cwd, environment):
        assert platform == "nt"
        starts.append((argv, cwd, environment))
        return Process()

    def posix(argv, **kwargs):
        assert platform == "posix"
        starts.append((argv, kwargs["cwd"], kwargs["env"]))
        return Process()

    monkeypatch.setattr(
        acceptance,
        "os",
        SimpleNamespace(name=platform, environ=acceptance.os.environ),
    )
    monkeypatch.setattr(acceptance, "_start_windows_installed", native)
    monkeypatch.setattr(acceptance.subprocess, "Popen", posix)
    monkeypatch.delenv("WAVEDL_ACCEPTANCE_TIMEOUT", raising=False)
    assert acceptance.checked(["probe"], cwd=tmp_path, environment={}) == "ok"
    monkeypatch.setenv("WAVEDL_ACCEPTANCE_TIMEOUT", "180")
    assert acceptance.checked(["probe"], cwd=tmp_path, environment={}) == "ok"
    assert captured == [60, 180]
    assert starts == [(["probe"], tmp_path, {})] * 2
    assert cleanup == ([("cancel", 0), "wait"] * 2 if platform == "nt" else [])
    for invalid in ("0", "301"):
        monkeypatch.setenv("WAVEDL_ACCEPTANCE_TIMEOUT", invalid)
        with pytest.raises(ValueError):
            acceptance.checked(["false"], cwd=tmp_path, environment={})
    assert len(starts) == 2, "Invalid budgets must fail before any process spawn"
