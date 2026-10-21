"""Keep daemon/browser acceptance gates mandatory and observable."""

import os
import re
import stat
import subprocess
from pathlib import Path

import pytest
import yaml


WORKFLOW = (
    Path(__file__).resolve().parents[1]
    / ".github/workflows/daemon-browser-integration.yml"
)


@pytest.fixture
def workflow():
    return yaml.safe_load(WORKFLOW.read_text())


def test_expensive_acceptance_preserves_failure_diagnostics_but_stops_on_cancel(
    workflow,
):
    """New owned execution stops on cancellation; existing evidence still uploads."""
    steps = workflow["jobs"]["chromium-cpu"]["steps"]
    producers = [
        step
        for step in steps
        if re.search(r"node tools/run_\S+acceptance\.mjs", step.get("run", ""))
        or "pytest unit_tests/daemon/test_registry_metric_http_recovery.py"
        in step.get("run", "")
    ]
    implicit = {
        "Verify native retained generations and refused fourth update",
        "Run all twelve mandatory browser acceptance cases",
    }
    assert len(producers) == 53
    assert {step["name"] for step in producers if not step.get("if")} == implicit
    for step in producers:
        if step["name"] not in implicit:
            # cancelled() is a status function, so no implicit success() is
            # added: ordinary failed earlier gates still collect diagnostics.
            assert step["if"] == "${{ !cancelled() }}"
        assert not step.get("continue-on-error", False)
    guards = [
        step
        for step in steps
        if step.get("name", "").startswith(("Require ", "Verify "))
        and step not in producers
    ]
    assert len(guards) == 60
    implicit_guards = {
        "Verify installed dependency and CPU data contracts",
        "Require exhaustive field and effective Python export round trips",
    }
    assert {step["name"] for step in guards if not step.get("if")} == implicit_guards
    for step in guards:
        if step["name"] not in implicit_guards:
            assert step["if"] == "always()"
        assert not step.get("continue-on-error", False)
    uploads = [
        step
        for step in steps
        if step.get("uses", "").startswith("actions/upload-artifact@")
    ]
    assert len(uploads) == 1
    assert uploads[0]["if"] == "always()"


def assert_runtime_tmpdir(job):
    assert "TMPDIR" not in job["env"]
    assert all("runner." not in str(value) for value in job["env"].values())
    first = job["steps"][0]
    assert first["name"] == "Create dedicated job temporary directory"
    assert 'export TMPDIR="$RUNNER_TEMP/wavedl-browser-ci"' in first["run"]
    assert 'mkdir -m 700 -p "$TMPDIR"' in first["run"]
    assert 'printf \'TMPDIR=%s\\n\' "$TMPDIR" >> "$GITHUB_ENV"' in first["run"]


def test_generated_manifest_is_copied_after_vendoring_and_uploaded_exactly(workflow):
    steps = workflow["jobs"]["chromium-cpu"]["steps"]
    vendor = next(
        step for step in steps if step.get("run") == "python tools/vendor_web_assets.py"
    )
    capture = next(
        step
        for step in steps
        if step.get("name") == "Capture exact generated asset manifest for evidence"
    )
    assert capture["run"] == (
        "cp -- src/wavedl_daemon/web_assets/.wavedl-assets.json "
        '"$TMPDIR/browser-build-manifest.json"'
    )
    assert not capture.get("continue-on-error", False)
    assert "if" not in capture
    first_browser = next(
        step for step in steps if step.get("run") == "node tools/run_web_acceptance.mjs"
    )
    assert steps.index(vendor) < steps.index(capture) < steps.index(first_browser)
    upload = next(
        step
        for step in steps
        if step.get("uses", "").startswith("actions/upload-artifact@")
    )
    paths = upload["with"]["path"].splitlines()
    assert (
        paths.count("${{ runner.temp }}/wavedl-browser-ci/browser-build-manifest.json")
        == 1
    )
    assert not any("web_assets/" in path for path in paths)
    assert upload["if"] == "always()"


