import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, realpath, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyPartialBestRecord, verifyPartialBestReport } from './verify_partial_best_browser_report.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const id = value => `11111111-1111-4111-8111-${String(value).padStart(12, '0')}`;
const options = { assetHash: 'a'.repeat(64), browser: 'agent-browser test', directory: '/owned/report' };
function valid(mode = 'fallback') {
  const name = `partial-best-${mode}`, count = mode === 'fallback' ? 2 : 1;
  const train = { operation: 'train', run_id: id(1), resolved_config: { epochs: 3 } };
  const files = Object.fromEntries(['pytorch_model.bin', 'training_meta.pkl', 'scaler.pkl', 'checkpoint_selection.json'].map(key => [key, { size: 1, sha256: 'b'.repeat(64) }]));
  const complete = { schema_version: 1, run_id: id(1), generation: 'gen-000002', attempt: 1, step: 4, manifest_sha256: 'c'.repeat(64), files: { 'checkpoint_selection.json': { size: 37, sha256: hash('{"schema_version": 1, "kind": "best"}') } } };
  const plot = { operation: 'plot', run_id: id(2), checkpoint_source: { run_id: id(1), generation: 'gen-000001', manifest_sha256: complete.manifest_sha256, complete_sha256: 'd'.repeat(64), selection: { schema_version: 1, kind: 'best' }, files: structuredClone(files) } };
  const durable = { plans: count, runs: Array.from({ length: count }, (_, i) => ({ run_id: id(i + 1), state: 'completed' })), control: Array.from({ length: count }, (_, i) => ({ plan_id: id(i + 3), submission_requested: 1, cancellation_requested: 0 })), executions: Array.from({ length: count }, (_, i) => ({ plan_id: id(i + 3), state: 'submitted', cancel_delivered: 0, observed_status: 'terminal' })) };
  const visibleGenerations = mode === 'fallback' ? ['gen-000001', 'gen-000002'] : ['gen-000002'];
  const record = {
    name, status: 'passed', browser: options.browser, assetManifestSha256: options.assetHash,
    driverReadinessMode: 'sync-exposure-poll-and-two-controller-dom-observations',
    browserViewport: { width: 1280, height: 900 }, browserProfile: { path: join(options.directory, `${name}-browser-profile`), initiallyEmpty: true }, freshStorage: { local: [], session: [], cookies: '' },
    pythonInterpreter: '/owned/python', assertions: Array(6).fill('Executable assertion'), started: '2026-10-18T00:00:00Z', finished: '2026-10-18T00:01:00Z',
    approvedPlan: JSON.stringify(train), partialBestPlans: mode === 'fallback' ? [train, plot] : [train],
    partialBestPublication: { mode, runId: id(1), attempt: 1, olderCompleteBest: 'gen-000001', partialGeneration: 'gen-000002', partialComplete: complete, originalCompleteSha256: { 'gen-000001': 'd'.repeat(64) }, visibleGenerations, quarantined: mode === 'refusal' ? ['gen-000001'] : [] },
    finalRegistry: durable, partialBestFrozenRegistry: structuredClone(durable), partialBestFrozenAfterCleanup: true,
    partialBestInventories: [{ status: 200, path: `/api/runs/${id(1)}/artifacts`, body: { generations: [...(mode === 'fallback' ? [{ generation: 'gen-000001', attempt: 1, step: 3, files }] : []), { generation: 'gen-000002', attempt: 1, step: 4, files: complete.files }] } }],
    partialBestRequests: Array.from({ length: count }, () => ['/api/runs/plan', '/api/runs'].map(path => ({ method: 'POST', path, status: 200, scopeHeaderPresent: true }))).flat(),
    partialBestPlanReceipts: Array.from({ length: count }, (_, sequence) => ({ sequence, method: 'POST', path: '/api/runs/plan' })),
    cleanup: { errors: [], fixtureExit: { code: null, signal: 'SIGINT' }, browserSessionAbsent: true, fixtureServicesClosed: true, removedOwnedRoots: true, browserProfileRemoved: true },
  };
  if (mode === 'fallback') {
    record.partialBestRaster = { width: 30, height: 20, rgbaSha256: 'f'.repeat(64) };
    record.partialBestDownload = { size: 400, sha256: 'e'.repeat(64) };
    record.partialBestPng = { ...record.partialBestRaster, ...record.partialBestDownload, generation: 'gen-000001', attempt: 1, inventory: { size: 400, sha256: 'e'.repeat(64) } };
  } else {
    record.partialBestBefore = structuredClone(durable);
    record.partialBestUi = 'Connected Automatic plots unavailable: the published checkpoint is incomplete.';
  }
  return record;
}
for (const mode of ['fallback', 'refusal']) test(`accepts complete internally consistent ${mode} evidence`, () => verifyPartialBestRecord(valid(mode), options));
for (const mode of ['fallback', 'refusal']) {
  for (const key of ['explicitFixtureWebAssets', 'authoringEventDiagnostic']) {
    for (const value of ['/alternate/instrumented-assets', false, '']) {
      test(`rejects ${mode} presence of ${key} with ${JSON.stringify(value)}`, () => {
        const record = valid(mode); record[key] = value;
        assert.throws(() => verifyPartialBestRecord(record, options));
      });
    }
  }
}

