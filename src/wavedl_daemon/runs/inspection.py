"""
Header-only dataset inspection in the shared filesystem worker pool.
Author: Ngo Duc Manh Le (manh@nnsvn.me)
"""

from __future__ import annotations

import asyncio
import math
import zipfile
from pathlib import Path

from wavedl_daemon.runs.catalog import BrowseForbidden, BrowseMissing


class InspectionRefused(ValueError):
    """The selected file cannot be inspected."""


def npy_header(stream):
    from numpy.lib import format

    version = format.read_magic(stream)
    if version == (1, 0):
        return format.read_array_header_1_0(stream)
    if version == (2, 0):
        return format.read_array_header_2_0(stream)
    raise InspectionRefused("Unsupported NumPy array version")


def _variable(name, shape, dtype):
    import numpy as np

    dtype = np.dtype(dtype)
    # Object storage counts references, not the (unknown) pickled object sizes.
    return {
        "name": name,
        "shape": list(shape),
        "dtype": str(dtype),
        "sample_count": shape[0] if shape else None,
        "declared_bytes": math.prod(shape) * dtype.itemsize,
    }


def inspect_dataset(path: str | Path) -> dict:
    """Read metadata without materializing arrays or unpickling object members."""
    import h5py
    import numpy as np

    path = Path(path)
    suffix = path.suffix.lower()
    try:
        if suffix == ".npz":
            variables = []
            with zipfile.ZipFile(path) as archive:
                for member in archive.infolist():
                    if member.filename.endswith(".npy"):
                        with archive.open(member) as stream:
                            shape, _, dtype = npy_header(stream)
                        variables.append(_variable(member.filename[:-4], shape, dtype))
        elif suffix == ".npy":
            with path.open("rb") as stream:
                shape, _, dtype = npy_header(stream)
            variables = [_variable("array", shape, dtype)]
        elif suffix in {".h5", ".hdf5", ".mat"}:
            if suffix != ".mat" or h5py.is_hdf5(path):
                variables = []
                with h5py.File(path, "r") as file:

                    def visit(name, item):
                        if isinstance(item, h5py.Dataset):
                            shape = item.shape[::-1] if suffix == ".mat" else item.shape
                            variables.append(_variable(name, shape, item.dtype))

                    file.visititems(visit)
            else:
                from scipy.io import whosmat

                # whosmat reports MATLAB classes rather than NumPy dtype names.
                classes = {
                    "double": "float64",
                    "single": "float32",
                    "logical": "bool",
                    "char": "U1",
                    "cell": "object",
                    "struct": "object",
                    "object": "object",
                    "sparse": "float64",
                }
                variables = [
                    _variable(name, shape, np.dtype(classes.get(kind, kind)))
                    for name, shape, kind in whosmat(path, appendmat=False)
                ]
        else:
            raise InspectionRefused("Unsupported dataset format")
        return {"schema_version": 1, "format": suffix[1:], "variables": variables}
    except InspectionRefused:
        raise
    except Exception:
        raise InspectionRefused("Could not read this dataset") from None


class DatasetInspector:
    def __init__(self, pool, *, catalog):
        self.pool, self.catalog = pool, catalog

    async def inspect(self, root: str, path: str) -> dict:
        def work(token):
            try:
                selected = self.catalog.resolve(root, path)
                if selected["kind"] != "file":
                    raise InspectionRefused("Choose a dataset file")
                token.check()
                return inspect_dataset(selected["path"])
            except (BrowseForbidden, BrowseMissing, OSError, ValueError):
                raise InspectionRefused("Could not read this dataset") from None

        handle = self.pool.submit(work)
        try:
            return await handle.wait()
        except asyncio.CancelledError:
            handle.cancel()
            await asyncio.gather(handle.wait(), return_exceptions=True)
            raise
