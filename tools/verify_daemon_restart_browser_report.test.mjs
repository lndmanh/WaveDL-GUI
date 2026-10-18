import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { limitation, verifyDaemonRestartFile, verifyDaemonRestartRecord } from "./verify_daemon_restart_browser_report.mjs";
function validRecord() {
  const digest = "a".repeat(64);
  const process = { pid: 10, create_time: 1, argv: ["python", "fixture.py", "--root", "/owned", "--tag", "private-tag"], cwd: "/owned/runs/run", run_root: "/owned/runs", tag: "private-tag" };
  const request = { method: "GET", path: "/api/health", status: 200, cursor: {} };
  const state = { runId: "run", runs: [{ run_id: "run", state: "running" }], plans: 1, executions: 1,
    journalMatches: true, metricSteps: [1], controls: [{ plan_id: "plan", submission_requested: 1, cancellation_requested: 0 }],
    processFingerprints: [process], requests: [request, { method: "POST", path: "/api/bootstrap", status: 200, cursor: {} }], eventIds: [[1, 0]], eventHashes: [digest], cursors: [[1, 0]] };
  const before = structuredClone(state), after = structuredClone(state), frozen = structuredClone(state);
  after.runs[0].state = frozen.runs[0].state = "supervision_lost";
  const storage = { cookies: "", local: [], session: [] };
  const derivedBefore = { run_id: "run", plan_id: "plan", request_id: "request", attempt: 1,
    backend: "local", operation: "train", state: "running", uncertainty: false,
    submission_requested: true, cancellation_requested: false };
  const derivedAfter = { ...derivedBefore, state: "supervision_lost", uncertainty: true,
    evidence: { confidence: "unconfirmed", backend: { status: "supervision_lost" }, reason: "Supervisor ownership was lost; PID adoption is unsafe" } };
  const wire = (value) => {
    const raw = JSON.stringify(value);
    return { path: "/api/runs/run", status: 200, raw, bytes: Buffer.byteLength(raw), sha256: createHash("sha256").update(raw).digest("hex") };
  };
  return { name: "owned-daemon-abrupt-restart", status: "passed", limitation,
    derivedBefore, derivedAfter, frozenDerived: structuredClone(derivedAfter),
    derivedBeforeWire: wire(derivedBefore), derivedAfterWire: wire(derivedAfter), frozenDerivedWire: wire(derivedAfter),
    initialProfileEmpty: true, browserObserved: { userAgent: "Chrome/133", width: 1280, height: 900 },
    driverReadinessMode: "sync-exposure-poll-and-two-controller-dom-observations",
    contextStarted: "2026-10-14T00:00:00Z", contextFinished: "2026-10-14T00:01:00Z",
    sourceSnapshotBefore: { "web/package.json": digest }, sourceSnapshotAfter: { "web/package.json": digest },
    viewport: { width: 1280, height: 900 }, browser: "agent-browser 0.26.0",
    assetBefore: digest, assetAfter: digest, daemonPidBefore: 10, daemonPidAfter: 20,
    healthBefore: { daemon_id: "daemon", build_id: "build" }, healthAfter: { daemon_id: "daemon", build_id: "build" },
    abruptReturncode: "SIGKILL", detached: { selectedAbsent: true, credentialEmpty: true }, before, after, frozen,
    renderedBefore: { runId: "run", badge: "running", storage }, renderedAfter: { runId: "run", badge: "supervision lost uncertain", currentMetrics: false, text: "Last known runtime metrics\nLatest emitted metrics are retained as evidence. Elapsed time and epoch progress do not confirm that the runtime is still active.", storage },
    loss: { currentMetrics: false }, capture: { allLive: true, captured: 1, processes: [process], daemon: process },
    daemonProofBefore: process, daemonProofAfter: { ...process, pid: 20 },
    processCleanup: { taggedProcessesAbsent: true, cachedRuntimeProcessesAbsent: true },
    cleanup: { errors: [], daemonsReaped: true, browserClosed: true, servicesClosed: true, listenerClosed: true, rootsRemoved: true } };
}
test("complete structural record passes while raw SQL failure is not public authority", () => {
  const record = validRecord(); record.after.runs[0].state = "failed"; record.frozen.runs[0].state = "failed";
  assert.equal(verifyDaemonRestartRecord(record), true);
});
for (const [name, mutate] of [
  ["PID omitted", (r) => { delete r.daemonPidAfter; }],
  ["asset omitted", (r) => { delete r.assetBefore; delete r.assetAfter; }],
  ["old prefix altered", (r) => { r.after.eventHashes[0] = "b".repeat(64); }],
  ["unexpected resubmission", (r) => { r.frozen.controls[0].submission_requested = 2; }],
  ["inconclusive process cleanup", (r) => { r.processCleanup.taggedProcessesAbsent = false; }],
  ["unbounded chronology", (r) => { r.contextFinished = "2026-10-15T00:01:00Z"; }],
  ["public authority omitted", (r) => { delete r.derivedAfter; }],
  ["unproven live runtime", (r) => { r.capture.allLive = false; }],
  ["stale current metrics on lost connection", (r) => { r.loss.currentMetrics = true; }],
  ["missing lost connection observation", (r) => { delete r.loss; }],
  ["daemon argv tag mismatch", (r) => { r.daemonProofAfter.argv[r.daemonProofAfter.argv.indexOf("--tag") + 1] = "other"; }],
  ["runtime tag mismatch", (r) => { r.before.processFingerprints[0].tag = "other"; }],
  ["runtime escaped run root", (r) => { r.before.processFingerprints[0].cwd = "/tmp/foreign"; }],
  ["request lineage changed", (r) => { r.frozenDerived.request_id = "other"; }],
  ["last-known caption missing", (r) => { r.renderedAfter.text = r.renderedAfter.text.replace("Last known runtime metrics", "Metrics"); }],
  ["retained-evidence disclaimer missing", (r) => { r.renderedAfter.text = r.renderedAfter.text.replace("Latest emitted metrics are retained as evidence.", ""); }],
  ["active-runtime disclaimer missing", (r) => { r.renderedAfter.text = r.renderedAfter.text.replace("Elapsed time and epoch progress do not confirm that the runtime is still active.", ""); }],
  ["misleading current-runtime title", (r) => { r.renderedAfter.text += "Current runtime metrics"; }],
  ["restart fixture root changed", (r) => { r.daemonProofAfter.argv = [...r.daemonProofAfter.argv]; r.daemonProofAfter.argv[r.daemonProofAfter.argv.indexOf("--root") + 1] = "/foreign"; }],
  ["both roots changed without runtime binding", (r) => { for (const proof of [r.daemonProofBefore, r.daemonProofAfter]) { proof.argv = [...proof.argv]; proof.argv[proof.argv.indexOf("--root") + 1] = "/foreign"; } }],
  ["daemon working directory changed", (r) => { r.daemonProofAfter.cwd = "/foreign"; }],
  ["daemon ownership root changed", (r) => { r.daemonProofAfter.run_root = "/foreign"; }],
]) test(`rejects ${name}`, () => {
  const record = validRecord(); mutate(record); assert.throws(() => verifyDaemonRestartRecord(record));
});
test("rejects absent genuine evidence", () =>
  assert.throws(() =>
    verifyDaemonRestartRecord({ name: "owned-daemon-abrupt-restart", status: "passed" }),
  ));
