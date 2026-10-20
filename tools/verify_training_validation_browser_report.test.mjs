import test from "node:test";
import assert from "node:assert/strict";
import { validationInputs, verifyTrainingValidationRecord } from "./verify_training_validation_browser_report.mjs";
import { readFileSync } from "node:fs";
const defaults = Object.fromEntries(JSON.parse(readFileSync(
  new URL("../web/shared/training-options.json", import.meta.url), "utf8")).map(option =>
  [option.name, option.default]));
const empty = {plans:0,runs:[],control:[],submissions:[],executions:[]};
function fixture() {
  const python = "/fixture/python";
  const assets = Object.fromEntries(Array.from({length:37},(_,i)=>["asset"+i,"a".repeat(64)]));
  const baseline = {plans:1,runs:[],submissions:[],executions:[],control:[
    {plan_id:"11111111-1111-4111-8111-111111111111",submission_requested:0,cancellation_requested:0}]};
  const state = {...structuredClone(baseline),plans:2};
  state.control.push({plan_id:"33333333-3333-4333-8333-333333333333",submission_requested:0,cancellation_requested:0});
  const config = {...defaults,model:"cnn",data_path:"/fixture/samples.npz",batch_size:8,lr:0.003,
    workers:0,cv:0,compile:false,nesterov:false,momentum:0.9,scheduler:"plateau",
    scheduler_factor:0.5,precision:"no",epochs:10000,patience:10000,seed:42,weight_decay:0.0001,
    optimizer:"sgd"};
  const manifest = {run_id:"22222222-2222-4222-8222-222222222222",
    resolved_config:{...config,output_dir:"/fixture/runs/22222222-2222-4222-8222-222222222222"},runtime:{python}};
  const request = {config,runtime:{python,device:"cpu",mode:"existing"}};
  const originalRow = [baseline.control[0].plan_id,JSON.stringify(request),JSON.stringify({manifest_json:JSON.stringify(manifest)})];
  const recoveredManifest = {...manifest,run_id:"44444444-4444-4444-8444-444444444444",
    resolved_config:{...manifest.resolved_config,cv:2,output_dir:"/fixture/runs/44444444-4444-4444-8444-444444444444"}};
  return {
    name:"training-validation",status:"passed",pythonInterpreter:python,assetManifestSha256:"b".repeat(64),
    selectedDatasetPath:"/fixture/samples.npz",
    trainingValidation:{
      schemaVersion:2,
      cvResumeRefusal:{version:1,cv:2,selector:"/fixture/private-resume-checkpoint.pth",
        observed:{id:"resume-field",value:"/fixture/private-resume-checkpoint.pth",invalid:"true",
          error:"Cross-validation does not support nondefault --resume."},
        corrected:{id:"resume-field",value:"",invalid:"false",error:""},pathDisclosed:false,
        beforeState:structuredClone(empty),afterState:structuredClone(empty),
        beforeReceiptCount:0,afterReceiptCount:0},
      cvResumeRecovery:{version:1,planId:state.control[1].plan_id,
        request:{...request,config:{...config,cv:2}},approvedManifest:recoveredManifest,
        persistedManifest:structuredClone(recoveredManifest),beforeState:baseline,afterState:state,
        beforeReceiptCount:4,afterReceiptCount:5,originalPlanRow:originalRow,preservedPlanRow:[...originalRow]},
      standaloneExport:{environmentOmitted:true,environmentRefusal:true,topologyRefusal:true,
        beforeState:structuredClone(empty),afterState:structuredClone(empty),
        beforeReceiptCount:0,afterReceiptCount:0,
        environmentDownload:{filename:"training-validation-environment.yaml",bytes:100,
          config:{...config}}},
      invalid:validationInputs.map(([name,value,correction],i)=>({
        name,value,submitted:false,ariaInvalid:"true",error:"Validation error",
        observed:{id:"field-"+i,invalid:"true",value,error:"Validation error"},
        corrected:{id:"field-"+i,invalid:"false",value:correction??python,error:""},
        beforePlans:0,afterPlans:0,beforeReceiptCount:0,afterReceiptCount:0,
        beforeState:structuredClone(empty),afterState:structuredClone(empty),
      })),
      unsupported:[["Runtime mode","bundled"],["Runtime mode","container"],["Device","mps"]]
        .map(([label,value],i)=>({label,value,beforeReceiptCount:i,afterReceiptCount:i+1,
          beforeState:structuredClone(empty),afterState:structuredClone(empty),refusalVisible:true})),
      beforeState:structuredClone(empty),afterState:state,planId:"11111111-1111-4111-8111-111111111111",
      approvedManifest:manifest,persistedManifest:structuredClone(manifest),
        request,
      successfulPreview:true,finalReceiptCount:5,beforeAssets:assets,afterAssets:{...assets},
      postAssetManifestSha256:"b".repeat(64),
    },
    trainingValidationRequests:[
      {method:"POST",path:"/api/browse/resolve",status:200,scopeHeaderPresent:true,cursor:{}},
      {method:"POST",path:"/api/datasets/inspect",status:200,scopeHeaderPresent:true,cursor:{}},
      ...[400,400,400,200,200].map(status=>({method:"POST",path:"/api/runs/plan",status,scopeHeaderPresent:true,cursor:{}}))],
    trainingValidationReceipts:[0,1,2,3,4].map(sequence=>({sequence,method:"POST",path:"/api/runs/plan"})),
    trainingValidationRequestsFrozenAfterCleanup:true,finalRegistry:state,
    cleanup:{errors:[],browserSessionAbsent:true,fixtureServicesClosed:true,
      browserProfileRemoved:true,removedOwnedRoots:true,fixtureExit:{code:0,signal:null}},
  };
}
test("complete production-shaped validation evidence is accepted",()=>{
  assert.doesNotThrow(()=>verifyTrainingValidationRecord(fixture()));
});
for (const phase of ['empty', 'one-plan', 'two-plan']) {
  for (const fault of ['missing', 'allocated']) test(`rejects ${fault} ${phase} submission evidence`, () => {
    const record = fixture();
    const state = phase === 'empty'
      ? record.trainingValidation.cvResumeRefusal.beforeState
      : phase === 'one-plan'
        ? record.trainingValidation.cvResumeRecovery.beforeState
        : record.trainingValidation.afterState;
    if (fault === 'missing') delete state.submissions;
    else state.submissions.push({ plan_id: 'unowned-submission' });
    assert.throws(() => verifyTrainingValidationRecord(record));
  });
}
const tampers = {
  missingRecovery:r=>delete r.trainingValidation.cvResumeRecovery,
  recoveryWrongCv:r=>r.trainingValidation.cvResumeRecovery.request.config.cv=0,
  recoveryResume:r=>r.trainingValidation.cvResumeRecovery.request.config.resume="private",
  recoveryApproval:r=>r.trainingValidation.cvResumeRecovery.approvedManifest={},
  recoveryExecution:r=>r.trainingValidation.cvResumeRecovery.afterState.executions.push({}),
  recoverySubmitted:r=>r.trainingValidation.cvResumeRecovery.afterState.control[1].submission_requested=1,
  recoveryCancelled:r=>r.trainingValidation.cvResumeRecovery.afterState.control[1].cancellation_requested=1,
  recoveryMissingReceipt:r=>r.trainingValidation.cvResumeRecovery.afterReceiptCount=4,
  recoveryOriginalChanged:r=>r.trainingValidation.cvResumeRecovery.preservedPlanRow[1]="{}",
  recoverySamePlan:r=>r.trainingValidation.cvResumeRecovery.planId=r.trainingValidation.planId,
  recoveryWrongConfig:r=>r.trainingValidation.cvResumeRecovery.persistedManifest.resolved_config.cv=0,
  oldSchema:r=>delete r.trainingValidation.schemaVersion,
  missingCvResume:r=>delete r.trainingValidation.cvResumeRefusal,
  wrongResumeVersion:r=>r.trainingValidation.cvResumeRefusal.version=0,
  wrongCv:r=>r.trainingValidation.cvResumeRefusal.cv=0,
  foreignResume:r=>r.trainingValidation.cvResumeRefusal.selector="/foreign/checkpoint",
  disclosedResume:r=>r.trainingValidation.cvResumeRefusal.pathDisclosed=true,
  noResumeError:r=>r.trainingValidation.cvResumeRefusal.observed.error="",
  wrongResumeError:r=>r.trainingValidation.cvResumeRefusal.observed.error="Invalid path",
  validResume:r=>r.trainingValidation.cvResumeRefusal.observed.invalid="false",
  wrongResumeValue:r=>r.trainingValidation.cvResumeRefusal.observed.value="",
  newResumeRequest:r=>r.trainingValidation.cvResumeRefusal.afterReceiptCount=1,
  newResumePlan:r=>r.trainingValidation.cvResumeRefusal.afterState.plans=1,
  newResumeExecution:r=>r.trainingValidation.cvResumeRefusal.afterState.executions.push({}),
  newResumeControl:r=>r.trainingValidation.cvResumeRefusal.afterState.control.push({}),
  resumeNotCleared:r=>r.trainingValidation.cvResumeRefusal.corrected.value="private",
  resumeStillInvalid:r=>r.trainingValidation.cvResumeRefusal.corrected.invalid="true",
  changedResumeControl:r=>r.trainingValidation.cvResumeRefusal.corrected.id="other",
  resumeRetainedError:r=>r.trainingValidation.cvResumeRefusal.corrected.error="Still invalid",
  missingExportSafety:r=>delete r.trainingValidation.standaloneExport,
  environmentNotOmitted:r=>r.trainingValidation.standaloneExport.environmentOmitted=false,
  environmentNotRefused:r=>r.trainingValidation.standaloneExport.environmentRefusal=false,
  topologyNotRefused:r=>r.trainingValidation.standaloneExport.topologyRefusal=false,
  exportCreatedPlan:r=>r.trainingValidation.standaloneExport.afterState.plans++,
  exportRequestedPlan:r=>r.trainingValidation.standaloneExport.afterReceiptCount++,
  absentYaml:r=>r.trainingValidation.standaloneExport.environmentDownload.bytes=0,
  exportLeaksEnvironment:r=>r.trainingValidation.standaloneExport.environmentDownload.config.environment={secret:"browser-secret-probe"},
  exportLeaksSecret:r=>r.trainingValidation.standaloneExport.environmentDownload.config.run_name="browser-secret-probe",
  wrongExportDataset:r=>r.trainingValidation.standaloneExport.environmentDownload.config.data_path="/foreign",
  missingCase:r=>r.trainingValidation.invalid.pop(),
  substitutedInput:r=>r.trainingValidation.invalid[1].value="0",
  wrongNativeId:r=>r.trainingValidation.invalid[0].corrected.id="foreign",
  unclearedError:r=>r.trainingValidation.invalid[0].corrected.error="Still invalid",
  wrongCorrection:r=>r.trainingValidation.invalid[0].corrected.value="0",
  noVisibleError:r=>r.trainingValidation.invalid[0].observed.error="",
  unexpectedClientRequest:r=>r.trainingValidation.invalid[0].afterReceiptCount++,
  mutatedClientState:r=>r.trainingValidation.invalid[0].afterState.plans++,
  backendCreatedRun:r=>r.trainingValidation.unsupported[0].afterState.runs.push({}),
  noBackendRefusal:r=>r.trainingValidation.unsupported[0].refusalVisible=false,
  skeletalReceipts:r=>r.trainingValidationReceipts=[{},{},{},{}],
  duplicateReceipt:r=>r.trainingValidationReceipts[1].sequence=0,
  missingReceipt:r=>r.trainingValidationReceipts.pop(),
  lateMutation:r=>r.trainingValidationRequests.push({method:"DELETE",path:"/api/runs/x",status:200}),
  wrongStatus:r=>r.trainingValidationRequests[2].status=200,
  unfrozen:r=>r.trainingValidationRequestsFrozenAfterCleanup=false,
  extraExecution:r=>r.trainingValidation.afterState.executions.push({}),
  submitted:r=>r.trainingValidation.afterState.control[0].submission_requested=1,
  failedCleanup:r=>r.cleanup.browserSessionAbsent=false,
  badExit:r=>r.cleanup.fixtureExit.code=73,
  changedAssets:r=>r.trainingValidation.afterAssets.asset0="c".repeat(64),
  missingAsset:r=>delete r.trainingValidation.beforeAssets.asset0,
  staleManifest:r=>r.trainingValidation.postAssetManifestSha256="c".repeat(64),
  changedInterpreter:r=>r.trainingValidation.request.runtime.python="/other/python",
  changedDataset:r=>r.trainingValidation.persistedManifest.resolved_config.data_path="/other",
  alteredPersistedConfig:r=>r.trainingValidation.request.config={model:"other"},
  mismatchedSeed:r=>r.trainingValidation.request.config.seed=999,
  emptyPlan:r=>r.trainingValidation.planId="",
  emptyInterpreter:r=>{r.pythonInterpreter="";r.trainingValidation.request.runtime.python="";},
  noScope:r=>r.trainingValidationRequests[2].scopeHeaderPresent=false,
  missingReadonly:r=>r.trainingValidationRequests.shift(),
  duplicateReadonly:r=>r.trainingValidationRequests.splice(1,0,{...r.trainingValidationRequests[0]}),
  wrongReadonlyPath:r=>r.trainingValidationRequests[0].path="/api/catalog/delete",
  wrongReadonlyStatus:r=>r.trainingValidationRequests[0].status=400,
  wrongReadonlyScope:r=>r.trainingValidationRequests[0].scopeHeaderPresent=false,
  wrongReadonlyMethod:r=>r.trainingValidationRequests[0].method="DELETE",
  wrongReadonlyCursor:r=>r.trainingValidationRequests[0].cursor={attempt:"1"},
  authoredOutputDir:r=>r.trainingValidation.request.config.output_dir="/authoritative",
  extraResolvedKey:r=>r.trainingValidation.persistedManifest.resolved_config.foreign=true,
  incorrectManagedPath:r=>r.trainingValidation.persistedManifest.resolved_config.output_dir="/foreign/runs",
  managedIdentityMismatch:r=>r.trainingValidation.persistedManifest.run_id="33333333-3333-4333-8333-333333333333",
  appendedDeleteResolve:r=>r.trainingValidationRequests.push(
    {method:"DELETE",path:"/api/browse/resolve",status:200}),
  appendedDeleteInspect:r=>r.trainingValidationRequests.push(
    {method:"DELETE",path:"/api/datasets/inspect",status:200}),
  appendedPatchResolve:r=>r.trainingValidationRequests.push(
    {method:"PATCH",path:"/api/browse/resolve",status:200}),
  appendedPutInspect:r=>r.trainingValidationRequests.push(
    {method:"PUT",path:"/api/datasets/inspect",status:200}),
  appendedOptionsResolve:r=>r.trainingValidationRequests.push(
    {method:"OPTIONS",path:"/api/browse/resolve",status:200}),
};
for (const key of Object.keys(defaults))
  tampers["mismatchedConfig-"+key] = r => {
    r.trainingValidation.request.config[key] = {invalid:"field mismatch"};
  };
for(const [name,mutate] of Object.entries(tampers)) test("rejects "+name,()=>{
  const r=fixture(); mutate(r); assert.throws(()=>verifyTrainingValidationRecord(r));
});
