#!/usr/bin/env node
// Native keyboard input only after opening an owned, fresh browser profile.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, access, lstat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import { boundedCommand } from './browser_process.mjs';
import { browserLaunchArgs, browserTemporaryEnvironment } from './browser_launch_policy.mjs';
import { verifyKeyboardRecord, keyboardFailureCategory } from './verify_keyboard_browser_report.mjs';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const python = process.env.WAVEDL_PYTHON ?? 'python';
const browser = process.env.AGENT_BROWSER_BIN ?? 'agent-browser';
assert(!process.env.WAVEDL_BROWSER_ASSETS, 'Keyboard acceptance requires current vendored assets');
const browserVersion = (await boundedCommand(browser, ['--version'], {
  cwd: repo,
  timeout: 10000,
})).trim();
const requestedDirectory = resolve(process.argv[2] ?? await mkdtemp(join(tmpdir(), 'wavedl-keyboard-')));
const requestedStat = await lstat(requestedDirectory);
assert(requestedStat.isDirectory() && !requestedStat.isSymbolicLink(), 'Require an existing non-symlink report directory');
assert.equal(requestedStat.mode & 0o777, 0o700, 'Require private report-directory permissions');
assert.equal(requestedStat.uid, process.getuid(), 'Require user-owned report directory');
const directory = await realpath(requestedDirectory);
assert.deepEqual(await readdir(directory), [], 'Require empty owned report directory');
const root = join(directory, 'fixture');
const profile = join(directory, 'profile');
const tokenFile = join(directory, '.token');
await mkdir(root, { mode: 0o700 });
await mkdir(profile, { mode: 0o700 });
const token = randomBytes(32).toString('base64url');
await writeFile(tokenFile, token, { mode: 0o600, flag: 'wx' });
const ownedIdentities = new Map(await Promise.all([directory, root, profile, tokenFile].map(async path => [path, await lstat(path)])));
const session = `wave-keys-${randomUUID().slice(0, 8)}`;
const record = {
  name: 'keyboard-browser',
  status: 'running',
  scope: 'Native keyboard-only local form and inline reset confirmation; no modal exists in these active surfaces; not blanket accessibility or remote certification',
  started: new Date().toISOString(),
  browser: browserVersion,
  assetManifestSha256: createHash('sha256').update(await readFile(join(repo, 'src/wavedl_daemon/web_assets/.wavedl-assets.json'))).digest('hex'),
  actions: [],
  checkpoints: [],
  visits: [],
  stage: 'fixture-startup',
};
const child = spawn(python, ['tools/browser_daemon_fixture.py', '--root', root, '--unseeded', '--token-file', tokenFile],
  { cwd: repo, env: { ...process.env, PYTHONPATH: join(repo, 'src'), OMP_NUM_THREADS: '1', MKL_NUM_THREADS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '';
let spawnFailed = false;
let opened = false;
let origin;
let stderrBytes = 0;
child.on('error', () => { spawnFailed = true; });
child.stdout.on('data', b => { stdout = (stdout + b).slice(-1024 * 1024); });
child.stderr.on('data', bytes => { stderrBytes = Math.min(1024 * 1024, stderrBytes + bytes.length); });
const until = async (predicate, timeout, message) => {
  const deadline = Date.now() + timeout;
  while (!await predicate()) {
    assert(Date.now() < deadline, message);
    await new Promise(r => setTimeout(r, 100));
  }
};
const cli = (args, input) => {
  record.stage = args[0] === 'eval' ? 'read-only-observation'
    : args[0] === 'press' ? 'native-keyboard'
      : args[0] === 'wait' ? 'public-readiness'
        : args[0] === 'close' ? 'browser-cleanup' : 'browser-open';
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('AGENT_BROWSER_')) delete env[key];
  env.AGENT_BROWSER_SESSION = session;
  return boundedCommand(browser, ['--session', session, ...(args[0] === 'open' ? ['--args', browserLaunchArgs] : []), ...args],
    { cwd: repo, timeout: 35000, env: browserTemporaryEnvironment(env), input });
};
const dom = async expression => JSON.parse(JSON.parse(await cli(['eval', '--stdin'], expression)));
const press = async key => {
  record.actions.push({ command: 'press', key });
  await cli(['press', key]);
};
const focus = () => dom(`JSON.stringify((() => {
  const e = document.activeElement;
  const r = e?.getBoundingClientRect();
  const s = e ? getComputedStyle(e) : null;
  return {
    tag: e?.tagName ?? '', id: e?.id ?? '', role: e?.getAttribute('role') ?? '',
    name: e?.getAttribute('aria-label') ?? (e?.labels?.length
      ? Array.from(e.labels).map(x => x.textContent.trim()).join(' ')
      : e?.textContent?.trim().slice(0, 100) ?? ''),
    value: e?.value ?? null, visible: !!r && r.width > 0 && r.height > 0,
    focusVisible: !!e?.matches(':focus-visible'), outline: s?.outlineStyle ?? '',
    withinConfirmation: !!e?.closest('[role="group"][aria-label="Confirm reset"]')
  };
})())`);
async function tabTo(name, tag, max = 120) {
  for (let index = 0; index < max; index++) {
    const observation = await focus();
    if (observation.name === name && (!tag || observation.tag === tag)) {
      assert(observation.visible, 'Keyboard target must be visible');
      record.visits.push({ target: name, ...observation });
      return observation;
    }
    await press('Tab');
  }
  throw Error(`Keyboard traversal did not reach ${name}`);
}
async function checkpoint(stage) {
  record.stage = stage;
  const script = `import json,sqlite3,sys
from pathlib import Path
c=sqlite3.connect((Path(sys.argv[1])/'state'/'registry.db').resolve().as_uri()+'?mode=ro',uri=True)
c.execute('BEGIN')
print(json.dumps({t:c.execute('SELECT count(*) FROM '+t).fetchone()[0] for t in ['plans','runs','plan_control','execution_control','submission_control']}))`;
  const registry = JSON.parse(await boundedCommand(python, ['-c', script, root], { cwd: repo, timeout: 10000 }));
  assert(Object.values(registry).every(n => n === 0), 'Keyboard probe must create no plan or execution');
  record.checkpoints.push({ stage, registry });
}
const inline = () => dom(`JSON.stringify({present:!!document.querySelector('[role="group"][aria-label="Confirm reset"]'),modals:Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"],[aria-modal="true"]')).filter(e=>e.getClientRects().length).length,epochs:Array.from(document.querySelectorAll('input')).find(e=>e.labels?.[0]?.textContent.trim()==='epochs')?.value??null})`);
try {
  await until(() => {
    assert(!spawnFailed && child.exitCode === null, 'Fixture startup failed');
    return stdout.includes('Browser: ');
  }, 180000, 'Fixture startup timed out');
  const url = stdout.match(/Browser: (http:\/\/[^\s]+)/)[1];
  origin = new URL(url).origin;
  opened = true;
  await cli(['open', '--headed', 'false', '--engine', 'chrome', '--profile', profile, '--allowed-domains', '127.0.0.1,localhost', url]);
  await cli(['wait', '--text', 'Connected']);
  record.freshStorage = await dom(`JSON.stringify({local:Object.keys(localStorage),session:Object.keys(sessionStorage),cookies:document.cookie})`);
  await checkpoint('connected');
  await tabTo('New training run', 'BUTTON');
  await press('Enter');
  await cli(['wait', '--text', 'Next step']);
  await tabTo('Next step', 'BUTTON');
  await press('Enter');
  await cli(['wait', '--text', 'Choose a dataset from the current daemon.']);
  record.missingDataset = await dom(`JSON.stringify({alert:Array.from(document.querySelectorAll('[role="alert"]')).some(e=>e.textContent.includes('Choose a dataset from the current daemon.')),step:document.querySelector('[aria-current="step"]')?.textContent.trim()})`);
  await checkpoint('invalid-guided-next');
  await tabTo('Configured root');
  record.rootTrigger = await focus();
  await press('Enter');
  await cli(['wait', '--fn', `!!document.querySelector('[role="listbox"]')`]);
  record.rootPopupOpen = await dom(`JSON.stringify({listboxes:Array.from(document.querySelectorAll('[role="listbox"]')).filter(e=>e.getClientRects().length).length,expanded:document.getElementById(${JSON.stringify(record.rootTrigger.id)})?.getAttribute('aria-expanded')??null})`);
  await press('Escape');
  record.rootPopupReturn = await focus();
  record.rootPopupClosed = await dom(`JSON.stringify(!Array.from(document.querySelectorAll('[role="listbox"]')).some(e=>e.getClientRects().length))`);
  await press('Enter');
  await cli(['wait', '--fn', `!!document.querySelector('[role="option"]')`]);
  await press('d');
  await press('Enter');
  await cli(['wait', '--text', 'samples.npz']);
  await tabTo('Select file samples.npz', 'BUTTON');
  await press('Enter');
  await cli(['wait', '--fn', `Array.from(document.querySelectorAll('p')).some(e=>e.textContent.includes('Dataset: ')&&e.textContent.includes('/samples.npz'))`]);
  record.selectedDataset = await dom(`JSON.stringify(Array.from(document.querySelectorAll('p')).find(e=>e.textContent.includes('Dataset: ')&&e.textContent.includes('/samples.npz'))?.textContent.trim())`);
  await tabTo('Next step', 'BUTTON');
  await press('Enter');
  await cli(['wait', '--text', 'Choose CNN']);
  await tabTo('Choose CNN', 'BUTTON');
  await press('Enter');
  record.selectedModel = await dom(`JSON.stringify(Array.from(document.querySelectorAll('p')).find(e=>e.textContent.includes('Model: cnn'))?.textContent.trim())`);
  await checkpoint('dataset-model-selected');
  await tabTo('Show full editor', 'BUTTON');
  await press('Enter');
  await cli(['wait', '--text', 'Reset training defaults']);
  await tabTo('epochs', 'INPUT');
  await press('ControlOrMeta+a');
  await press('0');
  await press('Tab');
  await cli(['wait', '--fn', `Array.from(document.querySelectorAll('input')).some(e=>e.labels?.[0]?.textContent.trim()==='epochs'&&e.getAttribute('aria-invalid')==='true')`]);
  record.invalidField = await dom(`JSON.stringify((() => {
    const e = Array.from(document.querySelectorAll('input')).find(e => e.labels?.[0]?.textContent.trim() === 'epochs');
    const error = e.closest('[data-slot="field"]')?.querySelector('[data-slot="field-error"]');
    return {
      label: e.labels?.[0]?.textContent.trim(), value: e.value,
      invalid: e.getAttribute('aria-invalid'), description: error?.textContent.trim() ?? '',
      errorRole: error?.getAttribute('role') ?? null, errorVisible: !!error?.getClientRects().length,
      describedBy: e.getAttribute('aria-describedby'), visible: e.getClientRects().length > 0
    };
  })())`);
  const afterTab = await focus();
  await press('Shift+Tab');
  record.reverseTraversal = { afterTab, returned: await focus() };
  assert.equal(record.reverseTraversal.returned.name, 'epochs');
  await press('ControlOrMeta+a');
  await press('1');
  await press('7');
  await press('Tab');
  await cli(['wait', '--fn', `Array.from(document.querySelectorAll('input')).some(e=>e.labels?.[0]?.textContent.trim()==='epochs'&&e.value==='17'&&e.getAttribute('aria-invalid')==='false')`]);
  record.correctedField = await dom(`JSON.stringify((()=>{const e=Array.from(document.querySelectorAll('input')).find(e=>e.labels?.[0]?.textContent.trim()==='epochs');return {value:e.value,invalid:e.getAttribute('aria-invalid')}})())`);
  await checkpoint('invalid-field-corrected');
  await tabTo('Reset training defaults', 'BUTTON');
  await press('Enter');
  record.confirmationOpened = await inline();
  await tabTo('Confirm reset', 'BUTTON');
  record.confirmFocus = await focus();
  await press('Tab');
  record.keepDraftFocus = await focus();
  assert.equal(record.keepDraftFocus.name, 'Keep draft');
  await press('Shift+Tab');
  record.reverseConfirmationFocus = await focus();
  assert.equal(record.reverseConfirmationFocus.name, 'Confirm reset');
  await press('Escape');
  record.afterEscape = await inline();
  await press('Tab');
  await press('Enter');
  record.confirmationDismissed = await inline();
  record.afterDismissFocus = await focus();
  // Inline removal need not restore focus like a modal. Verify keyboard can
  // re-enter the real form without assuming a nonexistent focus trap.
  await tabTo('Reset training defaults', 'BUTTON');
  record.returnedToReset = await focus();
  await checkpoint('keep-draft');
  record.limitations = {
    modalDialogsExercised: false,
    confirmationKind: 'inline role=group; no focus trap or automatic focus restoration promised',
    fieldErrorAssociation: record.invalidField.describedBy === null
      ? 'Visible field-scoped role=alert and aria-invalid; no aria-describedby association'
      : 'Recorded actual aria-describedby attribute; no assistive-technology certification',
    noPlanApprovalOrTraining: true,
  };
  record.status = 'passed';
} catch (error) {
  record.status = 'failed';
  record.failureCategory = keyboardFailureCategory(error);
  record.failureStage = record.stage;
} finally {
  const errors = [];
  record.cleanup = { errors };
  try {
    if (opened) await cli(['close']);
    await until(async () => !(await boundedCommand(browser, ['session', 'list'], { cwd: repo, timeout: 10000 })).includes(session), 15000, 'Browser session remains');
    record.cleanup.browserSessionAbsent = true;
  } catch {
    errors.push('Browser shutdown unconfirmed');
  }
  try {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGINT');
    await until(() => child.exitCode !== null || child.signalCode !== null, 15000, 'Fixture exit timeout');
    assert(stdout.includes('Fixture: services-closed'));
    record.cleanup.servicesClosed = true;
    record.cleanup.fixtureReaped = true;
  } catch {
    errors.push('Fixture shutdown unconfirmed');
  }
  try {
    const address = new URL(origin);
    await new Promise((done, fail) => {
      const socket = createConnection({ host: address.hostname, port: Number(address.port) });
      socket.setTimeout(1500);
      socket.once('connect', () => { socket.destroy(); fail(Error('Listener still accepting')); });
      socket.once('timeout', () => { socket.destroy(); fail(Error('Listener refusal unconfirmed')); });
      socket.once('error', error => {
        socket.destroy();
        if (error.code === 'ECONNREFUSED') done();
        else fail(Error('Listener refusal unconfirmed'));
      });
    });
    record.cleanup.listenerClosed = true;
  } catch {
    errors.push('Listener shutdown unconfirmed');
  }
  if (!errors.length) {
    try {
      for (const path of [directory, root, profile, tokenFile]) {
        const current = await lstat(path);
        const original = ownedIdentities.get(path);
        assert(!current.isSymbolicLink() && current.dev === original.dev && current.ino === original.ino, 'Cleanup requires exact original owned identities');
        assert.equal(await realpath(path), path, 'Cleanup target changed canonical identity');
      }
      for (const path of [root, profile, tokenFile]) {
        await rm(path, { recursive: path !== tokenFile, force: false });
        await assert.rejects(access(path), { code: 'ENOENT' });
      }
      record.cleanup.ownedRootsRemoved = true;
    } catch {
      errors.push('Owned roots removal unconfirmed');
    }
  }
  if (errors.length) record.status = 'failed';
  record.finished = new Date().toISOString();
  record.fixtureDiagnostic = { spawnFailed, stderrObserved: stderrBytes > 0, reaped: child.exitCode !== null || child.signalCode !== null };
  if (record.status === 'passed') {
    try {
      verifyKeyboardRecord(record);
    } catch (error) {
      record.status = 'failed';
      record.failureCategory = keyboardFailureCategory(error);
      record.failureStage = 'record-verification';
    }
  }
  await writeFile(join(directory, 'keyboard-browser.json'), JSON.stringify(record, null, 2), { mode: 0o600, flag: 'wx' });
}
console.log(`Keyboard report: ${join(directory, 'keyboard-browser.json')} (${record.status})`);
if (record.status !== 'passed') process.exitCode = 1;