@pytest.mark.parametrize("source_present", [True, False])
def test_manifest_capture_preserves_original_bytes_or_fails(
    workflow, tmp_path, source_present
):
    """Copy the producer bytes, never reconstruct a digest-matching stand-in."""
    step = next(
        step
        for step in workflow["jobs"]["chromium-cpu"]["steps"]
        if step.get("name") == "Capture exact generated asset manifest for evidence"
    )
    source = tmp_path / "src/wavedl_daemon/web_assets/.wavedl-assets.json"
    source.parent.mkdir(parents=True)
    content = b'{\n  "asset.js": "unmodified fixture bytes"\n}\n'
    if source_present:
        source.write_bytes(content)
    destination = tmp_path / "evidence with spaces"
    destination.mkdir()
    result = subprocess.run(
        ["bash", "-e", "-c", step["run"]],
        cwd=tmp_path,
        env={**os.environ, "TMPDIR": str(destination)},
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )
    captured = destination / "browser-build-manifest.json"
    if source_present:
        assert result.returncode == 0
        assert captured.read_bytes() == content
    else:
        assert result.returncode != 0
        assert not captured.exists()


@pytest.mark.skipif(
    os.name != "posix", reason="Ubuntu runner uses POSIX shell and modes"
)
def test_browser_tmpdir_uses_runner_runtime_and_persists_for_later_steps(
    workflow, tmp_path
):
    job = workflow["jobs"]["chromium-cpu"]
    assert_runtime_tmpdir(job)
    runner_temp = tmp_path / "runner temp"
    runner_temp.mkdir()
    github_env = tmp_path / "github-env"
    subprocess.run(
        ["bash", "-e", "-c", job["steps"][0]["run"]],
        env={
            **os.environ,
            "RUNNER_TEMP": str(runner_temp),
            "GITHUB_ENV": str(github_env),
            "TMPDIR": "/must-not-be-used",
        },
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )
    expected = runner_temp / "wavedl-browser-ci"
    assert expected.is_dir()
    assert stat.S_IMODE(expected.stat().st_mode) == 0o700
    assert github_env.read_text() == f"TMPDIR={expected}\n"


@pytest.mark.parametrize("event", ["push", "pull_request"])
def test_cursor_storage_evidence_changes_trigger_browser_lane(workflow, event):
    triggers = workflow.get("on", workflow.get(True))
    paths = triggers[event]["paths"]
    assert "tools/browser_cursor_storage.mjs" in paths
    assert paths.count("tools/verify_auth_skew_browser_report.mjs") == 1
    assert paths.count("tools/verify_auth_skew_browser_report.test.mjs") == 1


@pytest.mark.parametrize("event", ["push", "pull_request"])
def test_auth_retirement_proof_changes_trigger_browser_lane(workflow, event):
    triggers = workflow.get("on", workflow.get(True))
    paths = triggers[event]["paths"]
    assert paths.count("tools/browser_auth_retirement.mjs") == 1
    assert paths.count("tools/browser_auth_retirement.test.mjs") == 1
    steps = workflow["jobs"]["chromium-cpu"]["steps"]
    commands = "\n".join(step.get("run", "") for step in steps)
    assert "node --test tools/verify_adoption_browser_report.test.mjs " in commands
    assert "tools/browser_auth_retirement.test.mjs" in commands


def test_new_app_ci_excludes_legacy_transition_but_preserves_update_safety(workflow):
    triggers = workflow.get("on", workflow.get(True))
    for event in ("push", "pull_request"):
        assert not any("legacy" in path for path in triggers[event]["paths"])
    steps = workflow["jobs"]["chromium-cpu"]["steps"]
    commands = "\n".join(step.get("run", "") for step in steps)
    assert "run_legacy_browser_acceptance" not in commands
    assert "verify_legacy_transition_report" not in commands
    for runner in (
        "run_retained_browser_acceptance.mjs",
        "run_retained_rollback_browser_acceptance.mjs",
        "run_retained_concurrency_acceptance.mjs",
    ):
        assert f"node tools/{runner}" in commands


@pytest.mark.parametrize("event", ["push", "pull_request"])
def test_submission_and_storage_fault_changes_trigger_browser_lane(workflow, event):
    triggers = workflow.get("on", workflow.get(True))
    assert {
        "unit_tests/daemon/test_submission_http_crash_recovery.py",
        "tools/storage_fault_browser_fixture.py",
        "tools/run_storage_fault_browser_acceptance.mjs",
        "tools/verify_storage_fault_browser_report.mjs",
        "tools/verify_storage_fault_browser_report.test.mjs",
        "unit_tests/daemon/test_storage_fault_browser_fixture.py",
    }.issubset(triggers[event]["paths"])


