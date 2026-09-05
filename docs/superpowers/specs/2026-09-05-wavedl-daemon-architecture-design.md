# WaveDL Daemon Architecture Design

**Status:** user-approved direction; implementation specification
**Date:** 2026-09-05
**Supersedes:** `2026-08-02-qt-desktop-improvement-design.md` — specifically its decision to retain PySide6 Widgets, its §5.1 assignment of SQLite ownership to the GUI, and its §8 exclusion of a widget-framework replacement. Its JSONL protocol (§2), runtime selection (§3), and process supervision (§4) are carried forward and extended.

**Decision:** Replace the Qt desktop shell with a headless Python daemon that both a web UI and the CLI consume as clients. The daemon serves the web UI itself from the same origin.

---

## 1. Goals and constraints

WaveDL users run training in four places: the workstation the GUI is on, a remote lab box, an HPC login node under SLURM, and hosted notebooks such as Colab. A native desktop application serves only the first. Every remaining target requires the interface to be reachable over a network, which makes the client's delivery mechanism — not its widget toolkit — the load-bearing design decision.

The current shell is ~15,400 hand-written lines of PySide6 plus a 43,324-line generated `resource.py`. `TrainingWorker`, `TestWorker`, and `PlotWorker` in `src/wavedl_gui/service/training_service.py` spawn subprocesses and scrape merged stdout. That design cannot observe a job the GUI did not launch, which is precisely the SLURM case.

Constraints that hold across the whole design:

- Windows, macOS, and Linux; CPU, Apple MPS, and NVIDIA CUDA.
- HPC login nodes frequently have restricted or absent outbound internet. Nothing may require reaching a third-party host at runtime.
- `wavedl-train` must remain directly executable with no daemon present, because inside a SLURM allocation it *is* the process the scheduler launched.
- A port opened on a shared login node is reachable by every other user on that node.

## 2. Architecture

Three components. Two are clients of the third.

```
┌──────────────┐     ┌──────────────┐
│   Web UI     │     │  wavedl CLI  │   clients
│   (PWA)      │     │              │
└──────┬───────┘     └──────┬───────┘
       │  HTTP + SSE        │  HTTP
       └─────────┬──────────┘
                 ▼
        ┌─────────────────┐
        │  wavedl-daemon  │   headless core (FastAPI + uvicorn)
        │  run registry   │   runs on workstation / lab box /
        │  supervision    │   HPC login node / notebook runtime
        │  introspection  │
        │  serves the UI  │
        └────────┬────────┘
                 ▼
         ┌───────────────┐
         │   Executors   │
         └───────────────┘
      Local · Slurm · DryRun
```

### 2.1 The daemon serves its own UI

`wavedl-daemon serve` prints a URL with a first-use token and serves the static web build at `/` from the same origin as the API.

```
$ wavedl-daemon serve
  WaveDL daemon running at http://localhost:8420/?token=a3f9...
```

Serving the UI from the daemon rather than a hosted origin is required, not merely convenient:

- **Airgapped operation.** The UI travels inside the Python package. A restricted-egress login node can still load it.
- **No version skew.** UI and daemon ship and upgrade as one artifact; `pip install -U wavedl` moves both.
- **No cross-origin surface.** Same origin removes CORS configuration, preflight handling, and the mixed-content class of failure entirely.

Remote access is SSH port forwarding — `ssh -L 8420:localhost:8420 user@cluster`, then open `http://localhost:8420`. This keeps the browser on a trustworthy origin, so service workers register and the PWA remains installable. It is the same reflex users already have for Jupyter.

### 2.2 The CLI keeps a daemon-free path

Unlike LM Studio's `lms`, which requires its daemon, `wavedl-train` must keep working standalone. A SLURM batch script invokes it directly; there is no daemon inside the allocation to be a client of. Client mode (`wavedl run --daemon <url>`) is additive and never becomes the only path.

## 3. Executors

