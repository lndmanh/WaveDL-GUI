# Codex Review — WaveDL Daemon Architecture Design

**Reviewer:** Codex (gpt-6-astra, xhigh reasoning)
**Date:** 2026-09-05
**Subject:** `2026-09-05-wavedl-daemon-architecture-design.md`
**Note:** Verbatim output. External doc access was unavailable; prior-art claims are from model knowledge, flagged as such in §3.

---

## 1. Verdict

**Sound with substantial fixes, but not ready to implement as specified.** Keep the headless daemon, bundled web client, and daemon-free training entry point: those boundaries fit the deployment constraints. Keep JSONL as a portable training telemetry journal. The architectural mistake is treating that journal as sufficient authority for execution state, recovery, and artifact validity while independently assigning state to SQLite and terminal decisions to executors. Those responsibilities need explicit reconciliation and durability contracts. This warrants revising the backend specification before frontend migration, not replacing the whole design with Ray or another training platform. [Daemon §§2.1–2.2, lines 50–69][d2] [§3, lines 75–85][d3] [§7, lines 174–185][d7] [§9, lines 214–218][d9]

## 2. (a) Architectural soundness findings

### A1. The daemon/client split is right; the deployment boundary is underspecified

Serving a bundled client beside a per-user Python service is a sensible fit for disconnected installations. Keeping training executable independently avoids making an interactive monitoring service a prerequisite for scheduled computation. [Daemon §§2.1–2.2, lines 50–69][d2]

However, **“remote is a URL” describes client connectivity, not execution deployment**. The daemon still needs an execution environment, access to the job’s storage namespace, scheduler credentials, and a permitted place to remain running. A daemon URL cannot make a compute-node path readable from a login node. These requirements belong in the supported deployment contract, rather than only in the configurable-template risk. [Daemon §3, lines 78–87][d3] [§12, line 236][d12]

The notebook story also needs qualification: a runtime with neither inbound SSH nor an available HTTPS proxy has no supported browser-access path under the proposed access methods. Listing hosted notebooks as a target while excluding a bundled tunnel leaves that deployment dependent on an external facility. [Daemon §1, lines 11–22][d1] [§2.1, line 65][d2] [§5, line 157][d5] [§11, line 232][d11]

### A2. JSONL is suitable telemetry storage, but insufficient execution authority

There are three distinct authorities:

- **Execution intent:** what the user submitted or requested to cancel.
- **Execution observations:** what the runtime, supervisor, and scheduler independently report.
- **Published results:** which checkpoints and artifacts are complete and usable.

The proposed file records runtime events, SQLite owns run state, and the executor supplies external terminal judgments. The spec does not define precedence or how to reconstruct the combined result. For example, a runtime can report success before a batch script’s stage-out command fails. Replaying the runtime log alone cannot reconstruct that failure. [Daemon §§3–3.1, lines 83–103][d31] [§7, lines 176–183][d7] [§9, lines 216–218][d9]

The inherited protocol already recognizes that an `exit` event needs external confirmation from the subprocess return code. Extending that principle to scheduled execution requires a reducer over multiple observations—not elevating the runtime’s file into the sole authority. [Qt §2.2, line 44][q22]

There is also a transport ambiguity: the executor table says Local reads stdout, but the SSE section says both execution modes read the same file. If both transports carry events, the ordering between file persistence and stdout publication must be specified. Otherwise the UI can display an event that disappears on replay, or ingest it twice. [Daemon §3, lines 75–83][d3] [§4.3, line 143][d43]

### A3. The executor seam needs execution capabilities and reconciliation, not just rendering

A useful common interface is achievable, but the table is not yet that interface. Local process ownership and scheduler submission differ in submission acknowledgment, pending states, cancellation acknowledgment, recovery, and storage accessibility. The spec recognizes different supervision mechanisms without defining these lifecycle differences. [Daemon §3, lines 73–79][d3] [§9, lines 214–218][d9]