def test_submission_crash_recovery_requires_all_six_boundaries_without_skips(workflow):
    steps = workflow["jobs"]["chromium-cpu"]["steps"]
    runner = next(
        step
        for step in steps
        if step.get("run") == "python -m pytest "
        "unit_tests/daemon/test_submission_http_crash_recovery.py "
        '--junitxml="$TMPDIR/submission-http-crash-recovery.xml"'
    )
    guard = next(
        step for step in steps if "assert len(cases) == 6\n" in step.get("run", "")
    )
    assert steps.index(runner) < steps.index(guard)
    assert not runner.get("if") and not runner.get("continue-on-error", False)
    assert guard["if"] == "always()"
    assert not guard.get("continue-on-error", False)
    assert "||" not in guard["run"]
    assert (
        'case.get("classname") == "unit_tests.daemon.test_submission_http_crash_recovery"'
        in guard["run"]
    )
    assert '{case.get("name") for case in cases} == expected' in guard["run"]
    for boundary, recovery in (
        ("intent", "unique"),
        ("claim", "missing"),
        ("acceptance", "unique"),
        ("acceptance", "missing"),
        ("acceptance", "ambiguous"),
        ("receipt", "unique"),
    ):
        assert f'("{boundary}", "{recovery}")' in guard["run"]
    assert '("skipped", "failure", "error")' in guard["run"]
    assert "submission-http-crash-recovery.xml" in steps[-1]["with"]["path"]


@pytest.mark.parametrize(
    ("mode", "report"),
    [
        ("query_only", "storage-fault-query-only"),
        ("page_quota", "storage-fault-page-quota"),
    ],
)
def test_storage_fault_browser_modes_and_strict_guards_are_mandatory(
    workflow, mode, report
):
    job = workflow["jobs"]["chromium-cpu"]
    assert not job.get("continue-on-error", False)
    assert job["env"]["WAVEDL_PYTHON"] == "python"
    steps = job["steps"]
    contract = next(
        step
        for step in steps
        if "node --test tools/verify_storage_fault_browser_report.test.mjs"
        in step.get("run", "")
    )
    assert (
        "python -m pytest unit_tests/daemon/test_storage_fault_browser_fixture.py -q"
        in contract["run"]
    )
    assert not contract.get("if") and not contract.get("continue-on-error", False)
    runner = next(
        step
        for step in steps
        if step.get("run") == "node tools/run_storage_fault_browser_acceptance.mjs "
        f'--report="$TMPDIR/{report}.json" {mode}'
    )
    guard = next(
        step
        for step in steps
        if step.get("run") == "node tools/verify_storage_fault_browser_report.mjs "
        f'"$TMPDIR/{report}.json" {mode}'
    )
    upload = steps[-1]
    assert (
        steps.index(contract)
        < steps.index(runner)
        < steps.index(guard)
        < steps.index(upload)
    )
    for step in (runner, guard):
        assert step["if"] == (
            "${{ !cancelled() }}"
            if step["name"].startswith(("Run ", "Exercise "))
            else "always()"
        )
        assert not step.get("continue-on-error", False)
        assert "||" not in step["run"]
    assert upload["if"] == "always()"
    assert (
        f"${{{{ runner.temp }}}}/wavedl-browser-ci/{report}.json"
        in upload["with"]["path"].splitlines()
    )


@pytest.mark.parametrize("event", ["push", "pull_request"])
def test_additive_acceptance_changes_trigger_browser_lane(workflow, event):
    triggers = workflow.get("on", workflow.get(True))
    paths = triggers[event]["paths"]
    assert {
        "tools/browser_training_validation.mjs",
        "tools/run_training_validation_browser_acceptance.mjs",
        "tools/run_training_validation_browser_acceptance.test.mjs",
        "tools/verify_training_validation_browser_report.mjs",
        "tools/verify_training_validation_browser_report.test.mjs",
        "tools/verify_registry_http_recovery_report.py",
        "unit_tests/daemon/test_registry_http_recovery.py",
        "unit_tests/test_migration_acceptance_workflow.py",
    }.issubset(paths)


