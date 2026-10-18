# WaveDL Daemon/Browser Application — Corrected Task Structure

**Status (2026-10-15):** New daemon/browser application; Qt transition requirements superseded; final product/platform/site/release validation remains open
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

### Current scope decision — 2026-10-15 (normative)

Finish a brand-new daemon/browser application, not a legacy Qt migration.
T30a/T30b Qt compatibility and T40/R1/T41's deprecation/Qt-retaining-release
sequence are superseded non-goals. No old-user-data migration or backward
compatibility with the Qt client is required. Preserve existing user files; this
is not authority to delete data. Qt sources temporarily retained in this dirty
checkout are unshipped historical material, not active product code; physical
source deletion is not claimed here.

T30c remains the daemon/browser cross-component reliability gate: API/protocol,
durable state, ambiguous submission, crash/replay recovery, ownership and
security safeguards are unchanged. Real-site filesystem and Slurm evidence is
required before declaring HPC support. P0's 24 capabilities remain product
requirements with browser failure/path coverage, not a Qt compatibility matrix.
T38 and T42 still require current daemon/browser functional, package, browser
and supported-platform validation. No old test total certifies this cutover;
tagging/publishing requires explicit approval. All dated evidence and review
notes below retain their original historical meaning; this section and the
current task/milestone tables supersede conflicting Qt-transition requirements.

### Current implementation/evidence status — 2026-10-15 (new-app validation)

#### Latest Linux CPU artifact validation — 2026-10-18

The exact wheel and sdist now each pass isolated dependency-resolved Linux/arm64
Python 3.13 CPU lifecycle acceptance, **1/1 with zero skips**. Official CPU
PyTorch, a complete offline wheelhouse and network-disabled fresh virtual
environments verify actual training/publication, console scripts, browser assets,
bootstrap/authenticated daemon client operations and clean shutdown. Root and
independent Sol checks pass; exact artifact/report/journal identities are in the
ledger. This extends the dependency-light evidence, not hosted CI, native-host
Linux, Windows/GPU, compilation, real Slurm/site or overall T42 sign-off.

The full Linux/arm64 Python 3.13 CPU non-slow/non-GPU regression additionally
passes **3,800 / 35 skipped / 336 deselected**, with zero failures/errors and
independent report review. A test-only HPC cache fixture now uses an owned job
directory and restores all environment variables; no production behavior was
changed for this harness correction. Exact reports, transparent platform skips
and resource boundaries are recorded in the ledger.

#### Latest protocol and QA publication correction — 2026-10-18

Actual Python 3.13 testing found interpreter-dependent deep JSON acceptance.
The protocol now rejects more than 32 container levels before decoding, preserves
quoted/escaped text and mutable UTF-8 transport buffers, and returns a fixed
protocol diagnostic. Fresh macOS core/daemon regression passes **2,721 / 15
skipped**; exact rebuilt wheel/sdist each pass isolated lifecycle acceptance,
**1/1 with zero skips**. Be6 browser assets remain unchanged. Global checks with
CI-pinned Ruff 0.14.10 pass **481 files** after a targeted lambda-wrap correction.

A Linux run also caught a QA snapshot-publication race. Explicit owned readiness
markers now separate destination visibility from completed single-link evidence;
malicious hardlinks remain refused. **35 Python / 74 Node** fixture/guard tests
pass without weakening production durability or fault assertions. The ledger
records exact current artifacts and preserves failed precursor boundaries.

Final full Linux/arm64 dependency-light foundations runs pass under **Python
3.11.17 and 3.13.16**: each has **2,687 core/daemon passes / 51 explicit skips**,
all **13 required native POSIX cases**, and **76** report-guard passes. Both
containers exit zero with no OOM; exact pinned checks and independent Sol review
pass. The corrected journal-fault fixture also passes actual browser strict
verification and complete cleanup. This is Docker Desktop Linux-VM evidence,
not a native host, hosted CI, Linux ML install, Windows/GPU or real Slurm site.

#### Latest runtime and Linux-container validation — 2026-10-18

An actual unmapped-UID Linux run found an unnecessary eager login lookup during
submission despite an explicit backend owner. Lazy fallback fixes it without
changing ownership semantics; three regressions and independent Sol review pass.
The POSIX-only Slurm writer test dependency now skips explicitly when `pwd` is
absent, rather than breaking Windows collection. Fresh core/daemon regression:
**2,698 passed / 15 skipped**. Exact rebuilt wheel and sdist each pass isolated
dependency-resolved lifecycle acceptance, **1/1 with zero skips**, and a fresh
browser baseline completes genuine CPU training and verified artifact download.

A restricted Linux/arm64 container on Docker Desktop's Linux VM now passes real
4 MiB tmpfs ENOSPC/SQLite-full recovery (**1/1**), **86** evidence/workflow tests
and all **13 required POSIX foundation cases** (278 total passes, 14 transparent
other-platform/optional skips). Exit status is zero with no OOM. The ledger
records exact source/package/report identities, failed pilots and limits.
This is not native-host Linux, Linux ML-install, hosted CI, native Windows/GPU,
real filesystem/Slurm-site or overall T30c/T38/T42 sign-off. Be6 browser assets
are unchanged; older reports retain their original runtime boundary.

The [current new-app completion audit](2026-10-18-new-app-completion-audit.md)
maps all 24 workstation capabilities and all 15 architecture failure categories
to implementation and scoped evidence. It separates local implementation from
outstanding hosted/native-platform/GPU/site validation; older matrix caveats do
not add cache deletion, legacy migration or arbitrary new output formats.

#### Current preview export and final-bundle validation — 2026-10-18

The latest bundle is
`be6e933df02ec78e830f20ea02ba1ce61f27f96055cfdb96fb398f4de4f57472`.
PNG exports now expose preparation/handoff failures, suppress duplicate clicks
and stale callbacks after redraw/unmount, and never claim that the browser saved
a file. Shared export lifecycle handling is used by both preview renderers.
Heatmap replacement, correlation changes and reset clear stale hover values.
Independent Sol review and the full web suite pass: **820 passed / 1 skipped**,
with typecheck/lint/format checks clean and **38/38** generated-worker tests.
The required final-bundle browser aggregate strict-passes **12/12**, with owned
cleanup; exact wheel and sdist each pass isolated dependency-resolved lifecycle
acceptance **1/1, zero skips**. All 38 source/package asset files match and Qt is
absent from both packages. Exact evidence identities are in the ledger.

This supersedes earlier bundle totals below, not their historical report
identities. PNG fault handling is component-tested; a browser filesystem-save
or blocked-download claim is not inferred. Remaining P0 failure-path breadth,
full T30c/T38/T42, native Windows/GPU, hosted CI and real-site filesystem/Slurm
acceptance remain open. No legacy compatibility or data migration is required.

#### Additive native SSE read-boundary acceptance — 2026-10-18

The current be6 browser passes an explicitly instrumented native-reader QA
slice. Two fixture barriers wait for hash-bound native prefixes before releasing
the continuation bytes: UTF-8 `0xc3|0xb3` and CRLF `0x0d|0x0a` are observed across
actual adjacent reads of the selected SSE stream. Exact first-frame/control
bytes, successful native reader cancellation, genuine-cursor replay, Unicode
DOM text, metric canvas/history, durable journal/cursors and owned cleanup pass
strict verification. Exact heartbeat-only prelude suppression and bounded
padding are declared fixture behavior; no real event is dropped.
The ledger records the final report. This closes only the local instrumented
read-boundary slice, not uninstrumented package behavior, attempt rollover,
remote/Slurm/site, native Windows/GPU or full T30c/T38/T42 acceptance.

#### Additive CV/resume authoring refusal and recovery — 2026-10-18

The be6 browser now proves public `cv=2` plus a nonempty resume selector is
refused with an exact generic field error, zero planner receipts and unchanged
durable state. Clearing the same field removes its error. The original `cv=0`
preview remains byte-for-byte unchanged while an additive `cv=2`, `resume=null`
preview matches public approval and persisted request/manifest. Exactly two
unsubmitted plans exist, with no runs, execution, cancellation or submission.
Root and independent Sol strict verification pass; mandatory report schema v2
and **138 Node** contracts prevent historical reports from claiming this slice.
The ledger records the real report. This is authoring refusal/preview recovery,
not successful checkpoint resume, CV execution or complete row 10 sign-off.

#### Current preview resource-budget acceptance — 2026-10-18

Final product-source regression passes **2,695 core/daemon tests / 15 skips**;
web passes **809 / 1 skipped** with typecheck/lint/format clean. Acceptance
tooling passes **446 Node** and **90 focused Python** checks. The later precise
MAT declared-memory test revision independently passes **5/5**. Clean-staged
wheel/sdist assets equal all **38** source files, ship no Qt, and the exact wheel
passes **3** installed CLI/runtime checks (isolated wheelhouse unconfigured).
The acceptance ledger records exact reports and test-only revision boundaries.

The a077 browser now passes valid-numeric resource refusal and recovery:
`/private/tmp/wavedl-preview-budget-run2.lE2rO1/preview-budget.json` (SHA-256
`d49e9da346ea23d67e497b8144a53333e49b1e4d75032346fa9f15df77dce6cf`). The
unchanged ZIP-ratio cap rejects compressed NPZ expansion; fixture-only lower
file-byte and feature-width caps reject ordinary datasets. Sanitized HTTP 413
clears stale plots without disconnecting, capacity drains, and every ordinary
retry paints genuine canvases. Exact worker stdout/HTTP payloads, source hashes,
PID reaping, no durable mutations and owned cleanup are verified. Root and Sol
strict verification pass; verifier contracts **41/41**, Python resource tests
**5/5**, and CI wiring contracts **8/8** pass. No production/assets change.
This closes the bounded local assembled cap/decompression slice, not
production-default, saturation, native Windows/GPU, remote/site/Slurm, hosted CI
or complete T30c/T38/T42 acceptance.

#### Current inspection-deadline acceptance — 2026-10-18

The current a077 bundle now has a real browser/daemon HEADER deadline slice at
`/private/tmp/wavedl-header-deadline-final2.PnYENj/header-deadline.json` (SHA-256
`fb5a1f49496c8252bf6171418e59b2bafabd898da3f8ac2947f4a933c207178f`). A public
daemon-side selection triggers a genuine supervised child with a reduced
fixture-only 2-second command deadline; it is reaped before the pool callback
returns, the pool slot is released, and the browser receives sanitized 422
refusal with no fabricated fields. Public Refresh then runs the unmodified
inspector and returns exact NPZ/96-sample/X/y/shape/dtype metadata; no plans,
runs or cancellations are created. Owned browser, listener, services, child,
profile and fixture cleanup pass. This is explicitly not parser-specific,
production-default timeout, disconnect/Stop, saturation, remote filesystem or
Slurm evidence.

The strict HEADER verifier passes **42/42** contracts; its focused real-child
test and daemon inspection suite pass **18/18**. CI wiring is mandatory,
isolated and report-only; no production/assets change. This closes the local
assembled HEADER deadline slice only.

#### Additive checksum and metric-crash acceptance — 2026-10-18

The frozen a077 browser now also passes `autoplot-metadata-integrity`: one
whitespace byte in a genuine checkpoint metadata response becomes a tab. Size
and parsed JSON are unchanged, while the hash differs from published/disk bytes.
The browser revokes its connection and automatic-plot controls, makes no older
checkpoint request, and creates no plot or cancellation. Root and independent
Sol strict verification accept the cleaned-up report:
`/private/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-browser-acceptance-oT3kb7/summary.json`
(SHA-256 `6aff8357d8a88f8a14dccfb2c0bb30b5872a909db9a76aed9dcbff0c29ff2e4f`).
The earlier 3zxoVh pilot altered JSON syntax and is only precursor evidence, not
the checksum-only witness.

F04 now adds a metric-bearing SIGKILL matrix after a committed `hello`: both
projection/cursor write orders, each recovered by rebuild and direct ingestion.
All four cases preserve the committed prefix, roll back the interrupted metric,
replay it exactly once with its numeric/null/list values unchanged over public
HTTP SSE and SQLite, and remain stable through three polls and database reopen.
Root's real reports are in `/private/tmp/wavedl-f04-metric-root.XO7kB6`; the strict
four-case CLI accepts them. The original hello-only **33** tests and report
contract remain unchanged; combined hello/metric regression is **66/66**.

Both additions have mandatory CI runners, strict guards and bounded explicit
report uploads; hosted execution is not claimed. Final focused Python checks
pass **212/212** and Node browser-driver/guard checks pass **345/345**; Ruff
lint/format checks pass. No production source or frozen browser asset changed.
This closes these local failure slices, not complete T30c/T38, native
Windows/GPU, real Slurm/filesystem/site or release acceptance.

#### Current automatic-plot authority correction — 2026-10-18

Removed the broad `reportFailure: false` transport escape hatch introduced in
the preceding recovery implementation. Only malformed metadata whose downloaded
bytes match the published size and SHA-256 is a candidate-local failure.
Authentication, daemon identity/protocol changes, truncated streams and checksum
failures retain connection revocation and cannot trigger fallback or plotting.
Four authority/integrity regression cases and an all-partial-publications
refusal case now cover this distinction. Full web validation passes **809 / 1
skipped**, typecheck/lint/format pass, and generated-worker tests pass **38/38**
using the explicit installed `WAVEDL_PYTHON`. Independent Sol review and its
**69** focused tests also pass.

The rebuilt manifest is
`a077fa3d534153c8dfff5874e7bb0f7d9b62075cfc13a0b4fc94195548767eec`.
Clean staged wheel/sdist assets match all 38 source files byte-for-byte, with no
Qt source shipped; the exact wheel passes **3** outside-checkout installed
CLI/runtime checks. These checks do not close complete T30c/T38, external site,
native Windows/GPU, hosted CI or release acceptance.

The fresh a077 bundle's required twelve-case aggregate strict-passes **12/12**
with cleanup at
`/private/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-browser-acceptance-kEo33R/summary.json`
(SHA-256 `1304cc3d0e138ed3b32873aee9e94ba55ca2f70938cf73b3d3c93d88c13c7d2f`).
Two additional optional real-browser cases now prove partial-best recovery and
refusal. The fixture publishes a genuine metadata-only best with a valid
`COMPLETE.json`; responses are unmodified. Fallback pins the older complete
source, completes exactly one plot, and verifies native PNG download bytes and
decoded pixels. Refusal preserves original generations in private fixture
quarantine and proves connected/incomplete guidance, one training plan/run and
no plot/cancellation/late mutation. Both reports pass the independent strict
guard and owned cleanup:

- Fallback: `wavedl-browser-acceptance-3LdvhX/summary.json`, SHA-256
  `6d32285745b49f4a486f5859efb913d2d1614478b47778de9406e43becfdc2cb`.
- Refusal: `wavedl-browser-acceptance-Q42d2i/summary.json`, SHA-256
  `9d2027c9ced2a49d787b1b747ac74ce91cb917821c0af20c949ba2444df68032`.

Both workspaces are under the same temporary parent as the aggregate above.
The optional driver/guard tests pass **36/36**; root's fixture regression passes
**35/35**, and controller/workflow tests pass **41/41**. Initial fallback pilots
L0ibv4 and NnzFud remain failed evidence: their page-side blob fetch was refused
by the app's connection policy. The driver now verifies bytes through native
download and pixels through canvas without weakening CSP. Only this local
partial-generation slice is closed; complete T38/platform/site/release is not.

Both optional cases now have mandatory isolated run/strict-verification steps in
the browser CI lane, symmetric change triggers and explicit summary/case JSON
uploads. The required twelve-case baseline is unchanged. Final focused
workflow/package/static/fixture checks pass **127/127** and the baseline plus
optional driver/guard contracts pass **308/308**. This verifies local CI wiring,
not an executed hosted workflow or release approval.

#### Prior automatic-plot/source recovery — 2026-10-18

The browser controller now verifies that a candidate best publication contains
the required inference state (`model_weights.pth`/equivalent, `training_meta.pkl`
and `scaler.pkl`), skips malformed or partial newer candidates, and uses an
older complete best publication when available. The regression adds this
partial-generation case and passes with the full web suite. The regenerated
current bundle manifest is
`ec7d9feb9e5b39c65f9a9fabfcd477746e1021992d61abb0390dce0d8b1a95ac`; fresh
browser acceptance passes **12/12** against it at
`/private/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-browser-acceptance-85BTji/summary.json`
(SHA-256 `c873b4f07b38e093929f6a39632e39a185edefb95fa2864388e17c763647cf24`).
The web suite now passes **804 / 1 skipped**, with typecheck, lint and format
clean. This remains local macOS/CPU evidence; T30c/T38/platform/site/release
gates remain open.

#### Current authority hardening — 2026-10-17

Latest follow-up: invalid UTF-8 paths now fail with controlled refusals; header
inspection watches HTTP disconnect and cancels/drains its real child; YAML export
reports browser handoff instead of an unverified save. The final focused daemon
suite passes 147 HTTP/authority/catalog/inspection tests, the web suite passes 802 with one skip, and the frozen
`42f5cf8989bd128683715c90ee6b4f8eb4a7280bb175c5cfb479f8a1438517a8`
bundle passes the strict 12-case browser aggregate. See the acceptance ledger's
latest audited source/bundle section for exact reports and dated boundaries.
The current preview-fault and imported-preset authority reports are also
strict-verified there against this same manifest.

Dataset header inspection is now authority-scoped: the HTTP contract requires
`{root, path}`, the daemon resolves that selection through configured browse
roots, and arbitrary authenticated absolute paths are refused. The active
browser sends the same root ID and relative path returned by browse resolution.
The full daemon/core regression after this change is **2,657 passed / 15
skipped**; generated worker checks are **38/38**, and fresh Chromium baseline
and dataset-parity slices both pass. The frozen bundle's twelve-case Chromium
aggregate is strict-verified with all cases passed and cleanup. This is a new-app security correction, not
legacy Qt compatibility or migration work. Full T30c/T38, platform/site and
release validation remain separate gates.

The subsequent CV integrity hardening rejects non-array, malformed-shape,
mismatched-sample, empty-target, non-finite, non-numeric and over-folded inputs
before filesystem or model work. The focused data/CV regression passes **88/88**, and
the supported non-slow/non-GPU Python suite passes **3,680 / 15 skipped / 336
deselected** (JUnit `/private/tmp/wavedl-supported-final-after-cv-dtype-20261017.xml`,
SHA-256 `9ebb530289554d2dc29ffc9b78f011d1f64c23775b504c1edd043dac149d132b`).
This remains local CPU evidence; T30c/T38, platform/site and release gates stay
open.

A fresh `npm run test:browser` rerun passed all **12/12** required current cases
with cleanup, and independent strict verification accepted its summary at
`/private/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-browser-acceptance-24yiyU/summary.json`
(SHA-256 `7cdc59f69d5239db634d3996b3aac05fbceb37b2ab10447530405ba0073941af`)
against the same 42f5 asset manifest. This is same-host browser evidence; the
remote/platform/site and hosted release gates remain open.

#### Earlier staged-index release guard — 2026-10-18 (before source recovery)

The staged index was archived into a fresh temporary tree and built outside the
checkout. The resulting wheel and sdist each contain exactly 38 current web
assets and zero `wavedl_gui`/Qt entries. Ruff check and format check pass; the
browser report verifier passes **272/272** contracts; workflow, headless-scope,
vendor, static-client and installed-web checks pass **112/112**. This is clean
staging evidence only: the dirty checkout's ignored `build/lib` can retain stale
assets, so release builds must use the documented fresh staging tree. No commit,
tag or publication was performed.

Fresh current-source regressions on 2026-10-18 pass **1,814 daemon tests with 9
skips** and **804 web tests with 1 skip**. Workstation TypeScript typecheck,
Oxlint and Oxfmt checks also pass. These remain local macOS/CPU evidence and do
not substitute for the external T30c/T38/T42 gates.

The current packaged-browser history slice also passed at
`/private/tmp/wavedl-history-current-20261018.json` (SHA-256
`e5261717960dcb7db2ac93eb0d40ea95511ae3c34eedecf67f6b71f6948234f3`): a real
daemon journal/SQLite/SSE path delivered **100,000** metric steps to the chart,
all four loss/R²/learning-rate channel views painted, and owned browser,
fixture, listener and workspace cleanup was verified. This controlled local
history slice does not claim ML epochs, supersession, restart, remote, GPU,
Slurm or full T38 coverage.

Dated F05 precursor genuine-browser report C is at
`/private/tmp/wavedl-f05-genuine-browser-20261015-c.json` (SHA-256
`b40c35a30fb48018d6600d46f42f0d774877399d34ed4ff6c66f7647a03f586a`). Root
and independent strict verification passed. It proves
actual capacity-1 `EventBroker` `QueueFull` closure/overflow, unchanged ASGI
frames, two completed CPU attempts, first-stream `[1:0]`, overflow reconnect at
`1:0`, exact journal IDs `1:0..1:7` and `2:0..2:5`, durable cursor/journal
equality, one metric/history step, exact-once DOM diagnostics and cleanup. This
closes F05 only for this local browser slice; live allocation/requeue/Slurm,
browser chunk boundaries, GPU/site and full T30c remain open.

Additive F12 invalid-UTF-8 browser report B is
`/private/tmp/wavedl-f12-final-bundle-20261016.json` (SHA-256
`7c54da68df654e2e16f7632f48b2aa0967a3e3112d52b5d4b55bf925d8ea9249`). Root
and independent strict verification passed. Chrome refused
the malformed control with protocol-skew handling, cleared selection and
credentials, made two requests without retries, and completed durable-cursor
and cleanup checks. This bounded local browser fault does not claim network
chunk-boundary, private post-rejection cursor, attempt-rollover, Slurm/site or
full T30c acceptance.

Current bundle `8d1cd10a744f260d658dd4904244be530bcbceb716cb75230ef4dfd7ffc6ad96`
passes the bounded web suite **793 passed / 1 skipped across 70 files**, with
typecheck/lint/format clean, generated workers **38**, and package/static/headless
checks **112 passed**. Prior bundle reports remain dated evidence only.
The current no-Qt
supported regression (`unit_tests -m 'not slow and not gpu'`) completed with
**3,647 passed / 15 skipped / 336 deselected**, zero failures/errors, in
499.79 seconds. JUnit `/private/tmp/wavedl-full-current8d1-20261016.xml`
(SHA-256 `1a06a0900c89d4904c43c1ffce44dd8298db75075472cb382bdac7773c7f7802`)
audits to 3,662 tests, 15 skips and zero failures/errors. This is a fresh 8d1
supported-suite regression, not all-platform, GPU/site or full T30c/T38
acceptance, and does not authorize release/publishing.

The dated separately configured offline wheelhouse acceptance passes **1/1**
with no skips in 66.31 seconds. It resolves the built wheel into an isolated
environment, checks dependency consistency and all console scripts, exercises
daemon-free CPU training, then verifies bootstrap, authenticated health, bundled
assets and daemon shutdown outside the checkout. No Qt client is installed.

The current bundle has 37 assets. The prior 07e aggregate remains dated evidence:
`/private/tmp/wavedl-final-current-KF0jB2/wavedl-browser-acceptance-1zvROM/summary.json`
(SHA-256 `86888dcc3f07b3b9c5bcd91c007d1be4148234ad81679bca28982ddcfa1ebe49`);
it is not current 8d1 acceptance. Earlier F02/F05/F12/F13/F06 and scoped T38
reports likewise retain their recorded prior-build boundaries.

The current 12-case aggregate strict-passes **12/12**, exact bundle assets and
clean cleanup:
`/private/tmp/wavedl-current-browser-20261016.5w4B27/wavedl-browser-acceptance-KAJsET/summary.json`
(SHA-256 `8f3c52d6b44e23d541e65774374ba02f30b683521cf75700348f1215fc62c289`).
Current auth strict-passes at `/private/tmp/wavedl-auth-8d1-current-20261016.json`
(SHA-256 `9e394805ded2d131990cf8161b3ebc23a6da3027919691e6015fbaf32468e904`).
Combined preference/artifact verifier and cleanup tests pass **76**, including
fail-closed rejection of reports carrying error/skip/failure properties.
These bounded results do not close full T30c/T38, platform/site or release gates.

Additional strict 8d1 reports cover preview identity-mutation/reselection faults (34 Node/95 Python; browser caps/decompression/allocation/Stop variants remain unclaimed), cold
offline shell behavior (39 verifier tests, all cleanup checks), and pending
cancellation (pending/unknown/receipt/lost-ACK/dedup/detach, all cleanup checks):
preview `/private/tmp/wavedl-preview-fault-8d1-current-20261016-1/preview-fault.json`
(SHA-256 `b4b1bba33f3abeed323a189343cdcd43a150f8d0f964feb4f33ed37795b4a289`),
offline `/private/tmp/wavedl-cold-offline-8d1-5.json` (SHA-256
`0ae5e0b2b5bd13a368deb4df3c4b6b2dc22cefba98d6d807321453a3541ed42b`), and
cancellation `/private/tmp/wavedl-pending-cancel-final-current-20261016.json` (SHA-256
`d675bde4adcbed2ce89efe8e3913f38bf67efbc5a518327e0defbc3115ee67e7`).

The final visible-alert catalogue report
`/private/tmp/wavedl-catalogue-native-current8d1-20261016-final/catalogue-fault.json`
(SHA-256 `b90b1f6ac8cf94805f205c6337e66ed66add82ab79f89ee5b864191e15dc36dd`)
strict-passes 32 Node/11 Python checks and all cleanup/storage checks, preserving
six response faults plus native chmod-000 owned-child real-403 and 1001-empty-file
real-503 checks against the service's 1000-entry limit, without production wire
mutation. Unreadable configured roots, remote filesystems, disk ENOSPC and full
T38/T30c/platform/site/release remain unproven. The older six-case report is historical.

Dated prior-07e auth-watermark report `/private/tmp/wavedl-auth-watermark-final-20261016.json` (SHA-256 `c20a9fac9b51616859f38d9ab10eba73520b0015ee46ddcba3680679fc8e4388`) passed its then-current verifier and 42 focused tests for persisted cursor watermarks and the later-open race. It is historical, not current-8d1 recertification; use the strict current auth report above. Model-shape guidance remains implemented and test-covered; full T38/T30c remain open.

Current reconnect report `/private/tmp/wavedl-reconnect-current-Vg8OfT/reconnect.json` (SHA-256 `bfe3b12ea40791a335124339dd2b3675dae685ba6d67f414160ecddebf3cee99`) and sparse report `/private/tmp/wavedl-sparse-current-20261016.json` (SHA-256 `aa8e93eaeb9f36cc3d7d016fd2594806178047b0dc736af74ce9a232d8104506`) strict-pass with cleanup. These are local CPU/current-8d1 slices; Slurm, Windows, GPU, real-site and hosted coverage remain open.

The final pending-cancellation report above passes 35 meaningful portable verifier
checks (positive and mutation cases, including fatal UTF-8 tempfile handling);
workflow checks pass 29. Earlier `pending-cancel-live-20261016-9.json` is historical:
the current verifier rejects its source hash, so it is not current acceptance.

