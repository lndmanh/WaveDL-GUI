import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { boundedFile } from './browser_files.mjs';
import { TextDecoder } from 'node:util';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const sha = /^[a-f0-9]{64}$/;
const digest = value => createHash('sha256').update(value).digest('hex');
const equal = (actual, expected, label) => label === undefined ? assert.deepEqual(actual, expected) : assert.deepEqual(actual, expected, label);
const harness = ['tools/browser_pending_cancel_fixture.py', 'tools/run_pending_cancel_browser_acceptance.mjs', 'tools/verify_pending_cancel_browser_report.mjs', 'tools/browser_daemon_fixture.py', 'tools/browser_actions.mjs'];
const repo = resolve(new URL('..', import.meta.url).pathname);
export function currentFingerprints() {
  const manifestPath = resolve(repo, 'src/wavedl_daemon/web_assets/.wavedl-assets.json');
  const raw = readFileSync(manifestPath);
  const manifest = JSON.parse(raw);
  const assets = Object.fromEntries(Object.entries(manifest).map(([path, expected]) => {
    const actual = digest(readFileSync(resolve(repo, 'src/wavedl_daemon/web_assets', path)));
    assert.equal(actual, expected, `Packaged asset changed: ${path}`);
    return [path, actual];
  }));
  const sources = Object.fromEntries(harness.map(path => [path, digest(readFileSync(resolve(repo, path)))]));
  return { assetManifestSha256: digest(raw), assets, sources };
}
export function verifyPendingCancelBrowserReport(report) {
  equal(report.name, 'pending-cancel'); equal(report.status, 'passed');
  equal(report.scope, 'genuine Local POSIX process boundary; no ML runtime, scheduler or site certification');
  for (const key of ['error', 'skip', 'skipped', 'skipReason', 'shutdownError', 'failure', 'failed', 'retainedWorkspace', 'explicitFixtureWebAssets']) assert(!Object.hasOwn(report, key));
  equal(report.cleanup.errors, []);
  for (const key of ['browserAbsent', 'servicesClosed', 'listenerClosed', 'evidenceFrozen', 'privateRootsRemoved']) equal(report.cleanup[key], true);
  assert((report.cleanup.fixtureExit.code === 0 && report.cleanup.fixtureExit.signal === null) || (report.cleanup.fixtureExit.code === null && report.cleanup.fixtureExit.signal === 'SIGINT'));
  equal(report.browser.initialProfileEmpty, true);
  assert.match(report.browser.session, /^wavepending-[a-f0-9]{8}$/);
  assert.match(report.browser.userAgent, /Chrome\/[0-9]+/);
  equal(report.runIds.length, 2); assert.notEqual(report.runIds[0], report.runIds[1]);
  for (const id of report.runIds) assert.match(id, uuid);
  const identities = report.initial.map(value => ({ run_id: value.run_id, plan_id: value.plan_id, request_id: value.request_id }));
  equal(identities.map(value => value.run_id), report.runIds);
  assert.notEqual(identities[0].plan_id, identities[1].plan_id);
  function view(value, index, state, uncertainty, cancellation) {
    for (const [key, expected] of Object.entries(identities[index])) { assert.match(expected, uuid); equal(value[key], expected); }
    equal(value.backend, 'local'); equal(value.operation, 'train'); equal(value.attempt, null);
    equal(value.state, state); equal(value.uncertainty, uncertainty);
    equal(value.submission_requested, true); equal(value.cancellation_requested, cancellation);
    equal(value.evidence.runtime.hello_seen, false);
  }
  view(report.initial[0], 0, 'submission_unknown', true, false);
  view(report.initial[1], 1, 'pending', false, false);
  equal(report.detached, report.initial, 'Closing browser must not change either durable intent');
  view(report.unclaimed, 1, 'cancelled', false, true);
  view(report.unknown, 0, 'submission_unknown', true, true);
  view(report.receiptPending, 0, 'observation_unavailable', true, true);
  view(report.terminal, 0, 'cancelled', false, true);
  equal(report.final, [report.terminal, report.unclaimed]);
  equal(report.terminal.evidence.backend.status, 'terminal');
  equal(report.terminal.evidence.backend.native_state, 'CANCELLED');
  equal(report.terminal.evidence.batch.status, 'cancelled');
  const uiPhases = [['pendingUi', 1, 'pending', false], ['unclaimedUi', 1, 'cancelled', true], ['submittingUi', 0, 'submission unknown', false], ['unknownUi', 0, 'submission unknown', true], ['receiptUi', 0, 'observation unavailable', true], ['terminalUi', 0, 'cancelled', true]];
  for (const [key, index, badge, disabled] of uiPhases) {
    const item = report[key]; equal(item.runId, report.runIds[index]); equal(item.badge, badge); equal(item.cancelDisabled, disabled);
    equal(item.progress, false); equal(item.charts, 0);
    if (disabled) assert(item.status.some(text => text.includes('Cancellation: requested')));
    if (['submittingUi', 'unknownUi', 'receiptUi'].includes(key)) assert(item.badgeText.includes('uncertain'));
  }
  equal(report.lineage.length, 2);
  function lineage(value, index) {
    equal(value.total, 1); equal(value.attempts.length, 1);
    const item = value.attempts[0]; equal(item.attempt, null); equal(item.cancellation_requested, true);
    equal(item.execution_state, index === 0 ? 'submitted' : 'pending'); equal(item.cancel_delivered, index === 0);
    return item;
  }
  const final = report.lineage.map(lineage); equal(final[1].submission_handle, null);
  const receipt = report.receiptLineage.attempts?.[0];
  equal(report.receiptLineage.total, 1); equal(report.receiptLineage.attempts.length, 1);
  equal(receipt.execution_state, 'submitted'); equal(receipt.cancel_delivered, false);
  equal(receipt.cancellation_requested, true); equal(receipt.attempt, null);
  equal(receipt.submission_handle, final[0].submission_handle);
  equal(receipt.submission_handle.run_id, report.runIds[0]);
  assert(Number.isSafeInteger(receipt.submission_handle.pid) && receipt.submission_handle.pid > 0);
  assert(receipt.submission_handle.supervisor_id);
  equal(final[0].submission_observation.status, 'terminal');
  equal(report.backend.map(item => item.kind), ['submit-entered', 'probe-entered', 'receipt', 'cancel-entered', 'cancel-completed', 'child-reaped'], 'Exactly one submission and cancellation dispatch');
  for (const item of report.backend) {
    equal(item.run_id, report.runIds[0], 'Unclaimed run must never enter Local submission');
    if (Object.hasOwn(item, 'pid')) equal(item.pid, receipt.submission_handle.pid);
  }
  equal(report.backend.at(-1).pidAbsent, true); assert(Number.isSafeInteger(report.backend.at(-1).returncode));
  assert(Array.isArray(report.wire) && report.wire.length > 0 && report.wire.length <= 4096);
  for (const [index, item] of report.wire.entries()) {
    equal(item.sequence, index + 1);
    for (const [rawKey, bytesKey, hashKey] of [['rawBody', 'bodyBytes', 'bodySha256'], ['deliveredRawBody', 'deliveredBodyBytes', 'deliveredBodySha256']]) {
      assert(typeof item[rawKey] === 'string' && Buffer.byteLength(item[rawKey]) <= 65536);
      equal(item[bytesKey], Buffer.byteLength(item[rawKey])); equal(item[hashKey], digest(item[rawKey]));
    }
    equal(item.authenticated, true); equal(item.scoped, true); equal(typeof item.browser, 'boolean');
  }
  const cancel = report.wire.filter(item => item.method === 'POST');
  equal(cancel.length, 2, 'Repeated clicks must not duplicate requests or create executions');
  equal(cancel.map(item => item.path), [1, 0].map(index => `/api/runs/${report.runIds[index]}/cancel`));
  for (const item of cancel) { equal(item.browser, true); equal(item.originalStatus, 202); }
  equal(cancel[0].deliveredStatus, 503); equal(cancel[0].deliveredRawBody, '');
  equal(cancel[1].deliveredStatus, 202); equal(cancel[1].deliveredRawBody, cancel[1].rawBody);
  equal(JSON.parse(cancel[0].rawBody), report.unclaimed);
  equal(JSON.parse(cancel[1].rawBody), report.unknown);
  for (const item of report.wire.filter(item => !cancel.includes(item))) {
    equal(item.method, 'GET'); equal(item.originalStatus, 200); equal(item.deliveredStatus, 200); equal(item.deliveredRawBody, item.rawBody);
    assert(report.runIds.some(id => [`/api/runs/${id}`, `/api/runs/${id}/attempts`].includes(item.path)));
  }
  function recorded(value, index, { browser = false, suffix = '', after = 0, before = Infinity } = {}) {
    const result = report.wire.find(item => item.method === 'GET' && item.path === `/api/runs/${report.runIds[index]}${suffix}` && item.browser === browser && item.sequence > after && item.sequence < before && JSON.stringify(JSON.parse(item.rawBody)) === JSON.stringify(value));
    assert(result, 'Phase must bind genuine public response bytes and ordering'); return result.sequence;
  }
  for (let index = 0; index < 2; index++) recorded(report.initial[index], index, { before: cancel[0].sequence });
  const unclaimed = recorded(report.unclaimed, 1, { after: cancel[0].sequence, before: cancel[1].sequence });
  recorded(report.unclaimed, 1, { browser: true, after: cancel[0].sequence, before: unclaimed });
  const unknown = recorded(report.unknown, 0, { after: cancel[1].sequence });
  const accepted = recorded(report.receiptLineage, 0, { suffix: '/attempts', after: unknown });
  const pending = recorded(report.receiptPending, 0, { after: accepted });
  const terminal = recorded(report.terminal, 0, { after: pending });
  recorded(report.terminal, 0, { browser: true, after: pending });
  for (let index = 0; index < 2; index++) recorded(report.lineage[index], index, { suffix: '/attempts', after: terminal });
  equal(report.fingerprintsAfter, report.fingerprints); assert.match(report.fingerprints.assetManifestSha256, sha);
  equal(Object.keys(report.fingerprints.sources).sort(), [...harness].sort()); assert(Object.keys(report.fingerprints.assets).length >= 20);
  for (const map of [report.fingerprints.sources, report.fingerprints.assets]) for (const hash of Object.values(map)) assert.match(hash, sha);
  equal(report.fingerprints, currentFingerprints(), 'Report must bind to current owned source and packaged asset digests');
  return report;
}

export async function verifyPendingCancelBrowserFile(path) {
  const report = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await boundedFile(path, 2 * 1024 * 1024)));
  verifyPendingCancelBrowserReport(report); return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert(process.argv[2], 'Provide report path'); await verifyPendingCancelBrowserFile(process.argv[2]);
  console.log('Pending cancellation report verified');
}