def test_invalid_authoring_browser_and_guard_are_mandatory(workflow):
    steps = workflow["jobs"]["chromium-cpu"]["steps"]
    runner = next(
        step
        for step in steps
        if "node tools/run_training_validation_browser_acceptance.mjs"
        in step.get("run", "")
    )
    guard = next(
        step
        for step in steps
        if "node tools/verify_training_validation_browser_report.mjs"
        in step.get("run", "")
    )
    assert steps.index(runner) < steps.index(guard)
    for step in (runner, guard):
        assert step["if"] == (
            "${{ !cancelled() }}"
            if step["name"].startswith(("Run ", "Exercise "))
            else "always()"
        )
        assert not step.get("continue-on-error", False)
        assert "||" not in step["run"]
    artifacts = steps[-1]["with"]["path"]
    assert "training-validation-browser/training-validation.json" in artifacts


@pytest.mark.parametrize("event", ["push", "pull_request"])
def test_f12_changes_trigger_browser_lane(workflow, event):
    triggers = workflow.get("on", workflow.get(True))
    assert {
        "tools/stream_malformed_browser_fixture.py",
        "tools/run_stream_malformed_browser_acceptance.mjs",
        "tools/verify_stream_malformed_browser_report.mjs",
        "tools/verify_stream_malformed_browser_report.test.mjs",
        "unit_tests/daemon/test_stream_malformed_browser_fixture.py",
    }.issubset(triggers[event]["paths"])


def test_f12_malformed_and_invalid_utf8_browser_gates_are_mandatory(workflow):
    steps = workflow["jobs"]["chromium-cpu"]["steps"]
    malformed_runner = next(
        step
        for step in steps
        if step.get("run") == "node tools/run_stream_malformed_browser_acceptance.mjs "
        '--report="$TMPDIR/stream-malformed-browser.json"'
    )
    malformed_guard = next(
        step
        for step in steps
        if step.get("run") == "node tools/verify_stream_malformed_browser_report.mjs "
        '"$TMPDIR/stream-malformed-browser.json"'
    )
    utf8_runner = next(
        step
        for step in steps
        if step.get("run") == "node tools/run_stream_malformed_browser_acceptance.mjs "
        '--invalid-utf8 --report="$TMPDIR/stream-invalid-utf8-browser.json"'
    )
    utf8_guard = next(
        step
        for step in steps
        if step.get("run") == "node tools/verify_stream_malformed_browser_report.mjs "
        '"$TMPDIR/stream-invalid-utf8-browser.json"'
    )
    upload = steps[-1]
    for step in (malformed_runner, malformed_guard, utf8_runner, utf8_guard):
        assert step["if"] == (
            "${{ !cancelled() }}"
            if step["name"].startswith(("Run ", "Exercise "))
            else "always()"
        )
        assert not step.get("continue-on-error", False)
        assert "||" not in step["run"]
    assert (
        steps.index(malformed_runner)
        < steps.index(malformed_guard)
        < steps.index(upload)
    )
    assert steps.index(utf8_runner) < steps.index(utf8_guard) < steps.index(upload)
    artifacts = upload["with"]["path"].splitlines()
    assert (
        "${{ runner.temp }}/wavedl-browser-ci/stream-malformed-browser.json"
        in artifacts
    )
    assert (
        "${{ runner.temp }}/wavedl-browser-ci/stream-invalid-utf8-browser.json"
        in artifacts
    )


def test_registry_crash_matrix_has_four_reports_and_zero_skip_guard(workflow):
    steps = workflow["jobs"]["chromium-cpu"]["steps"]
    runner = next(
        step
        for step in steps
        if "pytest unit_tests/daemon/test_registry_http_recovery.py"
        in step.get("run", "")
    )
    guard = next(
        step
        for step in steps
        if "python tools/verify_registry_http_recovery_report.py" in step.get("run", "")
    )
    assert steps.index(runner) < steps.index(guard)
    assert "WAVEDL_REGISTRY_RECOVERY_REPORT_DIR" in runner["env"]
    assert not runner.get("if") and not runner.get("continue-on-error", False)
    assert guard["if"] == "always()"
    assert not guard.get("continue-on-error", False)
    assert "assert len(cases) == 33" in guard["run"]
    assert '("skipped", "failure", "error")' in guard["run"]
    assert "||" not in guard["run"]
    artifacts = steps[-1]["with"]["path"]
    for order in ("projection-cursor", "cursor-projection"):
        for recovery in ("rebuild", "ingest"):
            report = f"registry-http-recovery-{order}-{recovery}.json"
            assert report in guard["run"] and report in artifacts
    assert "registry-http-recovery.xml" in artifacts


