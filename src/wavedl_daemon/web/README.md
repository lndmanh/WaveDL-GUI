# WaveDL static workstation

This is the primary UI of the new daemon-backed WaveDL application, still under
final product/platform acceptance. Qt compatibility and old-user-data migration
are not required. It supports project authoring, immutable plan
approval, training/monitoring/cancellation, dataset exploration, verified results,
evaluation/plots, adoption and preferences. Cached UI is never evidence of a live
daemon or run status. English and Vietnamese are supported through the active
workstation's own catalogs; upstream scaffold locale files are not activated.
Switching language retains drafts, selected publications and chart data, while
disconnecting still clears connection-scoped authority.

## Active source and provenance

Nuxt uses its default `app/` source root, Vue Composition API and TypeScript. `app.vue`
only composes the workstation controller and build-skew notice.
The active app imports selected existing shadcn primitives from `app/components/ui`.
`app/assets/css/tailwind.css` provides the active semantic theme, using local system
fonts only. `app/lib` contains the typed daemon client and stream foundation.

The former workstation source has been merged into `app/`, which now contains the
browser application alongside the retained shadcn UI primitives and theme CSS.
The active typecheck checks all app TS/Vue and transitively imported UI components.
Lint/format checks target active custom code.

There is no Cloudflare, NuxtHub, Sentry, account/auth backend, telemetry or remote
font module. No Nitro server ships: `ssr: false` and static generation produce
only `.output/public`. The daemon remains the sole API/compute authority. Never
place the master bearer in build environment variables, source, public assets,
URLs or browser storage. Bootstrap exchanges it for a bounded, revocable
session envelope stored under `wavedl.session.v1` in `sessionStorage` by default;
`localStorage` is used only after the explicit **Keep me signed in on this browser** choice. Reloads
resume the same session without rotating its token. Session tokens expire after
12 hours idle or 7 days absolute. With the same state root and registry, daemon
identity is stable across restarts, `--credential-file` also preserves the master
token, and browser sessions are in memory, so after a daemon restart sign in again.
The envelope's `expiresAt` is informational; the client never rotates or rejects it
locally, and the daemon remains authoritative.
401 reports “Your session ended. Sign in again.”; a daemon-identity 409 reports
“A different WaveDL daemon is now serving this address. Sign in again.” Only
stored envelopes matching the rejected token are cleared. The non-credential
sign-in preference is remembered and can be changed while connected.

Cross-validation summaries are displayed from an explicitly selected, completed
SHA-verified publication. Summary generations are not model checkpoints. ONNX
exports are validated self-contained files; external-data graphs and models
requiring the protobuf 2 GiB limit are refused rather than downloaded partially.

## Run the packaged browser workstation

The checkout already includes the generated browser assets. Install the daemon
from the repository root and start it; Node is not required to run this bundle:

```sh
python -m pip install -e ".[daemon]"
wavedl-daemon serve --credential-file /absolute/path/to/daemon-token --browse-root datasets=/absolute/path/to/datasets
```

Use an owner-only token file for the recommended restart-stable master
credential; see the root [README](../../../README.md) for the creation command. The
ephemeral default is still supported, but a daemon restart requires a new
bootstrap link.

If you change browser source, regenerate and vendor its assets using the
development commands below before testing those changes through the daemon.

Open the single-use bootstrap URL printed by the daemon. The bootstrap code is
stripped from the URL synchronously before requests begin and is exchanged for
a session token; the master credential never enters the URL or browser storage.
Select data and a model, enter the absolute Python interpreter on the daemon
host, review the persisted plan, and approve it. The selected Python must
contain the WaveDL ML dependencies; daemon health alone does not certify that
environment. Keep the daemon bound to loopback; use SSH forwarding for remote
hosts, not unauthenticated LAN exposure.

Closing/detaching stops browser follow-up work without cancelling running jobs.
Use the explicit cancellation action for that. Browser downloads use your
browser's location/permission settings, not the daemon's run directory.

## Development and verification

Node 24 is used in CI (Node 22.19+ is supported). Dependencies and lockfile are pinned.

```sh
cd src/wavedl_daemon/web
npm ci
npm run dev
# Run Nuxt prepare/typecheck and generate sequentially, not concurrently.
npm run lint
npm run format:check
npm run typecheck
npm test
npm run generate
cd ../../../
python tools/vendor_web_assets.py
```

