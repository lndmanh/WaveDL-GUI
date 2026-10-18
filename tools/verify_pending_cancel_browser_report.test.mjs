import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { currentFingerprints, verifyPendingCancelBrowserFile, verifyPendingCancelBrowserReport } from './verify_pending_cancel_browser_report.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
function positiveFixture() {
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const runIds = [id(1), id(2)];
  const view = (i, state, uncertainty, cancellation_requested) => ({ run_id: runIds[i], plan_id: id(i + 3), request_id: id(i + 5), backend: 'local', operation: 'train', attempt: null, state, uncertainty, submission_requested: true, cancellation_requested, evidence: { runtime: { hello_seen: false } } });
  const initial = [view(0, 'submission_unknown', true, false), view(1, 'pending', false, false)];
  const unclaimed = view(1, 'cancelled', false, true); const unknown = view(0, 'submission_unknown', true, true); const receiptPending = view(0, 'observation_unavailable', true, true); const terminal = view(0, 'cancelled', false, true);
  terminal.evidence.backend = { status: 'terminal', native_state: 'CANCELLED' }; terminal.evidence.batch = { status: 'cancelled' };
  const handle = { run_id: runIds[0], pid: 123, supervisor_id: 'synthetic-supervisor' };
  const lineage = (i, delivered) => ({ total: 1, attempts: [{ attempt: null, cancellation_requested: true, execution_state: i === 0 ? 'submitted' : 'pending', cancel_delivered: delivered, submission_handle: i === 0 ? structuredClone(handle) : null, submission_observation: i === 0 && delivered ? { status: 'terminal', native_state: 'CANCELLED' } : null }] });
  const finalLineage = [lineage(0, true), lineage(1, false)]; const receiptLineage = lineage(0, false); const wire = [];
  const record = (i, value, { browser = false, method = 'GET', suffix = '', dropped = false } = {}) => { const rawBody = JSON.stringify(value); const deliveredRawBody = dropped ? '' : rawBody; wire.push({ sequence: wire.length + 1, method, path: `/api/runs/${runIds[i]}${suffix}`, browser, authenticated: true, scoped: true, originalStatus: method === 'POST' ? 202 : 200, deliveredStatus: dropped ? 503 : method === 'POST' ? 202 : 200, rawBody, bodyBytes: Buffer.byteLength(rawBody), bodySha256: digest(rawBody), deliveredRawBody, deliveredBodyBytes: Buffer.byteLength(deliveredRawBody), deliveredBodySha256: digest(deliveredRawBody) }); };
  record(0, initial[0]); record(1, initial[1]); record(1, unclaimed, { method: 'POST', suffix: '/cancel', browser: true, dropped: true }); record(1, unclaimed, { browser: true }); record(1, unclaimed); record(0, unknown, { method: 'POST', suffix: '/cancel', browser: true }); record(0, unknown); record(0, receiptLineage, { suffix: '/attempts' }); record(0, receiptPending); record(0, terminal); record(0, terminal, { browser: true }); record(0, finalLineage[0], { suffix: '/attempts' }); record(1, finalLineage[1], { suffix: '/attempts' });
  const ui = (i, badge, cancelDisabled) => ({ runId: runIds[i], badge, badgeText: `${badge} uncertain`, cancelDisabled, progress: false, charts: 0, status: cancelDisabled ? ['Cancellation: requested'] : [] });
  const fingerprints = currentFingerprints();
  return { name: 'pending-cancel', status: 'passed', scope: 'genuine Local POSIX process boundary; no ML runtime, scheduler or site certification', cleanup: { errors: [], browserAbsent: true, servicesClosed: true, listenerClosed: true, evidenceFrozen: true, privateRootsRemoved: true, fixtureExit: { code: 0, signal: null } }, browser: { initialProfileEmpty: true, session: 'wavepending-1234abcd', userAgent: 'Chrome/123' }, runIds, initial, detached: structuredClone(initial), unclaimed, unknown, receiptPending, terminal, final: [structuredClone(terminal), structuredClone(unclaimed)], pendingUi: ui(1, 'pending', false), unclaimedUi: ui(1, 'cancelled', true), submittingUi: ui(0, 'submission unknown', false), unknownUi: ui(0, 'submission unknown', true), receiptUi: ui(0, 'observation unavailable', true), terminalUi: ui(0, 'cancelled', true), lineage: finalLineage, receiptLineage, backend: ['submit-entered', 'probe-entered', 'receipt', 'cancel-entered', 'cancel-completed', 'child-reaped'].map((kind, i) => ({ kind, run_id: runIds[0], ...(i >= 2 ? { pid: handle.pid } : {}), ...(i === 5 ? { pidAbsent: true, returncode: -15 } : {}) })), wire, fingerprints, fingerprintsAfter: structuredClone(fingerprints) };
}

