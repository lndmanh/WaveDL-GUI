"""Static packaging refuses unowned output and retains recoverable builds."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest


def vendor(tmp_path, monkeypatch):
    source = tmp_path / "public"
    source.mkdir()
    for name in ("index.html", "sw.js", "manifest.webmanifest"):
        (source / name).write_text(name)
    spec = importlib.util.spec_from_file_location(
        "vendor_web_assets", Path(__file__).parents[2] / "tools/vendor_web_assets.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "SOURCE", source)
    monkeypatch.setattr(module, "TARGET", tmp_path / "web_assets")
    monkeypatch.setattr(module, "WORK_AREA", tmp_path / "backups")
    (source / "_nuxt").mkdir()
    (source / "_nuxt/oaoxtviz.js").write_text("generated chunk")
    (source / "_nuxt/ordinary.js").write_text("public file")
    (source / "sw.js").write_text(
        "const precache = "
        + json.dumps(
            [
                {"revision": "shell", "url": "/"},
                {"revision": "manifest", "url": "manifest.webmanifest"},
                {"revision": None, "url": "_nuxt/oaoxtviz.js"},
                {"revision": "ordinary", "url": "_nuxt/ordinary.js"},
            ],
            separators=(",", ":"),
        )
        + ";"
    )
    manifest = tmp_path / "client.manifest.mjs"
    manifest.write_text('export default {"entry": {"file": "oaoxtviz.js"}};')
    monkeypatch.setattr(module, "CLIENT_MANIFEST", manifest)
    return module


def test_packages_exact_manifest(tmp_path, monkeypatch):
    module = vendor(tmp_path, monkeypatch)
    module.main()
    assert json.loads(
        (module.TARGET / module.MANIFEST).read_text()
    ) == module.inventory(module.TARGET, managed=True)
    marker = json.loads((module.TARGET / module.IMMUTABLE).read_text())
    assert marker == {"version": 1, "paths": ["_nuxt/oaoxtviz.js"]}


def test_replacement_retains_previous_build(tmp_path, monkeypatch):
    module = vendor(tmp_path, monkeypatch)
    module.main()
    previous_worker = (module.SOURCE / "sw.js").read_text()
    new_worker = previous_worker + "\n// new worker"
    (module.SOURCE / "sw.js").write_text(new_worker)
    module.main()
    backups = list(module.WORK_AREA.glob("backup-*"))
    assert len(backups) == 1
    assert (backups[0] / "sw.js").read_text() == previous_worker
    assert (module.TARGET / "sw.js").read_text() == new_worker


def test_refuses_modified_previous_build(tmp_path, monkeypatch):
    module = vendor(tmp_path, monkeypatch)
    module.main()
    (module.TARGET / "sw.js").write_text("manual edit")
    with pytest.raises(ValueError, match="differ"):
        module.main()
    assert (module.TARGET / "sw.js").read_text() == "manual edit"


def test_refuses_unmanaged_previous_build(tmp_path, monkeypatch):
    module = vendor(tmp_path, monkeypatch)
    module.TARGET.mkdir()
    for name in ("index.html", "sw.js", "manifest.webmanifest"):
        (module.TARGET / name).write_text(name)
    with pytest.raises(ValueError, match="unmanaged"):
        module.main()


@pytest.mark.parametrize("name", ["linked.js", "linked-dir"])
def test_refuses_symlinks(tmp_path, monkeypatch, name):
    module = vendor(tmp_path, monkeypatch)
    target = tmp_path / "outside"
    target.mkdir()
    (module.SOURCE / name).symlink_to(target)
    with pytest.raises(ValueError, match="Symlink"):
        module.main()
    assert not module.TARGET.exists()


def test_refuses_backend_output(tmp_path, monkeypatch):
    module = vendor(tmp_path, monkeypatch)
    (module.SOURCE / "api").mkdir()
    (module.SOURCE / "api" / "health.json").write_text("{}")
    with pytest.raises(ValueError, match="Backend"):
        module.main()


def test_refuses_incomplete_build(tmp_path, monkeypatch):
    module = vendor(tmp_path, monkeypatch)
    (module.SOURCE / "sw.js").unlink()
    with pytest.raises(ValueError, match="Expected generated"):
        module.main()


def test_refuses_build_secrets(tmp_path, monkeypatch):
    module = vendor(tmp_path, monkeypatch)
    (module.SOURCE / ".env").write_text("secret")
    with pytest.raises(ValueError, match="Unexpected static"):
        module.main()


@pytest.mark.parametrize("name", [".wavedl-assets.json", ".wavedl-immutable.json"])
def test_refuses_source_packaging_metadata(tmp_path, monkeypatch, name):
    module = vendor(tmp_path, monkeypatch)
    (module.SOURCE / name).write_text("{}")
    with pytest.raises(ValueError, match="Unexpected static"):
        module.main()
    assert not module.TARGET.exists()


def test_refuses_modified_previous_metadata(tmp_path, monkeypatch):
    module = vendor(tmp_path, monkeypatch)
    module.main()
    (module.TARGET / module.IMMUTABLE).write_text("manual edit")
    with pytest.raises(ValueError, match="differ"):
        module.main()


def test_missing_manifest_asset_preserves_previous_build(tmp_path, monkeypatch):
    module = vendor(tmp_path, monkeypatch)
    module.main()
    (module.SOURCE / "_nuxt/oaoxtviz.js").unlink()
    with pytest.raises(ValueError, match="Generated client asset is missing"):
        module.main()
    assert (module.TARGET / "_nuxt/oaoxtviz.js").read_text() == "generated chunk"


def test_failed_replacement_restores_previous_build(tmp_path, monkeypatch):
    module = vendor(tmp_path, monkeypatch)
    module.main()
    original_worker = (module.SOURCE / "sw.js").read_text()
    original = module.os.replace

    def fail_stage(source, destination):
        if Path(source).name.startswith("stage-"):
            raise OSError("replacement failed")
        original(source, destination)

    monkeypatch.setattr(module.os, "replace", fail_stage)
    (module.SOURCE / "sw.js").write_text(original_worker + "\n// new worker")
    with pytest.raises(OSError, match="replacement failed"):
        module.main()
    assert (module.TARGET / "sw.js").read_text() == original_worker
    assert json.loads(
        (module.TARGET / module.MANIFEST).read_text()
    ) == module.inventory(module.TARGET, managed=True)


def test_refuses_duplicate_producer_manifest_keys(tmp_path, monkeypatch):
    module = vendor(tmp_path, monkeypatch)
    monkeypatch.setattr(
        module.subprocess,
        "run",
        lambda *_args, **_kwargs: SimpleNamespace(
            stdout='{"entry":{"file":"oaoxtviz.js","file":"ordinary.js"}}'
        ),
    )
    with pytest.raises(ValueError, match="Duplicate"):
        module.main()
    assert not module.TARGET.exists()
