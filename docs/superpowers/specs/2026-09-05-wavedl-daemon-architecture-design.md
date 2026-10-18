# WaveDL Daemon Architecture Design

**Status:** revision 2, incorporating design review
**Date:** 2026-09-05
**Supersedes:** `2026-08-02-qt-desktop-improvement-design.md` — its decision to retain PySide6 Widgets, its §5.1 assignment of SQLite ownership to the GUI, and its §8 exclusion of a widget-framework replacement. Its JSONL protocol (§2), runtime selection (§3), and process supervision (§4) are carried forward and extended.
**Review:** `2026-09-05-codex-review-daemon-architecture.md`. Revision 1 treated the event journal as sufficient authority for execution state, recovery, and artifact validity. It is not. §4 of this revision replaces that with an explicit reconciliation model; the review's remaining findings are folded into the sections they affect.

**Decision:** Replace the Qt desktop shell with a headless Python daemon that both a web UI and the CLI consume as clients. The daemon serves the web UI itself from the same origin.

---

## Current product decision — 2026-10-15

Finish a brand-new daemon/browser application with a daemon-free training CLI.
The original Qt migration rollout is superseded: no Qt compatibility,
old-user-data migration, deprecation period or intermediate Qt-retaining release
is required. Qt sources temporarily retained in the dirty checkout are unshipped
historical material, not active product code; physical deletion is not claimed.
Preserve existing user files.

The 24 workstation capabilities remain functional product requirements, not a Qt
backward-compatibility matrix. API/protocol, durable-state, crash/replay recovery,
security and ownership safeguards below remain normative. Real-site filesystem/
Slurm validation is required before declaring HPC support. Final package/browser/
supported-platform validation remains required; tagging/publishing needs explicit
approval. Dated evidence records its original scope, not fresh cutover acceptance.

## 1. Goals and constraints

WaveDL users run training in four places: the workstation the GUI is on, a remote lab box, an HPC login node under SLURM, and hosted notebooks. A native desktop application serves only the first. Every remaining target requires the interface to be reachable over a network, which makes the client's delivery mechanism — not its widget toolkit — the load-bearing design decision.

Historical motivation (2026-09-05): the original shell was ~15,400 hand-written lines of PySide6 plus a 43,324-line generated `resource.py`. `TrainingWorker`, `TestWorker`, and `PlotWorker` in `src/wavedl_gui/service/training_service.py` spawned subprocesses and scraped merged stdout. That design could not observe a job the GUI did not launch, which is precisely the SLURM case. This describes the original design, not the current daemon/browser architecture.

Constraints that hold across the whole design:

- Windows, macOS, and Linux; CPU, Apple MPS, and NVIDIA CUDA.
- HPC login nodes frequently have restricted or absent outbound internet. Nothing may require reaching a third-party host at runtime.
- `wavedl-train` must remain directly executable with no daemon present, because inside a SLURM allocation it *is* the process the scheduler launched.
- A port opened on a shared login node is reachable by every other user on that node.
- Training processes are not under the daemon's control in the scheduled case, and the daemon may die and restart while they continue.

### 1.1 Supported deployment contract

"Remote is a URL" describes client connectivity, not execution deployment. A daemon URL cannot make a compute-node path readable from a login node. A deployment is supported only when all of the following hold, and the daemon must verify and report them rather than assume them:

- The daemon runs as the user who owns the runs, with a private writable data directory on a filesystem that supports reliable locking (§8).
- The run directory is on a filesystem visible to both the daemon and the execution environment, with declared visibility semantics (§3.3).
- Scheduler client commands (`sbatch`, `squeue`, `sacct`, `scontrol`, `scancel`) are on `PATH` and authorised for that user, where the Slurm backend is used.
- The site permits a long-lived user process on the host where the daemon runs.

Notebook runtimes with neither inbound SSH nor an HTTPS proxy have **no supported browser-access path** under §6. Colab is therefore a supported *execution* target via a user-supplied tunnel, not a supported zero-configuration target. This is a limitation, stated rather than hidden.