The vendor script validates the exact static output, rejects links/backend files,
and checks existing packaged assets against their manifest before replacement.
Previous generated output is retained in
`src/wavedl_daemon/web/.vendor-backups/` for recovery, outside the vendored asset
directory.
The Python wheel includes only the vendored assets, not Node or a Nuxt server.
Do not manually copy build output into the package: stale chunks must not survive.

The browser workstation is online-only; Offline/PWA and retained-build support
were retired by the project owner on 2026-10-27. It does not register a service
worker or cache application/API data for offline use. `/api/health` reports the
daemon build identity; when it differs from the browser build, an accessible
notice offers **A newer WaveDL build is available — Reload**. Reload is user-
initiated with `location.reload()` and is never automatic.
For a client left under an older registration, the daemon serves `/sw.js` as a
no-store, self-unregistering cleanup worker. It does not clear site data or force
a reload; reopen or reload the tab once after cleanup to use the current client.

## Known dependency caveats

The 2026-10-08 `npm audit` reports 13 affected dependency entries: eight high and
five critical, including `braces`, `node-forge` and `simple-git` build/dev-tool
chains. Nuxt was upgraded from generator 4.4.5 to 4.5.2 and Vitest to 4.1.11;
these upgrades do not eliminate all advisories. No audit autofix downgrade was applied.
The static wheel does not include these Node packages. Bind the development
server to loopback only; this does not waive dependency maintenance or browser
acceptance before release.

## Reproducible assembled-browser failure slice

After generating and vendoring the current static assets, run from the repository
root with an installed `agent-browser` CLI and Chromium (the initial development
run used `agent-browser 0.26.0`):

```sh
node tools/run_web_acceptance.mjs
node tools/run_web_acceptance.mjs --case=baseline
node tools/run_web_acceptance.mjs --case=detach
node tools/run_web_acceptance.mjs --case=reload
node tools/run_web_acceptance.mjs --case=cancel
node tools/run_web_acceptance.mjs --case=lost-ack
node tools/run_web_acceptance.mjs --case=artifact-tamper
node tools/run_web_acceptance.mjs --case=port-reuse
node tools/run_web_acceptance.mjs --case=live-port-reuse
node tools/run_web_acceptance.mjs --case=authoring-parity
node tools/run_web_acceptance.mjs --case=download-names
node tools/run_keyboard_browser_acceptance.mjs
```

The focused keyboard runner uses only native key presses after opening a fresh
owned browser profile. It exercises guided dataset/model selection, popup Escape
focus return, invalid-field correction and the inline reset/Keep draft controls,
while asserting that no plan or execution is created. It prints its report path;
verify that file with `node tools/verify_keyboard_browser_report.mjs <report>`.
This is not a full WCAG or assistive-technology audit, and an inline confirmation
is not treated as a modal dialog with a focus trap.

Set `WAVEDL_PYTHON` to the daemon/ML interpreter and optionally
`AGENT_BROWSER_BIN` to the installed CLI. Each case creates an exclusively owned,
empty, private temporary root and an isolated browser session, launches a real
CPU daemon fixture, and authors a persisted plan through the actual browse/model
catalogue and approval UI. No bearer is saved to state files or printed by the
runner. The fixture's bootstrap output is captured only in memory. Browser
interactions use fresh accessibility snapshots, semantic locators or existing
unique field IDs, explicit scrolling and read-only two-frame geometry/hit tests
before native clicks. Ambiguous named controls require an explicit region scope;
hidden retained-form fields cannot redirect an action from its selected ID.
Positional ancestor selectors are not used across asynchronous render boundaries.
Native expandable summaries are clicked
and their open state is checked without changing authored values or creating plans.
This does not establish keyboard-only summary/form acceptance; that gate remains
separate. They exercise guided dataset/model selection,
then explicitly switch to the full editor for stable labelled-field authoring;
postconditions use read-only daemon SQLite queries. The reload case asserts
that the session envelope survives a document reload, the URL is credential
free and the master bearer is absent from storage.

