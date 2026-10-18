# Daemon/browser acceptance ledger — 2026-10-08

## Current product scope — 2026-10-15 (normative)

Accept a brand-new daemon/browser application, not migration of legacy Qt users.
T30a/T30b compatibility and T40/R1/T41's deprecation/Qt-retaining-release sequence
are superseded non-goals. No old-user-data migration or Qt backward compatibility
is required. Temporarily retained Qt sources in the dirty checkout are unshipped
historical material, not the active product; physical deletion is not claimed.
Preserve existing user files.

The 24 P0 capabilities remain functional browser product requirements. T30c's
API/protocol, durable-state, crash/replay recovery, security and ownership
safeguards remain unchanged. Real-site filesystem/Slurm evidence is required
before declaring HPC support. T38 and final T42 daemon/browser package, CLI,
browser and supported-platform validation remain open; tagging/publishing needs
explicit approval. Dated evidence below is not fresh cutover acceptance. This
decision and the current dependency table supersede older Qt-transition gates.

This is an evidence ledger, **not T30c or T38 sign-off**. It supplements the
corrected migration task structure and the 2026-10-04 web parity matrix without
changing their functional/reliability requirements under the current scope above.
All 24 P0 rows and all 15 architecture §16 failure
categories are retained below. Passing component tests establish only their
tested boundary; a local CPU browser scenario does not certify remote execution,
native Windows, GPU cancellation, or a real Slurm site's filesystem.

## Evidence boundary and notation

### Hosted validation in progress — 2026-10-19

The approved review branch is `review/daemon-browser-ci-2026-10-19`; no tag,
release or publication has been created. At commit `ec7b783`, hosted **Tests**
run `39149255592` succeeds on Python 3.11, 3.12 and 3.13: each reports **3,804
passed / 35 skipped / 336 deselected**. The Python 3.11 dependency-resolved
installed-wheel gate also passes. Hosted static-client run `39148790131` at
`beb2dee` passes typecheck, lint, format checks, generation, **820 browser tests
/ one skip**, and **38 generated-worker tests / zero skips**. Browser inputs
are unchanged between these two commits. Lint is also green at both revisions.

Linux and macOS foundations pass on Python 3.11 and 3.13. Native Windows remains
open: the runner's default object owner differs from its actual user, correctly
triggering the product's strict ownership checks. A reviewed test-only wrapper
now sets and restores the test process's default owner before fixture creation;
an unwrapped native witness checks restoration and child-created file ownership.
Production ownership/DACL rules are unchanged. Native test fixtures also retain
explicit Windows write/rename-denial and unchanged-byte witnesses instead of
assuming POSIX mutation behavior. These fixes still require hosted confirmation.

Clean tracked-source validation exposed and fixed an ignored shadcn utility.
GitHub workflow-context validation and two stale upload-step test lookups were
also corrected. The latest reviewed local batch passes **1,649 Node contracts**,
**869 core tests / six platform skips**, and **32 wrapper/release tests / one
native-Windows skip**, with pinned Ruff checks and actionlint. The earlier
browser integration runs failed; downstream missing-evidence failures do not
become independent product failures or successful acceptance. A fresh complete
browser/CPU lane is still required, as are final supported-platform, GPU and
real-site Slurm/filesystem gates. T30c/T38/T42 are not signed off here.

An isolated Nuxt 4.6.2 trial removes the critical build-tool advisory path, but
changes browser assets and the Node support floor; it has not been adopted.
Two transitive build-tool advisory roots remain in that trial. This is not a
clean dependency-audit claim or authority to bypass final package acceptance.

### Current authority-corrected source and bundle — 2026-10-18

#### Latest Linux CPU isolated artifact acceptance

The exact current wheel and sdist now also pass dependency-resolved **Linux
arm64 / Python 3.13.16 CPU** acceptance, not just the dependency-light lane.
The selected official CPU stack is Torch **2.14.1+cpu**, torchvision
**0.29.1+cpu**, Triton **3.8.0**; CUDA is unavailable. A complete wheelhouse was
downloaded from the installed exact dependency versions, then each artifact was
installed into a fresh virtual environment with no system-site packages, no
checkout leakage and **network disabled**. `pip check`, console entry points,
real daemon-free CPU training, exact bundled assets, single-use bootstrap,
authenticated health/client planning, shutdown, reacquired lock and SQLite
integrity checks all pass. Root and independent Sol review pass.

| Exact artifact | Linux acceptance report | Result / SHA-256 |
|---|---|---|
| Wheel `93f957fe4286e391dd2eb331d8977b7a276bcfa30c065983fc279ee49e741f79` | `/private/tmp/wavedl-linux-ml-wheel.HbWpnP/installed-acceptance.xml` | 1 passed, zero skips; `75e1d75e3ad264e69dc7c63f7dcb7c091cef65baf0e3d2969ba83dab39dcaa77` |
| Sdist `d67688f26b144a54a7ff927e6bcecb291bb9cfc48c3d051b513a9a38183affeb` | `/private/tmp/wavedl-linux-ml-sdist.ZxoTC3/installed-acceptance.xml` | 1 passed, zero skips; `fd27b11f56c6fe977b8412b9f14786dcd78322fe6831714232df4def9e920fd4` |

Both containers exit zero without OOM, with capabilities dropped, read-only
source/root, UID 501, 4 GiB/3 CPU limits and private persistent scratch volumes.
Each retained `standalone-cpu` output contains eight events, one genuine metric,
exit code zero and one complete checkpoint publication. Journal hashes are
`af646f18d7323df554c2222d4bdbd8cf97e3e210ea4e380f4e2794980a4b938a`
(wheel) and `7b828ee44ac4252b740dcafe5e78e3bce838b7b45225cf9f1f2de9aac1f16e4b`
(sdist). Reports, journals/checkpoints and provenance are retained; both stopped
acceptance containers and their exact task-labelled virtual-environment volumes
were removed after inspection. Existing user containers/data were untouched.

Provenance: `/private/tmp/wavedl-linux-ml-image.dOun0m/provenance.json`, SHA-256
`78eec271005d9e8447cb5753b6b4a8776ac41fd801c43a26a39a370547e3513d`.
Its Dockerfile and wheelhouse-export script remain beside it. This closes the
scoped Linux-VM CPU isolated-install/training lifecycle, not native Linux-host,
hosted CI, Windows/GPU, `torch.compile`, real Slurm/site or complete T42.

A separate read-only default-PyPI resolver check also succeeds for this exact
wheel, resolving 104 distributions; report
`/private/tmp/wavedl-linux-wheel-resolver.ZF9wpQ/resolver.json`, SHA-256
`afcd1ea2a2d261946bd17c532a5e2e683b0d96bab915bec96a1a0d4b9d979edd`.
It confirms an available aarch64 Triton wheel, so no speculative architecture
marker change was made. It is not runtime certification of the default CUDA
dependency set. The broader Linux CPU regression is recorded separately after
terminal verification; no running or interrupted test counts imply a pass.

The broader read-only-source harness sets Triton/Inductor cache roots inside its
private writable job volume. One test-only HPC-environment fixture also needed
isolation: it formerly ran a simulated unwritable-home job in the repository
and restored only three variables, leaking a bad `TORCH_HOME` into later tests.
It now changes to an owned temporary job directory, tracks/restores all 13
variables (including previously absent keys), verifies cache paths and restores
CWD. Its original offline checks remain and additional restoration assertions
are present. All **63 CLI tests** pass on host Python 3.11 and actual Linux 3.13;
independent Sol review confirms no production change or weakened assertions.
The interrupted first run and the subsequent nine-failure run remain failed
precursors; all nine latter failures name the same read-only cache path.

The corrected full Linux CPU regression now completes with **3,800 passed / 35
skipped / 336 deselected**, zero failures/errors, in 561.76 seconds. XML:
`/private/tmp/wavedl-linux-ml-regression-verified.tKOkCr/unit-tests.xml`, SHA-256
`c550998fd1be05a3771971ae201b4cc0b9f16340f702da5ae89171f1e1b6d2c0`.
The command is the CI non-slow/non-GPU selection, with no extra exclusions.
Root and independent Sol inspect the unmodified full XML, not a synthetic
native-report projection: all 13 required POSIX cases pass, as do actual CPU
training, two-rank/launcher, inference/export, hosted numerical operations,
requeue/setup/stage-out and the corrected environment fixture families.

The 35 skips are exactly 13 native Windows, 16 macOS-specific, four retained
unshipped Qt metric cases, the unconfigured isolated-wheelhouse opt-in and the
separately exercised tmpfs opt-in. The wheel/sdist and tmpfs gates have their own
passing reports; these skips are not promoted to cross-platform proof. The
container exits zero without OOM, with network disabled, source/root read-only,
UID 501, private persistent cache/work directories and 5 GiB/3 CPU limits.
Provenance is beside the XML, SHA-256
`4127c94b816f88823e8b77167c22f1106fa917f30f6462f0ea84d19820fb3f6c`.
Its stopped container and exact task-labelled scratch volume were removed after
verification; reports, copied isolated-training outputs and QA image/recipe are
retained. Existing user containers and data were not touched. This is selected
Linux-VM CPU stack evidence, not GPU, Windows, real Slurm/site, hosted CI,
native-host Linux or final release approval.

#### Latest protocol bound and pinned-tool correction

The full Linux Python 3.13 foundations run exposed that relying on the JSON
decoder's recursion limit no longer rejects a 2,000-container wire value.
`strict_loads` now enforces an explicit **32-container** lexical nesting bound
before decoding, independent of interpreter recursion behavior. Quoted brackets
and escape sequences do not count, invalid JSON still reaches syntax validation,
and rejection uses a fixed nonsecret diagnostic. This is related to, not exactly
the same counting as, the browser's root-at-zero node-depth budget. Existing
`bytearray` transport input is preserved and UTF-8 decoded without mutating it.
Root and independent Sol review pass; **79** focused protocol/transport/live
stream tests pass, including actual loopback requests and replay.

Fresh macOS core/daemon regression: **2,721 passed / 15 skipped**, zero
failures/errors, `/private/tmp/wavedl-core-daemon-protocol-final.xml` (SHA-256
`3505d34abd134b9246495382da279f40ba4a9c9eb0526afa5f7df0118c66d3a0`).
The earlier depth-only run remains a failed precursor: it exposed mutable-buffer
compatibility before the fix, and is not promoted to acceptance.

Pinned CI Ruff **0.14.10** revealed one lambda-wrap difference that local Ruff
0.15 accepted. A targeted patch resolves it; the clean source snapshot passes
global pinned lint/format checks across **481 files**. No formatter/autofix ran.
The public-state-root test also explicitly creates/asserts mode 0755, so a private
test-process umask cannot accidentally turn its refusal witness into mode 0700.

Latest exact artifacts, from
`/private/tmp/wavedl-protocol-final-package.1KLGQU/dist`, contain current
`protocol.py`, `runtime_service.py` and `controller.py` bytes, all 38 be6 assets
and no Qt package. Independent inventory review passes. Each exact artifact
passes dependency-resolved isolated lifecycle acceptance with zero skips:

| Artifact | SHA-256 | Isolated result |
|---|---|---|
| Wheel | `93f957fe4286e391dd2eb331d8977b7a276bcfa30c065983fc279ee49e741f79` | 1 passed; `/private/tmp/wavedl-isolated-wheelhouse-protocol-final.xml`, SHA-256 `9576b4636b61e2e53b5950a83da3de89003c153d72f2de751a27963f6b48e940` |
| Sdist | `d67688f26b144a54a7ff927e6bcecb291bb9cfc48c3d051b513a9a38183affeb` | 1 passed; `/private/tmp/wavedl-isolated-sdist-protocol-final.xml`, SHA-256 `aae52973d7b4bdc51d464d923cdfc16f74f67f3e5bfe6186521e8f43ddf0aecd` |

The journal-fault QA fixture additionally fixes a witnessed Linux publication
race: a destination appears while its temporary hardlink still exists, so path
existence cannot mean a single-link snapshot is ready. A separate owned empty
0700 directory marks completion only after strict payload verification; readers
wait for that marker and still reject malicious hardlinks. Core `write_once`
durability semantics, timeout bounds and fault assertions are unchanged.
Deterministic paused-link/security regressions plus real TCP coverage pass
**35 Python**, and browser runner/verifier contracts pass **74 Node**.

The final full dependency-light foundations lane now passes in Linux/arm64
containers for both configured Python versions. Each completes dependency
consistency checks, Node **24.22.0**, pinned Ruff 0.14.10 checks, all core and
daemon tests, and the strict native-report guard, with exit **0** and no OOM:

| Python / evidence directory | Core report SHA-256 (860 passed / 12 skipped) | Daemon report SHA-256 (1,827 passed / 39 skipped) | Guard contracts SHA-256 (76 passed) |
|---|---|---|---|
| 3.11.17 — `/private/tmp/wavedl-full-linux-py311-ready.HuK3X1` | `da4da7fc8f7ad3746917a396f7638d02fe2a753f890c1474469829b0ee271798` | `27309baae3300efee658303335c799950494609943cadbf100028cf2b5c2c489` | `f763a8fa2680b3ca2ae4d8e876e37ef74384979668aeda1d6c3909d17c2ded62` |
| 3.13.16 — `/private/tmp/wavedl-full-linux-py313-ready.Q7bW7c` | `8c76022e6dbd8cc4261363a0a6ea918489d460465016de1037cd6584c37871f0` | `0731e3e2e413824dd36b4b9a16b839ac5b406aed3025137678716d4d5f0c5370` | `bca82d7cd2de137fe234d2b9b69cbd4e1f24efe6d25cb0ab35f168c374c5272b` |

Report filenames are `core-foundations.xml`, `daemon-foundations.xml` and
`guard-contracts.xml`. Explicit Linux verification accepts **13 required native
cases** and **2,687 total core/daemon passes** per version; all **51** skips stay
visible (other platforms, absent ML, unconfigured isolated wheelhouse and the
separately exercised tmpfs opt-in). This is the full configured dependency-light
lane, not a dependency-resolved Linux ML installation or hosted/native-host
certification. The macOS 2,721-pass run preceded six additional QA publication
tests; that revised fixture separately passes all 35 tests and the full Linux
lanes above. No test count is silently reclassified.

Root and independent Sol verify exact source/report identities. The full runner
uses an executable persistent task-owned Docker local volume, not a noexec or
ephemeral tmpfs, for test runtimes; the source/root remain read-only and network
disabled, capabilities dropped, UID 501, 3 GiB memory/3 CPUs per container.
`/private/tmp/wavedl-full-linux-image.7yVOiX/provenance.json` (SHA-256
`225df16e7005b2678236bf97757eb44165b6b814a0dd8f9989639a752e7c35b9`)
records Dockerfile/runner hashes, images, exact limits/mounts and report hashes.
After inspection, all 12 stopped task-labelled containers and six task-labelled
scratch volumes were removed by exact name. Reports/source snapshots/Dockerfile
and QA images remain; existing user containers and data were untouched.

Actual browser recertification of the corrected journal-fault fixture also
strict-passes, with complete owned cleanup:
`/private/tmp/wavedl-journal-ready-browser.d7IsbB/journal-fault.json`, SHA-256
`a9f1969562191daa56f877539a3e4efbb00adea200a789750f314f476143274a`.
This retains its declared controlled numerical-supervisor scope, not full F02,
native-process, ML, shared-filesystem or site certification. Failed intermediate
container runs (Ruff cache location, pinned-format mismatch, noexec/ephemeral
temporary mount, mutable-buffer regression and witnessed snapshot race) remain
failed precursors, not evidence of completed acceptance.

#### Latest runtime correction and Linux-container evidence

A real Linux/arm64 container run exposed an eager login lookup in
`SubmissionController._ensure`: `getpass.getuser()` was evaluated even when the
backend supplied its owner. An unmapped UID therefore caused submission to
return 404 before storage-fault acceptance. The fallback is now lazy; explicit
backend ownership and genuine missing-owner/login failures retain their prior
semantics. Three red/green regressions and independent Sol review pass. An
unconditional POSIX `pwd` import in the Slurm writer tests now uses an explicit
dependency skip, preventing Windows collection failure without claiming native
Windows execution. All **22** POSIX writer tests still pass.

Fresh core/daemon regression: **2,698 passed / 15 skipped**, zero failures/errors;
`/private/tmp/wavedl-core-daemon-ownerfix-final.xml`, SHA-256
`5d36eb82951c2f9fcd86a6faca754318384ed9b9bc4f1bc19e51d2fda24afe05`.
Browser assets remain be6 unchanged. A fresh single-case public-browser CPU
training/download smoke passes with cleanup at
`/private/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-browser-acceptance-eIOudG/summary.json`
(SHA-256 `549aeac4a3373a3c746ac323bf8ab5397c8b8678e3f14df2cd6507e1b7e28c6e`).
This is a baseline smoke, not a new twelve-case aggregate; the older twelve-case
report below retains its pre-owner-fix runtime boundary.

Rebuilt exact artifacts in `/private/tmp/wavedl-ownerfix-package-stage.PRXw0A/dist`
each match current controller bytes and all 38 static files and ship no Qt:

| Artifact | SHA-256 | Isolated lifecycle result |
|---|---|---|
| `wavedl-1.8.1-py3-none-any.whl` | `9d23d21847e0aa1566367fe80c8ab53067e332fb2dc4383c0bec5a21b8f10b78` | 1 passed, zero skips; `/private/tmp/wavedl-isolated-wheelhouse-ownerfix.xml`, SHA-256 `24142d2aa9f03052140276513898a416f7eb4bc8663e7e172a615e03a236b868` |
| `wavedl-1.8.1.tar.gz` | `50b96ccb35953744ff2cf8ddb59416eaa5255c6affc1ab83a1f1959a394cce8a` | 1 passed, zero skips; `/private/tmp/wavedl-isolated-sdist-ownerfix.xml`, SHA-256 `150f394a25813e25089374fd83119abe257c3c943ac338006819d75784544814` |

Real Linux-kernel storage/supervision evidence is now available in a Docker
Desktop Linux VM, not a native Linux host or hosted CI. The final owned container
exits **0**, `OOMKilled=false`, as UID 501 with no supplied username, network
disabled, capabilities dropped, init enabled, read-only root/source, 1 GiB memory,
two CPUs and a dedicated **4 MiB tmpfs**. The unchanged F06 test witnesses real
ENOSPC/SQLITE_FULL, preserved committed authority and exact replay after reclaim;
the empty-mount check and strict inside-container guards pass. Minimal test
dependencies deliberately do not establish a complete Linux ML installation.

Final evidence directory: `/private/tmp/wavedl-linux-final-procps.tzYOVm`.
Independent Sol verification explicitly selects Linux, not the host's Darwin
default. All **13 required POSIX foundation cases** pass, with transparent
optional/platform skips:

| Report | Result | SHA-256 |
|---|---|---|
| `tmpfs-acceptance.xml` | 1 passed, zero skips | `3b450226ba52d9f87ae5fe53f9ad0c6872a50ac0553c5eb776a5d5548ca6b4a1` |
| `tmpfs-contracts.xml` | 86 passed, zero skips | `e44dfbdd1359c35965e66b80e00652bdb41b6409b5edfd52021ea8e92fcdb6ad` |
| `core-foundations.xml` | 208 passed, 4 skipped | `7423ba35af06bcb0885e9d31825fa49718c985b41a64ee6e57e079589dfb8c37` |
| `daemon-foundations.xml` | 70 passed, 10 skipped | `f3170e99b1b83980e1e1e2c3dc40d3eea40c9fa26179974f44e2b95a9848cfee` |

`provenance.json` (SHA-256
`0a367dff8710dddb7dd60694c06c34cb15f922d9e6ab9f41ceead01a494f16a5`)
records image/base identity, limits, source hashes, exact report hashes and
limitations; the small task-owned Dockerfile is retained at its recorded path.
After independent inspection, the four stopped task-labelled pilot/final
containers were removed by exact name; reports, provenance, Dockerfile and the
task's QA image remain. Existing user containers were not modified.
The 14 skips comprise three Windows cases, one unavailable NumPy witness and
ten Darwin-specific cases; they are not waived as Linux proof. Failed pilots
remain failed: first missing PYTHONPATH, then the genuine owner bug, then missing
`ps` in the slim image. Installing `procps` only in the task's QA image fixes the
test environment without weakening process assertions.

Hosted runs currently visible via read-only GitHub inspection target older
commits, not this dirty checkout. No push, workflow dispatch, tag, publish or
cluster submission was performed. Native Windows/GPU, full hosted matrix and
real-site filesystem/Slurm validation remain open.

#### Prior same-asset evidence and localized browser validation

The [current completion audit](2026-10-18-new-app-completion-audit.md) maps the
24 capability requirements and 15 architecture failure categories without
turning historical caveats into new features or claiming external certification.

Latest bundle authority is
`be6e933df02ec78e830f20ea02ba1ce61f27f96055cfdb96fb398f4de4f57472`.
Earlier a077/8d1 reports below retain their original asset boundary and are not
promoted to this build. The latest source adds shared PNG export lifecycle
handling (sanitized preparation/handoff failures, duplicate-click suppression,
stale-callback invalidation on redraw/unmount and truthful browser-handoff
wording) plus stale heatmap-hover clearing on replacement/reset. Independent
Sol review passes. Full web: **820 passed / 1 skipped across 71 files**;
typecheck/lint/format checks pass; generated-worker tests **38/38** pass.
These tests do not prove a browser saved a download or close every row 04 fault.

Targeted be6 preview lifecycle recertification also strict-passes:

- Refusal/Stop/reselection/retry: `/private/tmp/wavedl-preview-be6-recert.VqHU8o/preview-fault-browser/preview-fault.json`, SHA-256 `0bf3c54e2313b7e1bad5463caef4b503d1ecb1a96a26b017dbbf4b19062da1db`.
- Numeric resource/decompression refusal and retry: `/private/tmp/wavedl-budget-be6-recert.cGV1IR/preview-budget-browser/preview-budget.json`, SHA-256 `4c1048b3baa4c711ff44577fea873d50d762b5e7f3863c3218568bc72faa813c`.

Both retain their controlled local fixture boundaries; no production-default
saturation or remote/site claim is added. Final focused workflow/fixture checks
pass **133/133 Python**; browser action, CV/resume and native-SSE contracts pass
**212/212 Node**. The unchanged daemon CV incompatibility cohort independently
passes **18/18** across Local and simulated Slurm planning refusal.

The latest required browser aggregate strict-passes **12/12**, exact assets and
owned cleanup:
`/private/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-browser-acceptance-d9XBcT/summary.json`
(SHA-256 `31edacc7dd31e225f5e5735ab5b8e2e9848d7c642f28a5a549a66731f449f928`).
The intermediate ad7 aggregate bkhP4u is historical, not final be6 evidence.

Clean staging at `/private/tmp/wavedl-be6-accepted-stage.IF3GaG` produced
`wavedl-1.8.1-py3-none-any.whl` and `wavedl-1.8.1.tar.gz`; both match all **38**
source static files byte-for-byte and contain no Qt package. Each exact artifact
passes the dependency-resolved isolated-wheelhouse console-script, daemon-free
training, bootstrap/authenticated-health, bundled-assets and shutdown test:

| Artifact | Result | JUnit and SHA-256 |
|---|---|---|
| Wheel | 1 passed, zero skips | `/private/tmp/wavedl-isolated-wheelhouse-be6-current.xml`; `8aa45a633df5ccf55f13f8edd839d0af13e28245efab319fde7e00e0054b87c4` |
| Sdist | 1 passed, zero skips | `/private/tmp/wavedl-isolated-sdist-be6-current.xml`; `1b15d8ce8bf8c0aa6f514473d932f15e2a4b1a57721765d0416e98ece9294ba4` |

Artifact SHA-256: wheel
`42ae8de9d73eccf3e0f4976e817853e5be8446c52bd055076eba29b2a5ba718b`;
sdist `c17e87101ecbeceaf586ef70f38afc408ac68886c9c4d42282d9ee491e8be92f`.

This is local macOS/CPU acceptance, not native Windows/GPU, real-site
filesystem/Slurm, hosted CI, complete P0/T30c/T38/T42 or release sign-off.

Additive be6 native SSE report:
`/private/tmp/wavedl-native-sse-run5.mFuBZF/native-sse.json`, SHA-256
`3e427484b1c98361693bb7d1d1b04559863578179c7c2ff98df198848ee9427a`.
Root and independent Sol strict-file verification pass. A QA wrapper observes native
`ReadableStreamDefaultReader.read/cancel` results without replacing returned
chunks, values or receiver/error behavior; bounded hashes and restricted
boundary bytes are persisted, not arbitrary bodies or cancellation reasons.
Two owned release barriers force actual selected-stream adjacent reads across
`0xc3|0xb3` and `0x0d|0x0a`; native prefix/range/final-wire hashes bind them to
the controlled first genuine event and overflow control. Successful native
cancellation (not a fabricated natural EOF), real-cursor replay, exact Unicode
DOM text, genuine metric history/canvas, journal/projection authority and owned
cleanup pass. Exact heartbeat-only suppression before the first genuine event
and a bounded ignored comment padding are explicit fixture transformations.
No real event is dropped. Probe/guard contracts pass **40/40 Node** and the
fixture test **1/1 Python**, with Ruff checks clean. Failed pilots remain failed
private diagnostics and are not promoted to acceptance.

Mandatory additive CI wiring preserves the twelve-case baseline and uses an
isolated directory, exact sole-report inventory, strict current-asset/cleanup
verification and an explicit report-only upload. The copied workflow guard also
accepts this real report locally. The job budget is bounded at 120 minutes:
the measured local baseline alone took 11m53s and the lane has 49 other
acceptance runners plus setup/tests. Hosted timing remains unverified.
The exact isolated CI-layout runner also passes locally at
`/private/tmp/wavedl-native-sse-ci.S9XE81/native-sse-browser/native-sse.json`
(SHA-256 `dff27c1cda16a754948b854567cce69b3f64f7c50193c57a4464df2b5fcf5538`).

This is explicitly instrumented local QA. Its observer has finite QA budgets
and does not establish uninstrumented equivalence, remote/site/Slurm, attempt
rollover, native Windows/GPU, hosted CI or complete T30c/T38/T42 acceptance.

The following scoped status overrides stale remaining-work labels in the dated
matrices below; it is not whole-row or all-platform sign-off:

| Requirement slice | Current evidence |
|---|---|
| Row 02 HEADER deadline/retry | Real controlled-child timeout, slot release and exact browser header recovery pass; default/parser-specific/remote variants remain separate. |
| Row 03 preview cancellation | Explicit Stop/retry and the additive resource-budget browser slice now pass; default-cap, allocation-saturation and remote/site variants remain separate. |
| Row 10 CV/resume incompatibility | Current be6 public refusal, field correction and genuine CV preview recovery pass; successful resume/execution and other variants remain separate. |
| Row 17 partial-checkpoint and checksum refusal | Real partial-best fallback/refusal and checksum-only no-fallback reports pass; controller/workflow regression is 41 tests, full web 809 plus one skip. |
| F04 metric transaction crash | Both write orders and rebuild/ingest recovery pass after a committed hello; native Windows/site breadth remains separate. |

Current be6 CV/resume report:
`/private/tmp/wavedl-cv-resume-acceptance.l9QhXl/report/training-validation.json`,
SHA-256 `650bfead837af7885ca875930be2286eef1f930a067f7c8f7d34fe941f7cdf9b`.
Root and independent Sol strict verification pass. Native public field actions
author `cv=2` and an owned private-looking resume selector, observe the precise
generic validation error/invalid field without rendering the selector elsewhere,
then clear it and observe the same field valid/error-free. The refusal creates
zero request receipts/plans/runs/intents. Baseline invalid cases, unsupported
runtime refusals and ordinary `cv=0` preview remain intact. An additive genuine
`cv=2`, `resume=null` preview matches its persisted request/manifest and public
approval, preserving the original SQL plan row byte-for-byte. Exactly five
planner requests return `400,400,400,200,200`; exactly two unsubmitted plans and
zero runs/executions/submission/cancellation remain after cleanup. Report schema
v2 makes this evidence mandatory, with **138/138 Node** contracts; versionless
reports remain historical. This does not prove successful resume, CV execution,
whole row 10, platform/site/hosted or full T30c/T38/T42 acceptance.

Current be6 old-controller/new-daemon build-identity slice:
`/private/tmp/wavedl-cached-ci-final.PLc1ho/cached-build-replacement-browser/wavedl-browser-acceptance-Cv6MAD/summary.json`,
SHA-256 `f2c043daca3f1c1fd49e1f763d51d2d765369cbe3ffbc656b474b064f21b3ecd`.
The final runner and copied literal CI discovery/strict guard pass root and
independent Sol review locally.
A read-only QA closure proves the actual original service-worker object stays
identical with zero controller-change events. A genuine replacement daemon
process uses a controlled build identity at app construction (same production
sources, not an altered health response), the same origin and bearer, and a new
daemon identity. The old-scope request receives 409; an explicit manual fresh
connect receives genuine new-build health and is refused by the old compiled
client. Credentials, selected monitor/history and approval authority clear;
replacement plans/runs/intents/executions remain empty and only GET requests
reach it. Original native runtime reaping and both daemon/profile/credential
cleanup pass. Fixture temporary files stay inside their exact owned roots;
the isolated CI directory contains exactly the two-report workspace.

