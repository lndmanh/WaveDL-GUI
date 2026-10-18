import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { verifyNativeSseSplitReport } from "./verify_native_sse_split_report.mjs";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function valid() {
  const padding = Buffer.from(`: native-split-padding ${" ".repeat(4096)}\r\n`);
  const frame = Buffer.concat([padding, Buffer.from("QA native split: sóng 波 🌊\r\n\r\n")]);
  const offsets = [frame.indexOf(Buffer.from("ó")) + 1, frame.length - 1];
  const pieces = [
    frame.subarray(0, offsets[0]),
    frame.subarray(offsets[0], offsets[1]),
    frame.subarray(offsets[1]),
  ];
  const wire = {
    index: 0,
    paddingSize: padding.length,
    paddingSha256: hash(padding),
    suppressedCommentCount: 0,
    suppressedCommentBytes: 0,
    suppressedCommentSha256: hash(Buffer.from("")),
    cursor: { attempt: 0, seq: -1 },
    status: 200,
    authenticated: true,
    scoped: true,
    sourceIds: [[1, 0]],
    releases: [1, 2],
    stage: 3,
    controlResume: { attempt: 1, seq: 0 },
    frameSize: frame.length,
    frameSha256: hash(frame),
    splitOffsets: offsets,
    splitBytes: [
      [195, 179],
      [13, 10],
    ],
    pieces: pieces.map((bytes, index) => ({
      index,
      size: bytes.length,
      sha256: hash(bytes),
      prefixSize: pieces.slice(0, index + 1).reduce((sum, item) => sum + item.length, 0),
      prefixSha256: hash(Buffer.concat(pieces.slice(0, index + 1))),
    })),
  };
  const control = Buffer.from(
    'event: overflow\ndata: {"resumePosition": {"attempt": 1, "seq": 0}}\n\n',
  );
  wire.wireSize = frame.length + control.length;
  wire.wireSha256 = hash(Buffer.concat([frame, control]));
  const probe = (n) => ({
    scope: "instrumented-native-sse-read-results",
    streams: [
      {
        index: 0,
        bytes: pieces.slice(0, n).reduce((sum, item) => sum + item.length, 0),
        reads: n,
        done: n === 3,
        canceled: n === 3,
        sha256: hash(Buffer.concat(pieces.slice(0, n))),
      },
    ],
    chunks: pieces
      .slice(0, n)
      .map((bytes, index) => ({
        stream: 0,
        index,
        offset: index ? wire.pieces[index - 1].prefixSize : 0,
        length: bytes.length,
        sha256: hash(bytes),
        sseLike: index === 0,
        first: index === 1 ? 179 : index === 2 ? 10 : null,
        last: index === 0 ? 195 : index === 1 ? 13 : null,
      })),
  });
  const report = {
    status: "passed",
    scope: "instrumented-native-sse-split",
    browserObserved: true,
    assetManifestSha256: "a".repeat(64),
    runId: "11111111-1111-4111-8111-111111111111",
    browserRuntime: { userAgent: "Chrome/150" },
    localCursor: null,
    limitation:
      "instrumented native reader QA probe only; no remote, Slurm or uninstrumented package claim",
    nativeReaderInstrumentation:
      "ReadableStreamDefaultReader.read wrapper; native results and receiver preserved",
    nativeProbe: probe(3),
    prefixObservations: [1, 2].map((n) => ({
      streamIndex: 0,
      wire: { ...structuredClone(wire), stage: n, pieces: wire.pieces.slice(0, n) },
      native: probe(n),
    })),
    nativeSplitWitness: { utf8: true, crlf: true },
    records: [
      wire,
      {
        index: 1,
        cursor: { attempt: 1, seq: 0 },
        status: 200,
        authenticated: true,
        scoped: true,
        sourceIds: [[1, 1]],
      },
    ],
    rendered: {
      selectedRun: "11111111-1111-4111-8111-111111111111",
      diagnostics: "QA native split: sóng 波 🌊",
      historySteps: 1,
      historyCanvas: true,
    },
    authority: {
      eventCount: 2,
      metricCount: 1,
      cursors: { 1: 1 },
      journalIds: [
        [1, 0],
        [1, 1],
      ],
    },
    cleanup: {
      browserClosed: true,
      fixtureReaped: true,
      servicesClosed: true,
      listenerClosed: true,
      ownedRootsRemoved: true,
    },
  };
  report.nativeProbe.ranges = wire.pieces.map((piece, index) => ({
    stream: 0,
    start: index ? wire.pieces[index - 1].prefixSize : 0,
    end: piece.prefixSize,
    sha256: piece.sha256,
  }));
  report.nativeProbe.ranges.push({ stream: 0, start: 0, end: padding.length, sha256: hash(padding) });
  report.nativeProbe.streams[0].bytes = wire.wireSize;
  report.nativeProbe.streams[0].sha256 = wire.wireSha256;
  report.nativeProbe.chunks[2].length += control.length;
  report.nativeProbe.chunks[2].sha256 = hash(Buffer.concat([pieces[2], control]));
  return report;
}
test("accepts hash-bound actual native prefix and continuation witness", () =>
  verifyNativeSseSplitReport(valid()));
