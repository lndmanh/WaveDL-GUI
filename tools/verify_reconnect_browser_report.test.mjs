import assert from 'node:assert/strict';
import test from 'node:test';
import { reconnectLimitation, verifyReconnectRecord } from './verify_reconnect_browser_report.mjs';

function valid() {
  const id='12345678-1234-4234-8234-123456789abc';
  const authority=count=>({runId:id,runs:[{run_id:id,state:'running'}],plans:1,executions:1,controls:[{plan_id:id,submission_requested:1,cancellation_requested:0}],cursors:[[1,count-1]],eventIds:Array.from({length:count},(_,i)=>[1,i]),metricSteps:[1,2],journalMatches:true,prefixSha256:'a'.repeat(64)});
  const request={method:'GET',path:`/api/runs/${id}/events`,cursor:{attempt:0,seq:-1},status:200,scopeHeaderPresent:true};
  const rendered={selectedRunId:id,state:'running',steps:2,canvas:true,runtimeLog:true,currentMetrics:true,diagnosticIds:['1:0','1:1']};
  return {name:'same-daemon-reconnect',status:'passed',driverReadinessMode:'sync-exposure-poll-and-two-controller-dom-observations',browser:'agent-browser 0.26.0',initialProfileEmpty:true,browserObserved:{userAgent:'Chrome/146.0.0.0',width:1280,height:900,cookies:'',localStorageKeys:[],sessionStorageKeys:[]},limitation:reconnectLimitation,healthBefore:{daemon_id:'same',build_id:'1.8.1'},healthAfter:{daemon_id:'same',build_id:'1.8.1'},detached:{selectedRunAbsent:true,historyAbsent:true,diagnosticsAbsent:true,credentialEmpty:true},authorityBefore:authority(3),authorityDetached:authority(4),detachedAdvanced:authority(4),authorityAfter:authority(5),renderedBefore:rendered,renderedAfter:structuredClone(rendered),requestsBefore:[request],requestsAfter:[request,structuredClone(request)],requestsFrozenAfterCleanup:true,processResults:[{runId:id,pid:1234,returncode:0,cancelled:true,timedOut:false,pidAbsent:true}],cleanup:{errors:[],browserSessionAbsent:true,fixtureReaped:true,servicesClosed:true,listenerClosed:true,ownedRootsRemoved:true,browserProfileRemoved:true,privateCredentialRemoved:true}};
}
function complete() { const r=valid();for(const h of [r.healthBefore,r.healthAfter])Object.assign(h,{protocol_min:1,protocol_max:1});r.renderedAfter.diagnosticIds=['1:0','1:1','1:2'];return r; }
test('accepts fresh-monitor replay of the same real authority',()=>assert(verifyReconnectRecord(complete())));
for(const [name,mutate] of [
  ['identity replacement',r=>r.healthAfter.daemon_id='other'],
  ['cancel intent',r=>r.authorityAfter.controls[0].cancellation_requested=1],
  ['duplicate plan',r=>r.authorityAfter.plans=2],
  ['duplicate execution',r=>r.authorityAfter.executions=2],
  ['retained selected scope',r=>r.detached.selectedRunAbsent=false],
  ['retained credential',r=>r.detached.credentialEmpty=false],
  ['retained history',r=>r.detached.historyAbsent=false],
  ['nonzero fresh cursor',r=>r.requestsAfter[1].cursor={attempt:1,seq:2}],
  ['no replay GET',r=>r.requestsAfter=[r.requestsBefore[0]]],
  ['unscoped replay',r=>r.requestsAfter[1].scopeHeaderPresent=false],
  ['fake rejection',r=>r.requestsAfter[1].status=503],
  ['mutation after reconnect',r=>r.requestsAfter[1].method='POST'],
  ['changed request prefix',r=>r.requestsBefore[0].path='/api/other'],
  ['missing frozen requests',r=>r.requestsFrozenAfterCleanup=false],
  ['no active advancement',r=>r.authorityAfter.eventIds=r.authorityBefore.eventIds],
  ['foreign detached advancement',r=>r.detachedAdvanced.eventIds=[[1,99],[1,100],[1,101],[1,102]]],
  ['detached rollback',r=>r.detachedAdvanced.eventIds=r.authorityBefore.eventIds],
  ['after omits detached prefix',r=>r.authorityAfter.eventIds=r.authorityBefore.eventIds],
  ['corrupt producer prefix',r=>r.authorityAfter.eventIds[0]=[2,0]],
  ['journal mismatch',r=>r.authorityAfter.journalMatches=false],
  ['cursor beyond durable events',r=>r.authorityAfter.cursors=[[1,999]]],
  ['duplicate diagnostics',r=>r.renderedAfter.diagnosticIds=['1:0','1:0']],
  ['omitted pinned replay event',r=>r.renderedAfter.diagnosticIds=['1:0','1:1']],
  ['missing protocol identity',r=>delete r.healthAfter.protocol_max],
  ['skip reason masquerade',r=>r.skipReason='not executed'],
  ['uncommitted diagnostics',r=>r.renderedAfter.diagnosticIds=['1:999']],
  ['missing public paint',r=>r.renderedAfter.canvas=false],
  ['invented history',r=>r.renderedAfter.steps=99],
  ['vanished process proof',r=>r.processResults=[]],
  ['leaked runtime',r=>r.processResults[0].pidAbsent=false],
  ['timeout cleanup',r=>r.processResults[0].timedOut=true],
  ['listener remains',r=>r.cleanup.listenerClosed=false],
  ['profile remains',r=>r.cleanup.browserProfileRemoved=false],
  ['stale browser context',r=>r.browserObserved.width=800],
  ['private storage injection',r=>r.browserObserved.localStorageKeys=['cursor']],
  ['inflated limitation',r=>r.limitation='all T38 accepted'],
  ['retained private root',r=>r.retainedPrivateRoots=['/tmp/private']],
])test(`refuses ${name}`,()=>{const r=complete();mutate(r);assert.throws(()=>verifyReconnectRecord(r));});
