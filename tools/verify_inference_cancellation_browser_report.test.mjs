import assert from "node:assert/strict";
import test from "node:test";
import { verifyInferenceCancellationReport } from "./verify_inference_cancellation_browser_report.mjs";

const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
const base = () => ({
  name: "inference-cancellation",
  status: "passed",
  assetManifestSha256: 'a'.repeat(64),
  cleanup: { errors: [], fixtureExit: { code: 0, signal: null }, browserSessionAbsent: true, fixtureServicesClosed: true, removedOwnedRoots: true, browserProfileRemoved: true },
  inferenceCancellation: {
    sourceRunId: ids[0], cancelledRunId: ids[1], generation: "gen-000001",
    runningObserved: true, noDuplicatePlan: true, noDuplicateRun: true,
    cancelledUi: true, planId: ids[1], requestId: ids[1],
    runtime: { pid: 12345, pidAbsent: true, events: [{ type: "exit", run_id: ids[1], attempt: 1, payload: { status: 'cancelled' } }], publications: [] },
    startedRuntime: { pid: 12345, hello: { type: 'hello', run_id: ids[1], attempt: 1, payload: { interpreter: '/tmp/python', device: 'cpu' } } },
    approved: { operation: 'test', run_id: ids[1], runtime: { python: '/tmp/python', device: 'cpu' }, checkpoint_source: { run_id: ids[0], generation: 'gen-000001', manifest_sha256: 'b'.repeat(64), complete_sha256: 'c'.repeat(64) } },
    source: { manifestSha256: 'b'.repeat(64), completeSha256: 'c'.repeat(64), files: { 'model.pt': { size: 1, sha256: 'd'.repeat(64) } } },
    sourceAfter: { manifestSha256: 'b'.repeat(64), completeSha256: 'c'.repeat(64), files: { 'model.pt': { size: 1, sha256: 'd'.repeat(64) } } },
    running: { executions: [{ plan_id: ids[1], observed_status: 'running' }] },
    before: {
      plans: 3,
      runs: [{ run_id: ids[0], state: 'completed' }, { run_id: ids[1], state: 'running' }, { run_id: '33333333-3333-4333-8333-333333333333', state: 'completed' }],
      control: [{ plan_id: ids[1], submission_requested: 1, cancellation_requested: 0 }, { plan_id: ids[0], submission_requested: 1, cancellation_requested: 0 }, { plan_id: '33333333-3333-4333-8333-333333333333', submission_requested: 1, cancellation_requested: 0 }],
      executions: [{ plan_id: ids[1], cancel_delivered: 0, observed_status: 'running' }, { plan_id: ids[0], cancel_delivered: 0, observed_status: 'terminal' }, { plan_id: '33333333-3333-4333-8333-333333333333', cancel_delivered: 0, observed_status: 'terminal' }],
    },
    after: {
      plans: 3,
      runs: [{ run_id: ids[0], state: 'completed' }, { run_id: ids[1], state: "cancelled" }, { run_id: '33333333-3333-4333-8333-333333333333', state: 'completed' }],
      control: [{ plan_id: ids[1], submission_requested: 1, cancellation_requested: 1 }, { plan_id: ids[0], submission_requested: 1, cancellation_requested: 0 }, { plan_id: '33333333-3333-4333-8333-333333333333', submission_requested: 1, cancellation_requested: 0 }],
      executions: [{ cancel_delivered: 1, plan_id: ids[1], observed_status: "terminal" }, { plan_id: ids[0], cancel_delivered: 0, observed_status: 'terminal' }, { plan_id: '33333333-3333-4333-8333-333333333333', cancel_delivered: 0, observed_status: 'terminal' }],
    },
  },
});

test("accepts durable inference cancellation evidence", () => assert.equal(verifyInferenceCancellationReport(base()), true));
test("accepts graceful SIGINT fixture shutdown", () => { const report = base(); report.cleanup.fixtureExit = { code: null, signal: 'SIGINT' }; assert.equal(verifyInferenceCancellationReport(report), true); });
for (const [name, mutate] of [
  ["not running", report => { report.inferenceCancellation.runningObserved = false; }],
  ["duplicate run", report => { report.inferenceCancellation.after.runs.push({ run_id: ids[1], state: "cancelled" }); }],
  ["no cancellation intent", report => { report.inferenceCancellation.after.control[0].cancellation_requested = 0; }],
  ["not delivered", report => { report.inferenceCancellation.after.executions[0].cancel_delivered = 0; }],
  ["wrong source", report => { report.inferenceCancellation.approved.checkpoint_source.run_id = ids[1]; }],
  ["changed source bytes", report => { report.inferenceCancellation.sourceAfter.completeSha256 = 'd'.repeat(64); }],
  ["unreaped process", report => { report.inferenceCancellation.runtime.pidAbsent = false; }],
  ["wrong exit outcome", report => { report.inferenceCancellation.runtime.events[0].payload.status = 'completed'; }],
  ["unstarted producer", report => { report.inferenceCancellation.startedRuntime.hello.type = 'log'; }],
  ["fixture cleanup failed", report => { report.cleanup.fixtureExit.code = 1; }],
  ["unexpected fixture signal", report => { report.cleanup.fixtureExit = { code: null, signal: 'SIGTERM' }; }],
  ["new plan on cancellation", report => { report.inferenceCancellation.after.plans = 4; }],
  ["foreign cancellation", report => { report.inferenceCancellation.after.control[0].plan_id = ids[0]; }],
  ["wrong producer interpreter", report => { report.inferenceCancellation.startedRuntime.hello.payload.interpreter = '/other/python'; }],
  ["nonCPU producer", report => { report.inferenceCancellation.startedRuntime.hello.payload.device = 'cuda'; }],
  ["bad source file size", report => { report.inferenceCancellation.source.files['model.pt'].size = -1; }],
  ["bad source file digest", report => { report.inferenceCancellation.source.files['model.pt'].sha256 = 1; }],
  ["duplicate uncancelled execution", report => { report.inferenceCancellation.after.executions[1] = { plan_id: ids[1], cancel_delivered: 0 }; }],
  ["unrelated run mutated", report => { report.inferenceCancellation.after.runs[0].state = 'cancelled'; }],
  ["unrelated control mutated", report => { report.inferenceCancellation.after.control[1].submission_requested = 0; }],
  ["preexisting cancellation", report => { report.inferenceCancellation.before.control[0].cancellation_requested = 1; }],
  ["unsubmitted inference", report => { report.inferenceCancellation.before.control[0].submission_requested = 0; }],
  ["extra cleanup shape", report => { report.cleanup.extra = true; }],
  ["retained top level roots", report => { report.retainedPrivateRoots = []; }],
]) test(`rejects ${name}`, () => { const report = base(); mutate(report); assert.throws(() => verifyInferenceCancellationReport(report)); });
