"""
Sampled dataset summaries for the isolated preview worker.
Author: Ngo Duc Manh Le (manh@nnsvn.me)
"""

from __future__ import annotations

import math
import zipfile
from contextlib import contextmanager
from pathlib import Path

from wavedl_daemon.runs.inspection import InspectionRefused, inspect_dataset, npy_header


# The key priority of upstream's loader, ``wavedl/utils/data.py``.
INPUT_KEYS = ["input_train", "input_test", "X", "data", "inputs", "features", "x"]
OUTPUT_KEYS = ["output_train", "output_test", "Y", "labels", "outputs", "targets", "y"]


class PreviewRefused(ValueError):
    """The dataset cannot provide training summaries."""


class PickleRequired(PreviewRefused):
    """Reading this dataset requires explicit permission to unpickle."""


def _keys(variables):
    names = {item["name"]: item for item in variables}
    keys = [
        next((key for key in priorities if key in names), None)
        for priorities in (INPUT_KEYS, OUTPUT_KEYS)
    ]
    if None in keys:
        raise PreviewRefused("Dataset has no training input and output arrays")
    shapes = [names[key]["shape"] for key in keys]
    if not all(shape and all(shape) for shape in shapes):
        raise PreviewRefused("Dataset arrays are empty")
    if shapes[0][0] != shapes[1][0]:
        raise PreviewRefused("Input and output sample counts differ")
    return keys, shapes


def _dense(value):
    import numpy as np

    array = np.asarray(value.toarray() if hasattr(value, "toarray") else value)
    return np.asarray(array.tolist()) if array.dtype.hasobject else array


def _npz_rows(archive, key, indices, loaded):
    import numpy as np

    with archive.open(key + ".npy") as stream:
        shape, fortran, dtype = npy_header(stream)
        if dtype.hasobject or fortran:
            if key not in loaded:
                with archive.open(key + ".npy") as member:
                    loaded[key] = np.load(member, allow_pickle=dtype.hasobject)
            return np.stack([_dense(loaded[key][int(index)]) for index in indices])
        row_bytes = math.prod(shape[1:]) * dtype.itemsize
        rows = []
        position = 0
        # Read sequentially even for compressed members; retain only requested rows.
        for index in range(int(indices[-1]) + 1):
            row = stream.read(row_bytes)
            if len(row) != row_bytes:
                raise PreviewRefused("Dataset array is incomplete")
            if index == indices[position]:
                rows.append(np.frombuffer(row, dtype=dtype).reshape(shape[1:]))
                position += 1
                if position == len(indices):
                    break
        return np.stack(rows)


@contextmanager
def _reader(path, keys, allow_pickle):
    import h5py
    import numpy as np

    suffix = path.suffix.lower()
    if suffix == ".npz":
        with zipfile.ZipFile(path) as archive:
            for key in keys:
                with archive.open(key + ".npy") as member:
                    _, _, dtype = npy_header(member)
                if dtype.hasobject and not allow_pickle:
                    raise PickleRequired("Dataset contains pickled arrays")
            loaded = {}
            yield lambda key, indices: _npz_rows(archive, key, indices, loaded)
    elif suffix in {".h5", ".hdf5", ".mat"}:
        if suffix != ".mat" or h5py.is_hdf5(path):
            with h5py.File(path, "r") as file:

                def rows(key, indices):
                    dataset = file[key]
                    # Selection authority must not be bypassed by external HDF storage.
                    if dataset.external or dataset.is_virtual:
                        raise PreviewRefused("External dataset storage is unsupported")
                    return np.asarray(
                        dataset[..., indices].transpose()
                        if suffix == ".mat"
                        else dataset[indices]
                    )

                yield rows
        else:
            from scipy.io import loadmat

            arrays = loadmat(path, variable_names=keys, appendmat=False)
            yield lambda key, indices: arrays[key][indices]
    else:
        raise PreviewRefused("Unsupported dataset format")


def _finite(value):
    import numpy as np

    if isinstance(value, np.ndarray):
        return _finite(value.tolist())
    if isinstance(value, (list, tuple)):
        return [_finite(item) for item in value]
    if isinstance(value, dict):
        return {key: _finite(item) for key, item in value.items()}
    if isinstance(value, (float, np.floating)):
        return float(value) if math.isfinite(value) else None
    if isinstance(value, np.integer):
        return int(value)
    return value


