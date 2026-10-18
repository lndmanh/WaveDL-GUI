import test from "node:test";
import assert from "node:assert/strict";
import {
  verifyStreamSparseBrowserReport,
  limitation,
} from "./verify_stream_sparse_browser_report.mjs";

const runId = "11111111-1111-4111-8111-111111111111";
const record = () => ({
  path: `/api/runs/${runId}/events`,
  status: 200,
  browserObserved: false,
  splitBytes: 1000,
  nonAsciiBytes: 0,
  cursor: { attempt: 0, seq: -1 },
  sourceIds: [],
  forwardedIds: [],
  omittedIds: [],
  unicodeAnnotated: false,
  markerCodepointSplits: 0,
  controlResume: null,
  controlFault: null,
});
const report = () => ({
  status: "passed",
  scope: "real-packaged-browser-sparse-stream",
  browserObserved: true,
  localCursor: null,
  limitation,
  runId,
  assetManifestSha256: "a".repeat(64),
  browserRuntime: { userAgent: "Chrome/154.0" },
  rendered: {
    selectedRun: runId,
    diagnostics: "[1:0] QA split UTF-8: sóng 波 🌊\n[1:2]",
    status: "Stream control cannot advertise uncommitted progress",
  },
  rejection: {
    message: "Daemon identity, build or protocol changed.",
    selectedCleared: true,
    credentialEmpty: true,
  },
  records: [
    {
      ...record(),
      sourceIds: [
        [1, 0],
        [1, 1],
        [1, 2],
      ],
      forwardedIds: [
        [1, 0],
        [1, 2],
      ],
      omittedIds: [[1, 1]],
      unicodeAnnotated: true,
      markerCodepointSplits: 6,
      nonAsciiBytes: 12,
      controlResume: { attempt: 1, seq: 2 },
    },
    {
      ...record(),
      cursor: { attempt: 1, seq: 2 },
      controlResume: { attempt: 1, seq: 1002 },
      controlFault: "ahead-uncommitted-cursor",
    },
  ],
  authority: {
    journalIds: [
      [1, 0],
      [1, 1],
      [1, 2],
    ],
    cursors: { 1: 2 },
  },
  cleanup: {
    browserClosed: true,
    fixtureReaped: true,
    servicesClosed: true,
    listenerClosed: true,
    ownedRootsRemoved: true,
  },
});
test("requires actual sparse rendered IDs, Unicode, reconnect and control rejection", () => {
  assert.equal(verifyStreamSparseBrowserReport(report()).aheadControlRejected, true);
});
test("fails closed for forged evidence at each boundary", () => {
  for (const mutate of [
    (r) => (r.browserObserved = false),
    (r) => (r.records[0].browserObserved = true),
    (r) => (r.records[1].cursor.seq = 1002),
    (r) => (r.records[0].nonAsciiBytes = 0),
    (r) => (r.records[0].sourceIds[1] = [1, 0]),
    (r) => (r.rendered.diagnostics = "QA split UTF-8: sóng 波 🌊 [1:0]"),
    (r) => (r.rendered.diagnostics += " [1:1]"),
    (r) => (r.rejection.message = "Event connection: live"),
    (r) => (r.rejection.selectedCleared = false),
    (r) => r.authority.journalIds.pop(),
    (r) => (r.authority.cursors[1] = 1),
    (r) => (r.cleanup.browserClosed = false),
    (r) => (r.localCursor = { attempt: 1, seq: 2 }),
    (r) => (r.limitation = "all attempts proven"),
    (r) => (r.assetManifestSha256 = "missing"),
  ]) {
    const value = report();
    mutate(value);
    assert.throws(() => verifyStreamSparseBrowserReport(value));
  }
});

const namedReject = [
  ["marker codepoint fragmentation missing", (r) => delete r.records[0].markerCodepointSplits],
  ["partial marker fragmentation", (r) => (r.records[0].markerCodepointSplits = 5)],
  ["forged reconnect fragmentation", (r) => (r.records[1].markerCodepointSplits = 6)],
  ["replacement character rendering", (r) => (r.rendered.diagnostics += "\ufffd")],
  ["byte budget exceeded", (r) => (r.records[0].splitBytes = 262145)],
  ["nonfinite byte count", (r) => (r.records[0].splitBytes = Number.NaN)],
  ["impossible Unicode count", (r) => (r.records[0].nonAsciiBytes = 1001)],
  ["unsafe source identity", (r) => (r.records[0].sourceIds[0] = [1, Number.MAX_SAFE_INTEGER + 1])],
  ["unsafe cursor", (r) => (r.records[1].controlResume.seq = Number.MAX_SAFE_INTEGER)],
  ["malformed record shape", (r) => (r.records[0].forwardedIds = ["1:0"])],
  [
    "unexpected sequence",
    (r) =>
      (r.records[0].forwardedIds = [
        [1, 0],
        [1, 1],
      ]),
  ],
  ["replay mismatch", (r) => (r.records[1].cursor = { attempt: 1, seq: 1 })],
  ["foreign journal", (r) => (r.authority.journalIds[0] = [2, 0])],
  ["render marker missing", (r) => (r.rendered.diagnostics = "[1:0] only")],
  ["ahead control already committed", (r) => (r.authority.cursors[1] = 1002)],
  ["ahead control authority beyond injection", (r) => (r.authority.cursors[1] = 1003)],
  ["retirement not observed", (r) => (r.rejection.selectedCleared = false)],
  ["cleanup missing", (r) => (r.cleanup.fixtureReaped = false)],
];
for (const [name, mutate] of namedReject) {
  test(`rejects ${name}`, () => {
    const value = report();
    mutate(value);
    assert.throws(() => verifyStreamSparseBrowserReport(value));
  });
}
