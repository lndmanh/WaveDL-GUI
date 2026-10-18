import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm, mkdir, readFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import test from 'node:test';
import { verifyWizardProgression } from './browser_wizard_progression.mjs';
import { REPORT_NAME, readWizardEvidence, verifyWizardProgressionReport } from './verify_wizard_progression_browser_report.mjs';

function fixture() {
  const trainId='11111111-1111-4111-8111-111111111111', plotId='22222222-2222-4222-8222-222222222222';
  const run='33333333-3333-4333-8333-333333333333', plotRun='44444444-4444-4444-8444-444444444444';
  const control=(id,intent)=>({plan_id:id,submission_requested:intent,cancellation_requested:0});
  const execution=id=>({plan_id:id,observed_status:'terminal',cancel_delivered:0});
  const empty={plans:0,runs:[],control:[],executions:[]};
  const manifest={run_id:run,operation:'train',resolved_config:{epochs:3,model:'cnn',workers:0,precision:'no',batch_size:16,data_path:'/owned/samples.npz'},runtime:{python:'/owned/python',device:'cpu'}};
  const settled={plans:2,runs:[{run_id:run,state:'completed'},{run_id:plotRun,state:'completed'}],control:[control(trainId,1),control(plotId,1)],executions:[execution(trainId),execution(plotId)]};
  return {name:'wizard-progression',status:'passed',freshStorage:{local:[],session:[],cookies:''},driverReadinessMode:'sync-exposure-poll-and-two-controller-dom-observations',wizardInvalidDataset:{message:true,step:'1. Dataset'},wizardInvalidModel:{message:true,step:'2. Model'},wizardInvalidTraining:{message:true,step:'4. Training & runtime'},wizardReview:{step:'5. Review & approval',epochs:'3'},wizardAfterInvalidDataset:empty,wizardAfterInvalidModel:empty,wizardBeforeNavigation:empty,wizardAfterInvalidTraining:empty,wizardAfterNavigation:empty,wizardManifest:manifest,wizardSourceManifest:manifest,pythonInterpreter:'/owned/python',wizardPlanId:trainId,wizardPreviewRegistry:{plans:1,control:[control(trainId,0)],executions:[]},wizardSubmitted:{plans:1,control:[control(trainId,1)],executions:[execution(trainId)]},wizardAcknowledged:{disabled:true,runId:run},wizardSettled:settled,finalRegistry:settled,wizardDurablePlans:[{planId:trainId,manifest},{planId:plotId,manifest:{operation:'plot',run_id:plotRun,checkpoint_source:{run_id:run}}}],cleanup:{errors:[],browserSessionAbsent:true,fixtureServicesClosed:true,listenerClosed:true,browserProfileRemoved:true,removedOwnedRoots:true,fixtureExit:{code:null,signal:'SIGINT'}}};
}
test('accepts exact guided progression and owned completion',()=>verifyWizardProgression(fixture()));
for (const [name,mutate] of [
  ['invalid advancement',r=>r.wizardInvalidTraining.step='5. Review'],
  ['hidden acknowledgement',r=>r.wizardAcknowledged.disabled=false],
  ['extra execution',r=>r.wizardSettled.executions.push({plan_id:'foreign'})],
  ['foreign automatic plot',r=>r.wizardDurablePlans[1].manifest.checkpoint_source.run_id='foreign'],
  ['foreign source',r=>r.wizardSourceManifest={run_id:'foreign'}],
  ['changed runtime',r=>r.pythonInterpreter='/different/python'],
  ['early intent',r=>r.wizardPreviewRegistry.control[0].submission_requested=1],
  ['invalid plan',r=>r.wizardAfterInvalidTraining.plans=1],
  ['duplicate plans',r=>r.wizardSettled.plans=3],
  ['failed cleanup',r=>r.cleanup.listenerClosed=false],
  ['retained failure',r=>r.shutdownError='failed'],
  ['fixture assets',r=>r.explicitFixtureWebAssets='/foreign'],
  ['skip flag',r=>r.skipped=true],
  ['nonboolean validation',r=>r.wizardInvalidDataset.message='true'],
]) test(`rejects ${name}`,()=>{const value=structuredClone(fixture());mutate(value);assert.throws(()=>verifyWizardProgression(value));});
test('bounded reader rejects oversized, invalid UTF8, file and ancestor symlinks',async()=>{
  const root=await mkdtemp(join('/private/tmp','wavedl-wizard-reader-'));
  try {
    const file=join(root,'record');
    await writeFile(file,Buffer.alloc(256*1024+1)); await assert.rejects(readWizardEvidence(file));
    await writeFile(file,Buffer.from([0xff])); await assert.rejects(readWizardEvidence(file));
    await writeFile(file,'{}'); assert.equal(await readWizardEvidence(file),'{}');
    await symlink(file,join(root,'link')); await assert.rejects(readWizardEvidence(join(root,'link')));
    await mkdir(join(root,'real')); await writeFile(join(root,'real','item'),'{}');
    await symlink(join(root,'real'),join(root,'parent')); await assert.rejects(readWizardEvidence(join(root,'parent','item')));
  } finally { await rm(root,{recursive:true,force:true}); }
});
test('full report verifies current assets and rejects stale hash, malformed bytes and extra files',async()=>{
  const root=await mkdtemp(join('/private/tmp','wavedl-wizard-file-'));
  try {
    const value=fixture(),path=join(root,REPORT_NAME);
    value.assetManifestSha256=createHash('sha256').update(await readFile(new URL('../src/wavedl_daemon/web_assets/.wavedl-assets.json',import.meta.url))).digest('hex');
    await writeFile(path,JSON.stringify(value)); await verifyWizardProgressionReport(root);
    await writeFile(join(root,'extra'),'{}'); await assert.rejects(verifyWizardProgressionReport(root)); await unlink(join(root,'extra'));
    value.assetManifestSha256='0'.repeat(64); await writeFile(path,JSON.stringify(value)); await assert.rejects(verifyWizardProgressionReport(root));
    await writeFile(path,Buffer.from([0xff])); await assert.rejects(verifyWizardProgressionReport(root));
  } finally { await rm(root,{recursive:true,force:true}); }
});