Current-source retained-consent report
`/private/tmp/wavedl-retained-current-consent-20261016-active-draft-3.json`
(SHA-256 `cdc8680886336b71f8a480987fee0667ae1728a3923b2111802ad0e3f8c932ae`)
and fixture summary
`/private/tmp/wavedl-retained-current-consent-20261016-builds-1/summary.json`
(SHA-256 `bb2209db7b99df8e2dbe1a01f0e11edb0f5db10f8ba6d8f41abd12ec1e152dc4`)
strict-pass all 11 existing stages plus cleanup. Four genuine namespaced QA builds
use the current 641-source snapshot, not package-exact builds; the 37-asset 8d1
package is unchanged. Waiting/defer/approval preserves the active CPU PID,
plan/run and draft value 77, and only the approving tab reloads. This closes the
scoped local current-source consent gate, not full T38/platform/site/release.

Current 8d1 P3/authoring reports below strict-pass within scoped local CPU evidence:

- Wizard `/private/tmp/wavedl-acceptance-p3-20261016-wizard/wizard-progression-browser.json`, SHA-256 `e05b5cd904cb234d78dc77d62526896c6c876f4944f3c7952f4f81a03781af9e`.
- Fields `/private/tmp/wavedl-acceptance-p3-20261016-training-fields-37/training-fields-full.json`, SHA-256 `440787e0786fa7e2438439c4a2051a79c66bf2c173c6cdd79d389e193bdf54cf`; the tooling's stale 38-asset expectation was corrected to 37, without changing the bundle.
- Validation `/private/tmp/wavedl-acceptance-p3-20261016-training-validation/training-validation.json`, SHA-256 `8b8ebb1108b603feb3727d65ae4838b825a5e369d1ee30f17295f5d6fe231d4b`; submitted-plan report SHA-256 `c08c6eaff8e485a2ef01fdd88f335d9c855971887fd3248f300ef2e0b1562dac`.
- Result operations `/private/tmp/wavedl-result-operations-current-20261016/result-operations.json`, SHA-256 `6ce912661b563a646c9edb93fbc1cb9ddbd58ed17cc3610ca0bc69e89ff7c9ac`: CPU evaluation, unsupported-opset refusal and draft revocation.
- Numerical failure `/private/tmp/wavedl-numerical-current8d1-final-20261016/numerical-failure.json`, SHA-256 `7362e01289b6bd4c6f2cedad2da9569688cbbf2a827054dc3ce30f6e7f851e6f`: strict-passes after frozen changes with current source/assets/harness; scope is local CPU NaN/Inf/empty refusal and durable exits, not GPU/Windows/Slurm/site/release.
- Mapped autoplot `/private/tmp/wavedl-current8d1-mapped-autoplot-20261016.T2C3Sc/report/mapped-autoplot.json`, SHA-256 `843494bc0250c5c0bcc2a89bab3c142984964282845dd34725ed8d6e2485749b`: scheduler is simulated, not Slurm/site evidence.
- Inference cancellation `/private/tmp/wavedl-current8d1-inference-cancellation-20261016.fKWPct/report/inference-cancellation.json`, SHA-256 `f985c95f32ec15936635a738f113f256414186dbed1503fd4192264308f6ee9d`, with 60 verifier tests.

These do not establish GPU/Windows/Slurm/real-site/hosted acceptance or full
T30c/T38/release sign-off; earlier reports retain their dated build boundaries.

Current 8d1 ONNX and CV also strict-pass, with 45 verifier tests, full cleanup
and absent native PIDs. ONNX report
`/private/tmp/wavedl-current8d1-onnx-20261016.p3bWK8/report/onnx-export.json`
(SHA-256 `34f6e0fa23565b54faf19cb8191e1966709e4ca72936a41ae84dd259de4f62ac`)
verifies the 2,808,632-byte opset-17 artifact with checker and ORT CPU allclose
(max absolute error 4.0978e-8, shape `[1,1]`). CV report
`/private/tmp/wavedl-current8d1-cv-20261016.Ihq2Q0/report/cv-parity.json`
(SHA-256 `bf18d289dca2d964a27d2544630adc89879a549444fbdff60d7509c2d1ac2889`)
covers deterministic two-fold/one-epoch execution, fold-2 evaluation of 96 rows,
summary refusal, no arbitrary autoplot and exactly two plans/runs. These are
same-host CPU slices, not GPU/remote/Slurm/site/release certification.

Current browser fixes add BrowseContainer/ModelSelector scope-revocation guidance
and reload catalogue state after reconnect. WorkstationController derives `useHead`
language reactively; preference recovery preserves Vietnamese settings rather than
overwriting them with English. Strict preference report:
`/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-preferences-browser-rYqtC8/preferences-browser.json`
(SHA-256 `598d3f902763565e8bb394fa6ae7073107773829bba7100918196b3be959b10a`).
Strict artifact-safety report:
`/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-artifact-publication-HPt33u/artifact-publication-oversized-inventory.json`
(SHA-256 `7722cace14085f92c19a4edc2870cf75d28c35468faf734ab042de320cbaf86d`).
The bounded 100k report is `/private/tmp/wavedl-100k-8d1-current-20261016.json`
(SHA-256 `af6bd2888afdba5e63457ecd79cd8f07f2aa4a452cf8275102cb90c4819f2272`);
supersession strict-passes at
`/private/tmp/wavedl-supersession-8d1-current-20261016.json` (SHA-256
`b4d98f97b9ab8b9f97024eac67d2bcd4c4217b9c7f94ad9a7d29b19e070a18ed`).

Dated prior-bundle T38 evidence (manifest `5cc50573913b47481da55400fe81e28c08ffed81269d2811824c76b7493fea40`) now covers scoped rows 17, 21 and 24. Row 17 mapped autoplot report `/private/tmp/wavedl-t38-row17-ge0D9P/mapped-autoplot.json` (SHA-256 `8f36e0876a8724d02ac40e9b73f6de93e11ea857138e93f9f3394b8c32d07137`) passes 34 Node contracts and 6 Python checks with exact raster/ACK retry and no duplicate; scheduler behavior is simulated. Row 21 auth-skew report `/tmp/wavedl-t38-auth-skew-report-1792074108.json` (SHA-256 `8ff640c04fb56483f2d47386b41cd37bb51a24816fca5acbe5fab22c2bd98c98`) passes 23 tests and cleanup. Row 24 standalone adoption main `/tmp/wavedl-t38-adoption-main.Qa84Dg/standalone-adoption.json` (SHA-256 `604ec14150e20515ebdfa1f2063e037f734a9efcb27c8909da7fcc85ee139bcc`), negative `/private/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-adoption-negative-OudGRg/standalone-adoption-negative.json` (SHA-256 `7c5b0ab8bf6fdf901bc9c509a8948817fa8ddf1b0a5e6ff5a47d6f289f54ccbd`) and rollover `/tmp/wavedl-t38-adoption-rollover.vZCYUv/standalone-adoption-rollover.json` (SHA-256 `9d5b9a20a43e46ef7d0b5e6448f226ee59f16f2e955cb500c687a4d1927c7180`) all strict-pass with cleanup. These close only scoped local owned-fault variants; remote re-adoption, private cursor, real-site and remaining T38 variants stay open.

Dated prior-bundle expanded T38 authoring evidence (manifest `5cc50573913b47481da55400fe81e28c08ffed81269d2811824c76b7493fea40`) is strict-verified with zero cleanup errors and clean Python: parent `/private/tmp/wavedl-expanded-authoring-final-Qo7aqm`, wizard SHA `f95523b9dc1db7e9d106fe88bd15c951b047b1d183da859550f08acc3722022f`, fields SHA `3bcaceb5f33a97b4d940e5b566f505430dcf31f401907f5a53b7c7e0978c33eb`, validation SHA `0a4abe30ba22a934e3229afac5ac3bcee24c52f224239b2c331c2d57a52fa293`, and submitted SHA `d7050687c19d3736d7d571708158ed67326599ba20e5a030f5d00eb1f76d5866`. These close only the scoped authoring rows/variants; remaining T38 rows, T30c, platform/site and release gates remain open.
Dated prior-bundle F06 read-only/quota reports are `/private/tmp/storage-fault-readonly-final-20261015.json` (SHA-256 `1c992002bec91bc4a8d6415c7a67de10bcd62944251dc5f277348f5a1fcc09cb`) and `/private/tmp/storage-fault-quota-final-20261015.json` (SHA-256 `152549ccb455749e0592f3bf8a962a02bf594e630f9afdb2417582e01349d2d5`). F12 uses the final fixture splitBytes fix.


Current F01 crash-recovery evidence covers six genuine SIGKILL cases in
`unit_tests/daemon/test_submission_http_crash_recovery.py`: durable intent,
claim, acceptance-before-receipt with unique/missing/ambiguous recovery, and
durable receipt before response acknowledgement. Repeated requests and two
same-database reopens never duplicate acceptance. JUnit
`/private/tmp/wavedl-f01-sixcuts-only-20261015.xml` has SHA-256
`7bb4a9b4d33aa645483d317e557def9e5f25f611236466d268c2117a98e8a19a`.
CI requires those exact six case identities with no skips. This controlled
scheduler/ASGI evidence is not real Slurm or full T30c/site acceptance.

Prior-bundle recertification adds strict-passed F02 journal-fault evidence at
`/private/tmp/wavedl-f02-final-20261015.json` (SHA-256
`53c397703981964e5ec86941443baa563280fedef2d5a2b20cbc5eae41725a60`) and F05
genuine-overflow evidence at
`/private/tmp/wavedl-f05-final-20261015.json` (SHA-256
`5c19115f786240967ecc88f96007441be4909f9158bf324a5c34d08c56e09149`). The
dated prior-bundle 12-case aggregate is
`/private/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-browser-acceptance-nPthdn/summary.json`
(SHA-256 `16f858c01ddb7ec07b7650911038ab09ec533dd09e823a5710234be8f9ddb614`);
`verifySummary` passed against its recorded prior manifest. Prior F13 recertification at
`/private/tmp/wavedl-f13-final-20261015.json` (SHA-256
`ea56f9d7ba660055c591e9c22b7e74ae799de79a940b8c217ba4ed8436ded3e8`) passed
the unchanged strict verifier with its recorded prior manifest and all cleanup checks
true. Its same-host/loopback scope does not certify remote/site or full F13.
No full T30c, T38 or release completion is claimed.

#### Dated F02/F13 evidence — 2026-10-15 (7b1c baseline)

The following evidence predates the new-app bundle above and retains its
original tested boundary; it is not current-bundle recertification.

Actual macOS Chrome 150 F13 report C
`/private/tmp/wavedl-f13-hostile-browser-20261015-c.json` (SHA-256
`bdffa181eea30c45f55b33a2d0cb4136bfff7218eb60b00c0a1a8f898d860acb`)
passes root and independent unchanged strict file guards. A second loopback-port browser page
gets 403 for real simple GET/bodyless fetch POST/native form POST with cookie but
no authorization, and OPTIONS 403 for JSON/Authorization fetch without POST/CORS
grant. Cookie-only browser navigation gets 401. Seven sanitized wire receipts and
DOM observations agree; SQLite attack state is unchanged before legitimate Node
GET 200/cancel 202 changes `cancellation_requested` 0→1 and creates a pending
submission-control row, with no executions/ML.
All 38 assets are unchanged; browser session, both listeners, drained services,
SIGINT fixture and temporary workspace/profile/token cleanup are verified.
A's invalid positive-query and B's verifier daemon-ID schema failures remain
failed evidence. Combined root checks pass Node 175 and Python 241/0 skips
(`/private/tmp/wavedl-f02-f13-cli-validation-20261015.xml`), including CLI 39 with
nine new dependency-free help/invalid-secret tests. F13 CI is configured, not
remotely executed. Independent final review confirms the report/hash, actual
ENOENT for workspace/root/profile/token, both ports' ECONNREFUSED and reviewed
mandatory/always-run CI ordering/allowlist with 11 passing workflow tests. This local Chrome
loopback slice does not certify DNS rebinding, nonloopback/remote/site/cross-browser,
full F13 or T30c/T38.

Native agent-browser/HeadlessChrome 150 B evidence at
`/private/tmp/wavedl-f02-browser-20261015-b.json` (SHA-256
`c80fea6e439bc30c8f0252798ad525b6e22f5fbf73fff9ea23908e54f3b03cb1`) passes
root and independent strict file verification. Four controlled phases (damage,
live-reader eviction/bookmark restore, append torn suffix, repeat submit/stable-owner
laps) cover torn-tail, abandoned-tail, oversized-line and oversized-tail with 32
distinct DOM observations. Only torn-tail is `completed` after append; the other
three faults stay `terminal_unknown`/uncertain/no-metrics. The
38-asset inventory is unchanged and cleanup proves absent browser session,
listener refusal, fixture exit 0, drained services, and removed workspace/profile/
token. The fixture has a controlled terminal numerical supervisor/pid plus genuine Local
submission/startup/HELLO/journal bytes/SQLite/HTTP/SSE, but is not ML,
native-process, shared-filesystem/site or full-F02 certification. Initial A remains
failed on its immediate cleanup check; the bounded-poll correction is unit-covered.
Current Node runner/verifier/actions/launch pass 111 (74 F02, 37 actions/launch);
Python passes 65/0 skipped (29 fixture, 4 hosted, 24 reader, 8 workflow) at
`/private/tmp/wavedl-f02-ci-python-20261015.xml`; Ruff 0.14.10 is clean. Reviewed
CI wiring covers all six scoped paths on push/PR, mandatory fixture/Node checks,
always-run browser/strict-file verification and allowlisted artifact upload.
CI is configured, not remotely executed. The 3,883
Python/751-web/12-browser/package totals remain dated product-baseline evidence;
these tooling-only changes did not trigger a full regression rerun. Full
T30c/T38, Windows/GPU/site/hosted-release gates remain open.

### Current implementation/evidence status — 2026-10-14 (7b1c; local acceptance passed)

Current generated/vendored client inventory:
`7b1c164f0b9e05d1f3eaffa81c66fcbcaad9580e83f9899085ff51530119b5bc`
(38 assets); eece output is retained at `web/.vendor-backups/backup-gcan1hmm`.
The form now distinguishes definite plan-preview HTTP 400 refusal from uncertain
submission/status outcomes, carrying only sanitized numeric HTTP status across
the session boundary. Draft selections/values and stale-response fences remain
unchanged. Independent review passes 105 focused tests; full web tests pass 751,
typecheck/lint/format pass, generated-worker checks pass 38.

Actual mounted invalid-authoring acceptance now proves 12 field failures and
corrections without planning arrivals, three genuine runtime-policy HTTP 400s,
one corrected persisted preview with no execution, exact 46-field authoring plus
the daemon's managed output path, unchanged assets and owned cleanup. The strict
report guard passes 94 contracts. F04 local POSIX recovery also covers both
projection/cursor write orders with rebuild and missing-row ingestion after an
actual SIGKILL; its 33 tests and four reports pass. This ASGI/controlled-backend
slice is not native Windows, metric-event or real-site proof. CI requires these
additive slices without weakening existing cases. The frozen Python regression
passes **3,883 / 14 skipped / 336 slow/GPU deselected**, zero failures/errors and
all 427 source/test Python hashes unchanged. Exact current runtime-package
acceptance passes 1/1 with zero skips/errors; original browser recertification
passes **12/12** with exact assets and independently verified cleanup. Full
T30c/T38/platform/site/hosted/release
and Qt-retirement requirements remain unwaived.

### Historical implementation/evidence status — 2026-10-14 (eece; local acceptance passed)

Current generated/vendored client inventory:
`eecefbd5b13c587b2ee1951c91b7b186851ad62707cd201e0efc3a84bde5a835`
(38 assets); prior 58d4 is retained at `web/.vendor-backups/backup-upr2a97b`.
Deterministic CV now scopes RNG/backend state and seeds spawned workers; actual
CPU repeatability and CLI fold publication pass. The warn-only policy matches
ordinary training, not universal GPU bitwise guarantees. Auto-worker CV probes
task-owned shared memory and falls back to zero on denial, preserving explicit
worker choices. CV dependent Nesterov/SGD/momentum and plateau-factor validation
matches browser fields and fails before plan persistence. Other unsupported
CV resume/save/fresh/compile/tracking choices remain explicitly refused.

Current focused evidence: 98 CV/data cases, 158 contract/planning cases, 736
frontend tests, 38 generated-worker cases, 16 mandatory workflow guards and
74 browser action/CV guards. Actual browser deterministic two-fold training,
explicit fold evaluation, prediction download integrity and cleanup pass against
eece. Normal-training OneCycle now budgets post-shard optimizer updates and
suppresses duplicate world-size advancement and overflow-skipped steps. Seven
focused cases pass, including actual CPU/two-rank training and normal/emergency
resume; the scaler-skip case is controlled CPU evidence, not GPU acceptance.
Fresh frozen regression passes **3,833 / 14 skipped / 336 slow/GPU deselected**,
zero failures/errors and all 425 Python source/test hashes unchanged. Current
runtime package and strict source-bound epoch/CV browser checks pass; the original
twelve-scenario browser recertification passes **12/12**, with exact asset identity
and independently verified cleanup. The earlier
3,825-pass overlapping run and pre-OneCycle package/epoch certificates retain
their historical source boundary.
See the acceptance ledger for exact reports. Full T30c/T38, native/platform/site,
hosted CI, release and Qt-retirement requirements remain unwaived.

### Historical implementation/evidence status — 2026-10-14 (58d4)

The current generated/vendored client inventory is
`58d4762e5fd6e4b22feb07c2d75d8fb3e7f545d65f95ae4930463925557d4897`
(38 assets); the former 5864 output is retained in
`web/.vendor-backups/backup-osaziadr`. CV planning now refuses one-fold and
unsupported nondefault resume/save/fresh/deterministic/compile/tracking options
before persistence, while retaining cache validation as inapplicable to direct
source reads. Browser field validation mirrors the Python keys; preferences and
presets preserve editable drafts but refined plans reject incompatible CV values.
Current checks include 155 Python contract/planning tests, 114 combined CV/data/
core cases, 711 frontend tests with Python export integration, 41 browser-tool
contracts, typecheck/lint/format and a strict current epoch browser report.
These are not full T38, hosted, native Windows/GPU/site, release or Qt-retirement
certificates.

The fresh current 58d4 regression passes **3,764 / 14 skipped / 336 slow/GPU
deselected**, zero failures/errors and all 421 source/test Python hashes stable;
exact current-source package acceptance passes 1/1. Full parity, native/site,
hosted/release and Qt-retirement requirements remain unwaived.

### Historical implementation/evidence status — 2026-10-14 (5864)

Cancellation now shares one authority predicate between RunDetail and RunMonitor:
no repeated sending/acknowledged intent, but unknown outcomes remain retryable.
Superseded POST responses still validate immutable run/native ownership; newer
attempt/native state is not overwritten. Poll-confirmed cancellation remains
latched across lost/false delayed responses and later polls. Independent review
passes 49 focused tests. Root passes 683 frontend tests, typecheck/lint/format,
38 generated-worker checks and 97 static/offline/installed-web/vendor checks.
The generated/vendored inventory is
`5864c81a4f691bd504da7bfd9a9956df511f6268a268f9e1134ad7db8f6c34db`
(38 assets); 04b5 output is retained at `web/.vendor-backups/backup-f27_km7z`.
Current browser recertification passes 12/12, the genuine abrupt-restart guard
passes, installed-console acceptance passes 4/4, and the additive CPU
cancellation lost-ACK gate passes with one committed intent and complete cleanup.
Named earlier certificates remain historical. Full T30c/T38,
native/site/hosted/release requirements are unchanged.

The later same-static-bundle runtime correction refuses empty evaluation and
non-finite/wrong-shape predictions before metrics/CSV/publication. Real CPU
inference and three hosted public-HTTP numerical failure cases pass; singleton
metrics and finite results retain their contracts. Current broad Python
regression passes 3,532 with 14 native-platform/storage skips and 336 deselected
slow/GPU cases. The current mounted Results numerical-failure browser gate also
passes NaN/Inf/empty inputs against a genuine published best source, with truthful
failed diagnostics, no result publication, unchanged training bytes and complete
cleanup. This scoped local CPU evidence does not close all P3/T38 variants.

Training producer snapshots now reflect same-epoch best loss and patience;
15 runtime-training tests and 4 actual two-rank CPU DDP tests pass without
changing checkpoint or collective ordering. Release workflow hardening is also
present: hosted release jobs wait for reusable foundation/GUI/browser gates and
publish one freshly generated, vendored and independently hashed wheel/sdist.
Hosted CI and authorized publication remain unexecuted.

The subsequent full Python regression, including the epoch producer and final
release-helper changes, passes **3,551** with **15 skips** and **336 slow/GPU
deselections**. Root verifies zero errors/failures and unchanged hashes for all
412 Python source/test files. Thirteen skips require Windows, one requires an
explicit Linux tmpfs, and one lacked the opt-in install wheelhouse setting. The
last case separately passes **1/1, zero skips** with the configured offline
wheelhouse. Exact report paths/hashes are recorded in the acceptance ledger;
these results do not close T30c/T38/platform/site/release requirements.

The current same-epoch CPU browser gate now independently passes the strict
current-source/asset/report-owned screenshot verifier. First-best loss, patience
0→1→2, early stopping after epoch 3 of seven, journal/DB/history/publication
lineage and complete cleanup agree. Its 64 guard tests and two workflow-wiring
tests pass; the additive CI runner/verifier/screenshots are wired without
weakening the twelve original cases. A task-local matching Chrome headless-shell
avoids the observed macOS screenshot-tool hang; no user browser installation was
changed. The acceptance ledger records exact report and binary hashes. This
stationary CPU slice is not full T35/T38, hosted or platform/site acceptance.

The later CV component correction now honors authored weighted loss, Huber delta,
Nesterov and scheduler options in actual fold training, while malformed HDF5
inputs/options close their handle exactly once. The assembled focused slice
passes **94** with no skips and independent review. Real Linux bounded-tmpfs
ENOSPC/recovery and final exact-sdist rebuild/install also pass; mandatory
zero-skip CI gates are wired, not hosted-run certified. Earlier full-suite and
runtime-bound browser reports predate CV changes; the acceptance ledger records
the fresh post-CV epoch report and final source-distribution evidence. Remaining
CV configuration drops and all original T30c/T38/platform/site/release gates stay
open; this is not complete CV parity or a release authorization.
The frozen post-CV/storage/sdist full regression now passes **3,670 / 14 skipped /
336 deselected**, with zero failures/errors and unchanged hashes for all 417
Python source/test files. Thirteen skips require Windows; the Linux tmpfs case
separately passes in the bounded isolated container. Exact evidence hashes and
the fresh browser/package certificates are in the acceptance ledger.

The subsequent CV semantics implementation honors accumulation, explicit
pretrained selection, CPU BF16 and fold-local physical constraints; unsupported
precision modes fail explicitly. Its 85 CV/data cases pass independently, and the
frozen full regression now passes **3,701 / 14 skipped / 336 slow/GPU deselected**
with all 420 Python source/test hashes unchanged. The first full run's checkpoint
write failure and the passing isolated/two-rank/full retries are separately
preserved in the ledger. Current epoch browser and exact source-package checks
also pass. Remaining CV deterministic/compile/tracking/resume behavior and all
original platform/site/parity/release gates remain open.

### Previous implementation/evidence status — 2026-10-14 (04b5; historical)

Frozen manifest after bounded monitor presentation coalescing:
`04b5126c583e47c78077d8e2595e88c880d2385baf02d95492edf5cc2f93ce5c`.
The vendored package contains 38 verified assets; the previous generated output
is retained at `web/.vendor-backups/backup-x5ifa422`. Every history/cursor commit
remains authoritative; only subscriber notifications are coalesced, with
immediate boundary handling and bounded timer cleanup. Root passes 50 focused
monitor/history/use-runs checks, 661 frontend tests, 96 static/offline/vendor
checks, typecheck/lint/format and 38 generated-worker checks. The current preview
fault gate passes with real 409/503/200/200 responses and child-process cleanup.
The current 100,000-point browser gate passes with exact journal/SQLite/event-log/
cursor and painted-canvas evidence. Preview-fault recertification passes against
04b5; default twelve-case recertification passes 12/12, and same-daemon CPU
detach/reauthentication/fresh replay also passes its strict guard. The
current active-PWA/draft run passes all 11
browser stages after a read-only service-worker query repair reconstructs retained
capacity refusal across cold restart without changing the v1 retained-build schema
or caches. Its strict current-source, frozen-asset and cleanup verifier passes.
The current genuine CPU supersession browser slice also passes: public adoption
replays a verified epoch-1 restore, clears current metrics, then renders resumed
epochs 2 and 3 with the abandoned tail inactive. Source/journal/SSE/projection/
publication/cursor and cleanup evidence agree; staging delivery is explicit and
does not certify real Slurm requeue or native process restart.
The separate reviewed abrupt-restart gate proves genuine POSIX CPU execution,
owned-daemon SIGKILL and same-database public `supervision_lost` recovery without
PID adoption or resubmission. Complete cleanup and 29 verifier contracts pass;
additive CI wiring is checked, not hosted-run certified. Current installed
wheel/console acceptance also passes 4/4 outside the checkout on macOS/CPU.
Original T30c/T38/native/site/release requirements are unchanged.

### Previous implementation/evidence status — 2026-10-13 (8a; historical)

Frozen manifest after the numeric-list blank-entry fix:
`8a87ce6b055280a7c58606f044385614eaed2f7adbc7ba5b2d6183174bec0fa0`.
All 38 packaged assets match the inventory. Root passes 650 frontend tests with
the effective Python export/bootstrap integration enabled; 44 mounted controls
plus catalogue-owned model/data cover all 46 config destinations. YAML sequence
coercion and live-push gap/provenance ordering fixes are implemented and tested.
Current browser recertification passes 12/12; the separate mapped Qt six-case
gate passes with simulated scheduler/copy visibility and actual CPU execution.
Automatic plots pin verified publications and preserve registrations, including
no-output/ONNX-only metadata selection. The later frozen Python run passes 3,476
with 14 skips and 336 slow/GPU tests deselected, including final metadata cleanup.
The current ten-stage dashboard subgate also passes. A separate real-browser
authoring slice verifies 44 mounted controls and 46 persisted configuration
destinations before approval. The mapped-browser automatic-plot slice now passes
real CPU execution, source/import pins, public lost-ACK retry, visible PNG pixel
matching and cleanup, with scheduler/copy visibility explicitly simulated.
Real-site and full-parity gates remain open. Remaining verification continues; the 6a
reports below are historical until rerun. The acceptance ledger retains scope
and remaining T30c/T38/native/site/release requirements without waiver.

### Previous implementation/evidence status — 2026-10-13 (6a; historical)

Frozen web manifest after the guided-validation race fix:
`6a677b78cbb4d5bd87285ea6a9dca4e29892747bc9c76d53120f85b2b9765020`.
Web **626** tests, typecheck/lint/format and **35** generated-worker checks pass.
F02 journal fault coverage adds four cases; **49** focused tests pass (root
rerun **6.79 s**; agent JUnit
`/private/tmp/wavedl-f02-hosted-journal-faults-20261013.xml`).