The seam should expose operations resembling:

`plan → submit → observe/reconcile → request_cancel → collect`

The execution handle should retain backend identity, submission identity, ownership, storage locations, and raw backend observations. Planning must include resource topology, environment activation, working directory, and staging.

**DryRun is best modeled as planning without submission.** It needs a target backend: rendering a local command and rendering an `sbatch` script are different plans. Treating it as a third interchangeable running executor obscures that distinction. [Daemon §3, lines 79–84][d3] [§4.2, line 133][d42]

Likewise, scheduler states cannot be adequately represented by the inherited six runtime states alone. A held allocation and a running process awaiting shutdown are different conditions with different deadlines and actions. Preserve scheduler state separately from normalized application state. [Qt §2.2, line 38][q22] [Daemon §9, line 218][d9]

### A4. Replacing the runtime handshake with daemon health is a regression

`/api/health` can negotiate with the daemon. It cannot establish the version, device visibility, or capabilities of an interpreter later activated inside an allocation or container. Yet the spec removes runtime `hello` and exposes daemon-side versions and devices through health. [Daemon §§4.1–4.2, lines 119–126][d41]

The earlier design explicitly probes the selected runtime and requires a runtime-originated `hello`. Those checks remain necessary, alongside daemon health. A CPU-only login node must not disqualify a GPU allocation; conversely, a healthy daemon must not certify a missing compute-node environment. [Qt §§2.2–2.3, lines 37–50][q22] [§3, lines 54–63][q3]

Removing a mandatory first event while retaining protocol version 1 also needs an explicit compatibility decision: the inherited contract requires a new major for incompatible changes. Separate daemon API negotiation from runtime protocol negotiation. [Qt §2.1, lines 23–29][q21] [Daemon §4.1, lines 109–120][d41]

## 3. (b) Prior-art comparison

The mechanisms below are established prior-art knowledge, not a verification of particular current releases. No conclusion depends on an unverified release-specific implementation detail.

