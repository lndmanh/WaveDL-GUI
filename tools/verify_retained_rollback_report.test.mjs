import assert from "node:assert/strict";
import test from "node:test";
import { limitation, verifyRetainedRollbackReport } from "./verify_retained_rollback_report.mjs";
import { runRetainedRollbackGate } from "./run_retained_rollback_gate.mjs";

test("rollback gate proves failed-owner-only cleanup and preserves foreign cache", () => {
  const report = runRetainedRollbackGate();
  assert.equal(verifyRetainedRollbackReport(report).status, "passed");
  assert.equal(report.nativeProof, undefined);
  assert.match(limitation, /not native browser/i);
});

for (const [label, mutate] of [
  ["foreign deletion", (report) => { report.foreignCacheDeleted = true; }],
  ["failed owner retained", (report) => { report.after.records.push(report.before.records[2]); }],
  ["foreign cache removed", (report) => { report.after.cacheNames = report.after.cacheNames.filter((name) => name !== report.foreignCacheName); }],
  ["second cache deleted", (report) => { report.deletedCacheNames.push(report.before.records[0].cacheName); }],
]) test(`rejects ${label}`, () => {
  const report = runRetainedRollbackGate();
  mutate(report);
  assert.throws(() => verifyRetainedRollbackReport(report));
});
