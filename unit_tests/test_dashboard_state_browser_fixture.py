"""Pure dashboard fault projections must preserve identity and honest uncertainty."""

import asyncio
import json

import pytest

from tools.dashboard_state_browser_fixture import STAGES, boundary_wrapper, project


SOURCE = {
    "plan_id": "11111111-1111-4111-8111-111111111111",
    "run_id": "22222222-2222-4222-8222-222222222222",
    "request_id": "33333333-3333-4333-8333-333333333333",
    "backend": "local",
    "operation": "train",
    "attempt": 1,
    "state": "running",
    "uncertainty": False,
    "submission_requested": True,
    "cancellation_requested": False,
    "evidence": {},
}


@pytest.mark.parametrize("stage", range(len(STAGES)))
def test_projection_keeps_owned_identity_and_never_infers_success(stage):
    view = project(SOURCE, stage)
    for key in ("plan_id", "run_id", "request_id", "operation"):
        assert view[key] == SOURCE[key]
    assert view["state"] not in {"completed", "failed", "cancelled"}
    assert view["evidence"]["native_pending"] == STAGES[stage][4]
    assert view["attempt"] == STAGES[stage][2]
    assert view["evidence"]["native_identity"]["restart_count"] == view["attempt"] - 1
    assert SOURCE["backend"] == "local"


def test_runtime_exit_without_native_terminal_stays_running_uncertain():
    view = project(SOURCE, 5)
    assert view["state"] == "running"
    assert view["uncertainty"] is True
    assert view["evidence"]["runtime"]["outcome"]["status"] == "success"


def test_absent_accounting_is_unknown_not_failed_or_completed():
    assert project(SOURCE, 4)["state"] == "terminal_unknown"
    assert project(SOURCE, 3)["state"] == "observation_unavailable"


def fixture_app(status=200):
    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": status, "headers": []})
        await send({"type": "http.response.body", "body": json.dumps(SOURCE).encode()})

    return app


def call_boundary(app, method="GET"):
    messages = []

    async def invoke():
        async def send(message):
            messages.append(message)

        await app(
            {"type": "http", "method": method, "path": f"/api/runs/{SOURCE['run_id']}"},
            None,
            send,
        )

    asyncio.run(invoke())
    return messages


def test_unauthenticated_response_is_not_injected(tmp_path):
    stage, evidence = tmp_path / "stage", tmp_path / "evidence"
    stage.write_text("9")
    messages = call_boundary(boundary_wrapper(fixture_app(401), stage, evidence))
    assert messages[0]["status"] == 401
    assert json.loads(messages[1]["body"])["backend"] == "local"
    assert not evidence.exists()


def test_skipped_or_regressed_stage_fails_closed(tmp_path):
    stage, evidence = tmp_path / "stage", tmp_path / "evidence"
    app = boundary_wrapper(fixture_app(), stage, evidence)
    stage.write_text("2")
    with pytest.raises(ValueError, match="regressed or skipped"):
        call_boundary(app)
    stage.write_text("0")
    call_boundary(app)
    stage.write_text("1")
    call_boundary(app)
    stage.write_text("0")
    with pytest.raises(ValueError, match="regressed or skipped"):
        call_boundary(app)


def test_mutation_after_last_detail_is_immediately_persisted(tmp_path):
    stage, evidence = tmp_path / "stage", tmp_path / "evidence"
    app = boundary_wrapper(fixture_app(), stage, evidence)
    for index in range(len(STAGES)):
        stage.write_text(str(index))
        call_boundary(app)
    call_boundary(app, "POST")
    proof = json.loads(evidence.read_text())
    assert proof["records"][-1]["name"] == "supervision-lost"
    assert proof["mutations"] == [
        {"method": "POST", "path": f"/api/runs/{SOURCE['run_id']}"}
    ]
