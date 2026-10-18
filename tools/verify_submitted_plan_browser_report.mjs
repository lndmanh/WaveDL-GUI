#!/usr/bin/env node
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { lstat, open, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const REPORT_NAME = 'submitted-plan-browser.json';
const limit = 256 * 1024;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digest = (value) => assert(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
const uuid = (value) => assert(typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value));
export function verifySubmittedPlanRecord(record) {
  assert.equal(record.name, 'submitted-plan-authoring-protection');
  assert.equal(record.status, 'passed');
  assert.equal(record.driverReadinessMode, 'sync-exposure-poll-and-two-controller-dom-observations');
  assert.deepEqual(record.freshStorage, { local: [], session: [], cookies: '' });
  digest(record.assetManifestSha256); digest(record.trainingOptionsSha256);
  uuid(record.runId); uuid(record.planId);
  assert.equal(record.authored.epochs, '3');
  assert.equal(record.authored.model, 'cnn');
  assert.equal(record.authored.device, 'cpu');
  assert.equal(record.authored.workers, '0');
  assert.equal(record.authored.precision, 'no');
  assert.equal(record.authored.dataPath.endsWith('/samples.npz'), true);
  assert.equal(record.authored.python, record.pythonInterpreter);
  assert(typeof record.pythonInterpreter === 'string' && record.pythonInterpreter.startsWith('/'));
  assert.equal(record.accepted.state, 'completed');
  assert.deepEqual(record.accepted.manifest.config, {
    epochs: 3, model: 'cnn', data_path: record.authored.dataPath,
  });
  assert.equal(record.accepted.manifest.device, 'cpu');
  assert.equal(record.accepted.manifest.python, record.pythonInterpreter);
  const snapshots = [record.accepted, record.afterEdit, record.afterReset, record.afterNavigation];
  for (const item of snapshots) {
    assert.equal(item.plans, 2); assert.equal(item.executions, 2);
    assert.equal(item.planId, record.planId); assert.equal(item.runId, record.runId);
    assert.equal(item.state, 'completed');
    assert.equal(item.submissionRequested, 1); assert.equal(item.cancellationRequested, 0);
    assert.equal(item.cancelDelivered, 0);
    digest(item.planSha256); digest(item.manifestSha256); digest(item.controlSha256); digest(item.executionSha256);
    assert.equal(item.planSha256, record.accepted.planSha256);
    assert.equal(item.manifestSha256, record.accepted.manifestSha256);
    assert.equal(item.controlSha256, record.accepted.controlSha256);
    assert.equal(item.executionSha256, record.accepted.executionSha256);
  }
  for (const [item, epochs] of [[record.editedUi, '4'], [record.resetUi, record.defaults.epochs]]) {
    assert.equal(item.epochs, epochs);
    assert.equal(item.batchSize, item === record.resetUi ? record.defaults.batchSize : '16');
    assert.equal(item.dataPath, record.authored.dataPath);
    assert.equal(item.model, 'cnn');
    assert.equal(item.python, record.pythonInterpreter);
    assert.equal(item.device, 'cpu');
    assert.equal(item.approvalVisible, false);
    assert.equal(item.approveEnabled, false);
    assert.equal(item.acknowledgedRun, record.runId);
    assert.equal(item.openAcknowledgedEnabled, true);
    assert.equal(item.resetConfirmationVisible, false);
  }
  assert.equal(record.navigation.runId, record.runId);
  assert.equal(record.navigation.runDetailVisible, true);
  assert.deepEqual(record.cleanup, { errors: [], browserSessionAbsent: true, fixtureReaped: true,
    servicesClosed: true, listenerClosed: true, ownedRootsRemoved: true });
  assert.equal(record.limitation, 'One real local CPU completed run; no GPU, Windows, Slurm or release acceptance.');
  return record;
}
export async function verifySubmittedPlanReport(directory) {
  const root = resolve(directory);
  assert.deepEqual(await readdir(root), [REPORT_NAME]);
  const path = join(root, REPORT_NAME), before = await lstat(path);
  assert(before.isFile() && !before.isSymbolicLink() && before.size > 0 && before.size <= limit);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let record;
  try {
    const stat = await file.stat();
    assert(stat.isFile() && stat.ino === before.ino && stat.dev === before.dev && stat.size === before.size && stat.mtimeMs === before.mtimeMs);
    const bytes = Buffer.alloc(limit + 1); let size = 0;
    for (;;) {
      const chunk = await file.read(bytes, size, bytes.length - size, null);
      size += chunk.bytesRead;
      if (!chunk.bytesRead || size === bytes.length) break;
    }
    assert(size > 0 && size <= limit);
    const final = await file.stat();
    assert(final.isFile() && final.ino === stat.ino && final.dev === stat.dev && final.size === size && final.size === stat.size && final.mtimeMs === stat.mtimeMs);
    record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)));
  } finally { await file.close(); }
  verifySubmittedPlanRecord(record);
  const repo = fileURLToPath(new URL('../', import.meta.url));
  const options = await readFile(join(repo, 'web/shared/training-options.json'));
  assert.equal(record.trainingOptionsSha256, hash(options));
  const defaults = Object.fromEntries(JSON.parse(options).map((o) => [o.name, o.default]));
  assert.deepEqual(record.defaults, { epochs: String(defaults.epochs), batchSize: String(defaults.batch_size) });
  assert.equal(record.assetManifestSha256, hash(await readFile(join(repo, 'src/wavedl_daemon/web_assets/.wavedl-assets.json'))));
  return record;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (!process.argv[2]) throw new Error('Usage: verify_submitted_plan_browser_report.mjs REPORT_DIR');
  await verifySubmittedPlanReport(process.argv[2]);
  console.log('submitted-plan browser report: valid');
}
