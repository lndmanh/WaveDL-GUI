"""Fail-closed checks for the platform-native foundations acceptance guard."""

import os
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from tools import verify_native_foundations_report as guard
from tools.verify_native_foundations_report import (
    POSIX_REQUIRED,
    WINDOWS_REQUIRED,
    verify_reports,
)


def _write(path, cases, *, root_attrs=None, suite_attrs=None):
    root = ET.Element("testsuites", root_attrs or {})
    suite = ET.SubElement(root, "testsuite", suite_attrs or {})
    for module, names in cases.items():
        for name in names:
            ET.SubElement(suite, "testcase", classname=module, name=name)
    ET.ElementTree(root).write(path)


def _required(required=POSIX_REQUIRED):
    return {
        module: set(names)
        for group in required.values()
        for module, names in group.items()
    }


def _write_platform_reports(tmp_path, required, **kwargs):
    all_cases = _required(required)
    paths = {}
    for slice_name, prefix in (
        ("core", "unit_tests.core."),
        ("daemon", "unit_tests.daemon."),
    ):
        path = tmp_path / f"{slice_name}.xml"
        selected = {m: n for m, n in all_cases.items() if m.startswith(prefix)}
        _write(path, selected, **kwargs)
        paths[slice_name] = path
    return paths["core"], paths["daemon"]


def test_complete_posix_report_passes(tmp_path):
    required = _required()
    _write(
        tmp_path / "core.xml",
        {
            module: names
            for module, names in required.items()
            if module.startswith("unit_tests.core.")
        },
        root_attrs={"tests": "5"},
        suite_attrs={"tests": "5"},
    )
    _write(
        tmp_path / "daemon.xml",
        {
            module: names
            for module, names in required.items()
            if module.startswith("unit_tests.daemon.")
        },
        root_attrs={"tests": "8"},
        suite_attrs={"tests": "8"},
    )
    result = verify_reports(
        tmp_path / "core.xml", tmp_path / "daemon.xml", platform="darwin"
    )
    assert result["required"] == 13


@pytest.mark.parametrize(
    ("platform", "required", "expected"),
    [
        ("linux", POSIX_REQUIRED, 13),
        ("darwin", POSIX_REQUIRED, 13),
        ("win32", WINDOWS_REQUIRED, 12),
    ],
)
def test_complete_native_report_passes_for_each_supported_platform(
    tmp_path, platform, required, expected
):
    core, daemon = _write_platform_reports(tmp_path, required)
    assert verify_reports(core, daemon, platform=platform)["required"] == expected


def test_required_native_skip_fails(tmp_path):
    required = _required()
    core = tmp_path / "core.xml"
    daemon = tmp_path / "daemon.xml"
    _write(
        core, {m: n for m, n in required.items() if m.startswith("unit_tests.core.")}
    )
    _write(
        daemon,
        {m: n for m, n in required.items() if m.startswith("unit_tests.daemon.")},
    )
    tree = ET.parse(daemon)
    ET.SubElement(next(tree.getroot().iter("testcase")), "skipped")
    tree.write(daemon)
    with pytest.raises(ValueError, match=r"[Rr]equired native"):
        verify_reports(core, daemon, platform="darwin")


def test_root_count_mismatch_fails(tmp_path):
    required = _required()
    core = tmp_path / "core.xml"
    daemon = tmp_path / "daemon.xml"
    _write(
        core,
        {m: n for m, n in required.items() if m.startswith("unit_tests.core.")},
        root_attrs={"tests": "1"},
    )
    _write(
        daemon,
        {m: n for m, n in required.items() if m.startswith("unit_tests.daemon.")},
    )
    with pytest.raises(ValueError, match="count"):
        verify_reports(core, daemon, platform="darwin")


def test_unsupported_platform_fails(tmp_path):
    required = _required()
    core = tmp_path / "core.xml"
    daemon = tmp_path / "daemon.xml"
    _write(
        core, {m: n for m, n in required.items() if m.startswith("unit_tests.core.")}
    )
    _write(
        daemon,
        {m: n for m, n in required.items() if m.startswith("unit_tests.daemon.")},
    )
    with pytest.raises(ValueError, match="Unsupported"):
        verify_reports(core, daemon, platform="freebsd")