test("rejects inflated claim", () =>
  assert.throws(() =>
    verifyDaemonRestartRecord({
      name: "owned-daemon-abrupt-restart",
      status: "passed",
      limitation: "T38 accepted",
    }),
  ));
const cli = fileURLToPath(new URL("./verify_daemon_restart_browser_report.mjs", import.meta.url));
test("CLI rejects missing report instead of quietly succeeding", () => {
  const result = spawnSync(process.execPath, [cli], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});
test("CLI rejects supplied failed report", async () => {
  const root = await mkdtemp(join(tmpdir(), "wavedl-restart-cli-"));
  const failed = join(root, "daemon-restart.json");
  try {
  await writeFile(failed, JSON.stringify({ name: "owned-daemon-abrupt-restart", status: "failed" }));
  const result = spawnSync(
    process.execPath,
    [cli, failed],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AssertionError|status|passed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("file guard rejects malformed UTF-8 evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "wavedl-restart-guard-"));
  const malformed = join(root, "malformed.json");
  try {
  await writeFile(malformed, Buffer.from([0xc3, 0x28]));
  await assert.rejects(verifyDaemonRestartFile(malformed));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("CI triggers, executes, verifies and uploads only the restart report", async () => {
  const workflow = await readFile(new URL("../.github/workflows/daemon-browser-integration.yml", import.meta.url), "utf8");
  for (const path of ["tools/daemon_restart_browser_fixture.py", "tools/run_daemon_restart_browser_acceptance.mjs", "tools/verify_daemon_restart_browser_report.mjs", "tools/verify_daemon_restart_browser_report.test.mjs", "unit_tests/test_daemon_restart_browser_fixture.py"])
    assert.equal(workflow.split(`- "${path}"`).length - 1, 2, "Both push and pull-request must trigger");
  assert(workflow.includes('run: node tools/run_daemon_restart_browser_acceptance.mjs "$TMPDIR/daemon-restart-browser"'));
  assert(workflow.includes('run: node tools/verify_daemon_restart_browser_report.mjs "$TMPDIR/daemon-restart-browser/daemon-restart.json"'));
  assert(workflow.includes('node --test tools/verify_daemon_restart_browser_report.test.mjs'));
  assert(workflow.includes('python -m pytest unit_tests/test_daemon_restart_browser_fixture.py -q'));
  const uploads = workflow.split(/(?=^      - )/m).filter(step =>
    /^        uses: actions\/upload-artifact@[^\s]+$/m.test(step));
  assert.equal(uploads.length, 1, "Exactly one acceptance artifact upload required");
  const upload = uploads[0];
  assert(upload.includes("${{ runner.temp }}/wavedl-browser-ci/daemon-restart-browser/daemon-restart.json"));
  assert(!upload.includes("daemon-restart-browser/**"), "Never upload private fixture roots");
});