The daemon does not assume it owns the training process.

| Executor | Daemon's role | Event transport | Cancellation |
|---|---|---|---|
| **Local** | Spawns and owns the process | Reads child stdout (attached) | Graceful signal, bounded wait, then process-tree kill |
| **Slurm** | Renders `sbatch`, submits, polls `sacct`/`squeue` | Tails `run_dir/events.jsonl` (detached) | `scancel <job_id>` |
| **DryRun** | Renders the command or script, executes nothing | — returns the rendered text | n/a |

Three properties follow from this table and are the reason for it:

1. **The canonical event sink is a file.** `run_dir/events.jsonl` is the source of truth; stdout is one transport for the attached case only. This is the extension of the Aug 2 protocol that makes detached SLURM jobs observable at all, makes a run replayable after a daemon restart, and gives a dashboard to a run that was launched entirely by hand.
2. **"Generate commands only" is not a separate feature.** It is `DryRunExecutor` over the same manifest and the same renderer. The existing "Copy CLI Command" button becomes the visible edge of the executor abstraction.
3. **Remote is a URL, not an architecture.** Pointing at a different daemon host is the entire remote story.

`SshExecutor` — driving a remote box that has no daemon — is deliberately deferred. It is expressible in the same interface when wanted.

### 3.1 Run directory layout

Every executor produces the same structure, so the reader is executor-independent:

```
<run_dir>/
  manifest.json          immutable resolved config for this run
  events.jsonl           canonical event log, append-only
  stderr.log             captured diagnostics, not protocol
  training_history.csv   existing WaveDL output, unchanged
  checkpoints/
  plots/
```

`manifest.json` is written before execution begins and never mutated. Artifact paths in events resolve against `run_dir` and must not escape it; the daemon rejects events whose resolved paths fall outside, and records the rejection as a protocol warning.

## 4. Protocol

### 4.1 Event envelope

Carried forward from the Aug 2 design unchanged:

```json
{"protocol":"wavedl-jsonl","version":1,"run_id":"uuid","type":"metric","seq":7,"ts":"2026-09-05T12:00:00Z","payload":{}}
```

Event types: `state`, `metric`, `log`, `artifact`, `warning`, `error`, `exit`. Payload schemas, unknown-field tolerance, malformed-line handling, and terminal semantics are as specified in the Aug 2 document §2.2 and §2.3 and are not restated here.

Two changes:

- **`hello` is promoted from a stream event to `GET /api/health`.** Capability and version negotiation must be possible before a run is committed to, not in the first event after it starts.
- **`seq` gains a second role.** It was ordering; it is now also the resumption cursor (§4.3).

### 4.2 HTTP surface

```
GET  /                            static web UI
GET  /api/health                  daemon + wavedl version, protocol range, devices
GET  /api/models                  model registry metadata
GET  /api/models/{id}             single model detail
POST /api/datasets/inspect        path -> shape, dtype, sample count, target count
GET  /api/runs                    list, filterable by state
POST /api/runs                    create from manifest; body selects executor
GET  /api/runs/{id}               status, config, latest metrics
POST /api/runs/render             DryRun: rendered command or sbatch script
GET  /api/runs/{id}/events        SSE stream, resumable
POST /api/runs/{id}/cancel
GET  /api/runs/{id}/artifacts
```

### 4.3 Event streaming

Transport is **Server-Sent Events**, not WebSocket. The stream is one-directional — cancellation is a `POST`, not a stream message — so WebSocket would add bidirectionality that is unused while costing proxy and port-forward compatibility. `EventSource` also reconnects natively.

On reconnect the browser sends `Last-Event-ID`. The daemon maps that onto `seq` and replays from `events.jsonl` beyond that point. This behaves identically for attached local runs and detached SLURM jobs, because both read from the same file.

`EventSource` cannot set request headers, so bearer-token auth does not reach it. Authentication for the stream therefore uses the session cookie established at first load (§5), not the `Authorization` header. This is the reason the token exchange in §5 exists rather than using a header everywhere.