| System | Specific mechanism | WaveDL analog and deviation | Verdict |
|---|---|---|---|
| **Jupyter Server** | A user-owned server manages kernels and serves a browser client. Its security model includes token/cookie authentication, XSRF protection, and host validation. | The bundled daemon/client relationship is closely aligned. The proposed security contract specifies credentials but omits corresponding cookie-authenticated request protections and host policy. [Daemon §§2.1, 5][d2] [lines 149–157][d5] | **Architecture justified; incomplete security contract.** Adopt the owner-level trust boundary and request protections, not merely the startup URL convention. |
| **JupyterHub** | An authenticator, routing proxy, and `Spawner` lifecycle manage user servers. BatchSpawner supplies scheduler-specific spawning. Depending on the spawner, servers can run under separate Unix identities or containers. | WaveDL excludes accounts and tenancy while running on shared machines. Its executor interface is analogous to a spawner, but lacks an explicit pending/readiness/reconciliation contract. [Daemon §§3, 11][d3] [line 232][d11] | **Per-user daemons are justified.** A shared token must not quietly become a shared-user service. The scheduler lifecycle deserves the same explicit treatment as spawning. |
| **TensorBoard** | Summary `Event` protobufs are stored in TFRecord-framed event files, with length/checksum framing. Readers discover and consume event files; model checkpoints remain separate. | JSONL is a simpler readable telemetry format, but its durability and incomplete-record behavior are unspecified. Calling it sufficient run authority goes beyond the analogous TensorBoard mechanism. [Daemon §§3.1, 4.1][d31] [lines 109–120][d41] | **JSONL is justified; unframed durability assumptions are not.** Borrow robust record-reading behavior and keep checkpoint validity separate. |
| **MLflow** | The traditional FileStore separates per-run `meta.yaml`, parameter/tag files, and appendable metric-history files. Tracking-server SQL backends likewise separate lifecycle metadata from metric history; artifacts use a separate artifact store. | WaveDL puts heterogeneous events into one journal while also maintaining lifecycle state in SQLite, without defining the relationship. [Daemon §§3.1, 7][d31] [lines 176–185][d7] | **A compact journal is reasonable at this scale.** The missing distinction between lifecycle metadata, metrics, and artifact publication is a mistake. MLflow tracking also does not itself establish scheduler truth. |
| **Ray** | Ray Jobs submits work to a running cluster; the head/GCS and raylets provide control and scheduling services. Ray Train checkpoint persistence is distinct from task logs. | WaveDL delegates allocation to SLURM and intentionally permits execution without its daemon. [Daemon §§2.2, 3][d2] [lines 75–85][d3] | **The deviation is justified.** Requiring a Ray control plane inside every allocation would add operational machinery. Still, service recovery and execution recovery must be specified separately. |
| **Weights & Biases** | SDK offline mode records a local `.wandb` datastore, later uploaded with `wandb sync`; metrics and artifact tracking are separate from restoring model/optimizer state. | A local journal with a fully offline dashboard is a useful additional capability. WaveDL already configures offline W&B in its launcher and initializes trackers in training. [launcher.py:137–141][launch-wandb] [train.py:1093–1099][train-wandb] | **Justified.** W&B is strong precedent for disconnected telemetry capture, not evidence that telemetry constitutes a complete execution/checkpoint journal. |
| **Determined AI** | A master manages experiments, trials, and allocations; durable experiment metadata and configured checkpoint storage have separate roles. | WaveDL’s per-user daemon is substantially smaller and leaves allocation enforcement to SLURM, but lacks a comparable explicit allocation/result reconciliation model. [Daemon §§3, 7, 9][d3] [d7] [d9] | **Avoiding a full platform is justified.** Omitting allocation identity, desired state, observed state, and checkpoint publication semantics is not. These concepts remain necessary at small scale. |
| **SkyPilot** | Tasks describe resources, setup/run commands, and workdir/file mounts. Managed jobs use a controller for monitoring and recovery independently of the submitting terminal. | WaveDL proposes a manifest and site template, while describing remote operation primarily through daemon URLs. The template does not yet have a defined contract for environment setup, placement, or staging. [Daemon §3, lines 83–87][d3] [§12, line 236][d12] | **Skipping provisioning and SSH orchestration is justified.** Treating storage and environment deployment as incidental renderer details repeats the abstraction mistake. |

None of these mechanisms establishes a plain training-event file as the sole authority for distributed execution, scheduler lifecycle, and recoverable checkpoints. The closest precedents support the narrower telemetry-journal interpretation.

## 4. (c) New gaps, races, and failure modes

### C1. An incomplete trailing record must not be treated as a malformed completed record — high

**Scenario:** a writer emits half a JSON object; the daemon reaches the current EOF; the remaining bytes arrive later. Applying the inherited “malformed line → warn and continue” rule immediately loses the event. After a crash, appending another object directly after an unterminated fragment can corrupt that next record too.

The contract needs a newline commit boundary, buffering of unfinished tails, a maximum record size, and a defined repair or rollover procedure for abandoned tails. It must also distinguish Python buffering, completed writes, and durability acknowledgment. A successful append is not itself a durable commit. [Daemon §§3.1, 4.1][d31] [d41] [Qt §§2.1, 2.3, lines 33–50][q22]

### C2. Shared-filesystem visibility is unspecified — high

**Scenario:** training writes on a compute node while a login-node daemon holds the journal open for tailing. An append becomes visible later than expected, or a storage interruption leaves a partial tail. The dashboard must tolerate observation lag without treating EOF as completion or a heartbeat.

The filesystems need differentiated treatment:

