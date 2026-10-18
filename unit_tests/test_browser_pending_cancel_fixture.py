"""Controlled latency must not replace public cancellation or Local execution."""

import json
import threading
import time

from starlette.testclient import TestClient

from tools.browser_pending_cancel_fixture import BoundaryLocalBackend, create_sentinel
from wavedl_daemon.execution.budget import WorkBudget
from wavedl_daemon.http.app import create_app
from wavedl_daemon.runs.runtime_service import HostedServices
from wavedl_daemon.storage.settings import Settings


def test_barriers_retain_real_receipt_and_unclaimed_run_never_spawns(
    tmp_path, monkeypatch
):
    entered = {name: threading.Event() for name in ("probe", "cancel")}
    release = {name: threading.Event() for name in entered}

    def barrier(self, name):
        entered[name].set()
        assert release[name].wait(15), f"Unreleased {name} boundary"

    monkeypatch.setattr(BoundaryLocalBackend, "barrier", barrier)
    executable = create_sentinel(tmp_path)
    settings = Settings(tmp_path / "state", tmp_path / "runs")
    services = HostedServices(
        settings,
        budget=WorkBudget(max_workers=1, max_pending=0),
        backend_factory=lambda lock: {
            "local": BoundaryLocalBackend(
                tmp_path, dispatch_lock=lock, cancel_grace=0.05
            )
        },
    )
    app = create_app(
        settings,
        token="boundary-test",
        daemon_id="test",
        build_id="test",
        services=services,
    )
    payload = {
        "backend": "local",
        "operation": "train",
        "config": {"model": "cnn", "epochs": 1, "precision": "no"},
        "runtime": {
            "python": str(executable),
            "mode": "selected",
            "device": "cpu",
            "environment": {},
        },
        "topology": {"num_machines": 1, "processes_per_machine": 1, "machine_rank": 0},
    }
    try:
        with TestClient(
            app,
            base_url="http://localhost:8420",
            headers={"Authorization": "Bearer boundary-test"},
        ) as client:
            plans = []
            for index in range(2):
                response = client.post(
                    "/api/runs/plan",
                    json=payload,
                    headers={"Idempotency-Key": str(index)},
                )
                assert response.status_code == 200, response.text
                plan = response.json()
                plans.append(plan)
                assert (
                    client.post(
                        "/api/runs", json={"plan_id": plan["plan_id"]}
                    ).status_code
                    == 202
                )
                if index == 0:
                    assert entered["probe"].wait(5)
            urls = [f"/api/runs/{plan['run_id']}" for plan in plans]
            assert client.get(urls[1]).json()["state"] == "pending"
            assert not (tmp_path / "spawned").exists()
            for url in urls:
                for _ in range(2):
                    assert client.post(f"{url}/cancel").status_code == 202
            assert client.get(urls[1]).json()["state"] == "cancelled"
            assert client.get(urls[0]).json()["state"] == "submission_unknown"
            release["probe"].set()
            assert entered["cancel"].wait(10)
            pending = client.get(urls[0]).json()
            assert pending["cancellation_requested"]
            assert pending["state"] != "cancelled"
            assert pending["uncertainty"]
            lineage = client.get(f"{urls[0]}/attempts").json()["attempts"][0]
            assert lineage["submission_handle"]["pid"] > 0
            assert not lineage["cancel_delivered"]
            release["cancel"].set()
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                final = client.get(urls[0]).json()
                if final["state"] == "cancelled":
                    break
                time.sleep(0.02)
            assert final["state"] == "cancelled" and not final["uncertainty"]
    finally:
        for event in release.values():
            event.set()
    records = [
        json.loads(line)
        for line in (tmp_path / "backend.jsonl").read_text().splitlines()
    ]
    assert [row["kind"] for row in records] == [
        "submit-entered",
        "probe-entered",
        "receipt",
        "cancel-entered",
        "cancel-completed",
        "child-reaped",
    ]
    assert all(row["run_id"] == plans[0]["run_id"] for row in records)
    assert records[-1]["pidAbsent"]
