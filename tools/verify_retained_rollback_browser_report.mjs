#!/usr/bin/env node
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { boundedFile } from "./verify_retained_browser_report.mjs";
import { verifyConcurrencyFixtures, verifyStorage } from "./verify_retained_concurrency_report.mjs";

export const rollbackLimitation =
  "Native CacheStorage/IndexedDB installation rollback after injected HTTP 503: exact genuine QA-scoped worker and inventory, not ordinary UI update approval, quota exhaustion, browser crash, or GC proof.";

export function verifyRollbackReport(report, builds) {
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.mode, "native-storage-install-rollback");
  assert.equal(report.status, "passed");
  assert.equal(report.limitation, rollbackLimitation);
  assert.match(report.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.match(report.browser, /agent-browser/);
  const old = builds[0],
    failed = builds[3];
  verifyStorage(report.warm, [old]);
  verifyStorage(report.pending, [old, failed], true);
  verifyStorage(report.after, [old]);
  const oldPending = report.pending.records.find((r) => r.inventory.generation === old.generation);
  assert.deepEqual(oldPending, report.warm.records[0], "Warm ownership changed during install");
  assert.deepEqual(
    report.after,
    report.warm,
    "Old durable storage/registration changed after failure",
  );
  assert.deepEqual(
    report.pending.cached.find((c) => c.name === oldPending.cacheName),
    report.warm.cached[0],
  );
  const candidate = report.pending.records.find(
    (r) => r.inventory.generation === failed.generation,
  );
  const partial = report.pending.cached.find((c) => c.name === candidate.cacheName);
  assert.equal(partial.assets.length, 1, "Native partial cache.put evidence missing");
  assert.equal(partial.assets[0].url, failed.inventory.assets[0].url);
  assert.equal(report.failureAsset, failed.inventory.assets[1].url);
  assert.equal(report.terminal.state, "redundant");
  assert(
    report.terminal.states.includes("installing") && report.terminal.states.includes("redundant"),
  );
  assert(
    report.terminal.states.every((s) => s === "installing" || s === "redundant"),
    "Failed worker progressed beyond install",
  );
  assert.equal(report.terminal.scriptURL, report.origin + "/qa/g4a/sw.js");
  assert.equal(report.refusal.type, "WAVEDL_UPDATE_REFUSED");
  assert.equal(report.refusal.reason, "verification");
  assert.equal(report.refusal.scriptURL, report.terminal.scriptURL);
  assert.deepEqual(report.pageAfter, report.pageBefore, "Warm page reloaded or controller changed");
  assert.equal(report.pageBefore.controller, report.origin + "/sw.js");
  assert(
    report.pageBefore.entries.some((url) => old.entryUrls.includes(url)),
    "Warm genuine application entry missing",
  );
  assert.equal(report.warm.registrations.length, 1);
  assert.equal(report.warm.registrations[0].active, "activated");
  assert.equal(report.warm.registrations[0].scope, report.origin + "/");
  const registration = report.pending.registrations.find(
    (r) => r.scope === report.origin + "/qa/g4a/",
  );
  assert(
    registration &&
      registration.installing === "installing" &&
      !registration.active &&
      !registration.waiting,
  );
  assert.equal(report.trace.traceDropped, 0);
  const worker = report.trace.trace.filter((t) => t.kind === "worker" && t.namespace === "g4");
  assert.equal(worker.length, 1);
  assert.equal(worker[0].path, "/qa/g4a/sw.js");
  assert.equal(worker[0].sha256, failed.workerSha256);
  assert.equal(worker[0].size, failed.workerSize);
  assert.equal(worker[0].status, 200);
  const inventory = report.trace.trace.filter(
    (t) => t.kind === "inventory" && t.namespace === "g4",
  );
  assert.equal(inventory.length, 1);
  assert.equal(inventory[0].path, "/offline-build.json");
  assert.equal(inventory[0].sha256, failed.offlineInventorySha256);
  assert.equal(inventory[0].size, failed.inventorySize);
  assert.equal(inventory[0].status, 200);
  const assets = report.trace.trace.filter((t) => t.kind === "asset" && t.namespace === "g4");
  assert.equal(assets.length, 2);
  const first = assets.find((t) => t.path === failed.inventory.assets[0].url);
  assert(first && first.status === 200);
  assert.equal(first.sha256, failed.inventory.assets[0].sha256);
  assert.equal(first.size, failed.inventory.assets[0].size);
  const fault = assets.find((t) => t.path === report.failureAsset);
  assert(fault && fault.injected === "http-503" && fault.status === 503);
  assert.equal(fault.sha256, null);
  assert.equal(fault.size, 0);
  assert(
    Number.isFinite(Date.parse(fault.startISO)) &&
      Date.parse(fault.endISO) > Date.parse(fault.startISO),
  );
  assert(Date.parse(first.endISO) <= Date.parse(fault.startISO));
  const held = report.heldTrace.trace.find((t) => t.injected === "http-503");
  assert(held && held.status === "held" && held.endISO === null);
  assert.equal(held.startISO, fault.startISO);
  assert.equal(held.path, fault.path);
  for (const key of [
    "browserClosed",
    "sessionAbsent",
    "fixtureClosed",
    "servicesClosed",
    "listenerRefused",
    "ownedRemoved",
  ])
    assert.equal(report.cleanup[key], true, `Cleanup ${key} unproven`);
  assert.equal(report.cleanup.fixtureExitCode, 0);
  return { status: "passed", scope: report.mode, limitation: rollbackLimitation };
}

export async function verifyRetainedRollbackReport(reportPath, summaryPath, repository) {
  const report = JSON.parse(await boundedFile(reportPath, 8 * 1024 * 1024));
  assert.equal(report.fixtureSummary, resolve(summaryPath));
  const { builds } = await verifyConcurrencyFixtures(summaryPath, repository);
  return verifyRollbackReport(report, builds);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyRetainedRollbackReport(process.argv[2], process.argv[3])
    .then((v) => console.log(JSON.stringify(v)))
    .catch((e) => {
      console.error(`Rollback evidence rejected: ${e.message}`);
      process.exitCode = 1;
    });
}
