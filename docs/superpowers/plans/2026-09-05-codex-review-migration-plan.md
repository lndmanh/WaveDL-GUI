# Codex Peer Review — WaveDL Daemon Migration Plan

**Reviewer:** Codex (gpt-6-astra, xhigh reasoning)
**Date:** 2026-09-06
**Subject:** `2026-09-05-wavedl-daemon-migration.md`
**Verdict:** Not approved for implementation as written.
**Note:** Verbatim output. Offline review: repository and installed dependency source plus in-memory probes; the project suite, client build, and SLURM were not exercised.

> **Scope note (2026-10-16):** This review is historical evidence about the Qt migration plan. The current product scope is the new daemon/browser application; references below to Qt parity, retirement or migration sequencing do not define current acceptance.

---

**I would not approve this plan for implementation yet.** The revised architecture is substantially better, but the plan still contains failures in process supervision, submission recovery, event delivery, checkpoint integration, and authentication. Several tests would pass without establishing the guarantees named in their docstrings.

The plan changed during this review. This report uses a single snapshot with SHA-256 `5e9c035222a338cddfd5a8ae6a4b318090c3cf17005a3ca2c6b6de230f2a6273`—4,493 lines. That snapshot already corrects the private NumPy API and centralizes SLURM job-name construction.

Below, **P** means [the implementation plan](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md), and **S** means [revision 2 of the spec](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-09-05-wavedl-daemon-architecture-design.md). All investigation was offline. I inspected repository and installed dependency source and ran small in-memory Python probes; I did not run the project suite, build the client, or exercise SLURM.

The ten specific technical claims have these outcomes:

| Claim | Assessment |
|---|---|
| **Task 3: `rpartition("\n")`** | **Correct.** `"a\nb\n"` yields `("a\nb", "\n", "")`, so both completed records are processed. An empty file yields `("", "", "")` and returns no events. A fragment without a newline remains in `_pending`. The actual reader bugs are elsewhere, described below. [P:673](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:673) |
| **Task 2: `_next_seq()`** | **Conditionally correct, insufficient generally.** Counting lines works only for an intact, contiguous, zero-based journal with no foreign records. It does not recover the last sequence number, validate identity, or repair an abandoned tail. It scans the entire journal on each reopen. [P:445](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:445) |
| **Task 5: `data_dir: Path = None`** | **Works for an omitted value under the shown Pydantic v2 defaults.** Defaults are not validated by default; `model_post_init` replaces `None`. Explicit `Settings(data_dir=None)` fails validation before that hook. Verified with Pydantic 2.12.5. Use `Field(default_factory=default_data_dir)` for a consistently typed contract. [P:1129](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:1129) |
| **Task 6: reducer precedence** | **Incorrect and incomplete.** Early returns make execution deterministic, but the predicates are not intrinsically mutually exclusive. More importantly, `SUBMITTED` and `SUPERVISION_LOST` have no return paths, and several combinations produce false confirmed states. [P:1376](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:1376) |
| **Task 8: raising `SystemExit` in a signal handler** | **Raising it is valid Python; nested `Popen.wait()` is the problem.** On POSIX, the interrupted outer wait can hold a non-reentrant `_waitpid_lock`, preventing the handler’s nested wait from completing. The snapshot removes that nested wait and `SystemExit`, replacing them with signalling and an alarm. That corrects the original issue, but does not solve the supervision failures below. [P:1858](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:1858) |
| **Tasks 9–10: job-name mismatch** | **Resolved in the snapshot.** Both rendering and lookup are required to call `job_name(request_id)`. There is no remaining full-ID-versus-short-ID mismatch in that contract. Eight-character identity and ambiguous lookup remain unsafe. [P:2079](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:2079), [P:2302](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:2302) |
| **Task 13: private NumPy header reader** | **Resolved in the snapshot.** The original call already fails on installed NumPy 2.3.4 with `AttributeError`. Public `read_array_header_1_0` and `read_array_header_2_0`, selected using `read_magic`, work. The revised code uses those and explicitly rejects other versions. Its comment should say “absent in tested NumPy 2.3.4,” rather than generalizing to all NumPy 2.x. [P:2833](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:2833) |
| **Task 16: subscribe, replay, deduplicate** | **Correct pattern, incomplete implementation contract.** It closes the boundary race only with ordered committed events, coordinated publication, and lossless delivery or recovery. The planned broker drops events, and the cursor ignores attempts. [P:3339](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:3339) |
| **Task 17: `os.replace` atomicity** | **Correct as a successful same-filesystem namespace replacement; insufficient as a crash-durability claim.** It does not fsync checkpoint contents, the completion manifest, or directory entries, nor establish remote visibility ordering. [P:3490](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:3490) |
| **Task 19: Nuxt/PWA configuration** | **The static Nuxt choices are valid; the PWA override is insufficient.** Installed Nitro 2.13.4 has a `static` preset. `ssr: false` plus generation is appropriate. However, the local starter uses a custom `injectManifest` worker, whose routing and update behavior are not controlled by the proposed `workbox` options. [P:3748](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:3748) |

