# New-app completion audit — 2026-10-18

Requirement assessment reviewed by the main agent; not full T38/T42 sign-off.
This audits the new daemon/browser application, not a Qt transition.
No legacy migration, deprecation period or Qt-retaining release is required.

## 2026-10-20 verification addendum

The ledger's current top section supersedes the older pending-platform labels
in this audit. Hosted CPU Tests at product `2c60886` pass on Python 3.11/3.12/3.13,
each with 4,001 passes and 40 explicit skips. Exact Unicode-fixed wheel/sdist
offline lifecycle acceptance passes with zero skips. Native Windows installed
CPU acceptance now passes on both Python 3.11/3.13 at QA-only `01f9e7d`, with one
intended case and zero skips each; both retain native ownership and graceful
shutdown checks. The full eight-job foundation matrix passes at `2c60886`.
Actual single-device macOS MPS training-tree cancellation is also verified within
its declared boundary, not as cross-platform/distributed GPU acceptance.

A fresh requirements review identified a concrete local evidence gap: chart
keyboard tests did not establish the required real-browser forms journey. The
new native-key-only guided-authoring/invalid-field/inline-confirmation probe now
passes its strict current-be6 report, 31 regression tests and independent review.
No shipped modal dialog, focus trap or full assistive-technology certification is
assumed. Source, scope and report hashes are in the ledger. The subsequent QA-only
`01f9e7d` CPU Tests also pass with 4,010 passes / 40 skips per version and all eight
foundation jobs pass. The full hosted browser run remains live after passing its
default twelve-case suite. CUDA/distributed GPU, real Slurm/filesystem-site and
final T30c/T38/T42 sign-off remain open. No release or publishing is authorized.

## 2026-10-19 verification addendum

The ledger's newest sections supersede the older unrun-hosted labels below.
Hosted CPU Tests pass on Python 3.11/3.12/3.13 at `f8ad5f0`; fresh CPU Tests
at `32c25fc` are still running. Static-client checks pass at `6ed0fa4`, with
unchanged browser inputs since. At `32c25fc`, all six Linux/macOS/Windows
foundation versions and both real-tmpfs lanes pass. Both full Windows daemon
reports pass, including all 15 required native safety cases, the HEADER worker
and successful cleanup. Reviewed fixes retain native ownership, held-file
identity, bounds and truthful uncertainty. The full native foundations matrix
is accepted within this dependency-light filesystem/process/daemon scope.

Exact clean `32c25fc` wheel/sdist CPU lifecycle acceptance and fresh local
retained/cancellation/partial-best/native-SSE browser reports pass within their
declared boundaries. Hosted browser aggregate, final full supported-platform
validation, actual GPU/accelerate trees and real Slurm/filesystem-site gates
remain open. Local passes and passing native safety subsets do not close these
gates. Exact hashes, failed precursors and source boundaries are in the ledger;
no tag or publication is authorized by this addendum.

## Authority and evidence boundaries

Normative requirements: `2026-10-04-web-client-parity.md` capability matrix,
`2026-09-06-daemon-migration-structure.md` current T30c/T38/T42 tables, and
architecture specification §16. The acceptance ledger's current top section
overrides its older remaining-work labels. A historical report remains evidence
of its recorded scope; it is not silently relabelled with a newer asset hash.

Current frozen bundle: `be6e933df02ec78e830f20ea02ba1ce61f27f96055cfdb96fb398f4de4f57472`.
The ledger records 820 web passes/one skip, 38 generated-worker passes, the
12-case packaged browser aggregate `wavedl-browser-acceptance-d9XBcT/summary.json`,
be6 preview refusal/resource recertification, native SSE and CV/resume reports.
Clean-stage exact wheel and sdist each pass isolated dependency-resolved installed
acceptance with no skips; source/static inventories match and exclude Qt.

