import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { boundedFile, verifyRetainedBrowserReport } from "./verify_retained_browser_report.mjs";
import { activeDraftLimitation, frozenAssetProof } from "./browser_retained_active_draft.mjs";
import { boundedCommand } from "./run_retained_browser_acceptance.mjs";

export function verifyActiveDraft(report) {
  const proof = report.activeDraft;
  assert.equal(report.status, "passed");
  assert.equal(proof.limitation, activeDraftLimitation);
  assert(/^[a-f0-9]{64}$/.test(proof.frozenAssetsBefore.manifestSha256));
  assert.deepEqual(proof.frozenAssetsAfter, proof.frozenAssetsBefore);
  assert(Object.keys(proof.frozenAssetsBefore.assets).length > 20);
  assert.equal(proof.pageBefore.timeOrigin, proof.pageAfter.timeOrigin);
  assert.equal(proof.pageBefore.timeOrigin, report.stages[0].page.timeOrigin);
  assert.deepEqual(proof.pageBefore.entries, report.stages[0].page.entries);
  assert.deepEqual(proof.approvedPage, report.stages[1].approved);
  assert.equal(proof.pageAfter.timeOrigin, report.stages[1].previousTabs[0].timeOrigin);
  assert.deepEqual(proof.pageBefore.entries, proof.pageAfter.entries);
  assert.notEqual(proof.approvedPage.timeOrigin, proof.pageBefore.timeOrigin);
  assert.deepEqual(proof.draftBefore, proof.draftAfter);
  assert.equal(proof.draftBefore.epochs, "77");
  assert.equal(proof.draftBefore.preview, false);
  assert.equal(proof.draftBefore.acknowledged, false);
  assert.equal(proof.deferred.updatePromptVisible, false);
  assert.equal(proof.deferred.timeOrigin, proof.pageBefore.timeOrigin);
  assert(proof.waitingBeforeDefer.some((registration) => registration.waiting === "installed"));
  for (const selected of [proof.selectedBefore, proof.selectedAfter]) {
    assert.equal(selected.runId, proof.runId);
    assert.equal(selected.badge, "running");
    assert.equal(selected.progress, true);
    assert(selected.diagnostics.includes("[1:"));
  }
  const first = proof.authorityBefore;
  assert(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(proof.runId));
  assert(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(first.planId));
  assert(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(first.requestId));
  for (const authority of [first, proof.authorityAtDefer, proof.authorityAfter]) {
    assert.equal(authority.runId, proof.runId);
    assert.equal(authority.planId, first.planId);
    assert.equal(authority.requestId, first.requestId);
    assert.equal(authority.pid, first.pid);
    assert(Number.isSafeInteger(authority.pid) && authority.pid > 0);
    assert.equal(authority.alive, true);
    assert.equal(authority.state, "running");
    assert.equal(authority.backendStatus, "running");
    assert.equal(authority.operation, "train");
    assert.equal(authority.plans, 1);
    assert.equal(authority.executions, 1);
    assert.equal(authority.submissionRequested, 1);
    assert.equal(authority.cancellationRequested, 0);
    assert.equal(authority.cancelDelivered, 0);
    assert.equal(authority.hello.run_id, proof.runId);
    assert.equal(authority.hello.attempt, 1);
    assert.equal(authority.hello.type, "hello");
    assert.equal(authority.hello.payload.device, "cpu");
  }
  assert(
    Array.isArray(proof.finalRequests) &&
      proof.finalRequests.length > 5 &&
      proof.finalRequests.length <= 8192,
  );
  assert(
    proof.finalRequests.some(
      (request) => request.path === `/api/runs/${proof.runId}/events` && request.status === 200,
    ),
  );
  assert(
    proof.finalRequests
      .filter((request) => request.path.startsWith("/api/runs"))
      .every((request) => request.method === "GET"),
  );
  assert(report.fixtureDiagnostics.stdout.includes("Fixture process-result: "));
  const results = report.fixtureDiagnostics.stdout
    .split("\n")
    .filter((line) => line.startsWith("Fixture process-result: "))
    .map((line) => JSON.parse(line.slice("Fixture process-result: ".length)));
  assert.equal(results.length, 1);
  assert.equal(results[0].runId, proof.runId);
  assert.equal(results[0].pid, first.pid);
  assert.equal(results[0].cancelled, true);
  return { activeRunPreserved: true, unsentDraftPreserved: true, localOnly: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = JSON.parse(await boundedFile(process.argv[2], 8 * 1024 * 1024));
  verifyActiveDraft(report);
  const repo = resolve(new URL("..", import.meta.url).pathname);
  const current = await frozenAssetProof(
    (binary, args) => boundedCommand(binary, args, { cwd: repo, timeout: 15000 }),
    process.env.WAVEDL_PYTHON ?? "python",
  );
  assert.deepEqual(
    report.activeDraft.frozenAssetsBefore,
    current,
    "Main frozen asset identity drifted",
  );
  await verifyRetainedBrowserReport(
    process.argv[2],
    process.argv[3],
    resolve(new URL("..", import.meta.url).pathname),
    { activeDraft: true },
  );
  console.log("Retained two-tab active-run/draft browser evidence verified");
}