@pytest.mark.parametrize("event", ["push", "pull_request"])
def test_journal_byte_fault_changes_trigger_browser_lane(workflow, event):
    triggers = workflow.get("on", workflow.get(True))
    assert {
        "tools/browser_journal_fault_fixture.py",
        "tools/run_journal_fault_browser_acceptance.mjs",
        "tools/run_journal_fault_browser_acceptance.test.mjs",
        "tools/verify_journal_fault_browser_report.mjs",
        "tools/verify_journal_fault_browser_report.test.mjs",
        "unit_tests/daemon/test_browser_journal_fault_fixture.py",
    }.issubset(triggers[event]["paths"])


def test_journal_byte_fault_fixture_and_node_contracts_are_mandatory(workflow):
    job = workflow["jobs"]["chromium-cpu"]
    assert not job.get("continue-on-error", False)
    steps = job["steps"]
    for command in (
        "python -m pytest unit_tests/daemon/test_browser_journal_fault_fixture.py -q",
        "node --test tools/run_journal_fault_browser_acceptance.test.mjs "
        "tools/verify_journal_fault_browser_report.test.mjs",
    ):
        step = next(step for step in steps if step.get("run") == command)
        assert not step.get("if")
        assert not step.get("continue-on-error", False)


def test_journal_byte_fault_browser_and_strict_file_guard_are_mandatory(workflow):
    steps = workflow["jobs"]["chromium-cpu"]["steps"]
    runner = next(
        step
        for step in steps
        if step.get("run") == "node tools/run_journal_fault_browser_acceptance.mjs "
        '--report="$TMPDIR/journal-fault-browser.json"'
    )
    guard = next(
        step
        for step in steps
        if step.get("run") == "node tools/verify_journal_fault_browser_report.mjs "
        '"$TMPDIR/journal-fault-browser.json"'
    )
    upload = steps[-1]
    assert steps.index(runner) < steps.index(guard) < steps.index(upload)
    for step in (runner, guard):
        assert step["if"] == (
            "${{ !cancelled() }}"
            if step["name"].startswith(("Run ", "Exercise "))
            else "always()"
        )
        assert not step.get("continue-on-error", False)
        assert "||" not in step["run"]
    assert_runtime_tmpdir(workflow["jobs"]["chromium-cpu"])
    assert upload["if"] == "always()"
    assert upload["uses"] == "actions/upload-artifact@v4"
    assert not upload.get("continue-on-error", False)
    artifacts = upload["with"]["path"].splitlines()
    assert (
        "${{ runner.temp }}/wavedl-browser-ci/journal-fault-browser.json" in artifacts
    )


@pytest.mark.parametrize("event", ["push", "pull_request"])
def test_hostile_origin_changes_trigger_browser_lane(workflow, event):
    triggers = workflow.get("on", workflow.get(True))
    assert {
        "tools/hostile_origin_browser_fixture.py",
        "unit_tests/test_hostile_origin_browser_fixture.py",
        "tools/run_hostile_origin_browser_acceptance.mjs",
        "tools/run_hostile_origin_browser_acceptance.test.mjs",
        "tools/verify_hostile_origin_browser_report.mjs",
        "tools/verify_hostile_origin_browser_report.test.mjs",
    }.issubset(triggers[event]["paths"])


