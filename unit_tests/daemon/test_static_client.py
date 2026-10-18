"""The optional packaged shell cannot shadow API authority or escape its root."""

import asyncio
import hashlib
import json

import httpx
import pytest

from wavedl_daemon.http.app import create_app
from wavedl_daemon.storage.settings import Settings


def make_app(tmp_path, root):
    return create_app(
        Settings(state_root=tmp_path / "state", run_root=tmp_path / "runs"),
        token="static-test-token",
        daemon_id="daemon-static",
        build_id="build-static",
        web_assets=root,
    )


def request(app, path="/", *, method="GET", headers=None):
    async def run():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://localhost"
        ) as client:
            return await client.request(method, path, headers=headers)

    return asyncio.run(run())


@pytest.fixture
def assets(tmp_path):
    root = tmp_path / "assets"
    root.mkdir()
    (root / "index.html").write_text(
        '<html><script type="application/json">{"hello":1}</script></html>'
    )
    (root / "sw.js").write_text("worker")
    (root / "manifest.webmanifest").write_text("{}")
    return root


def test_public_shell_and_deep_link_head_have_security_headers(tmp_path, assets):
    app = make_app(tmp_path, assets)
    shell = request(app)
    deep = request(app, "/runs/run123", headers={"Accept": "text/html"})
    assert shell.status_code == deep.status_code == 200
    assert shell.content == deep.content
    assert (
        request(app, "/runs/", headers={"Accept": "text/html"}).content == shell.content
    )
    assert shell.headers["cache-control"] == "no-store"
    assert "'sha256-" in shell.headers["content-security-policy"]
    assert "unsafe-eval" not in shell.headers["content-security-policy"]
    assert shell.headers["referrer-policy"] == "no-referrer"
    head = request(app, "/", method="HEAD")
    assert head.content == b""
    assert head.headers["content-length"] == str(len(shell.content))
    assert not app.state.settings.state_root.exists()


def test_api_unknown_never_returns_shell(tmp_path, assets):
    app = make_app(tmp_path, assets)
    for path in ("/api", "/api/unknown", "/api/runs/unknown/path"):
        assert request(app, path).status_code == 401
        response = request(
            app,
            path,
            headers={
                "Authorization": "Bearer static-test-token",
                "Accept": "text/html",
            },
        )
        assert response.status_code == 404
        assert response.headers["content-type"] == "application/json"
    assert request(app, "/", method="POST").status_code == 405


def test_missing_build_is_explicit_and_app_construction_is_inert(tmp_path):
    root = tmp_path / "missing"
    app = make_app(tmp_path, root)
    assert not root.exists()
    assert request(app).status_code == 503
    assert "Generate and vendor" in request(app).text
    assert request(app, "/missing.js").status_code == 404
    assert not root.exists()


def test_only_content_verified_hashes_are_immutable(tmp_path, assets):
    raw = b"export const version = 1;"
    name = "bundle." + hashlib.sha256(raw).hexdigest()[:16] + ".js"
    (assets / name).write_bytes(raw)
    (assets / "bundle.aaaaaaaaaaaa.js").write_bytes(raw)
    app = make_app(tmp_path, assets)
    assert "immutable" in request(app, "/" + name).headers["cache-control"]
    for path in ("/sw.js", "/manifest.webmanifest", "/bundle.aaaaaaaaaaaa.js"):
        assert request(app, path).headers["cache-control"] == "no-cache"
    assert (
        request(app, "/missing.js", headers={"Accept": "text/html"}).status_code == 404
    )
    assert request(app, "/missing").status_code == 404


@pytest.mark.parametrize("path", ["/%2e%2e/secret", "/bad%5cname", "/bad:name"])
def test_invalid_members_are_not_shell_navigation(tmp_path, assets, path):
    response = request(
        make_app(tmp_path, assets), path, headers={"Accept": "text/html"}
    )
    assert response.status_code == 404