test('accepts a complete generated positive contract fixture', () => { const report = positiveFixture(); assert.equal(verifyPendingCancelBrowserReport(report), report); });
const mutations = [
  ['UI badge', r => { r.pendingUi.badge = 'cancelled'; }], ['UI fabricated progress', r => { r.receiptUi.progress = true; }], ['UI missing uncertainty', r => { r.unknownUi.badgeText = 'submission unknown'; }], ['UI enabled repeat cancellation', r => { r.unknownUi.cancelDisabled = false; }], ['wire authentication', r => { r.wire[0].authenticated = false; }], ['wire scoping', r => { r.wire[0].scoped = false; }], ['wire source hash', r => { r.wire[0].bodySha256 = '0'.repeat(64); }], ['wire delivered hash', r => { r.wire[2].deliveredBodySha256 = '0'.repeat(64); }], ['wire byte count', r => { r.wire[0].bodyBytes++; }], ['wire sequence', r => { r.wire[1].sequence = 99; }], ['wire public response binding', r => { r.wire[0].path = `/api/runs/${r.runIds[1]}`; }], ['wire browser reconciliation', r => { r.wire[3].browser = false; }], ['backend ownership', r => { r.backend[0].run_id = r.runIds[1]; }], ['backend child not reaped', r => { r.backend.at(-1).pidAbsent = false; }], ['lineage unclaimed dispatched', r => { r.lineage[1].attempts[0].cancel_delivered = true; }], ['lineage duplicated attempt', r => { r.lineage[0].attempts.push({ ...r.lineage[0].attempts[0] }); }], ['detachment changed intent', r => { r.detached[1].cancellation_requested = true; }], ['cleanup error', r => { r.cleanup.errors.push('failure'); }], ['cleanup child exit failure', r => { r.cleanup.fixtureExit.code = 1; }],
];
for (const key of ['browserAbsent', 'servicesClosed', 'listenerClosed', 'evidenceFrozen', 'privateRootsRemoved']) mutations.push([`cleanup ${key}`, r => { r.cleanup[key] = false; }]);
for (const key of ['error', 'skip', 'skipped', 'skipReason', 'shutdownError', 'failure', 'failed', 'retainedWorkspace', 'explicitFixtureWebAssets']) mutations.push([`forbidden flag ${key}`, r => { r[key] = false; }]);
for (const [name, mutate] of mutations) test(`rejects isolated negative mutation: ${name}`, () => { const report = positiveFixture(); assert.doesNotThrow(() => verifyPendingCancelBrowserReport(report)); mutate(report); assert.throws(() => verifyPendingCancelBrowserReport(report)); });

test('file reader accepts stable evidence and rejects unsafe or invalid files', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'wavedl-pending-verifier-'));
  try {
    const report = positiveFixture(); const valid = join(root, 'valid.json'); await writeFile(valid, JSON.stringify(report)); assert.deepEqual(await verifyPendingCancelBrowserFile(valid), report);
    const invalid = join(root, 'invalid-utf8.json'); await writeFile(invalid, Buffer.from([0x7b, 0xff, 0x7d])); await assert.rejects(verifyPendingCancelBrowserFile(invalid), /utf-8/i);
    const empty = join(root, 'empty.json'); await writeFile(empty, ''); await assert.rejects(verifyPendingCancelBrowserFile(empty), /bounded nonempty regular file/);
    const oversized = join(root, 'oversized.json'); await writeFile(oversized, Buffer.alloc(2 * 1024 * 1024 + 1, 0x20)); await assert.rejects(verifyPendingCancelBrowserFile(oversized), /bounded nonempty regular file/);
    const directory = join(root, 'directory'); await mkdir(directory); await assert.rejects(verifyPendingCancelBrowserFile(directory), /bounded nonempty regular file/);
    const linked = join(root, 'linked.json'); await symlink(valid, linked); await assert.rejects(verifyPendingCancelBrowserFile(linked), /bounded nonempty regular file/);
    const linkedParent = join(root, 'linked-parent'); await symlink(root, linkedParent, 'dir'); await assert.rejects(verifyPendingCancelBrowserFile(join(linkedParent, 'valid.json')), /ordinary directory/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
