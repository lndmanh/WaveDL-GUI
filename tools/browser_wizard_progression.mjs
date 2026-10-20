import assert from 'node:assert/strict';

// Assertions are intentionally sourced from the public DOM and read-only
// registry snapshots supplied by the shared runner.
export function verifyWizardProgression(record) {
  assert.equal(record.name, 'wizard-progression');
  assert.equal(record.status, 'passed');
  for (const field of ['error','shutdownError','trainingEditorFailure','retainedPrivateRoots','explicitFixtureWebAssets','skipped','skip']) assert.equal(record[field], undefined);
  assert.deepEqual(record.freshStorage, { local: [], session: [], cookies: '' });
  assert.equal(record.driverReadinessMode, 'sync-exposure-poll-and-two-controller-dom-observations');
  assert.equal(record.wizardInvalidDataset?.message, true);
  assert.equal(record.wizardInvalidDataset?.step?.startsWith('1.'), true);
  assert.equal(record.wizardInvalidModel?.message, true);
  assert.equal(record.wizardInvalidModel?.step?.startsWith('2.'), true);
  assert.equal(record.wizardReview?.step?.startsWith('5.'), true);
  assert.equal(typeof record.wizardReview?.epochs, 'string');
  assert.equal(record.wizardReview.epochs, '3');
  for (const state of [record.wizardAfterInvalidDataset, record.wizardAfterInvalidModel, record.wizardBeforeNavigation, record.wizardAfterInvalidTraining, record.wizardAfterNavigation]) {
    assert.deepEqual(state, { runs: [], plans: 0, control: [], submissions: [], executions: [] });
  }
  assert.equal(record.wizardInvalidTraining?.message, true);
  assert.equal(record.wizardInvalidTraining?.step?.startsWith('4.'), true);
  const id = value => assert(typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value));
  id(record.wizardPlanId); id(record.wizardManifest.run_id);
  assert.deepEqual(record.wizardSourceManifest, record.wizardManifest);
  assert.equal(record.wizardManifest.resolved_config.epochs, 3);
  assert.equal(record.wizardManifest.resolved_config.model, 'cnn');
  assert.equal(record.wizardManifest.resolved_config.workers, 0);
  assert.equal(record.wizardManifest.resolved_config.precision, 'no');
  assert.equal(record.wizardManifest.resolved_config.batch_size, 16);
  assert.equal(record.wizardManifest.runtime.device, 'cpu');
  assert.equal(record.wizardManifest.runtime.python, record.pythonInterpreter);
  assert(record.wizardManifest.resolved_config.data_path.endsWith('/samples.npz'));
  const preview = record.wizardPreviewRegistry;
  assert.equal(preview.plans, 1); assert.equal(preview.executions.length, 0);
  assert.deepEqual(preview.submissions, []);
  assert.deepEqual(preview.control, [{ plan_id: record.wizardPlanId, submission_requested: 0, cancellation_requested: 0 }]);
  const submitted = record.wizardSubmitted;
  assert.equal(submitted.plans, 1); assert.equal(submitted.executions.length, 1);
  assert.deepEqual(submitted.control, [{ plan_id: record.wizardPlanId, submission_requested: 1, cancellation_requested: 0 }]);
  assert.equal(record.wizardAcknowledged.disabled, true);
  assert.equal(record.wizardAcknowledged.runId, record.wizardManifest.run_id);
  const settled = record.wizardSettled;
  assert.equal(record.wizardDurablePlans.length, 2);
  const training = record.wizardDurablePlans.find(item=>item.planId===record.wizardPlanId);
  assert.deepEqual(training.manifest, record.wizardManifest);
  const plot = record.wizardDurablePlans.find(item=>item.planId!==record.wizardPlanId);
  id(plot.planId); id(plot.manifest.run_id);
  assert.equal(plot.manifest.operation, 'plot');
  assert.equal(plot.manifest.checkpoint_source.run_id, record.wizardManifest.run_id);
  assert.deepEqual(settled.runs.map(run=>run.run_id).sort(), record.wizardDurablePlans.map(item=>item.manifest.run_id).sort());
  assert.deepEqual(settled.control.map(row=>row.plan_id).sort(), record.wizardDurablePlans.map(item=>item.planId).sort());
  assert.deepEqual(settled.executions.map(row=>row.plan_id).sort(), record.wizardDurablePlans.map(item=>item.planId).sort());
  assert(settled.control.every(row=>row.submission_requested===1 && row.cancellation_requested===0));
  assert.equal(settled.plans, 2); assert.equal(settled.executions.length, 2); assert.equal(settled.runs.length, 2);
  assert(settled.runs.every(run=>run.state==='completed'));
  assert(settled.executions.every(execution=>execution.observed_status==='terminal' && execution.cancel_delivered===0));
  assert.equal(settled.runs.filter(run=>run.run_id===record.wizardManifest.run_id).length, 1);
  assert.deepEqual(record.finalRegistry, settled);
  assert.deepEqual(record.cleanup.errors, []);
  for (const field of ['browserSessionAbsent','fixtureServicesClosed','listenerClosed','browserProfileRemoved','removedOwnedRoots']) assert.equal(record.cleanup[field], true);
  assert((record.cleanup.fixtureExit.code===0 && record.cleanup.fixtureExit.signal===null) || (record.cleanup.fixtureExit.code===null && record.cleanup.fixtureExit.signal==='SIGINT'));
  return record;
}
