"""Keep the CPU CV cohort complete, successful, and mandatory in browser CI."""

import os
import shlex
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/daemon-browser-integration.yml"
FAMILY_COUNTS = {
    "unit_tests.test_cv_deterministic": 6,
    "unit_tests.test_cv_workers": 7,
    "unit_tests.test_cv_option_fidelity": 21,
    "unit_tests.test_cv_training_semantics": 20,
    "unit_tests.test_cv_physical_components": 11,
    "unit_tests.test_data_cv": 33,
}
COHORT_PATHS = {f"{family.replace('.', '/')}.py" for family in FAMILY_COUNTS}


@pytest.fixture
def workflow():
    return yaml.safe_load(WORKFLOW.read_text())


def _cohort_step(workflow):
    return next(
        step
        for step in workflow["jobs"]["chromium-cpu"]["steps"]
        if "python -m pytest unit_tests/test_cv_option_fidelity.py"
        in step.get("run", "")
    )


def _guard_step(workflow):
    return next(
        step
        for step in workflow["jobs"]["chromium-cpu"]["steps"]
        if step.get("name") == "Require all CV semantics cases with zero skips"
    )


def _guard_script(workflow):
    run = _guard_step(workflow)["run"]
    prefix = "python - <<'PY'\n"
    assert run.startswith(prefix)
    script, terminator = run[len(prefix) :].rsplit("\nPY", 1)
    assert not terminator.strip()
    return script


def _report():
    """Mirror pytest's single-suite report with class-qualified data CV cases."""
    root = ET.Element("testsuites")
    suite = ET.SubElement(
        root, "testsuite", tests="98", skipped="0", failures="0", errors="0"
    )
    for family, count in FAMILY_COUNTS.items():
        classname = (
            f"{family}.TestDataCV" if family.endswith("test_data_cv") else family
        )
        for index in range(count):
            ET.SubElement(
                suite, "testcase", classname=classname, name=f"test_case[{index}]"
            )
    return root, suite


def _run_guard(workflow, tmp_path, root=None):
    if root is not None:
        ET.ElementTree(root).write(tmp_path / "cv-option-fidelity.xml")
    return subprocess.run(
        [sys.executable, "-c", _guard_script(workflow)],
        env={**os.environ, "TMPDIR": str(tmp_path)},
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )


@pytest.mark.parametrize("event", ["push", "pull_request"])
def test_cv_cohort_and_contract_trigger_paths_are_explicit(workflow, event):
    """Changes to any cohort file, helper, or contract test trigger this lane."""
    triggers = workflow.get("on", workflow.get(True))
    required = COHORT_PATHS | {
        "src/wavedl/utils/cv_components.py",
        "unit_tests/test_cv_workflow.py",
        ".github/workflows/daemon-browser-integration.yml",
    }
    assert required.issubset(triggers[event]["paths"])


def test_cv_command_runs_all_six_files_without_skip_or_failure_escape(workflow):
    step = _cohort_step(workflow)
    tokens = shlex.split(step["run"])
    assert tokens[:3] == ["python", "-m", "pytest"]
    assert {token for token in tokens if token.endswith(".py")} == COHORT_PATHS
    assert "--junitxml=$TMPDIR/cv-option-fidelity.xml" in tokens
    assert not any(token in tokens[3:] for token in ("-k", "-m", "--collect-only"))
    assert "||" not in step["run"]
    assert not step.get("continue-on-error", False)
    assert not step.get("if")


def test_cv_guard_and_workflow_contract_tests_are_mandatory(workflow):
    steps = workflow["jobs"]["chromium-cpu"]["steps"]
    guard = _guard_step(workflow)
    assert guard["if"] == "always()"
    assert not guard.get("continue-on-error", False)
    assert "||" not in guard["run"]
    assert steps.index(_cohort_step(workflow)) < steps.index(guard)
    contract = next(
        step
        for step in steps
        if "pytest --noconftest unit_tests/test_cv_workflow.py" in step.get("run", "")
    )
    assert not contract.get("continue-on-error", False)
    assert not contract.get("if")
    assert "||" not in contract["run"]


def test_onecycle_update_and_resume_acceptance_is_mandatory(workflow):
    """The adjoining scientific-option gate cannot drop native CPU coverage."""
    path = "unit_tests/test_training_onecycle_accumulation.py"
    triggers = workflow.get("on", workflow.get(True))
    for event in ("push", "pull_request"):
        assert path in triggers[event]["paths"]
    steps = workflow["jobs"]["chromium-cpu"]["steps"]
    test = next(step for step in steps if f"pytest {path}" in step.get("run", ""))
    assert shlex.split(test["run"]) == [
        "python",
        "-m",
        "pytest",
        path,
        "--junitxml=$TMPDIR/onecycle-updates.xml",
    ]
    assert not test.get("continue-on-error", False) and not test.get("if")
    guard = next(
        step
        for step in steps
        if step.get("name")
        == "Require CPU and native DDP OneCycle acceptance with zero skips"
    )
    assert guard["if"] == "always()"
    assert not guard.get("continue-on-error", False)
    assert steps.index(test) < steps.index(guard)
    assert "assert len(cases) == 7" in guard["run"]
    assert '("skipped", "failure", "error")' in guard["run"]
    assert "||" not in guard["run"]
    assert "onecycle-updates.xml" in steps[-1]["with"]["path"]


def test_cv_guard_accepts_complete_production_shaped_report(workflow, tmp_path):
    root, _suite = _report()
    result = _run_guard(workflow, tmp_path, root)
    assert result.returncode == 0, result.stderr


def test_cv_guard_rejects_absent_report(workflow, tmp_path):
    result = _run_guard(workflow, tmp_path)
    assert result.returncode != 0
    assert "FileNotFoundError" in result.stderr


@pytest.mark.parametrize(
    "mutation",
    [
        "missing",
        "missing_deterministic_family",
        "duplicate_extra",
        "duplicate_replacement",
        "relabel_unknown_family",
        "relabel_known_family",
        "skipped",
        "error",
        "failure",
    ],
)
def test_cv_guard_rejects_incomplete_or_unsuccessful_report(
    workflow, tmp_path, mutation
):
    root, suite = _report()
    if mutation == "missing":
        suite.remove(suite[0])
    elif mutation == "missing_deterministic_family":
        for case in list(suite):
            if case.get("classname") == "unit_tests.test_cv_deterministic":
                suite.remove(case)
    elif mutation == "duplicate_extra":
        ET.SubElement(suite, "testcase", **suite[0].attrib)
    elif mutation == "duplicate_replacement":
        suite[1].attrib.update(suite[0].attrib)
    elif mutation == "relabel_unknown_family":
        suite[0].set("classname", "unit_tests.test_unrelated")
    elif mutation == "relabel_known_family":
        suite[0].set("classname", "unit_tests.test_cv_option_fidelity")
        suite[0].set("name", "test_relabelled_unique")
    else:
        ET.SubElement(suite[0], mutation)
    # Keep aggregate counts plausible: the guard must inspect the actual cases.
    suite.set("tests", str(len(suite)))
    result = _run_guard(workflow, tmp_path, root)
    assert result.returncode != 0
    assert "AssertionError" in result.stderr