## 5. Security

The daemon is a network service the moment it binds a port, and HPC login nodes are shared.

- **Bind `127.0.0.1` by default.** `--host 0.0.0.0` is an explicit opt-in and still requires a token.
- **A bearer token is always required.** It is generated per daemon start and printed in the startup URL.
- **First load exchanges `?token=` for a session cookie**, `HttpOnly`, `SameSite=Strict`, scoped to the daemon origin. The API accepts either the cookie or an `Authorization: Bearer` header; SSE relies on the cookie.
- **`--token` may pin a stable token** for scripted or long-lived deployments.
- Rejected requests return `401` with no detail about whether the run exists.

Plain HTTP over a LAN is not a supported access pattern: it is not a trustworthy origin, so the service worker will not register, and the token would cross the network in the clear. Supported remote access is SSH port forwarding, or a user-supplied HTTPS reverse proxy or tunnel. Mobile access requires one of the latter and is not a day-one feature.

## 6. Web client

Generated with `create-nuxt-saas` using modules **`base` + `pwa`**, optionally `content` for a bundled docs site.

`base` is frontend-only by design in that kit — no `server/`, no database, no authentication — which is exactly correct here. Everything above it (`server-core`, `database`, `auth`, `admin*`, `feature-flags`, `auth-*`) is Cloudflare/D1/session machinery that would be architecturally wrong: WaveDL's backend is the user's own daemon on their own hardware, and its credential is a daemon token rather than an account record. A base+pwa project sits near the kit's 483-file floor rather than 815.

- **`ssr: false`, `nuxt generate`.** There is no server-side knowledge of which daemon a user will run, so SSR has nothing to render. Static output is what the Python wheel bundles. The kit's Cloudflare/NuxtHub defaults must be overridden for this.
- **Build output is vendored into the Python package** at build time and served by the daemon at `/`.
- **Charts use uPlot.** Runs emit thousands of epochs; uPlot renders 100k+ points at interactive framerates in under 50KB. This is the functional replacement for pyqtgraph and the one frontend choice that can reintroduce the sluggishness the rewrite exists to remove.
- **The service worker must not intercept `/api/**`.** Cache strategy is navigation-and-assets only; an SW in front of an SSE endpoint breaks streaming in ways that are expensive to diagnose. Offline means the shell loads and reports no daemon connection, not that live monitoring appears to work.
- **PWA installability is retained.** Served from `http://localhost`, a trustworthy origin, the app installs with its own window and launcher icon on macOS, Windows, and Linux.
- The kit's `.nuxt-saas/manifest.json` and three-way upgrade merge are kept, so the client continues to track upstream kit changes rather than forking.

A multi-endpoint connection manager — one installed PWA managing several saved daemons — is a deliberate non-goal for this phase. It is the only feature that reintroduces cross-origin concerns, and it is additive later.

## 7. Ownership of configuration and state

| Concern | Owner | Store |
|---|---|---|
| Run registry, run state, artifact index | Daemon | SQLite in the daemon's data directory |
| Resolved run configuration | Daemon | `manifest.json` per run, immutable |
| Form defaults for new runs | Daemon | namespaced defaults document |
| Theme, layout, last-used paths, dismissed hints | Client | `localStorage` / IndexedDB, per browser |

This supersedes the Aug 2 §5.1 assignment of SQLite to the GUI. With the GUI no longer a process on the training machine, GUI ownership of that database is not expressible. The daemon owns it; clients never touch it directly.

Migration from the existing `qconfig` `config.json` and `database.db`: back up both, migrate inside a transaction, record `schema_version` and `migration_id`, and on failure restore the backup and start in read-only recovery mode with an actionable error. Legacy files are not deleted until a later release has confirmed a successful start.

## 8. Migration

Three phases. The application is never broken between them.

