import assert from "node:assert/strict";
import { boundedFile } from "./browser_files.mjs";
import { DRIVER_READINESS_MODE } from "./browser_actions.mjs";
import { boundedCommand } from "./browser_process.mjs";

export const stages = [
  { name: "queued", badge: "queued", attempt: 1, pending: true, emptyMetrics: true },
  { name: "held", badge: "held", attempt: 1, pending: true, emptyMetrics: true },
  { name: "running", badge: "running", attempt: 1, pending: false },
  {
    name: "accounting-unavailable",
    badge: "observation unavailable · uncertain",
    attempt: 1,
    pending: false,
  },
  { name: "accounting-absent", badge: "terminal unknown · uncertain", attempt: 1, pending: false },
  { name: "delayed-terminal", badge: "running · uncertain", attempt: 1, pending: false },
  {
    name: "lifecycle-stale",
    badge: "running · last observed, stale",
    attempt: 1,
    pending: false,
    emptyMetrics: true,
  },
  { name: "restart-pending", badge: "queued", attempt: 2, pending: true, emptyMetrics: true },
  { name: "restart-running", badge: "running", attempt: 2, pending: false, emptyMetrics: true },
  {
    name: "supervision-lost",
    badge: "supervision lost · uncertain",
    attempt: 2,
    pending: false,
    emptyMetrics: true,
  },
];
export const limitation =
  "Backend states, native identities, restart attempts and a runtime exit are injected reducer-derived response-boundary faults. Real local attempt-one SSE supplies history only; no actual native restart, Slurm, remote site, Windows, GPU or hosted CI acceptance is claimed.";
const uuid = (value) =>
  typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
export function verifyDashboardStateBrowserReport(report) {
  assert.equal(report.status, "passed");
  assert.equal(report.scope, "real-packaged-browser-dashboard-states");
  assert.equal(report.limitation, limitation);
  assert.equal(report.driverReadinessMode, DRIVER_READINESS_MODE);
  assert(uuid(report.runId));
  assert(/^[a-f0-9]{64}$/.test(report.assetManifestSha256));
  assert.equal(report.assetPreflight?.manifestSha256, report.assetManifestSha256);
  assert.deepEqual(report.assetPostflight, report.assetPreflight);
  assert(Object.keys(report.assetPreflight.assets).length > 20);
  assert(
    Object.values(report.assetPreflight.assets).every((value) => /^[a-f0-9]{64}$/.test(value)),
  );
  assert(/Chrome\/\d+/.test(report.browserRuntime?.userAgent));
  assert(Array.isArray(report.observations) && report.observations.length === stages.length);
  assert.equal(report.boundary?.scope, "authenticated-response-injection");
  assert(
    Array.isArray(report.boundary.records) &&
      report.boundary.records.length >= stages.length &&
      report.boundary.records.length <= 512,
  );
  let previousStage = 0;
  let planId = null,
    requestId = null;
  for (const record of report.boundary.records) {
    assert(
      Number.isSafeInteger(record.stage) &&
        record.stage >= previousStage &&
        record.stage <= previousStage + 1 &&
        record.stage < stages.length,
    );
    previousStage = record.stage;
    const expected = stages[record.stage];
    assert.equal(record.name, expected.name);
    assert.equal(record.path, `/api/runs/${report.runId}`);
    assert.equal(record.status, expected.name === "lifecycle-stale" ? 503 : 200);
    assert.equal(record.view.run_id, report.runId);
    assert(uuid(record.view.plan_id) && uuid(record.view.request_id));
    planId ??= record.view.plan_id;
    requestId ??= record.view.request_id;
    assert.equal(record.view.plan_id, planId);
    assert.equal(record.view.request_id, requestId);
    assert.equal(record.view.operation, "train");
    assert.equal(record.view.backend, "slurm");
    assert.equal(record.view.attempt, expected.attempt);
    assert.equal(record.view.evidence.native_pending, expected.pending);
    assert.deepEqual(record.view.evidence.native_identity, {
      cluster: "qa",
      job_id: "123",
      owner: "qa",
      restart_count: expected.attempt - 1,
      run_id: report.runId,
      request_id: requestId,
    });
    assert.equal(
      record.view.evidence.current_runtime_attempt,
      expected.pending ? null : expected.attempt,
    );
    assert.equal(record.view.evidence.backend.attempt, expected.attempt);
    if (expected.name !== "lifecycle-stale") {
      assert.equal(record.view.uncertainty, expected.badge.includes("uncertain"));
      assert.equal(record.view.state.replaceAll("_", " "), expected.badge.split(" · ")[0]);
    }
    assert.equal(record.view.submission_requested, true);
    assert.equal(record.view.cancellation_requested, false);
  }
  for (const [index, stage] of stages.entries()) {
    const item = report.observations[index];
    assert.equal(item.name, stage.name);
    assert.equal(item.badge, stage.badge);
    assert.equal(item.runId, report.runId);
    assert.equal(item.cancelDisabled, false);
    assert(report.boundary.records.some((record) => record.stage === index));
    if (stage.emptyMetrics) {
      assert.equal(item.progress, false);
      assert.equal(item.charts, 0);
    }
    assert(!/failed|completed/.test(item.badge));
  }
  assert(
    report.observations[2].progress,
    "Real attempt-one metrics must render before restart fencing",
  );
  assert(report.observations[2].charts > 0);
  assert.deepEqual(report.boundary.mutations, []);
  assert(report.observations[6].text.includes("Lifecycle is not currently confirmed."));
  assert(report.observations[8].text.includes("attempt 2"));
  assert(
    report.observations[8].diagnostics.includes("[1:"),
    "Retained attempt-one diagnostics remain available",
  );
  assert.deepEqual(report.cleanup, {
    browserClosed: true,
    fixtureReaped: true,
    servicesClosed: true,
    listenerClosed: true,
    ownedRootsRemoved: true,
  });
  return { states: report.observations.map((item) => item.name), reducerDerived: true };
}

if (process.argv[1]?.endsWith("verify_dashboard_state_browser_report.mjs")) {
  const report = JSON.parse((await boundedFile(process.argv[2])).toString("utf8"));
  verifyDashboardStateBrowserReport(report);
  const current = JSON.parse(
    await boundedCommand(
      process.env.WAVEDL_PYTHON ?? "python",
      [
        "-c",
        "import json,hashlib\nfrom pathlib import Path\nfrom tools.vendor_web_assets import inventory\np=Path('src/wavedl_daemon/web_assets'); raw=(p/'.wavedl-assets.json').read_bytes(); actual=inventory(p,managed=True)\nif actual!=json.loads(raw): raise ValueError('Current asset inventory mismatch')\nprint(json.dumps({'manifestSha256':hashlib.sha256(raw).hexdigest(),'assets':actual}))",
      ],
      { cwd: new URL("..", import.meta.url).pathname, timeout: 10000 },
    ),
  );
  assert.deepEqual(report.assetPreflight, current, "Not current complete packaged assets");
  console.log("Dashboard state report verified");
}
