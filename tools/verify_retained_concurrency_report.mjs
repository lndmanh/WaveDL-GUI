#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { boundedFile, verifySourceSnapshot } from "./verify_retained_browser_report.mjs";
import { injectedWorkboxInventory, validateAssetUrl } from "./build_retained_browser_fixtures.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const digest = (b) => createHash("sha256").update(b).digest("hex");
const sha = (s) => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
export const limitation = "Native-storage install concurrency: QA-scoped static-header/reference-routing native storage concurrency with bounded admission and simultaneous capacity refusal; Not ordinary UI-update concurrency, UI update consent, GC, or rollback proof.";

export async function verifyConcurrencyFixtures(summaryPath, repository = repo) {
  summaryPath = resolve(summaryPath);
  const summary = JSON.parse(await boundedFile(summaryPath));
  assert.equal(summary.schemaVersion, 1);
  assert.equal(summary.status, "passed");
  assert.equal(summary.sourceUnchanged, true);
  const before = JSON.parse(await boundedFile(join(dirname(summaryPath), "source-before.json")));
  assert.deepEqual(JSON.parse(await boundedFile(join(dirname(summaryPath), "source-after.json"))), before);
  assert.equal(summary.sourceTreeSha256, digest(JSON.stringify(before)));
  assert.equal(summary.sourceFileCount, Object.keys(before).length);
  await verifySourceSnapshot(before, repository);
  const ids = summary.sourceIdentifiers;
  for (const required of ["web/workstation/lib/build-identity.ts", "web/workstation/service-worker/retained-builds.ts", "web/workstation/service-worker/sw.ts", "tools/vendor_web_assets.py", "src/wavedl/__init__.py"]) assert(ids && Object.hasOwn(ids, required), "Missing source identity");
  for (const [path, hash] of Object.entries(ids)) { assert(sha(hash)); assert.equal(before[path], hash); }
  assert.deepEqual(summary.builds.map((b) => b.namespace), ["g1", "g2", "g3", "g4"]);
  for (const key of ["generation", "buildKey"]) assert.equal(new Set(summary.builds.map((b) => b[key])).size, 4);
  const builds = [];
  for (const build of summary.builds) {
    const dir = join(dirname(summaryPath), build.namespace, "src/wavedl_daemon/web_assets");
    assert.equal(build.assetsDir, dir);
    assert.equal(build.fixture, join(dirname(summaryPath), build.namespace));
    for (const key of ["generation", "buildKey", "workerSha256", "offlineInventorySha256"]) assert(sha(build[key]));
    const bytes = await boundedFile(join(dir, "offline-build.json"), 128 * 1024);
    assert.equal(digest(bytes), build.offlineInventorySha256);
    const inventory = JSON.parse(bytes);
    assert.equal(inventory.schema_version, 1);
    assert.equal(inventory.generation, build.generation);
    assert.equal(inventory.build_key, build.buildKey);
    assert(Array.isArray(inventory.assets) && inventory.assets.length > 0 && inventory.assets.length <= 128);
    assert.equal(inventory.assets.length, build.assetCount);
    assert.equal(new Set(inventory.assets.map((a) => a.url)).size, inventory.assets.length);
    let total = 0;
    let html;
    for (const asset of inventory.assets) {
      const path = validateAssetUrl(asset.url);
      assert(sha(asset.sha256) && Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= 8 * 1024 * 1024);
      assert.equal(typeof asset.immutable, "boolean");
      if (asset.immutable) assert(asset.url.startsWith(`/_nuxt/${build.namespace}/`));
      const content = await boundedFile(join(dir, path), 8 * 1024 * 1024);
      assert.equal(content.length, asset.size);
      assert.equal(digest(content), asset.sha256);
      total += content.length;
      if (asset.url === "/") html = content.toString("utf8");
    }
    assert(total <= 16 * 1024 * 1024);
    assert.equal(total, build.totalBytes);
    assert.equal(inventory.generation, digest(JSON.stringify(inventory.assets.map((a) => [a.url, a.sha256, a.size, a.immutable]))));
    const worker = await boundedFile(join(dir, "sw.js"), 8 * 1024 * 1024);
    assert.equal(digest(worker), build.workerSha256);
    const injected = injectedWorkboxInventory(worker.toString("utf8"));
    assert.equal(injected.buildKey, build.buildKey);
    assert.deepEqual(injected.entries.map((e) => e.url.startsWith("/") ? e.url : "/" + e.url).sort(), inventory.assets.map((a) => a.url).sort());
    const entries = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    assert(entries.length && entries.every((e) => e.startsWith(`/_nuxt/${build.namespace}/`) && inventory.assets.some((a) => a.url === e)));
    assert.deepEqual(entries, build.entryUrls);
    builds.push({ ...build, inventory, workerSize: worker.length, inventorySize: bytes.length });
  }
  return { summary, builds };
}

