// Read-only consistency guard; a JSON record is not independent browser proof.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { boundedFile } from "./browser_files.mjs";
import { currentMappedAssets } from "./verify_mapped_autoplot_browser_report.mjs";
import { parseHostileOriginJSON } from "./verify_hostile_origin_browser_report.mjs";

export const scope = "real-browser-genuine-broker-overflow-historical-rollover";
const packagedAssetCount = Object.keys(JSON.parse(readFileSync(new URL("../src/wavedl_daemon/web_assets/.wavedl-assets.json", import.meta.url), "utf8"))).length;
export const limitation = "Controlled journal-ingestion timing and first-subscriber capacity; two genuine completed CPU launcher attempts initially adopted at attempt 2. Historical replay crosses attempt 1 to 2, not live allocation or Slurm requeue. Cursor observed through the next authenticated browser request only; no private storage, browser chunk-boundary, GPU, site or full T30c claim.";
const keys = (v, names) => {
  assert(v && typeof v === "object" && !Array.isArray(v));
  assert.deepEqual(Object.keys(v).sort(), [...names].sort());
};
const count = (n, min = 0, max = Number.MAX_SAFE_INTEGER) => assert(Number.isSafeInteger(n) && n >= min && n <= max);
const sha = (s) => assert.match(s, /^[a-f0-9]{64}$/);
const uuid = (s) => assert.match(s, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
function assets(v) {
  keys(v, ["manifestSha256", "files"]); sha(v.manifestSha256);
  assert.equal(Object.keys(v.files).length, packagedAssetCount);
  for (const [name, file] of Object.entries(v.files)) {
    assert(!name.startsWith("/") && name.split("/").every(p => p && p !== "." && p !== ".."));
    keys(file, ["size", "sha256"]); count(file.size, 1, 16 * 1024 * 1024); sha(file.sha256);
  }
}
export function verifyGenuineBrokerOverflowReport(r) {
  keys(r, ["status", "scope", "limitation", "driverReadinessMode", "browser", "identity", "assetsBefore", "assetsAfter", "boundary", "authority", "rendered", "localCursor", "cleanup", "retainedWorkspace"]);
  assert.equal(r.status, "passed"); assert.equal(r.scope, scope); assert.equal(r.limitation, limitation);
  assert.equal(r.driverReadinessMode, "sync-exposure-poll-and-two-controller-dom-observations");
  keys(r.browser, ["version", "userAgent", "freshProfile"]);
  assert.equal(r.browser.version, "agent-browser 0.26.0"); assert.match(r.browser.userAgent, /Chrome\/\d+/); assert.equal(r.browser.freshProfile, true);
  keys(r.identity, ["runId", "requestId", "planId", "attempt", "daemonId", "buildId"]);
  for (const k of ["runId", "requestId", "planId"]) uuid(r.identity[k]);
  sha(r.identity.daemonId); assert.equal(r.identity.buildId, "1.8.1"); assert.equal(r.identity.attempt, 2);
  assets(r.assetsBefore); assets(r.assetsAfter); assert.deepEqual(r.assetsBefore, r.assetsAfter);
  assert.equal(r.localCursor, null); assert.equal(r.retainedWorkspace, null);
  keys(r.authority, ["runId", "journalIds", "cursors", "journalMatches", "metricCount"]);
  assert.equal(r.authority.runId, r.identity.runId); assert.equal(r.authority.journalMatches, true);
  keys(r.authority.cursors, ["1", "2"]); count(r.authority.metricCount, 1, 999);
  const ids = r.authority.journalIds;
  assert(Array.isArray(ids) && ids.length >= 6 && ids.length < 1000);
  let previous = [1, -1];
  for (const id of ids) {
    assert(Array.isArray(id) && id.length === 2); count(id[0], 1, 2); count(id[1]);
    if (id[0] === previous[0]) assert.equal(id[1], previous[1] + 1);
    else { assert.equal(previous[0], 1); assert.equal(id[0], 2); assert.equal(id[1], 0); }
    previous = id;
  }
  for (const n of [1, 2]) assert.equal(r.authority.cursors[n], ids.filter(id => id[0] === n).at(-1)?.[1]);
  keys(r.boundary, ["scope", "records", "queueFull"]); assert.equal(r.boundary.scope, "genuine-broker-capacity-overflow");
  assert.deepEqual(r.boundary.queueFull, {capacity: 1, sizeBefore: 1, fullBefore: true, memberBefore: true, closedBefore: false, overflowedBefore: false, closedAfter: true, overflowedAfter: true, memberAfter: false});
  assert(Array.isArray(r.boundary.records) && r.boundary.records.length === 2);
  for (const [i, record] of r.boundary.records.entries()) {
    keys(record, ["path", "cursor", "authenticated", "scoped", "browser", "status", "forwardedIds", "overflowResume", "gate", "bytes"]);
    assert.equal(record.path, `/api/runs/${r.identity.runId}/events`); assert.equal(record.status, 200);
    for (const k of ["authenticated", "scoped", "browser"]) assert.equal(record[k], true);
    count(record.bytes, 1, 16 * 1024 * 1024);
    assert.deepEqual(record.cursor, i ? {attempt: 1, seq: 0} : {attempt: 0, seq: -1});
    assert.deepEqual(record.overflowResume, i ? null : {attempt: 1, seq: 0});
    assert.equal(record.gate, i ? null : "original-first-frame-forwarded-generator-paused");
  }
  assert.deepEqual(r.boundary.records[0].forwardedIds, [[1, 0]]);
  assert.deepEqual(r.boundary.records.flatMap(x => x.forwardedIds), ids);
  keys(r.rendered, ["selectedRun", "diagnosticIds", "historyCanvas", "historySteps", "truncated"]);
  assert.equal(r.rendered.selectedRun, r.identity.runId); assert.equal(r.rendered.historyCanvas, true);
  count(r.rendered.historySteps, 1); assert.equal(r.rendered.historySteps, r.authority.metricCount); assert.equal(r.rendered.truncated, false);
  assert.deepEqual(r.rendered.diagnosticIds, ids, "Public DOM must render every journal event exactly once in order");
  assert.deepEqual(r.cleanup, {browserClosed: true, fixtureReaped: true, servicesClosed: true, listenerClosed: true, tokenRemoved: true, profileRemoved: true, ownedRootsRemoved: true});
  return true;
}
export async function verifyGenuineBrokerOverflowFile(path) {
  const r = parseHostileOriginJSON(await boundedFile(path, 2 * 1024 * 1024));
  verifyGenuineBrokerOverflowReport(r);
  assert.deepEqual(r.assetsBefore, await currentMappedAssets(), "Not current complete packaged assets");
  return r;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv[2], "Provide the dedicated genuine overflow JSON report");
  await verifyGenuineBrokerOverflowFile(process.argv[2]);
  process.stdout.write("Genuine broker overflow browser evidence verified\n");
}
