import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { boundedFile } from "./verify_retained_browser_report.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const id = (value) =>
  Array.isArray(value) && value.length === 2 && count(value[0]) && value[0] > 0 && count(value[1]);
function native(value) {
  assert.equal(value.scope, "instrumented-native-sse-read-results");
  assert(value.streams.length >= 1 && value.streams.length <= 16 && value.chunks.length <= 4096);
  for (const [index, stream] of value.streams.entries()) {
    assert.equal(stream.index, index);
    assert(count(stream.bytes) && stream.bytes <= 8388608);
    assert(count(stream.reads) && typeof stream.done === "boolean" && typeof stream.canceled === "boolean" && digest(stream.sha256));
    const chunks = value.chunks.filter((chunk) => chunk.stream === index);
    assert.equal(chunks.length, stream.reads);
    let offset = 0;
    for (const [position, chunk] of chunks.entries()) {
      assert.equal(chunk.index, position);
      assert.equal(chunk.offset, offset);
      assert(count(chunk.length) && chunk.length <= 8388608 && digest(chunk.sha256));
      assert(typeof chunk.sseLike === "boolean");
      for (const byte of [chunk.first, chunk.last])
        assert(byte === null || (Number.isInteger(byte) && byte >= 0 && byte <= 255));
      offset += chunk.length;
    }
    assert.equal(offset, stream.bytes);
  }
  assert(value.chunks.every((chunk) => count(chunk.stream) && chunk.stream < value.streams.length));
}
export function verifyNativeSseSplitReport(report) {
  for (const key of [
    "error",
    "shutdownError",
    "skip",
    "skipped",
    "skipReason",
    "failed",
    "retainedWorkspace",
    "failure",
    "nativeDebug",
  ])
    assert(!Object.hasOwn(report, key));
  assert.equal(report.status, "passed");
  assert.equal(report.scope, "instrumented-native-sse-split");
  assert.equal(report.browserObserved, true);
  assert(digest(report.assetManifestSha256));
  assert(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(report.runId));
  assert(/Chrome\/\d+/.test(report.browserRuntime.userAgent));
  assert.equal(report.localCursor, null);
  assert.equal(
    report.limitation,
    "instrumented native reader QA probe only; no remote, Slurm or uninstrumented package claim",
  );
  assert.equal(
    report.nativeReaderInstrumentation,
    "ReadableStreamDefaultReader.read wrapper; native results and receiver preserved",
  );
  native(report.nativeProbe);
  assert(Array.isArray(report.nativeProbe.ranges) && report.nativeProbe.ranges.length === 4);
  assert.equal(report.records.length, 2);
  const [first, next] = report.records;
  const padding = Buffer.from(`: native-split-padding ${" ".repeat(4096)}\r\n`);
  assert.equal(first.paddingSize, padding.length);
  assert.equal(first.paddingSha256, hash(padding));
  assert(count(first.suppressedCommentCount) && first.suppressedCommentCount <= 64);
  const prelude = Buffer.from(": heartbeat\n\n".repeat(first.suppressedCommentCount));
  assert.equal(first.suppressedCommentBytes, prelude.length);
  assert.equal(first.suppressedCommentSha256, hash(prelude));
  assert.equal(report.nativeProbe.ranges[3].start, 0);
  assert.equal(report.nativeProbe.ranges[3].end, first.paddingSize);
  assert.equal(report.nativeProbe.ranges[3].sha256, first.paddingSha256);
  assert(first.splitOffsets[0] > first.paddingSize);
  for (const [index, record] of report.records.entries()) {
    assert.equal(record.index, index);
    assert.equal(record.status, 200);
    assert.equal(record.authenticated, true);
    assert.equal(record.scoped, true);
    assert(
      record.sourceIds.length > 0 && record.sourceIds.length <= 4096 && record.sourceIds.every(id),
    );
    for (const identity of record.sourceIds) {
      assert(
        report.authority.journalIds.some(
          (item) => item[0] === identity[0] && item[1] === identity[1],
        ),
      );
      assert(report.authority.cursors[String(identity[0])] >= identity[1]);
    }
  }
  assert.deepEqual(first.cursor, { attempt: 0, seq: -1 });
  assert.equal(first.sourceIds.length, 1);
  assert.deepEqual(first.controlResume, {
    attempt: first.sourceIds[0][0],
    seq: first.sourceIds[0][1],
  });
  assert.deepEqual(next.cursor, first.controlResume);
  assert(
    next.sourceIds.every(
      (item) =>
        item[0] > next.cursor.attempt ||
        (item[0] === next.cursor.attempt && item[1] > next.cursor.seq),
    ),
  );
  assert.deepEqual(first.releases, [1, 2]);
  assert.equal(first.stage, 3);
  assert.equal(first.pieces.length, 3);
  assert.equal(first.splitOffsets.length, 2);
  assert.deepEqual(first.splitBytes, [
    [0xc3, 0xb3],
    [0x0d, 0x0a],
  ]);
  let prefix = 0;
  for (const [index, piece] of first.pieces.entries()) {
    assert.equal(piece.index, index);
    assert(count(piece.size) && piece.size > 0);
    assert(digest(piece.sha256) && digest(piece.prefixSha256));
    prefix += piece.size;
    assert.equal(piece.prefixSize, prefix);
    if (index < 2) assert.equal(first.splitOffsets[index], prefix);
    const range = report.nativeProbe.ranges[index];
    assert.equal(range.start, index ? first.pieces[index - 1].prefixSize : 0);
    assert.equal(range.end, piece.prefixSize);
    assert.equal(range.sha256, piece.sha256);
  }
  assert(first.frameSize <= 262144 && first.frameSize === prefix && digest(first.frameSha256));
  assert.equal(first.pieces[2].size, 1);
  assert.equal(first.pieces[2].sha256, hash(Buffer.from([10])));
  assert.equal(first.pieces[2].prefixSha256, first.frameSha256);
  const controlBytes = Buffer.from(
    `event: overflow\ndata: {"resumePosition": {"attempt": ${first.controlResume.attempt}, "seq": ${first.controlResume.seq}}}\n\n`,
  );
  assert.equal(first.wireSize, first.frameSize + controlBytes.length);
  assert.equal(first.wireSize - first.frameSize, controlBytes.byteLength);
  assert(digest(first.wireSha256));
  assert.equal(report.prefixObservations.length, 2);
  let streamIndex;
  for (const [index, observation] of report.prefixObservations.entries()) {
    native(observation.native);
    assert.equal(observation.wire.stage, index + 1);
    assert.deepEqual(observation.wire.pieces, first.pieces.slice(0, index + 1));
    assert(count(observation.streamIndex));
    if (index === 0) streamIndex = observation.streamIndex;
    else assert.equal(observation.streamIndex, streamIndex);
    const stream = observation.native.streams[streamIndex],
      piece = first.pieces[index];
    assert.equal(stream.bytes, piece.prefixSize);
    assert.equal(stream.sha256, piece.prefixSha256);
    const chunks = observation.native.chunks.filter((chunk) => chunk.stream === streamIndex);
    assert.equal(chunks.at(-1).last, index === 0 ? 0xc3 : 0x0d);
    assert.equal(chunks.at(-1).offset + chunks.at(-1).length, piece.prefixSize);
  }
  const chunks = report.nativeProbe.chunks.filter((chunk) => chunk.stream === streamIndex);
  // After the witnessed CR boundary, all remaining bytes are known: the LF
  // completing that frame followed by the genuine-cursor overflow control.
  // Hash each actual native read against its exact subrange, even when the
  // browser subdivides/coalesces those suffix bytes differently.
  const suffixStart = first.splitOffsets[1];
  const suffix = Buffer.concat([Buffer.from([0x0a]), controlBytes]);
  for (const chunk of chunks.filter((item) => item.offset >= suffixStart)) {
    const offset = chunk.offset - suffixStart;
    assert(offset + chunk.length <= suffix.length);
    assert.equal(chunk.sha256, hash(suffix.subarray(offset, offset + chunk.length)));
  }
  const finalStream = report.nativeProbe.streams[streamIndex];
  assert.equal(finalStream.bytes, first.wireSize);
  assert.equal(finalStream.sha256, first.wireSha256);
  // Overflow recovery leaves through finally/cancel, not a natural EOF read.
  assert.equal(finalStream.canceled, true);
  assert(report.nativeProbe.ranges.every((range) => range.stream === streamIndex));
  for (const observation of report.prefixObservations) {
    const original = observation.native.chunks.filter((chunk) => chunk.stream === streamIndex);
    assert.deepEqual(chunks.slice(0, original.length), original);
  }
  for (const [index, offset] of first.splitOffsets.entries()) {
    const previous = chunks.find((chunk) => chunk.offset + chunk.length === offset);
    const following = chunks.find((chunk) => chunk.offset === offset);
    assert(previous && following);
    assert.equal(following.index, previous.index + 1);
    assert.equal(previous.last, first.splitBytes[index][0]);
    assert.equal(following.first, first.splitBytes[index][1]);
  }
  assert.deepEqual(report.nativeSplitWitness, { utf8: true, crlf: true });
  assert.equal(report.rendered.selectedRun, report.runId);
  assert(
    report.rendered.diagnostics.includes("QA native split: sóng 波 🌊") &&
      !report.rendered.diagnostics.includes("\ufffd"),
  );
  assert(
    count(report.rendered.historySteps) &&
      report.rendered.historySteps > 0 &&
      report.rendered.historyCanvas === true,
  );
  assert(count(report.authority.metricCount) && report.authority.metricCount > 0);
  assert(
    count(report.authority.eventCount) &&
      report.authority.eventCount >= report.authority.metricCount,
  );
  assert(
    report.authority.journalIds.length > 0 &&
      report.authority.journalIds.length <= 8192 &&
      report.authority.journalIds.every(id),
  );
  assert.deepEqual(report.cleanup, {
    browserClosed: true,
    fixtureReaped: true,
    servicesClosed: true,
    listenerClosed: true,
    ownedRootsRemoved: true,
  });
  return true;
}
export async function verifyNativeSseSplitFile(path) {
  const report = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(await boundedFile(path, 1048576)),
  );
  verifyNativeSseSplitReport(report);
  await verifyNativeSseSplitAssets(report);
  return report;
}
export async function verifyNativeSseSplitAssets(report) {
  const root = new URL("../src/wavedl_daemon/web_assets/", import.meta.url);
  const bytes = await readFile(new URL(".wavedl-assets.json", root)),
    map = JSON.parse(bytes);
  assert(Object.keys(map).length > 20);
  assert.equal(report.assetManifestSha256, hash(bytes));
  for (const [path, expected] of Object.entries(map)) {
    assert(
      path.split("/").every((part) => part && part !== "." && part !== "..") &&
        !/[\\:%]/.test(path),
    );
    assert.equal(hash(await boundedFile(fileURLToPath(new URL(path, root)), 16777216)), expected);
  }
  return true;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyNativeSseSplitFile(process.argv[2]);
  console.log("instrumented native SSE split report: valid");
}