def test_hostile_origin_contracts_and_browser_file_guard_are_mandatory(workflow):
    job = workflow["jobs"]["chromium-cpu"]
    assert not job.get("continue-on-error", False)
    steps = job["steps"]
    contracts = []
    for command in (
        "python -m pytest unit_tests/test_hostile_origin_browser_fixture.py -q",
        "node --test tools/run_hostile_origin_browser_acceptance.test.mjs "
        "tools/verify_hostile_origin_browser_report.test.mjs",
    ):
        step = next(step for step in steps if step.get("run") == command)
        assert not step.get("if")
        assert not step.get("continue-on-error", False)
        contracts.append(step)
    runner = next(
        step
        for step in steps
        if step.get("run") == "node tools/run_hostile_origin_browser_acceptance.mjs "
        '--report="$TMPDIR/hostile-origin-browser.json"'
    )
    guard = next(
        step
        for step in steps
        if step.get("run") == "node tools/verify_hostile_origin_browser_report.mjs "
        '"$TMPDIR/hostile-origin-browser.json"'
    )
    upload = steps[-1]
    assert all(steps.index(step) < steps.index(runner) for step in contracts)
    assert steps.index(runner) < steps.index(guard) < steps.index(upload)
    for step in (runner, guard):
        assert step["if"] == (
            "${{ !cancelled() }}"
            if step["name"].startswith(("Run ", "Exercise "))
            else "always()"
        )
        assert not step.get("continue-on-error", False)
        assert "||" not in step["run"]
    assert_runtime_tmpdir(job)
    assert upload["if"] == "always()"
    assert upload["uses"] == "actions/upload-artifact@v4"
    assert not upload.get("continue-on-error", False)
    assert "${{ runner.temp }}/wavedl-browser-ci/hostile-origin-browser.json" in (
        upload["with"]["path"].splitlines()
    )


@pytest.mark.parametrize("event", ["push", "pull_request"])
def test_genuine_broker_overflow_changes_trigger_browser_lane(workflow, event):
    triggers = workflow.get("on", workflow.get(True))
    assert {
        "tools/genuine_broker_overflow_browser_fixture.py",
        "unit_tests/test_genuine_broker_overflow_browser_fixture.py",
        "tools/run_genuine_broker_overflow_browser_acceptance.mjs",
        "tools/run_genuine_broker_overflow_browser_acceptance.test.mjs",
        "tools/verify_genuine_broker_overflow_browser_report.mjs",
        "tools/verify_genuine_broker_overflow_browser_report.test.mjs",
    }.issubset(triggers[event]["paths"])


def test_genuine_broker_overflow_contracts_and_browser_file_guard_are_mandatory(
    workflow,
):
    job = workflow["jobs"]["chromium-cpu"]
    steps = job["steps"]
    fixture = next(
        step
        for step in steps
        if step.get("run")
        == "python -m pytest unit_tests/test_genuine_broker_overflow_browser_fixture.py -q"
    )
    node_contracts = next(
        step
        for step in steps
        if step.get("run")
        == "node --test tools/run_genuine_broker_overflow_browser_acceptance.test.mjs "
        "tools/verify_genuine_broker_overflow_browser_report.test.mjs"
    )
    runner = next(
        step
        for step in steps
        if step.get("run")
        == "node tools/run_genuine_broker_overflow_browser_acceptance.mjs "
        '--report="$TMPDIR/genuine-broker-overflow-browser.json"'
    )
    guard = next(
        step
        for step in steps
        if step.get("run")
        == "node tools/verify_genuine_broker_overflow_browser_report.mjs "
        '"$TMPDIR/genuine-broker-overflow-browser.json"'
    )
    upload = steps[-1]
    assert not job.get("continue-on-error", False)
    assert not fixture.get("if") and not fixture.get("continue-on-error", False)
    assert not node_contracts.get("if") and not node_contracts.get(
        "continue-on-error", False
    )
    assert steps.index(fixture) < steps.index(runner)
    assert steps.index(node_contracts) < steps.index(runner)
    assert steps.index(runner) < steps.index(guard) < steps.index(upload)
    for step in (runner, guard):
        assert step["if"] == (
            "${{ !cancelled() }}"
            if step["name"].startswith(("Run ", "Exercise "))
            else "always()"
        )
        assert not step.get("continue-on-error", False)
        assert "||" not in step["run"]
    assert_runtime_tmpdir(job)
    assert upload["if"] == "always()"
    assert upload["uses"] == "actions/upload-artifact@v4"
    assert not upload.get("continue-on-error", False)
    assert (
        "${{ runner.temp }}/wavedl-browser-ci/genuine-broker-overflow-browser.json"
        in upload["with"]["path"].splitlines()
    )


