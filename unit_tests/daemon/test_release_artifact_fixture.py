"""The release fixture never rebuilds an explicitly supplied wheel."""

import zipfile

import pytest

from . import test_installed_cli as acceptance


def test_explicit_release_wheel_is_copied_unchanged(tmp_path, monkeypatch):
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

    outside, *_rest = acceptance.build_installed(Factory(), wheelhouse=tmp_path)
    assert (outside / "wheels" / wheel.name).read_bytes() == wheel.read_bytes()
    assert not (outside / "source").exists()
    assert not any("wheel" in argv for argv in calls)
    assert "--system-site-packages" not in calls[0]
    assert "timeout" not in options[0]
    assert options[1]["timeout"] == 180
    assert f"{outside / 'wheels' / wheel.name}[daemon]" in calls[1]


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


def test_acceptance_timeout_defaults_to_60_and_is_bounded(monkeypatch, tmp_path):
    captured = []

    class Process:
        returncode = 0

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def communicate(self, *, timeout):
            captured.append(timeout)
            return "ok", ""

    monkeypatch.setattr(acceptance.subprocess, "Popen", lambda *_a, **_k: Process())
    monkeypatch.delenv("WAVEDL_ACCEPTANCE_TIMEOUT", raising=False)
    acceptance.checked(["probe"], cwd=tmp_path, environment={})
    monkeypatch.setenv("WAVEDL_ACCEPTANCE_TIMEOUT", "180")
    acceptance.checked(["probe"], cwd=tmp_path, environment={})
    assert captured == [60, 180]
    monkeypatch.setenv("WAVEDL_ACCEPTANCE_TIMEOUT", "301")
    with pytest.raises(ValueError):
        acceptance.checked(["false"], cwd=tmp_path, environment={})
