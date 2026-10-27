import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boundedFile } from './browser_files.mjs';
import { currentAssetDigest } from './verify_adoption_negative_browser_report.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const uuid = value => assert.match(value, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
const preset = { epochs: 23, lr: 0.002, batch_size: 24, patience: 7 };
const fixtures = [
  ['malformed-json', 'malformed', '{"epochs":'],
  ['forbidden-authority-fields', 'forbidden-fields', JSON.stringify({ model: 'custom.untrusted', data_path: '/tmp/retarget.npz', runtime: { python: '/tmp/x' }, output_dir: '/tmp/output', import_modules: ['untrusted.module'], epochs: 22 })],
  ['invalid-range', 'invalid-range', JSON.stringify({ epochs: 0, batch_size: -1, patience: -1 })],
];
const invalidMessage = 'Invalid preset. Use a JSON object containing only typed training fields, without dataset, model, runtime or output paths.';
const labels = { epochs: 'epochs', patience: 'patience', batch_size: 'batch size', lr: 'lr' };

function fileEvidence(value, content, suffix) {
  assert.equal(value.content, content);
  assert.equal(value.size, Buffer.byteLength(content));
  assert.equal(value.sha256, hash(content));
  assert(value.filename.endsWith(`/preset-import-${suffix}.json`));
}
function registry(value, rows) {
  assert.deepEqual(value, { runs: [], plans: rows.length, control: rows.map(row => ({ plan_id: row[0], submission_requested: 0, cancellation_requested: 0 })), submissions: [], executions: [] });
}
function rowEvidence(row, approved, interpreter) {
  assert.equal(row.length, 3); uuid(row[0]);
  const request = JSON.parse(row[1]), plan = JSON.parse(row[2]);
  assert.deepEqual(JSON.parse(plan.manifest_json), approved);
  uuid(approved.run_id);
  assert.equal(request.operation, 'train'); assert.equal(approved.operation, 'train');
  assert.equal(request.backend, 'local'); assert.equal(plan.target, 'local');
  assert.equal(plan.allocation_mode, 'writer');
  const { output_dir, ...config } = approved.resolved_config;
  assert.equal(output_dir, approved.run_directory);
  assert.deepEqual(request.config, config);
  assert.equal(config.model, 'cnn'); assert(config.data_path.endsWith('/samples.npz'));
  assert.equal(request.runtime.python, interpreter);
  assert.equal(request.runtime.device, 'cpu'); assert.equal(request.runtime.mode, 'existing');
  assert.deepEqual(request.runtime.environment, {});
  assert.deepEqual(approved.runtime, { ...request.runtime, container: null });
  assert.deepEqual(plan.topology, request.topology);
  return request;
}

