import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { boundedFile } from "./verify_retained_browser_report.mjs";

const MAX_FRAMES = 4096;
const MAX_SPLIT_BYTES = 16 * 1024 * 1024;
const safeCount = (value, maximum = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const validIdentity = (id) =>
  Array.isArray(id) &&
  id.length === 2 &&
  safeCount(id[0]) &&
  id[0] >= 1 &&
  safeCount(id[1]);
const advances = (id, cursor) =>
  id[0] > cursor.attempt || (id[0] === cursor.attempt && id[1] > cursor.seq);

export function verifyStreamBrowserReport(report) {
  assert.equal(report.status, "passed");
  assert.equal(report.scope, "real-browser-plus-asgi-boundary");
  assert.equal(report.browserObserved, true);
  assert.equal(report.browser, "agent-browser 0.26.0");
  assert.equal(
    report.driverReadinessMode,
    "sync-exposure-poll-and-two-controller-dom-observations",
  );
  assert(/^[a-f0-9]{64}$/.test(report.assetManifestSha256));
  assert(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(report.runId));
  assert.equal(report.localCursor, null);
  assert(/Chrome\/\d+/.test(report.browserRuntime?.userAgent));
  assert.equal(report.rendered.selectedRun, report.runId);
  assert(
    report.rendered.diagnostics &&
      report.rendered.historyCanvas &&
      report.rendered.historySteps > 0,
  );
  assert.deepEqual(report.diagnosticAccessibility, {
    role: "log",
    label: "Runtime diagnostics",
    tabIndex: 0,
    live: "off",
    plainText: true,
    overflow: "auto",
  });
  assert(Array.isArray(report.records) && report.records.length === 2);
  assert(
    safeCount(report.byteFragmentation, 2 * MAX_SPLIT_BYTES) &&
      report.byteFragmentation > 0,
  );
  let splitBytes = 0;
  for (const [index, record] of report.records.entries()) {
    assert(record && typeof record === "object" && !Array.isArray(record));
    assert.deepEqual(
      Object.keys(record).sort(),
      [
        "path",
        "cursor",
        "status",
        "forwardedIds",
        "interrupted",
        "browserObserved",
        "splitBytes",
        "nonAsciiBytes",
        ...(index === 0 ? ["controlResume"] : []),
      ].sort(),
    );
    assert.equal(record.status, 200);
    assert.equal(record.interrupted, index === 0);
    assert.equal(record.browserObserved, false);
    assert.deepEqual(Object.keys(record.cursor).sort(), ["attempt", "seq"]);
    assert(
      safeCount(record.cursor.attempt) &&
        Number.isSafeInteger(record.cursor.seq),
    );
    assert(
      record.cursor.seq >= -1 &&
        (record.cursor.attempt !== 0 || record.cursor.seq === -1),
    );
    assert(
      safeCount(record.splitBytes, MAX_SPLIT_BYTES) && record.splitBytes > 0,
    );
    assert(safeCount(record.nonAsciiBytes, record.splitBytes));
    splitBytes += record.splitBytes;
    assert(
      Array.isArray(record.forwardedIds) &&
        record.forwardedIds.length > 0 &&
        record.forwardedIds.length <= MAX_FRAMES,
    );
    let previous = record.cursor;
    for (const id of record.forwardedIds) {
      assert(validIdentity(id) && advances(id, previous));
      previous = { attempt: id[0], seq: id[1] };
    }
  }
  assert.equal(report.byteFragmentation, splitBytes);
  assert.equal(
    report.utf8Observed,
    report.records.some((record) => record.nonAsciiBytes > 0),
  );
  const [first, next] = report.records;
  assert.deepEqual(first.cursor, { attempt: 0, seq: -1 });
  const last = first.forwardedIds.at(-1);
  assert(last && last[0] >= 1 && last[1] >= 0);
  assert.deepEqual(first.controlResume, { attempt: last[0], seq: last[1] });
  assert.deepEqual(next.cursor, first.controlResume);
  assert(
    safeCount(report.authority.eventCount) && report.authority.eventCount > 0,
  );
  assert(
    Array.isArray(report.authority.journalIds) &&
      report.authority.journalIds.length <= 2 * MAX_FRAMES,
  );
  assert(report.authority.journalIds.every(validIdentity));
  for (const record of report.records) {
    assert.equal(record.path, `/api/runs/${report.runId}/events`);
    for (const id of record.forwardedIds) {
      assert(
        safeCount(report.authority.cursors[String(id[0])]) &&
          report.authority.cursors[String(id[0])] >= id[1],
      );
      assert(
        report.authority.journalIds.some(
          (entry) => entry[0] === id[0] && entry[1] === id[1],
        ),
      );
    }
  }
  assert.deepEqual(report.cleanup, {
    browserClosed: true,
    fixtureReaped: true,
    servicesClosed: true,
    listenerClosed: true,
    ownedRootsRemoved: true,
  });
  assert.equal(report.retainedWorkspace, null);
  assert.equal(
    report.limitation,
    "client cursor is observed only through next request; no private storage claim",
  );
  return { scope: report.scope, utf8Observed: report.utf8Observed };
}

export async function verifyStreamBrowserFile(path) {
  const report = JSON.parse((await boundedFile(path)).toString("utf8"));
  verifyStreamBrowserReport(report);
  const manifest = await readFile(
    new URL(
      "../src/wavedl_daemon/web_assets/.wavedl-assets.json",
      import.meta.url,
    ),
  );
  assert.equal(
    report.assetManifestSha256,
    createHash("sha256").update(manifest).digest("hex"),
    "Not current packaged assets",
  );
  return report;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  assert(process.argv[2], "Provide the dedicated stream JSON report path");
  await verifyStreamBrowserFile(process.argv[2]);
  process.stdout.write("Browser stream boundary evidence verified\n");
}
