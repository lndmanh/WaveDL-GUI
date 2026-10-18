"""Native split acceptance stays additive, isolated and nonsecret in CI."""

import subprocess
from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/daemon-browser-integration.yml"
PATHS = {
    "tools/native_sse_split_fixture.py",
    "tools/run_native_sse_split_browser_acceptance.mjs",
    "tools/verify_native_sse_split_report.mjs",
    "tools/verify_native_sse_split_report.test.mjs",
    "tools/browser_native_sse_probe.mjs",
    "tools/browser_native_sse_probe.test.mjs",
    "unit_tests/test_native_sse_split_fixture.py",
    "unit_tests/test_native_sse_split_workflow.py",
}


def workflow():
    return yaml.safe_load(WORKFLOW.read_text())


def guard_step():
    return next(
        step
        for step in workflow()["jobs"]["chromium-cpu"]["steps"]
        if "verifyNativeSseSplitFile" in step.get("run", "")
    )


def test_native_split_gate_is_mandatory_isolated_and_additive():
    value = workflow()
    job = value["jobs"]["chromium-cpu"]
    steps = job["steps"]
    runner = next(
        step
        for step in steps
        if "node tools/run_native_sse_split_browser_acceptance.mjs"
        in step.get("run", "")
    )
    guard = guard_step()
    for step in (runner, guard):
        assert step["if"] == "always()"
        assert not step.get("continue-on-error", False)
        assert "||" not in step["run"]
        assert '"$TMPDIR/native-sse-browser"' in step["run"]
    assert 'mkdir -m 700 "$TMPDIR/native-sse-browser"' in runner["run"]
    assert (
        'TMPDIR="$TMPDIR/native-sse-browser" node '
        "tools/run_native_sse_split_browser_acceptance.mjs "
        '--report="$TMPDIR/native-sse-browser/native-sse.json"' in runner["run"]
    )
    assert "assert.deepEqual(await readdir(root), ['native-sse.json'])" in guard["run"]
    assert "info.isDirectory() && !info.isSymbolicLink()" in guard["run"]
    assert "verifyNativeSseSplitFile(join(root, 'native-sse.json'))" in guard["run"]
    assert steps.index(runner) < steps.index(guard)
    assert job["timeout-minutes"] == 120
    assert any(step.get("run") == "node tools/run_web_acceptance.mjs" for step in steps)
    assert any(
        step.get("run") == 'node tools/verify_browser_ci_report.mjs "$TMPDIR"'
        and step["if"] == "always()"
        for step in steps
    )


def test_native_split_triggers_contracts_and_only_report_upload():
    value = workflow()
    triggers = value.get("on", value.get(True))
    assert set(triggers["push"]["paths"]) == set(triggers["pull_request"]["paths"])
    for event in ("push", "pull_request"):
        assert PATHS.issubset(triggers[event]["paths"])
    steps = value["jobs"]["chromium-cpu"]["steps"]
    contracts = next(
        step
        for step in steps
        if "node --test tools/browser_native_sse_probe.test.mjs" in step.get("run", "")
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
    paths = upload["with"]["path"].splitlines()
    assert [path for path in paths if "native-sse" in path] == [
        "${{ runner.temp }}/wavedl-browser-ci/native-sse-browser/native-sse.json"
    ]
    assert all("wavedl-native-sse-browser-" not in path for path in paths)
    assert upload["if"] == "always()"


@pytest.mark.parametrize("fault", ["missing", "extra", "workspace", "wrong", "symlink"])
def test_native_split_guard_refuses_inexact_report_inventory(tmp_path, fault):
    if fault == "extra":
        (tmp_path / "native-sse.json").write_text("{}")
        (tmp_path / "extra.json").write_text("{}")
    elif fault == "workspace":
        (tmp_path / "native-sse.json").write_text("{}")
        (tmp_path / "wavedl-native-sse-browser-retained").mkdir()
    elif fault == "wrong":
        (tmp_path / "wrong.json").write_text("{}")
    elif fault == "symlink":
        target = tmp_path.parent / "native-sse-target"
        target.mkdir()
        linked = tmp_path / "linked"
        linked.symlink_to(target)
        tmp_path = linked
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