Helper/driver/guard contracts pass **33/33 Node**; the full focused action,
CV/resume/native/controller cohort passes **245 Node** after the TMPDIR
regression addition, and all workflow/fixture checks pass **140/140 Python**.
Source/core/daemon lint and format checks pass across **289 files** including
the new Python fixtures/contracts. Mandatory additive CI wiring has symmetric
triggers and uploads only the explicit summary/case reports. This proves the
old controlled page and actual controller with unchanged entry URLs/packaged
hashes, not cache-hit or loaded-response-byte provenance, a matching new client
update, a different released binary, remote forwarding or complete F15/T38.
The earlier oXe70L and 5kVEtW pilots retain their narrower boundaries; the latter
does not establish literal CI-layout cleanup because W&B created sibling temps.

The partial-best and checksum report guards now also reject
`explicitFixtureWebAssets` and `authoringEventDiagnostic` by field presence,
including false/empty values. Their **86** verifier contracts pass and all three
existing same-bundle reports still strict-pass. This prevents instrumented or
alternate-asset pilot reports from being promoted as frozen-package evidence.

Earlier a077 local review (2026-10-18): **2,695 core/daemon passes, 15 skips**, zero
failures/errors in `/private/tmp/wavedl-core-daemon-preview-final.xml` (SHA-256
`e1ace9c32c9aec9f24468d78124d60ee8f7d8510163dd7c906aaa91442a27a49`). That
run imported the earlier permissive MAT test; the subsequent test-only revision
uses a valid smaller MAT declared-memory witness and requires precise
`PreviewTooLarge`, independently passing **5/5**. That bundle's full web is **809 / 1
skipped**, with typecheck/lint/format passing. Baseline plus new acceptance
tooling passes **446/446 Node**, and the focused fixture/workflow cohort passes
**90/90 Python**. The exact clean-staged wheel passes **3 installed checks**
(the unconfigured isolated-wheelhouse check skips); source/wheel/sdist contain
the same **38** asset files and no Qt package. Ruff checks pass. No overall
T30c/T38/T42, hosted, native Windows/GPU or real-site acceptance is inferred.

Current a077 preview-budget report:
`/private/tmp/wavedl-preview-budget-run2.lE2rO1/preview-budget.json`, SHA-256
`d49e9da346ea23d67e497b8144a53333e49b1e4d75032346fa9f15df77dce6cf`.
A valid compressed numeric NPZ exceeds the unchanged ZIP-ratio cap; ordinary
numeric datasets exceed fixture-only file-byte/feature-width caps. Each public
selection returns sanitized HTTP 413, clears old canvases/figures, preserves
the connection and releases capacity; each ordinary retry paints real canvases
again. The guard binds successful HTTP payloads to genuine worker stdout and
checks immutable source hashes, reaped PIDs, empty durable registry and owned
cleanup. Its **41** mutation contracts and the **5** Python resource tests pass.
Mandatory isolated CI wiring and its **8** contract tests pass locally. The
fixture uses explicit lower file/feature/output limits and does not certify
production-default caps, saturation, remote filesystems, Slurm, native
Windows/GPU or hosted CI. Failed startup pilot S4hTkY remains precursor only;
its fixture-only output budget was corrected without changing production.

Current a077 HEADER deadline report:
`/private/tmp/wavedl-header-deadline-final2.PnYENj/header-deadline.json`, SHA-256
`fb5a1f49496c8252bf6171418e59b2bafabd898da3f8ac2947f4a933c207178f`. A public
dataset selection used a real supervised child with a fixture-only reduced
2-second deadline, reaped its PID before callback return and released the pool
slot. The browser saw sanitized 422 refusal with no header/dimensions, retained
verified connection, then public Refresh succeeded via the unmodified metadata
worker with exact NPZ, 96, X/y, shape and dtype fields. Durable registry remained
empty and no mutation/cancellation occurred; cleanup verified child, listener,
services, browser profile and private roots. Scope is controlled child/no
descendants and does not claim parser-specific/default-deadline/Stop/disconnect,
saturation, remote filesystem or Slurm behavior. Header verifier **42/42** and
focused Python tests **18/18** pass; mandatory CI wiring preserves the baseline.

Additive same-bundle checksum-only browser report:
`/private/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-browser-acceptance-oT3kb7/summary.json`,
SHA-256 `6aff8357d8a88f8a14dccfb2c0bb30b5872a909db9a76aed9dcbff0c29ff2e4f`.
Root and independent Sol strict verification pass. One space-to-tab response
mutation preserves size and parsed JSON while changing the checksum; published
and disk bytes remain unchanged. The browser revokes authority, clears automatic
plot controls, performs no older-checkpoint fetch and creates no extra
plan/run/cancellation or late mutation. Owned cleanup is verified. The 3zxoVh
syntax-corruption pilot remains precursor evidence only.

F04's new metric-bearing matrix also passes all four POSIX SIGKILL cases after
a committed hello, in both write orders and both rebuild/ingest recovery paths.
The prior committed projection/cursor/event row survives; the interrupted metric
and history roll back; exact numeric/null/list payloads replay once over HTTP SSE
and SQLite and survive three repeated polls plus reopen. Root independently
passes the original hello **33** and additive metric **33** tests. Verified
root report directory: `/private/tmp/wavedl-f04-metric-root.XO7kB6`:

| Report suffix | SHA-256 |
|---|---|
| `cursor-projection-ingest` | `05ea092fbdeb69847654cde9c383d9e0cc6453d18b3c2b8036a7307a6777d17a` |
| `cursor-projection-rebuild` | `f9a29021e7fc1235353745a8548c5a2d0ed5a595e9acc2111863faf8a71f40d6` |
| `projection-cursor-ingest` | `a462a9e76caf1c03a031f3f0fab3117177231a9e1e6fb3d204a3020e9071f6a5` |
| `projection-cursor-rebuild` | `c06808502452e32d386defc2c108687159ce22d4009b171cf6912420d9fa81e1` |

Filenames are `registry-metric-http-recovery-<suffix>.json`. The strict four-case
CLI and exact CI JUnit guard pass; reverse order and numerical startup remain
controlled, with no browser/remote/site claim for this ASGI matrix. Both new
slices have mandatory isolated CI gates and explicit nonsecret uploads, without
changing the required twelve-case baseline or prior hello gate. Root's final
focused cohort passes **212/212 Python** and **345/345 Node** tests; Ruff
lint/format pass. Assets remain a077; these additions do not sign off complete
T30c/T38 or external platform/site/hosted/release gates.

Removed the broad metadata transport failure-suppression option. Verified but
malformed classification content can be skipped; authentication, identity,
protocol, truncation and checksum faults still revoke the connection and stop
automatic plotting. Four fail-closed regression cases and an all-partial
publication refusal case pass. Full web validation is **809 / 1 skipped**;
typecheck/lint/format and **38/38** generated-worker tests pass. Sol independently
passes **69** focused tests and approves the boundary correction.

The frozen manifest is
`a077fa3d534153c8dfff5874e7bb0f7d9b62075cfc13a0b4fc94195548767eec`.
Clean staged wheel/sdist asset bytes equal all 38 current source files, Qt source
is absent, and the exact wheel passes **3** outside-checkout installed
CLI/runtime checks. Package/static/headless/workflow tests pass **112/112**.
These are bounded local checks, not external T30c/T38/site/platform/hosted/release
acceptance. The following additional assembled reports close only the local
partial-generation slice.

Current a077 required aggregate strict-passes **12/12** and owned cleanup at
`/private/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-browser-acceptance-kEo33R/summary.json`
(SHA-256 `1304cc3d0e138ed3b32873aee9e94ba55ca2f70938cf73b3d3c93d88c13c7d2f`).
Optional `partial-best-fallback` and `partial-best-refusal` cases also pass
independent strict verification against the same assets:

- `wavedl-browser-acceptance-3LdvhX/summary.json`, SHA-256
  `6d32285745b49f4a486f5859efb913d2d1614478b47778de9406e43becfdc2cb`.
- `wavedl-browser-acceptance-Q42d2i/summary.json`, SHA-256
  `9d2027c9ced2a49d787b1b747ac74ce91cb917821c0af20c949ba2444df68032`.

Both workspaces use the aggregate's temporary parent. The fixture publishes a
valid metadata-only best, not a mocked HTTP body. Fallback retains genuine older
complete generations and proves exact source pin, one actual completed plot,
native PNG bytes and matching browser/PIL decoded pixels. Refusal moves genuine
originals into private fixture quarantine, preserves their bytes, and proves
one completed training run, incomplete guidance, no plot/cancel/late mutation
and clean owned shutdown. Optional driver/verifier tests pass **36/36**, fixture
regression **35/35**, and controller/workflow tests **41/41**. Failed pilots
L0ibv4/NnzFud remain failed; replacing a CSP-refused page-side blob probe with
native download evidence did not weaken production policy or acceptance.

Mandatory CI steps now run and independently verify each optional case in a
dedicated temporary directory, preserve the baseline twelve-case gate, and
upload only explicit nonsecret JSON artifacts. Symmetric triggers and exact
single-workspace discovery are test-covered. Root passes **127/127** focused
workflow/package/static/fixture tests and **308/308** baseline/optional Node
contracts. Hosted execution remains unverified; no tag or publication occurred.

### Prior audited source and bundle — 2026-10-18

The current regenerated bundle manifest SHA-256 is
`ec7d9feb9e5b39c65f9a9fabfcd477746e1021992d61abb0390dce0d8b1a95ac` with 37
inventoried assets. Fresh packaged-browser acceptance passes **12/12** with
cleanup at
`/private/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-browser-acceptance-85BTji/summary.json`
(SHA-256 `c873b4f07b38e093929f6a39632e39a185edefb95fa2864388e17c763647cf24`).
The web suite passes **804 / 1 skipped**; typecheck, workstation lint and format
also pass. Automatic-plot recovery now skips malformed/partial newer best
publications and selects an older complete source when present; focused
controller/workflow coverage passes **35/35**. These are bounded local
macOS/CPU checks, not complete T30c/T38 or platform/site/release acceptance.

### Latest audited source and bundle — 2026-10-17

Bundle manifest SHA-256
`42f5cf8989bd128683715c90ee6b4f8eb4a7280bb175c5cfb479f8a1438517a8`
contains 37 inventoried assets. The frozen bundle's full twelve-case Chromium
aggregate strict-passes at
`/private/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-browser-acceptance-QYbNoG/summary.json`
(SHA-256 `79e8eb0e18233c2483df70588046efdc1769198e541e3edc7962b13c06c18261`),
including exact asset identity and cleanup. Web tests pass **802 / 1 skipped**
across 71 files; typecheck, lint, format, generation and **38/38** generated-worker
tests pass. These are bounded local macOS/CPU checks, not complete T30c/T38 or
native Windows/GPU/remote/real-Slurm/site/hosted acceptance.

The current strict preview-fault report is
`/private/tmp/wavedl-preview-fault-20261017-final2/preview-fault.json`
(SHA-256 `8d24cd6dff9453737234beae70222b0abe3fc413010651039dc5ad8fb4f4d1059`),
and the imported-preset authority report is
`/private/tmp/wavedl-preset-import-20261017-final2/preset-import.json`
(SHA-256 `cbc06ed7a46e9fb889cd13f7797244c85bd5f9d4726be58c8d91fc1b95da19ca`).
Both reports bind the same current asset manifest and pass their strict
verifiers; the preview report includes explicit Stop/retry cleanup evidence.
The current catalogue/header fault report is
`/private/tmp/wavedl-catalogue-20261017-final2/catalogue-fault.json`
(SHA-256 `8ae200cd0da286f5f23188d266249fb60ce22925cb8d3aa1d04d85e2867351c3`);
its nine response-boundary cases include malformed model metadata and
reconnect/reselection recovery.

The current training-validation browser report
`/private/tmp/wavedl-training-validation-20261017-export/training-validation.json`
(SHA-256 `e59c085182558040ded3bd311cbfc9b9e65c4c1a73be6d5f4ee25fc1cc7fd777`)
strictly covers environment-secret omission in YAML, visible standalone CLI
refusal for explicit environment values, and visible multi-node topology refusal
without plans, executions or request receipts. Mapped automatic-plot negative
reports for failed and uncertain states are also strict-verified at
`/private/tmp/wavedl-negative-failed-3-92480/mapped-autoplot.json` (SHA-256
`305a83d7aa170469982cf96fe85eca420bfcc0673f500c4264c51ce806f91471`) and
`/private/tmp/wavedl-negative-uncertain-3-99101/mapped-autoplot.json` (SHA-256
`87197ac464a9995de7996ef01b4e32762c030cbc752d6ae51dbc7a5d8d1a0c5d`).

Final follow-up: event GETs reject noncanonical uppercase UUIDs before service
resolution, and verified artifact downloads expose a localized browser-handoff
status without claiming the file was saved. Root review passes **123** event/auth
tests, **802 / 1 skipped** web tests, and the complete daemon/core regression
passes **2,657 / 15 skipped**. The current bundle's generated-worker checks pass
**38/38** and installed CLI/static/vendor/release checks pass **91 / 1 skipped**.
The clean-staging installed CLI check also passes **3 / 1 skipped** on this host;
the older package aggregate and report hashes below retain their dated boundaries.

The final supported Python regression on this source passed **3,680 tests**,
with **15 skips and 336 deselections**, in 478.90 seconds after CV input
contract hardening. JUnit evidence is
`/private/tmp/wavedl-supported-final-after-cv-dtype-20261017.xml` (SHA-256
`9ebb530289554d2dc29ffc9b78f011d1f64c23775b504c1edd043dac149d132b`).

The CV helper now refuses non-array, malformed-shape, mismatched-sample,
empty-target, non-finite, non-numeric and over-folded inputs before creating
output directories or models. Its focused data/CV regression passes **88/88**; this
is local integrity hardening and does not close the external T30c/T38 gates.

A fresh `npm run test:browser` rerun also passed all **12/12** required current
cases with cleanup; the independent strict verifier accepted the summary at
`/private/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-browser-acceptance-24yiyU/summary.json`
(SHA-256 `7cdc59f69d5239db634d3996b3aac05fbceb37b2ab10447530405ba0073941af`)
against the same 42f5 asset manifest. This remains same-host browser evidence,
not remote, Windows/GPU, real-site or hosted release certification.

The browser evidence CLI guard now accepts either that owned report workspace or
its dedicated temporary-directory parent without weakening the existing
single-workspace, per-case, asset-identity or cleanup checks. Its adversarial
suite passes **272/272**, and direct verification of the fresh report passes
**12/12**.

The staged index was independently archived and built outside the checkout;
the wheel and sdist each contain exactly 38 current web assets and zero Qt
entries. Ruff check/format, workflow/headless-scope/vendor/static/installed-web
checks pass **112/112**. The dirty checkout's ignored `build/lib` may retain
stale assets, so the clean-staging build contract remains mandatory for release;
no commit, tag or publication was performed.

Fresh current-source regressions on 2026-10-18 pass **1,814 daemon tests with 9
skips** and **804 web tests with 1 skip**; workstation TypeScript typecheck,
Oxlint and Oxfmt also pass. These are local macOS/CPU results and do not close
the real-site, native-platform, hosted-CI or T30c/T38/T42 gates.

The current packaged-browser history slice also passed at
`/private/tmp/wavedl-history-current-20261018.json` (SHA-256
`e5261717960dcb7db2ac93eb0d40ea95511ae3c34eedecf67f6b71f6948234f3`): a real
daemon journal/SQLite/SSE path delivered **100,000** metric steps to the chart,
all four channel views painted, and owned cleanup was verified. It is bounded
local history evidence, not ML-epoch, supersession, restart, remote, GPU,
Slurm or complete T38 acceptance.

Three additional correctness fixes were independently reviewed: invalid UTF-8
dataset paths receive controlled refusals, HTTP inspection disconnect cancels and
drains its supervised child, and YAML export reports browser handoff rather than
claiming an unobservable successful save. Mounted tests cover no-op/rejected
download requests; ASGI tests cover task and real-child disconnect cleanup.
The final related inspection/authority/preview/service-host suite passes **104**;
the expanded HTTP/authority/catalog/inspection regression passes **147**, and
the HTTP body-deadline/disconnect suite passes **79**. JSON
request bodies now have a finite 10-second receive deadline and return sanitized
408 responses on stalled receives. Browser catalog malformed-row refusal now
includes a malformed model-row fault with reconnect/reselection recovery (32
strict Node contracts and 12 fixture tests). Pinned Ruff 0.14.10 checks pass
for changed Python files.

The supported Python suite passed **3,650 / 15 skipped / 336 deselected** before
the final disconnect correction; that correction and Unicode-path additions are
covered by the final focused suite above, not silently attributed to that older
full-suite collection. JUnit `/private/tmp/wavedl-supported-authority-20261016.xml`
has SHA-256 `12dd7a15f3f18ebc4eccad6206fdf9f5a3f34c88e4adeaef288d15e9c7f28d51`.
Final package/static/vendor/installed-CLI checks pass **91 / 1 skipped** in
`/private/tmp/wavedl-package-b80-20261016.xml` (SHA-256
`433b45cbbca84a73013355490f7dad6a7a2412b84e5c018e585d1ecfaa8f61b6`).
The skipped isolated-resolver check is not acceptance of dependency resolution.
No Qt source is shipped, no old-user migration is required, and no release is
authorized by these checks. All predecessor bundle reports below retain only
their dated boundaries; the full per-row/fault/platform/site gates remain open.

### Current status — 2026-10-15 (new-app validation)

### Current source hardening — 2026-10-16

Dataset header inspection now accepts only an explicit `{root, path}` selection
resolved through the daemon's configured browse authorities; arbitrary absolute
paths are rejected even after authentication. The browser sends the root ID and
relative path returned by `/api/browse/resolve`. Focused inspection and HTTP
integration tests pass, and the full daemon/core regression is **2,655 passed / 15
skipped**. The regenerated package manifest has SHA-256
`1a189483316b168c2c6ca2c7e34b4f783aaacbef0afdce39b6d7250869828fc5` with 37
entries. Real Chromium baseline evidence passes at
`/private/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-browser-acceptance-m60OTQ/summary.json`
(SHA-256 `06e37789b3286bfd50e1f06806904fb40cdcff042b17473e2e14f29e7c82cf9f`),
and dataset-parity evidence passes at
`/private/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-browser-acceptance-6l0BHi/summary.json`
(SHA-256 `aa86a2b2921f8a3e27c3ef00d2942a5885de5ca3f2cac474bb1b7c65f4888405`).
These are fresh local CPU/macOS slices; full T30c/T38, platform/site and release
gates remain open.

Current bundle `8d1cd10a744f260d658dd4904244be530bcbceb716cb75230ef4dfd7ffc6ad96`
passes the bounded web suite **793 passed / 1 skipped across 70 files**, with
typecheck/lint/format clean, generated workers **38**, and package/static/headless
checks **112 passed**. Prior bundle reports remain dated evidence only.
The web `npm test` script now runs `nuxt prepare` before Vitest, so a clean
checkout cannot race test collection against Nuxt's generated TypeScript
configuration; the independent run remains **793 passed / 1 skipped**.
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

Additional strict 8d1 scoped evidence: preview fault report
`/private/tmp/wavedl-preview-fault-8d1-current-20261016-1/preview-fault.json`
(SHA-256 `b4b1bba33f3abeed323a189343cdcd43a150f8d0f964feb4f33ed37795b4a289`)
passes 34 Node and 95 Python checks for browser identity-mutation/reselection
refusal and MAT/NPZ recovery; browser caps/decompression/allocation/Stop variants
remain unclaimed, and remote/site behavior remains open. Cold offline report
`/private/tmp/wavedl-cold-offline-8d1-5.json` (SHA-256
`0ae5e0b2b5bd13a368deb4df3c4b6b2dc22cefba98d6d807321453a3541ed42b`) strictly
passes with all cleanup checks and 39 verifier tests. Pending-cancellation report
`/private/tmp/wavedl-pending-cancel-final-current-20261016.json` (SHA-256
`d675bde4adcbed2ce89efe8e3913f38bf67efbc5a518327e0defbc3115ee67e7`) strictly
passes pending/unknown/receipt/lost-ACK/dedup/detach coverage with clean cleanup.
The final visible-alert catalogue report
`/private/tmp/wavedl-catalogue-native-current8d1-20261016-final/catalogue-fault.json`
(SHA-256 `b90b1f6ac8cf94805f205c6337e66ed66add82ab79f89ee5b864191e15dc36dd`)
strict-passes 32 Node/11 Python checks and all cleanup/storage checks, preserving
six response faults plus native chmod-000 owned-child real-403 and 1001-empty-file
real-503 checks against the service's 1000-entry limit, without production wire
mutation. Unreadable configured roots, remote filesystems, disk ENOSPC and full
T38/T30c/platform/site/release remain unproven. The older six-case report is historical.

Additional current 8d1 reports: dashboard-state
`/private/tmp/wavedl-dashboard-state-8d1-current-20261016.json` (SHA-256
`d7643326e9676c2a07b890e830126ab84629c821537953f9a589e9ba96cef401`) passes
18 Node and 15 fixture checks with cleanup; stream
`/private/tmp/wavedl-stream-current-20261016.json` (SHA-256
`d7ce441b0ebd7c0258b1bb205441e4f6e6c4e4d4d8efc5f7d56414b3eb954bed`) passes its
strict verifier. These remain reducer-derived/local attempt-one and SSE evidence;
native restart, Slurm, remote, Windows, GPU and hosted coverage remain open.

Current focused coverage also includes the generated-worker cold offline deep-link regression: deep links serve the shell while `/api/**` is never intercepted or cached. The local spawn-failure attempt-fence test confirms the durable attempt reservation remains uncertain/nonretryable (`SupervisionLost`), preventing duplicate admission rather than erasing the attempt state.

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
and reload catalogue state after reconnect. WorkstationController now derives `useHead`
language reactively; preference recovery preserves Vietnamese settings instead of
overwriting them with English.

Strict current reports: preferences
`/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-preferences-browser-rYqtC8/preferences-browser.json`
(SHA-256 `598d3f902763565e8bb394fa6ae7073107773829bba7100918196b3be959b10a`);
artifact safety
`/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-artifact-publication-HPt33u/artifact-publication-oversized-inventory.json`
(SHA-256 `7722cace14085f92c19a4edc2870cf75d28c35468faf734ab042de320cbaf86d`),
covering bounded modified-size/traversal inventory, incomplete generations,
active HTML/SVG no-inline/no-exec fixtures and clean cleanup. The 100k report is
`/private/tmp/wavedl-100k-8d1-current-20261016.json` (SHA-256
`af6bd2888afdba5e63457ecd79cd8f07f2aa4a452cf8275102cb90c4819f2272`);
supersession `/private/tmp/wavedl-supersession-8d1-current-20261016.json`
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

Prior-bundle recertification: strict-passed F02 journal-fault report
`/private/tmp/wavedl-f02-final-20261015.json` (SHA-256
`53c397703981964e5ec86941443baa563280fedef2d5a2b20cbc5eae41725a60`) and F05
genuine-overflow report
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

#### Dated F05 precursor browser evidence — report C

`/private/tmp/wavedl-f05-current-20261015.json` (SHA-256
`b40c35a30fb48018d6600d46f42f0d774877399d34ed4ff6c66f7647a03f586a`) passed
the root and independent strict verifiers. The real browser
exercise observed capacity-1 `EventBroker` `QueueFull`, unchanged ASGI frames,
two completed CPU attempts, first stream `[1:0]`, overflow/reconnect at cursor
`1:0`, exact journal IDs `1:0..1:7` and `2:0..2:5`, equal durable
cursors/journal, one metric/history step, exact-once DOM diagnostic IDs and
complete cleanup/assets. This closes F05 for the scoped local browser slice, not
live allocation/requeue/Slurm, browser chunk-boundary, GPU, site or full-T30c
acceptance.

#### F12 invalid-UTF-8 browser evidence — report B

`/private/tmp/wavedl-f12-final-bundle-20261016.json` (SHA-256
`7c54da68df654e2e16f7632f48b2aa0967a3e3112d52b5d4b55bf925d8ea9249`): root
and independent strict verification passed. Chrome refused the
invalid-UTF-8 control with protocol-skew handling, cleared the selected run and
credentials, made exactly two requests with no retries, and preserved durable
cursors plus complete cleanup. This is a bounded local browser fault: network
chunk boundaries, private post-rejection cursor, attempt rollover, Slurm/site
and full-T30c acceptance remain unclaimed.

#### Dated F02/F13 evidence — 2026-10-15 (7b1c baseline)

The following evidence predates the new-app bundle above and retains its
original tested boundary; it is not current-bundle recertification.

F13 actual macOS HeadlessChrome 150 report C
`/private/tmp/wavedl-f13-current-20261015.json`, SHA-256
`bdffa181eea30c45f55b33a2d0cb4136bfff7218eb60b00c0a1a8f898d860acb`,
passes root's and the independent review's unchanged strict file verifier. A second loopback-port page sends
real simple GET, bodyless fetch cancel POST and native form cancel POST: all
receive 403 despite sharing the cookie, without authorization. JSON/Authorization
fetch receives OPTIONS 403 with no actual POST or CORS grant; cookie-only browser
navigation receives 401. All seven sanitized ASGI receipts and actual DOM evidence
are retained without changing responses. Real SQLite state is identical before/
after attacks; legitimate authenticated Node GET 200 and cancel 202 then change
`cancellation_requested` from 0 to 1 and create a pending submission-control row,
with no executions or ML. All 38
assets remain unchanged. Cleanup measures absent browser session, both listeners
closed, services closed/drained, reaped SIGINT fixture and removed temporary
workspace/profile/token. A failed on an invalid positive GET query; B completed
browser cases but failed the verifier's daemon-ID schema assumption; neither is
promoted to acceptance. This loopback/macOS slice is not DNS-rebinding,
nonloopback/remote/site/cross-browser or full-F13 certification.

Combined root checks pass 175 Node cases (74 F02, 64 F13, 37 helpers) and 241
Python cases/0 skips in 10.49 seconds, including CLI 39 (nine new dependency-free
help/invalid-secret cases), HTTP auth 70, bootstrap 38, settings 18 and workflow
11. JUnit `/private/tmp/wavedl-f02-f13-cli-validation-20261015.xml`, SHA-256
`d0215bf768e57d0db718419f523938e2025f1e07a061a05dad45ea3ad67f829b`.
F13 CI wiring is configured with scoped push/PR triggers, mandatory checks,
always-run browser/strict file guard and allowlisted evidence upload, not remotely
executed. Independent final review verifies the unchanged report/hash, actual
ENOENT for workspace/root/profile/token and ECONNREFUSED on both ports, plus
ordered mandatory/always-run CI checks, explicit artifact allowlist and 11 passing
workflow tests.

The native agent-browser/HeadlessChrome 150 B report
`/private/tmp/wavedl-f02-current-20261015.json` (SHA-256
`c80fea6e439bc30c8f0252798ad525b6e22f5fbf73fff9ea23908e54f3b03cb1`)
passes the root and independent strict file verifiers. Four phases cover damage,
live-reader eviction/bookmark restore, append-only torn suffix, and repeat submit
with stable-owner laps. The report records 32 separate DOM observations and four
faults (torn-tail, abandoned-tail, oversized-line, oversized-tail). Only torn-tail
reaches `completed` after append; the other three faults stay
`terminal_unknown`/uncertain/no-metrics, not success claims. All 38
assets are unchanged. Cleanup verifies the browser session is absent, listener
refusal, fixture exit 0, drained services, and removal of temporary workspace,
profile and token. The controlled fixture has a terminal numerical supervisor/pid,
genuine Local submission/startup/HELLO/journal bytes/SQLite/HTTP/SSE, but no ML,
native-process, shared-filesystem/site, or full-F02 certification. Initial A remains
failed because cleanup was checked immediately; the bounded-poll fix is unit-covered.
Root's current Node runner/verifier/actions/launch pass 111 (74 F02, 37 actions/
launch); Python passes 65/0 skipped (29 fixture, 4 hosted, 24 reader, 8 workflow)
at `/private/tmp/wavedl-f02-ci-python-20261015.xml`; Ruff 0.14.10 is clean.
CI wiring and independent review pass: all six scoped paths trigger push/PR;
fixture/Node checks are mandatory by default, browser execution and strict file
verification always run, and artifact upload always uses an explicit allowlist.
This is configured CI, not a remotely executed hosted result.
The full 3,883-Python/751-web/12-browser/package baseline remains dated product
evidence; no full regression rerun was performed for these tooling-only
changes. T30c/T38, Windows/GPU/site/hosted-release gates remain open.

### Current status — 2026-10-14 (7b1c; local acceptance passed)

Current generated/vendored inventory:
`7b1c164f0b9e05d1f3eaffa81c66fcbcaad9580e83f9899085ff51530119b5bc`,
38 assets. Prior eece remains recoverable at
`web/.vendor-backups/backup-gcan1hmm`. The previous eece full/package/browser
certificates below are historical until their applicable new-build checks finish.

