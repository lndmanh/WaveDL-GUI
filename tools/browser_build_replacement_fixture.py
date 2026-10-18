"""Same production source, controlled genuine daemon build identity for local QA."""

from __future__ import annotations

import json


try:
    from tools import browser_daemon_fixture as base
except ModuleNotFoundError:
    import browser_daemon_fixture as base


BUILD_SUFFIX = "-qa-controlled-replacement"


def factory(original):
    def create(*args, **kwargs):
        kwargs["build_id"] += BUILD_SUFFIX
        app = original(*args, **kwargs)
        root = args[0].state_root.parent

        async def wrapped(scope, receive, send):
            target = (
                scope.get("type") == "http"
                and scope.get("method") == "GET"
                and scope.get("path") == "/api/health"
            )
            status = None
            body = bytearray()

            async def capture(message):
                nonlocal status
                if target and message["type"] == "http.response.start":
                    status = message["status"]
                if target and message["type"] == "http.response.body":
                    body.extend(message.get("body", b""))
                    if len(body) > 65536:
                        raise ValueError("Controlled health evidence budget")
                    if not message.get("more_body", False) and status == 200:
                        health = json.loads(body)
                        evidence = root / ".controlled-build-health.jsonl"
                        with evidence.open("a") as stream:
                            if evidence.stat().st_size > 1048576:
                                raise ValueError("Controlled health log budget")
                            stream.write(
                                json.dumps(
                                    {
                                        "status": status,
                                        "daemonId": health["daemon_id"],
                                        "buildId": health["build_id"],
                                        "scoped": any(
                                            key.lower() == b"x-wavedl-daemon-id"
                                            for key, _ in scope.get("headers", [])
                                        ),
                                    }
                                )
                                + "\n"
                            )
                await send(message)

            await app(scope, receive, capture)

        return wrapped

    return create


if __name__ == "__main__":
    base.create_app = factory(base.create_app)
    base.main()
