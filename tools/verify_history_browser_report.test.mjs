import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyHistoryBrowserReport, verifyHistoryBrowserFile, isRefusedConnectionError } from './verify_history_browser_report.mjs';
import { DRIVER_READINESS_MODE } from './browser_actions.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
function report() {
  const observation={selected:'run',steps:100000,canvas:true,canvasWidth:900,canvasHeight:600,paintedPixels:1000,paintHash:3,
    progress:1,summary:'Epoch 100000 / 100000 Best validation loss: 1.00001 P1 P2',
    values:{'Training loss':'1','Validation loss':'2','R²':'1','Learning rate':'0.001',Pearson:'1','Gradient norm':'2','MAE average':'3','Epoch duration':'3 s','Best R² (current attempt)':'1','Elapsed training time':'300000 s',Patience:'0 / 10',P1:'5',P2:'6'}};
  const r={status:'passed',scope:'real-packaged-browser-100k-history',limitation:'100000 controlled numerical metric events, not ML epochs; backend RUNNING observations and pid are fixture-controlled. Immutable writer identity, journal, daemon ingestion/SQLite/event log/public SSE and packaged application chart are real. Supersession/native restart and isolated uPlot render-only time are not claimed.',
    assetManifestSha256:'a'.repeat(64),assetManifestSha256After:'a'.repeat(64),
    browserRuntime:{userAgent:'HeadlessChrome/150',width:1280,height:900,cookies:'',localStorageKeys:[],sessionStorageKeys:[]},runId:'run',selectionToPaintedHistoryMs:10,initialProfileEmpty:true,driverReadinessMode:DRIVER_READINESS_MODE,
    sourceSeconds:10,sourceAndIngestSeconds:20,
    observations:[observation,...['R²','Learning rate','Loss'].map((channel,i)=>({...structuredClone(observation),channel,channelSwitchWallMs:1,paintHash:i+1}))],
    authority:{journalEvents:100001,journalMetrics:100000,activeMetrics:100000,lastStep:100000,eventLogEvents:100001,cursors:[[1,100000]],journalSha256:'a'.repeat(64),journalBytes:1000,lastMetric:{payload:{step:100000}},requests:[]},
    authorityBefore:{cursors:[[1,100000]],journalSha256:'a'.repeat(64)},
    cleanup:{browserClosed:true,fixtureReaped:true,servicesClosed:true,listenerClosed:true,workspaceRemoved:true}};
  r.authorityBefore=structuredClone(r.authority);
  r.authority.requests=[{method:'GET',path:'/api/runs/run/events'}];
  return r;
}
test('accepts exact public-path evidence shape',()=>verifyHistoryBrowserReport(report()));
test('reader rejects invalid UTF-8 and symlink ancestors',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'wavedl-history-reader-test-')));
 try {
  const path=join(root,'invalid.json');
  // Inserting invalid UTF-8 into an otherwise irrelevant field must not be
  // silently decoded into U+FFFD and accepted by the semantic verifier.
  const r=report();r.unused='MARKER';
  await writeFile(path,Buffer.from(JSON.stringify(r).replace('MARKER','\xff'),'latin1'));
  await assert.rejects(verifyHistoryBrowserFile(path));
  const link=join(root,'ancestor');await symlink(root,link);
  await assert.rejects(verifyHistoryBrowserFile(join(link,'invalid.json')),/ordinary directory/);
 } finally {await rm(root,{recursive:true,force:true});}
});
test('CLI rejects missing argument, absent report, failed status and stale asset inventory',async()=>{
 const script=new URL('./verify_history_browser_report.mjs',import.meta.url).pathname;
 assert.equal(spawnSync(process.execPath,[script]).status,2);
 const root=await mkdtemp(join(tmpdir(),'wavedl-history-verifier-test-'));
 try {
  assert.equal(spawnSync(process.execPath,[script,join(root,'missing.json')]).status,1);
  const failed=report();failed.status='failed';
  await writeFile(join(root,'failed.json'),JSON.stringify(failed));
  assert.equal(spawnSync(process.execPath,[script,join(root,'failed.json')]).status,1);
  await writeFile(join(root,'stale.json'),JSON.stringify(report()));
  assert.equal(spawnSync(process.execPath,[script,join(root,'stale.json')]).status,1);
 } finally {await rm(root,{recursive:true,force:true});}
});
test('listener cleanup accepts refusal only, not timeouts or unrelated network failures',()=>{
 assert.equal(isRefusedConnectionError({cause:{code:'ECONNREFUSED'}}),true);
 assert.equal(isRefusedConnectionError({cause:{errors:[{code:'ECONNREFUSED'},{code:'ECONNREFUSED'}]}}),true);
 for(const error of [new Error('fetch failed'),{name:'TimeoutError'},{cause:{code:'ETIMEDOUT'}},{cause:{errors:[{code:'ECONNREFUSED'},{code:'EHOSTUNREACH'}]}}]) assert.equal(isRefusedConnectionError(error),false);
});
for(const [name,change] of [
  ['synthetic scope',r=>r.scope='uplot-only'],
  ['99k',r=>r.observations[0].steps=99999],
  ['no painted canvas',r=>r.observations[0].canvasWidth=0],
  ['transparent canvas',r=>r.observations[0].paintedPixels=0],
  ['frozen channel canvas',r=>r.observations[2].paintHash=r.observations[1].paintHash],
  ['stale summary',r=>r.observations[0].values['Gradient norm']='999'],
  ['wrong channel',r=>r.observations[1].channel='Loss'],
  ['missing journal',r=>r.authority.journalMetrics=99999],
  ['missing projection',r=>r.authority.activeMetrics=99999],
  ['missing cursor',r=>r.authority.cursors=[[1,99999]]],
  ['unmeasured',r=>r.selectionToPaintedHistoryMs=NaN],
  ['incomplete cleanup',r=>r.cleanup.servicesClosed=false],
  ['browser mutation',r=>r.authority.requests.push({method:'POST',path:'/api/runs'})],
  ['source drift',r=>r.authority.journalSha256='b'.repeat(64)],
  ['asset drift',r=>r.assetManifestSha256After='b'.repeat(64)],
  ['nonfresh profile',r=>r.initialProfileEmpty=false],
  ['wrong viewport',r=>r.browserRuntime.width=900],
  ['storage residue',r=>r.browserRuntime.localStorageKeys=['credential']],
  ['skipped pass',r=>r.skipped=true],
  ['fake ML claim',r=>r.limitation='100000 ML epochs'],
  ['no selected stream',r=>r.authority.requests=[{method:'GET',path:'/api/health'}]],
  ['infinite source timing',r=>r.sourceSeconds=Infinity],
  ['infinite ingest timing',r=>r.sourceAndIngestSeconds=Infinity],
  ['oversized pixel hash',r=>r.observations[0].paintHash=2**32],
]) test(`rejects ${name}`,()=>{const r=report();change(r);assert.throws(()=>verifyHistoryBrowserReport(r));});
