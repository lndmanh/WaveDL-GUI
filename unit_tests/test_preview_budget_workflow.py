"""Preview resource-budget CI remains mandatory, additive and private-root safe."""

import subprocess
from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/daemon-browser-integration.yml"
NAME = "preview-budget-browser"


def workflow():
    return yaml.safe_load(WORKFLOW.read_text())


def guard_step():
    return next(
        step
        for step in workflow()["jobs"]["chromium-cpu"]["steps"]
        if "verifyPreviewBudgetFile" in step.get("run", "")
    )


def test_preview_budget_gate_is_mandatory_and_additive():
    steps = workflow()["jobs"]["chromium-cpu"]["steps"]
    runner = next(
        step
        for step in steps
        if "node tools/run_preview_budget_browser_acceptance.mjs" in step.get("run", "")
    )
    guard = guard_step()
    for step in (runner, guard):
        assert step["if"] == (
            "${{ !cancelled() }}"
            if step["name"].startswith(("Run ", "Exercise "))
            else "always()"
        )
        assert not step.get("continue-on-error", False)
        assert "||" not in step["run"]
        assert f'"$TMPDIR/{NAME}"' in step["run"]
    assert (
        f'TMPDIR="$TMPDIR/{NAME}" node tools/run_preview_budget_browser_acceptance.mjs'
        in runner["run"]
    )
    assert "assert.equal(entries.length, 1" in guard["run"]
    assert "info.isDirectory() && !info.isSymbolicLink()" in guard["run"]
    assert (
        "assert.deepEqual(await readdir(workspace), ['preview-budget.json'])"
        in guard["run"]
    )
    assert "join(workspace, 'preview-budget.json')" in guard["run"]
    assert steps.index(runner) < steps.index(guard)
    assert workflow()["jobs"]["chromium-cpu"]["timeout-minutes"] == 120
    assert any(step.get("run") == "node tools/run_web_acceptance.mjs" for step in steps)
    assert any(
        step.get("run") == 'node tools/verify_browser_ci_report.mjs "$TMPDIR"'
        and step["if"] == "always()"
        for step in steps
    )


def test_preview_budget_triggers_contracts_and_nonsecret_upload():
    value = workflow()
    triggers = value.get("on", value.get(True))
    assert set(triggers["push"]["paths"]) == set(triggers["pull_request"]["paths"])
    required = {
        "tools/browser_preview_budget_fixture.py",
        "tools/browser_preview_fault_fixture.py",
        "tools/browser_daemon_fixture.py",
        "tools/run_preview_budget_browser_acceptance.mjs",
        "tools/verify_preview_budget_browser_report.mjs",
        "tools/verify_preview_budget_browser_report.test.mjs",
        "unit_tests/daemon/test_preview_budget_acceptance.py",
        "unit_tests/test_preview_budget_workflow.py",
    }
    for event in ("push", "pull_request"):
        assert required.issubset(triggers[event]["paths"])
    steps = value["jobs"]["chromium-cpu"]["steps"]
    contracts = next(
        step
        for step in steps
        if "node --test tools/verify_preview_budget_browser_report.test.mjs"
        in step.get("run", "")
    )
    assert "unit_tests/daemon/test_preview_budget_acceptance.py" in contracts["run"]
    assert "unit_tests/test_preview_budget_workflow.py" in contracts["run"]
    assert not contracts.get("continue-on-error", False)
    upload = next(
        step
        for step in steps
        if step.get("uses", "").startswith("actions/upload-artifact@")
    )
    actual = [
        path for path in upload["with"]["path"].splitlines() if f"/{NAME}/" in path
    ]
    assert actual == [
        "${{ runner.temp }}/wavedl-browser-ci/preview-budget-browser/"
        "wavedl-preview-budget-*/preview-budget.json"
    ]
    assert upload["if"] == "always()"


@pytest.mark.parametrize(
    "fault", ["missing", "duplicate", "foreign", "symlink", "extra-file", "wrong-file"]
)
def test_preview_budget_discovery_rejects_unowned_or_inexact_evidence(tmp_path, fault):
    if fault == "duplicate":
        for suffix in ("one", "two"):
            (tmp_path / f"wavedl-preview-budget-{suffix}").mkdir()
    elif fault == "foreign":
        (tmp_path / "unowned").mkdir()
    elif fault == "symlink":
        target = tmp_path.parent / "preview-budget-target"
        target.mkdir()
        (tmp_path / "wavedl-preview-budget-linked").symlink_to(target)
    elif fault in {"extra-file", "wrong-file"}:
        workspace = tmp_path / "wavedl-preview-budget-owned"
        workspace.mkdir()
        (workspace / "unexpected.json").write_text("{}")
        if fault == "extra-file":
            (workspace / "preview-budget.json").write_text("{}")
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