const attacks = [
  ['status', r => { r.status = 'failed'; }],
  ['error flag', r => { r.error = ''; }],
  ['skip flag', r => { r.skipped = false; }],
  ['cleanup retained', r => { r.cleanup.retainedPrivateRoots = []; }],
  ['cleanup false', r => { r.cleanup.browserProfileRemoved = false; }],
  ['cleanup forced', r => { r.cleanup.fixtureExit.signal = 'SIGKILL'; }],
  ['asset hash', r => { r.assetManifestSha256 = '0'.repeat(64); }],
  ['browser version', r => { r.browser = 'other'; }],
  ['profile ownership', r => { r.browserProfile.path = '/foreign'; }],
  ['scope frozen', r => { r.partialBestFrozenAfterCleanup = false; }],
  ['newer order', r => { r.partialBestPublication.partialGeneration = 'gen-000001'; }],
  ['source pin', r => { r.partialBestPlans[1].checkpoint_source.generation = 'gen-000002'; }],
  ['COMPLETE hash', r => { r.partialBestPlans[1].checkpoint_source.complete_sha256 = '0'.repeat(64); }],
  ['manifest hash', r => { r.partialBestPlans[1].checkpoint_source.manifest_sha256 = '0'.repeat(64); }],
  ['source files', r => { delete r.partialBestPlans[1].checkpoint_source.files.scaler; r.partialBestPlans[1].checkpoint_source.files.other = { size: 1, sha256: 'b'.repeat(64) }; }],
  ['PNG bytes', r => { r.partialBestDownload.sha256 = '0'.repeat(64); }],
  ['missing native download', r => { delete r.partialBestDownload; }],
  ['PNG pixels', r => { r.partialBestRaster.rgbaSha256 = '0'.repeat(64); }],
  ['PNG budget', r => { r.partialBestPng.width = 9000; }],
  ['late work', r => { r.partialBestFrozenRegistry.plans = 3; }],
  ['cancel intent', r => { r.finalRegistry.control[0].cancellation_requested = 1; }],
  ['cancel delivered', r => { r.finalRegistry.executions[0].cancel_delivered = 1; }],
  ['extra plan request', r => { r.partialBestRequests.push({ method: 'POST', path: '/api/runs/plan', status: 200, scopeHeaderPresent: true }); }],
  ['masked cancellation', r => { r.partialBestRequests.push({ method: 'POST', path: `/api/runs/${id(1)}/[endpoint]`, status: 200 }); }],
  ['mutation alternate method', r => { r.partialBestRequests.push({ method: 'DELETE', path: '/api/runs', status: 200 }); }],
  ['arrival receipt', r => { r.partialBestPlanReceipts.pop(); }],
  ['inventory HTTP', r => { r.partialBestInventories[0].status = 500; }],
  ['inventory lacks partial', r => { r.partialBestInventories[0].body.generations.pop(); }],
];
for (const [name, mutate] of attacks) test(`rejects ${name}`, () => { const record = valid(); mutate(record); assert.throws(() => verifyPartialBestRecord(record, options)); });
test('rejects refusal with invented extra plot or missing UI', () => {
  for (const mutate of [r => { r.partialBestPlans.push({ operation: 'plot', run_id: id(2) }); }, r => { r.partialBestUi = 'Connected'; }]) {
    const record = valid('refusal'); mutate(record); assert.throws(() => verifyPartialBestRecord(record, options));
  }
});
test('bounded file reader refuses symlink report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'partial-best-verifier-test-'));
  try {
    await writeFile(join(directory, 'real.json'), '{}');
    await symlink(join(directory, 'real.json'), join(directory, 'summary.json'));
    await assert.rejects(verifyPartialBestReport(join(directory, 'summary.json')));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('file guard verifies current assets and rejects summary/per-case or directory tampering', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'partial-best-report-test-')));
  const assetHash = hash(await readFile(new URL('../src/wavedl_daemon/web_assets/.wavedl-assets.json', import.meta.url)));
  try {
    const record = valid();
    record.assetManifestSha256 = assetHash;
    record.browserProfile.path = join(directory, `${record.name}-browser-profile`);
    const summary = { browser: record.browser, started: record.started, finished: record.finished, cases: [record] };
    const summaryPath = join(directory, 'summary.json'), casePath = join(directory, `${record.name}.json`);
    const save = async (value = summary, perCase = record) => {
      await writeFile(summaryPath, JSON.stringify(value));
      await writeFile(casePath, JSON.stringify(perCase));
    };
    await save();
    await verifyPartialBestReport(summaryPath);
    for (const mutate of [
      value => { value.cases.push(structuredClone(record)); },
      value => { value.skipped = false; },
      value => { value.finished = '2020-01-01'; },
      value => { value.cases[0].assetManifestSha256 = '0'.repeat(64); },
    ]) {
      const changed = structuredClone(summary); mutate(changed); await save(changed);
      await assert.rejects(verifyPartialBestReport(summaryPath));
    }
    const changed = structuredClone(record); changed.partialBestFrozenAfterCleanup = false;
    await save(summary, changed);
    await assert.rejects(verifyPartialBestReport(summaryPath));
    await save(); await writeFile(join(directory, 'unexpected.json'), '{}');
    await assert.rejects(verifyPartialBestReport(summaryPath));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
