import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { numericalSourceFingerprint, verifyNumericalFailureFile, verifyNumericalFailureReport } from './verify_numerical_failure_browser_report.mjs';

// Synthetic verifier contracts only: these are never represented as browser proof.
const sha = 'a'.repeat(64), file = { size: 12, sha256: sha };
const ids = Array.from({ length: 4 }, (_, index) => `${index + 1}`.repeat(8) + '-1111-4111-8111-' + `${index + 1}`.repeat(12));
const python = '/usr/bin/python3';
function base() {
  const sources = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`source/${i}`, sha]));
  for (const path of ['src/wavedl/test.py', 'src/wavedl_daemon/web_assets/.wavedl-assets.json', 'tools/verify_numerical_failure_browser_report.test.mjs']) sources[path] = sha;
  const publication = { generation: 'gen-000001', completeSha256: sha,
    selectionMetadata: { kind: 'best' },
    complete: { run_id: ids[0], manifest_sha256: sha, files: { 'model_weights.pth': file, 'scaler.pkl': file, 'checkpoint_selection.json': file } },
    verifiedFiles: { 'model_weights.pth': file, 'scaler.pkl': file, 'checkpoint_selection.json': file } };
  const manifests = ids.map((run_id, index) => ({ run_id, operation: index ? 'test' : 'train', runtime: { python },
    resolved_config: index ? { save_predictions: true, data_path: `/fixture/${['nan', 'inf', 'empty'][index - 1]}.npz` } : {},
    ...(index ? { checkpoint_source: { run_id: ids[0], generation: 'gen-000001', manifest_sha256: sha, complete_sha256: sha } } : {}) }));
  const plans = manifests.map((manifest, index) => ({ plan_id: ids[index], request_id: ids[index], plan_json: JSON.stringify({ manifest_json: JSON.stringify(manifest) }),
    request_payload_json: JSON.stringify({ backend: 'local', operation: manifest.operation, runtime: { python, device: 'cpu' }, config: manifest.resolved_config, checkpoint_source: manifest.checkpoint_source }) }));
  const runs = ids.map((run_id, index) => {
    const events = [
      { type: 'hello', run_id, attempt: 1, seq: 0, payload: { device: 'cpu', interpreter: python } },
      { type: index ? 'error' : 'metric', run_id, attempt: 1, seq: 1, payload: { code: 'OPERATION_FAILED', message: index === 3 ? 'Evaluation and prediction require nonempty input data' : 'Model predictions contain nonfinite values' } },
      { type: 'exit', run_id, attempt: 1, seq: 2, payload: { status: index ? 'failed' : 'completed', code: index ? 1 : 0 } },
    ];
    return { run_id, operation: index ? 'test' : 'train', state: index ? 'failed' : 'completed', manifest: manifests[index],
      files: index ? { 'manifest.json': file } : { 'manifest.json': file, 'checkpoints/gen-000001/COMPLETE.json': file, 'checkpoints/gen-000001/model_weights.pth': file, 'checkpoints/gen-000001/scaler.pkl': file, 'checkpoints/gen-000001/checkpoint_selection.json': file },
      publications: index ? [] : [publication], directories: [], events, runtimeEvents: events };
  });
  const snapshot = count => structuredClone({ runs: runs.slice(0, count), plans: plans.slice(0, count),
    provenance: runs.slice(0, count).map(run => ({ run_id: run.run_id, plan_id: run.run_id, attempt: 1, event_json: JSON.stringify(run.runtimeEvents[0]) })),
    control: plans.slice(0, count).map(plan => ({ plan_id: plan.plan_id, submission_requested: 1, cancellation_requested: 0 })),
    executions: plans.slice(0, count).map((plan, index) => ({ plan_id: plan.plan_id, attempt: 1, cancel_delivered: 0, state: 'submitted',
      handle_json: JSON.stringify({ pid: index + 100 }), latest_observation_json: JSON.stringify({ status: 'terminal', exit_code: index ? 1 : 0 }) })) });
  const cases = ['nan', 'inf', 'empty'].map((name, index) => {
    const body = JSON.stringify({ run_id: ids[index + 1], plan_id: ids[index + 1], request_id: ids[index + 1], state: 'failed', uncertainty: false,
      evidence: { confidence: 'confirmed', last_observation: { exit_code: 1 } } });
    const errorMessage = runs[index + 1].runtimeEvents[1].payload.message;
    return { name, approved: manifests[index + 1], durable: snapshot(index + 2), ui: { selectedRunId: ids[index + 1], state: 'failed', errorMessage, text: `${ids[index + 1]} failed error: ${errorMessage}`, atMs: 100 },
      wire: [{ path: `/api/runs/${ids[index + 1]}`, method: 'GET', status: 200, authenticated: true, scoped: true, browser: true,
        rawBody: body, bodySha256: createHash('sha256').update(body).digest('hex') }] };
  });
  return { name: 'numerical-failure', status: 'passed', scope: 'same-host mounted Results CPU numerical-input failure only; not all P3',
    origin: 'http://127.0.0.1:12345', bootstrapConsumed: true, browser: 'agent-browser 0.26.0', profileInitiallyEmpty: true,
    browserRuntime: { userAgent: 'HeadlessChrome/145.0.0.0', width: 1280, height: 900 }, assetManifestSha256: sha, selected: { label: 'gen-000001 best', value: 'gen-000001' }, sourceRunId: ids[0],
    sourcesBefore: sources, sourcesAfter: structuredClone(sources), before: snapshot(1), after: snapshot(4), cases,
    datasets: Object.fromEntries(['nan', 'inf', 'empty'].map(name => [name, { ...file, keys: ['X'], shape: name === 'empty' ? [0, 32] : [4, 32], nanCount: name === 'nan' ? 1 : 0, infCount: name === 'inf' ? 1 : 0 }])),
    processResults: ids.map((runId, index) => ({ runId, attempt: 1, pid: index + 100, returncode: index ? 1 : 0, cancelled: false, timedOut: false, pidAbsent: true })),
    cleanup: { errors: [], browserSessionAbsent: true, fixtureServicesClosed: true, ownedRootRemoved: true, browserProfileRemoved: true,
      listenerAbsent: true, fixturePidAbsent: true, tokenRemoved: true, fixtureExit: { code: 0, signal: null } } };
}

