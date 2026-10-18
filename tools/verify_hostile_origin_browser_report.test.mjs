import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { currentMappedAssets } from "./verify_mapped_autoplot_browser_report.mjs";
import { limitation, parseHostileOriginJSON, scope, verifyHostileOriginFile, verifyHostileOriginReport } from "./verify_hostile_origin_browser_report.mjs";

const digest = (text) => createHash("sha256").update(text).digest("hex");
const packagedAssetCount = Object.keys((await currentMappedAssets()).files).length;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  const identity = { daemonId: digest("actual-hosted-daemon-instance"), runId: id(2), planId: id(3), requestId: id(4), buildId: "1.0.0" };
  const snapshot = (cancelled) => ({ registry: { sha256: digest(`registry-${cancelled}`),
    tables: { plans: 1, plan_control: 1, execution_control: 0, submission_control: cancelled, runs: 0, schema_migrations: 10 },
    cancellationRequested: [cancelled], plans: [{ planId: identity.planId, runId: identity.runId,
      requestId: identity.requestId, submissionRequested: 0, cancellationRequested: cancelled }],
    executions: [], submissionControls: cancelled ? [{ planId: identity.planId, state: "pending", cancelDelivered: false }] : [] },
    trees: { state: digest("state"), runs: digest("runs") }, settingsSha256: digest("settings") });
  const assets = { manifestSha256: digest("manifest"), files: Object.fromEntries(Array.from({ length: packagedAssetCount }, (_, n) => [`asset${n}.js`, { size: 1, sha256: digest(String(n)) }])) };
  const attack = "http://127.0.0.1:43211", cancel = `/api/runs/${identity.runId}/cancel`;
  const rows = [["node-get", "GET", "/api/runs", 200, null, false, true],
    ["simple-get", "GET", "/api/runs", 403, attack, true, false],
    ["simple-post", "POST", cancel, 403, attack, true, false],
    ["form-post", "POST", cancel, 403, attack, true, false],
    ["json-post", "OPTIONS", cancel, 403, attack, false, false],
    ["cookie-only", "GET", "/api/runs", 401, null, true, false],
    ["node-cancel", "POST", cancel, 202, null, false, true]];
  return { status: "passed", scope, limitation,
    driverReadinessMode: "sync-exposure-poll-and-two-controller-dom-observations",
    ownership: { workspace: "/tmp/wavedl-hostile-origin-Ab1234", root: "/tmp/wavedl-hostile-origin-Ab1234/root", profile: "/tmp/wavedl-hostile-origin-Ab1234/profile", session: `wavedl-hostile-origin-${id(5)}` },
    origins: { daemon: "http://127.0.0.1:43210", attack }, identity, assetsBefore: assets, assetsAfter: structuredClone(assets),
    browser: { version: "agent-browser 1.0.0", userAgent: "HeadlessChrome/154.0.0.0", cookieSet: true,
      dom: Object.fromEntries([["simpleGet", "simple-get"], ["simplePost", "simple-post"], ["formPost", "form-post"], ["jsonPost", "json-post"]].map(([key, name]) => { const outcome = key === "formPost" ? "submitted" : "rejected"; return [key, { outcome, text: `${name}:${outcome}` }]; })),
      cookieOnly: { outcome: "response", status: 401, text: '{"error":"Unauthorized"}' } },
    controls: { nodeAuthenticatedGet: { status: 200, transport: "node-fetch-not-browser" }, nodeAuthenticatedCancel: { status: 202, transport: "node-fetch-not-browser" } },
    evidence: { storageBefore: snapshot(0), storageAfter: snapshot(0), storageAfterPositive: snapshot(1),
      receipts: rows.map(([caseName, method, path, status, origin, cookiePresent, authHeaderPresent], index) => ({ sequence: index + 1, case: caseName, method, path, status, origin, cookiePresent, authHeaderPresent, bodyBytes: 0, bodySha256: digest(""), requestedHeaders: index === 4 ? ["authorization", "content-type"] : [], setCookiePresent: false, allowOriginPresent: false })) },
    cleanup: { errors: [], browserSessionAbsent: true, fixtureReaped: true, fixtureExit: { code: 0, signal: null }, servicesClosed: true, daemonListenerClosed: true, attackListenerClosed: true, rootRemoved: true, profileRemoved: true, tokenRemoved: true, workspaceRemoved: true }, fixtureOutputOverflow: false, ownedArtifactsRetained: false };
}