@pytest.mark.parametrize("attribute", ["tests", "skipped", "failures", "errors"])
@pytest.mark.parametrize("value", ["-1", "1.5", "invalid", "+0", "0_0", " 0"])
def test_malformed_or_negative_aggregate_fails(tmp_path, attribute, value):
    core, daemon = _write_platform_reports(tmp_path, POSIX_REQUIRED)
    tree = ET.parse(core)
    tree.getroot().set(attribute, value)
    tree.write(core)
    with pytest.raises(ValueError):
        verify_reports(core, daemon, platform="linux")


@pytest.mark.parametrize("attribute", ["skipped", "failures", "errors"])
def test_aggregate_outcome_contradiction_fails(tmp_path, attribute):
    core, daemon = _write_platform_reports(tmp_path, POSIX_REQUIRED)
    tree = ET.parse(core)
    tree.getroot().set(attribute, "1")
    tree.write(core)
    with pytest.raises(ValueError, match="count contradicts"):
        verify_reports(core, daemon, platform="linux")


@pytest.mark.parametrize(
    "payload", [b"", b"<not-testsuite />", b"<!DOCTYPE foo><testsuite />"]
)
def test_empty_oversized_or_unsupported_xml_fails(tmp_path, payload):
    core, daemon = _write_platform_reports(tmp_path, POSIX_REQUIRED)
    core.write_bytes(payload)
    with pytest.raises((ValueError, ET.ParseError)):
        verify_reports(core, daemon, platform="linux")


def test_oversized_report_fails(tmp_path):
    core, daemon = _write_platform_reports(tmp_path, POSIX_REQUIRED)
    core.write_bytes(b"x" * (8 * 1024 * 1024 + 1))
    with pytest.raises(ValueError, match="byte bound"):
        verify_reports(core, daemon, platform="linux")


def test_symlink_report_fails(tmp_path):
    core, daemon = _write_platform_reports(tmp_path, POSIX_REQUIRED)
    alias = tmp_path / "alias.xml"
    alias.symlink_to(core)
    with pytest.raises(ValueError, match="symlink"):
        verify_reports(alias, daemon, platform="linux")


@pytest.mark.skipif(os.name != "posix", reason="Native FIFO creation")
def test_fifo_report_refused_before_waiting_for_writer(tmp_path):
    core, daemon = _write_platform_reports(tmp_path, POSIX_REQUIRED)
    core.unlink()
    os.mkfifo(core)
    with pytest.raises(ValueError, match="ordinary file"):
        verify_reports(core, daemon, platform="linux")


@pytest.mark.parametrize(
    ("platform", "required"),
    [
        ("linux", POSIX_REQUIRED),
        ("darwin", POSIX_REQUIRED),
        ("win32", WINDOWS_REQUIRED),
    ],
)
@pytest.mark.parametrize(
    "mutation", ["missing", "skipped", "duplicate", "failure", "error", "identity"]
)
def test_required_case_adversarial_mutations_fail(
    tmp_path, platform, required, mutation
):
    core, daemon = _write_platform_reports(tmp_path, required)
    tree = ET.parse(daemon)
    suite = next(tree.getroot().iter("testsuite"))
    case = suite[0]
    if mutation == "missing":
        suite.remove(case)
    elif mutation == "duplicate":
        ET.SubElement(suite, "testcase", **case.attrib)
    elif mutation == "identity":
        case.attrib.pop("classname")
    else:
        ET.SubElement(case, mutation)
    tree.write(daemon)
    with pytest.raises(ValueError):
        verify_reports(core, daemon, platform=platform)


@pytest.mark.parametrize(
    ("fixture", "platform"), [(WINDOWS_REQUIRED, "linux"), (POSIX_REQUIRED, "win32")]
)
def test_wrong_platform_report_does_not_prove_native_cases(tmp_path, fixture, platform):
    core, daemon = _write_platform_reports(tmp_path, fixture)
    with pytest.raises(ValueError, match="Missing required"):
        verify_reports(core, daemon, platform=platform)


def test_other_platform_and_optional_ml_skips_remain_counted_unverified(tmp_path):
    core, daemon = _write_platform_reports(tmp_path, POSIX_REQUIRED)
    tree = ET.parse(core)
    root = tree.getroot()
    suite = next(root.iter("testsuite"))
    for module, name in (
        (
            "unit_tests.core.test_windows_ownership",
            "test_native_current_user_file_owner_and_dacl",
        ),
        ("unit_tests.core.test_optional_ml", "test_optional_model"),
    ):
        case = ET.SubElement(suite, "testcase", classname=module, name=name)
        ET.SubElement(case, "skipped")
    for aggregate in (root, suite):
        aggregate.set("skipped", "2")
        aggregate.set("tests", "7")
    tree.write(core)
    assert verify_reports(core, daemon, platform="linux") == {
        "required": 13,
        "passed": 13,
        "other_skipped": 2,
    }
    suite.set("skipped", "0")
    tree.write(core)
    with pytest.raises(ValueError, match="skipped count contradicts"):
        verify_reports(core, daemon, platform="linux")


