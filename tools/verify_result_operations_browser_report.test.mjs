import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { verifyResultOperationsFile, verifyResultOperationsReport } from './verify_result_operations_browser_report.mjs';

const ids = ['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
const hash = 'a'.repeat(64);
function base() {
  const pin = { run_id: ids[0], generation: 'gen-000001', manifest_sha256: hash, complete_sha256: hash };
  const approved = { operation: 'test', run_id: ids[1], resolved_config: { batch_size: 16 }, checkpoint_source: pin };
  const abandoned = { operation: 'test', run_id: ids[2] };
  const files = { 'predictions.csv': { size: 4, sha256: hash } };
  const publication = runId => ({ generation: 'gen-000001', completeSha256: hash, complete: { run_id: runId, manifest_sha256: hash, files }, verifiedFiles: files });
  return { name: 'result-operations', status: 'passed', assetManifestSha256: hash,
    cleanup: { errors: [], browserSessionAbsent: true, fixtureServicesClosed: true, fixtureExit: { code: 0, signal: null }, removedOwnedRoots: true, browserProfileRemoved: true },
    resultOperations: { scope: 'Same-host explicit CPU evaluation; unsupported opset refusal and draft revocation, not cancellation/ONNX/CV/remote matrix', selected: { value: 'gen-000001' }, sourceRunId: ids[0], refusal: { invalid: 'true', approvalAbsent: true, before: { plans: 2 }, after: { plans: 2 } }, approved, abandoned,
      durable: { plans: [
        { plan_id: 'train', manifest: { operation: 'train', run_id: ids[0] }, submission_requested: 1, cancellation_requested: 0 },
        { plan_id: 'plot', manifest: { operation: 'plot' }, submission_requested: 1, cancellation_requested: 0 },
        { plan_id: 'old', manifest: abandoned, submission_requested: 0, cancellation_requested: 0 },
        { plan_id: 'test', manifest: approved, submission_requested: 1, cancellation_requested: 0 },
      ], runs: [
        { runId: ids[0], state: 'completed', manifestSha256: hash, publications: [publication(ids[0])], events: [] },
        { runId: ids[1], state: 'completed', manifestSha256: hash, publications: [publication(ids[1])], events: [{ type: 'metric', run_id: ids[1], payload: { name: 'evaluation', metrics: { mae_avg: 0.1 } } }, { type: 'exit', run_id: ids[1], payload: { status: 'completed' } }] },
      ] },
    },
  };
}
test('accepts complete explicit result operation evidence', () => assert.equal(verifyResultOperationsReport(base()), true));
test('accepts reaped SIGINT fixture and refuses missing or failed exit shape', () => {
  const report = base();
  report.cleanup.fixtureExit = { code: null, signal: 'SIGINT' };
  assert.equal(verifyResultOperationsReport(report), true);
  for (const exit of [null, {}, { code: null, signal: null }, { code: 1, signal: null }, { code: 0, signal: 'SIGINT' }, { code: null, signal: 'SIGKILL' }]) {
    report.cleanup.fixtureExit = exit;
    assert.throws(() => verifyResultOperationsReport(report));
  }
});
for (const metrics of [[0.1], 'metric', { mae_avg: '0.1' }, { mae_avg: NaN }]) {
  test(`rejects non-numeric dictionary metrics ${JSON.stringify(metrics)}`, () => {
    const report = base();
    report.resultOperations.durable.runs[1].events[0].payload.metrics = metrics;
    assert.throws(() => verifyResultOperationsReport(report));
  });
}
test('bounded file reader accepts current ordinary evidence and refuses unsafe files', async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'wavedl-result-verifier-'));
  try {
    const report = base();
    report.assetManifestSha256 = createHash('sha256').update(await readFile(new URL('../src/wavedl_daemon/web_assets/.wavedl-assets.json', import.meta.url))).digest('hex');
    const file = join(directory, 'report.json');
    await writeFile(file, JSON.stringify(report));
    assert.deepEqual(await verifyResultOperationsFile(file), report);
    const link = join(directory, 'link.json');
    await symlink(file, link);
    await assert.rejects(verifyResultOperationsFile(link));
    const parentLink = join(directory, 'parent-link');
    await symlink(directory, parentLink);
    await assert.rejects(verifyResultOperationsFile(join(parentLink, 'report.json')));
    await assert.rejects(verifyResultOperationsFile(directory));
    const invalidUtf8 = Buffer.from(JSON.stringify({ ...report, note: 'INVALID_UTF8' }));
    invalidUtf8[invalidUtf8.indexOf('INVALID_UTF8')] = 0xff;
    await writeFile(file, invalidUtf8);
    await assert.rejects(verifyResultOperationsFile(file));
    await writeFile(file, '');
    await assert.rejects(verifyResultOperationsFile(file));
    await writeFile(file, 'x'.repeat(1024 * 1024 + 1));
    await assert.rejects(verifyResultOperationsFile(file));
    if (process.platform !== 'win32') {
      const fifo = join(directory, 'report.pipe');
      execFileSync('mkfifo', [fifo]);
      await assert.rejects(verifyResultOperationsFile(fifo));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
for (const [name, mutate] of [['failed report', r=>r.status='failed'], ['wrong scenario', r=>r.name='baseline'], ['missing cleanup', r=>r.cleanup.browserSessionAbsent=false], ['unexpected cleanup evidence', r=>r.cleanup.retainedPrivateRoots=[]], ['non-boolean cleanup', r=>r.cleanup.browserProfileRemoved=1], ['non-string report digest', r=>r.assetManifestSha256=42], ['refusal writes plan', r=>r.resultOperations.refusal.after.plans++], ['foreign source', r=>r.resultOperations.approved.checkpoint_source.run_id=ids[2]], ['wrong source digest', r=>r.resultOperations.approved.checkpoint_source.complete_sha256='b'.repeat(64)], ['submitted abandoned preview', r=>r.resultOperations.durable.plans[2].submission_requested=1], ['no evaluation producer metric', r=>r.resultOperations.durable.runs[1].events=[]], ['no publication', r=>r.resultOperations.durable.runs[1].publications=[]], ['incomplete result', r=>r.resultOperations.durable.runs[1].state='running'], ['bad artifact digest', r=>r.resultOperations.durable.runs[1].publications[0].verifiedFiles['predictions.csv'].sha256='bad']]) test(`rejects ${name}`, () => { const report=base(); mutate(report); assert.throws(()=>verifyResultOperationsReport(report)); });