## 2. Architecture

Three components. Two are clients of the third.

```
┌──────────────┐     ┌──────────────┐
│   Web UI     │     │  wavedl CLI  │   clients
│   (PWA)      │     │              │
└──────┬───────┘     └──────┬───────┘
       │  HTTP + stream     │  HTTP
       └─────────┬──────────┘
                 ▼
        ┌─────────────────┐
        │  wavedl-daemon  │   headless core (FastAPI + uvicorn)
        │  reconciler     │   runs on workstation / lab box /
        │  run registry   │   HPC login node / notebook runtime
        │  serves the UI  │
        └────────┬────────┘
                 ▼
         ┌───────────────┐
         │   Backends    │
         └───────────────┘
           Local · Slurm
```

### 2.1 The daemon serves its own UI

`wavedl-daemon serve` prints a URL with a first-use token and serves the static web build at `/` from the same origin as the API.

```
$ wavedl-daemon serve
  WaveDL daemon running at http://localhost:8420/?token=a3f9...
```

Serving the UI from the daemon rather than a hosted origin is required, not merely convenient:

- **Airgapped operation.** The UI travels inside the Python package. A restricted-egress login node can still load it.
- **No package version skew.** UI and daemon ship and upgrade as one artifact. This does not eliminate *browser* skew; see §14.1.
- **No cross-origin surface.** Same origin removes CORS configuration and preflight handling. It does not by itself provide isolation from other localhost services; see §6.

Remote access is SSH port forwarding — `ssh -L 8420:localhost:8420 user@cluster`, then open `http://localhost:8420`. This keeps the browser on a potentially trustworthy origin, so service workers register and the PWA remains installable. `http://localhost` and `http://127.0.0.1` are potentially trustworthy per the Secure Contexts specification; a bare LAN IP address is not.

### 2.2 The CLI keeps a daemon-free path

`wavedl-train` must keep working standalone. A SLURM batch script invokes it directly; there is no daemon inside the allocation to be a client of. Client mode (`wavedl run --daemon <url>`) is additive and never becomes the only path. Manifest construction is therefore a **shared library** used by both the daemon and standalone launches, not a daemon-private step (§12).

## 3. Execution model

### 3.1 The backend seam

Revision 1 modelled execution as three interchangeable "executors" distinguished by how they run. That conflates planning with execution and hides the lifecycle differences that matter. The seam is instead:

```
plan(target)  →  submit  →  observe / reconcile  →  request_cancel  →  collect
```

- **`plan(target)`** produces a reviewable object: resolved manifest, resource and topology plan, environment activation, working directory, storage mapping, and the exact argv or `sbatch` script. It executes nothing. **Dry-run is `plan` without `submit`**, and it takes a target — rendering a local command and rendering a batch script are different plans, not one shared rendering. A plan that cannot be expressed for a target is **rejected**, never rendered as a plausible-looking script.
- **`submit`** returns a durable backend handle: backend identity, submission identity, owning user, storage locations, and the raw backend acknowledgment.
- **`observe`** returns raw backend observations, never a normalised verdict on its own.
- **`request_cancel`** is a request. A successful `scancel` is an acknowledged request, not proof that cleanup and resource release finished.
- **`collect`** gathers artifacts and terminal evidence.

Two backends: **Local** and **Slurm**. `Ssh` is expressible in the same seam later and is out of scope.

Backend-native states are preserved alongside the normalised application state. A held allocation, a pending allocation, and a running process awaiting shutdown are different conditions with different deadlines; the six inherited runtime states cannot represent them.

### 3.2 Run directory layout

Every backend produces the same structure, so the reader is backend-independent:

