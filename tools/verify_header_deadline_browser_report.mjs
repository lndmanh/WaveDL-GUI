import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { boundedFile } from "./verify_retained_browser_report.mjs";
import { currentAssetDigest } from "./verify_adoption_negative_browser_report.mjs";

export function verifyHeaderDeadlineRecord(r) {
  assert.equal(r.name, "header-deadline"); assert.equal(r.status, "passed");
  for (const key of ["error", "skip", "skipped", "skipReason", "explicitFixtureWebAssets", "shutdownError", "failed", "failureStage", "failureDom", "retainedPrivateRoots"]) assert(!Object.hasOwn(r, key));
  assert.equal(r.driverReadinessMode, "sync-exposure-poll-and-two-controller-dom-observations");
  assert.match(r.browser, /agent-browser/); assert.equal(r.initialProfileEmpty, true);
  assert.match(r.browserObserved.userAgent, /Chrome\/[0-9]+/);
  for (const storage of [r.browserObserved, r.finalStorage]) {
    assert.equal(storage.cookies, ""); assert.deepEqual(storage.localStorageKeys, []); assert.deepEqual(storage.sessionStorageKeys, []);
  }
  assert.deepEqual(r.cleanup, { browserAbsent: true, fixtureReaped: true, servicesClosed: true, listenerClosed: true, childrenAbsent: true, ownedRemoved: true, errors: [] });
  const zero = Object.fromEntries(["plans", "plan_control", "execution_control", "submission_control", "runs", "runtime_provenance", "event_log"].map(k => [k, 0]));
  assert.deepEqual(r.before.counts, zero); assert.deepEqual(r.after, r.before);
  assert.deepEqual(Object.keys(r.before.sources).sort(), ["samples.h5", "samples.mat", "samples.npz"]);
  for (const item of Object.values(r.before.sources)) { assert(Number.isSafeInteger(item.size) && item.size > 0); assert.match(item.sha256, /^[a-f0-9]{64}$/); }
  assert.equal(r.recovery, "public-refresh-header-without-reconnect");
  assert.deepEqual(r.commands.map(c => c.controlled), [true, false]);
  const [stall, retry] = r.commands;
  for (const c of r.commands) {
    assert.equal(c.originalModule, "wavedl.core.dataset_headers"); assert.equal(c.authorityIdentityPresent, true);
    assert(Number.isSafeInteger(c.pid) && c.pid > 0); assert.equal(c.pidAbsent, true);
    assert.equal(c.descendantsSpawned, false);
    assert(Number.isFinite(c.deadline) && c.deadline > 0 && c.deadline <= 30);
    assert(Number.isFinite(c.elapsed) && c.elapsed > 0 && c.elapsed < 40);
    assert(Number.isSafeInteger(c.poolOutstandingBeforeReturn) && c.poolOutstandingBeforeReturn > 0);
    assert.equal(c.stderr, "");
  }
  assert.equal(stall.sequence, 1); assert.equal(retry.sequence, 2); assert.notEqual(stall.pid, retry.pid);
  assert.equal(stall.deadline, 2); assert(stall.elapsed >= stall.deadline); assert.equal(stall.timedOut, true);
  assert(Number.isInteger(stall.returncode) && stall.returncode < 0); assert(stall.elapsed < 10);
  assert.equal(stall.cancelled, true); assert.equal(stall.stdout, "owned-header-stall-child-ready\n");
  assert.equal(retry.returncode, 0); assert.equal(retry.timedOut, false); assert.equal(retry.cancelled, false); assert.equal(retry.deadline, 30);
  assert(r.http.length >= 2 && r.http.length <= 8);
  for (const h of r.http) {
    assert.equal(h.method, "POST");
    assert(["/api/datasets/inspect", "/api/browse/resolve", "/api/datasets/preview"].includes(h.endpoint));
    assert.equal(h.browser, true);
    assert(Number.isSafeInteger(h.poolOutstandingAfterResponse) && h.poolOutstandingAfterResponse >= 0);
    if (h.endpoint === "/api/datasets/inspect") assert.equal(h.poolOutstandingAfterResponse, 0);
    else { assert.equal(h.status, 200); assert.equal(h.response, null); }
  }
  const http = r.http.filter(h => h.endpoint === "/api/datasets/inspect"); assert.equal(http.length, 2);
  assert.equal(http[0].status, 422); assert.deepEqual(http[0].response, { error: "Invalid request" });
  assert.equal(http[1].status, 200);
  const metadata = JSON.parse(retry.stdout); assert.deepEqual(http[1].response, metadata);
  assert.deepEqual(metadata, { schema_version: 1, format: "npz", variables: [
    { name: "X", shape: [96, 32], dtype: "float32", sample_count: 96, declared_bytes: 12288 },
    { name: "y", shape: [96, 1], dtype: "float32", sample_count: 96, declared_bytes: 384 },
  ] });
  assert.equal(r.refusal.connected, true); assert.equal(r.retry.connected, true);
  assert.equal(r.refusal.header, false); assert.equal(r.refusal.dimensions, "");
  assert.deepEqual(r.refusal.fields, {});
  assert(r.refusal.alerts.some(a => a === "Dataset inspection refused or unavailable. Reconnect, select a supported dataset again, or retry its header inspection."));
  assert.equal(r.retry.header, true); assert(r.retry.dimensions.includes("96"));
  assert.deepEqual(r.retry.fields, { Format: "NPZ", Samples: "96", "File size": "Unknown", "Input key": "X", "Input shape": "32", "Input dtype": "float32", "Output key": "y", "Output shape": "1", "Output dtype": "float32" });
  assert(!r.retry.alerts.some(a => /refused|unavailable|invalid response/i.test(a)));
  assert.equal(r.limitation, "Fixture-controlled single child with reduced 2s command deadline, normal 30s pool; no descendants. Not parser-specific hang, default deadline, disconnect, Stop, capacity saturation, remote filesystem or Slurm certification.");
  assert.match(r.assetManifestSha256, /^[a-f0-9]{64}$/);
  return true;
}
export async function verifyHeaderDeadlineFile(path) {
  const r = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await boundedFile(path, 1048576)));
  verifyHeaderDeadlineRecord(r); assert.equal(r.assetManifestSha256, await currentAssetDigest()); return r;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) { await verifyHeaderDeadlineFile(process.argv[2]); console.log("HEADER deadline report: verified"); }
