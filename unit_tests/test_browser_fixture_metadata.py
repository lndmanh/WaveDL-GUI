"""Fixture request evidence must not parse or retain unbounded query data."""

import importlib.util
from pathlib import Path

import pytest


@pytest.fixture(scope="module")
def fixture_module():
    fixture_path = (
        Path(__file__).resolve().parents[1] / "tools" / "browser_daemon_fixture.py"
    )
    spec = importlib.util.spec_from_file_location("browser_fixture", fixture_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def cursor_metadata(fixture_module):
    return fixture_module.request_cursor_metadata


@pytest.mark.parametrize(
    "query,expected",
    [
        (b"attempt=1&seq=4", {"attempt": 1, "seq": 4}),
        (b"attempt=0&seq=-1", {"attempt": 0, "seq": -1}),
        (b"token=private&bootstrap=secret", {}),
        (b"seq=--1&attempt=1", {"attempt": 1}),
        (b"seq=1.5&attempt=1", {"attempt": 1}),
        (b"seq=" + b"9" * 20, {}),
        (b"seq=%D9%A1", {}),
        (b"seq=%FF", {}),
        (b"seq=\xff4", {}),
        (b"&".join([b"seq=1"] * 17), {}),
        (b"private=" + b"x" * 4096 + b"&seq=4", {}),
        (b"attempt=1&seq=4&private=" + b"x" * 4073, {}),
    ],
)
def test_cursor_metadata_caps_and_omits_private_values(
    cursor_metadata, query, expected
):
    assert cursor_metadata(query) == expected


def test_cursor_metadata_accepts_exact_byte_boundary(cursor_metadata):
    prefix = b"attempt=1&seq=4&private="
    query = prefix + b"x" * (4096 - len(prefix))
    assert len(query) == 4096
    assert cursor_metadata(query) == {"attempt": 1, "seq": 4}
    assert cursor_metadata(query + b"x") == {}


@pytest.mark.parametrize(
    "path,expected",
    [
        ("/api/health", "/api/health"),
        ("/api/runs", "/api/runs"),
        ("/api/runs/plan", "/api/runs/plan"),
        ("/api/browse/resolve", "/api/browse/resolve"),
        ("/api/datasets/inspect", "/api/datasets/inspect"),
        ("/api/runs/plan/private", "/api/[unrecorded]"),
        ("/api/browse/private-dataset", "/api/[unrecorded]"),
        ("/api/runs/private-run/events", "/api/[unrecorded]"),
        ("/api/health?token=private", "/api/[unrecorded]"),
        ("/api/" + "private" * 1000, "/api/[unrecorded]"),
    ],
)
def test_request_path_metadata_omits_private_values(fixture_module, path, expected):
    assert fixture_module.request_path_metadata(path) == expected


@pytest.mark.parametrize(
    "suffix,recorded_suffix",
    [("", ""), ("/events", "/events"), ("/artifacts/private-file", "/[endpoint]")],
)
def test_request_path_metadata_retains_only_uuid_identity(
    fixture_module, suffix, recorded_suffix
):
    run = "/api/runs/11111111-1111-4111-8111-111111111111"
    assert fixture_module.request_path_metadata(run + suffix) == run + recorded_suffix


def test_fixture_cli_passes_explicit_build_without_starting_daemon(
    fixture_module, monkeypatch, tmp_path
):
    observed = []

    async def capture_fixture(*args):
        observed.append(args)

    assets = tmp_path / "generated-build"
    root = tmp_path / "empty-dataset-root"
    monkeypatch.setattr(fixture_module, "serve_fixture", capture_fixture)
    monkeypatch.setattr(
        fixture_module.sys,
        "argv",
        [
            "browser_daemon_fixture.py",
            "--root",
            str(root),
            "--web-assets",
            str(assets),
            "--unseeded",
        ],
    )
    fixture_module.main()
    assert len(observed) == 1
    assert observed[0][0] == root
    assert observed[0][5] is False
    assert observed[0][11] == assets
    assert observed[0][12] is False
    assert not root.exists()
    assert not assets.exists()
