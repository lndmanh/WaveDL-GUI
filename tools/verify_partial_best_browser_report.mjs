#!/usr/bin/env node
// Optional one-case assembled proof; deliberately independent of the all12 guard.
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const generation = value => typeof value === 'string' && /^gen-\d{6,}$/.test(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const names = ['partial-best-fallback', 'partial-best-refusal'];
const forbidden = ['error', 'shutdownError', 'skip', 'skipped', 'skipReason', 'failureStage', 'failed', 'failurePage', 'failureSnapshot', 'failureEvidence', 'retainedPrivateRoots', 'ownedSessionStillListed', 'fixtureStderr', 'fixtureAlive', 'explicitFixtureWebAssets', 'authoringEventDiagnostic'];
function noFailure(value) {
  for (const key of forbidden) assert(!Object.hasOwn(value, key), `Failure flag: ${key}`);
}
function positive(value) { assert(Number.isSafeInteger(value) && value > 0); }
function fileIdentity(value) { positive(value.size); assert(digest(value.sha256)); }
function registry(value, count, runIds) {
  assert.equal(value.plans, count);
  for (const key of ['runs', 'control', 'executions']) assert.equal(value[key].length, count);
  assert.deepEqual(value.runs.map(run => run.run_id).sort(), [...runIds].sort());
  assert(value.runs.every(run => run.state === 'completed'));
  const ids = value.control.map(control => control.plan_id);
  assert.equal(new Set(ids).size, count);
  assert(ids.every(uuid));
  assert(value.control.every(control => control.submission_requested === 1 && control.cancellation_requested === 0));
  assert.deepEqual(value.executions.map(execution => execution.plan_id).sort(), [...ids].sort());
  assert(value.executions.every(execution => execution.cancel_delivered === 0 && execution.observed_status === 'terminal' && execution.state === 'submitted'));
}

export function verifyPartialBestRecord(record, { assetHash, browser, directory }) {
  assert(names.includes(record.name));
  noFailure(record);
  assert.equal(record.status, 'passed');
  assert.equal(record.browser, browser);
  assert.equal(record.assetManifestSha256, assetHash);
  assert.equal(record.driverReadinessMode, 'sync-exposure-poll-and-two-controller-dom-observations');
  assert.deepEqual(record.browserViewport, { width: 1280, height: 900 });
  assert.deepEqual(record.browserProfile, { path: join(directory, `${record.name}-browser-profile`), initiallyEmpty: true });
  assert.deepEqual(record.freshStorage, { local: [], session: [], cookies: '' });
  assert(typeof record.pythonInterpreter === 'string' && record.pythonInterpreter.startsWith('/'));
  assert(Array.isArray(record.assertions) && record.assertions.length > 5 && record.assertions.every(value => typeof value === 'string' && value.length > 0));
  assert(Number.isFinite(Date.parse(record.started)) && Number.isFinite(Date.parse(record.finished)) && Date.parse(record.finished) >= Date.parse(record.started));
  const mode = record.name === names[0] ? 'fallback' : 'refusal';
  const count = mode === 'fallback' ? 2 : 1;
  const proof = record.partialBestPublication;
  assert.equal(proof.mode, mode);
  assert(uuid(proof.runId)); positive(proof.attempt);
  assert(generation(proof.olderCompleteBest) && generation(proof.partialGeneration));
  assert(BigInt(proof.partialGeneration.slice(4)) > BigInt(proof.olderCompleteBest.slice(4)));
  const complete = proof.partialComplete;
  assert.equal(complete.schema_version, 1);
  assert.equal(complete.run_id, proof.runId);
  assert.equal(complete.generation, proof.partialGeneration);
  assert.equal(complete.attempt, proof.attempt);
  assert(Number.isSafeInteger(complete.step) && complete.step >= 0);
  assert(digest(complete.manifest_sha256));
  assert.deepEqual(Object.keys(complete.files), ['checkpoint_selection.json']);
  fileIdentity(complete.files['checkpoint_selection.json']);
  assert.deepEqual(complete.files['checkpoint_selection.json'], { size: 37, sha256: hash('{"schema_version": 1, "kind": "best"}') });
  const originals = proof.originalCompleteSha256;
  assert(Object.keys(originals).length > 0 && Object.keys(originals).every(generation) && Object.values(originals).every(digest));
  assert(digest(originals[proof.olderCompleteBest]));
  assert.equal(new Set(proof.visibleGenerations).size, proof.visibleGenerations.length);
  assert(proof.visibleGenerations.every(generation));
  assert.deepEqual([...proof.visibleGenerations].sort(), mode === 'fallback' ? [...Object.keys(originals), proof.partialGeneration].sort() : [proof.partialGeneration]);
  assert.deepEqual([...proof.quarantined].sort(), mode === 'refusal' ? Object.keys(originals).sort() : []);
  assert.equal(record.partialBestPlans.length, count);
  const train = record.partialBestPlans.find(plan => plan.operation === 'train');
  assert(train && train.run_id === proof.runId);
  assert.deepEqual(JSON.parse(record.approvedPlan), train);
  const plot = record.partialBestPlans.find(plan => plan.operation === 'plot');
  const runIds = [train.run_id];
  if (mode === 'fallback') {
    assert(plot && uuid(plot.run_id) && plot.run_id !== train.run_id);
    runIds.push(plot.run_id);
    const pin = plot.checkpoint_source;
    assert.equal(pin.run_id, train.run_id);
    assert.equal(pin.generation, proof.olderCompleteBest);
    assert.equal(pin.manifest_sha256, complete.manifest_sha256);
    assert.equal(pin.complete_sha256, originals[proof.olderCompleteBest]);
    assert.equal(pin.selection.schema_version, 1);
    assert.equal(pin.selection.kind, 'best');
    const png = record.partialBestPng;
    assert(generation(png.generation)); positive(png.attempt);
    fileIdentity(png); assert(png.size <= 16777216 && digest(png.rgbaSha256));
    positive(png.width); positive(png.height);
    assert(png.width <= 8192 && png.height <= 8192 && png.width * png.height <= 16777216);
    assert.deepEqual(png.inventory, { size: png.size, sha256: png.sha256 });
    assert.deepEqual(record.partialBestRaster, { width: png.width, height: png.height, rgbaSha256: png.rgbaSha256 });
    assert.deepEqual(record.partialBestDownload, { size: png.size, sha256: png.sha256 });
  } else {
    assert.equal(plot, undefined);
    assert(['partialBestPng', 'partialBestRaster', 'partialBestDownload'].every(key => !Object.hasOwn(record, key)));
    assert(record.partialBestUi.includes('Automatic plots unavailable: the published checkpoint is incomplete.'));
    assert(record.partialBestUi.includes('Connected'));
    registry(record.partialBestBefore, 1, runIds);
    assert.deepEqual(record.partialBestBefore, record.finalRegistry);
  }
  registry(record.finalRegistry, count, runIds);
  assert.deepEqual(record.partialBestFrozenRegistry, record.finalRegistry);
  assert.equal(record.partialBestFrozenAfterCleanup, true);
  assert(record.partialBestInventories.length > 0 && record.partialBestInventories.length <= 256);
  const inventory = record.partialBestInventories[0];
  assert.equal(inventory.status, 200);
  assert.equal(inventory.path, `/api/runs/${train.run_id}/artifacts`);
  assert.deepEqual(inventory.body.generations.map(value => value.generation).sort(), [...proof.visibleGenerations].sort());
  const partial = inventory.body.generations.find(value => value.generation === proof.partialGeneration);
  assert.deepEqual(partial, { generation: proof.partialGeneration, attempt: proof.attempt, step: complete.step, files: complete.files });
  if (mode === 'fallback') {
    const selected = inventory.body.generations.find(value => value.generation === proof.olderCompleteBest);
    assert.equal(selected.attempt, proof.attempt);
    assert(selected.files['training_meta.pkl'] && selected.files['scaler.pkl']);
    assert(['model_weights.pth', 'model.safetensors', 'model.bin', 'pytorch_model.bin'].some(name => selected.files[name]));
    assert.deepEqual(plot.checkpoint_source.files, selected.files);
    for (const identity of Object.values(selected.files)) fileIdentity(identity);
  }
  const requests = record.partialBestRequests;
  assert(requests.length > 0 && requests.length <= 8192);
  for (const request of requests) {
    assert(['GET', 'POST'].includes(request.method));
    assert(Number.isInteger(request.status) && request.status >= 200 && request.status < 300);
    if (request.method === 'POST') assert(['/api/runs/plan', '/api/runs', '/api/browse/resolve', '/api/datasets/inspect'].includes(request.path), 'Unexpected mutation/cancellation');
  }
  for (const path of ['/api/runs/plan', '/api/runs']) {
    const rows = requests.filter(value => value.method === 'POST' && value.path === path);
    assert.equal(rows.length, count);
    assert(rows.every(value => value.scopeHeaderPresent === true));
  }
  assert.deepEqual(record.partialBestPlanReceipts, Array.from({ length: count }, (_, sequence) => ({ sequence, method: 'POST', path: '/api/runs/plan' })));
  const cleanup = record.cleanup;
  noFailure(cleanup);
  assert.deepEqual(cleanup.errors, []);
  assert((cleanup.fixtureExit.code === 0 && cleanup.fixtureExit.signal === null)
    || (cleanup.fixtureExit.code === null && cleanup.fixtureExit.signal === 'SIGINT'), 'Unexpected fixture termination');
  for (const key of ['browserSessionAbsent', 'fixtureServicesClosed', 'removedOwnedRoots', 'browserProfileRemoved']) assert.equal(cleanup[key], true);
  for (const [key, value] of Object.entries(cleanup)) if (!['errors', 'fixtureExit'].includes(key)) assert.equal(value, true, key);
  return record;
}

async function bytes(path, limit = 1048576) {
  path = resolve(path);
  for (let parent = dirname(path); parent !== dirname(parent); parent = dirname(parent)) {
    const stat = await lstat(parent); assert(stat.isDirectory() && !stat.isSymbolicLink());
  }
  const before = await lstat(path);
  assert(before.isFile() && !before.isSymbolicLink() && before.size > 0 && before.size <= limit);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const start = await file.stat();
    assert(start.dev === before.dev && start.ino === before.ino && start.size === before.size);
    const data = Buffer.alloc(limit + 1); let length = 0;
    while (length < data.length) { const read = await file.read(data, length, data.length - length, null); if (!read.bytesRead) break; length += read.bytesRead; }
    const end = await file.stat();
    assert(length === start.size && length <= limit && end.size === start.size && end.mtimeMs === start.mtimeMs && end.ctimeMs === start.ctimeMs);
    return data.subarray(0, length);
  } finally { await file.close(); }
}
const json = async path => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytes(path)));
export async function verifyPartialBestReport(summaryPath) {
  summaryPath = resolve(summaryPath);
  const directory = dirname(summaryPath);
  const summary = await json(summaryPath);
  noFailure(summary);
  assert.equal(summary.cases.length, 1);
  const record = summary.cases[0];
  assert(names.includes(record.name));
  assert.deepEqual((await readdir(directory)).sort(), [`${record.name}.json`, 'summary.json'].sort());
  assert.equal(summary.browser, record.browser);
  assert(typeof summary.browser === 'string' && summary.browser.length > 0);
  assert(Date.parse(summary.started) <= Date.parse(record.started) && Date.parse(summary.finished) >= Date.parse(record.finished));
  const assets = fileURLToPath(new URL('../src/wavedl_daemon/web_assets/', import.meta.url));
  const manifest = await bytes(join(assets, '.wavedl-assets.json'));
  const assetMap = JSON.parse(manifest);
  assert(Object.keys(assetMap).length > 20);
  for (const [path, identity] of Object.entries(assetMap)) {
    assert(path.split('/').every(part => part && part !== '.' && part !== '..') && !/[\\:%]/.test(path) && digest(identity));
    assert.equal(hash(await bytes(join(assets, path), 16777216)), identity, 'Packaged asset bytes changed');
  }
  assert.deepEqual(await json(join(directory, `${record.name}.json`)), record, 'Summary/per-case evidence differ');
  return verifyPartialBestRecord(record, { assetHash: hash(manifest), browser: summary.browser, directory });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyPartialBestReport(process.argv[2]);
  console.log('partial-best browser report: valid');
}
