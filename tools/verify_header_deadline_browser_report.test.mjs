import test from "node:test";
import assert from "node:assert/strict";
import { verifyHeaderDeadlineRecord } from "./verify_header_deadline_browser_report.mjs";

function fixture() {
  const metadata = { schema_version: 1, format: "npz", variables: [
    { name: "X", shape: [96, 32], dtype: "float32", sample_count: 96, declared_bytes: 12288 },
    { name: "y", shape: [96, 1], dtype: "float32", sample_count: 96, declared_bytes: 384 },
  ] };
  const state = { counts: Object.fromEntries(["plans", "plan_control", "execution_control", "submission_control", "runs", "runtime_provenance", "event_log"].map(k => [k, 0])), sources: Object.fromEntries(["samples.npz", "samples.mat", "samples.h5"].map(k => [k, { size: 100, sha256: "a".repeat(64) }])) };
  const storage = { cookies: "", localStorageKeys: [], sessionStorageKeys: [] };
  const command = { originalModule: "wavedl.core.dataset_headers", authorityIdentityPresent: true, cancelled: false, pidAbsent: true, descendantsSpawned: false, poolOutstandingBeforeReturn: 1, stderr: "" };
  const http = { method: "POST", endpoint: "/api/datasets/inspect", browser: true, poolOutstandingAfterResponse: 0 };
  return structuredClone({ name: "header-deadline", status: "passed", assetManifestSha256: "a".repeat(64), driverReadinessMode: "sync-exposure-poll-and-two-controller-dom-observations", browser: "agent-browser 1", initialProfileEmpty: true, browserObserved: { userAgent: "Chrome/150", ...storage }, finalStorage: storage,
    cleanup: { browserAbsent: true, fixtureReaped: true, servicesClosed: true, listenerClosed: true, childrenAbsent: true, ownedRemoved: true, errors: [] }, before: state, after: structuredClone(state), recovery: "public-refresh-header-without-reconnect",
    commands: [{ ...command, cancelled: true, sequence: 1, pid: 1111, controlled: true, deadline: 2, elapsed: 2.3, timedOut: true, returncode: -15, stdout: "owned-header-stall-child-ready\n" }, { ...command, sequence: 2, pid: 1112, controlled: false, deadline: 30, elapsed: 0.2, timedOut: false, returncode: 0, stdout: JSON.stringify(metadata) }],
    http: [{ ...http, status: 422, response: { error: "Invalid request" } }, { ...http, status: 200, response: metadata }],
    refusal: { connected: true, header: false, dimensions: "", fields: {}, alerts: ["Dataset inspection refused or unavailable. Reconnect, select a supported dataset again, or retry its header inspection."] }, retry: { connected: true, header: true, dimensions: "96 × 32", fields: { Format: "NPZ", Samples: "96", "File size": "Unknown", "Input key": "X", "Input shape": "32", "Input dtype": "float32", "Output key": "y", "Output shape": "1", "Output dtype": "float32" }, alerts: [] },
    limitation: "Fixture-controlled single child with reduced 2s command deadline, normal 30s pool; no descendants. Not parser-specific hang, default deadline, disconnect, Stop, capacity saturation, remote filesystem or Slurm certification." });
}
test("complete supervised HEADER deadline evidence passes", () => assert(verifyHeaderDeadlineRecord(fixture())));
test("parallel read-only preview can finish while the header child retains admission", () => {
  const r = fixture();
  r.http.unshift({ method: "POST", endpoint: "/api/datasets/preview", browser: true, status: 200, response: null, poolOutstandingAfterResponse: 1 });
  assert(verifyHeaderDeadlineRecord(r));
});
for (const [name, mutate] of Object.entries({
  "no actual child execution": r => { r.commands[0].stdout = ""; },
  "no supervisor timeout": r => { r.commands[0].timedOut = false; },
  "no timeout cancellation": r => { r.commands[0].cancelled = false; },
  "near default deadline": r => { r.commands[0].elapsed = 29; },
  "invalid exit status": r => { r.commands[0].returncode = null; },
  "early refusal": r => { r.commands[0].elapsed = 1; },
  "unbounded child": r => { r.commands[0].elapsed = 60; },
  "live child": r => { r.commands[0].pidAbsent = false; },
  "slot released before reap": r => { r.commands[0].poolOutstandingBeforeReturn = 0; },
  "slot not released": r => { r.http[0].poolOutstandingAfterResponse = 1; },
  "mock metadata retry": r => { r.commands[1].controlled = true; },
  "missing authority": r => { r.commands[0].authorityIdentityPresent = false; },
  "retry absent": r => { r.commands.pop(); },
  "retry parser failure": r => { r.commands[1].returncode = 1; },
  "retry budget altered": r => { r.commands[1].deadline = 2; },
  "stale dimensions": r => { r.refusal.dimensions = "96 × 32"; },
  "stale header": r => { r.refusal.header = true; },
  "connection lost": r => { r.refusal.connected = false; },
  "reconnect hides failure": r => { r.recovery = "reconnect"; },
  "private error body": r => { r.http[0].response.error = "/private/dataset"; },
  "wrong dtype": r => { r.http[1].response.variables[0].dtype = "float64"; r.commands[1].stdout = JSON.stringify(r.http[1].response); },
  "wrong browser dtype": r => { r.retry.fields["Input dtype"] = "float64"; },
  "wrong browser shape": r => { r.retry.fields["Output shape"] = "32"; },
  "invented refusal fields": r => { r.refusal.fields = { Samples: "96" }; },
  "run mutation": r => { r.http.push({ ...r.http[0], endpoint: "/api/runs" }); },
  "plan mutation": r => { r.http.push({ ...r.http[0], endpoint: "/api/runs/plan" }); },
  "failed preview": r => { r.http.push({ method: "POST", endpoint: "/api/datasets/preview", browser: true, status: 500, response: null, poolOutstandingAfterResponse: 1 }); },
  "invalid pool observation": r => { r.http[0].poolOutstandingAfterResponse = -1; },
  "cancel mutation": r => { r.http.push({ ...r.http[0], endpoint: "/api/runs/id/cancel" }); },
  "durable mutation": r => { r.after.counts.plans = 1; },
  "source changed": r => { r.after.sources["samples.npz"].sha256 = "b".repeat(64); },
  "missing browser": r => { r.http[0].browser = false; },
  "cleanup incomplete": r => { r.cleanup.childrenAbsent = false; },
  "credentials retained": r => { r.finalStorage.localStorageKeys = ["token"]; },
  "skip": r => { r.skipped = true; },
  "passed with shutdown error": r => { r.shutdownError = "failed"; },
  "passed with failed marker": r => { r.failed = true; },
  "passed with failure stage": r => { r.failureStage = "retry"; },
  "passed with failure DOM": r => { r.failureDom = []; },
  "passed with retained roots": r => { r.retainedPrivateRoots = []; },
})) test(`reject ${name}`, () => { const r = fixture(); mutate(r); assert.throws(() => verifyHeaderDeadlineRecord(r)); });
