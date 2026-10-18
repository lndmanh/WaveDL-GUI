import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { currentMappedAssets } from "./verify_mapped_autoplot_browser_report.mjs";
import { scope, limitation, verifyGenuineBrokerOverflowReport, verifyGenuineBrokerOverflowFile } from "./verify_genuine_broker_overflow_browser_report.mjs";

const runId = "00000000-0000-4000-8000-000000000001";
const packagedAssetCount = Object.keys((await currentMappedAssets()).files).length;
function valid() {
  const ids = [[1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]];
  const assets = {manifestSha256: "a".repeat(64), files: Object.fromEntries(Array.from({length: packagedAssetCount}, (_, n) => [`asset${n}`, {size: 1, sha256: "b".repeat(64)}]))};
  const record = {path: `/api/runs/${runId}/events`, cursor: {attempt: 0, seq: -1}, authenticated: true, scoped: true, browser: true, status: 200, forwardedIds: [[1, 0]], overflowResume: {attempt: 1, seq: 0}, gate: "original-first-frame-forwarded-generator-paused", bytes: 200};
  return {status: "passed", scope, limitation, driverReadinessMode: "sync-exposure-poll-and-two-controller-dom-observations", browser: {version: "agent-browser 0.26.0", userAgent: "Chrome/149.0", freshProfile: true}, identity: {runId, requestId: "00000000-0000-4000-8000-000000000002", planId: "00000000-0000-4000-8000-000000000003", attempt: 2, daemonId: "c".repeat(64), buildId: "1.8.1"}, assetsBefore: assets, assetsAfter: structuredClone(assets), boundary: {scope: "genuine-broker-capacity-overflow", records: [record, {...record, cursor: {attempt: 1, seq: 0}, forwardedIds: ids.slice(1), overflowResume: null, gate: null}], queueFull: {capacity: 1, sizeBefore: 1, fullBefore: true, memberBefore: true, closedBefore: false, overflowedBefore: false, closedAfter: true, overflowedAfter: true, memberAfter: false}}, authority: {runId, journalIds: ids, cursors: {1: 2, 2: 2}, journalMatches: true, metricCount: 1}, rendered: {selectedRun: runId, diagnosticIds: ids, historyCanvas: true, historySteps: 1, truncated: false}, localCursor: null, retainedWorkspace: null, cleanup: {browserClosed: true, fixtureReaped: true, servicesClosed: true, listenerClosed: true, tokenRemoved: true, profileRemoved: true, ownedRootsRemoved: true}};
}
test("accepts complete genuine-overflow report shape", () => assert.equal(verifyGenuineBrokerOverflowReport(valid()), true));
for (const [name, change] of [
  ["fake overflow", r => r.boundary.queueFull.fullBefore = false],
  ["already closed subscriber", r => r.boundary.queueFull.closedBefore = true],
  ["no membership", r => r.boundary.queueFull.memberBefore = false],
  ["wrong control cursor", r => r.boundary.records[0].overflowResume.seq = 1],
  ["wrong reconnect cursor", r => r.boundary.records[1].cursor.seq = 1],
  ["third connection", r => r.boundary.records.push(r.boundary.records[1])],
  ["missing request authentication", r => r.boundary.records[1].authenticated = false],
  ["foreign request path", r => r.boundary.records[1].path += "?case=test"],
  ["duplicate rendering", r => r.rendered.diagnosticIds = [...r.authority.journalIds, [2, 2]]],
  ["missing rendering", r => r.rendered.diagnosticIds = r.authority.journalIds.slice(1)],
  ["wrong durable cursor", r => r.authority.cursors[2] = 1],
  ["journal disagreement", r => r.authority.journalMatches = false],
  ["unknown field", r => r.token = "private"],
  ["unknown nested field", r => r.boundary.records[0].headers = {}],
  ["incomplete assets", r => delete r.assetsBefore.files.asset1],
  ["retained profile", r => r.cleanup.profileRemoved = false],
  ["overclaim", r => r.limitation = "full T30c passed"],
  ["private cursor claim", r => r.localCursor = {attempt: 2, seq: 2}],
  ["bad daemon identity", r => r.identity.daemonId = runId],
]) test(`rejects ${name}`, () => { const r = valid(); change(r); assert.throws(() => verifyGenuineBrokerOverflowReport(r)); });
test("file guard verifies exact current assets and rejects duplicate JSON keys", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "wavedl-overflow-verifier-test-"));
  try {
    const path = join(root, "report.json"), r = valid();
    r.assetsBefore = await currentMappedAssets(); r.assetsAfter = structuredClone(r.assetsBefore);
    await writeFile(path, JSON.stringify(r)); await verifyGenuineBrokerOverflowFile(path);
    r.assetsBefore.manifestSha256 = "a".repeat(64); r.assetsAfter = structuredClone(r.assetsBefore);
    await writeFile(path, JSON.stringify(r)); await assert.rejects(verifyGenuineBrokerOverflowFile(path));
    await writeFile(path, '{"status":"passed","status":"passed"}'); await assert.rejects(verifyGenuineBrokerOverflowFile(path));
  } finally { await rm(root, {recursive: true}); }
});