The final frozen Python regression passes **3,883 / 14 skipped / 336 slow/GPU
deselected**, zero failures/errors, all 427 Python source/test hashes unchanged.
Report `/private/tmp/wavedl-full-validation-frozen-20261014.xml`, SHA-256
`3066c305a5b471573eb6666d257cc504bff63c50923565567fc5f1a21e1dfe70`.
Exact current package acceptance passes 1/1 with zero skips/errors/failures;
the current browser aggregate passes 12/12 with cleanup and exact 7b1c assets.

#### Definite plan rejection and invalid-authoring acceptance

`ConnectionSessionError` preserves only validated integer HTTP 400–599 status,
not raw response bodies/messages. `ProjectContainer` distinguishes preview-only
status 400 from uncertain acknowledgement and submission/status errors. It shows
safe English/Vietnamese refusal guidance, preserves the exact draft and selection,
never resets/retries automatically, and ignores late errors after draft/session
retirement. Network/timeouts retain existing connection retirement semantics.
Independent read-only review passes 105 cases across six suites; root passes
**751** frontend cases with real Python export integration, typecheck/lint/format,
and **38** generated-worker checks.

The actual isolated Chromium run passes all twelve client-invalid cases:
zero/fractional batch size, zero/blank LR, workers below -1, malformed loss weights
and milestones, one-fold CV, relative interpreter, unsupported CV compilation,
Nesterov without positive momentum, and invalid plateau reduction factor.
Each records actual native field ID/value/ARIA/error and corrected value/error
clearance, empty plans/control/executions/runs, and zero planning request arrivals.
Three real planner HTTP 400s cover bundled/container runtimes and explicit MPS;
after correction, exactly one HTTP 200 persists an unsubmitted preview. Request
receipts are captured at arrival, including aborted callers; response metadata is
secret-free and frozen only after fixture closure. Legitimate read-only POST
browse-resolve and dataset-inspect are recorded separately; unexpected mutation
methods, even to those paths, are rejected by the evidence guard.

Final report
`/private/tmp/wavedl-training-validation-20261014-d/training-validation.json`,
SHA-256 `889ba2efca9724ec38c4cde52fd8548bda47ae9ba4bda45199d05b713299d8d1`.
All 46 inventory-owned request fields equal the immutable persisted config;
`output_dir` is separately validated as the daemon-owned run path, never authored.
Both 38-file asset inventories and manifest hashes agree with 7b1c. All native
case observations, receipt/status cardinality, empty durable state before the
single preview and complete cleanup pass independent review. The strict verifier
and wrapper pass **94** Node cases, including every-field mismatch and extra
readonly-path mutation tampering. This slice does not approve or execute training
and does not close every configuration/runtime/remote variant in T38.

The earlier pilots remain explicit failure evidence: first at
`/private/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-validation-JHYRtJ`
and second at `.../wavedl-validation-Vezgdm` completed the UI flows but their
verifier rejected legitimate read-only POSTs; third at
`.../wavedl-validation-kcXFpt` rejected an incorrect authored-vs-managed output-dir
equality assertion. No invalid plans/executions were accepted. The final run
records fixed endpoint identities and the explicit managed-path contract; these
pilot reports are not silently promoted to acceptance.

#### F04 assembled local POSIX crash/recovery

`unit_tests/daemon/test_registry_http_recovery.py` covers two transaction write
orders × two recovery paths (rebuild and direct ingestion). A durable
`JournalWriter` fsyncs/closes hello seq 0, the authenticated ASGI event route
enters the actual owner-thread SQLite transaction, and an owned subprocess is
SIGKILLed at the witnessed projection/cursor barrier. Same-database reopen proves
projection/cursor/event-log rollback. Rebuild restores the event independently;
the ingestion variant records missing-row state immediately before its first
real poll. Three subsequent polls and authenticated public state remain identical,
with one event row and cursor zero. Bad bearer gets 401; host outstanding work
and owned thread/process closure are measured. Reverse write order is injected;
numerical startup uses a controlled backend. No metric, browser, network,
Windows or real filesystem/Slurm-site certificate is claimed.

Root's dependency-light final run passes **33**, zero skips/errors/failures:
`/private/tmp/wavedl-registry-http-recovery-final2-20261014.xml`, SHA-256
`e5faf660f33117b88af44b63ad95cfc0df40ac5a8070b28469ce81c1c59de8df`.
Four measured reports under `/private/tmp/wavedl-registry-recovery-ci.Us6R1K`
pass the strict POSIX-only verifier. The report reader rejects duplicate/malformed
JSON, nested boolean/type substitution, missing/unsafe identities, links/ancestry
replacement, public/oversized files and overwrites. Windows collection visibly
skips this POSIX-only module; existing native Windows mandatory checks are
unchanged and remain unverified here. Browser CI requires all four reports plus
the complete 33-case zero-skip XML; four workflow contract tests pass. Hosted CI
is wired, not executed.

Current combined metadata/F04/workflow cohort passes **80**, zero skips/errors/
failures at `/private/tmp/wavedl-migration-acceptance-new-20261014.xml`, SHA-256
`5184d04b33283b98118e26ddca737b937fb33dea30af942ffabef10dd070f93f`.
An earlier incorrect `--noconftest` invocation lacked `paused_process` and failed
four setups (76 passed); the proper scoped conftest run passes all 80, and the
dependency-light F04 `--confcutdir=unit_tests/daemon` run passes all 33.

Current strict source-bound epoch report passes:
`/private/tmp/wavedl-epoch-validation-frozen-20261014.json`, SHA-256
`70dc79d02ec8f5ff5935008ba586381bffa4cd727b327fa97d435c737c0f275a`.
The fresh full regression (`wavedl-full-validation-frozen-20261014.xml`) passes
**3,883 / 14 skipped / 336 slow/GPU deselected**, zero failures/errors, 644.15
seconds; SHA-256
`3066c305a5b471573eb6666d257cc504bff63c50923565567fc5f1a21e1dfe70`.
Root audits all 3,897 selected cases and unchanged hashes for all 427 Python
source/test files. Exact-package acceptance is staged; original twelve-browser
recertification is running separately. Only four verified
inactive task-owned virtualenv directories from completed earlier package tests
were removed (about 2.8 GiB); their packages/reports/evidence and all configured
user environments remain. No completion is inferred from running checks.

Exact 7b1c runtime-package acceptance passes **1/1**, zero skips/errors/failures,
59.22 seconds. Archive
`/private/tmp/wavedl-release-preview-dist.TxbwSK/wavedl-1.8.1.tar.gz`, SHA-256
`13bcaa4be843f5a8abb292a7ddf92d8886f661267511e20a60b931e2e943190b`.
Rebuilt wheel SHA-256:
`434674576f7bfe668c555fde7204289a1066c6f8d083f45c947cc63d4e0f1c7a`.
JUnit `/private/tmp/wavedl-release-preview-report.MCxtjs/release-sdist-installed.xml`,
SHA-256 `ef46ccf84a80d2fc83adc63b8cc489544a1b6809857dacb4dd3822c9813dfa53`.
All 219 production Python files and 39 assets match the frozen staged source,
sdist and rebuilt wheel. Parallel README progress edits are intentionally outside
the runtime/static parity claim. Only this new task's completed virtualenvs were
removed after acceptance; artifacts/evidence remain. No publishing occurred.

The final original twelve-case 7b1c browser recertification passes **12/12**:
`/private/tmp/wavedl-cv12-acceptance-new-UZq6rx/wavedl-browser-acceptance-e8bZUS/summary.json`,
SHA-256 `af3710b8b85078300c09cb0ddbf0359107616ee62450cb2056a40e2e10f53ef2`.
Root independently reruns the fail-closed aggregate verifier and confirms exact
7b1c assets, all twelve passed statuses and complete fixture/browser cleanup.
The named earlier eece aggregate remains rejected as stale against this build.
The new invalid-authoring report and strict current-source epoch report also
pass their independent verifiers. These scoped local checks do not sign off all
24 T38 rows, real-site filesystem/Slurm, native Windows/GPU or authorized release.

Full T30c/T38/native/platform/site, hosted CI, authorized release and Qt retirement
remain open.

### Historical status — 2026-10-14 (eece; local acceptance passed)

Current generated/vendored inventory is
`eecefbd5b13c587b2ee1951c91b7b186851ad62707cd201e0efc3a84bde5a835`,
38 assets. Prior 58d4 output remains recoverable at
`web/.vendor-backups/backup-upr2a97b`. Deterministic CV now matches ordinary
training's warn-only policy while restoring caller Python/NumPy/Torch RNG and
backend flags after success/failure. Actual stochastic two-fold CPU runs compare
metrics and model tensors; native macOS spawned workers and actual CLI forwarding
are covered. CUDA/MPS execution and universal bitwise reproducibility are not
established by these CPU tests. Auto-worker CV probes only a newly owned byte of
shared memory and falls back to zero workers on creation/cleanup denial; explicit
worker counts remain unchanged. Positive auto-count tests use controlled loader
observations, not native throughput/worker-count certification.

Browser and Python CV checks require SGD with positive finite momentum for
Nesterov, and a finite plateau factor in [0, 1). Other schedulers may intentionally
increase LR. Mounted correction flows and repeated Local/Slurm HTTP rejection
prove no invalid preview transport or persisted plan/key/job. Deterministic is no
longer in the unsupported list; resume/save/fresh/compile/tracking remain visibly
refused until implemented. Preferences/presets still preserve editable drafts.

- CV/data cohort: **98 passed**, zero skips/errors/failures, 50.78 seconds;
  `/private/tmp/wavedl-cv-complete-current-20261014.xml`, SHA-256
  `296422e5fbb10ee19f0573ef371179953dfff3f43d7791b00ccb19a9676dffb7`.
  The mandatory CI guard requires exact family counts, unique case IDs and no
  skipped/failure/error elements; 16 workflow contract tests now pass, including
  mandatory OneCycle gate wiring (the original CV-only cohort had 15).
  This is not exact per-test-name identity attestation or hosted CI acceptance.
- Contract/planning cohort: **158 passed**, zero skips/errors/failures;
  `/private/tmp/wavedl-cv-contract-current-20261014.xml`, SHA-256
  `4de5ee3b9e8c38921c80c41e3b34efc6ff1c7bfabec0e4cae6e453443c6e79ef`.
- Frontend: **736 passed**, zero skips with real Python export integration;
  typecheck/lint/format pass. Generated worker: **38 passed** using the clean
  Python environment. The first generated-test invocation used system Python
  without Starlette and failed; the correctly configured rerun passes all 38.
  A final repeat ran Vitest alongside `nuxt prepare` and two suites failed to
  load the temporarily absent generated `.nuxt/tsconfig.app.json` (676 cases
  passed, not a complete acceptance). Once type generation completed, the
  sequential rerun passes all 736. CI already runs typecheck before tests;
  no source change or test skip was used to bypass this orchestration race.
- Browser action/CV guards: **74 passed**. Actual mounted deterministic CV,
  completed folds, summary refusal, explicit fold evaluation, verified prediction
  download and complete cleanup pass at
  `/private/tmp/wavedl-cv-browser-deterministic-20261014/cv-parity.json`, SHA-256
  `590569f07c6a96424f05539e8baac4782dd79f36a66a79b217fcf0476842f496`.
  Its manifest hash equals eece; no GPU/remote/complete CV parity claim is made.

#### Pre-OneCycle source snapshot and overlapping regression boundary

Exact source-distribution rebuild/install passed **1/1**, zero skips/errors/
failures, 51.89 seconds before the subsequent normal-training OneCycle change.
Archive:
`/private/tmp/wavedl-release-freeze-dist.bFCCok/wavedl-1.8.1.tar.gz`, SHA-256
`71599ec6610ce37df52c239a0b2da4739d1854c2ec912f94f67cf70af13231d8`.
Rebuilt wheel SHA-256:
`a6435d2f95a7e95d347961630502a78167d9cc6f947069e507cf6eec83162ff2`.
JUnit `/private/tmp/wavedl-release-freeze-report.i4tqh9/release-sdist-installed.xml`,
SHA-256 `fadb874d094e030572477f37b2bb6b68b491bd407a114207d175ccc5698c1788`.
219 Python files and 39 web assets match the then-frozen checkout/staged source,
sdist and rebuilt wheel byte-for-byte. No publishing/tagging occurred.

The strict current-source epoch browser gate also passed before the OneCycle
edit at `/private/tmp/wavedl-epoch-deterministic-current-20261014.json`, SHA-256
`191fd78173a5f632e8dffc28208ace5246b4acc363977e66c1556ca36f949845`.
After the edit its runtime-source fingerprint is historical, not a current
certificate. Its same-epoch CPU scope and all original open gates are unchanged.

The broad run reports **3,825 passed / 14 skipped / 336 deselected**, zero errors/
failures, 592.77 seconds at
`/private/tmp/wavedl-full-deterministic-20261014.xml`, SHA-256
`f7d11017d061898d010f9921034b9711b632044f9776a12f20fcc4b4f9b884c1`.
Root's pre/post inventory changed `src/wavedl/train.py` and added
`unit_tests/test_training_onecycle_accumulation.py` (424→425 Python files).
Therefore this is an overlapping diagnostic run, **not** frozen-source acceptance.
The OneCycle correction now budgets post-shard optimizer updates rather than raw
microbatches, disables Accelerate's duplicate world-size scheduler advancement,
and retains prepared scheduler checkpoint filenames. The inherited wrong-
budget scheduler state in old checkpoints is not silently rewritten.

Final OneCycle focused report: **7 passed**, zero skips/errors/failures, 28.21
seconds, `/private/tmp/wavedl-onecycle-final-current-20261014.xml`, SHA-256
`f7546526dbb4cbf491ea33b9a39a579bafff3f3661998aa6b6f1d05b61e52c7f`.
Three genuine CPU accumulation cases and a native two-rank CPU case verify saved
scheduler budgets, Adam update counters and reference LR. Actual cancellation
after epoch one resumes both emergency `scheduler.pt` and managed
`scheduler.bin` paths to nine optimizer/scheduler updates. The remaining case
uses a controlled CPU scaler to verify skipped-update suppression; it does not
certify actual CUDA overflow behavior. Independent review passes the final resume
variants and the seven-case gate, plus neighboring runtime/DDP cases. The broader
focused implementation run passed 72 before adding the normal-resume variant.
Mandatory CI requires all seven cases with unique IDs, exact module ownership
and zero skips/errors/failures, and uploads their XML; hosted execution remains
unverified. The earlier six-case XML at
`/private/tmp/wavedl-onecycle-current-20261014.xml` was correctly rejected by the
seven-case guard; independent recertification later replaces it with seven cases
(SHA-256 `38708b7a6c4c64aadb7536984274990b23300497daf70d17ff6ada818733c821`).

Fresh frozen regression `/private/tmp/wavedl-full-onecycle-frozen-20261014.xml`
passes **3,833 / 14 skipped / 336 slow/GPU deselected**, zero failures/errors,
620.04 seconds; SHA-256
`e52071efb93d35d0b131d23e5b417d12cd5554c763169aca2e8d6fb7ff3350cc`.
Root independently checks all 3,847 selected cases and unchanged hashes for all
425 Python source/test files, with no additions/deletions. Thirteen skips require
native Windows and one requires the dedicated Linux tmpfs mount (previously
passed separately). The source remains frozen through verification.

Post-OneCycle exact runtime-source package acceptance passes **1/1**, zero
skips/errors/failures, 47.76 seconds. Archive
`/private/tmp/wavedl-release-onecycle-dist.NVU0U2/wavedl-1.8.1.tar.gz`, SHA-256
`44827c27c942f2c8025929ac0e0db9701397071969784525a00358ece5e8a21b`;
rebuilt wheel SHA-256
`e8ca6f54bb52a328bf15a52670b4e0aec931cc180cf4cbe9808dda837de7a99f`.
JUnit `/private/tmp/wavedl-release-onecycle-report.cIHc2f/release-sdist-installed.xml`,
SHA-256 `60c3e1bb89bb98ad6adb88ffdc9c37bd643927dd6e6aa5f1bad69ddf63e34805`.
All 219 production Python files and 39 packaged assets match the snapshot, sdist
and rebuilt wheel. Root's concurrent README progress update is intentionally not
claimed byte-identical documentation coverage. The completed task's new runtime/
build virtualenvs were removed after verifying inactivity; package/report/runtime
evidence remains. No previous roots or configured user environments were removed.

Current strict epoch browser report
`/private/tmp/wavedl-epoch-onecycle-frozen-20261014.json` passes its
`--require-current` runtime-source/assets/screenshots/cleanup guard, SHA-256
`0041e92564d2272a20e79ac96ec46ac95ee3e266064395e80c1d1a36b4edda46`.
Current deterministic CV/fold-evaluation browser recertification passes at
`/private/tmp/wavedl-cv-browser-onecycle-frozen-20261014/cv-parity.json`, SHA-256
`9b8a58ed5c79a1357c23dea5bc1bd38325c6cf6f6709520fc582b86e24c4a44f`.
These are local CPU slices, not complete T30c/T38.

The separate original twelve-case browser recertification passes **12/12**:
baseline, offline, detach, reload, cancel, lost-ACK, artifact tamper, port reuse,
live port reuse, authoring parity, download names and dataset parity. Summary
`/private/tmp/wavedl-cv12-acceptance-UD6iTe/wavedl-browser-acceptance-FvGeYY/summary.json`,
SHA-256 `5960e56bbcc58d5cd57932bf06f3ab0a5b28d8c8018416b0484a8c9eafe60ace`.
Root independently reruns `tools/verify_browser_ci_report.mjs` on its dedicated
root and checks all twelve statuses, asset hashes and empty cleanup errors.
All use exact eece assets; fixture/replacement exits are accepted SIGINT and
all twelve owned browser profiles are confirmed absent. Baseline submission/
immutable publication, actual tampered-response refusal and full-identity native
download filenames retain their genuine evidence contracts. The aggregate proves
these twelve scenarios, not every field/path/fault/PWA/remote variant in all 24
T38 rows. No user browser, runtime credentials or unrelated state was modified.

Full T30c/T38, native Windows/GPU, actual Slurm/filesystem/site, hosted CI and
authorized T40/R1/T41/T42 requirements remain open.

### Historical status — 2026-10-14 (58d4)

The rebuilt served client has inventory SHA-256
`58d4762e5fd6e4b22feb07c2d75d8fb3e7f545d65f95ae4930463925557d4897`,
38 assets. Prior 5864 output remains recoverable at
`web/.vendor-backups/backup-osaziadr`. Browser validation now matches the
dependency-light Python CV compatibility validator: CV=1 or unsupported
nondefault resume/save/fresh/deterministic/compile/tracking choices are refused
before plan persistence. Errors name only option keys; repeated authenticated
Local/Slurm requests produce generic 400 with no plan/key/job. Defaults remain
explicit compatibility placeholders, not claimed checkpoint-resume support.
Cache validation is retained but inapplicable to CV's direct source read.

The browser explains incompatibilities at individual fields before preview.
Preferences and presets preserve editable legacy values through an unrefined
base schema, while full form/plan submission requires the refined schema.
Independent review found no approval bypass or silent preference loss. The
all-fields authoring fixture is explicitly regular training (`cv=0`); separate
CV tests cover supported/refused configurations rather than silently approving
the former incompatible combination.

Current verification: **155** Python contract/planning cases, **114** combined
CV/data/core cases, **711** frontend cases with Python export integration enabled
(zero skips), typecheck, lint/format, **38** generated-worker cases, and **41**
all-fields browser-tool contracts pass. The combined Python report is
`/private/tmp/wavedl-cv-compat-final-20261014.xml`, SHA-256
`a216102ab12bc06c2b16b83ee65dfb547f420e0b33ba7bb4f245b5cccd26b9c9`.
The current epoch browser report passes its strict source/asset/screenshot/cleanup
guard at `/private/tmp/wavedl-epoch-final-assets-20261014.json`. Older 5864 browser
and package reports, including the 3,701 full-suite baseline, predate this latest
compatibility/bundle change; they are not silently current-58d4 certificates.
The fresh current 58d4 full regression now passes **3,764 / 14 skipped / 336
slow/GPU deselected**, 543.92 seconds, zero failures/errors:
`/private/tmp/wavedl-full-final58d4-20261014.xml`, SHA-256
`ee47ea39fe0ad8a025da99640abf043049b98765c814bf4460dbc3e37ca46603`.
Root audits all 3,778 selected cases and unchanged hashes for all 421 Python
source/test files. Native Windows (13) and isolated Linux tmpfs (1) remain skips;
the real tmpfs case passed separately. Current-package recertification also
passes as recorded below. Full current-bundle parity, native Windows/GPU/site,
hosted CI and authorized release/Qt retirement remain open.

### Previous status — 2026-10-14 (5864; historical)

Frozen generated/vendored inventory:
`5864c81a4f691bd504da7bfd9a9956df511f6268a268f9e1134ad7db8f6c34db`;
38 verified assets. Prior 04b5 output is retained for recovery at
`web/.vendor-backups/backup-f27_km7z`.

Later same-static-bundle numerical result correction is owned by
`src/wavedl/test.py`: empty evaluation/prediction now fails instead of silently
completing without a result. Model output must match `(samples, outputs)` and
remain finite; inverse scaling must preserve shape and finite values before
metrics, CSV or result publication. The training loader is unchanged. Undefined
singleton metrics still serialize as null, and the export-only early return is
preserved. Root passes **37** runtime-operation cases and **32** actual ONNX
tests. Independent runtime review passes the same 37 cases. Numerical/empty
cases execute real CPU inference; malformed-shape/scaler cases explicitly use
fault injection. Every invalid case checks failed/nonzero, no CSV/artifact/
COMPLETE publication and unchanged checkpoint bytes. The export-only dispatch
regression is mocked, not a new ONNX export certificate.

`unit_tests/daemon/test_pending_cancellation_http.py` adds a passing public ASGI
and actual Local process boundary case: cancellation during a held submit stays
uncertain until its receipt and native cancellation; an unclaimed cancelled run
never spawns. Repeated intent does not resubmit or redeliver. The interpreter is
a POSIX sentinel shim, not an ML runtime, and Windows explicitly skips this
supplementary case. Three real hosted targetless NaN/Inf/empty evaluation cases
also pass with pinned published best sources, exact approved manifests,
confirmed failed/nonzero runtime outcomes, no CSV/artifact/COMPLETE generation
and unchanged training publication bytes. Root's assembled runtime/hosted/
pending slice passes **41**, with no skips; its mandatory CI step and explicit
three-case JUnit guard are wired but have not run remotely. The built-browser
numerical failure gate passes with exact evidence recorded below.

The current broad numerical-runtime regression passes **3,532 / 14 skipped /
336 deselected in 515.20 s**:
`/private/tmp/wavedl-full-numerical-5864-20261014.xml`. Independent JUnit audit
counts 3,546 selected testcases with zero failures/errors. All 410 production
and test Python files stayed hash-identical during that run; evolving browser
tooling was outside this stable Python snapshot. The 14 skips remain native
Windows (13) and isolated Linux tmpfs (1). The 3,505-test baseline below is
historical for the runtime preceding the numerical result correction.

Production cancellation correction is owned by
`web/workstation/lib/run-monitor.ts` and
`web/workstation/components/runs/RunDetail.vue`. One shared predicate blocks
in-flight or acknowledged repeated intent while preserving unknown retries,
uncertain supervision-lost and native-pending cancellation. Every returned POST
response is checked against immutable run/plan/request/backend/operation and
present native cluster/job/owner, even when superseded by a newer poll. Older
legitimate acknowledgements cannot regress the newer attempt/native head.
Poll-confirmed cancellation is monotonic through rejected/false delayed POSTs
and subsequent false polls; no local terminal state is invented.

Training producer snapshots now describe the same epoch that is committed:
`best_val_loss` is the current epoch’s best (including epoch 1), and patience is
the post-epoch counter. A real CPU plateau/early-stop fixture plus resumed
metadata reset passes **15** runtime-training tests; actual two-rank CPU DDP
passes **4** tests. Frontend metric-history/summary tests pass **21**. The
existing post-scheduler broadcast/checkpoint ordering remains unchanged.

Fresh full Python regression after the epoch producer and final release helper
changes passes **3,551 / 15 skipped / 336 deselected** (3,902 collected),
`/private/tmp/wavedl-full-epoch-release-20261014.xml`, SHA-256
`6063e3791a9eba8503f29b29bc60830e8b99e253e9fb048a8d57f20f470bf0ba`.
Root audits zero failures/errors and unchanged hashes for all 412 Python
source/test files across the run. Skips are 13 native-Windows cases, one explicit
Linux tmpfs case, and the opt-in isolated install without its wheelhouse setting.
That install is separately recertified with the actual configured offline
wheelhouse: **1/1, zero skips**, 75.90 seconds,
`/private/tmp/wavedl-epoch-install-recert-20261014.xml`, SHA-256
`f57ab4b61f9663d0b04b562e653a3b231fffa6323cbfe9598ab2a92983456474`.
The broad suite uses `not slow and not gpu`; it is not native-platform/GPU/site
proof. The earlier 3,532-test result remains the pre-epoch/release baseline.

The observational epoch browser run now reaches both required live states at
`/private/tmp/epoch-metric-final6.json` (SHA-256
`9251a9b2b632bb13093156029eed61c88818feebbeebdf5bd17df50b56324d24`): epoch 1
is running with first-best validation loss and patience 0/2; the run configured
for seven epochs early-stops after epoch 3 and displays completed/patience 2/2.
The journal, captured console metrics, history, metadata and SQLite source_seq
agree. This uses a stationary custom model and bounded real CPU matrix work
solely to pace observation; it is not throughput evidence or cryptographic
TOCTOU pinning of custom imports. At creation its draft guard had only two smoke
contracts; that certificate is historical, not current strict sign-off. Prior
failed reports are retained, not relabelled.

The subsequent strict run
`/private/tmp/wavedl-epoch-strict-20261014.json` (SHA-256
`a85592b0ddb431571a3d8a50c8b0d9b255ffaf2f8937b0c68d468bb06530b41e`)
passes the then-current 48-test guard, captures actual first/final epoch states,
and confirms all seven owned cleanup fields. Independent review then identified
missing manifest/file-inventory/DB-journal bindings and screenshot validation.
These are repaired: the guard now passes **64** tests, including complete current
800-file source inventory, full asset inventory, publication and journal hashes,
DB replay equivalence, bracketed screenshot epochs, bounded CRC/PNG decoding at
1280×900, exclusive output-path checks and exact JSON browser-session absence.
Root scoped Ruff/Oxfmt checks pass. The post-review attempts
`/private/tmp/wavedl-epoch-final-reviewed-20261014.json` and
`/private/tmp/wavedl-epoch-final-reviewed-retry-20261014.json` are **failed**:
first-epoch DOM evidence is captured, but the native screenshot command times
out. Genuine CPU training completes; roots remain retained and no report is
retrofitted. An isolated `about:blank` screenshot also times out. Fresh positive
acceptance and mandatory runner/file-guard CI wiring were pending at that point;
contract tests alone do not certify the browser gate or T35/T38.

The fresh post-review report now passes root's and an independent agent's strict
current-file guard:
`/private/tmp/wavedl-epoch-shell-final4-20261014.json`, SHA-256
`0850e7177bf2c3e5fb70f08555b603fbf403265a146032e016664b14f3ac60bd`.
It proves actual three-epoch CPU training, first-best loss, patience 0→1→2,
early stopping at epoch 3 of the approved seven, exact journal/DB/history/
checkpoint/publication lineage, bracketed 1280×900 screenshots and all seven
cleanup fields. The captured JSON session list excludes the owned session;
native PID 23552 is absent. Root and reviewer visually inspect both screenshots.
The frozen static inventory remains `5864c81a...` and all 800 source hashes match.
The strict verifier passes **64** tests; two separate workflow-wiring tests pass.
CI now runs the additive runner and strict verifier unconditionally and uploads
only the report and two screenshots, without weakening the twelve original
cases. This wiring has not been executed on hosted GitHub.

