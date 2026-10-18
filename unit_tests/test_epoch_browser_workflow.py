"""Keep the additive epoch browser gate mandatory and its evidence scoped."""

from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/daemon-browser-integration.yml"


def test_epoch_browser_acceptance_and_strict_guard_are_mandatory():
    """An unsuccessful run or current-file verifier must fail the browser job."""
    workflow = yaml.safe_load(WORKFLOW.read_text())
    steps = workflow["jobs"]["chromium-cpu"]["steps"]
    runner = next(
        step
        for step in steps
        if "node tools/run_epoch_metric_browser_acceptance.mjs" in step.get("run", "")
    )
    verifier = next(
        step
        for step in steps
        if "node tools/verify_epoch_metric_browser_report.mjs" in step.get("run", "")
    )
    for step in (runner, verifier):
        assert step["if"] == "always()"
        assert not step.get("continue-on-error", False)
        assert '"$TMPDIR/epoch-metrics.json"' in step["run"]
        assert "||" not in step["run"]
    assert steps.index(runner) < steps.index(verifier)
    assert any(
        "node --test tools/verify_epoch_metric_browser_report.test.mjs"
        in step.get("run", "")
        for step in steps
    )


def test_epoch_browser_outputs_and_trigger_paths_are_explicit():
    """Collect only reports/screenshots, never fixture profiles or credentials."""
    workflow = yaml.safe_load(WORKFLOW.read_text())
    # PyYAML's YAML 1.1 loader treats the unquoted GitHub key `on` as True.
    triggers = workflow.get("on", workflow.get(True))
    required = {
        "tools/epoch_metric_plateau_model.py",
        "tools/epoch_metric_browser_fixture.py",
        "tools/epoch_metric_browser_evidence.py",
        "tools/run_epoch_metric_browser_acceptance.mjs",
        "tools/verify_epoch_metric_browser_report.mjs",
        "tools/verify_epoch_metric_browser_report.test.mjs",
        "unit_tests/test_epoch_browser_workflow.py",
    }
    for event in ("push", "pull_request"):
        assert required.issubset(triggers[event]["paths"])
    steps = workflow["jobs"]["chromium-cpu"]["steps"]
    upload = next(
        step
        for step in steps
        if step.get("uses", "").startswith("actions/upload-artifact@")
    )
    assert upload["if"] == "always()"
    paths = upload["with"]["path"].splitlines()
    epoch_paths = [path for path in paths if "/epoch-metrics" in path]
    prefix = "${{ runner.temp }}/wavedl-browser-ci/epoch-metrics.json"
    assert epoch_paths == [prefix, f"{prefix}.first.png", f"{prefix}.final.png"]