export function verifyPresetImportRecord(r) {
  assert.equal(r.name, 'preset-import'); assert.equal(r.status, 'passed');
  for (const key of ['error', 'shutdownError', 'trainingEditorFailure', 'retainedPrivateRoots', 'explicitFixtureWebAssets', 'skipped', 'skip', 'skipReason']) assert(!Object.hasOwn(r, key));
  assert.match(r.browser, /agent-browser/);
  assert.equal(r.driverReadinessMode, 'sync-exposure-poll-and-two-controller-dom-observations');
  assert.equal(r.browserProfile.initiallyEmpty, true);
  assert.deepEqual(r.browserViewport, { width: 1280, height: 900 });
  assert.match(r.browserRuntime.userAgent, /Chrome\/[0-9]+/);
  assert.deepEqual(r.freshStorage, { local: [], session: [], cookies: '' });
  assert.equal(r.presetImportRequestsFrozenAfterCleanup, true);
  assert.deepEqual(r.cleanup.errors, []);
  assert(!Object.hasOwn(r.cleanup, 'retainedPrivateRoots'));
  for (const key of ['browserSessionAbsent', 'fixtureServicesClosed', 'listenerClosed', 'browserProfileRemoved', 'removedOwnedRoots']) assert.equal(r.cleanup[key], true);
  assert((r.cleanup.fixtureExit.code === 0 && r.cleanup.fixtureExit.signal === null) || (r.cleanup.fixtureExit.code === null && r.cleanup.fixtureExit.signal === 'SIGINT'));
  assert.deepEqual(r.presetImportDurableCounts, { plans: 2, plan_control: 2, execution_control: 0, submission_control: 0, runs: 0, runtime_provenance: 0, event_log: 0 });
  assert.deepEqual(r.presetImportReceipts, [0, 1].map(sequence => ({ sequence, method: 'POST', path: '/api/runs/plan' })));
  assert(r.presetImportRequests.length > 0 && r.presetImportRequests.length <= 512);
  for (const request of r.presetImportRequests) {
    assert(['GET', 'POST'].includes(request.method));
    assert.equal(request.status, 200); assert.deepEqual(request.cursor, {});
    assert.equal(typeof request.scopeHeaderPresent, 'boolean');
    if (request.method === 'POST') {
      assert(['/api/browse/resolve', '/api/datasets/inspect', '/api/runs/plan'].includes(request.path));
      assert.equal(request.scopeHeaderPresent, true);
    } else assert(['/api/health', '/api/runs', '/api/[unrecorded]'].includes(request.path));
  }
  const plans = r.presetImportRequests.filter(request => request.path === '/api/runs/plan');
  assert.equal(plans.length, 2); assert(plans.every(request => request.method === 'POST'));
  const e = r.presetImportEvidence, b = e.baseline, f = e.final, v = e.validRetry;
  assert.equal(e.noSubmission, true);
  assert.equal(b.planRows.length, 1); assert.equal(f.planRows.length, 2);
  assert.equal(new Set(f.planRows.map(row => row[0])).size, 2);
  registry(b.registry, b.planRows); registry(f.registry, f.planRows);
  assert.deepEqual(r.finalRegistry, f.registry);
  const first = b.planRows[0];
  assert.deepEqual(f.planRows.find(row => row[0] === first[0]), first);
  const last = f.planRows.find(row => row[0] !== first[0]);
  const beforeRequest = rowEvidence(first, b.approvedManifest, r.pythonInterpreter);
  const finalRequest = rowEvidence(last, f.approvedManifest, r.pythonInterpreter);
  assert.notEqual(b.approvedManifest.run_id, f.approvedManifest.run_id);
  assert.deepEqual(finalRequest, { ...beforeRequest, config: { ...beforeRequest.config, ...preset } });
  assert.equal(b.draft.fields['Python interpreter'].value, r.pythonInterpreter);
  assert(b.draft.selection.some(value => value.startsWith('Dataset: ') && value.includes(beforeRequest.config.data_path)));
  assert(b.draft.selection.some(value => value.startsWith('Model: cnn')));
  assert(b.draft.controls.length > 0);
  assert.equal(e.refusals.length, 3);
  for (const [index, refusal] of e.refusals.entries()) {
    const [id, category, content] = fixtures[index];
    assert.equal(refusal.id, id); assert.equal(refusal.category, category);
    fileEvidence(refusal, content, id); assert.equal(refusal.publicMessage, invalidMessage);
    for (const flag of ['draftPreserved', 'approvalPreserved', 'planRowsPreserved', 'registryPreserved', 'inputCleared']) assert.equal(refusal[flag], true);
    assert.deepEqual(refusal.after.draft, b.draft);
    assert.deepEqual(refusal.after.registry, b.registry);
    assert.deepEqual(refusal.after.planRows, b.planRows);
    assert.deepEqual(JSON.parse(refusal.after.approvedManifestText), b.approvedManifest);
  }
  fileEvidence(v, JSON.stringify(preset), 'valid'); assert.deepEqual(v.preset, preset);
  assert.equal(v.publicMessage, 'Validated preset applied to the draft. Review it before planning.');
  for (const flag of ['approvalRevoked', 'selectionAndRuntimePreserved', 'noAutomaticPlan', 'inputCleared']) assert.equal(v[flag], true);
  assert.equal(v.after.approvedManifestText, null);
  assert.deepEqual(v.after.registry, b.registry); assert.deepEqual(v.after.planRows, b.planRows);
  assert.deepEqual(v.after.draft.selection, b.draft.selection);
  const expectedFields = structuredClone(b.draft.fields);
  for (const [name, value] of Object.entries(preset)) expectedFields[labels[name]].value = String(value);
  assert.deepEqual(v.after.draft.fields, expectedFields);
  const expectedControls = b.draft.controls.map(control => {
    const name = Object.keys(preset).find(key => control.id.endsWith(`-training-${key}`));
    return name ? { ...control, value: String(preset[name]) } : control;
  });
  assert.deepEqual(v.after.draft.controls, expectedControls);
  for (const [name, value] of Object.entries(preset)) {
    assert(b.draft.controls.some(control => control.id.endsWith(`-training-${name}`)));
    assert.equal(finalRequest.config[name], value);
  }
  return r;
}
export async function verifyPresetImportFile(path) {
  const r = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await boundedFile(path, 2 * 1024 * 1024)));
  verifyPresetImportRecord(r);
  assert.equal(r.assetManifestSha256, await currentAssetDigest());
  return r;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await verifyPresetImportFile(process.argv[2]);
  console.log('preset import browser report: verified');
}