The substantive findings follow, ordered broadly by consequence.

1. **Critical — Task 14 reproduces the cross-port credential exposure it claims to prevent.**

   `require_auth` compares the session cookie directly against `settings.token`. Thus the cookie contains the bearer credential itself. Another service on the same hostname can receive that cookie when the browser requests its port, then use the captured value in an `Authorization` header. Different cookie names prevent collisions; they do not prevent disclosure. This was explicitly identified in the prior review. [P:3010](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:3010), [prior review:153](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-09-05-codex-review-daemon-architecture.md:153)

   The dependency also accepts cookies for API reads and mutations, accepts cookie-authenticated mutations without an `Origin`, implements no XSRF token, and implements no Host allowlist. The bearer branch bypasses Origin checking entirely. Comparing Origin against `request.base_url` does not independently establish that the supplied Host is trusted.

   **Change:** keep API authentication header-only. The public SPA already loads without authentication in Task 19, so establish whether navigation cookies are needed at all. If retained, they need a distinct, restricted session credential that cannot become an API bearer token. Add explicit Host/Origin policy, single-use bootstrap exchange, URL stripping, and log redaction. Test missing Origin and disallowed Host, not only a mismatched Origin. This is required by **S §6**, not an optional security enhancement. [S:209](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-09-05-wavedl-daemon-architecture-design.md:209)

2. **High — Task 8 can report cancellation finished while descendants continue holding GPU memory.**

   After signalling the process group, `request_cancel` returns as soon as the direct child exits. A descendant that ignores SIGTERM survives because the SIGKILL phase is skipped. The implementation therefore does not provide “full reaping before release.” Repeated cancellation after the leader has disappeared can also fail at `getpgid` or `killpg`; cancellation is not idempotent. [P:1931](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:1931)

   Independently, submission sets `stdout=PIPE`, but no task specifies a reader that continuously drains that pipe. Training emits substantial stdout, including legacy metrics. Once the pipe fills, training can block. The Windows path assigns the Job Object after an already-running process is created, leaving a spawn-before-assignment window; closing the object also supplies no graceful phase. [P:1906](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:1906)

   **Change:** make process-tree ownership, output draining, graceful shutdown, escalation, and completion detection one explicit supervisor contract. Test a leader that exits immediately with a SIGTERM-ignoring grandchild, repeated cancellation, and output larger than pipe capacity. For Windows, specify race-free Job Object assignment and separate graceful/forceful behavior. These are **S §9.1** requirements. [S:261](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-09-05-wavedl-daemon-architecture-design.md:261)

