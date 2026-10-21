"""The installed browser gate binds private, cleaned evidence to one exact wheel."""

import ast
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/installed-browser-acceptance.yml"
RUNNER = "tools/run_installed_browser_acceptance.mjs"
GUARD = "tools/verify_installed_browser_report.mjs"
BUILD = "Build exact wheel in clean tracked-source staging"
VERIFY = "Require exact successful installed-browser evidence and cleanup"


def workflow():
    return yaml.safe_load(WORKFLOW.read_text())


def steps():
    return workflow()["jobs"]["installed-browser"]["steps"]


def selected(name):
    return next(step for step in steps() if step.get("name") == name)


def python_body(step):
    return step["run"].split("<<'PY'\n", 1)[1].split("\nPY", 1)[0]


def test_standalone_bounded_gate_has_complete_triggers_and_read_only_permissions():
    value = workflow()
    triggers = value.get("on", value.get(True))
    expected = {
        "src/wavedl/**",
        "src/wavedl_daemon/**",
        "web/**",
        "pyproject.toml",
        "MANIFEST.in",
        "tools/**",
        "unit_tests/test_installed_browser_workflow.py",
        ".github/workflows/installed-browser-acceptance.yml",
    }
    assert set(triggers["push"]["paths"]) == expected
    assert set(triggers["pull_request"]["paths"]) == expected
    assert "workflow_dispatch" in triggers
    assert value["permissions"] == {"contents": "read"}
    assert value["concurrency"]["cancel-in-progress"] is True
    assert "github.workflow" in value["concurrency"]["group"]
    assert set(value["jobs"]) == {"installed-browser"}
    job = value["jobs"]["installed-browser"]
    assert job["runs-on"] == "ubuntu-24.04"
    assert job["timeout-minutes"] == 40
    assert "strategy" not in job
    assert job["defaults"]["run"]["shell"] == "bash"
    assert job["env"]["CUDA_VISIBLE_DEVICES"] == ""
    assert steps()[0]["with"]["persist-credentials"] is False
    for action, version in (("python", "3.11"), ("node", "24")):
        step = next(
            step
            for step in steps()
            if step.get("uses", "").startswith(f"actions/setup-{action}@")
        )
        assert step["with"][f"{action}-version"] == version
    text = WORKFLOW.read_text()
    for forbidden in ("secrets.", "git push", "pull_request_target", "pip install -e"):
        assert forbidden not in text


def test_source_qa_and_pinned_controller_do_not_replace_installed_execution():
    qa = selected("Test installed-browser gate contracts")["run"]
    for required in (
        "python -m pytest --noconftest unit_tests/test_installed_browser_workflow.py",
        "ruff check unit_tests/test_installed_browser_workflow.py",
        "ruff format --check unit_tests/test_installed_browser_workflow.py",
        "node --test tools/verify_installed_browser_report.test.mjs",
    ):
        assert required in qa
    dependencies = selected("Install build and source-contract tools only")["run"]
    assert "'ruff==0.14.10'" in dependencies
    assert '["build-system"]["requires"]' in dependencies
    browser = selected("Install pinned native browser controller")["run"]
    assert "npm install --global agent-browser@0.26.0" in browser
    assert 'test "$(agent-browser --version)"' in browser
    assert "agent-browser install --with-deps" in browser
    for step in steps():
        assert not step.get("continue-on-error", False)
        assert not step.get("continue-on-error")
        assert "|| true" not in step.get("run", "")
        assert "PYTHONPATH:" not in step.get("run", "")
    generate = selected("Generate locked browser assets")
    assert generate["working-directory"] == "web"
    assert generate["run"].splitlines() == ["npm ci", "npm run generate"]
    vendor = selected("Vendor verified current browser assets")
    assert vendor["run"] == "python tools/vendor_web_assets.py"
    assert (
        steps().index(generate) < steps().index(vendor) < steps().index(selected(BUILD))
    )


def test_clean_staging_binds_exact_assets_and_wheel_bytes_without_deleting_user_data():
    build = selected(BUILD)["run"]
    for required in (
        '"git", "archive", "--format=zip", "HEAD"',
        'dir=os.environ["RUNNER_TEMP"]',
        'assert not (stage / "build").exists()',
        '"--wheel", "--no-isolation", "--outdir", str(dist), str(stage)',
        "assert len(wheels) == 1",
        "assert len(names) == len(set(names))",
        'name.startswith("wavedl_gui/")',
        'inventory(assets, managed=True) == json.loads(expected[".wavedl-assets.json"])',
        'assert actual == expected, "Wheel must preserve every current vendored asset byte"',
        "sha = hashlib.sha256(wheel.read_bytes()).hexdigest()",
        '"source_commit": os.environ["GITHUB_SHA"]',
        '"asset_manifest_sha256": hashlib.sha256(expected[".wavedl-assets.json"])',
        "directory.mkdir(mode=0o700)",
        "WAVEDL_ACCEPTANCE_WHEEL_SHA256={sha}",
        'target = stage / "src/wavedl_daemon/web_assets"',
        "shutil.rmtree(target)",
    ):
        assert required in build
    for forbidden in ("git clean", "git reset", "ignore_errors", "build/lib/"):
        assert forbidden not in build


