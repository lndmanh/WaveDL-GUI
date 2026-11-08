"""
Sampled numerical summaries across the supported training formats.
Author: Ngo Duc Manh Le (manh@nnsvn.me)
"""

from __future__ import annotations

import h5py
import numpy as np
import pytest
from scipy.io import savemat
from scipy.sparse import csr_matrix

from wavedl_daemon.runs.dataset_preview import (
    PickleRequired,
    PreviewRefused,
    preview_dataset,
)


@pytest.mark.parametrize("compressed", [False, True])
def test_numeric_npz_streams_only_sampled_rows(tmp_path, monkeypatch, compressed):
    path = tmp_path / "data.npz"
    inputs = np.arange(2000 * 4, dtype="float32").reshape(2000, 4)
    outputs = np.arange(2000, dtype="float32").reshape(2000, 1)
    (np.savez_compressed if compressed else np.savez)(
        path, inputs=inputs, outputs=outputs
    )
    monkeypatch.setattr(
        np,
        "load",
        lambda *args, **kwargs: pytest.fail("Numeric npz loaded a whole member"),
    )
    value = preview_dataset(path)
    indices = np.linspace(0, 1999, 512, dtype=int)
    assert value["sample_indices"] == indices.tolist()
    assert value["input_sample_indices"] == indices.tolist()
    assert value["scatter"]["x"] == inputs[indices].tolist()
    assert value["scatter"]["y"] == outputs[indices, 0].tolist()
    assert value["samples"][1]["values"] == inputs[indices[1]].tolist()
    assert len(value["output_histograms"][0]["counts"]) == 32
    assert sum(value["output_histograms"][0]["counts"]) == 512


def test_fortran_npz_fallback(tmp_path):
    path = tmp_path / "data.npz"
    inputs = np.asfortranarray(np.arange(24).reshape(6, 4))
    np.savez(path, inputs=inputs, outputs=np.zeros((6, 1)))
    assert preview_dataset(path)["scatter"]["x"] == inputs.tolist()


def test_object_npz_requires_permission_and_densifies_sparse_samples(tmp_path):
    path = tmp_path / "data.npz"
    inputs = np.empty(4, dtype=object)
    for index in range(4):
        inputs[index] = csr_matrix(np.full((5, 6), index + 1.0))
    np.savez(path, inputs=inputs, outputs=np.arange(4).reshape(4, 1))
    with pytest.raises(PickleRequired, match="Dataset contains pickled arrays"):
        preview_dataset(path)
    value = preview_dataset(path, allow_pickle=True)
    assert value["input_shape"] == [4, 5, 6]
    assert value["samples"][1]["shape"] == [5, 6]
    assert value["samples"][1]["values"] == np.full((5, 6), 2.0).tolist()


def test_input_sampling_budget_and_strided_samples_cover_full_image(tmp_path):
    path = tmp_path / "images.h5"
    with h5py.File(path, "w") as file:
        file.create_dataset(
            "inputs", shape=(1000, 500, 500), dtype="float32", fillvalue=2
        )
        file.create_dataset("outputs", data=np.arange(1000).reshape(1000, 1))
    value = preview_dataset(path)
    assert len(value["sample_indices"]) == 512
    assert len(value["input_sample_indices"]) == 33
    assert value["input_sample_indices"][0] == 0
    assert value["input_sample_indices"][-1] == 999
    assert len(value["scatter"]["x"]) == 33
    assert value["scatter"]["y"] == value["input_sample_indices"]
    assert sum(value["input_histograms"][0]["counts"]) == 33
    assert sum(value["output_histograms"][0]["counts"]) == 512
    assert value["samples"][0]["feature_shape"] == [500, 500]
    assert value["samples"][0]["shape"] == [125, 125]
    assert np.asarray(value["samples"][0]["values"]).size <= 16384
    assert len(value["input_statistics"]["means"]) == 40


def test_wide_outputs_reduce_sampling_within_shared_byte_budget(tmp_path):
    path = tmp_path / "wide.h5"
    with h5py.File(path, "w") as file:
        file.create_dataset("inputs", shape=(1000, 2), dtype="float32")
        file.create_dataset("outputs", shape=(1000, 50000), dtype="float32")
    value = preview_dataset(path)
    assert 1 <= len(value["sample_indices"]) < 512
    assert len(value["input_sample_indices"]) <= len(value["sample_indices"])


def test_single_row_over_budget_is_refused_before_reading(tmp_path):
    path = tmp_path / "huge.h5"
    with h5py.File(path, "w") as file:
        file.create_dataset("inputs", shape=(2, 2), dtype="float32")
        file.create_dataset("outputs", shape=(2, 20000000), dtype="float64")
    with pytest.raises(PreviewRefused, match="Dataset is too large to preview"):
        preview_dataset(path)