3. **High — Task 6’s reducer gives demonstrably false answers.**

   Evaluating the embedded reducer produced:

   | Evidence supplied | Actual result | Problem |
   |---|---|---|
   | `{"supervision_lost": True}` | `RUNNING`, confirmed | Contradicts §9.2 and Task 8’s observation contract. |
   | `{"state": "PENDING"}` | `RUNNING`, confirmed | Queued/held work is displayed as executing. |
   | Existing handle, no observation | `RUNNING`, confirmed | Invents active evidence. |
   | Runtime exit code 1; backend `COMPLETED`, code 0 | `COMPLETED`, confirmed, “runtime and backend agree” | The runtime explicitly disagrees. |
   | Vanished backend plus runtime exit | `COMPLETED` or `FAILED` | Promotes unconfirmed runtime evidence into a terminal application state. |

   `runtime_exit` is never checked in the confirmed-completion branch. Published results are not an input despite the function’s three-authority claim. No attempt-selection contract prevents an earlier attempt’s exit from contaminating a requeued attempt. [P:1379](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:1379), [P:1410](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:1410)

   **Change:** define a truth table over attempt-scoped runtime outcome, backend lifecycle, observation availability, cancellation intent, supervision ownership, and publication outcome. Preserve those dimensions separately. Add explicit queued, held, supervision-lost, and unavailable-evidence branches. A successful backend wrapper must not erase training failure, and unconfirmed runtime completion must not silently become settled completion. **S §§3.1, 4, 9.2.**

4. **High — Task 11’s scheduler observation logic manufactures terminal evidence and misses available evidence.**

   Every nonempty `squeue` response becomes nonterminal. Every nonempty successful `sacct` response becomes terminal, regardless of whether its state is `RUNNING`, `PENDING`, or an intermediate accounting record. The reducer then turns a supposedly terminal `RUNNING` observation into `FAILED`.

   The code also ignores `squeue`’s return code, collapses unsuccessful accounting queries into disappearance, selects the first accounting row without identifying the allocation versus job steps, and discards the signal component of `ExitCode`. A controller/authentication error must not become disappearance merely because stdout is empty. [P:2456](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:2456)

   Reading `MinJobAge` does not itself exploit the retention window. There is no completed-job `scontrol` observation fallback, enforced polling schedule, batched query interface, or backoff implementation.

   **Change:** parse explicitly selected job records, preserve exit status and signal separately, classify documented lifecycle states, distinguish observation errors from confirmed absence, and retain previous evidence. Implement batched reconciliation and test requeue, held jobs, lagging accounting, controller rejection, and retained terminal records. **S §§4, 10.**

5. **Critical — Tasks 10, 15, and 18 do not complete the idempotent submission controller.**

   Persisting intent before `sbatch` is necessary, but insufficient:

   - Every `POST /api/runs` constructs new run and request UUIDs. Retrying after a lost HTTP response can create a second job.
   - `find_by_request_id` exists, but no startup reconciliation task actually invokes it for unresolved intents.
   - A submission timeout is not converted to `SubmissionUnknown`; Task 15 only handles that exception.
   - Definitive rejection and ambiguous acceptance leave no complete, distinct transition contract.
   - Cancellation persisted before handle discovery has no specified reconciliation action that applies it after recovery.

   These are precisely the external-side-effect boundaries highlighted in the earlier review. [P:2270](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:2270), [P:3178](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:3178), [prior review:105](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-09-05-codex-review-daemon-architecture.md:105)

   Lookup itself returns the first job matching an eight-character prefix, without owner verification, full request-ID verification, duplicate-match handling, or command-status checking. Two matching jobs must yield ambiguity, not arbitrary adoption.

   **Change:** give the API a stable idempotency key or persisted plan/submission identity; enforce uniqueness transactionally; bind it to the submitted payload; and implement a startup plus periodic controller for unresolved submission and cancellation intent. Search using verifiable full identity and ownership, and retain `submission_unknown` whenever acceptance remains uncertain. **S §4.1.**

6. **High — Task 5’s dispatch lock is permanent after a crash, and storage placement conflicts with HPC execution.**

   Inserting a row into `locks` is a durable reservation, not a liveness-aware lock. The supplied test proves normal `close()` releases it; it does not cover a killed daemon. After a crash, the row remains and subsequent acquisition fails indefinitely. Conversely, no submit-path code checks that dispatch ownership was acquired. [P:1176](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:1176)

   `UnsupportedStorage` is declared but never used to validate a mount. The default data path is commonly under an HPC network-mounted home directory. Task 15 then places run directories beneath that same data directory. The spec requires the database on suitable local storage while runs must be visible to compute nodes; these often require **different roots**. [P:1120](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:1120), [P:3181](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:3181)

   **Change:** separate private daemon-state storage from shared run storage. Validate ownership, permissions, filesystem support, and execution-side mapping. Use a crash-released lock or a rigorously defined liveness/recovery mechanism, and gate every external mutation on ownership. Add the backup, transactional migration, versioning, and read-only recovery workflow required by **S §8**; none is implemented by Task 5. [S:234](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-09-05-wavedl-daemon-architecture-design.md:234)