Current twelve-case browser acceptance passes **12/12** with strict current
asset/cleanup guard at
`/private/tmp/wavedl-browser-current-6a-20261013/wavedl-browser-acceptance-TUbgZl/summary.json`;
Node contracts pass **682/682**. The real wizard report passes strict verification
at `/private/tmp/wavedl-wizard-progression-check-5/wizard-progression-browser.json`;
19 focused wizard contracts also pass.
It covers native double-click, repeated-disabled acknowledgement and preserved
data, not a directly sampled transient validation lock.
Qt automatic-plot retry is implemented: root mandatory GUI passes **29 / zero
skips in 44.25 s**, `/private/tmp/wavedl-gui-mandatory-6a-20261013.xml`, with strict
29-case guard. Public retry-button real-HTTP/export-fault acceptance passes
(agent **14.07 s**); guard/service/dispatch/shutdown checks pass **93 in 3.07 s**,
including uncertainty unwind and late-worker identity fences. Independent Qt
review passes **11 tests with no material findings**. Full non-slow/non-GPU Python
passes **3,425 / 14 skipped / 336 deselected in 472.74 s** at
`/private/tmp/wavedl-clean-python-6a-20261013.xml`. Linux-container foundations
pass **2,364 / 52 skips** (core **783/12**, daemon **1,581/40**, no failures/errors),
with strict native guard accepting **13** required cases; raw reports are in
`/tmp/wavedl-linux-foundations-evidence.BiuG7f/`. The subsequent guard fix passes
**76** adversarial tests separately from that full Python baseline. The actual
Linux CLI guard rerun with `--init` passes and both task-owned containers are
removed. This is LinuxKit aarch64 with
**2 CPU / 4 GiB**, not GPU/Windows/site certification. All b3 records
below are historical unless explicitly rerun against 6a, including the earlier
23-case GUI report, which does not satisfy the expanded guard. T30c/T38,
remote/GPU/Windows/Slurm/site, hosted CI and authorized release/Qt-retirement gates
remain open.

Current-6a CV, supported ONNX and inference-cancellation reports have additionally
passed root's strict verifiers. The [acceptance ledger](2026-10-08-migration-acceptance-ledger.md#current-build-recertification-and-remaining-work--2026-10-13)
records exact paths, interpreter boundaries and remaining requirements. These
local CPU slices do not certify every T38 variant or an installed release.
The later current-6a continuation adds reviewed sparse-stream and ten-stage
dashboard response-boundary acceptance, current standalone adoption and installed
CLI/static checks. Root passes **706** tooling contracts, **627** frontend tests,
**35** generated-worker checks, and current lint/typecheck/format checks. Synthetic
scheduler/native lifecycle inputs are explicitly scoped; real platform/site and
full T30c/T38/release requirements remain unchanged.

### Previous implementation/evidence status — 2026-10-13 (b3; historical)

The following records describe the previous b3 snapshot, not current-6a
recertification.

The current bundle manifest is
`b3c63a860ed01b19e88ec4e8f572416a7cb767e32d889b2b985d5d80b7caabf9`.
Current changes cover visibly bounded diagnostic shortening, accessible focusable
plain-text logs, Qt reconnect dispatch independent of editable-draft validation
but retaining daemon/run identity fences, and publication-crash HTTP recovery.
Diagnostic presentation preserves authoritative events/cursors and surrogate
pairs; terminal/retired workers cannot use reconnect to resubmit an empty draft.
Root's focused reconnect/worker/publication/generation/
artifact command passed **130 tests in 5.08 s** (exact command in the acceptance
ledger); web **623 tests**, typecheck/lint/format and generated-worker **35**
checks pass. The strict stream report
`/private/tmp/wavedl-stream-current-b3-20261013.json` verifies current assets,
fragmented replay/control-cursor resume, rendered diagnostics accessibility and
owned cleanup; it does not establish full browser parity.

The three `os._exit(73)` publication points (partial copy, before marker, after
marker) prove incomplete HTTP generations are refused as 404, prior bytes remain
usable, retry publishes generation 3 and valid after-marker publication is served.
They do not prove power-loss durability or a real site's filesystem behavior.
The full b3 aggregate passed **12/12** with strict current-asset/cleanup guard at
`/private/tmp/wavedl-browser-current-b3-20261013/wavedl-browser-acceptance-B5sAHl/summary.json`.
Full non-slow/non-GPU Python passed **3,414 / 14 skipped / 336 deselected in
455.05 s**, `/private/tmp/wavedl-clean-python-b3-20261013.xml`; mandatory GUI
passed **23 / zero skips in 42.57 s** and its strict guard,
`/private/tmp/wavedl-gui-mandatory-b3-20261013.xml`. Tooling contracts passed
**663**. Current-b3 strict ONNX export and inference cancellation pass at
`/private/tmp/wavedl-onnx-b3-rerun-20261013-report/onnx-export.json` and
`/private/tmp/wavedl-inference-cancel-b3-20261013-current-agent/inference-cancellation.json`.
Reviewed current-b3 CV also passes strict verification at
`/private/tmp/wavedl-cv-b3-reviewed-20261013-report/cv-parity.json` with summary
text, durable plans, exact registry IDs, literal headers, 96 CSV rows and 22
focused tests, limited to local two-fold CPU classification. Full CV/T38 parity
remains open. Current-b3 submitted-plan and artifact reports also pass strict
guards at `/tmp/wavedl-submitted-parent-cnbuaB/report/` and
`/tmp/wavedl-artifact-report-rwwXJC/`.
The new installed GUI probe passed **1/1 in 18.79 s**,
`/private/tmp/wavedl-installed-gui-root-b3-20261013.xml`, on POSIX with inherited
host Qt/dependencies. Windows is explicitly unsupported by this probe; no
isolated GUI resolver acceptance is claimed. Its mandatory POSIX CI step is
added, not remotely executed. Earlier installed T39a **4/4** remains 4d evidence;
earlier installed Qt **1/1** was also a system-site probe.

All dated continuations below describe the build tested at that time. In
particular, 4d twelve-case/submitted-plan/artifact/result-operation/ONNX/cancellation
passes are historical, not current-b3 recertification. T30c/T38, untested
CV/remote/GPU/Windows/Slurm variants, hosted CI, platform/site and authorized
release/Qt-retirement gates remain open.

| Milestone | Ends after | Establishes |
|---|---|---|
| **1A — contracts, storage, supervision** | T13b | Core contracts, storage ownership, migration/recovery, platform supervisors, each with focused failure tests |
| **1B — functioning headless service** | T39a | The daemon works through its public interface with no Qt involved |
| **1C — daemon/browser reliability** | T30c | Cross-component failure evidence; real-site validation before claiming HPC support |
| **2 — browser product** | T38 | All 24 functional capabilities owned and verified |
| **3 — new-app release validation** | T42 | Headless/browser artifacts and supported deployments verified; publishing separately authorized |

Phase 1 keeps both backends. Deferring Slurm was offered and declined: it is
central to the product, and building both early exposes false abstractions in
identity, storage, lifecycle, and topology before the web client depends on
them. Note that **T18a is not Slurm-only** — durable request handling,
cancellation intent, and controller startup are needed for Local too.

### Initial contracts/storage snapshot — 2026-10-01

Completed foundation slices:

- **Shared contracts:** T0, T1, T2, T5, T6, T3, T4, T20a, under
  `src/wavedl/core/`, plus lazy public exports in `src/wavedl/__init__.py`.
- **Storage and registry:** T7a, T8a, T8b, T7b, under
  `src/wavedl_daemon/storage/`.

The task-detail examples were treated as a starting point, not correctness
evidence. Implementation additionally covers numeric overflow and recursion
inside the protocol error boundary, public-export test isolation, real completed
bytes at fsync, root aliases and escaped Linux mount points, Windows lock offsets,
per-batch sequence ordering, numeric attempt ordering, damaged-journal prefixes,
short-read/EOF separation, atomic rebuild failure recovery, manifest operation
recovery, initial schema stamps, future-schema read-only access, and consistent
SQLite WAL backup/restore. Migration callbacks cannot commit outside the runner's
transaction, and schema migration/recovery must acquire dispatch ownership.

`rebuild_from_journals` rebuilds **telemetry projections and cursors only**.
Future submission intents, backend handles, and idempotency records must not be
claimed recoverable from runtime telemetry alone. Damaged attempts retain their
good prefix and bounded diagnostics; storage errors roll back the rebuild.
Existing foreign/unversioned databases are refused rather than imported or
modified. No configured user database was migrated or deleted.

Verified on macOS, Python 3.11.16, pytest 8.3.4, Ruff 0.15.0:

```bash
PYTHONPATH=src python3 -m pytest unit_tests/core --confcutdir=unit_tests/core -q
# 133 passed
PYTHONPATH=src python3 -m pytest unit_tests/daemon --confcutdir=unit_tests/daemon -q
# 67 passed
PYTHONPATH=src python3 -m pytest unit_tests -m "not slow and not gpu" -q
# 622 passed, 336 deselected
ruff check .
ruff format --check .
git diff --check
# all passed
```

A wheel build includes both packages, and fresh `-S` imports outside the checkout
work without loading Torch, NumPy, or Qt. CI's pinned Ruff 0.14.10 was not run.
The existing training/checkpoint producers, CLI commands, and Qt adapters are
unchanged. Existing unrelated GUI worktree edits were preserved.

At this initial snapshot T13a, T22a, T9, T29a, T10, T11, T12, T13b, and CI-1
were still pending. The continuation below records their implementation and
remaining acceptance limits. There is no HTTP service or scheduler submission.

Review follow-ups before their owning slices:

- T18a includes both Local execution (T14) and Slurm submission (T16); its
  controller implementation must satisfy both backends rather than just Slurm.
- The milestone table ends 1C at T30c although T41d is also assigned to 1C;
  its final cleanup/validation ordering must be explicit.
- The architecture spec's cookie/bootstrap and legacy-import text is older than
  T21's no-cookie and T7b's no-import decisions. Reconcile those sections before
  implementing the HTTP/lifecycle tasks.
- Phase 2 rows with unspecified outputs or failure cases need task detail before
  implementation; they are not covered by these foundation gates.
- The local evidence that the legacy DB is unused does not establish that every
  user's database is empty. T41d removes inert code, not existing user data.

### Phase 1A continuation — 2026-10-01

GPT-6.1 Sol agents at medium reasoning implemented separate owned slices in
parallel, with an independent read-only reviewer and root integration review.
No commits, deployment, scheduler submission, or unrelated GUI changes occurred.

| Tasks | Implemented code |
|---|---|
| T13a, T13b | Immutable serializable backend plans/handles, typed observations and independent outcomes, Local train/test/plot planning |
| T22a | Immutable persisted plans, request-bound idempotency, submission/cancellation intent, schema-2 migration |
| T9 | Pure attempt-scoped state reducer with explicit uncertainty, independent runtime/batch/stage-out/publication evidence |
| T29a | Validated budgets, bounded cooperative thread admission, supervised command deadlines, visible storage failures |
| T10 | Nonblocking launcher signal forwarding, normal-flow escalation/reap, selected-interpreter Accelerate invocation, explicit CPU routing |
| T11 | POSIX process-group signalling, bounded continuous output drain, leader-exit descendant cleanup, shared finalization |
| T12 | Suspended Windows spawn, Job assignment before resume, kill-on-close, graceful/force phases, bounded drain and handle cleanup |
| CI-1 | Dependency-light Ubuntu/macOS/Windows matrix on Python 3.11/3.13 with pinned Ruff 0.14.10 |

Review findings were fixed before final validation: Windows leader-exit cleanup
and cancellation deadlines, false explicit-device promises in Local test/plot
plans, nested JSON-key coercion during idempotency checks, and root schema/control
integration. Most importantly, normal startup must not recreate a deleted control
database and issue a new identity for an old request. A durable initialization
marker is now published before creation; missing storage at an initialized path
fails closed. Telemetry recovery may rebuild into a separately chosen location,
but does not authorize recovery of lost idempotency or submission intent.
The marker is an initialization sentinel, not database/backup authentication.

Registry schema 2 upgrades retain telemetry and control data, migrations can
borrow matching live dispatch ownership without releasing it, and telemetry
rebuild never deletes plans/control. Callback and real-process crash boundaries
are tested. Local planning preserves the selected interpreter and refuses
unsupported shapes/topologies/mappings/device promises. CUDA submission must
still verify the allocation in T14; merely naming visible devices does not
certify that hardware exists. Test/plot currently permit only auto device
selection, matching the shipping CLI's behavior.

Final validation on macOS/Python 3.11.16:

```bash
PYTHONPATH=src python3 -m pytest unit_tests/core --confcutdir=unit_tests/core -q
# 133 passed
PYTHONPATH=src python3 -m pytest unit_tests/daemon --confcutdir=unit_tests/daemon -q
# 263 passed, 7 native Windows tests skipped
PYTHONPATH=src python3 -m pytest unit_tests -m "not slow and not gpu" -q
# 818 passed, 7 skipped, 336 deselected
uv tool run --from ruff==0.14.10 ruff check .
uv tool run --from ruff==0.14.10 ruff format --check .
git diff --check
# all passed
```

The native CI matrix YAML was parsed/checked locally but remote jobs were not
executed. A fresh wheel includes all new modules; `-S` imports and standalone
launcher help work outside the checkout without importing Torch, NumPy, Qt, or
Accelerate. This is not T39a's future daemon-console-script acceptance.

