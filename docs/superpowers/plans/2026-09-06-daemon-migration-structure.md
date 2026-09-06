# WaveDL Daemon Migration — Corrected Task Structure

**Status:** structure settled; task detail to be written against it
**Date:** 2026-09-06
**Spec:** `../specs/2026-09-05-wavedl-daemon-architecture-design.md`
**Reviews:** `2026-09-05-codex-review-migration-plan.md` (findings F1–F17), plus a
second Codex review of the 42-task skeleton that produced this structure.

Two rounds of review rejected the decomposition before any detail was written.
The lesson from the second round is that **increasing the task count does not
expose missing work** — naming each task's contract does. Every task below
therefore carries four fields:

- **Produces** — the symbols and artifacts later tasks may rely on.
- **Consumes** — what must already exist, by task number.
- **Failure cases** — the failures this task's tests must exercise. A task
  whose failure column is empty is not ready to be written.
- **Gate** — which milestone this contributes to.

Task numbers keep their original identity with suffixes (`T20a`, `T20b`) so
traceability to F1–F17 survives. Renumber only when the detail is written.

## Milestones

| Milestone | Ends after | Establishes |
|---|---|---|
| **1A — contracts, storage, supervision** | T13b | Core contracts, storage ownership, migration/recovery, platform supervisors, each with focused failure tests |
| **1B — functioning headless service** | T39a | The daemon works through its public interface with no Qt involved |
| **1C — existing client migrated** | T30c | Qt drives the daemon for every workflow; real-site validation recorded |
| **2 — web client** | T38 | Parity enumerated up front, every row owned |
| **3 — release and retirement** | T42 | Qt removed after a release that carried the deprecation notice |

Phase 1 keeps both backends. Deferring Slurm was offered and declined: it is
central to the product, and building both early exposes false abstractions in
identity, storage, lifecycle, and topology before the web client depends on
them. Note that **T18a is not Slurm-only** — durable request handling,
cancellation intent, and controller startup are needed for Local too.

## Two invariants that constrain ordering

**The app must work between every pair of commits, not just between phases.**
This is not theoretical. `PlotWorker` hardcodes `os.path.join(output_dir,
"best_checkpoint")` and refuses to run without it
(`src/wavedl_gui/service/training_service.py:302`), and plot generation fires
automatically after every successful run (`:565`). Publishing checkpoints as
`checkpoints/gen-NNNNNN/` before that reader understands generations breaks the
shipping app on its happy path. **Consumers learn the new layout before
producers emit it** (T20b before T20c/T20d).

**Emergency saves are deliberately different from normal saves.** Normal saves
are collective across ranks; the emergency path is rank-zero-only to avoid a
deadlock after interruption (`src/wavedl/train.py:1962`). Routing every save
through one helper would erase that distinction, so T20d is its own task with
its own review.

---

## Phase 1A — shared contracts

| Task | Produces | Consumes | Failure cases | Gate |
|---|---|---|---|---|
| **T1** Protocol envelope | `Envelope`, `encode`, `decode`, `finite_or_none`, `ProtocolError` | — | unsupported version; non-finite in payload; negative seq/attempt; malformed JSON; unknown fields tolerated | 1A |
| **T2** Per-type payload schemas + supersession event | `HelloPayload`, `StatePayload`, `MetricPayload`, `ArtifactPayload`, `ExitPayload`, `SupersedePayload` | T1 | wrong type for a known field; unknown event type warns not fatal; supersession referencing an absent step | 1A |
| **T5** Run layout, attempt allocation, operation identity | `RunLayout`, `OperationKind{train,test,plot}`, `allocate_attempt` | — | concurrent allocation race; existing numeric dirs; requeue creating attempt 2 | 1A |
| **T6** Resolved manifest in `wavedl.core` | `Manifest` (resolved config, runtime selection, cwd, storage map), `build_manifest`, `write_manifest`, `read_manifest` | T5 | overwrite refused; interrupted write leaves no partial file; relative paths resolved before submission | 1A |
| **T3** Journal writer | `JournalWriter`, `RecordTooLarge`, `AbandonedTail` | T1, T5 | oversized record leaves no partial bytes; **reopen over an unfinished tail starts a new segment rather than appending through it**; fsync policy; disk-full | 1A |
| **T4** Journal reader | `JournalReader`, `seek_to_seq`, bounded reads | T1, T3 | incomplete tail buffered; **cursor −1 replays seq 0**; **gap in sequence still replays the rest**; schema-invalid line raises `ProtocolError`; CRLF offsets; malformed-line bound | 1A |
| **T20a** Shared generation publication | `publish_generation`, `published_generations`, `COMPLETE.json` | T5, T6 | interrupted mid-copy leaves prior generation published; fsync ordering of contents before manifest; **works with no daemon installed** | 1A |

