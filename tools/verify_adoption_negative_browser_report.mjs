import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { boundedFile } from "./browser_files.mjs";

export function verifyNegativeAdoptionRecord(r) {
  assert.equal(r.name, "standalone-adoption-negative");
  assert.equal(r.status, "passed");
  assert.equal(r.driverReadinessMode, "sync-exposure-poll-and-two-controller-dom-observations");
  assert(typeof r.browser === "string" && r.browser.includes("agent-browser"));
  assert.equal(r.initialProfileEmpty, true);
  assert.match(r.browserObserved.userAgent, /Chrome\/[0-9]+/);
  assert.deepEqual({ ...r.browserObserved, userAgent: "Chrome" }, { userAgent: "Chrome", width: 1280, height: 900, cookies: "", localStorageKeys: [], sessionStorageKeys: [] });
  for (const key of ["error", "skip", "skipped", "skipReason", "retainedPrivateRoots", "explicitFixtureWebAssets"]) assert(!Object.hasOwn(r, key));
  assert.deepEqual(r.cleanup, { errors: [], browserSessionAbsent: true, fixtureReaped: true,
    servicesClosed: true, listenerClosed: true, ownedRootsRemoved: true, browserProfileRemoved: true, privateCredentialRemoved: true });
  assert.equal(r.producer.returncode, 0);
  assert.equal(r.producer.timedOut, false);
  assert.equal(r.producer.cancelled, false);
  assert.deepEqual(r.before.original, r.after.original);
  assert.deepEqual(r.before.originalFiles, r.after.originalFiles);
  const sha = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
  assert(uuid(r.before.original.runId) && uuid(r.before.original.requestId));
  assert.equal(r.before.original.journalExit.type, "exit");
  assert.equal(r.before.original.journalExit.payload.status, "completed");
  assert(r.before.original.checkpoints.length > 0);
  assert(Object.keys(r.before.originalFiles).length > 4);
  for (const files of [r.before.originalFiles, ...r.cases.flatMap(c => [c.beforeFault, c.faulted])]) {
    for (const [path, d] of Object.entries(files)) {
      assert(path && !path.startsWith("/") && !path.includes("\\") && !path.split("/").some(p => !p || p === ".." || p === "."));
      assert(Number.isSafeInteger(d.size) && d.size >= 0 && d.size <= 64 * 1024 * 1024 && sha(d.sha256));
    }
  }
  assert.deepEqual(r.after.counts, r.before.counts);
  assert.deepEqual(r.after.counts, Object.fromEntries(["plans", "plan_control", "execution_control", "submission_control", "runs", "runtime_provenance", "event_log"].map(k => [k, 0])));
  assert.deepEqual(r.cases.map(c => c.mode), ["corrupt-provenance", "conflicting-identity", "missing-provenance"]);
  assert.equal(r.responses.length, 3);
  assert.equal(new Set(r.cases.map(c => c.path)).size, 3);
  assert.equal(new Set(r.cases.map(c => dirname(c.path))).size, 1);
  for (const [i, c] of r.cases.entries()) {
    const response = r.responses[i];
    assert.equal(c.validBeforeFault, true);
    assert(isAbsolute(c.path) && resolve(c.path) === c.path && basename(c.path) === c.mode);
    assert.equal(r.after.cases[i].mode, c.mode);
    const originalFiles = { ...r.before.originalFiles }, copyFiles = { ...c.beforeFault };
    for (const name of ["manifest.json", "attempts/1/runtime_request.json"]) {
      assert(Object.hasOwn(copyFiles, name) && Object.hasOwn(originalFiles, name));
      assert.notDeepEqual(copyFiles[name], originalFiles[name]);
      delete copyFiles[name]; delete originalFiles[name];
    }
    assert.deepEqual(copyFiles, originalFiles);
    const member = "attempts/1/runtime_identity.json";
    assert(Object.hasOwn(c.beforeFault, member));
    assert(Object.keys(c.beforeFault).length > 4);
    const prior = { ...c.beforeFault }, changed = { ...c.faulted };
    delete prior[member]; delete changed[member];
    assert.deepEqual(changed, prior);
    if (c.mode === "missing-provenance") assert(!Object.hasOwn(c.faulted, member));
    else assert.notDeepEqual(c.faulted[member], c.beforeFault[member]);
    assert.deepEqual(c.faulted, r.after.cases[i].files);
    assert.equal(c.visibleNoConfirmation, true);
    assert.equal(c.visibleMessage, i === 2 ? "Adoption acknowledgement is unknown. Reconnect and reselect the same directory and attempt, then retry the retained request." : "The daemon rejected adoption. No ownership confirmation was received.");
    assert.equal(response.request.method, "POST");
    assert.equal(response.request.path, "/api/runs/adopt");
    assert.equal(response.request.idempotencyKeyPresent, true);
    assert(sha(response.request.idempotencyKeySha256) && sha(response.request.bodySha256));
    assert(Number.isSafeInteger(response.request.bodyBytes) && response.request.bodyBytes > 0 && response.request.bodyBytes <= 8192);
    assert.deepEqual(response.request.json, { path: c.path, attempt: 1 });
    const requestText = JSON.stringify(response.request.json);
    assert.equal(response.request.bodySha256, createHash("sha256").update(requestText).digest("hex"));
    assert.equal(response.request.bodyBytes, Buffer.byteLength(requestText));
    assert.equal(response.response.status, i === 2 ? 503 : 400);
    assert.equal(response.deliveredStatus, response.response.status);
    assert.equal(response.response.bodyBytes, Buffer.byteLength(response.response.bodyText));
    assert.equal(response.response.bodySha256, createHash("sha256").update(response.response.bodyText).digest("hex"));
    assert(!response.response.bodyText.includes(c.path));
    assert.deepEqual(JSON.parse(response.response.bodyText), response.response.json);
  }
  assert.equal(new Set(r.responses.map(x => x.request.idempotencyKeySha256)).size, 3);
  assert.equal(r.limitation, "Local owned fault copies only; no OS foreign ownership, remote, GPU, Windows or site certification.");
  return true;
}

export async function verifyNegativeAdoptionFile(path) {
  const r = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await boundedFile(path, 1024 * 1024)));
  verifyNegativeAdoptionRecord(r);
  assert.equal(r.assetManifestSha256, await currentAssetDigest());
  return r;
}
export async function currentAssetDigest() {
  const root = new URL("../src/wavedl_daemon/web_assets/", import.meta.url).pathname;
  const assets = await boundedFile(join(root, ".wavedl-assets.json"), 1024 * 1024);
  const manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(assets));
  const inventory = [];
  async function walk(directory, prefix = "") {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      assert(!item.isSymbolicLink());
      const name = prefix + item.name;
      if (item.isDirectory()) await walk(join(directory, item.name), name + "/");
      else if (name !== ".wavedl-assets.json") inventory.push(name);
    }
  }
  await walk(root);
  assert.deepEqual(inventory.sort(), Object.keys(manifest).sort());
  for (const [name, digest] of Object.entries(manifest)) {
    assert(name && !name.startsWith("/") && !name.split("/").some(p => !p || p === ".." || p === "."));
    assert.equal(createHash("sha256").update(await boundedFile(join(root, name), 16 * 1024 * 1024)).digest("hex"), digest);
  }
  return createHash("sha256").update(assets).digest("hex");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await verifyNegativeAdoptionFile(process.argv[2]);
  console.log("negative adoption browser report: verified");
}
