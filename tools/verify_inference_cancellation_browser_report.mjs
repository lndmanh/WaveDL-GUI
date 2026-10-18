import assert from "node:assert/strict";
import { readFile, lstat, open } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export function verifyInferenceCancellationReport(report) {
  assert(report && typeof report === "object" && !Array.isArray(report));
  assert.equal(report.status, "passed");
  assert.equal(report.name, "inference-cancellation");
  for (const key of ['error', 'shutdownError', 'skip', 'skipped', 'skipReason', 'explicitFixtureWebAssets', 'retainedPrivateRoots', 'retainedOwnedPaths']) assert(!Object.hasOwn(report, key));
  assert.match(report.assetManifestSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(report.cleanup).sort(), ['browserProfileRemoved', 'browserSessionAbsent', 'errors', 'fixtureExit', 'fixtureServicesClosed', 'removedOwnedRoots'].sort());
  assert.deepEqual(report.cleanup.errors, []);
  for (const field of ['browserSessionAbsent', 'fixtureServicesClosed', 'removedOwnedRoots', 'browserProfileRemoved']) assert.equal(report.cleanup[field], true);
  assert(!Object.hasOwn(report.cleanup, 'retainedPrivateRoots'));
  assert(
    (report.cleanup.fixtureExit.code === 0 && report.cleanup.fixtureExit.signal === null)
      || (report.cleanup.fixtureExit.code === null && report.cleanup.fixtureExit.signal === 'SIGINT'),
    'Fixture must exit normally or via graceful SIGINT',
  );
  const proof = report.inferenceCancellation;
  assert(proof && typeof proof === "object");
  assert.match(proof.sourceRunId, uuid);
  assert.match(proof.cancelledRunId, uuid);
  assert.match(proof.generation, /^gen-[0-9]{6,}$/);
  assert.equal(proof.runningObserved, true);
  assert.equal(proof.approved.operation, 'test');
  assert.equal(proof.approved.run_id, proof.cancelledRunId);
  assert.equal(proof.approved.checkpoint_source.run_id, proof.sourceRunId);
  assert.equal(proof.approved.checkpoint_source.generation, proof.generation);
  assert.equal(proof.approved.checkpoint_source.manifest_sha256, proof.source.manifestSha256);
  assert.equal(proof.approved.checkpoint_source.complete_sha256, proof.source.completeSha256);
  assert.equal(proof.approved.runtime.python, proof.startedRuntime.hello.payload.interpreter);
  assert.equal(proof.startedRuntime.hello.payload.device, 'cpu');
  assert.equal(proof.startedRuntime.hello.payload.interpreter, proof.approved.runtime.python);
  for (const key of ['manifestSha256', 'completeSha256']) assert.match(proof.source[key], /^[a-f0-9]{64}$/);
  assert(Object.keys(proof.source.files).length > 0);
  for (const file of Object.values(proof.source.files)) {
    assert(Number.isSafeInteger(file.size) && file.size > 0);
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
  }
  assert.deepEqual(proof.sourceAfter, proof.source);
  assert.equal(proof.startedRuntime.pid, proof.runtime.pid);
  assert.equal(proof.startedRuntime.hello.type, 'hello');
  assert.equal(proof.startedRuntime.hello.run_id, proof.cancelledRunId);
  assert.equal(proof.startedRuntime.hello.attempt, 1);
  assert(proof.running.executions.some(execution => execution.plan_id === proof.planId && execution.observed_status === 'running'));
  for (const key of ['runs', 'control', 'executions']) {
    assert.equal(proof.before[key].length, 3);
    assert.equal(proof.after[key].length, 3);
  }
  assert.equal(proof.before.control.filter(item => item.plan_id === proof.planId && item.submission_requested === 1 && item.cancellation_requested === 0).length, 1);
  assert.equal(proof.before.executions.filter(item => item.plan_id === proof.planId).length, 1);
  assert.equal(proof.after.executions.filter(item => item.plan_id === proof.planId).length, 1);
  const unrelatedBefore = proof.before.runs.filter(item => item.run_id !== proof.cancelledRunId);
  const unrelatedAfter = proof.after.runs.filter(item => item.run_id !== proof.cancelledRunId);
  assert.deepEqual(unrelatedAfter, unrelatedBefore);
  for (const key of ['control', 'executions']) {
    assert.deepEqual(proof.after[key].filter(item => item.plan_id !== proof.planId), proof.before[key].filter(item => item.plan_id !== proof.planId));
    assert.equal(new Set(proof.before[key].map(item => item.plan_id)).size, 3);
    assert.equal(new Set(proof.after[key].map(item => item.plan_id)).size, 3);
  }
  assert.equal(proof.before.plans, 3);
  assert.equal(proof.after.plans, 3);
  assert(proof.before.control.every(item => item.submission_requested === 1 && item.cancellation_requested === 0));
  assert(proof.before.executions.every(item => item.cancel_delivered === 0));
  assert.equal(proof.noDuplicatePlan, true);
  assert.equal(proof.noDuplicateRun, true);
  assert.equal(proof.cancelledUi, true);
  assert.match(proof.planId, uuid);
  assert.match(proof.requestId, uuid);
  assert(proof.runtime && Number.isInteger(proof.runtime.pid) && proof.runtime.pid > 0);
  assert.equal(proof.runtime.pidAbsent, true);
  assert(Array.isArray(proof.runtime.events) && proof.runtime.events.some(event => event.type === 'exit' && event.run_id === proof.cancelledRunId && event.attempt === 1 && event.payload.status === 'cancelled'));
  assert.deepEqual(proof.runtime.publications, []);
  assert.equal(proof.after.runs.filter(run => run.run_id === proof.cancelledRunId).length, 1);
  assert.equal(proof.after.runs.find(run => run.run_id === proof.cancelledRunId)?.state, "cancelled");
  assert.equal(proof.before.plans, proof.after.plans);
  assert.equal(proof.after.control.filter(control => control.cancellation_requested === 1).length, 1);
  assert.equal(proof.after.control.filter(control => control.plan_id === proof.planId && control.cancellation_requested === 1).length, 1);
  assert.equal(proof.after.executions.filter(execution => execution.plan_id === proof.planId && execution.cancel_delivered === 1 && execution.observed_status === 'terminal').length, 1);
  return true;
}

