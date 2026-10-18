"""Bounded valid numeric resource witnesses for the ordinary preview browser UI."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import zipfile
from dataclasses import asdict, replace
from pathlib import Path

import browser_preview_fault_fixture as common

from wavedl.core.dataset_preview import PreviewLimits, preview_dataset
from wavedl_daemon.runs.preview_service import DatasetPreviewService


NAMES = ("samples.npz", "compressed.npz", "features.npz", "bytes.npz")
LIMITS = replace(
    PreviewLimits(),
    max_file_bytes=32768,
    max_input_features=64,
    max_output_bytes=200000,
)


def configure(root: Path) -> None:
    """Create bounded ordinary datasets and an independent numeric control."""
    import numpy as np

    root = root.resolve()
    np.savez_compressed(
        root / "compressed.npz",
        X=np.zeros((10000, 10)),
        y=np.zeros((10000, 1)),
    )
    np.savez(root / "features.npz", X=np.zeros((2, 65)), y=np.zeros((2, 1)))
    np.savez(root / "bytes.npz", X=np.zeros((128, 64)), y=np.zeros((128, 1)))
    with zipfile.ZipFile(root / "compressed.npz") as archive:
        members = [
            {
                "name": member.filename,
                "expanded": member.file_size,
                "compressed": member.compress_size,
            }
            for member in archive.infolist()
        ]
    # Valid numeric control differs only in ZIP ratio. This rules out dtype,
    # parser, and shape refusal; normal daemon requests keep the default 100.
    path = root / "compressed.npz"
    stat = path.stat()
    identity = {
        key: getattr(stat, key)
        for key in ("st_dev", "st_ino", "st_size", "st_mtime_ns")
    }
    control = preview_dataset(
        path,
        expected_identity=identity,
        limits=replace(LIMITS, max_zip_ratio=10000),
    )
    witness = {
        "limits": asdict(LIMITS),
        "members": members,
        "control": {
            "input_shape": control["input_shape"],
            "output_shape": control["output_shape"],
            "sample_count": len(control["sample_indices"]),
            "max_zip_ratio": 10000,
        },
    }
    (root / ".preview-budget-witness.json").write_text(json.dumps(witness))


def command_factory(root: Path, phase: int, argv: list[str]) -> tuple[str, ...]:
    """Record a genuine worker PID before replacing the wrapper via exec."""
    return (
        sys.executable,
        str(Path(__file__).resolve()),
        "--phase-child",
        str(root),
        str(phase),
        json.dumps(argv),
    )


async def serve(root: Path, token_file: Path | None) -> None:
    """Apply lower file/feature limits only inside this dedicated fixture."""
    original = DatasetPreviewService.__init__

    def bounded_init(self, *args, **kwargs):
        kwargs["limits"] = LIMITS
        original(self, *args, **kwargs)

    DatasetPreviewService.__init__ = bounded_init
    await common.serve(
        root,
        token_file,
        command_factory=command_factory,
        configure=configure,
        capture_output=True,
        max_phases=7,
    )


def main() -> None:
    """Run a fixture, inspect its read-only state, or enter a worker wrapper."""
    if len(sys.argv) > 1 and sys.argv[1] == "--phase-child":
        root, phase, argv = Path(sys.argv[2]), int(sys.argv[3]), json.loads(sys.argv[4])
        (root / f".preview-ready-{phase}.json").write_text(
            json.dumps({"phase": phase, "pid": os.getpid(), "argv": argv})
        )
        os.execv(argv[0], argv)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--token-file", type=Path)
    parser.add_argument("--inspect", action="store_true")
    args = parser.parse_args()
    if args.inspect:
        print(json.dumps(common.snapshot(args.root, NAMES)))
    else:
        asyncio.run(serve(args.root, args.token_file))


if __name__ == "__main__":
    main()
