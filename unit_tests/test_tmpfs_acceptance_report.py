"""Fail-closed mutation tests for mandatory real-tmpfs JUnit evidence."""

import ast
import os
import stat
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from tools import verify_tmpfs_acceptance_report as guard


pytestmark = pytest.mark.skipif(
    os.name != "posix", reason="Linux tmpfs gate requires POSIX no-follow access"
)


# Captured shape of a genuine pytest report, without depending on an ephemeral
# acceptance run's path, mount, clock, hostname, or test-duration measurements.
REAL_PYTEST_REPORT = (
    '<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests">'
    '<testsuite name="pytest" errors="0" failures="0" skipped="0" tests="1" '
    'time="0.858" timestamp="2026-10-14T10:47:39.107375+00:00" '
    'hostname="99412763d869"><testcase '
    'classname="unit_tests.daemon.test_tmpfs_storage_acceptance" '
    'name="test_real_tmpfs_enospc_preserves_authority_and_recovers" '
    'time="0.752" /></testsuite></testsuites>'
)


@pytest.fixture
def report(tmp_path):
    # Resolve pytest's platform temp-root aliases before exercising strict paths.
    path = tmp_path.resolve() / "tmpfs.xml"
    path.write_text(REAL_PYTEST_REPORT, encoding="utf-8")
    return path


def _mutate(path, mutation):
    tree = ET.parse(path)
    root = tree.getroot()
    mutation(root, root[0], root[0][0])
    tree.write(path, encoding="utf-8", xml_declaration=True)


def test_genuine_pytest_shape_passes(report):
    assert guard.verify_report(report) == 1


def test_single_suite_root_passes(report):
    tree = ET.parse(report)
    ET.ElementTree(tree.getroot()[0]).write(report)
    assert guard.verify_report(report) == 1


def test_matching_root_aggregate_passes(report):
    _mutate(report, lambda root, _suite, _case: root.attrib.update(guard.COUNTS))
    assert guard.verify_report(report) == 1


@pytest.mark.parametrize("outcome", ["skipped", "failure", "error"])
def test_each_unsuccessful_outcome_rejected_even_with_zero_counts(report, outcome):
    _mutate(report, lambda _root, _suite, case: ET.SubElement(case, outcome))
    with pytest.raises(ValueError):
        guard.verify_report(report)


@pytest.mark.parametrize("attribute", list(guard.COUNTS))
@pytest.mark.parametrize("value", [None, "2", "-1", "+0", " 0", "0.0", "\u0660", ""])
def test_missing_malformed_or_contradictory_suite_counts_rejected(
    report, attribute, value
):
    def mutation(_root, suite, _case):
        if value is None:
            suite.attrib.pop(attribute)
        else:
            suite.set(attribute, value)

    _mutate(report, mutation)
    with pytest.raises(ValueError):
        guard.verify_report(report)


@pytest.mark.parametrize("attribute", list(guard.COUNTS))
def test_root_counts_cannot_contradict_suite(report, attribute):
    _mutate(report, lambda root, _suite, _case: root.set(attribute, "2"))
    with pytest.raises(ValueError):
        guard.verify_report(report)


@pytest.mark.parametrize("attribute", ["classname", "name"])
@pytest.mark.parametrize("value", [None, "", "foreign", "required[linux]"])
def test_identity_must_match_exactly(report, attribute, value):
    def mutation(_root, _suite, case):
        if value is None:
            case.attrib.pop(attribute)
        else:
            case.set(attribute, value)

    _mutate(report, mutation)
    with pytest.raises(ValueError):
        guard.verify_report(report)


@pytest.mark.parametrize("mutation", ["missing", "duplicate", "extra", "empty_suite"])
def test_missing_duplicate_or_broad_suite_is_not_proof(report, mutation):
    def mutate(root, suite, case):
        if mutation == "missing":
            suite.remove(case)
        elif mutation == "empty_suite":
            ET.SubElement(root, "testsuite", **guard.COUNTS)
        else:
            attributes = (
                case.attrib
                if mutation == "duplicate"
                else {
                    "classname": "unit_tests.daemon.test_optional_ml",
                    "name": "test_optional",
                }
            )
            ET.SubElement(suite, "testcase", **attributes)

    _mutate(report, mutate)
    with pytest.raises(ValueError):
        guard.verify_report(report)


def test_collection_skip_is_never_waived(report):
    def mutation(_root, suite, case):
        case.set("classname", "")
        case.set("name", guard.REQUIRED_CASE[0])
        suite.set("skipped", "1")
        ET.SubElement(case, "skipped")

    _mutate(report, mutation)
    with pytest.raises(ValueError):
        guard.verify_report(report)


def test_nested_outcome_cannot_hide_from_gate(report):
    _mutate(
        report,
        lambda _root, _suite, case: ET.SubElement(
            ET.SubElement(case, "properties"), "skipped"
        ),
    )
    with pytest.raises(ValueError):
        guard.verify_report(report)


