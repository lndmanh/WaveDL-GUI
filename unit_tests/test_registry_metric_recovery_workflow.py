"""Additive metric F04 gates cannot silently weaken the original hello matrix."""

import os
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/daemon-browser-integration.yml"
PREFIX = "${{ runner.temp }}/wavedl-browser-ci/"
ORDERS = ("projection-cursor", "cursor-projection")
RECOVERIES = ("rebuild", "ingest")


def _workflow():
    return yaml.safe_load(WORKFLOW.read_text())


def _steps():
    return _workflow()["jobs"]["chromium-cpu"]["steps"]


def _guard():
    return next(
        step
        for step in _steps()
        if "python tools/verify_registry_metric_http_recovery_report.py"
        in step.get("run", "")
    )


def test_metric_crash_matrix_and_strict_four_report_gate_are_mandatory():
    steps = _steps()
    run = next(
        step
        for step in steps
        if step.get("run", "").startswith(
            "python -m pytest unit_tests/daemon/test_registry_metric_http_recovery.py "
        )
    )
    guard = _guard()
    for step in (run, guard):
        assert step["if"] == "always()"
        assert not step.get("continue-on-error", False)
        assert "||" not in step["run"]
        assert "--junitxml" in step["run"] or "ET.parse" in step["run"]
    assert steps.index(run) < steps.index(guard)
    assert run["env"] == {
        "WAVEDL_REGISTRY_METRIC_RECOVERY_REPORT_DIR": PREFIX
        + "registry-metric-http-recovery"
    }
    line = guard["run"].splitlines()[0]
    assert line.split()[:2] == [
        "python",
        "tools/verify_registry_metric_http_recovery_report.py",
    ]
    assert set(line.split()[2:]) == {
        f'"$TMPDIR/registry-metric-http-recovery/registry-metric-http-recovery-{order}-{recovery}.json"'
        for order in ORDERS
        for recovery in RECOVERIES
    }
    assert len(line.split()[2:]) == 4
    assert any(
        "unit_tests/test_registry_metric_recovery_workflow.py" in step.get("run", "")
        for step in steps
    )


def test_metric_workflow_has_symmetric_triggers_and_explicit_report_uploads():
    value = _workflow()
    triggers = value.get("on", value.get(True))
    assert set(triggers["push"]["paths"]) == set(triggers["pull_request"]["paths"])
    required = {
        "unit_tests/daemon/test_registry_metric_http_recovery.py",
        "tools/verify_registry_metric_http_recovery_report.py",
        "unit_tests/test_registry_metric_recovery_workflow.py",
    }
    assert required <= set(triggers["push"]["paths"])
    upload = next(
        step
        for step in _steps()
        if step.get("uses", "").startswith("actions/upload-artifact@")
    )
    assert upload["if"] == "always()"
    actual = {
        path
        for path in upload["with"]["path"].splitlines()
        if "/registry-metric-http-recovery" in path
    }
    assert actual == {PREFIX + "registry-metric-http-recovery.xml"} | {
        PREFIX
        + f"registry-metric-http-recovery/registry-metric-http-recovery-{order}-{recovery}.json"
        for order in ORDERS
        for recovery in RECOVERIES
    }


def test_original_hello_matrix_guard_remains_exactly_33_and_strict_four():
    guard = next(
        step
        for step in _steps()
        if "python tools/verify_registry_http_recovery_report.py" in step.get("run", "")
    )
    assert guard["if"] == "always()"
    assert "assert len(cases) == 33" in guard["run"]
    assert '"unit_tests.daemon.test_registry_http_recovery"' in guard["run"]
    assert 'for kind in ("skipped", "failure", "error")' in guard["run"]
    assert len(guard["run"].splitlines()[0].split()[2:]) == 4


@pytest.mark.parametrize(
    "fault",
    [
        None,
        "missing",
        "duplicate",
        "wrong-case",
        "wrong-class",
        "skipped",
        "failure",
        "error",
    ],
)
def test_exact_ci_junit_script_rejects_missing_duplicate_foreign_or_skipped_cases(
    tmp_path, fault
):
    names = [
        f"test_metric_transaction_sigkill_preserves_prefix_and_recovers_once[{recovery}-{order}]"
        for recovery in RECOVERIES
        for order in ORDERS
    ] + [f"guard-contract-{index}" for index in range(29)]
    root = ET.Element("testsuites")
    suite = ET.SubElement(root, "testsuite")
    for name in names:
        ET.SubElement(
            suite,
            "testcase",
            classname="unit_tests.daemon.test_registry_metric_http_recovery",
            name=name,
        )
    if fault == "missing":
        suite.remove(suite[0])
    elif fault == "duplicate":
        suite[0].set("name", suite[1].get("name"))
    elif fault == "wrong-case":
        suite[0].set("name", "test_metric_transaction_unknown")
    elif fault == "wrong-class":
        suite[0].set("classname", "other.suite")
    elif fault:
        ET.SubElement(suite[0], fault)
    ET.ElementTree(root).write(tmp_path / "registry-metric-http-recovery.xml")
    script = _guard()["run"].split("<<'PY'\n", 1)[1].rsplit("\nPY", 1)[0]
    result = subprocess.run(
        [sys.executable, "-"],
        input=script,
        capture_output=True,
        text=True,
        env={**os.environ, "TMPDIR": str(tmp_path)},
        timeout=10,
        check=False,
    )
    assert (result.returncode == 0) == (fault is None), result.stderr