- **Local POSIX filesystems:** `O_APPEND` coordinates append positioning with a write; it does not make several buffered writes one transaction or guarantee persistence.
- **NFS:** ordinary client-side append is not a distributed record-append transaction. Data and attribute caching affect observation. Close-to-open consistency is not a promise that an already-open tailing descriptor immediately sees another client’s writes.
- **Lustre and GPFS/Spectrum Scale:** their distributed locking and coherence mechanisms generally provide stronger POSIX-style behavior than that NFS model. It would be wrong to label all three equally unsafe. They still do not make JSON buffering, checkpoints, and metadata publication one atomic operation.

Exact guarantees depend on the deployment and mount configuration; those remain site-validation questions. Define supported behavior, visibility tolerance, reopen/poll strategy, and recovery tests. The current spec names only a shared pathname and generic resumption tests. [Daemon §§3.1, 4.3, 10][d31] [d43] [d10]

### C3. Event ingestion, database cursors, and SSE need one consistency contract — high

**Scenario:** the daemon applies event 40 to SQLite, crashes before persisting its ingestion cursor, and applies it again after restart. Reversing those writes can instead permanently skip event 40.

A second race occurs when the daemon finishes replay through event 40, event 41 arrives, and live subscription begins after that append. A naïve replay-then-subscribe implementation loses the boundary event.

Require transactional projection/cursor updates, idempotent event application, snapshot watermarks, and a gap-free replay-to-live transition. Also specify cursor restoration for a **new** `EventSource` after page reload: native reconnection of an existing instance does not establish application-level cursor persistence across newly created instances. [Daemon §4.3, lines 139–145][d43] [§7, lines 176–183][d7] [§10, lines 222–223][d10]

### C4. Submission has an unavoidable ambiguous-outcome window — critical

**Scenario:** `sbatch` accepts a job; the daemon crashes before recording the returned handle. On restart, blindly retrying creates a second GPU job. A dropped HTTP response followed by a client retry creates a similar ambiguity.

An SQLite transaction cannot atomically encompass scheduler submission. Persist a submission intent first, use a durable request identifier, associate the submitted script/job with it, and reconcile before retrying. When acceptance cannot be established, expose `submission_unknown` and avoid automatic resubmission.

Also define cancellation during submission: a cancel request arriving before the scheduler handle must remain actionable after that handle is recorded. [Daemon §3, line 78][d3] [§4.2, lines 131–135][d42] [§7, line 178][d7]

### C5. Daemon restart does not restore Local supervision — high

**Scenario:** terminate the daemon abruptly while a Local run continues. A replacement daemon can replay telemetry, but it cannot recreate the original parent relationship, `Popen` handle, or stdout pipe. A stored PID alone is unsafe for later cancellation because process identifiers can be reused.

Specify whether Local jobs survive daemon death. If they do, introduce a persistent run supervisor or another explicit recovery mechanism, including process identity and durable exit results. If they do not, define that behavior consistently and report interrupted supervision distinctly.

The spec promises replay after restart and retains process-handle-based supervision, without defining their intersection. [Daemon §3, lines 77–83][d3] [§9, line 216][d9] [Qt §4, lines 67–77][q4]

### C6. SQLite ownership is not a storage-placement or singleton policy — high

**Scenario:** the same user starts daemons on two login nodes, both using a home-directory database. Both can act on a pending submission. SQLite serializing individual transactions does not prevent duplicate external side effects.

Network-mounted home directories introduce another problem: SQLite WAL depends on shared-memory coordination and is not a supported cross-host network-filesystem solution. Other journal modes still require reliable filesystem locking; “use SQLite” does not settle this.

Specify a private per-user data directory, supported filesystem placement, one active dispatch owner, migration locking, and failure behavior when storage disappears. The current legacy settings also resolve `AppData` relative to the working directory outside the packaged-Windows branch, so migration must not infer user ownership merely from a shared checkout location. [Daemon §7, lines 176–185][d7] [setting.py:22–31][settings]

### C7. Artifact events do not establish checkpoint validity or training-history validity — high

