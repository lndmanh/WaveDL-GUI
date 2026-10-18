import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { verifyStreamBrowserReport } from "./verify_stream_browser_report.mjs";

function valid() {
  return {
    status: "passed",
    scope: "real-browser-plus-asgi-boundary",
    browserObserved: true,
    localCursor: null,
    browser: "agent-browser 0.26.0",
    assetManifestSha256: "a".repeat(64),
    driverReadinessMode:
      "sync-exposure-poll-and-two-controller-dom-observations",
    limitation:
      "client cursor is observed only through next request; no private storage claim",
    runId: "00000000-0000-4000-8000-000000000001",
    browserRuntime: { userAgent: "Chrome/130" },
    rendered: {
      selectedRun: "00000000-0000-4000-8000-000000000001",
      diagnostics: true,
      historyCanvas: true,
      historySteps: 2,
    },
    diagnosticAccessibility: {
      role: "log", label: "Runtime diagnostics", tabIndex: 0,
      live: "off", plainText: true, overflow: "auto",
    },
    byteFragmentation: 300,
    utf8Observed: false,
    records: [
      {
        path: "/api/runs/00000000-0000-4000-8000-000000000001/events",
        status: 200,
        interrupted: true,
        forwardedIds: [[1, 3]],
        controlResume: { attempt: 1, seq: 3 },
        cursor: { attempt: 0, seq: -1 },
        browserObserved: false,
        splitBytes: 150,
        nonAsciiBytes: 0,
      },
      {
        path: "/api/runs/00000000-0000-4000-8000-000000000001/events",
        status: 200,
        cursor: { attempt: 1, seq: 3 },
        forwardedIds: [[1, 4]],
        interrupted: false,
        browserObserved: false,
        splitBytes: 150,
        nonAsciiBytes: 0,
      },
    ],
    authority: {
      eventCount: 5,
      cursors: { 1: 4 },
      journalIds: [
        [1, 3],
        [1, 4],
      ],
    },
    cleanup: {
      browserClosed: true,
      fixtureReaped: true,
      servicesClosed: true,
      listenerClosed: true,
      ownedRootsRemoved: true,
    },
    retainedWorkspace: null,
  };
}
test("assembled evidence verifies without claiming unobserved UTF-8/local cursor", () => {
  assert.deepEqual(verifyStreamBrowserReport(valid()), {
    scope: "real-browser-plus-asgi-boundary",
    utf8Observed: false,
  });
});
test("fails closed for incorrect replay, local cursor, rendering, UTF8 or cleanup claims", () => {
  for (const mutate of [
    (r) => r.records[1].cursor.seq++,
    (r) => (r.records[1].path = "/api/runs/foreign/events"),
    (r) => (r.localCursor = { attempt: 1, seq: 3 }),
    (r) => (r.rendered.diagnostics = false),
    (r) => delete r.diagnosticAccessibility,
    (r) => (r.diagnosticAccessibility.tabIndex = -1),
    (r) => (r.diagnosticAccessibility.plainText = false),
    (r) => (r.diagnosticAccessibility.role = "region"),
    (r) => (r.diagnosticAccessibility.label = ""),
    (r) => (r.diagnosticAccessibility.live = "polite"),
    (r) => (r.diagnosticAccessibility.overflow = "visible"),
    (r) => (r.utf8Observed = true),
    (r) => (r.cleanup.fixtureReaped = false),
    (r) => (r.authority.journalIds = []),
    (r) => (r.byteFragmentation = 1),
    (r) => r.records.push({ ...r.records[1] }),
    (r) => (r.records[0].cursor = { attempt: 1, seq: 0 }),
    (r) => (r.records[1].forwardedIds = []),
    (r) => (r.records[0].splitBytes = 0),
    (r) => (r.records[1].splitBytes = "150"),
    (r) => (r.records[1].nonAsciiBytes = 151),
    (r) => (r.records[1].nonAsciiBytes = -1),
    (r) => (r.records[1].forwardedIds[0][1] = Number.MAX_SAFE_INTEGER + 1),
    (r) => (r.records[1].forwardedIds[0][0] = 0),
    (r) => (r.records[1].forwardedIds[0] = [1, 3]),
    (r) => (r.records[1].cursor.seq = 3.5),
    (r) => (r.records[0].browserObserved = true),
    (r) => (r.records[1].extra = true),
    (r) => (r.authority.eventCount = "5"),
    (r) => (r.authority.cursors[1] = "4"),
    (r) => (r.authority.journalIds[0][0] = "1"),
  ]) {
    const report = valid();
    mutate(report);
    assert.throws(() => verifyStreamBrowserReport(report));
  }
});


test("fixture spawn failure is sanitized and reports cleanup without browser commands", async () => {
  const workspace = await mkdtemp(
    join(tmpdir(), "wavedl-stream-spawn-contract-"),
  );
  const report = join(workspace, "failure.json");
  const missingInterpreter = join(workspace, "private-missing-python");
  try {
    await assert.rejects(
      promisify(execFile)(
        process.execPath,
        ["tools/run_stream_browser_acceptance.mjs", `--report=${report}`],
        {
          env: {
            ...process.env,
            TMPDIR: workspace,
            WAVEDL_PYTHON: missingInterpreter,
            AGENT_BROWSER_BIN: join(workspace, "must-not-run-browser"),
          },
          timeout: 10000,
        },
      ),
    );
    const bytes = await readFile(report, "utf8");
    assert(!bytes.includes(missingInterpreter));
    const failure = JSON.parse(bytes);
    assert.equal(failure.status, "failed");
    assert.equal(failure.error, "Fixture process could not start");
    assert.equal(failure.browser, undefined);
    assert.equal(failure.retainedWorkspace, null);
    assert.deepEqual(failure.cleanup, {
      browserClosed: true,
      fixtureReaped: true,
      servicesClosed: true,
      listenerClosed: true,
      ownedRootsRemoved: true,
    });
    assert.deepEqual(await readdir(workspace), ["failure.json"]);
  } finally {
    await rm(workspace, { recursive: true, force: false });
  }
});
