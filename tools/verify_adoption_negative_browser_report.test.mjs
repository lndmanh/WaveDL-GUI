import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyNegativeAdoptionRecord, verifyNegativeAdoptionFile } from "./verify_adoption_negative_browser_report.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
function record() {
  const files = Object.fromEntries(["manifest.json", "attempts/1/runtime_identity.json", "attempts/1/runtime_request.json", "attempts/1/events.jsonl", "checkpoints/gen-000001/COMPLETE.json"].map(name => [name, { size: 10, sha256: hash(name) }]));
  const original = { runId: "11111111-1111-4111-8111-111111111111", requestId: "22222222-2222-4222-8222-222222222222", journalExit: { type: "exit", payload: { status: "completed" } }, checkpoints: [{}] };
  const counts = Object.fromEntries(["plans", "plan_control", "execution_control", "submission_control", "runs", "runtime_provenance", "event_log"].map(k => [k, 0]));
  const cases = ["corrupt-provenance", "conflicting-identity", "missing-provenance"].map((mode, i) => {
    const beforeFault = structuredClone(files);
    for (const name of ["manifest.json", "attempts/1/runtime_request.json"]) beforeFault[name] = { size: 12, sha256: hash(mode + name) };
    const faulted = structuredClone(beforeFault);
    if (i === 2) delete faulted["attempts/1/runtime_identity.json"];
    else faulted["attempts/1/runtime_identity.json"] = { size: 7, sha256: hash(mode) };
    return { mode, path: `/owned/${mode}`, validBeforeFault: true, beforeFault, faulted, visibleNoConfirmation: true, visibleMessage: i === 2 ? "Adoption acknowledgement is unknown. Reconnect and reselect the same directory and attempt, then retry the retained request." : "The daemon rejected adoption. No ownership confirmation was received." };
  });
  const responses = cases.map((c, i) => {
    const bodyText = JSON.stringify({ detail: i === 2 ? "Adoption service unavailable" : "Invalid adoption request" });
    const requestJson = { path: c.path, attempt: 1 };
    const requestText = JSON.stringify(requestJson);
    return { request: { method: "POST", path: "/api/runs/adopt", idempotencyKeyPresent: true, idempotencyKeySha256: hash(c.mode), bodySha256: hash(requestText), bodyBytes: Buffer.byteLength(requestText), json: requestJson }, response: { status: i === 2 ? 503 : 400, bodyText, bodyBytes: Buffer.byteLength(bodyText), bodySha256: hash(bodyText), json: JSON.parse(bodyText) }, deliveredStatus: i === 2 ? 503 : 400 };
  });
  const context = { driverReadinessMode: "sync-exposure-poll-and-two-controller-dom-observations", browser: "agent-browser Chrome", initialProfileEmpty: true, browserObserved: { userAgent: "Chrome/1", width: 1280, height: 900, cookies: "", localStorageKeys: [], sessionStorageKeys: [] } };
  return { ...context, name: "standalone-adoption-negative", status: "passed", producer: { returncode: 0, timedOut: false, cancelled: false }, before: { original, originalFiles: files, counts }, after: { original: structuredClone(original), originalFiles: structuredClone(files), counts: structuredClone(counts), cases: cases.map(c => ({ mode: c.mode, files: c.faulted })) }, cases, responses, cleanup: { errors: [], browserSessionAbsent: true, fixtureReaped: true, servicesClosed: true, listenerClosed: true, ownedRootsRemoved: true, browserProfileRemoved: true, privateCredentialRemoved: true }, limitation: "Local owned fault copies only; no OS foreign ownership, remote, GPU, Windows or site certification." };
}
test("accepts complete synthetic evidence contract, not browser proof", () => assert(verifyNegativeAdoptionRecord(record())));
for (const [name, change] of [
  ["failed status", r => r.status = "failed"],
  ["missing mode", r => r.cases.pop()],
  ["wrong response status", r => r.responses[0].response.status = 200],
  ["body mismatch", r => r.responses[0].response.json = {}],
  ["body hash", r => r.responses[0].response.bodySha256 = "a".repeat(64)],
  ["request hash", r => r.responses[0].request.bodySha256 = "bad"],
  ["request identity", r => r.responses[0].request.json.attempt = 2],
  ["duplicate idempotency", r => r.responses[1].request.idempotencyKeySha256 = r.responses[0].request.idempotencyKeySha256],
  ["empty counts", r => r.before.counts = r.after.counts = {}],
  ["durable plan", r => r.after.counts.plans = 1],
  ["empty source", r => r.before.original = r.after.original = {}],
  ["source mutation", r => r.after.originalFiles["manifest.json"].size++],
  ["unfaulted copy", r => r.cases[0].faulted = structuredClone(r.cases[0].beforeFault)],
  ["unrelated fault", r => r.cases[0].faulted["manifest.json"].size++],
  ["wrong after mode", r => r.after.cases[0].mode = "missing-provenance"],
  ["missing browser context", r => delete r.browserObserved],
  ["nonempty profile", r => r.initialProfileEmpty = false],
  ["relative path", r => r.cases[0].path = "corrupt-provenance"],
  ["unrelated copy mutation", r => r.cases[0].beforeFault["attempts/1/events.jsonl"].size++],
  ["cleanup failure", r => r.cleanup.listenerClosed = false],
  ["cleanup error", r => r.cleanup.errors.push("retained")],
  ["skip", r => r.skip = true],
  ["retained roots", r => r.retainedPrivateRoots = []],
]) test(`rejects ${name}`, () => { const r = record(); change(r); assert.throws(() => verifyNegativeAdoptionRecord(r)); });
test("file guard binds exact current assets and rejects symlink report", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "wavedl-negative-guard-"));
  try {
    const r = record();
    r.assetManifestSha256 = hash(await readFile(new URL("../src/wavedl_daemon/web_assets/.wavedl-assets.json", import.meta.url)));
    const path = join(root, "report.json");
    await writeFile(path, JSON.stringify(r));
    await verifyNegativeAdoptionFile(path);
    await symlink(path, join(root, "link.json"));
    await assert.rejects(verifyNegativeAdoptionFile(join(root, "link.json")));
    r.assetManifestSha256 = "0".repeat(64);
    await writeFile(path, JSON.stringify(r));
    await assert.rejects(verifyNegativeAdoptionFile(path));
  } finally { await rm(root, { recursive: true, force: true }); }
});
