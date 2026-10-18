import assert from "node:assert/strict";
import test from "node:test";
import { verifyActiveDraft } from "./verify_retained_active_draft_report.mjs";
import { activeDraftLimitation } from "./browser_retained_active_draft.mjs";

const run = "11111111-1111-4111-8111-111111111111";
const plan = "22222222-2222-4222-8222-222222222222";
const request = "33333333-3333-4333-8333-333333333333";
function base() {
  const page = { timeOrigin: 10, entries: ["/_nuxt/g1/old.js"] };
  const assets = {
    manifestSha256: "a".repeat(64),
    assets: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`asset${i}`, "b".repeat(64)])),
  };
  const draft = { epochs: "77", python: "", preview: false, acknowledged: false };
  const selected = { runId: run, badge: "running", progress: true, diagnostics: "[1:0] hello" };
  const authority = {
    runId: run,
    planId: plan,
    requestId: request,
    operation: "train",
    pid: 123,
    alive: true,
    state: "running",
    backendStatus: "running",
    plans: 1,
    executions: 1,
    submissionRequested: 1,
    cancellationRequested: 0,
    cancelDelivered: 0,
    hello: { run_id: run, attempt: 1, type: "hello", payload: { device: "cpu" } },
  };
  const report = {
    status: "passed",
    stages: [{ page }, { approved: { timeOrigin: 20 }, previousTabs: [page] }],
    activeDraft: {
      runId: run,
      limitation: activeDraftLimitation,
      pageBefore: page,
      pageAfter: structuredClone(page),
      approvedPage: { timeOrigin: 20 },
      frozenAssetsBefore: assets,
      frozenAssetsAfter: structuredClone(assets),
      draftBefore: draft,
      draftAfter: structuredClone(draft),
      selectedBefore: selected,
      selectedAfter: structuredClone(selected),
      authorityBefore: authority,
      authorityAtDefer: structuredClone(authority),
      authorityAfter: structuredClone(authority),
      deferred: { timeOrigin: 10, updatePromptVisible: false },
      waitingBeforeDefer: [{ waiting: "installed" }],
      finalRequests: Array.from({ length: 6 }, () => ({
        method: "GET",
        path: `/api/runs/${run}/events`,
        status: 200,
      })),
    },
    fixtureDiagnostics: {
      stdout: `Fixture process-result: ${JSON.stringify({ runId: run, pid: 123, cancelled: true })}\nFixture: services-closed`,
    },
  };
  return report;
}
test("requires active runtime and unsent draft across shared takeover", () =>
  assert.equal(verifyActiveDraft(base()).activeRunPreserved, true));
for (const [name, mutate] of [
  ["unapproved B reload", (r) => (r.activeDraft.pageAfter.timeOrigin = 30)],
  ["old entry replaced", (r) => (r.activeDraft.pageAfter.entries = ["new.js"])],
  ["lost draft", (r) => (r.activeDraft.draftAfter.epochs = "1000")],
  ["submitted draft", (r) => (r.activeDraft.draftBefore.preview = true)],
  ["no waiting worker", (r) => (r.activeDraft.waitingBeforeDefer = [])],
  ["completed run", (r) => (r.activeDraft.authorityAfter.state = "completed")],
  ["dead PID", (r) => (r.activeDraft.authorityAfter.alive = false)],
  ["changed PID", (r) => (r.activeDraft.authorityAfter.pid = 456)],
  ["foreign plan", (r) => (r.activeDraft.authorityAfter.planId = run)],
  ["extra plan", (r) => (r.activeDraft.authorityAfter.plans = 2)],
  ["cancel during deferral", (r) => (r.activeDraft.authorityAtDefer.cancellationRequested = 1)],
  [
    "browser mutation",
    (r) => r.activeDraft.finalRequests.push({ method: "POST", path: `/api/runs/${run}` }),
  ],
  ["runtime attempt mismatch", (r) => (r.activeDraft.authorityAfter.hello.attempt = 2)],
  ["no metrics", (r) => (r.activeDraft.selectedAfter.progress = false)],
  [
    "frozen bundle changed",
    (r) => (r.activeDraft.frozenAssetsAfter.manifestSha256 = "c".repeat(64)),
  ],
  ["missing cleanup runtime", (r) => (r.fixtureDiagnostics.stdout = "Fixture: services-closed")],
])
  test(`rejects ${name}`, () => {
    const report = base();
    mutate(report);
    assert.throws(() => verifyActiveDraft(report));
  });