const attacks = [
  (r) => (r.status = "failed"),
  (r) => (r.error = ""),
  (r) => (r.skipped = false),
  (r) => (r.assetManifestSha256 = "bad"),
  (r) => (r.runId = "foreign"),
  (r) => (r.nativeProbe.chunks = []),
  (r) => (r.nativeSplitWitness.utf8 = false),
  (r) => r.nativeProbe.chunks[1].offset++,
  (r) => (r.nativeProbe.chunks[0].index = 1),
  (r) => (r.nativeProbe.chunks[1].first = 10),
  (r) => (r.prefixObservations[0].native.streams[0].sha256 = "b".repeat(64)),
  (r) => r.prefixObservations[1].native.streams[0].bytes++,
  (r) => (r.records[0].authenticated = false),
  (r) => (r.records[1].cursor.seq = 100),
  (r) => r.records[0].releases.pop(),
  (r) => r.authority.journalIds.pop(),
  (r) => (r.authority.metricCount = 0),
  (r) => (r.authority.cursors[1] = 0),
  (r) => (r.rendered.selectedRun = "other"),
  (r) => (r.rendered.diagnostics += "\ufffd"),
  (r) => (r.cleanup.ownedRootsRemoved = false),
  (r) => (r.cleanup.listenerClosed = false),
  (r) => (r.retainedWorkspace = "/owned"),
];
for (const [index, mutate] of attacks.entries())
  test(`rejects native witness mutation ${index}`, () => {
    const report = valid();
    mutate(report);
    assert.throws(() => verifyNativeSseSplitReport(report));
  });
for (const [name, mutate] of [
  ["final native chunk digest", (r) => (r.nativeProbe.chunks[0].sha256 = "f".repeat(64))],
  ["known LF and control suffix digest", (r) => (r.nativeProbe.chunks[2].sha256 = "f".repeat(64))],
  ["final stream digest", (r) => (r.nativeProbe.streams[0].sha256 = "f".repeat(64))],
  ["piece digest", (r) => (r.records[0].pieces[1].sha256 = "f".repeat(64))],
  ["range digest", (r) => (r.nativeProbe.ranges[1].sha256 = "f".repeat(64))],
  ["padding digest", (r) => (r.nativeProbe.ranges[3].sha256 = "f".repeat(64))],
  ["padding byte count", (r) => r.records[0].paddingSize++],
  ["suppressed prelude byte count", (r) => r.records[0].suppressedCommentBytes++],
  ["suppressed prelude digest", (r) => r.records[0].suppressedCommentSha256 = "f".repeat(64)],
  ["missing native cancellation", (r) => delete r.nativeProbe.streams[0].canceled],
  ["unsuccessful native cancellation", (r) => r.nativeProbe.streams[0].canceled = false],
])
  test(`rejects detached ${name}`, () => {
    const report = valid();
    mutate(report);
    assert.throws(() => verifyNativeSseSplitReport(report));
  });
test("pending cleanup is validated only through a projected copy, final reports still require true", () => {
  const report = valid();
  report.cleanup.ownedRootsRemoved = false;
  assert.throws(() => verifyNativeSseSplitReport(report));
  verifyNativeSseSplitReport({
    ...report,
    cleanup: { ...report.cleanup, ownedRootsRemoved: true },
  });
  assert.equal(report.cleanup.ownedRootsRemoved, false);
});