## Phase 1A — durable control and supervision

| Task | Produces | Consumes | Failure cases | Gate |
|---|---|---|---|---|
| **T7a** Settings and storage validation | `Settings`, `default_data_dir`, `UnsupportedStorage`, **separate daemon-state root and shared run root** | — | network mount refused for SQLite; unwritable dir; run root not visible to compute nodes | 1A |
| **T8a** Registry transactions and cursors | `Registry`, `RunRecord`, `apply_events`, `(attempt, seq)` cursors | T7a | crash between projection and cursor in both orders; duplicate apply; cursor per attempt not per run | 1A |
| **T8b** Dispatch ownership | `acquire_dispatch_lock` with liveness, `require_dispatch` guard | T8a | **killed daemon releases the lock**; two daemons; every external mutation gated | 1A |
| **T7b** Legacy migration and recovery | `migrate_legacy`, `schema_version`, `migration_id` | T8a | interrupted migration restores backup; read-only recovery start; **explicit disposition of the legacy `task` entity's download fields (`url`, `isLive`, `isBinaryMerge`)** | 1A |
| **T13a** Backend and operation contracts | `Backend` protocol, `Plan`, `Handle`, `OperationKind` lifecycle/result contract, `UnsupportedPlan` | T5, T6 | unsupported topology refused not rendered; operation kinds declared here so T28 does not redesign the seam later | 1A |
| **T22a** Persisted plan and idempotency | `PlanRecord`, `idempotency_key`, transactional uniqueness | T8a, T13a | concurrent identical submits collapse to one; key bound to payload; retry after lost response | 1A |
| **T9** Reducer | `RunState`, `DerivedState`, `reduce` | T2, T8a, T13a | **17-case truth table**: supervision lost, queued, held, absent observation, observe error, wrapper-success-with-training-failure, vanished, requeue attempt isolation | 1A |
| **T29a** Bounded execution | `WorkBudget`, bounded threadpool, subprocess deadlines | T7a | worker exhaustion; deadline cancels the work not just the wait; storage-error policy | 1A |
| **T10** Launcher signal forwarding | `_install_sigterm_handler`, `_terminate_child` | — | **no `Popen.wait()` inside the handler**; child ignoring SIGTERM escalates; exit reports 128+signum | 1A |
| **T11** POSIX supervisor | `Supervisor` contract, group signalling, output draining | T29a, T10 | leader exits immediately with a SIGTERM-ignoring grandchild; repeated cancel is idempotent; output exceeding pipe capacity; full reap before release | 1A |
| **T12** Windows supervisor | same `Supervisor` contract via Job Object | T11 | **race-free assignment at spawn**; graceful phase distinct from kill-on-close; same failure set as T11 | 1A |
| **T13b** Local planning | `LocalBackend.plan` | T13a | multi-machine refused; caller-supplied `--output_dir` refused | 1A |
| **CI-1** Cross-platform CI matrix | Ubuntu/macOS/Windows job | T11, T12 | must exist **here**, not at T42 — a release task cannot retroactively validate intermediate Windows commits | 1A |

## Phase 1B — execution and runtime

