import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { boundedFile } from "./verify_retained_browser_report.mjs";
import { currentAssetDigest } from "./verify_adoption_negative_browser_report.mjs";

export function verifyCatalogueFaultRecord(r) {
  assert.equal(r.name, "catalogue-header-fault"); assert.equal(r.status, "passed");
  for (const key of ["error", "skip", "skipped", "skipReason", "explicitFixtureWebAssets"]) assert(!Object.hasOwn(r, key));
  assert.equal(r.driverReadinessMode, "sync-exposure-poll-and-two-controller-dom-observations");
  assert.match(r.browser, /agent-browser/); assert.equal(r.initialProfileEmpty, true);
  assert.match(r.browserObserved.userAgent, /Chrome\/[0-9]+/);
  assert.deepEqual({ ...r.browserObserved, userAgent: "Chrome" }, { userAgent: "Chrome", cookies: "", localStorageKeys: [], sessionStorageKeys: [] });
  assert.deepEqual(r.finalStorage, { cookies: "", localStorageKeys: [], sessionStorageKeys: [] });
  assert.deepEqual(r.cleanup, { browserAbsent: true, fixtureReaped: true, servicesClosed: true, listenerClosed: true, nativePermissionsRestored: true, ownedRemoved: true, errors: [] });
  const modes = ["roots", "traversal", "header", "shape", "claim", "malformed-model", "outage", "unreadable", "oversized"];
  assert.deepEqual(r.cases.map(x => x.mode), modes); assert.deepEqual(r.responses.map(x => x.mode), modes);
  const zero = Object.fromEntries(["plans", "plan_control", "execution_control", "submission_control", "runs", "runtime_provenance", "event_log"].map(k => [k, 0]));
  assert.deepEqual(r.before.counts, zero); assert.deepEqual(r.after, r.before);
  assert.deepEqual(r.after.sources, r.before.sources);
  assert.deepEqual(Object.keys(r.before.sources).sort(), ["samples.h5", "samples.mat", "samples.npz"]);
  for (const s of Object.values(r.before.sources)) { assert(s.size > 0 && Number.isSafeInteger(s.size)); assert.match(s.sha256, /^[a-f0-9]{64}$/); }
  assert.equal(r.baseline.plan, false); assert.equal(r.baseline.outside, false);
  assert(r.baseline.header); assert(r.baseline.files > 0); assert.equal(r.recoveredModel, true);
  for (const [i, item] of r.cases.entries()) {
    assert.deepEqual(item.state, r.before);
    for (const state of [item.refusal, item.retry]) { assert.equal(state.plan, false); assert.equal(state.outside, false); }
    const native = ["unreadable", "oversized"].includes(item.mode);
    const catalogue = native || ["roots", "traversal"].includes(item.mode), model = ["claim", "malformed-model", "outage"].includes(item.mode);
    const expected = catalogue ? "Catalogue unavailable. Verify your connection or choose another allowed location." : model ? "Model catalogue unavailable. Reconnect to the verified daemon and retry." : "Dataset inspection refused or unavailable. Reconnect, select a supported dataset again, or retry its header inspection.";
    assert(item.refusal.alerts.some(a => a.includes(expected) || a.includes('The daemon returned an invalid response. Reconnect to verify its identity.')));
    if (catalogue) { assert.equal(item.refusal.files, 0); assert(item.retry.files > 0); }
    else if (model) { assert.equal(item.refusal.models, 0); assert(item.retry.models > 0); }
    else { assert.equal(item.refusal.header, false); assert.equal(item.retry.header, true); }
    assert(!item.retry.alerts.some(a => a.includes(expected)));
    assert(!item.retry.alerts.some(a => a.includes("The daemon returned an invalid response.")));
    const response = r.responses[i];
    const expectedStatus = item.mode === "unreadable" ? 403 : item.mode === "oversized" || item.mode === "outage" ? 503 : 200;
    assert.equal(response.realStatus, native ? expectedStatus : 200); assert.equal(response.status, expectedStatus);
    assert.equal(response.method, model || catalogue ? "GET" : "POST");
    assert.equal(response.endpoint, catalogue ? "/api/browse" : model ? "/api/models" : "/api/datasets/inspect");
    for (const key of ["original", "response"]) { assert(Buffer.byteLength(response[key]) <= 262144); assert.equal(response[key + "Sha256"], createHash("sha256").update(response[key]).digest("hex")); }
    const real = JSON.parse(response.original), fault = JSON.parse(response.response);
    if (native) {
      assert.equal(response.original, response.response); assert.equal(response.responseModified, false); assert.equal(response.browser, true);
      assert(Buffer.byteLength(response.response) < 1024); assert(!Object.hasOwn(fault, "entries"));
      assert.deepEqual(fault, { error: item.mode === "unreadable" ? "Forbidden" : "Request failed" });
      const proof = response.native;
      assert.equal(proof.child, `${item.mode}-location`); assert.equal(proof.ordinaryDirectory, true);
      assert(Number.isSafeInteger(proof.uid) && proof.uid > 0); assert.equal(proof.owner, proof.uid); assert.equal(proof.maxEntries, 1000);
      assert.equal(proof.mode, item.mode === "unreadable" ? 0 : 448);
      if (item.mode === "unreadable") assert.equal(proof.permissionDenied, true);
      else { assert.equal(proof.entryCount, 1001); assert.equal(proof.ordinaryEmptyFiles, true); }
      const query = new URLSearchParams(response.query);
      assert.equal(query.get("root"), "datasets"); assert.equal(query.get("path"), proof.child);
      assert.equal(item.recovery, "public-reload-roots-reselect-root-and-file"); assert.equal(item.retry.header, true);
      continue;
    }
    assert.notDeepEqual(real, fault);
    if (item.mode === "roots") { assert.deepEqual(fault, { roots: [{ id: "../outside" }] }); assert.equal(response.query, ""); }
    if (item.mode === "traversal") { assert.equal(fault.entries[0].name, "../outside.npz"); assert.equal(new URLSearchParams(response.query).get("root"), "datasets"); }
    if (item.mode === "claim") { assert.equal(real.runtime_verified, false); assert.equal(fault.runtime_verified, true); }
    if (item.mode === "malformed-model") {
      assert(real.models.length > 0); assert.equal(typeof real.models[0].id, "string");
      const expected = structuredClone(real); expected.models[0].id = 37;
      assert.deepEqual(fault, expected, "Malformed model fault must change only the first model ID type");
      assert.equal(real.runtime_verified, false); assert.equal(response.query, "");
    }
    if (item.mode === "outage") assert.deepEqual(fault, { error: "Unavailable" });
    if (item.mode === "header") { assert.equal(real.schema_version, 1); assert.equal(fault.schema_version, 999); }
    if (item.mode === "shape") assert.equal(fault.variables[0].sample_count, real.variables[0].sample_count + 1);
  }
  assert.equal(r.limitation, "Seven explicit one-shot response-boundary faults plus two native owned local child-location refusals; not root-location, remote filesystem, remote outage or Slurm certification.");
  return true;
}
export async function verifyCatalogueFaultFile(path) {
  const r = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await boundedFile(path, 2 * 1024 * 1024)));
  verifyCatalogueFaultRecord(r); assert.equal(r.assetManifestSha256, await currentAssetDigest()); return r;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) { await verifyCatalogueFaultFile(process.argv[2]); console.log("catalogue/header fault browser report: verified"); }