Native macOS/CPU is locally verified within these scopes. An additive
Linux/arm64 container run exposed and fixed an eager login lookup despite an
explicit backend owner; fresh core/daemon regression is 2,698 passed/15 skipped,
and rebuilt exact artifacts plus a new browser training smoke pass. Actual
4 MiB tmpfs ENOSPC/SQLite-full recovery and all 13 required POSIX foundation
cases pass in Docker Desktop's Linux VM (278 foundation passes, 14 explicit
other-platform/optional skips), not a native Linux host or a Linux ML install.
Full dependency-light Linux/arm64 foundations now pass for Python 3.11.17 and
3.13.16, each with 2,687 core/daemon passes/51 explicit skips and 76 guard tests.
The run exposed interpreter-dependent deep JSON acceptance, now fixed with an
explicit 32-container bound and mutable UTF-8 buffer compatibility. Current
macOS production-source regression is 2,721 passes/15 skips; six later QA-only
publication tests additionally pass within the full Linux lanes and focused
35-test fixture suite. Exact rebuilt packages pass isolated lifecycle checks.
The journal-fault browser flow also passes after fixing its readiness handshake,
without relaxing single-link checks. Exact current wheel and sdist additionally
pass Linux/arm64 Python 3.13 CPU dependency-resolved isolated installation and
real training/publication with network disabled, no system-site packages or
checkout leakage, plus authenticated daemon lifecycle checks. This extends the
selected Linux-VM CPU evidence; it does not prove GPU, compilation, hosted CI or
native-host support. The full selected-stack Linux CPU regression also passes
3,800 tests with 35 explicit skips and 336 slow/GPU deselections, including
actual CPU runtime, inference/export and simulated scheduler workflows. A
test-only cache-environment fixture now restores all state, preventing test-order
pollution. Linux/CPU CI is configured, not freshly
hosted-verified by this audit. Native
Windows, actual GPU process-tree cancellation and real Slurm/filesystem
integration remain external. See the ledger's latest runtime section for hashes.
The final exact-controller report and literal CI-layout guard pass root and
independent Sol review. Its controlled build identity and read-only observer are
explicit QA conditions, not a released-binary, cache-hit or remote-site claim.

Pointers below are relative to the repository unless just a basename is used:
`W` = `web/workstation`, `WT` = `web/test/workstation`, `D` =
`src/wavedl_daemon`, `DT` =
`unit_tests/daemon`, `CT` = `unit_tests/core`. Named reports are located and hashed
in the acceptance ledger. **Component** means executable isolated/ASGI/backend
coverage; **assembled** means recorded browser/runtime evidence. Neither means
external-platform certification.

## P0 capabilities: all 24 requirements