| Task | Produces | Consumes | Failure cases | Gate |
|---|---|---|---|---|
| **T14** Local execution | `LocalBackend.submit/observe/collect` | T11, T12, T13b | daemon restart yields `supervision_lost` not running; pid reuse | 1B |
| **T15** Slurm planning | `SlurmBackend.plan`, `job_name`, sbatch template | T13a | **`$$` escaping — bare `$?` raises ValueError**; log dir precreated with `%j` in filename; topology maps to `num_machines`/`machine_rank`; unexpressible topology refused | 1B |
| **T16** Slurm submission | `submit`, `find_by_request_id`, `SubmissionUnknown` | T15, T22a | unparseable ack; timeout classified as unknown; **two matching jobs is ambiguity not adoption**; owner verified | 1B |
| **T17** Slurm observation and collection | `observe`, `collect`, `capabilities` | T16 | **`sacct` RUNNING row is not terminal**; accounting absent; `MinJobAge` window missed; controller error ≠ absence; exit code and signal preserved; **independent training/batch/stage-out outcomes** | 1B |
| **T18a** Submission and cancellation controller | startup + periodic reconciliation loop | T16, T8b, T22a | crash between sbatch and record → recovered, never resubmitted; cancel before handle applied after recovery; unknown acceptance stays unknown | 1B |
| **T18b** Batched scheduler reconciliation | fleet polling, backoff, retention-aware schedule | T17, T29a | many runs batched into one query; backoff on controller error; previous evidence retained | 1B |
| **T19** Standalone bootstrap and runtime emission | `wavedl.journal.RunJournal`, `WAVEDL_RUN_ID` propagation, rank logs | T1–T6 | **non-main rank writes nothing**; identity propagated from launcher, not regenerated; standalone run produces a real manifest | 1B |
| **T19n** Runtime negotiation | first-event enforcement, version range check, provenance persistence | T19, T8a | hello absent past deadline; incompatible runtime version; **scheduler wait distinguished from handshake timeout** | 1B |
| **T20b** Generation-aware consumers | resume selection, supersession projection, **legacy `best_checkpoint` compatibility** | T20a, T2 | resume picks a published generation; supersession invalidates later metrics; **Qt PlotWorker still works** | 1B |
| **T20c** Normal save integration | best + periodic saves publish generations | T20b | collective participation across ranks; all rank files complete before publish | 1B |
| **T20d** Emergency save integration | interrupted-run publication | T20c | **rank-zero-only path preserved — routing it through the collective helper deadlocks** | 1B |
| **T21** App, auth, health identity | `create_app`, `require_auth`, Host validation, `/api/health` with daemon/build identity | T7a | **no cookie is ever set**; token in a cookie does not authenticate; missing and disallowed Host; no leakage of run id or token | 1B |
| **T21b** Bootstrap credential handling | single-use exchange, access-log redaction | T21 | token absent from logs; replay of a consumed bootstrap refused | 1B |
| **T22b** Lifecycle endpoints | plan/submit/list/get/cancel | T22a, T9 | intent persisted before backend call (verified by injecting failure at the boundary) | 1B |
| **T22c** Verified adoption | `POST /api/runs/adopt` | T22b, T6 | provenance and ownership verified; group-writable directory refused; **adopts a genuinely standalone-produced run** | 1B |
| **T23** Ingestion, projection, delivery | `Ingestor`, `EventBroker` as wakeup only, DB authoritative | T8a, T4, T29a | commit without wakeup still delivered; overflow disconnects with recoverable position rather than advancing past a gap | 1B |
| **T23p** Runtime live-push path | authenticated attempt-aware push endpoint | T23, T21 | dedup against journal replay; outage falls back to file; **spec §3.3 requires this — removing it needs a spec change** | 1B |
| **T24** Resumable stream | `GET /api/runs/{id}/events` with `(attempt, seq)` cursor | T23 | **attempt 2 seq 0 is not suppressed by attempt 1 seq 100**; replay-to-live handover loses nothing | 1B |
| **T25** Safe artifact access | listing + download | T20a, T21 | **symlink replaced between validation and open**; active content never served inline | 1B |
| **T26** Dataset inspection | `inspect_dataset`, `npz_member_headers` | T29a | **public numpy header API**; oversized refused; deadline enforced; **training loader contract unchanged**; `.hdf5` parity | 1B |
| **T27** Models and browse endpoints | `/api/models`, `/api/browse` | T21 | unreadable path; containment | 1B |
| **T28a** Test operation | test kind through the seam | T13a, T14 | same lifecycle contract as train | 1B |
| **T28b** Plot operation | plot kind through the seam | T28a, T20b | consumes published generations | 1B |
| **T29b** Daemon lifecycle and serve CLI | `wavedl-daemon serve` | T29a, T21 | port in use; shutdown drains | 1B |
| **T29c** Daemon-client CLI | `wavedl run --daemon <url>` | T22b | **`wavedl-train` still runs with no daemon**; uses the idempotency contract | 1B |
| **T39a** Installed-package checks | wheel contents, console scripts | T29b | **runs outside the checkout — `PYTHONPATH=src` hides a missing script** | 1B |

