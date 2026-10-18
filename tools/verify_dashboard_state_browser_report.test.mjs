import test from "node:test";
import assert from "node:assert/strict";
import {
  stages,
  limitation,
  verifyDashboardStateBrowserReport,
} from "./verify_dashboard_state_browser_report.mjs";
import { DRIVER_READINESS_MODE } from "./browser_actions.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const plan = "22222222-2222-4222-8222-222222222222";
const request = "33333333-3333-4333-8333-333333333333";
const matrix = () => ({
  status: "passed",
  scope: "real-packaged-browser-dashboard-states",
  limitation,
  driverReadinessMode: DRIVER_READINESS_MODE,
  runId: id,
  assetManifestSha256: "a".repeat(64),
  assetPreflight: {
    manifestSha256: "a".repeat(64),
    assets: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`x${i}`, "b".repeat(64)])),
  },
  assetPostflight: {
    manifestSha256: "a".repeat(64),
    assets: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`x${i}`, "b".repeat(64)])),
  },
  browserRuntime: { userAgent: "Chrome/154.0" },
  observations: stages.map((stage) => ({
    name: stage.name,
    badge: stage.badge,
    runId: id,
    progress: false,
    charts: 0,
    cancelDisabled: false,
    text:
      stage.name === "lifecycle-stale"
        ? "Lifecycle is not currently confirmed."
        : stage.name === "restart-running"
          ? "attempt 2"
          : "",
    diagnostics: stage.name === "restart-running" ? "[1:1]" : "",
  })),
  boundary: {
    scope: "authenticated-response-injection",
    mutations: [],
    records: stages.map((stage, index) => ({
      stage: index,
      name: stage.name,
      path: `/api/runs/${id}`,
      status: stage.name === "lifecycle-stale" ? 503 : 200,
      view: {
        run_id: id,
        plan_id: plan,
        request_id: request,
        operation: "train",
        backend: "slurm",
        attempt: stage.attempt,
        state: stage.badge.split(" · ")[0].replaceAll(" ", "_"),
        uncertainty: stage.badge.includes("uncertain"),
        submission_requested: true,
        cancellation_requested: false,
        evidence: {
          native_pending: stage.pending ?? false,
          native_identity: {
            cluster: "qa",
            job_id: "123",
            owner: "qa",
            restart_count: stage.attempt - 1,
            run_id: id,
            request_id: request,
          },
          current_runtime_attempt: stage.pending ? null : stage.attempt,
          backend: { attempt: stage.attempt },
        },
      },
    })),
  },
  cleanup: {
    browserClosed: true,
    fixtureReaped: true,
    servicesClosed: true,
    listenerClosed: true,
    ownedRootsRemoved: true,
  },
});
function base() {
  const report = matrix();
  report.observations[2].progress = true;
  report.observations[2].charts = 2;
  return report;
}
test("accepts complete dashboard matrix", () =>
  assert.equal(verifyDashboardStateBrowserReport(base()).reducerDerived, true));
test("rejects cross-plan detail identity", () => {
  const report = base();
  report.boundary.records[1].view.plan_id = id;
  assert.throws(() => verifyDashboardStateBrowserReport(report));
});
test("rejects mutation evidence", () => {
  const report = base();
  report.boundary.mutations = [{ method: "POST", path: "/api/runs" }];
  assert.throws(() => verifyDashboardStateBrowserReport(report));
});
for (const [name, mutate] of [
  ["foreign request", (report) => (report.boundary.records[1].view.request_id = id)],
  ["foreign operation", (report) => (report.boundary.records[1].view.operation = "test")],
  ["regressed attempt", (report) => (report.boundary.records[8].view.attempt = 1)],
  [
    "missing native pending",
    (report) => (report.boundary.records[7].view.evidence.native_pending = false),
  ],
  [
    "foreign native owner",
    (report) => (report.boundary.records[7].view.evidence.native_identity.owner = "other"),
  ],
  [
    "runtime attempt mismatch",
    (report) => (report.boundary.records[7].view.evidence.current_runtime_attempt = 1),
  ],
  [
    "restart count regression",
    (report) => (report.boundary.records[8].view.evidence.native_identity.restart_count = 0),
  ],
  ["false completion", (report) => (report.observations[4].badge = "completed")],
  [
    "missing uncertain guidance",
    (report) => (report.observations[3].badge = "observation unavailable"),
  ],
  ["old metrics current", (report) => (report.observations[8].progress = true)],
  ["no actual history", (report) => (report.observations[2].progress = false)],
  ["missing stale guidance", (report) => (report.observations[6].text = "running")],
  ["unverified assets", (report) => (report.assetPostflight.assets.x0 = "c".repeat(64))],
  ["old driver", (report) => (report.driverReadinessMode = "direct-click")],
  ["incomplete cleanup", (report) => (report.cleanup.fixtureReaped = false)],
])
  test(`rejects ${name}`, () => {
    const report = base();
    mutate(report);
    assert.throws(() => verifyDashboardStateBrowserReport(report));
  });
