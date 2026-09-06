# Codex Review — Revised Task Skeleton

**Reviewer:** Codex (gpt-6-astra, xhigh reasoning)
**Date:** 2026-09-06
**Subject:** the 42-task skeleton that preceded `2026-09-06-daemon-migration-structure.md`
**Verdict:** not approved for expansion; corrected structure supplied.
**Note:** Verbatim. Offline, read-only; no tests or network tools run.

---

**I would not approve the skeleton for expansion yet.** It fixes several important boundaries, but 42 tasks still conceal missing work, oversized commits, and gates whose prerequisites arrive too late.

I read the [saved review](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-codex-review-migration-plan.md) first. Below, **F1–F17** refer to its findings; **T1–T42** refer to the [51-line skeleton](/private/tmp/claude-501/-Users-myt-Documents-GitHub-WaveDL-GUI/a94a463e-993b-484c-a63c-a043d1cd8cf0/scratchpad/skeleton.md), SHA-256 `dc95e50d0c25e600ecefa8ac13d8a8b81c6883fe908866ee7b33d0a48290d89a`.

This is a decomposition review. “Covered” below means the task has an adequate implementation boundary—not that nonexistent code has passed review. All investigation was local and read-only; I ran no tests or network tools.

**1. Coverage of all 17 findings**

