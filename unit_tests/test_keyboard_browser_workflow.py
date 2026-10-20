"""The additive keyboard browser gate is mandatory, bounded and report-only."""

import subprocess
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/daemon-browser-integration.yml"
RUNNER = "tools/run_keyboard_browser_acceptance.mjs"
VERIFIER = "tools/verify_keyboard_browser_report.mjs"
CONTRACTS = "tools/verify_keyboard_browser_report.test.mjs"
REPORT = "$TMPDIR/keyboard-browser/keyboard-browser.json"


def workflow():
    return yaml.safe_load(WORKFLOW.read_text())


def steps():
    return workflow()["jobs"]["chromium-cpu"]["steps"]


def test_keyboard_gate_is_additive_and_requires_private_empty_report_directory():
    value = steps()
    runner = next(step for step in value if f"node {RUNNER}" in step.get("run", ""))
    guard = next(step for step in value if f"node {VERIFIER}" in step.get("run", ""))
    assert runner["if"] == "${{ !cancelled() }}"
    assert runner["run"].splitlines() == [
        'mkdir -m 700 "$TMPDIR/keyboard-browser"',
        f'node {RUNNER} "$TMPDIR/keyboard-browser"',
    ]
    assert guard["if"] == "always()"
    assert guard["run"] == f'node {VERIFIER} "{REPORT}"'
    for step in (runner, guard):
        assert not step.get("continue-on-error", False)
        assert "||" not in step["run"]
        assert "if [" not in step["run"]
        assert "test -" not in step["run"]
    assert value.index(runner) < value.index(guard)
    assert any(step.get("run") == "node tools/run_web_acceptance.mjs" for step in value)
    assert any(
        step.get("run") == 'node tools/verify_browser_ci_report.mjs "$TMPDIR"'
        and step["if"] == "always()"
        for step in value
    )


def test_keyboard_triggers_and_contracts_cover_all_owned_files():
    value = workflow()
    triggers = value.get("on", value.get(True))
    assert set(triggers["push"]["paths"]) == set(triggers["pull_request"]["paths"])
    required = {
        RUNNER,
        VERIFIER,
        CONTRACTS,
        "unit_tests/test_keyboard_browser_workflow.py",
    }
    for event in ("push", "pull_request"):
        assert required.issubset(triggers[event]["paths"])
    contract = next(
        step for step in steps() if f"node --test {CONTRACTS}" in step.get("run", "")
    )
    assert (
        "python -m pytest --noconftest unit_tests/test_keyboard_browser_workflow.py"
        in contract["run"]
    )
    assert not contract.get("continue-on-error", False)


def test_keyboard_upload_is_only_the_nonsecret_final_report():
    upload = next(
        step
        for step in steps()
        if step.get("uses", "").startswith("actions/upload-artifact@")
    )
    actual = [
        path
        for path in upload["with"]["path"].splitlines()
        if "/keyboard-browser/" in path
    ]
    assert actual == [
        "${{ runner.temp }}/wavedl-browser-ci/keyboard-browser/keyboard-browser.json"
    ]
    assert all(not path.endswith("/**") for path in actual)
    source = (ROOT / VERIFIER).read_text()
    for name in (
        "browserSessionAbsent",
        "servicesClosed",
        "fixtureReaped",
        "listenerClosed",
        "ownedRootsRemoved",
        "submission_control",
        "execution_control",
    ):
        assert name in source


def test_keyboard_guard_fails_when_report_is_missing(tmp_path):
    result = subprocess.run(
        ["node", str(ROOT / VERIFIER), str(tmp_path / "missing.json")],
        check=False,
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode != 0
    assert "Keyboard browser evidence rejected" in result.stderr
    assert "verified" not in result.stdout