```
<run_dir>/
  manifest.json              immutable resolved plan for this run
  attempts/<n>/events.jsonl  canonical event journal, per attempt
  attempts/<n>/stderr.log    captured diagnostics, not protocol
  attempts/<n>/rank/<r>.log  per-rank stderr for non-zero ranks
  checkpoints/<generation>/  immutable published generations (§11)
  training_history.csv       existing WaveDL output, unchanged
  plots/
```

**Attempt identity is mandatory.** SLURM requeue (node failure, preemption) re-runs the same job id from the start, and `seq` restarts at zero. Without a per-attempt journal, a requeue corrupts both the sequence and the metric history. The attempt number is allocated by the writer at startup and recorded in the manifest's attempt index.

### 3.3 Journal storage contract

The journal is a **telemetry record**, not the authority for execution state (§4). It still needs a real storage contract:

- **Exactly one writer per attempt.** Under `accelerate launch --num_processes=N` there are N training processes. `seq` is only well-defined with a single writer. Only the main process writes `events.jsonl`, using the existing `accelerator.is_main_process` guard. Non-zero ranks write `rank/<r>.log` for diagnostics and never touch the journal.
- **Newline is the commit boundary.** A reader that reaches EOF mid-object must buffer the fragment and wait, never apply the inherited "malformed line → warn and continue" rule to an incomplete tail. Records have a maximum size; a fragment exceeding it, or an abandoned tail after a crash, triggers a defined rollover rather than silent corruption of the next record.
- **A successful append is not a durable commit.** The writer flushes and `fsync`s on a defined cadence. The contract states what is guaranteed after a crash, rather than assuming it.
- **Non-finite numbers are forbidden on the wire.** RFC 8259 has no `Infinity`/`NaN`, and `JSON.parse` rejects them. `best_val_loss` is infinity until the first checkpoint, so this affects epoch 1 of every fresh run. Emitters serialise non-finite values as `null` with `allow_nan=False`; consumers treat `null` as "unavailable" and restore their own sentinel. *(Fixed in `train.py` ahead of this spec; the protocol now requires it.)*
- **Filesystem visibility is declared, not assumed.** Local POSIX filesystems make `O_APPEND` position-atomic but guarantee neither multi-write transactions nor persistence. **NFS** does not provide a distributed record-append, and close-to-open consistency is not a promise that an already-open tailing descriptor sees another client's writes — a login-node daemon tailing a compute-node writer may see nothing until close. **Lustre and GPFS** provide materially stronger coherence and should not be lumped in with NFS. The daemon declares a visibility tolerance, reopens rather than holding a descriptor indefinitely, and never treats EOF as completion or as a heartbeat.

Because tailing is unreliable on some supported filesystems, the journal is the **durable and replay** path, and a direct push from the training process to the daemon is the **live** path where the compute node can reach it. Neither is required for correctness of the other.

## 4. State authority and reconciliation

This section replaces revision 1's implicit claim that the journal is the source of truth.

Three authorities exist and must not be collapsed:

| Authority | Source | Example |
|---|---|---|
| **Execution intent** | User request, persisted by the daemon | "run this manifest", "cancel this run" |
| **Execution observations** | Runtime journal, process supervisor, scheduler | `exit` event, process return code, `sacct` state |
| **Published results** | Completion manifests | which checkpoint generation is usable (§11) |

Displayed state is **derived** by a reducer over all available observations, with documented precedence and explicit uncertainty. The reducer's rules:

- An `exit` event in the journal is runtime evidence, not a verdict. It is confirmed by the process return code (Local) or scheduler terminal state (Slurm).
- A runtime success followed by a batch-script failure is a **failed run**. Training, batch, and stage-out outcomes are preserved independently; the script's final exit status alone must not overwrite the training outcome.
- **Failure to observe is not evidence of termination.** A command timeout, controller outage, or authorisation error yields `observation_unavailable`, never `failed`.
- When evidence is genuinely absent — no `exit` event, job gone from the scheduler, accounting unavailable — the state is **`terminal_unknown`** with the last known evidence attached. Guessing `failed` is forbidden.
- Event application to the registry is **idempotent**, and the ingestion cursor is updated in the same transaction as the projection. A crash between the two must not skip or double-apply an event.
- Replay-to-live handover is gap-free: the subscription is established before the replay watermark is finalised, so an event arriving during handover is neither lost nor duplicated.

