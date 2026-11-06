"""
Header-only inspection through NumPy, HDF5 and SciPy metadata APIs.
Author: Ngo Duc Manh Le (manh@nnsvn.me)
"""

from __future__ import annotations

import asyncio
import threading
import zipfile

import h5py
import numpy as np
import pytest
from scipy.io import savemat
from starlette.testclient import TestClient

from unit_tests.daemon.conftest import route_app
from wavedl_daemon.execution.budget import WorkBudget
from wavedl_daemon.execution.pool import BoundedThreadPool
from wavedl_daemon.http.inspection import inspection_routes
from wavedl_daemon.runs.catalog import CatalogService
from wavedl_daemon.runs.inspection import (
    DatasetInspector,
    InspectionRefused,
    inspect_dataset,
)


def test_npz_reports_numeric_and_object_headers_without_loading(tmp_path, monkeypatch):
    path = tmp_path / "data.npz"
    np.savez(
        path,
        inputs=np.zeros((5, 3), dtype="float32"),
        objects=np.array([{"x": 1}], dtype=object),
    )
    monkeypatch.setattr(
        np, "load", lambda *args, **kwargs: pytest.fail("Inspection decoded an array")
    )
    result = inspect_dataset(path)
    assert result == {
        "schema_version": 1,
        "format": "npz",
        "variables": [
            {
                "name": "inputs",
                "shape": [5, 3],
                "dtype": "float32",
                "sample_count": 5,
                "declared_bytes": 60,
            },
            {
                "name": "objects",
                "shape": [1],
                "dtype": "object",
                "sample_count": 1,
                "declared_bytes": np.dtype(object).itemsize,
            },
        ],
    }


@pytest.mark.parametrize("suffix", [".h5", ".hdf5", ".mat"])
def test_hdf_inspection_uses_dataset_metadata(tmp_path, suffix, monkeypatch):
    path = tmp_path / ("data" + suffix)
    with h5py.File(path, "w") as file:
        file.create_dataset("group/inputs", shape=(5, 3), dtype="float32")
    monkeypatch.setattr(
        h5py.Dataset,
        "__getitem__",
        lambda *args: pytest.fail("Inspection read a payload"),
    )
    variable = inspect_dataset(path)["variables"][0]
    assert variable["shape"] == ([3, 5] if suffix == ".mat" else [5, 3])
    assert variable["dtype"] == "float32"
    assert variable["declared_bytes"] == 60


@pytest.mark.parametrize("version", ["4", "5"])
def test_mat_inspection_uses_whosmat(tmp_path, monkeypatch, version):
    path = tmp_path / "data.mat"
    savemat(path, {"inputs": np.zeros((5, 3))}, format=version)
    import scipy.io

    monkeypatch.setattr(
        scipy.io,
        "loadmat",
        lambda *args, **kwargs: pytest.fail("Inspection decoded MAT"),
    )
    assert inspect_dataset(path)["variables"][0] == {
        "name": "inputs",
        "shape": [5, 3],
        "dtype": "float64",
        "sample_count": 5,
        "declared_bytes": 120,
    }


def test_sparse_file_above_old_file_cap_is_not_refused(tmp_path):
    path = tmp_path / "large.npy"
    with path.open("wb") as stream:
        np.lib.format.write_array_header_1_0(
            stream, {"descr": "<f4", "fortran_order": False, "shape": (200000000, 1)}
        )
        stream.truncate(800000128)
    assert path.stat().st_size > 512 * 1024 * 1024
    assert inspect_dataset(path)["variables"][0]["shape"] == [200000000, 1]


def test_npz_header_only_member_has_no_payload(tmp_path):
    path = tmp_path / "header.npz"
    with (
        zipfile.ZipFile(path, "w") as archive,
        archive.open("inputs.npy", "w") as member,
    ):
        np.lib.format.write_array_header_2_0(
            member, {"descr": "<f8", "fortran_order": False, "shape": (1000000000, 3)}
        )
    assert inspect_dataset(path)["variables"][0]["declared_bytes"] == 24000000000


def test_inspection_rejects_corrupt_and_unsupported_files(tmp_path):
    for name in ("broken.npz", "broken.mat", "data.txt"):
        path = tmp_path / name
        path.write_bytes(b"not a dataset")
        with pytest.raises(InspectionRefused):
            inspect_dataset(path)


def test_inspection_runs_off_owner_thread_and_rejects_root_escape(
    tmp_path, monkeypatch
):
    path = tmp_path / "data.npy"
    np.save(path, np.zeros((3, 2)))
    import wavedl_daemon.runs.inspection as inspection

    original = inspection.inspect_dataset
    owner = threading.get_ident()
    threads = []

    def inspect(selected):
        threads.append(threading.get_ident())
        return original(selected)

    monkeypatch.setattr(inspection, "inspect_dataset", inspect)
    with BoundedThreadPool(WorkBudget()) as pool:
        service = DatasetInspector(pool, catalog=CatalogService({"data": tmp_path}))
        assert asyncio.run(service.inspect("data", "data.npy"))["variables"][0][
            "shape"
        ] == [3, 2]
        for selected in ("../data.npy", str(path), "missing.npy"):
            with pytest.raises(InspectionRefused):
                asyncio.run(service.inspect("data", selected))
    assert threads and owner not in threads


def test_http_inspection_is_strict_noncacheable_and_redacted():
    class Inspector:
        async def inspect(self, root, path):
            if path == "bad":
                raise InspectionRefused("private path")
            return {"schema_version": 1, "format": "npy", "variables": []}

    with TestClient(route_app(routes=inspection_routes(Inspector()))) as client:
        response = client.post(
            "/api/datasets/inspect", json={"root": "data", "path": "data.npy"}
        )
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert (
            client.post("/api/datasets/inspect", json={"path": "data.npy"}).status_code
            == 400
        )
        response = client.post(
            "/api/datasets/inspect", json={"root": "data", "path": "bad"}
        )
        assert response.status_code == 400
        assert response.json() == {"error": "Could not inspect this dataset"}
        assert "private" not in response.text


def test_cancelled_inspection_drains_in_process_worker(tmp_path, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    (tmp_path / "data.npy").write_bytes(b"fixture")

    def inspect(path):
        entered.set()
        assert release.wait(3)
        return {"schema_version": 1, "format": "npy", "variables": []}

    monkeypatch.setattr("wavedl_daemon.runs.inspection.inspect_dataset", inspect)
    with BoundedThreadPool(WorkBudget()) as pool:
        service = DatasetInspector(pool, catalog=CatalogService({"data": tmp_path}))

        async def run():
            task = asyncio.create_task(service.inspect("data", "data.npy"))
            try:
                async with asyncio.timeout(2):
                    while not entered.is_set():
                        await asyncio.sleep(0.005)
                task.cancel()
                await asyncio.sleep(0.01)
                assert not task.done()
                assert pool.outstanding == 1
                release.set()
                with pytest.raises(asyncio.CancelledError):
                    await task
                assert pool.outstanding == 0
            finally:
                release.set()
                await asyncio.gather(task, return_exceptions=True)

        asyncio.run(run())
