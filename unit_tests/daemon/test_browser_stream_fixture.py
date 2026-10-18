import asyncio
import json

from tools.browser_stream_fixture import boundary_wrapper


def test_fixture_forwards_fragmented_real_frame_and_records_cursor(tmp_path):
    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send(
            {
                "type": "http.response.body",
                "body": b'id: 1:3\nevent: message\ndata: {"x": "\xc3\xa9"}\n\n',
                "more_body": False,
            }
        )

    sent = []

    async def run():
        wrapped = boundary_wrapper(app, tmp_path / "evidence.json")

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            sent.append(message)

        await wrapped(
            {
                "type": "http",
                "method": "GET",
                "path": "/api/runs/00000000-0000-4000-8000-000000000001/events",
                "query_string": b"attempt=1&seq=2",
            },
            receive,
            send,
        )

    asyncio.run(run())
    assert b"".join(m.get("body", b"") for m in sent).startswith(
        b'id: 1:3\nevent: message\ndata: {"x": "\xc3\xa9"}\n\n'
    )
    report = json.loads((tmp_path / "evidence.json").read_text())
    assert report["scope"] == "asgi-only"
    assert report["records"][0]["cursor"] == {"attempt": 1, "seq": 2}
    assert report["records"][0]["interrupted"] is True
    assert report["records"][0]["nonAsciiBytes"] > 0