def test_complete_offline_wheelhouse_resolves_exact_wheel_daemon_extra_and_cpu_stack():
    command = selected("Resolve complete offline daemon wheelhouse with CPU PyTorch")[
        "run"
    ]
    for required in (
        "pip download torch torchvision --no-deps --only-binary=:all:",
        "--index-url https://download.pytorch.org/whl/cpu",
        'assert metadata["Name"] in {"torch", "torchvision"}',
        'assert "+cpu" in metadata["Version"]',
        "assert len(constraints) == 2",
        'pip download "$WAVEDL_ACCEPTANCE_WHEEL[daemon]" --only-binary=:all:',
        '--find-links "$WAVEDL_ACCEPTANCE_WHEELHOUSE"',
        '--dest "$WAVEDL_ACCEPTANCE_WHEELHOUSE"',
        '--constraint "$(dirname "$WAVEDL_ACCEPTANCE_WHEELHOUSE")/cpu-constraints.txt"',
    ):
        assert required in command
    final_command = command.splitlines()[-1]
    assert "--no-deps" not in final_command
    assert steps().index(selected(BUILD)) < steps().index(
        selected("Resolve complete offline daemon wheelhouse with CPU PyTorch")
    )


def test_installed_runner_and_unconditional_guard_have_explicit_same_wheel_hash():
    runner = selected("Run actual installed console and browser outside checkout")
    assert runner["run"] == (
        f'node {RUNNER} "$WAVEDL_ACCEPTANCE_WHEEL" '
        '"$WAVEDL_ACCEPTANCE_REPORTS" "$WAVEDL_ACCEPTANCE_WHEELHOUSE" '
        '"$WAVEDL_ACCEPTANCE_WHEEL_SHA256"'
    )
    assert "if" not in runner
    guard = selected(VERIFY)
    assert guard["if"] == "always()"
    assert guard["id"] == "verify"
    assert guard["run"].splitlines()[0] == (
        f'node {GUARD} "$WAVEDL_ACCEPTANCE_REPORTS/installed-browser.json" '
        '"$WAVEDL_ACCEPTANCE_WHEEL_SHA256"'
    )
    assert steps().index(runner) < steps().index(guard)
    assert 'report["installation"]["assets"] == proof["assets"]' in guard["run"]
    upload = selected("Upload only verified nonsecret acceptance evidence")
    assert upload["if"] == "${{ always() && steps.verify.outcome == 'success' }}"
    assert upload["with"]["if-no-files-found"] == "error"
    assert upload["with"]["path"].splitlines() == [
        "${{ env.WAVEDL_ACCEPTANCE_REPORTS }}/installed-browser.json",
        "${{ env.WAVEDL_ACCEPTANCE_EVIDENCE }}/build-manifest.json",
        "${{ env.WAVEDL_ACCEPTANCE_EVIDENCE }}/wheel.sha256",
    ]


def test_inline_python_scripts_are_valid_and_shell_is_fail_closed():
    for step in steps():
        if "<<'PY'" in step.get("run", ""):
            ast.parse(python_body(step))
        if "run" in step:
            result = subprocess.run(
                ["bash", "-n"],
                input=step["run"],
                text=True,
                capture_output=True,
                check=False,
            )
            assert result.returncode == 0, result.stderr


@pytest.mark.parametrize(
    "fault",
    [
        None,
        "missing-report",
        "extra-file",
        "retained-owned-root",
        "symlink-root",
        "public-root",
        "changed-wheel",
        "wrong-expected-wheel",
        "changed-assets",
        "missing-asset",
        "changed-manifest",
    ],
)
def test_workflow_guard_rejects_inexact_build_identity_or_unclean_root(tmp_path, fault):
    reports, evidence = tmp_path / "reports", tmp_path / "evidence"
    reports.mkdir(mode=0o700)
    evidence.mkdir()
    sha, manifest = "a" * 64, "b" * 64
    assets = {"index.html": "c" * 64, ".wavedl-assets.json": manifest}
    report = {
        "wheelSha256": sha,
        "installation": {"assets": dict(assets), "assetManifestSha256": manifest},
    }
    proof = {
        "wheel_sha256": sha,
        "assets": dict(assets),
        "asset_manifest_sha256": manifest,
    }
    if fault == "extra-file":
        (reports / "unexpected.json").write_text("{}")
    elif fault == "retained-owned-root":
        (reports / "owned").mkdir()
    elif fault == "public-root":
        reports.chmod(0o755)
    elif fault == "changed-wheel":
        report["wheelSha256"] = "d" * 64
    elif fault == "wrong-expected-wheel":
        proof["wheel_sha256"] = "d" * 64
        report["wheelSha256"] = "d" * 64
    elif fault == "changed-assets":
        report["installation"]["assets"]["index.html"] = "d" * 64
    elif fault == "missing-asset":
        del report["installation"]["assets"]["index.html"]
    elif fault == "changed-manifest":
        report["installation"]["assetManifestSha256"] = "d" * 64
    (evidence / "build-manifest.json").write_text(json.dumps(proof))
    if fault != "missing-report":
        (reports / "installed-browser.json").write_text(json.dumps(report))
    if fault == "symlink-root":
        alias = tmp_path / "alias"
        alias.symlink_to(reports, target_is_directory=True)
        reports = alias
    result = subprocess.run(
        [sys.executable, "-c", python_body(selected(VERIFY))],
        env={
            **os.environ,
            "WAVEDL_ACCEPTANCE_REPORTS": str(reports),
            "WAVEDL_ACCEPTANCE_EVIDENCE": str(evidence),
            "WAVEDL_ACCEPTANCE_WHEEL_SHA256": sha,
        },
        text=True,
        capture_output=True,
        check=False,
        timeout=10,
    )
    assert (result.returncode == 0) is (fault is None), result.stderr
