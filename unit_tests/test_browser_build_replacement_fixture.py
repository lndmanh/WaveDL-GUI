"""Controlled build overrides are genuine app construction, never wire mutation."""

import asyncio
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace


def test_factory_uses_new_build_identity_and_forwards_exact_success_bytes(tmp_path):
    path = Path(__file__).parents[1] / "tools/browser_build_replacement_fixture.py"
    spec = importlib.util.spec_from_file_location("controlled_build", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    captured = []
    raw = b'{"daemon_id":"owned","build_id":"1.8.1-qa-controlled-replacement"}'

    def original(settings, **kwargs):
        assert kwargs["build_id"] == "1.8.1" + module.BUILD_SUFFIX

        async def app(scope, receive, send):
            await send({"type": "http.response.start", "status": 200})
            await send({"type": "http.response.body", "body": raw})

        return app

    app = module.factory(original)(
        SimpleNamespace(state_root=tmp_path / "state"), build_id="1.8.1"
    )

    async def send(message):
        captured.append(message)

    asyncio.run(
        app({"type": "http", "method": "GET", "path": "/api/health"}, None, send)
    )
    assert captured[1]["body"] == raw
    receipt = json.loads((tmp_path / ".controlled-build-health.jsonl").read_text())
    assert receipt == {
        "status": 200,
        "daemonId": "owned",
        "buildId": "1.8.1-qa-controlled-replacement",
        "scoped": False,
    }