@pytest.mark.parametrize("event", ["push", "pull_request"])
def test_cold_offline_and_pending_cancel_changes_trigger_browser_lane(workflow, event):
    triggers = workflow.get("on", workflow.get(True))
    assert {
        "tools/run_cold_offline_browser_acceptance.mjs",
        "tools/verify_cold_offline_browser_report.mjs",
        "tools/verify_cold_offline_browser_report.test.mjs",
        "tools/browser_pending_cancel_fixture.py",
        "tools/run_pending_cancel_browser_acceptance.mjs",
        "tools/verify_pending_cancel_browser_report.mjs",
        "tools/verify_pending_cancel_browser_report.test.mjs",
        "unit_tests/test_browser_pending_cancel_fixture.py",
    }.issubset(triggers[event]["paths"])


def test_cold_offline_and_pending_cancel_live_gates_are_mandatory(workflow):
    steps = workflow["jobs"]["chromium-cpu"]["steps"]
    commands = "\n".join(step.get("run", "") for step in steps)
    for command in (
        "node tools/run_cold_offline_browser_acceptance.mjs",
        "node tools/verify_cold_offline_browser_report.mjs",
        "node tools/run_pending_cancel_browser_acceptance.mjs",
        "node tools/verify_pending_cancel_browser_report.mjs",
    ):
        assert command in commands
    cold_runner = next(
        step
        for step in steps
        if "node tools/run_cold_offline_browser_acceptance.mjs" in step.get("run", "")
    )
    cold_guard = next(
        step
        for step in steps
        if step.get("run", "").startswith(
            "node tools/verify_cold_offline_browser_report.mjs"
        )
    )
    pending_runner = next(
        step
        for step in steps
        if step.get("run", "").startswith(
            "node tools/run_pending_cancel_browser_acceptance.mjs"
        )
    )
    pending_guard = next(
        step
        for step in steps
        if step.get("run", "").startswith(
            "node tools/verify_pending_cancel_browser_report.mjs"
        )
    )
    for step in (cold_runner, cold_guard, pending_runner, pending_guard):
        assert step["if"] == (
            "${{ !cancelled() }}"
            if step["name"].startswith(("Run ", "Exercise "))
            else "always()"
        )
        assert not step.get("continue-on-error", False)
        assert "||" not in step["run"]
    assert steps.index(cold_runner) < steps.index(cold_guard)
    assert 'WAVEDL_PYTHON="$(python -c' in cold_runner["run"]
    assert "print(sys.executable)" in cold_runner["run"]
    assert steps.index(pending_runner) < steps.index(pending_guard)
    assert any(
        "cold-offline-browser.json" in line
        for line in steps[-1]["with"]["path"].splitlines()
    )
    assert any(
        "pending-cancel-browser.json" in line
        for line in steps[-1]["with"]["path"].splitlines()
    )


def test_catalogue_fault_browser_gate_and_cleanup_guard_are_mandatory(workflow):
    triggers = workflow.get("on", workflow.get(True))
    for event in ("push", "pull_request"):
        assert {
            "tools/browser_catalogue_fault_fixture.py",
            "tools/run_catalogue_fault_browser_acceptance.mjs",
            "tools/verify_catalogue_fault_browser_report.mjs",
            "tools/verify_catalogue_fault_browser_report.test.mjs",
            "unit_tests/test_browser_catalogue_fault_fixture.py",
        }.issubset(triggers[event]["paths"])
    steps = workflow["jobs"]["chromium-cpu"]["steps"]
    runner = next(
        step
        for step in steps
        if step.get("run", "").startswith(
            "node tools/run_catalogue_fault_browser_acceptance.mjs"
        )
    )
    guard = next(
        step
        for step in steps
        if step.get("run", "").startswith(
            "node tools/verify_catalogue_fault_browser_report.mjs"
        )
    )
    for step in (runner, guard):
        assert step["if"] == (
            "${{ !cancelled() }}"
            if step["name"].startswith(("Run ", "Exercise "))
            else "always()"
        )
        assert not step.get("continue-on-error", False)
        assert "||" not in step["run"]
    assert steps.index(runner) < steps.index(guard) < len(steps) - 1
    assert (
        "${{ runner.temp }}/wavedl-browser-ci/catalogue-fault-browser/catalogue-fault.json"
        in steps[-1]["with"]["path"].splitlines()
    )