## Phase 1C — existing client

| Task | Produces | Consumes | Failure cases | Gate |
|---|---|---|---|---|
| **T30a** Qt training adapter | `TrainingWorker` via daemon | T24, T22b | stream reconnect; daemon absent | 1C |
| **T30b** Qt test/plot/data adapters | `TestWorker`, `PlotWorker`, inspection via daemon | T28a, T28b, T27 | **no subprocess spawning remains** | 1C |
| **T30c** Cross-component failure harness + real-site gate | reusable harness | T30a, T30b | every §16 failure exercised; **one real cluster validated, filesystem and Slurm version recorded** | 1C |

## Phase 2 — web client

Parity is enumerated **before** implementation; every row gets an owner.

| Task | Produces | Consumes | Failure cases | Gate |
|---|---|---|---|---|
| **P0** Parity matrix | enumerated Qt capability → owning task | T30b | a row with no owner blocks Phase 2 | 2 |
| **T31** Scaffold, static serving, build fixture, client CI | vendored build, SPA fallback, **effective** worker config | T21 | **built worker's real routing tested, not the config object**; `/api/**` not intercepted; prompt-not-autoUpdate | 2 |
| **T32** API client and identity | `apiFetch`, connection store, **bootstrap URL stripping** | T31, T21 | 401 re-prompt; skew surfaced; token removed from URL | 2 |
| **T33** Streaming client | `streamRun` with `(attempt, seq)` | T24, T32 | **`new TextDecoder("utf-8")` + `decode(chunk,{stream:true})`**; UTF-8 split across chunks; cursor persisted per backend | 2 |
| **T37** Browse and model UI | path browser, model selector | T27 | — | 2 |
| **T34** Run views | list, detail, state badges | T33 | uncertain states visually distinct from failure | 2 |
| **T35** Charts | uPlot, supersession-aware | T34, T20b | **restored history replaced, not frozen**; 100k points | 2 |
| **T36** Plan preview | bound to the persisted plan | T22a | preview equals what submits | 2 |
| **P1** Project/hyperparameter authoring | — | T36 | — | 2 |
| **P2** Data visualisation | — | T27 | — | 2 |
| **P3** Test/results/export | — | T28a | — | 2 |
| **P4** Settings | — | T32 | — | 2 |
| **T38** Parity verification only | signed-off matrix | P0–P4 | — | 2 |

## Phase 3 — release and retirement

| Task | Produces | Consumes | Failure cases | Gate |
|---|---|---|---|---|
| **T40** Deprecation notice | `wavedl-gui` prints the daemon command | T38 | — | 3 |
| **R1** **Ship a release with Qt retained** | tagged release | T40 | — | 3 |
| **T41** Remove Qt | package deleted, test disposition applied | R1 | **no test imports `wavedl_gui` afterwards** | 3 |
| **T42** Final release verification | — | T41 | — | 3 |

## Traceability

| Finding | Owning tasks |
|---|---|
| F1 credential exposure | T21, T21b, T32 |
| F2 process-tree cancellation | T10, T11, T12, CI-1 |
| F3 false reducer conclusions | T9 |
| F4 scheduler observation | T17, T18b |
| F5 idempotent submission | T22a, T16, T18a |
| F6 dispatch ownership, storage, migration | T7a, T7b, T8b |
| F7 slurm script and outcomes | T15, T17 |
| F8 shared manifest and identity | T6, T19, T22c |
| F9 journal recovery | T3, T4 |
| F10 event delivery | T8a, T23, T24, T33 |
| F11 checkpoint integration | T20a, T20b, T20c, T20d |
| F12 restored metric history | T2, T20b, T23, T35 |
| F13 artifact race and adoption | T25, T22c |
| F14 bounded execution | T29a, T26 |
| F15 protocol and negotiation | T1, T2, T19n |
| F16 offline client and identity | T31, T32, T33, T21 |
| F17 migration and release gates | T28a, T28b, T30a–c, T39a, R1, T41 |
