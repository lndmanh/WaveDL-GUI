import assert from "node:assert/strict";
import { test } from "node:test";
import { limitation, verifyConcurrencyReport, verifyStorage } from "./verify_retained_concurrency_report.mjs";

test("concurrency verifier declares its deliberately narrow scope", () => {
  assert.match(limitation, /Native-storage install concurrency/);
  assert.match(limitation, /Not ordinary UI-update concurrency/);
});

test("storage verifier rejects foreign cache names", () => {
  assert.throws(() => verifyStorage({ records: [], cached: [], cacheNames: ["wavedl-retained-v1-foreign"], registrations: [] }, []));
});

test("report verifier rejects an unpassed report before inspecting browser evidence", () => {
  assert.throws(() => verifyConcurrencyReport({ schemaVersion: 1, status: "failed" }, []), /passed/);
});

function valid() {
  const origin = "http://127.0.0.1:1234";
  const builds = [1, 2, 3, 4].map((n) => {
    const generation = String(n).repeat(64), buildKey = String(n + 4).repeat(64);
    return { namespace: `g${n}`, generation, buildKey, workerSha256: "a".repeat(64), workerSize: 10, inventorySize: 20, offlineInventorySha256: "b".repeat(64), totalBytes: 5, inventory: { schema_version: 1, generation, build_key: buildKey, assets: [{ url: "/", sha256: "c".repeat(64), size: 5, immutable: false }] } };
  });
  const record = (b, pending = false) => { const owner = `00000000-0000-4000-8000-00000000000${b.namespace.slice(1)}`; return { inventory: b.inventory, status: pending ? "pending" : "ready", owner, reservedBytes: 5, cacheName: `wavedl-retained-v1-${b.generation}-${owner}` }; };
  const storage = (count, pending = false) => {
    const records = builds.slice(0, count).map((b, i) => record(b, pending && i > 0));
    return { records, cached: records.map((r) => ({ name: r.cacheName, assets: r.status === "ready" ? r.inventory.assets.map(({ url, sha256, size }) => ({ url, sha256, size })) : [] })), cacheNames: records.map((r) => r.cacheName), registrations: records.map((r, i) => ({ scope: origin + (i === 0 ? "/" : `/qa/g${i + 1}/`), active: "activated", activeScript: origin + (i === 0 ? "/sw.js" : `/qa/g${i + 1}/sw.js`) })) };
  };
  const trace = builds.slice(1, 3).flatMap((b) => [
    { namespace: b.namespace, kind: "worker", sha256: b.workerSha256, status: 200, path: `/qa/${b.namespace}/sw.js`, size: 10 },
    { namespace: b.namespace, kind: "inventory", sha256: b.offlineInventorySha256, status: 200, path: "/offline-build.json", size: 20 },
    { namespace: b.namespace, kind: "asset", path: "/", sha256: "c".repeat(64), size: 5, status: 200, barrier: true, startISO: "2026-10-11T00:00:00.000Z", endISO: "2026-10-11T00:00:01.000Z" },
  ]);
  trace.splice(3, 0, { ...trace[3], kind: "worker" });
  const report = { schemaVersion: 1, status: "passed", origin, limitation, warm: storage(1), initialStatus: { inventorySeen: ["g1", "g2", "g3"], barrierArrived: ["g2"] }, initialStorage: storage(2, true), initialPage: { url: `${origin}/`, text: "", registrations: [{ scope: `${origin}/`, active: "activated" }, { scope: `${origin}/qa/g2/`, installing: "installing" }] }, retry: { namespace: "g3", started: "2026-10-11T00:00:00.000Z", completed: "2026-10-11T00:00:01.000Z" }, pendingStorage: storage(3, true), pendingStatus: { released: false, inventorySeen: ["g1", "g2", "g3"], barrierArrived: ["g2", "g3"], traceDropped: 0 }, final: { storage: storage(3), status: { released: true, traceDropped: 0, trace } }, capacity: { refusals: [{ type: "WAVEDL_UPDATE_REFUSED", reason: "capacity", role: "g4a", scriptURL: `${origin}/qa/g4a/sw.js` }, { type: "WAVEDL_UPDATE_REFUSED", reason: "capacity", role: "g4b", scriptURL: `${origin}/qa/g4b/sw.js` }], scriptTrace: [{ namespace: "g4", path: "/qa/g4a/sw.js", sha256: "a".repeat(64), size: 10, status: 200 }, { namespace: "g4", path: "/qa/g4b/sw.js", sha256: "a".repeat(64), size: 10, status: 200 }], postStorage: storage(3) }, cleanup: { browserClosed: true, sessionAbsent: true, fixtureClosed: true, servicesClosed: true, listenerRefused: true, ownedRemoved: true, fixtureExitCode: 0 } };
  report.pendingStatus.trace = trace.filter((t) => t.barrier).map((t) => ({ ...t, status: "held", endISO: null }));
  report.cleanup.fixtureExitCode = 0;
  return { report, builds };
}

test("complete native concurrent admission evidence is accepted", () => {
  const { report, builds } = valid();
  assert.equal(verifyConcurrencyReport(report, builds).status, "passed");
});

for (const [label, mutate] of [
  ["nonoverlapping asset fetches", (r) => { r.final.status.trace.find((t) => t.namespace === "g3" && t.barrier).startISO = "2026-10-11T00:00:02.000Z"; }],
  ["candidate worker rewrite", (r) => { r.final.status.trace[0].sha256 = "d".repeat(64); }],
  ["lost warm ownership", (r) => { r.final.storage.records[0].owner = "10000000-0000-4000-8000-000000000001"; }],
  ["pending quota overflow", (r) => { r.pendingStorage.records[1].reservedBytes = 64 * 1024 * 1024; }],
  ["foreign cache", (r) => { r.final.storage.cacheNames.push("foreign"); }],
  ["unproven listener closure", (r) => { r.cleanup.listenerRefused = false; }],
  ["missing pending generation", (r) => { r.pendingStorage.records.pop(); }],
  ["wrong active scope", (r) => { r.final.storage.registrations[1].scope += "wrong"; }],
  ["truncated trace", (r) => { r.final.status.traceDropped = 1; }],
  ["capacity marker mismatch", (r) => { r.capacity.refusals[0].reason = "verification"; }],
  ["capacity role script mismatch", (r) => { r.capacity.refusals[1].scriptURL = `${r.origin}/qa/g4a/sw.js`; }],
  ["capacity changed warm bytes", (r) => { r.capacity.postStorage.records[0].reservedBytes = 6; }],
  ["capacity foreign cleanup", (r) => { r.capacity.postStorage.cacheNames.push("wavedl-retained-v1-foreign"); }],
]) test(`verifier rejects ${label}`, () => {
  const { report, builds } = valid();
  mutate(report);
  assert.throws(() => verifyConcurrencyReport(report, builds));
});