**Milestone 1A readiness is not yet certified across platforms.** Native Windows
supervision/durability and native Linux tests still require CI. Windows directory
synchronization retains fail-closed behavior; the available documentation does
not establish its durability guarantee, so native acceptance remains necessary.
See [directory handles](https://learn.microsoft.com/en-us/windows/win32/fileio/obtaining-a-handle-to-a-directory)
and [FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers).
POSIX reaps the direct child and signals inherited process-group descendants;
macOS cannot `waitpid` unrelated orphan grandchildren, which the OS reaps.
Deliberate session escape is outside process-group containment. Python thread
cancellation is cooperative: capacity remains occupied until work actually stops;
noncooperative hard-deadline work must use supervised subprocesses.

Next implementation milestone is 1B: Local/Slurm execution and controllers,
runtime/checkpoint integration, authenticated HTTP APIs, ingestion/streaming,
test/plot execution, daemon/client CLIs, and installed-package gates. No native
platform, shared-filesystem, or real-cluster success is inferred from these
macOS results.

### Phase 1B execution/control continuation — 2026-10-03

GPT-6.1 Sol agents at medium reasoning implemented disjoint backend, storage,
controller, reconciliation, runtime-helper and consumer slices. Initial agent
rate limits were handled by resuming smaller batches. Root integration and an
independent read-only review exercised actual persistence and process boundaries,
not just agent-reported totals. No real scheduler submissions, deployment,
commits, GPU training, or configured user-data migration occurred. Unrelated
dirty GUI files remain untouched.

| Tasks | Implemented scope |
|---|---|
| T14 | Bounded Local execution, selected-interpreter/device probes, owned-handle cancellation, terminal diagnostic release, immutable no-resubmit attempt reservations |
| T15 | Immutable Slurm previews, full UUID binding, mapped paths, explicit resource/topology requests, per-node CUDA probes, independent command receipts |
| T16 | Bounded scheduler commands, durable submission reservation, definite rejection versus unknown acceptance, owner/name/comment/cluster recovery, identity-filtered cancellation |
| T17 | Batched native observations, capabilities, restart identity checks, bounded outcome collection, independent command/batch/stage-out evidence |
| T18a | Schema-3 execution control, transactional claims and cancellation intent, nonblocking controller, startup recovery without automatic ambiguous resubmission |
| T18b | Bounded fleet admission, cross-page evidence retention, capability-aware polling, capped backoff, retention risk and main-thread persistence |
| T19, partial | Standalone/bootstrap and rank-aware `wavedl.journal.RunJournal` helpers; actual launcher/train/test wiring and requeue coordination are still pending |
| T20b, partial | Generation selection and inference consumers; actual training resume, supersession, and Qt plot consumption are still pending |

Schema-3 migration preserves prior telemetry, immutable plans and intent. Runtime
telemetry rebuild never recreates execution claims or handles. Cancellation is
checked inside the claim transaction; cancellation after a claim is delivered
after receipt recovery. A backend's late successful mutation reply is retained
even if its worker deadline expires, and a failed database commit can be replayed
without repeating the external mutation. Scheduler polling persists evidence
before removing terminal handles; Local diagnostics are released only after a
durable terminal observation. Neither wrapper exit zero nor a receipt fabricates
a runtime journal exit or published checkpoint.

Review fixes additionally covered optimized Python bypassing assertion probes,
keyword-only recovery arguments, stale receipts after requeue, one job poisoning
its batch siblings, missing optional accounting comments, real empty-controller
output, cross-page backoff loss, terminal cancellation retry loops, numeric job-ID
reuse, and ambient scheduler options overriding approved plans. Scheduler options
are scrubbed and command timezones fixed to UTC. Slurm scripts use explicit
`--export=NIL`, requiring support at the target site; administrator setup hooks
and the declared runtime environment establish compute-node environment. See
[SchedMD environment precedence and export semantics](https://slurm.schedmd.com/sbatch.html).

A test-run hang was captured with a Python stack: the supervisor worker had
disappeared while a waiter remained blocked. Error finalization now publishes
failure even when pipe cleanup fails, and dead-worker checks prevent indefinite
waits without evidence. Deterministic failure-injection tests and 100 real
timeout/reap stress iterations passed. The exact spontaneous triggering OS
exception was not recovered, so this is evidence for the fixed failure class,
not proof of that original trigger.

Runtime helpers preserve the initial manifest while recording fresh standalone
attempt requests, validate injected effective input against approved values and
an explicit defaults snapshot, require a durable first hello, and isolate rank
logs. File and journal directory entries are synchronized before reporting a
durable handshake. Metadata and abandoned-tail reads reject special files rather
than blocking. Inference selects validated COMPLETE publications in publication
order, uses explicit hash-covered best/periodic/interrupted classification, and
never borrows an old parent scaler for a new generation. Completed emergency
generations remain resumable. Broader inference weight/scaler open-time security
still relies on trusted immutable generation storage until its owning task.

**This is not milestone 1B completion.** Training runtime emission, coordinated
requeue attempts, negotiation, generation-aware training/Qt consumers, normal
and rank-zero emergency producers, authenticated HTTP, ingestion/push/streams,
safe artifact APIs, inspection/browse/models, daemon/client CLIs and installed
console-script gates still remain. Phase 1C, web parity, and release/retirement
have not been substituted with these helper implementations.

Native Linux/Windows, shared-filesystem and real-cluster acceptance remain
unverified. New safe metadata/inventory readers explicitly refuse unsupported
native no-follow/descriptor capabilities; Windows implementations remain needed,
and unsupported access must not silently select stale legacy checkpoints.
Slurm's full-controller snapshot is output-bounded; when it cannot be read,
validated live/accounting evidence may still be used, but controller failure is
not absence and queue-only terminal rows cannot certify restart identity.
Accounting-disabled sites with large controller snapshots or missing retained
identity can therefore remain uncertain. Requeue is currently disabled and an
unexpected restart fails closed until coordinated attempt allocation is wired.

Final local validation of this continuation, macOS/Python 3.11.16:

```bash
PYTHONPATH=src python3 -m pytest unit_tests/core --confcutdir=unit_tests/core -q -o faulthandler_timeout=30
# 216 passed
PYTHONPATH=src python3 -m pytest unit_tests/daemon --confcutdir=unit_tests/daemon -q -o faulthandler_timeout=30
# 454 passed, 7 native Windows tests skipped
PYTHONPATH=src python3 -m pytest unit_tests -m "not slow and not gpu" -q -o faulthandler_timeout=30
# 1092 passed, 7 skipped, 336 deselected
uv tool run --from ruff==0.14.10 ruff check .
uv tool run --from ruff==0.14.10 ruff format --check .
git diff --check
# all passed
```

A fresh wheel build succeeds, and dependency-light execution/controller modules
import outside the checkout with `-S` without Torch, NumPy, Qt or Accelerate.
This remains packaging evidence, not acceptance of future daemon console scripts.

### Phase 1B runtime/checkpoint and security continuation — 2026-10-03

The helper-only limitations in the preceding snapshot are now partly resolved.
Separate GPT-6.1 Sol agents at medium reasoning implemented schema extraction,
runtime training, negotiation, safe native readers, causal metric projection,
HTTP security and bootstrap credentials. Root integration and independent review
checked real callers and then ran actual CPU training. Native tests exposed and
fixed issues that the mock fixtures did not reveal.

| Tasks | Current implementation evidence |
|---|---|
| T19 | Shared dependency-light CLI/YAML resolution, launcher bootstrap before Accelerate, actual train/CV lifecycle events, main-rank journal and follower logs; coordinated Slurm requeue remains pending |
| T19n | First-record enforcement, version/device/interpreter/allocation checks, immutable schema-4 actual provenance, bounded controller probes and RUNNING-only deadlines |
| T20b | Actual generation resume, restored history and supersession; inference and real Qt PlotWorker select published generations while keeping legacy compatibility |
| T20c | Collective normal saves, rank-write quiescence, generation-local metadata/scaler/history, COMPLETE-last publication and artifact announcement |
| T20d | Separate rank-zero-only emergency publication; no save_state, barrier or collective; publication failures remain failed outcomes |
| T21 | Inert Starlette app, authenticated minimal health, strict Host/Origin boundary, header-only Bearer, no cookie authentication or issuance |
| T21b | Bounded hashed single-use bootstrap pool, same-origin exchange, replay/expiry refusal, non-cacheable bearer response, explicit access-log redaction filter |

The initial immutable run manifest remains the approved request; actual runtime
provenance and fresh standalone attempt requests are separate. Ambient environment
secrets are not copied into standalone manifests. Launcher and worker use the
same parser defaults, and worker config extensions must match an explicit defaults
snapshot. No daemon or Qt import is required by standalone training helpers.

Schema 5 adds transactional metric history, branch lineage and independently
verified publication boundaries. New checkpoint selection metadata carries
`source_seq`, the exact source journal cutoff. Supersession applies both step
and sequence boundaries through every source ancestor; live ingestion and numeric
attempt replay have identical active history in delayed same-step tests. Older
generations without that optional field keep step-only compatibility with an
explicit warning. Cursor, run projection and metric projection commit together;
telemetry rebuild never deletes plan, execution or actual-provenance records.

An end-to-end test invokes the real Local backend, launcher, Accelerate and one
CPU training epoch, negotiates/persists its actual hello, observes process exit,
and validates best/periodic generations and projected metrics. A separate actual
two-rank CPU torchrun test verifies one canonical journal, a follower log, both
rank RNG files inventoried and hashed before COMPLETE, and causal publication
cutoffs. This is native macOS CPU evidence, not GPU or multi-node cluster evidence.

The two-rank run exposed Accelerate passing device IDs to CPU barriers; the
installed PyTorch then selected MPS on this host. WaveDL's own CPU waits now use
device-free barriers without framework-global patches. Checkpoints occur after
the epoch scheduler transition; actual resumed scheduler/LR continuity is tested.
Cross-validation stays single-process, uses the actual selected device and emits
lifecycle rather than invented epoch metrics; unsupported distributed CV is
refused at preview.

POSIX supervision now reserves the unreaped leader PID through group cleanup,
using waitid(WNOWAIT) or kqueue NOTE_EXIT rather than an early Popen.poll(). A
Darwin group containing only zombies can return EPERM: a bounded group-scoped
snapshot must prove the owned leader and all members are zombies before that is
accepted as no live work. Other permission errors remain visible. Linux's waitid
path and native Windows still need native execution. Shared safe-file APIs now
include Windows no-follow/reparse-point handling, anchored traversal, bounded
live first-record reads and streaming hashes; mocked Win32 tests are not native
Windows acceptance.

The older cookie-session and legacy-import sections of the architecture spec
have been reconciled with the corrected plan. The optional daemon extra declares
Starlette/Uvicorn; HTTPX is a development dependency. No listener was bound and
no configured credential/data directory, real scheduler, deployment or commit
was changed. Existing dirty GUI changes were preserved; the deliberate GUI edit
is narrowly limited to PlotWorker's generation-aware checkpoint selection.

**Remaining 1B work is still substantial:** coordinated scheduler requeue,
service/lifecycle/adoption APIs, ingestion and live push, resumable delivery,
safe artifact serving, inspection/browse/models, test/plot runtime wiring,
daemon and client CLIs, installed-console acceptance and native/site validation.
HTTP credential filters will be installed by the serve lifecycle; constructing
an app does not mutate process-wide loggers. This continuation does not certify
the headless-service milestone or retire Qt.

Final local validation, macOS/Python 3.11.16:

```bash
PYTHONPATH=src python3 -m pytest unit_tests/core --confcutdir=unit_tests/core -q -o faulthandler_timeout=30
# 353 passed, 2 native Windows tests skipped
PYTHONPATH=src python3 -m pytest unit_tests/daemon --confcutdir=unit_tests/daemon -q -o faulthandler_timeout=30
# 642 passed, 7 native Windows tests skipped
PYTHONPATH=src QT_QPA_PLATFORM=offscreen python3 -m pytest unit_tests -m "not slow and not gpu" -q -o faulthandler_timeout=65
# 1441 passed, 9 skipped, 336 deselected
uv tool run --from ruff==0.14.10 ruff check .
uv tool run --from ruff==0.14.10 ruff format --check .
git diff --check
# all passed; 246 Python files formatted
```

A fresh wheel was inspected/imported outside the checkout: runtime/checkpoint
and control modules load with `-S` without ML/Qt packages; the HTTP factory loads
with its installed optional dependencies without loading ML/Qt, and the wheel
metadata contains the daemon extra. Remote CI, GPU execution and real-cluster
acceptance were not run. Installed daemon/client console scripts are still future
T29/T39 work, not inferred from these package imports.

### Phase 1B service/API and installed-CLI continuation — 2026-10-03

The preceding remaining-work list is historical. This continuation integrates
the headless service, rather than inferring readiness from isolated helpers.
GPT-6.1 Sol agents at medium reasoning implemented focused slices and reviewed
the combined result; root inspected their changes, integrated the real callers,
and independently reran the authoritative checks. A prior agent usage-limit
failure was handled locally; it was not reported as a successful delegated run.

| Tasks | Current implementation evidence |
|---|---|
| T22b | Typed plan/submit/cancel/get/list facade; immutable UUID previews, strict shared defaults and durable idempotent intent; cancellation is not invented termination |
| T22c | Descriptor-anchored standalone verification; original producer request identity, plan/control/execution/provenance registered atomically; adopted Local runs remain supervision-lost |
| T23/T23p | Schema-6 transactional canonical event log, bounded file/push ingestion, commit-before-wakeup, historical adopted attempts, actual loopback live-push acceptance; credentials never enter persisted plans |
| T24 | DB-authoritative resumable SSE, subscription-before-read, bounded pages, capacity refusal before headers and recoverable cursor on overflow/read failure |
| T25 | COMPLETE-inventoried artifacts, retained no-follow handles, same-handle digest validation and streaming; Unicode, spaces and legal URL punctuation; attachment/octet-stream/CSP sandbox |
| T26 | Supervised metadata-only NPZ/NPY/HDF5/MAT inspection, public NumPy headers, bounded validated MAT headers before SciPy; actual cancellation kills the child |
| T27 | Packaged static model metadata without importing Qt/Torch; explicitly allowlisted, anchored, bounded path browsing; metadata is not interpreter capability evidence |
| T28a/T28b | Actual test/plot hello/state/metric/error/exit events, declared device selection, published-generation input and immutable output publication before announcement/completion |
| T29b/T29c | Loopback-only serve CLI, explicit private credential file or ephemeral token/bootstrap exchange, additive request/client CLI with explicit retry key and protocol negotiation |
| T39a | Fresh wheel and real installed console scripts outside the checkout; bootstrap exchange, model catalog, repeat plan-only client calls, SIGTERM shutdown and daemon-free CPU training |

`HostedServices` owns one SQLite/service thread and a shared bounded filesystem
pool. SQL transactions contain no awaits. Audited inspection/adoption/catalog
calls release async exclusivity while awaiting filesystem work, so get/cancel
remain responsive; other calls retain default serialization. Cancellation reaches
the actual inspector child, while admission remains held through real cleanup.
Repeated/concurrent start/close and failed startup cleanly drain resources.
Server cleanup also covers Uvicorn startup/main-loop exceptions and cancellation,
not just normal lifespan shutdown. Existing non-private state roots are refused
without chmod or registry mutation; configured credentials use stricter read and
write confidentiality checks, including handle-based Windows ACL policy.

Schema 6 backfills accepted schema-5 journal rows without applying projections
twice. Event append, cursor advancement and projections commit together. Live
push cannot skip missing sequence positions or suppress later file replay;
historical ingestion cannot change the active runtime negotiation/provenance.
Worker/storage exhaustion is visible and redacted, including SSE setup failures.

MAT inspection validates flags, dimension/name lengths and declared storage
before passing a small metadata snapshot to public SciPy `whosmat`. Compressed
payload inflation is bounded; MAT v4 precision and complex storage are retained.
MAT v7.3 uses HDF5 metadata, including bounded sparse descriptors and MATLAB axis
ordering; dataset payloads are not materialized. This does not change training
loader behavior. Native Windows inspection still needs its platform gate.

The public HTTP CPU workflow now trains one epoch, then runs both test and plot
against its published best checkpoint, observes actual termination, and downloads
published prediction/plot artifacts. Plot tests exclude unavailable host LaTeX
tools; they do not claim an incomplete LaTeX installation works. Standalone
operations targeting an existing training run use isolated child output runs.
The real Qt PlotWorker now selects generations and scans its own isolated plot
output, preserving the existing dirty GUI changes. It still spawns a subprocess:
this compatibility repair is not the Phase 1C HTTP adapter migration.

The installed serve CLI prints a short-lived single-use bootstrap URL, never an
access-token URL. Local runtime push credentials are injected only into the child
environment. Remote HTTP is refused by the client; HTTPS verifies certificates,
redirects/proxies are not used, response framing is bounded and slow-body IO has
an absolute deadline. OS DNS resolution can outlive coroutine cancellation; the
client does not claim to kill a noncooperative resolver. Native installed Windows
console-signal acceptance is separately gated. Uvicorn re-raises SIGTERM after
clean lifespan shutdown, so a signal exit code is not classified as abandonment.

Usage (install the `daemon` extra first):

```bash
wavedl-daemon serve --state-root /private/local/wavedl-state --port 8420
# Optional trusted site config: --slurm-site /private/slurm-site.json
# Slurm also requires a separate shared --run-root, explicit cluster/resources,
# a POSIX scheduler host and the real current user's scheduler identity.
# Optional browse authority: --browse-root datasets=/absolute/datasets
wavedl run --daemon http://127.0.0.1:8420 --request /absolute/plan.json \
  --idempotency-key same-key-on-retry --credential-file /private/token --plan-only
# --request contains the typed lifecycle JSON, with absolute selected paths.
# A credential file must match the daemon's explicit --credential-file; otherwise
# obtain the ephemeral bearer through the single-use bootstrap exchange.
```

Static web serving/root bootstrap UI is still T31/T32 work; the current bootstrap
URL is an exchange capability, not a claim that a bundled web client exists.
No real scheduler submission, configured user data migration, deployment, commit,
release or Qt removal was performed. Integration listeners used temporary local
ports and were shut down. Existing unrelated dirty work was preserved.

Local validation, macOS/Python 3.11.16:

```bash
PYTHONPATH=src python3 -m pytest unit_tests/core --confcutdir=unit_tests/core -q
# 483 passed, 3 native Windows tests skipped
PYTHONPATH=src QT_QPA_PLATFORM=offscreen python3 -m pytest unit_tests -m "not slow and not gpu" -q -o faulthandler_timeout=65
# 1779 passed, 10 skipped, 336 deselected
uv tool run --from ruff==0.14.10 ruff check .
uv tool run --from ruff==0.14.10 ruff format --check .
git diff --check
# Full pinned checks passed; installed wheel tests pass outside the checkout.
```

**The overall plan is not complete.** Remaining work includes coordinated Slurm
requeue, bounded/fair monitoring of very large attempt histories, native Linux
and Windows/real shared-filesystem/site acceptance, Qt HTTP adapters and their
cross-component failure harness, downloader-remnant removal, enumerated web
parity/static client, and the release/deprecation/retirement gates. Requeue remains
fail-closed (`--no-requeue` plus nonzero restart refusal): enabling it requires an
immutable writer restart binding and one CAS activation of attempt/handle/history;
neither a journal hello nor a reused scheduler job ID can authorize that transition.
No milestone sign-off is inferred from these macOS tests.

### Bounded replay and scheduler-startup foundation — 2026-10-04

Independent review found that a fleet larger than the retained reader cache could
repeatedly replay only the first batch of a long journal. Committed compact
`JournalBookmark` values now retain the next unread byte boundary, sequence floor,
native file identity and historical hello proof without retaining raw payloads.
Idle reader eviction preserves these bookmarks; only successful SQL commits
advance them. Truncation/replacement is refused, pending UTF-8/torn tails are
reread safely, and bookmark exhaustion is explicit. The configured bound remains
finite (4,096 retained sources by default), not a claim of unlimited fleet size.

Monitoring now admits at most four plans and twelve journal polls per lap,
prioritizes each active attempt, and rotates two historical sources per complete
fleet sweep. A corrupt old journal does not suppress unrelated active delivery.
Authenticated health reports bounded, secret-free monitoring failures and
registered backends; it does not certify runtime capability or scheduler health.

T19 now has a **disabled startup-binding foundation**, not enabled requeue:
`wavedl.core.scheduler_attempt` binds the approved run/request/owner and exact
cluster/job/restart identity to a reserved attempt. It validates the full typed
manifest and real Slurm submission receipt through private anchored handles.
Twenty real local processes consume one immutable binding. Restart zero retains
the explicit daemon reservation; a later restart allocates after any abandoned
gaps rather than assuming `restart_count + 1`. Atomic no-replace publication,
anchored POSIX allocation and follower-owned directory flushes cover the
link-before-fsync boundary. Incomplete claims remain refused after process death;
complete bindings can be consumed idempotently without another reservation.

The helper is POSIX/same-path shared-storage only. Mapped execution paths are
refused pending exact mapping integration. Its timeout bounds rendezvous polling,
not a blocking filesystem syscall: enabling runtime use still needs supervised
execution. Caller-supplied scheduler identity is not native scheduler authority.
The daemon's durable CAS activation, historical execution snapshot, restart-aware
native reconciliation and launcher/wrapper integration remain required before
removing `--no-requeue` or the nonzero-restart refusal. Local process tests do not
establish real shared-filesystem or multi-node behavior.

One existing inference fixture used the checkout's default output directory;
its new telemetry files were identified from their manifest/journal identity and
moved, not deleted, to `/tmp/wavedl-test-run-recovery.dUk8xo`. The fixture now uses
a temporary operation directory and explicit CPU. No user data was moved.
The Qt PlotWorker compatibility fixture also checks its emitted paths point to
its isolated operation output, without changing unrelated dirty GUI edits.

Final assembled validation, including the test-isolation repair:

```bash
PYTHONPATH=src python3 -m pytest unit_tests/core --confcutdir=unit_tests/core -q
# 523 passed, 3 native Windows tests skipped
PYTHONPATH=src python3 -m pytest unit_tests/daemon --confcutdir=unit_tests/daemon -q
# 846 passed, 7 native Windows tests skipped
PYTHONPATH=src QT_QPA_PLATFORM=offscreen python3 -m pytest unit_tests -m "not slow and not gpu" -q -o faulthandler_timeout=65
# 1829 passed, 10 skipped, 336 deselected
uv tool run --from ruff==0.14.10 ruff check .
uv tool run --from ruff==0.14.10 ruff format --check .
git diff --check
# All passed; 295 Python files formatted.
```

The final full run repeated these 1,829 passing tests after moving the accidental
fixtures and left no checkout-root manifest or attempts directory. Installed
wheel tests were rerun after adding scheduler-helper import isolation and clearing
ambient daemon URL/token variables. POSIX-only scheduler coordinator tests are
explicitly skipped on Windows; they do not imply native Windows scheduler support.

The full plan remains active: coordinated requeue activation, platform/site gates,
Qt HTTP adapters, the web parity/build/client work and release/retirement remain.

### Native-verified requeue and independent outcome integration — 2026-10-04

The disabled-foundation statement above is historical. Requeue is now explicitly
opt-in through `SlurmSite.requeue=True` (the serve CLI's trusted Slurm-site JSON
accepts `"requeue": true`). The default still renders `--no-requeue`; approved
plans persist their policy, and both controller and store refuse activation
without the literal boolean approval. No user job was requeued by this work.

The allocation wrapper consumes one private startup binding before launching any
rank, exports the bound attempt to every machine launcher, and writes outcomes
under that same dynamic attempt. Binding/setup failure cannot write a restarted
receipt into the old attempt. Runtime identity now includes the full typed
scheduler binding. Native discovery verifies job/cluster/owner/request/restart
before reading private proof; a journal or push never advances execution state.
The current accounting generation is selected independently from older retained
rows, while ambiguity remains unavailable evidence. Official scheduler behavior
and restart-count semantics were checked against the primary
[sbatch documentation](https://slurm.schedmd.com/sbatch.html).

Schema 7 adds immutable prior-execution snapshots and restart bindings. One CAS
transaction archives the source, activates the matching new handle/attempt,
clears attempt-local observations and cancellation delivery, and preserves
plan-level intent. SQL triggers require matching immutable evidence for that
transition. Exact retries are idempotent; stale/conflicting generations fail.
Old observation/cancel/probe/fleet results are fenced before any result **or error**
can affect the new generation. Old workers remain admitted until actual cleanup;
activation does not acquire the reconciler lock while its worker owns it.

Default provenance reads are active-attempt-only. A new attempt starts with a new
negotiation; an old accepted hello, failed tracker or delayed probe cannot satisfy
or poison it. Capacity is checked before CAS. Terminal restart watches use bounded
filesystem hints before native queries, so unchanged jobs do not introduce a
per-run scheduler-query storm. Active watches take precedence over historical
terminal watches; capacity refusals are observable in authenticated health.

Mapped host/execution paths now require an exact normalized longest-prefix storage
map before either view is accepted. Conflicting roots or an unrelated working
directory are refused. Mirrored temporary directory tests validate declarations,
producer bindings and worker bootstrap from both views; they are not a claim of
real mount coherence. The first attempt remains a daemon reservation consumed by
startup, while requeue attempts are writer-allocated. Reconciling that initial
reservation with the spec's literal writer-allocation wording remains an audit
item; moving initial submission identity outside `attempts/` is not implied done.

Schema 8 stores immutable collected runtime/batch/stage-out outcomes against the
exact active handle. Incomplete observations remain diagnostic, not finalized
receipts. Collection is now part of the actual controller lifecycle; successful
Slurm completion requires independently successful receipts, not only a wrapper
exit. Reads verify the original plan and the current or archived handle, rejecting
foreign/damaged data in read-only recovery too. Native scheduler failure remains
separate from command outcome fields: a valid receipt's successful runtime or
batch phase is not overwritten by a later native failure. The public bounded
`GET /api/runs/{run_id}/attempts` endpoint exposes archived/current provenance and
collections with explicit pagination and byte bounds.

The assembled acceptance test uses real HTTP planning/submission/status/history,
the real Slurm backend and native-identity parser, generated Bash, actual one-epoch
CPU training, journals, checkpoints, SQL activation and SSE. Only scheduler-command
responses are simulated. Two executions of one submitted script produce attempts
1/2, independent hello sequence zero, complete generations, correctly rebound
receipts and preserved old evidence, without a second `sbatch`. A separate actual
stage-out exit 7 reports the run failed while retaining successful runtime evidence.
This is not real Slurm, NFS/Lustre/GPFS, CUDA or multi-node acceptance.

Review also caught credential/environment propagation defects. Batch scripts unset
`SLURM_JWT` before setup/binding/rank launch while keeping it available for scheduler
client authentication, following the primary
[Slurm JWT guidance](https://slurm.schedmd.com/jwt.html). Supervisors now support an
explicit non-inheriting environment: sanitized scheduler/Local environments cannot
silently regain removed ambient variables. Local plans refuse caller-owned launcher
and scheduler identity. Real child-process tests cover these boundaries; native
Windows forwarding remains separately gated despite mock coverage.

The full goal remains active. Native/site verification, initial allocation audit,
Qt HTTP adapters, web parity/static client, and release/deprecation/retirement gates
remain. No configured database, real scheduler, release or unrelated dirty GUI
changes were modified. Current local validation is recorded after the final
assembled regression pass below.

Final local validation (macOS/Python 3.11.16):

```bash
PYTHONPATH=src python3 -m pytest unit_tests/core --confcutdir=unit_tests/core -q -o faulthandler_timeout=30
# 531 passed, 3 native Windows tests skipped
PYTHONPATH=src python3 -m pytest unit_tests/daemon --confcutdir=unit_tests/daemon -q -o faulthandler_timeout=30
# 953 passed, 7 native Windows tests skipped
PYTHONPATH=src QT_QPA_PLATFORM=offscreen python3 -m pytest unit_tests -m "not slow and not gpu" -q -o faulthandler_timeout=65
# 1949 passed, 10 skipped, 336 deselected
uv tool run --from ruff==0.14.10 ruff check .
uv tool run --from ruff==0.14.10 ruff format --check .
git diff --check
# All passed; 303 Python files formatted.
```

The full pass includes newly rebuilt installed-wheel console tests outside the
checkout. Native scheduler field parsing now refuses duplicates and field-name
suffix spoofing rather than overwriting identity fields. No temporary daemon,
training or inference process remains after validation, and no test manifest or
attempts directory was recreated in the checkout.

### Qt HTTP integration and inert-code retirement — 2026-10-04

The existing Qt training, test, plot and dataset-metadata workers now use the
authenticated daemon interface. Frozen requests retain the preview's run/plan
identity, submission key and attempt-aware cursor through reconnects and lost
acknowledgements. A forwarding-port change cannot retarget a selected path or
source run: clients pin the owned backend identity in a request header, which
the daemon rejects before mutation on mismatch or duplication. That identity
survives ordinary daemon restart/token rotation but changes for a replaced
registry/state root. Health and model descriptions remain explicitly separate
from runtime negotiation inside the eventual execution environment.

Thin adapters preserve existing UI signals, structured evaluation and automatic
result plotting. Restored metric history replaces charts and summaries rather
than appending invalidated epochs. Plot requests use the completed training
RunRef and immutable checkpoint selection, not a local `best_checkpoint` guess.
Approved storage mappings survive consumer requests; manifests now persist the
canonical host roots actually used for rewrites, while execution roots and the
selected interpreter's final symlink remain lexical. Alias/duplicate-map and
foreign working-directory regressions cover that boundary.

Artifact downloads are bounded, hash/size verified, no-follow and no-overwrite,
with anchored publication and temporary-file cleanup. Training chooses a verified
best generation even when it predates many periodic generations. Explicit ONNX
export destinations remain local and are published last, after other requested
downloads verify; failure/retry does not publish an export prematurely or submit
a second operation. Failed client delivery remains distinguishable from remote
execution failure. Raster display forces PNG decoding and dimension/pixel bounds;
server-provided labels are plain text.

Connection preferences store a credential-file location, never its token. Dataset
browse resolves authenticated, contained daemon-side selections with explicit
identity and path realm. Metadata inspection shares the actual loader's key
priority and does not fabricate file size or load arrays in the Qt inspection
worker. The existing **interactive numerical dataset previews remain same-host
only**; remote selection clears them. Local hardware is labelled "This computer"
and cannot certify a remote allocation. Daemon model metadata is fetched off the
UI thread; unavailable catalogues retain explicitly unverified offline choices,
and recommendations no longer probe client GPUs as remote evidence.

One-shot network workers are retained independently of requesting widgets, stop
their actual socket waits, and ignore stale responses. Cancellation uses
`asyncio.timeout` rather than the Python 3.11 `wait_for` ready/cancel race.
Dataset preview replacement/clear uses cooperative cancellation, not native
QThread termination or a blocking UI wait. Quit detaches monitoring, sends no
remote cancellation, prevents shutdown-time auto-plot/new work, and keeps the
event loop alive until frontend threads finish. Context-bound layout timers
cannot call deleted widgets. Non-cooperative DNS/native filesystem work is not
claimed forcibly cancellable; retention continues until actual work unwinds.

**T41d is implemented:** 20 tracked source files (1,266 lines) from the inert
downloader database, speed badge and download/speed services were removed, and
MainWindow no longer starts SQL infrastructure. Existing user database files are
preserved. Isolated actual MainWindow startup/destruction tests cover both an
absent database and an existing SQLite file whose bytes must remain unchanged.
macOS offscreen tests bypass only native Cocoa titlebar integration; they do not
certify native desktop chrome. The deleted code remains recoverable through Git.

A genuine Qt/public-HTTP acceptance test runs actual CPU training, inference and
plot generation through the daemon, checks structured Qt progress and published
generations, and independently verifies downloaded PNG hashes, sizes and Qt
decoding. It does not mock training or runtime execution. It also verifies that
the GUI main/network-worker threads do not launch runtime subprocesses; the
daemon backend does. A partial TeX executable installation now falls back to
ordinary plotting fonts when the Agg pipeline lacks `latex` or `dvipng`, following
[Matplotlib's rendering requirements](https://matplotlib.org/3.10.0/users/explain/text/usetex.html).
Installed TeX package compatibility is not inferred merely from executable names.

Ordinary native Qt Quit events now pass through the asynchronous frontend drain
coordinator; forced OS termination is outside that guarantee. The installed
`wavedl-gui` console target now resolves to a real lazy `main()` rather than a
top-level event loop with no exported entry function. Import and `--help` do not
start Qt or load numerical/GUI dependencies, and launch arguments and the
existing preference-path resolution order are preserved.

Wheel acceptance now builds from an isolated clean source staging tree and checks
the exact adapter inventory plus absence of retired downloader modules and local
`AppData`. Review found that an old setuptools `build/lib` directory can retain
deleted modules; the checkout's generated build output was preserved, not
deleted. Release builds must use a clean checkout/staging tree. Packaging excludes
the retired namespaces and local application data as well.

[P0 web-client parity](2026-10-04-web-client-parity.md) now enumerates capability
owners, failure tests and the missing bounded daemon data-visualisation contract
before web implementation. It is not T38 parity sign-off. Full T30c §16 failure
coverage, native Linux/Windows process/GPU checks, real-site Slurm/shared-storage
acceptance, initial attempt-allocation redesign, Phase 2 implementation/browser
gates and authorised release/deprecation/retirement remain open. No real cluster,
release, configured user database or unrelated staged GUI work was modified.

The [initial-allocation audit](2026-10-04-initial-attempt-allocation-audit.md)
records the remaining dependency chain: new submissions need a durable namespace
and native receipt independent of a runtime attempt, including outcomes from
setup failures before any writer starts. Existing plan/request identities can
remain unchanged; old plans require an explicit compatibility path.

Final local validation after integration, shutdown, packaging and entrypoint
review (macOS/Python 3.11.16):

```bash
PYTHONPATH=src python3 -m pytest unit_tests/core --confcutdir=unit_tests/core -q -o faulthandler_timeout=30
# 559 passed, 3 native Windows skips
PYTHONPATH=src python3 -m pytest unit_tests/daemon --confcutdir=unit_tests/daemon -q -o faulthandler_timeout=30
# 984 passed, 7 native Windows skips
PYTHONPATH=src QT_QPA_PLATFORM=offscreen python3 -m pytest unit_tests -m "not slow and not gpu" -q -o faulthandler_timeout=65
# 2206 passed, 10 skipped, 336 deselected, 155.78 seconds
PYTHONPATH=src python3 -m pytest unit_tests/daemon/test_installed_cli.py --confcutdir=unit_tests/daemon -q
# 3 passed, with a clean staged wheel outside the checkout
uv tool run --from ruff==0.14.10 ruff check .
uv tool run --from ruff==0.14.10 ruff format --check .
git diff --check
# All passed; 308 Python files formatted.
```

The direct socket-detach regression also passed ten consecutive repetitions
(health/poll/SSE cases). A cancellation before reading a response can close TCP
with reset rather than EOF; the core test accepts either actual closure, not a
timing delay as proof. Some isolated Qt processes emit library-wrapper GC
ResourceWarnings; no test failure, active frontend thread or temporary training
process was left by the final pass. No test manifest/attempts directory was
recreated in the checkout. Native/site and slow/GPU gates remain unverified.

### Initial writer allocation continuation — 2026-10-05

The preceding allocation audit is now historical. Explicit writer mode spans the
approved plan, immutable submission namespace, native receipt, runtime bootstrap,
initial-binding CAS, fleet reconciliation, public views and ingestion. Legacy
reserved plans remain byte-compatible and are not rewritten on upgrade. Current
production preview defaults remain reserved until the remaining writer gates
are verified; this is not a claim that the allocation redesign is fully closed.

Schema 9 separates unbound native submission control from positive runtime
execution and preserves immutable initial activation proof. Schema 10 retains
independent pre-runtime batch/stage-out collections without creating an attempt
or runtime exit. Forward migrations preserve legacy evidence with backups and
read-only recovery. Both Local startup and generated Slurm wrappers allocate
their first numeric attempt at runtime; full native identity, approved plan and
manifest hashes authorize activation, not hello events, filesystem hints or a
persisted PID.

Reviewed integration includes lost-supervision refusal, cancellation while
unbound, retained observations when startup proof fails, bounded mixed native
fleet polling, stale worker fencing, and first discovery after an approved native
restart. Actual CPU tests execute Local training and generated Bash initial/
requeue wrappers. Setup failure before allocation publishes independent native
outcomes with unknown runtime. These simulated scheduler fixtures do not certify
a real Slurm cluster or shared filesystem.

One remaining failure boundary is explicitly fail-closed: if native restart 2
fails setup before initial activation, its outcome cannot be finalized against
the immutable ACK-0 receipt. A typed native-generation collection contract is
still needed. Public HTTP staging acceptance now executes actual CPU training
through plan, attemptless submit, verified activation, provenance, actual SSE
replay and hash-verified checkpoint download; daemon allocation is forbidden
throughout that test. Full test/plot/multi-rank and failure-boundary parity are
still required before enabling writer mode in default previews. See the updated
[allocation audit](2026-10-04-initial-attempt-allocation-audit.md).

Independent review also found a Darwin fast-exit race: the child may become a
zombie before kqueue registration. ESRCH now proceeds only after bounded proof
that the owned, unreaped leader is a zombie; process-group identity remains
reserved through descendant cleanup and pipe draining. Deterministic tests cover
exit 0/7, SIGTERM-ignoring descendants and refusal without terminal proof. The
47-test POSIX suite and five repeated eight-case fast-exit/race runs passed.

Native Linux/Windows and real-site T30c acceptance, remote numerical data
previews, actual Phase 2 web implementation and browser gates, and authorized R1
release before Qt retirement remain open. The objective has not been narrowed
to these foundations and has not been marked complete.

Final validation of this continuation on macOS/Python 3.11.16:

```bash
PYTHONPATH=src python3 -m pytest unit_tests/core --confcutdir=unit_tests/core -q -o faulthandler_timeout=30
# 725 passed, 6 native Windows skips
PYTHONPATH=src python3 -m pytest unit_tests/daemon --confcutdir=unit_tests/daemon -q -o faulthandler_timeout=30
# 1129 passed, 7 native Windows skips
PYTHONPATH=src QT_QPA_PLATFORM=offscreen python3 -m pytest unit_tests -m "not slow and not gpu" -q -o faulthandler_timeout=65
# 2531 passed, 13 skipped, 336 deselected, 200.45 seconds
uv tool run --from ruff==0.14.10 ruff check .
uv tool run --from ruff==0.14.10 ruff format --check .
git diff --check
# All passed; 327 Python files formatted.
```

A clean isolated dependency-light daemon environment, matching the foundation
workflow's dependencies and including pip for wheel acceptance, passed **1120
tests with 12 explicit skips**. The first isolated attempt lacked pip and failed
two wheel fixtures; adding that existing CI prerequisite fixed the environment,
not the package. Real ML-only cases are dependency-gated rather than made to
simulate training. This local dependency check does not certify native Windows
or Linux. The workflow now includes `local_startup.py` in its trigger and checks.
No test-generated manifest, attempt, journal or runtime identity files remain in
the checkout, and no configured user data was deleted or migrated by these tests.

### Generation collection, operation parity and historical lineage — 2026-10-05

The preceding ACK-0/restart-2 collection gap is closed by a typed native proposal
and backed-up schema 11 immutable generation collections. Proposals carry the
full scheduler identity, approved plan/manifest hashes, terminal native evidence,
and independent runtime/batch/stage-out results. An unbound runtime is unknown
with no exit code or signal. Exact-generation reads and source-revision CAS
prevent another generation's outcome from being relabeled. Approved terminal
requeue watches remain batched and bounded; cache scope changes with verified
native identity, and stale fleet/callback evidence is discarded.

Public CPU writer parity executes train, test and plot, consumes immutable
published generations, verifies artifact bytes and hashes, emits real inference
metrics and nine PNG outputs. Actual two-rank CPU training uses supervised
torchrun/Gloo with one startup proof, attempt and journal, rank-specific logs,
and complete checkpoint state from both ranks. The selected interpreter must
provide Gloo for multiprocess CPU dispatch; CPU requests are capped at 64.
These are macOS CPU acceptance results, not GPU/cross-machine/native Windows or
real Slurm certification.

Independent review found that numeric directory enumeration could admit an
unactivated predecessor's metrics and advance replay cursors. Managed historical
ingestion now requires matching durably archived execution lineage. Monitoring
selects current plus at most two fairly rotated archive records on the store
owner thread before filesystem work. Gapped/preexisting journals cannot write
events, metrics, cursors or notifications. Explicit standalone adoption retains
a separate full predecessor verification path, including manifest/request/runtime
identity, canonical initial hello, and retained directory anchors.

Initial activation also rejects a binding older than known-good native identity;
observations are copied only from the binding's exact native generation, with
explicit ACK-0 compatibility for legacy identity-less observations. Storage and
controller regressions prove that native-2 exit evidence cannot be attached to
binding 0 and that stale discovery clears its worker without activating.

Default rollout still has a specific open native-identity invariant. Review
reproduced `RUNNING(native 2) → ERROR(native 3) → untyped ERROR → binding 2`:
known-good lifecycle and latest diagnostic do not provide a durable native
generation high-water mark. The Slurm producer also drops verified identity for
unknown native states. A separate monotonic native-generation head must retain
that proof and fence observation, collection and activation without replacing
earlier known-good lifecycle evidence. This remains executable implementation
work, not a reason to mark the full goal blocked or completed.

Production preview defaults remain reserved until that invariant and rollout
acceptance are verified. Native/site T30c, remote numerical previews, all Phase 2
web/browser work, and release-before-Qt-retirement gates remain open.

Final assembled validation after the activation-generation review fixes
(macOS/Python 3.11.16):

```bash
PYTHONPATH=src python3 -m pytest unit_tests/core --confcutdir=unit_tests/core -q -o faulthandler_timeout=30
# 725 passed, 6 native Windows skips
PYTHONPATH=src QT_QPA_PLATFORM=offscreen python3 -m pytest unit_tests -m "not slow and not gpu" -q -o faulthandler_timeout=65
# 2623 passed, 13 skipped, 336 deselected, 240.66 seconds
uv tool run --from ruff==0.14.10 ruff check .
uv tool run --from ruff==0.14.10 ruff format --check .
git diff --check
# All passed; 334 Python files formatted.
```

No real scheduler jobs, releases or pushes were performed. Existing staged GUI
changes and configured user data were preserved. No test run manifests, journals
or runtime identity files were left in the checkout. Passing local tests does
not resolve the explicitly reproduced native high-water invariant above.
A fresh isolated dependency-light daemon run also passed **1207 tests with 17
explicit dependency/platform skips**; real CPU acceptance is not inferred from
that environment's skipped ML cases.

### Durable native heads, default writer rollout and CV artifacts — 2026-10-05

The native high-water invariant above is now implemented in schema 12. An
immutable per-generation proof ledger retains full scheduler identity separately
from known-good lifecycle and latest diagnostic. ERROR/ABSENT without identity
cannot erase it; unknown native states retain independently verified tuples.
Migration seeds only surviving validated observations, finalized collections and
startup/requeue bindings, with backup and damaged-proof recovery checks. It does
not claim to recover facts old code discarded before upgrade.

Controller source fences, native collection scope, initial/requeue activation,
public attempt evidence and batched poll-cache scope consume that durable head.
Typed requeue discovery also preserves a newer head when a previously bound
runtime has no successor binding yet. A restored daemon cannot treat the older
runtime's success as current-run completion while that newer native generation
awaits proof. Foreign/regressing native replies never advance the head, and
identity-free errors retain polling backoff.

New public daemon previews now explicitly request writer allocation. Existing
idempotency keys replay saved reserved previews byte-for-byte; direct planner
defaults remain reserved for compatibility. A backend ignoring writer mode is
refused before persistence. Public lifecycle, loopback live push, installed CLI,
Qt HTTP, CPU train/test/plot/two-rank and generated Slurm wrapper/requeue/stage-out
acceptance now exercise this default rather than a test-only planning subclass.

CV previously completed without daemon-downloadable results. It now publishes
inference-compatible fold generations and an aggregate summary. Exact expected
fold counts and staged file allowlists exclude stale directories/files. JSON
undefined metrics are null, checkpoint epoch identifies the best restored weights
and separately retains total trained epochs, and partial publication failure
leaves prior completed generations usable without emitting success. CV kinds are
explicit inference choices, never automatic best/optimizer-resume candidates;
explicit optimizer resume is refused instead of silently warm-starting.

Qt uses shared strict classification validation, verifies the captured request's
current fold set and hash-covered summary, exports source-correct paths, and
does not automatically plot an arbitrary CV fold. CV without local export also
retains its immutable mode/source; no synthetic epoch metrics are introduced.

Final local validation after integration:

```bash
PYTHONPATH=src QT_QPA_PLATFORM=offscreen python3 -m pytest unit_tests -m "not slow and not gpu" -q -o faulthandler_timeout=65
# 2728 passed, 13 skipped, 336 deselected, 303.55 seconds
uv tool run --from ruff==0.14.10 ruff check .
uv tool run --from ruff==0.14.10 ruff format --check .
git diff --check
# All passed; 341 Python files formatted.
```

A fresh isolated dependency-light daemon run passed **1288 tests with 22
explicit dependency/platform skips**. This does not certify skipped ML/native
platform behavior. Earlier transitional failures were stale reserved fixtures,
one missing test helper and the writer receipt's new namespace; their scenarios
now use typed startup proof and actual runtime allocation, not fabricated attempt
1 before the runtime starts. No real scheduler jobs, pushes or releases occurred.

The full goal remains active. Remaining local work includes independent
generation collection for setup failure after an earlier runtime already bound,
the complete §16 failure harness, remote numerical data-preview parity and the
actual Phase 2 client/browser gates. Native/site verification and authorized
release-before-Qt-retirement remain independent requirements. These results do
not establish full T30c or overall migration completion.

### Later requeue setup failure and retained runtime history — 2026-10-05

The previously open collection boundary after an earlier bound runtime is now
implemented. Backed-up schema 13 retains current native known/latest lifecycle
separately from immutable native identity proofs and the preceding positive
runtime. Bound native collection fences the active execution revision, exact
native head, immutable ACK/plan/manifest and terminal native proof. It never
rewrites the old runtime handle, journal, provenance, checkpoint or collection.

Current derivation switches to attemptless native evidence before processing old
runtime events, trackers or publications. The public view reports unknown runtime
for that newer allocation; its prior positive attempt remains explicitly labelled
`last_runtime`, not `current`. The sentinel used by the batch wrapper is not a
fabricated runtime exit. Batched native watches can discover a requeue even when
setup fails before any new numeric directory appears.

Historical replay can still tail the registered last-started runtime while a
newer native generation awaits binding. Live push cannot promote it to current
runtime; source/path/lineage is checked before and after reads. Qt retains the
proven RunRef, cursor and metric history, but clears current metric/progress
presentation and emits no stale evaluation result for a native-only failure.
Native identity changes rearm cancellation, including successive pending native
generations without a new positive runtime number.

Two assembled HTTP/generated-Bash/actual-CPU cases first complete runtime 1,
then fail requeue setup with batch exit 9 and independent stage-out 0/7. Both
report the new native failure with runtime unknown, retain all earlier event,
provenance, artifact and collection bytes, and create no attempt-2 journal or
directory. Barrier tests retain a valid old runtime collection as history while
rejecting stale cancellation/native collection callbacks and delayed runtime
collection after authentic replacement activation. These are local scheduler
simulations, not real Slurm/shared-filesystem certification.

The full migration objective remains active: complete §16 harness coverage,
native/site validation, remote numerical previews, Phase 2 web/browser work and
authorised release-before-Qt-retirement remain open. No commits, pushes, releases,
real scheduler submissions or configured-user-data deletion were performed.

Final local regression after schema 13/native-pending integration:

```bash
PYTHONPATH=src QT_QPA_PLATFORM=offscreen python3 -m pytest unit_tests -m "not slow and not gpu" -q -o faulthandler_timeout=65
# 2767 passed, 13 skipped, 336 deselected, 288.63 seconds
uv tool run --from ruff==0.14.10 ruff check .
uv tool run --from ruff==0.14.10 ruff format --check .
git diff --check
# All passed; 348 Python files formatted.
```

The fresh isolated dependency-light daemon run passed **1318 tests with 22
explicit dependency/platform skips**. The actual-CPU/Qt regressions above cover
cases that this light environment skips; neither result certifies another native
platform or a real cluster.

### Bounded daemon dataset previews and failure-gate audit — 2026-10-05

P2's missing numerical backend contract now has an authenticated
`POST /api/datasets/preview` endpoint. Requests are exactly `{root, path, view}`:
the root is configured by the operator (including `--browse-root`), the path is
slash-relative, and view is `distribution`, `sample`, `correlation`, `statistics`,
`scatter`, or `all`. Clients cannot choose arbitrary absolute paths, expressions,
loaders or higher limits. All responses retain the dataset identity and selected
root/path; `/api/datasets/inspect` remains metadata-only.

Authority holds root, ancestry and ordinary-file capabilities through supervised
child execution and checks fingerprints before/after decoding. Numeric imports
stay outside the daemon owner/event loop. Decoder coverage includes NPZ,
MAT-v4/v5/v7.3, HDF5 and `.hdf5`, with training key priority, MATLAB axis handling,
deterministic row sampling, finite-or-null numbers and strict bounded JSON.
Objects, structures, complex/ragged arrays, unsafe links, unsupported HDF filters,
encrypted/traversing archives and compressed expansion fail closed.

The current default ceilings are 64 MiB file/decoded bytes, 8 Mi decoded elements,
512 sampled rows, 65,536 input features, 256 outputs and 16,384 sample-preview
elements. Histograms use at most eight features/32 bins, correlation at most 30
output features, statistics at most 40 inputs, and scatter at most eight inputs.
Output is capped at 1 MiB or a smaller shared command-budget-derived ceiling.
These are explicit initial preview ceilings: a larger valid training dataset can
be refused for preview, rather than being silently materialized without a cap.

Refusal status is explicit: malformed/unauthorised selections 400, changed
identity 409, budget/expansion 413, unsupported numerical content 422, and
admission/deadline failure 503. Cancellation/disconnect cancels and drains the
supervised child. Tests execute real hosted authenticated NPZ/MAT/HDF children,
all selectors, traversal/links, mutation, malformed/ragged input, memory/expansion
caps, cancellation and shared admission. Browser/remote-Qt rendering consumers
are still open; the endpoint alone does not establish interactive P2 parity.

The §16 review mapped existing tests and added a cursor-first SIGKILL transaction
regression. This complements projection-first failure injection but is expressly
helper-level SQLite atomicity evidence, not an assembled runtime/HTTP gate.
Archived native lifecycle fields now round-trip as typed observations, with an
exact persisted/reopened regression. Qt unsupported protocol ranges emit an
explicit mismatch message and do not mutate, submit, advance a cursor or invent
a terminal result.

Still-open concrete gates include extended assembled delayed visibility without
false completion, read-only/storage-exhaustion lifecycle, native Linux/Windows/
GPU full-tree cancellation, a real site's scheduler/filesystem evidence and the
Phase 2 built service-worker `/api/**` exclusion/browser requirements. No real
cluster, release or push was performed; the full objective remains active.

### Remote Qt previews and assembled visibility recovery — 2026-10-05

The remote preview consumer is now implemented, not merely hidden. Authenticated
browse selections retain configured root and slash-relative path alongside daemon
identity. A retained cancellable one-shot worker requests the bounded `all` view,
checks daemon identity before/after the request and fences returned root/path/view.
The existing card renders six bounded server-summary views lazily with interactive
navigation/export; it never reconstructs or opens a remote dataset locally.
Malformed or missing remote selections fail closed rather than falling back to
client-local reads. Same-host legacy numerical plots remain compatible.

Independent review tightened payload shape/finite/index bounds, duplicate sample
refusal, correlation range checks, clear/reload geometry and error-widget cleanup.
All one-shot Qt inspection/model/connection/browse workers now expose a fixed
secret-safe protocol mismatch message for valid unsupported ranges; malformed
responses retain generic refusal without exposing server-controlled text.

The new assembled HostedServices/HTTP visibility harness uses public writer-mode
plan/submit, genuine runtime allocation/startup proof and validated initial
activation. Missing/empty journals across multiple actual owner-pump cycles stay
`terminal_unknown`. Projection-first/cursor-first injected SQLite write failures
and actual `PRAGMA query_only=ON` refusal preserve committed events, cursor and
reader bookmark; authenticated health surfaces the monitoring fault. Restoring
writability replays exactly once and clears the fault. This is local assembled
evidence with a controlled supervisor, not physical storage exhaustion or a
real shared filesystem certification.

The baseline before this latest continuation passed **2,854 tests, 13 skips and
336 slow/GPU deselections** on macOS/Python 3.11.16. New slices are being reviewed
and validated separately before the next authoritative whole-project pass.
README now documents installation of `daemon` plus `gui` extras, private token
creation, two-terminal startup and the actual Settings connection controls.
A real loopback credential-file startup regression passes alongside ephemeral
bootstrap startup; no credentials are printed.

T31 now has safe public static serving and API-excluding SPA fallback, with a
missing-build 503 instead of a fabricated web UI. The specified
`create-nuxt-saas` base+pwa generator produced a provenance-retaining scaffold;
frontend-only static build, real generated-worker tests and T32/T33 typed browser
transport are being implemented. A scaffold is not T38 parity, and Qt continues
to ship. Physical disk-full, native Linux/Windows/GPU, real-site, full browser
parity and authorised release-before-retirement gates remain open.

### Native Linux acceptance and built web foundations — 2026-10-05

A disposable native Linux arm64 container now runs the dependency-light suites
with read-only source and network disconnected after dependency installation.
The final core result is **744 passed, 12 skipped**; daemon **1,399 passed,
33 skipped**. Linux 7.0.14-linuxkit, Python 3.11.17 and SQLite 3.46.1 were recorded.
The actual opt-in 8 MiB tmpfs test fills only a dedicated empty mount, observes
real ENOSPC/SQLite `SQLITE_FULL`, preserves committed telemetry/cursor/bookmark,
surfaces the health fault and verifies exactly-once recovery. The isolated Linux
process-tree/launcher subset also passed 52 cases with ten Darwin-only skips.
Only task-owned containers and temporary files were removed; this is not Windows,
GPU, cross-machine or real Slurm/shared-filesystem acceptance.

Linux exposed a collection-before-fleet race: generation 3 was terminal in the
native lifecycle while the compatibility submission snapshot still described
generation 2. Schema 13 collection now validates exact current native lifecycle
for bound and unbound submissions. Public derivation uses that same head-scoped
evidence and cannot overlay a collection onto another full native identity.
Cached native observations do not churn source revisions, while runtime/backend
freshness and hydration remain preserved. Deterministic public/storage tests and
the fresh Linux full rerun verify this ordering, not a fake-clock timeout increase.

T31 now builds a frontend-only Nuxt static workstation and safely vendors the
verified output into the Python package. Clean installed-wheel checks verify the
exact asset inventory, content hashes, shell CSP, deep GET/HEAD, API separation
and every actual service-worker precache URL. Real browser testing found Nuxt's
extensionless `200`/`404` precache aliases unavailable on the daemon; they are now
excluded without weakening server navigation rules. The installed worker loads
the offline shell while API fetches fail when the daemon is stopped. Browser
update testing verifies a waiting worker remains waiting until explicit action,
and keyboard activation of Update and reload changes control and reloads the page.

T32/T33 have typed bounded same-origin transport/stream foundations with 33 unit
tests. Credentials stay memory-only; bootstrap capability stripping precedes the
first request; health/build/daemon pins fence mutations; immutable plan approvals
belong to one connection. The incremental UTF-8 stream accepts sparse monotonic
attempt/seq tuples, deduplicates replay, refuses ahead control cursors and persists
only after consumer commit. These libraries are not yet wired to the web workflow
UI. The current browser shell honestly reports Not connected with execution
controls unavailable; it is not T38 parity.

The final frontend pipeline passes active app and worker typechecks, scoped
lint/format, 33 transport/stream tests, 13 generated-worker tests, nine safe-vendor
tests and static generation. A local generated-worker command initially selected
a Python interpreter without Starlette; rerunning with the documented explicit
`WAVEDL_PYTHON` verified all 13 tests. CI installs the route-check dependencies in
its selected interpreter. Eleven Node build/dev-tool audit advisories remain
reported; the Python static package contains no Node dependencies. They remain
release-maintenance work, not waived by static deployment.

The final post-foundation macOS whole-project pass is **2,927 passed, 14 skipped,
336 slow/GPU deselections**, in 305.63 seconds. The additional skip is the
explicit Linux-only tmpfs fixture, which passed in native Linux acceptance.
Pinned Ruff 0.14.10 check/format and `git diff --check` pass; 366 Python files
are formatted. The installed static/vendor subset separately passes 22 tests.
Windows/GPU and real-site gates, interactive web parity and authorised
release-before-Qt-retirement remain open. No user release or real scheduler job
was performed; the full goal remains active.

### Interactive workstation and acceptance continuation — 2026-10-08

This continuation supersedes the preceding foundation-only status, not its
historical test results. `web/workstation/components/WorkstationController.vue`
now connects the real daemon session to project planning/approval/submission,
run list/detail/stream monitoring, model/path selection, bounded remote dataset
previews, artifact results, explicit result-operation planning, adoption and
settings. Disconnected/offline state still carries no execution authority;
credentials remain connection-scoped rather than persisted browser preferences.
Component and transport failure tests exercise these consumers, but implementation
is not acceptance of every T38 parity row.

Training controls now include export, presets and guidance; settings distinguish
browser appearance/training preferences from daemon administration and explain
browser-controlled download locations. Dataset consumers render the six bounded
summary views without reopening remote files. Results use immutable artifact
generation/size/hash identity and explicit checkpoint-based evaluation/plot
requests. Evaluation presentation and metric-history consumers have focused
regressions. Full locale parity remains open. The AutoPlot workflow/controller
are now root-wired with explicit retry/disable/status navigation, pagehide/unmount
cleanup and permanent page-local request deduplication. Independent review found
and fixed absent Slurm native evidence and actionable state after invalid capture;
same-request status checks cannot re-arm explicitly disabled workflows.
Dataset header inspection and simultaneous dashboard metrics/health have also
been integrated, with stale/pending guards rather than placeholder values.

The immediately preceding root macOS non-slow/non-GPU validation reports
**2,959 passed, 14 skipped and 336 deselected**. The frontend baseline before
AutoPlot integration reports **31 files / 354 tests passed**. Root real-browser
CPU evaluation produced a **4,548-byte predictions artifact whose downloaded
SHA-256 matched**. Browser NPZ preview and a transient **100k-point / 53.2 ms**
chart measurement were recorded. This is a measured local case, not a universal
render-time bound or real-browser completion of every result workflow. A subsequent
actual browser-authored CPU training run completed and automatically submitted a
plot job from verified best gen-000003 rather than newer periodic gen-000004.
The plot job completed and published nine PNGs. Browser PNG rendering and download
verified 139,593 bytes and exact published SHA-256. That happy-path browser build
preceded later deduplication/accessibility fixes; their final assembled checks
remain separate. Post-integration frontend checks passed 36 files / 390 tests,
typecheck/lint/format/static generation, 13 generated-worker tests and 25 installed
static/vendor/wheel/CLI tests before the later runtime-form label changes.

The actual browser acceptance also exposed a Local executable-alias defect:
Homebrew's selected /opt/homebrew/bin/python3.11 reports a different
sys.executable path, so lexical runtime approval rejected an otherwise successful
training run. Work to bind actual interpreter/prefix evidence from the existing
bounded runtime probe is underway; global realpath/samefile exceptions are not an
acceptable substitute for proving the selected environment.

The recent native Linux agent reports Python **3.11.17**, pytest **8.4.2** and
Starlette **0.52.1**; dependency-light core **762 passed / 12 skipped**, daemon
**1,408 passed / 33 skipped**, and native process subset **53 passed / 10
Darwin-only skips**. Ruff **0.14.10** check/format passed across **206 files**.
Source was read-only and network disabled. These numbers are recent reported
validation, not newly independently reproduced during this documentation update;
dependency-light skips do not certify Linux Qt/ML or GPU readiness. The preceding
actual Linux tmpfs/ENOSPC acceptance remains its own historical storage result.

Still-open gates include full locale parity, actual web ONNX/CV and MAT/HDF5
preview end-to-end acceptance, final assembled automatic-plot regression acceptance,
Local interpreter-alias attestation,
native Windows/GPU validation, a real site's scheduler and filesystem guarantees,
and an authorised release retaining Qt before its retirement. Real browser CPU
evaluation/download evidence narrows the open web gate; it does not close T38,
T30c real-site acceptance, T40–T42, or the overall migration objective. No release
authority is inferred from implementation or these reports; Qt continues to ship.

#### Post-review attestation and assembled verification — 2026-10-08

The Local executable-alias defect is fixed using the existing bounded probe,
not filesystem alias inference. Exact actual interpreter, prefix and base-prefix
are persisted with approved plan, request, run, owner and supervisor identity;
runtime hello and writer startup must match. Original selected lexical Python
paths remain unchanged. New immutable writer receipts hash-bind the required
runtime-probe file; deletion/modification cannot silently downgrade new work to
legacy before allocation. Duplicate identity/proof JSON fields are rejected
before canonicalization. Genuine legacy receipts retain exact-interpreter-only
policy. Slurm cannot consume Local alias authority. Independent review drove
missing-proof and duplicate-field regressions; actual Homebrew-alias and
symlinked-virtualenv HTTP training completed with ingested events/checkpoints.

The definitive post-hardening macOS/Python 3.11.17 whole-project non-slow/non-GPU
rerun passed **2,986 tests**, with **14 skips / 336 deselections**, in **422.59 s**.
The earlier attestation run's four visibility-fixture failures are not presented
as a pass: its fake probe returned no identity. Updating the synthetic probe and
hello to the production contract corrected those fixtures without loosening
validation. Final native Linux declared-range checks passed **762 core / 1,426
daemon tests**, with **12 / 33 skips** respectively, plus **53 native
POSIX/launcher/actual tmpfs ENOSPC tests / 10 Darwin-only skips**. Pinned Ruff
0.14.10 lint and formatting pass; the complete Python source/test/tool formatter
check used `--no-respect-gitignore` and covered **373 files**. Diff checks pass.

The final frontend passed **37 files / 393 tests**, typecheck, lint, formatting
and static generation. Vendored current assets passed **13 generated-worker**
and **25 installed static/vendor/wheel/CLI** tests. Browser MAT/HDF5 header
metadata and all six keyboard-selectable preview views were exercised with 96
rows and shapes 32 / 1. Single-output correlation reports insufficient features,
so actual multi-output heatmap acceptance remains separate. A completed CPU run
rendered simultaneous dashboard loss/R²/LR/gradient/MAE/time/patience and parameter
metrics. Mobile Settings at 390px/110% scale has 390px document width, with dark
appearance applied and only scoped appearance preferences in storage. Producer
best-loss/patience still reflect the emitted snapshot before its current-epoch
update; this is not silently relabelled as a post-update value.

Still open: full language/localization parity, web ONNX/CV and multi-output
heatmap acceptance, broader failure/browser T38 sign-off, mapped-runtime
automatic-plot support (explicitly refused), native Windows/GPU/real-site Slurm
and filesystem validation, dependency-advisory maintenance, and authorized
release/deprecation/Qt retirement. The current Node audit has 13 affected entries
(eight high, five critical); static packaging excludes Node but does not waive
those advisories. This continuation does not close the overall plan.

#### Workstation localization and usable result exports — 2026-10-08

The active workstation now has typed English/Vietnamese catalogs for all screens,
accessible names, client-owned diagnostics and validation guidance. Matching keys
and interpolation parameters are checked. All 46 training field descriptions and
71 bundled model descriptions/best-for entries have explicit translations; exact
source signatures prevent changed/custom daemon metadata from being translated
as though it were the bundled description. Raw logs, manifest/plan JSON, paths,
identifiers, option values and request bodies remain unchanged. Version-one
appearance preferences accept both languages; language switching does not confer
daemon authority or persist credentials. Template AST and client-diagnostic
coverage tests prevent ordinary untranslated copy from silently returning.

Independent review and assembled tests found two issues beyond text replacement:
Reka's mount-time generated checkbox labels could stay English after switching,
and settings navigation could unmount result/dataset/run workspaces. Explicit
reactive accessible names and unique per-instance training control IDs fix the
former; lazy-mounted, scope-keyed retained workspaces fix the latter. Mounted-root
regression tests retain edited inference fields, selected publications, chart
channel/zoom/history and dataset state without additional authority requests.
Detach/reconnect still unmounts stale state. A real built-browser CV summary
load showed five result tables, retained gen-000003, batch size 17 and one summary
read across the English-to-Vietnamese Settings change; document language became vi.

P3 now displays a structured CV summary from an explicitly selected immutable
publication. Reads are SHA-verified, limited to 1 MiB and parsed with duplicate/
nonfinite rejection; fold/target rendering is bounded and null stays unavailable.
Summary publication is not labelled proof of successful execution or model weights.
Actual browser CPU two-fold CV, explicit fold selection, summary download and
96×3×4 output preview/correlation heatmap were exercised. The heatmap rendered
12×12 coefficients and exported a visually checked PNG.

Actual ONNX acceptance uncovered an unpublished external-weights companion.
Exports now request a bounded self-contained model and reject external tensor
references throughout nested protobuf messages before publication, without
following companion paths. Structural checking is mandatory even when optional
numerical checking is disabled. Oversized protobuf models are explicitly refused.
Private staging validates and fsyncs before replacement; rollback preserves prior
output on ordinary durability failures. Failed rollback raises ExportCommitUnknown
and retains recovery outside staging. Prior inode bytes are fsynced before recovery
directory publication. This assumes a caller-owned quiescent destination, not an
atomic concurrency fence against arbitrary unrelated writers.

A fresh real browser fold-2 ONNX export downloaded 2,895,919 bytes with published
SHA-256 35d73f3c83a3deefea5875ecce20cbcbd0d1a1d8d7fdf3b7e9eb56a295feab36.
The relocated download passed ONNX checking and standalone CPU ONNX Runtime;
five sample outputs matched PyTorch plus the fold scaler with maximum absolute
error 9.59e-7. Earlier broken-download evidence is not presented as success.

The assembled frontend passed 48 files / 441 tests, typecheck, lint, formatting
and generation. Current vendored output passed 13 generated-worker and 25
installed wheel/static/vendor/CLI checks. The full macOS non-slow/non-GPU suite
passed 3,007 tests / 14 skips after ONNX hardening. The definitive final rerun
after plotting compatibility passed **3,012 tests / 14 skips**, with slow/GPU
tests excluded, in **201.11 seconds** using two workers. A nondeterministic
collection-time UUID parameter was replaced with a stable foreign UUID; the
preceding xdist collection failure is not described as a test pass. Pinned Ruff
checks cover 375 files.
Real Linux ML acceptance (not dependency-light) discovered Matplotlib 3.11's
removed boxplot labels argument. Signature-based tick_labels/legacy-labels
selection fixes it without hiding invalid-data TypeError; old/new/transitional
signature and real rendering tests cover the compatibility boundary.

Actual Linux aarch64 ML acceptance then passed **49 tests / zero skips** across
real CPU HTTP training, evaluation/plot, CV, ONNX/ORT golden output, two-rank Gloo
training and requeue wrappers in **220.82 seconds**. Full core/daemon with actual
ML dependencies passed **2,212 tests / 25 skips** in **263.56 seconds**; skips
were native Windows/Darwin/root-permission conditions, not missing ML. The real
dedicated 8 MiB tmpfs ENOSPC gate passed. Artifact inspection verified 38
COMPLETE.json objects, 30 ONNX files and 68 PNGs. The first three plotting
failures are historical failures; all three passed on the corrected rerun.
The environment installed declared pyproject requirements: Python 3.11.17,
Torch 2.14.1+cu130, torchvision 0.29.1+cu130, Accelerate 1.15.0, Matplotlib 3.11.2,
ONNX 1.23.2 and ORT 1.30.0. pip check was clean; Gloo was available and actual
CUDA was not. Source was read-only, network disconnected during tests, and the
container had two CPU / 3 GiB limits with zero OOM/kill events. Only the owned
ephemeral container was removed after completion; other containers and user data
were untouched. This is actual Linux CPU evidence, not native Linux Qt, GPU,
Windows or a real Slurm-site certification.

Full T38 sign-off, mapped-runtime automatic-plot support, native Windows/GPU,
real-site Slurm/filesystem acceptance, dependency advisories and authorized
release-before-Qt-retirement remain open. Implemented localization and local
result paths do not waive those requirements or complete the overall objective.

#### Mapped plots, assembled browser failures and shutdown review — 2026-10-09

Explicit storage-map authoring now preserves original host paths and applies the
approved forward mapping once. Automatic plots retain the original exact-instance
training approval, revalidate credential/daemon authority at every async boundary,
and attest the returned normalized plot manifest and immutable checkpoint file
inventory. Credential rotation, detached/replaced workflows and held digest races
permanently fence stale work. Ambiguous data/root symlink canonicalization remains
fail-closed; browser code cannot manufacture a canonical host-path proof.
Distributed training now derives a separate single-process plot topology without
changing the approved device, environment, backend or storage map. An operator
policy that cannot express that plot is refused without a fallback submission.
The frontend passed **50 files / 479 tests**, typecheck, lint, format and generation.

The checked-in browser runner completed all **seven scenarios** against asset
manifest `42755bd6462effa699e05083e44eb7e6d3ea3fe0f86001fc5985fc970e81407d`:
real CPU training/verified download, offline mutation refusal, detach without
cancellation, fresh authentication after reload, authoritative cancellation,
accepted-submit/lost-ACK status recovery without duplicate execution, and genuine
same-length artifact-byte corruption refusal. Owned browser/fixture cleanup was
verified. The baseline download was a 55-byte checkpoint-selection artifact;
that scenario did not await automatic plot completion. Lost ACK means an empty
proxy-style HTTP 503 after acceptance, not a TCP disconnect. These bounded results
are not all T38 rows. The [acceptance ledger](2026-10-08-migration-acceptance-ledger.md)
retains all 24 parity rows and all 15 architecture §16 failure categories.

A dedicated three-OS / Python 3.11 and 3.13 GUI integration lane now installs Qt,
daemon and ML dependencies and requires all 16 assembled acceptance cases with
no skips. Its report guard independently passed eight tests; the mandatory local
Qt slice passed all 16 cases. Hosted matrix results are still unverified.
Packaged static caching now uses hash-covered producer metadata rather than
assuming Nuxt hash names contain uppercase letters or digits. Strict metadata
parsing and semantic-corruption probes passed 52 focused tests; installed
wheel/static/vendor/CLI checks passed 56 tests before the latest frontend rebuild.

The next full Python run exposed a genuine two-rank Gloo teardown deadlock and
was interrupted after **2,909 passed, 14 skipped and one failure**. Runtime exit
events did not prove native termination: the reducer correctly retained an
uncertain running state. Native inspection also found torchrun binary workers
creating new sessions outside the supervisor's inherited process group. The
launcher now uses supported callable run-path workers; real two-rank markers
confirm inherited process group/session and bounded full-tree cancellation.
Prepared model/frame/cycle references are released before distributed backend
destruction, without adding an emergency collective. If an escaped descendant
retains pipes after owned-group termination, bounded draining raises a supervision
error rather than waiting forever or claiming cleanup. Root independently passed
19 runtime/cleanup/public-HTTP tests, including the previously failing writer
two-rank case. Independent focused shutdown review passed 62 tests. The full
rerun then passed **3,066 tests / 14 skips in 185.27 seconds**, with slow/GPU
tests excluded. This is the baseline before the further review fixes below,
not proof that later edits were included in that run.

That review identified further cleanup-error diagnostics, journal-bootstrap
failure cleanup and standalone group-identity lifetime work. All three are now
implemented. Multiple original faults remain explicit, startup writer/push
resources close on failure, and standalone leaders remain unreaped until the
final group signal with forwarding disarmed before identity release. Observation
failure still kills/reaps the owned child without masking the original error.
The definitive rerun after these fixes and the latest vendored frontend passed
**3,083 tests / 14 skips in 190.24 seconds**, with slow/GPU tests excluded.
The mandatory local Qt integration rerun passed all **16 cases / zero skips** in
26.59 seconds and its JUnit guard passed. Fresh generated worker routing passed
13 tests and the new vendored build passed 56 installed/static/vendor/CLI tests.
Pinned Ruff checks passed all 381 implementation Python files; whole-directory
checks additionally expose an unrelated ignored `test.ipynb`, which was not
modified or silently autofixed.

A new real browser port-reuse scenario independently passed against asset
manifest `e5d4a6c2932de8a7621d252fba8d183f444936f1fd7778424b40b7cb4b25afb0`.
Two daemons used the same loopback port, build and private bearer. Both health
checks authenticated, their identities differed, and stale preview approval
revoked the old browser scope without creating any plan/intent/execution/run on
the replacement. Both services/roots and the fixture-only credential file were
cleaned. This starts from an unsubmitted preview, not a live nonempty stream
cursor. The first aggregate eight-case run had an authoring-input failure in the
detach case before submission; its failure is retained. The driver now expands
native summaries with a single click and verifies authored values and zero plan/
submission mutation. It does not claim keyboard-only summary acceptance.
The definitive root rerun then passed all **eight cases**, exit zero; evidence is
`wavedl-browser-acceptance-KU1VNH/summary.json` under the macOS temporary root.
The current-build report guard independently accepted all eight matching case
files and verified cleanup. It rejects the earlier failed aggregate and old
seven-case build rather than treating them as current success.

A dedicated Ubuntu CPU/Chromium workflow now generates/vendors the exact app,
pins agent-browser 0.26.0, runs all eight cases, requires strict current-build
evidence and uploads only the nine explicit nonsecret JSON report paths. It
does not upload fixture roots, private credentials, downloads or browser logs.
Its reusable report guard passed **35 failure-oriented Node tests**, including
missing/duplicate/skipped cases, stale assets, incomplete cleanup, links and
nonblocking FIFO refusal. Root reviewed the workflow and guard and ran the tests
independently. Hosted CI execution is still unverified; this is wiring and local
acceptance, not a green remote matrix claim.

Native Windows/GPU, real-site scheduler/filesystem
acceptance, remaining browser/remote parity, dependency advisories and authorized
Qt-retaining release/deprecation/retirement gates remain open. No release,
scheduler job, configured user storage or unrelated dirty notebook was modified.

#### Native Linux, live browser scope replacement and CI contracts — 2026-10-09

Current source was independently exercised on Linux aarch64/glibc 2.41 with
Python 3.11.17, Torch 2.14.1+cpu and actual Gloo support. A dedicated container
used two CPUs/3 GiB, a read-only repository mount and no network during tests.
Dependency setup and later provisioning corrections were separated from those
network-off acceptance runs; pip check was clean. Results:

- Core/daemon: **2,250 passed / 26 skips**, 230.89 seconds. Skips are native
  platform conditions and one root-permission condition, not missing ML.
- Actual HTTP train/test/plot, CV, ONNX/ORT, requeue and 8 MiB tmpfs ENOSPC:
  **56 passed / zero skips**, 156.67 seconds.
- Native containment/bootstrap/cleanup: **78 passed / 11 Darwin-only skips**.
- Mandatory Qt acceptance: **16 passed / zero skips**, 31.94 seconds, with the
  JUnit guard independently passing. The corresponding macOS rerun passed all
  16 cases in 32.47 seconds.
- Real two-rank CPU training published two complete generations, then bounded
  cancellation left zero live tracked group members. Native cancellation and
  published checkpoint proof are recorded separately.

The first Linux vendor tests failed because Node was absent in the minimal
container; the first Qt collection lacked system libraries. A later Qt test
counted third-party darkdetect's main-thread gsettings appearance probe as a
runtime launch. These failed artifacts are preserved. UI preferences now load
before the runtime ownership spy, which still refuses all runtime subprocesses
on the GUI/network-worker threads. The final Linux/macOS Qt runs include this
test adjustment. Zero OOM/OOM-kill events were observed. The exact owned container
was removed only after terminal process verification; unrelated containers were
untouched. Evidence remains in `/tmp/wavedl-linux-validation-20261009.WY8H3u`.

The root browser run passed all **nine scenarios**, exit zero, against asset
manifest `e5d4a6c2932de8a7621d252fba8d183f444936f1fd7778424b40b7cb4b25afb0`;
actual aggregate evidence is `wavedl-browser-acceptance-n582lH/summary.json`.
The ninth scenario establishes real persisted metrics/logs, a matching producer
journal cursor and rendered nonempty chart history before replacement. Transport
loss retires the old scope. Deliberate fresh fixture-only credential entry still
retains the original daemon pin, and the new daemon rejects the browser's scoped
health request with 409. Final request evidence is frozen after browser and
replacement shutdown; no foreign run read was accepted and no mutation reached
the replacement. Both services/roots and the private credential file were cleaned.

The old native process was genuinely cancelled and reaped, but its runtime EXIT
was absent: that outcome is explicitly null/unknown, not manufactured cancelled
telemetry or a rewritten stale SQL projection. Producer/registry cursor evidence
and visible chart history do not claim the browser's private consumer cursor had
the exact same sequence. The first stricter-but-incorrect journal-EXIT assumption
failed and remains preserved. Exact known fixture bearer/bootstrap values are
recursively redacted and checked before case and summary writes. Metadata bounds,
numeric-only cursor fields and canonical run ownership avoid exposing raw queries
or arbitrary endpoint tails. The nine-case report guard independently passed
**100 Node tests** and accepted the actual aggregate, without combining runs.

Regular CI now installs CPU PyTorch plus daemon test dependencies; a clean
environment reproduced missing Starlette collection and passed all 70 auth tests
after declared daemon dependencies were added. Explicit Node 24 setup covers the
asset producer fixtures in normal/foundations CI. The dependency-light clean
foundations run passed 763 core / 11 skips and 1,475 daemon / 23 skips; it does
not claim runtime/DDP or Qt coverage. The browser workflow requires all nine
cases and uploads only ten explicit nonsecret JSON files. Hosted workflows and
other native Python/platform matrix cells remain unverified.

Full T38/remote and keyboard/PWA upgrade acceptance, native Windows/GPU, real
Slurm/shared-filesystem certification and authorized release-before-Qt-retirement
remain open. Linux CPU/Qt acceptance does not waive any of these gates.

The fixture request-metadata parser now independently caps raw query bytes at
4,096, fields at 16 and numeric replay values at 19 ASCII digits. Thirteen focused
tests cover private-value omission, malformed/non-ASCII input and the exact byte
boundary; the hardened live browser case passed again. A subsequent macOS full
rerun exposed an SSE test that treated TCP reset as different from actual socket
closure. The fixture now accepts only EOF or ConnectionResetError as closure,
while preserving bounded worker detach and no-terminal-signal assertions; root
and independent review both passed all 41 cases and five repeated three-stall
runs. The following full rerun then exposed a separate Darwin EPERM/exit-observation
race in standalone signal handling. Its failing artifact is not counted as a
pass. Darwin normal-flow EPERM confirmation is now bounded to 100 ms, requires
the unreaped owned leader to be present and every group member to be a zombie,
and keeps live/missing/empty groups as errors. Forty actual SIGINT/SIGTERM
repetitions and the 63-case signal suite pass; root independently passed 72
signal/distributed-launch checks. The final whole-project non-slow/non-GPU
rerun passed **3,138 tests / 14 skips in 219.29 seconds**. The reserved-group
mock test is explicitly POSIX-only; Windows uses its separate Job Object contract.
Pinned Ruff lint and formatting cover all 382 implementation Python files.

#### Preset authority, retired acknowledgments and result provenance — 2026-10-10

Source review identified four concrete frontend issues beyond missing acceptance
evidence. Preset imports admitted executable module names and checkpoint/code
paths; retained project components could show a prior daemon's acknowledged run;
an optional results monitor could hide all artifact controls; and download labels
discarded run/generation provenance. These are now corrected with focused mounted
and library regressions, without changing backend paths or download verification.

Presets remain strict partial shared-schema values, but cannot import
`import_modules`, `constraint_file` or `resume`, even as empty/null values.
Manually authored values remain supported and survive safe preset application.
Connection retirement clears acknowledgment/status/guide/confirmation/grants and
fences late async results, including a synchronous listener retiring scope between
the submission and submitted-plan callbacks. Local draft values remain intact.
Artifact controls coexist with evaluation displays, and safe UTF-8-bounded save
labels retain full run UUID and generation. Unrepresentable provenance is refused;
sanitized basename collisions within the same run/generation are not claimed solved.

The assembled frontend passed **54 files / 524 tests**, typecheck, lint, formatting
and static generation. Independent focused review passed 30 tests and found no
significant remaining defect in these fixes. The new packaged build passed 13
actual generated-worker tests and 56 installed-wheel/static/vendor/CLI checks.
The current asset manifest is
`ae70bb25d86b173ab4a6dbe84324efffbb53b9ef3f72105a115ef48383bcc922`.

Factored browser helpers now cover authoring/reset/export and native download
labels. An actual ten-case aggregate passed on the preceding d99a50 build under
`wavedl-browser-acceptance-CVoIKD`; this does not certify the newer callback fix.
The authoring case exercised eight representative fields, all 46 exported YAML
keys, shell-metacharacter paths, saved-default/reset separation, rejected code
module preset upload and immutable re-preview without submission. An isolated
native filename case on the current build (`HMSjRS`) downloaded two genuine
selection publications with full run/generation labels and exact COMPLETE bytes,
after both training and its automatic plot operation completed.

The following current-build eleven-case aggregate (`KanF7h`) failed three cases
during authoring, before submission: positional browser selections triggered an
unintended preview or observed a transient field layout. Failed JSON evidence and
verified cleanup are retained. It is not an eleven-case acceptance result; the
driver's asynchronous target-selection boundary was then revised. Native CLI
clicks had no built-in scroll/readiness/hit-test guarantee, and positional paths
crossed asynchronous command boundaries. The exact physical cause of the earlier
misclick is not claimed proven. The new driver uses semantic/XPath controls,
existing visible field IDs, explicit region scope for duplicate names and
read-only two-frame geometry/hit testing. Eighteen contract tests pass. An actual
eleven-case rerun (`29ip2B`) then passed against the ae70bb25 build, with the
report guard accepting all eleven matching case files and verified cleanup.

An additional latent component contract was hardened: replacing a results
session prop now retires its prior work/subscription, uses one reactive raw owner
everywhere and remounts session-capturing children. Current controller usage is
already stable-session/revision-keyed; this is not presented as an exploited
production bug. Five mounted replacement regressions cover stale callbacks,
pending reads/decoding, preserved new-owner state and image revocation. The
latest serialized frontend run passed **55 files / 529 tests**, typecheck, lint,
formatting and generation. A concurrent prepare/test attempt failed generated
tsconfig lookup and is not counted as success. Current vendored assets have hash
`c9e255128bb53681fa1b4fc4c1868483aa1ff5e03e34176ff84a86305ff72db5`,
with 13 generated-worker and 56 installed/static/vendor/CLI tests passing. Its
fresh eleven-case browser rerun (`4YbChE`) passed to exit zero, and the strict
report guard independently accepted all eleven matching cases and cleanup proofs
against that exact c9e25512 build. The previous ae70 build's eleven-case result
remains separately recorded; no reports were combined. Native downloads use two
real generations and exact full-run/generation labels, with COMPLETE-matching
bytes. Authoring exports contain all 46 inventory keys but only eight fields are
claimed exercised through controls. The strict
eleven-case report guard passed 155 tests and rejects missing/failed/stale evidence.
CI requires all eleven cases and uploads only twelve explicit nonsecret JSON files.
Full T38, remote/browser variants, platform/site and release gates remain open.

#### Current dataset acceptance and single-row repair — 2026-10-10

Independent concurrent reviews found a concrete numerical contract mismatch:
the core correctly returns no correlation matrix when fewer than two rows are
sampled, but the daemon and browser validators required a square matrix whenever
there were multiple outputs. Both validators now accept `null` only for that
unavailable case, retain strict matrix requirements for multi-row/multi-output
data, and reject fabricated matrices for a single sampled row. The browser
explains insufficient sampled rows separately from insufficient output features.
Eight real-child NPZ/MAT/H5/HDF5 regressions cover one-row data and an explicit
one-row sampling cap; the multi-row missing-matrix regression stays fail-closed.

Preview session-prop replacement now retires old work and attempts validation
under the new owner, so a stale branded selection produces recoverable reselect
guidance without a new request. Disconnected header and preview panels preserve
explicit guidance instead of clearing it to a blank panel. Mounted regressions
cover fresh reselection, retired-session callbacks, pending-response cancellation,
and header Stop/retry without detaching the connection. Current controller
revision-keyed remounting is preserved; this is component-contract hardening, not
a claim of demonstrated cross-daemon data access.

The root-owned dataset pilot `wavedl-browser-acceptance-YRfUuj` passed against
manifest SHA-256
`7286e1858e900a5320eb51fc30d7f6943b8ecdc01eae2b226e2583ecc7a3c929`.
It verified actual header metadata and all six views for four extensions plus
one-row NPZ, independently computed displayed statistics, and decoded 29 genuine
PNG downloads with bounded dimensions, colored raster pixels and file hashes.
Nonfinite statistics remain explicitly Missing with rendered charts. Replacing
an owned selected file with unsupported nonnumeric arrays makes Refresh refuse
and clear stale charts. This is not a pinned historical-file identity refusal:
each ordinary refresh deliberately resolves root/path afresh. Mid-request
identity mutation, cancellation and budgets remain separate backend evidence.
No CSV control is invented, no remote certification is inferred, and no training
plan, run or control intent was created by dataset inspection/export.

The first two pilots (`IBNTqZ`, `imtWpi`) failed and remain recorded with verified
cleanup. The first selected uPlot legend rows as statistics; the second used
exact JSON equality on independent NumPy reductions with different memory
orders. Root reproduced equal MAT/NPZ arrays and a standard-deviation difference
of `2.220446049250313e-16`. Independent expectations now use canonical contiguous
float64 reduction order and additionally compare actual canonical input/output
array byte hashes. Neither failure is counted as passing acceptance.

Latest root checks pass **3,147 Python tests / 14 platform/environment skips**
in 192.61 seconds (non-slow/non-GPU), **55 frontend files / 538 tests**, typecheck,
lint, formatting, generation, **13 generated-worker tests**, **86 installed
web/static/vendor/CLI tests**, and pinned Ruff 0.14.10 on all 382 Python files.
An initial generated-worker attempt used a different default interpreter without
Starlette and failed; the explicit tested Python 3.11 interpreter rerun passed
all 13. The README now documents the local browser development beta; it does not
promise a finished native Windows/GPU/Slurm or production release.

The checked-in browser CI now requires twelve scenarios and uploads only their
thirteen explicitly named nonsecret JSON files. An initial twelve-case aggregate
(`i9bx2X`) passed eleven cases but failed the new sample-drag driver when the
native CLI rejected fractional mouse coordinates. The helper now rounds and
validates its native coordinates, with focused contracts; the failed aggregate
remains a failure. The expanded assembled aggregate
and representative native zoom/reset assertions require their own final artifact;
the passing single-case pilot above is not a substitute for that aggregate.
Full P2/T38, remote/platform/site, dependency and authorized release gates stay open.

##### Browser diagnostic continuation — not acceptance

The expanded twelve-case aggregate `i9bx2X` remains **eleven passed / one
failed**, not a passing current aggregate. Subsequent interactive pilots also
remain failed. A native sample drag changed the actual raster in `kZxOmL`, but
the reset did not match its starting raster; no production plot-reset change was
made without sufficient evidence. Further pilots encountered suppressed native
animation frames and delayed driver operations even though ordinary DOM reads,
timers and daemon response starts remained observable. These observations do not
establish an application-level animation or networking defect.

The driver now polls synchronous exposure and compares two independent native
controller DOM observations, including geometry, viewport and center hit tests.
It rejects moving, covered, ambiguous, disabled or missing controls and retains
exact supplied locators and visible field IDs. Its explicitly recorded mode is
`sync-exposure-poll-and-two-controller-dom-observations`; it **does not claim two
completed render frames or an atomic read-to-click transaction**. Twenty-four
driver contracts pass. Raster checkpoints separately compare actual bounded RGBA
bytes under a wall-clock deadline, not private uPlot state.

PNG acceptance now requires genuine native clicks and completed browser-selected
filenames; descriptive names are explicitly test-evidence aliases created only
after bounded byte/PNG verification. CRCs, scanline filters, dimensions, colored
raster pixels and hashes are checked. Unexpected files are refused, not renamed
into apparently valid PNG evidence. Seventeen helper contracts and 260 report
guard contracts pass. The real expanded browser run is still required.

Managed Chrome 150 stalled in several local pilots. A scoped installed-Chrome
154 diagnostic reached real previews but also produced unexpected
`downloads.html`-named files, including a file larger than the eight-MiB export
budget; `TQLZ4X` and `iK2VER` were correctly refused. These files appeared before
some export clicks. No raw unexpected HTML or foreign tab information is retained
in JSON, and no cause is asserted from a filename alone. Fresh, explicitly empty
private profiles are now required and removed only after confirmed closure. An
OS-process ownership probe confirmed the scoped headless Chrome used the expected
private profile; the existing user Chrome process was not its target. This does
not certify the expanded export workflow or the hosted CI browser.

The failed `qYYsGn` and `8gHW9B` pilots initially retained private fixture/download
folders because browser-close acknowledgment timed out. Subsequent normal close
of each exact owned session confirmed absence; only those owned folders were
removed after the daemon's genuine services-closed acknowledgment. Separate
`cleanup-recovery.json` files bind the recovery to the original report hashes.
Original failed reports remain unchanged. No user profile, default browser
session, dataset, database, release, tag or scheduler job was modified.

The Python/frontend results above remain passing evidence for their tested
scope. Current twelve-case browser acceptance, native reset/export behavior,
complete P2/T38, platform/site and authorized release gates remain **open**.

##### Prepared inference sources and export attribution — 2026-10-10

An independently reviewed library-contract gap is now fenced: successful
`ResultOperations.prepare()` captures the current connection revision. A later
`preview()` must still use that exact connected revision before sending any
planning request. The real-session regression reconnects to the same daemon/build
with a replacement credential, verifies no planning request is dispatched from
old selections, then reselects current branded dataset/checkpoint grants and
successfully previews. Temporarily removing only this fence caused the regression
to resolve a plan instead of rejecting; restoration passed. Existing form
subscriptions/remounting already mitigated the default UI path, so this is not
claimed as an observed cross-daemon exploit.

The full frontend suite initially caught the missing Vietnamese presentation for
the new diagnostic. That translation is now registered, and **55 files / 539
tests**, typecheck, lint, format check, generation, **13 generated-worker checks**
and **86 installed/static/vendor/CLI checks** pass. Current assets have hash
`79a3e366881aebd0d3bf6430164a5a43ec3f62943099604fde6ca3e69e678929`.
The earlier Python result remains scoped to its unchanged Python implementation;
it is not a fresh full-suite execution in this continuation.

Export attribution is still open. A minimal real loopback HTML/canvas fixture with
the same asynchronous `toBlob`/anchor pattern produced a genuine PNG in a fresh
Chrome 154 profile. Adding the exact public raster read, shared native preflight,
XPath click and before/after tab inventories also produced only that PNG, with
all no-click filesystem checkpoints clean. This diagnoses the driver boundary;
it is **not WaveDL acceptance** and does not replace a real workstation test.

The real `7SYFdW` probe against the current assets recorded clean download-folder
checkpoints through navigation, configured-root keyboard selection, screenshot,
network idle and initial dataset selection. Its first export baseline contained
only the declared screenshot. Unexpected `downloads.html`-named output appeared
later, with a non-PNG bounded prefix, and was refused. This supersedes any claim
that this specific run's first export simply observed a pre-existing download.
A filename alone still does not identify the payload as HTML or establish its
producer. Bounded prefix diagnostics retain hashes/signature booleans, not raw
unexpected contents, foreign URLs or credentials. All owned browser sessions are
closed; the default session is not touched. Current expanded browser acceptance
and complete P2/P3/T38/platform/site/release gates remain open.

##### Explicit custom-model inference registration — 2026-10-10

Independent review reproduced a real missing contract: training could import a
custom registration module, but a fresh test/plot/export process could neither
approve nor render that import and failed to reconstruct its model. Inference
now accepts an explicit bounded `import_modules` list and renders `--import`.
Registration executes only inside the operation lifecycle, after bootstrap
approval, from the approved request manifest; checkpoint metadata never supplies
executable imports. Empty defaults preserve legacy inference requests, while
null/scalar/nonstring/NUL/option-looking or oversized imports are refused.

The web Results form exposes the same request field with English/Vietnamese
trusted-code guidance and validation. Automatic plots retain the cloned captured
training list, not a later edited draft. Its regression failed before the
workflow/schema fix and passes restored, including unchanged retry intent.
A second reviewer reproduced relative `.py` registrations resolving against the
owned run directory. Manifest planning now resolves those files against the
submission directory and applies existing longest-prefix storage mapping once;
named modules remain interpreter imports. Actual fresh training using a relative
registration file followed by TEST/PLOT/ONNX export from separate owned working
directories failed before this path fix and passes afterward. Missing/omitted
registration still fails without publishing artifacts. This is real local CPU
execution, not a real scheduler or mapped-filesystem site certificate.

Root verification: **3,189 Python passes / 14 platform/environment skips** with
`-n 2 -m 'not slow and not gpu'`; **56 frontend files / 556 passes**; typecheck,
lint, format, generation; **13 generated-worker** and **86 installed/static/
vendor/CLI checks**; pinned Ruff 0.14.10 lint/format checks on **384 Python files**.
The current 37-asset manifest hash is
`e67392c8e81b2f92b694024f41f6473d2ff62e9650de62d82a76f5b7b2ebce92`;
previous assets remain recoverable in `web/.vendor-backups/backup-jf7sevk_`.

Six mocked asynchronous export lifecycle regressions verify component URL
creation/revocation, fixed names, null/unmounted callbacks and isolated DOM/history
preservation. Their inert surrounding-tab sentinel is not parent-tab integration
or native download proof. Three real preview-service regressions independently
pass queued cancellation/draining, post-child file mutation (409), and shared
capacity refusal/recovery (503 then 200).

The strict real dataset pilot `2cQQPs` still failed on an unexpected non-PNG
download and its owned cleanup is verified. Separate fresh real-workstation
diagnostics produced a decoded 470-by-260 PNG (7,736 bytes) through a native click,
including a run with a catalogue screenshot. Other preflight/tab-observation
diagnostics again produced refused non-PNG output; two intermediate diagnostic
scripts also contained invalid evaluation-string quoting, which was corrected
without changing production code. These diagnostics are not a matched-build
acceptance bundle or proof of the unexpected output's producer. Original reports
are retained, with separate cleanup recovery records; only owned fixture/profile/
download folders were removed after service closure and session absence. Verified
PNG artifacts were retained. No user/default browser session was changed.

Complete P2/P3/T38, remote/platform/site, dependency and authorized release gates
remain open. No tagging, publishing, Qt retirement or real Slurm submission occurred.

##### Assembled custom-model consumers and native export readiness — 2026-10-10

Two independently reviewed, root-repeated hosted tests now exercise real Local
owner dispatch through authenticated in-process ASGI: relative-file custom
training followed by explicit best-generation TEST/PLOT and ONNX consumers.
Planning and idempotent replay do not execute the registration marker; actual
imports occur in distinct child PIDs and owned working directories. Full approved
checkpoint pins match persisted manifests and verified source manifest/COMPLETE
digests. Source checkpoint bytes stay unchanged. Downloaded artifact sizes/SHA256
match verified publications; complete CSV headers/shape and both signed/absolute
error pairs are checked; test/plot predictions agree; ten PNGs decode with positive
dimensions; ONNX Runtime predictions agree with published CSV. Service host/pool
outstanding work is zero after lifespan exit. **2 passes / zero skips**, with
ONNX dependencies present, and pinned Ruff checks pass. This is not live TCP,
browser, remote-site or immutable external-registration-source acceptance; the
90-second polling policy is not a claim of globally bounded shutdown.

Matched current-build browser diagnostics distinguish a direct native XPath
baseline (decoded 7,736-byte PNG) from snapshot/readiness variants with no observed
export in eight seconds. A scoped snapshot repeats the same Export PNG `e45`
reference twice for one DOM figure; deduplicating that identical reference and
clicking it natively also produces the decoded PNG. Dataset acceptance now uses
scoped native references while preserving unique CSS/XPath first-figure identity,
exact native text, and two stable post-snapshot exposure observations. Distinct
refs, stale text, hidden/disabled/disconnected/duplicate targets and changing
geometry fail closed. Native filename/CRC/RGBA/size checks remain unchanged;
**307 Node contracts** pass (24 shared actions, 23 dataset, 260 report guard).

The full pilots `pwxbQF`, `VAKKCF` and `89pLS7` still fail and remain failed reports.
Per-export filesystem checks now admit only the declared screenshot and already
verified PNGs, never arbitrary pre-existing names. In `89pLS7` both checkpoints
around pre-export tab inventory are clean, but an unexpected partial non-PNG file
is present after final readiness **before the native export click**. That click
is refused. This narrows the command interval, not the file producer or a product
defect. Post-click inventory now follows strict PNG completion so diagnostic reads
cannot mask already verified bytes. Owned closures/profile/root removal are
confirmed; successful diagnostic PNGs and original reports are retained.
No twelve-case acceptance or complete P2/P3/T38/platform/site/release sign-off is
claimed. Production preview components were not changed by these diagnostics.

##### Per-client PWA reload consent and dependency floors — 2026-10-10

Independent SDK-source review found the prompt helper installs a reload handler
when a waiting worker appears, not when this tab approves. The installed Vue
registration helper's VM regression demonstrates an unapproved client reloads
on external takeover with zero SKIP_WAITING requests. The workstation now disables
the Nuxt-provided registrar and uses one custom plugin with the supported
`onNeedReload` hook. Shared worker activation does not grant this tab permission
to reload. Explicit local approval, external takeover followed by later local
approval, request/registration failure, stale completion, 15-second consent expiry,
and reload-once behavior have regressions. Six policy tests, two tests executing
the installed SDK Vue helper, and five mounted prompt tests use real controls and
EN/VI presentation. The mounted tests mock only Nuxt injection; they do not
establish actual two-tab worker takeover or deferred lazy-chunk/cache compatibility.
API cache exclusions and worker claim/activation behavior were not changed.

Root checks pass **59 frontend files / 569 tests**, typecheck, lint, format,
generation, **13 generated-worker checks** and **86 installed/static/vendor/CLI
checks**. The packaged 37-asset manifest hash is
`85239010c9e01bbe263bcb5ce27916e8f2527fa8688b14060f5b2af98e625971`;
previous output remains in `web/.vendor-backups/backup-s_v8knnu`.
Real browser baseline `Qhybij` connected and verified memory-only authentication,
but failed authoring with no exposed Python interpreter field; its failure
snapshot still shows guided model selection. This is not baseline acceptance or
proof of a PWA regression. Its owned session, services, profile and root cleanup
are verified; the default browser session was not touched.

Project/CI constraints now require setuptools **83+** (below 85), Starlette **1.3+**
(below 2) and explicit h11 **0.16+** (below 1). The ML floor is PyTorch **2.6+**
with torchvision **0.21+**. Reviewed advisory boundaries:
[setuptools PackageIndex](https://github.com/pypa/setuptools/security/advisories/GHSA-5rjg-fvgr-3xxf),
[setuptools Unicode manifest exclusions](https://github.com/advisories/GHSA-h35f-9h28-mq5c),
[Starlette Host/path](https://github.com/advisories/GHSA-86qp-5c8j-p5mr),
[Starlette authority](https://github.com/advisories/GHSA-jp82-jpqv-5vv3),
[h11 chunk parsing](https://github.com/python-hyper/h11/security/advisories/GHSA-vqfr-h8mv-ghfj),
and [PyTorch weights-only loading](https://github.com/pytorch/pytorch/security/advisories/GHSA-53q9-r3pm-6pq6).
These are constraint repairs, not demonstrated exploits in this checkout or a
complete dependency security certification. Eight constraint regressions pass,
including affected-version exclusion in explicit CI installs.

A private system-site-packages environment with Python 3.11.17, Starlette 1.3.0,
setuptools 83.0.0, h11 0.16.0 and installed PyTorch 2.13.0 passed **3,199 / 14
platform/environment skips** (`-n 2 -m 'not slow and not gpu'`, 229.75 seconds).
The selected CI-floor assertions were strengthened during that test-only review
and independently rerun (8 passes). Pinned Ruff 0.14.10 checks all **386 Python
files**. Minimum setuptools wheel/installed acceptance also passed; minimum
PyTorch 2.6 runtime and hosted platform cells were not executed. This private
environment inherits unrelated FastAPI 0.128.5; `pip check` correctly reports its
Starlette<1 conflict. No global environment was upgraded and no clean whole-tree
resolver result is claimed. README recommends a dedicated WaveDL environment.

The fresh Node audit remains **13 affected entries (8 high / 5 critical)**,
including propagated parent entries for three vulnerable leaves. No compatible
published fix was established for the current braces/node-forge paths; simple-git
4 is not a validated drop-in for DevTools' current default import. No forced
override, Nuxt downgrade or advisory suppression was added. Full browser/PWA,
remote/platform/site, dependency and authorized release gates remain open.

##### Editor readiness and deferred-client compatibility audit — 2026-10-10

The current-baseline failure does not establish a guided-editor production bug:
its accessibility snapshot shows the model step, while a later public DOM capture
shows the full-editor toggle. Source uses one synchronous toggle and a retained
`v-show` form. The runner now waits for the actual project-scoped interpreter's
unique native label/ID association, then requires two consecutive identical valid
public observations within eight reads and a 15-second observation-phase budget.
Native waits retain their own separate CLI limits; no total-mode-switch deadline
is invented. False or changed observations reset the candidate; persistent
ambiguity/hidden/disabled/disconnected controls fail closed. Failure-only
diagnostics persist check names and bounded structural metadata, never field
values or private component state. The actual observed interpreter ID can be
passed to fill, which rechecks its native label before existing exposure/readback.
Eight editor contracts and three additional shared-fill contracts pass; CI runs the
new helper suite and its files are explicitly tracked by ignore exceptions.
The final combined run passes 318 Node contracts (27 shared actions, 8 editor,
23 dataset and 260 report guard). Explicit native-label association is rechecked
after typing, even if the value was retained.

Pilots `vg6LIp`, `ZeD1gH`, `AZCadD`, `fqrnkS`, `718NdM` and `7oLzDm` remain failed
reports with verified owned teardown. `fqrnkS` narrows one refusal to label
visibility even though the associated input is visible; `718NdM`/`7oLzDm` obtain
valid editor association metadata but later fill discovery still refuses. These
are diagnostic boundaries, not accepted baseline or causal production claims.
No clicks/fills are retried after failure, and no acceptance check is waived.

A separate source audit establishes that per-tab reload consent is insufficient
for deferred-client build compatibility. Workbox activation deletes old precache
entries, while vendoring replaces the served root. The actual prior entry imports
four lazy chunk URLs absent from current assets; recovery backups are not a
historical asset service. Merely removing `cleanupOutdatedCaches()` is insufficient
because PrecacheController's activation also purges its shared cache. This gate
needs implementation, not another narrow passing prompt test.

The reviewed implementation direction preserves the requested independent-tab
update behavior: generation-specific complete verified caches, a distinct web
generation identity (not Python/API build identity), atomic durable generation/
byte admission, and exact inventory-authorized immutable lazy-asset lookup. Retain
all admitted generations conservatively; refuse a new install at capacity before
takeover instead of evicting an active old build. Count incomplete reservations in
the quota and roll back only the installer's owned resources. Do not use expiring
heartbeats or a two-generation eviction rule as proof that an older tab is gone.
Do not cache API/auth/mutation state or serve an old root/worker by arbitrary
historical first-match lookup. A complete build inventory must refuse omitted
large lazy assets rather than silently accepting Workbox's 4 MB exclusion.

Required assembled proof includes three simultaneously open web generations,
unvisited old lazy routes after the third activation, capacity/concurrent-install
refusal without damaging admitted builds, corrupted/evicted cache behavior, API
exclusions, and A-approval/B-deferral with successful old lazy navigation. Legacy
workers need an explicit initial close/reopen transition; this mechanism cannot
resurrect already purged caches. At the time of this diagnostic snapshot the
direction above was not yet implemented or accepted. The later bounded
retained-build continuation implements it; see the current acceptance ledger
for the distinction between implementation, historical pilots and current-build
recertification. No automatic storage reset or shared-worker consensus snapshot
is authorized as a substitute. Full PWA/T38 and external/release gates remain open.

## Two invariants that constrain ordering

**The daemon/browser app must work between every pair of commits, not just between phases.**
The following planning-snapshot example is historical evidence from the former
Qt client; it is retained to explain checkpoint ordering, not to require Qt support.
At the planning snapshot, `PlotWorker` hardcoded `os.path.join(output_dir,
"best_checkpoint")` and refuses to run without it
(`src/wavedl_gui/service/training_service.py:302`), and plot generation fires
automatically after every successful run (`:565`). Publishing checkpoints as
`checkpoints/gen-NNNNNN/` before that reader understands generations breaks the
shipping app on its happy path. The historical Qt HTTP adapters replaced that
filesystem coupling. In the new app, **daemon/browser consumers learn the new
layout before producers emit it** (T20b before T20c/T20d).

**Emergency saves are deliberately different from normal saves.** Normal saves
are collective across ranks; the emergency path is rank-zero-only to avoid a
deadlock after interruption (`src/wavedl/train.py:1962`). Routing every save
through one helper would erase that distinction, so T20d is its own task with
its own review.

---

## Phase 1A — shared contracts

| Task | Produces | Consumes | Failure cases | Gate |
|---|---|---|---|---|
| **T0** Lazy public exports | `wavedl.__getattr__` (PEP 562); unchanged export names and version metadata | — | `import wavedl` loads the ML stack; a public name stops resolving | 1A |
| **T1** Protocol envelope | `Envelope`, `encode`, `decode`, `finite_or_none`, `ProtocolError` | T0 | unsupported version; non-finite in payload; negative seq/attempt; malformed JSON; unknown fields tolerated; NumPy scalars sanitized; numeric conversion stays inside the error boundary | 1A |
| **T2** Per-type payload schemas + supersession event | `HelloPayload`, `StatePayload`, `MetricPayload`, `ArtifactPayload`, `ExitPayload`, `SupersedePayload` | T1 | wrong type for a known field; unknown event type warns not fatal; supersession referencing an absent step | 1A |
| **T5** Run layout, attempt allocation, operation identity | `RunLayout`, `OperationKind{train,test,plot}`, `allocate_attempt` | — | concurrent allocation race; existing numeric dirs; requeue creating attempt 2 | 1A |
| **T6** Resolved manifest in `wavedl.core` | `Manifest` (resolved config, runtime selection, cwd, storage map), `build_manifest`, `write_manifest`, `read_manifest` | T5 | overwrite refused; interrupted write leaves no partial file; relative paths resolved before submission | 1A |
| **T3** Journal writer | `JournalWriter`, `RecordTooLarge`, `AbandonedTail` | T1, T5 | oversized record leaves no partial bytes; **reopen over an unfinished tail starts a new segment rather than appending through it**; fsync policy; disk-full | 1A |
| **T4** Journal reader | `JournalReader`, `seek_to_seq`, bounded reads | T1, T3 | incomplete tail buffered; **cursor −1 replays seq 0**; **gap in sequence still replays the rest**; schema-invalid line raises `ProtocolError`; CRLF offsets; malformed-line bound | 1A |
| **T20a** Shared generation publication | `publish_generation`, `published_generations`, `COMPLETE.json` | T5, T6 | interrupted mid-copy leaves prior generation published; fsync ordering of contents before manifest; **works with no daemon installed** | 1A |

## Phase 1A — durable control and supervision

| Task | Produces | Consumes | Failure cases | Gate |
|---|---|---|---|---|
| **T7a** Settings and storage validation | `Settings`, `default_data_dir`, `UnsupportedStorage`, **separate daemon-state root and shared run root** | — | network mount refused for the daemon-state root; unwritable dir; run root not visible to compute nodes; **detection is stdlib-only — `psutil` is not a declared dependency** | 1A |
| **T8a** Registry transactions and cursors | `Registry`, `RunRecord`, `apply_events`, `(attempt, seq)` cursors, `rebuild_from_journals` | T7a | **projection and cursor commit in ONE transaction — a crash leaves neither applied**; duplicate apply; cursor per attempt not per run; **registry deleted mid-flight rebuilds from `events.jsonl`** | 1A |
| **T8b** Dispatch ownership | `acquire_dispatch_lock` on a kernel-released file lock, `require_dispatch` guard | T8a | **killed daemon releases the lock** (verified: `flock` is released on `SIGKILL`; a recorded pid is not liveness because pids are reused); two daemons; every external mutation gated | 1A |
| **T7b** Schema versioning and recovery | `schema_version`, `migration_id`, forward-migration runner | T8a | interrupted migration restores backup; read-only recovery start; **a future schema change is applied exactly once**. No legacy import: see the note below | 1A |
| **T13a** Backend and operation contracts | `Backend` protocol, `Plan`, `Handle`, `OperationKind` lifecycle/result contract, `UnsupportedPlan` | T5, T6 | unsupported topology refused not rendered; operation kinds declared here so T28 does not redesign the seam later | 1A |
| **T22a** Persisted plan and idempotency | `PlanRecord`, `idempotency_key`, transactional uniqueness | T8a, T13a | concurrent identical submits collapse to one; key bound to payload; retry after lost response | 1A |
| **T9** Reducer | `RunState`, `DerivedState`, `reduce` | T2, T8a, T13a | **17-case truth table**: supervision lost, queued, held, absent observation, observe error, wrapper-success-with-training-failure, vanished, requeue attempt isolation | 1A |
| **T29a** Bounded execution | `WorkBudget`, bounded threadpool, subprocess deadlines | T7a | worker exhaustion; deadline cancels the work not just the wait; storage-error policy | 1A |
| **T10** Launcher signal forwarding | `_install_sigterm_handler`, `_terminate_child` | — | **no `Popen.wait()` inside the handler**; child ignoring SIGTERM escalates; exit reports 128+signum | 1A |
| **T11** POSIX supervisor | `Supervisor` contract, group signalling, output draining | T29a, T10 | leader exits immediately with a SIGTERM-ignoring grandchild; repeated cancel is idempotent; output exceeding pipe capacity; full reap before release | 1A |
| **T12** Windows supervisor | same `Supervisor` contract via Job Object | T11 | **race-free assignment at spawn**; graceful phase distinct from kill-on-close; same failure set as T11 | 1A |
| **T13b** Local planning | `LocalBackend.plan` | T13a | multi-machine refused; caller-supplied `--output_dir` refused | 1A |
| **CI-1** Cross-platform CI matrix | Ubuntu/macOS/Windows job | T11, T12 | must exist **here**, not at T42 — a release task cannot retroactively validate intermediate Windows commits | 1A |

### Why there is no legacy database migration

`T7b` originally required an explicit disposition of the legacy `task` entity's
download fields. Tracing the code shows there is nothing to migrate, so the task
is recovery-only and the GUI's database layer is deleted rather than imported.

The legacy SQLite layer is inert, and its schema belongs to a different
application:

- `tbl_task` carries `url`, `isLive`, `isBinaryMerge`, `isLiveRealTimeMerge`,
  and a `status` of 0 downloading / 1 complete / 2 failed — a video downloader's
  schema, reached via a music-player template whose `DatabaseThread` docstrings
  still describe "audio directories".
- `DBInitializer.init()` (`view/main_window.py:147`) creates the table on every
  launch, and a `DatabaseThread` is started.
- Its only consumer, `service/download_task_service.py`, is imported by nobody,
  and would raise `AttributeError` if it were: it calls `task.availableVideoPath()`
  and `task.videoPath`, neither of which exists on the `Task` entity. The only
  two `sqlRequest` call sites in the repository are these dead ones.
- No insert path exists anywhere in the repository.
- `AppData/Log/database.log` is 0 bytes and no `database.db` exists on the
  development machine.

The local trace establishes an inert downloader schema with no active insert
path in this checkout; it does not establish that every installed user's file
has always been empty. No automatic import is planned. `T41d` deletes the inert
code and stops creating new legacy databases, while existing user database files
are preserved.

The same template left two more unreferenced remnants, found by simulating the
deletion rather than reasoning about it: `service/speed_service.py` aggregates
download throughput in KB/s and MB/s, and `common/speed_badge/` paints a
per-platform dock badge for it. Neither is referenced anywhere. Deleting all
four — 1,266 lines — leaves no dangling reference and no syntax error, verified
against a scratch copy of `src/`.

The daemon still uses SQLite, but as a **durable local index rebuildable from
`events.jsonl`**, not a source of truth and not a cache. It earns its place on
transactional uniqueness (`T22a` idempotency keys) and relational queries over
runs; it stays on `sqlite3` from the standard library because the HPC login-node
target cannot run a network service, and because the daemon is the only writer.

## Phase 1B — execution and runtime

| Task | Produces | Consumes | Failure cases | Gate |
|---|---|---|---|---|
| **T14** Local execution | `LocalBackend.submit/observe/collect` | T11, T12, T13b | daemon restart yields `supervision_lost` not running; pid reuse | 1B |
| **T15** Slurm planning | `SlurmBackend.plan`, `job_name`, sbatch template | T13a | **`$$` escaping — bare `$?` raises ValueError**; log dir precreated with `%j` in filename; topology maps to `num_machines`/`machine_rank`; unexpressible topology refused | 1B |
| **T16** Slurm submission | `submit`, `find_by_request_id`, `SubmissionUnknown` | T15, T22a | unparseable ack; timeout classified as unknown; **two matching jobs is ambiguity not adoption**; owner verified | 1B |
| **T17** Slurm observation and collection | `observe`, `collect`, `capabilities` | T16 | **`sacct` RUNNING row is not terminal**; accounting absent; `MinJobAge` window missed; controller error ≠ absence; exit code and signal preserved; **independent training/batch/stage-out outcomes** | 1B |
| **T18a** Submission and cancellation controller | startup + periodic reconciliation loop | T14, T16, T8b, T22a | crash between sbatch and record → recovered, never resubmitted; cancel before handle applied after recovery; unknown acceptance stays unknown | 1B |
| **T18b** Batched scheduler reconciliation | fleet polling, backoff, retention-aware schedule | T17, T29a | many runs batched into one query; backoff on controller error; previous evidence retained | 1B |
| **T19** Standalone bootstrap and runtime emission | `wavedl.journal.RunJournal`, `WAVEDL_RUN_ID` propagation, rank logs | T1–T6 | **non-main rank writes nothing**; identity propagated from launcher, not regenerated; standalone run produces a real manifest | 1B |
| **T19n** Runtime negotiation | first-event enforcement, version range check, provenance persistence | T19, T8a | hello absent past deadline; incompatible runtime version; **scheduler wait distinguished from handshake timeout** | 1B |
| **T20b** Generation-aware consumers | resume selection, supersession projection, published-checkpoint selection | T20a, T2 | resume picks a published generation; supersession invalidates later metrics; daemon/browser plot consumes the correct published generation | 1B |
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

## Phase 1C — daemon/browser reliability (current scope)

| Task | Produces | Consumes | Failure cases | Gate |
|---|---|---|---|---|
| **T30a/T30b** Historical Qt adapters | Superseded non-goal; retain dated evidence only | — | Not an acceptance dependency of the new app | — |
| **T30c** Cross-component failure harness + supported-site gate | daemon/browser reliability evidence | T14–T29c, browser consumers | every applicable §16 failure exercised; **real filesystem and Slurm version/configuration validated before HPC support is declared** | 1C |
| **T41d** Historical inert-downloader cleanup | Dated source-removal evidence retained; not an active Qt acceptance gate | — | New-app artifacts exclude Qt; preserve existing user files | — |

## Phase 2 — web client

The 24 functional capabilities are enumerated **before** acceptance; every row
gets an owner. Historical parity terminology identifies product functions, not
an obligation to support the Qt client or migrate its users.

| Task | Produces | Consumes | Failure cases | Gate |
|---|---|---|---|---|
| **P0** Functional capability inventory | 24 daemon/browser capabilities → owning task | daemon API contracts | a row with no owner blocks Phase 2 | 2 |
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
| **T38** Product verification only | signed-off 24-capability inventory | P0–P4 | current browser failures/path variants and supported deployment evidence | 2 |

## Phase 3 — new daemon/browser release validation

| Task | Produces | Consumes | Failure cases | Gate |
|---|---|---|---|---|
| **T40/R1/T41** Historical Qt transition sequence | Superseded non-goal: no deprecation or Qt-retaining release required | — | No prerequisite for new-app delivery; temporary unshipped source is not a deletion claim | — |
| **T42** Final new-app release verification | verified wheel/sdist, console scripts, static browser assets and supported-runtime evidence | T38, T39a, T30c within declared support | Qt excluded from shipped artifacts; daemon-free CLI and daemon/browser acceptance; no publish without approval | 3 |

## Traceability

| Finding | Owning tasks |
|---|---|
| F1 credential exposure | T21, T21b, T32 |
| F2 process-tree cancellation | T10, T11, T12, CI-1 |
| F3 false reducer conclusions | T9 |
| F4 scheduler observation | T17, T18b |
| F5 idempotent submission | T22a, T16, T18a |
| F6 dispatch ownership, storage, schema versioning | T7a, T7b, T8b; historical T41d |
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
| F17 product and release gates | T28a, T28b, T30c, T38, T39a, T42; historical Qt sequence superseded |

## Continuation: bounded retained web builds implemented — 2026-10-10

This continuation supersedes the earlier dated statement that deferred-client
retention is unimplemented; that statement remains historical evidence, not the
current implementation status. It does **not** supersede the outstanding assembled
browser, platform, site, dependency or release acceptance gates.

`web/workstation/service-worker/retained-builds.ts` now implements IndexedDB-backed
atomic admission and generation-specific CacheStorage. Pending reservations count
against admission; an install publishes ready state only after full inventory,
size and digest verification. Rollback removes only the installer's owned data;
an unsuccessful cleanup leaves its reservation charged as cleanup debt. There is
no automatic orphan deletion, admitted-generation GC or eviction policy.
`tools/vendor_web_assets.py` produces the complete bounded `offline-build.json`,
including lazy assets rather than silently omitting large Workbox entries.
`web/workstation/service-worker/sw.ts` binds the inventory to the compiled worker,
serves its own verified navigation shell, and resolves old immutable assets only
through exact authorized retained inventory entries. API/auth/state/mutations
remain network-only. The distinct web generation is not a Python/API identity.
The update plugin and EN/VI prompt surface capacity/verification refusal while
preserving the separate per-client reload-consent boundary.

Implemented bounds are **3 admitted generations** (ready, pending and cleanup-debt
reservations), **64 MiB aggregate declared asset reservations**, **16 MiB/build**,
**128 assets/build**, **8 MiB/asset**, **128 KiB inventory metadata**, and **8 KiB
preserved security headers/response**. Declared reservation accounting does not
certify physical browser storage overhead or available quota. Capacity refusal
before takeover is normal and intentionally leaves admitted builds intact; this
is not support for indefinitely many updates. No deadline guarantee is recorded
here while deadline changes remain under implementation and verification.

CacheStorage and IndexedDB can be evicted or corrupted independently. Missing,
unaccounted, inconsistent or unverifiable data fails closed, not as proof of
continued offline compatibility. Retention cannot resurrect assets already purged
by a legacy worker. The initial legacy transition requires saving/exporting drafts
and closing all existing Workstation tabs/windows before reopening the current
client; fresh-profile install evidence is a different test.

README documents optional manual recovery after closing every affected-origin
Workstation tab/window: inspect that origin and remove only WaveDL's retained
cache buckets and matching metadata database together, with any necessary legacy
worker unregistration scoped explicitly to WaveDL. This sacrifices retained
offline builds, not daemon runs or user databases. No deletions or automatic cache
reset were executed or introduced by this documentation change.

Root verification supplied for this continuation: **3,243 Python passes / 14
platform/environment skips** in the private environment with non-slow/non-GPU
selection; **602 frontend tests**, **28 compiled generated-worker checks**, **59
vendor tests**, and pinned **Ruff 0.14.10 across 387 Python files**. Four genuine
isolated-namespace Nuxt fixture generations were generated and verified. These
are source/component/generated-output checks, **not real-browser three-generation
acceptance**. Three simultaneous generations with unvisited old lazy routes,
A-approval/B-deferral, capacity/concurrent-install refusal, and browser storage
loss remain assembled browser gates. The private environment's inherited FastAPI
`pip check` conflict persists; no clean resolver, complete dependency-security,
minimum-runtime/platform certification or full migration completion is claimed.

## Continuation: native retained-build pilot and clean installed CPU chain — 2026-10-10

This newer evidence supersedes the preceding "not real-browser three-generation
acceptance" and "no clean resolver" statements only within the scopes below.
The earlier reports and environment conflict remain historical evidence.

Native pilot C passed at
`/private/tmp/wavedl-retained-browser-pilot-20261010-c.json`. Four genuine
current-source isolated-namespace Nuxt fixtures in
`/private/tmp/wavedl-retained-browser-builds.eixujJ` have verified source hashes
matching the worker/store. G1/G2/G3 have exact ready IndexedDB records and complete
CacheStorage inventories. Native approval of G2 and G3 reloads only the approver;
all deferred old-tab timeOrigins remain unchanged. Previously unmounted G1
Project/Settings/Results and G2 Settings render. G4 installation is refused at
capacity, leaving exactly three ready buckets, no G4 record or orphan; G3 Settings
still renders afterward. Read-only `no-store` public fetch probes have real
service-worker `workerStart > 0`, with exact inventory hash/size matches, while
the same old URLs return 404 from the current daemon. Modules may have been
HTTP-prefetched: route rendering plus those independent probes does **not** prove
the actual lazy module loader traversed the worker. A/B pilot failures remain
preserved in their corresponding `...-a.json` and `...-b.json` reports.

The native receiver-bound fetch defect was first reproduced as 1 failure / 27
passes, then repaired with a local bare fetch function (28 passing checks).
Concurrent orphan-enumeration and rollback regressions were also repaired.
Current checks are **607 frontend tests**, **30 compiled generated-worker checks**
and **387 Python files with Ruff 0.14.10**; no replacement full Python count is
asserted while that run is live. Current assets manifest:
`fb0dca4bbd6445621d630072c1d9375845107bfd3693b2cc6a5f5b9a6ec2474a`.
Metadata fetch plus body has one 30-second total deadline; each asset fetch,
body, digest and cached verification has a 30-second per-asset deadline. These
do not bound CacheStorage/IndexedDB waits or certify a hard whole-install deadline.
Pilot cleanup records browser/services closure, SIGINT listener refusal
(`ECONNREFUSED`) and removal of only its owned temporary root.

A separate clean wheel environment `/private/tmp/wavedl-clean-install.2fZjAn`
installed all 79 dependencies without system-site-packages, FastAPI or Qt; root
independently confirmed `pip check` passes. Real TCP checks cover static serving
(33 checks), single-use authenticated bootstrap, no cookies, foreign-origin 403,
shutdown lock release and restart. Installed actual CPU training for two epochs,
then TEST → PLOT → ONNX, all completed in
`/private/tmp/wavedl-installed-cpu.V3sJin` without PYTHONPATH. Root inspected the
script and terminal JSON log. Exact public artifact hashes/sizes match; CSV is
96×4 with finite values/errors and TEST=PLOT, nine PNGs decode, and native ONNX
agreement is within 1e-5 with an immutable best-generation consumer pin.

This was an installed wheel `[daemon]` runtime, not an actual editable
`.[dev,daemon]` runtime install (that exact request received resolver dry-run
verification only). Its browser asset snapshot predates the latest bare-fetch
fix; CPU/core code is unchanged, but the clean wheel does **not** establish
current final browser asset identity. The older inherited FastAPI conflict does
not describe this new clean environment. Legacy transition, restart/storage-loss
browser cases, broader T38/PWA, security/platform/site and release gates remain
open; no full migration completion follows.

## Continuation: reproducible retained-build acceptance and final Python result — 2026-10-10

The terminal full non-slow/non-GPU Python rerun is now verified: **3,244 passes /
14 skips in 222.06 seconds**, JUnit
`/private/tmp/wavedl-final-python.YrixiM/results.xml`. This supersedes the live-run
qualification above, not its platform/GPU exclusions.

Checked-in `tools/build_retained_browser_fixtures.mjs` actually produced four
serial genuine Nuxt builds after the dist-alias/private-workspace fixes, with
summary at
`/private/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-retained-browser-builds.Z01VrI/summary.json`.
Native pilot D passed all nine stages:
`/private/tmp/wavedl-retained-browser-producer-20261010-d.json`.
`tools/verify_retained_browser_report.mjs` accepted that actual report and checks
the complete current source inventory (Vue, TypeScript and public asset hashes),
not merely worker/store TypeScript identity. Guarded reads reject symlinks/FIFOs
and bound source files to 32 MiB each/128 MiB aggregate, report to 2 MiB and
offline assets to 8 MiB each. Ten producer, eight guard and 320 existing Node
contracts total **338 passes**; the latest minor guard update independently passes
all eight guard contracts.

`.github/workflows/daemon-browser-integration.yml` triggers these tools and runs
contracts → four-build producer → native nine-stage pilot → report guard before
the original mandatory twelve scenarios. Retained-build artifact uploads contain
only the report JSON and producer summary, not fixture logs/profiles/credentials.
This is verified wiring, **not a hosted CI execution result**. README documents
the three reproducible retained-build QA commands separately from quickstart.

Full current twelve-scenario acceptance remains open. Actual baseline `I5ZwfO`
failed with three unrequested plans and no intent. Instrumented `NL8AwY` did not
expand the summary; trusted keyboard/detail-zero diagnostics showed repeated
roughly 180k events but zero before/after per-field events. Inspection of native
0.26 fill/wait/snapshot implementation did not establish an Enter-send cause.
No causal production claim or product-guard relaxation follows. The summary
helper preserves its original preflight XPath rather than substituting exact-text
lookup (27 contracts). Opt-in `WAVEDL_BROWSER_ASSETS` binds explicit diagnostic
fixture assets; the main twelve-case guard refuses `explicitFixtureWebAssets` or
`authoringEventDiagnostic`, so diagnostic success cannot become acceptance.
The live Chrome 150 diagnostic has no asserted result here. Prior unexpected
non-PNG dataset-export evidence and broader legacy/restart/storage-loss/T38,
security/platform/site and authorized release gates remain open.

## Continuation: bounded runner and uninstrumented native baseline — 2026-10-10

The retained runner now bounds its owned subprocess-group TERM/KILL, reap and
output-drain lifecycle; seven runner contracts pass. Actual native pilot E
`/private/tmp/wavedl-retained-browser-bounded-20261010-e.json` passed all nine
stages and the full-current-source report guard. The combined Node result is now
**349 passes**, including 31 driver, ten producer, eight guard and seven runner
contracts. Driver stabilization requires two matching actual native-association
observations within eight reads/15 seconds, preserving original IDs/XPath and
refusing moving controls; it does not change application preview semantics.

Actual unmodified packaged Chrome 154 visible baseline **DRDaGD passed**:
`/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-browser-acceptance-DRDaGD/baseline.json`,
with current manifest `fb0dca4bbd6445621d630072c1d9375845107bfd3693b2cc6a5f5b9a6ec2474a`.
All field before/after plan counts and summary plan count remain zero before
explicit approval, with no accidental planning; root's normal CPU run completed.
The actual private fresh profile and closure were verified. Optional
`WAVEDL_BROWSER_HEADED=true` defaults false; Linux headless CI wiring is not a
hosted execution result. The newly started full twelve-case headed run is still
live, so **no full twelve-case acceptance is claimed**.

Instrumented headed `JXrhpt` succeeded but remains excluded by the main evidence
guard. Managed Chrome 150 `qazu4t` failed initial closure and preserved its owned
private roots/report. Root later verified PID31217's exact owned profile, sent
SIGTERM only to that test Chrome, then verified agent-browser owned closure,
PID absence and default session; the original failed report is unchanged.
The prior headless trusted-keyboard-event cause remains unknown, not evidence
for a product guard fix. Broader legacy/restart/storage-loss/T38, security,
platform/site and authorized release gates remain open.

## Continuation: terminal twelve-case result and privacy guard — 2026-10-10

Actual current-manifest full run `rjoHIF` is terminal:
`/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-browser-acceptance-rjoHIF/summary.json`.
**Eleven cases passed; dataset failed**. Passed cases are baseline, offline,
detach, reload, cancel, lost acknowledgment, artifact tamper, port reuse, live
port reuse, authoring parity and download names, each with verified owned
cleanup. The aggregate acceptance guard correctly rejects the bundle; this is
not full twelve-case or T38 acceptance. Its dataset session left the expected
fixture origin; no unrelated-origin details are reproduced here.

Isolated dataset follow-up `B0rQgg` observed the actual pipeline header and all
six view tabs exposed, with only the first-input distribution inspected and genuinely painted, then refused
unexpected `downloads.html`/`.crdownload` before the export click. Cleanup passed.
The download producer/cause remains unknown and under read-only review; no
29-PNG acceptance or relaxed non-PNG/download guard is claimed. The driver now
fences snapshots to expected loopback origin, limits allowed domains to loopback
and skips foreign body reads in failure handling. Optional headed mode still
defaults false. Prior headless event causes remain unknown; no accidental-preview
or application approval semantics were changed.

Privacy review repairs redact the full bounded stderr before truncating its tail,
fully suppress stderr exceeding 64 KiB, and unconditionally suppress browser-command
stderr so exact secret fragments cannot leak. Two added regressions bring owned
subprocess contracts to **nine** and the root-verified combined Node result to
**351 passes**. Driver31 still uses bounded eight-read/15s matching native-ID
association. Previously verified native E nine-stage/full-source-guard results
and CI producer/pilot/guard wiring remain valid scoped evidence, not hosted CI
or full T38 sign-off. Dataset and broader external/release gates remain open.

## Continuation: actual dataset parity and benchmark-only browser startup — 2026-10-11

Native visible Chrome 154 **Iw86fF passed** 71 dataset assertions:
`/private/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-browser-acceptance-Iw86fF/dataset-parity.json`.
NPZ/MAT/H5/HDF5 plus one-row NPZ exercise six views, with one-row correlation
explicitly unavailable, 29 genuine decoded PNG exports, nonfinite replacement,
plot drag/reset and heatmap keyboard/reset. Registry reads verify no new plans or
intents/executions; owned fixture/profile/browser cleanup passed. This supersedes
the prior absence of actual dataset interaction/export proof, not the rejected
eleven-pass `rjoHIF` aggregate or full T30c/T38 sign-off.

Owned failed `97ozxB` download bytes were inspected read-only, never executed:
CRX3 (`Cr24`, version 3, 1,093-byte header, ZIP offset 1,105) contains only
`model.tflite`/`model-info.pb`, not HTML/PNG. Exact installed Chromium
154.0.8037.98
[source](https://chromium.googlesource.com/chromium/src/+/154.0.8037.98/components/optimization_guide/core/delivery/prediction_model_download_manager.cc)
defines the benchmark-only model-download switch and suppresses fetching when
set. The test-owned Chrome command line uses the single
`--disable-optimization-guide-model-downloads-for-benchmarking` switch; Iw86fF
passed after unflagged failures. Failed comma-feature-list experiments remain
failed evidence. No user-global setting, browser sandbox default, WaveDL export
logic or non-PNG acceptance rule was changed.

Bounded failure-prefix retention uses no-follow/inode/post-read identity checks,
16-file/4-KiB-each/64-KiB-total caps, mode-0700 directories/mode-0600 neutral
files and metadata-only reports with no CI byte uploads. Cleanup can remove a
download before capture; not every failed payload is guaranteed retained.
Canonical realpath workspace ownership addresses macOS `/var` aliases without
weakening symlink refusal. First-view discovery retains its 24-read bound and no
additional browser commands (26 parity, eight prefix and three policy contracts
pass); the previous combined 351 count is not yet replaced by a terminal rerun.

Current-manifest full twelve-case run `81lrwj` is live, not accepted here. The
aggregate guard correctly refuses isolated Iw86fF's missing mandatory cases.
Earlier Python 3,244/14, frontend 607 and Ruff 387-file checks are unchanged
earlier evidence, not fresh reruns. Complete T30c/T38, remote site/native platform,
legacy transition/restart/storage-loss, security and authorized release remain
open; no full-migration completion is claimed.

## Continuation: terminal current twelve-case browser bundles — 2026-10-11

Actual same-host macOS visible Chrome 154 `81lrwj` completed **12/12 passed**:
`/private/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-browser-acceptance-81lrwj/summary.json`.
Direct fail-closed `verifySummary` accepted all twelve cases and current manifest
`fb0dca4bbd6445621d630072c1d9375845107bfd3693b2cc6a5f5b9a6ec2474a`;
its copied-report CLI attempt remained refused for dedicated TMPDIR/profile mismatch.

The fresh dedicated repeat at
`/private/tmp/wavedl-browser-ci-acceptance.0rTzUi/wavedl-browser-acceptance-oOrxj3/summary.json`
also passed **12/12**. Exact CLI
`node tools/verify_browser_ci_report.mjs /private/tmp/wavedl-browser-ci-acceptance.0rTzUi`
exited 0 with cleanup proven and the same manifest. All test-owned browser/daemon
processes were confirmed gone; unrelated UMI sessions were untouched. The terminal
combined Node check now totals **366 passes in 1,722.49 ms**. This supersedes the
preceding live/count caveats, not historical failed reports; Iw86fF's isolated
dataset proof and benchmark-only browser policy remain unchanged.

Hosted CI was not run. Same-host macOS/Chrome/CPU results do not complete all 24
T38 rows, remote GPU/Windows/real Slurm-site, R1 or authorized release gates.
Next local browser evidence is standalone adoption (row 24), same-daemon
401/identity-skew retirement (row 21), and assembled split-UTF8/sparse-attempt
streams (row 16); existing unit/hosted evidence does not replace those cases.
Local intentionally rejects remapping, so fake mapped-Local execution is not a
substitute for genuine remote/site acceptance. No full-goal completion is claimed.

## Continuation: packaged adoption and auth-skew guards — 2026-10-11

Packaged assets now hash `3487e46c6e87bb9d40fbcd020dd9a5f8030a563aab52b0942093c956ec8b27cf`.
Adoption quality runs 5 and 6 each passed all ten assertions; the CLI guard accepted
quality 6: 13 source files,
one `COMPLETE`, and 200 → 503 → retry-200. The registry proves no PID, supervisor,
job, submission receipt or cancellation intent was created; the API reported
`supervision_lost` uncertainty and owned
cleanup passed. Auth-skew report
`/private/tmp/wavedl-auth-skew-report-20261011-l.json` passed its CLI guard with CPU
history, health post-handler-401/build/protocol faults, public reauth/detach and
old-authority removal; original plan/control/manifest remained unchanged;
one derived automatic-plot source generation is proven. CLI-argv credential use is
not process-list secrecy; reports contain no token. Focused Python 21 (five actual
live-TCP stream tests, not browser cursor proof), Node 45 and
frontend 610/typecheck/lint/format passed; generated-worker checks pass 30/30 with
configured Python PATH (the earlier missing-Starlette-default failure is retained).
The fresh 3487e twelve-case suite at
`/private/tmp/wavedl-browser-current.X2kTyd/wavedl-browser-acceptance-CkycRA/summary.json`
passed 12/12; its dedicated CLI guard accepted current assets and cleanup.
Full non-slow/non-GPU Python validation passed **3,251 / 14 skipped in 228.02s**,
JUnit `/private/tmp/wavedl-final-python-current.xml`; pinned Ruff 0.14.10 lint and
format passed on 390 files. Additive adoption/auth/live-TCP CI wiring is checked
locally, not an executed hosted lane. Browser restart/storage-loss/concurrent
admission/legacy transition and browser cursor proof remain separate unfinished
gates; complete T38/platform/GPU/site/release sign-off is not claimed.

## Continuation: retained-browser restart durability — 2026-10-11

Retained report `/private/tmp/wavedl-retained-browser-current-20261011-b.json`
passed ten ordered stages and its `verify_retained_browser_report.mjs` guard
exited 0. Restart closed/reopened the same owned Chrome profile, checked exact
g1–g3 CacheStorage/IndexedDB identity, fresh-document rendering and each
generation's Settings chunk, then cleaned up. Storage loss/corruption,
concurrency, legacy transition, browser stream cursor, full T38/platform/site
and release gates remain open. Combined Node is **404/404**; Python is
**3,251 passed / 14 skipped**.

## Continuation: retained storage-loss hard refusal — 2026-10-11

Following Service Worker hard-refusal and admitted-static matcher fixes, packaged
assets were rebuilt with hash
`af18842e79fde54a900655f8a4683a1546fe45a44f9cd520b06c1ae58b390978`.
The current frozen bundle at
`/private/tmp/wavedl-browser-current-final-sw/wavedl-browser-acceptance-4FYKuM/summary.json`
passed 12/12 and its CLI guard accepted exact current assets and cleanup.
The assembled stream subgate `/private/tmp/wavedl-stream-browser-final-f2/report.json`
passed its strict verifier with rendered history/diagnostics, fragmented first SSE,
cursor `0:-1` → `1:0`, journal/registry authority and owned cleanup. It explicitly
records `utf8Observed: false`; split UTF-8 remains covered only by ASGI tests.
The retained storage report
passed 11 stages and its report guard exited 0. Storage-loss removed exactly the
three owned caches and retained-builds IndexedDB database while the active
registration remained; immutable and navigation requests failed closed without a
network response or resurrection. Generated-worker checks are **32/32** and
retained Vitest **28/28**. This supersedes restart-only evidence. Concurrency,
legacy transition, browser stream cursor, full T38/platform/site and release gates
remain open.

## Continuation: final frozen worker and stream replay — 2026-10-11

The final format-checked package manifest hashes to
`f2d77eb7b246d0de1800cc8b295b685aaf77d1bee755ac9cf5213d274fea99d8`.
Its exact current twelve-case report is
`/private/tmp/wavedl-browser-current-f2/wavedl-browser-acceptance-uWi0jN/summary.json`;
the dedicated CLI guard exited zero with 12/12 and cleanup proven.
Fresh current adoption and auth/skew reports also passed their current-asset
guards at `/private/tmp/wavedl-adoption-browser-final-f2/standalone-adoption.json`
and `/private/tmp/wavedl-auth-skew-final-f2.json`.
Current native retained report `/private/tmp/wavedl-retained-browser-final-f2.json`
passed all eleven stages and its complete current-source guard.

Assembled stream `/private/tmp/wavedl-stream-browser-final-f2/standard-final.json`
passed its current-asset guard: real rendered CPU metrics/logs, byte-fragmented
real first frame, an explicit test-owned overflow position, next-request cursor
`0:-1` → `1:0`, and registry/journal matching with owned cleanup. It deliberately
records `utf8Observed: false`; raw multibyte delivery, sparse/attempt transitions
and corrupt controls still need their own browser proof. A Unicode-interpreter
experiment failed and remains private failure evidence, not acceptance.
ASGI-only boundary tests enforce `browserObserved: false` and no local cursor.
The b92 run was rejected after a rebuild; no stale/mixed report was certified.

Current frontend 612/typecheck/lint/format and generated-worker 33/33 passed.
Concurrent admission, legacy transition, full T38/platform/GPU/site and release
gates remain open. No full-goal completion or hosted CI result is claimed.

## Continuation: current 54bc build, concurrency and legacy transition — 2026-10-12

After the Nuxt consent configuration (`emitRouteChunkError: false` and
`checkOutdatedBuildInterval: false`), the packaged manifest is
`54bc033f36361213fb73fa0ee28c9bb3a83451f2bbce71516de66189fc1d8ef0`.
The current twelve-case guard passed, and current adoption/auth/skew/retained
reports were rerun against the same hash. Native retained concurrency
`/private/tmp/wavedl-concurrency-current54-final.json` passed with one stale-admission
refusal plus explicit retry, simultaneous g4a/g4b capacity refusal, unchanged
warm generation, three ready generations and cleanup. Legacy transition
`/private/tmp/wavedl-legacy-transition-20261012-d` passed independently: actual
legacy Workbox install, authored YAML, browser close/session absence, profile
preservation, current swap, explicit reload consent and current retained bytes.

The stream guard is now strict about exactly two records, initial cursor,
fragmentation totals and advancing reconnect events. It still records raw
`utf8Observed: false`; ASGI tests cover split UTF-8, while sparse attempts and
malformed controls remain browser gaps. Hosted CI, Windows/GPU/Slurm-site,
complete T38 and authorized Qt-retirement release gates remain open.

Root final checks: full current non-slow/non-GPU Python validation passed
**3,261 / 14 skipped** (JUnit `/private/tmp/wavedl-final-python-20261012.xml`);
449 Node tooling contracts passed; 15 focused stream/concurrency Python tests
passed; pinned Ruff 0.14.10 lint and format passed on 396 files; `git diff --check`
passed. These do not certify hosted CI, Windows/GPU, real Slurm-site, full T38 or
release/Qt retirement.

## Continuation: approved registration paths and native rollback/stream gates — 2026-10-12

Current assets are
`3bad3d0efbb39a233a4db1da158eb3d7f2118629b2404450831fb39d495061ac`.
Independent review and two RED/GREEN regressions repaired automatic-plot
registration paths: original host-side `.py` paths undergo exactly one forward
map, and the derived plot's normalized imports must exactly match the immutable
training manifest. Named-module identity/order remain checked. Remapped Local
execution remains deliberately unsupported; this is not mapped-site acceptance.

The native rollback report
`/private/tmp/wavedl-retained-rollback-autoplot-20261012.json` passed its strict
guard against fresh current-source fixtures. A genuine QA-scoped worker writes
one native cached asset, fails the second on injected HTTP 503, becomes redundant
and removes only its pending/cache ownership. Warm storage/page/controller stay
unchanged. Ordinary UI consent, quota exhaustion, crash and GC remain distinct.

The current sparse stream report
`/private/tmp/wavedl-sparse-browser-20261012-final3bad-report.json` also passed:
real sparse journal IDs render with injected Unicode, public reconnect uses
`1:2`, and an ahead control causes public protocol-skew retirement. Public DOM
releases an owned-file fault barrier. ASGI byte fragmentation is not browser
network-chunk proof; attempt rollover, post-rejection private cursor and malformed
JSON control cases remain open.

Fresh root checks passed 3,266 Python tests / 14 skips, 615 frontend tests,
485 Node tooling contracts, 35 generated-worker checks, typecheck/lint/format
and pinned Ruff on 399 explicitly non-ignored Python files. New CI wiring requires
native rollback and sparse stream guards but does not establish hosted results.
The fresh full browser aggregate and serial baseline failed native authoring/
readback; those are retained failures with cleanup, not current twelve-case
acceptance. See the latest acceptance-ledger continuation for exact report paths
and limitations. T30c/T38/platform/GPU/site/release/Qt-retirement stay open.

### Current twelve-case rerun and clean install — 2026-10-12

After isolating an input flood at the native configured-root Enter interaction,
QA selects the visible exact option through bounded native hit-test readiness,
without app state injection or product edits. The fresh aggregate
`/private/tmp/wavedl-browser-native-option-final-20261012/wavedl-browser-acceptance-KfFwu9/summary.json`
passed all twelve cases, and root's strict CLI guard accepted current 3bad assets
and owned cleanup. This supersedes the preceding missing-current-aggregate note;
earlier failures remain retained. Keyboard-combobox acceptance is not claimed.

A clean non-system venv installed `.[dev,daemon,gui]`, passed `pip check` and ran
3,266 tests / 14 skips after making four `-S` dependencyless source-import probes
independent of inherited `PYTHONPATH`. JUnit:
`/private/tmp/wavedl-clean-python-final-20261012.xml`. Current tooling contracts
pass 488/488. Full parity/native/site/hosted/release gates remain open.

### Additional assembled and CI acceptance work — 2026-10-12

`unit_tests/daemon/test_assembled_crash_replay.py` adds real local ASGI/SQLite/
journal crash replay at both transaction write orders; five focused tests pass
and the scope excludes real scheduler/site semantics. The malformed stream
report `/private/tmp/wavedl-stream-malformed-20261012-gate.json` proves public
refusal/retirement and bounded no-replay for a truncated control; attempt
rollover/private cursor/browser network chunk claims remain open.

The GUI acceptance guard is strict about aggregate counts and test identities.
Clean assembled GUI acceptance is 17/17, including real Qt automatic-plot
filesystem-fault recovery. The native foundations guard adds
bounded UTF-8 XML parsing and entity/symlink rejection and requires 13 macOS
POSIX ownership/process cases while retaining other
platform/optional skips as explicit unverified evidence; local core/daemon
foundations passed 789/6 and 1,608/8. Workflow changes trigger web/tool changes,
run dependency checks, upload JUnit and wire the native guard. No hosted workflow
or external platform certification is inferred.

The expanded clean full regression passed 3,384 tests / 14 skips in 226.58s
(`wavedl-clean-python-gui-fault-20261012.xml` under `/private/tmp`); combined
Node tooling contracts are 533/533 and pinned Ruff passes on 406 Python files.
All seven workflow YAML files parse and the current 3bad twelve-case browser
guard still accepts. These results do not close complete T30c/T38, keyboard/
attempt-rollover browser acceptance, hosted/native/site/GPU or release gates.

The local attempt-rollover browser subgate subsequently passed at
`/tmp/wavedl-rollover-final-9/standalone-adoption-rollover.json`: two genuine
launcher attempts share one run identity, attempt 2 is publicly adopted, and
the monitor renders historical attempt 1 plus active attempt 2 from journal
authority. Private browser cursor storage, broker-capacity semantics and real
Slurm requeue/site behavior remain unclaimed.

## Continuation: submitted-plan protection, Qt lifecycle and isolated package gates — 2026-10-12

The submitted-plan authoring gate passed independently against current 3bad
assets at `/private/tmp/wavedl-submitted-independent-final-20261012/submitted-plan-browser.json`.
After real completed CPU training and its automatic plot, epoch editing, confirmed
reset and acknowledged-run navigation left full settled plan/manifest/control/
execution hashes unchanged. Exact accepted-run identity, listener refusal and
owned cleanup are mandatory; other platform/site variants remain unverified.

Qt lifecycle review repaired stale automatic-plot reuse across successive runs,
late output/results from retired monitors, false cross-validation plot spinners,
and empty successful plot results. Independent neighboring GUI/worker/autoplot/
restart coverage passed 66 tests; repeated-supersession regressions are additive.

The installed-package path now includes a truly isolated resolver cell. A complete
local wheelhouse passed fresh no-system-site-packages installation, `pip check`,
console scripts, TCP/static assets, daemon-free CPU training, checkout isolation
and teardown. Root reproduced it independently in 54.49 seconds; the clean agent
JUnit is `/private/tmp/wavedl-t39a-isolated-20261012.xml`. Explicit incomplete
wheelhouses fail rather than skipping.

Artifact runner cleanup/reporting is hardened and its real browser report passes
again. Current Node contracts pass 583/583; pinned Ruff passes on 407 Python files.
Explicit result-operation browser implementation exists but has no green real
acceptance yet. Complete T30c/T38, remaining parity variants, hosted/native/site,
and authorized release/Qt-retirement gates remain open.

The fresh full clean-venv regression with an explicit complete wheelhouse passed
**3,391 tests / 14 skipped / 336 deselected in 532.88 seconds**; JUnit is
`/private/tmp/wavedl-clean-python-parity-20261012.xml`. The isolated resolver test
ran rather than skipping. Current Node contracts remain **583/583** and pinned
Ruff checks pass on **407** Python files. These are current local results, not
completion of T30c/T38 or permission to release/retire Qt.
## Continuation: current packaged evaluation-operation acceptance — 2026-10-12

The rebuilt current package hashes to
`4d09580d5f443ec24698bbffe67eac58ee3019099514a2f513841ad3e81e7c34` after fixing
the result-operation form's missing `backend: local` default. Real current
Chromium acceptance and strict report verification passed explicit published-
checkpoint evaluation at
`/private/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-browser-acceptance-LkqO5s/result-operations.json`.
The gate proves unsupported-opset refusal, stale-preview revocation, completed
CPU evaluation, verified predictions publication, and durable source/COMPLETE/
evaluation-event identity. Remote/GPU/Windows/Slurm and complete T38 remain open.

The later complete twelve-case aggregate was rerun against the rebuilt 4d package
and is recorded in the acceptance ledger. Earlier 3bad-specific aggregate and
subgate reports above remain historical evidence; they must not be read as
current-package certification for unrelated subgates.

## Continuation: current 4d ONNX and inference cancellation — 2026-10-13

Strict verification passes for the current supported ONNX browser report
`/private/tmp/wavedl-p3-onnx-current4d-actualbrowser-v2/onnx-export.json`.
The exact-opset fix is reflected in a same-host CPU opset-17 export from a genuine
checkpoint, finite source/output comparison, immutable publication/download
identity, and complete cleanup. This closes only the supported ONNX export slice;
CV, remote, GPU, Windows, Slurm and full T38 parity remain unverified.

Strict verification also passes for
`/private/tmp/wavedl-inference-cancel-root-current4d-20261013-rerun/inference-cancellation.json`.
The browser/runtime fixture observed a real `hello` and PID, a running state,
cancellation, cancelled exit code 130, and no publication. SIGINT cleanup was
graceful and owned roots/services were removed, with no duplicate plan or run.
This is local CPU cancellation evidence, not scheduler, remote, platform, site,
or release certification.

The focused current checks are 32 Python ONNX tests plus 46 runtime/ONNX root
tests; Node ONNX and cancellation contracts pass 17 and 31 tests, respectively.
The fresh full Python non-slow/non-GPU suite passed 3,402 tests, with 14 skips and
336 deselected; JUnit `/private/tmp/wavedl-clean-python-current-20261013.xml`.
All 641 Node tooling contracts pass. Root independently reran the hardened ONNX
wrapper and guard at
`/private/tmp/wavedl-onnx-root-reviewed-current4d-20261013/onnx-export.json`.
The current 12-case aggregate and current submitted-plan, artifact,
and result-operation reports remain separately accepted evidence. T30c/T38 and
platform/site/release gates stay open; no CV/remote/GPU/Windows/Slurm/full-parity
claim is made.
