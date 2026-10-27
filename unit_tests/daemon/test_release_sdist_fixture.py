"""Exact source-distribution acceptance never falls back to checkout source."""

import io
import tarfile
import zipfile

import pytest

from . import test_installed_cli as acceptance


MODULES = (
    "wavedl/core/client_transport.py",
    "wavedl/distributed_launch.py",
    "wavedl/launcher.py",
    "wavedl/runtime.py",
    "wavedl/train.py",
    "wavedl_daemon/runs/catalog.py",
    "wavedl_daemon/runs/model_metadata.py",
)
ASSETS = {
    name: name.encode()
    for name in (
        "index.html",
        ".wavedl-assets.json",
        "_nuxt/lazy.js",
    )
}


def make_sdist(path):
    with tarfile.open(path, "w:gz") as archive:
        files = {
            "PKG-INFO": b"Version: 1.0.0\n",
            "pyproject.toml": b'[project.scripts]\nwavedl = "wavedl.client:main"\n',
            "src/wavedl_daemon/runs/model_metadata.py": b"# metadata\n",
        }
        files.update(
            {f"src/wavedl_daemon/web_assets/{k}": v for k, v in ASSETS.items()}
        )
        for name, content in files.items():
            entry = tarfile.TarInfo(f"wavedl-1.0.0/{name}")
            entry.size = len(content)
            archive.addfile(entry, io.BytesIO(content))


def make_wheel(path, *, fault=None):
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(
            "wavedl-1.0.0.dist-info/METADATA",
            f"Version: {'2.0.0' if fault == 'version' else '1.0.0'}\n",
        )
        archive.writestr(
            "wavedl-1.0.0.dist-info/entry_points.txt",
            "[console_scripts]\nwavedl = wavedl.client:main\n",
        )
        for name in MODULES:
            archive.writestr(name, b"# module\n")
        for name, content in ASSETS.items():
            if fault == "missing" and name == "_nuxt/lazy.js":
                continue
            archive.writestr(
                f"wavedl_daemon/web_assets/{name}",
                b"changed" if fault == "bytes" else content,
            )
        if fault == "extra":
            archive.writestr("wavedl_daemon/web_assets/extra.js", b"extra")


def factory(tmp_path):
    class Factory:
        def mktemp(self, _name):
            outside = tmp_path / "outside"
            outside.mkdir()
            return outside

    return Factory()


@pytest.mark.parametrize("fault", [None, "version", "missing", "bytes", "extra"])
def test_exact_tar_rebuild_preserves_version_assets_and_isolation(
    tmp_path, monkeypatch, fault
):
    source = tmp_path / "wavedl-1.0.0.tar.gz"
    make_sdist(source)
    original = source.read_bytes()
    monkeypatch.delenv("WAVEDL_ACCEPTANCE_WHEEL", raising=False)
    monkeypatch.setenv("WAVEDL_ACCEPTANCE_SDIST", str(source))
    monkeypatch.setenv("PIP_INDEX_URL", "https://unwanted.invalid")
    calls = []

    def capture(argv, **kwargs):
        calls.append((argv, kwargs))
        if "wheel" in argv and "--wheel-dir" in argv:
            make_wheel(
                tmp_path / "outside/wheels/wavedl-1.0.0-py3-none-any.whl", fault=fault
            )

    monkeypatch.setattr(acceptance, "checked", capture)
    if fault:
        with pytest.raises(AssertionError, match="Sdist rebuild changed"):
            acceptance.build_installed(factory(tmp_path), wheelhouse=tmp_path)
    else:
        outside, *_rest = acceptance.build_installed(
            factory(tmp_path), wheelhouse=tmp_path
        )
        assert (outside / source.name).read_bytes() == original
        assert not (outside / "source").exists()
        assert all("--system-site-packages" not in argv for argv, _ in calls)
        assert all(
            "PIP_INDEX_URL" not in options["environment"] for _, options in calls
        )
        build, options = next(
            (argv, options) for argv, options in calls if "--wheel-dir" in argv
        )
        assert build[0] == str(
            outside
            / "build-venv"
            / ("Scripts/python.exe" if acceptance.os.name == "nt" else "bin/python")
        )
        assert str(outside / source.name) in build
        assert {"--no-index", "--no-build-isolation", "--no-deps"} <= set(build)
        assert options["timeout"] == 180
        assert any("setuptools>=83.0.0,<85" in argv for argv, _ in calls)
    assert source.read_bytes() == original


@pytest.mark.parametrize("fault", ["missing", "malformed", "conflict", "no_wheelhouse"])
def test_invalid_explicit_sdist_fails_without_checkout_fallback(
    tmp_path, monkeypatch, fault
):
    source = tmp_path / "wavedl-1.0.0.tar.gz"
    if fault != "missing":
        if fault == "malformed":
            source.write_bytes(b"not a tar")
        else:
            make_sdist(source)
    monkeypatch.setenv("WAVEDL_ACCEPTANCE_SDIST", str(source))
    monkeypatch.delenv("WAVEDL_ACCEPTANCE_WHEEL", raising=False)
    if fault == "conflict":
        monkeypatch.setenv("WAVEDL_ACCEPTANCE_WHEEL", "some.whl")
    monkeypatch.setattr(
        acceptance, "checked", lambda *_a, **_k: pytest.fail("must not invoke build")
    )
    with pytest.raises((AssertionError, tarfile.ReadError)):
        acceptance.build_installed(
            factory(tmp_path), wheelhouse=None if fault == "no_wheelhouse" else tmp_path
        )


@pytest.mark.parametrize("fault", ["module", "dependency", "extra", "entrypoint"])
def test_wheel_acceptance_rejects_retired_qt_surfaces(tmp_path, fault):
    wheel = tmp_path / "wavedl-1.0.0-py3-none-any.whl"
    with zipfile.ZipFile(wheel, "w") as archive:
        metadata = "Version: 1.0.0\n"
        scripts = "[console_scripts]\nwavedl = wavedl.client:main\n"
        if fault == "module":
            archive.writestr("wavedl_gui/main.py", b"# must not ship\n")
        elif fault == "dependency":
            metadata += "Requires-Dist: PySide6>=6.6\n"
        elif fault == "extra":
            metadata += "Provides-Extra: gui\n"
        else:
            scripts += "wavedl-gui = wavedl_gui.main:main\n"
        archive.writestr("wavedl-1.0.0.dist-info/METADATA", metadata)
        archive.writestr("wavedl-1.0.0.dist-info/entry_points.txt", scripts)
    with pytest.raises(AssertionError):
        acceptance.assert_no_qt_wheel(wheel)


def test_sdist_acceptance_rejects_retained_qt_source(tmp_path):
    source = tmp_path / "wavedl-1.0.0.tar.gz"
    with tarfile.open(source, "w:gz") as archive:
        entry = tarfile.TarInfo("wavedl-1.0.0/src/wavedl_gui/main.py")
        entry.size = 1
        archive.addfile(entry, io.BytesIO(b"#"))
    with pytest.raises(AssertionError, match="retired Qt application"):
        acceptance.sdist_inventory(source)
