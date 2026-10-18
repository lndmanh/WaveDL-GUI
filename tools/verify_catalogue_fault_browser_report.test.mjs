import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { verifyCatalogueFaultRecord } from "./verify_catalogue_fault_browser_report.mjs";

function fixture() {
  const zero = Object.fromEntries(["plans", "plan_control", "execution_control", "submission_control", "runs", "runtime_provenance", "event_log"].map(k => [k, 0]));
  const state = { counts: zero, sources: Object.fromEntries(["samples.npz", "samples.mat", "samples.h5"].map(k => [k, { size: 100, sha256: "a".repeat(64) }])) };
  const observation = { alerts: [], files: 1, models: 1, header: true, plan: false, outside: false };
  const modes = ["roots", "traversal", "header", "shape", "claim", "malformed-model", "outage"];
  const cases = [], responses = [];
  for (const mode of modes) {
    const real = { roots: [{ id: "datasets" }], entries: [{ name: "samples.npz", kind: "file" }], schema_version: 1, variables: [{ sample_count: 96 }], runtime_verified: false, models: [{ id: "cnn" }] };
    let fault = structuredClone(real);
    if (mode === "roots") fault = { roots: [{ id: "../outside" }] };
    if (mode === "traversal") fault.entries[0].name = "../outside.npz";
    if (mode === "header") fault.schema_version = 999;
    if (mode === "shape") fault.variables[0].sample_count++;
    if (mode === "claim") fault.runtime_verified = true;
    if (mode === "malformed-model") fault.models[0].id = 37;
    if (mode === "outage") fault = { error: "Unavailable" };
    const catalogue = ["roots", "traversal"].includes(mode), model = ["claim", "malformed-model", "outage"].includes(mode);
    const message = catalogue ? "Catalogue unavailable. Verify your connection or choose another allowed location." : model ? "Model catalogue unavailable. Reconnect to the verified daemon and retry." : "Dataset inspection refused or unavailable. Reconnect, select a supported dataset again, or retry its header inspection.";
    const refusal = { ...observation, alerts: [message], ...(catalogue ? { files: 0 } : model ? { models: 0 } : { header: false }) };
    cases.push({ mode, refusal, retry: observation, state });
    const original = JSON.stringify(real), response = JSON.stringify(fault);
    const hash = value => createHash("sha256").update(value).digest("hex");
    responses.push({ mode, realStatus: 200, status: mode === "outage" ? 503 : 200, method: catalogue || model ? "GET" : "POST", endpoint: catalogue ? "/api/browse" : model ? "/api/models" : "/api/datasets/inspect", query: mode === "traversal" ? "root=datasets" : "", original, response, originalSha256: hash(original), responseSha256: hash(response) });
  }
  for (const mode of ["unreadable", "oversized"]) {
    const response = JSON.stringify({ error: mode === "unreadable" ? "Forbidden" : "Request failed" });
    const status = mode === "unreadable" ? 403 : 503;
    cases.push({ mode, refusal: { ...observation, files: 0, alerts: ["Catalogue unavailable. Verify your connection or choose another allowed location."] }, retry: observation, state, recovery: "public-reload-roots-reselect-root-and-file" });
    responses.push({ mode, realStatus: status, status, method: "GET", endpoint: "/api/browse", query: `root=datasets&path=${mode}-location`, original: response, response, originalSha256: createHash("sha256").update(response).digest("hex"), responseSha256: createHash("sha256").update(response).digest("hex"), responseModified: false, browser: true, native: { child: `${mode}-location`, uid: 501, owner: 501, mode: mode === "unreadable" ? 0 : 448, ordinaryDirectory: true, maxEntries: 1000, ...(mode === "unreadable" ? { permissionDenied: true } : { entryCount: 1001, ordinaryEmptyFiles: true }) } });
  }
  return structuredClone({ name: "catalogue-header-fault", status: "passed", driverReadinessMode: "sync-exposure-poll-and-two-controller-dom-observations", browser: "agent-browser 1", initialProfileEmpty: true, browserObserved: { userAgent: "Chrome/150", cookies: "", localStorageKeys: [], sessionStorageKeys: [] }, finalStorage: { cookies: "", localStorageKeys: [], sessionStorageKeys: [] }, cleanup: { browserAbsent: true, fixtureReaped: true, servicesClosed: true, listenerClosed: true, nativePermissionsRestored: true, ownedRemoved: true, errors: [] }, before: state, after: structuredClone(state), baseline: observation, recoveredModel: true, cases, responses, limitation: "Seven explicit one-shot response-boundary faults plus two native owned local child-location refusals; not root-location, remote filesystem, remote outage or Slurm certification." });
}

test("complete bounded catalogue/header evidence passes", () => assert(verifyCatalogueFaultRecord(fixture())));
for (const [name, mutate] of Object.entries({
  "missing refusal": r => { r.cases[0].refusal.alerts = []; },
  "stale file choice": r => { r.cases[1].refusal.files = 1; },
  "stale model choice": r => { r.cases[4].refusal.models = 1; },
  "stale header": r => { r.cases[2].refusal.header = true; },
  "plan authority": r => { r.cases[0].refusal.plan = true; },
  "traversal leak": r => { r.cases[1].refusal.outside = true; },
  "no retry": r => { r.cases[4].retry.models = 0; },
  "identity refusal during retry": r => { r.cases[0].retry.alerts = ["The daemon returned an invalid response. Reconnect to verify its identity."]; },
  "baseline authority": r => { r.baseline.plan = true; },
  "listener alive": r => { r.cleanup.listenerClosed = false; },
  "cleanup error": r => { r.cleanup.errors = ["unconfirmed"]; },
  "final storage credential": r => { r.finalStorage.sessionStorageKeys = ["token"]; },
  "durable mutation": r => { r.cases[0].state.counts.plans = 1; },
  "source mutation": r => { r.after.sources["samples.npz"].sha256 = "b".repeat(64); },
  "fake response": r => { r.responses[0].response = "{}"; },
  "missing case": r => { r.cases.pop(); },
  "missing response": r => { r.responses.pop(); },
  "cleanup incomplete": r => { r.cleanup.fixtureReaped = false; },
  "skip": r => { r.skipped = true; },
  "native status rewritten": r => { r.responses[7].realStatus = 200; },
  "native modified response": r => { r.responses[7].responseModified = true; },
  "root bypass permission proof": r => { r.responses[7].native.uid = 0; },
  "not chmod000": r => { r.responses[7].native.mode = 448; },
  "no native denial": r => { r.responses[7].native.permissionDenied = false; },
  "not over budget": r => { r.responses[8].native.entryCount = 1000; },
  "fake giant files": r => { r.responses[8].native.ordinaryEmptyFiles = false; },
  "wrong service bound": r => { r.responses[8].native.maxEntries = 1001; },
  "native stale files": r => { r.cases[8].refusal.files = 1; },
  "native no public recovery": r => { delete r.cases[7].recovery; },
  "native permission unrestored": r => { r.cleanup.nativePermissionsRestored = false; },
  "storage credential": r => { r.browserObserved.localStorageKeys = ["token"]; },
})) test(`reject ${name}`, () => { const r = fixture(); mutate(r); assert.throws(() => verifyCatalogueFaultRecord(r)); });
