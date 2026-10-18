import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  rollbackLimitation,
  verifyRollbackReport,
  verifyRetainedRollbackReport,
} from "./verify_retained_rollback_browser_report.mjs";
import {
  faultFixtureCode,
  storageExpression,
} from "./run_retained_rollback_browser_acceptance.mjs";

function valid() {
  const origin = "http://127.0.0.1:1234";
  const builds = [1, 2, 3, 4].map((n) => {
    const generation = String(n).repeat(64),
      buildKey = String(n + 4).repeat(64);
    return {
      namespace: `g${n}`,
      generation,
      buildKey,
      entryUrls: [`/_nuxt/g${n}/entry.js`],
      workerSha256: "a".repeat(64),
      workerSize: 10,
      inventorySize: 20,
      offlineInventorySha256: "b".repeat(64),
      totalBytes: 10,
      inventory: {
        schema_version: 1,
        generation,
        build_key: buildKey,
        assets: [
          { url: "/", sha256: "c".repeat(64), size: 5, immutable: false },
          { url: `/_nuxt/g${n}/entry.js`, sha256: "d".repeat(64), size: 5, immutable: true },
        ],
      },
    };
  });
  const record = (b, pending = false) => {
    const owner = `00000000-0000-4000-8000-00000000000${b.namespace.slice(1)}`;
    return {
      inventory: b.inventory,
      status: pending ? "pending" : "ready",
      owner,
      reservedBytes: 10,
      cacheName: `wavedl-retained-v1-${b.generation}-${owner}`,
    };
  };
  const storage = (bs, pending = false) => {
    const records = bs.map((b, i) => record(b, pending && i > 0));
    return {
      records,
      cached: records.map((r) => ({
        name: r.cacheName,
        assets: r.inventory.assets
          .slice(0, r.status === "pending" ? 1 : 2)
          .map(({ url, size, sha256 }) => ({ url, size, sha256 })),
      })),
      cacheNames: records.map((r) => r.cacheName),
      registrations: [
        { scope: origin + "/", active: "activated", activeScript: origin + "/sw.js" },
        ...(pending ? [{ scope: origin + "/qa/g4a/", installing: "installing" }] : []),
      ],
    };
  };
  const scriptURL = origin + "/qa/g4a/sw.js";
  const page = {
    url: origin + "/",
    timeOrigin: 123,
    controller: origin + "/sw.js",
    entries: builds[0].entryUrls,
  };
  const fault = {
    namespace: "g4",
    kind: "asset",
    path: builds[3].inventory.assets[1].url,
    startISO: "2026-10-12T00:00:01.000Z",
    endISO: "2026-10-12T00:00:02.000Z",
    status: 503,
    sha256: null,
    size: 0,
    injected: "http-503",
  };
  return {
    builds,
    report: {
      schemaVersion: 1,
      mode: "native-storage-install-rollback",
      status: "passed",
      limitation: rollbackLimitation,
      origin,
      browser: "agent-browser 0.30",
      warm: storage([builds[0]]),
      pending: storage([builds[0], builds[3]], true),
      after: storage([builds[0]]),
      pageBefore: page,
      pageAfter: structuredClone(page),
      failureAsset: fault.path,
      terminal: { scriptURL, state: "redundant", states: ["installing", "redundant"] },
      refusal: { type: "WAVEDL_UPDATE_REFUSED", reason: "verification", scriptURL },
      trace: {
        traceDropped: 0,
        trace: [
          {
            namespace: "g4",
            kind: "worker",
            path: "/qa/g4a/sw.js",
            status: 200,
            sha256: "a".repeat(64),
            size: 10,
          },
          {
            namespace: "g4",
            kind: "inventory",
            path: "/offline-build.json",
            status: 200,
            sha256: "b".repeat(64),
            size: 20,
          },
          {
            namespace: "g4",
            kind: "asset",
            path: "/",
            status: 200,
            sha256: "c".repeat(64),
            size: 5,
            endISO: "2026-10-12T00:00:00.000Z",
          },
          fault,
        ],
      },
      heldTrace: { trace: [{ ...fault, status: "held", endISO: null }] },
      cleanup: {
        browserClosed: true,
        sessionAbsent: true,
        fixtureClosed: true,
        servicesClosed: true,
        listenerRefused: true,
        ownedRemoved: true,
        fixtureExitCode: 0,
      },
    },
  };
}
test("complete rollback report contract accepted", () => {
  const { report, builds } = valid();
  assert.equal(verifyRollbackReport(report, builds).status, "passed");
});
for (const [label, mutate] of [
  ["synthetic mode", (r) => (r.mode = "synthetic")],
  ["wrong worker hash", (r) => (r.trace.trace[0].sha256 = "e".repeat(64))],
  ["wrong inventory hash", (r) => (r.trace.trace[1].sha256 = "e".repeat(64))],
  ["wrong retained cache bytes", (r) => (r.after.cached[0].assets[0].sha256 = "e".repeat(64))],
  ["missing partial native write", (r) => (r.pending.cached[1].assets = [])],
  ["failed generation ready", (r) => (r.pending.records[1].status = "ready")],
  ["failed generation activated", (r) => r.terminal.states.push("activated")],
  ["post failure orphan cache", (r) => r.after.cacheNames.push("wavedl-retained-v1-foreign")],
  ["warm reload", (r) => r.pageAfter.timeOrigin++],
  ["fault never released", (r) => (r.trace.trace[3].status = "held")],
  ["wrong refusal", (r) => (r.refusal.reason = "capacity")],
  ["truncated trace", (r) => (r.trace.traceDropped = 1)],
  ["missing cleanup", (r) => delete r.cleanup.ownedRemoved],
  ["fixture failed exit", (r) => (r.cleanup.fixtureExitCode = 1)],
])
  test(`rejects ${label}`, () => {
    const { report, builds } = valid();
    mutate(report);
    assert.throws(() => verifyRollbackReport(report, builds));
  });
test("independent file verifier refuses synthetic producer summary", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "wavedl-rollback-verifier-test-")));
  try {
    const path = join(dir, "summary.json"),
      report = join(dir, "report.json");
    await writeFile(
      path,
      JSON.stringify({ schemaVersion: 1, status: "passed", sourceUnchanged: false, builds: [] }),
    );
    await writeFile(report, JSON.stringify({ fixtureSummary: path }));
    await assert.rejects(verifyRetainedRollbackReport(report, path), /false !== true/);
  } finally {
    await rm(dir, { recursive: true });
  }
});
test("fault injector leaves native worker and storage unmodified", () => {
  assert.match(faultFixtureCode, /status_code=503/);
  assert.match(faultFixtureCode, /secrets.compare_digest/);
  assert.doesNotMatch(faultFixtureCode, /self\.workers\[.*\]\s*=/);
  assert.doesNotMatch(storageExpression, /\.put\(|\.delete\(|readwrite/);
});