export async function verifyInferenceCancellationFile(path) {
  path = resolve(path);
  for (let parent = dirname(path); parent !== dirname(parent); parent = dirname(parent)) {
    const parentStat = await lstat(parent);
    assert(parentStat.isDirectory() && !parentStat.isSymbolicLink());
  }
  const before = await lstat(path);
  assert(before.isFile() && !before.isSymbolicLink() && before.size > 0 && before.size <= 1024 * 1024);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat();
    assert(opened.isFile() && opened.dev === before.dev && opened.ino === before.ino && opened.size === before.size && opened.size > 0 && opened.size <= 1024 * 1024 && opened.mtimeMs === before.mtimeMs && opened.ctimeMs === before.ctimeMs);
    const bytes = Buffer.alloc(opened.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat();
    assert(length === opened.size && after.size === opened.size && after.mtimeMs === opened.mtimeMs && after.ctimeMs === opened.ctimeMs);
    const report = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
    verifyInferenceCancellationReport(report);
    const manifest = await readFile(new URL('../src/wavedl_daemon/web_assets/.wavedl-assets.json', import.meta.url));
    assert.equal(report.assetManifestSha256, createHash('sha256').update(manifest).digest('hex'));
    return report;
  } finally { await handle.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert(process.argv[2], "Usage: verify_inference_cancellation_browser_report.mjs REPORT_FILE");
  await verifyInferenceCancellationFile(process.argv[2]);
  console.log("inference cancellation report: verified");
}
