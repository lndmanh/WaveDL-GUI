import assert from 'node:assert/strict';
import { CONTROL_VALUE_SOURCE } from './browser_actions.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export async function submittedPlanProtection({ cli, dom, button, actions, fill, registry, root, record, python, command, repo, approvedManifest, check }) {
  const options = await readFile(join(repo, 'web/shared/training-options.json'));
  const defaults = Object.fromEntries(JSON.parse(options).map(o => [o.name, o.default]));
  const hash = value => createHash('sha256').update(value).digest('hex');
  record.trainingOptionsSha256 = hash(options);
  record.defaults = { epochs: String(defaults.epochs), batchSize: String(defaults.batch_size) };
  const capture = async () => {
    const raw = JSON.parse(await command(python, ['-c', `import json,sqlite3,sys
from pathlib import Path
c=sqlite3.connect((Path(sys.argv[1])/"state"/"registry.db").resolve().as_uri()+"?mode=ro",uri=True); c.row_factory=sqlite3.Row
print(json.dumps({table:[dict(row) for row in c.execute("SELECT * FROM "+table+" ORDER BY plan_id")] for table in ("plans","plan_control","execution_control")}))`, root]));
    record.protectionStorageSnapshots ??= [];
    record.protectionStorageSnapshots.push(raw);
    const state = await registry(root);
    const plans = raw.plans.map(plan => ({ plan, manifest: JSON.parse(JSON.parse(plan.plan_json).manifest_json) }));
    const target = plans.find(item => item.manifest.run_id === record.runId);
    assert(target, `Accepted training manifest ${record.runId} must remain present`);
    const plan = target.plan, manifest = target.manifest;
    const control = raw.plan_control.find(row => row.plan_id === plan.plan_id);
    const execution = raw.execution_control.find(row => row.plan_id === plan.plan_id);
    assert(control && execution, 'Accepted training plan must retain control and execution rows');
    const snapshot = { plans: state.plans, executions: state.executions.length, planId: plan.plan_id,
      runId: manifest.run_id, state: state.runs.find(r => r.run_id === manifest.run_id)?.state,
      submissionRequested: control.submission_requested,
      cancellationRequested: control.cancellation_requested,
      cancelDelivered: execution.cancel_delivered,
      planSha256: hash(JSON.stringify(raw.plans)), manifestSha256: hash(JSON.stringify(manifest)),
      controlSha256: hash(JSON.stringify(raw.plan_control)), executionSha256: hash(JSON.stringify(raw.execution_control)) };
    let settled = false;
    let previous = snapshot.executionSha256;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 250));
      const confirmation = await command(python, ['-c', `import json,sqlite3,sys
from pathlib import Path
c=sqlite3.connect((Path(sys.argv[1])/"state"/"registry.db").resolve().as_uri()+"?mode=ro",uri=True); c.row_factory=sqlite3.Row
print(json.dumps([dict(row) for row in c.execute("SELECT * FROM execution_control ORDER BY plan_id")]))`, root]);
      const observed = hash(JSON.stringify(JSON.parse(confirmation)));
      if (observed === previous) { settled = true; break; }
      record.executionSettlingDifferences ??= [];
      const next = JSON.parse(confirmation);
      record.executionSettlingDifferences.push({ before: raw.execution_control, after: next,
        changedFields: next.map((row, index) => ({ planId: row.plan_id, fields: Object.keys(row).filter(key => row[key] !== raw.execution_control[index]?.[key]) })) });
      raw.execution_control = next;
      previous = observed;
    }
    assert(settled, 'Execution rows did not settle within bounded backend observation window');
    snapshot.executionSha256 = previous;
    return snapshot;
  };
  const ui = async () => {
    await actions.showTrainingField('Epochs');
    return dom(`JSON.stringify((()=>{
    // Every builder block stays mounted, so draft fields are read wherever they are.
    const field=name=>{const label=Array.from(document.querySelectorAll('section[aria-labelledby="project-title"] label')).find(e=>e.textContent.trim()===name);const control=label&&document.getElementById(label.htmlFor);return control?${CONTROL_VALUE_SOURCE}(control):null};
    const dataset=document.querySelector('[data-testid="selected-dataset"]');
    const datasetLocation=(dataset?.nextElementSibling?.textContent??'').trim()||null;
    const model=Array.from(document.querySelectorAll('[data-testid="model-card"]')).find(row=>Array.from(row.querySelectorAll('[aria-label]')).some(e=>e.getAttribute('aria-label')==='In use'))?.getAttribute('data-model-entry')??null;
    const device=document.querySelector('[data-testid^="device-"][aria-checked="true"]')?.getAttribute('data-testid')?.slice(7)??null;
    const ack=document.querySelector('[aria-label="Acknowledged training run"]');
    return {epochs:field('Epochs'),batchSize:field('Batch size'),python:field('Python interpreter'),device,
      datasetFile:dataset?.textContent.trim()||null,datasetLocation,model,
      approvalVisible:!!document.querySelector('[aria-label="Approved normalized manifest"]'),
      approveEnabled:Array.from(document.querySelectorAll('button')).some(e=>e.getClientRects().length&&!e.disabled&&e.textContent.trim()==='Approve and start this plan'),
      acknowledgedRun:ack?.textContent.includes(${JSON.stringify(approvedManifest.run_id)})?${JSON.stringify(approvedManifest.run_id)}:null,
      openAcknowledgedEnabled:Array.from(document.querySelectorAll('button')).some(e=>!e.disabled&&e.textContent.trim()==='Open acknowledged run'),
      resetConfirmationVisible:!!document.querySelector('[aria-label="Confirm reset"]')};})())`);
  };
  record.runId = approvedManifest.run_id;
  record.accepted = await capture(); record.planId = record.accepted.planId;
  record.accepted.manifest = { config: { epochs: approvedManifest.resolved_config.epochs, model: approvedManifest.resolved_config.model, data_path: approvedManifest.resolved_config.data_path }, device: approvedManifest.runtime.device, python: approvedManifest.runtime.python };
  record.authored = { epochs: '3', model: 'cnn', workers: '0', precision: 'no', device: 'cpu', dataPath: approvedManifest.resolved_config.data_path, python: approvedManifest.runtime.python };
  await actions.openProject('continue');
  await fill('Epochs', '4');
  record.editedUi = await ui(); record.afterEdit = await capture();
  await button('Reset training defaults');
  check(await dom(`JSON.stringify(!!document.querySelector('[aria-label="Confirm reset"]'))`), 'Submitted draft reset requires explicit confirmation');
  await button('Confirm reset');
  record.resetUi = await ui(); record.afterReset = await capture();
  await button('Open acknowledged run'); await cli('wait', '--text', 'Run detail');
  record.navigation = await dom(`JSON.stringify({runId:document.querySelector('[aria-label="Selected run"]')?.textContent.includes(${JSON.stringify(record.runId)})?${JSON.stringify(record.runId)}:null,runDetailVisible:Array.from(document.querySelectorAll('h2,h1')).some(e=>e.getClientRects().length&&e.textContent.trim()==='Run detail')})`);
  record.afterNavigation = await capture();
  for (const item of [record.afterEdit, record.afterReset, record.afterNavigation]) {
    for (const key of Object.keys(item)) assert.deepEqual(item[key], record.accepted[key], `Submitted persisted ${key} changed during authoring`);
  }
  check(true, 'Completed accepted plan, control and execution rows remained byte-identical after edit, confirmed reset and acknowledged-run navigation');
  record.limitation = 'One real local CPU completed run; no GPU, Windows, Slurm or release acceptance.';
}
