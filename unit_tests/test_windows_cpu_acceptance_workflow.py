"""Separate native Windows CPU acceptance never substitutes foundation mocks."""

import ast
import os
import subprocess
import sys
from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/windows-cpu-acceptance.yml"
CASE = "test_isolated_resolved_wheelhouse_console_scripts_and_assets"


def workflow():
    return yaml.safe_load(WORKFLOW.read_text())


def steps():
    return workflow()["jobs"]["installed-cpu"]["steps"]


def selected(name):
    return next(step for step in steps() if step.get("name") == name)


def test_native_windows_cpu_matrix_is_separate_bounded_and_read_only():
    value = workflow()
    trigger = value.get("on", value.get(True))
    assert trigger["push"]["branches"] == ["main", "review/daemon-browser-ci-*"]
    assert set(trigger["push"]["paths"]) == set(trigger["pull_request"]["paths"])
    for path in (
        "src/wavedl/**",
        "src/wavedl_daemon/**",
        "web/**",
        "unit_tests/daemon/test_installed_cli.py",
        "unit_tests/daemon/test_installed_cli_native_helpers.py",
        "unit_tests/test_launcher_stdio.py",
        "tools/run_user_owned_pytest.py",
        "unit_tests/test_windows_cpu_acceptance_workflow.py",
        ".github/workflows/windows-cpu-acceptance.yml",
    ):
        assert path in trigger["push"]["paths"]
    assert "workflow_dispatch" in trigger
    assert value["permissions"] == {"contents": "read"}
    assert value["concurrency"]["cancel-in-progress"] is True
    assert "github.workflow" in value["concurrency"]["group"]
    assert set(value["jobs"]) == {"installed-cpu"}
    job = value["jobs"]["installed-cpu"]
    assert job["runs-on"] == "windows-latest"
    assert job["timeout-minutes"] == 30
    assert job["strategy"] == {
        "fail-fast": False,
        "matrix": {"python-version": ["3.11", "3.13"]},
    }
    assert job["env"]["CUDA_VISIBLE_DEVICES"] == ""
    assert job["defaults"]["run"]["shell"] == "bash"
    assert steps()[0]["with"]["persist-credentials"] is False
    text = WORKFLOW.read_text()
    assert "secrets." not in text
    assert "pypi" not in text.lower()
    assert "git push" not in text


def test_cpu_dependencies_precede_project_and_exact_constraint_wheelhouse():
    items = steps()
    cpu = selected("Install official CPU PyTorch before project dependencies")
    project = selected("Install declared daemon and acceptance dependencies")
    assert cpu["run"] == (
        "python -m pip install torch torchvision --index-url "
        "https://download.pytorch.org/whl/cpu"
    )
    assert items.index(cpu) < items.index(project)
    assert 'python -m pip install -e ".[daemon]" pytest httpx build' in project["run"]
    assert '["build-system"]["requires"]' in project["run"]
    assert "python -m pip check" in project["run"]
    wheelhouse = selected(
        "Resolve complete offline wheelhouse from exact installed constraints"
    )
    assert "pip freeze --exclude-editable" in wheelhouse["run"]
    for required in (
        '"$WAVEDL_ACCEPTANCE_WHEEL[daemon]"',
        "--only-binary=:all:",
        '--wheel-dir "$WAVEDL_ACCEPTANCE_WHEELHOUSE"',
        '--constraint "$RUNNER_TEMP/windows-cpu-constraints.txt"',
        "--extra-index-url https://download.pytorch.org/whl/cpu",
    ):
        assert required in wheelhouse["run"]


def test_exact_wheel_uses_tracked_clean_staging_and_complete_asset_identity():
    build = selected("Build exact wheel in clean tracked-source staging")["run"]
    for required in (
        '"git", "archive", "--format=zip", "HEAD"',
        'dir=os.environ["RUNNER_TEMP"]',
        'assert not (stage / "build").exists()',
        '"--wheel", "--no-isolation", "--outdir", str(dist), str(stage)',
        "assert len(wheels) == 1",
        'name.startswith("wavedl_gui/")',
        'inventory(assets, managed=True) == json.loads(expected[".wavedl-assets.json"])',
        'assert actual == expected, "Wheel must preserve every current vendored asset byte"',
        "hashlib.sha256(wheel.read_bytes()).hexdigest()",
        '"source_commit": os.environ["GITHUB_SHA"]',
        "WAVEDL_ACCEPTANCE_WHEEL=",
        "WAVEDL_ACCEPTANCE_WHEELHOUSE=",
        "torch.version.cuda is None",
    ):
        assert required in build
    assert "shutil.rmtree(target)" in build
    assert 'target = stage / "src/wavedl_daemon/web_assets"' in build
    assert not any(
        token in build for token in ("git clean", "git reset", "ignore_errors")
    )
    items = steps()
    vendor = selected("Vendor verified current browser assets")
    assert items.index(selected("Generate locked browser assets")) < items.index(vendor)
    assert items.index(vendor) < items.index(
        selected("Build exact wheel in clean tracked-source staging")
    )


