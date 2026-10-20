import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { verifyKeyboardRecord, verifyKeyboardFile, keyboardFailureCategory } from './verify_keyboard_browser_report.mjs';

const observed = name => ({ name, id: name, visible: true, focusVisible: true, withinConfirmation: true });
const empty = { plans: 0, runs: 0, plan_control: 0, execution_control: 0, submission_control: 0 };
function valid() {
  return { name: 'keyboard-browser', status: 'passed', browser: 'agent-browser 0.26.0',
    scope: 'Native keyboard-only local form and inline reset confirmation; no modal exists in these active surfaces; not blanket accessibility or remote certification',
    started: '2026-10-20T00:00:00Z', finished: '2026-10-20T00:01:00Z', assetManifestSha256: 'a'.repeat(64),
    freshStorage: { local: [], session: [], cookies: '' },
    actions: ['Tab','Enter','Tab','Enter','Tab','Enter','Tab','ControlOrMeta+a','0','Tab','Shift+Tab','1','7','Tab','Enter','Escape'].map(key => ({ command: 'press', key })),
    checkpoints: ['connected','invalid-guided-next','dataset-model-selected','invalid-field-corrected','keep-draft'].map(stage => ({ stage, registry: { ...empty } })),
    visits: ['New training run','Next step','Configured root','Select file samples.npz','Choose CNN','Show full editor','epochs','Reset training defaults','Confirm reset'].map(target => ({target,...observed(target)})),
    rootTrigger:observed('Configured root'),rootPopupOpen:{listboxes:1,expanded:'true'},rootPopupClosed:true,rootPopupReturn:observed('Configured root'),
    selectedDataset:'Dataset: /owned/samples.npz',selectedModel:'Model: cnn',
    missingDataset: { alert: true, step: '1. Dataset' }, invalidField: {label:'epochs',value:'0',invalid:'true',description:'Must be positive',errorRole:'alert',errorVisible:true,describedBy:null,visible:true},
    reverseTraversal: {afterTab:observed('patience'),returned:observed('epochs')}, correctedField: {value:'17',invalid:'false'},
    confirmationOpened:{present:true,modals:0,epochs:'17'},afterEscape:{present:true,modals:0,epochs:'17'},confirmationDismissed:{present:false,modals:0,epochs:'17'},
    confirmFocus:observed('Confirm reset'),keepDraftFocus:observed('Keep draft'),reverseConfirmationFocus:observed('Confirm reset'),
    returnedToReset:observed('Reset training defaults'),cleanup:{errors:[],browserSessionAbsent:true,servicesClosed:true,fixtureReaped:true,listenerClosed:true,ownedRootsRemoved:true},
    limitations:{modalDialogsExercised:false,noPlanApprovalOrTraining:true,confirmationKind:'inline; no focus trap',fieldErrorAssociation:'no aria-describedby association'},
    fixtureDiagnostic:{spawnFailed:false,reaped:true,stderrObserved:false},
  };
}
test('accepts bounded native keyboard form/inline confirmation scope', () => verifyKeyboardRecord(valid()));
test('accepts actual improved error association without making absence a requirement', () => {
  const record = valid();
  record.invalidField.describedBy = 'epochs-error';
  record.limitations.fieldErrorAssociation = 'Recorded actual aria-describedby attribute; no assistive-technology certification';
  verifyKeyboardRecord(record);
});
for (const [name, mutate] of [
  ['failed',r=>r.status='failed'],['error',r=>r.error='failure'],['skip',r=>r.skipped=true],
  ['mouse action',r=>r.actions.push({command:'click',key:'Enter'})],
  ['missing Escape',r=>r.actions=r.actions.filter(a=>a.key!=='Escape')],
  ['missing traversal target',r=>r.visits.pop()],['invisible focus',r=>r.visits[0].focusVisible=false],
  ['missing visible invalid feedback',r=>r.invalidField.description=''],['uncorrected field',r=>r.correctedField.invalid='true'],
  ['lost ShiftTab',r=>r.reverseTraversal.returned.name='elsewhere'],['submitted plan',r=>r.checkpoints[1].registry.plans=1],
  ['missing registry boundary',r=>r.checkpoints.pop()],['invisible confirmation focus',r=>r.confirmFocus.visible=false],
  ['missing field announcement',r=>r.invalidField.errorRole=null],['wrong field label',r=>r.invalidField.label='another'],
  ['popup Escape focus lost',r=>r.rootPopupReturn.id='elsewhere'],['popup left open',r=>r.rootPopupClosed=false],
  ['popup never expanded',r=>r.rootPopupOpen.expanded='false'],['missing trigger identity',r=>r.rootTrigger.id=''],
  ['modal claim',r=>r.confirmationOpened.modals=1],['Escape destroys draft',r=>r.afterEscape.epochs='3'],
  ['Keep draft resets values',r=>r.confirmationDismissed.epochs='3'],['confirmation never dismissed',r=>r.confirmationDismissed.present=true],
  ['cleanup incomplete',r=>r.cleanup.servicesClosed=false],['wrong browser',r=>r.browser='agent-browser 9.0'],
]) test(`rejects ${name}`,()=>{const r=valid();mutate(r);assert.throws(()=>verifyKeyboardRecord(r));});
test('file verification is bounded, nofollow and current-asset-bound',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'wavedl-keyboard-guard-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'report.json'),r=valid();
  r.assetManifestSha256=createHash('sha256').update(await readFile(new URL('../src/wavedl_daemon/web_assets/.wavedl-assets.json',import.meta.url))).digest('hex');
  await writeFile(path,JSON.stringify(r));await verifyKeyboardFile(path);
  const link=join(dir,'link');await symlink(path,link);await assert.rejects(verifyKeyboardFile(link));
  r.assetManifestSha256='0'.repeat(64);await writeFile(path,JSON.stringify(r));await assert.rejects(verifyKeyboardFile(path));
  await writeFile(path,'x'.repeat(256*1024+1));await assert.rejects(verifyKeyboardFile(path));
});
test('runner uses keyboard commands and read-only DOM inspection, no bypass mutation',async()=>{
  const source=await readFile(new URL('./run_keyboard_browser_acceptance.mjs',import.meta.url),'utf8');
  assert(source.includes("await press('Shift+Tab')"));assert(source.includes("await press('Escape')"));
  assert(!/cli\(\['(?:click|fill|focus|mouse)'/.test(source));
  assert(!/dispatchEvent|\.focus\(|\.click\(|setAttribute|localStorage\.setItem/.test(source));
  assert(source.includes("assert(!process.env.WAVEDL_BROWSER_ASSETS"));
});

test('runner refuses insecure and symlink report roots before launching services', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'wavedl-keyboard-paths-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const insecure = join(directory, 'insecure');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(insecure, { mode: 0o755 });
  const runner = new URL('./run_keyboard_browser_acceptance.mjs', import.meta.url);
  assert.throws(() => execFileSync(process.execPath, [runner.pathname, insecure], { stdio: 'pipe' }));
  const link = join(directory, 'linked');
  await symlink(insecure, link);
  assert.throws(() => execFileSync(process.execPath, [runner.pathname, link], { stdio: 'pipe' }));
});

test('failure diagnostics never retain bearer, bootstrap URL, argv or private paths', () => {
  const message = 'http://127.0.0.1:8420/?bootstrap=single-use-secret bearer-private /private/user/token';
  const error = Object.assign(new Error(message), { code: 'ERR_ASSERTION' });
  assert.equal(keyboardFailureCategory(error), 'assertion');
  assert.equal(keyboardFailureCategory(new Error(message)), 'operation-failed');
  assert(!JSON.stringify({ category: keyboardFailureCategory(error) }).includes('secret'));
});
