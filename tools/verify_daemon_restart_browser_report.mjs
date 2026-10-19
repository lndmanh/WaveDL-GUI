import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { currentAssetDigest } from "./verify_adoption_negative_browser_report.mjs";
import { boundedFile, verifySourceSnapshot } from "./verify_retained_browser_report.mjs";
const repository = fileURLToPath(new URL("../", import.meta.url));
export const limitation =
  "Real POSIX local CPU abrupt owned-daemon restart, same durable database identity and explicit browser reauthentication. No host reboot, escaping-session containment, PID-reuse simulation, GPU, Windows, remote or site certification; supplementary T30c/T38 evidence only.";
export function verifyDaemonRestartRecord(r) {
  assert(r && typeof r === "object" && !Array.isArray(r), "Object report required");
  assert.equal(r.name, "owned-daemon-abrupt-restart");
  assert.equal(r.status, "passed");
  assert.equal(r.limitation, limitation);
  assert(!r.error);
  assert.equal(r.abruptReturncode, "SIGKILL");
  assert.deepEqual(r.viewport, { width: 1280, height: 900 });
  const started = Date.parse(r.contextStarted), finished = Date.parse(r.contextFinished);
  assert(Number.isFinite(started) && Number.isFinite(finished) && finished > started,
    "Bounded run chronology required");
  assert(finished - started < 30 * 60 * 1000, "Restart evidence exceeds run budget");
  assert.deepEqual(r.sourceSnapshotBefore, r.sourceSnapshotAfter, "Producer sources changed");
  assert(r.sourceSnapshotBefore && Object.keys(r.sourceSnapshotBefore).length > 0);
  assert.equal(r.driverReadinessMode, "sync-exposure-poll-and-two-controller-dom-observations");
  assert.match(r.browser, /agent-browser/);
  assert.match(r.browser, /^agent-browser \d+\.\d+\.\d+$/);
  for (const pid of [r.daemonPidBefore, r.daemonPidAfter])
    assert(Number.isInteger(pid) && pid > 0, "Positive daemon PID required");
  for (const digest of [r.assetBefore, r.assetAfter])
    assert.match(digest, /^[a-f0-9]{64}$/, "Current asset digest required");
  assert.equal(r.assetBefore, r.assetAfter);
  assert.notEqual(r.daemonPidBefore, r.daemonPidAfter);
  assert.equal(r.healthBefore.daemon_id, r.healthAfter.daemon_id);
  assert.equal(r.healthBefore.build_id, r.healthAfter.build_id);
  for (const health of [r.healthBefore, r.healthAfter]) {
    assert(typeof health === "object" && health !== null);
    assert(typeof health.daemon_id === "string" && health.daemon_id.length > 0);
    assert(typeof health.build_id === "string" && health.build_id.length > 0);
  }
  assert.deepEqual(r.detached, { selectedAbsent: true, credentialEmpty: true });
  assert.equal(r.before.runId, r.after.runId);
  assert.equal(r.before.runId, r.frozen.runId);
  assert(typeof r.before.runId === "string" && r.before.runId.length > 0);
  assert.equal(r.before.runs[0].state, "running");
  // SQL is a telemetry projection and may transiently be FAILED after a
  // BrokenPipe; public authenticated HTTP is the authority for user state.
  for (const derived of [r.derivedBefore, r.derivedAfter, r.frozenDerived]) {
    assert(derived && typeof derived === "object");
    assert.equal(derived.run_id ?? derived.runId, r.before.runId);
  }
  assert.equal(r.derivedBefore.state, "running");
  assert.equal(r.derivedAfter.state, "supervision_lost");
  assert.equal(r.frozenDerived.state, "supervision_lost");
  assert.equal(r.derivedAfter.uncertainty, true);
  assert.equal(r.frozenDerived.uncertainty, true);
  for (const [wire, derived] of [[r.derivedBeforeWire, r.derivedBefore], [r.derivedAfterWire, r.derivedAfter], [r.frozenDerivedWire, r.frozenDerived]]) {
    assert.deepEqual(Object.keys(wire).sort(), ["bytes", "path", "raw", "sha256", "status"]);
    assert.equal(wire.path, `/api/runs/${r.before.runId}`);
    assert.equal(wire.status, 200);
    assert(typeof wire.raw === "string" && Buffer.byteLength(wire.raw) === wire.bytes);
    assert.match(wire.sha256, /^[a-f0-9]{64}$/);
    assert.equal(wire.sha256, createHash("sha256").update(wire.raw).digest("hex"));
    assert.deepEqual(JSON.parse(wire.raw), derived, "Derived HTTP object differs from response bytes");
    assert.equal(derived.attempt, 1);
    assert.equal(derived.backend, "local");
    assert.equal(derived.operation, "train");
    assert.equal(derived.submission_requested, true);
    assert.equal(derived.cancellation_requested, false);
    assert.equal(derived.plan_id, r.before.controls[0].plan_id);
    assert.equal(derived.request_id, r.derivedBefore.request_id);
  }
  for (const derived of [r.derivedAfter, r.frozenDerived]) {
    assert.equal(derived.evidence.confidence, "unconfirmed");
    assert.equal(derived.evidence.backend.status, "supervision_lost");
    assert.match(derived.evidence.reason, /ownership.*lost|PID adoption is unsafe/i);
  }
  for (const a of [r.before, r.after, r.frozen]) {
    assert.equal(a.plans, 1);
    assert.equal(a.executions, 1);
    assert.equal(a.runs.length, 1);
    assert.equal(a.journalMatches, true);
    assert(a.metricSteps.length > 0);
    assert.equal(a.controls[0].submission_requested, 1);
    assert.equal(a.controls[0].cancellation_requested, 0);
    assert.equal(a.controls.length, 1);
    assert.equal(a.runs[0].run_id, r.before.runId);
    assert(Array.isArray(a.eventIds) && a.eventIds.length > 0);
    assert(Array.isArray(a.eventHashes) && a.eventHashes.length === a.eventIds.length);
    for (const hash of a.eventHashes) assert.match(hash, /^[a-f0-9]{64}$/);
    assert.deepEqual(a.cursors, [a.eventIds.at(-1)], "Cursor must match committed journal head");
    for (let i = 0; i < a.eventIds.length; i++) {
      const [attempt, seq] = a.eventIds[i];
      assert.equal(attempt, 1);
      assert.equal(seq, i);
    }
  }
  assert.deepEqual(r.before.controls, r.after.controls);
  assert.deepEqual(r.after.controls, r.frozen.controls);
  for (const [before, after] of [[r.before, r.after], [r.after, r.frozen]]) {
    assert.deepEqual(after.eventIds.slice(0, before.eventIds.length), before.eventIds);
    assert.deepEqual(after.eventHashes.slice(0, before.eventHashes.length), before.eventHashes,
      "Committed old journal prefix changed");
    assert.deepEqual(after.metricSteps.slice(0, before.metricSteps.length), before.metricSteps);
    assert.deepEqual(after.requests.slice(0, before.requests.length), before.requests,
      "Request lineage prefix changed");
  }
  assert.deepEqual(r.before.processFingerprints, r.after.processFingerprints);
  assert.deepEqual(r.after.processFingerprints, r.frozen.processFingerprints);
  assert(Array.isArray(r.before.processFingerprints) && r.before.processFingerprints.length > 0);
  for (const fingerprint of r.before.processFingerprints) {
    assert(Number.isInteger(fingerprint.pid) && fingerprint.pid > 0);
    assert(typeof fingerprint.create_time === "number" && Number.isFinite(fingerprint.create_time));
    assert(Array.isArray(fingerprint.argv) && fingerprint.argv.length > 0);
    assert(typeof fingerprint.cwd === "string" && typeof fingerprint.run_root === "string");
    assert(typeof fingerprint.tag === "string" && fingerprint.tag.length > 0);
  }
  assert.equal(r.renderedBefore.runId, r.before.runId);
  assert.equal(r.renderedBefore.badge, "running");
  assert.equal(r.loss.currentMetrics, false, "Disconnected runtime must not expose current metrics");
  assert.equal(r.renderedAfter.runId, r.before.runId);
  assert.match(r.renderedAfter.badge, /supervision lost/);
  assert.match(r.renderedAfter.badge, /uncertain/);
  assert(typeof r.renderedAfter.text === "string" && r.renderedAfter.text.includes("Last known runtime metrics"),
    "Historical metrics must be explicitly labelled as last known evidence");
  assert(r.renderedAfter.text.includes("Latest emitted metrics are retained as evidence."),
    "Historical metrics disclaimer must be visible after reconnect");
  assert(r.renderedAfter.text.includes("Elapsed time and epoch progress do not confirm that the runtime is still active."),
    "Elapsed time and progress must not imply active supervision");
  assert(!r.renderedAfter.text.includes("Current runtime metrics"),
    "Lost supervision must not present a current-runtime metrics title");
  let previousCursor = -1;
  for (const observation of [r.renderedBefore, r.loss, r.renderedAfter]) {
    const storage = observation.storage;
    assert.deepEqual(Object.keys(storage).sort(), ["cookies", "entries", "local", "session", "valid"]);
    assert.equal(storage.cookies, "");
    assert.equal(storage.session, 0);
    assert.equal(storage.valid, true, "Only the exact scoped replay cursor may persist");
    assert(Number.isSafeInteger(storage.local) && storage.local >= 0 && storage.local <= 1);
    if (previousCursor >= 0) assert.equal(storage.local, 1, "Disconnect must not erase the persisted cursor");
    assert.equal(storage.entries.length, storage.local);
    for (const entry of storage.entries) {
      assert.deepEqual(Object.keys(entry).sort(), ["cursor", "key"]);
      assert.equal(entry.key, `wavedl:cursor:v1:${encodeURIComponent(r.healthBefore.daemon_id)}:${encodeURIComponent(r.before.runId)}`);
      assert.deepEqual(Object.keys(entry.cursor).sort(), ["attempt", "seq"]);
      assert.equal(entry.cursor.attempt, 1);
      assert(Number.isSafeInteger(entry.cursor.seq) && entry.cursor.seq >= previousCursor);
      assert(r.frozen.eventIds.some(([attempt, seq]) => attempt === entry.cursor.attempt && seq === entry.cursor.seq), "Persisted cursor must identify a committed journal event");
      previousCursor = entry.cursor.seq;
    }
  }
  assert.equal(r.renderedAfter.storage.local, 1, "Reconnected replay must persist its scoped cursor");
  assert(r.frozen.requests.length > 0);
  assert(r.frozen.requests.every((q) => ["GET", "POST"].includes(q.method)));
  assert(!r.frozen.requests.some((q) => q.method === "POST" && q.path !== "/api/bootstrap"));
  for (const q of r.frozen.requests) {
    assert(typeof q.path === "string" && /^\/api\//.test(q.path));
    assert([200, 401].includes(q.status), "Unexpected real API status");
    assert(q.cursor && typeof q.cursor === "object" && !Array.isArray(q.cursor));
    for (const [key, value] of Object.entries(q.cursor))
      assert(["attempt", "seq"].includes(key) && Number.isInteger(value));
  }
  assert(r.frozen.requests.some(q => q.path === "/api/health" && q.status === 200));
  assert(r.frozen.requests.some(q => q.path === "/api/bootstrap" && q.method === "POST"));
  assert.equal(r.processCleanup.taggedProcessesAbsent, true);
  assert.equal(r.processCleanup.cachedRuntimeProcessesAbsent, true);
  assert.equal(r.initialProfileEmpty, true);
  assert.match(r.browserObserved.userAgent, /(?:Headless)?Chrome\/\d+/);
  assert.equal(r.browserObserved.width, 1280);
  assert.equal(r.browserObserved.height, 900);
  assert.equal(r.capture.allLive, true);
  assert.equal(r.capture.captured, r.capture.processes.length);
  assert.deepEqual(r.capture.processes, r.before.processFingerprints);
  assert.deepEqual(r.capture.daemon, r.daemonProofBefore);
  assert.equal(r.daemonProofBefore.pid, r.daemonPidBefore);
  assert.equal(r.daemonProofAfter.pid, r.daemonPidAfter);
  const fixtureRoot = r.daemonProofBefore.argv[r.daemonProofBefore.argv.indexOf("--root") + 1];
  assert(typeof fixtureRoot === "string" && fixtureRoot.length > 0);
  for (const proof of [r.daemonProofBefore, r.daemonProofAfter]) {
    assert(proof.create_time > 0 && typeof proof.tag === "string" && proof.tag.length > 0);
    assert(Array.isArray(proof.argv) && proof.argv.includes("--root") && proof.argv.includes("--tag"));
    const rootIndex = proof.argv.indexOf("--root");
    const tagIndex = proof.argv.indexOf("--tag");
    assert(rootIndex + 1 < proof.argv.length && tagIndex + 1 < proof.argv.length);
    assert.equal(proof.argv[tagIndex + 1], proof.tag, "Daemon argv tag must match its environment tag");
    assert(typeof proof.argv[rootIndex + 1] === "string" && proof.argv[rootIndex + 1].length > 0,
      "Daemon argv must carry a private fixture root");
    assert.equal(resolve(proof.argv[rootIndex + 1]), resolve(fixtureRoot),
      "Restart must reopen the same owned fixture root");
    assert.equal(proof.cwd, r.daemonProofBefore.cwd, "Daemon cwd must remain unchanged");
    assert.equal(proof.run_root, r.daemonProofBefore.run_root, "Daemon ownership root must remain unchanged");
    assert.equal(proof.argv[tagIndex + 1], r.daemonProofBefore.tag,
      "Restart daemons must share one ownership tag");
  }
  for (const proof of r.before.processFingerprints) {
    assert.equal(proof.tag, r.daemonProofBefore.tag, "Runtime fingerprint tag must match daemon tag");
    assert.equal(resolve(proof.run_root), join(resolve(fixtureRoot), "runs"),
      "Runtime fingerprint must belong to the daemon fixture root");
    assert.equal(resolve(proof.cwd), join(resolve(fixtureRoot), "runs", r.before.runId),
      "Runtime cwd must belong to the captured run");
  }
  for (const derived of [r.derivedBefore, r.derivedAfter, r.frozenDerived])
    assert.equal(derived.request_id, r.derivedBefore.request_id,
      "Wire request lineage must remain stable across restart projections");
  assert.deepEqual(r.cleanup, {
    errors: [],
    daemonsReaped: true,
    browserClosed: true,
    servicesClosed: true,
    listenerClosed: true,
    rootsRemoved: true,
  });
  return true;
}

/** Verify a report as a bounded, immutable UTF-8 evidence file. */
export async function verifyDaemonRestartFile(path) {
  assert(typeof path === "string" && path.length > 0, "Report path required");
  const bytes = await boundedFile(path, 2 * 1024 * 1024);
  const report = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  verifyDaemonRestartRecord(report);
  const current = await currentAssetDigest();
  assert.equal(report.assetBefore, current, "Report does not reference current packaged assets");
  assert.equal(report.assetAfter, current, "Asset inventory changed during acceptance");
  await verifySourceSnapshot(report.sourceSnapshotBefore, repository);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: node verify_daemon_restart_browser_report.mjs <report.json>");
  await verifyDaemonRestartFile(path);
  console.log("daemon restart browser report: verified");
}
