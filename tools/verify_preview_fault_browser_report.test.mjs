import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyPreviewFaultRecord, verifyPreviewFaultFile } from "./verify_preview_fault_browser_report.mjs";
import { currentAssetDigest } from "./verify_adoption_negative_browser_report.mjs";

function baseRecord() {
  const identity={st_dev:1,st_ino:2,st_size:10,st_mtime_ns:3};
  const sources=Object.fromEntries(['samples.npz','samples.mat','samples.h5'].map(n=>[n,{size:10,sha256:'a'.repeat(64)}]));
  const counts=Object.fromEntries(['plans','plan_control','execution_control','submission_control','runs','runtime_provenance','event_log'].map(n=>[n,0]));
  const argv=['/python','-m','wavedl.core.dataset_preview','--path','/fixture/samples.npz','--expected-identity',JSON.stringify({identity,root_id:'datasets',relative_path:'samples.npz',path:'/fixture/samples.npz'})];
  const processes=[1,2,3,4].map(phase=>({phase,pid:100+phase,pidAbsent:true,returncode:phase===1?1:0,cancelled:phase===2,timedOut:false,stdoutTruncated:false,stdoutSha256:'b'.repeat(64),stdoutBytes:10,originalArgv:argv}));
  return {name:'dataset-preview-fault',status:'passed',driverReadinessMode:'sync-exposure-poll-and-two-controller-dom-observations',browser:'agent-browser',initialProfileEmpty:true,browserObserved:{userAgent:'Chrome/1',width:1280,height:900,cookies:'',localStorageKeys:[],sessionStorageKeys:[]},cleanup:{errors:[],browserSessionAbsent:true,fixtureReaped:true,servicesClosed:true,listenerClosed:true,ownedRootsRemoved:true,browserProfileRemoved:true,privateCredentialRemoved:true},before:{counts,sources,identity},after:{counts:structuredClone(counts),sources:structuredClone(sources)},mutated:{counts:structuredClone(counts),sources:{...sources,'samples.npz':{size:11,sha256:'c'.repeat(64)}}},pending:{loading:true,canvases:0},cancelPending:{loading:true,canvases:0},refusal:{message:'The daemon request failed. Verify connectivity and the operation outcome before retrying.',canvases:0,figures:0},reselection:{format:true,canvases:8},retry:{format:true,canvases:8,figures:8},mutationReady:{phase:1,pid:101,argv},cancelReady:{phase:2,pid:102,argv},processes,responses:[{status:409,request:{root:'datasets',path:'samples.npz',view:'all'},response:{error:'Conflict'}},{status:200,request:{root:'datasets',path:'samples.npz',view:'all'},response:{input_shape:[96,32],output_shape:[96,1]}}],limitation:'Fixture-only supervised phase barriers and ordinary local file mutation; no explicit preview Stop button, remote or site certification.'};
}
function record(){const r=baseRecord();r.drained={outstanding:0};r.restored=structuredClone(r.before);const bad=r.responses[0],good=r.responses[1];r.responses=[bad,{status:503,request:structuredClone(bad.request),response:{error:'Request failed'}},{status:200,request:{root:'datasets',path:'samples.mat',view:'all'},response:structuredClone(good.response)},good].map(x=>{const requestText=JSON.stringify(x.request),responseText=JSON.stringify(x.response),hash=t=>createHash('sha256').update(t).digest('hex');return{...x,requestComplete:true,responseComplete:true,requestText,responseText,requestBytes:Buffer.byteLength(requestText),responseBytes:Buffer.byteLength(responseText),requestSha256:hash(requestText),responseSha256:hash(responseText)};});return r;}
const originalRecord=record;
for(const [name,mutate] of [
  ['missingStop',r=>delete r.stopReady],['stopNotLive',r=>r.stopReady.pidAlive=false],
  ['wrongStopPhase',r=>r.stopReady.phase=4],['wrongStopPid',r=>r.stopReady.pid=104],
  ['stopChangedFileIdentity',r=>{const i=JSON.parse(r.stopReady.argv[r.stopReady.argv.indexOf('--expected-identity')+1]);i.identity.st_ino++;r.stopReady.argv[r.stopReady.argv.indexOf('--expected-identity')+1]=JSON.stringify(i);}],
  ['stopChangedAncestryIdentity',r=>{const i=JSON.parse(r.stopReady.argv[r.stopReady.argv.indexOf('--expected-identity')+1]);i.ancestry[0].st_ino++;r.stopReady.argv[r.stopReady.argv.indexOf('--expected-identity')+1]=JSON.stringify(i);}],
  ['stopChangedExpectedPath',r=>{const i=JSON.parse(r.stopReady.argv[r.stopReady.argv.indexOf('--expected-identity')+1]);i.path='/other/samples.npz';r.stopReady.argv[r.stopReady.argv.indexOf('--expected-identity')+1]=JSON.stringify(i);}],
  ['missingStopControl',r=>r.stopPending.stopButtons=0],['staleStopRaster',r=>r.stopPending.canvases=1],
  ['stopStillLoading',r=>r.stopResult.loading=true],['stopStaleFigures',r=>r.stopResult.figures=1],
  ['stopNotAcknowledged',r=>r.stopResult.message=''],['stopNotCancelled',r=>r.processes[4].cancelled=false],
  ['stopTimedOut',r=>r.processes[4].timedOut=true],['stopUnreaped',r=>r.processes[4].pidAbsent=false],
  ['stopCapacityHeld',r=>r.stopCapacity.outstanding=1],['stopNoRetry',r=>r.stopRetry.figures=0],
  ['stopRetryTruncated',r=>r.processes[5].stdoutTruncated=true],['stopRetryShape',r=>r.responses[5].response.input_shape=[1,1]],
  ['wrongMethod',r=>r.responses[4].method='GET'],['wrongEndpoint',r=>r.responses[4].path='/api/runs'],
  ['private503Message',r=>r.responses[4].response={error:'Service Unavailable'}],['wrong503Message',r=>r.responses[4].response={error:'secret traceback'}],
  ['extraRequest',r=>r.responses.push(r.responses[5])],['wrongRequestOrder',r=>r.responses.reverse()],
])test(`rejects ${name}`,()=>{const r=record();mutate(r);assert.throws(()=>verifyPreviewFaultRecord(r));});
test('accepts stop directory metadata churn',()=>{const r=record();const i=JSON.parse(r.stopReady.argv[r.stopReady.argv.indexOf('--expected-identity')+1]);i.root_identity.st_size+=160;i.root_identity.st_mtime_ns+=99;i.ancestry[0].st_size+=160;i.ancestry[0].st_mtime_ns+=99;r.stopReady.argv[r.stopReady.argv.indexOf('--expected-identity')+1]=JSON.stringify(i);assert(verifyPreviewFaultRecord(r));});
function stopRecord(){const r=originalRecord();const argv=structuredClone(r.cancelReady.argv);r.stopReady={phase:5,pid:105,argv,pidAlive:true};r.stopPending={loading:true,canvases:0,figures:0,stopButtons:1};r.stopResult={loading:false,message:'Preview loading stopped. Refresh preview to retry.',canvases:0,figures:0,stopButtons:0};r.stopCapacity={phase:5,outstanding:0};r.stopCapacityPending={phase:5,outstanding:1};r.stopRetry={format:true,canvases:8,figures:8};for(const phase of [5,6])r.processes.push({...structuredClone(r.processes[3]),phase,pid:100+phase,cancelled:phase===5,originalArgv:structuredClone(argv)});r.responses.push(structuredClone(r.responses[1]),structuredClone(r.responses[3]));for(const response of r.responses){response.method='POST';response.path='/api/datasets/preview';if(response.status===200){response.response.format=response.request.path.endsWith('.mat')?'mat':'npz';response.responseText=JSON.stringify(response.response);response.responseBytes=Buffer.byteLength(response.responseText);response.responseSha256=createHash('sha256').update(response.responseText).digest('hex');}}r.limitation='Fixture-only supervised phase barriers and ordinary local file mutation; explicit Stop loading exercises the local preview UI; no remote or site certification.';return r;}
record = () => {
  const r=stopRecord();
  for(const [phase,ready] of [[1,r.mutationReady],[2,r.cancelReady],[5,r.stopReady]]){
    const argv=structuredClone(ready.argv), index=argv.indexOf('--expected-identity')+1;
    const expected=JSON.parse(argv[index]);
    expected.root_path='/fixture';expected.root_identity={st_dev:1,st_ino:7,st_size:256,st_mtime_ns:9};
    expected.ancestry=[{path:'/fixture',...expected.root_identity}];
    argv[index]=JSON.stringify(expected);ready.argv=argv;r.processes.find(p=>p.phase===phase).originalArgv=argv;
  }
  return r;
};
test('accepts synthetic evidence contract only, not actual browser proof',()=>assert(verifyPreviewFaultRecord(record())));
for(const [name,mutate] of [
  ['failed',r=>r.status='failed'],['skip',r=>r.skip=true],['retainedroots',r=>r.retainedPrivateRoots=[]],['missingChrome',r=>r.browserObserved.userAgent='other'],['badviewport',r=>r.browserObserved.width=0],['cleanup',r=>r.cleanup.listenerClosed=false],['emptycounts',r=>r.after.counts={}],['planwrite',r=>r.after.counts.plans=1],['unrestoredsource',r=>r.after.sources['samples.npz'].size++],['unmutatedsource',r=>r.mutated.sources=r.before.sources],['staleraster',r=>r.refusal.canvases=1],['falsepending',r=>r.pending.loading=false],['noretry',r=>r.retry.figures=0],['timeout',r=>r.processes[0].timedOut=true],['notcancelled',r=>r.processes[1].cancelled=false],['pidalive',r=>r.processes[2].pidAbsent=false],['pidmismatch',r=>r.cancelReady.pid=999],['truncatedstdout',r=>r.processes[0].stdoutTruncated=true],['identitymismatch',r=>r.before.identity.st_size++],['wrongchild',r=>r.mutationReady.argv[2]='other'],['missingphase',r=>r.processes.pop()],['missing409',r=>r.responses[0].status=200],['wrongresponse',r=>r.responses[0].response={error:'OK'}],['wrongretryshape',r=>r.responses[1].response.input_shape=[1,1]],
])test(`rejects ${name}`,()=>{const r=record();mutate(r);assert.throws(()=>verifyPreviewFaultRecord(r));});
for(const [name,mutate] of [['workNotDrained',r=>r.drained.outstanding=1],['responseHash',r=>r.responses[0].responseSha256='0'.repeat(64)],['requestHash',r=>r.responses[0].requestSha256='0'.repeat(64)],['responseLength',r=>r.responses[0].responseBytes++],['requestIncomplete',r=>r.responses[0].requestComplete=false],['responseIncomplete',r=>r.responses[0].responseComplete=false],['missingCancelBoundary',r=>r.responses[1].status=200],['restoreFingerprint',r=>r.restored.identity.st_size++]])test(`rejects ${name}`,()=>{const r=record();mutate(r);assert.throws(()=>verifyPreviewFaultRecord(r));});
test('file gate binds current full asset inventory and rejects stale/symlink evidence',async()=>{const root=await mkdtemp(join(await realpath(tmpdir()),'preview-guard-'));try{const r=record();r.assetManifestSha256=await currentAssetDigest();const path=join(root,'report.json');await writeFile(path,JSON.stringify(r));await verifyPreviewFaultFile(path);await symlink(path,join(root,'link.json'));await assert.rejects(verifyPreviewFaultFile(join(root,'link.json')));r.assetManifestSha256='0'.repeat(64);await writeFile(path,JSON.stringify(r));await assert.rejects(verifyPreviewFaultFile(path));}finally{await rm(root,{recursive:true,force:true});}});