export function verifyStorage(storage, builds, pending = false) {
  assert.equal(storage.records.length, builds.length);
  assert(storage.records.length <= 3);
  assert(storage.records.reduce((s, r) => s + r.reservedBytes, 0) <= 64 * 1024 * 1024);
  assert.equal(new Set(storage.records.map((r) => r.owner)).size, builds.length);
  assert.equal(storage.cached.length, builds.length);
  assert.equal(new Set(storage.cached.map((c) => c.name)).size, builds.length);
  assert(storage.cacheNames.every((n) => n.startsWith("wavedl-retained-v1-")), "Foreign cache forbidden");
  assert.deepEqual(storage.cacheNames.filter((n) => n.startsWith("wavedl-retained-v1-")).sort(), storage.records.map((r) => r.cacheName).sort());
  for (const [index, b] of builds.entries()) {
    const r = storage.records.find((r) => r.inventory.generation === b.generation);
    assert(r, "Missing generation");
    assert.deepEqual(r.inventory, b.inventory);
    assert.match(r.owner, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    assert.equal(r.cacheName, `wavedl-retained-v1-${b.generation}-${r.owner}`);
    assert.equal(r.reservedBytes, b.totalBytes);
    assert.equal(r.status, pending && index > 0 ? "pending" : "ready");
    const cache = storage.cached.find((c) => c.name === r.cacheName);
    assert(cache);
    if (r.status === "ready") assert.deepEqual(cache.assets.map((a) => a.url).sort(), b.inventory.assets.map((a) => a.url).sort());
    for (const a of cache.assets) { const expected = b.inventory.assets.find((e) => e.url === a.url); assert(expected); assert.equal(a.sha256, expected.sha256); assert.equal(a.size, expected.size); }
  }
}

export function verifyConcurrencyReport(report, builds) {
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.status, "passed");
  assert.equal(report.limitation, limitation);
  assert.match(report.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  const used = builds.slice(0, 3);
  verifyStorage(report.warm, used.slice(0, 1));
  verifyStorage(report.pendingStorage, used, true);
  verifyStorage(report.final.storage, used);
  for (const snapshot of [report.pendingStorage, report.final.storage]) assert.deepEqual(snapshot.records.find((r) => r.inventory.generation === used[0].generation), report.warm.records[0], "Warm g1 ownership lost");
  const registrations = report.final.storage.registrations;
  assert.equal(registrations.length, 3);
  for (const path of ["/", "/qa/g2/", "/qa/g3/"]) { const r = registrations.find((r) => r.scope === report.origin + path); assert(r && r.active === "activated"); assert.equal(r.activeScript, report.origin + (path === "/" ? "/sw.js" : path + "sw.js")); assert(!r.installing && !r.waiting); }
  const p = report.pendingStatus;
  assert(report.initialStatus && report.initialStorage, "Initial refusal evidence missing");
  assert(["g2", "g3"].every((n) => report.initialStatus.inventorySeen.includes(n)));
  assert([1, 2].includes(report.initialStatus.barrierArrived.length), "Initial admission branch must hold one or both candidates");
  const winner = used.find((b) => b.namespace === report.initialStatus.barrierArrived[0]);
  const retry = used.find((b) => b.namespace !== "g1" && !report.initialStatus.barrierArrived.includes(b.namespace));
  assert(winner);
  if (report.initialStatus.barrierArrived.length === 1) {
    assert(retry && report.retry?.namespace === retry.namespace);
    assert(Number.isFinite(Date.parse(report.retry.started)) && Number.isFinite(Date.parse(report.retry.completed)));
    verifyStorage(report.initialStorage, [used[0], winner], true);
  } else {
    assert(!report.retry || report.retry.namespace === null);
    verifyStorage(report.initialStorage, used, true);
  }
  assert(report.initialPage.url === report.origin + "/");
  assert(Array.isArray(report.initialPage.registrations) && report.initialPage.registrations.some((r) => r.scope === report.origin + "/" && r.active === "activated"));
  assert(report.initialPage.registrations.some((r) => r.scope === report.origin + "/qa/g2/" || r.scope === report.origin + "/qa/g3/"), "Initial loser registration must be publicly observable");
  assert.equal(p.released, false);
  assert(["g2", "g3"].every((n) => p.inventorySeen.includes(n)));
  assert(p.inventorySeen.every((n) => ["g1", "g2", "g3"].includes(n)));
  assert.deepEqual(p.barrierArrived.sort(), ["g2", "g3"]);
  assert.equal(p.traceDropped, 0);
  const pendingFetches = p.trace.filter((t) => t.kind === "asset" && t.barrier);
  assert.equal(pendingFetches.length, 2);
  assert.deepEqual(pendingFetches.map((t) => t.namespace).sort(), ["g2", "g3"]);
  assert(pendingFetches.every((t) => t.status === "held" && t.endISO === null && Number.isFinite(Date.parse(t.startISO))));
  const f = report.final.status;
  assert.equal(f.released, true);
  assert.equal(f.traceDropped, 0);
  const held = f.trace.filter((t) => t.kind === "asset" && t.barrier);
  assert.equal(held.length, 2);
  assert.deepEqual(held.map((t) => t.namespace).sort(), ["g2", "g3"]);
  for (const t of held) { const old = pendingFetches.find((o) => o.namespace === t.namespace); assert.equal(t.startISO, old.startISO); assert.equal(t.path, old.path); assert.equal(t.status, 200); }
  assert(Math.max(...held.map((t) => Date.parse(t.startISO))) < Math.min(...held.map((t) => Date.parse(t.endISO))), "Candidate fetches must overlap");
  for (const b of used.slice(1)) {
    const worker = f.trace.filter((t) => t.namespace === b.namespace && t.kind === "worker");
    assert.equal(worker.length, b.namespace === retry?.namespace ? 2 : 1);
    for (const w of worker) {
      assert.equal(w.sha256, b.workerSha256);
      assert.equal(w.status, 200);
      assert.equal(w.path, `/qa/${b.namespace}/sw.js`);
      assert.equal(w.size, b.workerSize);
    }
    const inventory = f.trace.filter((t) => t.namespace === b.namespace && t.kind === "inventory");
    assert(inventory.length > 0);
    assert(inventory.every((t) => t.sha256 === b.offlineInventorySha256 && t.status === 200));
    assert(inventory.every((t) => t.path === "/offline-build.json" && t.size === b.inventorySize));
    for (const a of b.inventory.assets) { const found = f.trace.find((t) => t.namespace === b.namespace && t.kind === "asset" && t.path === a.url && t.status === 200); assert(found, "Missing real asset trace"); assert.equal(found.sha256, a.sha256); assert.equal(found.size, a.size); }
  }
  const capacity = report.capacity;
  assert(capacity && capacity.refusals?.length === 2, "Two simultaneous capacity refusals required");
  for (const refusal of capacity.refusals) {
    assert.equal(refusal.type, "WAVEDL_UPDATE_REFUSED");
    assert.equal(refusal.reason, "capacity");
    assert(["g4a", "g4b"].includes(refusal.role));
    assert.match(refusal.scriptURL, new RegExp(`${report.origin}/qa/${refusal.role}/sw\\.js$`));
  }
  assert.equal(capacity.scriptTrace?.length, 2, "Both exact g4 worker scripts must be traced");
  const g4 = builds.find((b) => b.namespace === "g4");
  assert(g4);
  for (const trace of capacity.scriptTrace) {
    assert(["/qa/g4a/sw.js", "/qa/g4b/sw.js"].includes(trace.path));
    assert.equal(trace.namespace, "g4");
    assert.equal(trace.sha256, g4.workerSha256);
    assert.equal(trace.size, g4.workerSize);
    assert.equal(trace.status, 200);
  }
  assert.deepEqual(capacity.postStorage, report.final.storage, "Capacity refusal changed retained storage");
  for (const key of ["browserClosed", "sessionAbsent", "fixtureClosed", "servicesClosed", "listenerRefused", "ownedRemoved"]) assert.equal(report.cleanup[key], true, `Cleanup ${key} unproven`);
  assert.equal(report.cleanup.fixtureExitCode, 0, "Fixture did not exit normally after SIGINT");
  return { status: "passed", scope: "native-storage-install-concurrency", limitation };
}

export async function verifyRetainedConcurrencyReport(reportPath, summaryPath, repository = repo) {
  const report = JSON.parse(await boundedFile(reportPath, 8 * 1024 * 1024));
  assert.equal(report.fixtureSummary, resolve(summaryPath));
  const { builds } = await verifyConcurrencyFixtures(summaryPath, repository);
  return verifyConcurrencyReport(report, builds);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyRetainedConcurrencyReport(process.argv[2], process.argv[3]).then((v) => console.log(JSON.stringify(v))).catch((e) => { console.error(`Concurrency evidence rejected: ${e.message}`); process.exitCode = 1; });
}
