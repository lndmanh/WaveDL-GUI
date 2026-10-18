#!/usr/bin/env node
// Additive mounted Results gate; genuine CPU seed and genuine invalid NPZ files.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';
import { createBrowserActions } from './browser_actions.mjs';
import { browserLaunchArgs } from './browser_launch_policy.mjs';
import { boundedCommand } from './run_retained_browser_acceptance.mjs';
import { numericalSourceFingerprint, verifyNumericalFailureFile } from './verify_numerical_failure_browser_report.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.WAVEDL_PYTHON;
assert(python?.startsWith('/'), 'Explicit absolute WAVEDL_PYTHON required');
const destination = resolve(process.argv[2]);
await mkdir(destination, { mode: 0o700 });
assert((await lstat(destination)).isDirectory() && !(await lstat(destination)).isSymbolicLink());
assert.deepEqual(await readdir(destination), []);
const owned = await mkdtemp(join(await realpath(tmpdir()), 'wavedl-numerical-'));
const root = join(owned, 'fixture'), profile = join(owned, 'profile');
await mkdir(root, { mode: 0o700 }); await mkdir(profile, { mode: 0o700 });
const session = `wavenum-${randomUUID().slice(0, 8)}`;
const browserEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AGENT_BROWSER_')));
const report = { name: 'numerical-failure', status: 'running', scope: 'same-host mounted Results CPU numerical-input failure only; not all P3', cases: [] };
const command = (binary, args, timeout = 35000) => boundedCommand(binary, args, { cwd: repo, timeout, env: binary === 'agent-browser' ? browserEnv : process.env });
const fingerprint = numericalSourceFingerprint;
report.sourcesBefore = await fingerprint();
report.assetManifestSha256 = createHash('sha256').update(await readFile(join(repo, 'src/wavedl_daemon/web_assets/.wavedl-assets.json'))).digest('hex');
let output = '', outputOverflow = false, opened = false, servicesClosed = false;
const fixture = spawn(python, ['tools/browser_numerical_failure_fixture.py', '--root', root, '--epochs', '1', '--record-process-results'], { cwd: repo, env: { ...process.env, PYTHONPATH: join(repo, 'src') }, stdio: ['ignore', 'pipe', 'pipe'] });
fixture.stdout.on('data', chunk => { if (outputOverflow) return; if (Buffer.byteLength(output) + chunk.length > 1048576) { outputOverflow = true; return; } output += chunk; });
fixture.stderr.on('data', () => {}); // Never echo potentially credential-bearing fixture output.
const poll = async (fn, predicate, label, timeout = 90000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { assert(!outputOverflow, 'Fixture evidence output exceeds bound'); const value = await fn(); if (predicate(value)) return value; await new Promise(r => setTimeout(r, 200)); }
  throw new Error(`Bounded observation failed: ${label}`);
};
const cli = (...args) => command('agent-browser', ['--session', session, ...(args[0] === 'open' ? ['--headed', 'false', '--engine', 'chrome', '--profile', profile, '--allowed-domains', '127.0.0.1,localhost', '--args', browserLaunchArgs] : []), ...args]);
const dom = async expression => JSON.parse(JSON.parse(await cli('eval', '-b', Buffer.from(expression).toString('base64'))));
const actions = createBrowserActions({ cli, dom, snapshot: () => cli('snapshot', '-i') });
const evidence = async () => JSON.parse(await command(python, ['tools/browser_numerical_failure_fixture.py', 'evidence', root]));
try {
  await poll(async () => output, value => /Browser: http/.test(value) && /Run: /.test(value), 'fixture ready');
  const url = output.match(/Browser: (http\S+)/)[1];
  const training = output.match(/Run: ([0-9a-f-]{36})/)[1];
  report.origin = new URL(url).origin;
  report.browser = await command('agent-browser', ['--version']);
  report.profileInitiallyEmpty = (await readdir(profile)).length === 0;
  opened = true; await cli('open', url); await cli('set', 'viewport', '1280', '900');
  await cli('wait', '--text', 'Connected');
  report.browserRuntime = await dom('JSON.stringify({userAgent:navigator.userAgent,width:innerWidth,height:innerHeight})');
  assert(!(await cli('get', 'url')).includes('bootstrap'));
  report.bootstrapConsumed = true;
  report.datasets = JSON.parse(await command(python, ['tools/browser_numerical_failure_fixture.py', 'datasets', root]));
  await poll(evidence, value => value.runs.some(run => run.run_id === training && run.state === 'completed'), 'genuine training completed');
  await actions.button('Experiments'); await actions.button('Close', true);
  await actions.button('Refresh', false, { scope: '//section[@aria-label="Runs"]' });
  await cli('click', `xpath=//button[contains(@class,"run-row")][.//small[normalize-space(.)='${training}']]`);
  await actions.button('Results'); await actions.button('Refresh artifacts');
  await cli('wait', '--fn', 'Array.from(document.getElementById("source-generation")?.options??[]).some(o=>o.value&&!o.disabled)');
  const options = await dom('JSON.stringify(Array.from(document.getElementById("source-generation").options).filter(o=>o.value&&!o.disabled).map(o=>({value:o.value,label:o.textContent.trim()})))');
  report.selected = options.find(option => option.label.endsWith('best')); assert(report.selected);
  report.sourceRunId = training;
  report.before = await evidence();
  const scope = '//section[@aria-labelledby="inference-title"]';
  for (const name of ['nan', 'inf', 'empty']) {
    // Public run selection restores pinned training authority after each failed test.
    if (report.cases.length) {
      await actions.button('Experiments');
      await actions.button('Refresh', false, { scope: '//section[@aria-label="Runs"]' });
      await cli('click', `xpath=//button[contains(@class,"run-row")][.//small[normalize-space(.)='${training}']]`);
      await actions.button('Results'); await actions.button('Refresh artifacts');
    }
    await actions.select('Source checkpoint generation', report.selected.value);
    const locator = await actions.readyControl('field', 'Configured root', false, { locator: `xpath=${scope}//*[@role="combobox" and @aria-label="Configured root"]` });
    await cli('click', locator); await actions.option('datasets');
    await actions.button(`Select file ${name}.npz`, false, { scope });
    await actions.fill('Python interpreter', python, { scope });
    if (await dom('JSON.stringify(document.getElementById("inference-save_predictions").getAttribute("aria-checked"))') !== 'true') {
      await cli('click', await actions.readyControl('button', 'Publish predictions CSV', false, { locator: '#inference-save_predictions' }));
    }
    await actions.button('Preview evaluation / plot plan', false, { scope });
    const plan = `document.getElementById('inference-title').closest('section').querySelector('[aria-label="Approved normalized manifest"]')`;
    await cli('wait', '--fn', `${plan} !== null`);
    const approved = JSON.parse(await dom(`JSON.stringify(${plan}.textContent)`));
    const item = { name, approved }; report.cases.push(item);
    await actions.button('Approve and start this plan', false, { scope });
    item.durable = await poll(evidence, value => value.runs.some(run => run.run_id === approved.run_id && run.state === 'failed'), `${name} runtime failed`);
    await actions.button('Experiments');
    await actions.button('Refresh', false, { scope: '//section[@aria-label="Runs"]' });
    await cli('click', `xpath=//button[contains(@class,"run-row")][.//small[normalize-space(.)='${approved.run_id}']]`);
    const expectedError = item.durable.runs.find(run => run.run_id === approved.run_id).runtimeEvents.find(event => event.type === 'error').payload.message;
    const ui = () => dom('JSON.stringify((()=>{const s=document.querySelector("[aria-label=\\"Selected run\\"]");const text=s?.innerText??"";const log=s?.querySelector("[role=log]")?.textContent??"";const line=log.split("\\n").find(line=>line.includes(" error: "));return {selectedRunId:s?.querySelector(".identity")?.textContent.trim(),state:s?.querySelector("[data-slot=badge]")?.textContent.trim(),errorMessage:line?.split(" error: ").slice(1).join(" error: ")??null,text,atMs:Date.now()}})())');
    item.ui = await poll(ui, value => value.selectedRunId === approved.run_id && value.state === 'failed' && value.errorMessage === expectedError, `${name} mounted failed diagnostic`);
    item.durable = await poll(evidence, value => {
      const plan = value.plans.find(row => JSON.parse(JSON.parse(row.plan_json).manifest_json).run_id === approved.run_id);
      const execution = value.executions.find(row => row.plan_id === plan?.plan_id);
      const observed = execution && JSON.parse(execution.latest_observation_json ?? execution.observation_json);
      return observed?.status === 'terminal' && observed.exit_code === 1;
    }, `${name} confirmed native failure`);
    item.wire = (await readFile(join(root, '.numerical-wire.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse).filter(row => row.path === `/api/runs/${approved.run_id}`);
  }
  report.after = await evidence();
  report.sourcesAfter = await fingerprint();
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error.message).replace(/bootstrap=\S+/g, 'bootstrap=[REDACTED]'); }
finally {
  report.cleanup = { errors: [] };
  try { if (opened) await cli('close'); await poll(() => command('agent-browser', ['session', 'list']), value => !value.split('\n').some(line => line.trim() === session), 'browser session closed', 5000); report.cleanup.browserSessionAbsent = true; }
  catch { report.cleanup.errors.push('browser closure unverified'); }
  try {
    fixture.kill('SIGINT');
    await poll(async () => ({ code: fixture.exitCode, signal: fixture.signalCode, output }), v => (v.code !== null || v.signal !== null) && v.output.includes('Fixture: services-closed'), 'fixture shutdown', 30000);
    servicesClosed = true; report.cleanup.fixtureServicesClosed = true;
    report.cleanup.fixturePidAbsent = true;
    report.cleanup.tokenRemoved = true; // Ephemeral fixture token lived only in owned process memory.
    report.cleanup.fixtureExit = { code: fixture.exitCode, signal: fixture.signalCode };
    report.processResults = (await readFile(join(root, '.numerical-process.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    for (const result of report.processResults) {
      try { process.kill(result.pid, 0); result.pidAbsent = false; } catch (error) { result.pidAbsent = error.code === 'ESRCH'; }
    }
    const address = new URL(report.origin);
    report.cleanup.listenerAbsent = await new Promise(resolveProbe => {
      const socket = createConnection({ host: address.hostname, port: Number(address.port) });
      socket.setTimeout(2000);
      socket.on('connect', () => { socket.destroy(); resolveProbe(false); });
      socket.on('error', error => { socket.destroy(); resolveProbe(error.code === 'ECONNREFUSED'); });
      socket.on('timeout', () => { socket.destroy(); resolveProbe(false); });
    });
  } catch { report.cleanup.errors.push('fixture services closure unverified'); }
  if (servicesClosed && report.cleanup.browserSessionAbsent && report.cleanup.listenerAbsent && report.processResults?.every(item => item.pidAbsent)) {
    await rm(owned, { recursive: true }); await assert.rejects(access(owned)); report.cleanup.ownedRootRemoved = true; report.cleanup.browserProfileRemoved = true;
  }
  if (report.cleanup.errors.length) report.status = 'failed';
  await writeFile(join(destination, 'numerical-failure.json'), JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
}
await verifyNumericalFailureFile(join(destination, 'numerical-failure.json'));
console.log(`Numerical failure browser evidence: ${join(destination, 'numerical-failure.json')}`);
