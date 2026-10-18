import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,realpath,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {verifyAutoplotMetadataIntegrityRecord,verifyAutoplotMetadataIntegrityReport} from './verify_autoplot_metadata_integrity_report.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const id=n=>`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`;
const options={assetHash:'a'.repeat(64),browser:'agent-browser test',directory:'/owned/report'};
function valid() {
  const name='autoplot-metadata-integrity',train={operation:'train',run_id:id(1)};
  const original={size:37,sha256:hash('{"schema_version": 1, "kind": "best"}')};
  const raw=Buffer.from('{"schema_version":\t1, "kind": "best"}');
  const complete={schema_version:1,run_id:id(1),generation:'gen-000002',attempt:1,step:4,manifest_sha256:'c'.repeat(64),files:{'checkpoint_selection.json':original}};
  const files=Object.fromEntries(['training_meta.pkl','scaler.pkl','model.safetensors','checkpoint_selection.json'].map(key=>[key,{size:5,sha256:'b'.repeat(64)}]));
  const durable={plans:1,runs:[{run_id:id(1),state:'completed'}],control:[{plan_id:id(2),submission_requested:1,cancellation_requested:0}],executions:[{plan_id:id(2),state:'submitted',observed_status:'terminal',cancel_delivered:0}]};
  const path=`/api/runs/${id(1)}/artifacts/gen-000002/checkpoint_selection.json`;
  return {
    name,status:'passed',browser:options.browser,assetManifestSha256:options.assetHash,driverReadinessMode:'sync-exposure-poll-and-two-controller-dom-observations',
    pythonInterpreter:'/owned/python',browserViewport:{width:1280,height:900},browserProfile:{path:join(options.directory,`${name}-browser-profile`),initiallyEmpty:true},freshStorage:{local:[],session:[],cookies:''},
    started:'2026-10-18T00:00:00Z',finished:'2026-10-18T00:01:00Z',assertions:Array(6).fill('Verified assertion'),
    integrityUi:'The daemon returned an invalid response. Reconnect to verify its identity.',integrityDom:{connectionRefused:true,automaticPlotControlsAbsent:true,verifiedRasterAbsent:true},
    partialBestPublication:{mode:'fallback',runId:id(1),attempt:1,olderCompleteBest:'gen-000001',partialGeneration:'gen-000002',partialComplete:complete,originalCompleteSha256:{'gen-000001':'d'.repeat(64)},visibleGenerations:['gen-000001','gen-000002'],quarantined:[]},
    approvedPlan:JSON.stringify(train),integrityPlans:[train],finalRegistry:durable,integrityBefore:structuredClone(durable),integrityFrozenRegistry:structuredClone(durable),integrityFrozenAfterCleanup:true,
    integrityInventories:[{status:200,path:`/api/runs/${id(1)}/artifacts`,body:{generations:[{generation:'gen-000001',attempt:1,step:3,files},{generation:'gen-000002',attempt:1,step:4,files:complete.files}]}}],
    integrityWire:[{phase:'arrival',path},{phase:'complete',path,status:200,tampered:true,original,published:structuredClone(original),diskAfter:structuredClone(original),wire:{size:37,sha256:hash(raw)},parsedOriginal:{schema_version:1,kind:'best'},parsedWire:{schema_version:1,kind:'best'}}],
    integrityRequests:['/api/runs/plan','/api/runs'].map(path=>({method:'POST',path,status:200,scopeHeaderPresent:true})),integrityReceipts:[{sequence:0,method:'POST',path:'/api/runs/plan'}],
    cleanup:{errors:[],fixtureExit:{code:null,signal:'SIGINT'},browserSessionAbsent:true,fixtureServicesClosed:true,removedOwnedRoots:true,browserProfileRemoved:true,listenerClosed:true},
  };
}
test('accepts complete fail-closed evidence with real older source available',()=>verifyAutoplotMetadataIntegrityRecord(valid(),options));
for (const key of ['explicitFixtureWebAssets','authoringEventDiagnostic']) {
  for (const value of ['/alternate/instrumented-assets', false, '']) {
    test(`rejects presence of ${key} with ${JSON.stringify(value)}`,()=>{
      const record=valid();record[key]=value;
      assert.throws(()=>verifyAutoplotMetadataIntegrityRecord(record,options));
    });
  }
}
const attacks=[
  ['error',r=>r.error=''],['skip',r=>r.skipped=false],['status',r=>r.status='failed'],['assets',r=>r.assetManifestSha256='0'.repeat(64)],
  ['connection',r=>r.integrityDom.connectionRefused=false],['plot controls',r=>r.integrityDom.automaticPlotControlsAbsent=false],['raster',r=>r.integrityDom.verifiedRasterAbsent=false],
  ['no UI',r=>r.integrityUi='Connected'],['incomplete downgrade',r=>r.integrityUi+='Automatic plots unavailable: the published checkpoint is incomplete.'],
  ['missing older',r=>r.partialBestPublication.visibleGenerations.shift()],['quarantine',r=>r.partialBestPublication.quarantined=['gen-000001']],
  ['missing source weights',r=>delete r.integrityInventories[0].body.generations[0].files['model.safetensors']],
  ['no arrival',r=>r.integrityWire.shift()],['extra older arrival',r=>r.integrityWire.push({phase:'arrival',path:r.integrityWire[0].path.replace('000002','000001')})],
  ['no corruption',r=>r.integrityWire[1].tampered=false],['changed disk',r=>r.integrityWire[1].diskAfter.sha256='0'.repeat(64)],
  ['wrong original',r=>r.integrityWire[1].original.size=38],['wrong wire hash',r=>r.integrityWire[1].wire.sha256='0'.repeat(64)],['truncation',r=>r.integrityWire[1].wire.size=36],
  ['changed parsed classification',r=>r.integrityWire[1].parsedWire.kind='periodic'],['missing parsed wire proof',r=>delete r.integrityWire[1].parsedWire],
  ['extra plot',r=>r.integrityPlans.push({operation:'plot'})],['late plan',r=>r.integrityFrozenRegistry.plans=2],['cancel',r=>r.finalRegistry.control[0].cancellation_requested=1],
  ['extra planning receipt',r=>r.integrityReceipts.push(r.integrityReceipts[0])],['extra request',r=>r.integrityRequests.push(r.integrityRequests[0])],
  ['cancel request',r=>r.integrityRequests.push({method:'POST',path:`/api/runs/${id(1)}/[endpoint]`,status:202})],['method',r=>r.integrityRequests.push({method:'DELETE',path:'/api/runs',status:200})],
  ['not frozen',r=>r.integrityFrozenAfterCleanup=false],['profile retained',r=>r.cleanup.browserProfileRemoved=false],['forced shutdown',r=>r.cleanup.fixtureExit.signal='SIGKILL'],['listener',r=>r.cleanup.listenerClosed=false],
];
for(const [name,mutate] of attacks)test(`rejects ${name}`,()=>{const r=valid();mutate(r);assert.throws(()=>verifyAutoplotMetadataIntegrityRecord(r,options));});
test('file guard binds exact current bytes and summary/case and directory',async()=>{
  const directory=await realpath(await mkdtemp(join(tmpdir(),'metadata-integrity-guard-')));
  try {
    const r=valid();r.browserProfile.path=join(directory,`${r.name}-browser-profile`);r.assetManifestSha256=hash(await readFile(new URL('../src/wavedl_daemon/web_assets/.wavedl-assets.json',import.meta.url)));
    const summary={browser:r.browser,started:r.started,finished:r.finished,cases:[r]},path=join(directory,'summary.json'),casePath=join(directory,`${r.name}.json`);
    const save=async()=>{await writeFile(path,JSON.stringify(summary));await writeFile(casePath,JSON.stringify(r));};
    await save();await verifyAutoplotMetadataIntegrityReport(path);
    await writeFile(casePath,'{}');await assert.rejects(verifyAutoplotMetadataIntegrityReport(path));
    await save();await writeFile(join(directory,'extra.json'),'{}');await assert.rejects(verifyAutoplotMetadataIntegrityReport(path));
  } finally {await rm(directory,{recursive:true,force:true});}
});
test('file guard refuses symlink report and invalid UTF-8',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'metadata-integrity-link-'));
  try {await writeFile(join(directory,'real.json'),'{}');await symlink(join(directory,'real.json'),join(directory,'summary.json'));await assert.rejects(verifyAutoplotMetadataIntegrityReport(join(directory,'summary.json')));await writeFile(join(directory,'invalid.json'),Buffer.from([255]));await assert.rejects(verifyAutoplotMetadataIntegrityReport(join(directory,'invalid.json')));} finally {await rm(directory,{recursive:true,force:true});}
});
