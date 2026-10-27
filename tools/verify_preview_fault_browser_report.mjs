import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { boundedFile } from "./browser_files.mjs";
import { currentAssetDigest } from "./verify_adoption_negative_browser_report.mjs";

export function verifyPreviewFaultRecord(r) {
  assert.equal(r.name, "dataset-preview-fault"); assert.equal(r.status, "passed");
  for (const key of ["error", "skip", "skipped", "skipReason", "retainedPrivateRoots", "explicitFixtureWebAssets"]) assert(!Object.hasOwn(r, key));
  assert.equal(r.driverReadinessMode, "sync-exposure-poll-and-two-controller-dom-observations");
  assert(r.browser.includes("agent-browser")); assert.equal(r.initialProfileEmpty, true); assert.match(r.browserObserved.userAgent, /Chrome\/[0-9]+/);
  assert.deepEqual({ ...r.browserObserved, userAgent: "Chrome" }, { userAgent: "Chrome", width:1280, height:900, cookies:"", localStorageKeys:[], sessionStorageKeys:[] });
  assert.deepEqual(r.cleanup, { errors:[], browserSessionAbsent:true, fixtureReaped:true, servicesClosed:true, listenerClosed:true, ownedRootsRemoved:true, browserProfileRemoved:true, privateCredentialRemoved:true });
  assert.deepEqual(r.drained,{outstanding:0});
  const zero = Object.fromEntries(["plans", "plan_control", "execution_control", "submission_control", "runs", "runtime_provenance", "event_log"].map(k=>[k,0]));
  assert.deepEqual(r.before.counts, zero); assert.deepEqual(r.after.counts, zero); assert.deepEqual(r.mutated.counts,zero);
  assert.deepEqual(r.after.sources,r.before.sources);
  assert.deepEqual(r.restored.sources,r.before.sources);
  assert.deepEqual(r.restored.counts,zero);
  assert.deepEqual(Object.keys(r.before.sources).sort(),["samples.h5","samples.mat","samples.npz"]);
  for(const d of Object.values(r.before.sources)){assert(Number.isSafeInteger(d.size)&&d.size>0);assert.match(d.sha256,/^[a-f0-9]{64}$/);}
  assert.notDeepEqual(r.mutated.sources["samples.npz"],r.before.sources["samples.npz"]);
  for(const name of ["samples.mat","samples.h5"])assert.deepEqual(r.mutated.sources[name],r.before.sources[name]);
  assert.deepEqual(r.pending,{loading:true,canvases:0});assert.deepEqual(r.cancelPending,{loading:true,canvases:0});
  assert.equal(r.stopReady.phase,5);assert.equal(r.stopReady.pidAlive,true);
  assert.deepEqual(r.stopPending,{loading:true,canvases:0,figures:0,stopButtons:1});
  assert.deepEqual(r.stopResult,{loading:false,message:'Preview loading stopped. Refresh preview to retry.',canvases:0,figures:0,stopButtons:0});
  assert.deepEqual(r.stopCapacity,{phase:5,outstanding:0});
  assert.equal(r.stopCapacityPending.phase,5);assert(Number.isSafeInteger(r.stopCapacityPending.outstanding)&&r.stopCapacityPending.outstanding>0);
  assert.deepEqual(r.stopRetry,{format:true,canvases: r.stopRetry.canvases,figures:r.stopRetry.figures});assert(r.stopRetry.canvases>0&&r.stopRetry.figures>0);
  assert.equal(r.refusal.message,"The daemon request failed. Verify connectivity and the operation outcome before retrying.");
  assert.deepEqual({ canvases: r.refusal.canvases, figures: r.refusal.figures }, { canvases: 0, figures: 0 });
  assert.equal(r.reselection.format,true);assert(r.reselection.canvases>0);assert.equal(r.retry.format,true);assert(r.retry.canvases>0&&r.retry.figures>0);
  assert.equal(r.processes.length,6);assert.deepEqual(r.processes.map(p=>p.phase).sort(),[1,2,3,4,5,6]);
  for(const [phase,ready] of [[1,r.mutationReady],[2,r.cancelReady],[5,r.stopReady]]){const p=r.processes.find(x=>x.phase===phase);assert.equal(ready.phase,phase);assert.equal(p.pid,ready.pid);assert(Number.isSafeInteger(p.pid)&&p.pid>0);assert.equal(p.pidAbsent,true);assert.equal(p.timedOut,false);assert.equal(p.stdoutTruncated,false);assert.deepEqual(p.originalArgv,ready.argv);assert.equal(p.originalArgv[1],"-m");assert.equal(p.originalArgv[2],"wavedl.core.dataset_preview");}
  assert.equal(r.processes.find(p=>p.phase===1).cancelled,false);assert.notEqual(r.processes.find(p=>p.phase===1).returncode,0);
  assert.equal(r.processes.find(p=>p.phase===2).cancelled,true);assert.equal(r.processes.find(p=>p.phase===5).cancelled,true);
  for(const p of r.processes){assert(Number.isSafeInteger(p.pid)&&p.pid>0);assert.equal(p.pidAbsent,true);assert.equal(p.timedOut,false);assert.equal(p.stdoutTruncated,false);assert.match(p.stdoutSha256,/^[a-f0-9]{64}$/);assert(Number.isSafeInteger(p.stdoutBytes)&&p.stdoutBytes>=0&&p.stdoutBytes<=1048576);}
  assert.equal(new Set(r.processes.map(p=>p.pid)).size,6);
  const expected=JSON.parse(r.mutationReady.argv[r.mutationReady.argv.indexOf('--expected-identity')+1]);
  assert.deepEqual(expected.identity,r.before.identity);assert.equal(expected.root_id,'datasets');assert.equal(expected.relative_path,'samples.npz');assert(expected.path.endsWith('/samples.npz'));assert.equal(r.mutationReady.argv[r.mutationReady.argv.indexOf('--path')+1],expected.path);
  const cancelExpected=JSON.parse(r.cancelReady.argv[r.cancelReady.argv.indexOf('--expected-identity')+1]);assert.deepEqual(cancelExpected.identity,r.restored.identity);assert.equal(cancelExpected.path,expected.path);
  const stopIdentity=JSON.parse(r.stopReady.argv[r.stopReady.argv.indexOf('--expected-identity')+1]);
  const cancelIdentity=JSON.parse(r.cancelReady.argv[r.cancelReady.argv.indexOf('--expected-identity')+1]);
  const argvWithoutIdentity = argv => argv.map((value,index)=>index===argv.indexOf('--expected-identity')+1?'EXPECTED_IDENTITY':value);
  assert.deepEqual(argvWithoutIdentity(r.stopReady.argv),argvWithoutIdentity(r.cancelReady.argv));
  const identityWithoutDirectoryChurn = (value) => ({
    path:value.path, identity:value.identity, root_id:value.root_id,
    relative_path:value.relative_path, root_path:value.root_path,
    root_identity:{st_dev:value.root_identity.st_dev,st_ino:value.root_identity.st_ino},
    ancestry:value.ancestry.map(item=>({path:item.path,st_dev:item.st_dev,st_ino:item.st_ino})),
  });
  assert.deepEqual(identityWithoutDirectoryChurn(stopIdentity),identityWithoutDirectoryChurn(cancelIdentity));
  assert.deepEqual(stopIdentity.identity,cancelIdentity.identity);
  assert.equal(stopIdentity.path,cancelIdentity.path);assert.equal(stopIdentity.root_id,'datasets');
  assert.equal(stopIdentity.relative_path,'samples.npz');assert(stopIdentity.path.endsWith('/samples.npz'));
  assert.equal(stopIdentity.root_path,cancelIdentity.root_path);
  for(const p of r.processes.filter(p=>p.phase>2&&p.phase!==5)){assert.equal(p.returncode,0);assert.equal(p.cancelled,false);assert.equal(p.timedOut,false);}
  const refused=r.responses.find(x=>x.status===409);assert(refused);assert.deepEqual(refused.request,{root:"datasets",path:"samples.npz",view:"all"});assert.deepEqual(refused.response,{error:"Conflict"});
  const retry=r.responses.find(x=>x.status===200&&x.request.path==="samples.npz");assert(retry);assert.deepEqual(retry.response.input_shape,[96,32]);assert.deepEqual(retry.response.output_shape,[96,1]);
  assert.equal(r.responses.length,6);assert.deepEqual(r.responses.map(x=>x.status),[409,503,200,200,503,200]);
  for(const response of r.responses.filter(x=>x.status===503))assert.deepEqual(response.response,{error:'Request failed'});
  const stopRetry=r.responses[5];assert.deepEqual(stopRetry.response.input_shape,[96,32]);assert.deepEqual(stopRetry.response.output_shape,[96,1]);assert.equal(stopRetry.response.format,'npz');
  for(const response of r.responses){assert.equal(response.method,'POST');assert.equal(response.path,'/api/datasets/preview');assert.equal(response.requestComplete,true);assert.equal(response.responseComplete,true);assert.deepEqual(JSON.parse(response.requestText),response.request);assert.deepEqual(JSON.parse(response.responseText),response.response);for(const kind of ['request','response']){assert.equal(response[kind+'Bytes'],Buffer.byteLength(response[kind+'Text']));assert.equal(response[kind+'Sha256'],createHash('sha256').update(response[kind+'Text']).digest('hex'));}assert.equal(response.request.root,'datasets');assert.equal(response.request.view,'all');}
  assert.deepEqual(r.responses.map(x=>x.request.path),['samples.npz','samples.npz','samples.mat','samples.npz','samples.npz','samples.npz']);
  assert.equal(r.limitation,"Fixture-only supervised phase barriers and ordinary local file mutation; explicit Stop loading exercises the local preview UI; no remote or site certification.");
  return true;
}
export async function verifyPreviewFaultFile(path){const r=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(await boundedFile(path,2*1024*1024)));verifyPreviewFaultRecord(r);assert.equal(r.assetManifestSha256,await currentAssetDigest());return r;}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){await verifyPreviewFaultFile(process.argv[2]);console.log("preview fault browser report: verified");}