7. **High — Task 9’s script still has rendering, filesystem, topology, and outcome errors.**

   The supplied template contains literal `$?` and `$TRAIN_STATUS`. Ordinary `string.Template.substitute` interprets these as template syntax; the `$?` produces `ValueError`. I reproduced that from the embedded template. Escape shell dollars as `$$`, while preserving deliberate Python substitutions. [P:2097](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:2097)

   Its output paths are `attempts/%j/slurm.out` and `.err`, but planning creates only `run_dir`. The job-specific parent does not exist before scheduler redirection. Creating numeric job-ID directories under `attempts/` also conflicts with the attempt allocator, which treats every numeric directory as an attempt. Put scheduler logs directly beneath an already-created log directory, with `%j` in the filename.

   The proposed `--machine_rank $SLURM_NODEID` can be expanded by the batch shell before `srun`, passing the same rank to every launcher. The plan omits exact tasks-per-node, rendezvous, and GPU-count semantics. This matters here because WaveDL forwards `num_gpus` directly into Accelerate’s `num_processes`; installed Accelerate divides that number by `num_machines`. “Four GPUs” must explicitly mean total or per node. [P:2125](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:2125), [launcher.py:315](/Users/myt/Documents/GitHub/WaveDL-GUI/src/wavedl/launcher.py:315)

   Finally, `exit $TRAIN_STATUS` preserves training failure but masks cleanup/stage-out failure after successful training. No independent outcome record is written.

   **Change:** render and execute scripts against fake scheduler/launcher commands that capture actual argv, rank, environment, working directory, and exit outcomes. Include both “training failed, cleanup succeeded” and its inverse. Move directory creation from planning into submission preparation. **S §§3.1, 4, 10.**

8. **High — Tasks 4, 7, and 12 never establish a shared, consistent run manifest.**

   Task 12 explicitly forbids importing daemon code into training, while Task 4 puts the supposedly shared manifest builder inside `wavedl_daemon`. No standalone launch path constructs that manifest. Task 15’s adoption test manufactures one through daemon imports, so it does not test adoption of an actual standalone run. [P:892](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:892), [P:2507](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:2507)

   Runtime emission reads `WAVEDL_RUN_ID`, but the plan never sets it when launching. Training therefore generates a different UUID from the registry/manifest. New attempts also get no specified linkage to a persistent standalone identity. [P:2685](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:2685)

   The manifest stores raw arguments rather than the resolved configuration, runtime selection, working directory, and storage mapping promised by §3.1. Local execution changes cwd to the new run directory, so relative dataset/config paths can stop resolving. `write_manifest` is a check-then-write race and can leave a truncated manifest after interruption.

   **Change:** place shared manifest/layout/publication primitives in a dependency-light core module; construct manifests from both launch paths; propagate and validate one run identity; resolve paths/configuration before submission; and publish manifests without overwrite or partial-file exposure. **S §§2.2, 3.1–3.2, 12.**

9. **High — Tasks 2–3 handle ordinary newline boundaries but not recovery boundaries.**

   The following reader failures were reproduced from the embedded implementation:

   - `seek_to_seq(-1)` on `[0,1]` skips event zero and returns `[1]`.
   - Seeking after missing sequence 1 in `[0,2]` advances past sequence 2 and returns nothing.
   - A schema-invalid JSON object raises Pydantic `ValidationError`, which the reader does not catch as `ProtocolError`.

   The seek algorithm advances its offset before deciding whether it has reached a record that should be replayed. It needs to stop **before** the first record with `seq > cursor`, with `-1` positioned at the beginning. [P:689](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:689)

   `_next_seq()` returns 2 for records numbered `[0,4]`. More seriously, reopening a file ending in an unfinished object appends the next object directly to that fragment. The next newline commits a corrupt combined record. Use a new attempt/segment or an explicit recovery procedure; never silently append through an abandoned tail. A full scan on occasional recovery may be acceptable, but the plan must state its scale and integrity assumptions rather than imply general correctness.

   The reader also loads all newly visible bytes and retains all malformed lines without bounds. Text-mode newline translation makes its manually computed offsets unsafe for Windows CRLF files. Use bounded binary reads, newline framing, explicit decoding, and bounded diagnostics. **S §§3.3, 13, 16.**