The baseline checks explicit approval, daemon-confirmed real CPU completion and
downloaded bytes against the immutable publication's size and SHA-256.
Failure cases check detach/close without cancellation, reload session recovery,
explicit cancellation with daemon-confirmed terminal state, and
recovery after the fixture suppresses one
successful submit acknowledgment and returns an empty proxy-style 503
*after actual backend acceptance*. The lost-ack case tests HTTP gateway failure
after acceptance, not a TCP connection-loss test; the CLI's
abort route alone cannot prove server acceptance. Fault injection lives only in
the test fixture, with no production debug API and no fabricated checkpoints.
The artifact-tamper case flips one byte in the genuine backend's artifact stream,
retains its original length, and asserts that the browser refuses it before
publishing a download. It exclusively creates a private, mode-600 arm file inside
its owned fixture root after loading publications, so earlier automatic metadata
reads remain genuine. There is no HTTP fault-control endpoint or signal dependency.

The port-reuse case previews against daemon A, gracefully stops A while keeping
the browser's approved plan, and starts a genuinely distinct daemon B on the
identical loopback port. Both fixtures read the same exclusively created private
mode-600 bearer file outside their otherwise-empty roots. Authenticated read-only
health checks prove the credential remains valid and identity—not a 401—changed.
The old browser approval must require explicit scope clearing, revoke its preview
and selections, and leave B with zero plans, submission intent, executions or runs.
Both owned daemon roots and the temporary credential file are cleanup-verified;
the bearer itself is never passed in argv, recorded in evidence, or printed.

The live-port-reuse case additionally submits genuine long CPU training, waits
for persisted runtime metrics/logs matching its producer journal, and captures a
nonempty rendered epoch/history/log monitor before replacing the daemon. Its
recorded cursor comes from the real durable producer event, not private Vue state
or a claim about the browser's exact internal replay position. Normal fixture
shutdown cancels and reaps A's owned process while the browser stays open; genuine
native process results are recorded before deleting any root. A runtime exit is
recorded only if genuinely published; its absence is explicitly an unknown runtime
outcome, not a fabricated cancelled publication. This is distinct from the
detach/close-without-cancellation case. If shutdown first retires the transport
scope, the case verifies history/credential/cancel authority are cleared, then
explicitly enters the generated fixture-only credential through the real connection
UI. The retained daemon identity must still fence B; production reconnection policy
is not bypassed. Exact private bearer and bootstrap values are recursively redacted
from success/failure evidence, including snapshots, keys and the final summary.
Replacement B records only secret-free API method, path, whitelisted numerical
cursor fields, response status and scope-header presence. The case requires an
old-scope identity conflict, removal of the actual populated monitor/history,
no accepted old-run read/replay and no B mutation. Rejected old-scope boundary
requests are allowed; successful authentication alone is not identity proof.
The final request inventory is reread only after the owned browser is absent and B
has finished service shutdown, so late accepted reads/mutations cannot escape the
assertions. Query fields, API paths and inventory bytes are bounded and whitelisted.

The authoring-parity module is a partial local authoring slice, not a claim that
every training control has been manually exercised. It authors eight representative
fields through actual controls, checks all training inventory keys in genuinely
downloaded YAML, parses generated POSIX quoting for an owned dataset path containing
spaces and shell metacharacters, and checks guided navigation, cancelled/confirmed
reset, malformed preset rejection, invalid-range blocking and immutable plan
invalidation/repreview without submission. Project reset currently restores bundled
training defaults while preserving separately saved browser new-run preferences.
Settings only explains browser-owned download placement; the case does not invent a
workstation download-folder setting. Actual before/after exports remain in the
runner's browser-configured private download directory.

The download-names module waits for genuine CPU training and its independent
automatic plotting workflow to complete, then downloads selection metadata from
two actual generations using native browser clicks (no test-overridden save
filename). It checks the full run/generation prefixes and exact publication
bytes. This proves those ordinary metadata filenames, not universal collision
freedom for every sanitized path or OS download setting.

The runner prints a private temporary evidence location containing per-case JSON
and a summary with the exact CLI version, packaged-asset manifest hash, approval
manifest, assertions, final daemon state and accessibility snapshot. It shuts
down only its daemon/browser, verifies its named browser session is absent, and
removes only its own temporary dataset/run/state roots after verified cleanup.
Polling uses wall-clock deadlines, including bounded read-only registry calls.
Forced or uncertain shutdown marks the case failed and retains its private roots
for inspection rather than deleting data while descendants may remain.
JSON evidence remains for inspection. Nonzero exit means at least one
case failed; failure records are not acceptance claims. This slice does not
establish all T38 gates, every artifact format/size boundary, build-skew reload
handling, GPU/Slurm execution, or network-level lost-ACK recovery.