@pytest.mark.parametrize("event", ["push", "pull_request"])
def test_preset_and_preview_fault_changes_trigger_browser_lane(workflow, event):
    triggers = workflow.get("on", workflow.get(True))
    paths = triggers[event]["paths"]
    for path in (
        "tools/browser_preset_import.mjs",
        "tools/browser_preset_import.test.mjs",
        "tools/run_preset_import_browser_acceptance.mjs",
        "tools/verify_preset_import_browser_report.mjs",
        "tools/verify_preset_import_browser_report.test.mjs",
        "tools/browser_preview_fault_fixture.py",
        "tools/run_preview_fault_browser_acceptance.mjs",
        "tools/verify_preview_fault_browser_report.mjs",
        "tools/verify_preview_fault_browser_report.test.mjs",
        "unit_tests/daemon/test_browser_preview_fault_fixture.py",
        "tools/browser_mapped_autoplot_fixture.py",
        "tools/run_mapped_autoplot_browser_acceptance.mjs",
        "tools/verify_mapped_autoplot_browser_report.mjs",
        "tools/verify_mapped_autoplot_browser_report.test.mjs",
        "tools/verify_mapped_autoplot_negative_report.mjs",
        "tools/verify_mapped_autoplot_negative_report.test.mjs",
        "unit_tests/daemon/test_browser_mapped_autoplot_fixture.py",
    ):
        assert paths.count(path) == 1


@pytest.mark.parametrize(
    ("case", "report"),
    [("preset_import", "preset-import"), ("preview_fault", "preview-fault")],
)
def test_preset_and_preview_fault_contracts_and_browser_guards_are_mandatory(
    workflow, case, report
):
    steps = workflow["jobs"]["chromium-cpu"]["steps"]
    commands = "\n".join(step.get("run", "") for step in steps)
    assert f"tools/verify_{case}_browser_report.test.mjs" in commands
    if case == "preset_import":
        assert "node --test tools/browser_preset_import.test.mjs" in commands
    else:
        assert (
            "python -m pytest unit_tests/daemon/test_browser_preview_fault_fixture.py -q"
            in commands
        )
    runner = next(
        step
        for step in steps
        if step.get("run")
        == f'node tools/run_{case}_browser_acceptance.mjs "$TMPDIR/{report}-browser"'
    )
    guard = next(
        step
        for step in steps
        if step.get("run") == f"node tools/verify_{case}_browser_report.mjs "
        f'"$TMPDIR/{report}-browser/{report}.json"'
    )
    for step in (runner, guard):
        assert step["if"] == (
            "${{ !cancelled() }}"
            if step["name"].startswith(("Run ", "Exercise "))
            else "always()"
        )
        assert not step.get("continue-on-error", False)
        assert "||" not in step["run"]
    assert steps.index(runner) < steps.index(guard) < len(steps) - 1
    assert (
        f"${{{{ runner.temp }}}}/wavedl-browser-ci/{report}-browser/{report}.json"
        in steps[-1]["with"]["path"].splitlines()
    )


def test_mapped_autoplot_negative_fault_guards_are_mandatory(workflow):
    steps = workflow["jobs"]["chromium-cpu"]["steps"]
    for fault in ("failed", "uncertain"):
        runner = next(
            step
            for step in steps
            if step.get("run")
            == "node tools/run_mapped_autoplot_browser_acceptance.mjs "
            f'"$TMPDIR/mapped-autoplot-{fault}-browser" {fault}'
        )
        guard = next(
            step
            for step in steps
            if step.get("run")
            == "node tools/verify_mapped_autoplot_negative_report.mjs "
            f'"$TMPDIR/mapped-autoplot-{fault}-browser/mapped-autoplot.json" {fault}'
        )
        assert steps.index(runner) < steps.index(guard) < len(steps) - 1
        for step in (runner, guard):
            assert step["if"] == (
                "${{ !cancelled() }}"
                if step["name"].startswith(("Run ", "Exercise "))
                else "always()"
            )
            assert not step.get("continue-on-error", False)
            assert "||" not in step["run"]
        assert (
            f"${{{{ runner.temp }}}}/wavedl-browser-ci/mapped-autoplot-{fault}-browser/mapped-autoplot.json"
            in steps[-1]["with"]["path"].splitlines()
        )
