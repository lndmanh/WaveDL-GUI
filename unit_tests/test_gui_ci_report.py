"""The mandatory Qt acceptance lane cannot silently pass skipped/missing cases."""

import importlib.util
import os
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest


spec = importlib.util.spec_from_file_location(
    "verify_gui_ci_report",
    Path(__file__).resolve().parents[1] / "tools" / "verify_gui_ci_report.py",
)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


def report(tmp_path, *, mapped=False):
    required = guard.MAPPED_CASES if mapped else guard.REQUIRED_CASES
    expected_count = sum(len(names) for names in required.values())
    root = ET.Element(
        "testsuites",
        tests=str(expected_count),
        skipped="0",
        failures="0",
        errors="0",
    )
    suite = ET.SubElement(
        root,
        "testsuite",
        tests=str(expected_count),
        skipped="0",
        failures="0",
        errors="0",
    )
    for module, names in required.items():
        for name in sorted(names):
            ET.SubElement(suite, "testcase", classname=module, name=name)
    return root, suite, tmp_path / "report.xml"


def test_complete_report_passes(tmp_path):
    root, _suite, path = report(tmp_path)
    ET.ElementTree(root).write(path)
    assert guard.verify_report(path) == 29


def test_mapped_report_is_separate_from_baseline(tmp_path):
    root, _suite, path = report(tmp_path, mapped=True)
    ET.ElementTree(root).write(path)
    assert guard.verify_report(path, mapped=True) == 6
    with pytest.raises(ValueError, match="required set"):
        guard.verify_report(path)


@pytest.mark.parametrize("mutation", ["missing", "duplicate", "skipped", "failure"])
def test_mapped_gate_rejects_incomplete_or_unsuccessful_cases(tmp_path, mutation):
    root, suite, path = report(tmp_path, mapped=True)
    if mutation == "missing":
        suite.remove(suite[0])
    elif mutation == "duplicate":
        ET.SubElement(suite, "testcase", **suite[0].attrib)
    else:
        ET.SubElement(suite[0], mutation)
    root.set("tests", str(len(suite)))
    suite.set("tests", str(len(suite)))
    ET.ElementTree(root).write(path)
    with pytest.raises(ValueError):
        guard.verify_report(path, mapped=True)


def test_baseline_report_cannot_substitute_for_mapped_gate(tmp_path):
    root, _suite, path = report(tmp_path)
    ET.ElementTree(root).write(path)
    with pytest.raises(ValueError, match="required set"):
        guard.verify_report(path, mapped=True)


@pytest.mark.parametrize("outcome", ["skipped", "failure", "error"])
def test_unsuccessful_case_fails(tmp_path, outcome):
    root, suite, path = report(tmp_path)
    ET.SubElement(suite[0], outcome)
    ET.ElementTree(root).write(path)
    with pytest.raises(ValueError, match="Unsuccessful"):
        guard.verify_report(path)


@pytest.mark.parametrize("mutation", ["missing", "duplicate", "collection_skip"])
def test_incomplete_or_duplicate_report_fails(tmp_path, mutation):
    root, suite, path = report(tmp_path)
    if mutation == "missing":
        suite.remove(suite[0])
    elif mutation == "duplicate":
        ET.SubElement(suite, "testcase", **suite[0].attrib)
    else:
        suite.set("skipped", "1")
    root.set("tests", str(len(suite)))
    suite.set("tests", str(len(suite)))
    ET.ElementTree(root).write(path)
    with pytest.raises(ValueError):
        guard.verify_report(path)


def test_absent_report_fails(tmp_path):
    with pytest.raises(FileNotFoundError):
        guard.verify_report(tmp_path / "absent.xml")


@pytest.mark.parametrize("outcome", ["skipped", "failures", "errors"])
def test_root_unsuccessful_aggregate_fails(tmp_path, outcome):
    root, _suite, path = report(tmp_path)
    root.set(outcome, "1")
    ET.ElementTree(root).write(path)
    with pytest.raises(ValueError, match="report"):
        guard.verify_report(path)


@pytest.mark.parametrize("attribute", ["tests", "skipped", "failures", "errors"])
def test_root_aggregate_mismatch_or_invalid_value_fails(tmp_path, attribute):
    root, _suite, path = report(tmp_path)
    root.set(attribute, "15" if attribute == "tests" else "not-an-integer")
    ET.ElementTree(root).write(path)
    with pytest.raises(ValueError):
        guard.verify_report(path)


