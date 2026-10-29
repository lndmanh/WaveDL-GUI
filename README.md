<div align="center">

<img src="logos/wavedl_logo.png" alt="WaveDL Logo" width="500">

### A Scalable Deep Learning Framework for Wave-Based Inverse Problems

[![Python 3.11+](https://img.shields.io/badge/Python-3.11+-blue.svg?style=plastic&logo=python&logoColor=white)](https://www.python.org/downloads/)
[![PyTorch 2.x](https://img.shields.io/badge/PyTorch-2.x-ee4c2c.svg?style=plastic&logo=pytorch&logoColor=white)](https://pytorch.org/)
[![Accelerate](https://img.shields.io/badge/Accelerate-Enabled-yellow.svg?style=plastic&logo=huggingface&logoColor=white)](https://huggingface.co/docs/accelerate/)
<br>
[![Tests](https://img.shields.io/github/actions/workflow/status/ductho-le/WaveDL/test.yml?branch=main&style=plastic&logo=githubactions&logoColor=white&label=Tests)](https://github.com/ductho-le/WaveDL/actions/workflows/test.yml)
[![Lint](https://img.shields.io/github/actions/workflow/status/ductho-le/WaveDL/lint.yml?branch=main&style=plastic&logo=ruff&logoColor=white&label=Lint)](https://github.com/ductho-le/WaveDL/actions/workflows/lint.yml)
[![Try it on Colab](https://img.shields.io/badge/Try_it_on_Colab-8E44AD?style=plastic&logo=googlecolab&logoColor=white)](https://colab.research.google.com/github/ductho-le/WaveDL/blob/main/notebooks/demo.ipynb)
<br>
[![Downloads](https://img.shields.io/badge/dynamic/json?url=https://pypistats.org/api/packages/wavedl/recent?period=month%26mirrors=false&query=data.last_month&style=plastic&logo=pypi&logoColor=white&color=9ACD32&label=Downloads&suffix=/month)](https://pypistats.org/packages/wavedl)
[![License: MIT](https://img.shields.io/badge/License-MIT-orange.svg?style=plastic)](LICENSE)
[![DOI](https://img.shields.io/badge/DOI-10.1016/j.cpc.2026.110400-008080.svg?style=plastic)](https://doi.org/10.1016/j.cpc.2026.110400)

**Production-ready • Multi-GPU DDP • Memory-Efficient • Plug-and-Play**

[Getting Started](#-getting-started) •
[Documentation](#-documentation) •
[Examples](#-examples) •
[Discussions](https://github.com/ductho-le/WaveDL/discussions) •
[Citation](#-citation)

---

 **Plug in your model, load your data, and let WaveDL do the heavy lifting 💪**

</div>

### Product direction — 2026-10-27

WaveDL is a new daemon/browser application with a daemon-free training CLI.
The local browser client is the primary interface. The Qt desktop application
has been physically removed from the repository; its source history is preserved
at tag `archive/qt-desktop-2026-10-27`. Legacy Qt compatibility, old-user-data
migration, a deprecation period and an intermediate release retaining Qt are not
product requirements.

The 23 remaining workstation capabilities remain functional product requirements.
Offline/PWA capability #23 was retired by owner decision on 2026-10-27; dated
offline/worker reports below are historical evidence only. API/protocol,
durable-state, crash-recovery, security and browser acceptance safeguards remain
required. Real HPC-site filesystem/Slurm validation is required before declaring
that deployment supported. Final daemon/browser package and release validation
remains open; tagging or publishing requires explicit approval. Dated evidence
below retains its original scope; historical Qt-retirement gates do not describe
the current source tree.

Current verification (2026-10-21): the full hosted browser workflow passes
**191 steps with zero failures or skips**, including its twelve-case baseline,
extended failure paths, cancellation recovery and authentication retirement.
Hosted CPU tests pass on Python 3.11/3.12/3.13 with 4,036 passes and 40 explicit
skips per version; the separate isolated-wheel gate passes without skips.
Actual installed-wheel/browser acceptance and the native foundation matrix
pass. Native Windows isolated CPU acceptance passes on Python 3.11/3.13;
the selected wheel/sdist pair passes separate offline CPU lifecycle checks.
Genuine single-device macOS MPS training/cancellation also passes within its
bounded scope. An approved Colab T4 also passes single-GPU CUDA training,
checkpoint publication and native cancellation/process/context cleanup; it
does not establish a graceful runtime exit. Distributed GPU, real Slurm-site
qualification and disposition
of 11 high/zero critical build-tool advisory entries remain open; this is not
final release sign-off. See the
[acceptance ledger](docs/superpowers/plans/2026-10-08-migration-acceptance-ledger.md)
for current source hashes, results, limitations and remaining gates.
The [runtime qualification runbook](docs/daemon-runtime-qualification.md) records
the inputs and real hardware/site evidence needed for the remaining GPU/Slurm
gates; it is not a qualification report.

Latest local validation (2026-10-18): the daemon/browser bundle passes all 12
strict browser acceptance scenarios, 820 web tests (one skip), and 38 generated
worker checks. PNG preview exports now report preparation failures and browser
handoff honestly, discard stale callbacks, and share lifecycle handling; heatmap
replacement/reset clears stale hover values. Both the exact wheel and sdist
pass isolated dependency-resolved install-and-run acceptance with no skips.
Additive Linux-container runs found and fixed an eager username lookup
despite an explicit backend owner and interpreter-dependent deep JSON acceptance.
Fresh core/daemon regression passes **2,721**
tests (15 skips); rebuilt wheel/sdist and a fresh browser training smoke pass.
Real 4 MiB tmpfs exhaustion/recovery and all 13 required POSIX foundation cases
also pass in Docker Desktop's Linux VM, not a native host or hosted CI.
Full dependency-light Linux foundations additionally pass on Python 3.11 and
3.13: 2,687 core/daemon passes and 76 report-guard passes per version, with 51
explicit platform/optional skips. The exact wheel and sdist also pass isolated
Linux/arm64 Python 3.13 CPU installation, real training/publication and daemon
lifecycle acceptance with network disabled. These remain Docker-VM results, not
native-host, hosted CI or GPU certification.
The full selected-stack Linux CPU regression passes **3,800 tests**, with 35
explicit skips and 336 slow/GPU deselections.
Inspection disconnect now cancels/drains its child, malformed
Unicode paths fail safely, and YAML export reports browser handoff honestly.
Automatic plots skip malformed/partial newer checkpoints and use an older
complete publication when available. Authentication, identity/protocol and
checksum faults still revoke the connection. Real browser cases prove both
older-complete fallback and all-partial refusal with no unintended follow-up.
The supported non-slow/non-GPU Python regression is **3,680 passed, 15 skipped**
with 336 deselected (recorded 2026-10-17); these are local macOS/CPU results.
Additional current-bundle acceptance verifies checksum-only metadata refusal
without fallback and metric-bearing crash/replay in both transaction orders.
Real browser checks also verify supervised header timeout/retry and bounded
preview resource refusal/recovery, including clearing stale plots.
See the [latest acceptance ledger](docs/superpowers/plans/2026-10-08-migration-acceptance-ledger.md#current-authority-corrected-source-and-bundle--2026-10-18)
for exact build identities, test boundaries and remaining T30c/T38/platform/site
and release requirements. Older bundle reports below remain historical.

Dated F05 precursor browser evidence (2026-10-15) is recorded in
`/private/tmp/wavedl-f05-genuine-browser-20261015-c.json` (SHA-256
`b40c35a30fb48018d6600d46f42f0d774877399d34ed4ff6c66f7647a03f586a`). Root
and independent strict verification passed. The genuine
capacity-1 EventBroker overflow, replay-to-live reconnect from cursor `1:0`,
exact journal IDs through attempt rollover, durable cursor equality, DOM
diagnostic uniqueness and cleanup passed. This closes F05 for the scoped local
browser slice only; live allocation/requeue/Slurm, chunk-boundary, GPU, site and
full-T30c coverage remain open.

Current F12 malformed-control evidence is
`/private/tmp/wavedl-f12-invalid-utf8-20261015-b.json` (SHA-256
`6bc6f4233d391625d9d50c30e802060f0d386e712ce51e32ec7d1e08e767a636`). Root
and independent strict verification passed. Chrome refused
the invalid-UTF-8 control with protocol-skew handling, cleared the selected run
and credentials, issued exactly two requests with no retries, and preserved
durable cursors/cleanup. This is a bounded local browser fault: network chunk
boundaries, private post-rejection cursor, attempt rollover, Slurm/site and
full-T30c acceptance remain unclaimed.

Current bundle `8d1cd10a744f260d658dd4904244be530bcbceb716cb75230ef4dfd7ffc6ad96`
passes the bounded web suite **793 passed / 1 skipped across 70 files**, with
typecheck/lint/format clean, generated workers **38**, and package/static/headless
checks **112 passed**. Prior bundle reports remain historical and are not silently
reclassified as this bundle's evidence.
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

Additional strict 8d1 scoped reports cover preview faults
(`/private/tmp/wavedl-preview-fault-8d1-current-20261016-1/preview-fault.json`,
SHA-256 `b4b1bba33f3abeed323a189343cdcd43a150f8d0f964feb4f33ed37795b4a289`,
34 Node/95 Python; browser identity-mutation/reselection refusal and MAT/NPZ recovery are covered, while browser caps/decompression/allocation/Stop variants remain unclaimed), cold offline shell behavior
(`/private/tmp/wavedl-cold-offline-8d1-5.json`, SHA-256
`0ae5e0b2b5bd13a368deb4df3c4b6b2dc22cefba98d6d807321453a3541ed42b`, 39
verifier tests), and pending cancellation
(`/private/tmp/wavedl-pending-cancel-final-current-20261016.json`, SHA-256
`d675bde4adcbed2ce89efe8e3913f38bf67efbc5a518327e0defbc3115ee67e7`).

The final visible-alert catalogue report
`/private/tmp/wavedl-catalogue-native-current8d1-20261016-final/catalogue-fault.json`
(SHA-256 `b90b1f6ac8cf94805f205c6337e66ed66add82ab79f89ee5b864191e15dc36dd`)
strict-passes 32 Node/11 Python checks and all cleanup/storage checks, preserving
six response faults plus native chmod-000 owned-child real-403 and 1001-empty-file
real-503 checks against the service's 1000-entry limit, without production wire
mutation. Unreadable configured roots, remote filesystems, disk ENOSPC and full
T38/T30c/platform/site/release remain unproven. The older six-case report is historical.

Dated 8d1 focused coverage (2026-10-16) also included the generated-worker cold
offline deep-link regression. That result is historical evidence, not current
offline support. The local spawn-failure attempt-fence test confirms the durable
attempt reservation remains uncertain/nonretryable (`SupervisionLost`), preventing
duplicate admission rather than erasing the attempt state.

Dated prior-07e auth-watermark report `/private/tmp/wavedl-auth-watermark-final-20261016.json` (SHA-256 `c20a9fac9b51616859f38d9ab10eba73520b0015ee46ddcba3680679fc8e4388`) passed its then-current verifier and 42 focused tests for persisted cursor watermarks and the later-open race. It is historical, not current-8d1 recertification; use the strict current auth report above. Model-shape guidance remains implemented and test-covered; full T38/T30c remain open.

Current reconnect report `/private/tmp/wavedl-reconnect-current-Vg8OfT/reconnect.json` (SHA-256 `bfe3b12ea40791a335124339dd2b3675dae685ba6d67f414160ecddebf3cee99`) and sparse report `/private/tmp/wavedl-sparse-current-20261016.json` (SHA-256 `aa8e93eaeb9f36cc3d7d016fd2594806178047b0dc736af74ce9a232d8104506`) strict-pass with cleanup. These are local CPU/current-8d1 slices; Slurm, Windows, GPU, real-site and hosted coverage remain open.

The final pending-cancellation report above passes 35 meaningful portable verifier
checks (positive and mutation cases, including fatal UTF-8 tempfile handling);
workflow checks pass 29. Earlier `pending-cancel-live-20261016-9.json` is historical:
the current verifier rejects its source hash, so it is not current acceptance.

Historical current-source retained-consent report (2026-10-16)
`/private/tmp/wavedl-retained-current-consent-20261016-active-draft-3.json`
(SHA-256 `cdc8680886336b71f8a480987fee0667ae1728a3923b2111802ad0e3f8c932ae`)
and fixture summary
`/private/tmp/wavedl-retained-current-consent-20261016-builds-1/summary.json`
(SHA-256 `bb2209db7b99df8e2dbe1a01f0e11edb0f5db10f8ba6d8f41abd12ec1e152dc4`)
strict-pass all 11 existing stages plus cleanup. Four genuine namespaced QA builds
use the current 641-source snapshot, not package-exact builds; the 37-asset 8d1
package is unchanged. Waiting/defer/approval preserves the active CPU PID,
plan/run and draft value 77, and only the approving tab reloads. This records the
former consent flow as dated evidence; it is not a current product gate or claim.

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
and reload catalogue state after reconnect, while WorkstationController now derives
`useHead` language reactively. Preference recovery preserves Vietnamese settings;
the previously observed overwrite-to-English path is covered by the current
bundle evidence.

The strict preference report is
`/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-preferences-browser-rYqtC8/preferences-browser.json`
(SHA-256 `598d3f902763565e8bb394fa6ae7073107773829bba7100918196b3be959b10a`).
The strict artifact-safety report is
`/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-artifact-publication-HPt33u/artifact-publication-oversized-inventory.json`
(SHA-256 `7722cace14085f92c19a4edc2870cf75d28c35468faf734ab042de320cbaf86d`);
it covers bounded modified-size/traversal inventory, incomplete-generation and
active-HTML/SVG no-inline/no-exec fixtures, and clean cleanup. The current 100k
report is `/private/tmp/wavedl-100k-8d1-current-20261016.json` (SHA-256
`af6bd2888afdba5e63457ecd79cd8f07f2aa4a452cf8275102cb90c4819f2272`); the
supersession report `/private/tmp/wavedl-supersession-8d1-current-20261016.json`
strict-passes (SHA-256
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
`/private/tmp/wavedl-f05-final-20261015.json` (SHA-256
`5c19115f786240967ecc88f96007441be4909f9158bf324a5c34d08c56e09149`). F12
`/private/tmp/wavedl-f12-final-bundle-20261016.json` (SHA-256
`7c54da68df654e2e16f7632f48b2aa0967a3e3112d52b5d4b55bf925d8ea9249`) includes
the fixture splitBytes fix; F13
`/private/tmp/wavedl-f13-final-20261015.json` (SHA-256
`ea56f9d7ba660055c591e9c22b7e74ae799de79a940b8c217ba4ed8436ded3e8`). F06
read-only/quota reports are
`/private/tmp/storage-fault-readonly-final-20261015.json` (SHA-256
`1c992002bec91bc4a8d6415c7a67de10bcd62944251dc5f277348f5a1fcc09cb`) and
`/private/tmp/storage-fault-quota-final-20261015.json` (SHA-256
`152549ccb455749e0592f3bf8a962a02bf594e630f9afdb2417582e01349d2d5`). The
dated prior-bundle 12-case aggregate is
`/private/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-browser-acceptance-nPthdn/summary.json`
(SHA-256 `16f858c01ddb7ec07b7650911038ab09ec533dd09e823a5710234be8f9ddb614`);
`verifySummary` passed against its recorded prior manifest. Prior F13 recertification at
`/private/tmp/wavedl-hostile-origin-current-20261015.json` (SHA-256
`1dabd4fc72d04cdbd98852814ea211a6008a3d3ee21447cbf6db543894ec1cce`) passed
the unchanged strict verifier with its recorded prior manifest and all cleanup checks
true. Its same-host/loopback scope does not certify remote/site or full F13.
No full T30c, T38 or release completion is claimed.

## Historical acceptance evidence (before the new-app cutover)

The reports in this section describe their dated builds. References to mandatory
Qt/GUI lanes, parity, retirement or release sequencing are historical and do not
define the new app's current acceptance checklist. See the product direction
above and the acceptance ledger's current dependency table.

### Dated daemon/browser evidence — 2026-10-15 (F02/F13; 7b1c baseline unchanged)

Actual macOS Chrome 150 hostile-origin report C
`/private/tmp/wavedl-f13-hostile-browser-20261015-c.json` (SHA-256
`bdffa181eea30c45f55b33a2d0cb4136bfff7218eb60b00c0a1a8f898d860acb`) passes
root and independent unchanged strict verifiers. Second-port browser GET/fetch POST/form POST
attacks receive 403; JSON/Authorization preflight gets 403 without POST/CORS grant;
cookie-only navigation gets 401. Seven sanitized wire receipts match DOM evidence,
attack storage is unchanged, and authenticated GET/cancel positive controls return
200/202 (`cancellation_requested` 0→1 plus pending submission-control row, no
executions/ML). Assets and owned
cleanup pass. A/B remain failed pilots. Combined root checks pass Node 175 and
Python 241/0 skips, including CLI 39 with nine new dependency-free help/invalid-secret
tests. F13 CI is configured, not remotely executed; independent final review verifies
the report/hash, removed temporary paths, both refused ports and mandatory/always-run
CI ordering/allowlist with 11 passing workflow tests. DNS rebinding,
nonloopback/remote/site/cross-browser and full F13 remain
outside this local loopback slice.

Native agent-browser/HeadlessChrome 150 B F02 evidence is recorded at
`/private/tmp/wavedl-f02-browser-20261015-b.json` (SHA-256
`c80fea6e439bc30c8f0252798ad525b6e22f5fbf73fff9ea23908e54f3b03cb1`); root and
independent strict file verifiers pass. Four controlled phases (damage,
live-reader eviction/bookmark restore, append torn suffix, repeat submit/stable-owner
laps) cover torn-tail, abandoned-tail, oversized-line and oversized-tail with 32 DOM
observations. Only torn-tail completed after append; the other three faults remain
terminal unknown/uncertain/no-metrics. Assets remain unchanged,
and cleanup verifies absent browser session, listener refusal, fixture exit 0, drained
services and removed workspace/profile/token. This is genuine Local
submission/startup/HELLO/journal/SQLite/HTTP/SSE evidence with a terminal numerical
supervisor/pid, not ML, native-process, shared-filesystem/site or full-F02 proof.
Initial A remains failed on its immediate cleanup check; bounded-poll repair is
unit-covered. Current Node runner/verifier/actions/launch pass 111; Python passes
65/0 skipped (including eight workflow checks); Ruff 0.14.10 is clean. Reviewed
CI wiring covers scoped push/PR paths, mandatory fixture/Node checks, always-run
browser/strict-file verification and allowlisted artifact upload; hosted execution
has not run. The 3,883-Python/751-web/12-browser/
package totals remain dated product-baseline evidence, with no full regression rerun
for tooling-only changes. Full T30c/T38, Windows/GPU/site/hosted-release remain
open.

### Historical daemon/browser status — 2026-10-14 (7b1c; local acceptance passed)

The packaged client inventory is
`7b1c164f0b9e05d1f3eaffa81c66fcbcaad9580e83f9899085ff51530119b5bc`
(38 assets); prior eece is retained at `web/.vendor-backups/backup-gcan1hmm`.
Definite planning HTTP 400 now explains that the plan was refused and settings
need correction. Submission/status failures and uncertain transport outcomes
retain their existing acknowledgement/identity guidance; response bodies and
private error messages remain redacted. No settings are silently reset.

The full frontend suite passes **751**, typecheck/lint/format pass, and generated
worker checks pass **38**. Actual browser acceptance verifies 12 invalid-field
corrections with zero planning arrivals, three real unsupported-runtime refusals,
then exactly one corrected unsubmitted preview. Its guard compares all 46
authored fields plus the separate daemon-owned output directory, and verifies
unchanged assets and cleanup. Local POSIX assembled SQLite recovery now covers
both projection/cursor write orders through rebuild and direct ingestion; this
controlled-backend ASGI slice does not certify Windows, metrics or site storage.
The fresh frozen regression passes **3,883 / 14 skipped / 336 slow/GPU deselected**,
zero failures/errors, with all 427 Python source/test hashes unchanged.
Exact current runtime-package acceptance passes 1/1 with zero skips/errors;
original twelve-browser recertification passes **12/12** with current assets and
complete cleanup independently verified.
Full T30c/T38, Windows/GPU/real Slurm/site, hosted CI and authorized release/Qt
retirement remain open. Exact evidence is in the acceptance ledger.

### Historical daemon/browser status — 2026-10-14 (eece; local acceptance passed)

The rebuilt/vendored client inventory is
`eecefbd5b13c587b2ee1951c91b7b186851ad62707cd201e0efc3a84bde5a835`
(38 assets); 58d4 remains recoverable at
`web/.vendor-backups/backup-upr2a97b`. Deterministic CV is now supported, with
seeded CPU repeatability, native spawned-worker coverage and caller RNG/backend
restoration. Its warn-only policy matches normal training; this is not a claim
of bitwise reproducibility on every accelerator. CV auto-worker selection now
falls back to zero workers when its owned shared-memory probe is unavailable.
CV-only Nesterov/SGD/momentum and plateau-factor validation agrees between the
browser and daemon; unsupported resume/save/fresh/compile/tracking choices still
fail visibly before persistence.

The assembled CV/data cohort passes **98**, contract/planning cases **158**,
frontend tests **736**, generated-worker cases **38**, and browser action/CV
guards **74**. A fresh real browser authors deterministic CV, completes two CPU
folds, explicitly selects one fold for evaluation and verifies downloaded
predictions and cleanup. OneCycle now budgets successful optimizer-update
boundaries, including partial accumulation windows, without duplicate DDP
scheduler advancement. Seven focused tests cover actual CPU/two-rank training,
normal/emergency resume and a controlled CPU scaler skip. The fresh frozen
regression passes **3,833 / 14 skipped / 336 slow/GPU deselected**, zero failures/
errors, with all 425 Python source/test hashes unchanged. Exact current runtime
package acceptance and strict current-source epoch/CV browser checks also pass.
The original twelve-scenario browser recertification passes **12/12**, with exact
asset identity and cleanup independently verified.
The earlier overlapping 3,825-pass run remains diagnostic, not frozen acceptance.
Exact evidence and remaining gates are in the acceptance ledger.
Local CPU development is runnable; full parity,
Windows/GPU/Slurm/site, hosted CI and authorized release/Qt retirement remain open.

### Historical daemon/browser status — 2026-10-14 (58d4)

The current generated/vendored client inventory is
`58d4762e5fd6e4b22feb07c2d75d8fb3e7f545d65f95ae4930463925557d4897` (38 assets);
5864 remains recoverable under `web/.vendor-backups/backup-osaziadr`. Cross-
validation now visibly rejects unsupported nondefault resume/save/fresh/
deterministic/compile/tracking settings before preview, and field-level errors
mirror the daemon contract. Supported fold loss, optimizer, scheduler,
accumulation, precision, pretrained and physical-constraint settings are tested
on real CPU paths. Current frontend tests (711), Python CV/planning contracts,
typecheck/lint/format and strict epoch browser evidence pass. Full T38, hosted
CI, native Windows/GPU/site and authorized release/Qt retirement remain open.
Fresh current-bundle regression passes **3,764 / 14 skipped / 336 slow/GPU
deselected**, zero failures/errors, with all 421 Python source/test files
unchanged. Exact source-distribution acceptance separately passes 1/1 with no
skips. These local certificates do not waive the remaining parity/platform/site
or release requirements.

### Historical daemon/browser status — 2026-10-14 (5864)

The packaged client now guards cancellation as one durable intent. A confirmed
request disables repeated Stop; an unconfirmed outcome remains retryable. Delayed
cancellation responses retain immutable run/native ownership checks even after
a newer poll, and cannot overwrite newer lifecycle evidence or clear an already
acknowledged intent. Independent review passes 49 focused checks; the full web
suite passes 683 with typecheck/lint/format. Generated-worker checks pass 38 and
static/offline/installed-web/vendor checks pass 97.

The frozen inventory is
`5864c81a4f691bd504da7bfd9a9956df511f6268a268f9e1134ad7db8f6c34db`
(38 assets). The preceding 04b5 output is retained at
`web/.vendor-backups/backup-f27_km7z`. Current browser recertification passes
12/12; the genuine abrupt-restart and installed-console 4/4 gates also pass.
The additive real cancellation lost-acknowledgement gate also passes: a genuine
CPU run observes unknown → requested/stopping → daemon-confirmed cancelled,
with one committed cancellation POST whose 202 acknowledgement is replaced by
503, no duplicate intent, and complete cleanup. Earlier
browser and installed-console certificates below belong to their named bundle;
they are not automatically current-5864 certificates. Local CPU development
remains runnable; T30c/T38/platform/site/hosted/release gates remain open.

Evaluation now rejects empty input and non-finite or incorrectly shaped model/
inverse-scaled predictions before publishing results. Finite predictions and
singleton metrics remain supported. The updated runtime passes 3,532 Python
tests with 14 documented platform skips; real daemon-managed NaN/Inf/empty
evaluation cases also pass their expected-failure checks. A subsequent broad
regression including the epoch-metrics and release-helper changes passes 3,551
with 15 skips and 336 slow/GPU cases deselected. Thirteen skips need Windows,
one needs Linux tmpfs, and the opt-in isolated install separately passes 1/1
with its configured offline wheelhouse. No native Windows/GPU/site acceptance
is inferred from these local results.
The current mounted Results numerical-failure browser gate also covers NaN, Inf
and empty input-only NPZ files through a genuine daemon CPU run: all fail with
truthful diagnostics, no prediction artifacts, immutable training publications,
and complete cleanup. This is scoped local evidence, not full P3 parity.

The same-epoch metrics browser gate now independently passes against the current
bundle: epoch-one best loss, patience 0→1→2 and early stopping after three of
seven approved epochs match the journal, database, history and publications.
Its 64 evidence-contract tests and two CI-wiring tests pass; both screenshots
and complete cleanup are verified. This stationary CPU slice uses an explicit
task-local matching Chrome headless-shell to avoid a macOS screenshot-tool hang.
The additive CI gate is wired, not yet hosted-run certified. Full T35/T38,
Windows/GPU/site and authorized release gates remain open.

The later runtime change fixes CV component-option fidelity: weighted loss,
Huber delta, Nesterov and scheduler settings now reach actual fold training.
Seven real HDF5 failure cases also verify cleanup. The focused assembled Python
slice passes 94 tests; other CV options remain open parity work. Real Linux
4 MiB tmpfs exhaustion/recovery and exact source-distribution rebuild/install
both pass their scoped acceptance checks, and their mandatory CI lanes are
wired. Earlier broad-suite/runtime-bound browser reports predate this change;
the acceptance ledger records fresh post-CV evidence without retroactive sign-off.
The fresh full regression now passes **3,670**, with **14 skips** and **336
slow/GPU cases deselected**, zero failures/errors and all 417 Python source/test
hashes unchanged. Thirteen skips need native Windows; the Linux tmpfs case
separately passes in its bounded isolated container. The browser/source package
recertifications do not close full CV parity, platform/site or release gates.

The subsequent CV correction also honors accumulation, explicit pretrained
selection and physical constraints, and executes CPU BF16 autocast. The current
combined CV/data suite passes 85 tests independently; CI requires them with zero
skips. CUDA precision paths have controlled probes, not actual GPU acceptance;
unsupported modes fail explicitly. The earlier 3,670 full-suite certificate
predates this correction. The fresh full regression passes **3,701 / 14 skipped /
336 slow/GPU deselected**, zero errors/failures, with all 420 Python source/test
hashes unchanged. The exact
current source distribution separately passes isolated rebuild/install/runtime
acceptance. Deterministic/compile, tracking and CV resume/save behavior remain open.

### Previous daemon/browser status — 2026-10-14 (04b5; historical)

The monitor now batches presentation updates without skipping history events or
resume cursors. The rebuilt manifest is
`04b5126c583e47c78077d8e2595e88c880d2385baf02d95492edf5cc2f93ce5c` (38 verified
assets; the prior output is retained under `web/.vendor-backups/`). 661 frontend
tests, 96 static/offline/vendor checks and 38 generated-worker checks pass, with
typecheck/lint/format and independent review. The real 100,000-point public chart
gate now passes with exact journal/SQLite/event-log/cursor evidence and complete
cleanup. Preview-fault refusal/retry also passes. The retained active-run/draft
current run passes all 11 stages, including cold restart and storage-loss refusal,
with strict current-source, frozen-asset and cleanup verification.
The current twelve-case browser aggregate passes 12/12. The same-daemon reconnect
gate also passes against 04b5: genuine local CPU detach, reauthentication and
fresh replay from cursor `0:-1`. Transport-resume cursor, attempt rollover and
remote/platform certification remain separate.
The genuine CPU checkpoint-resume browser slice also verifies restored history
replacement and cleared/current summaries through staged public SSE delivery.
This is not real Slurm requeue or native-restart certification.
Uncertain runtime metrics now say “Last known runtime metrics” and explain
that recorded epoch progress and elapsed time do not prove active execution.
The reviewed abrupt-restart gate passes genuine owned-daemon SIGKILL and
same-database recovery to public `supervision_lost`, with complete cleanup.
Its additive CI gate is wired but not hosted-run certified. Current installed
wheel/console acceptance passes 4/4 outside the checkout on macOS/CPU.
Full platform/site/parity/release gates remain open.

### Previous daemon/browser status — 2026-10-13 (8a; historical)

The packaged manifest is now
`8a87ce6b055280a7c58606f044385614eaed2f7adbc7ba5b2d6183174bec0fa0`.
Blank numeric-list entries reject instead of silently becoming zero; YAML list
options retain their sequence values. Full frontend checks pass **650 tests**,
including explicit Python parser/effective-bootstrap export round trips for all
46 config destinations. Live-push gaps now reject before runtime provenance
mutation. Current browser recertification passes **12/12** with strict cleanup
and asset checks. Mapped Qt plotting passes the separate **6-case** gate with
simulated scheduler/storage visibility and actual CPU-generated plots; automatic
plots now pin verified publications and retain custom registrations. A broad
Python snapshot passed **3,467 tests**, and the later frozen run passes **3,476**
with 14 skips and 336 slow/GPU tests deselected, including final metadata cleanup.
The current ten-stage dashboard subgate also passes its strict verifier. A separate
real-browser authoring slice verifies all 44 mounted controls and 46 persisted
configuration destinations before approval (no execution claim). The mapped
automatic-plot browser slice now passes real CPU execution, source/import pins,
public lost-ACK retry, displayed PNG pixel matching and cleanup, with scheduler/
copy visibility explicitly simulated. Real-site and full-parity gates remain
open. The 6a records below
are historical, not current-8a certification.
Local CPU development remains runnable; full platform/site/release gates remain
open. See the acceptance ledger for exact boundaries.

### Previous daemon/browser status — 2026-10-13 (6a; historical)

The frozen web manifest after the guided-validation race fix is
`6a677b78cbb4d5bd87285ea6a9dca4e29892747bc9c76d53120f85b2b9765020`.
Current web contracts pass **626**, typecheck/lint/format pass, and generated
worker checks pass **35**. F02 journal fault coverage adds four cases; the focused
suite passes **49** (root rerun: **6.79 s**; agent JUnit:
`/private/tmp/wavedl-f02-hosted-journal-faults-20261013.xml`).

The current twelve-case browser aggregate passes **12/12** with strict current
asset/cleanup guard at
`/private/tmp/wavedl-browser-current-6a-20261013/wavedl-browser-acceptance-TUbgZl/summary.json`.
Node contracts pass **682/682**. The real wizard report passes strict verification
at `/private/tmp/wavedl-wizard-progression-check-5/wizard-progression-browser.json`;
19 focused wizard contracts also pass.
It covers native double-click, repeated-disabled acknowledgement and preserved
data, not a directly sampled transient validation lock.
Qt automatic-plot retry is implemented; root's
mandatory GUI suite passes **29 / zero skips in 44.25 s**, with strict guard:
`/private/tmp/wavedl-gui-mandatory-6a-20261013.xml`. The public retry button passes
real-HTTP/export-fault acceptance (agent: **14.07 s**); guard/service/dispatch/
shutdown checks pass **93 in 3.07 s**, including uncertainty unwind and late-worker
identity fences. Independent Qt review passes **11 tests with no material
findings**. Full non-slow/non-GPU Python validation passes **3,425 / 14 skipped /
336 deselected in 472.74 s** (`/private/tmp/wavedl-clean-python-6a-20261013.xml`),
including installed GUI checks.
Linux container foundations pass **2,364 / 52 skips** (core **783/12**, daemon
**1,581/40**, no failures/errors); the strict native guard accepts **13** required
cases. A subsequent guard fix passes **76** adversarial tests but is not included
in the 3,425-test full Python baseline. A fresh `--init` Linux guard rerun passes;
both task-owned containers are removed. This is not GPU/Windows/site certification.
All b3 reports below are historical unless explicitly rerun against 6a; in
particular the earlier 23-case GUI report does not satisfy the expanded guard.
T30c/T38, remote/GPU/Windows/Slurm/site, hosted CI and authorized release/Qt
retirement gates remain open.

The later current-6a continuation adds reviewed sparse-stream and ten-stage
dashboard acceptance (scheduler/native inputs are explicitly simulated), genuine
standalone adoption with lost-ack recovery, and **5** installed CLI/static checks.
Final local checks pass **706** tooling contracts, **627** frontend tests and
**35** generated-worker checks. See the
[acceptance ledger](docs/superpowers/plans/2026-10-08-migration-acceptance-ledger.md)
for exact evidence and remaining gates; these additions do not certify a release.

### Previous packaged evidence — 2026-10-13 (b3; historical)

The following records describe the previous b3 snapshot, not current-6a
recertification.

The current web bundle is the rebuilt `b3` package with manifest
`b3c63a860ed01b19e88ec4e8f572416a7cb767e32d889b2b985d5d80b7caabf9`.
The strict real-browser stream report
`/private/tmp/wavedl-stream-current-b3-20261013.json` passes: interrupted
byte-fragmented replay resumes at the control cursor, diagnostics are rendered
as an accessible focusable `role="log"`, and owned browser/fixture/services and
roots are cleaned up. This is stream/replay evidence only, not full browser
certification.

Current focused Python acceptance is **130 passed** (terminal, 5.08 s):
`QT_QPA_PLATFORM=offscreen PYTHONPATH=src cleanpython -m pytest
unit_tests/test_gui_reconnect_dispatch.py unit_tests/test_gui_training_service_daemon.py
unit_tests/test_gui_daemon_workers.py unit_tests/daemon/test_publication_crash_http.py
unit_tests/core/test_generations.py unit_tests/daemon/test_safe_artifacts.py -q`.
Current web contracts pass **623**, typecheck/lint/format pass, and generated
worker checks pass **35**. Diagnostic shortening now shows an omission marker
without splitting surrogate pairs or changing authoritative events/cursors.
Qt dashboard reconnect bypasses editable-draft validation while preserving daemon
and run identity fences; terminal/retired workers cannot submit a fresh empty draft.
The full b3 twelve-case aggregate passes its strict current-asset/cleanup guard:
`/private/tmp/wavedl-browser-current-b3-20261013/wavedl-browser-acceptance-B5sAHl/summary.json`.
Full non-slow/non-GPU Python validation passed **3,414 / 14 skipped / 336
deselected in 455.05 s** (`/private/tmp/wavedl-clean-python-b3-20261013.xml`).
The mandatory GUI guard passed **23 cases with zero skips in 42.57 s**
(`/private/tmp/wavedl-gui-mandatory-b3-20261013.xml`). Tooling contracts passed
**663**. Current b3 strict recertification also passes supported ONNX export at
`/private/tmp/wavedl-onnx-b3-rerun-20261013-report/onnx-export.json` and inference
cancellation at
`/private/tmp/wavedl-inference-cancel-b3-20261013-current-agent/inference-cancellation.json`.
The reviewed CV report
`/private/tmp/wavedl-cv-b3-reviewed-20261013-report/cv-parity.json` also passes
strict verification: summary text, durable plans, exact registry IDs, literal
headers and 96 CSV rows, with 22 focused tests. This is local two-fold CPU
classification only; full CV/T38 parity remains open.

The publication-crash HTTP slice exercises three `os._exit(73)` crash points:
partial copy, before marker and after marker. Incomplete publication returns 404,
prior bytes remain usable and retry publishes generation 3; a valid after-marker
publication remains served. It is not power-loss or real-site certification.
The new installed GUI probe passed **1/1 in 18.79 s**
(`/private/tmp/wavedl-installed-gui-root-b3-20261013.xml`), using inherited host
Qt/dependencies on POSIX; Windows is explicitly unsupported by this probe and no
isolated GUI resolver claim is made. Its mandatory POSIX CI step is added but not
remotely executed. Installed T39a **4/4** remains earlier 4d evidence.
The previous 4d aggregate remains historical; current-b3 submitted-plan and
oversized-artifact reports are recertified separately at
`/tmp/wavedl-submitted-parent-cnbuaB/report/submitted-plan-browser.json` and
`/tmp/wavedl-artifact-report-rwwXJC/artifact-publication-oversized-inventory.json`.

### Previous packaged evidence — 2026-10-12/13

The previous 4d packaged manifest was
`4d09580d5f443ec24698bbffe67eac58ee3019099514a2f513841ad3e81e7c34`.
Automatic plots now preserve approved host-side Python registration paths and
attest the resulting execution-side imports against the training manifest,
avoiding a second storage-map rewrite. Current checks pass 3,402 Python tests
(14 skips), 617 frontend tests, 641 tooling contracts and 35 generated-worker
checks. The assembled crash/replay harness covers both SQLite transaction write
orderings, and the assembled GUI lane covers 18 mandatory cases including
automatic-plot filesystem-fault recovery and ordinary daemon shutdown/reopen
without duplicate execution. These are local checks; they do not close T30c/T38
or certify hosted, Windows, GPU, Slurm, or release behavior.

The fresh twelve-case browser aggregate passed its strict current-build guard
against the 4d package after QA replaced an unstable native Enter interaction on
the configured-root combobox with a visible, hit-tested option click. Earlier
failed reports remain preserved. The rollover, sparse-stream, malformed-control,
and keyboard subgates are documented separately with their own package hashes;
they are not implicitly re-certified by this aggregate. Native/site/GPU and
release gates remain open.

### Previous frozen-build acceptance — 2026-10-12

The previous packaged asset manifest was
`54bc033f36361213fb73fa0ee28c9bb3a83451f2bbce71516de66189fc1d8ef0`.
The twelve-case browser guard passed against that build, along with adoption,
auth/skew, retained-storage (11 stages), native retained admission concurrency,
legacy-worker close/reopen transition, and assembled stream replay. Legacy evidence
includes an actual Workbox worker, an external authored YAML with `epochs=11`,
close/session absence, current-asset swap and explicit Update and reload consent.
Native concurrency proves one stale admission refusal, explicit retry, simultaneous
capacity refusal for two QA-scoped workers, three retained generations and cleanup.
Platform/site/GPU/Windows, hosted CI, full T38 and Qt-retirement release gates remain
open; these local reports are not a production deployment certificate.

### Previous 4d supported ONNX and cancellation evidence — 2026-10-13

The previous 4d supported-ONNX browser report
`/private/tmp/wavedl-p3-onnx-current4d-actualbrowser-v2/onnx-export.json` passes
strict verification after the exact-opset fix. It proves same-host CPU opset-17
export-only via an evaluation plan from a genuine checkpoint, finite output comparison, verified
publication/download identity and owned cleanup. The current inference-cancellation
report `/private/tmp/wavedl-inference-cancel-root-current4d-20261013-rerun/inference-cancellation.json`
also passes strict verification: a real runtime hello/PID reached running, was
cancelled, exited code 130 without publication, and cleaned up via graceful SIGINT.

Focused checks are 32 Python ONNX tests and 46 runtime/ONNX root tests, plus 17
ONNX and 31 cancellation Node contracts. The fresh full Python non-slow/non-GPU
rerun passed 3,402 tests (14 skipped, 336 deselected); 641 tooling contracts pass. Together
with the current 12-case aggregate and current submitted-plan, artifact-inventory
and result-operation reports, this is local 4d evidence only. CV, remote, GPU,
Windows, Slurm, full parity, T30c/T38, platform/site and release gates remain open.

---

## 💡 What is WaveDL?

WaveDL is a **deep learning framework** built for **wave-based inverse problems** — from ultrasonic NDE and geophysics to biomedical tissue characterization. It provides a robust, scalable training pipeline for mapping multi-dimensional data (1D/2D/3D) to physical quantities or dense 2D property fields.

```
Input: Waveforms, spectrograms, B-scans, dispersion curves, ...
   ↓
Output: Material properties, defect dimensions, elasticity/velocity maps, ...
```

The framework handles the engineering challenges of large-scale deep learning — big datasets, distributed training, and HPC deployment — so you can focus on the science, not the infrastructure.

**Built for researchers who need:**
- 📊 Vector and dense 2D regression with reproducibility and fair benchmarking
- 🚀 Seamless multi-GPU training on HPC clusters
- 💾 Memory-efficient handling of large-scale datasets
- 🔧 Easy integration of custom model architectures

---

## ✨ Features

<div align="center">
<table width="100%">
<tr>
<td width="50%" valign="top">

**⚡ Dataset Caching**

Prepare data for repeated training:
- Memory-mapped training caches
- Chunked HDF5 and MATLAB v7.3 preprocessing
- NPZ loading and cross-validation require host memory

</td>
<td width="50%" valign="top">

**🧠 Models? We've Got Options**

20+ architectures (70+ variants), ready to go:
- CNNs, ResNets, ViTs, SSMs, WaveNets...
- Vector regression plus a [dense-output U-Net](#dense-2d-field-regression)
- [Add your own](#adding-custom-models) in one line

</td>
</tr>
<tr>
<td width="50%" valign="top">

**🛡️ Distributed Training**

Coordinate training across ranks:
- Synchronized early stopping
- Collective epoch checkpoints
- Global validation metric aggregation

</td>
<td width="50%" valign="top">

**🔬 Physics-Constrained Training**

Make your model respect the laws:
- Enforce bounds, positivity, equations
- Simple expression syntax or Python
- [Custom constraints](#physical-constraints) for various laws

</td>
</tr>
<tr>
<td width="50%" valign="top">

**🖥️ HPC-Native Design**

Built for high-performance clusters:
- Automatic GPU detection
- WandB experiment tracking
- BF16/FP16 mixed precision

</td>
<td width="50%" valign="top">

**🔄 Training Recovery**

Resume interrupted experiments:
- Model, optimizer, and scheduler checkpoints
- Epoch-boundary resume
- Best-effort emergency saves on interrupt

</td>
</tr>
<tr>
<td width="50%" valign="top">

**🎛️ Flexible & Reproducible Training**

Fully configurable via CLI flags or YAML:
- Loss functions, optimizers, schedulers
- K-fold cross-validation
- See [Configuration](#️-configuration) for details

</td>
<td width="50%" valign="top">

**📦 ONNX Export**

Deploy models anywhere:
- One-command export to ONNX
- LabVIEW, MATLAB, C++ compatible
- Validated PyTorch↔ONNX outputs

</td>
</tr>
</table>
</div>

---

## 🚀 Getting Started

### Installation

#### From PyPI (recommended for all users)

```bash
pip install --upgrade wavedl
```

This installs the training, inference, HPO, and ONNX export dependencies.
The unreleased source requires Python 3.11+, PyTorch 2.13+, torchvision 0.28+,
and ONNX 1.22+. Install a compatible PyTorch/torchvision pair for your CPU or
CUDA/ROCm platform in a dedicated environment. Changes under `[Unreleased]`
are available from source until the next package release.

See [security and deployment boundaries](.github/SECURITY.md) for vulnerability
reporting procedures, safe deserialization practices, and secure data handling guidelines.

#### From Source (for development)

```bash
git clone https://github.com/ductho-le/WaveDL.git
cd WaveDL
pip install -e ".[dev]"
```

> [!NOTE]
> Python 3.11+ required. For contributor setup (pre-commit hooks), see [CONTRIBUTING.md](.github/CONTRIBUTING.md).

When building a distribution wheel, use a fresh checkout or clean temporary
source staging tree. Setuptools can retain deleted modules in an old `build/lib`
directory. The installed-package acceptance tests build in isolated staging and
check that retired downloader modules and local `AppData` are absent; do not
remove user databases or preferences to clean a build.

### Local browser client (development beta; primary interface)

The daemon/browser application is runnable for local CPU workflows, but is
still under acceptance review. Install the daemon extra from this checkout:

```bash
python -m pip install -e ".[dev,daemon]"
```

Use a dedicated Python environment for WaveDL. The daemon requires Starlette
1.3+; applications that pin Starlette below 1 (including some FastAPI versions)
cannot share that dependency environment. The selected training interpreter
must have WaveDL and its ML dependencies installed.

For a fresh local session, the recommended primary mode is a private
`--credential-file`. Create a private token **once** on macOS/Linux, outside the
repository. The command refuses to replace an existing token and prints only
its location:

```bash
python -c 'import os, secrets; from pathlib import Path; directory = Path.home() / ".wavedl"; directory.mkdir(mode=0o700, exist_ok=True); path = directory / "daemon-token"; descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600); stream = os.fdopen(descriptor, "w"); stream.write(secrets.token_urlsafe(32) + "\n"); stream.close(); print(path)'
```

Windows credentials require a user-private file ACL; Unix mode bits alone do not
provide that guarantee. Native Windows foundations and isolated installed CPU
acceptance pass on Python 3.11/3.13; this does not certify Windows GPU execution.

In the first terminal, start the daemon with that exact absolute path. Replace
the dataset path below with your own absolute directory:

```bash
wavedl-daemon serve --credential-file <absolute-token-path> --browse-root "datasets=/absolute/path/to/datasets"
```

Do not share or commit the token. Remote execution uses SSH forwarding and
explicit daemon-side paths, not a bare LAN HTTP address. The one-time bootstrap
URL is not the credential file. With the same state root and registry, daemon
identity is stable across restarts, `--credential-file` also preserves the master
token, and browser sessions are in memory, so after a daemon restart sign in again.
Without `--credential-file`, the master credential is ephemeral. Daemon-free
`wavedl-train` remains available below.

Open the one-time **bootstrap URL printed by the daemon** in your local browser.
In **New training run**, select the configured dataset, model and the absolute
Python interpreter from your installation. Preview the persisted plan, verify its
configuration, then explicitly approve it. **Datasets** provides bounded numerical
previews; a preview refusal does not necessarily mean a dataset cannot train.

This is a local CPU development workflow, not a completed Windows/GPU/Slurm or
production-release certification. Keep the master credential private and the
daemon loopback-only. The bootstrap exchange gives the browser a separate,
revocable session token; only that derived session envelope is stored, in
`sessionStorage` by default. **Stay signed in** on the connect screen opts into
`localStorage`; it is off by default. The envelope key is `wavedl.session.v1`.
Session tokens use a 12-hour idle sliding lifetime and a 7-day absolute lifetime.
The master bearer is never persisted, and
credentials are not placed in the URL after bootstrap. Reloading the page
resumes the same browser session without rotating its token. A rejected session
reports **Your session ended. Sign in again.** A changed daemon identity reports
**WaveDL was restarted or replaced. Sign in again.**
Only stored envelopes matching the rejected token are cleared. The sign-in
preference is remembered separately, and its switch is also available while
connected. Turning it off removes the localStorage credential copy. Explicitly
disconnect to revoke the session. Closing the browser
detaches monitoring and does not stop training. If you change web source,
regenerate and vendor its assets before using the daemon's browser client
(`npm run generate` in `web/`, followed by `python tools/vendor_web_assets.py`
from the repository root).

The browser workstation is online-only. Offline/PWA support, service-worker
precaching and retained browser builds were retired by the project owner on
2026-10-27; the browser does not cache application or API data for offline use.

The daemon's `/api/health` response identifies its web build. When the browser
detects a build mismatch, it shows **A newer WaveDL build is available — Reload**.
Reload only happens when you choose the button; save or export unsaved work first.
The browser does not silently reload. A same-daemon reload resumes the scoped
session; a daemon restart still requires opening the new bootstrap URL.

For clients that still have a worker registered from an older release, the
daemon serves `/sw.js` as a no-store, self-unregistering cleanup worker. It does
not clear site data or force a reload; after it activates, reopen or reload the
tab once to use the current online client.

A separate clean installed wheel with the `daemon` extra completed CPU training,
test, plot and ONNX export and passed `pip check`. That wheel's browser assets
predate the latest browser changes; it is not current-final-browser-asset acceptance.
The exact editable `.[dev,daemon]` install was resolver dry-run checked, not the
installed runtime used for that test. The dedicated-environment recommendation
above still applies.

The latest completed current-client twelve-case run passed **12/12** cases with
verified cleanup and the fail-closed CI-report CLI passing locally. Hosted CI
itself was not run. An isolated native dataset run also passed all five fixtures,
six interactive views and 29 genuinely decoded PNG exports. These are same-host
macOS/Chrome/CPU results, not complete T38/platform/site certification.
Contributor browser QA uses a fresh owned profile and
the test-only `--disable-optimization-guide-model-downloads-for-benchmarking`
startup switch to suppress Chromium's unrelated model downloads. It does not
change user browser settings or WaveDL export behavior. Unexpected non-PNG
downloads remain refused; the export/download guard has not been weakened.

### Historical acceptance continuation — 2026-10-11

The following entries retain their original build hashes, test totals and open
gates. They describe evidence at the time of each run, not current-build sign-off;
later evidence is tracked in the [acceptance ledger](docs/superpowers/plans/2026-10-08-migration-acceptance-ledger.md).

Current packaged assets hash
`3487e46c6e87bb9d40fbcd020dd9a5f8030a563aab52b0942093c956ec8b27cf` after the
adoption-component fix. Standalone adoption quality runs 5 and 6 each passed ten
assertions; the CLI guard accepted quality 6. Genuine standalone evidence covers
13 source files, one `COMPLETE`, and actual 200 → 503 → retry-200, not an adopted
PID/supervisor/job/submission receipt or cancellation. The API explicitly reports
`supervision_lost` uncertainty. Auth-skew CLI evidence passed with real CPU history,
401/build/protocol faults, reauth/detach, old-authority removal and unchanged
original plan/control/manifest; one derived automatic-plot source generation is
proven. Owned cleanup passed. Disposable credentials entered through native CLI
argv are not proof against local process-list visibility; reports contain no token.
The current 3487e twelve-case suite passed 12/12 in the dedicated
`/private/tmp/wavedl-browser-current.X2kTyd` run; the strict CLI guard accepted
all reports and verified cleanup. Current full non-slow/non-GPU Python validation
passed 3,251 tests with 14 platform skips. PWA restart/storage-loss/legacy,
full T38, Windows/GPU/site and release gates remain open.

The retained-browser report `/private/tmp/wavedl-retained-browser-current-20261011-b.json`
passed ten ordered stages, and `verify_retained_browser_report.mjs` exited 0. Its
restart stage reopened the same owned Chrome profile, verified exact g1–g3
CacheStorage/IndexedDB identity, a fresh document and per-generation Settings
chunks, then cleaned up. Storage loss/corruption, concurrency, legacy transition
and browser stream cursor gates remain open. Combined Node is 404/404.

After a Service Worker hard-refusal and admitted-static matcher fix, packaged
assets were rebuilt with hash
`af18842e79fde54a900655f8a4683a1546fe45a44f9cd520b06c1ae58b390978`.
The current frozen bundle passed 12/12 at
`/private/tmp/wavedl-browser-current-final-sw/wavedl-browser-acceptance-4FYKuM/summary.json`
and its CLI guard accepted exact current assets and cleanup. The assembled stream
subgate `/private/tmp/wavedl-stream-browser-final-f2/report.json` also passed its
strict verifier: real rendered history/diagnostics, a fragmented first SSE response,
cursor `0:-1` → `1:0` on the next request, read-only journal/registry authority and
owned cleanup. Raw non-ASCII UTF-8 was not observed in this CPU fixture; separate
ASGI tests cover split UTF-8. The retained storage report
`/private/tmp/wavedl-retained-browser-storage-20261011-b.json` passed 11 stages;
the verify guard exited 0. Its storage-loss stage deleted exactly three owned
CacheStorage buckets and the retained-builds IndexedDB database while the active
registration remained. Immutable and navigation requests then failed closed with
no network response or resurrection. Generated-worker checks pass 32/32 and
retained Vitest checks 28/28. This supersedes restart-only evidence; concurrency,
legacy transition, browser stream cursors and full T38/platform/site/release gates
remain open.

The final format-checked build is now
`f2d77eb7b246d0de1800cc8b295b685aaf77d1bee755ac9cf5213d274fea99d8`.
Fresh current-build twelve-case, adoption, auth/skew, 11-stage retained-storage
and assembled stream/replay runs all passed their strict guards. Frontend
validation passed 612 tests plus typecheck/lint/format; generated-worker tests
passed 33/33. The stream run establishes reconnect behavior through the next
public request, not a private browser cursor or raw multibyte UTF-8 delivery.
Native concurrent admission, legacy transition, broader T38 and platform/site/
release certification remain separate unfinished gates.

### Quick Start

> [!TIP]
> In all examples below, replace `<...>` placeholders with your values. See [Configuration](#️-configuration) for defaults and options.

### Training

```bash
# Basic training (auto-detects GPUs and environment)
wavedl-train --model <model_name> --data_path <train_data> --output_dir <output_folder>

# Detailed configuration
wavedl-train --model <model_name> --data_path <train_data> --batch_size <number> \
  --lr <number> --epochs <number> --patience <number> --compile --output_dir <output_folder>

# Multi-GPU is automatic (uses all available GPUs)
# Override with --num_gpus if needed
wavedl-train --model cnn --data_path train.npz --num_gpus 4 --output_dir results

# Resume training (automatic - just re-run with same output_dir)
wavedl-train --model <model_name> --data_path <train_data> --output_dir <output_folder>

# Force fresh start (archives prior training artifacts under previous_runs/)
wavedl-train --model <model_name> --data_path <train_data> --output_dir <output_folder> --fresh

# List available models
wavedl-train --list_models
```

> [!NOTE]
> `wavedl-train` automatically detects your environment:
> - **HPC clusters** (SLURM, PBS, etc.): Uses local caching, offline WandB
> - **Local machines**: Uses standard cache locations (~/.cache)
>
> **Auto-Resume**: Re-running an incomplete experiment with the same `--output_dir`
> selects an available checkpoint. Epoch checkpoints preserve the optimizer and
> learning-rate schedule. Emergency checkpoints replay the interrupted epoch and
> are not exact recovery; OneCycle recovery requires an epoch-boundary checkpoint.
> Use `--resume <checkpoint_directory>` to select one explicitly. `--fresh` archives
> prior training artifacts under `previous_runs/` and cannot be combined with `--resume`.
> Use a separate output/cache directory for every independent concurrent run.

<details>
<summary><b>Advanced: Direct Accelerate Launch</b></summary>

For fine-grained control over distributed training, you can use `accelerate launch` directly:

```bash
# Custom accelerate configuration
accelerate launch -m wavedl.train --model <model_name> --data_path <train_data> --output_dir <output_folder>

# Multi-node training
accelerate launch --num_machines 2 --main_process_ip <ip> -m wavedl.train --model cnn --data_path train.npz
```

</details>

### Testing & Inference

```bash
# Basic inference
wavedl-test --checkpoint <checkpoint_folder> --data_path <test_data>

# Custom architectures need explicit registration in each fresh inference process
wavedl-test --checkpoint <checkpoint_folder> --data_path <test_data> \
  --import my_model.py --model my_model --device cpu

# With visualization, prediction export, and multiple plot formats
wavedl-test --checkpoint <checkpoint_folder> --data_path <test_data> \
  --plot --plot_format png pdf --save_predictions --output_dir <output_folder>

# With custom parameter names
wavedl-test --checkpoint <checkpoint_folder> --data_path <test_data> \
  --param_names '$p_1$' '$p_2$' '$p_3$' --plot

# Export model to ONNX for deployment (LabVIEW, MATLAB, C++, etc.)
wavedl-test --checkpoint <checkpoint_folder> --data_path <test_data> \
  --export onnx --export_path <output_file.onnx>

# For 3D volumes with small depth (e.g., 8×128×128), override auto-detection
wavedl-test --checkpoint <checkpoint_folder> --data_path <test_data> \
  --input_channels 1
```

**Output:**

- **Console**: R², Pearson correlation, and MAE per parameter/channel; dense fields also report relative L2 error
- **Predictions** (with `--save_predictions`): vector outputs use CSV; dense fields use compressed `predictions.npz` with `target`, `prediction`, `error`, and `channel_names` arrays (or only `prediction` and `channel_names` when targets are absent)
- **Plots** (with `--plot`): vectors produce 10 publication-quality diagnostic plots; dense fields with ground truth produce target, prediction, and error maps
- **Format** (with `--plot_format`): Supported formats: `png` (default), `pdf` and `svg` (vector graphics), `eps` (LaTeX), `tiff`, `jpg`, `ps`

For dense fields, R² and Pearson correlation are computed independently per
property channel over all sample-pixel values and then averaged; MAE/RMSE also
aggregate spatial values, while relative L2 error averages sample/channel field
norms. Field plots are intentionally limited to the first three samples and six
channels to keep result directories manageable.

> [!NOTE]
> `wavedl-test` auto-detects the model architecture from checkpoint metadata. If unavailable, it falls back to folder name parsing. Use `--model` to override if needed.

### Dense 2D Field Regression

Use `--model unet_field` for supervised, pixel-wise prediction of an elasticity, stiffness, velocity, density, or similar 2D property map. This model is field-only; continue using `unet_regression` or another vector architecture for `(N, T)` targets. The built-in field model follows WaveDL's existing **single-channel input** convention: store each input as `(H_in, W_in)`, and the data loader adds the channel axis internally.

Accepted target layouts are:

| Stored target layout | Meaning | Model layout |
|----------------------|---------|--------------|
| `(N, H_out, W_out)` | One scalar field per sample | `(N, 1, H_out, W_out)` |
| `(N, C, H_out, W_out)` | `C` property fields per sample | unchanged |

Targets must be channels-first; channels-last arrays such as `(N, H, W, C)` are not guessed and should be transposed before saving. The 2D input and output grid resolutions are independent, so `(H_in, W_in)` may differ from `(H_out, W_out)`, but their spatial rank must match. `unet_field` infers the target grid during training and interpolates its dense head to that size. Each output channel is standardized independently using statistics over the training samples and both spatial axes, rather than fitting a separate scaler at every pixel.

Dense caches record their normalization version and rebuild automatically after
normalization changes. Checkpoints from the earlier experimental dense scaler
require retraining with `--fresh` or a new output directory. Vector checkpoints
retain their target normalization. Legacy Mamba/Vim weights are an exception:
the corrected selective scan changes predictions, so unversioned scan weights
are rejected. Use the original WaveDL version for legacy inference/resume, or
retrain with `--fresh`. New checkpoints store the scan version in their weights.
WaveNet retains the published optimizer parameter layout for resume compatibility.
Resuming also verifies that the current training
split has the same target normalization as the saved checkpoint.

This small synthetic example exercises different input/output grid sizes:

```python
import numpy as np

rng = np.random.default_rng(7)
wave_images = rng.normal(size=(80, 64, 96)).astype(np.float32)
property_maps = wave_images[:, ::2, ::2]  # (N, H_out, W_out) = (80, 32, 48)

np.savez(
    "field_data.npz",
    input_train=wave_images[:64],
    output_train=property_maps[:64],
    input_test=wave_images[64:],
    output_test=property_maps[64:],
)
```

```bash
wavedl-train --model unet_field --data_path field_data.npz --batch_size 4 --epochs 5 \
  --output_dir field_run

wavedl-test --checkpoint field_run/best_checkpoint --data_path field_data.npz \
  --param_names property --save_predictions --plot --output_dir field_results
```

For multiple output properties, stack maps on axis 1 to create `(N, C, H_out, W_out)` targets. The channel count is detected automatically; no output-grid CLI flag is required.

Dense decoders and target maps use substantially more GPU memory and disk than
vector regression. Start with a small batch size (for example, 1–8). Training
also creates `target_data_cache.dat` in the output directory with size roughly
`N × C × H_out × W_out × 4` bytes, so place the output directory on scratch
storage with adequate quota for large FWI or elastography datasets.

> [!IMPORTANT]
> This feature implements **supervised dense inversion**: it learns property fields from paired wave measurements and reference maps. It can provide a direct learned estimate or an initialization/prior for an FWI workflow, but it is not full waveform inversion by itself. True FWI requires a differentiable (or adjoint-gradient) wave solver and an iterative observed-versus-simulated data-consistency/misfit loop; that solver loop is not part of the current WaveDL CLI.

### Adding Custom Models

<details>
<summary><b>Creating Your Own Architecture</b></summary>

**Requirements** (for a vector-output model):

1. Inherit from `BaseModel`
2. Accept `in_shape`, `out_size` in `__init__`
3. Return a tensor of shape `(batch, out_size)` from `forward()`

---

**Step 1: Create `my_model.py`**

```python
import torch.nn as nn
import torch.nn.functional as F
from wavedl.models import BaseModel, register_model

@register_model("my_model")  # This name is used with --model flag
class MyModel(BaseModel):
    def __init__(self, in_shape, out_size, **kwargs):
        # in_shape: spatial dimensions, e.g., (128,) or (64, 64) or (32, 32, 32)
        # out_size: number of parameters to predict (auto-detected from data)
        super().__init__(in_shape, out_size)

        # Define your layers (this is just an example for 2D)
        self.conv1 = nn.Conv2d(1, 64, 3, padding=1)  # Input always has 1 channel
        self.conv2 = nn.Conv2d(64, 128, 3, padding=1)
        self.fc = nn.Linear(128, out_size)

    def forward(self, x):
        # Input x has shape: (batch, 1, *in_shape)
        x = F.relu(self.conv1(x))
        x = F.relu(self.conv2(x))
        x = x.mean(dim=[-2, -1])  # Global average pooling
        return self.fc(x)  # Output shape: (batch, out_size)
```

**Step 2: Train**

```bash
wavedl-train --import my_model.py --model my_model --data_path train.npz
```

Use the same trusted `--import` modules or `.py` files for inference, plotting,
and ONNX export. Daemon plans resolve registration files against the submission
directory and apply explicit host/execution storage mappings; named modules
must be available in the selected interpreter. Imports execute Python code and
are never inferred from checkpoint metadata. The browser Results form exposes
the import list explicitly; automatic plots retain the captured training list.

WaveDL handles everything else: training loop, logging, checkpoints, multi-GPU, early stopping, etc.

For a custom dense 2D model, also accept the inferred `out_shape=(C, H_out, W_out)`, set `supports_spatial_output = True` (and `requires_spatial_output = True` if it cannot emit vectors), and return exactly `(batch, C, H_out, W_out)`.

</details>

---

## 📁 Project Structure

```
WaveDL/
├── src/
│   └── wavedl/                   # Main package (namespaced)
│       ├── __init__.py           # Package init with __version__
│       ├── train.py              # Training script
│       ├── test.py               # Testing & inference script
│       ├── hpo.py                # Hyperparameter optimization
│       ├── launcher.py           # Training launcher (wavedl-train)
│       │
│       ├── models/               # Model Zoo (20+ architectures, 70+ variants)
│       │   ├── registry.py       # Model factory (@register_model)
│       │   ├── base.py           # Abstract base class
│       │   └── ...               # See "Available Models" section
│       │
│       └── utils/                # Utilities
│           ├── data.py           # Memory-mapped data pipeline
│           ├── metrics.py        # R², Pearson, visualization
│           ├── constraints.py    # Physical constraints for training
│           ├── distributed.py    # DDP synchronization
│           ├── losses.py         # Loss function factory
│           ├── optimizers.py     # Optimizer factory
│           ├── schedulers.py     # LR scheduler factory
│           └── config.py         # YAML configuration support
│
├── configs/                      # YAML config templates
├── examples/                     # Ready-to-run examples
├── notebooks/                    # Jupyter notebooks
├── unit_tests/                   # Pytest test suite
│
├── pyproject.toml                # Package config, dependencies
├── CHANGELOG.md                  # Version history
└── CITATION.cff                  # Citation metadata
```
---

## ⚙️ Configuration

> [!NOTE]
> All configuration options below work with `wavedl-train`. The wrapper script passes all arguments directly to `train.py`.

<a id="available-models"></a>
<details>
<summary><b>Available Models</b> — 20+ architectures (70+ variants)</summary>

**Output support**

| Output type | Built-in models | Stored target | Model output |
|-------------|-----------------|---------------|--------------|
| Vector regression | Every model except `unet_field` | `(N,)` or `(N, T)` | `(N, T)` |
| Dense 2D field | `unet_field` | `(N, H_out, W_out)` or `(N, C, H_out, W_out)` | `(N, C, H_out, W_out)` |

The dimensionality column below describes the **input**. A model accepting 2D
input does not automatically support dense output; look at the output-support
table above when selecting a model.

| Model | Backbone Params | Input Dim |
|-------|-----------------|-----------|
| **── Classic CNNs ──** |||
| **CNN** — Convolutional Neural Network |||
| `cnn` | 1.6M | 1D/2D/3D |
| **ResNet** — Residual Network |||
| `resnet18` | 11.2M | 1D/2D/3D |
| `resnet34` | 21.3M | 1D/2D/3D |
| `resnet50` | 23.5M | 1D/2D/3D |
| `resnet18_pretrained` ⭐ | 11.2M | 2D |
| `resnet50_pretrained` ⭐ | 23.5M | 2D |
| **DenseNet** — Densely Connected Network |||
| `densenet121` | 7.0M | 1D/2D/3D |
| `densenet169` | 12.5M | 1D/2D/3D |
| `densenet121_pretrained` ⭐ | 7.0M | 2D |
| **── Efficient/Mobile CNNs ──** |||
| **MobileNetV3** — Mobile Neural Network V3 |||
| `mobilenet_v3_small` ⭐ | 0.9M | 2D |
| `mobilenet_v3_large` ⭐ | 3.0M | 2D |
| **EfficientNet** — Efficient Neural Network |||
| `efficientnet_b0` ⭐ | 5.3M | 2D |
| `efficientnet_b2` ⭐ | 9.1M | 2D |
| `efficientnet_b4` ⭐ | 19M | 2D |
| `efficientnet_b7` ⭐ | 66M | 2D |
| **EfficientNetV2** — Efficient Neural Network V2 |||
| `efficientnet_v2_s` ⭐ | 20.2M | 2D |
| `efficientnet_v2_m` ⭐ | 52.9M | 2D |
| `efficientnet_v2_l` ⭐ | 117.2M | 2D |
| **RegNet** — Regularized Network |||
| `regnet_y_400mf` ⭐ | 3.9M | 2D |
| `regnet_y_800mf` ⭐ | 5.7M | 2D |
| `regnet_y_1_6gf` ⭐ | 10.3M | 2D |
| `regnet_y_3_2gf` ⭐ | 17.9M | 2D |
| `regnet_y_8gf` ⭐ | 37.4M | 2D |
| **── Modern CNNs ──** |||
| **ConvNeXt** — Convolutional Next |||
| `convnext_tiny` | 27.8M | 1D/2D/3D |
| `convnext_small` | 49.5M | 1D/2D/3D |
| `convnext_base` | 87.6M | 1D/2D/3D |
| `convnext_tiny_pretrained` ⭐ | 27.8M | 2D |
| **ConvNeXt V2** — ConvNeXt with GRN |||
| `convnext_v2_tiny` | 27.9M | 1D/2D/3D |
| `convnext_v2_small` | 49.6M | 1D/2D/3D |
| `convnext_v2_base` | 87.7M | 1D/2D/3D |
| `convnext_v2_tiny_pretrained` ⭐ | 27.9M | 2D |
| **UniRepLKNet** — Large-Kernel ConvNet |||
| `unireplknet_tiny` | 30.8M | 1D/2D/3D |
| `unireplknet_small` | 56.0M | 1D/2D/3D |
| `unireplknet_base` | 97.6M | 1D/2D/3D |
| **── Vision Transformers ──** |||
| **ViT** — Vision Transformer |||
| `vit_tiny` | 5.4M | 1D/2D |
| `vit_small` | 21.4M | 1D/2D |
| `vit_base` | 85.3M | 1D/2D |
| **Swin** — Shifted Window Transformer |||
| `swin_t` ⭐ | 27.5M | 2D |
| `swin_s` ⭐ | 48.8M | 2D |
| `swin_b` ⭐ | 86.7M | 2D |
| **MaxViT** — Multi-Axis ViT |||
| `maxvit_tiny` ⭐ | 30.1M | 2D |
| `maxvit_small` ⭐ | 67.6M | 2D |
| `maxvit_base` ⭐ | 119.1M | 2D |
| **── Hybrid CNN-Transformer ──** |||
| **FastViT** — Fast Hybrid CNN-ViT |||
| `fastvit_t8` ⭐ | 4.0M | 2D |
| `fastvit_t12` ⭐ | 6.8M | 2D |
| `fastvit_s12` ⭐ | 8.8M | 2D |
| `fastvit_sa12` ⭐ | 10.9M | 2D |
| **CAFormer** — MetaFormer with Attention |||
| `caformer_s18` ⭐ | 26.3M | 2D |
| `caformer_s36` ⭐ | 39.2M | 2D |
| `caformer_m36` ⭐ | 56.9M | 2D |
| `poolformer_s12` ⭐ | 11.9M | 2D |
| **EfficientViT** — Memory-Efficient ViT |||
| `efficientvit_m1` ⭐ | 2.6M | 2D |
| `efficientvit_b1` ⭐ | 7.5M | 2D |
| `efficientvit_b2` ⭐ | 21.8M | 2D |
| `efficientvit_l2` ⭐ | 60.5M | 2D |
| **── State Space Models ──** |||
| **Mamba** — State Space Model |||
| `mamba_1d` | 3.4M | 1D |
| **S4D** — Diagonal Structured State Space |||
| `s4d_small` | 0.8M | 1D |
| `s4d` | 3.2M | 1D |
| `s4d_large` | 11M | 1D |
| **Vision Mamba (ViM)** — 2D Mamba |||
| `vim_tiny` | 6.6M | 2D |
| `vim_small` | 51.1M | 2D |
| `vim_base` | 201.4M | 2D |
| **── Specialized Architectures ──** |||
| **TCN** — Temporal Convolutional Network |||
| `tcn_small` | 0.9M | 1D |
| `tcn` | 6.9M | 1D |
| `tcn_large` | 10.0M | 1D |
| **WaveNet** — Gated Dilated Conv Network |||
| `wavenet_small` | 1.0M | 1D |
| `wavenet` | 4.0M | 1D |
| `wavenet_large` | 15M | 1D |
| **ResNet3D** — 3D Residual Network |||
| `resnet3d_18` | 33.2M | 3D |
| `mc3_18` — Mixed Convolution 3D | 11.5M | 3D |
| **U-Net** — U-shaped Network |||
| `unet_regression` | 31.0M | 1D/2D/3D |
| `unet_field` 🗺️ | ~31.0M | 2D |


⭐ = **Pretrained on ImageNet** (recommended for smaller datasets). Weights are downloaded automatically on first use.

🗺️ = **Dense 2D field output**. Unmarked models produce regression vectors.

- **Cache location**: `~/.cache/torch/hub/checkpoints/` (or `./.torch_cache/` on HPC if home is not writable)
- **Use pretrained weights**: Pass `--pretrained` (default: train from scratch). Only effective for `*_pretrained` model variants marked with ⭐ above.

**💡 HPC Users**: If compute nodes block internet, pre-download weights on the login node:

```bash
# Run once on login node (with internet) — downloads ALL pretrained weights
# Uses download-only approach (no model instantiation) to avoid CPU time limits
python -c "
import os, torch, warnings
warnings.filterwarnings('ignore', category=UserWarning, module='pydantic')
os.environ['TORCH_HOME'] = '.torch_cache'  # Match WaveDL's HPC cache location
os.environ['HF_HOME'] = '.hf_cache'        # Match WaveDL's HPC cache for timm models

from torchvision import models as m
from torchvision.models import video as v

# === TorchVision + Video Models — download only, no model instantiation ===
urls = [
    ('ResNet18',         m.ResNet18_Weights.IMAGENET1K_V1.url),
    ('ResNet50',         m.ResNet50_Weights.IMAGENET1K_V1.url),
    ('EfficientNet_B0',  m.EfficientNet_B0_Weights.IMAGENET1K_V1.url),
    ('EfficientNet_B2',  m.EfficientNet_B2_Weights.IMAGENET1K_V1.url),
    ('EfficientNet_B4',  m.EfficientNet_B4_Weights.IMAGENET1K_V1.url),
    ('EfficientNet_B7',  m.EfficientNet_B7_Weights.IMAGENET1K_V1.url),
    ('EfficientNetV2_S', m.EfficientNet_V2_S_Weights.IMAGENET1K_V1.url),
    ('EfficientNetV2_M', m.EfficientNet_V2_M_Weights.IMAGENET1K_V1.url),
    ('EfficientNetV2_L', m.EfficientNet_V2_L_Weights.IMAGENET1K_V1.url),
    ('MobileNetV3_S',    m.MobileNet_V3_Small_Weights.IMAGENET1K_V1.url),
    ('MobileNetV3_L',    m.MobileNet_V3_Large_Weights.IMAGENET1K_V1.url),
    ('RegNet_Y_400MF',   m.RegNet_Y_400MF_Weights.IMAGENET1K_V1.url),
    ('RegNet_Y_800MF',   m.RegNet_Y_800MF_Weights.IMAGENET1K_V1.url),
    ('RegNet_Y_1_6GF',   m.RegNet_Y_1_6GF_Weights.IMAGENET1K_V1.url),
    ('RegNet_Y_3_2GF',   m.RegNet_Y_3_2GF_Weights.IMAGENET1K_V1.url),
    ('RegNet_Y_8GF',     m.RegNet_Y_8GF_Weights.IMAGENET1K_V1.url),
    ('Swin_T',           m.Swin_T_Weights.IMAGENET1K_V1.url),
    ('Swin_S',           m.Swin_S_Weights.IMAGENET1K_V1.url),
    ('Swin_B',           m.Swin_B_Weights.IMAGENET1K_V1.url),
    ('ConvNeXt_Tiny',    m.ConvNeXt_Tiny_Weights.IMAGENET1K_V1.url),
    ('DenseNet121',      m.DenseNet121_Weights.IMAGENET1K_V1.url),
    ('R3D_18',           v.R3D_18_Weights.KINETICS400_V1.url),
    ('MC3_18',           v.MC3_18_Weights.KINETICS400_V1.url),
]
cache = os.path.join(os.environ['TORCH_HOME'], 'hub', 'checkpoints')
os.makedirs(cache, exist_ok=True)
for name, url in urls:
    torch.hub.download_url_to_file(url, os.path.join(cache, os.path.basename(url)))
    print(f'  ✓ {name}')

# === Timm Models — download only via HuggingFace Hub ===
import timm
from huggingface_hub import hf_hub_download
timm_models = [
    'maxvit_tiny_tf_224', 'maxvit_small_tf_224', 'maxvit_base_tf_224',
    'fastvit_t8', 'fastvit_t12', 'fastvit_s12', 'fastvit_sa12',
    'caformer_s18', 'caformer_s36', 'caformer_m36', 'poolformer_s12',
    'convnextv2_tiny',
    'efficientvit_m1', 'efficientvit_b1', 'efficientvit_b2', 'efficientvit_l2',
]
for name in timm_models:
    cfg = timm.get_pretrained_cfg(name)
    if cfg.hf_hub_id:
        hf_hub_download(cfg.hf_hub_id, 'model.safetensors')
    elif cfg.url:
        torch.hub.download_url_to_file(cfg.url, os.path.join(cache, os.path.basename(cfg.url)))
    print(f'  ✓ {name}')

print(f'\n✓ All {len(urls) + len(timm_models)} pretrained weight files cached!')
"
```


</details>

<details>
<summary><b>Training Parameters</b></summary>

| Argument | Default | Description |
|----------|---------|-------------|
| `--model` | `cnn` | Model architecture |
| `--import` | - | Python file(s) to import for custom models (supports multiple) |
| `--batch_size` | `128` | Per-GPU batch size |
| `--lr` | `1e-3` | Learning rate |
| `--epochs` | `1000` | Maximum epochs |
| `--patience` | `20` | Early stopping patience |
| `--weight_decay` | `1e-4` | AdamW regularization |
| `--grad_clip` | `1.0` | Gradient clipping |
| `--grad_accum_steps` | `1` | Gradient accumulation steps (simulate larger batch sizes) |

</details>

<details>
<summary><b>Data & I/O</b></summary>

| Argument | Default | Description |
|----------|---------|-------------|
| `--data_path` | `train_data.npz` | Dataset path |
| `--workers` | `-1` | DataLoader workers per GPU (-1=auto-detect) |
| `--seed` | `2025` | Random seed |
| `--output_dir` | `.` | Output directory for checkpoints |
| `--selection_metric` | `loss` | Select checkpoints by configured loss or normalized `mse`; CV supports `loss` |
| `--allow_pickle` | `False` | Opt in to loading trusted legacy NPZ object arrays |
| `--resume` | `None` | Checkpoint to resume (auto-detected if not set) |
| `--save_every` | `50` | Checkpoint frequency |
| `--fresh` | `False` | Archive previous training artifacts and start fresh |
| `--single_channel` | `False` | Confirm data is single-channel (for shallow 3D volumes like `(8, 128, 128)`) |

</details>

<details>
<summary><b>Performance</b></summary>

| Argument | Default | Description |
|----------|---------|-------------|
| `--compile` | `False` | Enable `torch.compile` (recommended for long runs) |
| `--precision` | `bf16` | Mixed precision mode (`bf16`, `fp16`, `no`) |
| `--workers` | `-1` | DataLoader workers per GPU (-1=auto, up to 16) |
| `--wandb` | `False` | Enable W&B logging |
| `--wandb_watch` | `False` | Enable W&B gradient watching (adds overhead) |
| `--project_name` | `DL-Training` | W&B project name |
| `--run_name` | `None` | W&B run name (auto-generated if not set) |

**Automatic GPU Optimizations:**

WaveDL automatically enables performance optimizations for modern GPUs:

| Optimization | Effect | GPU Support |
|--------------|--------|-------------|
| **TF32 precision** | ~2x speedup for float32 matmul | A100, H100 (Ampere+) |
| **cuDNN benchmark** | Auto-tuned convolutions | All NVIDIA GPUs |
| **Worker scaling** | Up to 16 workers per GPU | All systems |

> [!NOTE]
> These optimizations are **backward compatible** — they have no effect on older GPUs (V100, T4, GTX) or CPU-only systems. No configuration needed.

**HPC Best Practices:**
- Stage data to `$SLURM_TMPDIR` (local NVMe) for maximum I/O throughput
- Use `--compile` for training runs > 50 epochs
- Increase `--workers` manually if auto-detection is suboptimal

</details>

<details>
<summary><b>Distributed Training Arguments</b></summary>

| Argument | Default | Description |
|----------|---------|-------------|
| `--num_gpus` | **Auto-detected** | Number of GPUs to use. By default, automatically detected via `nvidia-smi`. Set explicitly to override |
| `--num_machines` | `1` | Number of machines in distributed setup |
| `--mixed_precision` | `bf16` | Precision mode: `bf16`, `fp16`, or `no` |
| `--dynamo_backend` | `no` | PyTorch Dynamo backend |

**Environment Variables (for logging):**

| Variable | Default | Description |
|----------|---------|-------------|
| `WANDB_MODE` | `offline` | WandB mode: `offline` or `online` |

</details>

<a id="loss-functions"></a>
<details>
<summary><b>Loss Functions</b></summary>

| Loss | Flag | Best For | Notes |
|------|------|----------|-------|
| `mse` | `--loss mse` | Default, smooth gradients | Standard Mean Squared Error |
| `mae` | `--loss mae` | Outlier-robust, linear penalty | Mean Absolute Error (L1) |
| `huber` | `--loss huber --huber_delta 1.0` | Best of MSE + MAE | Robust, smooth transition |
| `smooth_l1` | `--loss smooth_l1` | Similar to Huber | PyTorch native implementation |
| `log_cosh` | `--loss log_cosh` | Smooth approximation to MAE | Differentiable everywhere |
| `weighted_mse` | `--loss weighted_mse --loss_weights "2.0,1.0,1.0"` | Prioritize specific targets/properties | Per-vector-target or per-field-channel weighting |

**Example:**
```bash
# Use Huber loss for noisy NDE data
wavedl-train --model cnn --loss huber --huber_delta 0.5

# Weighted MSE: prioritize thickness (first target)
wavedl-train --model cnn --loss weighted_mse --loss_weights "2.0,1.0,1.0"

# Dense maps: weight the first property channel twice as strongly
wavedl-train --model unet_field --loss weighted_mse --loss_weights "2.0,1.0" \
    --data_path field_data.npz --batch_size 4
```

</details>

<a id="optimizers"></a>
<details>
<summary><b>Optimizers</b></summary>

| Optimizer | Flag | Best For | Key Parameters |
|-----------|------|----------|----------------|
| `adamw` | `--optimizer adamw` | Default, most cases | `--betas "0.9,0.999"` |
| `adam` | `--optimizer adam` | Legacy compatibility | `--betas "0.9,0.999"` |
| `sgd` | `--optimizer sgd` | Better generalization | `--momentum 0.9 --nesterov` |
| `nadam` | `--optimizer nadam` | Adam + Nesterov | Faster convergence |
| `radam` | `--optimizer radam` | Variance-adaptive | More stable training |
| `rmsprop` | `--optimizer rmsprop` | RNN/LSTM models | `--momentum 0.9` |

**Example:**
```bash
# SGD with Nesterov momentum (often better generalization)
wavedl-train --model cnn --optimizer sgd --lr 0.01 --momentum 0.9 --nesterov

# RAdam for more stable training
wavedl-train --model cnn --optimizer radam --lr 1e-3
```

</details>

<a id="learning-rate-schedulers"></a>
<details>
<summary><b>Learning Rate Schedulers</b></summary>

| Scheduler | Flag | Best For | Key Parameters |
|-----------|------|----------|----------------|
| `plateau` | `--scheduler plateau` | Default, adaptive | `--scheduler_patience 10 --scheduler_factor 0.5` |
| `cosine` | `--scheduler cosine` | Long training, smooth decay | `--min_lr 1e-6` |
| `cosine_restarts` | `--scheduler cosine_restarts` | Escape local minima | Warm restarts |
| `onecycle` | `--scheduler onecycle` | Fast convergence | Super-convergence |
| `step` | `--scheduler step` | Simple decay | `--step_size 30 --scheduler_factor 0.1` |
| `multistep` | `--scheduler multistep` | Custom milestones | `--milestones "30,60,90"` |
| `exponential` | `--scheduler exponential` | Continuous decay | `--scheduler_factor 0.95` |
| `linear_warmup` | `--scheduler linear_warmup` | Warmup phase | `--warmup_epochs 5` |

**Example:**
```bash
# Cosine annealing for 1000 epochs
wavedl-train --model cnn --scheduler cosine --epochs 1000 --min_lr 1e-7

# OneCycleLR for super-convergence
wavedl-train --model cnn --scheduler onecycle --lr 1e-2 --epochs 50

# MultiStep with custom milestones
wavedl-train --model cnn --scheduler multistep --milestones "100,200,300"
```

</details>

<details>
<summary><b>Cross-Validation</b></summary>

For robust model evaluation, simply add the `--cv` flag:

```bash
# 5-fold cross-validation
wavedl-train --model cnn --cv 5 --data_path train_data.npz

# Dense 2D field cross-validation (non-stratified)
wavedl-train --model unet_field --cv 5 --data_path field_data.npz \
    --batch_size 4

# Stratified CV for unbalanced vector targets
wavedl-train --model cnn --cv 5 --cv_stratify --loss huber --epochs 100

# Full configuration
wavedl-train --model cnn --cv 5 --cv_stratify \
    --loss huber --optimizer adamw --scheduler cosine \
    --output_dir ./cv_results
```

| Argument | Default | Description |
|----------|---------|-------------|
| `--cv` | `0` | Number of CV folds (0=disabled, normal training) |
| `--cv_stratify` | `False` | Bin vector targets for stratified splitting; unsupported for dense fields |
| `--cv_bins` | `10` | Number of bins for stratified CV |

**Output:**
- `cv_summary.json`: Aggregated metrics (mean ± std)
- `cv_results.csv`: Per-fold detailed results
- `fold_*/`: Individual fold models and scalers

Dense field CV can require substantial host memory because folds are currently
materialized in memory. Do not combine it with `--cv_stratify`; use smaller
datasets/batches or run separate held-out experiments for very large field maps.
CV preserves custom loss weights, Huber delta, and pretrained initialization.
Physical constraints and gradient accumulation require standard training; CV
rejects these options instead of silently ignoring them. CV runs in one process
and currently selects folds using the configured loss (`--selection_metric loss`).

</details>

<details>
<summary><b>Configuration Files (YAML)</b></summary>

Use YAML files for reproducible experiments. CLI arguments can override any config value.

```bash
# Use a config file
wavedl-train --config configs/config.yaml --data_path train.npz

# Override specific values from config
wavedl-train --config configs/config.yaml --lr 5e-4 --epochs 500
```

**Example config (`configs/config.yaml`):**
```yaml
# Model & Training
model: cnn
batch_size: 128
lr: 0.001
epochs: 1000
patience: 20

# Loss, Optimizer, Scheduler
loss: mse
optimizer: adamw
scheduler: plateau

# Cross-Validation (0 = disabled)
cv: 0

# Performance
precision: bf16
compile: false
seed: 2025
```

> See [`configs/config.yaml`](configs/config.yaml) for the complete template with all available options documented.

</details>

<a id="physical-constraints"></a>
<details>
<summary><b>Physical Constraints</b> — Enforce Physics During Training</summary>

Add penalty terms to the loss function to enforce physical laws:

```
Total Loss = Data Loss + weight × penalty(violation)
```

### Expression Constraints

```bash
# Positivity
--constraint "y0 > 0"

# Bounds
--constraint "y0 >= 0" "y0 <= 1"

# Equations (penalize deviations from zero)
--constraint "y2 - y0 * y1"

# Input-dependent constraints
--constraint "y0 - 2*x[0]"

# Multiple constraints with different weights
--constraint "y0 > 0" "y1 - y2" --constraint_weight 0.1 1.0
```

### Custom Python Constraints

For complex physics (matrix operations, implicit equations):

```python
# my_constraint.py
import torch

def constraint(pred, inputs=None):
    """
    Args:
        pred:   (batch, num_outputs) vectors or (batch, C, H, W) fields
        inputs: (batch, features) or (batch, C, H, W) or (batch, C, D, H, W)
    Returns:
        Violation tensor; WaveDL reduces all returned values to one penalty.
    """
    # For vectors, y0/y1/y2 are (batch,). For dense outputs they are
    # (batch, H, W), so this same expression applies at every pixel.
    y0, y1, y2 = pred[:, 0], pred[:, 1], pred[:, 2]

    # Inputs — Tabular: (batch, features)
    # x0 = inputs[:, 0]                    # Feature 0
    # x_sum = inputs.sum(dim=1)            # Sum all features

    # Inputs — Images: (batch, C, H, W)
    # pixel = inputs[:, 0, 3, 5]           # Pixel at (3,5), channel 0
    # img_mean = inputs.mean(dim=(1,2,3))  # Mean over C,H,W

    # Inputs — 3D Volumes: (batch, C, D, H, W)
    # voxel = inputs[:, 0, 2, 3, 5]        # Voxel at (2,3,5), channel 0

    # Example constraints:
    # return y2 - y0 * y1                                    # Wave equation
    # return y0 - 2 * inputs[:, 0]                           # Output = 2×input
    # return inputs[:, 0, 3, 5] * y0 + inputs[:, 0, 6, 7] * y1  # Mixed

    return y0 - y1 * y2
```

```bash
--constraint_file my_constraint.py --constraint_weight 1.0
```

---

### Reference

| Argument | Default | Description |
|----------|---------|-------------|
| `--constraint` | — | Expression(s): `"y0 > 0"`, `"y0 - y1*y2"` |
| `--constraint_file` | — | Python file with `constraint(pred, inputs)` |
| `--constraint_weight` | `0.1` | Penalty weight(s) |
| `--constraint_reduction` | `mse` | `mse` (squared) or `mae` (linear) |

#### Expression Syntax

| Variable | Meaning |
|----------|---------|
| `y0`, `y1`, ... | Vector outputs `(B,)` or dense property channels `(B,H,W)` |
| `x[0]`, `x[1]`, ... | Input values (1D tabular) |
| `x[i,j]`, `x[i,j,k]` | Input values (2D/3D: images, volumes) |
| `x_mean`, `x_sum`, `x_max`, `x_min`, `x_std` | Input aggregates |

**Operators:** `+`, `-`, `*`, `/`, `**`, `>`, `<`, `>=`, `<=`, `==`

**Functions:** `sin`, `cos`, `exp`, `log`, `sqrt`, `sigmoid`, `softplus`, `tanh`, `relu`, `abs`

</details>



<details>
<summary><b>Hyperparameter Search (HPO)</b></summary>

Automatically find the best training configuration using [Optuna](https://optuna.org/).

**Run HPO:**

```bash
# Basic HPO (50 trials, auto-detects GPUs)
wavedl-hpo --data_path train.npz --n_trials 50

# Quick search (minimal search space, fastest)
wavedl-hpo --data_path train.npz --n_trials 30 --quick

# Medium search (balanced between quick and full)
wavedl-hpo --data_path train.npz --n_trials 50 --medium

# Full search with specific models
wavedl-hpo --data_path train.npz --n_trials 100 --models cnn resnet18 efficientnet_b0

# Dense field search (auto-selects unet_field and small batch candidates)
wavedl-hpo --data_path field_data.npz --n_trials 30

# In-process mode (enables pruning, faster, single-GPU)
wavedl-hpo --data_path train.npz --n_trials 50 --inprocess
```

> [!TIP]
> **GPU Detection**: HPO auto-detects GPUs and runs one trial per GPU in parallel. Use `--inprocess` for single-GPU with pruning support (early stopping of bad trials).

HPO inspects the target shape before creating a study. Vector data uses the
standard CNN/ResNet model presets and batch candidates 16/32/64/128. Dense data
uses `unet_field` and batch candidates 1/2/4/8. Explicit `--models` values are
validated against the target contract before any trials launch; use
`--batch_sizes` to override the memory-conscious dense defaults.

HPO compares trials using the same normalized validation MSE, even when their
training losses differ. It seeds the sampler and records a study signature covering
the dataset, search settings, and objective. Use a new study name when those
settings change or when migrating a legacy study without this signature; mixing
incompatible trials is rejected. Parallel trials lease distinct visible GPUs.

**Train with best parameters**

After HPO completes, it prints the optimal command:
```bash
wavedl-train --data_path train.npz --model cnn --lr 3.2e-4 --batch_size 128 ...
```

---

**What Gets Searched:**

| Parameter | Default | You Can Override With |
|-----------|---------|----------------------|
| Models | Vector: cnn, resnet18, resnet34; dense: unet_field | `--models X Y Z` |
| Optimizers | [all 6](#optimizers) | `--optimizers X Y` |
| Schedulers | [all 8](#learning-rate-schedulers) | `--schedulers X Y` |
| Losses | [all 6](#loss-functions) | `--losses X Y` |
| Learning rate | 1e-5 → 1e-2 | (always searched) |
| Batch size | Vector: 16, 32, 64, 128; dense: 1, 2, 4, 8 | `--batch_sizes N ...` |

**Search Presets:**

| Mode | Vector models | Dense models | Optimizers | Schedulers | Use Case |
|------|---------------|--------------|------------|------------|----------|
| Full (default) | cnn, resnet18, resnet34 | unet_field | all 6 | all 8 | Production search |
| `--medium` | cnn, resnet18 | unet_field | adamw, adam, sgd | plateau, cosine, onecycle | Balanced exploration |
| `--quick` | cnn | unet_field | adamw | plateau | Fast validation |

**Execution Modes:**

| Mode | Flag | Pruning | GPU Memory | Best For |
|------|------|---------|------------|----------|
| Subprocess (default) | — | ❌ No | Isolated | Multi-GPU parallel trials |
| In-process | `--inprocess` | ✅ Yes | Shared | Single-GPU with early stopping |

> [!TIP]
> Use `--inprocess` when running single-GPU trials. It enables MedianPruner to stop unpromising trials early, reducing total search time.

---

**All Arguments:**

| Argument | Default | Description |
|----------|---------|-------------|
| `--data_path` | (required) | Training data file |
| `--models` | Target-aware | Compatible models to search (specify any number) |
| `--n_trials` | `50` | Number of trials to run |
| `--quick` | `False` | Quick mode: minimal search space |
| `--medium` | `False` | Medium mode: balanced search space |
| `--inprocess` | `False` | Run trials in-process (enables pruning) |
| `--optimizers` | all 6 | Optimizers to search |
| `--schedulers` | all 8 | Schedulers to search |
| `--losses` | all 6 | Losses to search |
| `--batch_sizes` | Target-aware | Batch sizes to search |
| `--n_jobs` | `-1` | Parallel trials (-1 = auto-detect GPUs) |
| `--max_epochs` | `50` | Max epochs per trial |
| `--output` | `hpo_results.json` | Output file |


> See [Available Models](#available-models) for all 20+ architectures (70+ variants) you can search.

</details>

---

## 📈 Data Preparation

WaveDL supports multiple data formats for training and inference:

| Format | Extension | Key Advantages |
|--------|-----------|----------------|
| **NPZ** | `.npz` | Native NumPy, fast loading, recommended |
| **HDF5** | `.h5`, `.hdf5` | Large datasets, hierarchical, cross-platform |
| **MAT** | `.mat` | MATLAB compatibility (**v7.3+ only**, saved with `-v7.3` flag) |

**The framework automatically detects file format and data dimensionality** (1D, 2D, or 3D) — you only need to provide the appropriate model architecture.

| Key | Shape | Type | Description |
|-----|-------|------|-------------|
| `input_train` / `input_test` | `(N, L)`, `(N, H, W)`, or `(N, D, H, W)` | `float32` | N samples of 1D/2D/3D representations |
| `output_train` / `output_test` | `(N,)`, `(N, T)`, `(N, H, W)`, or `(N, C, H, W)` | `float32` | Scalar/vector targets, scalar 2D fields, or channels-first multi-property 2D fields |

> [!TIP]
> - **Flexible Key Names**: WaveDL auto-detects common key pairs:
>   - `input_train`/`output_train`, `input_test`/`output_test` (WaveDL standard)
>   - `X`/`Y`, `x`/`y` (ML convention)
>   - `data`/`labels`, `inputs`/`outputs`, `features`/`targets`
> - **Automatic Dimension Detection**: Channel dimension is added automatically. No manual reshaping required!
> - **Sparse Matrix Support**: NPZ and MAT v7.3 files with scipy/MATLAB sparse matrices are automatically converted to dense arrays.
> - **Auto-Normalization**: Vector targets are standardized per parameter. Dense targets are standardized per property channel over all training samples and pixels. MAE is reported in original physical units.
> - **Dense Target Layout**: Store a scalar map as `(N, H, W)` or multiple property maps as `(N, C, H, W)`. Convert channels-last targets explicitly before saving.

> [!IMPORTANT]
> **MATLAB Users**: MAT files must be saved with the `-v7.3` flag for memory-efficient loading:
> ```matlab
> save('data.mat', 'input_train', 'output_train', '-v7.3')
> ```
> Older MAT formats (v5/v7) are not supported. Convert to NPZ for best compatibility.

<details>
<summary><b>Example: Basic Preparation</b></summary>

```python
import numpy as np

X = np.array(images, dtype=np.float32)  # (N, H, W)
y = np.array(labels, dtype=np.float32)  # (N, T)

np.savez('train_data.npz', input_train=X, output_train=y)
```

</details>

<details>
<summary><b>Example: From Image Files + CSV</b></summary>

```python
import numpy as np
from PIL import Image
from pathlib import Path
import pandas as pd

# Load images
images = [np.array(Image.open(f).convert('L'), dtype=np.float32)
          for f in sorted(Path("images/").glob("*.png"))]
X = np.stack(images)

# Load labels
y = pd.read_csv("labels.csv").values.astype(np.float32)

np.savez('train_data.npz', input_train=X, output_train=y)
```

</details>

<details>
<summary><b>Example: From MATLAB (.mat)</b></summary>

```python
import numpy as np
from scipy.io import loadmat

data = loadmat('simulation_data.mat')
X = data['spectrograms'].astype(np.float32)  # Adjust key
y = data['parameters'].astype(np.float32)

# Transpose if needed: (H, W, N) → (N, H, W)
if X.ndim == 3 and X.shape[2] < X.shape[0]:
    X = np.transpose(X, (2, 0, 1))

np.savez('train_data.npz', input_train=X, output_train=y)
```

</details>

<details>
<summary><b>Example: Synthetic Test Data</b></summary>

```python
import numpy as np

X = np.random.randn(1000, 256, 256).astype(np.float32)
y = np.random.randn(1000, 5).astype(np.float32)

np.savez('test_data.npz', input_test=X, output_test=y)
```

</details>

<details>
<summary><b>Validation Script</b></summary>

```python
import numpy as np

data = np.load('train_data.npz')
assert data['input_train'].ndim >= 2, "Input must be at least 2D: (N, ...) "
assert data['output_train'].ndim in (1, 2, 3, 4), \
    "Output must be (N,), (N,T), (N,H,W), or (N,C,H,W)"
assert len(data['input_train']) == len(data['output_train']), "Sample mismatch"

print(f"✓ Input:  {data['input_train'].shape} {data['input_train'].dtype}")
print(f"✓ Output: {data['output_train'].shape} {data['output_train'].dtype}")
```

</details>


---

## 📦 Examples [![Try it on Colab](https://img.shields.io/badge/Try_it_on_Colab-8E44AD?style=plastic&logo=googlecolab&logoColor=white)](https://colab.research.google.com/github/ductho-le/WaveDL/blob/main/notebooks/demo.ipynb)

The `examples/` folder contains a **complete, ready-to-run example** for **material characterization of isotropic plates**. The pre-trained MobileNetV3 predicts three physical parameters from Lamb wave dispersion curves:

| Parameter | Unit | Description |
|-----------|------|-------------|
| $h$ | mm | Plate thickness |
| $\sqrt{E/\rho}$ | km/s | Square root of Young's modulus over density |
| $\nu$ | — | Poisson's ratio |

> [!NOTE]
> This example is based on our paper at **SPIE Smart Structures + NDE 2026**: [*"A lightweight deep learning model for ultrasonic assessment of plate thickness and elasticity"*](https://doi.org/10.1117/12.3090206) (Proc. SPIE 13951, 1395106).

**Sample Dispersion Data:**

<p align="center">
  <img src="examples/elasticity_prediction/dispersion_samples.png" alt="Dispersion curve samples" width="700"><br>
  <em>Test samples showing the wavenumber-frequency relationship for different plate properties</em>
</p>

**Try it yourself:**

```bash
# Run inference on the example data
wavedl-test --checkpoint ./examples/elasticity_prediction/best_checkpoint \
  --data_path ./examples/elasticity_prediction/Test_data_100.mat \
  --plot --save_predictions --output_dir ./examples/elasticity_prediction/test_results

# Export to ONNX (already included as model.onnx)
wavedl-test --checkpoint ./examples/elasticity_prediction/best_checkpoint \
  --data_path ./examples/elasticity_prediction/Test_data_100.mat \
  --export onnx --export_path ./examples/elasticity_prediction/model.onnx
```

**What's Included:**

| File | Description |
|------|-------------|
| `best_checkpoint/` | Pre-trained MobileNetV3 checkpoint |
| `Test_data_100.mat` | 100 sample test set (500×500 dispersion curves → $h$, $\sqrt{E/\rho}$, $\nu$) |
| `dispersion_samples.png` | Visualization of sample dispersion curves with material parameters |
| `model.onnx` | ONNX export with embedded de-normalization |
| `training_history.csv` | Epoch-by-epoch training metrics (loss, R², LR, etc.) |
| `training_curves.png` | Training/validation loss and learning rate plot |
| `test_results/` | Example predictions and diagnostic plots |
| `WaveDL_ONNX_Inference.m` | MATLAB script for ONNX inference |

**Training Progress:**

<p align="center">
  <img src="examples/elasticity_prediction/training_curves.png" alt="Training curves" width="600"><br>
  <em>Training and validation loss with <code>plateau</code> learning rate schedule</em>
</p>

**Inference Results:**

<p align="center">
  <img src="examples/elasticity_prediction/test_results/scatter_all.png" alt="Scatter plot" width="700"><br>
  <em>Figure 1: Predictions vs ground truth for all three elastic parameters</em>
</p>

<p align="center">
  <img src="examples/elasticity_prediction/test_results/error_histogram.png" alt="Error histogram" width="700"><br>
  <em>Figure 2: Distribution of prediction errors showing near-zero mean bias</em>
</p>

<p align="center">
  <img src="examples/elasticity_prediction/test_results/residuals.png" alt="Residual plot" width="700"><br>
  <em>Figure 3: Residuals vs predicted values (no heteroscedasticity detected)</em>
</p>

<p align="center">
  <img src="examples/elasticity_prediction/test_results/bland_altman.png" alt="Bland-Altman plot" width="700"><br>
  <em>Figure 4: Bland-Altman analysis with ±1.96 SD limits of agreement</em>
</p>

<p align="center">
  <img src="examples/elasticity_prediction/test_results/qq_plot.png" alt="Q-Q plot" width="700"><br>
  <em>Figure 5: Q-Q plots confirming normally distributed prediction errors</em>
</p>

<p align="center">
  <img src="examples/elasticity_prediction/test_results/error_correlation.png" alt="Error correlation" width="300"><br>
  <em>Figure 6: Error correlation matrix between parameters</em>
</p>

<p align="center">
  <img src="examples/elasticity_prediction/test_results/relative_error.png" alt="Relative error" width="700"><br>
  <em>Figure 7: Relative error (%) vs true value for each parameter</em>
</p>

<p align="center">
  <img src="examples/elasticity_prediction/test_results/error_cdf.png" alt="Error CDF" width="500"><br>
  <em>Figure 8: Cumulative error distribution — 95% of predictions within indicated bounds</em>
</p>

<p align="center">
  <img src="examples/elasticity_prediction/test_results/prediction_vs_index.png" alt="Prediction vs index" width="700"><br>
  <em>Figure 9: True vs predicted values by sample index</em>
</p>

<p align="center">
  <img src="examples/elasticity_prediction/test_results/error_boxplot.png" alt="Error box plot" width="400"><br>
  <em>Figure 10: Error distribution summary (median, quartiles, outliers)</em>
</p>

---

## 🔬 Broader Applications

Beyond the material characterization example above, the WaveDL pipeline can be adapted for a wide range of **wave-based inverse problems** across multiple domains:

### 🏗️ Non-Destructive Evaluation & Structural Health Monitoring

| Application | Input | Output |
|-------------|-------|--------|
| Defect Sizing | A-scans, phased array images, FMC/TFM, ... | Crack length, depth, ... |
| Corrosion Estimation | Thickness maps, resonance spectra, ... | Wall thickness, corrosion rate, ... |
| Weld Quality Assessment | Phased array images, TOFD, ... | Porosity %, penetration depth, ... |
| RUL Prediction | Acoustic emission (AE), vibration spectra, ... | Cycles to failure, ... |
| Damage Localization | Wavefield images, DAS/DVS data, ... | Damage coordinates (x, y, z) |

### 🌍 Geophysics & Seismology

| Application | Input | Output |
|-------------|-------|--------|
| Seismic Inversion | Shot gathers, seismograms, ... | Velocity models, density profiles, ... |
| Subsurface Characterization | Surface wave dispersion, receiver functions, ... | Layer thickness, shear modulus, ... |
| Earthquake Source Parameters | Waveforms, spectrograms, ... | Magnitude, depth, focal mechanism, ... |
| Reservoir Characterization | Reflection seismic, AVO attributes, ... | Porosity, fluid saturation, ... |

### 🩺 Biomedical Ultrasound & Elastography

| Application | Input | Output |
|-------------|-------|--------|
| Tissue Elastography | Shear wave data, strain images, ... | Shear modulus, Young's modulus, ... |
| Liver Fibrosis Staging | Elastography images, US RF data, ... | Stiffness (kPa), fibrosis score, ... |
| Tumor Characterization | B-mode + elastography, ARFI data, ... | Lesion stiffness, size, ... |
| Bone QUS | Axial-transmission signals, ... | Porosity, cortical thickness, elastic modulus ... |

> [!NOTE]
> Adapting WaveDL to these applications requires preparing your own dataset and choosing a suitable model architecture to match your input and target dimensionality. Dense maps use supervised `unet_field` training as described above; conventional FWI still requires an external wave solver and data-misfit optimization loop.

---

## 📚 Documentation

| Resource | Description |
|----------|-------------|
| Technical Paper | In-depth framework description *(coming soon)* |
| [`_template.py`](src/wavedl/models/_template.py) | Template for custom architectures |

---

## 📜 Citation

If you use WaveDL in your research, please cite our published paper:

```bibtex
@article{le2026wavedl,
  author = {Le, Ductho and Phan, Haidang and Sacchi, Mauricio D. and Le, Lawrence H.},
  title = {{WaveDL}: A Scalable Deep Learning Framework for Wave-Based Inverse Problems},
  journal = {Computer Physics Communications},
  volume = {329},
  pages = {110400},
  year = {2026},
  doi = {10.1016/j.cpc.2026.110400},
  url = {https://doi.org/10.1016/j.cpc.2026.110400}
}
```

Or in APA format:
> Le, D., Phan, H., Sacchi, M. D., & Le, L. H. (2026). WaveDL: A scalable deep learning framework for wave-based inverse problems. *Computer Physics Communications*, 329, 110400. https://doi.org/10.1016/j.cpc.2026.110400

Please also consider to cite other related papers:

```bibtex
@inproceedings{le2026lightweight,
  author = {Le, Ductho and Sacchi, Mauricio D. and Zhang, Xu and Ta, Dean and Lou, Edmond and Le, Lawrence H.},
  title = {A lightweight deep learning model for ultrasonic assessment of plate thickness and elasticity},
  booktitle = {Health Monitoring of Structural and Biological Systems XX},
  volume = {13951},
  pages = {1395106},
  year = {2026},
  publisher = {SPIE},
  doi = {10.1117/12.3090206},
  url = {https://doi.org/10.1117/12.3090206}
}
```

Or in APA format:
> Le, D., Sacchi, M. D., Zhang, X., Ta, D., Lou, E., & Le, L. H. (2026). A lightweight deep learning model for ultrasonic assessment of plate thickness and elasticity. *Proc. SPIE 13951, Health Monitoring of Structural and Biological Systems XX*, 1395106. https://doi.org/10.1117/12.3090206

---

## 🙏 Acknowledgments

Ductho Le would like to acknowledge [NSERC](https://www.nserc-crsng.gc.ca/) and [Alberta Innovates](https://albertainnovates.ca/) for supporting his study and research by means of a research assistantship and a graduate doctoral fellowship.

This research was enabled in part by support provided by [Compute Ontario](https://www.computeontario.ca/), [Calcul Québec](https://www.calculquebec.ca/), and the [Digital Research Alliance of Canada](https://alliancecan.ca/).

<br>

<p align="center">
  <a href="https://www.ualberta.ca/"><img src="logos/ualberta.png" alt="University of Alberta" height="60"></a>
  &emsp;&emsp;
  <a href="https://albertainnovates.ca/"><img src="logos/alberta_innovates.png" alt="Alberta Innovates" height="60"></a>
  &emsp;&emsp;
  <a href="https://www.nserc-crsng.gc.ca/"><img src="logos/nserc.png" alt="NSERC" height="60"></a>
</p>

<p align="center">
  <a href="https://alliancecan.ca/"><img src="logos/drac.png" alt="Digital Research Alliance of Canada" height="50"></a>
</p>

---

<div align="center">

**[Ductho Le](mailto:ductho.le@outlook.com)** · University of Alberta

[![ORCID](https://img.shields.io/badge/ORCID-0000--0002--3073--1416-a6ce39?style=plastic&logo=orcid&logoColor=white)](https://orcid.org/0000-0002-3073-1416)
[![Google Scholar](https://img.shields.io/badge/Google_Scholar-4285F4?style=plastic&logo=google-scholar&logoColor=white)](https://scholar.google.ca/citations?user=OlwMr9AAAAAJ)
[![ResearchGate](https://img.shields.io/badge/ResearchGate-00CCBB?style=plastic&logo=researchgate&logoColor=white)](https://www.researchgate.net/profile/Ductho-Le)

<sub>May your signals be strong and your attenuation low 👋</sub>

</div>
