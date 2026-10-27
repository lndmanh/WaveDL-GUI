# AGENTS.md — WaveDL-GUI

## Project Overview

WaveDL is a deep learning framework and new daemon/browser application for
wave-based inverse problems:
- `src/wavedl/` — Core ML framework (PyTorch training, models, utilities)
- `src/wavedl_daemon/` — Headless per-user execution/API service
- `web/` — Nuxt/Vue + TypeScript browser workstation; generated static assets are
  vendored into the daemon package

The browser is the primary UI; `wavedl-train` also works without a daemon. The Qt
desktop application has been physically removed from the repository; its source
history is preserved at tag `archive/qt-desktop-2026-10-27`. Legacy Qt
compatibility, old-user-data migration, a deprecation period and an
intermediate Qt-retaining release are non-goals. Preserve unrelated dirty
changes and existing user files.

The 23 workstation capabilities remain functional product requirements; the
offline/PWA capability is retired.
API/protocol, durable-state, crash/replay recovery, security and ownership
safeguards remain required. Validate a real site's filesystem/Slurm before
declaring HPC support. Final release validation remains required; tagging or
publishing requires explicit approval.

Python **3.11+** required. Licensed under MIT.

## Build & Install

```bash
pip install -e ".[dev]"        # Core + dev tools (ruff, pytest)
pip install -e ".[dev,daemon]" # Core + dev + daemon/browser runtime
```

For browser development, use the existing `web/package.json` and lockfile:

```bash
cd web
npm ci
npm run typecheck
npm test
npm run lint:workstation
npm run format:check
npm run generate
cd ..
python tools/vendor_web_assets.py
```

Do not run formatting/autofix unless requested. Use clean staging for package
builds to avoid stale `build/lib` modules; never clean user preferences/databases.

## Lint & Format

Ruff is the Python linter and formatter (replaces Black, Flake8, isort).
Browser code uses the existing Oxlint/Oxfmt scripts above.

```bash
ruff check .                       # Lint
ruff check . --fix                 # Lint with auto-fix
ruff format .                      # Format
ruff format . --check --diff       # Check formatting without modifying
```

Pre-commit hooks are configured. Install with:
```bash
pre-commit install
pre-commit run --all-files         # Manual full run
```

The CI (`lint.yml`) pins `ruff==0.14.10` and runs both `ruff check` and `ruff format --check`.

## Test Commands

```bash
pytest                                           # All tests (verbose, short traceback)
pytest unit_tests/test_losses.py                 # Single file
pytest unit_tests/test_losses.py::TestGetLoss    # Single class
pytest unit_tests/test_losses.py::TestGetLoss::test_mse_loss  # Single test
pytest -m "not slow"                             # Skip slow architecture tests (CI default)
pytest -m "not gpu"                              # Skip GPU-requiring tests
pytest -k "test_mse"                             # Keyword filter
```

Tests live in `unit_tests/`. Filenames follow `test_*.py`, classes `Test*`, functions `test_*`.
Default addopts: `-v --tb=short --strict-markers`. Markers: `slow`, `gpu`, `integration`.

## UI Style

The design has to be Apple-like - modern, intuitive and nice looking

## Code Style

### Formatting
- **Line length**: 88 (ruff/Black default)
- **Quotes**: Double quotes
- **Indentation**: 4 spaces
- **Trailing commas**: Preserved (not skipped)
- **Line endings**: LF (enforced by pre-commit)
- **Docstring code**: Formatted by ruff

### Imports
Ruff handles import sorting (isort rules). Order: stdlib, third-party, local.
- `known-first-party = ["wavedl"]`
- Two blank lines after imports
- Multi-imports use `combine-as-imports = true`
- `__init__.py` files may have unused imports (`F401` suppressed)

Browser code follows the established `web/workstation/` imports and conventions.

### Naming Conventions
- **Classes**: `PascalCase` — `TrainingProgress`, `ProcessState`, `SignalBus`
- **Functions/methods**: `snake_case` for Python core/daemon; existing camelCase conventions for browser TypeScript
- **Private methods**: Single underscore prefix `_check_environment()`
- **Config items**: Follow daemon contracts and existing browser types
- **Constants**: `UPPER_SNAKE` for true constants; preserve established local conventions
- **Enums**: `PascalCase` class name, `UPPER_SNAKE` members (`ProcessState.IDLE`)
- **Test classes**: `Test*` prefix; test methods: `test_*` with snake_case

### Type Annotations
- Used in the ML layer: `def load_config(config_path: str) -> dict[str, Any]:`
- Use modern syntax (`dict[str, Any]`, `list[float]`) not `typing.Dict`/`typing.List`
- `from __future__ import annotations` used in newer files
- Browser code uses TypeScript and Vue Composition API with `<script setup>`;
  follow existing web types
- Dataclasses used for structured data (`@dataclass class TrainingProgress`)

### Error Handling
- Factory functions raise `ValueError` for unknown keys: `raise ValueError(f"Unknown loss function")`
- Daemon/API failures preserve truthful unknown/uncertain states and sanitized diagnostics
- `FileNotFoundError` for missing config/data files
- Browser errors use the existing workstation error presentation; never expose credentials or private error bodies

### Docstrings
- ML layer uses detailed module-level docstrings with sections (Features, Usage, Author)
- Function docstrings use Google-style or NumPy-style (`Parameters`, `Returns`, `Raises`)
- Python service classes use concise docstrings
- Test docstrings describe expected behavior: `"""MSE loss should work correctly."""`

## Architecture Patterns

### Daemon/browser application
- **Daemon**: Per-user same-origin API and static client; authenticated mutations
- **State**: Journal/SQLite projection, attempt-aware replay and durable intents;
  preserve ownership and crash-recovery contracts
- **Browser**: Nuxt static SPA, Vue Composition API + TypeScript; follow existing
  `web/workstation/` components, composables and design conventions
- **Offline/PWA**: Retired capability; offline behavior is not a product requirement
- **Execution**: Daemon owns runtime supervision; closing a browser detaches,
  cancellation is an explicit durable request

### ML Layer (`wavedl`)
- **Registry pattern**: `register_model`, `get_model`, `list_models`, `get_loss`, `list_losses`
- **Config**: YAML-based with `load_config()` / `save_config()` / CLI merge
- **Data**: NPZ, MAT, HDF5 formats via `prepare_data()` / `load_training_data()`

## Key Files

| Path | Purpose |
|---|---|
| `src/wavedl_daemon/` | Daemon CLI, HTTP API, storage and execution backends |
| `src/wavedl/core/` | Shared protocol and lifecycle contracts |
| `web/workstation/` | Browser application source |
| `web/package.json` | Frontend build, tests and validation commands |
| `tools/vendor_web_assets.py` | Vendor generated static browser output |
| `src/wavedl/train.py` | CLI training entry point |
| `src/wavedl/models/` | 18+ model architectures |
| `src/wavedl/utils/` | Losses, metrics, optimizers, schedulers, data loading |
| `pyproject.toml` | All project config (deps, ruff, pytest) |
| `configs/config.yaml` | Example training config |

## Ruff Rules Summary

Enabled: `E` `W` `F` `I` `B` `C4` `UP` `SIM` `TCH` `RUF`

Notable ignores: `E501` (line length handled by formatter), `E741` (math variable names like `l`, `I`), `B006`/`B008` (mutable defaults intentional in some APIs), `SIM108` (ternary not always clearer).

Per-file: `__init__.py` allows unused imports. `unit_tests/` allows `assert`. `train.py`/`test.py` allow late imports (`E402`).