**Scenario:** an artifact event identifies `best_checkpoint`; a subsequent save overwrites files there; a crash leaves a mixture of generations. The old event still names the same directory, but its meaning has changed.

The current training implementation saves state into a reusable `best_checkpoint` directory and writes metadata and standalone weights separately. That sequence is not an atomic publication of a checkpoint generation. [train.py:1780–1825][train-save]

Separately, restoring an older checkpoint can invalidate later metric history. Current resume logic explicitly truncates restored CSV history to the checkpoint epoch. An immutable telemetry journal needs an equivalent *logical* rollback/supersession rule; otherwise the dashboard retains metrics for work no longer represented by the restored model. [train.py:1436–1457][train-resume]

Define immutable checkpoint generations, completion manifests, and explicit linkage between a published checkpoint and its training step. A checksum-bearing path event alone is insufficient. [Daemon §§3.1, 4.1][d31] [d41] [Qt §2.2, line 41][q22]

### C8. The inherited metrics can violate strict JSON on an ordinary fresh run — high

**Scenario:** port the current metrics dictionary directly into the new event envelope. `best_val_loss` starts as infinity, is included in the emitted dictionary, and is updated only later during checkpoint handling. Python’s default `json.dumps` permits the resulting `Infinity` token; strict JSON consumers reject it. [train.py:1300–1304][train-init] [train.py:1722–1739][train-metrics] [train.py:1786–1788][train-save]

The new protocol must define finite-number requirements and a representation such as `null` plus an explanatory status for unavailable/non-finite measurements. Cover numerical divergence as well as startup values. Merely specifying a JSON object and carrying forward existing metrics leaves this unresolved. [Daemon §4.1, lines 109–115][d41] [Qt §§2.1–2.2, lines 17–39][q21]

### C9. Wall-clock timestamps cannot order independent observations — medium

**Scenario:** a compute node’s clock is ahead of the daemon’s. A cancellation observation sorts before an earlier metric, or an NTP adjustment makes apparent runtime decrease.

Use journal sequence for that journal’s order, training step for learning progress, and monotonic clocks for elapsed durations and local deadlines. Preserve separate producer and observation timestamps when combining scheduler and runtime evidence; do not manufacture a total causal order by sorting RFC 3339 values.

The envelope specifies a wall-clock timestamp, while monotonic deadlines are specified only for supervision. The ordering rule for combined observations is absent. [Qt §2.1, lines 29–30][q21] [Daemon §§4.1, 7, 9][d41] [d7] [d9]

### C10. “Origin-scoped” cookies do not isolate localhost ports — high, potentially critical

**Scenario:** two services run at `localhost:8420` and `localhost:8421`. Cookies are scoped by host/path, **not port**. Identically named cookies can overwrite each other, and matching cookies can be sent to another localhost service when the browser requests it. `HttpOnly` prevents JavaScript reading; it does not prevent that transmission.

Likewise, `SameSite=Strict` does not distinguish two same-scheme localhost ports. Without Origin/XSRF enforcement, a same-site service may induce cookie-authenticated mutations, particularly a bodyless cancellation POST. Exact exploitability depends on the eventual method/content-type validation. [Daemon §5, lines 151–155][d5] [§4.2, line 135][d42]

Retain the bootstrap exchange, but define the host-isolation/trusted-local-services boundary, cookie naming, allowed Host/Origin policy, and XSRF protections. Distinct cookie names fix collisions, not cross-port confidentiality. Also define URL cleanup and log redaction; a stable secret supplied through `--token` may be exposed on systems that allow other users to inspect process arguments. [Daemon §§2.1, 5][d2] [d5]

### C11. Artifact containment requires safe access, not only event-time validation — high

**Scenario:** a group-writable imported run contains a symlink. It resolves inside the run directory when the event is accepted, then is replaced before the daemon opens it. Event-time containment no longer protects the read.