**Phase 1 — extract the daemon beneath the existing Qt app.**
The Qt shell keeps running but talks HTTP to the daemon instead of spawning subprocesses. This proves the protocol, the executors, and the run directory contract with zero UI risk, and it delivers the Aug 2 document's M1–M4 goals. This phase is worth completing even if the client decision were later reversed.

**Phase 2 — build the web client against the proven API.**
Qt continues to ship throughout.

**Phase 3 — cut over and retire the Qt shell.**

### 8.1 Disposition of existing code

| Code | Lines | Fate |
|---|---|---|
| `common/constants/models.py` | 2,484 | Moves to daemon, served by `/api/models` |
| `view/` + `components/` | 8,586 | Rewritten as the web client |
| `service/` | 944 | Becomes daemon executors and supervision |
| `common/utils.py` | 611 | Split: data introspection to daemon, Qt helpers dropped |
| `common/constants/index.py` | 436 | Becomes Pydantic schema shared by daemon and manifest |
| `common/database/` (QtSql DAO) | 880 | Replaced by sqlite3/SQLAlchemy in the daemon |
| `common/concurrent/`, `wizard_state.py` | 506 | Dropped; async replaces QThread |
| `common/resource.py` | 43,324 | Deleted; assets become static files |

Approximately 4,500 lines port with edits, 9,000 are rewritten, and 43,000 generated lines are removed.

## 9. Process supervision

The Local executor retains the Aug 2 §4 requirements in full: launch without a shell, stdin closed, stdout and stderr captured separately, `start_new_session=True` on POSIX, a Windows Job Object with kill-on-job-close assigned immediately, graceful-then-forceful tree termination on cancellation, monotonic deadlines, idempotence when cancellation races normal exit, exactly one terminal result, and full reaping of descendants before release.

The Slurm executor's supervision is different in kind: the daemon does not own the process, so cancellation is `scancel` and liveness comes from `sacct`/`squeue` polling rather than a pipe. A job that vanishes from the scheduler without an `exit` event in `events.jsonl` is reported as `failed` with the last known scheduler state, never silently as completed.

## 10. Testing

- Protocol fixtures covering every event type, ordering, unknown events, and malformed lines; parser is pure Python with no web-framework dependency.
- Resumption tests: reconnect at arbitrary `seq`, including mid-file and past end-of-file, for both attached and detached transports.
- Executor tests: local cancellation kills descendants on Windows, macOS, and Linux; SLURM rendering is asserted against fixture manifests; DryRun output is byte-compared to the command the Local executor would run.
- Path containment tests for artifact events attempting to escape `run_dir`.
- Auth tests: unauthenticated request rejection, token-to-cookie exchange, SSE authentication by cookie, and `0.0.0.0` binding refusing to start without a token.
- Migration tests from representative legacy `config.json` and `database.db`, including forced-failure rollback.
- Client tests: service worker does not intercept `/api/**`; offline shell renders a disconnected state.

## 11. Out of scope

No native desktop shell (Electron, Tauri, GPUI) in this phase — the daemon makes it an additive client later. No multi-endpoint connection manager. No `SshExecutor`. No hosted UI origin. No mobile-specific client. No tunnel or VPN layer bundled with the daemon. No multi-user accounts, roles, or tenancy. No changes to training algorithms beyond structured event emission. No scheduler support beyond SLURM.

## 12. Known risks

- **SLURM site variability.** Partitions, account flags, module loads, and container wrappers differ per cluster. The sbatch renderer needs a site-configurable template rather than a fixed string, and this is the most likely source of field failures.
- **Windows process-tree control.** Carried over from the Aug 2 design and still the least-covered platform path.
- **Kit defaults.** `create-nuxt-saas` targets Cloudflare/NuxtHub; the static-output configuration is off its main path and needs verification early rather than at packaging time.
- **Wheel size.** Vendoring the built client into the Python package grows it. Measure before committing to bundling versus an optional extra.
