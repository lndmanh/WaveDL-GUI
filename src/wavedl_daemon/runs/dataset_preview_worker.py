"""
Disposable subprocess entry point for dataset previews, including opted-in pickle.
Author: Ngo Duc Manh Le (manh@nnsvn.me)
"""

from __future__ import annotations

import argparse
import json
import sys

from wavedl_daemon.runs.dataset_preview import (
    PickleRequired,
    PreviewRefused,
    preview_dataset,
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--path", required=True)
    parser.add_argument("--allow-pickle", action="store_true")
    arguments = parser.parse_args()
    try:
        result = preview_dataset(arguments.path, allow_pickle=arguments.allow_pickle)
    except PickleRequired:
        result = {"error": "Dataset contains pickled arrays", "status": 409}
    except PreviewRefused:
        result = {"error": "Could not preview this dataset", "status": 400}
    print(json.dumps(result, allow_nan=False, separators=(",", ":")))
    return 1 if "error" in result else 0


if __name__ == "__main__":
    sys.exit(main())
