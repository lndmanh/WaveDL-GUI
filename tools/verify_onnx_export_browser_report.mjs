import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export function verifyOnnxExportReport(report) {
  assert.equal(report.status, 'passed');
  assert.equal(report.name, 'onnx-export');
  assert(digest(report.assetManifestSha256));
  assert(report.cleanup && typeof report.cleanup === 'object' && !Array.isArray(report.cleanup));
  assert.deepEqual(Object.keys(report.cleanup).sort(), ['browserProfileRemoved', 'browserSessionAbsent', 'errors', 'fixtureExit', 'fixtureServicesClosed', 'removedOwnedRoots'].sort());
  assert.deepEqual(report.cleanup.errors, []);
  for (const key of ['browserSessionAbsent', 'fixtureServicesClosed', 'removedOwnedRoots', 'browserProfileRemoved']) assert.equal(report.cleanup[key], true);
  assert(report.cleanup.fixtureExit && ((report.cleanup.fixtureExit.code === 0 && report.cleanup.fixtureExit.signal === null) || (report.cleanup.fixtureExit.code === null && report.cleanup.fixtureExit.signal === 'SIGINT')));
  const proof = report.onnxExport;
  assert.equal(proof.scope, 'Same-host CPU supported opset-17 export-only via evaluation plan; genuine training checkpoint, publication and browser download; not cancellation/CV/remote matrix');
  assert(uuid(proof.sourceRunId) && uuid(proof.approved.run_id));
  assert.equal(proof.approved.operation, 'test');
  assert.equal(proof.approved.resolved_config.export, 'onnx');
  assert.equal(proof.approved.resolved_config.export_opset, 17);
  assert.equal(proof.approved.runtime.device, 'cpu');
  for (const flag of ['save_predictions', 'plot', 'verbose', 'no_denorm']) assert.equal(proof.approved.resolved_config[flag], false);
  assert.equal(proof.approved.checkpoint_source.run_id, proof.sourceRunId);
  assert.equal(proof.approved.checkpoint_source.generation, proof.selected.value);
  assert(/^gen-[0-9]{6,}$/.test(proof.selected.value));
  assert.equal(proof.before.plans, 2);
  assert.equal(proof.previewed.plans, 3);
  assert.deepEqual(proof.before.runs, proof.previewed.runs);
  assert.equal(proof.previewed.control.filter(item => item.submission_requested === 1).length, 2);
  assert(/^[A-Za-z0-9_.-]+\.onnx$/.test(proof.browserDownload.path));
  assert(/^gen-[0-9]{6,}$/.test(proof.browserDownload.generation));
  assert(Number.isSafeInteger(proof.browserDownload.size) && proof.browserDownload.size > 0);
  assert(digest(proof.browserDownload.sha256));
  const durable = proof.durable;
  assert.equal(durable.sourceRunId, proof.sourceRunId);
  assert.equal(durable.resultRunId, proof.approved.run_id);
  assert.equal(durable.sourceGeneration, proof.selected.value);
  assert.deepEqual(durable.artifact, proof.browserDownload);
  assert.equal(proof.approved.checkpoint_source.manifest_sha256, durable.sourceManifestSha256);
  assert.equal(proof.approved.checkpoint_source.complete_sha256, durable.sourceCompleteSha256);
  for (const key of ['sourceManifestSha256', 'resultManifestSha256', 'sourceCompleteSha256']) assert(digest(durable[key]));
  assert.equal(durable.plans.length, 3);
  assert(durable.plans.every(item => item.submission_requested === 1 && item.cancellation_requested === 0));
  assert.deepEqual(durable.plans.find(item => item.manifest.run_id === proof.approved.run_id)?.manifest, proof.approved);
  assert.deepEqual(new Set(durable.runs.map(run => run.runId)), new Set([proof.sourceRunId, proof.approved.run_id]));
  for (const run of durable.runs) {
    assert.equal(run.state, 'completed');
    assert(run.publications.length > 0);
    for (const publication of run.publications) {
      assert(digest(publication.completeSha256));
      assert.equal(publication.complete.run_id, run.runId);
      assert.deepEqual(publication.complete.files, publication.verifiedFiles);
      for (const identity of Object.values(publication.verifiedFiles)) { assert(Number.isSafeInteger(identity.size) && identity.size > 0); assert(digest(identity.sha256)); }
    }
  }
  const result = durable.runs.find(run => run.runId === proof.approved.run_id);
  const source = durable.runs.find(run => run.runId === proof.sourceRunId);
  const selectedSource = source.publications.find(item => item.generation === proof.selected.value);
  assert(selectedSource);
  assert.equal(selectedSource.completeSha256, durable.sourceCompleteSha256);
  assert.equal(selectedSource.complete.manifest_sha256, durable.sourceManifestSha256);
  assert.equal(durable.plans.find(item => item.manifest.run_id === proof.sourceRunId)?.manifest.operation, 'train');
  const publication = result.publications.find(item => item.generation === proof.browserDownload.generation);
  assert(publication);
  assert.equal(publication.complete.manifest_sha256, durable.resultManifestSha256);
  assert.deepEqual(publication.verifiedFiles[proof.browserDownload.path], {size: proof.browserDownload.size, sha256: proof.browserDownload.sha256});
  assert.equal(durable.hello.type, 'hello'); assert.equal(durable.hello.run_id, proof.approved.run_id);
  assert.equal(durable.hello.payload.device, 'cpu'); assert.equal(durable.hello.payload.interpreter, proof.approved.runtime.python);
  assert.equal(durable.onnx.checker, 'passed');
  assert.equal(durable.onnx.provider, 'CPUExecutionProvider');
  assert.equal(durable.onnx.finite, true);
  assert.deepEqual(durable.onnx.providers, ['CPUExecutionProvider']);
  assert.deepEqual(durable.onnx.opsets.filter(item => item.domain === '' || item.domain === 'ai.onnx').map(item => item.version), [17]);
  assert.equal(durable.onnx.comparedWithSource, true);
  assert.equal(durable.onnx.allclose, true);
  assert.deepEqual(durable.onnx.outputShape, durable.onnx.sourceOutputShape);
  assert(Array.isArray(durable.onnx.outputShape) && durable.onnx.outputShape.length === 2 && durable.onnx.outputShape.every(size => Number.isSafeInteger(size) && size > 0));
  assert.equal(durable.onnx.rtol, 1e-4); assert.equal(durable.onnx.atol, 1e-5);
  assert(Number.isFinite(durable.onnx.maxAbsoluteDifference) && durable.onnx.maxAbsoluteDifference >= 0);
  assert(durable.events.some(event => event.type === 'artifact' && event.run_id === proof.approved.run_id && event.payload.generation === proof.browserDownload.generation && event.payload.path === `checkpoints/${proof.browserDownload.generation}/${proof.browserDownload.path}` && event.payload.sha256 === proof.browserDownload.sha256 && event.payload.size === proof.browserDownload.size));
  assert.equal(durable.exit.type, 'exit'); assert.equal(durable.exit.run_id, proof.approved.run_id);
  assert.equal(durable.exit.payload.code, 0);
  assert.equal(durable.exit.payload.status, 'completed');
  return true;
}
export async function verifyOnnxExportFile(path) {
  path = resolve(path);
  for (let parent = dirname(path); parent !== dirname(parent); parent = dirname(parent)) { const stat = await lstat(parent); assert(stat.isDirectory() && !stat.isSymbolicLink()); }
  const before = await lstat(path);
  assert(before.isFile() && !before.isSymbolicLink() && before.size > 0 && before.size <= 1024 * 1024);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat();
    assert(opened.isFile() && opened.dev === before.dev && opened.ino === before.ino && opened.size === before.size);
    assert(opened.size > 0 && opened.size <= 1024 * 1024);
    const bytes = Buffer.alloc(opened.size);
    let length = 0;
    while (length < bytes.length) { const read = await handle.read(bytes, length, bytes.length - length, null); if (!read.bytesRead) break; length += read.bytesRead; }
    const after = await handle.stat();
    assert.equal(length, opened.size); assert.equal(after.size, opened.size); assert.equal(after.mtimeMs, opened.mtimeMs); assert.equal(after.ctimeMs, opened.ctimeMs);
    const report = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); verifyOnnxExportReport(report);
    const assets = await readFile(new URL('../src/wavedl_daemon/web_assets/.wavedl-assets.json', import.meta.url));
    assert.equal(report.assetManifestSha256, createHash('sha256').update(assets).digest('hex'));
    return report;
  } finally { await handle.close(); }
}
if (import.meta.url === `file://${process.argv[1]}`) { await verifyOnnxExportFile(process.argv[2]); console.log('onnx export report: verified'); }
