import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const generation = value => typeof value === 'string' && /^gen-[0-9]{6,}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function verifyResultOperationsReport(report) {
  assert(report && typeof report === 'object' && !Array.isArray(report), 'Report object required');
  assert.equal(report.status, 'passed');
  assert.equal(report.name, 'result-operations');
  for (const key of ['error', 'shutdownError', 'skip', 'skipped', 'skipReason', 'retainedPrivateRoots']) assert(!Object.hasOwn(report, key), 'Failure or retained-private-root evidence present');
  assert(digest(report.assetManifestSha256));
  assert(report.cleanup && typeof report.cleanup === 'object' && !Array.isArray(report.cleanup), 'Cleanup object required');
  assert.deepEqual(
    Object.keys(report.cleanup).sort(),
    ['browserProfileRemoved', 'browserSessionAbsent', 'errors', 'fixtureExit', 'fixtureServicesClosed', 'removedOwnedRoots'].sort(),
    'Unexpected cleanup or retained-private-root evidence',
  );
  assert(
    object(report.cleanup.fixtureExit) && Object.keys(report.cleanup.fixtureExit).length === 2 && (
      (report.cleanup.fixtureExit.code === 0 && report.cleanup.fixtureExit.signal === null) ||
      (report.cleanup.fixtureExit.code === null && report.cleanup.fixtureExit.signal === 'SIGINT')
    ),
    'Fixture must have exited cleanly',
  );
  assert.deepEqual(report.cleanup.errors, []);
  for (const key of ['browserSessionAbsent', 'fixtureServicesClosed', 'removedOwnedRoots', 'browserProfileRemoved']) assert.strictEqual(report.cleanup[key], true);
  const proof = report.resultOperations;
  assert(object(proof) && object(proof.selected) && object(proof.refusal) && object(proof.approved) && object(proof.abandoned) && object(proof.durable), 'Result operation evidence objects required');
  assert.equal(proof.scope, 'Same-host explicit CPU evaluation; unsupported opset refusal and draft revocation, not cancellation/ONNX/CV/remote matrix');
  assert(generation(proof.selected.value));
  assert.equal(proof.refusal.invalid, 'true');
  assert.equal(proof.refusal.approvalAbsent, true);
  assert.deepEqual(proof.refusal.before, proof.refusal.after);
  assert.equal(proof.abandoned.operation, 'test');
  assert.equal(proof.approved.operation, 'test');
  assert.equal(proof.approved.resolved_config.batch_size, 16);
  assert(uuid(proof.sourceRunId) && uuid(proof.approved.run_id) && uuid(proof.abandoned.run_id));
  assert.notEqual(proof.approved.run_id, proof.abandoned.run_id);
  assert.equal(proof.approved.checkpoint_source.run_id, proof.sourceRunId);
  assert.equal(proof.approved.checkpoint_source.generation, proof.selected.value);
  assert(Array.isArray(proof.durable.runs) && Array.isArray(proof.durable.plans), 'Durable evidence arrays required');
  assert.equal(proof.durable.runs.length, 2);
  assert.deepEqual(new Set(proof.durable.runs.map(run=>run.runId)), new Set([proof.sourceRunId, proof.approved.run_id]));
  assert(proof.durable.runs.every(run => run.state === 'completed' && digest(run.manifestSha256)));
  assert.equal(proof.durable.plans.length, 4);
  assert.equal(new Set(proof.durable.plans.map(plan=>plan.plan_id)).size, 4);
  const abandoned = proof.durable.plans.find(plan=>plan.manifest.run_id===proof.abandoned.run_id);
  assert(abandoned && abandoned.submission_requested === 0 && abandoned.cancellation_requested === 0);
  assert.deepEqual(abandoned.manifest, proof.abandoned);
  assert.equal(proof.durable.plans.filter(plan=>plan.submission_requested===1).length, 3);
  assert(proof.durable.plans.every(plan=>plan.cancellation_requested===0));
  const plot = proof.durable.plans.find(plan => plan.manifest.operation === 'plot');
  assert(plot && plot.submission_requested === 1 && plot.cancellation_requested === 0);
  const test = proof.durable.plans.find(plan => plan.manifest.run_id === proof.approved.run_id);
  assert(test && test.manifest.operation === 'test' && test.submission_requested === 1);
  assert.deepEqual(test.manifest, proof.approved);
  assert.equal(test.manifest.checkpoint_source.run_id, proof.sourceRunId);
  assert.equal(test.manifest.checkpoint_source.generation, proof.selected.value);
  const result = proof.durable.runs.find(run => run.runId === proof.approved.run_id);
  const source = proof.durable.runs.find(run=>run.runId===proof.sourceRunId);
  const publication = source.publications.find(item=>item.generation===proof.selected.value);
  assert(publication && digest(publication.completeSha256));
  assert.equal(proof.approved.checkpoint_source.manifest_sha256, source.manifestSha256);
  assert.equal(proof.approved.checkpoint_source.complete_sha256, publication.completeSha256);
  assert(result && result.publications.length > 0);
  assert(result.events.some(event=>event.type === 'metric' && event.run_id === result.runId && event.payload?.name === 'evaluation' && object(event.payload.metrics) && Object.keys(event.payload.metrics).length > 0 && Object.values(event.payload.metrics).every(value=>typeof value === 'number' && Number.isFinite(value))));
  assert(result.events.some(event=>event.type === 'exit' && event.run_id === result.runId && event.payload?.status === 'completed'));
  for (const publication of result.publications) {
    assert(generation(publication.generation));
    assert(digest(publication.completeSha256));
    assert.equal(publication.complete.run_id, result.runId);
    assert.equal(publication.complete.manifest_sha256, result.manifestSha256);
    assert.deepEqual(publication.complete.files, publication.verifiedFiles);
    assert(object(publication.verifiedFiles) && Object.keys(publication.verifiedFiles).length > 0);
    for (const identity of Object.values(publication.verifiedFiles)) {
      assert(Number.isSafeInteger(identity.size) && identity.size > 0);
      assert(digest(identity.sha256));
    }
  }
  return true;
}

export async function verifyResultOperationsFile(path) {
  const limit = 1024 * 1024;
  path = resolve(path);
  for (let parent = dirname(path); parent !== dirname(parent); parent = dirname(parent)) {
    const parentStat = await lstat(parent);
    assert(parentStat.isDirectory() && !parentStat.isSymbolicLink(), 'Evidence parent must be an ordinary directory');
  }
  const before = await lstat(path);
  assert(before.isFile() && !before.isSymbolicLink() && before.size > 0 && before.size <= limit);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat();
    assert(opened.isFile() && opened.dev === before.dev && opened.ino === before.ino && opened.size === before.size && opened.size > 0 && opened.size <= limit && opened.mtimeMs === before.mtimeMs && opened.ctimeMs === before.ctimeMs);
    const buffer = Buffer.alloc(opened.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat();
    assert(length === opened.size && length <= limit && after.size === opened.size && after.mtimeMs === opened.mtimeMs && after.ctimeMs === opened.ctimeMs);
    const bytes = buffer.subarray(0, length);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const report = JSON.parse(text);
    verifyResultOperationsReport(report);
    const current = await readFile(fileURLToPath(new URL('../src/wavedl_daemon/web_assets/.wavedl-assets.json', import.meta.url)));
    assert.equal(report.assetManifestSha256, createHash('sha256').update(current).digest('hex'), 'Not current packaged assets');
    return report;
  } finally { await handle.close(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await verifyResultOperationsFile(process.argv[2]);
  console.log('result operations report: verified');
}