| Finding | Skeleton owner(s) | Assessment |
|---|---|---|
| **F1 — Credential exposure and incomplete authentication** | **T21**, with client/startup work in **T29, T32** | **The central fix has a clear home:** header-only API authentication and Host/Origin/XSRF policy. Bootstrap exchange remains incompletely allocated: single-use semantics, any distinct navigation credential, startup/access-log redaction, and browser URL stripping need explicit ownership. T32’s “identity/skew” does not inherently include bootstrap cleanup. |
| **F2 — Incomplete process-tree cancellation and undrained output** | **T10–T12, T14** | **Substantially improved.** T11 names the missing POSIX behavior. T12 names only race-free assignment, which does not cover Windows graceful shutdown, escalation, output draining, repeated cancellation, and completion detection. Both platform tasks must implement the same supervisor contract. |
| **F3 — False reducer conclusions** | **T9**, supported by **T8, T17–T20, T23** | **Adequate primary home.** “Truth table over attempt-scoped dimensions” is the correct scope. Its inputs must explicitly include publication and independent runtime/backend outcomes, observation availability, cancellation intent, and supervision ownership. Otherwise “dimensions” can shrink back to the old insufficient inputs. |
| **F4 — Incorrect scheduler observation** | **T17, T18** | **Partial.** T17 addresses classification, errors versus absence, and exit/signal preservation. Neither task explicitly owns batched fleet observation, backoff, retention-aware scheduling, or retained terminal-record fallback. A periodic submission-recovery loop is not that service. |
| **F5 — Incomplete idempotent submission controller** | **T8, T16, T18, T22** | **Partial, with a much better controller boundary.** Full-identity lookup and startup recovery now have homes. Persisted plan identity does not automatically establish retry idempotency: payload binding, transactional uniqueness, concurrent HTTP retries, timeout classification, cancellation before handle discovery, and explicit resolution of unknown acceptance must belong to the controller contract. |
| **F6 — Dispatch ownership, storage placement, migration** | **T7, T8**, enforced through **T18, T22, T29** | **Partial.** Separate roots and crash-released ownership are explicit. “Migration” is too vague and too large inside T7. Legacy source ownership, backup, conversion, versioning, rollback, and read-only recovery need a distinct task. Every external mutation must be gated by dispatch ownership; merely implementing the lock in T8 is insufficient. |
| **F7 — Slurm script rendering, topology, and outcomes** | **T15, T16**, with evidence consumption in **T17–T18** | **Partial.** Escaping, log placement, and topology now have explicit scope. Independent training/batch/stage-out outcomes remain unnamed. Submission preparation must create directories before scheduler redirection; T15 must preserve planning without execution. Executable fake-launcher tests belong here, not only at T30. |
| **F8 — Shared manifest and consistent identity** | **T5, T6, T13–T16, T19, T22** | **Partial.** Moving the manifest into core and resolving configuration are correct. T19 must explicitly construct a real standalone manifest, preserve standalone identity across attempts, and validate supplied identity. T5/T6 need exclusive output allocation and publication without partial-file exposure. Adoption must test a genuinely standalone-produced directory. |
| **F9 — Journal recovery and reader boundaries** | **T1, T3, T4**, with allocation in **T5** | **Good decomposition home.** The reproduced reader failures and abandoned-tail problem are named. T3 must specify the recovery action after refusal—new attempt/segment or explicit repair—and sequence recovery from validated records. “Refuse” alone leaves the restart workflow unfinished. Visibility/reopen behavior remains outside these headlines. |
| **F10 — Non-resumable event delivery** | **T8, T23, T24, T33** | **Good decomposition home.** Attempt-aware cursors and broker-as-wakeup directly address the finding. T23 must own transactional event/projection/cursor advancement and recovery when a commit occurs without a wakeup. T33 must persist the last *applied* cursor under the correct backend/run identity. |
| **F11 — Wrong checkpoint integration and inconsistent resume** | **T20**, consuming **T5/T6** and feeding **T25** | **Still undersplit.** Real save sites and resume are finally named, but shared publication is not a separate task. T6’s run manifest is not a checkpoint completion manifest. T20 still bundles publication machinery, normal collective saves, emergency saves, resume selection, and supersession. |
| **F12 — Incorrect restored metric history** | **T2, T20, T23, T35** | **Partial.** Producer and chart handling are explicit. The missing middle is the server’s durable supersession/projection rule, including reconstruction after restart. Assign it explicitly to T23 and define its event schema in T2. Chart handling alone cannot repair server history. |
| **F13 — Artifact open-time race and unsafe adoption** | **T25**, plus adoption in **T22** | **Safe serving has an adequate home; adoption remains partial.** T25’s “safe open, symlink policy” describes the right boundary. T22 must separately own provenance/ownership verification and writable-directory refusal. Safe downloads do not make adoption safe. |
| **F14 — Unbounded blocking execution and loader regression** | **T4, T26, T29**, affecting **T14–T18, T22–T27** | **Partial and late.** T26 correctly separates inspection from training loading. The shared admission/worker/deadline model cannot first arrive in T29 after its consumers. Inspection cancellation, worker exhaustion, supported-format parity, and storage-error behavior need explicit scope. |
| **F15 — Protocol validation and runtime negotiation** | **T1, T2, T19** | **Validation is covered; negotiation is not.** T1/T2 address strict decoding and payload schemas. T19 emits `hello` and diagnostics. No task owns first-event enforcement, supported-runtime negotiation, eligible handshake deadlines, or separate provenance persistence. |
| **F16 — Offline client, upgrades, and identity** | **T31–T33, T38**, with producers needed in **T21/T39** | **Partial.** Generator pinning, effective worker configuration, and decoding are addressed. Built-worker behavior needs explicit tests. Backend/API/build identity production, backend-scoped preferences, persistent cursors, and bootstrap cleanup need assigned producers and consumers. T32 cannot manufacture server identity. |
| **F17 — Impossible migration and release gates** | **T26–T30, T31–T38, T39–T42** | **Improved but unresolved.** Test/plot operations and backend parity endpoints now precede Qt cutover. T30 still combines substantial adaptation with the gate. T38 still lacks bounded owners for several parity features. Packaging precedes deprecation, but the required *release carrying the notice* is still not placed between T40 and T41. |

The strongest corrections are **T9**, **T10–T14**, **T23→T24**, and moving backend parity work before **T30**. The weakest remain **T20**, **T29–T30**, and **T38**.

**2. Missing tasks and work without a sufficiently scoped owner**

The six items you specifically named have these outcomes:

