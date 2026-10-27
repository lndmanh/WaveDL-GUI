#!/usr/bin/env node
// Genuine Local backend barriers; read-only DOM eval, native public UI actions.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, access, realpath, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { boundedCommand } from './browser_process.mjs';
import { browserLaunchArgs } from './browser_launch_policy.mjs';
import { createBrowserActions } from './browser_actions.mjs';
import { verifyPendingCancelBrowserReport } from './verify_pending_cancel_browser_report.mjs';
import { boundedFile } from './browser_files.mjs';

const repo = resolve(new URL('..', import.meta.url).pathname);
const reportPath = process.argv.find(arg => arg.startsWith('--report='))?.slice(9);
assert(reportPath?.startsWith('/'), 'Provide --report=/absolute/new-report.json');
await assert.rejects(access(reportPath));
const python = process.env.WAVEDL_PYTHON ?? 'python';
const browser = process.env.AGENT_BROWSER_BIN ?? 'agent-browser';
const owned = await realpath(await mkdtemp(join(tmpdir(), 'wavedl-pending-cancel-')));
assert(!resolve(reportPath).startsWith(owned + '/'));
const root = join(owned, 'root'), profile = join(owned, 'profile'), tokenPath = join(owned, 'token');
await mkdir(root, { mode: 0o700 });
await mkdir(profile, { mode: 0o700 });
const token = randomBytes(32).toString('base64url');
await writeFile(tokenPath, token, { mode: 0o600, flag: 'wx' });
const session = `wavepending-${randomUUID().slice(0, 8)}`;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AGENT_BROWSER_')));
const cli = (...args) => boundedCommand(browser, ['--session', session, ...args], { cwd: repo, env, timeout: 35000 });
const dom = async expression => JSON.parse(JSON.parse(await cli('eval', '-b', Buffer.from(`JSON.stringify(${expression})`).toString('base64'))));
const actions = createBrowserActions({ cli, dom: async expression => JSON.parse(JSON.parse(await cli('eval', '-b', Buffer.from(expression).toString('base64')))), snapshot: () => cli('snapshot', '-i') });
const delay = ms => new Promise(done => setTimeout(done, ms));
async function poll(get, accept, label, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await get(); if (accept(value)) return value; await delay(80); }
  throw new Error(`${label} timeout`);
}
const sha = value => createHash('sha256').update(value).digest('hex');
async function fingerprints() {
  const raw = await readFile(join(repo, 'src/wavedl_daemon/web_assets/.wavedl-assets.json'));
  const assets = JSON.parse(raw), sources = {};
  for (const [path, hash] of Object.entries(assets)) assert.equal(sha(await readFile(join(repo, 'src/wavedl_daemon/web_assets', path))), hash);
  for (const path of ['tools/browser_pending_cancel_fixture.py', 'tools/run_pending_cancel_browser_acceptance.mjs', 'tools/verify_pending_cancel_browser_report.mjs', 'tools/browser_daemon_fixture.py', 'tools/browser_actions.mjs']) sources[path] = sha(await readFile(join(repo, path)));
  return { assetManifestSha256: sha(raw), assets, sources };
}
const report = { name: 'pending-cancel', status: 'failed', scope: 'genuine Local POSIX process boundary; no ML runtime, scheduler or site certification', cleanup: { errors: [] }, browser: { session, initialProfileEmpty: (await readdir(profile)).length === 0 } };
let stdout = '', stderr = '', origin, daemonId, opened = false;
const fixture = spawn(python, ['tools/browser_pending_cancel_fixture.py', '--root', root, '--token-file', tokenPath], { cwd: repo, env: { ...env, PYTHONPATH: `${repo}:${join(repo, 'src')}` }, stdio: ['ignore', 'pipe', 'pipe'] });
let fixtureClosed = false;
fixture.once('close', () => { fixtureClosed = true; });
fixture.stdout.on('data', data => { stdout = (stdout + data).slice(-65536); });
fixture.stderr.on('data', data => { stderr = (stderr + data).slice(-8192); });
fixture.on('error', error => { stderr = error.message; });
async function open(url) {
  opened = true;
  await cli('--headed', String(process.env.WAVEDL_BROWSER_HEADED === 'true'), '--engine', 'chrome', '--profile', profile, '--allowed-domains', '127.0.0.1,localhost', ...(process.env.WAVEDL_BROWSER_EXECUTABLE ? ['--executable-path', process.env.WAVEDL_BROWSER_EXECUTABLE] : []), '--args', browserLaunchArgs, 'open', url);
  await cli('wait', '--text', 'Connected');
  assert(!(await cli('get', 'url')).includes('bootstrap'));
}
const headers = () => ({ Authorization: `Bearer ${token}`, 'X-WaveDL-Daemon-ID': daemonId });
async function get(runId, suffix = '') {
  const response = await fetch(`${origin}/api/runs/${runId}${suffix}`, { headers: headers(), signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  const raw = await response.text(); assert(Buffer.byteLength(raw) <= 65536);
  return JSON.parse(raw);
}
async function getBoth(suffix = '') {
  const values = [];
  for (const id of report.runIds) values.push(await get(id, suffix));
  return values;
}
async function select(runId) {
  await cli('wait', '--fn', `Array.from(document.querySelectorAll('[aria-label="Runs"] small')).some(e=>e.textContent.trim()===${JSON.stringify(runId)})`);
  await cli('snapshot', '-i');
  await cli('click', await actions.readyControl('button', runId, false, { locator: `xpath=//section[@aria-label='Runs']//button[.//small[normalize-space()='${runId}']]` }));
  await cli('wait', '--text', 'Run detail');
}
const readUi = () => dom(`(()=>{const s=document.querySelector('[aria-label="Selected run"]'); const b=Array.from(s?.querySelectorAll('button')||[]).find(e=>e.textContent.trim()==='Request cancellation');const badge=s?.querySelector('[data-slot="badge"]');const badgeText=badge?.textContent.trim()||'';return {runId:s?.querySelector('.identity')?.textContent.trim(),badge:badgeText.replace(/uncertain|stale|·/g,'').trim(),badgeText,cancelDisabled:b?.disabled,status:Array.from(s?.querySelectorAll('[role="status"]')||[]).map(e=>e.textContent.trim()),text:s?.innerText||'',progress:!!s?.querySelector('progress'),charts:s?.querySelectorAll('canvas').length||0};})()`);
async function ui(expected, disabled) {
  const normalized = expected.replaceAll('_', ' ');
  return poll(readUi, value => (value.badge === normalized || value.badgeText?.startsWith(normalized)) && value.cancelDisabled === disabled, `DOM ${expected}`);
}
async function repeatedDisabledClicks() {
  await cli('scrollintoview', 'xpath=//button[normalize-space(.)="Request cancellation"]');
  const point = await dom(`(()=>{const b=Array.from(document.querySelector('[aria-label="Selected run"]').querySelectorAll('button')).find(e=>e.textContent.trim()==='Request cancellation');const r=b.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
  await cli('mouse', 'move', String(point.x), String(point.y));
  for (let index = 0; index < 2; index++) { await cli('mouse', 'down'); await cli('mouse', 'up'); }
}
try {
  report.fingerprints = await fingerprints();
  await poll(() => stdout, value => { assert(fixture.exitCode === null && fixture.signalCode === null, `Fixture exited: ${stderr}`); return value.includes('Reconnect: '); }, 'Fixture');
  const url = stdout.match(/Browser: (http:\/\/\S+)/)[1], reconnect = stdout.match(/Reconnect: (http:\/\/\S+)/)[1];
  origin = new URL(url).origin;
  report.runIds = [0, 1].map(index => stdout.match(new RegExp(`Run${index}: ([a-f0-9-]{36})`))[1]);
  const health = await fetch(`${origin}/api/health`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(health.status, 200); daemonId = (await health.json()).daemon_id;
  report.initial = await getBoth();
  await open(url);
  report.browser.userAgent = await dom('navigator.userAgent');
  await select(report.runIds[1]);
  report.pendingUi = await ui('pending', false);
  await cli('close'); opened = false;
  await poll(() => boundedCommand(browser, ['session', 'list'], { env, timeout: 5000 }), value => !value.includes(session), 'Detached browser absent');
  report.detached = await getBoth();
  await open(reconnect);
  await select(report.runIds[1]);
  await actions.button('Request cancellation');
  report.unclaimedUi = await ui('cancelled', true);
  await repeatedDisabledClicks();
  report.unclaimed = await get(report.runIds[1]);
  await select(report.runIds[0]);
  report.submittingUi = await ui('submission_unknown', false);
  await actions.button('Request cancellation');
  report.unknownUi = await ui('submission_unknown', true);
  await repeatedDisabledClicks();
  report.unknown = await get(report.runIds[0]);
  await writeFile(join(root, 'release-probe'), '', { mode: 0o600, flag: 'wx' });
  report.receiptLineage = await poll(() => get(report.runIds[0], '/attempts'), value => value.attempts?.[0]?.submission_handle?.pid > 0, 'Accepted real Local receipt');
  await poll(async () => (await boundedFile(join(root, 'backend.jsonl'), 65536)).toString('utf8'), value => value.includes('cancel-entered'), 'Cancellation delivery barrier');
  report.receiptPending = await get(report.runIds[0]);
  report.receiptUi = await ui(report.receiptPending.state, true);
  await writeFile(join(root, 'release-cancel'), '', { mode: 0o600, flag: 'wx' });
  report.terminal = await poll(() => get(report.runIds[0]), value => value.state === 'cancelled' && !value.uncertainty, 'Observed native cancellation');
  report.terminalUi = await ui('cancelled', true);
  report.final = await getBoth();
  report.lineage = await getBoth('/attempts');
  report.fingerprintsAfter = await fingerprints();
  report.status = 'passed';
} catch (error) { report.error = error.message.replaceAll(token, '[REDACTED]'); }
finally {
  try {
    if (opened) await cli('close');
    await poll(() => boundedCommand(browser, ['session', 'list'], { env, timeout: 5000 }), value => !value.includes(session), 'Final browser absence');
    report.cleanup.browserAbsent = true;
  } catch (error) { report.cleanup.errors.push(error.message); }
  try {
    // Release backend workers before shutdown, including failed scenarios.
    for (const name of ['probe', 'cancel']) await writeFile(join(root, `release-${name}`), '', { mode: 0o600 });
    if (fixture.exitCode === null && fixture.signalCode === null) fixture.kill('SIGINT');
    await poll(() => fixtureClosed, Boolean, 'Fixture pipes closed', 20000);
    assert(stdout.includes('Fixture: services-closed'));
    report.cleanup.fixtureExit = { code: fixture.exitCode, signal: fixture.signalCode };
    report.cleanup.servicesClosed = true;
    await assert.rejects(fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) }), error => error.cause?.code === 'ECONNREFUSED');
    report.cleanup.listenerClosed = true;
    const wire = (await boundedFile(join(root, 'wire.jsonl'), 1048576)).toString('utf8'), backend = (await boundedFile(join(root, 'backend.jsonl'), 65536)).toString('utf8');
    report.wire = wire.trim().split('\n').filter(Boolean).map(JSON.parse);
    report.backend = backend.trim().split('\n').filter(Boolean).map(JSON.parse);
    report.cleanup.evidenceFrozen = true;
    const child = report.backend.find(item => item.kind === 'child-reaped');
    assert(child?.pidAbsent, 'Owned Local child must be reaped');
    await rm(owned, { recursive: true, force: false });
    await assert.rejects(access(owned), error => error.code === 'ENOENT');
    report.cleanup.privateRootsRemoved = true;
  } catch (error) { report.cleanup.errors.push(error.message); report.retainedWorkspace = owned; }
  if (report.cleanup.errors.length) report.status = 'failed';
  if (report.status === 'passed') try { verifyPendingCancelBrowserReport(report); } catch (error) { report.status = 'failed'; report.error = error.message; }
  const serialized = JSON.stringify(report, null, 2);
  assert(!serialized.includes(token));
  await writeFile(reportPath, serialized, { mode: 0o600, flag: 'wx' });
}
console.log(`Pending cancellation browser evidence: ${reportPath}`);
if (report.status !== 'passed') { console.error(report.error ?? report.cleanup.errors.join('; ')); process.exitCode = 1; }
