import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { boundedFile } from "./verify_retained_browser_report.mjs";

export const limitation =
  "attempt rollover and post-rejection local cursor are unclaimed; malformed JSON control, Unicode annotation and omission are bounded fixture faults; fatal refusal retires the public monitor so no post-refusal replay cursor is observable; ASGI byte splits do not assert browser network chunk boundaries";
const identity = (id) =>
  Array.isArray(id) &&
  id.length === 2 &&
  id.every(Number.isSafeInteger) &&
  id[0] >= 1 &&
  id[1] >= 0;
const isAfter = (left, right) => left[0] > right[0] || (left[0] === right[0] && left[1] > right[1]);
export function verifyStreamMalformedBrowserReport(report) {
  assert.equal(report.status, "passed");
  assert.equal(report.scope, "real-packaged-browser-malformed-control");
  assert.equal(report.browserObserved, true);
  assert.equal(report.localCursor, null);
  assert.equal(report.limitation, limitation);
  assert(/^[a-f0-9]{64}$/.test(report.assetManifestSha256));
  assert.equal(
    report.assetManifestSha256,
    createHash("sha256")
      .update(
        readFileSync(
          new URL("../src/wavedl_daemon/web_assets/.wavedl-assets.json", import.meta.url),
        ),
      )
      .digest("hex"),
    "Not current packaged assets",
  );
  assert(Number.isSafeInteger(report.quiescence.observedMilliseconds));
  assert(report.quiescence.observedMilliseconds >= 3000);
  assert(report.quiescence.observedMilliseconds <= 30000);
  assert.equal(report.quiescence.streamRequests, 2);
  assert.equal(report.quiescence.rejectedRequests, 0);
  assert(/Chrome\/\d+/.test(report.browserRuntime?.userAgent));
  assert(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(report.runId));
  assert.equal(report.rendered.selectedRun, report.runId);
  assert(report.rendered.diagnostics.includes("QA split UTF-8: sóng 波 🌊"));
  assert(
    report.rejection.message.includes(
      report.fault === "invalid-utf8-control"
        ? "Daemon identity, build or protocol changed."
        : "The daemon returned an invalid response.",
    ),
  );
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
  assert(first.nonAsciiBytes > 0);
  assert.equal(first.controlFault, null);
  assert.equal(first.sourceIds.length, 3);
  assert(first.sourceIds.every(identity));
  assert(
    first.sourceIds.slice(1).every((id, index) => isAfter(id, first.sourceIds[index])),
    "source event IDs must be strictly ordered",
  );
  assert.deepEqual(first.forwardedIds, [first.sourceIds[0], first.sourceIds[2]]);
  assert(
    first.forwardedIds.slice(1).every((id, index) => isAfter(id, first.forwardedIds[index])),
    "forwarded event IDs must be strictly ordered",
  );
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
  const fault = report.fault ?? "malformed-json-truncated-object";
  assert(["malformed-json-truncated-object", "invalid-utf8-control"].includes(fault));
  assert.equal(next.controlFault, fault);
  assert.deepEqual(next.controlResume, { attempt: end[0], seq: end[1] + 1000 });
  if (fault === "invalid-utf8-control") {
    assert.equal(next.controlWire, null);
    const expected = `event: overflow\ndata: {"annotation":"`;
    const wire = Buffer.concat([
      Buffer.from(expected),
      Buffer.from([0xc3, 0x28]),
      Buffer.from(`","resumePosition": {"attempt": ${end[0]}, "seq": ${end[1] + 1000}}}\n\n`),
    ]);
    assert.equal(next.wireHex, wire.toString("hex"));
    assert.equal(next.nonAsciiBytes, 1);
    assert.throws(() => new TextDecoder("utf-8", { fatal: true }).decode(wire));
  } else {
    assert.equal(next.nonAsciiBytes, 0);
    assert.equal(
      next.controlWire,
      `event: overflow\ndata: {"resumePosition": {"attempt": ${end[0]}, "seq": ${end[1] + 1000}}\n\n`,
    );
    assert.throws(() => JSON.parse(next.controlWire.split("data: ")[1].trim()));
  }
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
    malformedControlRejected: true,
  };
}

if (process.argv[1]?.endsWith("verify_stream_malformed_browser_report.mjs")) {
  assert(process.argv[2], "Provide report path");
  const report = JSON.parse((await boundedFile(process.argv[2])).toString("utf8"));
  verifyStreamMalformedBrowserReport(report);
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
  process.stdout.write(
    `${report.fault === "invalid-utf8-control" ? "Invalid UTF-8" : "Malformed JSON control"} refusal browser evidence verified\n`,
  );
}
