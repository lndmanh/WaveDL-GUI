#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { boundedFile } from "./verify_retained_browser_report.mjs";

export const coldOfflineLimitation =
  "Owned Chrome cold-process restart with the real daemon stopped and Chromium offline. Current packaged shell/deep-link routing and authority refusal only; no browser installation UI, client-update takeover, remote-site or OS/GPU certification.";

export function verifyColdOfflineRecord(record, inventory) {
  assert.equal(record.name, "cold-offline-browser");
  assert.equal(record.status, "passed");
  for (const field of ["error", "skip", "skipped", "skipReason", "retainedPrivateRoots"])
    assert(!Object.hasOwn(record, field));
  assert.equal(record.limitation, coldOfflineLimitation);
  assert.equal(record.initialProfileEmpty, true);
  assert.match(record.assetManifestSha256, /^[a-f0-9]{64}$/);
  assert.match(record.browser, /^agent-browser 0\.26\.0/);
  assert.match(record.online.userAgent, /Chrome\/\d+/);
  assert.equal(record.online.bootstrapRemoved, true);
  assert.equal(record.online.connected, true);
  assert.equal(record.online.controller, record.origin + "/sw.js");
  assert.equal(record.daemonStoppedBeforeRestart, true);
  assert.equal(record.firstBrowserClosed, true);
  assert.equal(record.coldStart.controller, record.origin + "/sw.js");
  assert.equal(record.coldStart.shell, true);
  assert(record.coldStart.timeOrigin > record.online.timeOrigin);
  assert(record.coldStart.navigationWorkerStart > 0);
  assert.deepEqual(record.before, record.after);
  assert.deepEqual(Object.keys(record.before.counts).sort(), ["event_log", "execution_control", "plan_control", "plans", "runs", "submission_control"]);
  assert(Object.values(record.before.counts).every(value => value === 0));
  assert.deepEqual(Object.keys(record.before.sources).sort(), ["samples.h5", "samples.mat", "samples.npz"]);
  for (const identity of Object.values(record.before.sources)) {
    assert(Number.isSafeInteger(identity.size) && identity.size > 0);
    assert.match(identity.sha256, /^[a-f0-9]{64}$/);
  }
  const root = inventory.assets.find(asset => asset.url === "/");
  assert(root);
  assert.deepEqual(record.cache.root, { size: root.size, sha256: root.sha256 });
  const expected = inventory.assets.map(asset => asset.url).sort();
  assert.deepEqual(record.cache.paths, expected);
  assert(record.cache.paths.every(path => !/^\/(?:api|auth|events|state|tokens?)(?:\/|$)/i.test(path)));
  assert.deepEqual(record.pages.map(page => page.path), ["/experiments?offline=1", "/runs/11111111-1111-4111-8111-111111111111", "/settings/storage"]);
  let priorTimeOrigin = record.coldStart.timeOrigin;
  for (const page of record.pages) {
    assert.equal(page.href, record.origin + page.path);
    assert(page.timeOrigin > priorTimeOrigin);
    priorTimeOrigin = page.timeOrigin;
    assert.equal(page.controller, record.origin + "/sw.js");
    assert.equal(page.online, false);
    assert.equal(page.shell, true);
    assert.equal(page.offlineNotice, true);
    assert.equal(page.liveRun, false);
    assert.equal(page.approvedPlan, false);
    assert.equal(page.enabledMutations, 0);
    assert.equal(page.apiReadRefused, true);
    assert.equal(page.apiMutationRefused, true);
    assert.deepEqual(page.storage, { local: [], session: [], cookies: "" });
    assert(page.scripts.length > 0 && page.scripts.every(path => expected.includes(path)));
    assert(page.workerResourceCount > 0);
  }
  assert.deepEqual(record.onlineAgain, { online: true, explicitReconnect: true, enabledMutations: 0, approvedPlan: false, liveRun: false });
  assert.deepEqual(record.feedback, {
    href: "https://github.com/ductho-le/WaveDL", target: "_blank",
    rel: "noopener noreferrer", referrerPolicy: "no-referrer",
  });
  assert.deepEqual(record.cleanup, {
    errors: [], browserSessionAbsent: true, fixtureReaped: true,
    servicesClosed: true, listenerRefused: true, ownedWorkspaceRemoved: true,
  });
  return record;
}

export async function verifyColdOfflineFile(path) {
  const record = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await boundedFile(path)));
  const manifest = await boundedFile(fileURLToPath(new URL("../src/wavedl_daemon/web_assets/.wavedl-assets.json", import.meta.url)), 128 * 1024);
  assert.equal(record.assetManifestSha256, createHash("sha256").update(manifest).digest("hex"));
  const inventory = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await boundedFile(fileURLToPath(new URL("../src/wavedl_daemon/web_assets/offline-build.json", import.meta.url)), 128 * 1024)));
  return verifyColdOfflineRecord(record, inventory);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 3, "Usage: verify_cold_offline_browser_report.mjs REPORT");
  await verifyColdOfflineFile(process.argv[2]);
  console.log("Cold-offline browser report verified");
}