| Required work | Present status | Required correction |
|---|---|---|
| **Protocol validation and runtime negotiation — F15** | Validation: **T1/T2**. Negotiation: **missing**. | Add a runtime-negotiation task before **T23**. It consumes actual producer output, backend launch evidence, and registry storage; enforces first-event/version rules; persists provenance; and distinguishes scheduler waiting from an eligible runtime handshake timeout. |
| **Additive daemon-client CLI — F17 and the prior coverage appendix** | **Not explicitly present.** T29 derives from the old *serve CLI* task. | Separate `wavedl-daemon serve` from the client command required by spec §2.2, such as `wavedl run --daemon …`. The client must use the persisted-plan/idempotency contract and preserve direct `wavedl-train` execution. |
| **Legacy config/database migration — F6** | **Named but not scoped** in T7. | Split out source discovery/ownership, field disposition, backups, transactional conversion, `schema_version`/`migration_id`, interrupted-migration recovery, and read-only startup. Preserve legacy files through the required successful-release window. |
| **Declared live-push path — F9/F10 and the prior coverage appendix** | **Missing.** T23’s broker is downstream daemon delivery, not runtime-to-daemon transport. | Add a bounded, authenticated, attempt-aware runtime push path, deduplication with journal replay, and outage behavior. Also assign visibility tolerance and reader reopening. Removing push would require an explicit spec change. |
| **Batched scheduler reconciliation with backoff — F4/F14** | **Not explicitly present.** T17 parses observations; T18 recovers submissions. | Give fleet observation its own bounded scheduler task: batched queries, capability/retention policy, deadlines, backoff, previous-evidence retention, and unavailable-observation behavior. |
| **Standalone completion manifests — F8/F11** | **No explicit implementation owner.** | Add shared core checkpoint publication before T20’s training integration, then prove a daemon-free run publishes generations consumable by resume and adoption. |

These are explicit requirements in [spec §2.2](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-09-05-wavedl-daemon-architecture-design.md:79), [§3.3](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-09-05-wavedl-daemon-architecture-design.md:120), [§5.2](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-09-05-wavedl-daemon-architecture-design.md:173), [§8](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-09-05-wavedl-daemon-architecture-design.md:230), and [§§10–11](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-09-05-wavedl-daemon-architecture-design.md:269).

Additional work needs explicit allocation:

- **Slurm collection and independent outcomes — F3/F7.** T14 explicitly includes Local `collect`; the Slurm tasks do not. Assign collection of publication and training/batch/stage-out evidence to a named Slurm task.
- **Operational storage-error policy — F9/F14.** Writer failure, projection failure, disk exhaustion, and read-only storage need a visible policy across T3/T8/T23/T29. “Bounded” does not specify what happens when persistence stops working.
- **Real producer/consumer compatibility — F8/F15.** T19 must exercise the actual standalone writer against T1–T4 and negotiation. Moving the manifest to core does not ensure the two journal implementations agree.
- **Web parity implementation — F17.** Project/configuration setup, hyperparameter editing, data visualization, test/results/export workflows, and settings still lack sufficiently bounded owners. T34’s inherited run-list/detail scope, T36’s preview, and T37’s browser/model selector do not collectively cover them.

Migration also needs repository-specific decisions. The current legacy database entity contains download-oriented fields such as `url`, `isLive`, and `isBinaryMerge`; it is not already a daemon run registry. “Migrate the database” must state which records become what, and which are preserved as legacy data. See [the entity](/Users/myt/Documents/GitHub/WaveDL-GUI/src/wavedl_gui/common/database/entity/task.py:15) and [legacy path resolution](/Users/myt/Documents/GitHub/WaveDL-GUI/src/wavedl_gui/common/setting.py:22).

**3. Ordering**

The four requested checks:

| Dependency | Verdict |
|---|---|
| **T11/T12 supervisor → T14 Local backend** | **Correct.** Preserve a common supervisor interface before either platform implementation. T14 should adapt it, not invent divergent platform semantics. |
| **T23 delivery contract → T24 stream** | **Correct.** This repairs the old broker dependency inversion. T23 must be independently testable with durable events, projections, and wakeup failure injection. |
| **T22 persisted plan → T36 preview binding** | **Correct at the client boundary.** But the persistence/idempotency domain contract is needed by **T18**, earlier than T22. Extract it from the HTTP endpoints and introduce it before the controller. |
| **T6 manifest → T20 checkpoints** | **Necessary but insufficient.** `manifest.json` describes the immutable run request; `COMPLETE.json` publishes a usable checkpoint generation. T6 does not produce the publication primitive T20 needs. Add that producer before save/resume integration. |