test('accepts internally coherent synthetic verifier contract, not browser acceptance', () => assert.equal(verifyNumericalFailureReport(base()), true));
for (const [name, mutate] of [
  ['changed source', r => r.sourcesAfter['src/wavedl/test.py'] = 'b'.repeat(64)],
  ['unpinned browser version', r => r.browser = 'agent-browser 0.25.0'],
  ['not Chrome', r => r.browserRuntime.userAgent = 'Firefox/145.0'],
  ['nonempty owned profile', r => r.profileInitiallyEmpty = false],
  ['wrong viewport', r => r.browserRuntime.width = 800],
  ['periodic checkpoint posing as best', r => r.before.runs[0].publications[0].selectionMetadata.kind = 'periodic'],
  ['extra cleanup failure', r => r.cleanup.retainedPrivateRoots = []],
  ['duplicate case', r => r.cases[1].name = 'nan'],
  ['targets present', r => r.datasets.nan.keys.push('y')],
  ['finite NaN case', r => r.datasets.nan.nanCount = 0],
  ['empty not empty', r => r.datasets.empty.shape = [4, 32]],
  ['foreign pin', r => r.cases[0].approved.checkpoint_source.generation = 'gen-000002'],
  ['mutated training', r => r.after.runs[0].files['manifest.json'].sha256 = 'b'.repeat(64)],
  ['cancel requested', r => r.after.control[1].cancellation_requested = 1],
  ['duplicate execution', r => r.after.executions.push(r.after.executions[1])],
  ['unconfirmed public state', r => r.cases[0].wire = []],
  ['foreign mounted UI', r => r.cases[0].ui.selectedRunId = ids[2]],
  ['generic failed text', r => r.cases[0].ui.errorMessage = null],
  ['request differs from approved manifest', r => r.cases[0].durable.plans[1].request_payload_json = JSON.stringify({})],
  ['missing persisted runtime provenance', r => r.cases[0].durable.provenance = []],
  ['unscoped public GET', r => r.cases[0].wire[0].scoped = false],
  ['wire digest tamper', r => r.cases[0].wire[0].bodySha256 = 'b'.repeat(64)],
  ['runtime success', r => r.cases[0].durable.runs[1].runtimeEvents.at(-1).payload.code = 0],
  ['runtime not CPU', r => r.cases[0].durable.runs[1].runtimeEvents[0].payload.device = 'cuda'],
  ['output publication', r => r.cases[0].durable.runs[1].publications.push({})],
  ['prediction CSV', r => r.cases[0].durable.runs[1].files['predictions.csv'] = file],
  ['incomplete generation', r => r.cases[0].durable.runs[1].directories.push('checkpoints/gen-000002')],
  ['nonreaped process', r => r.processResults[1].pidAbsent = false],
  ['wrong process exit', r => r.processResults[1].returncode = 0],
  ['retained profile', r => r.cleanup.browserProfileRemoved = false],
  ['live listener', r => r.cleanup.listenerAbsent = false],
  ['retained credential', r => r.cleanup.tokenRemoved = false],
]) test(`rejects ${name}`, () => { const report = base(); mutate(report); assert.throws(() => verifyNumericalFailureReport(report)); });

test('file verifier rejects wrong filename, stale inventory, invalid UTF8, symlink and oversized report', async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'wavedl-numerical-verifier-'));
  const path = join(directory, 'numerical-failure.json');
  try {
    await writeFile(path, JSON.stringify(base())); await assert.rejects(verifyNumericalFailureFile(path));
    await assert.rejects(verifyNumericalFailureFile(join(directory, 'wrong.json')));
    await writeFile(path, Buffer.from([0xff])); await assert.rejects(verifyNumericalFailureFile(path));
    await writeFile(path, 'x'.repeat(2 * 1024 * 1024 + 1)); await assert.rejects(verifyNumericalFailureFile(path));
    const child = join(directory, 'child'); await symlink(directory, child); await assert.rejects(verifyNumericalFailureFile(join(child, 'numerical-failure.json')));
  } finally { await rm(directory, { recursive: true }); }
});

test('numerical verifier rejects non-passed, skipped, or contract-only reports', () => {
  for (const report of [
    null,
    { name: 'numerical-failure', status: 'failed' },
    { name: 'numerical-failure', status: 'passed', skip: 'fixture' },
    { name: 'numerical-failure', status: 'passed', scope: 'synthetic contract' },
  ]) assert.throws(() => verifyNumericalFailureReport(report));
});

test('source fingerprint covers frozen production, web, packaged assets, and this verifier', async () => {
  const fingerprint = await numericalSourceFingerprint();
  assert(Object.hasOwn(fingerprint, 'src/wavedl/test.py'));
  assert(Object.hasOwn(fingerprint, 'src/wavedl_daemon/web_assets/.wavedl-assets.json'));
  assert(Object.hasOwn(fingerprint, 'web/app/app.vue'));
  assert(Object.hasOwn(fingerprint, 'tools/verify_numerical_failure_browser_report.mjs'));
  assert(Object.hasOwn(fingerprint, 'tools/verify_numerical_failure_browser_report.test.mjs'));
  assert(Object.values(fingerprint).every(value => /^[a-f0-9]{64}$/.test(value)));
});