10. **High — Tasks 16, 18, and 21 cannot guarantee resumable event delivery.**

    Sequence numbers reset per attempt, but `events_after(run_id, since_seq)`, the HTTP cursor, the live deduplication check, and the client interface all use a single run-wide `seq`. After attempt 1 reaches 100, attempt 2’s events 0–100 can be suppressed. [P:989](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:989), [P:3334](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:3334)

    Subscription-before-replay fixes one race, but Task 18 introduces another loss mechanism. For example, a subscriber receives 101–102, its full queue drops 103–104, and it later receives 105. The stream advances `last` to 105, making 103–104 disappear from subsequent resumption. A server-side dropped counter does not notify that subscriber or repair its cursor. No broker publication contract connects database commit to notification. [P:3348](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:3348), [P:3658](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:3658)

    **Change:** use an opaque delivery cursor or an explicit `(attempt, seq)` contract throughout. Define ordered publication after durable insertion. On overflow, disconnect with recoverable position or replay from durable storage; do not advance past an unaccounted delivery gap. A particularly simple pattern is to treat broker messages as wakeups and read authoritative ordered events from the database. Test concurrent replay, overflow, commit/publication interruption, and requeue. **S §§4, 5.4, 13.**

11. **High — Task 17 modifies the wrong checkpoint path and leaves resume behavior inconsistent.**

    The named `_save_best_checkpoint` helper is not called by the main training loop. The actual best-checkpoint save is inline at [train.py:1809](/Users/myt/Documents/GitHub/WaveDL-GUI/src/wavedl/train.py:1809); periodic saves are separate at [train.py:1876](/Users/myt/Documents/GitHub/WaveDL-GUI/src/wavedl/train.py:1876), and emergency saves follow another path.

    Editing the helper alone does not publish ordinary training checkpoints. The task also leaves automatic resume scanning the old directory names and makes publication conditional on daemon-package importability, explicitly falling back to mutable standalone saves. That contradicts standalone completion manifests in **S §11**. [P:3510](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:3510), [train.py:1330](/Users/myt/Documents/GitHub/WaveDL-GUI/src/wavedl/train.py:1330)

    **Change:** trace and modify every real save/resume path. Define collective rank participation, shared staging identity, when all rank files are complete, rank-zero publication, and how resume selects a published generation. Publish directly from core code. Specify durability ordering around contents and `COMPLETE.json`; atomic rename alone is not sufficient.

12. **High — Task 23 makes restored metric history permanently wrong.**

    `appendPoint` permanently ignores an epoch already in `seen`. If training emitted through epoch 100, restores epoch 90, and recomputes 91–100, the chart preserves the old values and discards the new ones. This is not event idempotency; it confuses an epoch number with an event identity. [P:4087](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:4087)

    The repository already truncates CSV history to the checkpoint epoch. The plan contains no journal rollback/supersession event, producer integration, server projection rule, or client handling. [train.py:1477](/Users/myt/Documents/GitHub/WaveDL-GUI/src/wavedl/train.py:1477)

    **Change:** implement logical rollback before charts: identify the restored checkpoint, invalidate subsequent logical history, and apply new events by attempt/event identity. Then test chart reconstruction across reconnect and resume. This is an explicit, currently uncovered **S §11** requirement. [S:281](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/specs/2026-09-05-wavedl-daemon-architecture-design.md:281)