Further dependency problems:

1. **T29’s bounded execution model arrives after its consumers.** Move admission limits, bounded workers, scheduler subprocess deadlines, and shutdown behavior before backend/controller/API implementations. Leave startup wiring and CLI behavior in a later task. **F14.**

2. **T28 changes the operation model after T6/T13/T22 establish it.** Declare training/test/plot operation kinds and required lifecycle/result contracts in the shared manifest and backend seam. Implement those operations later in T28. Otherwise T28 becomes a backward rewrite of already-landed contracts. **F17.**

3. **T7’s migration precedes T8’s target registry.** Storage settings can precede the registry; database migration should follow the target schema and ownership/recovery primitives. Split T7. **F6.**

4. **T23 lacks its runtime-negotiation dependency.** T19 emission is not a substitute. **F15.**

5. **T42’s OS matrix is too late for T12 and the Phase 1 gate.** Platform verification infrastructure must accompany supervision work. A final release task cannot retroactively validate intermediate Windows commits. **F2/F17.**

6. **T39 cannot own all build preparation if T31–T38 need built-client tests.** Static generation, daemon mounting, build fixtures, and client CI belong with T31. Later packaging can verify distribution contents and installed behavior. **F16/F17.**

7. **T40 → T41 → T42 needs an intervening release milestone.** The order must include: notice added → release shipped with Qt retained → Qt removal → subsequent release. Merely having packaging ready at T39 does not satisfy that temporal dependency. The old plan explicitly required this [release interval](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:4520).

**4. Sizing**

A task is reviewable when its behavior and failure boundary can be understood and tested together. File count and the presence of a test filename are poor substitutes.

| Task | Required sizing change |
|---|---|
| **T7** | Separate settings/storage validation from legacy migration and recovery. |
| **T8** | Separate registry transaction/cursor behavior from crash-released dispatch ownership and enforcement. Both have substantial, different failure tests. |
| **T18** | Separate submission/cancellation recovery from batched scheduler observation and backoff. Keep startup and periodic *submission* recovery together; they implement the same controller. |
| **T19** | Give standalone manifest/identity bootstrap an explicit boundary distinct from training event instrumentation, unless the detailed change remains demonstrably small. |
| **T20** | Split into shared publication primitives; generation-aware consumers/resume/supersession; normal best/periodic save integration; emergency save integration. |
| **T22** | Separate persisted-plan/idempotency domain work, HTTP lifecycle endpoints, and verified adoption. These have different failure and trust boundaries. |
| **T29** | Separate bounded execution infrastructure, daemon lifecycle/serve CLI, and additive daemon-client CLI. |
| **T30** | Separate Qt training adaptation, remaining Qt operation/data adapters, and cross-component failure verification. The phase gate should be a milestone after those commits. |
| **T38** | Enumerate parity before implementation, assign missing features to bounded tasks, and leave T38 with cross-client verification only. |

For **T20**, the emergency path deserves its own review because the repository intentionally avoids collective checkpoint saving after interruption: normal saves involve all ranks, while emergency saving is rank-zero-only to avoid a deadlock. A generic “route every save through the new helper” instruction would erase that distinction. See [the actual emergency path](/Users/myt/Documents/GitHub/WaveDL-GUI/src/wavedl/train.py:1962).

The four previously oversized tasks therefore stand as follows:

- **Old T8 → new T10–T14:** broadly right-sized. This is the most successful split, provided both supervisors share a contract and Windows receives its full lifecycle scope.
- **Old T17 → new T20/T25:** **not sufficiently split**. Artifact serving is separated correctly; publication and training integration remain bundled.
- **Old T18 → new T18/T23/T29/T30:** **partly split**. Controller extraction is useful, but T29 and T30 still combine unrelated work.
- **Old T26 → new T31/T38:** **not fixed by wording**. “Enumerated parity matrix” is useful only when enumeration happens early and every implementation row has an owner.

