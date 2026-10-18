"""Parse actual web exports without executing their shell or training payloads."""

from __future__ import annotations

import json
import shlex
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import yaml

from wavedl.core.manifest import read_manifest
from wavedl.core.training_cli import parse_training_args
from wavedl.launch_runtime import prepare_runtime
from wavedl.launcher import parse_args


def main():
    payload = json.load(sys.stdin)
    expected = payload["request"]["config"]
    parsed_yaml = yaml.safe_load(payload["yaml"])
    argv = shlex.split(payload["command"])
    assert argv[:3] == [
        payload["request"]["runtime"]["python"],
        "-m",
        "wavedl.launcher",
    ]
    # parse_args consumes sys.argv; no command is executed and no custom module,
    # checkpoint or constraint file is imported by this dependency-light probe.
    sys.argv = ["wavedl.launcher", *argv[3:]]
    options, remaining = parse_args()
    parsed, _ = parse_training_args(remaining)
    command_config = {name: vars(parsed)[name] for name in expected}
    with TemporaryDirectory(prefix="wavedl-export-authoring-") as temporary:
        output = Path(temporary) / "run"
        remaining = [*remaining, "--output_dir", str(output)]
        prepare_runtime(remaining, options, python=sys.executable, environment={})
        manifest = read_manifest(output / "manifest.json")
        runtime_config = {name: manifest.resolved_config[name] for name in expected}
        yaml_path = Path(temporary) / "authored.yaml"
        yaml_path.write_text(payload["yaml"], encoding="utf-8")
        yaml_output = Path(temporary) / "yaml-run"
        prepare_runtime(
            ["--config", str(yaml_path), "--output_dir", str(yaml_output)],
            options,
            python=sys.executable,
            environment={},
        )
        yaml_manifest = read_manifest(yaml_output / "manifest.json")
        yaml_runtime_config = {
            name: yaml_manifest.resolved_config[name] for name in expected
        }
        conflict_rejected = False
        try:
            prepare_runtime(
                [*remaining, "--precision", "fp16"],
                options,
                python=sys.executable,
                environment={},
            )
        except ValueError as error:
            conflict_rejected = "precision" in str(error)
    assert (
        parsed_yaml
        == command_config
        == runtime_config
        == yaml_runtime_config
        == expected
    )
    print(
        json.dumps(
            {
                "fields": len(expected),
                "yaml": parsed_yaml,
                "command": command_config,
                "runtime": runtime_config,
                "yaml_runtime": yaml_runtime_config,
                "precision_conflict_rejected": conflict_rejected,
                "processes": options.num_gpus,
                "cpu": options.cpu,
            }
        )
    )


if __name__ == "__main__":
    main()