13. **High — Task 17’s artifact access check remains vulnerable to replacement between validation and open.**

    `Path.resolve()` followed by a containment check is still two operations before the eventual file open. An ancestor can change between them; returning a path-based file response may delay the open further. The supplied test only creates an already-escaping symlink, so it does not exercise the race named in its docstring. Adoption also tests manifest presence without ownership/provenance verification. [P:3508](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:3508)

    **Change:** define a symlink policy and platform-specific safe-open mechanism, validate components relative to trusted directory handles where available, and stream the verified open file rather than reopening an unchecked pathname. Test replacement between validation and open and group-writable adopted directories. The download headers are appropriate but address a different problem. **S §§6, 12.**

14. **High — Tasks 13, 15, and 18 do not provide the promised bounded execution model.**

    Task 13 declares `timeout_s`, but neither its implementation instructions nor tests enforce a deadline. File size alone does not bound ZIP member count, header work, or stalled filesystem operations. Putting the operation in a threadpool prevents event-loop execution; it does not necessarily stop timed-out work or prevent worker exhaustion. [P:2721](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:2721), [P:2862](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:2862)

    Task 15’s `async def submit_run` directly performs synchronous filesystem, database, and subprocess operations. A 60-second scheduler call blocks that event-loop worker, undermining concurrent cancellation and streams. Task 18 says to wire an ingestion loop without specifying bounded workers or scheduler reconciliation.

    There is also a repository contract issue: `NPZSource.load_mmap` returns array-bearing `LazyDataHandle` objects consumed by training, not metadata. Its callers index samples. Do not change its return contract to header tuples. Add a separate metadata API that shares key selection and format normalization. Include `.hdf5`, which the repository supports, and avoid presenting `.npy` inspection as trainable input when the training format dispatcher rejects it. [data.py:319](/Users/myt/Documents/GitHub/WaveDL-GUI/src/wavedl/utils/data.py:319), [data.py:1387](/Users/myt/Documents/GitHub/WaveDL-GUI/src/wavedl/utils/data.py:1387), [data.py:222](/Users/myt/Documents/GitHub/WaveDL-GUI/src/wavedl/utils/data.py:222)

    **Change:** define admission limits, bounded work queues, deadlines, and cancellation/error behavior for each blocking operation. Keep inspection and training-data loading as separate contracts. **S §§7, 13.**

15. **High — Protocol and runtime negotiation are advertised but not implemented.**

    Task 1’s decoder accepts non-finite JSON constants, unsupported protocol versions, negative attempts/sequences, and arbitrary timestamps. I verified that version 999 with a `NaN` payload is accepted. Its encoder sanitizes numbers, but that does not make the decoder strict.

    Task 12 emits `hello`, but no task validates its supported range, enforces a first-event rule/deadline, or records the required execution provenance separately. `protocol/events.py` appears in the file map without a task that implements the per-type schemas. Non-main-rank diagnostic files are named in the layout but not wired into emission. [P:251](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:251), [P:2689](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:2689)

    **Change:** add protocol validation and runtime negotiation as an explicit task before ingestion. Preserve unknown-field/event tolerance without accepting malformed known fields or incompatible versions. Distinguish waiting in the scheduler from a launched runtime that missed its handshake deadline. **S §§5.1–5.2, 16.**

16. **Medium–High — Tasks 19–21 do not establish a functioning, upgrade-safe offline client.**

    The local starter’s production configuration uses `strategies: 'injectManifest'`, `app/service-worker/sw.ts`, and `registerType: 'autoUpdate'`. Its worker explicitly calls `skipWaiting()` and `clientsClaim()`. Adding the plan’s top-level `workbox` object does not rewrite that worker, and production overrides must also be removed or changed. [starter nuxt.config.ts:46](/Users/myt/Documents/GitHub/Nuxt-Starter-Kit/nuxt.config.ts:46), [starter sw.ts:79](/Users/myt/Documents/GitHub/Nuxt-Starter-Kit/app/service-worker/sw.ts:79)

    **Change:** pin the generator version and inspect the generated effective configuration. Either explicitly choose `generateSW` and remove conflicting worker configuration, or edit the custom worker. Verify the built worker’s actual routing, offline navigation, update activation, and absence of required third-party assets. The `/api/` navigation denylist does not by itself govern ordinary fetch requests. Task 26’s regex/config inspection cannot prove runtime behavior.

    Task 21 also gives an invalid decoding API: `TextDecoder({ stream: true })`. Use `new TextDecoder("utf-8")`, then `decoder.decode(chunk, { stream: true })`. Test a UTF-8 character split between chunks. [P:3944](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:3944)

    Finally, Task 20 consumes `client_build` and assumes backend identity, but Task 14’s health response does not define their production. Cursor persistence, backend-namespaced preferences, and bootstrap URL cleanup likewise lack implementation tasks. **S §§6, 8, 14–14.1.**