### 4.1 Submission has an unavoidable ambiguous window

No transaction can span "scheduler accepted the job" and "daemon recorded the handle". If the daemon dies between them, a naive retry submits a second expensive GPU job.

The daemon persists a **submission intent with a durable request id before submitting**, embeds that id in the rendered script and job name, and on restart **reconciles by searching the backend for that id** before considering a retry. Where acceptance cannot be established, the run enters `submission_unknown` and **automatic resubmission is prohibited**; resolution is an explicit user action. A cancel request arriving before a handle exists is recorded against the intent and applied once the handle is known.

## 5. Protocol

### 5.1 Envelope

Carried forward from the Aug 2 design:

```json
{"protocol":"wavedl-jsonl","version":1,"run_id":"uuid","attempt":1,"type":"metric","seq":7,"ts":"2026-09-05T12:00:00Z","payload":{}}
```

`attempt` is added (§3.2). Event types, payload schemas, unknown-field tolerance, and terminal semantics are as specified in the Aug 2 document §2.2–§2.3, amended by the numeric rule in §3.3.

**Ordering.** `seq` orders one journal. Training step orders learning progress. Monotonic clocks measure elapsed time and deadlines. `ts` is wall-clock and **must not** be used to order observations from different machines — compute-node and login-node clocks disagree, and NTP steps are not monotonic. Producer and observation timestamps are recorded separately when combining scheduler and runtime evidence.

### 5.2 Two handshakes, not one

Revision 1 replaced the runtime `hello` with `GET /api/health`. That was a regression: health negotiates with the *daemon*, which cannot establish the version, device visibility, or capabilities of an interpreter that activates later inside an allocation or container. A CPU-only login node must not disqualify a GPU job, and a healthy daemon must not certify a compute-node environment it cannot see.

- **`GET /api/health`** — daemon and API compatibility, daemon-side versions, backend availability.
- **Runtime `hello`** — emitted by the training process inside its actual execution environment, reporting interpreter, container, WaveDL and protocol versions, and allocated devices. It remains the first journal event, and its absence within a deadline remains a protocol failure.

Execution provenance from `hello` is recorded separately from the immutable submitted request. Because the mandatory first event is retained, protocol `version` stays at 1.

### 5.3 HTTP surface

```
GET  /                            static web UI
GET  /api/health                  daemon + API compatibility, backends available
GET  /api/models                  model registry metadata
POST /api/datasets/inspect        shape, dtype, sample count (bounded, see §7)
GET  /api/runs                    list, filterable by state
POST /api/runs/plan               reviewable plan for a target; executes nothing
POST /api/runs                    submit a plan; returns a durable handle
POST /api/runs/adopt              register an externally launched run (§12)
GET  /api/runs/{id}               derived state, evidence, uncertainty
GET  /api/runs/{id}/events        event stream, resumable
POST /api/runs/{id}/cancel        records a cancellation request
GET  /api/runs/{id}/artifacts     published artifacts only (§11)
```

### 5.4 Event streaming

Transport is **`fetch` with a streaming response body**, not `EventSource`. `EventSource` cannot set request headers, which would force stream authentication onto cookies — and cookies are not port-isolated (§6). Using `fetch` allows `Authorization: Bearer` on the stream exactly as on every other endpoint, and resumption is already implemented manually via `seq`, so `EventSource`'s automatic reconnection is not a loss worth taking the cookie exposure for.

Resumption: the client sends its last applied `seq`; the daemon replays from the journal beyond it, then hands over to live without a gap (§4). Cursor persistence across page reloads is application state in the client, not a browser-managed reconnect.

## 6. Security

