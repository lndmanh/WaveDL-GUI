"""Fail closed when mandatory assembled GUI acceptance is missing or skipped."""

from __future__ import annotations

import argparse
import os
import stat
import xml.etree.ElementTree as ET
from pathlib import Path


REQUIRED_CASES = {
    "unit_tests.test_gui_daemon_restart_integration": {
        "test_real_qt_public_http_shutdown_reopen_preserves_identity_and_intent",
    },
    "unit_tests.test_gui_autoplot_failure_integration": {
        "test_autoplot_export_fault_retains_completed_run_and_retries_without_duplicate",
    },
    "unit_tests.test_gui_daemon_http_integration": {
        "test_real_qthread_public_http_cpu_training_inference_and_verified_plot_downloads",
    },
    "unit_tests.test_gui_preview_http_integration": {
        f"test_real_qthread_remote_preview_and_six_views[{extension}]"
        for extension in ("npz", "mat", "h5")
    },
    "unit_tests.test_gui_entrypoint": {
        "test_entrypoint_is_lightweight_outside_checkout[import]",
        "test_entrypoint_is_lightweight_outside_checkout[help]",
        "test_main_launches_once_preserves_args_and_returns_event_loop_code[Auto]",
        "test_main_launches_once_preserves_args_and_returns_event_loop_code[1.5]",
    },
    "unit_tests.test_gui_frontend_shutdown": {
        "test_detach_monitoring_closes_running_bridge_without_cancel_rpc",
        "test_late_training_success_after_shutdown_cannot_start_plot_or_new_work",
    },
    "unit_tests.test_gui_quit_dispatch": {
        f"test_native_quit_event_obeys_frontend_drain_registration[{mode}]"
        for mode in ("managed", "managed_idle", "unmanaged")
    },
    "unit_tests.test_gui_legacy_cleanup": {
        "test_downloader_modules_and_sql_hooks_are_removed",
        "test_actual_startup_neither_creates_nor_changes_legacy_database[False]",
        "test_actual_startup_neither_creates_nor_changes_legacy_database[True]",
    },
    "unit_tests.test_gui_reconnect_dispatch": {
        "test_plot_retry_button_dispatch_retains_run_after_transport_uncertainty",
        "test_plot_uncertainty_enables_retry_only_after_thread_exit_and_ignores_late_state",
        *(
            f"test_plot_retry_identity_fences[{fence}]"
            for fence in ("terminal", "retired", "closing", "running")
        ),
        "test_reconnect_dispatch_does_not_read_empty_or_changed_draft",
        "test_reconnect_dispatch_preserves_actual_worker_identity_fence[False]",
        "test_reconnect_dispatch_preserves_actual_worker_identity_fence[True]",
        "test_terminal_or_retired_reconnect_cannot_submit_empty_draft[False-True]",
        "test_terminal_or_retired_reconnect_cannot_submit_empty_draft[True-False]",
    },
}
MAX_REPORT_BYTES = 8 * 1024 * 1024
MAPPED_CASES = {
    "unit_tests.test_gui_mapped_autoplot_integration": {
        "test_explicit_qt_plot_pin_inverse_maps_approved_file_registration_once",
        "test_qt_plot_registration_inverse_rejects_non_roundtripping_mapping",
        "test_training_pin_selection_without_bulk_output_preferences[no-output]",
        "test_training_pin_selection_without_bulk_output_preferences[onnx-only]",
        "test_automatic_plot_refuses_success_without_verified_publication",
        "test_mapped_cpu_training_auto_plot_pins_source_and_retries_public_qt_delivery",
    },
}


def _read_report(path: Path) -> ET.Element:
    """Parse one bounded ordinary UTF-8 JUnit artifact without XML entities."""
    if path.is_symlink():
        raise ValueError("GUI acceptance report must not be a symlink")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    descriptor = os.open(path, flags)
    with os.fdopen(descriptor, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError("GUI acceptance report must be an ordinary file")
        content = stream.read(MAX_REPORT_BYTES + 1)
    if not content or len(content) > MAX_REPORT_BYTES:
        raise ValueError("GUI acceptance report is empty or exceeds its byte bound")
    try:
        xml = content.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ValueError("GUI acceptance report must use UTF-8 XML") from error
    if "<!DOCTYPE" in xml.upper() or "<!ENTITY" in xml.upper():
        raise ValueError("GUI acceptance report cannot declare XML entities")
    root = ET.fromstring(content)
    if root.tag not in {"testsuite", "testsuites"}:
        raise ValueError("GUI acceptance report has an unsupported root")
    return root


def verify_report(path: Path, *, mapped: bool = False) -> int:
    """Require each named case exactly once and reject any unsuccessful result."""
    root = _read_report(path)
    required = MAPPED_CASES if mapped else REQUIRED_CASES
    expected = {(module, name) for module, names in required.items() for name in names}
    seen = set()
    cases = list(root.iter("testcase"))

    def aggregate_int(element: ET.Element, attribute: str) -> int | None:
        value = element.get(attribute)
        if value is None:
            return None
        if not value.isascii() or not value.isdecimal():
            raise ValueError(f"Invalid GUI acceptance {attribute} aggregate")
        try:
            return int(value)
        except ValueError as error:
            raise ValueError(
                f"Invalid GUI acceptance {attribute} aggregate: {value!r}"
            ) from error

    for outcome in ("skipped", "failures", "errors"):
        value = aggregate_int(root, outcome)
        if value is not None and value != 0:
            raise ValueError(f"GUI acceptance report has {outcome}")
    reported_tests = aggregate_int(root, "tests")
    if reported_tests is not None and reported_tests != len(cases):
        raise ValueError(
            f"GUI acceptance report tests count {reported_tests} != {len(cases)}"
        )

    for case in cases:
        key = (case.get("classname"), case.get("name"))
        if any(case.find(tag) is not None for tag in ("skipped", "failure", "error")):
            raise ValueError(f"Unsuccessful GUI acceptance case: {key}")
        if key in seen:
            raise ValueError(f"Duplicate GUI acceptance case: {key}")
        seen.add(key)
    for suite in root.iter("testsuite"):
        for outcome in ("skipped", "failures", "errors"):
            value = aggregate_int(suite, outcome)
            if value is not None and value != 0:
                raise ValueError(f"GUI acceptance suite has {outcome}")
        reported_tests = aggregate_int(suite, "tests")
        suite_cases = sum(1 for _ in suite.iter("testcase"))
        if reported_tests is not None and reported_tests != suite_cases:
            raise ValueError(
                f"GUI acceptance suite tests count {reported_tests} != {suite_cases}"
            )
    missing = expected - seen
    unexpected = seen - expected
    if missing or unexpected:
        raise ValueError(
            "GUI acceptance cases differ from required set: "
            f"missing={sorted(missing)}, unexpected={sorted(unexpected, key=repr)}"
        )
    return len(cases)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument(
        "--mapped",
        action="store_true",
        help="Verify the separate POSIX mapped-runtime gate, not the baseline GUI lane",
    )
    args = parser.parse_args()
    try:
        count = verify_report(args.report, mapped=args.mapped)
    except (OSError, ValueError, ET.ParseError) as error:
        parser.exit(1, f"GUI acceptance gate failed: {error}\n")
    scope = "Mapped POSIX GUI" if args.mapped else "GUI"
    print(f"{scope} acceptance gate passed: {count} cases, zero skips/failures/errors")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
