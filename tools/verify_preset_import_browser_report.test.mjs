import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { verifyPresetImportRecord } from './verify_preset_import_browser_report.mjs';

const interpreter = '/fixture/python';
const base = () => {
  const make = (id, config, run) => {
    const runtime = { python: interpreter, device: 'cpu', mode: 'existing', environment: {} };
    const manifest = { operation: 'train', run_id: run, run_directory: `/fixture/runs/${run}`, resolved_config: { model: 'cnn', data_path: '/fixture/samples.npz', workers: 0, precision: 'no', output_dir: `/fixture/runs/${run}`, ...config }, runtime: { ...runtime, container: null } };
    const { output_dir, ...requestConfig } = manifest.resolved_config;
    const request = { backend: 'local', operation: 'train', config: requestConfig, runtime, topology: { machine_rank: 0, num_machines: 1, processes_per_machine: 1 } };
    const plan = { allocation_mode: 'writer', target: 'local', topology: request.topology, run_directory: manifest.run_directory, manifest_json: JSON.stringify(manifest) };
    return [id, JSON.stringify(request), JSON.stringify(plan)];
  };
  const firstConfig = { epochs: 10000, patience: 10000, batch_size: 16, lr: 0.001 };
  const finalConfig = { ...firstConfig, epochs: 23, patience: 7, batch_size: 24, lr: 0.002 };
  const first = make('11111111-1111-4111-8111-111111111111', firstConfig, '22222222-2222-4222-8222-222222222222');
  const last = make('33333333-3333-4333-8333-333333333333', finalConfig, '44444444-4444-4444-8444-444444444444');
  const draft = { fields: Object.fromEntries([['epochs','10000'],['patience','10000'],['batch size','16'],['lr','0.001'],['seed','2025'],['workers','0'],['precision','no'],['weight decay','0.0001'],['Python interpreter',interpreter]].map(([k,v]) => [k,{value:v,checked:false}])), selection: ['Dataset: /fixture/samples.npz','Model: cnn'], controls: ['v-0-5-training-batch_size','v-0-6-training-lr','v-0-7-training-epochs','v-0-8-training-patience'].map(id => ({id, value: id.endsWith('batch_size')?'16':id.endsWith('lr')?'0.001':'10000', checked:false})) };
  const reg = rows => ({ runs: [], plans: rows.length, control: rows.map(row => ({ plan_id: row[0], submission_requested: 0, cancellation_requested: 0 })), submissions: [], executions: [] });
  const approved1 = JSON.parse(JSON.parse(first[2]).manifest_json), approved2 = JSON.parse(JSON.parse(last[2]).manifest_json);
  const after = (approvedText = JSON.stringify(approved1)) => ({ draft: structuredClone(draft), registry: reg([first]), planRows: [first], approvedManifestText: approvedText });
  const file = (id, category, content) => ({ id, filename: `/tmp/preset-import-${id}.json`, content, size: Buffer.byteLength(content), sha256: requireHash(content), category, publicMessage: 'Invalid preset. Use a JSON object containing only typed training fields, without dataset, model, runtime or output paths.', draftPreserved:true, approvalPreserved:true, planRowsPreserved:true, registryPreserved:true, inputCleared:true, after: after() });
  const forbidden = JSON.stringify({model:'custom.untrusted',data_path:'/tmp/retarget.npz',runtime:{python:'/tmp/x'},output_dir:'/tmp/output',import_modules:['untrusted.module'],epochs:22});
  return { name:'preset-import', browser:'agent-browser 0.26.0', driverReadinessMode:'sync-exposure-poll-and-two-controller-dom-observations', pythonInterpreter:interpreter, status:'passed', browserProfile:{initiallyEmpty:true}, browserViewport:{width:1280,height:900}, browserRuntime:{userAgent:'Chrome/150'}, freshStorage:{local:[],session:[],cookies:''}, assetManifestSha256:'a'.repeat(64), presetImportRequests:[{method:'POST',path:'/api/runs/plan',cursor:{},status:200,scopeHeaderPresent:true},{method:'POST',path:'/api/runs/plan',cursor:{},status:200,scopeHeaderPresent:true}], presetImportReceipts:[{sequence:0,method:'POST',path:'/api/runs/plan'},{sequence:1,method:'POST',path:'/api/runs/plan'}], presetImportDurableCounts:{plans:2,plan_control:2,execution_control:0,submission_control:0,runs:0,runtime_provenance:0,event_log:0}, presetImportRequestsFrozenAfterCleanup:true, cleanup:{errors:[],browserSessionAbsent:true,fixtureServicesClosed:true,listenerClosed:true,browserProfileRemoved:true,removedOwnedRoots:true,fixtureExit:{code:0,signal:null}}, presetImportEvidence:{baseline:{registry:reg([first]),planRows:[first],draft,approvedManifest:approved1},refusals:[file('malformed-json','malformed','{"epochs":'),file('forbidden-authority-fields','forbidden-fields',forbidden),file('invalid-range','invalid-range',JSON.stringify({epochs:0,batch_size:-1,patience:-1}))],validRetry:{filename:'/tmp/preset-import-valid.json',content:'{"epochs":23,"lr":0.002,"batch_size":24,"patience":7}',size:53,sha256:requireHash('{"epochs":23,"lr":0.002,"batch_size":24,"patience":7}'),preset:{epochs:23,lr:0.002,batch_size:24,patience:7},publicMessage:'Validated preset applied to the draft. Review it before planning.',approvalRevoked:true,selectionAndRuntimePreserved:true,noAutomaticPlan:true,inputCleared:true,after:{draft:{...structuredClone(draft),fields:{...structuredClone(draft.fields),epochs:{value:'23',checked:false},patience:{value:'7',checked:false},'batch size':{value:'24',checked:false},lr:{value:'0.002',checked:false}},controls:draft.controls.map(c=>({...c,value:c.id.endsWith('batch_size')?'24':c.id.endsWith('lr')?'0.002':c.id.includes('epochs')?'23':c.id.includes('patience')?'7':c.value}))},registry:reg([first]),planRows:[first],approvedManifestText:null}},final:{registry:reg([first,last]),planRows:[first,last],approvedManifest:approved2},noSubmission:true},finalRegistry:reg([first,last])};
};
const requireHash = text => createHash('sha256').update(text).digest('hex');