def _features(width, maximum):
    import numpy as np

    return np.linspace(0, width - 1, min(width, maximum), dtype=int)


def _histograms(array):
    import numpy as np

    result = []
    for index in _features(array.shape[1], 8):
        column = array[:, index]
        column = column[np.isfinite(column)]
        if column.size and np.max(np.abs(column)) > 1e150:
            raise PreviewRefused("Numeric magnitude exceeds histogram safety limit")
        counts, edges = np.histogram(column, bins=32)
        result.append({"feature_index": int(index), "counts": counts, "edges": edges})
    return result


def _summaries(x, y, indices, input_indices, shapes):
    import numpy as np

    x_flat = x.reshape(len(input_indices), -1).astype(np.float64)
    y_flat = y.reshape(len(indices), -1).astype(np.float64)
    stats = _features(x_flat.shape[1], 40)
    scatter = _features(x_flat.shape[1], 8)
    corr = _features(y_flat.shape[1], 30)
    with np.errstate(all="ignore"):
        matrix = (
            np.corrcoef(y_flat[:, corr], rowvar=False)
            if len(corr) > 1 and len(indices) > 1
            else None
        )
        means = x_flat[:, stats].mean(axis=0)
        stds = x_flat[:, stats].std(axis=0)
    samples = []
    for position in range(min(3, len(input_indices))):
        row = x[position].astype(np.float64, copy=False)
        # A uniform stride preserves coverage and the rank used by sample views.
        stride = 1
        while math.prod(math.ceil(size / stride) for size in row.shape) > 16384:
            stride += 1
        value = (
            row[tuple(slice(None, None, stride) for _ in row.shape)]
            if row.ndim
            else row.reshape(1)
        )
        samples.append(
            {
                "sample_index": int(input_indices[position]),
                "feature_shape": shapes[0][1:],
                "shape": list(value.shape),
                "values": value,
            }
        )
    return _finite(
        {
            "sample_indices": indices,
            "input_sample_indices": input_indices,
            "input_histograms": _histograms(x_flat),
            "output_histograms": _histograms(y_flat),
            "correlation": {"feature_indices": corr, "matrix": matrix},
            "input_statistics": {
                "feature_indices": stats,
                "means": means,
                "stds": stds,
            },
            "scatter": {
                "feature_indices": scatter,
                "output_index": 0,
                "x": x_flat[:, scatter],
                "y": y_flat[np.searchsorted(indices, input_indices), 0],
            },
            "samples": samples,
        }
    )


def preview_dataset(path, *, allow_pickle=False):
    """Read sampled rows, with explicit opt-in for executable pickle payloads."""
    import numpy as np

    path = Path(path)
    try:
        metadata = inspect_dataset(path)
        keys, shapes = _keys(metadata["variables"])
        indices = np.linspace(0, shapes[0][0] - 1, min(512, shapes[0][0]), dtype=int)
        with _reader(path, keys, allow_pickle) as read:
            inputs = next(
                item for item in metadata["variables"] if item["name"] == keys[0]
            )
            if np.dtype(inputs["dtype"]).hasobject:
                first = read(keys[0], np.array([0]))
                shapes[0] = [shapes[0][0], *first.shape[1:]]
            width = math.prod(shapes[0][1:])
            count = min(len(indices), max(1, 8388608 // max(1, width)))
            input_indices = indices[np.linspace(0, len(indices) - 1, count, dtype=int)]
            x = read(keys[0], input_indices)
            y = read(keys[1], indices)
        if x.dtype.kind not in {"b", "i", "u", "f"} or y.dtype.kind not in {
            "b",
            "i",
            "u",
            "f",
        }:
            raise PreviewRefused("Only real numeric arrays can be previewed")
        shapes = [[shapes[0][0], *x.shape[1:]], [shapes[1][0], *y.shape[1:]]]
        return {
            "schema_version": 1,
            "format": path.suffix.lower()[1:],
            "input_key": keys[0],
            "output_key": keys[1],
            "input_shape": shapes[0],
            "output_shape": shapes[1],
            **_summaries(x, y, indices, input_indices, shapes),
        }
    except PreviewRefused:
        raise
    except InspectionRefused as error:
        raise PreviewRefused(str(error)) from None
    except Exception:
        raise PreviewRefused("Could not read this dataset") from None
