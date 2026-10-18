"""Offline inventory is derived from the actual worker and verified static bytes."""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()


@pytest.fixture
def build(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location(
        "offline_vendor", Path(__file__).parents[2] / "tools/vendor_web_assets.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    source = tmp_path / "public"
    source.mkdir()
    files = {
        "index.html": "<html>shell</html>",
        "favicon.svg": "<svg/>",
        "manifest.webmanifest": '{"name":"WaveDL"}',
        "_nuxt/app.js": "entry code",
        "_nuxt/lazy.js": "lazy code",
        "_nuxt/style.css": "body{}",
        "_nuxt/font.woff2": "font bytes",
        "_nuxt/ordinary.js": "unversioned public code",
    }
    entries = []
    for relative, content in files.items():
        path = source / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        entries.append(
            {
                "url": "/" if relative == "index.html" else relative,
                "revision": None if relative.startswith("_nuxt/") else "revision",
            }
        )
    (source / "sw.js").write_text("K(" + compact(entries).decode() + ");")
    monkeypatch.setattr(module, "SOURCE", source)
    monkeypatch.setattr(module, "TARGET", tmp_path / "web_assets")
    monkeypatch.setattr(module, "WORK_AREA", tmp_path / "backups")
    producer = tmp_path / "client.manifest.mjs"
    producer.write_text("export default {};")
    monkeypatch.setattr(module, "CLIENT_MANIFEST", producer)
    monkeypatch.setattr(
        module.subprocess,
        "run",
        lambda *_args, **_kwargs: SimpleNamespace(
            stdout=json.dumps(
                {
                    "entry": {"file": "app.js", "css": ["style.css"]},
                    "lazy": {"file": "lazy.js", "assets": ["font.woff2"]},
                }
            )
        ),
    )
    return module, entries


def test_packages_complete_offline_inventory(build):
    module, entries = build
    module.main()
    raw = (module.TARGET / "offline-build.json").read_bytes()
    inventory = json.loads(raw)
    assert inventory["schema_version"] == 1
    assert (
        inventory["build_key"]
        == hashlib.sha256(
            compact(sorted([[entry["url"], entry["revision"]] for entry in entries]))
        ).hexdigest()
    )
    assets = inventory["assets"]
    assert [asset["url"] for asset in assets] == sorted(
        "/" if entry["url"] == "/" else "/" + entry["url"] for entry in entries
    )
    for asset in assets:
        relative = "index.html" if asset["url"] == "/" else asset["url"][1:]
        content = (module.SOURCE / relative).read_bytes()
        assert asset["sha256"] == hashlib.sha256(content).hexdigest()
        assert asset["size"] == len(content)
        assert asset["immutable"] is (
            relative.startswith("_nuxt/") and relative != "_nuxt/ordinary.js"
        )
    assert (
        inventory["generation"]
        == hashlib.sha256(
            compact(
                [
                    [asset["url"], asset["sha256"], asset["size"], asset["immutable"]]
                    for asset in assets
                ]
            )
        ).hexdigest()
    )
    marker = json.loads((module.TARGET / module.MANIFEST).read_text())
    assert marker["offline-build.json"] == hashlib.sha256(raw).hexdigest()
    assert marker == module.inventory(module.TARGET, managed=True)


def test_generation_changes_for_same_workbox_build_key(build):
    module, _entries = build
    module.main()
    previous = json.loads((module.TARGET / "offline-build.json").read_text())
    (module.SOURCE / "_nuxt/lazy.js").write_text("changed lazy bytes")
    module.main()
    current = json.loads((module.TARGET / "offline-build.json").read_text())
    assert previous["build_key"] == current["build_key"]
    assert previous["generation"] != current["generation"]
    backup = next(module.WORK_AREA.glob("backup-*"))
    assert json.loads((backup / "offline-build.json").read_text()) == previous


@pytest.mark.parametrize(
    "name", ["_nuxt/lazy.js", "favicon.svg", "manifest.webmanifest"]
)
def test_uncached_static_asset_rejected_without_replacing_build(build, name):
    module, entries = build
    module.main()
    original = (module.TARGET / "offline-build.json").read_bytes()
    filtered = [entry for entry in entries if entry["url"] != name]
    (module.SOURCE / "sw.js").write_text("K(" + compact(filtered).decode() + ");")
    with pytest.raises(ValueError, match="precache"):
        module.main()
    assert (module.TARGET / "offline-build.json").read_bytes() == original


@pytest.mark.parametrize("worker", ["missing injection", "K([]);", "K([{bad}]);"])
def test_missing_or_invalid_workbox_manifest_rejected(build, worker):
    module, _entries = build
    (module.SOURCE / "sw.js").write_text(worker)
    with pytest.raises(ValueError, match="Workbox"):
        module.main()
    assert not module.TARGET.exists()


def test_ambiguous_workbox_literals_rejected(build):
    module, entries = build
    (module.SOURCE / "sw.js").write_text(
        "K(" + compact(entries).decode() + ");L(" + compact(entries).decode() + ");"
    )
    with pytest.raises(ValueError, match="Workbox"):
        module.main()


@pytest.mark.parametrize(
    "url",
    [
        "https://evil.test/a.js",
        "//evil.test/a.js",
        "/api/health",
        "../a.js",
        "/_nuxt/app.js?x=1",
        "index.html",
    ],
)
def test_invalid_workbox_url_rejected(build, url):
    module, entries = build
    entries[0]["url"] = url
    (module.SOURCE / "sw.js").write_text("K(" + compact(entries).decode() + ");")
    with pytest.raises(ValueError, match="Workbox"):
        module.main()


@pytest.mark.parametrize(
    "relative",
    [
        "Auth/signin.js",
        "V1/status.js",
        "v2/status.js",
        "EVENTS/feed.js",
        "State/snapshot.js",
        "token/value.js",
        "Tokens/value.js",
        "Server/status.js",
        "NODE_MODULES/index.js",
        "200.html",
        "data.json",
        "other.webmanifest",
    ],
)
def test_existing_noncacheable_precache_asset_rejected(build, relative):
    module, entries = build
    path = module.SOURCE / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("not an offline asset")
    entries.append({"url": relative, "revision": "revision"})
    (module.SOURCE / "sw.js").write_text("K(" + compact(entries).decode() + ");")
    with pytest.raises(ValueError, match="Workbox"):
        module.main()
    assert not module.TARGET.exists()


def test_plus_and_at_sign_static_names_are_supported(build):
    module, entries = build
    (module.SOURCE / "_nuxt/a+b@c.js").write_text("valid public code")
    entries.append({"url": "_nuxt/a+b@c.js", "revision": "revision"})
    (module.SOURCE / "sw.js").write_text("K(" + compact(entries).decode() + ");")
    module.main()
    result = json.loads((module.TARGET / "offline-build.json").read_text())
    assert any(asset["url"] == "/_nuxt/a+b@c.js" for asset in result["assets"])


def test_duplicate_normalized_workbox_url_rejected(build):
    module, entries = build
    entries.append({"url": "/_nuxt/app.js", "revision": None})
    (module.SOURCE / "sw.js").write_text("K(" + compact(entries).decode() + ");")
    with pytest.raises(ValueError, match="Duplicate"):
        module.main()


def test_workbox_order_does_not_change_identity(build):
    module, entries = build
    module.main()
    original = (module.TARGET / "offline-build.json").read_bytes()
    (module.SOURCE / "sw.js").write_text(
        "const entries=" + compact(list(reversed(entries))).decode() + ";K(entries);"
    )
    module.main()
    assert (module.TARGET / "offline-build.json").read_bytes() == original


@pytest.mark.parametrize("revision", [1, False, {}, []])
def test_invalid_workbox_revision_rejected(build, revision):
    module, entries = build
    entries[0]["revision"] = revision
    (module.SOURCE / "sw.js").write_text("K(" + compact(entries).decode() + ");")
    with pytest.raises(ValueError, match="Workbox"):
        module.main()


def test_worker_cannot_include_itself(build):
    module, entries = build
    entries.append({"url": "sw.js", "revision": "control script"})
    (module.SOURCE / "sw.js").write_text("K(" + compact(entries).decode() + ");")
    with pytest.raises(ValueError, match="Workbox"):
        module.main()


def test_static_copy_race_preserves_previous_generation(build, monkeypatch):
    module, _entries = build
    module.main()
    original = (module.TARGET / "offline-build.json").read_bytes()
    copyfile = module.shutil.copyfile

    def corrupt_copy(source, destination):
        copyfile(source, destination)
        if Path(source).name == "lazy.js":
            Path(destination).write_text("not the verified bytes")

    monkeypatch.setattr(module.shutil, "copyfile", corrupt_copy)
    with pytest.raises(ValueError, match="changed while being staged"):
        module.main()
    assert (module.TARGET / "offline-build.json").read_bytes() == original
    assert not list(module.WORK_AREA.glob("stage-*"))


def test_source_cannot_supply_offline_inventory(build):
    module, _entries = build
    (module.SOURCE / "offline-build.json").write_text("{}")
    with pytest.raises(ValueError, match="Unexpected static"):
        module.main()


@pytest.mark.parametrize(
    "limit",
    [
        "MAX_OFFLINE_ASSETS",
        "MAX_OFFLINE_FILE",
        "MAX_OFFLINE_TOTAL",
        "MAX_OFFLINE_MANIFEST",
    ],
)
def test_offline_inventory_bounds_fail_before_replacement(build, monkeypatch, limit):
    module, _entries = build
    module.main()
    original = (module.TARGET / "offline-build.json").read_bytes()
    monkeypatch.setattr(module, limit, 1)
    with pytest.raises(ValueError, match=r"[Oo]ffline"):
        module.main()
    assert (module.TARGET / "offline-build.json").read_bytes() == original


def test_modified_offline_metadata_rejected(build):
    module, _entries = build
    module.main()
    (module.TARGET / "offline-build.json").write_text("forged")
    with pytest.raises(ValueError, match="differ"):
        module.main()


def test_empty_asset_rejected(build):
    module, _entries = build
    (module.SOURCE / "_nuxt/lazy.js").write_bytes(b"")
    with pytest.raises(ValueError, match=r"[Oo]ffline"):
        module.main()


def test_failed_swap_recovers_offline_inventory(build, monkeypatch):
    module, _entries = build
    module.main()
    original = (module.TARGET / "offline-build.json").read_bytes()
    replace = module.os.replace

    def fail_stage(source, destination):
        if Path(source).name.startswith("stage-"):
            raise OSError("swap failed")
        replace(source, destination)

    monkeypatch.setattr(module.os, "replace", fail_stage)
    (module.SOURCE / "_nuxt/lazy.js").write_text("new generation")
    with pytest.raises(OSError, match="swap failed"):
        module.main()
    assert (module.TARGET / "offline-build.json").read_bytes() == original
    assert not list(module.WORK_AREA.glob("stage-*"))
