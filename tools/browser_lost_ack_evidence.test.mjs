import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { lostAckBindingReady, verifyLostAckEvidence } from './browser_lost_ack_evidence.mjs';

const identity = {
  planId: '11111111-1111-4111-8111-111111111111',
  runId: '22222222-2222-4222-8222-222222222222',
  requestId: '33333333-3333-4333-8333-333333333333',
};
function snapshot(bound = false) {
  const source = { plan_id: identity.planId, run_id: identity.runId,
    request_id: identity.requestId, state: 'submitted', receipt_run_id: identity.runId,
    receipt_request_id: identity.requestId, supervisor_id: 'a'.repeat(43), pid: 1234 };
  return { plans: 1, control: [{ plan_id: identity.planId, submission_requested: 1,
    cancellation_requested: 0 }], runs: [], submissions: [source],
  executions: bound ? [{ plan_id: identity.planId, run_id: identity.runId,
    request_id: identity.requestId, supervisor_id: source.supervisor_id, pid: source.pid,
    attempt: 1 }] : [] };
}
function record() {
  const before = snapshot();
  before.control[0].submission_requested = 0;
  before.submissions = [];
  return { approvedPlan: JSON.stringify({ run_id: identity.runId }), lostAckRecovery: {
    scope: 'Observed durable writer submission and verified initial runtime binding; not training completion or lifetime exactly-once proof',
    identity, before, accepted: snapshot(), recovered: snapshot(), bound: snapshot(true),
    acknowledged: snapshot(true), acknowledgedUi: { disabled: true, runId: identity.runId },
  } };
}

test('writer acceptance is not runtime binding; delayed binding retains one original receipt', () => {
  assert.equal(lostAckBindingReady(snapshot(), identity), false);
  assert.equal(lostAckBindingReady(snapshot(true), identity), true);
  verifyLostAckEvidence(record());
});
test('acceptance before native receipt stays unbound and never fabricates readiness', () => {
  const value = record();
  const source = value.lostAckRecovery.accepted.submissions[0];
  source.state = 'submitting';
  for (const field of ['receipt_run_id', 'receipt_request_id', 'supervisor_id', 'pid']) source[field] = null;
  assert.equal(lostAckBindingReady(value.lostAckRecovery.accepted, identity), false);
  verifyLostAckEvidence(value);
});
for (const [name, mutate] of [
  ['missing history', r => delete r.lostAckRecovery],
  ['missing writer source', r => { r.lostAckRecovery.recovered.submissions = []; }],
  ['foreign recovery identity', r => { r.lostAckRecovery.recovered.submissions[0].request_id = identity.runId; }],
  ['duplicate writer source', r => { r.lostAckRecovery.recovered.submissions.push(r.lostAckRecovery.recovered.submissions[0]); }],
  ['duplicate bound execution', r => { r.lostAckRecovery.bound.executions.push(r.lostAckRecovery.bound.executions[0]); }],
  ['missing eventual binding', r => { r.lostAckRecovery.bound.executions = []; }],
  ['foreign bound runtime', r => { r.lostAckRecovery.bound.executions[0].run_id = identity.planId; }],
  ['rotated native supervisor', r => { r.lostAckRecovery.accepted.submissions[0].supervisor_id = 'b'.repeat(43); }],
  ['rotated runtime attempt', r => { r.lostAckRecovery.acknowledged.executions[0].attempt = 2; }],
  ['replacement plan', r => { r.lostAckRecovery.recovered.plans = 2; }],
  ['foreign runtime projection', r => { r.lostAckRecovery.recovered.runs = [{ run_id: identity.planId }]; }],
  ['enabled duplicate approval', r => { r.lostAckRecovery.acknowledgedUi.disabled = false; }],
]) test(`rejects ${name}`, () => {
  const value = record();
  mutate(value);
  assert.throws(() => verifyLostAckEvidence(value));
});

test('aggregate guard requires recovery history, runner records both durable phases', async () => {
  const verifier = await readFile(new URL('./verify_browser_ci_report.mjs', import.meta.url), 'utf8');
  assert(verifier.includes("if (record.name === 'lost-ack') verifyLostAckEvidence(record)"));
  const runner = await readFile(new URL('./run_web_acceptance.mjs', import.meta.url), 'utf8');
  assert(runner.includes('FROM submission_control s JOIN plans p'));
  assert(runner.includes('c.execute("BEGIN")'));
  assert(runner.includes('record.lostAckRecovery.recovered = retried'));
  assert(runner.includes('record.lostAckRecovery.bound = await pollRegistry'));
});