test('accepts strict synthetic preset evidence', () => assert.doesNotThrow(() => verifyPresetImportRecord(base())));
test('current shared registry observations retain explicit empty submission controls', () => {
  const record = base();
  assert.deepEqual(record.presetImportEvidence.baseline.registry.submissions, []);
  assert.deepEqual(record.presetImportEvidence.final.registry.submissions, []);
  assert.doesNotThrow(() => verifyPresetImportRecord(record));
});
for (const phase of ['baseline', 'final']) {
  for (const fault of ['missing', 'allocated']) test(`rejects ${fault} ${phase} submission evidence`, () => {
    const record = base();
    const registry = record.presetImportEvidence[phase].registry;
    if (fault === 'missing') delete registry.submissions;
    else registry.submissions.push({ plan_id: 'unowned-submission' });
    assert.throws(() => verifyPresetImportRecord(record));
  });
}
for (const [name, mutate] of [['draft', r => { r.presetImportEvidence.refusals[0].after.draft.fields.epochs.value = '9'; }], ['approval', r => { r.presetImportEvidence.refusals[1].after.approvedManifestText = null; }], ['plan', r => { r.presetImportEvidence.refusals[2].after.planRows.pop(); }], ['method', r => { r.presetImportRequests[0].method = 'GET'; }], ['durable', r => { r.presetImportDurableCounts.runs = 1; }], ['payload', r => { r.presetImportEvidence.validRetry.content += 'x'; }]]) test(`rejects ${name} drift`, () => { const r = base(); mutate(r); assert.throws(() => verifyPresetImportRecord(r)); });
