import assert from 'node:assert/strict';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A native submission and its eventual runtime binding are distinct evidence. */
export function lostAckBindingReady(snapshot, identity) {
  assert(snapshot && snapshot.plans === 1, 'Lost ACK must retain exactly the original plan');
  assert(Array.isArray(snapshot.control) && snapshot.control.length === 1,
    'Lost ACK must retain exactly one durable intent');
  const control = snapshot.control[0];
  assert(control.plan_id === identity.planId && control.submission_requested === 1
    && control.cancellation_requested === 0, 'Lost ACK intent must belong to the approved plan');
  assert(Array.isArray(snapshot.submissions) && snapshot.submissions.length === 1,
    'Lost ACK must retain exactly one writer submission');
  const source = snapshot.submissions[0];
  assert(source.plan_id === identity.planId && source.run_id === identity.runId
    && source.request_id === identity.requestId, 'Foreign writer submission identity');
  assert(['pending', 'submitting', 'unknown', 'submitted'].includes(source.state),
    'Writer submission failed before runtime binding');
  assert(Array.isArray(snapshot.executions) && snapshot.executions.length <= 1,
    'Lost ACK must not duplicate bound executions');
  assert(snapshot.executions.every(row => row.plan_id === identity.planId),
    'Foreign bound execution after lost ACK');
  assert(Array.isArray(snapshot.runs) && snapshot.runs.length <= 1
    && snapshot.runs.every(row => row.run_id === identity.runId),
    'Foreign or duplicate runtime projection after lost ACK');
  if (source.receipt_run_id !== null || source.receipt_request_id !== null
    || source.supervisor_id !== null || source.pid !== null) {
    assert(source.receipt_run_id === identity.runId
      && source.receipt_request_id === identity.requestId
      && typeof source.supervisor_id === 'string' && /^[A-Za-z0-9_-]{43}$/.test(source.supervisor_id)
      && Number.isSafeInteger(source.pid) && source.pid > 0,
    'Native receipt must identify the original local writer request');
  }
  if (snapshot.executions.length === 0) return false;
  const execution = snapshot.executions[0];
  assert(Number.isSafeInteger(execution.attempt) && execution.attempt > 0,
    'A bound execution needs a positive verified runtime attempt');
  assert(source.state === 'submitted' && source.receipt_run_id === identity.runId
    && execution.run_id === identity.runId && execution.request_id === identity.requestId
    && execution.supervisor_id === source.supervisor_id && execution.pid === source.pid,
  'Runtime binding must retain the original native receipt identity');
  return true;
}

export function verifyLostAckEvidence(record) {
  const proof = record?.lostAckRecovery;
  assert(proof && proof.scope === 'Observed durable writer submission and verified initial runtime binding; not training completion or lifetime exactly-once proof',
    'Lost ACK recovery history is required');
  const identity = proof.identity;
  assert(identity && ['planId', 'runId', 'requestId'].every(key => uuid.test(identity[key])),
    'Lost ACK approved identity is required');
  assert(JSON.parse(record.approvedPlan).run_id === identity.runId,
    'Lost ACK history must follow the approved manifest');
  const before = proof.before;
  assert(before?.plans === 1 && before.control?.length === 1
    && before.control[0].plan_id === identity.planId
    && before.control[0].submission_requested === 0
    && before.control[0].cancellation_requested === 0
    && before.submissions?.length === 0 && before.executions?.length === 0
    && before.runs?.length === 0, 'Lost ACK history must begin with an unsubmitted original plan');
  lostAckBindingReady(proof.accepted, identity);
  lostAckBindingReady(proof.recovered, identity);
  assert(lostAckBindingReady(proof.bound, identity), 'Lost ACK eventual runtime binding is missing');
  assert(lostAckBindingReady(proof.acknowledged, identity), 'Lost ACK acknowledged runtime binding is missing');
  const receipt = row => Object.fromEntries(['receipt_run_id', 'receipt_request_id', 'pid', 'supervisor_id']
    .map(key => [key, row[key]]));
  const expected = receipt(proof.bound.submissions[0]);
  for (const stage of ['accepted', 'recovered', 'acknowledged']) {
    const source = proof[stage].submissions[0];
    if (source.receipt_run_id !== null) assert.deepEqual(receipt(source), expected,
      'Lost ACK recovery must not rotate the native request handle');
  }
  assert(proof.bound.executions[0].attempt === proof.acknowledged.executions[0].attempt,
    'Lost ACK acknowledgment must not allocate another runtime attempt');
  assert(proof.acknowledgedUi?.disabled === true && proof.acknowledgedUi.runId === identity.runId,
    'Recovered acknowledgment must disable duplicate approval of the original run');
}