def test_acceptance_is_one_explicit_owned_offline_case_with_no_optional_fallback():
    contracts = selected("Test Windows CPU workflow contracts")
    assert contracts["run"] == (
        "python -m pytest --noconftest "
        "unit_tests/test_windows_cpu_acceptance_workflow.py "
        "unit_tests/daemon/test_installed_cli_native_helpers.py "
        "unit_tests/test_launcher_stdio.py -q"
    )
    assert steps().index(
        selected("Install declared daemon and acceptance dependencies")
    ) < steps().index(contracts)
    run = selected("Run native installed CPU acceptance outside checkout")
    assert run["run"] == (
        "python tools/run_user_owned_pytest.py "
        "unit_tests/daemon/test_installed_cli.py --confcutdir=unit_tests/daemon "
        "-k isolated_resolved --junitxml=windows-cpu-installed.xml -q"
    )
    for step in steps():
        if "run" in step:
            assert step["if"] == (
                "always()"
                if step["name"].startswith("Require exactly")
                else "${{ success() && !cancelled() }}"
            )
            assert not step.get("continue-on-error", False)
            assert "||" not in step["run"]
    upload = steps()[-1]
    assert upload["uses"] == "actions/upload-artifact@v4"
    assert upload["if"] == "always()"
    assert upload["with"]["path"].splitlines() == [
        "windows-cpu-installed.xml",
        "windows-cpu-artifact.json",
    ]
    assert not any("**" in path for path in upload["with"]["path"].splitlines())


def test_embedded_python_steps_are_syntax_valid():
    for step in steps():
        run = step.get("run", "")
        if "python - <<'PY'\n" in run:
            script = run.split("python - <<'PY'\n", 1)[1].split("\nPY", 1)[0]
            compile(script, step["name"], "exec")


def test_exact_artifact_environment_writer_emits_two_real_records(
    tmp_path, monkeypatch
):
    build = selected("Build exact wheel in clean tracked-source staging")["run"]
    script = build.split("python - <<'PY'\n", 1)[1].split("\nPY", 1)[0]
    writer = next(
        node
        for node in ast.parse(script).body
        if isinstance(node, ast.With) and "GITHUB_ENV" in ast.unparse(node)
    )
    environment = tmp_path / "github-env"
    monkeypatch.setenv("GITHUB_ENV", str(environment))
    owned = tmp_path / "owned source with spaces"
    wheel = owned / "dist/wavedl.whl"
    exec(
        compile(
            ast.Module(body=[writer], type_ignores=[]), "environment writer", "exec"
        ),
        {"os": os, "owned": owned, "wheel": wheel},
    )
    assert environment.read_text().splitlines() == [
        f"WAVEDL_ACCEPTANCE_WHEEL={wheel.as_posix()}",
        f"WAVEDL_ACCEPTANCE_WHEELHOUSE={(owned / 'wheelhouse').as_posix()}",
    ]
    assert environment.read_bytes().count(b"\n") == 2


@pytest.mark.parametrize(
    "fault",
    [
        None,
        "skip",
        "failure",
        "error",
        "empty",
        "duplicate",
        "wrong-name",
        "wrong-class",
    ],
)
def test_native_cpu_junit_guard_fails_closed(tmp_path, fault):
    import xml.etree.ElementTree as ET

    root = ET.Element("testsuite")
    if fault != "empty":
        case = ET.SubElement(
            root,
            "testcase",
            name=CASE,
            classname="unit_tests.daemon.test_installed_cli",
        )
        if fault in {"skip", "failure", "error"}:
            ET.SubElement(case, "skipped" if fault == "skip" else fault)
        if fault == "wrong-name":
            case.set("name", "optional_smoke")
        if fault == "wrong-class":
            case.set("classname", "foreign")
        if fault == "duplicate":
            ET.SubElement(root, "testcase", name=CASE)
    ET.ElementTree(root).write(tmp_path / "windows-cpu-installed.xml")
    guard = selected("Require exactly one successful native installed CPU case")["run"]
    script = guard.split("python - <<'PY'\n", 1)[1].rsplit("\nPY", 1)[0]
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=tmp_path,
        env=dict(os.environ),
        capture_output=True,
        timeout=10,
    )
    assert (result.returncode == 0) == (fault is None)