17. **High — The migration and release gates cannot pass as written.**

    Task 18 replaces only `TrainingWorker` subprocess spawning. `PlotWorker` and `TestWorker` still launch subprocesses, while the backend seam has no operation type or API for those workflows. Thus “the Qt shell runs entirely through the daemon” is not achieved. [P:3658](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:3658), [training_service.py:329](/Users/myt/Documents/GitHub/WaveDL-GUI/src/wavedl_gui/service/training_service.py:329), [training_service.py:400](/Users/myt/Documents/GitHub/WaveDL-GUI/src/wavedl_gui/service/training_service.py:400)

    Task 26 postpones project setup, plots, hyperparameters, results/export, settings, and other parity gaps to “fix any gaps,” without bounded implementation tasks. Task 28 then deletes `wavedl_gui` but retains Task 27’s unconditional import of `wavedl_gui.main`; its promised full-suite pass is impossible without removing or replacing that test. Existing GUI parser tests also need an explicit disposition. [P:4298](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:4298), [P:4335](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:4335), [test_metrics_json.py:206](/Users/myt/Documents/GitHub/WaveDL-GUI/unit_tests/test_metrics_json.py:206)

    Release builds are wired only in Task 29, after the mandatory release carrying Task 27’s deprecation notice. Packaging must be established before that release, and Phase 2 static tests need a build fixture or CI build prerequisite. Package the SLURM `.sh` template explicitly as well as the web assets, and test an installed wheel outside the checkout. `PYTHONPATH=src` fixes imports, not a missing or stale `wavedl-train` console script. **S §§2.1, 15–16.**

The decomposition needs revision beyond renumbering:

| Area | Required correction |
|---|---|
| **Phase table** | It still says Tasks 1–26, 27–36, and 37–39. Actual boundaries are **1–18, 19–26, 27–29**. “Tasks 1–10 and 26 give a working Local-only daemon” is false: those tasks lack the API, ingestion, CLI, and runtime integration. [P:26](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:26) |
| **Task 16 → Task 18** | Streaming consumes `EventBroker` before it is introduced. Move the broker and delivery contract before the endpoint, or land them together. |
| **Task 18 → Task 25** | Phase 1 requires Qt operating through the daemon, but models and dataset HTTP endpoints land in Phase 2. Move backend parity endpoints into Phase 1. |
| **Task 12 → Task 26** | Task 12 says Task 26 tests producer/consumer compatibility; Task 26 instead tests service-worker configuration. Add the promised compatibility tests before the Phase 1 gate. |
| **Backend interfaces** | Task 7’s interface says `submit(plan)` while the protocol says `submit(plan, manifest)`. `collect` is promised without a concrete implementation/consumer contract. The plan and handle omit required ownership/storage/runtime fields. [P:1481](/Users/myt/Documents/GitHub/WaveDL-GUI/docs/superpowers/plans/2026-09-05-wavedl-daemon-migration.md:1481) |
| **Reviewable plan identity** | Task 24 promises the preview is exactly what will run, but Task 15 rebuilds the manifest, UUIDs, output path, and plan on submit. Persist or deterministically bind submission to the reviewed plan. |
| **Oversized commits** | Split Task 8 into launcher signalling, POSIX supervision, and Windows supervision; Task 17 into shared publication, training/resume integration, and artifact access; Task 18 into controller lifecycle, resource limits, CLI, Qt adapters, and integration gates. Task 26 must validate an already-enumerated parity matrix, not absorb an unspecified UI rewrite. |
| **Commit completeness** | Task 18’s staged paths omit `ingest.py`, where it introduces `EventBroker`. Several “Files” and commit blocks similarly omit implementation dependencies. Audit these against the required one-commit-per-task workflow. |