def test_symlink_leaf_and_parent_fail_closed(tmp_path, assets):
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.js").write_text("secret")
    try:
        (assets / "link.js").symlink_to(outside / "secret.js")
        (assets / "linked").symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("Symlinks unavailable")
    app = make_app(tmp_path, assets)
    for path in ("/link.js", "/linked/secret.js", "/linked/navigation"):
        assert request(app, path, headers={"Accept": "text/html"}).status_code == 404


def test_root_swap_to_symlink_fails_closed(tmp_path, assets):
    app = make_app(tmp_path, assets)
    moved = tmp_path / "moved"
    assets.rename(moved)
    try:
        assets.symlink_to(moved, target_is_directory=True)
    except OSError:
        pytest.skip("Symlinks unavailable")
    assert request(app).status_code == 404


def test_fallback_never_follows_replaced_index(tmp_path, assets):
    outside = tmp_path / "outside.html"
    outside.write_text("not the build")
    (assets / "index.html").unlink()
    try:
        (assets / "index.html").symlink_to(outside)
    except OSError:
        pytest.skip("Symlinks unavailable")
    response = request(
        make_app(tmp_path, assets), "/runs/id", headers={"Accept": "text/html"}
    )
    assert response.status_code == 404


def test_assets_are_bounded_and_unsafe_shell_is_not_navigation_fallback(
    tmp_path, assets, monkeypatch
):
    monkeypatch.setattr("wavedl_daemon.http.static.MAX_ASSET_BYTES", 4)
    app = make_app(tmp_path, assets)
    assert request(app).status_code == 404
    assert request(app, "/sw.js").status_code == 404
    assert request(app, "/runs/id", headers={"Accept": "text/html"}).status_code == 404


def test_nuxt_hash_name_requires_vendored_digest_and_rejects_changed_bytes(
    tmp_path, assets
):
    (assets / "_nuxt").mkdir()
    path = assets / "_nuxt/AbcD1234.js"
    raw = b"export default 1"
    path.write_bytes(raw)
    app = make_app(tmp_path, assets)
    assert request(app, "/_nuxt/AbcD1234.js").headers["cache-control"] == "no-cache"
    (assets / ".wavedl-assets.json").write_text(
        json.dumps({"_nuxt/AbcD1234.js": hashlib.sha256(raw).hexdigest()})
    )
    assert "immutable" in request(app, "/_nuxt/AbcD1234.js").headers["cache-control"]
    path.write_bytes(b"modified build")
    assert request(app, "/_nuxt/AbcD1234.js").status_code == 404


@pytest.mark.parametrize("name", ["oaoxtviz.js", "style.abcdefgh.css"])
def test_producer_inventory_accepts_lowercase_hashes_not_public_files(
    tmp_path, assets, name
):
    (assets / "_nuxt").mkdir()
    raw = b"generated build"
    path = assets / "_nuxt" / name
    path.write_bytes(raw)
    (assets / "_nuxt/ordinary.js").write_bytes(raw)
    marker = json.dumps({"version": 1, "paths": ["_nuxt/" + name]}).encode()
    (assets / ".wavedl-immutable.json").write_bytes(marker)
    (assets / ".wavedl-assets.json").write_text(
        json.dumps(
            {
                ".wavedl-immutable.json": hashlib.sha256(marker).hexdigest(),
                "_nuxt/" + name: hashlib.sha256(raw).hexdigest(),
                "_nuxt/ordinary.js": hashlib.sha256(raw).hexdigest(),
            }
        )
    )
    app = make_app(tmp_path, assets)
    assert "immutable" in request(app, "/_nuxt/" + name).headers["cache-control"]
    assert request(app, "/_nuxt/ordinary.js").headers["cache-control"] == "no-cache"
    path.write_bytes(b"modified generated build")
    assert request(app, "/_nuxt/" + name).status_code == 404
    path.write_bytes(raw)
    (assets / ".wavedl-immutable.json").write_bytes(b"corrupt marker")
    assert request(app, "/_nuxt/" + name).status_code == 404
    (assets / ".wavedl-immutable.json").unlink()
    assert request(app, "/_nuxt/" + name).status_code == 404


