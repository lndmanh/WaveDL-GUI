"""Partial-best assembled browser gates remain mandatory and privately scoped."""

import subprocess
from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/daemon-browser-integration.yml"


def workflow():
    return yaml.safe_load(WORKFLOW.read_text())


def test_partial_best_gates_run_then_strictly_verify_single_owned_workspace():
    job = workflow()["jobs"]["chromium-cpu"]
    steps = job["steps"]
    for mode in ("fallback", "refusal"):
        name = f"partial-best-{mode}"
        runner = next(step for step in steps if f"--case={name}" in step.get("run", ""))
        guard = next(
            step
            for step in steps
            if "verifyPartialBestReport" in step.get("run", "")
            and f"record.name, '{name}'" in step["run"]
        )
        for step in (runner, guard):
            assert step["if"] == "always()"
            assert not step.get("continue-on-error", False)
            assert "||" not in step["run"]
            assert f'"$TMPDIR/{name}"' in step["run"]
        assert (
            f'TMPDIR="$TMPDIR/{name}" node tools/run_web_acceptance.mjs'
            in runner["run"]
        )
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
    assert job["timeout-minutes"] == 120


def test_partial_best_contracts_and_symmetric_triggers_are_required():
    value = workflow()
    triggers = value.get("on", value.get(True))
    assert set(triggers["push"]["paths"]) == set(triggers["pull_request"]["paths"])
    paths = {
        "tools/run_web_acceptance.mjs",
        "tools/browser_daemon_fixture.py",
        "tools/run_partial_best_browser_acceptance.test.mjs",
        "tools/verify_partial_best_browser_report.mjs",
        "tools/verify_partial_best_browser_report.test.mjs",
        "unit_tests/test_browser_partial_best_fixture.py",
        "unit_tests/test_partial_best_browser_workflow.py",
    }
    for event in ("push", "pull_request"):
        assert paths.issubset(triggers[event]["paths"])
    steps = value["jobs"]["chromium-cpu"]["steps"]
    contracts = next(
        step
        for step in steps
        if "node --test tools/run_partial_best_browser_acceptance.test.mjs"
        in step.get("run", "")
    )
    assert "tools/verify_partial_best_browser_report.test.mjs" in contracts["run"]
    assert "unit_tests/test_browser_partial_best_fixture.py" in contracts["run"]
    assert "unit_tests/test_partial_best_browser_workflow.py" in contracts["run"]
    assert not contracts.get("continue-on-error", False)


def test_partial_best_uploads_only_explicit_nonsecret_case_and_summary_json():
    steps = workflow()["jobs"]["chromium-cpu"]["steps"]
    upload = next(
        step
        for step in steps
        if step.get("uses", "").startswith("actions/upload-artifact@")
    )
    paths = upload["with"]["path"].splitlines()
    actual = [path for path in paths if "/partial-best-" in path]
    expected = []
    for mode in ("fallback", "refusal"):
        name = f"partial-best-{mode}"
        prefix = "${{ runner.temp }}/wavedl-browser-ci/" + name
        expected.extend(
            f"{prefix}/wavedl-browser-acceptance-*/{filename}"
            for filename in ("summary.json", f"{name}.json")
        )
    assert actual == expected
    assert upload["if"] == "always()"


@pytest.mark.parametrize("mode", ["fallback", "refusal"])
@pytest.mark.parametrize("fault", ["missing", "duplicate", "foreign", "symlink"])
def test_ci_discovery_rejects_missing_duplicate_foreign_or_linked_workspaces(
    tmp_path, mode, fault
):
    """Execute the exact CI discovery script, never the acceptance browser."""
    name = f"partial-best-{mode}"
    steps = workflow()["jobs"]["chromium-cpu"]["steps"]
    step = next(
        step
        for step in steps
        if "verifyPartialBestReport" in step.get("run", "")
        and f"record.name, '{name}'" in step["run"]
    )
    if fault == "duplicate":
        for suffix in ("one", "two"):
            (tmp_path / f"wavedl-browser-acceptance-{suffix}").mkdir()
    elif fault == "foreign":
        (tmp_path / "unowned").mkdir()
    elif fault == "symlink":
        target = tmp_path.parent / f"target-{mode}"
        target.mkdir()
        (tmp_path / "wavedl-browser-acceptance-linked").symlink_to(target)
    script = step["run"].split("<<'JS'\n", 1)[1].rsplit("\nJS", 1)[0]
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