Validate ownership/trust when adopting runs and enforce containment when opening artifacts, including symlink policy. If artifacts are served inline, specify safe content handling: an HTML or active SVG artifact at the authenticated daemon origin can become an API-capable page. This is conditional on the serving implementation, which the API does not currently define.

The inherited artifact schema includes arbitrary `other` artifacts; the new security rule covers resolved paths only. [Qt §2.2, line 41][q22] [Daemon §3.1, line 103][d31] [§4.2, line 136][d42]

### C12. Hand-launched run discovery and exclusive output ownership are missing — high

**Scenario:** a user launches a run manually into shared scratch. Its files exist, but the daemon has no registry record. The specified API has creation and listing, but no explicit adoption/import operation or configured discovery contract. Meanwhile, the daemon is named as manifest owner despite the daemon-free execution requirement. [Daemon §§2.2, 3, 4.2, 7][d2] [d3] [d42] [d7]

A separate collision arises if two invocations reuse an output directory. Current training defaults `output_dir` to `"."`, creates it with `exist_ok=True`, and uses fixed checkpoint/completion names. A new manifest UUID does not by itself isolate those files. [train.py:411–418][train-output] [train.py:1031–1032][train-mkdir] [train.py:1306–1328][train-init]

Define a shared manifest builder for standalone and daemon launches, explicit adoption with verified provenance, and exclusive directory allocation or rejection of conflicting active use.

### C13. Backpressure and storage failure can interfere with training and cancellation — high

**Scenario:** stderr floods while shared storage stalls. An unbounded ingestion queue exhausts daemon memory; synchronous file operations block request handling; or a blocked pipe eventually stalls the training process. Per-run scheduler polling can additionally become a large aggregate RPC load across many users.

The inherited requirement that logs never be silently dropped from disk needs a disk-full/error policy. Choose explicitly between failing the run, switching to a bounded emergency spool, or continuing with visibly degraded telemetry. Define bounded queues, subscriber isolation, batched scheduler queries, timeouts, and backoff.

Replacing QThread machinery with “async” does not make blocking filesystem operations asynchronous. [Qt §2.3, line 50][q22] [Daemon §3, lines 77–78][d3] [§8.1, line 209][d8] [§10, lines 222–228][d10]

### C14. Bundling does not eliminate browser/daemon version skew — medium

**Scenario:** the daemon upgrades while an installed PWA retains its previous service worker and cached shell. Alternatively, a user reuses the same local forwarding port for another daemon. The browser origin remains the same, carrying cached assets and client-side path preferences into a different backend.

Bundling guarantees package parity, not parity with the client currently executing in the browser. Expose daemon identity, client build identity, and API compatibility; define service-worker upgrade behavior and namespace backend-specific preferences accordingly. The existing no-API-cache rule does not resolve stale application code. [Daemon §2.1, lines 61–63][d2] [§6, lines 165–172][d6] [§7, line 181][d7]

## 5. (d) HPC contact-reality failures

These are ranked qualitatively; likelihood depends on site policy and workload.