@pytest.mark.parametrize(
    "payload",
    [
        b"",
        b"<testsuites",
        b"<unrelated />",
        b"\xff",
        b"<!DOCTYPE testsuites><testsuites />",
        b'<!DOCTYPE testsuites [<!ENTITY x "boom">]><testsuites />',
        REAL_PYTEST_REPORT.encode("utf-16"),
        b"x" * (guard.MAX_REPORT_BYTES + 1),
    ],
    ids=[
        "empty",
        "malformed",
        "root",
        "encoding",
        "doctype",
        "entity",
        "utf16",
        "oversized",
    ],
)
def test_unsafe_xml_and_byte_bounds_rejected(report, payload):
    report.write_bytes(payload)
    with pytest.raises((ValueError, ET.ParseError)):
        guard.verify_report(report)


def test_symlink_file_rejected(report):
    alias = report.with_name("alias.xml")
    alias.symlink_to(report)
    with pytest.raises((OSError, ValueError)):
        guard.verify_report(alias)


def test_symlink_ancestor_rejected(report):
    alias = report.parent / "alias"
    alias.symlink_to(report.parent, target_is_directory=True)
    with pytest.raises((OSError, ValueError)):
        guard.verify_report(alias / report.name)


def test_writable_file_rejected(report):
    report.chmod(0o666)
    with pytest.raises(ValueError, match="protected"):
        guard.verify_report(report)


def test_writable_ancestor_rejected(report):
    child = report.parent / "unsafe"
    child.mkdir(mode=0o777)
    child.chmod(0o777)
    path = child / "tmpfs.xml"
    path.write_text(REAL_PYTEST_REPORT)
    with pytest.raises(ValueError, match="ancestor"):
        guard.verify_report(path)


def test_missing_file_rejected(report):
    with pytest.raises(OSError):
        guard.verify_report(report.with_name("missing.xml"))


def test_directory_rejected(report):
    with pytest.raises(ValueError, match="ordinary"):
        guard.verify_report(report.parent)


def test_fifo_rejected_without_waiting_for_writer(report):
    report.unlink()
    os.mkfifo(report)
    with pytest.raises(ValueError, match="ordinary"):
        guard.verify_report(report)


def test_foreign_owner_rejected(report, monkeypatch):
    monkeypatch.setattr(guard.os, "getuid", lambda: os.stat(report).st_uid + 1)
    with pytest.raises(ValueError):
        guard.verify_report(report)


@pytest.mark.parametrize("mutation", ["symlink", "mode", "content"])
def test_file_change_after_pinned_open_rejected(report, monkeypatch, mutation):
    original = guard.os.fstat

    def changed(descriptor):
        before = original(descriptor)
        if stat.S_ISREG(before.st_mode):
            if mutation == "symlink":
                saved = report.with_name("saved.xml")
                report.rename(saved)
                report.symlink_to(saved)
            elif mutation == "mode":
                report.chmod(0o666)
            else:
                report.write_text(REAL_PYTEST_REPORT + " ")
        return before

    monkeypatch.setattr(guard.os, "fstat", changed)
    with pytest.raises(ValueError, match="changed"):
        guard.verify_report(report)


def test_declared_non_utf8_encoding_rejected(report):
    report.write_text(REAL_PYTEST_REPORT.replace("utf-8", "iso-8859-1"))
    with pytest.raises(ValueError, match="UTF-8"):
        guard.verify_report(report)


def test_parent_alias_rejected(report):
    with pytest.raises(ValueError, match="parent aliases"):
        guard.verify_report(report.parent / ".." / report.parent.name / report.name)


def test_cli_pass_and_failure_are_bounded_and_do_not_echo_payload(report):
    script = Path(guard.__file__).resolve()
    passed = subprocess.run(
        [sys.executable, str(script), str(report)],
        capture_output=True,
        text=True,
        timeout=5,
        check=False,
    )
    assert passed.returncode == 0
    assert "0 skips" in passed.stdout
    report.write_text("<SECRET_PAYLOAD />")
    failed = subprocess.run(
        [sys.executable, str(script), str(report)],
        capture_output=True,
        text=True,
        timeout=5,
        check=False,
    )
    assert failed.returncode == 1
    assert "SECRET_PAYLOAD" not in failed.stderr
    assert len(failed.stderr) < 400
    assert "required real-tmpfs test passed" in failed.stderr


def test_required_identity_matches_current_acceptance_source():
    project = Path(__file__).resolve().parents[1]
    source = project.joinpath(*guard.REQUIRED_CASE[0].split(".")).with_suffix(".py")
    definitions = {
        node.name
        for node in ast.walk(ast.parse(source.read_text()))
        if isinstance(node, ast.FunctionDef)
    }
    assert guard.REQUIRED_CASE[1] in definitions