The macOS screenshot workaround uses an explicitly selected, task-local official
Chrome headless-shell **150.0.7871.24**, not a user/browser installation change.
Archive SHA-256 `dc0c41987be926773db9e12e65210b04fac46def7c2eda4c4eb175a0c4691e6a`;
executable SHA-256 `066f900e847ed0988087c3546c85c850668b9a1a37889cfa430e0df91e18bbee`.
Both remain in `/private/tmp/wavedl-cft-shell.2W5So7`. The runner checks a real
loopback preflight screenshot before launching ML and supports the explicit
`WAVEDL_BROWSER_EXECUTABLE` override; Linux CI retains its installed default.
The observed full-Chrome timeout matches
[upstream issue 1437](https://github.com/vercel-labs/agent-browser/issues/1437);
its precise compositor/CDP cause is not established here. Failed reports and
diagnostic roots are retained unchanged. This narrow stationary-model CPU gate
does not close transport-gap, restart, remote/GPU or complete T35/T38 requirements.

Release hardening is implemented but not executed on hosted GitHub: release
waits for tests, package verification, reusable daemon-foundation/GUI/browser
gates; one generated/vendored wheel+sdist is hashed and consumed by both GitHub
Release and PyPI; PEP 440 prerelease classification is used; fresh outside-
checkout exact-wheel acceptance passes **1/1** at
`/private/tmp/wavedl-release-exact-bounded-acceptance.xml` with wheel SHA-256
`abc1c7d82466f885bf8698675290a2f187953912e4fd2c14a456c608e01a24f2` and assets
matching current inventory SHA `5864c81a...`. No release/tag/publish was run.

Final independent release review passes **19** focused workflow/artifact tests.
The package job's manifest SHA is an independent output anchor; both consumers
require it before trusting downloaded bytes, and execute verifier code from
checkout, not from the artifact. The release-only exact-wheel acceptance uses
bounded 180-second command deadlines; ordinary acceptance retains 60 seconds.
Browser gates regenerate their own bundle, so they do not certify execution of
the exact distribution's browser bundle. The exact-wheel gate independently
checks installed HTTP asset bytes and runtime behavior. Hosted execution, sdist
installation and authorized publication remain unproven.

Independent review passes **49** focused monitor/control/use-runs tests. Root's
full frontend run passes **683**, with typecheck/lint/format. Current generated
worker checks pass **38**; static/offline/installed-web/vendor Python checks pass
**97**. The separate 04b5 installed-console **4/4** and browser certificates
below remain evidence for that bundle, not implicit 5864 sign-off. Current
twelve-case recertification passes 12/12 at
`/private/tmp/wavedl-d12-9xg8W2gs/wavedl-browser-acceptance-W60YJn/summary.json`
(SHA-256 `aa0b20c4c7c66058d4ad28008c3b34a0b5d0c1f59ee80d8cb66bd3e93482be04`).
Root independently passes its strict dedicated-workspace/current-assets/cleanup
guard. The additive real cancellation lost-ACK gate also passes current 5864:
`/private/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-cancel-ack-UBDck3/cancellation-lost-ack.json`
(SHA-256 `1e46544c3166d9fa228bca4611f1322fbab054f99f646f04506f21c5410083fa`).
It uses a genuine seeded Local CPU run and real browser/API/daemon path: one
committed cancellation POST is delivered as 503 after commit; the browser
observes unknown, then requested/stopping with Stop disabled, then confirmed
cancelled. Durable cancellation intent/delivery and native `CANCELLED` exit
143/PID absence are independently proven. Runtime journal outcome is honestly
`unknown` because native cancellation may preempt its final journal event.
Raw SQL remains a telemetry projection, not lifecycle authority. All owned
cleanup passes. This is scoped local CPU evidence, not complete cancellation
parity or remote/GPU/Windows/site certification. Same-host wall-clock DOM/GET
observations bound the visible timeline, not a complete causal proof.

Current authoritative Python regression:
`/private/tmp/wavedl-full-current5864-20261014.xml`: **3,505 passed / 14
skipped / 336 deselected**, 0 failures/errors, 3,519 selected testcases. The
14 skips are 13 native Windows cases and one explicit Linux tmpfs case. During
that run the Python/asset snapshot stayed unchanged; two evolving cancellation
browser tooling files were outside the stable Python production snapshot.
The final focused fixture/reducer/controller checks pass **92**, and the
cancellation verifier passes **28** contracts after mandatory CI wiring.
The additive runner/unique-workspace guard and exact JSON-only artifact upload
are wired with symmetric push/PR triggers; hosted CI has not run.

### Current recertification — 2026-10-14 (post-CV/storage/release work)

#### Later CV training-semantics correction

CV now consumes accumulation, precision, pretrained selection and physical
constraints instead of silently dropping those authored values. Accumulation
matches Accelerator's configured loss divisor, flushes partial windows, clips
only at optimizer boundaries and budgets OneCycle using ceiling update counts.
CPU BF16 is exercised with real autocast; CUDA FP16 uses scaling/unscale/clip/
step/update and gates scheduling on successful updates. CUDA capability and
overflow paths have controlled tests, not a real GPU certificate. CPU FP16 and
unsupported MPS mixed modes fail explicitly. BF16 predictions are converted to
FP32 before NumPy metrics.

Each fold receives explicit `pretrained` selection and a physical criterion built
from only its training scaler. Expression and file penalties receive actual
inputs during training; validation/checkpoint selection use base loss, as in
standard training. The wrapper and weighted-loss buffers move to the selected
device. Real two-fold CPU cases verify false/true forwarding (without downloading
pretrained weights) and fold-specific penalties. Direct helper defaults remain
full precision and one-step accumulation; its pretrained default is explicitly
false to avoid a registry family's implicit download/default selection.

Root and independent review pass **85/85** under normal pytest collection:
21 prior fidelity/HDF5 cases, 20 accumulation/precision cases, 11 physical/
pretrained cases and 33 existing CV/data cases. Report
`/private/tmp/wavedl-cv85-default-20261014.xml`, SHA-256
`d34d9e690d589eeef5c97e6eb4096150bc973f614bb08b9c159d882d185d2bfb`.
Explicit shared-fixture aliases resolve the independently discovered collection-
order setup failures. Ruff checks/format and diff checks pass; CI now requires
all 85 cohort cases with no skipped/error/failure outcomes, and root executed the
expanded guard against the actual report. The static bundle stays 5864.
Deterministic/compile, tracking and CV resume/save/fresh remain open. The earlier
3,670 full-suite and package/browser certificates predate this correction;
a fresh full regression is running. The final outside-staged exact sdist now
passes **1/1** (three deselected, zero skips/failures/errors), 48.97 seconds, at
`/private/tmp/wavedl-cv-final-sdist-20261014.gMYwKS/current-acceptance.xml`, SHA-256
`f6d58a08e59f2bf1581dab84feccec39ad0930d412dbbd69b6f847e022a8d597`.
Its tar SHA is `f79c7b46c89da533b2562cf8096ed858714359d760f0897f2b6c12c680d6dc3f`;
all **219** product Python files (including `cv_components.py`) and **39** web
assets match current source. Earlier package reports remain historical.

The first full post-semantics run is retained as **failed**:
`/private/tmp/wavedl-full-cv-semantics-20261014.xml`, SHA-256
`16ed1a86cdb90cad389301efc8c2464f29790b49528b724ef9f6cb7347bc5c0a`:
3,700 passed, one failed, 14 skipped and 336 deselected; all 420 Python source/test
hashes were stable. Its one failure is the existing two-rank writer case: after
the first checkpoint PyTorch reports a zip file-position write failure. The host
data volume then reports 100% capacity/2.3 GiB free. Ten inactive, verified task-
owned acceptance venv/build-venv directories were removed, preserving archives,
reports, wheels and runtime evidence; free space recovered to 8.8 GiB. The exact
two-rank test independently passes afterward in 14.16 seconds at
`/private/tmp/wavedl-ddp-storage-retry-20261014.xml`. This supports storage pressure
as the cause but does not rewrite the failed certificate. A clean full-suite
rerun with restored headroom now passes **3,701 / 14 skipped / 336 deselected**,
541.75 seconds, with zero failures/errors at
`/private/tmp/wavedl-full-final-current-20261014.xml`, SHA-256
`d6b729fa82335a7000a184c09c39ef81cdc5d899fa08e35cbfebac00605b613a`.
Root audits all 3,715 selected cases and unchanged hashes for all 420 Python
source/test files. Windows-only (13) and isolated Linux tmpfs (1) remain the
skips; the tmpfs scenario passed separately. Disk pressure is consistent with
the earlier write fault, but its exact cause was not captured as ENOSPC and is
not treated as proven or erased from the record.

The current runtime's fresh epoch browser gate passes the strict file verifier at
`/private/tmp/wavedl-epoch-cv-semantics-current-20261014.json`, SHA-256
`6d173ef26ab2059861a57ed1af493445832c671e13a022d99a38a777e4c818ce`.
It binds the newly added helper in its 801-source inventory, unchanged 5864 web
assets, first/final screenshots and all owned cleanup. The separately passing
two-rank retry report SHA is
`f3bd17ea051ae7f25c105945cee52ddf524e527776ce6329a3844c2030c4b551`.

The real Linux storage-failure slice now passes on a dedicated 4 MiB tmpfs
inside a disposable container: exactly one `test_real_tmpfs_enospc_preserves_authority_and_recovers`
case, zero skips/failures/errors, real SQLite `SQLITE_FULL`, unchanged committed
cursor/event count/bookmark during three reconciliation laps, exact replay after
space recovery, and empty tmpfs cleanup. The captured report is
`/private/tmp/wavedl-linux-tmpfs-current.Mj4kXW/tmpfs-acceptance.xml`, SHA-256
`6752aa6850b99609b12138910d8a6b9254ebb969a1d69137edf97e8f5b04eec6`.
The strict report guard passes **79** adversarial tests; workflow/cleanup tests
pass **7**, including preservation of the original test exit status when unmount
or directory cleanup fails. CI now has mandatory Ubuntu Python 3.11/3.13
dedicated tmpfs jobs with bounded mounts, EXIT cleanup and zero-skip report guards.
This is genuine local filesystem/SQLite/ASGI evidence, not shared-site or Slurm
proof.

CV now forwards authored weighted-loss weights, Huber delta, SGD Nesterov and
scheduler gamma/factor, step size, milestones and warmup settings into actual
two-fold CPU training. The final fidelity/resource suite passes **21/21**; existing CV/data
tests pass **33/33**, writer CV HTTP tests **5/5**, and the assembled component
slice passes **94/94** at `/private/tmp/wavedl-cv-final-20261014.xml`, SHA-256
`d9a5f988494c370adfc86abf7cfff86632fea26e5232e60f350f097f0cab1def`.
Seven real HDF5 failure cases prove exactly-once closure for invalid shape and
options, failed lifecycle status and no publication. Beta pairs require two
finite values in `[0, 1)`. The summary's existing 11-key wire contract remains
unchanged. Browser CI requires all 21 named fidelity/resource cases with zero
skips; root executed that exact guard against a fresh report. Independent review
found no regression and documents
remaining CV drops (precision, pretrained, accumulation, constraints,
deterministic/compile, resume/save/fresh and tracking) as open parity work.
This component fix is not full CV/T38 sign-off.

The previous 3,551 full-suite baseline and earlier runtime-bound browser reports
predate this CV change; they remain historical, not silently recertified. The
post-CV epoch report now passes the strict current 800-source/asset/screenshot
guard at `/private/tmp/wavedl-epoch-post-cv-20261014.json`, SHA-256
`3b7b6061922aacfaa57d79f9a071b794166ee2fef38267275a0667ed2c686fe6`, with
complete owned cleanup. The static bundle remains 5864. The fresh full Python
regression with the explicit offline wheelhouse now passes **3,670 / 14 skipped /
336 deselected** (4,020 collected), 563.75 seconds,
`/private/tmp/wavedl-full-post-cv-storage-sdist-20261014.xml`, SHA-256
`f789d6e8c9036cdbf9f896221bdb3b0823102b3c6504aa8a22f31152d08944b2`.
Root independently audits all 3,684 selected cases with zero failures/errors and
unchanged hashes for all **417** Python source/test files across the run. Skips
are 13 native-Windows cases and the isolated Linux tmpfs test separately passed
above. This does not certify slow/GPU, hosted or real-site variants.

The exact source-distribution gate is now implemented and independently reviewed:
the exact tar is rebuilt in a separate no-system-site-packages environment using
offline build tools, its version and all **218** product Python files plus **39**
web assets must match, and the installed daemon/CLI/static/bootstrap/CPU lifecycle
passes outside the checkout. Post-CV evidence is
`/private/tmp/wavedl-current-sdist-20261014.WbfB9c/current-acceptance.xml`,
SHA-256 `34b2e160662413da0b5d3772674254d93f2bdbf4525025c32fa8c3d18bd5c5c`,
with tar SHA-256
`2e9bf313142f5d87676180744891b62debae24e08377065945bb0a993baf42be` and
one passed selected case (three deselected, zero skips/failures/errors). That
report predates the final HDF5 cleanup. The final archive, built from an explicit
outside-checkout staging tree, is now certified at
`/private/tmp/wavedl-current-sdist-final-20261014.IXPo2i/staged-acceptance.xml`,
SHA-256 `6f467cd0164528a71cdcc9e78e7311bcfe021f7b79c2b0f37ef2e76c4253e42c`:
**1/1**, three deselected, zero skips/errors/failures, 52.72 seconds. Its exact
tar SHA is `cbfb6ccfc1d52b8a4b1b40890a42cdd3823f2c6a065660be5edf968e7ebef9bd`;
all 218 Python and 39 asset files match final source. The fixture and workflow
contracts pass **28** tests independently. Release
CI now requires both exact-wheel and exact-sdist acceptance before artifact
upload. No hosted run, release, tag or publication has been performed.

The mounted Results numerical-failure gate also passes current 5864:
`/private/tmp/wavedl-numeric-report-final3/numerical-failure.json`
(SHA-256 `1f09c48fd1c7cebafcbb9a355463b951b2a712369758df72f8c53791f1226cea`).
It is a genuine browser → daemon → CPU runtime path over three input-only NPZ
cases (NaN, Inf, empty) against one published best checkpoint. Each selected
run renders a truthful failed state and producer error, public authenticated
GET evidence confirms failed/nonzero exit, no result artifact or COMPLETE is
published, and the original training publication bytes remain unchanged. Four
owned native processes exit 0/1/1/1 and are absent; browser/profile/listener/
credential/private-root cleanup is complete. This is scoped same-host mounted
Results numerical-input evidence, not complete P3 or remote/platform coverage.
Its current verifier has 36 contracts. The additive CI runner, strict verifier,
and JSON-only report artifact are wired with symmetric push/PR triggers; hosted
CI remains unexecuted.
Installed-console acceptance also passes **4/4 / zero skips**, with independent
JUnit `/private/tmp/wavedl-installed-cli-current5864-20261014.xml`; both newly
built wheels contain the current assets outside the checkout. The current abrupt-restart report
`/private/tmp/wavedl-current5864-restart-recert-20261014.NUOBFV/daemon-restart.json`
(SHA-256 `2787eb5a922da0fb14003e797db1736eb8c9be15e9b661b51da9aba41652e8c5`)
passes root's strict current-source/asset guard. It preserves the exact local
scope: genuine CPU run, owned-daemon SIGKILL, same DB/port/identity, public
`supervision_lost`, last-known metrics and independent runtime outcome, one
execution and no cancellation/resubmission. All private/runtime/browser/listener
cleanup passes. No hosted workflow, release or Qt retirement was performed.

Remaining T30c/T38 breadth, native Windows/GPU, real Slurm/filesystem/site,
hosted CI and authorized T40/R1/T41/T42 requirements are unchanged.

### Previous status — 2026-10-14 (04b5; historical)

Frozen packaged inventory SHA-256:
`04b5126c583e47c78077d8e2595e88c880d2385baf02d95492edf5cc2f93ce5c`.
All 38 assets match; no regeneration followed the current recertification.
The last-known metric caption is additive: epoch, elapsed time, metrics, charts
and journal diagnostics remain visible under uncertain ownership, explicitly
without claiming that the runtime is still active. Root's full frontend run
passes **661**, with typecheck/lint/format, **96** static/offline/vendor checks
and **38** generated-worker checks.

Current-build browser evidence, each checked against the frozen inventory:

| Scope | Current report | Result and boundary |
|---|---|---|
| Original twelve cases | `/private/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-browser-acceptance-7K6056/summary.json` | Root's strict `verifySummary` passes 12/12; per-case reports agree and owned cleanup is complete. |
| 100k metric history | `/private/tmp/wavedl-history-recert-20261014.json` | Exact 100,001 journal/event-log records, 100,000 metrics and cursor; 11.678 s selection-to-painted history. Controlled numerical fixture, not 100k ML epochs. |
| Preview faults | `/private/tmp/wavedl-preview-fault-current04b5126c-20261014-1/preview-fault.json` | Actual 409/503/200/200, four absent child PIDs, unchanged durable tables/source bytes. |
| Retained active CPU run/draft | `/private/tmp/wavedl-retained-current04-active-draft-20261014.json` | All 11 original stages, cold restart and storage-loss refusal; same active attempt and unsent draft retained. Namespaced isolated fixture generations. |
| Same-daemon reconnect | `/private/tmp/wavedl-reconnect-current04-20261014/reconnect.json` | Genuine CPU advances while detached; reauthentication and fresh `0:-1` replay restore the prefix with one execution and no cancellation. Not private transport-cursor persistence. |
| CPU checkpoint supersession | `/private/tmp/wavedl-supersession-recert-20261014.json` | Genuine CPU resume, adoption/lost-ACK retry and staged pass-through SSE; restored history replaces abandoned tail. Not live Slurm requeue. |
| CV explicit-fold evaluation | `/private/tmp/wavedl-cv-current04b5126c-20261014-1/cv-parity.json` | Two-fold CPU classification, explicit fold 2 and 96 prediction rows; summary source refused. Not all CV variants. |

All listed strict guards pass and all owned cleanup checks are true. The retained
build producer is
`/private/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-retained-browser-builds.Vom7So/summary.json`.
The prior broad non-slow/non-GPU Python baseline remains **3,495 passed / 14
skipped / 336 deselected** at `/private/tmp/wavedl-full-9419-20261014.xml`.
It predates the latest test-only restart regression; root separately reruns
the complete reducer, controller and restart-fixture files: **91 passed**, zero skips.
The 14 baseline skips are native Windows (13) and real Linux tmpfs (1);
the opt-in installed wheelhouse gate was enabled, not skipped.

The genuine abrupt owned-daemon restart report
`/private/tmp/wavedl-daemon-restart-accepted-20261014-05/daemon-restart.json`
passes root's strict current-asset/source guard. It proves active CPU execution,
owned daemon SIGKILL, same-port/private-database restart and explicit browser
reauthentication. Public derived state is `supervision_lost`; raw SQL may retain
a genuine BrokenPipe runtime failure independently. No PID adoption, resubmission
or cancellation is introduced. Independent review strengthens daemon/runtime
root/tag bindings, public wire identity and last-known UI evidence. Root reruns
**29** restart guard contracts and the strict accepted report successfully.
The mandatory additive CI runner/guard, symmetric push/PR triggers and exact
JSON-only artifact upload are wired and independently parsed. The original
twelve cases remain mandatory; no hosted workflow was executed. This is scoped
local evidence, not full F07/T30c/T38/native/site sign-off.

The installed-package T39a slice is also recertified against 04b5 with the
explicit offline wheelhouse: JUnit
`/private/tmp/wavedl-installed-cli-current04b-full-20261014.xml` records **4
passed / 0 skipped / 0 failures / 0 errors**. It runs real wheel console
scripts outside the checkout, bootstrap exchange, repeated plan-only calls,
SIGTERM shutdown and daemon-free CPU training. This is macOS arm64/Python 3.11
wheelhouse evidence only; it does not certify GUI display, Windows, GPU,
multi-node or hosted CI.

T30c/T38 breadth, native Windows/GPU, actual Slurm/filesystem/site, hosted CI and
authorized T40/R1/T41/T42 release/Qt-retirement requirements remain open.
The following 9419 records are historical, not current-04b5 certificates.

### Previous status — 2026-10-14 (9419; historical)

Frozen manifest after the monitor presentation-coalescing fix:
`9419eadd632433e918352d3845263b218c102ee6e26a86327bef7afd6467e8da`.
The 9419 report paths below identify the earlier inventory, now retained at
`web/.vendor-backups/backup-x5ifa422`; use the current 04b5 section above for
recertified reports. All 38 assets matched the full inventory. The fixed source
was vendored; the then-current
browser replay passes the 100,000-step public chart and all three channel switches
after a harness tab-control correction. The current preview-fault browser gate
passes with real 409/503/200/200 responses and all owned child processes reaped.
The full active-PWA/draft gate
passes all 11 stages, including cold restart and storage-loss refusal, after the
read-only worker admission query repair. The fresh strict full-source, asset and
cleanup verifier passes.

The fix retains every history/cursor commit while coalescing presentation
notifications within a bounded 250 ms interval. First events and lifecycle/
warning/error/supersession boundaries remain immediate; EOF/refresh flush,
abort cleanup, native-pending fences and clock rollback are tested. Root's
focused monitor/history/use-runs checks pass 50; the full frontend passes
660 tests in 65 files. Static/offline/vendor checks pass 96; generated-worker
checks pass 38; typecheck/lint/format pass. Independent review found no material
issue. All 8a reports below are historical unless rerun against 9419.
T30c/T38/native/site/release gates remain open.

Root verifies current 100k report `/private/tmp/wavedl-history-current9419-1.json`
through its strict CLI guard. Source generation plus real ingestion took 60.165 s;
selection to public painted history took 14.429 s.
This includes transport/controller/paint overhead, not isolated uPlot render time.
All 100,001 journal/event-log records, 100,000 active metric records and cursor
`[[1,100000]]` match before/after browser reads. The fixture backend/PID observations
are controlled, not genuine ML epochs or scheduler/native-restart proof. Exact
limitation, selected-run public SSE GET, complete current inventory, immutable
source, channel-pixel differences and all owned cleanup are guarded. Root passes
58 history/preview verifier contracts and four Python fixture checks separately
from the earlier 3,476-test full-suite snapshot.

Root also verifies current preview report
`/private/tmp/wavedl-preview-fault-PWArepair-pVs7pg/preview-fault.json`:
actual identity-change refusal, public-reselection cancellation, retry, unchanged
durable tables/source bytes and four absent child PIDs. The full active-PWA report
`/private/tmp/wavedl-retained-active-draft-9419-current-20261013-2.json` passes
the current full-source/asset/cleanup guard. Additive CI gates and sanitized report artifacts are
wired; no hosted workflow was executed.

Current twelve-case report
`/private/tmp/wavedl-default12-current9419-P5MlPw/wavedl-browser-acceptance-AUy8Z8/summary.json`
passes root's strict current-asset/cleanup CLI guard. Combined Node tooling
contracts pass 959/959; pinned Ruff 0.14.10 lint/format checks cover all 431
Python files with ignored tooling explicitly included. The current non-slow/
non-GPU full Python run passes **3,495 / 14 skipped / 336 deselected in 584.83 s**
at `/private/tmp/wavedl-full-9419-20261014.xml`; the 14 skips are the
documented native Windows, real Linux tmpfs, and opt-in wheelhouse/platform
boundaries. The later 9419 PWA source changes are TypeScript/web-only and have
their own current checks below.

The 9419 PWA repair adds a read-only service-worker admission query over the
existing retained-build metadata. It does not upgrade the v1 IndexedDB schema,
mutate caches, activate workers, or treat unavailable inventory as capacity.
Focused update/retained tests pass **51**, web tests pass **660**, generated
worker tests pass **38**, and workstation typecheck/lint/format pass. The current
9419 retained active-run/draft report
`/private/tmp/wavedl-retained-active-draft-9419-current-20261013-2.json` passes
all 11 stages, including cold restart and storage-loss refusal. Preview-fault
report `/private/tmp/wavedl-preview-fault-PWArepair-pVs7pg/preview-fault.json`
passes strict verification with 409/503/200/200 and four reaped child PIDs.
The isolated installed CLI/dependency acceptance passes **4/4** with the exact
offline wheelhouse; independent JUnit is
`/private/tmp/wavedl-installed-cli-9419-readiness-20261013.xml` (four cases, zero
failures/errors/skips, 65.30 s). No hosted workflow was executed.

Later local F05/F12 transport coverage reconnects the real authenticated stream
after overflow or malformed controls using the last delivered data cursor. It
proves exactly-once delivery of the committed hidden record and released broker
subscriptions without reapplying SQLite rows. Root reruns five cases in 0.27 s.
The additive same-daemon reconnect browser gate also passes at
`/private/tmp/wavedl-reconnect-9419-final2-20261013-6881/reconnect.json`: a genuine CPU
run advances while the public scope is detached, then fresh cursor `0:-1` replay
reconstructs the pinned event prefix after reauthentication. It proves unchanged
daemon/build/protocol identity, one plan/execution, zero cancellation and full
browser/fixture/listener/profile/token/runtime cleanup. Root independently
verifies the strengthened report and passes 38 adversarial guard tests. This is deliberately
not private cursor persistence, transport-resume cursor, attempt rollover,
remote, Windows, GPU or site certification. The additive CI gate, symmetric
source triggers and sanitized reconnect report artifact are wired; no hosted
workflow was run.
The supersession browser slice now passes genuine CPU training/checkpoint resume,
public adoption/lost-ACK retry, and staged pass-through SSE replay at
`/private/tmp/wavedl-supersession-9419-attempt5.json` (SHA-256
`b46eac0cc92425ff579b57aa3ddf2c085be63fdb7dc7f618609918380c0c42b9`).
The restored epoch-1 point clears current summary/progress; attempt-2 epochs 2
and 3 replace the abandoned old tail and update visible metrics/canvas. Both
journals, raw SSE frames/order, runtime identity/request bytes, COMPLETE/file
inventories, causal selection, SQLite rows/cursors and adoption controls agree.
Independent source/projection/registry inspections remain unchanged, current
9419 assets remain frozen, and all owned cleanup checks pass. Four fixture tests
include actual CPU resume; the strict Node guard has 30 checks covering
positive-contract, adversarial and CLI-reader behavior.
The broader Node tooling snapshot passes 959 contracts; the focused daemon/
history/supersession Python slice passes 82, with JUnit
`/private/tmp/wavedl-supersession-focused-20261014.xml`. This is staged genuine
journal delivery, not live Slurm requeue, native process restart or complete
T35/T38 sign-off. The additive
CI gate preserves the original twelve cases; no hosted workflow was executed.

An owned-daemon abrupt-restart browser harness is still a draft: smoke runs fail
before accepted restart/cleanup evidence. It is not wired into acceptance CI and
does not close F07. Its local safety tests are not an end-to-end pass.

### Previous status — 2026-10-13 (8a; historical)

Frozen manifest after the numeric-list blank-entry fix:
`8a87ce6b055280a7c58606f044385614eaed2f7adbc7ba5b2d6183174bec0fa0`.
All **38** packaged assets match the complete inventory; the previous generated
output is retained at `web/.vendor-backups/backup-zcfhw4z3`.

Two concrete authoring fixes are implemented: blank numeric list entries reject
instead of becoming zero, and YAML `nargs` sequence options retain lists instead
of becoming scalar CSV values. All **44** mounted training controls have explicit
nondefault round trips; the two catalogue-owned fields complete **46** config
destinations. YAML and command exports are compared with actual Python parser
and effective bootstrap manifests, without executing training/custom code.
Root's focused web suites pass **45**, and the full frontend passes **650** with
the Python integration explicitly enabled. This is mounted-component/transport/
parser acceptance, not all-46-fields real-browser acceptance.

Live-push continuity now rejects gaps before runtime negotiation can mutate
provenance. Missing-first-event and internal gaps leave provenance/cursor/event
rows unchanged and permit a later valid hello. Root's real loopback HTTP test
also covers before-commit delivery outage and lost after-commit ACK: deferred
journal polling repairs events once, and duplicate replay leaves event count,
cursor and metric projection unchanged. These are controlled response/polling
faults with the hosted owner and SQLite, not real filesystem/site certification.

Current-8a default browser recertification passes **12/12**, with strict current
asset/cleanup guard at
`/private/tmp/wavedl-default12-current8a-WOyJHy/wavedl-browser-acceptance-Wsi45e/summary.json`.
Root independently verifies that report. Generated-worker checks pass **35**;
web typecheck/lint/format and **706** tooling contracts pass. Root's focused
ingestion/configuration/runtime checks pass **161 in 10.12 s**;
`/private/tmp/wavedl-ingestion-config-final-20261013.xml`.

Qt automatic plots now carry the verified best-publication generation and
approved imports, inverse-mapping file registrations with the existing
roundtrip check. The daemon pins manifest/COMPLETE/source files. No-output and
ONNX-only workflows verify bounded classification metadata without downloading
weights; the automatic service refuses missing pins instead of falling back to
a mutable run directory. Explicit legacy PlotWorker callers retain compatibility.

The mapped Qt report
`/private/tmp/wavedl-mapped-qt-acceptance-20261013g.xml` passes the separate strict
**6-case / zero-skip** gate, including actual CPU training/plot execution,
runtime-generated PNG hashes, selected source hashes, and the public retry-button
path retaining one plot identity/two total jobs. Scheduler commands and
host/compute copy visibility are simulated, not real Slurm/shared filesystem
certification. Training is HTTP-approved then monitored by the actual Qt worker;
this is not a mapped GUI authoring or mapped-browser acceptance claim. Root's
earlier mapped/local/service run passes **32 in 49.63 s**; the later export-pin
edge repairs additionally pass **102** focused agent tests. The separate mapped
POSIX CI gate is added; Windows remains unverified, never silently skipped as
equivalent coverage. Root passes **59** guard tests after the six-case expansion.

The broad non-slow/non-GPU Python snapshot completed **3,467 passed / 14 skipped /
336 deselected in 690.96 s**;
`/private/tmp/wavedl-clean-python-8a-20261013.xml`. It began before the final
metadata-scratch cleanup and guard identity edits, so it does not certify those
later changes. Root separately passes **109 focused tests / one heavy mapped
case deselected** at `/private/tmp/wavedl-qt-pin-cleanup-reviewed-20261013.xml`.
An owned metadata-only `TemporaryDirectory` now cleans success/refusal/cancellation
paths without deleting user exports. Its bookkeeping does not queue background
filesystem writers that could recreate scratch after cancellation. Root's latest
focused run passes **110 / one heavy case deselected**;
`/private/tmp/wavedl-qt-pin-cancel-reviewed-20261013.xml`. Independent final
cleanup review passes with no remaining material findings. All 416 Python files
pass pinned Ruff checks. The frozen full-suite rerun completes **3,476 passed /
14 skipped / 336 deselected in 740.32 s** at
`/private/tmp/wavedl-clean-python-8a-frozen-20261013.xml`. Root verifies the
JUnit aggregate: 3,490 cases, zero errors/failures, 14 skips. This includes the
final pin/no-output/ONNX-only and metadata cancellation cleanup fixes.
GUI/release CI requires the separate mapped six-case gate
without substituting for the original 29-case baseline. No hosted job, release
or Qt retirement has been performed.
Current-8a ten-stage dashboard report
`/private/tmp/wavedl-dashboard-state-current-8a-20261013-agent-recert-1.json`
also passes root's strict current-inventory verifier: zero mutations and all five
cleanup checks. It retains the explicit simulated response/native-identity/exit
boundary, not real scheduler or allocation restart certification.
Current-8a negative standalone adoption report
`/private/tmp/wavedl-negative-adoption-current8a-context-IFoTD2/standalone-adoption-negative.json`
passes root's strict verifier. Three owned copies of genuine launcher evidence
are first metadata-verified, then faulted only at runtime provenance. Corrupt
provenance and conflicting run identity receive actual HTTP 400; missing
provenance receives actual HTTP 503 and the browser truthfully reports an
unconfirmed acknowledgement, not rejection or ownership confirmation.
The original recursive file inventory and all faulted-copy bytes remain
unchanged after observation, seven exact durable table counts remain zero, and
browser/host/listener/profile/credential/fixture-root cleanup is proven. The
Chrome/readiness/viewport/fresh-profile context and full current asset inventory
are required by the guard. Root verifies **25** adversarial Node contracts and
**2** Python fixture tests separately from the frozen full-suite baseline above.
The independent gate is wired into browser CI; no hosted workflow was run.
Scope is local owned fault copies, not OS foreign ownership or remote/site proof.
Earlier reports lacking the strengthened browser context are historical.

Current expanded browser authoring report
`/private/tmp/wavedl-full-training-fields-8d/training-fields-full.json` passes
with the explicit clean interpreter
`/private/tmp/wavedl-clean-install-20261012.fc9prN/venv/bin/python`. Real
Chromium authors all 44 mounted controls plus catalogue-owned model/data, then
compares all 46 destinations across YAML, copied CLI, real parser/bootstrap
manifests and the actually persisted plan preview. It stops before approval or
execution; no training, submission or cancellation is claimed. The strict
verifier has **39** mutation contracts and the wrapper has **2** destination/
source-containment tests. Ambient Python re-verification is not accepted.

The mapped browser automatic-plot report now passes at
`/private/tmp/wavedl-mapped-browser-current8a-pixels4/mapped-autoplot.json`, with
root's strict standalone verifier. Public authoring maps the dataset and file
registration once; genuine CPU training and plotting produce publications.
The first plot-submit ACK is suppressed after acceptance. Public automatic retry
retains exactly two durable plans/jobs, source-bound idempotency identity and
unchanged publications. Run/request/control/scheduler identity, best checkpoint,
manifest/COMPLETE/source-file hashes and mapped imports are explicitly checked.

The selected published `scatter_all.png` is independently decoded to RGBA, then
compared with pixel readback from the already loaded browser image at natural
dimensions. The source PNG size/SHA and RGBA digest match; native scrolling
brings the image into the viewport before the screenshot. This avoids the
CSP-forbidden blob fetch without weakening `connect-src 'self'`. All browser,
fixture, listener and owned-root cleanup checks pass. Scheduler commands and
host/compute copy barriers remain simulated: this closes a local assembled
mapped-browser slice, not a real cluster/shared-filesystem/site gate or every
automatic-plot variant. Earlier failed/intermediate reports are not accepted.
Root passes **34** verifier contracts and **4** fixture tests, including actual
CPU marker execution in the compute directory and verified copyback. The new
independent CI gate is wired without altering the original twelve-case set.
The later combined tooling snapshot passes **806/806**; pinned Ruff lint and
format checks pass for **420** Python files. The expanded browser gate and
negative-adoption fixture were added after the 3,476-test frozen Python baseline,
so their separate focused checks are not represented as another full-suite run.
All **6a** reports below are historical snapshots unless rerun against 8a.
Full T30c/T38/platform/site/release gates remain open.

### Previous status — 2026-10-13 (6a; historical)

Frozen manifest after the guided-validation race fix:
`6a677b78cbb4d5bd87285ea6a9dca4e29892747bc9c76d53120f85b2b9765020`.

- **Passed:** web **626** tests, typecheck/lint/format and **35** generated-worker
  checks. F02 journal faults add four cases; **49** focused tests pass (root
  rerun **6.79 s**; agent JUnit
  `/private/tmp/wavedl-f02-hosted-journal-faults-20261013.xml`).
- **Passed:** implemented Qt automatic-plot retry; root mandatory GUI **29 / zero
  skips in 44.25 s**, `/private/tmp/wavedl-gui-mandatory-6a-20261013.xml`, strict
  29-case guard accepted. Public retry-button real-HTTP/export-fault acceptance
  passes (agent **14.07 s**); guard/service/dispatch/shutdown checks pass **93 in
  3.07 s**, including uncertainty unwind and late-worker identity fences.
- **Passed:** current twelve-case browser aggregate **12/12** with strict current
  asset/cleanup guard at
  `/private/tmp/wavedl-browser-current-6a-20261013/wavedl-browser-acceptance-TUbgZl/summary.json`;
  Independent Qt review passes **11 tests with no
  material findings**. The real wizard report passes strict verification at
  `/private/tmp/wavedl-wizard-progression-check-5/wizard-progression-browser.json`;
  19 focused wizard contracts also pass.
  native double-click, repeated-disabled acknowledgement and preserved data are
  covered, not a directly sampled transient validation lock.
  Node contracts **682/682**. Full non-slow/non-GPU Python passes **3,425 / 14
  skipped / 336 deselected in 472.74 s** at
  `/private/tmp/wavedl-clean-python-6a-20261013.xml`.
  The earlier b3 **23**-case GUI report remains historical.
- **Passed Linux-container foundations:** core **783 / 12 skips**, daemon
  **1,581 / 40 skips**, no failures/errors, at
  `/tmp/wavedl-linux-foundations-evidence.BiuG7f/core-foundations.xml` and
  `/tmp/wavedl-linux-foundations-evidence.BiuG7f/daemon-foundations.xml`. The strict
  native guard accepts **13** required cases, **2,364** passes and **52** other
  skips; canonical optional-ML collection skips remain unverified, never required
  coverage. Seven initial producer failures from missing Node were resolved with
  verified Node 24; raw pre-Node evidence is preserved.
- **Later focused validation only:** native-guard fix passes **76** adversarial
  tests, separately from the full **3,425** Python baseline above. The actual
  Linux CLI guard rerun with `--init` accepted all 13 required cases; JUnit
  `/tmp/wavedl-linux-foundations-evidence.BiuG7f/report-guard-fixed.xml` also has
  76 passes. Both task-owned containers were removed without OOM; existing
  containers were untouched. The first full-run container used non-reaping PID 1
  and accumulated zombies, so global orphan-reaping success is not claimed.
  Scope is LinuxKit
  **7.0.14-linuxkit aarch64**, **2 CPU / 4 GiB**, not GPU/Windows/site acceptance.

All b3 browser, GUI, installed and full-suite reports below remain historical
unless explicitly rerun against 6a. No T30c/T38, remote/GPU/Windows/Slurm/site,
hosted CI or authorized release/Qt-retirement gate is closed by these results.

### Current-build recertification and remaining work — 2026-10-13

Root independently accepted these reports with their strict verifiers:

- CV: `/private/tmp/wavedl-cv-current6a-hardened-CRdQQK/cv-parity.json`;
  explicit fold 2 evaluation, 96 verified prediction rows, summary/fold generation
  disposition and owned cleanup. Runtime interpreter is
  `/private/tmp/wavedl-clean-install-20261012.fc9prN/venv/bin/python`.
- ONNX: `/private/tmp/wavedl-onnx-current6a-20261013-e6KJRY/onnx-export.json`;
  genuine checkpoint, CPU opset 17, finite numerical comparison and verified
  publication/download identity. This uses checkout source with an ambient
  interpreter, not a new clean installed-package certificate.
- Cancellation:
  `/private/tmp/wavedl-inference-cancel-current6a-09v8sa/inference-cancellation.json`;
  real runtime hello/PID, cancelled exit 130, no publication or duplicate intent,
  and owned cleanup. This likewise does not recertify clean installation.
- Standalone adoption:
  `/private/tmp/wavedl-adoption-current6a-20261013-eZmDe9/standalone-adoption.json`;
  genuine daemon-free launcher exit 0, independently captured source bytes
  unchanged, and lost-ack retry with identical frozen request. No runtime handle,
  scheduler submission or cancellation was manufactured. Exact clean interpreter
  as above; same-host adoption only, not a remote-site proof.
- Installed package surface: the current clean Python environment passed the
  outside-checkout daemon CLI/static-client probe **5/5 in 68.51 s**;
  `/private/tmp/wavedl-installed-cli-web-6a-20261013.xml`. This covers wheel
  console scripts and packaged static routing, not isolated Qt dependency
  resolution on Windows.

All bind the current 6a manifest and prove owned cleanup. They prove local CPU
slices, not all evaluation, CV, cancellation, export or adoption variants.
Root's focused verifier contracts pass **61**, with **25** additional adoption/
rollover verifier tests; the latter are contracts, not an actual rollover rerun.

Current sparse-stream report
`/private/tmp/wavedl-stream-sparse-reviewed-6a-20261013.json` also passes root's
strict verifier after independent quality review. It proves exact rendered
`QA split UTF-8: sóng 波 🌊` without replacement characters, six marker-internal
one-byte ASGI boundaries, rendered event identities 1:0 and 1:2 with controlled
1:1 omission, reconnect from 1:2 and refusal of uncommitted control 1:1002.
The verifier additionally requires the durable cursor to be behind the injected
ahead cursor; equal/higher authority mutations are rejected. All five cleanup
checks pass. This is controlled ASGI/response-boundary fault evidence, not a claim
about browser network chunk boundaries, genuine broker capacity overflow,
attempt rollover or private post-rejection cursor state. Root focused checks
pass **23 Node** and **80 Python** tests (the latter include 76 native-report
guard tests); the combined Node snapshot passes **688/688**.
Root also rehashed all **38** packaged assets against the full inventory, rather
than relying only on the inventory file's checksum.

Current dashboard report
`/private/tmp/wavedl-dashboard-state-current-6a-20261013-final.json` passes root's
strict verifier and independent review. Ten stages cover queued, held, running,
accounting unavailable/absent, delayed terminal visibility, lifecycle-stale 503,
restart pending/running and supervision loss. It verifies exact run/plan/request
identity, no browser mutations, retained attempt-one diagnostics without
presenting them as attempt-two metrics, full packaged inventory pre/postflight
and owned cleanup. Backend/native identities, restart attempts and one exit are
injected reducer-derived response faults; the genuine local attempt-one SSE
supplies history only. It is not actual Slurm/native-restart acceptance.

The added fixture tests also verify that unauthenticated responses are untouched,
skipped/regressed stage transitions fail closed and a late mutation is persisted
immediately. Root passes **18** dashboard verifier contracts, **15** fixture
tests, and **3** Vue presentation tests; the final combined tooling snapshot
passes **706/706**. Ruff check/format pass for **414** Python files; frontend
typecheck, workstation lint and formatting pass. The standalone gate is wired
into browser CI with symmetric triggers and exact JSON artifact upload, but that
hosted workflow has not been executed. No frozen web assets were regenerated.
The final full frontend rerun passes **627 tests in 62 files**; generated-worker
checks pass **35/35** with the clean interpreter directory on PATH. An initial
worker run selected a system `python3` without Starlette and failed one check;
the explicit-environment rerun resolves that invocation error, not a product
code defect. The earlier 3,425-test full Python baseline predates these new
dashboard fixture tests and is not presented as a new full-suite run.

| Remaining gate | What is implemented | Evidence still required |
|---|---|---|
| T30c assembled failures | Journal/publication/replay and Qt recovery harnesses | Complete §16 mapping plus real cluster, filesystem and Slurm-version proof |
| T38 browser parity | All 24 capability owners, exhaustive local authoring and mapped automatic-plot slices | Remaining field/fault/path variants, stream/adoption/PWA variants and real remote/platform behavior; scoped gates do not sign off all rows |
| Native platforms | POSIX and Linux-container foundations; Windows supervisor and GPU paths | Actual Windows and GPU execution/cancellation results, not host substitutes |
| Retained PWA | Bounded complete-generation storage, admission/refusal and explicit reload consent | Current-build upgrade/restart/concurrency variants; earlier pilots are historical |
| Installed/hosted/release | Package checks and mandatory CI workflows | Current installed-path coverage, hosted CI results, R1 release with Qt retained before T41 removal and T42 verification |

The table distinguishes acceptance work from missing implementation. It does not
waive any original requirement or close a complete parity row.

### Previous status — 2026-10-13 (b3; historical)

The following records describe the previous b3 snapshot, not current-6a
recertification.

Current manifest:
`b3c63a860ed01b19e88ec4e8f572416a7cb767e32d889b2b985d5d80b7caabf9`.
The dated reports below are historical snapshots unless they explicitly match
this manifest; the 4d aggregate, submitted-plan, artifact, result-operation, ONNX
and inference-cancellation passes are not current-b3 recertification.

- **Passed:** strict current-asset stream report
  `/private/tmp/wavedl-stream-current-b3-20261013.json`; interrupted fragmented
  replay/control-cursor resume, rendered metrics/plain-text diagnostics, focusable
  labelled `role="log"` (`aria-live="off"`, scroll overflow), and owned cleanup.
- **Passed:** root's exact focused Python command below, **130 tests in 5.08 s**
  (no JUnit produced); web **623 tests**, typecheck/lint/format, and **35**
  generated-worker checks.
- **Passed:** full b3 aggregate **12/12**, strict current-asset/cleanup guard,
  `/private/tmp/wavedl-browser-current-b3-20261013/wavedl-browser-acceptance-B5sAHl/summary.json`.
- **Passed:** full non-slow/non-GPU Python **3,414 / 14 skipped / 336 deselected
  in 455.05 s**, `/private/tmp/wavedl-clean-python-b3-20261013.xml`; mandatory
  GUI **23 / zero skips in 42.57 s**,
  `/private/tmp/wavedl-gui-mandatory-b3-20261013.xml`, strict guard accepted.
- **Passed:** **663** tooling contracts. Current b3 strict ONNX and cancellation
  reports pass at `/private/tmp/wavedl-onnx-b3-rerun-20261013-report/onnx-export.json`
  and `/private/tmp/wavedl-inference-cancel-b3-20261013-current-agent/inference-cancellation.json`.
- **Passed reviewed current-b3 CV:**
  `/private/tmp/wavedl-cv-b3-reviewed-20261013-report/cv-parity.json` passes strict
  verification with summary text, durable plans, exact registry IDs, literal
  headers, 96 CSV rows and 22 focused tests. Scope is local two-fold CPU
  classification only; full CV/T38 remains open.
- **Passed:** current-b3 submitted-plan and artifact reports are
  `/tmp/wavedl-submitted-parent-cnbuaB/report/submitted-plan-browser.json` and
  `/tmp/wavedl-artifact-report-rwwXJC/artifact-publication-oversized-inventory.json`;
  both pass strict current-asset cleanup guards.
- **Passed bounded installed GUI probe:** **1/1 in 18.79 s**,
  `/private/tmp/wavedl-installed-gui-root-b3-20261013.xml`; POSIX with inherited
  host Qt/dependencies. Windows has an explicit unsupported flag; this is not
  isolated GUI resolver acceptance. Mandatory POSIX CI step added, not remotely
  executed.
- **Earlier installation evidence only:** installed T39a **4/4** belongs to 4d;
  installed Qt probe **1/1** used system site packages, not a clean resolver
  environment. Neither certifies all current-b3 installed paths; the new bounded
  probe above supplies separate current evidence.

Exact root focused command:

```bash
QT_QPA_PLATFORM=offscreen PYTHONPATH=src cleanpython -m pytest unit_tests/test_gui_reconnect_dispatch.py unit_tests/test_gui_training_service_daemon.py unit_tests/test_gui_daemon_workers.py unit_tests/daemon/test_publication_crash_http.py unit_tests/core/test_generations.py unit_tests/daemon/test_safe_artifacts.py -q
```

Current changes add a visible diagnostic omission marker under the existing
4096-code-unit presentation ceiling without splitting surrogate pairs or changing
authoritative events/cursors, accessible plain-text logs, and Qt dashboard reconnect
that bypasses editable-draft validation while preserving daemon/run identity fences
and refusing terminal/retired-worker resubmission. Assembled publication-crash HTTP
checks use
three abrupt `os._exit(73)` points (partial copy, before marker, after marker):
incomplete generations return 404, prior bytes remain usable, retry publishes
generation 3, and a valid after-marker generation remains served. This is local
process-crash evidence, not power-loss durability or real-site certification.
T30c/T38, remaining CV/remote/GPU/Windows/Slurm variants, hosted CI, platform/site and
authorized release/Qt-retirement gates remain open.

### Dated evidence notation

Paths below are repository-relative. `W` means `web/workstation`, `WT` means
`web/test/workstation`, `D` means `src/wavedl_daemon`, `DT` means
`unit_tests/daemon`, and `CT` means `unit_tests/core`. These abbreviations refer
to actual source/test files, not separate deliverables. Source/test anchors were
checked against the current checkout; their presence is not a fresh passing run.

- **Partial browser**: the named current assembled case proves only the stated
  assertions. The remainder of the row remains open.
- **Reported earlier**: recorded in the current parity-plan continuation, but
  the underlying earlier browser artifact was not independently read for this
  ledger. It is not treated as current-build sign-off.
- **Open**: no complete assembled evidence for all failures/path variants.

The full Python rerun was interrupted after 2,909 passes, 14 skips and one
two-rank native shutdown failure. Subsequent shutdown/containment fixes passed
focused acceptance, including the previously failing public-HTTP test; the next
full run passed 3,066 / 14 skips in 185.27 seconds. The definitive run after
additional review fixes and the rebuilt assets passed 3,083 / 14 skips in
190.24 seconds (non-slow/non-GPU). The latest final run including bounded Darwin
EPERM confirmation and fixture boundary regressions passed 3,138 / 14 skips in
219.29 seconds. Earlier reported macOS
3,012 passed / 14 skips, frontend 441 tests, Linux 2,212 / 25 skips and actual
Linux ML 49 / zero skips remain historical evidence, not completion criteria.

## Current assembled browser artifact

Independently read `summary.json` and each of the seven case JSON files under:

`/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-browser-acceptance-z9blHB/`

The summary records agent-browser 0.26.0, interpreter
`/opt/homebrew/opt/python@3.11/bin/python3.11`, and 2026-10-08
16:38:05.883Z–16:41:23.126Z. All seven per-case statuses are `passed` and share
asset-manifest SHA-256
`42755bd6462effa699e05083e44eb7e6d3ea3fe0f86001fc5985fc970e81407d`.
Root reported the runner exited zero; these JSON files do not themselves contain
a runner exit-code field. Every case records no cleanup errors, absent owned
browser session, confirmed fixture service closure and removed owned roots;
fixture parents exited by SIGINT, not a fabricated numeric zero exit.

The reproducible runner is `tools/run_web_acceptance.mjs`, using
`tools/browser_daemon_fixture.py` and vendored assets. These are real Chromium
interactions with real Local CPU execution. Lost ACK and tampered download cases
inject explicitly described transport faults around real backend results.
Preserve/export the temporary JSON evidence before deleting its parent directory;
the dedicated run roots were already removed by the runner.

| Case / file | Exact established boundary | Not established |
|---|---|---|
| `baseline.json` | Guided dataset/model selection followed by labelled full editor; persisted plan before approval; exact authored runtime/data/config; CPU train completed; downloaded `checkpoint_selection.json`, 55 bytes, SHA-256 `ded1592abc7676dd2d2598ed61e202046dfbd69c20212653878d06d5f683917c` | Automatic plot completion/rendering: final registry still shows the separate plot execution running. No remote map, ONNX, CV or preview-format sign-off. |
| `offline.json` | Actual Chromium offline emulation after persisted preview; no enabled plan/submit/cancel action; registry has one plan and no submit/cancel intent | Not a lost submit ACK; no online reconnect/replay or cold offline worker-shell guarantee. |
| `detach.json` | Submitted Local execution remains running after disconnect/browser close; cancellation intent stays zero | No reopened-browser stream cursor recovery or GPU descendant certification. |
| `reload.json` | Reload requires a fresh memory-only credential; preview remains unsubmitted | No reconnect to an active run, daemon upgrade or forwarding-port reuse. |
| `cancel.json` | Selected UI shows fresh daemon-confirmed cancelled state; durable cancellation intent/delivery and terminal backend observation independently recorded | Registry `runs` is empty in this snapshot; terminal authority comes from the backend observation, not a fabricated runtime exit. No remote/GPU/Win32 tree proof. |
| `lost-ack.json` | One successful real submit ACK replaced with empty proxy-style 503; status recovery uses original approved plan; one execution; duplicate approval disabled | No Slurm ambiguous scheduler acceptance, alternate persistence crashes or exhaustive retry timing. |
| `artifact-tamper.json` | First byte of a real artifact stream changed without changing length; no browser download; invalid-response UI and scope revocation | Not backend symlink-race proof; current refusal revokes connection scope rather than establishing a result-local retry UX. |

All cases verify bootstrap removal and no persistent authentication. All use
same-machine daemon paths and `storage_map: []`. Authenticated daemon-side browse
on the same machine is not cross-machine/Slurm storage-mapping acceptance.

## P0 / T38: all 24 rows

### Additional current-build evidence — 2026-10-09

The root independently ran `port-reuse` to exit zero; JSON evidence is under
`/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-browser-acceptance-a25fDY/`.
The asset manifest is now
`e5d4a6c2932de8a7621d252fba8d183f444936f1fd7778424b40b7cb4b25afb0`.
Two genuine daemons at the same loopback origin accepted the same private bearer
for health reads and exposed different daemon identities with the same build.
The old preview approval failed on identity skew, revoked dataset/approval scope
and created zero replacement plans, intents, executions or runs. Both daemon
closures, root absence and private credential removal are recorded. This is
partial evidence for rows 01, 12 and 21/F13/F15, not a live-cursor takeover test.
The first combined eight-case run failed detach authoring before submission;
that failure remains under `wavedl-browser-acceptance-ytklvX`. After the summary
driver fix, the definitive root run passed all eight cases to exit zero under
`wavedl-browser-acceptance-KU1VNH` in the same temporary base. All case files match
the summary and current asset hash; verified cleanup is present. The new strict
report guard accepted this real report, rejected the prior failed/stale reports,
and independently passed 35 Node tests. Native summary clicks are exercised;
keyboard-only acceptance is still separate.

`.github/workflows/daemon-browser-integration.yml` now defines a dependency-equipped
Ubuntu/Python 3.11/Node 24/Chromium lane with pinned agent-browser 0.26.0, freshly
generated/vendored assets, all eleven mandatory cases and a fail-closed report
guard. Artifacts contain only twelve explicit JSON report paths. Hosted execution
has not been established; local wiring and guarded evidence are not remote CI.

The actual nine-case root run passed to exit zero under
`wavedl-browser-acceptance-n582lH`, 2026-10-09 01:58:34Z–02:02:00Z; the strict
guard independently accepted exact per-case JSON and current manifest hash.
Its 100 Node tests pass. `live-port-reuse` establishes persisted metrics/logs,
matching producer journal and durable cursor plus real rendered history before
the outage. The transport retires authority, then deliberate same-credential
reconnection retains the old daemon pin and receives scoped health 409 from B.
Frozen final boundary metadata has no accepted old-run read or mutation; B's
registry is empty. The original native process is genuinely cancelled/reaped,
but missing runtime EXIT remains null/unknown and its stale projection is not
rewritten. This is not an exact private browser-consumer cursor assertion.
All nine cleanup records are verified. The earlier failed first live probe
`0fedQu` remains failure evidence. The post-run fixture query-byte cap has 13
unit tests; an independent live rerun `bD7puU` also passed after that hardening.

Real contained two-rank CPU cancellation and complete-generation publication
now pass. Standalone launch signals remain scoped to an unreaped owned leader;
bounded supervision refuses escaped pipe holders. Current Linux native evidence
under `/tmp/wavedl-linux-validation-20261009.WY8H3u` includes 2,250 core/daemon
passes / 26 platform/root-permission skips, 56 actual ML/HTTP/CV/ONNX/ORT/requeue/
ENOSPC passes / zero skips, 78 focused passes / 11 Darwin skips and 16 mandatory
Qt passes / zero skips with an accepted JUnit report. Actual two-rank cancellation
after two COMPLETE publications left zero live tracked group members. Source
was read-only, network off during tests, two CPU/3 GiB bounded and zero OOM events.
Missing Node/Qt system libraries and a theme-probe instrumentation failure were
preserved and corrected before these results. This improves F11's Linux/macOS
CPU and Linux Qt boundaries, not native Windows/GPU or real-site certification.

Every row remains **open for complete T38 sign-off**. Source, automated tests,
browser interaction, local/remote coverage and result must all be recorded before
closing a row. The following partial evidence must not be inflated into that
closure.

### Earlier eleven-case bundle — 2026-10-10

The exact asset manifest for this bundle is
`c9e255128bb53681fa1b4fc4c1868483aa1ff5e03e34176ff84a86305ff72db5`.
Root's actual aggregate `wavedl-browser-acceptance-4YbChE/summary.json` passed all
eleven cases to exit zero, and the strict guard accepted matching per-case JSON
and verified cleanup. The preceding `KanF7h` failed during authoring and is not
acceptance evidence. Revised public-DOM actions use semantic/scoped XPath targets
or existing visible field IDs, with native scrolling and read-only two-frame
geometry/hit tests; 18 action contracts and 155 report-guard contracts pass.
The exact earlier physical misclick mechanism is not claimed established.

The current source also retires replaced results-session subscriptions, pending
work and captured child selections consistently. Five mounted regressions cover
the otherwise latent replacement contract. The serialized full frontend suite
passes 55 files / 529 tests, with typecheck, lint, formatting, generation, 13 real
generated-worker checks and 56 installed/static/vendor/CLI checks passing.
These results narrow authoring/reset/export/native-download and recovery evidence;
they do not close remaining P2, keyboard/PWA, remote, Windows/GPU, real-site or
authorized release gates.

### Current dataset pilot and regression build — 2026-10-10

Current assets have manifest SHA-256
`7286e1858e900a5320eb51fc30d7f6943b8ecdc01eae2b226e2583ecc7a3c929`.
The single-case `wavedl-browser-acceptance-YRfUuj` pilot passed actual six-view
rendering/header/statistics for NPZ/MAT/H5/HDF5 plus one-row NPZ, 29 decoded PNG
downloads, explicit Missing nonfinite statistics and genuine unsupported-file
replacement refusal with stale charts cleared. Root read the exact per-case JSON,
confirmed zero allocated plans/runs/intents/executions and verified removed owned
roots and clean browser/service teardown. That pilot predates the additional
native sample-drag/correlation-keyboard assertions; it cannot certify them.
The two earlier failed pilots remain failures, not combined acceptance evidence.

One-row correlation now agrees across core/daemon/browser contracts. Connected
session replacement and disconnected status regressions preserve reselect
guidance and owner fences. Current full local checks: 3,147 Python passed / 14
platform/environment skips, 55 frontend files / 538 passed, typecheck/lint/format,
generation, 13 generated-worker tests and 86 installed/static/vendor/CLI tests.
The first twelve-case aggregate (`i9bx2X`) passed eleven but failed the new native
sample-drag driver on fractional CLI coordinates; it remains failed evidence.
The helper now rounds and validates native coordinates with focused contracts.
The expanded twelve-case assembled aggregate still needs final recorded proof.
All 24 complete row sign-offs and T30c/T38 remain open.

The subsequent bounded driver records synchronous exposure plus two independent
controller geometry/hit-test observations, not completed render frames. Current
contracts pass 24 native-action, 17 PNG/provenance and 260 report-guard tests.
An exact supplied locator cannot widen into a same-name global control. PNG
exports must be genuinely browser-saved, then explicitly renamed for evidence;
non-PNG names and unexpected completed files remain failures.

Fresh-profile pilots `TQLZ4X`/`iK2VER` encountered unexpected `downloads.html`-named
files, including oversized output, and were refused. Neither managed Chrome 150
nor the installed-Chrome 154 diagnostic supplies a passing current twelve-case
bundle. A prior native sample-drag/reset mismatch remains unproven as a product
defect. No production reset/download fix was inferred from these driver failures.
Private browser profiles now have explicit empty-before-open/removal proof.
Initially unverified cleanup in `qYYsGn` and `8gHW9B` was subsequently recovered by
normal closure of the exact owned sessions and removal of only private test
folders; separate hashed recovery records preserve the failed originals.

Latest inference-source regression: `ResultOperations` now fences the successful
prepare revision before preview dispatch. Same-daemon credential reconnect cannot
reuse old grants to send a planning request; fresh reselection restores preview.
The new test fails with only the fence removed and passes restored. Current
frontend checks pass 55 files / 539 tests including translated diagnostics,
typecheck/lint/format/generation, 13 generated-worker checks and 86 installed
web/static/vendor/CLI checks on manifest hash
`79a3e366881aebd0d3bf6430164a5a43ec3f62943099604fde6ca3e69e678929`.

Current `7SYFdW` export tracing is failed evidence. Its recorded no-export
checkpoints stayed clean through initial dataset selection and its first export
baseline contained only the diagnostic screenshot; unexpected non-PNG-named
output then appeared. Earlier pre-existing-download hypotheses do not explain
this recorded run. A separate minimal actual HTTP/canvas/async export fixture,
including the same native preflight/raster/tab-observation sequence, saved a real
PNG and no foreign files. It diagnoses but does not certify the workstation.
P2/P3/T38 still require sufficient real-app evidence; no requirement is waived.

### Explicit custom-model inference and working-directory repair — 2026-10-10

Training-to-inference registration loss was reproduced and fixed across the
dependency-light CLI, approved inference config, Local argv and actual operation
lifecycle. Imports are explicit bounded trusted code, never inferred from
checkpoint metadata. The shared web schema defaults omitted imports to `[]`,
the Results form exposes the list with EN/VI guidance, and automatic plots retain
only the captured training imports. A second review found relative `.py` paths
were interpreted from owned execution cwd; manifest planning now resolves them
against submission cwd and applies existing storage mappings, preserving named
modules. Actual relative-file custom training followed by fresh TEST/PLOT/ONNX
export from separate owned working directories supplies RED/GREEN evidence;
omitted/missing registration remains a truthful failure without artifacts.
Anchors: `src/wavedl/core/inference_cli.py`, `src/wavedl/core/manifest.py`,
`src/wavedl/test.py`, `D/backends/local.py`, `D/runs/service.py`,
`unit_tests/test_inference_custom_imports.py`,
`unit_tests/core/test_manifest_import_paths.py`, `W/lib/autoplot-workflow.ts`,
`web/shared/schemas/result-request.ts`, `WT/inference-registration.test.ts`.

Current root checks: 3,189 Python passes / 14 platform/environment skips
(`-n 2 -m 'not slow and not gpu'`); 56 frontend files / 556 passes; typecheck,
lint/format/generation; 13 generated-worker checks; 86 installed/static/vendor/CLI
checks; pinned Ruff 0.14.10 across 384 Python files. Current manifest:
`e67392c8e81b2f92b694024f41f6473d2ff62e9650de62d82a76f5b7b2ebce92`.
Six mocked export callback lifecycle tests are component-only, not native PNG or
actual parent-tab acceptance. Three genuine preview-service regressions establish
queued cancellation/drain, mid-request mutation 409 and capacity 503/recovery.

Strict dataset pilot `2cQQPs` is failed evidence with verified owned cleanup, not
a current twelve-case pass. Separate real-app native-click diagnostics produced
a decoded PNG, but preflight/tab-observation diagnostics still encountered
refused unexpected output. Diagnostics used multiple builds and do not establish
causality or the unknown file's producer. Two failed diagnostic scripts had invalid
evaluation quoting; fixing it did not require production changes. Reports and
verified PNGs are retained; private test fixtures/profiles/downloads were removed
only after service closure and session absence. All 24 complete sign-offs and
T30c/T38/platform/site/dependency/release gates remain open.

### Assembled source consumers and scoped native references — 2026-10-10

`unit_tests/test_hosted_custom_model_workflow.py` supplies **2 root-repeated passes
/ zero skips** through actual authenticated ASGI and owner-dispatched Local CPU
children: relative-file custom training, pinned best-generation TEST/PLOT and
ONNX export. Full persisted pins/digests, immutable checkpoint bytes, publication
download SHA/size, complete CSV arithmetic, equal test/plot predictions, ten
decoded PNGs and ONNX-vs-CSV equality pass. Host/pool work drains to zero after
lifespan. This is in-process ASGI, not live TCP/browser/remote acceptance; external
Python source is not immutable, and polling deadlines do not globally bound
cleanup. The preceding broad Python/frontend totals are historical checks;
these are two additional focused tests, not a new whole-suite count.

Current-build direct-click and scoped native-ref diagnostics produce decoded
PNGs. Snapshot/readiness variants did not observe completion in eight seconds.
The dataset driver now validates scoped AX references against one actual CSS/
XPath first figure and exact target, native text and two stable post-snapshot
exposure observations. Duplicate prints of one reference are deduplicated;
distinct refs and invalid targets fail closed. PNG verification is unchanged.
Node contracts pass **307** (24 shared actions / 23 dataset / 260 guard).
Per-export file baselines permit only declared screenshots and verified PNGs;
post-click inventory follows strict file completion. Pilots `pwxbQF`, `VAKKCF`
and `89pLS7` remain failed with verified cleanup. `89pLS7` records clean file
checkpoints around pre-export tab inventory, then unexpected partial non-PNG
output after final readiness before the export click, which is refused. This
narrows the diagnostic interval but does not establish the producer or a product
defect. No current twelve-case pass or complete sign-off is claimed.

### Per-client update consent and reviewed dependency floors — 2026-10-10

`W/lib/update-consent.ts`, `W/plugins/workstation-update.client.ts` and UpdatePrompt
now gate reload on this client's explicit consent, replacing the Nuxt registrar
with one supported SDK registration hook. The installed SDK Vue-helper regression
demonstrates the old unapproved reload and the new callback gate. Six pure policy,
two installed-helper VM and five mounted EN/VI prompt tests pass. The VM fakes
Workbox/controller transport; mounted tests mock only Nuxt injection, not UI or
policy. Real two-tab takeover, active history/draft retention and old lazy-asset
compatibility remain open. Worker claiming and API cache exclusions are unchanged.

Current frontend checks: **59 files / 569 passes**, typecheck/lint/format/generation,
13 actual generated-worker checks and 86 installed/static/vendor/CLI checks.
Manifest `85239010c9e01bbe263bcb5ce27916e8f2527fa8688b14060f5b2af98e625971`.
Baseline `Qhybij` connected, but failed before authored approval because the driver
found no exposed interpreter field while the snapshot remained in guided model
selection. It remains failed evidence with verified owned cleanup; it neither
certifies baseline nor establishes a production PWA regression.

Reviewed project/CI floors are setuptools>=83,<85, Starlette>=1.3,<2 and explicit
h11>=0.16,<1; ML requires torch>=2.6 and torchvision>=0.21. These exclude the
specific reviewed advisory versions, not all potential vulnerabilities.
`unit_tests/test_dependency_security_bounds.py` has 8 passing selected constraint
regressions. Root's private Python 3.11.17 environment with setuptools83,
Starlette1.3, h11.16 and torch2.13 passed **3,199 / 14 platform/environment skips**
(non-slow/non-GPU, 229.75s). Test-only CI assertions strengthened during review
were independently repeated. Minimum setuptools wheel acceptance passed; minimum
torch2.6 and hosted matrix were not run. Pinned Ruff checks **386 Python files**.
The private environment inherits unrelated FastAPI and fails `pip check` on its
Starlette<1 constraint; this is not a clean resolver certificate or a global
environment mutation. Use a dedicated WaveDL environment as documented.

Fresh Node audit remains 13 affected entries (8 high/5 critical), including
propagated parents of simple-git/braces/node-forge. No compatible repair was
established; no blind major override, downgrade or suppression was applied.
Referenced advisories and precise verification boundaries are recorded in the
main plan's matching continuation. Complete T30c/T38/PWA/platform/site/dependency
and release gates remain open.

### Current editor driver and deferred-client source gap — 2026-10-10

The driver now validates actual interpreter label/ID readiness after full-editor
navigation, using two consecutive identical observations (at most eight / 15s for
the DOM phase). Native wait budgets remain separate. Explicit observed-ID fills
must still pass native label association, original geometry/exposure and value
readback. Eight editor and three new shared-fill contracts pass; CI includes the
new helper. Failures record bounded public metadata without field values.
Final combined Node run: 318 contracts; explicit fill also rechecks exact native
label association after typing, not merely retained value.
Current `vg6LIp`/`ZeD1gH`/`AZCadD`/`fqrnkS`/`718NdM`/`7oLzDm` pilots remain failures
with verified owned closure and profile/root removal. Label visibility and later
fill discovery are narrowed refusal points, not proven production causes.

Historical diagnosis, before the retained-build implementation: PWA reload
consent did not complete deferred-client compatibility. Workbox's
shared precache activation removes old lazy URLs and StaticClient serves only
the replaced current root. Actual prior entry imports four chunks absent now.
Required implementation direction is bounded complete per-generation caches,
durable atomic admission including provisional bytes/generations, no eviction of
admitted old builds, and inventory-exact immutable old lazy lookup with API/auth
excluded. Capacity must refuse the new install, not silently break a third old
tab. This direction was subsequently implemented in `W/service-worker/sw.ts`
and `W/service-worker/retained-builds.ts`; the dated continuation records bounded admission,
three-generation/quota/concurrency/old-route tests. Those earlier pilots are not
current-6a recertification or complete PWA/T38 sign-off.

The matrix below retains the original row identities and requirements from
`2026-10-04-web-client-parity.md`. Its browser column reconciles those requirements
with the strict current 12/12 aggregate for vendored manifest
`8d1cd10a744f260d658dd4904244be530bcbceb716cb75230ef4dfd7ffc6ad96`
and its current scoped reports recorded above. Prior-07e and earlier scoped
reports, including expanded authoring under
`/private/tmp/wavedl-expanded-authoring-final-Qo7aqm`, retain their dated build
boundaries and are not implicitly recertified. No full T38 sign-off follows.
Real-site/platform proofs remain separate gates, not additional unrequested
capability requirements.

| # / capability / owner | Current implementation anchors | Automated failure/regression anchors | Dated browser evidence and outstanding acceptance |
|---|---|---|---|
| 01 Dataset selection — T37/P1 | `W/lib/catalog-api.ts`, `W/components/catalog/BrowseContainer.vue`, `D/runs/catalog.py` | `WT/catalog-api.test.ts`, `WT/catalog-components.test.ts`, `DT/test_catalog_api.py` | Current visible-alert catalogue report `/private/tmp/wavedl-catalogue-native-current8d1-20261016-final/catalogue-fault.json` (SHA-256 `b90b1f6ac8cf94805f205c6337e66ed66add82ab79f89ee5b864191e15dc36dd`) strict-passes 32 Node/11 Python checks with all cleanup/storage checks, preserving six response faults plus native chmod-000 owned-child real-403 and 1001-empty-file/real-503 cases. Configured unreadable roots, remote filesystems and disk-ENOSPC remain unproven. Scope is local browser fixtures, not real remote/site/filesystem/Slurm certification. |
| 02 Header summary — P2/T26 | `W/lib/dataset-inspection.ts`, `W/components/datasets/DatasetInfoPanel.vue`, `D/runs/inspection.py` | `WT/dataset-inspection.test.ts`, `WT/dataset-info-panel.test.ts`, `DT/test_inspection.py` | Current visible-alert catalogue report (SHA-256 `b90b1f6ac8cf94805f205c6337e66ed66add82ab79f89ee5b864191e15dc36dd`) proves the bounded header/shape/claim fault refusals and public retry paths among six browser fault cases, with 32 Node/11 Python and clean cleanup/storage. Unknown/mismatched metadata is not presented as verified. Unsupported/ragged metadata, header-deadline, configured unreadable-root and remote filesystem variants remain unproven. Remote/site/filesystem/Slurm and full T38 remain open. |
| 03 Six interactive views — P2 | `W/lib/dataset-preview.ts`, `W/components/datasets/DatasetPreviewPanel.vue`, `D/runs/preview_service.py`, `D/runs/preview_authority.py` | `WT/dataset-preview.test.ts`, `WT/dataset-preview-render.test.ts`, `DT/test_preview_service.py`, `DT/test_preview_authority.py`, `tools/browser_dataset_parity.test.mjs` | Strict 12/12 aggregate proves all six views for NPZ/MAT/H5/HDF5, actual statistics/PNG exports, and native sample/correlation zoom, pan and reset. Current preview-fault report `preview-fault-8d1-current-20261016-1/preview-fault.json` (SHA-256 `b4b1bba33f3abeed323a189343cdcd43a150f8d0f964feb4f33ed37795b4a289`) passes 34 Node/95 Python checks for identity-mutation/reselection refusal and MAT/NPZ recovery. Caps/decompression/allocation/explicit-Stop browser variants and real remote-site views remain unproven. |
| 04 Download preference/folder disposition — P3/P4 | `W/lib/artifact-client.ts`, `W/components/results/ArtifactList.vue`, `W/components/settings/SettingsWorkspace.vue` | `WT/artifact-client.test.ts`, `WT/preferences.test.ts` | Strict aggregate proves two real generation downloads and five nested/case/sanitized alias downloads with exact bytes and collision-safe disposition. Reset preserves download preference; browser preference remains distinct from daemon output_dir. Remaining: blocked downloads must not falsely report success. |
| 05 Reset defaults, preserve data/preferences — P1/P4 | `W/components/project/ProjectContainer.vue`, `W/components/settings/TrainingDefaultsSettings.vue`, `W/lib/preferences.ts` | `WT/project-plan.test.ts`, `WT/settings-workspace.test.ts`, `WT/preferences.test.ts` | Strict aggregate proves explicit cancelled/confirmed reset preserves dataset, model, interpreter and download preference. Final expanded submitted-plan report proves persisted plan bytes, submission control and executions survive reset, later edits and navigation. Remote selection preservation still requires genuine site proof; no reset replacement of a submitted plan is claimed absent. |
| 06 YAML/daemon-free CLI export — P1 | `W/lib/training-export.ts`, `W/components/project/TrainingExport.vue` | `WT/training-export.test.ts` | Current 8d1 fields report (SHA-256 `440787e0786fa7e2438439c4a2051a79c66bf2c173c6cdd79d389e193bdf54cf`; stale 38→37 tool expectation fixed) proves all 44 mounted controls plus model/data (46 destinations) round-trip through downloaded YAML, copied CLI, parser/bootstrap and persisted preview. Aggregate covers metacharacter paths and daemon-free output semantics. Unsupported-option/secret handling still requires its specific acceptance; Windows/real remote execution is a separate platform/site gate. |
| 07 Guided wizard — P1/T37 | `W/components/project/ProjectGuide.vue`, `ProjectContainer.vue`, `TrainingPresets.vue` | `WT/project-plan.test.ts`, `WT/training-presets.test.ts` | Current 8d1 wizard report (SHA-256 `e05b5cd904cb234d78dc77d62526896c6c876f4944f3c7952f4f81a03781af9e`) proves missing dataset/model/training blocks progression without durable plans, back/forward preserves inputs and repeated completion clicks create a single intent. Imported-preset validation remains a distinct original failure case; the wizard is not wholly untested. |
| 08 Model descriptions/shape/pretrained — T37 | `W/components/catalog/ModelSelector.vue`, `ModelList.vue`, `D/runs/catalog.py` | `WT/catalog-localization.test.ts`, `WT/catalog-components.test.ts`, `DT/test_catalog_api.py` | Current visible-alert catalogue report (SHA-256 `b90b1f6ac8cf94805f205c6337e66ed66add82ab79f89ee5b864191e15dc36dd`) strict-passes bounded shape/claim/outage browser faults and public retries, with 32 Node/11 Python checks and clean cleanup/storage. False `runtime_verified` claims and outage are covered; malformed model-row browser refusal remains unproven. Model-shape guidance is nonblocking advisory, not runtime verification; real remote/site/filesystem/Slurm and full T38 remain open. |
| 09 Visible training controls — P1/T36 | `W/components/project/TrainingFields.vue`, `TrainingOptionField.vue`, `W/lib/project-plan.ts` | `WT/training-fields.test.ts`, `WT/project-plan.test.ts` | Current 8d1 fields report (SHA-256 `440787e0786fa7e2438439c4a2051a79c66bf2c173c6cdd79d389e193bdf54cf`; stale 38→37 tool expectation fixed) proves all 44 mounted controls plus model/data through YAML/copy-CLI/parser/bootstrap/persisted preview; current validation report (SHA-256 `8b8ebb1108b603feb3727d65ae4838b825a5e369d1ee30f17295f5d6fe231d4b`) proves browser invalid-authoring rejection. Remaining original faults are any unproven invalid option/range and conflicting precision variants, not an absent remaining-fields round-trip. |
| 10 Additional config seam fields — P1 | `web/shared/training-options.json`, `web/shared/schemas`, `W/components/project/TrainingFields.vue`, `tools/export_web_training_schema.py` | `WT/training-fields.test.ts`, `WT/runtime-fields.test.ts`, `WT/storage-mapping.test.ts` | Current 8d1 fields report (SHA-256 `440787e0786fa7e2438439c4a2051a79c66bf2c173c6cdd79d389e193bdf54cf`) proves the complete 46-destination schema seam round-trip, including hidden/default values through parser/bootstrap and persisted preview. Remaining original faults: incompatible resume selector and any unproven conflicting topology/precision or explicitly unsupported option; genuine remote/platform runtime certification is separate. |
| 11 Legacy no-cache preference — P1/P4 | `W/components/settings/SettingsWorkspace.vue`, `W/lib/preferences.ts`, `D/backends/local.py` | `WT/preferences.test.ts`, `WT/settings-workspace.test.ts` | Current preference report (SHA-256 `598d3f902763565e8bb394fa6ae7073107773829bba7100918196b3be959b10a`) strictly proves unchanged owned prior-run cache sentinel/file hashes while a stale legacy cache preference survives browser recovery/reset. This closes scoped nondeletion preservation, not an executed cache-deletion operation or old-user-data migration. |
| 12 Plan preview/start — T36/T34 | `W/lib/project-plan.ts`, `W/lib/daemon-api.ts`, `W/components/project/PlanApproval.vue`, `D/runs/service.py` | `WT/project-plan.test.ts`, `WT/daemon-api.test.ts`, `DT/test_lifecycle_api.py`, `DT/test_plan_store.py` | Strict aggregate proves persisted exact preview and lost-ACK same-plan/key recovery. Final expanded validation/submitted reports prove edits invalidate approval and submitted bytes/control/executions survive later reset/edit/navigation. Ambiguous real Slurm acceptance remains a separate site/runtime gate, not evidence that edited-preview invalidation is absent. |
| 13 Stop/reconnect — T34/T33 | `W/lib/run-monitor.ts`, `W/lib/event-stream.ts`, `D/runs/controller.py` | `WT/run-monitor.test.ts`, `WT/event-stream.test.ts`, `DT/test_submission_controller.py`, `unit_tests/daemon/test_pending_cancellation_http.py` | Current reconnect report `/private/tmp/wavedl-reconnect-current-Vg8OfT/reconnect.json` (SHA-256 `bfe3b12ea40791a335124339dd2b3675dae685ba6d67f414160ecddebf3cee99`) and hardened pending-cancellation report `/private/tmp/wavedl-pending-cancel-final-current-20261016.json` (SHA-256 `d675bde4adcbed2ce89efe8e3913f38bf67efbc5a518327e0defbc3115ee67e7`) pass strict verification for detach/fresh replay, pending/unknown/receipt/lost-ACK/dedup; full external/Slurm stop behavior remains open. |
| 14 Dashboard states/progress — T34 | `W/components/runs/StateBadge.vue`, `RunDetail.vue`, `W/lib/run-monitor.ts`, `D/runs/reducer.py` | `WT/run-monitor.test.ts`, `WT/use-runs.test.ts`, `DT/test_reducer.py` | Current dashboard-state report `dashboard-state-8d1-current-20261016.json` (SHA-256 `d7643326e9676c2a07b890e830126ab84629c821537953f9a589e9ba96cef401`) passes 18 Node/15 fixture checks with cleanup. It is reducer-derived/local attempt-one evidence; native restart, Slurm/remote, Windows/GPU and hosted coverage remain open. |
| 15 Histories/sparklines/summaries — T35 | `W/lib/metric-history.ts`, `W/components/runs/MetricsChart.vue`, `MetricSummary.vue` | `WT/metric-history.test.ts`, `WT/metrics-chart.test.ts`, `WT/metric-summary.test.ts`, `DT/test_metric_projection.py` | Current strict 100k report `/private/tmp/wavedl-100k-8d1-current-20261016.json` (SHA-256 `af6bd2888afdba5e63457ecd79cd8f07f2aa4a452cf8275102cb90c4819f2272`) and supersession `/private/tmp/wavedl-supersession-8d1-current-20261016.json` (SHA-256 `b4d98f97b9ab8b9f97024eac67d2bcd4c4217b9c7f94ad9a7d29b19e070a18ed`) recertify the bounded history and staged CPU resume/replacement cases. Original duplicate-replay/gap/restart breadth and full T35/T38 remain open. |
| 16 Output/log panel — T33/T34 | `W/lib/event-stream.ts`, `W/components/runs/LogPanel.vue`, `D/events/streaming.py` | `WT/event-stream.test.ts`, `WT/run-monitor.test.ts`, `DT/test_event_delivery.py` | Current stream report `/private/tmp/wavedl-stream-current-20261016.json` (SHA-256 `d7ce441b0ebd7c0258b1bb205441e4f6e6c4e4d4d8efc5f7d56414b3eb954bed`) and sparse stream report `/private/tmp/wavedl-sparse-current-20261016.json` (SHA-256 `aa8e93eaeb9f36cc3d7d016fd2594806178047b0dc736af74ce9a232d8104506`) pass strict verification for local SSE/replay, sparse Unicode and persisted cursor behavior. Scope is local attempt-one/reducer-derived evidence; native restart, network chunk boundaries, Slurm/remote, Windows/GPU and hosted T38 remain unproven. |
| 17 Automatic plots — P3 | `W/lib/autoplot-workflow.ts`, `autoplot-controller.ts`, `W/composables/useAutomaticPlots.ts`, `D/runs/service.py`; `/private/tmp/wavedl-current8d1-mapped-autoplot-20261016.T2C3Sc/report/mapped-autoplot.json` | `WT/autoplot-workflow.test.ts`, `WT/autoplot-controller.test.ts`, `WT/storage-mapping.test.ts`, `unit_tests/test_gui_checkpoint_consumer.py` | Current 8d1 mapped report (SHA-256 `843494bc0250c5c0bcc2a89bab3c142984964282845dd34725ed8d6e2485749b`) proves exact raster and lost-ACK retry retains the same two plans/publications without duplicates. The 2026-10-18 current-source controller cases now skip malformed/partial newer best publications and select an older complete source (**35/35** focused controller/workflow tests; full web **804 / 1 skipped**). Remaining original faults: older best checkpoint/reused fixed names, download refusal and no plotting on uncertain/failing/shutdown states where not separately proven. Scheduler is simulated; real-site certification is separate. |
| 18 Evaluation/prediction/export — P3 | `W/lib/result-operations.ts`, `evaluation-results.ts`, `W/components/results/ResultOperationForm.vue`, `src/wavedl/test.py`, `src/wavedl/operations.py` | `WT/result-operations.test.ts`, `WT/evaluation-results.test.ts`, `unit_tests/test_runtime_operations.py`, `unit_tests/test_hosted_operation_result_quality.py`, `unit_tests/test_onnx_export.py`, `tools/run_numerical_failure_browser_acceptance.mjs` | Current 8d1 result-operations (SHA-256 `6ce912661b563a646c9edb93fbc1cb9ddbd58ed17cc3610ca0bc69e89ff7c9ac`) strict-passes scoped CPU evaluation/opset-refusal/draft-revocation. Numerical report SHA `7362e01289b6bd4c6f2cedad2da9569688cbbf2a827054dc3ce30f6e7f851e6f` strict-passes after frozen changes with current source/assets/harness. Current inference-cancellation report (SHA-256 `f985c95f32ec15936635a738f113f256414186dbed1503fd4192264308f6ee9d`) strict-passes with 60 verifier tests; Current ONNX report (SHA `34f6e0fa23565b54faf19cb8191e1966709e4ca72936a41ae84dd259de4f62ac`) and CV report (SHA `bf18d289dca2d964a27d2544630adc89879a549444fbdff60d7509c2d1ac2889`) strict-pass 45 verifier tests and cleanup within same-host CPU boundaries. Remaining original faults: stale-attempt/wrong-checkpoint, unsupported format and budget/integrity variants not covered by those scoped reports; real remote/runtime certification is separate. |
| 19 Checkpoints/artifacts — P3/T25 | `W/lib/artifact-client.ts`, `W/components/results/ArtifactList.vue`, `D/runs/artifacts.py` | `WT/artifact-client.test.ts`, `DT/test_safe_artifacts.py`, `CT/test_generations.py` | Current artifact-safety report `/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-artifact-publication-HPt33u/artifact-publication-oversized-inventory.json` (SHA-256 `7722cace14085f92c19a4edc2870cf75d28c35468faf734ab042de320cbaf86d`) strictly covers bounded modified-size/traversal inventory, incomplete generations, active HTML/SVG no-inline/no-exec and clean cleanup. Backend symlink-race and full T38 remain open. |
| 20 Appearance/language/defaults/W&B — P4 | `W/lib/preferences.ts`, `W/components/settings/SettingsWorkspace.vue`, `W/i18n` | `WT/preferences.test.ts`, `WT/settings-workspace.test.ts`, `WT/shell-settings-localization.test.ts` | Current preference report (SHA-256 `598d3f902763565e8bb394fa6ae7073107773829bba7100918196b3be959b10a`) proves malformed/oversized fallback, Vietnamese retention after restart, dark/zoom/accent/guide and W&B/watch-default persistence, saved-default application/reset and unrelated-storage preservation. WorkstationController `useHead` language is reactive. No guide navigation, external W&B access, YAML export or cache deletion is exercised; those scopes are not certified. |
| 21 Connection/identity — T32/P4 | `W/lib/connection-session.ts`, `daemon-api.ts`, `W/components/ConnectionPanel.vue`, `D/http/auth.py`, `bootstrap.py`; `/tmp/wavedl-t38-auth-skew-report-1792074108.json` | `WT/connection-session.test.ts`, `WT/daemon-api.test.ts`, `DT/test_http_auth.py`, `test_bootstrap_credentials.py` | Final-bundle auth-skew report (SHA-256 `8ff640c04fb56483f2d47386b41cd37bb51a24816fca5acbe5fab22c2bd98c98`) proves 401/reauthentication and build/protocol skew with cleanup; aggregate/F13 prove port-reuse and credential/Origin isolation slices. These original faults are not absent. Remaining bootstrap/log/storage/export variants need their own evidence where not already covered; real forwarded-site behavior is separate. |
| 22 About/feedback/update — P4/T31 | `W/components/settings/SettingsWorkspace.vue`, `W/components/UpdatePrompt.vue`, `W/lib/build-identity.ts` | `WT/build-identity.test.ts`, `WT/workstation-shell.test.ts`, `web/test/generated/service-worker.test.mjs` | Current-source retained-consent report `retained-current-consent-20261016-active-draft-3.json` (SHA-256 `cdc8680886336b71f8a480987fee0667ae1728a3923b2111802ad0e3f8c932ae`) and build-summary SHA `bb2209db7b99df8e2dbe1a01f0e11edb0f5db10f8ba6d8f41abd12ec1e152dc4` strict-pass 11 stages/cleanup: waiting/defer/approval reloads only the approving tab while active CPU PID/plan/run/draft77 remain stable. Four genuine namespaced QA builds use the current 641-source snapshot, not package-exact builds; fixed 37-asset 8d1 is unchanged. External feedback/privacy and full platform/site/T38 remain open. |
| 23 Offline shell/installed PWA — T31–T33 | `W/service-worker/sw.ts`, `web/nuxt.config.ts`, `D/http/static.py` | `web/test/generated/service-worker.test.mjs`, `DT/test_static_client.py`, `DT/test_installed_web_client.py` | Cold-offline report `/private/tmp/wavedl-cold-offline-8d1-5.json` (SHA-256 `0ae5e0b2b5bd13a368deb4df3c4b6b2dc22cefba98d6d807321453a3541ed42b`) strictly passes 39 verifier tests with all cleanup checks: cold deep links serve the shell and `/api/**` remains unhandled. Active-worker/hosted deployment and fabricated-state gates remain open. |
| 24 Run list/detail/adoption — T34/T22c | `W/components/runs/RunsWorkspace.vue`, `AdoptRunPanel.vue`, `W/lib/adoption.ts`, `D/runs/adoption_service.py`; final-bundle adoption reports | `WT/adoption.test.ts`, `WT/adoption-panel.test.ts`, `DT/test_adoption_service.py`, `test_adoption.py` | Final-bundle main SHA-256 `604ec14150e20515ebdfa1f2063e037f734a9efcb27c8909da7fcc85ee139bcc`, negative `7c5b0ab8bf6fdf901bc9c509a8948817fa8ddf1b0a5e6ff5a47d6f289f54ccbd` and rollover `9d5b9a20a43e46ef7d0b5e6448f226ee59f16f2e955cb500c687a4d1927c7180` reports strict-pass with cleanup. Genuine same-host standalone adoption/lost-ACK and negative ownership/provenance/history cases are proven within those scopes. Review any uncovered original foreign/malformed manifest, conflicting ownership, missing storage or corrupt attempt-history variant; private cursor and remote re-adoption are not independent row-24 requirements. Real-site storage/runtime validation remains separate. |

## Architecture §16 / T30c failure ledger

The required category is not closed by a single named test. These anchors identify
current implementation and automated probes; add a final test-run artifact and
assembled/platform/site coverage before claiming the T30c gate is complete.

| # / required failure | Source authority and concrete tests | Current boundary / remaining proof |
|---|---|---|
| F01 Interrupted submission at each boundary; no duplicate | `D/runs/controller.py`, `D/storage/executions.py`; `DT/test_submission_controller.py::test_accept_before_receipt_crash_recovers_one_job`, `test_receipt_persistence_failure_replays_same_response_without_resubmit`, `unit_tests/daemon/test_submission_http_crash_recovery.py` (six SIGKILL cuts), `unit_tests/daemon/test_local_execution.py::test_spawn_failure_retains_attempt_fence_and_never_retries`, writer-controller suites; `/private/tmp/wavedl-f01-sixcuts-only-20261015.xml` | Current lost-ack browser case establishes one Local execution after suppressed ACK. The six HTTP crash cuts and Local spawn-failure fence are now covered locally; real sbatch acceptance/identity recovery remains separate. |
| F02 Incomplete/oversized/abandoned journals | `src/wavedl/core/journal_writer.py`, `journal_reader.py`; `CT/test_journal_writer.py`, `test_journal_reader.py`; `/private/tmp/wavedl-f02-final-20261015.json` | Current final-bundle browser report covers torn-tail, abandoned-tail, oversized-line and oversized-tail through four phases/32 DOM observations. Only torn-tail completes after append; the other three faults remain terminal unknown/uncertain/no-metrics through reader eviction/bookmark restore and repeated-submit/stable-owner laps. Genuine Local submission/startup/HELLO/journal/SQLite/HTTP/SSE and strict independent verification pass; no ML, native-process, shared-filesystem/site or full-F02 certification. |
| F03 Delayed filesystem visibility cannot imply completion | `D/events/ingestion.py`, `D/runs/reducer.py`; `DT/test_hosted_failure_visibility.py::test_delayed_completion_and_failed_commit_replay_over_hosted_http` | Real HTTP/owner/SQLite with controlled backend; not a real filesystem's visibility certification. |
| F04 Projection/cursor crash in both orders | `D/storage/registry.py`, `event_log.py`; `DT/test_event_delivery.py::test_registry_event_projection_and_cursor_rollback`, `test_registry_reverse_commit.py::test_cursor_first_crash_rolls_back_projection_and_replays_once`, `DT/test_registry_http_recovery.py`, `tools/verify_registry_http_recovery_report.py` | Current POSIX assembled four-case write-order/recovery matrix and 33-case guarded cohort pass: actual SIGKILL rollback, durable journal, same-DB rebuild/direct ingestion, exact-once replay and stable authenticated state. Numerical startup is controlled and reverse write order injected; metric-event, native Windows and real-site breadth remain open. |
| F05 Replay-to-live handover | `D/events/streaming.py`, `broker.py`; `DT/test_event_delivery.py::test_register_before_replay_closes_handover_race`, `test_overflow_disconnects_with_last_delivered_position`; `WT/event-stream.test.ts`; `/private/tmp/wavedl-f05-final-20261015.json` | Current final-bundle report proves genuine capacity-1 `QueueFull`, overflow closure, cursor `1:0` reconnect, exact attempt-1/2 journal IDs, durable cursor equality, DOM diagnostics and cleanup; root and independent strict verification passed. F05 is closed only for this local browser slice. Live allocation/requeue/Slurm, chunk-boundary, GPU/site and full T30c coverage remain open. |
| F06 Exhausted/read-only storage | `D/storage`, `src/wavedl/core/generations.py`; `DT/test_tmpfs_storage_acceptance.py`, `test_hosted_failure_visibility.py`, `CT/test_local_attempt.py::test_read_only_never_allocates_or_publishes`; `/private/tmp/storage-fault-readonly-current-20261015.json`; `/private/tmp/storage-fault-quota-current-20261015.json` | Current read-only and quota reports are strict-verified; native permission and site storage behavior remain open. |
| F07 Local daemon restart → supervision_lost | `D/backends/local_execution.py`, `D/runs/controller.py`; `DT/test_submission_controller.py::test_actual_cpu_local_subprocess_and_restart_loss`, `test_local_lost_supervision_never_adopts_or_restarts`; `tools/run_daemon_restart_browser_acceptance.mjs` | Current POSIX CPU restart report proves owned-daemon SIGKILL, same durable DB/port, public `supervision_lost`, preserved last-known evidence and complete cleanup. The accepted slice is additive local evidence; PID reuse, host reboot, Windows/GPU/remote/site and full T30c remain open. |
| F08 Interrupted checkpoint generation | `src/wavedl/core/generations.py`, `src/wavedl/checkpointing.py`; `CT/test_generations.py`, `unit_tests/test_checkpointing.py`, `DT/test_publication_crash_http.py` | Abrupt subprocess cuts at partial copy, before marker and after marker plus authenticated inventory/download/retry are covered by current broad regression. Full numerical-runtime/browser assembly and real-site fsync/visibility remain separate; do not describe crash coverage as absent. |
| F09 Healthy daemon/incompatible allocation hello | `D/runs/negotiation.py`, `D/storage/runtime_provenance.py`; `DT/test_runtime_negotiation.py`, `test_writer_http_acceptance.py` | Runtime environment/topology/interpreter attestation probes exist; real allocation/runtime mismatch at site open. Daemon health is not runtime certification. |
| F10 Scheduler accounting/retention/requeue/held/timeout | `D/backends/slurm_observation.py`, `D/runs/reconciliation.py`; `DT/test_scheduler_reconciliation.py`, `test_slurm_observation.py`, `unit_tests/test_hosted_slurm_requeue.py`, `test_hosted_requeue_setup_failure.py` | Actual CPU runtimes with simulated scheduler, independent runtime/batch/stage-out outcomes. Real site's Slurm version/config/retention/requeue semantics remain mandatory. |
| F11 Full accelerate tree cancellation on three OS; no GPU orphan | `D/supervision/posix.py`, `windows.py`, `src/wavedl/launcher.py`; `DT/test_posix_supervisor.py`, `test_windows_supervisor.py`, `test_launcher_signals.py` | Current browser confirms Local cancellation intent and terminal backend, not GPU process absence. Native Windows and actual GPU/accelerate tree across OS remain open. |
| F12 Strict JSON/events/order/attempt boundaries | `src/wavedl/core/protocol.py`, `events.py`, `D/events/ingestion.py`; `CT/test_protocol.py`, `test_events.py`, `DT/test_event_delivery.py`, `test_runtime_negotiation.py`; `/private/tmp/wavedl-f12-final-bundle-20261016.json` | Current final-bundle report proves Chrome refusal/protocol-skew handling for invalid UTF-8, cleared selection/credentials, exactly two requests with no retries, durable cursors and cleanup; root and independent strict verification passed. Bounded local browser fault only: network chunk boundaries, private post-rejection cursor, attempt rollover, Slurm/site and full T30c remain open. |
| F13 Auth/Origin/XSRF/cookie isolation/nonloopback token | `D/http/auth.py`, `bootstrap.py`, `D/storage/settings.py`, `D/cli.py`; `DT/test_http_auth.py`, `test_bootstrap_credentials.py`, `test_settings.py`, `test_cli.py`; `/private/tmp/wavedl-f13-final-20261015.json` | Existing bootstrap/memory-only/port-reuse fences remain. Current final-bundle report passes root and independent unchanged strict guards: second-port simple GET/fetch POST/form POST 403, JSON/Authorization OPTIONS 403 without POST/CORS grant, cookie-only navigation 401, exact unchanged attack storage, authenticated GET 200/cancel 202 positive control (`cancellation_requested` 0→1 plus pending submission-control row; no executions/ML), seven sanitized wire receipts, unchanged assets and independently verified owned cleanup. DNS-rebinding, nonloopback/remote/site/cross-browser and full-F13 breadth remain open. |
| F14 Artifact containment/symlink replacement | `D/runs/artifacts.py`, `D/http/artifacts.py`; `DT/test_safe_artifacts.py::test_replacement_between_inventory_validation_and_stream_open_is_rejected`, `test_replacement_after_open_cannot_redirect_stream` | Automated race probes; current browser same-length stream tamper refusal. Different threats; neither substitutes for the other or site filesystem checks. |
| F15 Built worker /api separation and version mismatch | `W/service-worker/sw.ts`, `W/lib/connection-session.ts`, `D/http/static.py`; `web/test/generated/service-worker.test.mjs`, `WT/connection-session.test.ts`, `DT/test_installed_web_client.py` | Generated worker routing and earlier real-worker reports; current offline case not complete upgrade/skew browser proof. Open current old-controller/new-daemon/forwarded-port identity cases. |

## Lifecycle lineage and recovery: preserve the implemented boundary

Do not carry forward obsolete claims that requeue, initial writer allocation,
historical lineage or independent outcome collection are entirely absent.
`D/storage/submission_generations.py`, `native_heads.py`, `native_lifecycle.py`,
`submission_collections.py`, and runtime activation implement separate native and
runtime identities. Current probes include:

- `DT/test_bound_native_collections.py`: runtime 0/native 3 preservation,
  unknown-runtime truthfulness, foreign/newer runtime rejection and atomic
  collection rollback.
- `DT/test_writer_historical_lineage.py`: skipped forged directories refused;
  genuinely archived activation replayed; archived first-record failure cannot
  negotiate/reject the active runtime.
- `DT/test_control_integration.py`: telemetry rebuild preserves pre-runtime
  plan/cancel intent; deleted control database cannot reissue idempotent identity;
  interrupted initialization requires explicit recovery.
- `unit_tests/test_hosted_slurm_requeue.py`: actual CPU execution generations
  retained and stage-out failure independent from successful runtime.
- `unit_tests/test_hosted_requeue_setup_failure.py`: completed runtime followed
  by unbound requeue setup failure remains truthful.

These local probes do not certify the real cluster's initial attempt-allocation,
requeue, shared storage visibility or scheduler identity contract.

## Phase dependencies and remaining work

| Phase / task group | Current disposition | Required next dependency / authority |
|---|---|---|
| 1A T0–T13b + CI-1 | Implemented foundations and cross-platform dependency-light CI | Inspect native Windows results; actual GPU tree/FS durability proof is not supplied by mocks. |
| 1B T14–T29c + T39a | Implemented execution/API/runtime/wheel baseline | Final regression artifact; real-site scheduler/filesystem validation and lineage semantics. |
| Historical T30a/T30b/T41d | Historical Qt adapter/inert-code evidence; Qt compatibility is a superseded non-goal | No Qt acceptance dependency; preserve existing user files. |
| 1C T30c | Open daemon/browser reliability gate | Every applicable F01–F15 mapped to assembled evidence; real-site filesystem and Slurm version/configuration before declaring HPC support. |
| 2 P0/T31–T37/P1–P4 | Implemented workstation surfaces; 24 functional product capabilities, not Qt compatibility | Complete browser row failures/path variants, automatic plots through daemon/browser runtime and current-build tests. |
| 2 T38 | Open verification task, not an implementation catch-all | Row owner + automated failure + real browser + local/remote coverage + explicit result. No unsupported/untested row silently accepted. |
| Historical T40/R1/T41 | Superseded non-goals | No deprecation period or intermediate Qt-retaining release required. |
| 3 T42 | Open final new-app validation | T38, current wheel/sdist/entry points/static assets, daemon-free CLI and daemon/browser checks; Qt excluded from shipped artifacts. Tagging/publishing requires explicit release authority. |

The dependency-light `.github/workflows/daemon-foundations.yml` matrix validates
core/daemon contracts on Ubuntu/macOS/Windows with Python 3.11/3.13. The regular
test and release lanes install CPU PyTorch plus `.[dev,daemon]`; the browser lane
uses Node 24 and the packaged static client. Qt is not a dependency, and the
retired desktop workflow is absent. The unreleased app has no legacy-worker
transition gate; normal retained-build updates, rollback and multi-tab safety
remain required. Current local results are recorded above, not inferred from
workflow wiring. Hosted matrix, native Windows/GPU and real-site acceptance
remain unverified here. No release execution, publication, scheduler submission
or mutation of configured user storage is authorized by this ledger.

## Continuation: retained-build implementation, acceptance still open — 2026-10-10

This dated continuation supersedes the earlier "remains unimplemented" retention
note without rewriting that historical audit. Implemented anchors are
`web/workstation/service-worker/retained-builds.ts`, its worker `sw.ts`,
`tools/vendor_web_assets.py`, the workstation update plugin and EN/VI UpdatePrompt.
They provide atomic durable generation/byte admission, complete verified build
inventories, owned installation rollback, exact retained immutable lazy-asset
lookup, and capacity/verification refusal without granting another tab reload
consent. API/auth/state/mutations are excluded; navigation selects the compiled
worker's own verified shell rather than an arbitrary historical root.

Admission is bounded to **3 generations**, including pending and cleanup-debt
reservations, **64 MiB aggregate declared reservations**, **16 MiB/build**, **128
assets/build**, **8 MiB/asset**, **128 KiB inventory metadata**, and **8 KiB preserved
security headers/response**. Physical browser overhead/quota is not certified.
There is no automatic GC or eviction of admitted generations; capacity refusal
is normal, not an error repaired by silently discarding an older tab's build.
No unlimited-update or deadline guarantee is added.

CacheStorage/IndexedDB loss or corruption fails closed. Legacy workers cannot
resurrect previously purged assets: initial transition requires saving/exporting
drafts and closing all existing Workstation tabs/windows. A clean-profile test is
not legacy-transition proof. README gives optional, origin-scoped manual recovery
only after all affected tabs/windows close, removing matching WaveDL retained
caches/database together and inspecting any legacy worker registration before
manual unregistration. No storage deletion or automatic reset was performed by
this documentation work; daemon runs and user databases are not recovery targets.

Root reports **3,243 Python passes / 14 platform/environment skips** (private
environment, non-slow/non-GPU), **602 frontend tests**, **28 compiled
generated-worker checks**, **59 vendor tests**, and **387 Python files checked
with Ruff 0.14.10**. Four genuine isolated-namespace Nuxt fixture generations were
generated and verified. **No real-browser three-generation acceptance yet**:
simultaneously open generations, unvisited old lazy routes after third activation,
A-approval/B-deferral, concurrency/capacity refusal and storage-loss behavior still
need assembled browser evidence. Inherited FastAPI's `pip check` conflict remains;
this is not a clean resolver, security/platform certificate, T38/PWA sign-off or
completion of the full migration/release goal.

## Continuation: scoped native-browser and clean-wheel acceptance — 2026-10-10

Superseding evidence is native pilot C:
`/private/tmp/wavedl-retained-browser-pilot-20261010-c.json`, using four genuine
isolated-namespace current-source Nuxt generations in
`/private/tmp/wavedl-retained-browser-builds.eixujJ` with verified worker/store
source hashes. G1/G2/G3 have exact ready metadata and complete cache inventories;
native G2/G3 approvals reload only their approvers, preserving every deferred
old-tab timeOrigin. Initially unmounted G1 Project/Settings/Results and G2 Settings
render. G4 is capacity-refused without G4/orphan data or loss of the three ready
buckets, and G3 Settings renders afterward. Separate read-only public `no-store`
fetches prove actual service-worker routing (`workerStart > 0`) and exact old
asset hash/size matches; current-daemon requests to those old URLs return 404.
HTTP-prefetch may have supplied lazy module bytes: actual module-loader traversal
of the worker is **not** established. A/B failure reports remain preserved.
Browser/services closure, SIGINT listener `ECONNREFUSED` and owned-root removal
are recorded; no unrelated storage was reset.

The native fetch receiver defect has recorded RED (1 failure / 27 passes) then
GREEN (28) evidence after the bare-fetch fix; concurrent orphan-enumeration and
rollback regressions are repaired. Current verification is **607 frontend tests**,
**30 compiled generated-worker checks**, **387 Python files with Ruff 0.14.10**,
manifest `fb0dca4bbd6445621d630072c1d9375845107bfd3693b2cc6a5f5b9a6ec2474a`.
The full Python rerun is live, so no new final count is recorded. Metadata has a
30-second total fetch/body deadline and assets a 30-second per-asset
fetch/body/digest/cached-verification deadline, not bounded CacheStorage/IndexedDB
waits or a hard whole-install deadline.

Clean wheel `[daemon]` environment `/private/tmp/wavedl-clean-install.2fZjAn`
installed 79 dependencies without system packages/FastAPI/Qt; root independently
confirmed `pip check` passes. Real TCP static checks (33), single-use bootstrap,
no-cookie/foreign-origin-403 enforcement and shutdown-lock/restart checks passed.
Installed two-epoch CPU TRAIN → TEST → PLOT → ONNX all completed in
`/private/tmp/wavedl-installed-cpu.V3sJin` without PYTHONPATH. Root inspected the
script/terminal JSON evidence: public artifact hashes/sizes match, finite 96×4
CSV and errors agree TEST=PLOT, nine PNGs decode, native ONNX agrees within 1e-5,
and consumers pin the immutable best generation. Exact editable `.[dev,daemon]`
received resolver dry-run verification, not that installed runtime test.
The wheel's browser asset snapshot predates the bare-fetch fix: unchanged CPU/core
acceptance is not certification of current final browser assets. These scoped
results supersede earlier no-native-pilot/no-clean-resolver notes, but not legacy
transition, browser restart/storage-loss, broader T38/PWA, dependency-security,
platform/site or authorized release gates, and not the full migration goal.

## Continuation: guarded native producer evidence and terminal checks — 2026-10-10

Root verified the completed full Python non-slow/non-GPU rerun: **3,244 passed /
14 skipped, 222.06s**, JUnit
`/private/tmp/wavedl-final-python.YrixiM/results.xml`. This replaces the earlier
live-run caveat without removing platform/GPU exclusions.

The checked-in four-serial-build producer actually passed after dist-alias/private
workspace fixes; its genuine Nuxt summary is
`/private/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-retained-browser-builds.Z01VrI/summary.json`.
Native nine-stage D passed at
`/private/tmp/wavedl-retained-browser-producer-20261010-d.json`; the checked-in
fail-closed guard accepted the real report against complete current Vue/TS/public
source hash inventory. Reads reject symlinks/FIFOs and cap source at 32 MiB/file,
128 MiB aggregate, report at 2 MiB and offline assets at 8 MiB/file. Producer 10 +
guard 8 + prior Node contracts 320 = **338 passing contracts**; the latest guard
minor update separately passed eight. The exact module-loader/prefetch limitation
of the earlier native evidence still applies.

The browser integration workflow now triggers producer/guard/runner changes and
executes contracts, producer, native pilot and guard before its original twelve
mandatory cases. Retained-build uploads are report JSON/producer summary only,
not logs/profiles/credentials. Wiring is not a hosted CI result.

Actual current baseline `I5ZwfO` failed (three unrequested plans, no intent).
Instrumented `NL8AwY` failed summary expansion with repeated roughly 180k trusted
keyboard/detail-zero events and zero plans in per-field before/after checks. Native 0.26
fill/wait/snapshot source did not establish an Enter-send cause; no production
guard fix is justified by that diagnostic alone. Summary discovery retains the
original preflight XPath (27 contracts). Explicit fixture-asset/event diagnostics
are opt-in, and the main twelve-case guard rejects their report flags instead of
certifying them. No result is claimed for the live Chrome 150 diagnostic. Full
twelve-case acceptance, prior unexpected non-PNG dataset-export evidence, legacy
transition/restart/storage-loss and broader T38/security/platform/site/release
gates remain open; no full-goal completion is recorded.

## Continuation: native E and current uninstrumented baseline — 2026-10-10

Owned subprocess-group TERM/KILL, reap and output drain are now bounded in the
retained runner (seven contracts). Native E
`/private/tmp/wavedl-retained-browser-bounded-20261010-e.json` passed all nine
stages and the complete current-source guard. Combined Node contracts now total
**349 passes** (driver31/producer10/guard8/runner7 plus other suites). Driver-only
stabilization uses two matching native-association observations within eight
reads/15s, original IDs/XPath and refusal to act on moving controls; application
preview semantics are unchanged.

Unmodified packaged Chrome 154 visible baseline **DRDaGD passed**, report:
`/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-browser-acceptance-DRDaGD/baseline.json`.
It uses current manifest `fb0dca4bbd6445621d630072c1d9375845107bfd3693b2cc6a5f5b9a6ec2474a`,
with zero plans at every field before/after check and summary before explicit
approval, no accidental planning, and completed normal CPU execution. Fresh
private profile/closure are verified. Full twelve-case actual-current headed
acceptance has only started and remains live here; no complete result is claimed.
Optional headed mode defaults off, and CI wiring remains unexecuted-hosted evidence.

Instrumented `JXrhpt` success is not accepted by the main guard. Failed Chrome150
`qazu4t` initially preserved private roots after closure failure; root's later
exact-profile/PID31217 SIGTERM and owned browser closure verified PID gone/default
session without altering its failed report. Earlier headless event cause is
unknown and no production guard semantics were changed. Legacy/restart/storage
loss, broader T38/security/platform/site and authorized release gates remain open.

## Continuation: final twelve-case bundle is rejected — 2026-10-10

Current-manifest actual bundle `rjoHIF` is terminal at
`/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-browser-acceptance-rjoHIF/summary.json`:
**11 passed / dataset failed**, correctly rejected by the aggregate evidence
guard. Baseline/offline/detach/reload/cancel/lost-ack/artifact-tamper/port-reuse/
live-port-reuse/authoring-parity/download-names passed with verified owned cleanup.
The initial dataset failure left the fixture origin; unrelated-origin information
is deliberately omitted. This supersedes the live-run note, not the open T38 gate.

Actual isolated `B0rQgg` dataset follow-up rendered the pipeline header, exposed all
six view tabs and verified the painted first-input distribution, then refused unexpected
`downloads.html`/`.crdownload` before export. All cleanup passed. Producer/cause
remains unknown and read-only review is ongoing; no actual 29-PNG acceptance,
non-PNG tolerance or weakened export/download check follows. Expected-loopback
snapshot and allowed-domain fences now prevent foreign-body failure reads.
Headed mode defaults off; headless causes remain unknown and application preview
approval semantics remain unchanged.

Stderr privacy handling now redacts the whole bounded input before tailing,
suppresses over-64-KiB input and unconditionally suppresses browser-command
stderr. Two regressions bring subprocess contracts to nine; the root terminal
combined Node result is **351 passes**, retaining driver31's bounded eight/15s
same-ID native association. Native E nine-stage/full-current-source guard and CI
wiring remain scoped evidence; full twelve-case/T38, dataset and broader
security/platform/site/release gates remain open.

## Continuation: native dataset parity and isolated browser policy — 2026-10-11

Actual native visible Chrome 154 dataset run **Iw86fF passed**:
`/private/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-browser-acceptance-Iw86fF/dataset-parity.json`.
Its 71 assertions cover NPZ, MAT, H5, HDF5 and one-row NPZ fixtures, all six
views (the one-row correlation is explicitly unavailable), 29 genuine decoded
PNG exports, nonfinite fault replacement, interactive plot drag/reset and heatmap
keyboard/reset behavior. Registry checks remain read-only with no new plans or
intents/executions. Owned browser/profile/fixture cleanup passed. This supersedes
the earlier absence of actual dataset PNG/interaction proof, not the failed
`rjoHIF` aggregate or complete T30c/T38/site/platform/release gates.

Read-only inspection of owned failed `97ozxB` download evidence found CRX3 magic
`Cr24`, version 3, header length 1,093 and ZIP offset 1,105. The ZIP contained only
`model.tflite` (131,736 bytes) and `model-info.pb` (7,105 bytes), not HTML or PNG.
The retained private 4-KiB prefix is neutral `000.bin`; it was not executed or
published. This identifies Chromium startup Optimization Guide model downloading
as the supported explanation for that payload, not a WaveDL PNG export defect.
The exact installed Chromium 154.0.8037.98
[source](https://chromium.googlesource.com/chromium/src/+/154.0.8037.98/components/optimization_guide/core/delivery/prediction_model_download_manager.cc)
defines `--disable-optimization-guide-model-downloads-for-benchmarking` and skips
model fetching when set (lines 48–53 and 208–214). Root observed that single switch
in the owned Chrome command line; flagged Iw86fF passed after unflagged
`97ozxB`/`fTG`/`6Bem` failures. This is a test-profile startup policy, not a global
user setting, production browser requirement or changed WaveDL export logic.
The unsuccessful comma-feature-list experiments `CpjzSH`/`f8DUOd` remain failures;
the final policy uses only the single benchmark switch and retains sandbox defaults.

Failure handling now retains at most 16 owned file prefixes, 4 KiB each/64 KiB
aggregate, in private mode-0700 directories/mode-0600 neutral files. Directory
and file no-follow/inode checks, post-read size/mtime/ctime checks and exact byte
caps reject moving or unsafe targets; reports expose neutral metadata, not bytes,
and CI does not upload these prefixes. Downloads may disappear during cleanup,
so this does **not** promise every failed payload is retained. Canonical realpath
ownership handles macOS `/var` aliases without relaxing symlink refusal.
First-view discovery remains bounded to 24 reads without added browser commands;
parity contracts pass 26, prefix contracts eight and launch-policy contracts three.
No new combined Node count is asserted before root's terminal combined check.

Fresh full twelve-case actual-current run `81lrwj` has started with manifest
`fb0dca4bbd6445621d630072c1d9375845107bfd3693b2cc6a5f5b9a6ec2474a`;
its terminal result is not yet recorded here. The aggregate guard correctly refuses
isolated Iw86fF because it lacks the twelve mandatory cases. Earlier Python
3,244/14, frontend 607 and Ruff 387-file results are unchanged earlier evidence,
not reruns. Same-host native evidence does not certify remote sites, platforms,
legacy transition, browser restart/storage loss, broader security or release.

## Continuation: terminal current twelve-case browser bundles — 2026-10-11

Actual same-host macOS visible Chrome 154 run `81lrwj` is terminal **12/12
passed**, at
`/private/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-browser-acceptance-81lrwj/summary.json`.
Direct fail-closed `verifySummary` passed for all twelve cases and current asset
manifest `fb0dca4bbd6445621d630072c1d9375845107bfd3693b2cc6a5f5b9a6ec2474a`.
Its copied-report CLI attempt was not accepted because the dedicated TMPDIR/profile
paths did not match; direct verification was not misrepresented as wrapper success.

A fresh dedicated repeat also passed **12/12**:
`/private/tmp/wavedl-browser-ci-acceptance.0rTzUi/wavedl-browser-acceptance-oOrxj3/summary.json`.
The exact command
`node tools/verify_browser_ci_report.mjs /private/tmp/wavedl-browser-ci-acceptance.0rTzUi`
exited 0, verifying twelve cases, proven cleanup and the same current manifest.
Root confirmed all test-owned browser/daemon processes gone; unrelated UMI browser
sessions were untouched. The terminal combined Node check is now **366 passes**
in **1,722.49 ms**. These results supersede the preceding live-run/combined-count
qualifications and the earlier rejected eleven-pass bundle, without reclassifying
failed historical runs. Isolated Iw86fF retains its separate 71-assertion/29-PNG
proof; browser benchmark policy and application export safety remain unchanged.

This is actual same-host macOS/Chrome/CPU acceptance, not hosted CI, all 24 T38
rows, remote GPU/Windows/real Slurm-site certification or R1/release completion.
Next local browser gaps include standalone adoption (row 24), same-daemon
401/identity-skew session retirement (row 21), and assembled split-UTF8/sparse-attempt
streams (row 16); existing unit/hosted evidence is not substituted for those
browser cases. Local deliberately rejects path remapping; no fake mapped-Local
scenario is required to claim remote storage acceptance.

## Continuation: packaged adoption and auth-skew evidence — 2026-10-11

Current asset manifest: `3487e46c6e87bb9d40fbcd020dd9a5f8030a563aab52b0942093c956ec8b27cf`.
Standalone adoption quality runs 5 and 6 each passed all ten assertions;
`verifyAdoption` accepted quality 6.
Thirteen genuine source files and one `COMPLETE` were independently hash-checked
before and after adoption, with actual 200, an injected 503, then retry-200.
The registry proves no PID, supervisor, job, submission receipt or cancellation
intent was created; the API explicitly reported `supervision_lost` uncertainty. Owned cleanup
passed.
Auth-skew report
`/private/tmp/wavedl-auth-skew-report-20261011-l.json` passed its CLI guard (exit 0)
with CPU history, real health post-handler-401/build/protocol faults, public
reauth/detach and old-authority removal, preserving original plan/control/manifest;
only one derived automatic-plot source generation is proven. Disposable credentials
were supplied via native CLI argv, not proof of process-list secrecy; reports contain
no token. Focused Python 21 (including five live-TCP stream tests, not browser
cursor proof) and Node 45 passed; frontend 610/typecheck/lint/format
passed. Generated-worker checks now pass 30/30 with configured Python PATH; the
earlier missing-Starlette-default failure remains retained history.

## Continuation: current packaged bundle and full Python rerun — 2026-10-11

The current 3487e build passed all twelve real-browser cases at
`/private/tmp/wavedl-browser-current.X2kTyd/wavedl-browser-acceptance-CkycRA/summary.json`.
`node tools/verify_browser_ci_report.mjs /private/tmp/wavedl-browser-current.X2kTyd`
exited zero: 12/12 passed, exact current assets and cleanup proven. This supersedes
the preceding no-current-bundle caveat, not the distinct earlier failed reports.
The fresh full Python non-slow/non-GPU rerun passed **3,251 / 14 skipped in
228.02s**, JUnit `/private/tmp/wavedl-final-python-current.xml`. Pinned Ruff
0.14.10 lint and format checks passed on 390 source/tool/test files.

CI now requires additive adoption/auth contracts, focused live-TCP tests and
the two real browser runners with strict guards. Uploads remain explicit JSON
reports only. Workflow wiring is not hosted CI execution. Independent audit
still requires real browser restart, storage-loss/corruption, concurrent admission
and legacy-worker transition evidence, plus browser stream cursor-boundary proof.
Full T38, platform/GPU/real-site and authorized release gates remain open.

## Continuation: retained-browser restart durability — 2026-10-11

`/private/tmp/wavedl-retained-browser-current-20261011-b.json` passed all ten
ordered stages; `node tools/verify_retained_browser_report.mjs ...` exited 0.
The restart stage closed/reopened the same owned Chrome profile, verified exact
g1–g3 CacheStorage/IndexedDB identity, a fresh document and per-generation
Settings chunks, then cleaned up. Storage loss/corruption, concurrent admission,
legacy transition and browser stream cursor boundaries remain open, as do full
T38/platform/site/release gates. Combined Node is **404/404** and Python is
**3,251 passed / 14 skipped**.

## Continuation: retained storage-loss hard refusal — 2026-10-11

After Service Worker hard-refusal and admitted-static matcher fixes, packaged
assets were rebuilt with hash
`af18842e79fde54a900655f8a4683a1546fe45a44f9cd520b06c1ae58b390978`.
The current frozen 12/12 bundle at
`/private/tmp/wavedl-browser-current-final-sw/wavedl-browser-acceptance-4FYKuM/summary.json`
was accepted by the strict CLI guard. The assembled stream report
`/private/tmp/wavedl-stream-browser-final-f2/report.json` passed with real rendered
history, fragmented SSE, cursor `0:-1` → `1:0`, and read-only journal/registry
authority; it explicitly records raw `utf8Observed: false` (split UTF-8 is ASGI-only).
Retained report
`/private/tmp/wavedl-retained-browser-storage-20261011-b.json` passed 11 stages and
`verify_retained_browser_report.mjs` exited 0. Its storage-loss stage deleted
exactly three owned CacheStorage buckets and the retained-builds IndexedDB database
while leaving the active registration present. Immutable and navigation requests
failed closed with no network response or resurrection. Generated-worker checks
pass **32/32** and retained Vitest **28/28**. This supersedes the prior
restart-only report; concurrency, legacy transition, browser stream cursor and
full T38/platform/site/release gates remain open.

## Continuation: final frozen-build evidence — 2026-10-11

Current package manifest:
`f2d77eb7b246d0de1800cc8b295b685aaf77d1bee755ac9cf5213d274fea99d8`.

| Exact current evidence | Terminal result |
|---|---|
| `/private/tmp/wavedl-browser-current-f2/wavedl-browser-acceptance-uWi0jN/summary.json` | 12/12; dedicated CLI guard accepted current assets and cleanup |
| `/private/tmp/wavedl-adoption-browser-final-f2/standalone-adoption.json` | Current-asset adoption guard accepted |
| `/private/tmp/wavedl-auth-skew-final-f2.json` | Current-asset auth/skew guard accepted |
| `/private/tmp/wavedl-retained-browser-final-f2.json` | Eleven native stages; current-source retained guard accepted |
| `/private/tmp/wavedl-stream-browser-final-f2/standard-final.json` | Rendered CPU history/diagnostics, fragmented real SSE, overflow-triggered replay at `1:0`, journal/registry match, cleanup |

Stream evidence observes the client cursor only through its next public request;
it records `utf8Observed: false` and does not claim private cursor storage. Raw
multibyte delivery, sparse sequence/attempt changes and corrupt controls remain
browser gaps, despite separate real-ASGI coverage. The Unicode-interpreter trial
failed and retains private evidence. The b92 bundle was rejected after rebuilding;
stale/mixed asset evidence was not accepted. Current frontend 612, generated
worker 33/33, typecheck/lint/format passed. Native concurrency, legacy transition,
full T38/platform/GPU/site and release gates remain open; no hosted lane was run.

Final root checks: all **407 Node tooling contracts** passed; nine focused
Python stream/boundary tests passed; pinned Ruff 0.14.10 lint and format passed
on 394 files; `git diff --check` passed. These are current focused results, not a
new claim that the full Python/platform suite was rerun after adding fixtures.

## Continuation: current 54bc PWA/legacy/concurrency evidence — 2026-10-12

The current manifest is
`54bc033f36361213fb73fa0ee28c9bb3a83451f2bbce71516de66189fc1d8ef0`.
Fresh current-build evidence passed strict guards:

| Gate | Evidence |
|---|---|
| Twelve browser cases | `/private/tmp/wavedl-browser-current-54/wavedl-browser-acceptance-IuAPCl/summary.json` |
| Adoption/auth/skew | `/private/tmp/wavedl-adoption-browser-current54/standalone-adoption.json`, `/private/tmp/wavedl-auth-skew-current54.json` |
| Retained PWA | `/private/tmp/wavedl-retained-browser-current54-b.json`, 11 stages |
| Native admission | `/private/tmp/wavedl-concurrency-current54-final.json`, stale refusal/retry and simultaneous capacity refusal |
| Legacy transition | `/private/tmp/wavedl-legacy-transition-20261012-d`, Workbox → authored YAML → close/reopen → consented update |
| Stream replay | `/private/tmp/wavedl-stream-current54.json`, rendered history and next-request cursor proof |

Nuxt automatic chunk-error/outdated-build reload paths are disabled and generated
worker tests assert their absence. The native concurrency scope is retained-store
admission with QA-scoped worker routing, not ordinary UI update approval, GC or
rollback. Stream evidence records raw `utf8Observed: false`; ASGI tests cover
split UTF-8. Hosted CI, Windows/GPU/real Slurm, sparse/malformed browser stream
cases, full T38 and release/Qt retirement remain open.

Root final checks: **3,261 Python passes / 14 skips** with JUnit
`/private/tmp/wavedl-final-python-20261012.xml`, **449 Node tooling contracts**,
15 focused stream/concurrency Python tests, pinned Ruff 0.14.10 on 396 files and
clean `git diff --check`. No hosted CI or external site certificate is inferred.

The release workflow was corrected to install `.[dev,daemon,gui]`, CPU Torch and
run `pip check` with offscreen Qt/CPU environment settings before its full test
job. This fixes a concrete dependency mismatch; the tagged release, PyPI publish,
T40 deprecation notice, T41 Qt removal and T42 verification remain unauthorized
and open.

## Continuation: registration mapping repair and new native failure gates — 2026-10-12

Current packaged manifest:
`3bad3d0efbb39a233a4db1da158eb3d7f2118629b2404450831fb39d495061ac`.

Independent review found that automatic plots restored host-side data/interpreter
paths but retained execution-side `.py` imports. Overlapping storage roots could
map them a second time. A RED regression reproduced the wrong path; a second RED
controller regression reproduced rejection of a correctly normalized plot plan.
The repair validates each original registration's single forward mapping,
preserves the original host input and compares the derived normalized import
list exactly against the immutable training manifest. Order and named-module
identity remain attested. A Vietnamese diagnostic and a Python manifest
roundtrip regression accompany the fix. This does not make remapped Local
execution supported or certify a real mapped Slurm allocation.

| Current gate | Independently accepted evidence |
|---|---|
| Native partial-install rollback | `/private/tmp/wavedl-retained-rollback-autoplot-20261012.json`, with `/private/tmp/wavedl-retained-builds-autoplot-final-20261012/summary.json` |
| Sparse Unicode stream and ahead-control rejection | `/private/tmp/wavedl-sparse-browser-20261012-final3bad-report.json` |

Rollback uses the genuine QA-scoped worker and native CacheStorage/IndexedDB,
holds the second asset after one native cache write, then injects HTTP 503. The
failed worker becomes redundant, its pending/cache ownership is removed and
the warm generation/page/controller remain unchanged. This is not ordinary
UI update approval, quota exhaustion, crash or GC proof.

The stream fixture retains genuine journal identities, omits one event,
explicitly annotates a payload with Unicode and fragments ASGI body sends.
Public DOM observes `[1:0]` and `[1:2]` with `sóng 波 🌊`; the next public request
uses cursor `1:2`. An owned-file barrier releases an ahead-control fault only
after that DOM observation, then the public protocol-skew alert retires the
selected run and bearer field. No attempt rollover, post-rejection private
cursor, malformed JSON control or browser network-chunk boundary is claimed.
Both native reports prove owned cleanup.

The rebuilt twelve-case aggregate
`/private/tmp/wavedl-browser-autoplot-20261012/wavedl-browser-acceptance-ujEPTc/summary.json`
failed all cases at native authoring/readback boundaries. A subsequent serial
baseline also failed:
`/private/tmp/wavedl-browser-autoplot-serial-20261012/wavedl-browser-acceptance-a5hQB4/summary.json`.
These remain failures with verified owned cleanup, not a current twelve-case
pass. Concurrency alone did not explain the serial failure; product vs driver
causality remains under focused investigation. Earlier 54bc reports are
historical and are not accepted as current 3bad evidence.

Current root checks: **3,266 Python passes / 14 skips**, JUnit
`/private/tmp/wavedl-python-autoplot-20261012.xml`; **615 frontend**, **485 Node
tooling contracts**, **35 generated-worker** and 31 focused Python tests passed.
Typecheck, Oxlint, Oxfmt, pinned Ruff 0.14.10 with `--no-respect-gitignore` on
399 files, workflow YAML and `git diff --check` passed. CI now includes native
rollback/sparse runners, strict guards and JSON-only uploads, plus legacy and
concurrency contracts; it was not run on hosted infrastructure. Current full
browser acceptance, T30c/T38, native Windows/GPU/site and authorized release/
Qt-retirement gates remain open.

### Clean installation and bounded authoring-driver diagnosis — 2026-10-12

A new venv without inherited system site packages installed `.[dev,daemon,gui]`
successfully and passed `pip check`; it has no FastAPI. The older shared validation
environment's FastAPI/Starlette conflict is not accepted as dependency readiness.
The clean environment resolves Python 3.11.17, Torch 2.14.1, Starlette 1.7.0,
PySide6 6.12.0 and pytest 9.1.1. Installed `wavedl-daemon serve --help` succeeds.
Its first full run exposed four `python -S` test probes that implicitly relied
on inherited `PYTHONPATH` (editable `.pth` discovery is disabled by `-S`). The
four probes now explicitly select checkout `src` while preserving `-S` and the
forbidden ML/GUI dependency assertions. Root repeated those four tests without
parent `PYTHONPATH`, then reran the entire clean environment: **3,266 passed /
14 skipped in 218.68s**, JUnit `/private/tmp/wavedl-clean-python-final-20261012.xml`.
The original failed clean run remains `/private/tmp/wavedl-clean-python-20261012.xml`.

Owned stage-by-stage browser diagnostics
`/private/tmp/wavedl-authoring-diagnostic-KCm6lO/evidence.json` located the native
event flood immediately after `press Enter` on the configured-root Radix
combobox, before dataset/model/editor actions. Concurrent browsers and semantic
editor-toggle locator hypotheses were falsified by serial/paired probes. The
exact driver implementation defect is not established. No product workaround
was added. QA now clicks the visible `datasets` option using a preserved XPath
and the existing two-observation hit-test gate; duplicate or unstable options
fail closed. It does not claim keyboard-combobox acceptance.

The same current packaged build's fresh single baseline passed with clean Python:
`/private/tmp/wavedl-browser-click-root-20261012/wavedl-browser-acceptance-WQdHZt/summary.json`.
This is a single case, not a twelve-case sign-off. Current combined tooling
contracts are **488/488**. Diagnostic sessions/services and owned profiles/data
were closed/removed, while their private evidence remains. Earlier failed
aggregates are preserved; complete browser/T38/native/site/release gates stay open.

### Fresh current-build twelve-case acceptance after driver correction — 2026-10-12

`/private/tmp/wavedl-browser-native-option-final-20261012/wavedl-browser-acceptance-KfFwu9/summary.json`
completed all twelve cases with the clean installed Python environment. Root ran
`node tools/verify_browser_ci_report.mjs /private/tmp/wavedl-browser-native-option-final-20261012`:
**12/12 passed**, exact current manifest `3bad3d0e…` and owned cleanup proven.
The native option action still rejects duplicates and unstable hit-test geometry;
no form/app state is injected. This supersedes the preceding no-current-aggregate
caveat, not the failed reports or keyboard acceptance gap. Current retained
partial-install rollback and sparse Unicode/rejection reports remain accepted.
Complete T30c/T38, malformed-control browser faults, native
Windows/GPU/site, hosted CI and authorized release/Qt retirement remain open.

### Assembled crash/replay, malformed control and native-foundations guards — 2026-10-12

The local assembled failure harness covers projection-first and cursor-first
SQLite transaction orderings. It uses public ASGI plan/submit/cancel, real
HostedServices, writer receipt/startup files, durable journal bytes, a SIGKILL
at the first uncommitted telemetry write, restart replay and repeated
plan/event/cancel requests:
`unit_tests/daemon/test_assembled_crash_replay.py` plus neighboring registry/
hosted tests passed **5/5**. This is assembled local/controlled-compute evidence,
not scheduler, remote-filesystem or real-site proof.

The current malformed-control browser report
`/private/tmp/wavedl-stream-malformed-20261012-gate.json` passed its strict guard.
It rendered real sparse journal IDs and Unicode, sent a syntactically truncated
control on the second real SSE request, observed public invalid-response
retirement, cleared the selected run and bearer, and proved 3-second quiescence
with no extra request. Attempt rollover, private post-retirement cursor and
browser network chunk boundaries remain explicitly unclaimed.

The native-foundations guard requires the current OS ownership/process cases
while counting other platform/optional skips as unverified. On this macOS host,
core foundations passed **789 / 6 skipped** and daemon foundations **1,608 / 8
skipped**; the strict guard accepted **13 required native cases** and reported
14 other skips. Windows, GPU, shared-filesystem and Slurm-site behavior remain
external gates. CI now triggers foundations on `web/**` and `tools/**`, runs
`pip check`, uploads JUnit and executes the native guard.

The GUI XML guard now rejects root/suite count contradictions, malformed
aggregates and unexpected testcase identities; **53 guard tests** passed. The
native foundations guard adds bounded UTF-8 XML parsing, entity/symlink rejection
and strict decimal aggregate checks; **70 guard tests** passed. The clean
assembled GUI lane passed **17/17** with zero skips/failures/errors, including
automatic-plot filesystem-fault/retry recovery. Hosted
matrices have not run.

Root's expanded clean full regression passed **3,386 / 14 skipped in 302.67s**,
JUnit `/private/tmp/wavedl-clean-python-restart-20261012.xml`. Combined Node
tooling contracts passed **556/556**; pinned Ruff 0.14.10 lint/format passed on
404 Python files, all seven workflow YAML files parsed and `git diff --check`
passed. Current 3bad twelve-case browser evidence remains accepted. T30c/T38,
hosted/native Windows/GPU/site
and authorized release/Qt-retirement gates remain open.

### Qt automatic-plot delivery failure/retry gate — 2026-10-12

`unit_tests/test_gui_autoplot_failure_integration.py` now runs real CPU training
and automatic plot generation through public loopback HTTP and real QThreads.
After the successful training export, a preserved ordinary file replaces the
client export-directory path. The completed daemon plot remains truthful while
the GUI marks delivery uncertain and emits no successful plot signal. Repairing
only that local preference resumes the retained operation without a second run;
returned PNG signature/size/SHA, QImage decoding and actual gallery raster pass.
Teardown continues even after earlier cleanup errors and verifies zero outstanding
host work, stopped host/server threads and listener refusal.

The new case passed independently and with ten neighboring GUI/consumer tests.
It is now required by both GUI and release CI, making the assembled slice
**17/17 with zero skips/failures/errors**, JUnit
`/private/tmp/wavedl-clean-gui-acceptance-20261012-v2.xml`. This proves an unmapped
Local client-filesystem delivery fault, not mapped Local support or remote-site
plot acceptance. The GUI report reader adds bounded ordinary UTF-8 input,
nonblocking FIFO rejection, entities/root/count validation, and **53 guard tests**
pass. Root's clean full non-slow/non-GPU rerun passed **3,384 / 14 skips**, JUnit
`/private/tmp/wavedl-clean-python-gui-fault-20261012.xml`.

Two genuine standalone launcher attempts with one run identity and public initial
adoption of attempt 2 now pass the strict current-package browser gate:
`/tmp/wavedl-rollover-hardened-20261012-b/standalone-adoption-rollover.json`. Public DOM
renders historical attempt 1 and active attempt 2 IDs; the SSE boundary records
cursor `0:-1` → `1:0` and forwards genuine attempt-2 records. The browser cursor
itself remains intentionally unobservable, and the first disconnect is a bounded
fixture overflow control, not broker-capacity proof. The report proves same-run
launcher identity, lost-ack retry, journal/registry authority and owned cleanup.
This closes the local attempt-rollover browser subgate, not real Slurm requeue or
site certification. Complete T30c/T38, native Windows/GPU/
site, hosted CI and authorized release/Qt-retirement gates remain open.

Independent Playwright keyboard acceptance also passed against current 3bad
assets (`/private/tmp/wavedl-keyboard-acceptance.EzSVmI/report.json`). The real
configured-root trigger focused, Enter opened the popup, ArrowUp selected
`datasets`, Enter committed it and the daemon returned the dataset in the public
DOM; reopening and Escape preserved the selection. ArrowDown from the initially
selected last item is a no-op under packaged Radix ordering `[datasets, runs]`;
the gate records that bounded behavior rather than claiming wraparound. Browser,
daemon, profile, token and fixture cleanup all passed. This closes the keyboard
interaction subgate while leaving complete T38 and external platform/site gates.

### Browser preference-corruption recovery gate — 2026-10-12

The current preference gate passed at
`/tmp/wavedl-preferences-fixed-4/preferences-browser.json` against the 3bad
package. A real daemon/browser session seeded malformed and oversized appearance
and daemon-default records, reauthenticated on the same normal origin, and
verified public fallback theme `system`, locale `en`, guide enabled, CPU draft
defaults (`epochs=1000`, `batch_size=128`, `workers=-1`, `precision=bf16`),
unrelated storage preservation, unchanged fixture file hashes and strict browser/
daemon/profile/token/listener cleanup. It does not exercise YAML export or cache
deletion. The verifier has 17 adversarial tests and is wired into browser CI;
row 20's corruption fallback subgate is locally covered.

### Real Qt/public-HTTP ordinary restart/reconnection gate — 2026-10-12

`unit_tests/test_gui_daemon_restart_integration.py` establishes a real CPU child,
hello, nonempty epoch progress and running Qt monitoring. Ordinary daemon shutdown
stops its owned child without modifying durable user cancellation intent. Reopen
on the same state/run directories, port and credential retains the database's
daemon identity and reports `supervision_lost` uncertainty. Explicit retained
worker resume preserves the run/idempotency reference and does not allocate a
new plan or process. Cleanup verifies worker/host/server shutdown, no outstanding
work, reaped children and listener refusal.

The expanded mandatory assembled GUI slice passed **18/18 with zero skips**,
accepted by the strict CLI guard; JUnit
`/private/tmp/wavedl-gui-restart-acceptance-20261012.xml`. This is not SIGKILL,
orphan/PID-reuse, Windows/GPU or real-site proof. It is now mandatory in GUI and
release CI, without executing either hosted workflow or a release.

### Declared oversized artifact browser refusal — 2026-10-12

`/tmp/wavedl-artifact-check.shL0Ja/artifact-publication-oversized-inventory.json`
passed the strict current-package guard. The fixture changes only one declared
size in an authenticated completed inventory to `64 MiB + 1`; actual immutable
publication bytes remain small and are independently size/SHA verified. The real
browser refuses with budget guidance before an artifact GET, creates no preview
or download file, and leaves all registry/run/COMPLETE/journal bytes unchanged.
Session absence, listener refusal, services/runtime completion and owned root/
profile/token removal pass. The earlier cleanup-failed run is retained separately.
There are 23 focused verifier tests and 556 total Node tooling contracts.
This is a response-boundary declared-size refusal, not an actual 64 MiB file,
filesystem crash, incomplete-publication or remote-site acceptance claim.

### Submitted-plan protection, Qt lifecycle and isolated wheel acceptance — 2026-10-12

Fresh independent current-package proof is
`/private/tmp/wavedl-submitted-independent-final-20261012/submitted-plan-browser.json`.
Real Chromium/CPU training and automatic plotting settled two plans before an
epoch edit, confirmed reset and acknowledged-run navigation. Full settled plan,
manifest, control and execution-row hashes remained unchanged; dataset/model/
runtime selection survived reset, with no new submission or cancellation. The
bounded verifier requires exact run identity, current assets, listener refusal
and owned cleanup. This closes only the local submitted-plan browser subgate.

Qt now retires superseded automatic-plot monitors without cancelling daemon work,
ignores their late output/results, starts the dashboard spinner only for actual
plot work, and clears empty successful plot states. Independent neighboring
worker/autoplot/restart coverage passed 66 tests; subsequent regression additions
also cover repeated supersession and empty results. The earlier broad counts are
historical until the fresh full rerun completes.

T39a now has a true no-system-site-packages dependency-resolving wheel gate.
With `/private/tmp/wavedl-t39a-wheelhouse.ULlpKp`, root independently passed the
selected gate in 54.49 seconds: resolver install, `pip check`, console scripts,
TCP/static assets, standalone CPU training, checkout isolation and teardown.
Explicit empty/incomplete wheelhouse configuration fails; only unconfigured
environments skip without assuming network access. JUnit from the agent's clean
run is `/private/tmp/wavedl-t39a-isolated-20261012.xml`.

Artifact acceptance cleanup now escalates/reaps owned processes, continues after
individual path-removal errors, never signals a reaped leader, exclusively writes
reports and redacts credentials. A fresh real report passed at
`/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-artifact-publication-uxTMUj/`.
Current Node contracts pass 583/583.

The explicit result-operation browser helper and strict verifier are implemented,
but current real attempts still fail before evaluation completes. No browser pass
is claimed. T30c/T38, remaining parity variants, hosted CI, Windows/GPU/real-site,
and authorized release/Qt-retirement gates remain open.

Fresh full clean-venv regression with the explicit complete wheelhouse passed
**3,391 / 14 skipped / 336 deselected in 532.88 seconds**, JUnit
`/private/tmp/wavedl-clean-python-parity-20261012.xml`. The additional isolated
installation test actually ran; its no-wheelhouse optional skip was not counted
as acceptance. Current Node contracts pass **583/583**, and pinned Ruff
lint/format checks pass on **407** Python files. This supersedes the earlier
regression totals, not the remaining real result-operation browser gate.
### Current packaged evaluation-operation acceptance — 2026-10-12

The rebuilt current asset manifest is
`4d09580d5f443ec24698bbffe67eac58ee3019099514a2f513841ad3e81e7c34`, after
fixing the result-operation form's missing `backend: local` default. Real
Chromium/daemon acceptance and the strict verifier passed at
`/private/var/folders/kl/k8qwgt0x2rg5zv3chzgzzwfr0000gn/T/wavedl-browser-acceptance-LkqO5s/result-operations.json`.
The flow selected a genuine checkpoint, refused unsupported ONNX opset 18 without
durable mutation, revoked an abandoned preview after a draft change, completed an
explicit CPU evaluation, published a verified predictions artifact, and proved
source/manifest/COMPLETE/evaluation-event identity and cleanup. This is local CPU
evidence only; remote/GPU/Windows/Slurm and complete T38 remain open.

### Current twelve-case browser aggregate — 2026-10-12

The rebuilt package manifest is
`4d09580d5f443ec24698bbffe67eac58ee3019099514a2f513841ad3e81e7c34`.
Root independently ran the complete twelve-case aggregate under
`/private/tmp/wavedl-browser-final4d-20261012`; the strict verifier accepted
12/12 cases, exact current assets and owned cleanup. This supersedes the earlier
3bad twelve-case report as current aggregate evidence. It does not re-certify
subgates whose reports were produced from another package, and it does not close
T30c/T38, hosted CI, Windows/GPU, Slurm or release authorization.

The submitted-plan protection and declared oversized-inventory refusal gates
were also rerun against this exact 4d package. Root accepted the strict reports
`/private/tmp/wavedl-submitted-parent-PjP8lO/report/submitted-plan-browser.json`
and `/tmp/wavedl-artifact-current-YO3oFC/artifact-publication-oversized-inventory.json`
with current assets and all owned cleanup confirmed. The latter has 28/28
focused evidence contracts. These establish only the same-host submitted-plan
immutability and response-boundary declared-size refusal already described
above, not remote execution, an actual oversized file, crash publication or T38
completion.

### Current 4d ONNX and inference-cancellation gates — 2026-10-13

The current 4d browser ONNX report
`/private/tmp/wavedl-p3-onnx-current4d-actualbrowser-v2/onnx-export.json`
passes the strict verifier. It records the exact-opset correction (`opset=17`),
same-host CPU export from a genuine checkpoint, finite PyTorch/ONNX comparison,
verified immutable download/publication identity, and complete owned cleanup. This
is supported ONNX export-only evidence via an evaluation plan; it does not claim CV, remote,
GPU, Windows, Slurm, or full T38 parity.

The current 4d inference-cancellation report
`/private/tmp/wavedl-inference-cancel-root-current4d-20261013-rerun/inference-cancellation.json`
also passes the strict verifier. A real runtime emitted `hello` with a live PID,
entered `running`, received cancellation, exited `cancelled` (code 130), left no
publication, and completed graceful SIGINT fixture cleanup with no duplicate plan
or run. This is local CPU cancellation evidence, not remote/scheduler/platform
parity or release/site certification.

Focused current checks are 32 Python ONNX tests and 46 runtime/ONNX root tests
(`cleanpython -m pytest unit_tests/test_onnx_export.py unit_tests/test_runtime_operations.py -q`).
The focused Node ONNX and cancellation contracts pass 17 and 31 tests,
respectively. The fresh complete non-slow/non-GPU Python rerun passed
**3,402 / 14 skipped / 336 deselected in 467.39 seconds**, JUnit
`/private/tmp/wavedl-clean-python-current-20261013.xml`. All **641** Node tooling
contracts pass. Root also independently reran the hardened ONNX wrapper and
guard at `/private/tmp/wavedl-onnx-root-reviewed-current4d-20261013/onnx-export.json`.
The current twelve-case aggregate plus the submitted-plan, artifact-inventory,
and result-operation reports remain the accepted 4d reports above. T30c/T38,
platform/site/release gates remain explicitly open; CV, remote, GPU, Windows,
Slurm, and full parity are not claimed.

### Final current-source package recertification — 2026-10-14 (58d4)

The exact source distribution built from an outside-checkout staging tree now
passes its clean isolated acceptance: **1 passed / 3 deselected / 0 skips,
failures or errors** in 47.92 seconds. JUnit:
`/private/tmp/wavedl-release-final-report.1uGai6/release-sdist-installed.xml`,
SHA-256 `1578fbbc277aaec6111188fe2019dc0f093bd19a266094275fa37f57da9f6fcd`.
The tar SHA-256 is
`95e4d826b895caba8b52a32ba86c13adb2b2c202afb7c8b0c5871e1d1611555c`; its
219 Python files and 39 web assets match the rebuilt wheel and current source.
No repository files were edited during recertification, and no tag, release or
publication was performed. This supersedes prior package reports.
