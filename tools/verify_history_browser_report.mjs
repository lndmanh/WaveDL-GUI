import assert from 'node:assert/strict';
import { boundedFile } from './verify_retained_browser_report.mjs';
import { currentAssetDigest } from './verify_adoption_negative_browser_report.mjs';
import { DRIVER_READINESS_MODE } from './browser_actions.mjs';
import { pathToFileURL } from 'node:url';
export function isRefusedConnectionError(error) {
  const codes=[],seen=new Set();
  const visit=e=>{
    if(!e||typeof e!=='object'||seen.has(e)) return;
    seen.add(e);
    if(seen.size>64) {codes.push('EVIDENCE_BOUND');return;}
    if(e.code) codes.push(e.code);
    if(e.cause) visit(e.cause);
    if(Array.isArray(e.errors)) e.errors.forEach(visit);
  };
  visit(error);
  return codes.length>0&&codes.every(code=>code==='ECONNREFUSED');
}
export function verifyHistoryBrowserReport(r) {
  assert.equal(r.status,'passed');
  for(const k of ['error','skip','skipped','skipReason','retainedWorkspace']) assert(!Object.hasOwn(r,k));
  assert.equal(r.scope,'real-packaged-browser-100k-history');
  assert.equal(r.limitation,'100000 controlled numerical metric events, not ML epochs; backend RUNNING observations and pid are fixture-controlled. Immutable writer identity, journal, daemon ingestion/SQLite/event log/public SSE and packaged application chart are real. Supersession/native restart and isolated uPlot render-only time are not claimed.');
  assert.match(r.assetManifestSha256,/^[0-9a-f]{64}$/);
  assert.equal(r.assetManifestSha256After,r.assetManifestSha256);
  assert.match(r.browserRuntime.userAgent,/Chrome\/\d+/);
  assert.deepEqual({width:r.browserRuntime.width,height:r.browserRuntime.height},{width:1280,height:900});
  assert.deepEqual(r.browserRuntime.cookies,'');
  assert.deepEqual(r.browserRuntime.localStorageKeys,[]);
  assert.deepEqual(r.browserRuntime.sessionStorageKeys,[]);
  assert.equal(r.observations.length,4);
  assert.deepEqual(r.observations.slice(1).map(o=>o.channel),['R²','Learning rate','Loss']);
  for(const o of r.observations) {
    assert.equal(o.selected,r.runId); assert.equal(o.steps,100000);
    assert(o.canvas&&o.canvasWidth>0&&o.canvasHeight>0);
    assert(Number.isSafeInteger(o.paintedPixels)&&o.paintedPixels>0);
    assert(Number.isSafeInteger(o.paintHash)&&o.paintHash>=0&&o.paintHash<=2**32-1);
    assert.equal(o.progress,1);
    assert(o.summary.includes('Epoch 100000 / 100000'));
    for(const [k,v] of Object.entries({'Training loss':'1','Validation loss':'2','R²':'1','Learning rate':'0.001','Pearson':'1','Gradient norm':'2','MAE average':'3','Epoch duration':'3 s','Best R² (current attempt)':'1','Elapsed training time':'300000 s','Patience':'0 / 10','P1':'5','P2':'6'})) assert.equal(o.values[k],v,`summary ${k}`);
    assert(o.summary.includes('Best validation loss: 1.00001'));
    assert(o.summary.includes('P1')&&o.summary.includes('P2'));
  }
  assert(r.selectionToPaintedHistoryMs>0&&Number.isFinite(r.selectionToPaintedHistoryMs));
  assert(Number.isFinite(r.sourceSeconds)&&r.sourceSeconds>0&&Number.isFinite(r.sourceAndIngestSeconds)&&r.sourceAndIngestSeconds>=r.sourceSeconds);
  assert(r.observations.slice(1).every(o=>o.channelSwitchWallMs>0&&Number.isFinite(o.channelSwitchWallMs)));
  assert(new Set(r.observations.slice(1).map(o=>o.paintHash)).size===3);
  const a=r.authority;
  const {requests: beforeRequests,...before}=r.authorityBefore;
  const {requests: afterRequests,...after}=a;
  assert.deepEqual(before,after);
  assert.deepEqual(beforeRequests,[]);
  assert(afterRequests.some(x=>x.method==='GET'&&x.path===`/api/runs/${r.runId}/events`));
  assert.deepEqual(r.authorityBefore.cursors,a.cursors);
  assert.deepEqual(r.authorityBefore.journalSha256,a.journalSha256);
  assert.equal(r.initialProfileEmpty,true);
  assert.equal(r.driverReadinessMode,DRIVER_READINESS_MODE);
  assert(r.authority.requests.every(x=>x.method==='GET'&&typeof x.path==='string'&&!x.path.includes('bootstrap=')));
  assert.equal(a.journalEvents,100001); assert.equal(a.journalMetrics,100000);
  assert.equal(a.activeMetrics,100000); assert.equal(a.lastStep,100000);
  assert.equal(a.eventLogEvents,100001); assert.deepEqual(a.cursors,[[1,100000]]);
  assert.match(a.journalSha256,/^[0-9a-f]{64}$/); assert(a.journalBytes>0&&a.journalBytes<128*1024*1024);
  assert.equal(a.lastMetric.payload.step,100000);
  for(const name of ['browserClosed','fixtureReaped','servicesClosed','listenerClosed','workspaceRemoved']) assert.equal(r.cleanup[name],true,`cleanup ${name}`);
  return r;
}
export async function verifyHistoryBrowserFile(path) {
  const raw=await boundedFile(path);
  const r=verifyHistoryBrowserReport(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)));
  assert.equal(r.assetManifestSha256,await currentAssetDigest());
  return r;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const path = process.argv[2];
  if (!path || !path.startsWith('/')) {
    console.error('Usage: node tools/verify_history_browser_report.mjs /absolute/report.json');
    process.exitCode = 2;
  } else {
    try { await verifyHistoryBrowserFile(path); console.log(`Verified: ${path}`); }
    catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
  }
}