The TDD structure is also weaker than its presentation suggests. Several assertions do not test their stated property:

- “Intent persisted **before** backend call” checks registry contents only **after** the request.
- “Events and cursor commit together” inserts no events and merely checks the cursor.
- The slow/fast subscriber test never drains the “fast” subscriber.
- The no-orphan gate takes its baseline **after** training starts, then only looks for processes created afterward; already-running leaked workers are excluded.
- The publication-interruption test creates an unrelated incomplete directory instead of interrupting publication.
- Substring checks for `srun` and `TRAIN_STATUS` do not test topology or exit semantics.
- The 10,000-point test checks length, not the claimed absence of copying.

Replace these with controlled failure injection at persistence boundaries, barrier-controlled concurrency, executable fake backends, and actual tracked process trees. Platform-specific Bash stubs and POSIX signal tests also need explicit markers/skips and Windows counterparts; adding an OS matrix at Task 29 does not make those tests portable.

The spec-coverage appendix should therefore be downgraded from “covered” to the following:

| Spec requirement | Actual coverage |
|---|---|
| **§1.1 deployment contract** | Partial. Capability probes and one cluster gate exist; storage mapping, mount validation, ownership, and supported service lifetime are not implemented. |
| **§2.2 standalone execution; §12 adoption** | Partial. Standalone journaling exists; shared manifest construction, persistent identity, and verified adoption do not. The additive daemon-client CLI has no task. |
| **§3.3 journal storage** | Partial. Newline handling and fsync exist; abandoned-tail recovery, bounded reads, declared visibility tolerance, and the specified optional live-push path are missing. |
| **§4 reconciliation; §4.1 ambiguous submission** | Incomplete. Reducer and lookup helpers exist, but their correctness and the controller that invokes recovery are missing. |
| **§5.1–5.2 protocol/handshakes** | Partial. Envelope and hello emission exist; payload validation, compatibility enforcement, deadlines, and provenance persistence do not. |
| **§6 security** | Incorrect in material parts. Cookie bearer exposure and open-time race remain; Host/XSRF/bootstrap requirements are incomplete. |
| **§7 inspection** | Partial. Public header reads are now sound; time/concurrency budgets and repository format parity remain unproven. |
| **§8 storage/migration** | Mostly missing beyond database CRUD. Storage refusal, crash-safe dispatch ownership, and legacy migration/recovery have no completed task. |
| **§9 supervision** | Partial and unsafe. Full-tree shutdown, output draining, Windows ownership, and reducer handling are incomplete. |
| **§10 scheduler integration** | Partial. Rendering/probes exist; correct lifecycle observation, batching/backoff, topology, and independent outcomes do not. |
| **§11 checkpoints** | Incomplete. Publication helper exists, but production save/resume integration, standalone publication, and metric supersession are absent. |
| **§13 backpressure** | Partial. Queue capacity exists; recoverable overflow, bounded blocking work, reader bounds, and an operational storage-error policy do not. |
| **§14–14.1 client/skew** | Partial. Planned UI/configuration exists; effective worker behavior, identity production, backend namespaces, and upgrade behavior need implementation and verification. |
| **§15 migration** | Incomplete. Qt test/plot paths and substantial parity work have no bounded tasks. |
| **§16 failure-oriented testing** | Substantially overstated. Crash-boundary, delayed-visibility, live-handover, runtime-mismatch, held/requeued-state, read-only-storage, and race-at-open tests are absent or do not exercise the named failure. |

The architecture’s deviations from larger systems are mostly justified: a per-user daemon, SQLite, readable JSONL, scheduler-owned allocation, and explicit loss of Local supervision after daemon death fit WaveDL. The unjustified deviations are implementing a job controller without a recovery loop, treating a lossy notification queue as an event-delivery guarantee, using a lock row without liveness, and calling a raw argument list an immutable resolved plan.

**Revise the controller, identity/cursor contracts, supervision, and production checkpoint integration before expanding the client tasks.** Keep the real-cluster gate, but move the missing failure simulations and cross-platform supervision checks ahead of it. The current 29-task count hides substantial unplanned implementation work.
