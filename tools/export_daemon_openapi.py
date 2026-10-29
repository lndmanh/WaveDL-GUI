"""Export the daemon lifecycle OpenAPI document without starting the daemon."""

from __future__ import annotations

import argparse
import ast
import json
import sys
from pathlib import Path

from fastapi.openapi.utils import get_openapi

from wavedl_daemon.http.app import create_app
from wavedl_daemon.http.runs import lifecycle_routes


ROOT = Path(__file__).resolve().parents[1]


class _InertRunService:
    """Service placeholder: schema generation must never execute lifecycle calls."""

    def __getattr__(self, name: str):
        def forbidden(*args, **kwargs):
            raise AssertionError(f"OpenAPI generation called service method {name}")

        return forbidden


def _package_version() -> str:
    tree = ast.parse((ROOT / "src" / "wavedl" / "__init__.py").read_text())
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "__version__"
            for target in node.targets
        ):
            value = ast.literal_eval(node.value)
            if isinstance(value, str):
                return value
    raise ValueError("Package version is not declared")


def build_openapi() -> dict:
    """Build the deterministic lifecycle schema without invoking a service."""
    app = create_app(
        None,
        token="offline-openapi-token",
        daemon_id="offline-openapi-daemon",
        build_id="offline-openapi-build",
        services=None,
        web_assets=None,
    )
    routes = lifecycle_routes(_InertRunService())
    for route in routes:
        # GET and HEAD share a handler; document GET only.
        route.methods.discard("HEAD")
    app.router.routes.extend(routes)
    spec = get_openapi(
        title="WaveDL daemon API",
        version=_package_version(),
        routes=app.routes,
    )
    # FastAPI documents 422 for every route; the daemon answers 400 ErrorResponse.
    for methods in spec["paths"].values():
        for operation in methods.values():
            operation["responses"].pop("422", None)
    for name in ("HTTPValidationError", "ValidationError"):
        spec["components"]["schemas"].pop(name, None)
    return spec


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    rendered = json.dumps(build_openapi(), indent=2, sort_keys=True) + "\n"
    if args.output is None:
        # Text-mode stdout would write CRLF on Windows; keep the bytes identical.
        sys.stdout.buffer.write(rendered.encode("utf-8"))
    else:
        args.output.write_text(rendered, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
