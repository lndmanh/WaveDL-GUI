"""Export dependency-light training field metadata for browser authoring.

Run with PYTHONPATH=src python tools/export_web_training_schema.py. Its JSON
describes web/shared/training-options.json; the Python regression test compares
parsed metadata so JavaScript formatting does not affect reproducibility.
"""

from __future__ import annotations

import argparse
import json

from wavedl.core.training_cli import build_training_parser, training_defaults


def export_options() -> list[dict]:
    """Describe each daemon-supported destination exactly once."""
    defaults = training_defaults()
    fields = {}
    for action in build_training_parser()._actions:
        if action.dest in {"help", "list_models", "config", "output_dir"}:
            continue
        if action.help == argparse.SUPPRESS:
            continue
        fields[action.dest] = {
            "name": action.dest,
            "kind": (
                "boolean"
                if isinstance(action, argparse._StoreTrueAction)
                else "integer"
                if action.type is int
                else "number"
                if action.type is float
                else "string"
            ),
            "multiple": action.nargs == "+",
            "choices": list(action.choices or []),
            "default": defaults[action.dest],
            "description": action.help,
        }
    return list(fields.values())


if __name__ == "__main__":
    print(json.dumps(export_options(), indent=2) + "\n", end="")
