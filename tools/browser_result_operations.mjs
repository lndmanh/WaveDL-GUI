// Focused explicit CPU evaluation through public DOM and the existing owned runner.
import assert from 'node:assert/strict';

export async function resultOperations({ cli, dom, button, actions, registry, pollRegistry,
  root, record, python, command, approvedManifest, check }) {
  const scope = '//section[@aria-labelledby="inference-title"]';
  const planElement = `document.getElementById('inference-title').closest('section').querySelector('[aria-label="Approved normalized manifest"]')`;
  const observe = expression => dom(`JSON.stringify(${expression})`);
  // The normal automatic follow-up remains enabled; settle it before isolating
  // explicit user intent so background writes cannot impersonate our evidence.
  record.resultOperationStage = 'settle-automatic-plot';
  await pollRegistry(root, state => state.plans === 2 && state.runs.length === 2
    && state.runs.every(run => run.state === 'completed'), 'Automatic plot settled', 90000);
  // Automatic plotting selects its own run. Re-select the completed training
  // run explicitly before opening the result-operation surface.
  await button('Dismiss', true);
  await button('Experiments');
  await button('Close', true);
  await actions.button('Refresh', false, { scope: '//section[@aria-label="Runs"]' });
  record.resultOperationStage = 'select-training-run';
  const trainingRow = `xpath=//button[contains(@class,"run-row")][.//small[normalize-space(.)=${JSON.stringify(approvedManifest.run_id)}]]`;
  await cli('wait', '--fn', `document.evaluate(${JSON.stringify(trainingRow.slice(6))},document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null).snapshotLength===1`);
  await cli('click', trainingRow);
  await button('Results');
  await button('Refresh artifacts');
  record.resultOperationStage = 'verified-checkpoint-options';
  await cli('wait', '--fn', `Array.from(document.getElementById('source-generation')?.options ?? []).some(option => option.value && !option.disabled)`);
  const options = await observe('Array.from(document.querySelector("#source-generation").options).filter(o=>o.value&&!o.disabled).map(o=>({value:o.value,label:o.textContent.trim()}))');
  const chosen = options.find(option => option.label.endsWith('best'));
  assert(chosen, 'Published best classification must be explicitly selected');
  await actions.select('Source checkpoint generation', chosen.value);
  record.resultOperationStage = 'select-evaluation-dataset';
  const locator = await actions.readyControl('field', 'Configured root', false,
    { locator: `xpath=${scope}//*[@role="combobox" and @aria-label="Configured root"]` });
  await cli('click', locator);
  await actions.option('datasets');
  await actions.button('Select file samples.npz', false, { scope });
  await actions.fill('Python interpreter', record.pythonInterpreter,
    { scope });
  await actions.fill('Inference batch size', '8');
  const predictions = await actions.readyControl('button', 'Publish predictions CSV', false,
    { locator: '#inference-save_predictions' });
  await cli('click', predictions);
  assert.equal(await observe("document.getElementById('inference-save_predictions')?.getAttribute('aria-checked')"), 'true');
  record.resultOperationStage = 'unsupported-opset-refusal';
  const before = await registry(root);
  await actions.fill('ONNX opset (11–17)', '18');
  await actions.button('Preview evaluation / plot plan', false, { scope });
  await cli('wait', '--fn', 'document.querySelector("#inference-export_opset")?.getAttribute("aria-invalid") === "true"');
  const refusal = await observe(`({invalid:document.getElementById('inference-export_opset')?.getAttribute('aria-invalid'),approvalAbsent:!${planElement}})`);
  const after = await registry(root);
  assert.deepEqual(after, before, 'Unsupported opset must not persist, submit or cancel any work');
  await actions.fill('ONNX opset (11–17)', '17');
  record.resultOperationStage = 'preview-evaluation';
  await actions.button('Preview evaluation / plot plan', false, { scope });
  await cli('wait', '--fn', `${planElement} !== null`);
  const preview = async () => JSON.parse(await observe(`${planElement}.textContent`));
  const abandoned = await preview();
  assert.equal(abandoned.operation, 'test');
  await actions.fill('Inference batch size', '16');
  await cli('wait', '--fn', `!${planElement}`);
  const revoked = await registry(root);
  assert(revoked.control.every(control => control.submission_requested === (before.control.some(prior=>prior.plan_id===control.plan_id) ? 1 : 0)), 'Draft change cannot submit obsolete preview');
  await actions.button('Preview evaluation / plot plan', false, { scope });
  await cli('wait', '--fn', `${planElement} !== null`);
  const approved = await preview();
  assert.notEqual(approved.run_id, abandoned.run_id);
  assert.equal(approved.resolved_config.batch_size, 16);
  assert.equal(approved.checkpoint_source.run_id, approvedManifest.run_id);
  assert.equal(approved.checkpoint_source.generation, chosen.value);
  await actions.button('Approve and start this plan', false, { scope });
  await pollRegistry(root, state => {
    const run = state.runs.find(run => run.run_id === approved.run_id);
    assert(!run || !['failed','cancelled'].includes(run.state), 'Explicit CPU evaluation failed');
    return run?.state === 'completed';
  }, 'Explicit CPU evaluation completed', 90000);
  await button('Results');
  await button('Refresh artifacts');
  const evidence = JSON.parse(await command(python, ['-c', `import hashlib,json,sqlite3,sys
from pathlib import Path
root=Path(sys.argv[1]); ids=sys.argv[2:]
c=sqlite3.connect((root/'state'/'registry.db').resolve().as_uri()+'?mode=ro',uri=True); c.row_factory=sqlite3.Row
plans=[]
for r in c.execute('SELECT p.plan_id,p.plan_json,pc.submission_requested,pc.cancellation_requested FROM plans p JOIN plan_control pc ON pc.plan_id=p.plan_id ORDER BY p.plan_id'):
 d=dict(r); d['manifest']=json.loads(json.loads(d.pop('plan_json'))['manifest_json']); plans.append(d)
runs=[]
for id in ids:
 p=root/'runs'/id; pubs=[]
 for complete in sorted((p/'checkpoints').glob('*/COMPLETE.json')):
  raw=complete.read_bytes(); publication=json.loads(raw); files={}
  for name,wanted in publication['files'].items():
   body=(complete.parent/name).read_bytes(); actual={'size':len(body),'sha256':hashlib.sha256(body).hexdigest()}
   if actual != wanted: raise ValueError('Published bytes mismatch')
   files[name]=actual
  pubs.append({'generation':complete.parent.name,'completeSha256':hashlib.sha256(raw).hexdigest(),'complete':publication,'verifiedFiles':files})
 events=[json.loads(r[0]) for r in c.execute('SELECT event_json FROM event_log WHERE run_id=? ORDER BY attempt,seq',(id,))]
 manifest=(p/'manifest.json').read_bytes()
 runs.append({'runId':id,'manifestSha256':hashlib.sha256(manifest).hexdigest(),'publications':pubs,'events':events,'state':c.execute('SELECT state FROM runs WHERE run_id=?',(id,)).fetchone()[0]})
print(json.dumps({'plans':plans,'runs':runs}))`, root, approvedManifest.run_id, approved.run_id]));
  record.resultOperations = { scope: 'Same-host explicit CPU evaluation; unsupported opset refusal and draft revocation, not cancellation/ONNX/CV/remote matrix',
    selected: chosen, sourceRunId: approvedManifest.run_id, abandoned, approved,
    refusal: { ...refusal, before, after }, revoked, durable: evidence };
  check(true, 'Explicit evaluation approved the selected genuine checkpoint and completed with independently verified durable publications');
}