def test_suite_tests_count_mismatch_fails(tmp_path):
    root, suite, path = report(tmp_path)
    suite.set("tests", "15")
    ET.ElementTree(root).write(path)
    with pytest.raises(ValueError, match="suite tests count"):
        guard.verify_report(path)


def test_unexpected_case_fails(tmp_path):
    root, suite, path = report(tmp_path)
    ET.SubElement(suite, "testcase", classname="unexpected.module", name="test_extra")
    root.set("tests", str(len(suite)))
    suite.set("tests", str(len(suite)))
    ET.ElementTree(root).write(path)
    with pytest.raises(ValueError, match="unexpected"):
        guard.verify_report(path)


@pytest.mark.parametrize("scope", ["root", "suite"])
@pytest.mark.parametrize("attribute", ["tests", "skipped", "failures", "errors"])
@pytest.mark.parametrize("value", ["-1", "invalid"])
def test_invalid_aggregate_fails(tmp_path, scope, attribute, value):
    root, suite, path = report(tmp_path)
    (root if scope == "root" else suite).set(attribute, value)
    ET.ElementTree(root).write(path)
    with pytest.raises(ValueError):
        guard.verify_report(path)


def test_complete_report_without_optional_aggregates_passes(tmp_path):
    root, suite, path = report(tmp_path)
    root.attrib.clear()
    suite.attrib.clear()
    ET.ElementTree(root).write(path)
    assert guard.verify_report(path) == 29


def test_complete_testsuite_root_passes(tmp_path):
    _root, suite, path = report(tmp_path)
    ET.ElementTree(suite).write(path)
    assert guard.verify_report(path) == 29


def test_malformed_unexpected_cases_fail_closed(tmp_path):
    root, suite, path = report(tmp_path)
    ET.SubElement(suite, "testcase")
    ET.SubElement(suite, "testcase", classname="unexpected.module", name="test_extra")
    root.set("tests", str(len(suite)))
    suite.set("tests", str(len(suite)))
    ET.ElementTree(root).write(path)
    with pytest.raises(ValueError, match="unexpected"):
        guard.verify_report(path)


@pytest.mark.parametrize(
    "tag", ["report", "testcase", "results", "{foreign}testsuites"]
)
def test_non_junit_root_rejected_even_with_required_cases(tmp_path, tag):
    root, _suite, path = report(tmp_path)
    root.tag = tag
    ET.ElementTree(root).write(path)
    with pytest.raises(ValueError, match="unsupported root"):
        guard.verify_report(path)


@pytest.mark.parametrize("value", ["+16", " 16", "16 ", "1_6", "١٦", "", "16.0"])
def test_non_decimal_aggregate_is_not_silently_normalized(tmp_path, value):
    root, _suite, path = report(tmp_path)
    root.set("tests", value)
    ET.ElementTree(root).write(path)
    with pytest.raises(ValueError, match="Invalid"):
        guard.verify_report(path)


def test_report_byte_bound_before_parsing(tmp_path, monkeypatch):
    path = tmp_path / "large.xml"
    path.write_bytes(b"x" * 65)
    monkeypatch.setattr(guard, "MAX_REPORT_BYTES", 64)
    with pytest.raises(ValueError, match="byte bound"):
        guard.verify_report(path)


@pytest.mark.parametrize(
    "content", [b"", b"\xff", b"<!DOCTYPE testsuites><testsuites/>"]
)
def test_empty_invalid_encoding_and_entity_declarations_fail(tmp_path, content):
    path = tmp_path / "invalid.xml"
    path.write_bytes(content)
    with pytest.raises(ValueError):
        guard.verify_report(path)


def test_report_symlink_rejected(tmp_path):
    root, _suite, path = report(tmp_path)
    ET.ElementTree(root).write(path)
    link = tmp_path / "link.xml"
    try:
        link.symlink_to(path)
    except OSError:
        pytest.skip("Native symlink creation unavailable")
    with pytest.raises(ValueError, match="symlink"):
        guard.verify_report(link)


@pytest.mark.skipif(os.name != "posix", reason="Native nonblocking FIFO semantics")
def test_report_fifo_refused_without_waiting_for_a_writer(tmp_path):
    path = tmp_path / "report.pipe"
    os.mkfifo(path)
    with pytest.raises(ValueError, match="ordinary file"):
        guard.verify_report(path)
