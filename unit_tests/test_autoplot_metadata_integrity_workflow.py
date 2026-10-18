"""Additive checksum browser gate cannot replace baseline or hide cleanup failures."""

import subprocess
from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/daemon-browser-integration.yml"
NAME = "autoplot-metadata-integrity"


def workflow():
    return yaml.safe_load(WORKFLOW.read_text())


def guard_step():
    return next(
        step
        for step in workflow()["jobs"]["chromium-cpu"]["steps"]
        if "verifyAutoplotMetadataIntegrityReport" in step.get("run", "")
    )


def test_integrity_run_and_guard_are_required_and_additive_to_baseline_and_partial():
    steps = workflow()["jobs"]["chromium-cpu"]["steps"]
    runner = next(step for step in steps if f"--case={NAME}" in step.get("run", ""))
    guard = guard_step()
    for step in (runner, guard):
        assert step["if"] == "always()"
        assert not step.get("continue-on-error", False)
        assert "||" not in step["run"]
        assert f'"$TMPDIR/{NAME}"' in step["run"]
    assert f'TMPDIR="$TMPDIR/{NAME}" node tools/run_web_acceptance.mjs' in runner["run"]
    assert "assert.equal(entries.length, 1" in guard["run"]
    assert "info.isDirectory() && !info.isSymbolicLink()" in guard["run"]
    assert "join(workspace, 'summary.json')" in guard["run"]
    assert steps.index(runner) < steps.index(guard)
    assert any(step.get("run") == "node tools/run_web_acceptance.mjs" for step in steps)
    assert any(
        step.get("run") == 'node tools/verify_browser_ci_report.mjs "$TMPDIR"'
        and step["if"] == "always()"
        for step in steps
    )
    for mode in ("fallback", "refusal"):
        assert any(
            f"--case=partial-best-{mode}" in step.get("run", "") for step in steps
        )


def test_integrity_contracts_triggers_and_nonsecret_uploads():
    value = workflow()
    triggers = value.get("on", value.get(True))
    assert set(triggers["push"]["paths"]) == set(triggers["pull_request"]["paths"])
    required = {
        "tools/run_web_acceptance.mjs",
        "tools/browser_daemon_fixture.py",
        "tools/run_autoplot_metadata_integrity_browser_acceptance.test.mjs",
        "tools/verify_autoplot_metadata_integrity_report.mjs",
        "tools/verify_autoplot_metadata_integrity_report.test.mjs",
        "unit_tests/test_browser_autoplot_metadata_integrity_fixture.py",
        "unit_tests/test_autoplot_metadata_integrity_workflow.py",
    }
    for event in ("push", "pull_request"):
        assert required.issubset(triggers[event]["paths"])
    steps = value["jobs"]["chromium-cpu"]["steps"]
    contracts = next(
        step
        for step in steps
        if "node --test tools/run_autoplot_metadata_integrity_browser_acceptance.test.mjs"
        in step.get("run", "")
    )
    for path in required - {
        "tools/run_web_acceptance.mjs",
        "tools/browser_daemon_fixture.py",
        "tools/verify_autoplot_metadata_integrity_report.mjs",
    }:
        assert path in contracts["run"]
    assert not contracts.get("continue-on-error", False)
    upload = next(
        step
        for step in steps
        if step.get("uses", "").startswith("actions/upload-artifact@")
    )
    paths = upload["with"]["path"].splitlines()
    actual = [path for path in paths if f"/{NAME}/" in path]
    prefix = "${{ runner.temp }}/wavedl-browser-ci/" + NAME
    assert actual == [
        f"{prefix}/wavedl-browser-acceptance-*/summary.json",
        f"{prefix}/wavedl-browser-acceptance-*/{NAME}.json",
    ]
    assert upload["if"] == "always()"


@pytest.mark.parametrize("fault", ["missing", "duplicate", "foreign", "symlink"])
def test_integrity_ci_discovery_rejects_unowned_workspaces(tmp_path, fault):
    if fault == "duplicate":
        for suffix in ("one", "two"):
            (tmp_path / f"wavedl-browser-acceptance-{suffix}").mkdir()
    elif fault == "foreign":
        (tmp_path / "unowned").mkdir()
    elif fault == "symlink":
        target = tmp_path.parent / "integrity-target"
        target.mkdir()
        (tmp_path / "wavedl-browser-acceptance-linked").symlink_to(target)
    script = guard_step()["run"].split("<<'JS'\n", 1)[1].rsplit("\nJS", 1)[0]
    result = subprocess.run(
        ["node", "--input-type=module", "-", str(tmp_path)],
        input=script,
        text=True,
        capture_output=True,
        cwd=ROOT,
        check=False,
        timeout=10,
    )
    assert result.returncode != 0
    assert "AssertionError" in result.stderr