def test_pytest_optional_module_collection_skip_remains_unverified(tmp_path):
    core, daemon = _write_platform_reports(tmp_path, POSIX_REQUIRED)
    tree = ET.parse(daemon)
    suite = next(tree.getroot().iter("testsuite"))
    case = ET.SubElement(
        suite, "testcase", classname="", name="unit_tests.daemon.test_optional_ml"
    )
    ET.SubElement(case, "skipped", message="optional ML dependency unavailable")
    tree.write(daemon)
    result = verify_reports(core, daemon, platform="linux")
    assert result == {"required": 13, "passed": 13, "other_skipped": 1}


@pytest.mark.parametrize(
    "mutation", ["passed", "foreign", "duplicate", "required", "required_with_cases"]
)
def test_module_collection_skip_cannot_bypass_native_gate(tmp_path, mutation):
    core, daemon = _write_platform_reports(tmp_path, POSIX_REQUIRED)
    tree = ET.parse(daemon)
    suite = next(tree.getroot().iter("testsuite"))
    name = "unit_tests.daemon.test_optional_ml"
    if mutation == "required":
        suite.clear()
        name = "unit_tests.daemon.test_posix_supervisor"
    elif mutation == "required_with_cases":
        name = "unit_tests.daemon.test_posix_supervisor"
    elif mutation == "foreign":
        name = "foreign.module"
    case = ET.SubElement(suite, "testcase", classname="", name=name)
    if mutation != "passed":
        ET.SubElement(case, "skipped")
    if mutation == "duplicate":
        duplicate = ET.SubElement(suite, "testcase", **case.attrib)
        ET.SubElement(duplicate, "skipped")
    tree.write(daemon)
    with pytest.raises(ValueError):
        verify_reports(core, daemon, platform="linux")


@pytest.mark.parametrize(
    "payload",
    [b"<testsuites />", b"<testsuites", "<!DOCTYPE foo><testsuites/>".encode("utf-16")],
)
def test_missing_testcases_malformed_or_utf16_entity_xml_fails(tmp_path, payload):
    core, daemon = _write_platform_reports(tmp_path, POSIX_REQUIRED)
    core.write_bytes(payload)
    with pytest.raises((ValueError, ET.ParseError)):
        verify_reports(core, daemon, platform="linux")


@pytest.mark.parametrize("attribute", ["tests", "skipped", "failures", "errors"])
def test_suite_aggregate_contradiction_fails(tmp_path, attribute):
    core, daemon = _write_platform_reports(tmp_path, POSIX_REQUIRED)
    tree = ET.parse(core)
    next(tree.getroot().iter("testsuite")).set(attribute, "1")
    tree.write(core)
    with pytest.raises(ValueError, match="count contradicts"):
        verify_reports(core, daemon, platform="linux")


def test_cli_uses_actual_platform_and_has_no_platform_override(
    tmp_path, monkeypatch, capsys
):
    core, daemon = _write_platform_reports(tmp_path, WINDOWS_REQUIRED)
    monkeypatch.setattr(guard.sys, "platform", "win32")
    monkeypatch.setattr(guard.sys, "argv", ["guard", str(core), str(daemon)])
    assert guard.main() == 0
    assert "12 required native cases passed" in capsys.readouterr().out
    monkeypatch.setattr(
        guard.sys, "argv", ["guard", str(core), str(daemon), "--platform=linux"]
    )
    with pytest.raises(SystemExit) as error:
        guard.main()
    assert error.value.code == 2


def test_required_names_match_actual_test_source():
    import ast

    project = Path(__file__).resolve().parents[1]
    for required in (POSIX_REQUIRED, WINDOWS_REQUIRED):
        for modules in required.values():
            for module, names in modules.items():
                source = project.joinpath(*module.split(".")).with_suffix(".py")
                definitions = {
                    node.name
                    for node in ast.walk(ast.parse(source.read_text()))
                    if isinstance(node, ast.FunctionDef)
                }
                assert {name.split("[")[0] for name in names} <= definitions
