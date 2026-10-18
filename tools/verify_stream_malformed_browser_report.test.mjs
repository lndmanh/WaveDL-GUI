import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  verifyStreamMalformedBrowserReport,
  limitation,
} from "./verify_stream_malformed_browser_report.mjs";

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
  controlResume: null,
  controlFault: null,
});
const report = () => ({
  status: "passed",
  scope: "real-packaged-browser-malformed-control",
  browserObserved: true,
  localCursor: null,
  limitation,
  runId,
  assetManifestSha256: createHash("sha256")
    .update(
      readFileSync(new URL("../src/wavedl_daemon/web_assets/.wavedl-assets.json", import.meta.url)),
    )
    .digest("hex"),
  quiescence: { observedMilliseconds: 3000, streamRequests: 2, rejectedRequests: 0 },
  browserRuntime: { userAgent: "Chrome/154.0" },
  rendered: {
    selectedRun: runId,
    diagnostics: "[1:0] QA split UTF-8: sóng 波 🌊\n[1:2]",
    status: "Stream control cannot advertise uncommitted progress",
  },
  rejection: {
    message: "The daemon returned an invalid response.",
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
      nonAsciiBytes: 12,
      controlResume: { attempt: 1, seq: 2 },
    },
    {
      ...record(),
      cursor: { attempt: 1, seq: 2 },
      controlResume: { attempt: 1, seq: 1002 },
      controlFault: "malformed-json-truncated-object",
      controlWire: 'event: overflow\ndata: {"resumePosition": {"attempt": 1, "seq": 1002}\n\n',
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
test("requires actual sparse rendered IDs, Unicode, reconnect and malformed control refusal", () => {
  assert.equal(verifyStreamMalformedBrowserReport(report()).malformedControlRejected, true);
});
test("requires exact invalid UTF-8 transport bytes and fail-closed UI", () => {
  const value = report();
  value.fault = "invalid-utf8-control";
  value.rejection.message = "Daemon identity, build or protocol changed.";
  const next = value.records[1];
  next.controlFault = value.fault;
  next.controlWire = null;
  next.nonAsciiBytes = 1;
  next.wireHex = Buffer.concat([
    Buffer.from('event: overflow\ndata: {"annotation":"'),
    Buffer.from([0xc3, 0x28]),
    Buffer.from('","resumePosition": {"attempt": 1, "seq": 1002}}\n\n'),
  ]).toString("hex");
  assert.equal(verifyStreamMalformedBrowserReport(value).malformedControlRejected, true);
  for (const mutate of [
    (r) => (r.records[1].wireHex = Buffer.from("valid UTF8").toString("hex")),
    (r) => (r.records[1].nonAsciiBytes = 0),
    (r) => (r.rejection.credentialEmpty = false),
    (r) => (r.quiescence.streamRequests = 3),
  ]) {
    const changed = structuredClone(value);
    mutate(changed);
    assert.throws(() => verifyStreamMalformedBrowserReport(changed));
  }
});
test("fails closed for forged evidence at each boundary", () => {
  for (const mutate of [
    (r) => (r.browserObserved = false),
    (r) => (r.records[0].browserObserved = true),
    (r) => (r.records[1].cursor.seq = 1002),
    (r) => (r.records[0].nonAsciiBytes = 0),
    (r) => (r.records[0].sourceIds[1] = [1, 0]),
    (r) => r.records[0].sourceIds.reverse(),
    (r) => r.records[0].forwardedIds.reverse(),
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
    (r) => (r.quiescence.rejectedRequests = 1),
    (r) => (r.quiescence.streamRequests = 3),
    (r) => (r.quiescence.observedMilliseconds = 2999),
    (r) => (r.records[1].controlWire = "event: overflow\ndata: {}\n\n"),
  ]) {
    const value = report();
    mutate(value);
    assert.throws(() => verifyStreamMalformedBrowserReport(value));
  }
});

const namedReject = [
  [
    "well-formed instead of malformed control",
    (r) => (r.records[1].controlWire = "event: overflow\ndata: {}\n\n"),
  ],
  ["stale packaged asset hash", (r) => (r.assetManifestSha256 = "0".repeat(64))],
  ["retry after refusal", (r) => (r.quiescence.rejectedRequests = 1)],
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
  ["retirement not observed", (r) => (r.rejection.selectedCleared = false)],
  ["cleanup missing", (r) => (r.cleanup.fixtureReaped = false)],
];
for (const [name, mutate] of namedReject) {
  test(`rejects ${name}`, () => {
    const value = report();
    mutate(value);
    assert.throws(() => verifyStreamMalformedBrowserReport(value));
  });
}
