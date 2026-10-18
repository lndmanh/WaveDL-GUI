import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boundedFile } from './verify_retained_browser_report.mjs';
import { currentAssetDigest } from './verify_adoption_negative_browser_report.mjs';

export const reconnectLimitation = 'Genuine same-daemon local CPU detach, reauthentication and fresh-monitor replay from zero. No private cursor storage, transport-resume cursor, attempt rollover, remote, Windows, GPU or site certification.';
export function verifyReconnectRecord(r) {
  assert.equal(r.name, 'same-daemon-reconnect'); assert.equal(r.status, 'passed');
  for (const key of ['error','skip','skipped','skipReason','retainedPrivateRoots','explicitFixtureWebAssets']) assert(!Object.hasOwn(r,key));
  assert.equal(r.driverReadinessMode,'sync-exposure-poll-and-two-controller-dom-observations');
  assert(r.browser.includes('agent-browser')); assert.equal(r.initialProfileEmpty,true);
  assert.match(r.browserObserved.userAgent,/Chrome\/[0-9]+/);
  assert.deepEqual({...r.browserObserved,userAgent:'Chrome'},{userAgent:'Chrome',width:1280,height:900,cookies:'',localStorageKeys:[],sessionStorageKeys:[]});
  assert.equal(r.limitation,reconnectLimitation);
  assert.deepEqual(r.healthBefore,r.healthAfter);
  assert.match(r.healthBefore.daemon_id,/^[!-~]{1,256}$/); assert.match(r.healthBefore.build_id,/^[!-~]{1,256}$/);assert.equal(r.healthBefore.protocol_min,1);assert.equal(r.healthBefore.protocol_max,1);
  assert.deepEqual(r.detached,{selectedRunAbsent:true,historyAbsent:true,diagnosticsAbsent:true,credentialEmpty:true});
  const id=r.authorityBefore.runId; assert.match(id,/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  for(const a of [r.authorityBefore,r.authorityDetached,r.detachedAdvanced,r.authorityAfter]) {
    assert.equal(a.runId,id); assert.equal(a.plans,1); assert.equal(a.executions,1);
    assert.equal(a.runs.length,1);assert.equal(a.runs[0].run_id,id);assert.equal(a.runs[0].state,'running');
    assert.equal(a.controls.length,1);assert.equal(a.controls[0].submission_requested,1);assert.equal(a.controls[0].cancellation_requested,0);
    assert.equal(a.journalMatches,true);assert.match(a.prefixSha256,/^[a-f0-9]{64}$/);
    assert(a.metricSteps.length>0&&a.metricSteps.every(s=>Number.isSafeInteger(s)&&s>0&&s<=100000)); assert(a.eventIds.length>0&&a.eventIds.length<=200000);
    a.eventIds.forEach((event,i)=>assert.deepEqual(event,[1,i]));
    assert.deepEqual(a.cursors,[[1,a.eventIds.length-1]]);
  }
  assert.deepEqual(r.authorityDetached.controls,r.authorityBefore.controls);
  assert(r.detachedAdvanced && r.detachedAdvanced.eventIds.length>r.authorityBefore.eventIds.length);
  assert.deepEqual(r.detachedAdvanced.controls,r.authorityBefore.controls);
  assert.deepEqual(r.detachedAdvanced.eventIds.slice(0,r.authorityBefore.eventIds.length),r.authorityBefore.eventIds);
  assert.deepEqual(r.authorityAfter.controls,r.authorityBefore.controls);
  assert.deepEqual(r.authorityAfter.eventIds.slice(0,r.authorityBefore.eventIds.length),r.authorityBefore.eventIds);
  assert.deepEqual(r.authorityAfter.eventIds.slice(0,r.detachedAdvanced.eventIds.length),r.detachedAdvanced.eventIds);
  assert(r.authorityAfter.eventIds.length>r.authorityBefore.eventIds.length,'Training must advance while detached');
  for(const o of [r.renderedBefore,r.renderedAfter]) {
    assert.equal(o.selectedRunId,id);assert(Number.isSafeInteger(o.steps)&&o.steps>0);assert.equal(o.canvas,true);
    assert.equal(o.runtimeLog,true);assert.equal(o.currentMetrics,true);assert.equal(o.state,'running');
    assert(o.diagnosticIds.length>0&&new Set(o.diagnosticIds).size===o.diagnosticIds.length);
    assert(o.diagnosticIds.every(item=>r.authorityAfter.eventIds.some(([a,s])=>item===`${a}:${s}`)));
  }
  assert(r.renderedAfter.steps>=r.renderedBefore.steps);
  assert(r.renderedAfter.steps>=new Set(r.authorityBefore.metricSteps).size,'Fresh monitor must reconstruct the pinned pre-detach metric prefix');
  assert(r.authorityBefore.eventIds.length<=1000,'Pinned replay prefix exceeds public diagnostic capacity');
  for(const [a,s] of r.authorityBefore.eventIds)assert(r.renderedAfter.diagnosticIds.includes(`${a}:${s}`),'Fresh monitor omitted pinned committed replay event');
  assert(r.renderedAfter.steps<=new Set(r.authorityAfter.metricSteps).size);
  for(const requests of [r.requestsBefore,r.requestsAfter]) {
    assert(Array.isArray(requests)&&requests.length>0&&requests.length<=2000);
    assert(requests.every(q=>q.method==='GET'&&q.status===200&&(q.scopeHeaderPresent||q.path==='/api/health')));
  }
  assert.deepEqual(r.requestsAfter.slice(0,r.requestsBefore.length),r.requestsBefore);
  const streams=r.requestsAfter.filter(q=>q.path===`/api/runs/${id}/events`);
  assert(streams.length>=2); assert(streams.every(q=>JSON.stringify(q.cursor)==='{"attempt":0,"seq":-1}'));
  assert(r.requestsAfter.slice(r.requestsBefore.length).some(q=>q.path===`/api/runs/${id}/events`));
  assert.equal(r.requestsFrozenAfterCleanup,true);
  assert(r.processResults.length===1);const p=r.processResults[0];assert.equal(p.runId,id);
  assert(Number.isSafeInteger(p.pid)&&p.pid>0);assert(Number.isInteger(p.returncode));assert.equal(p.cancelled,true);assert.equal(p.timedOut,false);assert.equal(p.pidAbsent,true);
  assert.deepEqual(r.cleanup,{errors:[],browserSessionAbsent:true,fixtureReaped:true,servicesClosed:true,listenerClosed:true,ownedRootsRemoved:true,browserProfileRemoved:true,privateCredentialRemoved:true});
  return true;
}
export async function verifyReconnectFile(path) {
  const r=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await boundedFile(path,2*1024*1024)));
  verifyReconnectRecord(r);assert.equal(r.assetManifestSha256,await currentAssetDigest());return r;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){await verifyReconnectFile(process.argv[2]);console.log('same-daemon reconnect report: verified');}