| Rank | Likelihood / severity | Concrete failure |
|---|---|---|
| **1** | High / High | **Submission succeeds, execution environment fails.** A login-node probe validates one Python installation; the batch script activates a different module/container environment where WaveDL or the required protocol is unavailable. Daemon health cannot certify that environment. [Daemon §§4.1–4.2, 12][d41] [d12] |
| **2** | High / High | **The run directory is not shared as assumed.** A compute job writes under node-local scratch; the login-node daemon sees no events. Copying the directory back only at completion provides no live monitoring. Absolute paths inside a container may also differ from host paths. [Daemon §§3–3.1][d3] [d31] |
| **3** | High for multi-node use / Critical | **The allocation topology and launcher topology disagree.** Allocating two nodes does not itself run the training launcher on both. Conversely, wrapping a multi-process launcher in too many scheduler tasks multiplies workers. The existing launcher exposes machine count, rank, and rendezvous parameters, but the spec provides no mapping from scheduler resources to those settings. [launcher.py:204–233][launch-topology] [Daemon §§3, 12][d3] [d12] |
| **4** | High on shared nodes / Medium–High | **Startup collisions and lifecycle policy break the control service.** Two users cannot both bind the same address and port on one host. A site that terminates lingering login-session processes also requires an approved service-lifetime arrangement. Database paths must remain private and explicitly owned. [Daemon §2.1, lines 52–65][d2] [§5, line 151][d5] [§7][d7] |
| **5** | Moderate / Critical | **An interrupted submission produces duplicate expensive jobs.** The scheduler accepts the request before the daemon records acknowledgment; restart or HTTP retry submits again. This is C4’s external-side-effect window. [Daemon §§3, 4.2, 7][d3] [d42] [d7] |
| **6** | Moderate / High | **A valid script produces a misleading final result.** Training fails, then a successful cleanup command becomes the script’s final exit status; or training succeeds and stage-out fails. A template must preserve training, batch, and publication outcomes independently. [Daemon §9][d9] [Qt §2.2, line 44][q22] |
| **7** | High at scale / High | **Monitoring creates excessive shared-storage or scheduler load.** Many daemons repeatedly scan growing journals and poll individual jobs; slow storage then delays API responses and cancellation. Rendering fixtures do not exercise this failure. [Daemon §§3, 4.3, 8.1, 10][d3] [d43] [d8] [d10] |
| **8** | Moderate / High | **An apparently valid batch script never starts correctly.** An output directory needed for scheduler redirection does not exist before launch, or a renderer assumes shell variables expand inside `#SBATCH` directives. Directory preparation and directive rendering need explicit semantics and failure reporting. [Daemon §§3.1, 12][d31] [d12] |

There is also a scheduler-observation distinction the contract must preserve: a command timeout, controller outage, or authorization error is **failure to observe**, not evidence that a previously observed job has terminated. Likewise, a successful `scancel` invocation is a cancellation request acknowledgment, not proof that cleanup and resource release are finished. These need explicit intermediate states and reconciliation. [Daemon §9, line 218][d9]

## 6. Alternative architecture recommendation

Keep the proposed deployment shape, and implement the following backend contract before proceeding with the client rewrite:

1. **Make the daemon a per-user reconciled job controller.** Persist command intent, submission receipts, cancellation requests, and backend observations. Derive displayed state with documented precedence and explicit uncertainty. Runtime events supply evidence; scheduler and supervisor observations supply additional evidence. This resolves the competing ownership claims in §§3, 7, and 9. [d3] [d7] [d9]

2. **Keep runtime-owned JSONL for telemetry, with a real storage protocol.** Define complete-record boundaries, flush/durability policy, bounded records, corruption handling, and cursor semantics. For deployments where mutable-file tailing proves unreliable, support immutable, sealed event segments published through a small index. Do not introduce Kafka or a compute-to-daemon network dependency merely to obtain a journal. [Daemon §§3.1, 4.3][d31] [d43]

3. **Separate submission plans from executable backends.** `plan(target=local|slurm)` should produce a reviewable manifest, resource/environment plan, argv/script, and storage mapping. DryRun returns this plan. Submission returns a durable backend handle; observation and cancellation operate on that handle. Explicitly reject unsupported topologies instead of rendering plausible but invalid scripts. [Daemon §§3, 12][d3] [d12]

4. **Retain runtime-side negotiation and publish execution provenance.** Keep daemon health for daemon/API compatibility. Probe or announce the actual runtime inside the allocation, recording the interpreter/container, WaveDL/protocol versions, device allocation, and execution paths separately from the immutable submitted request. [Daemon §§3.1, 4.1–4.2][d31] [d41] [Qt §3][q3]

5. **Publish checkpoints as committed generations.** Write a new generation, complete its files, publish a completion manifest, and only then announce it as available. Preserve the relationship between the checkpoint and valid metric history. Provide standalone manifest generation and explicit adoption so daemon-free runs remain first-class. [Daemon §§2.2, 3.1, 7][d2] [d31] [d7]

