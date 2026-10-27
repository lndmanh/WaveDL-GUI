"""Lightweight dataset metadata; importing it never loads numerical packages."""

from dataclasses import dataclass


@dataclass
class DataInfo:
    path: str
    format: str
    file_size: int | None
    num_samples: int
    input_shape: tuple
    output_shape: tuple
    input_dtype: str
    output_dtype: str
    input_key: str = "X"
    output_key: str = "Y"
    dimensionality: str = ""
    error: str = ""

    @property
    def file_size_str(self):
        if self.file_size is None:
            return "Not reported"
        size = self.file_size
        for unit in ("B", "KB", "MB", "GB"):
            if size < 1024:
                return f"{size:.1f} {unit}"
            size /= 1024
        return f"{size:.1f} TB"

    @property
    def num_outputs(self):
        return self.output_shape[-1] if self.output_shape else 0