The daemon is a network service the moment it binds a port, and HPC login nodes are shared.

- **Bind `127.0.0.1` by default.** `--host 0.0.0.0` is an explicit opt-in and still requires a token.
- **A bearer token is required on every protected API endpoint.** The serve lifecycle generates a fresh access token unless an explicitly configured credential file supplies it; access tokens are not printed in startup URLs or logs. Process arguments are not the preferred transport for long-lived secrets.
- **No authentication cookie is ever set or accepted.** Cookies are not port-scoped: other services on `localhost` share the cookie jar. API and stream clients send `Authorization: Bearer` explicitly. Host validation applies to all HTTP paths, and requests with an Origin must match the daemon origin, including port. A same-site bodyless cancellation request without a bearer header does not authenticate.
- **Bootstrap is a separate short-lived capability, not an access token or cookie session.** When enabled, `POST /api/bootstrap` is the only unauthenticated API exception. It consumes a same-origin, single-use code and returns the bearer token in a non-cacheable JSON response. Only code hashes are retained while pending; replay and expiry are refused atomically. The client strips the bootstrap code from its navigation URL immediately. Access logs redact credentials, including encoded query values. The corrected migration plan's T21/T21b decisions supersede the earlier cookie/session description.
- **Artifact access is validated at open time, not only at event time.** A symlink that resolved inside the run directory when the event was accepted can be replaced before the daemon opens it. Containment is enforced on every read, with an explicit symlink policy and verified ownership when adopting runs.
- **Artifacts are never served inline as active content.** An HTML or SVG artifact rendered at the authenticated daemon origin would become an API-capable page. Downloads are served with a non-renderable content type and a restrictive `Content-Security-Policy`.

Plain HTTP over a LAN is not a supported access pattern: it is not a trustworthy origin, so the service worker will not register and the token would cross the network in the clear. Supported remote access is SSH port forwarding, or a user-supplied HTTPS reverse proxy or tunnel.

## 7. Dataset inspection

`POST /api/datasets/inspect` moves dataset introspection into the daemon — which, on an HPC login node, means onto a shared, memory-capped host. This is the single most likely way to get a user's account flagged by site administrators.

`np.load` **silently ignores `mmap_mode` for `.npz` archives**: the returned `NpzFile` yields a fully materialised `ndarray` on member access, not a `memmap`. Confirmed empirically — `.npy` returns `memmap`, `.npz` returns `ndarray`. `src/wavedl/utils/data.py` `load_mmap` therefore reads the entire input array for NPZ, the format the README leads with.

Requirements:

- **Read NPZ shape and dtype from the member header, not the data.** NPZ members are `.npy` files inside a zip; `zipfile` plus the `.npy` header gives shape and dtype without decompressing the array.
- **Enforce an explicit size and time budget**, and return a structured refusal when a file exceeds it rather than attempting the read.
- **Run inspection in a bounded worker**, never on the event loop. Replacing QThread with `async` does not make a blocking filesystem read asynchronous.

## 8. Daemon state and storage

The daemon owns the run registry; clients never touch it directly. This supersedes the Aug 2 §5.1 assignment of SQLite to the GUI, which is not expressible once the GUI is not a process on the training machine.

- **A private per-user data directory**, not a path relative to a shared checkout. The legacy `AppData` resolution in `src/wavedl_gui/common/setting.py` resolves relative to the working directory outside the packaged-Windows branch; migration must not infer ownership from a shared location.
- **SQLite placement is constrained.** WAL depends on shared-memory coordination and is not supported across hosts on a network filesystem; other journal modes still require reliable locking. The supported placement is local disk, and the daemon refuses to start rather than corrupting a database on an unsupported mount.
- **One active dispatch owner.** The same user starting daemons on two login nodes must not produce two dispatchers acting on the same pending submission. SQLite serialising individual transactions does not prevent duplicate external side effects. A lock with a recorded owner and liveness gates dispatch; a daemon without it runs read-only.
- **No legacy downloader database import.** The corrected plan's T7b decision supersedes the earlier import proposal: foreign/unversioned databases are refused and configured user data is not deleted. Daemon schema upgrades use SQLite-consistent backups, transactions, a migration ledger and read-only recovery. Runtime journals rebuild telemetry only; they cannot recover lost idempotency, submission claims, handles, or authoritative request intent.