6. **Define the supported operating envelope.** Specify daemon lifetime, private storage and permissions, singleton dispatch ownership, shared-filesystem requirements, artifact access rules, and localhost/proxy security boundaries. A per-user token service is sufficient within that envelope; shared accounts or team access require a separately designed tenancy layer. [Daemon §§5, 7, 11][d5] [d7] [d11]

7. **Make failure-oriented backend tests the Phase 1 gate.** Add interrupted submission at each persistence boundary; incomplete journal tails; delayed filesystem visibility; snapshot/replay races; storage exhaustion; restart during active Local execution; checkpoint-publication interruption; runtime mismatch; and scheduler lifecycle simulations. Then validate at least one actual site’s filesystem and scheduler integration before claiming HPC readiness. The current SLURM test requirement primarily checks rendering, while Phase 1 claims to prove the executors and run-directory contract. [Daemon §8, lines 189–195][d8] [§10, lines 222–228][d10]

The architectural boundary worth preserving is **a lightweight, optional control service observing independently executable training**. The specification needs a durable job-control model around that boundary before its journal can support the recovery guarantees being claimed.

[d1]: /Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-09-05-wavedl-daemon-architecture-design.md:11
[d2]: /Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-09-05-wavedl-daemon-architecture-design.md:50
[d3]: /Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-09-05-wavedl-daemon-architecture-design.md:75
[d31]: /Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-09-05-wavedl-daemon-architecture-design.md:83
[d41]: /Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-09-05-wavedl-daemon-architecture-design.md:107
[d42]: /Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-09-05-wavedl-daemon-architecture-design.md:122
[d43]: /Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-09-05-wavedl-daemon-architecture-design.md:139
[d5]: /Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-09-05-wavedl-daemon-architecture-design.md:147
[d6]: /Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-09-05-wavedl-daemon-architecture-design.md:159
[d7]: /Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-09-05-wavedl-daemon-architecture-design.md:174
[d8]: /Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-09-05-wavedl-daemon-architecture-design.md:187
[d9]: /Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-09-05-wavedl-daemon-architecture-design.md:214
[d10]: /Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-09-05-wavedl-daemon-architecture-design.md:220
[d11]: /Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-09-05-wavedl-daemon-architecture-design.md:230
[d12]: /Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-09-05-wavedl-daemon-architecture-design.md:234
[q21]: /Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-08-02-qt-desktop-improvement-design.md:15
[q22]: /Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-08-02-qt-desktop-improvement-design.md:33
[q3]: /Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-08-02-qt-desktop-improvement-design.md:52
[q4]: /Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-08-02-qt-desktop-improvement-design.md:65
[settings]: /Users/myt/Documents/GitHub/WaveDL-GUI/src/wavedl_gui/common/setting.py:22
[launch-wandb]: /Users/myt/Documents/GitHub/WaveDL-GUI/src/wavedl/launcher.py:137
[launch-topology]: /Users/myt/Documents/GitHub/WaveDL-GUI/src/wavedl/launcher.py:204
[train-wandb]: /Users/myt/Documents/GitHub/WaveDL-GUI/src/wavedl/train.py:1093
[train-init]: /Users/myt/Documents/GitHub/WaveDL-GUI/src/wavedl/train.py:1300
[train-output]: /Users/myt/Documents/GitHub/WaveDL-GUI/src/wavedl/train.py:411
[train-mkdir]: /Users/myt/Documents/GitHub/WaveDL-GUI/src/wavedl/train.py:1031
[train-resume]: /Users/myt/Documents/GitHub/WaveDL-GUI/src/wavedl/train.py:1436
[train-metrics]: /Users/myt/Documents/GitHub/WaveDL-GUI/src/wavedl/train.py:1722
[train-save]: /Users/myt/Documents/GitHub/WaveDL-GUI/src/wavedl/train.py:1780
