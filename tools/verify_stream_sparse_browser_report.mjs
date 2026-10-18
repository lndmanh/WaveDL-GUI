import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { boundedFile } from "./verify_retained_browser_report.mjs";

export const limitation =
  "attempt rollover and post-rejection local cursor are unclaimed; Unicode annotation, event omission and controls are bounded fixture faults; ASGI byte splits do not assert browser network chunk boundaries";
const identity = (id) =>
  Array.isArray(id) &&
  id.length === 2 &&
  id.every(Number.isSafeInteger) &&
  id[0] >= 1 &&
  id[1] >= 0;
export function verifyStreamSparseBrowserReport(report) {
  assert.equal(report.status, "passed");
  assert.equal(report.scope, "real-packaged-browser-sparse-stream");
  assert.equal(report.browserObserved, true);
  assert.equal(report.localCursor, null);
  assert.equal(report.limitation, limitation);
  assert(/^[a-f0-9]{64}$/.test(report.assetManifestSha256));
  assert(/Chrome\/\d+/.test(report.browserRuntime?.userAgent));
  assert(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(report.runId));
  assert.equal(report.rendered.selectedRun, report.runId);
  assert(report.rendered.diagnostics.includes("QA split UTF-8: sóng 波 🌊"));
  assert(!report.rendered.diagnostics.includes("\ufffd"));
  assert(report.rejection.message.includes("Daemon identity, build or protocol changed."));
  assert.equal(report.rejection.selectedCleared, true);
  assert.equal(report.rejection.credentialEmpty, true);
  assert(Array.isArray(report.records) && report.records.length === 2);
  const [first, next] = report.records;
  for (const record of report.records) {
    assert.equal(record.status, 200);
    assert.equal(record.browserObserved, false);
    assert.equal(record.path, `/api/runs/${report.runId}/events`);
    assert(
      Number.isSafeInteger(record.splitBytes) &&
        record.splitBytes > 0 &&
        record.splitBytes <= 262144,
    );
    assert(
      Number.isSafeInteger(record.nonAsciiBytes) &&
        record.nonAsciiBytes >= 0 &&
        record.nonAsciiBytes <= record.splitBytes,
    );
  }
  assert.deepEqual(first.cursor, { attempt: 0, seq: -1 });
  assert.equal(first.unicodeAnnotated, true);
  // ó, 波 and 🌊 cross 1 + 2 + 3 one-byte ASGI body boundaries.
  assert.equal(first.markerCodepointSplits, 6);
  assert(first.nonAsciiBytes > 0);
  assert.equal(first.controlFault, null);
  assert.equal(first.sourceIds.length, 3);
  assert(first.sourceIds.every(identity));
  assert.deepEqual(first.forwardedIds, [first.sourceIds[0], first.sourceIds[2]]);
  assert.deepEqual(first.omittedIds, [first.sourceIds[1]]);
  const [start, omitted, end] = first.sourceIds;
  assert(start[0] === omitted[0] && omitted[0] === end[0]);
  assert(start[1] < omitted[1] && omitted[1] < end[1]);
  assert.deepEqual(first.controlResume, { attempt: end[0], seq: end[1] });
  assert.deepEqual(next.cursor, first.controlResume);
  assert.deepEqual(next.forwardedIds, []);
  assert.deepEqual(next.sourceIds, []);
  assert.deepEqual(next.omittedIds, []);
  assert.equal(next.unicodeAnnotated, false);
  assert.equal(next.markerCodepointSplits, 0);
  assert.equal(next.nonAsciiBytes, 0);
  assert.equal(next.controlFault, "ahead-uncommitted-cursor");
  assert.deepEqual(next.controlResume, { attempt: end[0], seq: end[1] + 1000 });
  // The injected control is intentionally ahead of durable authority; treating
  // an already-committed cursor as a rejection would not exercise the guard.
  const committed = report.authority.cursors[String(end[0])];
  assert(Number.isSafeInteger(committed) && committed < next.controlResume.seq);
  for (const id of first.forwardedIds)
    assert(report.rendered.diagnostics.includes(`[${id[0]}:${id[1]}]`));
  assert(!report.rendered.diagnostics.includes(`[${omitted[0]}:${omitted[1]}]`));
  assert(Array.isArray(report.authority.journalIds) && report.authority.journalIds.length <= 4096);
  assert(report.authority.journalIds.every(identity));
  for (const id of first.sourceIds) {
    assert(report.authority.journalIds.some((other) => other[0] === id[0] && other[1] === id[1]));
    const committed = report.authority.cursors[String(id[0])];
    assert(Number.isSafeInteger(committed) && committed >= id[1]);
  }
  assert.deepEqual(report.cleanup, {
    browserClosed: true,
    fixtureReaped: true,
    servicesClosed: true,
    listenerClosed: true,
    ownedRootsRemoved: true,
  });
  return {
    scope: report.scope,
    sparseRendered: true,
    unicodeRendered: true,
    aheadControlRejected: true,
  };
}

if (process.argv[1]?.endsWith("verify_stream_sparse_browser_report.mjs")) {
  assert(process.argv[2], "Provide report path");
  const report = JSON.parse((await boundedFile(process.argv[2])).toString("utf8"));
  verifyStreamSparseBrowserReport(report);
  assert.equal(
    report.assetManifestSha256,
    createHash("sha256")
      .update(
        await readFile(
          new URL("../src/wavedl_daemon/web_assets/.wavedl-assets.json", import.meta.url),
        ),
      )
      .digest("hex"),
    "Not current packaged assets",
  );
  process.stdout.write("Sparse Unicode and ahead-control browser evidence verified\n");
}
