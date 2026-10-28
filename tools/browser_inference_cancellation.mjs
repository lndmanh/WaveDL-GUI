import { openPlanDisclosure } from './browser_actions.mjs';
// Real-browser acceptance helper for cancelling a submitted inference run.
// The caller owns the daemon/browser lifecycle and supplies the existing
// acceptance helpers; this function never fakes an HTTP response or registry.
import assert from "node:assert/strict";

export async function inferenceCancellation({
  cli,
  actions,
  button,
  pollRegistry,
  registry,
  dom,
  python,
  command,
  root,
  record,
  approvedManifest,
  scope = '//section[@aria-labelledby="inference-title"]',
}) {
  assert(approvedManifest?.run_id, "A real source training run is required");
  const planElement = `document.getElementById('inference-title').closest('section').querySelector('[aria-label="Approved normalized manifest"]')`;
  const observe = expression => dom(`JSON.stringify(${expression})`);
  record.inferenceCancellation = { sourceRunId: approvedManifest.run_id };
  record.inferenceCancellationStage = "settle-source";
  await pollRegistry(root, state => state.plans === 2 && state.runs.length === 2
    && state.runs.every(run => run.state === 'completed'), 'Source and automatic plot completed', 90000);
  await button('Dismiss', true);
  await actions.button('Experiments', false, { locator: '[data-testid="nav-experiments"]' });
  await button('Close', true);
  await actions.button('Refresh', false, { scope: '//section[@aria-label="Runs"]' });
  await cli('click', `xpath=//button[contains(@class,"run-row")][.//small[normalize-space(.)=${JSON.stringify(approvedManifest.run_id)}]]`);
  await actions.button('Results', false, { locator: '[data-testid="nav-results"]' });
  await button('Refresh artifacts');
  record.inferenceCancellationStage = "select-source";
  // Ordinary input amplification, not a mock or paused runtime: evaluation
  // executes the checkpoint model on 100,000 genuine rows at batch size one.
  // The bounded ~13 MiB file gives the public browser controls time to act.
  await command(python, ['-c', `import sys,numpy as np
from pathlib import Path
r=Path(sys.argv[1]); d=np.load(r/'samples.npz'); n=100000
np.savez(r/'cancellation.npz',X=np.resize(d['X'],(n,32)),y=np.resize(d['y'],(n,1)))`, root]);

  // Select the published checkpoint through the public form. The helper is
  // intentionally bounded: only a small CPU inference run is submitted.
  await cli('wait', '--fn', '!!document.getElementById("source-generation")');
  const options = (await actions.options('Source checkpoint generation')).filter(option => option.value && !option.disabled);
  const best = options.find(option => option.label.endsWith("best"));
  assert(best, "A verified best checkpoint classification is required");
  const selectedGeneration = best.value;
  await actions.select('Source checkpoint generation', selectedGeneration);
  const configuredRoot = await actions.readyControl('field', 'Search roots and paths', false,
    { locator: `xpath=${scope}//*[@role="combobox" and @aria-label="Search roots and paths"]` });
  await cli('click', configuredRoot);
  await actions.option('datasets');
  record.inferenceCancellationStage = "select-dataset";
  await actions.button('Select file cancellation.npz', false, { scope });
  await actions.fill('Python interpreter', record.pythonInterpreter, { scope });
  await actions.fill('Inference batch size', '1', { scope });
  await actions.fill('Data loader workers', '0', { scope });
  record.inferenceCancellationStage = "preview-inference";
  await actions.button('Preview evaluation / plot plan', false, { scope });
  await openPlanDisclosure({ cli, dom });
  await cli('wait', '--fn', `${planElement} !== null`);
  const plan = JSON.parse(await observe(`${planElement}.textContent`));
  assert.equal(plan.operation, 'test');
  assert.equal(plan.checkpoint_source.run_id, approvedManifest.run_id);
  assert.equal(plan.checkpoint_source.generation, selectedGeneration);
  const sourceBytes = JSON.parse(await command(python, ['-c', `import hashlib,json,sys
from pathlib import Path
p=Path(sys.argv[1])/'runs'/sys.argv[2]; complete=p/'checkpoints'/sys.argv[3]/'COMPLETE.json'; publication=json.loads(complete.read_bytes())
files={name:{'size':len((complete.parent/name).read_bytes()),'sha256':hashlib.sha256((complete.parent/name).read_bytes()).hexdigest()} for name in publication['files']}
assert files==publication['files']
print(json.dumps({'manifestSha256':hashlib.sha256((p/'manifest.json').read_bytes()).hexdigest(),'completeSha256':hashlib.sha256(complete.read_bytes()).hexdigest(),'files':files}))`, root, approvedManifest.run_id, selectedGeneration]));
  assert.equal(plan.checkpoint_source.manifest_sha256, sourceBytes.manifestSha256);
  assert.equal(plan.checkpoint_source.complete_sha256, sourceBytes.completeSha256);
  record.inferenceCancellation.source = sourceBytes;

  record.inferenceCancellationStage = "submit-inference";
  await actions.button('Approve and start this plan', false, { scope });
  const identity = JSON.parse(await command(python, ['-c', `import sqlite3,json,sys
from pathlib import Path
c=sqlite3.connect((Path(sys.argv[1])/'state/registry.db').resolve().as_uri()+'?mode=ro',uri=True)
r=c.execute("SELECT plan_id,request_id FROM plans WHERE json_extract(json_extract(plan_json,'$.manifest_json'),'$.run_id')=?",(sys.argv[2],)).fetchone()
print(json.dumps({'planId':r[0],'requestId':r[1]}))`, root, plan.run_id]));
  await pollRegistry(root, state => state.runs.some(run => run.run_id === plan.run_id)
    && state.executions.some(execution => execution.plan_id === identity.planId && execution.observed_status === 'running'),
  'Inference run entered genuine running state', 90000);
  record.inferenceCancellation.runningObserved = true;
  record.inferenceCancellation.running = await registry(root);
  record.inferenceCancellation.startedRuntime = JSON.parse(await command(python, ['-c', `import json,sqlite3,sys,time
from pathlib import Path
r=Path(sys.argv[1]); p=r/'runs'/sys.argv[3]/'attempts/1/events.jsonl'; deadline=time.monotonic()+25
while time.monotonic()<deadline:
 events=[json.loads(line) for line in p.read_text().splitlines()] if p.is_file() else []
 hello=next((e for e in events if e['type']=='hello'),None)
 if hello:
  c=sqlite3.connect((r/'state/registry.db').resolve().as_uri()+'?mode=ro',uri=True)
  handle=json.loads(c.execute('SELECT handle_json FROM execution_control WHERE plan_id=?',(sys.argv[2],)).fetchone()[0])
  print(json.dumps({'hello':hello,'pid':handle['pid']})); break
 time.sleep(.1)
else: raise RuntimeError('Inference producer hello absent')`, root, identity.planId, plan.run_id]));

  const beforeCancel = await registry(root);
  const inferencePlansBefore = beforeCancel.plans;
  record.inferenceCancellationStage = "request-cancellation";
  await button('Request cancellation');
  await cli('wait', '--fn', `Array.from(document.querySelectorAll('[aria-label="Selected run"] [data-run-state="cancelled"]')).some(e => e.getClientRects().length)`);
  await pollRegistry(root, state => state.runs.some(run => run.run_id === plan.run_id && run.state === 'cancelled')
    && state.control.some(control => control.plan_id === identity.planId && control.cancellation_requested === 1)
    && state.executions.some(execution => execution.plan_id === identity.planId && execution.cancel_delivered === 1 && execution.observed_status === 'terminal'),
  'Inference cancellation durably acknowledged', 90000);
  const afterCancel = await registry(root);
  assert.equal(afterCancel.plans, inferencePlansBefore, 'Cancellation must not create a duplicate plan');
  assert.equal(afterCancel.runs.filter(run => run.run_id === plan.run_id).length, 1, 'Cancellation must not duplicate the run');
  assert.equal(afterCancel.runs.find(run => run.run_id === plan.run_id)?.state, 'cancelled');
  record.inferenceCancellation.after = afterCancel;
  record.inferenceCancellation.planId = identity.planId;
  record.inferenceCancellation.requestId = identity.requestId;
  record.inferenceCancellation.before = beforeCancel;
  record.inferenceCancellation.approved = plan;
  record.inferenceCancellation.cancelledUi = await observe(`document.querySelector('[aria-label="Selected run"] [data-run-state]')?.textContent.trim() === 'Cancelled'`);
  record.inferenceCancellation.runtime = JSON.parse(await command(python, ['-c', `import os,json,sqlite3,sys
from pathlib import Path
r=Path(sys.argv[1]); c=sqlite3.connect((r/'state/registry.db').resolve().as_uri()+'?mode=ro',uri=True)
h=json.loads(c.execute('SELECT handle_json FROM execution_control WHERE plan_id=?',(sys.argv[2],)).fetchone()[0]); pid=h['pid']
try: os.kill(pid,0); absent=False
except ProcessLookupError: absent=True
p=r/'runs'/sys.argv[3]; events=[json.loads(line) for line in (p/'attempts/1/events.jsonl').read_text().splitlines()]
print(json.dumps({'pid':pid,'pidAbsent':absent,'events':events,'attempts':sorted(x.name for x in (p/'attempts').iterdir()),'publications':list(str(x.relative_to(p)) for x in p.glob('checkpoints/*/COMPLETE.json'))}))`, root, identity.planId, plan.run_id]));
  assert.equal(record.inferenceCancellation.runtime.pidAbsent, true, 'Owned inference process must already be reaped before fixture shutdown');
  assert.equal(record.inferenceCancellation.runtime.pid, record.inferenceCancellation.startedRuntime.pid);
  record.inferenceCancellation.sourceAfter = JSON.parse(await command(python, ['-c', `import hashlib,json,sys
from pathlib import Path
p=Path(sys.argv[1])/'runs'/sys.argv[2]; complete=p/'checkpoints'/sys.argv[3]/'COMPLETE.json'; publication=json.loads(complete.read_bytes())
files={name:{'size':len((complete.parent/name).read_bytes()),'sha256':hashlib.sha256((complete.parent/name).read_bytes()).hexdigest()} for name in publication['files']}
assert files==publication['files']
print(json.dumps({'manifestSha256':hashlib.sha256((p/'manifest.json').read_bytes()).hexdigest(),'completeSha256':hashlib.sha256(complete.read_bytes()).hexdigest(),'files':files}))`, root, approvedManifest.run_id, selectedGeneration]));
  assert.deepEqual(record.inferenceCancellation.sourceAfter, sourceBytes);
  record.inferenceCancellation.cancelledRunId = plan.run_id;
  record.inferenceCancellation.generation = selectedGeneration;
  record.inferenceCancellation.noDuplicatePlan = true;
  record.inferenceCancellation.noDuplicateRun = true;
  return record.inferenceCancellation;
}
