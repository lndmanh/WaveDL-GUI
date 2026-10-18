"""Real vendored Nuxt assets must survive a wheel install outside the checkout."""

import hashlib
import json
from pathlib import Path

import pytest

from .test_installed_cli import checked, installed


@pytest.fixture(scope="module")
def installed_web(tmp_path_factory):
    root = Path(__file__).resolve().parents[2]
    assets = root / "src/wavedl_daemon/web_assets"
    if not (assets / "index.html").is_file() or not (assets / "sw.js").is_file():
        pytest.skip(
            "Generate and vendor the real web build before installed acceptance"
        )
    inventory = {
        file.relative_to(assets).as_posix(): {
            "size": file.stat().st_size,
            "sha256": hashlib.sha256(file.read_bytes()).hexdigest(),
        }
        for file in assets.rglob("*")
        if file.is_file()
    }
    assert any(name.startswith("_nuxt/") for name in inventory)
    instance = installed.__wrapped__(tmp_path_factory)
    return instance, inventory


_EXERCISE = r"""
import asyncio, base64, hashlib, json, re, sys
from pathlib import Path
from urllib.parse import urljoin, urlsplit
import httpx
import wavedl_daemon
from wavedl_daemon.http.app import create_app

package = Path(wavedl_daemon.__file__).parent
assert package.is_relative_to(Path(sys.prefix)), package
assets = package / 'web_assets'
inventory = json.loads(Path(sys.argv[1]).read_text())
packaged = {file.relative_to(assets).as_posix() for file in assets.rglob('*') if file.is_file()}
assert packaged == set(inventory), ('Wheel inventory mismatch', packaged ^ set(inventory))
for name, expected in inventory.items():
    raw = (assets / name).read_bytes()
    assert len(raw) == expected['size'], name
    assert hashlib.sha256(raw).hexdigest() == expected['sha256'], name
canonical = json.loads((assets / '.wavedl-assets.json').read_text())
marker_raw = (assets / '.wavedl-immutable.json').read_bytes()
assert canonical['.wavedl-immutable.json'] == hashlib.sha256(marker_raw).hexdigest()
marker = json.loads(marker_raw)
assert marker['version'] == 1 and marker['paths']
assert all(name in canonical and name.startswith('_nuxt/') for name in marker['paths'])

async def exercise():
    app = create_app(None, token='installed-static', daemon_id='installed-daemon',
                     build_id='installed-build')
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url='http://localhost') as client:
        root = await client.get('/')
        assert root.status_code == 200, root.text
        assert root.content == (assets / 'index.html').read_bytes()
        assert root.headers['cache-control'] == 'no-store'
        assert root.headers['content-type'].startswith('text/html')
        assert root.headers['referrer-policy'] == 'no-referrer'
        policy = root.headers['content-security-policy']
        assert "script-src 'self'" in policy
        assert "style-src 'self' 'unsafe-inline'" in policy
        assert 'unsafe-eval' not in policy
        for attributes, body in re.findall(rb'<script\b([^>]*)>(.*?)</script\s*>',
                                           root.content, re.I | re.S):
            if not re.search(rb'\bsrc\s*=', attributes, re.I):
                digest = base64.b64encode(hashlib.sha256(body).digest()).decode()
                assert "'sha256-" + digest + "'" in policy
        deep = await client.get('/runs/installed-run', headers={'Accept':'text/html'})
        assert deep.status_code == 200 and deep.content == root.content
        assert deep.headers['cache-control'] == 'no-store'
        head = await client.head('/runs/installed-run', headers={'Accept':'text/html'})
        assert head.status_code == 200 and not head.content
        assert head.headers['content-length'] == str(len(root.content))
        assert (await client.get('/api/unknown')).status_code == 401
        missing = await client.get('/api/unknown', headers={
            'Authorization':'Bearer installed-static', 'Accept':'text/html'})
        assert missing.status_code == 404
        assert missing.headers['content-type'] == 'application/json'
        assert (await client.post('/runs/installed-run')).status_code == 405
        assert (await client.get('/_nuxt/missing.js', headers={'Accept':'text/html'})).status_code == 404
        for name in inventory:
            response = await client.get('/' + name)
            assert response.status_code == 200, (name, response.status_code)
            assert hashlib.sha256(response.content).hexdigest() == inventory[name]['sha256'], name
            assert response.headers['x-content-type-options'] == 'nosniff'
            if name.endswith('.js'):
                assert 'javascript' in response.headers['content-type'], name
            elif name.endswith('.css'):
                assert response.headers['content-type'].startswith('text/css'), name
            if name.startswith('_nuxt/') and name.count('/') == 1 and name.endswith(('.js','.css')):
                assert name in marker['paths'], ('Generated chunk absent from producer inventory', name)
                assert 'immutable' in response.headers['cache-control'], name
            if name in ('sw.js', 'manifest.webmanifest'):
                assert response.headers['cache-control'] == 'no-cache', name
        worker = await client.get('/sw.js')
        assert b'installed-static' not in worker.content
        # Exercise the actual bundled Workbox install URLs, not a reconstructed
        # filesystem listing. Workbox may transform index.html/404.html into
        # navigation aliases, which a worker's default Accept cannot resolve.
        manifests = re.findall(r'\[\{"revision":.*?\}\]', worker.text, re.S)
        assert len(manifests) == 1, 'Pinned worker precache literal not found'
        entries = json.loads(manifests[0])
        assert entries and all(set(entry) == {'revision','url'} for entry in entries)
        assert any(entry['url'] == '/' for entry in entries)
        seen = set()
        for entry in entries:
            url = urljoin('http://localhost/', entry['url'])
            parsed = urlsplit(url)
            assert parsed.scheme == 'http' and parsed.netloc == 'localhost', url
            assert not parsed.query and not parsed.fragment, url
            assert parsed.path not in seen, 'Duplicate precache URL: ' + url
            seen.add(parsed.path)
            assert parsed.path != '/api' and not parsed.path.startswith('/api/'), url
            response = await client.get(url, headers={'Accept':'*/*'})
            assert response.status_code == 200, ('Worker precache URL unavailable', url, response.status_code)
            canonical = 'index.html' if parsed.path == '/' else parsed.path.lstrip('/')
            assert canonical in inventory, ('Precache URL has no packaged file', url)
            assert hashlib.sha256(response.content).hexdigest() == inventory[canonical]['sha256'], url
    print(json.dumps({'packaged_files':len(inventory), 'precache_urls':len(entries),
                      'static_and_api':'verified'}))
asyncio.run(exercise())
"""


def test_installed_real_web_inventory_shell_csp_and_api_separation(installed_web):
    (outside, _venv, _binary, python, environment), inventory = installed_web
    expected = outside / "web-inventory.json"
    expected.write_text(json.dumps(inventory))
    output = checked(
        [str(python), "-c", _EXERCISE, str(expected)],
        cwd=outside,
        environment=environment,
    )
    evidence = json.loads(output)
    assert evidence["packaged_files"] == len(inventory)
    assert evidence["static_and_api"] == "verified"
    assert evidence["precache_urls"] > 10