def test_fortran_whole_array_over_budget_is_refused_before_loading(
    tmp_path, monkeypatch
):
    path = tmp_path / "fortran.npz"
    inputs = np.asfortranarray(np.zeros((1024, 20000), dtype="float64"))
    np.savez_compressed(path, inputs=inputs, outputs=np.zeros((1024, 1)))
    monkeypatch.setattr(
        np, "load", lambda *args, **kwargs: pytest.fail("Loaded oversized fallback")
    )
    with pytest.raises(PreviewRefused, match="Dataset is too large to preview"):
        preview_dataset(path)


def test_object_whole_array_over_budget_is_refused_before_loading(
    tmp_path, monkeypatch
):
    path = tmp_path / "objects.npz"
    inputs = np.empty(1024, dtype=object)
    inputs[:] = 1
    np.savez_compressed(path, inputs=inputs, outputs=np.zeros((1024, 1)))
    monkeypatch.setattr("wavedl_daemon.runs.dataset_preview._PREVIEW_BYTES", 4096)
    monkeypatch.setattr(
        np,
        "load",
        lambda *args, **kwargs: pytest.fail("Loaded oversized object fallback"),
    )
    with pytest.raises(PreviewRefused, match="Dataset is too large to preview"):
        preview_dataset(path, allow_pickle=True)


def test_sparse_object_row_over_budget_is_refused_before_densifying(
    tmp_path, monkeypatch
):
    path = tmp_path / "sparse.npz"
    inputs = np.empty(1, dtype=object)
    inputs[0] = csr_matrix((1, 20000000), dtype="float64")
    np.savez(path, inputs=inputs, outputs=np.zeros((1, 1)))
    monkeypatch.setattr(
        csr_matrix,
        "toarray",
        lambda *args, **kwargs: pytest.fail("Densified oversized row"),
    )
    with pytest.raises(PreviewRefused, match="Dataset is too large to preview"):
        preview_dataset(path, allow_pickle=True)


@pytest.mark.parametrize("suffix", [".h5", ".hdf5", ".mat"])
def test_hdf_and_mat73_fancy_indexing_matches_logical_rows(tmp_path, suffix):
    path = tmp_path / ("data" + suffix)
    inputs = np.arange(24, dtype="float32").reshape(6, 2, 2)
    outputs = np.arange(12, dtype="float32").reshape(6, 2)
    with h5py.File(path, "w") as file:
        file["inputs"] = inputs.transpose() if suffix == ".mat" else inputs
        file["outputs"] = outputs.transpose() if suffix == ".mat" else outputs
    value = preview_dataset(path)
    assert value["input_shape"] == [6, 2, 2]
    assert value["samples"][2]["values"] == inputs[2].tolist()
    assert value["scatter"]["y"] == outputs[:, 0].tolist()


@pytest.mark.parametrize("version", ["4", "5"])
def test_mat_numeric_preview(tmp_path, version):
    path = tmp_path / "data.mat"
    savemat(
        path,
        {"inputs": np.arange(12).reshape(6, 2), "outputs": np.arange(6).reshape(6, 1)},
        format=version,
    )
    assert preview_dataset(path)["scatter"]["y"] == list(range(6))


@pytest.mark.parametrize(
    "values",
    [
        {"inputs": np.zeros((2, 2)), "outputs": np.zeros((3, 1))},
        {"other": np.zeros((2, 2))},
        {"inputs": np.zeros((0, 2)), "outputs": np.zeros((0, 1))},
        {"inputs": np.array([["hello"]]), "outputs": np.zeros((1, 1))},
    ],
)
def test_invalid_training_arrays_refused(tmp_path, values):
    path = tmp_path / "data.npz"
    np.savez(path, **values)
    with pytest.raises(PreviewRefused):
        preview_dataset(path)


def test_rank_one_samples_and_nonfinite_values_remain_json_safe(tmp_path):
    path = tmp_path / "data.npz"
    np.savez(
        path, inputs=np.array([float("nan"), 1]), outputs=np.array([1, float("inf")])
    )
    value = preview_dataset(path)
    assert value["samples"][0] == {
        "sample_index": 0,
        "feature_shape": [],
        "shape": [1],
        "values": [None],
    }
    assert value["correlation"]["matrix"] is None
    assert value["scatter"]["y"] == [1, None]


def test_object_numeric_entries_are_normalized_after_opt_in(tmp_path):
    path = tmp_path / "objects.npz"
    np.savez(
        path, inputs=np.array([[1, 2], [3, 4]], dtype=object), outputs=np.zeros((2, 1))
    )
    assert preview_dataset(path, allow_pickle=True)["scatter"]["x"] == [[1, 2], [3, 4]]


def test_external_hdf_storage_cannot_read_around_selection_authority(tmp_path):
    path = tmp_path / "external.h5"
    with h5py.File(path, "w") as file:
        file.create_dataset(
            "inputs",
            shape=(2, 3),
            dtype="float32",
            external=[(str(tmp_path / "payload"), 0, h5py.h5f.UNLIMITED)],
        )
        file.create_dataset("outputs", data=np.zeros((2, 1)))
    with pytest.raises(PreviewRefused, match="External dataset storage"):
        preview_dataset(path)