I would not automatically split **T23** again: transactional ingestion and durable replay driven by wakeups form a coherent pipeline, once negotiation, scheduler polling, and shared resource management are elsewhere. Likewise, **T25** is a defensible security-focused commit if adoption is separate.

**No task is demonstrably too small merely because it was split.** T1/T2 have distinct conformance contracts; T5 has allocation/race behavior; T10 has signal-forwarding behavior; T40 can have a small entry-point regression check. But release actions and gate sign-offs should not be padded into artificial red/green implementation tasks. A verification-only commit should add a real reusable harness, not just rename a checklist.

**5. Phase boundaries**

**The Phase 1 goal is achievable; the current allocation is not yet sufficient to achieve it.** Thirty tasks is not itself the problem. Missing contracts and postponing integration until T30 are.

I would retain Local and Slurm within Phase 1, but introduce these exact intermediate boundaries:

| Milestone | Boundary using current task numbers | What it establishes |
|---|---|---|
| **Phase 1A — contracts, storage, supervision** | **Before T14.** Move shared publication from T20, persisted-plan domain work from T22, bounded execution from T29, and OS CI from T42 into this preceding group. | Core contracts, migration/recovery, dispatch ownership, and platform supervisors pass focused failure tests. This is a foundation milestone, not a claim that the daemon is complete. |
| **Phase 1B — functioning headless service** | **Before T30.** Complete both backends, controllers, runtime negotiation, publication integration, ingestion/push/streaming, APIs, test/plot operations, both CLIs, and daemon installation checks. | The service works through its public interface independently of Qt. Both simulated scheduler failures and Local execution are exercised. |
| **Phase 1C — Qt migration and readiness** | **After the split T30 work, before T31.** | Qt uses the daemon for the required workflows; cross-component failure tests pass; real-site validation is recorded before HPC readiness is claimed. |

Failures should be tested in their owning tasks, then combined at the milestones. T30 must not be the first test of missing runtime handshakes, projection/cursor crashes, scheduler ambiguity, or interrupted checkpoint publication. These are already specified in the [Phase 1 failure gate](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-09-05-wavedl-daemon-architecture-design.md:342).

**Declining the Local-only option was reasonable.** Slurm is central to the stated product, and implementing both backends early exposes false abstractions around identity, storage, lifecycle, and topology before the web client depends on them. I would not reopen that choice solely because the count reached 30.

However, **T18 is not Slurm-only**. Even a Local-only phase needs durable request handling, cancellation intent, controller startup, and correct handling of lost supervision. Deferring “T15–T18” wholesale would remove required Local control-plane work. Only the Slurm-specific backend and scheduler reconciliation portions can move together.

The real-site gate remains dependent on actual access and validation. This review does not establish its availability or completion.

**6. What the restructure breaks—or risks losing—from the old structure**

There are genuine improvements here. The following distinguishes new boundary problems from inherited defects:

- **The old checkpoint task at least explicitly owned the publication helper.** The new split names training integration in T20 and access in T25, but leaves shared publication without its own explicit producer. Moving a *run* manifest to T6 does not preserve that responsibility. **F8/F11.**
- **The backend seam used to precede Local supervision.** T13 now follows T11/T12. That is safe only if supervisors are independent of backend models and a common supervisor contract already exists. Otherwise the split creates an interface dependency in the wrong direction. **F2.**
- **The checkpoint compatibility gap becomes longer.** Old checkpoint work immediately preceded the Qt adaptation task; new T20 precedes T30 by ten tasks. The existing Qt plot worker still looks specifically for `best_checkpoint`, and successful training automatically invokes it. Changing publication layout before adapting readers can break the still-shipping Qt app between commits. Update consumers first to understand published generations while retaining legacy compatibility, then switch producers. See [checkpoint selection](/Users/myt/Documents/GitHub/WaveDL-GUI/src/wavedl_gui/service/training_service.py:299) and [automatic plot dispatch](/Users/myt/Documents/GitHub/WaveDL-GUI/src/wavedl_gui/service/training_service.py:560). **F11/F17.**
- **The old scaffold task explicitly produced a vendored build and mounted SPA.** T31’s new headline emphasizes generator pinning and service-worker inspection. Preserve static generation, daemon mounting, SPA fallback, and build fixtures explicitly; do not accidentally transfer all of them to T39. **F16/F17.**
- **Adding test/plot operations repairs an old omission but creates a new dependency obligation.** Their operation schemas must enter T6/T13 before T22 hardens the API. T28 cannot quietly redesign the seam after its consumers land. **F17.**