| Row | Implementation and strongest concrete evidence | Local disposition / boundary |
|---|---|---|
| 01 Dataset selection | `W/lib/catalog-api.ts`, `BrowseContainer.vue`; `DT/test_catalog_api.py`; catalogue fault report, real unreadable-owned-child and entry-limit refusals | Component + assembled; configured remote roots/site filesystems remain external. |
| 02 Header summary | `W/lib/dataset-inspection.ts`, `DT/test_inspection.py`; HEADER deadline report `wavedl-header-deadline-final2.PnYENj/header-deadline.json` | Component + assembled timeout/retry; fixture deadline is explicit, not a new production default. |
| 03 Six interactive views | `DatasetPreviewPanel.vue`, `W/lib/dataset-preview.ts`; dataset-parity baseline, be6 `preview-fault.json` and `preview-budget.json` | Component + assembled six views/PNG/statistics/Stop/retry/caps; default-cap saturation is not claimed and is not an extra invented capability. |
| 04 Downloads/folder disposition | `ArtifactList.vue`, `W/lib/artifact-client.ts`; `WT/artifact-download.test.ts`, `training-export-download-status.test.ts`, baseline download-names/artifact-tamper, PNG lifecycle tests | Component + assembled exact downloads/collision/integrity; truthful handoff does not claim an unobservable browser save. No native-folder API is required. |
| 05 Reset preservation | `ProjectContainer.vue`, preferences; `WT/settings-workspace.test.ts`; submitted-plan and baseline authoring reports | Component + assembled explicit reset/immutable submitted bytes; no missing reset implementation identified. |
| 06 YAML/standalone CLI | `W/lib/training-export.ts`, `TrainingExport.vue`; `WT/training-export.test.ts`; full-fields and training-validation export reports | Component + assembled complete destination round-trip, quoting, secret omission and unsupported environment/topology refusal. |
| 07 Guided wizard | `ProjectGuide.vue`, `ProjectContainer.vue`; `tools/browser_wizard_progression.mjs`, wizard and preset-import reports | Component + assembled back/forward, invalid progression, preserved inputs and single submission; guide preference is separately tested. |
| 08 Models/shape/pretrained | `ModelSelector.vue`, `D/runs/catalog.py`; catalog component/API tests, nine-case catalogue report | Component + assembled malformed model metadata/refusal/reselection; guidance is not runtime certification. |
| 09 Visible training controls | `TrainingFields.vue`, shared schema; `WT/training-fields-acceptance.test.ts`, project-plan tests, full-fields/training-validation reports | Component + assembled controls/options/ranges; canonical precision field prevents conflicting alias authoring rather than silently dropping aliases. |
| 10 Additional seam fields | shared training inventory/schema, runtime/storage fields; full-fields report, be6 CV/resume report and `DT/test_lifecycle_api.py::test_cv_unsupported_plan_refused_without_persistence` | Component + assembled exact seam, incompatible CV resume refusal/correction/preview recovery; successful resume execution is not inferred from this negative slice. |
| 11 Legacy no-cache preference | `TrainingFields.vue`, preferences, Local per-run isolation; preferences report with unchanged cache sentinels | Requirement is nondeletion. Parity matrix explicitly prohibits offering previous-run cache deletion; no deletion confirmation feature is missing. |
| 12 Preview/start | `W/lib/project-plan.ts`, `PlanApproval.vue`, daemon service; lifecycle/plan-store tests, baseline lost-ACK and submitted-plan reports | Component + assembled persisted preview, exact submission and stable retry identity. Real sbatch ambiguity remains external. |
| 13 Stop/reconnect | run monitor/event stream/controller; pending-cancellation HTTP tests, pending-cancel/reconnect/inference-cancel reports | Component + assembled detach, receipt/lost-ACK/dedup and cancellation; Windows/GPU/real scheduler trees remain external. |
| 14 Dashboard states | StateBadge/run monitor/reducer; `DT/test_reducer.py`, dashboard-state and restart reports | Component + assembled truthful uncertain/terminal presentation; no additional state invented from absence. |
| 15 History/charts | metric-history/uPlot/projection; metric tests, 100k history and genuine supersession reports | Component + assembled 100k and replaced restored history; repeated permutations across every backend are not a separate local requirement. |
| 16 Output/logs | event-stream/LogPanel/streaming; stream/sparse/native-SSE reports and `DT/test_event_delivery.py` | Component + assembled durable replay, Unicode chunk boundaries and overflow; native QA transformations remain declared. |
| 17 Automatic plots | autoplot controller/workflow; `WT/autoplot-controller.test.ts` best-vs-periodic, partial fallback/refusal, requeue/detach; partial-best/checksum and failed/uncertain reports | Component + assembled verified best pin and no-fallback integrity refusal; no missing product behavior identified. |
| 18 Evaluation/prediction/export | ResultOperations/result schema; `CT/test_checkpoint_source.py`, runtime operations, ONNX tests; result-operations/CV/ONNX/numerical/inference-cancel reports | Supported plot formats PNG/PDF/SVG/EPS/TIFF are schema/runtime-covered; assembled reports cover bound source, structured metrics, selected plot outputs, CSV and ONNX. ONNX-only model export matches CLI contract; other model formats are not required. |
| 19 Published artifacts | artifact store/SafeDirectory; `DT/test_safe_artifacts.py` replacement-after-listing/before-open/after-open tests; artifact-publication and tamper reports | Component + assembled containment/incomplete/integrity/budget/no-inline; local symlink race is tested, not an absent implementation. Site filesystem semantics remain external. |
| 20 Appearance/defaults/W&B | preferences/settings; `WT/preferences.test.ts`, settings/localization tests; preferences and wizard reports | Component + assembled corruption fallback, language/theme/zoom/accent/defaults/guide. External W&B access is not required to prove optional default persistence. No cache deletion is authorized. |
| 21 Connection/identity | connection-session/auth/bootstrap; `WT/connection-session.test.ts`, HTTP auth/bootstrap tests; auth-skew, port-reuse and hostile-origin reports | Component + assembled 401/skew/isolation/URL stripping; real forwarding/site deployment identity remains external. |
| 22 About/feedback/update | SettingsWorkspace/build identity; shell and build-skew prompt tests | Component + assembled explicit build-skew notice and user-triggered reload; feedback uses no-referrer/noopener and warns against secret disclosure, not an automatic outbound export. |
| 23 Offline/PWA | Former compiled worker/static-serving implementation and acceptance evidence below (historical record only) | Retired as a product capability by owner decision on 2026-10-27; no offline/PWA support is required or claimed for the current workstation. |
| 24 Run list/detail/adoption | RunsWorkspace/adoption service; `DT/test_adoption.py`, `test_adoption_service.py`; standalone main/negative/rollover reports | Component + assembled real standalone provenance/ownership/lost-ACK/negative history. No PID supervision adoption; real-site ownership/storage remains external. |

## Architecture §16: all 15 failure categories

