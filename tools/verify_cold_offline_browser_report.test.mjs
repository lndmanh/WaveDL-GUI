import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { coldOfflineLimitation, verifyColdOfflineRecord, verifyColdOfflineFile } from "./verify_cold_offline_browser_report.mjs";

const inventory = { assets: [
  { url: "/", size: 100, sha256: "a".repeat(64) },
  { url: "/_nuxt/app.js", size: 10, sha256: "b".repeat(64) },
] };
function fixture() {
  const origin = "http://127.0.0.1:12345";
  const before = {
    counts: { runs: 0, plans: 0, plan_control: 0, execution_control: 0, submission_control: 0, event_log: 0 },
    sources: Object.fromEntries(["samples.npz", "samples.h5", "samples.mat"].map(name => [name, { size: 10, sha256: "c".repeat(64) }])),
  };
  return {
    name: "cold-offline-browser", status: "passed", origin,
    limitation: coldOfflineLimitation, initialProfileEmpty: true,
    assetManifestSha256: "d".repeat(64), browser: "agent-browser 0.26.0",
    online: { userAgent: "HeadlessChrome/150", bootstrapRemoved: true, connected: true, controller: origin + "/sw.js", timeOrigin: 1 },
    coldStart: { controller: origin + "/sw.js", shell: true, timeOrigin: 1.5, navigationWorkerStart: 1 },
    daemonStoppedBeforeRestart: true, firstBrowserClosed: true,
    before, after: structuredClone(before),
    cache: { root: { size: 100, sha256: "a".repeat(64) }, paths: ["/", "/_nuxt/app.js"] },
    pages: ["/experiments?offline=1", "/runs/11111111-1111-4111-8111-111111111111", "/settings/storage"].map((path, index) => ({
      path, href: origin + path, timeOrigin: index + 2, controller: origin + "/sw.js",
      online: false, shell: true, offlineNotice: true, liveRun: false, approvedPlan: false,
      enabledMutations: 0, apiReadRefused: true, apiMutationRefused: true,
      storage: { local: [], session: [], cookies: "" }, scripts: ["/_nuxt/app.js"], workerResourceCount: 2,
    })),
    onlineAgain: { online: true, explicitReconnect: true, enabledMutations: 0, approvedPlan: false, liveRun: false },
    feedback: { href: "https://github.com/ductho-le/WaveDL", target: "_blank", rel: "noopener noreferrer", referrerPolicy: "no-referrer" },
    cleanup: { errors: [], browserSessionAbsent: true, fixtureReaped: true, servicesClosed: true, listenerRefused: true, ownedWorkspaceRemoved: true },
  };
}

test("accepts complete contract fixture, not independent browser evidence", () => verifyColdOfflineRecord(fixture(), inventory));
for (const field of ["error", "skip", "skipped", "skipReason", "retainedPrivateRoots"])
  test(`rejects passed evidence containing ${field}`, () => {
    const record = fixture(); record[field] = false;
    assert.throws(() => verifyColdOfflineRecord(record, inventory));
  });
for (const [name, mutate] of [
  ["dirty profile", record => { record.initialProfileEmpty = false; }],
  ["live daemon", record => { record.daemonStoppedBeforeRestart = false; }],
  ["warm browser", record => { record.firstBrowserClosed = false; }],
  ["no cold worker navigation", record => { record.coldStart.navigationWorkerStart = 0; }],
  ["same document", record => { record.pages[0].timeOrigin = 1; }],
  ["missing route", record => { record.pages.pop(); }],
  ["wrong route", record => { record.pages[0].href += "other"; }],
  ["online page", record => { record.pages[0].online = true; }],
  ["uncontrolled page", record => { record.pages[1].controller = null; }],
  ["missing worker timing", record => { record.pages[2].workerResourceCount = 0; }],
  ["network-only asset", record => { record.pages[0].scripts.push("/unverified.js"); }],
  ["API cache", record => { record.cache.paths.push("/api/health"); }],
  ["corrupt shell", record => { record.cache.root.sha256 = "b".repeat(64); }],
  ["unstripped bootstrap", record => { record.online.bootstrapRemoved = false; }],
  ["cached API state", record => { record.pages[0].apiReadRefused = false; }],
  ["offline mutation response", record => { record.pages[0].apiMutationRefused = false; }],
  ["fabricated run", record => { record.pages[1].liveRun = true; }],
  ["offline plan", record => { record.pages[2].approvedPlan = true; }],
  ["offline controls", record => { record.pages[0].enabledMutations = 1; }],
  ["deferred authority", record => { record.onlineAgain.enabledMutations = 1; }],
  ["implicit reconnect", record => { record.onlineAgain.explicitReconnect = false; }],
  ["persisted credential", record => { record.pages[0].storage.local.push("bearer"); }],
  ["cookie authority", record => { record.pages[0].storage.cookies = "token=x"; }],
  ["server mutation", record => { record.after.counts.plans = 1; }],
  ["absent registry proof", record => { record.before.counts = {}; record.after.counts = {}; }],
  ["wrong source filenames", record => {
    record.before.sources["other.npz"] = record.before.sources["samples.npz"];
    delete record.before.sources["samples.npz"];
    record.after = structuredClone(record.before);
  }],
  ["source mutation", record => { record.after.sources["samples.npz"].sha256 = "e".repeat(64); }],
  ["feedback credential", record => { record.feedback.href += "?bootstrap=secret"; }],
  ["feedback referrer", record => { record.feedback.referrerPolicy = "unsafe-url"; }],
  ["listener retained", record => { record.cleanup.listenerRefused = false; }],
  ["cleanup error", record => { record.cleanup.errors.push("error"); }],
  ["scope overclaim", record => { record.limitation = "All PWA platforms supported"; }],
]) test(`rejects ${name}`, () => {
  const record = fixture(); mutate(record);
  assert.throws(() => verifyColdOfflineRecord(record, inventory));
});
test("file guard rejects absent, empty, oversized, invalid UTF-8 and symlink reports", async () => {
  const root = await mkdtemp(join(tmpdir(), "cold-offline-verifier-"));
  try {
    const path = join(root, "report.json");
    await assert.rejects(verifyColdOfflineFile(path));
    for (const content of ["", " ".repeat(2 * 1024 * 1024 + 1), Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125])]) {
      await writeFile(path, content);
      await assert.rejects(verifyColdOfflineFile(path));
    }
    await rm(path); await symlink("/dev/null", path);
    await assert.rejects(verifyColdOfflineFile(path));
  } finally { await rm(root, { recursive: true, force: true }); }
});