def test_lowercase_name_without_provenance_remains_revalidated(tmp_path, assets):
    (assets / "_nuxt").mkdir()
    raw = b"public file"
    (assets / "_nuxt/ordinary.js").write_bytes(raw)
    (assets / ".wavedl-assets.json").write_text(
        json.dumps({"_nuxt/ordinary.js": hashlib.sha256(raw).hexdigest()})
    )
    assert (
        request(make_app(tmp_path, assets), "/_nuxt/ordinary.js").headers[
            "cache-control"
        ]
        == "no-cache"
    )


@pytest.mark.parametrize(
    "marker",
    [
        {"version": True, "paths": ["_nuxt/oaoxtviz.js"]},
        {"version": 1.0, "paths": ["_nuxt/oaoxtviz.js"]},
        {"version": 2, "paths": ["_nuxt/oaoxtviz.js"]},
        {"version": 1, "paths": [], "extra": True},
        {"version": 1, "paths": []},
        {"version": 1, "paths": ["_nuxt/oaoxtviz.js"] * 2},
        {"version": 1, "paths": ["_nuxt/oaoxtviz.js"] * 10001},
        {"version": 1, "paths": [123]},
        {"version": 1, "paths": ["_nuxt/../oaoxtviz.js"]},
        {"version": 1, "paths": ["_nuxt/./oaoxtviz.js"]},
        {"version": 1, "paths": ["_nuxt//oaoxtviz.js"]},
        {"version": 1, "paths": ["_nuxt/bad:name.js"]},
        {"version": 1, "paths": ["_nuxt/bad\\name.js"]},
        {"version": 1, "paths": ["_nuxt/bad\x00name.js"]},
        {"version": 1, "paths": ["_nuxt/café.js"]},
        {"version": 1, "paths": ["public/file.js"]},
        {"version": 1, "paths": ["_nuxt/missing.js"]},
        '{"version":1,"version":1,"paths":["_nuxt/oaoxtviz.js"]}',
    ],
)
def test_hash_matching_but_semantically_invalid_marker_fails_closed(
    tmp_path, assets, marker
):
    (assets / "_nuxt").mkdir()
    raw = b"generated chunk"
    (assets / "_nuxt/oaoxtviz.js").write_bytes(raw)
    encoded = (marker if isinstance(marker, str) else json.dumps(marker)).encode()
    (assets / ".wavedl-immutable.json").write_bytes(encoded)
    canonical = {
        ".wavedl-immutable.json": hashlib.sha256(encoded).hexdigest(),
        "_nuxt/oaoxtviz.js": hashlib.sha256(raw).hexdigest(),
    }
    if isinstance(marker, dict):
        for path in marker["paths"]:
            if isinstance(path, str) and path != "_nuxt/missing.js":
                canonical[path] = hashlib.sha256(raw).hexdigest()
    (assets / ".wavedl-assets.json").write_text(json.dumps(canonical))
    assert request(make_app(tmp_path, assets), "/_nuxt/oaoxtviz.js").status_code == 404


@pytest.mark.parametrize("digest", [None, 123, "not-a-digest", "A" * 64])
def test_marker_paths_require_valid_canonical_digest(tmp_path, assets, digest):
    (assets / "_nuxt").mkdir()
    (assets / "_nuxt/oaoxtviz.js").write_bytes(b"generated chunk")
    marker = json.dumps(
        {"version": 1, "paths": ["_nuxt/oaoxtviz.js", "_nuxt/other.js"]}
    ).encode()
    (assets / ".wavedl-immutable.json").write_bytes(marker)
    (assets / ".wavedl-assets.json").write_text(
        json.dumps(
            {
                ".wavedl-immutable.json": hashlib.sha256(marker).hexdigest(),
                "_nuxt/oaoxtviz.js": hashlib.sha256(b"generated chunk").hexdigest(),
                "_nuxt/other.js": digest,
            }
        )
    )
    assert request(make_app(tmp_path, assets), "/_nuxt/oaoxtviz.js").status_code == 404
