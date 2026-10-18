"""Fixture ownership and actual HTTP journal-byte acceptance, not browser claims."""

import asyncio
import json
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

import httpx
import pytest

from tools import browser_journal_fault_fixture as fixture
from tools.browser_journal_fault_fixture import (
    FAULTS,
    MAX_SNAPSHOT_BYTES,
    bounded_read,
    damage,
    digest,
    latest,
    private_root,
    publication_ready,
    publish,
    queue_command,
)
from wavedl import __version__
from wavedl.core.protocol import Envelope, encode


pytestmark = pytest.mark.skipif(
    os.name != "posix", reason="Fixture requires POSIX getuid and O_NOFOLLOW"
)


@pytest.mark.parametrize("fault", FAULTS)
def test_fault_bytes_are_exact_and_do_not_parse_damaged_tail(fault):
    completion = encode(
        Envelope(
            "00000000-0000-4000-8000-000000000001",
            1,
            "exit",
            1,
            "2026-10-13T00:00:00Z",
            {"status": "completed", "code": 0},
        )
    )
    raw = damage(fault, completion)
    if fault in {"torn-tail", "abandoned-tail"}:
        assert raw + completion[len(completion) // 2 :] == completion
        assert not raw.endswith(b"\n")
    elif fault == "oversized-line":
        assert raw == b"x" * 65536 + b"\n" + completion
    else:
        assert raw == b"x" * 65536
    with pytest.raises(ValueError):
        damage("foreign", completion)


def test_private_root_and_evidence_refuse_replacement_and_size(tmp_path):
    tmp_path.chmod(0o700)
    private_root(tmp_path, empty=True)
    publish(tmp_path / "file", {"ok": True})
    with pytest.raises(FileExistsError):
        publish(tmp_path / "file", {})
    with pytest.raises(ValueError, match="empty"):
        private_root(tmp_path, empty=True)
    with pytest.raises(ValueError, match="bound"):
        bounded_read(tmp_path / "file", 1)
    link = tmp_path / "link"
    link.symlink_to(tmp_path / "file")
    with pytest.raises(ValueError):
        bounded_read(link, 4096)
    with pytest.raises(ValueError, match="byte bound"):
        publish(tmp_path / "oversized", {"x": "x" * MAX_SNAPSHOT_BYTES})
    tmp_path.chmod(0o755)
    with pytest.raises(ValueError, match="mode-700"):
        private_root(tmp_path)


def test_private_commands_are_monotone_owned_and_write_once(tmp_path):
    tmp_path.chmod(0o700)
    publish(
        tmp_path / "fixture.json",
        {"fixtureId": "owned", "rootIdentity": list(private_root(tmp_path))},
    )
    publish(tmp_path / "snapshot-0.json", {"fixtureId": "owned", "phase": 0})
    assert latest(tmp_path)["phase"] == 0
    with pytest.raises(ValueError, match="skip"):
        queue_command(tmp_path, 2)
    assert queue_command(tmp_path, 1) == {"queuedPhase": 1}
    with pytest.raises(FileExistsError):
        queue_command(tmp_path, 1)
    publish(tmp_path / "snapshot-2.json", {"fixtureId": "owned", "phase": 2})
    with pytest.raises(ValueError, match="monotone"):
        latest(tmp_path)


def test_publication_waits_for_temporary_hardlink_removal(tmp_path, monkeypatch):
    publish(
        tmp_path / "fixture.json",
        {"fixtureId": "owned", "rootIdentity": list(private_root(tmp_path))},
    )
    publish(tmp_path / "snapshot-0.json", {"fixtureId": "owned", "phase": 0})
    target = tmp_path / "snapshot-1.json"
    linked = threading.Event()
    release = threading.Event()
    failures = []
    original = os.link

    def paused_link(source, destination, *args, **kwargs):
        original(source, destination, *args, **kwargs)
        if Path(destination) == target:
            linked.set()
            assert release.wait(timeout=5)

    def writer():
        try:
            publish(target, {"fixtureId": "owned", "phase": 1})
        except BaseException as error:
            failures.append(error)

    monkeypatch.setattr(os, "link", paused_link)
    thread = threading.Thread(target=writer)
    thread.start()
    try:
        assert linked.wait(timeout=5)
        assert target.stat().st_nlink == 2
        assert not publication_ready(target)
        assert latest(tmp_path)["phase"] == 0
        with pytest.raises(ValueError, match="single-link"):
            bounded_read(target, MAX_SNAPSHOT_BYTES)
    finally:
        release.set()
        thread.join(timeout=5)
    assert not thread.is_alive()
    assert not failures
    assert target.stat().st_nlink == 1
    assert publication_ready(target)
    assert latest(tmp_path)["phase"] == 1


def test_completion_marker_does_not_waive_malicious_hardlink(tmp_path):
    publish(
        tmp_path / "fixture.json",
        {"fixtureId": "owned", "rootIdentity": list(private_root(tmp_path))},
    )
    target = tmp_path / "snapshot-0.json"
    publish(target, {"fixtureId": "owned", "phase": 0})
    os.link(target, tmp_path / "foreign-alias")
    assert publication_ready(target)
    with pytest.raises(ValueError, match="single-link"):
        latest(tmp_path)


@pytest.mark.parametrize("kind", ["symlink", "file", "public", "nonempty"])
def test_publication_marker_refuses_unsafe_entries(tmp_path, kind):
    target = tmp_path / "snapshot-0.json"
    marker = target.with_name(target.name + ".ready")
    if kind == "symlink":
        ordinary = tmp_path / "ordinary"
        ordinary.mkdir(mode=0o700)
        marker.symlink_to(ordinary, target_is_directory=True)
    elif kind == "file":
        marker.write_bytes(b"")
    else:
        marker.mkdir(mode=0o700)
        if kind == "public":
            marker.chmod(0o755)
        else:
            (marker / "foreign").write_bytes(b"")
    with pytest.raises(ValueError, match="completion marker"):
        publication_ready(target)


@pytest.mark.parametrize("phase", [False, True])
def test_latest_refuses_boolean_snapshot_phase(tmp_path, phase):
    publish(
        tmp_path / "fixture.json",
        {"fixtureId": "owned", "rootIdentity": list(private_root(tmp_path))},
    )
    if phase:
        publish(tmp_path / "snapshot-0.json", {"fixtureId": "owned", "phase": 0})
    publish(
        tmp_path / f"snapshot-{int(phase)}.json",
        {"fixtureId": "owned", "phase": phase},
    )
    with pytest.raises(ValueError, match="ownership/phase"):
        latest(tmp_path)


@pytest.mark.parametrize("mutation", ["replace", "rewrite", "mode", "hardlink"])
def test_evidence_refuses_identity_and_metadata_changes_during_read(
    tmp_path, monkeypatch, mutation
):
    path = tmp_path / "evidence"
    publish(path, {"ok": True})
    original = os.read

    def changed(descriptor, size):
        result = original(descriptor, size)
        if mutation == "replace":
            path.unlink()
            path.write_bytes(result)
        elif mutation == "rewrite":
            path.write_bytes(b"x" * len(result))
        elif mutation == "mode":
            path.chmod(0o644)
        else:
            os.link(path, tmp_path / "alias")
        return result

    monkeypatch.setattr(os, "read", changed)
    with pytest.raises(ValueError, match="changed"):
        bounded_read(path, 4096)


def test_root_refuses_symlink_or_unprotected_ancestor(tmp_path):
    ancestor = tmp_path / "ancestor"
    ancestor.mkdir(mode=0o700)
    root = ancestor / "root"
    root.mkdir(mode=0o700)
    link = tmp_path / "link"
    link.symlink_to(ancestor, target_is_directory=True)
    with pytest.raises(ValueError, match="ancestor"):
        private_root(link / "root")
    ancestor.chmod(0o777)
    with pytest.raises(ValueError, match="ancestor"):
        private_root(root)


@pytest.mark.parametrize(
    "command",
    [
        None,
        [],
        {},
        {"fixtureId": "foreign", "phase": 1},
        {"fixtureId": "owned", "phase": True, "previousSha256": "wrong"},
    ],
)
def test_malformed_commands_never_advance_or_publish(tmp_path, command):
    publish(tmp_path / "snapshot-0.json", {"fixtureId": "owned", "phase": 0})
    publish(tmp_path / "command-1.json", command)
    scenario = fixture.JournalScenario(tmp_path, None, "owned")
    calls = []

    async def advance(phase):
        calls.append(phase)

    scenario.advance = advance
    with pytest.raises(ValueError, match="Foreign"):
        asyncio.run(scenario.controls())
    assert calls == []
    assert not (tmp_path / "snapshot-1.json").exists()


@pytest.mark.parametrize("port", [-1, 65536, True, "0"])
def test_invalid_port_has_no_publication_side_effect(tmp_path, port):
    with pytest.raises(ValueError, match="Port bound"):
        asyncio.run(fixture.serve(tmp_path, tmp_path / "absent-token", port))
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize(
    "kind", ["public", "oversized", "empty", "symlink", "hardlink", "inside"]
)
def test_invalid_token_has_no_fixture_publication(tmp_path, kind):
    root = tmp_path / "root"
    root.mkdir(mode=0o700)
    token = root / "token" if kind == "inside" else tmp_path / "token"
    token.write_text(
        "x" * 4097
        if kind == "oversized"
        else ""
        if kind == "empty"
        else "fixture-token"
    )
    token.chmod(0o644 if kind == "public" else 0o600)
    if kind == "symlink":
        alias = tmp_path / "alias"
        alias.symlink_to(token)
        token = alias
    elif kind == "hardlink":
        os.link(token, tmp_path / "alias")
    with pytest.raises(ValueError):
        asyncio.run(fixture.serve(root, token))
    assert not (root / "fixture.json").exists()
    assert not (root / "state").exists()


def test_real_tcp_fixture_retains_faults_and_only_recovers_exact_torn_tail(tmp_path):
    repo = Path(__file__).resolve().parents[2]
    root = tmp_path / "root"
    root.mkdir(mode=0o700)
    token_file = tmp_path / "token"
    token_file.write_text("journal-fixture-test-token", encoding="ascii")
    token_file.chmod(0o600)
    output = tmp_path / "stdout"
    errors = tmp_path / "stderr"
    with output.open("w+") as stdout, errors.open("w+") as stderr:
        child = subprocess.Popen(
            [
                sys.executable,
                str(repo / "tools/browser_journal_fault_fixture.py"),
                "--root",
                str(root),
                "--token-file",
                str(token_file),
            ],
            cwd=repo,
            env={**os.environ, "PYTHONPATH": str(repo / "src")},
            stdout=stdout,
            stderr=stderr,
        )

        def wait_for(predicate):
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                if child.poll() is not None:
                    pytest.fail(f"Fixture exited: {errors.read_text()}")
                if predicate():
                    return
                time.sleep(0.03)
            pytest.fail("Fixture bounded readiness timeout")

        try:
            wait_for(lambda: "Phase: 0" in output.read_text())
            bootstrap = next(
                line.removeprefix("Browser: ")
                for line in output.read_text().splitlines()
                if line.startswith("Browser: ")
            )
            origin = bootstrap.split("/?")[0]
            with httpx.Client(
                base_url=origin,
                headers={"Authorization": "Bearer journal-fixture-test-token"},
                timeout=5,
            ) as client:
                assert httpx.get(origin + "/api/runs", timeout=5).status_code == 401
                initial = latest(root)
                assert initial["phase"] == 0
                assert initial["laps"] >= initial["phaseStartLaps"] + 3
                assert set(initial["cases"]) == set(FAULTS)
                for case in initial["cases"].values():
                    reply = client.get(f"/api/runs/{case['runId']}")
                    assert reply.status_code == 200, reply.text
                    assert reply.json()["state"] == "terminal_unknown"
                    assert reply.json()["uncertainty"] is True
                    assert case["cursors"] == [[1, 0]]
                    assert case["events"][0]["type"] == "hello"
                    assert len(case["events"]) == 1
                    assert (
                        digest(bytes.fromhex(case["journal"]["rawHex"]))
                        == case["journal"]["sha256"]
                    )
                health = client.get("/api/health")
                assert health.status_code == 200
                assert health.json()["build_id"] == __version__
                assert (
                    json.loads(bounded_read(root / "fixture.json", 4096))["buildId"]
                    == __version__
                )
                assert len(health.json()["monitoring_errors"]) == 2
                for phase in (1, 2, 3):
                    queue_command(root, phase)
                    wait_for(
                        lambda phase=phase: publication_ready(
                            root / f"snapshot-{phase}.json"
                        )
                    )
                    state = latest(root)
                    assert state["phase"] == phase
                    assert state["laps"] >= state["phaseStartLaps"] + 3
                    for fault, case in state["cases"].items():
                        recovered = phase >= 2 and fault == "torn-tail"
                        assert case["cursors"] == [[1, int(recovered)]]
                        assert len(case["events"]) == 1 + int(recovered)
                        prefix = bytes.fromhex(case["journal"]["rawHex"])[
                            : case["journal"]["prefixBytes"]
                        ]
                        assert case["events"] == [json.loads(prefix)] + (
                            [
                                json.loads(
                                    bytes.fromhex(case["journal"]["completionHex"])
                                )
                            ]
                            if recovered
                            else []
                        )
                        assert case["events"][0]["run_id"] == case["runId"]
                        assert case["events"][0]["attempt"] == 1
                        assert case["events"][0]["seq"] == 0
                        assert client.get(f"/api/runs/{case['runId']}").json()[
                            "state"
                        ] == ("completed" if recovered else "terminal_unknown")
                        if fault != "torn-tail":
                            assert case["journal"] == initial["cases"][fault]["journal"]
                    for fault in ("torn-tail", "abandoned-tail"):
                        bookmark = state["cases"][fault]["bookmark"]
                        recovered = phase >= 2 and fault == "torn-tail"
                        assert (
                            bookmark["offset"]
                            == state["cases"][fault]["journal"][
                                "bytes" if recovered else "prefixBytes"
                            ]
                        )
                        assert bookmark["last_seq"] == int(recovered)
                assert client.get("/").status_code == 200
        finally:
            if child.poll() is None:
                child.send_signal(signal.SIGINT)
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)
                pytest.fail("Fixture shutdown exceeded bound")
        assert child.returncode == 0, errors.read_text()
        assert "Fixture: control-drained" in output.read_text()
        assert "Fixture: services-closed" in output.read_text()