test("populated dedicated report passes", () => assert(verifyHostileOriginReport(fixture())));
test("accepts re-raised SIGINT only after measured drain and listener closure", () => {
  const report = fixture(); report.cleanup.fixtureExit = { code: null, signal: "SIGINT" };
  assert(verifyHostileOriginReport(report));
  for (const key of ["servicesClosed", "daemonListenerClosed", "attackListenerClosed", "fixtureReaped"]) {
    const broken = structuredClone(report); broken.cleanup[key] = false;
    assert.throws(() => verifyHostileOriginReport(broken));
  }
});
const tampers = {
  "failed status": r => r.status = "failed",
  "overscope": r => r.limitation = "Full F13 certified",
  "extra claim": r => r.fullSecurityAcceptance = true,
  "error even empty": r => r.error = "",
  "nested secret": r => r.evidence.receipts[0].authorization = "Bearer hidden",
  "same port": r => r.origins.attack = r.origins.daemon,
  "different hostname": r => r.origins.attack = "http://localhost:43211",
  "unsafe profile": r => r.ownership.profile = "/tmp/other",
  "UUID daemon identity instead of hosted digest": r => r.identity.daemonId = id(1),
  "missing case": r => delete r.browser.dom.simplePost,
  "copied DOM": r => r.browser.dom.simpleGet.text = "json-post:rejected",
  "no actual GET403": r => r.evidence.receipts[1].status = 0,
  "form only cors assumption": r => r.evidence.receipts.splice(3, 1),
  "duplicate simple post substitutes form": r => r.evidence.receipts[3].case = "simple-post",
  "actual POST substituted for preflight": r => r.evidence.receipts[4].method = "POST",
  "actual forbidden JSON POST": r => r.evidence.receipts.push({ ...r.evidence.receipts[4], method: "POST", sequence: 8 }),
  "no auth preflight": r => r.evidence.receipts[4].requestedHeaders = ["content-type"],
  "preflight falsely cookie authenticated": r => r.evidence.receipts[4].cookiePresent = true,
  "cross port cookie not sent": r => r.evidence.receipts[2].cookiePresent = false,
  "cookie authorizes": r => r.evidence.receipts[5].status = 200,
  "cookie DOM differs": r => r.browser.cookieOnly.text = '{"detail":"Forbidden"}',
  "synthetic cookie not set": r => r.browser.cookieSet = false,
  "grant CORS": r => r.evidence.receipts[1].allowOriginPresent = true,
  "issue cookie": r => r.evidence.receipts[5].setCookiePresent = true,
  "auth control lacks auth": r => r.evidence.receipts[0].authHeaderPresent = false,
  "nonlegitimate cancellation": r => r.controls.nodeAuthenticatedCancel.status = 403,
  "body count forged": r => r.evidence.receipts[3].bodyBytes = 2,
  "body hash forged": r => r.evidence.receipts[3].bodySha256 = digest("{}"),
  "sequence reused": r => r.evidence.receipts[2].sequence = 2,
  "storage mutated": r => r.evidence.storageAfter.trees.runs = digest("mutated"),
  "hashes selfconsistent but identities disagree": r => { r.identity.runId = id(7); for (const row of r.evidence.receipts) row.path = row.path.replace(id(2), id(7)); },
  "selfconsistent duplicate real identities": r => { r.identity.requestId = r.identity.planId; for (const s of [r.evidence.storageBefore, r.evidence.storageAfter, r.evidence.storageAfterPositive]) s.registry.plans[0].requestId = r.identity.planId; },
  "selfconsistent snapshot hashes hide submission": r => { for (const s of [r.evidence.storageBefore, r.evidence.storageAfter]) { s.registry.sha256 = digest("changed"); s.registry.plans[0].submissionRequested = 1; } },
  "positive control missing persisted cancellation": r => r.evidence.storageAfterPositive.registry.cancellationRequested = [0],
  "positive dispatched ML": r => r.evidence.storageAfterPositive.registry.executions.push({ planId: r.identity.planId, attempt: 1, state: "submitted", cancelDelivered: 0 }),
  "positive submitted writer": r => r.evidence.storageAfterPositive.registry.submissionControls[0].state = "submitted",
  "missing asset selfconsistent": r => { delete r.assetsBefore.files["asset0.js"]; delete r.assetsAfter.files["asset0.js"]; },
  "fixture killed": r => r.cleanup.fixtureExit = { code: null, signal: "SIGKILL" },
  "fixture terminated": r => r.cleanup.fixtureExit = { code: null, signal: "SIGTERM" },
  "fixture nonzero": r => r.cleanup.fixtureExit = { code: 1, signal: null },
  "fixture mixed exit": r => r.cleanup.fixtureExit = { code: 0, signal: "SIGINT" },
  "cleanup errors": r => r.cleanup.errors.push("failed"),
};
for (const key of ["browserSessionAbsent", "fixtureReaped", "servicesClosed", "daemonListenerClosed", "attackListenerClosed", "rootRemoved", "profileRemoved", "tokenRemoved", "workspaceRemoved"]) tampers[`cleanup ${key}`] = r => r.cleanup[key] = false;
for (const [name, tamper] of Object.entries(tampers)) test(`rejects ${name}`, () => { const r = fixture(); tamper(r); assert.throws(() => verifyHostileOriginReport(r)); });

test("strict parser rejects duplicate, escaped duplicate, invalid UTF8 and invalid JSON", () => {
  for (const bytes of [Buffer.from('{"x":1,"x":2}'), Buffer.from('{"x":1,"\\u0078":2}'), Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125]), Buffer.from('{"x":NaN}'), Buffer.from('\ufeff{}')]) assert.throws(() => parseHostileOriginJSON(bytes));
});
test("dedicated bounded file verifies exact current assets and rejects selfconsistent stale hash", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wavedl-hostile-verifier-"));
  try {
    const report = fixture(); report.assetsBefore = await currentMappedAssets(); report.assetsAfter = structuredClone(report.assetsBefore);
    const path = join(dir, "report.json"); await writeFile(path, JSON.stringify(report)); assert(await verifyHostileOriginFile(path));
    report.assetsBefore.manifestSha256 = digest("stale"); report.assetsAfter = structuredClone(report.assetsBefore);
    await writeFile(path, JSON.stringify(report)); await assert.rejects(verifyHostileOriginFile(path));
    const link = join(dir, "link"); await symlink(path, link); await assert.rejects(verifyHostileOriginFile(link));
    await assert.rejects(verifyHostileOriginFile(dir));
    await writeFile(path, " ".repeat(1024 * 1024 + 1)); await assert.rejects(verifyHostileOriginFile(path));
    await writeFile(path, ""); await assert.rejects(verifyHostileOriginFile(path));
    await writeFile(path, '{"status":"failed","status":"passed"}'); await assert.rejects(verifyHostileOriginFile(path));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
