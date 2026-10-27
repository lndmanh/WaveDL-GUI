import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { boundedFile } from "./browser_files.mjs";
import { packagedAssetHashes } from "./browser_training_fields_full.mjs";

export const limitation = "Controlled terminal numerical supervisor; genuine local submission, journal, owner ingestion, SQLite query_only/SQLITE_FULL, HTTP, SSE and native browser. Not native ENOSPC, filesystem permissions, ML training or site certification.";
const sha = /^[a-f0-9]{64}$/;
const packagedAssetCount = Object.keys(JSON.parse(readFileSync(new URL("../src/wavedl_daemon/web_assets/.wavedl-assets.json", import.meta.url), "utf8"))).length;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const digest = b => createHash("sha256").update(b).digest("hex");
function clean(value, path = "") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert(!/^(skip.*|failure|failed|retainedPrivateRoots|explicitFixtureWebAssets)$/i.test(key));
    if (key === "errors") assert.deepEqual(child, []);
    if (key === "error") assert(path.endsWith(".monitoring_errors.0") && child === "OperationalError");
    clean(child, `${path}.${key}`);
  }
}
export function verifyStorageFaultBrowserReport(r, expectedMode) {
  clean(r);
  assert.equal(r.status, "passed"); assert.equal(r.scope, "real-sqlite-storage-refusal");
  assert.equal(r.limitation, limitation); assert.equal(r.snapshots.length, 4);
  assert.equal(r.driverReadinessMode, "sync-exposure-poll-and-two-controller-dom-observations");
  assert.match(r.browser.version, /^agent-browser \d+\.\d+\.\d+/); assert.match(r.browser.userAgent, /Chrome\/\d+/);
  assert.match(r.assetPreflight.manifestSha256, sha); assert.equal(Object.keys(r.assetPreflight.assets).length, packagedAssetCount);
  for (const hash of Object.values(r.assetPreflight.assets)) assert.match(hash, sha);
  assert.deepEqual(r.assetPostflight, r.assetPreflight);
  const [before, refused, recovered, stable] = r.snapshots;
  const mode = Object.keys(before.cases)[0]; assert(["query_only", "page_quota"].includes(mode));
  if (expectedMode !== undefined) assert.equal(mode, expectedMode);
  let lastLaps = -1;
  for (const [phase, s] of r.snapshots.entries()) {
    assert.equal(s.phase, phase); assert.match(s.fixtureId, uuid); assert.equal(s.fixtureId, before.fixtureId);
    assert(Number.isSafeInteger(s.laps) && Number.isSafeInteger(s.phaseStartLaps));
    assert(s.phaseStartLaps >= lastLaps && s.laps >= s.phaseStartLaps + 3); lastLaps = s.laps;
    assert.equal(s.limitation, limitation); assert.equal(s.scope, "real-sqlite-storage-refusal");
    const c = Object.values(s.cases); assert.equal(c.length, 1);
    assert.deepEqual(Object.keys(s.cases), [mode]);
    assert.match(c[0].journalSha256, sha); assert.equal(c[0].cursors.length, 1);
    const x = c[0], raw = Buffer.from(x.journalHex, "hex");
    assert.equal(raw.toString("hex"), x.journalHex); assert(raw.length <= 131072); assert.equal(raw.at(-1), 10);
    assert.equal(digest(raw), x.journalSha256);
    const journal = raw.toString("utf8").trimEnd().split("\n").map(JSON.parse);
    assert.deepEqual(journal.map(e => e.type), phase === 0 ? ["hello"] : ["hello", "log", "exit"]);
    assert.equal(journal[0].payload.device,"cpu"); assert.deepEqual(journal[0].payload.capabilities,["train"]);
    if(phase){assert.deepEqual(journal[1].payload,{stream:"stdout",level:"info",message:"quota-growth:"+"x".repeat(60000)});assert.deepEqual(journal[2].payload,{status:"completed",code:0});}
    for (const [seq, e] of journal.entries()) { assert.equal(e.seq, seq); assert.equal(e.run_id, x.runId); assert.equal(e.attempt, 1); assert.equal(e.protocol, "wavedl-jsonl"); assert.equal(e.version, 1); }
    const accepted = phase < 2 ? [journal[0]] : journal;
    assert.deepEqual(x.events, accepted); assert.deepEqual(x.cursors, [[1, phase < 2 ? 0 : 2]]);
    assert.deepEqual(x.registry, { state: phase < 2 ? "running" : "completed", eventCount: accepted.length });
    assert.equal(x.bookmark.last_seq, x.cursors[0][1]); assert.equal(x.bookmark.offset, phase < 2 ? Buffer.from(Object.values(before.cases)[0].journalHex, "hex").length : raw.length);
    assert.equal(x.bookmark.private_owner, false); assert.equal(x.bookmark.historical_hello, false);
    assert.match(x.runId, uuid); assert.match(x.planId, uuid); assert.equal(x.view.run_id, x.runId); assert.equal(x.view.plan_id, x.planId);
    assert.equal(x.view.evidence.runtime.exit_seq, phase < 2 ? -1 : 2);
    assert.equal(x.view.evidence.confidence, phase < 2 ? "unconfirmed" : "confirmed");
    assert.deepEqual(s.health.monitoring_errors, phase === 1 ? [{source:x.planId,error:"OperationalError"}] : []);
    for (const key of ["dispatch_errors", "restart_monitoring_errors"]) assert.deepEqual(s.health[key], []);
    if (phase) { assert.equal(x.runId, Object.values(before.cases)[0].runId); assert.equal(x.planId, Object.values(before.cases)[0].planId); }
  }
  const b = Object.values(before.cases)[0], f = Object.values(refused.cases)[0], ok = Object.values(recovered.cases)[0], st = Object.values(stable.cases)[0];
  assert.deepEqual(f.cursors, b.cursors); assert.deepEqual(f.events, b.events); assert.equal(f.view.state, "terminal_unknown");
  assert.equal(f.view.uncertainty, true);
  assert.deepEqual(f.sqliteErrors, [{code:mode === "query_only" ? 8 : 13,name:mode === "query_only" ? "SQLITE_READONLY" : "SQLITE_FULL"}]);
  assert.deepEqual(b.sqliteErrors, []); assert.deepEqual(ok.sqliteErrors, f.sqliteErrors); assert.deepEqual(st.sqliteErrors, f.sqliteErrors);
  assert.equal(f.queryOnly, Number(mode === "query_only")); assert.equal(ok.queryOnly, 0);
  assert.equal(ok.maxPages, b.maxPages); assert.equal(st.maxPages, b.maxPages);
  if(mode === "page_quota") {assert.equal(f.maxPages, b.pageCount); assert.equal(f.pageCount, b.pageCount); assert(ok.pageCount > f.pageCount);}
  assert.deepEqual(f.bookmark, b.bookmark);
  assert.equal(ok.journalHex, f.journalHex); assert.equal(st.journalHex, f.journalHex);
  assert.equal(ok.view.state, "completed"); assert.equal(ok.view.uncertainty, false); assert.equal(ok.cursors[0][1], b.cursors[0][1] + 2);
  assert.deepEqual(st.cursors, ok.cursors); assert.deepEqual(st.events, ok.events); assert.equal(st.view.state, "completed");
  assert.equal(r.browserObservations.length, 8);
  for (const phase of [0,1,2,3]) for(const repeat of [0,1]) {
    const observations = r.browserObservations.filter(o => o.phase === phase && o.repeat === repeat); assert.equal(observations.length, 1);
    const o = observations[0]; assert.equal(o.fault, mode); assert.equal(o.runId, b.runId); assert.equal(o.badge, phase < 2 ? "terminal unknown · uncertain" : "completed"); assert.equal(o.uncertain, phase < 2); assert.equal(o.emptyMetrics, true);
  }
  assert.deepEqual(r.cleanup.errors, []); assert.equal(r.cleanup.browserSessionAbsent, true); assert.equal(r.cleanup.fixtureReaped, true);
  for(const key of ["servicesClosed","controlDrained","listenerClosed","rootRemoved","profileRemoved","tokenRemoved","workspaceRemoved"]) assert.equal(r.cleanup[key],true);
  assert((r.cleanup.fixtureExit.code===0&&r.cleanup.fixtureExit.signal===null)||(r.cleanup.fixtureExit.code===null&&r.cleanup.fixtureExit.signal==="SIGINT"));
  return true;
}
export async function verifyStorageFaultBrowserFile(path, expectedMode) {
  const r = JSON.parse(new TextDecoder("utf8",{fatal:true}).decode(await boundedFile(path,4*1024*1024)));
  verifyStorageFaultBrowserReport(r, expectedMode);
  if (expectedMode !== undefined) {
    assert(["query_only", "page_quota"].includes(expectedMode));
    assert.deepEqual(Object.keys(r.snapshots[0].cases), [expectedMode]);
  }
  assert.equal(r.assetPreflight.manifestSha256,digest(await boundedFile(fileURLToPath(new URL("../src/wavedl_daemon/web_assets/.wavedl-assets.json",import.meta.url)))));
  assert.deepEqual(r.assetPreflight.assets,await packagedAssetHashes(fileURLToPath(new URL("../",import.meta.url)))); return r;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv.length === 3 || process.argv.length === 4);
  await verifyStorageFaultBrowserFile(process.argv[2], process.argv[3]);
  console.log("Storage fault browser evidence verified");
}
