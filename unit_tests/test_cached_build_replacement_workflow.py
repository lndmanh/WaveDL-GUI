"""Controlled factory build replacement is isolated and additive in CI."""

import subprocess
from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/daemon-browser-integration.yml"
NAME = "cached-build-replacement-browser"
PATHS = {
    "tools/browser_build_replacement_fixture.py",
    "tools/browser_controller_identity.mjs",
    "tools/browser_controller_identity.test.mjs",
    "tools/run_web_acceptance.mjs",
    "tools/run_cached_build_replacement_browser_acceptance.test.mjs",
    "tools/verify_cached_build_replacement_report.mjs",
    "tools/verify_cached_build_replacement_report.test.mjs",
    "unit_tests/test_browser_build_replacement_fixture.py",
    "unit_tests/test_cached_build_replacement_workflow.py",
}


def workflow():
    return yaml.safe_load(WORKFLOW.read_text())


def guard_step():
    return next(
        step
        for step in workflow()["jobs"]["chromium-cpu"]["steps"]
        if "verifyCachedBuildReplacementReport" in step.get("run", "")
    )


def test_gate_is_mandatory_isolated_and_additive():
    steps = workflow()["jobs"]["chromium-cpu"]["steps"]
    runner = next(
        step
        for step in steps
        if "--case=cached-build-replacement" in step.get("run", "")
    )
    guard = guard_step()
    for step in (runner, guard):
        assert step["if"] == "always()"
        assert not step.get("continue-on-error", False)
        assert "||" not in step["run"]
        assert f'"$TMPDIR/{NAME}"' in step["run"]
    assert (
        f'TMPDIR="$TMPDIR/{NAME}" node tools/run_web_acceptance.mjs '
        "--case=cached-build-replacement" in runner["run"]
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


def test_symmetric_paths_contracts_and_report_only_upload():
    value = workflow()
    triggers = value.get("on", value.get(True))
    assert set(triggers["push"]["paths"]) == set(triggers["pull_request"]["paths"])
    for event in ("push", "pull_request"):
        assert PATHS.issubset(triggers[event]["paths"])
    steps = value["jobs"]["chromium-cpu"]["steps"]
    contracts = next(
        step
        for step in steps
        if "node --test tools/run_cached_build_replacement_browser_acceptance.test.mjs"
        in step.get("run", "")
    )
    for path in PATHS:
        if path.endswith(".test.mjs") or path.startswith("unit_tests/"):
            assert path in contracts["run"]
    assert not contracts.get("continue-on-error", False)
    upload = next(
        step
        for step in steps
        if step.get("uses", "").startswith("actions/upload-artifact@")
    )
    prefix = "${{ runner.temp }}/wavedl-browser-ci/" + NAME
    assert [
        path for path in upload["with"]["path"].splitlines() if f"/{NAME}/" in path
    ] == [
        f"{prefix}/wavedl-browser-acceptance-*/summary.json",
        f"{prefix}/wavedl-browser-acceptance-*/cached-build-replacement.json",
    ]
    assert upload["if"] == "always()"


@pytest.mark.parametrize("fault", ["missing", "duplicate", "foreign", "symlink"])
def test_discovery_refuses_unowned_workspaces(tmp_path, fault):
    if fault == "duplicate":
        for suffix in ("one", "two"):
            (tmp_path / f"wavedl-browser-acceptance-{suffix}").mkdir()
    elif fault == "foreign":
        (tmp_path / "unowned").mkdir()
    elif fault == "symlink":
        target = tmp_path.parent / "cached-build-target"
        target.mkdir()
        (tmp_path / "wavedl-browser-acceptance-linked").symlink_to(target)
    script = guard_step()["run"].split("<<'JS'\n", 1)[1].rsplit("\nJS", 1)[0]
    result = subprocess.run(
        ["node", "--input-type=module", "-", str(tmp_path)],
        input=script,
        text=True,
        capture_output=True,
        cwd=ROOT,
        timeout=10,
        check=False,
    )
    assert result.returncode != 0
    assert "AssertionError" in result.stderr
