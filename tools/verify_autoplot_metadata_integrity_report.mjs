import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const name = 'autoplot-metadata-integrity';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const generation = value => typeof value === 'string' && /^gen-\d{6,}$/.test(value);
const failureKeys = ['error','shutdownError','skip','skipped','skipReason','failureStage','failed','failurePage','failureSnapshot','failureEvidence','retainedPrivateRoots','ownedSessionStillListed','fixtureStderr','fixtureAlive','explicitFixtureWebAssets','authoringEventDiagnostic'];
function noFailure(value) { for (const key of failureKeys) assert(!Object.hasOwn(value, key), key); }
function identity(value) { assert(Number.isSafeInteger(value.size) && value.size > 0 && digest(value.sha256)); }
function durable(value, runId) {
  assert.equal(value.plans, 1);
  assert.deepEqual(value.runs, [{ run_id: runId, state: 'completed' }]);
  assert.equal(value.control.length, 1); assert.equal(value.executions.length, 1);
  const control = value.control[0], execution = value.executions[0];
  assert(uuid(control.plan_id));
  assert.equal(control.submission_requested, 1); assert.equal(control.cancellation_requested, 0);
  assert.equal(execution.plan_id, control.plan_id); assert.equal(execution.state, 'submitted');
  assert.equal(execution.observed_status, 'terminal'); assert.equal(execution.cancel_delivered, 0);
}
export function verifyAutoplotMetadataIntegrityRecord(record, {assetHash, browser, directory}) {
  noFailure(record); assert.equal(record.name, name); assert.equal(record.status, 'passed');
  assert.equal(record.assetManifestSha256, assetHash); assert.equal(record.browser, browser);
  assert.equal(record.driverReadinessMode, 'sync-exposure-poll-and-two-controller-dom-observations');
  assert.deepEqual(record.browserViewport, {width:1280,height:900});
  assert.deepEqual(record.browserProfile, {path:join(directory, `${name}-browser-profile`),initiallyEmpty:true});
  assert.deepEqual(record.freshStorage, {local:[],session:[],cookies:''});
  assert(typeof record.pythonInterpreter === 'string' && record.pythonInterpreter.startsWith('/'));
  assert(record.assertions.length > 5 && record.assertions.every(value=>typeof value==='string' && value.length));
  assert(Number.isFinite(Date.parse(record.started)) && Date.parse(record.finished)>=Date.parse(record.started));
  assert(record.integrityUi.includes('The daemon returned an invalid response. Reconnect to verify its identity.'));
  assert(!record.integrityUi.includes('Automatic plots unavailable: the published checkpoint is incomplete.'));
  assert.deepEqual(record.integrityDom, {connectionRefused:true,automaticPlotControlsAbsent:true,verifiedRasterAbsent:true});
  const proof = record.partialBestPublication;
  assert.equal(proof.mode,'fallback'); assert(uuid(proof.runId));
  assert(Number.isSafeInteger(proof.attempt) && proof.attempt>0);
  assert(generation(proof.partialGeneration) && generation(proof.olderCompleteBest));
  assert(BigInt(proof.partialGeneration.slice(4))>BigInt(proof.olderCompleteBest.slice(4)));
  assert.deepEqual(proof.quarantined,[]);
  const originals = Object.keys(proof.originalCompleteSha256);
  assert(originals.length>0 && originals.every(generation) && Object.values(proof.originalCompleteSha256).every(digest));
  assert(originals.includes(proof.olderCompleteBest));
  assert.deepEqual([...proof.visibleGenerations].sort(),[...originals,proof.partialGeneration].sort());
  const complete = proof.partialComplete;
  assert.equal(complete.schema_version,1); assert.equal(complete.run_id,proof.runId);
  assert.equal(complete.generation,proof.partialGeneration); assert.equal(complete.attempt,proof.attempt);
  assert(Number.isSafeInteger(complete.step) && complete.step>=0 && digest(complete.manifest_sha256));
  assert.deepEqual(complete.files, {'checkpoint_selection.json':{size:37,sha256:hash('{"schema_version": 1, "kind": "best"}')}});
  const train = JSON.parse(record.approvedPlan);
  assert.equal(train.operation,'train'); assert.equal(train.run_id,proof.runId);
  assert.deepEqual(record.integrityPlans,[train]);
  durable(record.finalRegistry,proof.runId);
  assert.deepEqual(record.integrityBefore,record.finalRegistry);
  assert.deepEqual(record.integrityFrozenRegistry,record.finalRegistry);
  assert.equal(record.integrityFrozenAfterCleanup,true);
  assert(record.integrityInventories.length>0 && record.integrityInventories.length<=256);
  const inventory = record.integrityInventories[0];
  assert.equal(inventory.status,200); assert.equal(inventory.path,`/api/runs/${proof.runId}/artifacts`);
  assert.deepEqual(inventory.body.generations.map(item=>item.generation).sort(),[...proof.visibleGenerations].sort());
  const older = inventory.body.generations.find(item=>item.generation===proof.olderCompleteBest);
  assert.equal(older.attempt,proof.attempt);
  assert(older.files['training_meta.pkl'] && older.files['scaler.pkl']);
  assert(['model_weights.pth','model.safetensors','model.bin','pytorch_model.bin'].some(key=>older.files[key]));
  Object.values(older.files).forEach(identity);
  assert.deepEqual(inventory.body.generations.find(item=>item.generation===proof.partialGeneration).files,complete.files);
  const target = `/api/runs/${proof.runId}/artifacts/${proof.partialGeneration}/checkpoint_selection.json`;
  const wire = record.integrityWire;
  // Exact arrival/completion pair rules out older fetches, retries and uncompleted downloads.
  assert.equal(wire.length,2);
  assert.deepEqual(wire[0],{phase:'arrival',path:target});
  const response = wire[1];
  assert.equal(response.phase,'complete'); assert.equal(response.path,target);
  assert.equal(response.status,200); assert.equal(response.tampered,true);
  assert.deepEqual(response.original,complete.files['checkpoint_selection.json']);
  assert.deepEqual(response.published,response.original); assert.deepEqual(response.diskAfter,response.original);
  identity(response.wire); assert.equal(response.wire.size,response.original.size);
  const corrupted = Buffer.from('{"schema_version":\t1, "kind": "best"}');
  assert.equal(response.wire.sha256,hash(corrupted)); assert.notEqual(response.wire.sha256,response.original.sha256);
  assert.deepEqual(response.parsedOriginal,{schema_version:1,kind:'best'});
  assert.deepEqual(response.parsedWire,response.parsedOriginal);
  assert(record.integrityRequests.length>0 && record.integrityRequests.length<=8192);
  for (const request of record.integrityRequests) {
    assert(['GET','POST'].includes(request.method)); assert(Number.isInteger(request.status) && request.status>=200 && request.status<300);
    if (request.method==='POST') assert(['/api/runs/plan','/api/runs','/api/browse/resolve','/api/datasets/inspect'].includes(request.path));
  }
  for (const path of ['/api/runs/plan','/api/runs']) {
    const rows = record.integrityRequests.filter(item=>item.method==='POST' && item.path===path);
    assert.equal(rows.length,1); assert.equal(rows[0].scopeHeaderPresent,true);
  }
  assert.deepEqual(record.integrityReceipts,[{sequence:0,method:'POST',path:'/api/runs/plan'}]);
  const cleanup=record.cleanup; noFailure(cleanup); assert.deepEqual(cleanup.errors,[]);
  assert((cleanup.fixtureExit.code===0 && cleanup.fixtureExit.signal===null)||(cleanup.fixtureExit.code===null && cleanup.fixtureExit.signal==='SIGINT'));
  for (const key of ['browserSessionAbsent','fixtureServicesClosed','removedOwnedRoots','browserProfileRemoved','listenerClosed']) assert.equal(cleanup[key],true);
  for (const [key,value] of Object.entries(cleanup)) if (!['errors','fixtureExit'].includes(key)) assert.equal(value,true,key);
  return record;
}
async function bytes(path,limit=1048576) {
  path=resolve(path);
  for(let parent=dirname(path);parent!==dirname(parent);parent=dirname(parent)) {const info=await lstat(parent);assert(info.isDirectory()&&!info.isSymbolicLink());}
  const before=await lstat(path); assert(before.isFile()&&!before.isSymbolicLink()&&before.size>0&&before.size<=limit);
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const start=await file.stat();assert(start.dev===before.dev&&start.ino===before.ino&&start.size===before.size);
    const buffer=Buffer.alloc(limit+1);let length=0;
    while(length<buffer.length){const read=await file.read(buffer,length,buffer.length-length,null);if(!read.bytesRead)break;length+=read.bytesRead;}
    const end=await file.stat(),after=await lstat(path);
    assert(length===start.size&&length<=limit&&end.size===start.size&&end.mtimeMs===start.mtimeMs&&end.ctimeMs===start.ctimeMs&&after.dev===start.dev&&after.ino===start.ino&&after.size===start.size&&after.mtimeMs===start.mtimeMs&&after.ctimeMs===start.ctimeMs);
    return buffer.subarray(0,length);
  } finally {await file.close();}
}
const json=async path=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(path)));
export async function verifyAutoplotMetadataIntegrityReport(summaryPath) {
  summaryPath=resolve(summaryPath);const directory=dirname(summaryPath),summary=await json(summaryPath);
  noFailure(summary);assert.equal(summary.cases.length,1);const record=summary.cases[0];
  assert.equal(record.name,name);assert(typeof summary.browser==='string'&&summary.browser.length>0);
  assert.deepEqual((await readdir(directory)).sort(),[`${name}.json`,'summary.json'].sort());
  assert(Date.parse(summary.started)<=Date.parse(record.started)&&Date.parse(summary.finished)>=Date.parse(record.finished));
  const assets=fileURLToPath(new URL('../src/wavedl_daemon/web_assets/',import.meta.url));
  const manifest=await bytes(join(assets,'.wavedl-assets.json'));const map=JSON.parse(manifest);
  assert(Object.keys(map).length>20);
  for(const [path,expected] of Object.entries(map)) {
    assert(path.split('/').every(part=>part&&part!=='.'&&part!=='..')&&!/[\\:%]/.test(path)&&digest(expected));
    assert.equal(hash(await bytes(join(assets,path),16777216)),expected,'Frozen asset changed');
  }
  assert.deepEqual(await json(join(directory,`${name}.json`)),record);
  return verifyAutoplotMetadataIntegrityRecord(record,{assetHash:hash(manifest),browser:summary.browser,directory});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  await verifyAutoplotMetadataIntegrityReport(process.argv[2]);console.log('autoplot metadata integrity report: valid');
}