Client-side presentation state (theme, layout, last-used paths) stays in the browser and is **namespaced per backend identity**, so reusing a forwarding port for a different daemon does not carry preferences across.

## 9. Process supervision

### 9.1 The process tree is four levels deep

`wavedl-train` is not the training process. `src/wavedl/launcher.py` builds `accelerate launch --num_processes=N ... -m wavedl.train` and runs it via `subprocess.run`:

```
wavedl-daemon
 └─ wavedl-train (launcher.py)        daemon's direct child
     └─ accelerate launch
         └─ wavedl.train × num_gpus   processes holding GPU memory
```

The launcher's only signal handling is `except KeyboardInterrupt`. Python raises `KeyboardInterrupt` on SIGINT, **not** SIGTERM, so a SIGTERM to the launcher kills it, abandons `subprocess.run`, and orphans `accelerate` plus N processes holding GPU memory.

Two changes are therefore required, and one of them is in `src/wavedl/`:

- The supervisor signals the **process group**, not the direct child, for both the graceful and forceful phases.
- `launcher.py` gains a SIGTERM handler that forwards to its child and waits. This is a change outside the daemon, stated explicitly rather than assumed.

The Aug 2 §4 requirements are otherwise retained in full: no shell, stdin closed, streams captured separately, `start_new_session=True` on POSIX, a Windows Job Object with kill-on-job-close assigned immediately, monotonic deadlines, idempotent cancellation, exactly one terminal result, and full reaping before release.

### 9.2 Daemon restart does not restore Local supervision

A replacement daemon can replay the journal, but it cannot recreate the parent relationship, the `Popen` handle, or the stdout pipe. A stored PID is not safe for later cancellation because PIDs are reused.

The policy is explicit: **Local runs do not survive daemon death as supervised runs.** On restart, a Local run whose supervisor is gone is marked `supervision_lost` with its journal intact and its last known evidence attached. It is never silently adopted as running, and never reported as failed on that basis alone.

## 10. Scheduler integration

- **`sacct` requires `slurmdbd`.** Where site accounting is not configured, `sacct` returns nothing. The daemon probes accounting availability at startup and records it as a backend capability.
- **`MinJobAge` defaults to 300 seconds**, after which completed jobs are purged from `squeue` and `scontrol`. The daemon reads `MinJobAge` from `scontrol show config` and polls faster than it. Where accounting is unavailable *and* the window is missed, the state is `terminal_unknown` (§4), not `failed`.
- **Topology mapping is explicit.** Allocating two nodes does not by itself run the launcher on both, and wrapping a multi-process launcher in too many scheduler tasks multiplies workers. The plan maps scheduler resources onto the launcher's `--num_machines`, `--machine_rank`, and rendezvous parameters, and rejects combinations it cannot express.
- **The sbatch template is site-configurable**, covering partition, account, constraints, module loads, container wrappers, and environment activation. Output directories required for scheduler redirection are created before submission, and the renderer's shell-expansion semantics inside `#SBATCH` directives are defined rather than assumed.
- **Scheduler polling is batched** across runs, with timeouts and backoff, so that many daemons do not become an aggregate load problem on the controller.

## 11. Checkpoint publication

An artifact event naming a path does not establish that the path's contents are valid. `train.py` saves into a reusable `best_checkpoint` directory with fixed names; a crash mid-save leaves a mixture of generations while the old event still names the same directory.