Two prominent issues are **carried forward**, rather than newly caused: late cross-platform CI and the absence of an explicit deprecation-release checkpoint. Renumbering has not repaired them.

The application-working-between-phases requirement also needs to hold between task commits. Core publication, CLI behavior, and legacy Qt consumers cannot be knowingly incompatible for the intervening tasks.

**The corrected structure I would expand**

Preserve the current numbers with suffixes while rewriting, so finding traceability survives. Renumber only after these boundaries are settled.

| Group | Corrected ordered work |
|---|---|
| **Phase 1A: shared contracts** | **T1/T2** protocol and payload schemas → **T5/T6** layout, operation identity, resolved manifests → **T3/T4** journal writing/recovery and reading → **T20a** shared core generation publication and discovery. Keep standalone dependencies explicit; use shared code or actual producer/consumer conformance tests. |
| **Phase 1A: durable control and supervision** | **T7a** settings/storage → **T8a** registry transactions → **T8b** dispatch ownership → **T7b** legacy migration/recovery → **T13a** backend/operation contracts → **T22a** persisted plans and idempotency → **T9** reducer → **T29a** bounded execution → **T10–T12** launcher/platform supervision with early OS CI → **T13b** Local planning. Then the Phase 1A milestone. |
| **Phase 1B: execution and runtime** | **T14–T17** Local execution and Slurm planning/submission/observation, explicitly including Slurm collection/outcomes → **T18a** submission/cancellation controller → **T18b** batched scheduler reconciliation → **T19** standalone bootstrap and runtime emission → **new runtime-negotiation task** → **T20b** generation-aware consumers, resume, and supersession → **T20c** normal saves → **T20d** emergency saves. |
| **Phase 1B: public service** | **T21** app/auth/bootstrap/health identity → **T22b** lifecycle HTTP endpoints → **T23** transactional ingestion/projection/delivery → **new runtime live-push task** → **T24** resumable stream → **T25** safe artifact access → **T22c** verified adoption → **T26/T27** inspection/models/browse → **T28a/T28b** test and plot operations → **T29b** daemon lifecycle/serve CLI → **new daemon-client CLI task** → **T39a** installed daemon/package checks. Then the Phase 1B milestone. |
| **Phase 1C: existing client** | **T30a** Qt training adapter → **T30b** remaining operation/data adapters → **T30c** cross-component failure harness. Complete the Qt and real-site gate before Phase 2. |
| **Phase 2: web client** | Enumerate parity **before these tasks**. **T31** scaffold/static serving/build/worker behavior with client CI and **T39b** web package integration → **T32/T33** API identity and streaming → **T37** browse/model UI → bounded **project/hyperparameter authoring** work → **T36** persisted-plan preview → **T34/T35** run views/charts → bounded **data visualization**, **test/results/export**, and **settings** tasks → **T38** parity verification only. |
| **Phase 3: release and retirement** | **T40** deprecation notice → **ship a release with Qt retained** → **T41** remove Qt and apply the test disposition → **T42** final release verification. CI and build automation must already exist. |

Before writing task detail, give every task four concrete fields: **produces, consumes, failure cases, and gate contribution**. That will expose missing work far more reliably than another count increase.

The blockers to expansion are the absent negotiation/live-push/client-CLI/publication owners, the overloaded migration/checkpoint/Qt tasks, and unassigned parity implementation. Resolve those boundaries first; the current 42-task count should not be treated as a constraint.