| Category | Concrete strongest evidence | Disposition |
|---|---|---|
| F01 Interrupted submit | `DT/test_submission_http_crash_recovery.py` six SIGKILL cuts; Local spawn-failure fence; lost-ACK browser | Local component + assembled; real sbatch identity recovery external. |
| F02 Torn/oversized/abandoned journal | core reader/writer tests; journal-fault report four genuine-byte cases/reader eviction | Local component + assembled; shared filesystem behavior external. |
| F03 Delayed visibility | `DT/test_hosted_failure_visibility.py::test_delayed_completion_and_failed_commit_replay_over_hosted_http` | Local assembled HTTP/owner/SQLite with controlled observation; real FS visibility external. |
| F04 Projection/cursor crash | hello and metric `test_registry_http_recovery.py` matrices, both orders and rebuild/ingest, SIGKILL | Local assembled durable recovery; current top ledger closes stale metric-event label. Windows/site external. |
| F05 Replay/live race | event-delivery handover tests, genuine broker-overflow browser, native-SSE replay | Local component + assembled; live real scheduler/site external. |
| F06 Exhaustion/read-only | `test_tmpfs_storage_acceptance.py`, read-only/quota reports, strict tmpfs CI guard and final `wavedl-linux-final-procps.tzYOVm/tmpfs-acceptance.xml` | Actual 4 MiB tmpfs ENOSPC/SQLite-full recovery passes with zero skips in Docker Desktop's Linux VM. Native-host Linux, hosted CI and site durability remain unverified. |
| F07 Local restart | submission-controller actual CPU restart loss; daemon-restart browser SIGKILL | Local assembled supervision_lost/no resubmit; host reboot and Windows/GPU outside verified scope. |
| F08 Interrupted publication | `DT/test_publication_crash_http.py`, core generations/checkpointing; partial copy/before/after marker | Local assembled subprocess/HTTP preserves previous publication; real-site fsync external. |
| F09 Runtime mismatch | runtime negotiation/writer-HTTP tests, explicit interpreter/topology/device provenance | Local component/HTTP refusal; incompatible real allocation at site external. |
| F10 Scheduler lifecycle | scheduler reconciliation/Slurm observation tests, hosted CPU simulated requeue/setup-failure | Required simulation implemented/exercised; actual Slurm config/retention/held/requeue external. |
| F11 Full accelerate tree | POSIX/Windows supervisor and launcher-signal tests; Local/inference browser cancellation; Linux-container native-foundations guard | Local macOS CPU and Linux-container required POSIX process cases pass. This does not prove accelerate/GPU trees across platforms; native Windows and actual GPU validation remain external. |
| F12 Protocol/attempt/order | core protocol/events, event delivery, native heads/lineage; malformed UTF-8, rollover/sparse/native-SSE reports; full Linux 3.11/3.13 foundations | Explicit 32-container JSON bound is verified independently of interpreter recursion; mutable UTF-8 transport buffers remain supported. Local component + assembled order/attempt/chunk boundaries; no invented all-runtime crossproduct. |
| F13 Auth | HTTP Host/Origin/XSRF/bootstrap/CLI tests; hostile-origin report incl positive controls and unchanged storage | Local component + assembled; 0.0.0.0/no-token and malformed Host are explicit tests, not absent security behavior. Real deployment external. |
| F14 Artifact race | safe-artifacts exact pre-open/post-open symlink swaps, anchored FD/hash source, publication/tamper reports | Local component + assembled distinct threats; real-site filesystem external. |
| F15 Worker/API/skew | compiled worker API read/mutation/navigation exclusion; connection-session skew; auth-skew/cold-offline/retained and current controlled-build replacement reports | Required local behaviors have component/assembled evidence, including exact controller identity and genuine new-daemon build refusal. Hosted/forwarded deployment external. |

## Finite remaining local work and external gates

No new missing local product implementation is demonstrated by this audit.
Historical matrix caveats are not themselves executable new requirements.
In particular, cache deletion, additional model-export formats and all-fault ×
all-backend crossproducts must not be added as completion blockers.

Main-agent disposition:

1. The final exact-controller proof and copied CI-layout guard pass; the earlier
   pilot with W&B sibling temporary directories is not CI-layout acceptance.
2. The 24-row local implementation inventory is reconciled with the recorded
   evidence and accepted within its stated component/assembled macOS/CPU scopes.
   This is not complete T38 or evidence for untested deployments/platforms. No
   missing local feature is established by this review, and unrelated historical
   reports are not promoted to current assets or arbitrarily invalidated.
3. Exact be6 wheel/sdist hashes and isolated lifecycle results are recorded in
   the ledger. Local packaging, console-script, static assets, daemon-free CLI
   and daemon/browser requirements pass. T42 remains open across the declared
   support matrix; this review neither silently narrows support nor authorizes
   release. See the ledger for precise artifact and report identities.

Outside this local audit: fresh hosted Linux/CPU matrix execution and timing;
native Windows runtime/process control; actual GPU/accelerate trees across
supported OSes; a real Slurm site's filesystem/version/config/retention/requeue;
and explicit tagging/publishing approval. Local acceptance cannot manufacture
these authorities, and the current support claims must continue to state them.

## 2026-10-27 owner decision — capability #23 retired

The owner retired Offline/PWA capability #23. The retained-build service worker,
offline shell/cache behavior and update-consent subsystem are not part of the
current workstation contract. Current build-skew handling is limited to an
accessible user-triggered reload notice; no offline support or silent reload is
claimed. The historical implementation and reports above remain dated evidence,
not current requirements or acceptance gates.