- Checkpoints are written as **immutable generations** and announced only after a completion manifest is written. `GET /api/runs/{id}/artifacts` returns published generations only.
- Each generation records the training step it corresponds to.
- **Resume logically supersedes later metrics.** `train.py` already truncates restored CSV history to the checkpoint epoch; an append-only journal needs the equivalent *logical* rollback marker, or the dashboard will keep showing metrics for work the restored model no longer represents.
- Standalone runs can generate a completion manifest without a daemon, so daemon-free execution stays first-class.

## 12. Run adoption and output ownership

- **Adoption is an explicit operation.** A user who launches training by hand has files but no registry record. `POST /api/runs/adopt` registers an existing run directory with verified provenance and ownership.
- **Manifest construction is a shared library** used by both standalone launches and the daemon, so an adopted run's manifest is not a second-class reconstruction.
- **Output directories are exclusively allocated.** `--output_dir` defaults to `"."` and is created with `exist_ok=True`, with fixed checkpoint names; a fresh run UUID does not isolate those files. The daemon allocates a directory or refuses to start a run that would collide with an active one.

## 13. Resource limits and backpressure

- Ingestion queues are **bounded**, with subscriber isolation so one slow client cannot stall others.
- A **disk-full or storage-error policy** is required. The inherited rule that logs are never silently dropped from disk needs an explicit choice: fail the run, spool to a bounded emergency buffer, or continue with visibly degraded telemetry. Silence is not an option.
- Blocking filesystem and scheduler calls run in a bounded threadpool, never on the event loop.
- Journal readers do not rescan a growing file from the start; they track offsets per attempt.

## 14. Web client

Generated with `create-nuxt-saas` using modules **`base` + `pwa`**, optionally `content` for a bundled docs site.

`base` is frontend-only in that kit — no `server/`, no database, no authentication — which is correct here. Everything above it (`server-core`, `database`, `auth`, `admin*`, `feature-flags`, `auth-*`) is Cloudflare/D1/session machinery that would be architecturally wrong: WaveDL's backend is the user's own daemon, and its credential is a daemon token rather than an account record.

- **`ssr: false`, `nuxt generate`.** The static output is vendored into the Python package and served by the daemon at `/`. The kit's Cloudflare/NuxtHub defaults must be overridden.
- **Charts use uPlot.** Runs emit thousands of epochs; uPlot renders 100k+ points at interactive framerates in under 50KB. This is the functional replacement for pyqtgraph and the one frontend choice that can reintroduce the sluggishness the rewrite exists to remove.
- **The service worker must not intercept `/api/**`.** Cache strategy is navigation-and-assets only. Offline means the shell loads and reports no daemon connection.
- PWA installability is retained: served from `http://localhost`, a trustworthy origin, the app installs with its own window and launcher icon.
- The kit's `.nuxt-saas/manifest.json` and three-way upgrade merge are kept.

### 14.1 Package parity is not browser parity

Bundling guarantees that the shipped daemon and client match. It does not guarantee that the client *currently executing in the browser* matches: a service worker serves a cached shell across a daemon upgrade, and a reused forwarding port presents a different backend at the same origin. The daemon exposes its identity and API compatibility, the client reports its build identity, a mismatch is surfaced to the user, and service-worker upgrade behaviour is defined rather than left to defaults.

A multi-endpoint connection manager remains out of scope; it is the only feature that reintroduces cross-origin concerns.

## 15. Migration

### Current delivery contract — 2026-10-15

1. Complete the daemon/runtime contracts and failure-oriented reliability gates.
2. Complete the browser's 24 functional capabilities against those contracts.
3. Verify new-app wheel/sdist, entry points, vendored static assets, daemon-free
   CLI and supported deployments. Exclude Qt from shipped artifacts; no
   intermediate Qt-retaining release is required. Publish only with approval.

Historical rollout (superseded 2026-10-15): the original three phases extracted
the daemon beneath Qt, kept Qt shipping while the browser was built, then retired
Qt after a deprecation release. T30a/T30b and T40/R1/T41 record that former plan,
not dependencies of this new application. T30c reliability and real-site evidence
before claiming HPC support are not waived by this scope change.

### 15.1 Original code disposition estimate (historical, not a deletion certificate)

| Code | Lines | Fate |
|---|---|---|
| `common/constants/models.py` | 2,484 | Moves to daemon, served by `/api/models` |
| `view/` + `components/` | 8,586 | Rewritten as the web client |
| `service/` | 944 | Becomes daemon backends and supervision |
| `common/utils.py` | 611 | Split: introspection to daemon, Qt helpers dropped |
| `common/constants/index.py` | 436 | Becomes the shared manifest schema |
| `common/database/` (QtSql DAO) | 880 | Replaced by sqlite3/SQLAlchemy in the daemon |
| `common/concurrent/`, `wizard_state.py` | 506 | Dropped; async replaces QThread |
| `common/resource.py` | 43,324 | Deleted; assets become static files |

Approximately 4,500 lines port with edits, 9,000 are rewritten, and 43,000 generated lines are removed.

## 16. Testing

Phase 1's gate is **failure-oriented**. Rendering fixtures do not exercise the failures that matter.

- Interrupted submission at each persistence boundary, including the §4.1 ambiguous window; assert no duplicate job is ever created.
- Incomplete journal tails, oversized records, and abandoned tails after a simulated crash.
- Delayed filesystem visibility; a reader that sees no data for an extended period must not report completion.
- Snapshot/replay races: crash between projection and cursor commit, in both orders; assert no skip and no double-apply.
- Replay-to-live handover under events arriving during handover.
- Storage exhaustion and read-only filesystems.
- Daemon restart during an active Local run; assert `supervision_lost`, not a false running or failed state.
- Checkpoint publication interrupted mid-generation; assert the previous generation stays published.
- Runtime/daemon mismatch: a `hello` reporting an incompatible runtime inside an allocation that a healthy daemon accepted.
- Scheduler lifecycle simulation: accounting unavailable, `MinJobAge` window missed, requeue, held allocation, controller timeout.
- Local cancellation kills the full `accelerate` tree on Windows, macOS, and Linux; assert no orphaned GPU processes.
- Protocol: strict-JSON conformance including non-finite values, unknown events, ordering, and attempt boundaries.
- Auth: unauthenticated rejection, Origin/XSRF enforcement on mutating requests, cookie-name isolation, `0.0.0.0` refusing to start without a token.
- Artifact containment including symlink replacement between event acceptance and open.
- Client: service worker does not intercept `/api/**`; version-mismatch surfacing.

Beyond simulation, **at least one real site's filesystem and scheduler integration must be validated before claiming HPC readiness.**

## 17. Out of scope

No native desktop shell (Electron, Tauri, GPUI) in this phase — the daemon makes it an additive client later. No multi-endpoint connection manager. No `SshExecutor`. No hosted UI origin. No bundled tunnel or VPN. No multi-user accounts, roles, or tenancy: a per-user token service is sufficient within §1.1's envelope, and shared or team access requires a separately designed tenancy layer. No scheduler support beyond SLURM. No changes to training algorithms beyond structured event emission, supervision signals, and checkpoint publication.

## 18. Known risks

- **SLURM site variability** remains the most likely source of field failures, now partly mitigated by §10's site template and explicit rejection of inexpressible topologies.
- **Windows process-tree control** is the least-covered platform path.
- **Shared-filesystem behaviour** is deployment-dependent; §3.3 defines tolerances but only site validation confirms them.
- **`create-nuxt-saas` static output** is off the kit's Cloudflare/NuxtHub main path and needs verification early.
- **Wheel size** grows with the vendored client; measure before committing to bundling versus an optional extra.
- **Phase 1 scope** roughly doubled relative to revision 1. If that proves too large to land in one piece, the split point is §10 (scheduler integration), which can follow a Local-only Phase 1 without invalidating §4.
