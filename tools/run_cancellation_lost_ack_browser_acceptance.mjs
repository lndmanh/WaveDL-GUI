#!/usr/bin/env node
// Additive seeded Local CPU gate. No authoring claim, scheduler or API mock.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, access, realpath, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { boundedCommand } from './run_retained_browser_acceptance.mjs';
import { browserLaunchArgs } from './browser_launch_policy.mjs';
import { createBrowserActions } from './browser_actions.mjs';
import { verifyCancellationLostAckReport } from './verify_cancellation_lost_ack_browser_report.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.WAVEDL_PYTHON ?? 'python';
const browser = process.env.AGENT_BROWSER_BIN ?? 'agent-browser';
const owned = await realpath(await mkdtemp(join(tmpdir(), 'wavedl-cancel-ack-')));
const root = join(owned, 'fixture'), profile = join(owned, 'profile');
const tokenPath = join(owned, 'private-token');
const session = `wavecancel-${randomUUID().slice(0, 8)}`;
const token = randomBytes(32).toString('base64url');
const report = { name: 'cancellation-lost-ack', status: 'running', scope: 'seeded genuine Local CPU runtime; no browser authoring claim' };
report.clockScope = 'same-host Date.now milliseconds; observations ordered against completed public GETs';
report.limitation = 'Same-host wall-clock DOM observations are bounded against completed public GETs, not a complete causal proof. Runtime journal outcome is independent of native cancellation; absent exit means unknown. No browser authoring, scheduler, remote, GPU, Windows or site certification.';
report.browser = { session, engine: 'chrome', startedAtMs: Date.now() };
const privateSecrets = new Set([token]);
const redact = text => { for (const value of privateSecrets) text=text.split(value).join('[REDACTED]'); return text; };
const sanitize = value => typeof value==='string'?redact(value):Array.isArray(value)?value.map(sanitize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,sanitize(v)])):value;
await mkdir(root, { mode: 0o700 });
await mkdir(profile, { mode: 0o700 });
report.browser.initialProfileEmpty = (await readdir(profile)).length === 0;
await writeFile(tokenPath, token, { flag: 'wx', mode: 0o600 });
const delay = ms => new Promise(done => setTimeout(done, ms));
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('AGENT_BROWSER_')) delete env[key];
const cli = (...args) => boundedCommand(browser, ['--session', session, ...args], { cwd: repo, env, timeout: 35000, redact });
const dom = async script => JSON.parse(JSON.parse(await cli('eval', '-b', Buffer.from(`JSON.stringify(${script})`).toString('base64'))));
const actions = createBrowserActions({ cli, dom: async script => JSON.parse(JSON.parse(await cli('eval', '-b', Buffer.from(script).toString('base64')))), snapshot: () => cli('snapshot', '-i') });
const command = (script, ...args) => boundedCommand(python, ['-c', script, root, ...args], { cwd: repo, timeout: 35000 });
const dbScript = `import json,sqlite3,sys,os
from pathlib import Path
r=Path(sys.argv[1]); c=sqlite3.connect((r/'state/registry.db').resolve().as_uri()+'?mode=ro',uri=True); c.row_factory=sqlite3.Row
plans=[dict(x) for x in c.execute('SELECT plan_id,request_id,plan_json FROM plans')]
executions=[dict(x) for x in c.execute('SELECT plan_id,cancel_delivered,handle_json,latest_observation_json FROM execution_control')]
controls=[dict(x) for x in c.execute('SELECT plan_id,submission_requested,cancellation_requested FROM plan_control')]
runs=[dict(x) for x in c.execute('SELECT run_id,state FROM runs')]
print(json.dumps(dict(plans=plans,executions=executions,controls=controls,runs=runs)))`;
const database = async () => JSON.parse(await command(dbScript));
async function poll(fn, description, timeout = 90000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await delay(100); }
  throw new Error(`${description} exceeded ${timeout}ms`);
}
const assets = join(repo, 'src/wavedl_daemon/web_assets');
async function fingerprints() {
  const bytes = await readFile(join(assets, '.wavedl-assets.json'));
  const manifest = JSON.parse(bytes);
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  for (const [path, digest] of Object.entries(manifest)) assert.equal(sha(await readFile(join(assets, path))), digest);
  const sources = {};
  const excluded = new Set(['node_modules','.nuxt','.output','.cache','.vite','.vendor-backups','.git']);
  async function visit(directory,prefix) {
    for (const entry of await readdir(directory,{withFileTypes:true})) {
      if (excluded.has(entry.name)||entry.isSymbolicLink()) continue;
      const path=join(directory,entry.name), key=`${prefix}/${entry.name}`;
      if(entry.isDirectory()) await visit(path,key);
      else if(entry.isFile()) sources[key]=sha(await readFile(path));
    }
  }
  await visit(join(repo,'web'),'web');
  for(const path of ['tools/vendor_web_assets.py','src/wavedl/__init__.py']) sources[path]=sha(await readFile(join(repo,path)));
  const harnessSources={};
  for(const path of ['tools/run_cancellation_lost_ack_browser_acceptance.mjs','tools/browser_daemon_fixture.py','tools/verify_cancellation_lost_ack_browser_report.mjs']) harnessSources[path]=sha(await readFile(join(repo,path)));
  return { assetManifestSha256: sha(bytes), assets: manifest, sources, harnessSources };
}
report.fingerprints = await fingerprints();
let stdout = '', stderr = '', opened = false, origin;
const fixture = spawn(python, ['tools/browser_daemon_fixture.py', '--root', root, '--epochs', '10000', '--drop-cancel-ack', '--token-file', tokenPath], { cwd: repo, env: { ...process.env, PYTHONPATH: join(repo, 'src'), OMP_NUM_THREADS: '1', MKL_NUM_THREADS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
fixture.stdout.on('data', data => { stdout = (stdout + data).slice(-65536); });
fixture.stderr.on('data', data => { stderr = (stderr + data).slice(-4096); });
try {
  await poll(() => { assert(fixture.exitCode === null && fixture.signalCode === null, 'Fixture exited before ready'); return stdout.includes('Browser: '); }, 'Fixture readiness', 45000);
  const bootstrap = stdout.match(/Browser: (http:\/\/\S+)/)[1];
  privateSecrets.add(bootstrap);privateSecrets.add(new URL(bootstrap).searchParams.get('bootstrap'));
  const runId = stdout.match(/Run: ([a-f0-9-]{36})/)[1];
  origin = new URL(bootstrap).origin;
  opened = true;
  await cli('--headed', String(process.env.WAVEDL_BROWSER_HEADED === 'true'), '--engine', 'chrome', '--profile', profile, '--allowed-domains', '127.0.0.1,localhost', ...(process.env.WAVEDL_BROWSER_EXECUTABLE ? ['--executable-path', process.env.WAVEDL_BROWSER_EXECUTABLE] : []), '--args', browserLaunchArgs, 'open', bootstrap);
  await cli('wait', '--text', 'Connected');
  report.browser.connectedAtMs=Date.now();
  assert(!(await cli('get', 'url')).includes('bootstrap'));
  await cli('set', 'viewport', '1280', '900');
  Object.assign(report.browser,await dom('({userAgent:navigator.userAgent,width:innerWidth,height:innerHeight,timeOrigin:performance.timeOrigin})'));
  report.browser.version=execFileSync(browser,['--version'],{encoding:'utf8',timeout:35000}).trim();
  await cli('snapshot', '-i');
  await cli('click', `xpath=//button[contains(@class,"run-row")][.//small[normalize-space(.)="${runId}"]]`);
  await cli('wait', '--text', 'Run detail');
  await cli('wait', '--fn', `document.querySelector('[aria-label="Selected run"] [data-slot="badge"]')?.textContent.trim()==='running'`);
  report.before = await database();
  assert.equal(report.before.plans.length, 1);
  const plan = report.before.plans[0];
  report.identity = { runId, planId: plan.plan_id, requestId: plan.request_id };
  report.manifest = JSON.parse(JSON.parse(plan.plan_json).manifest_json);
  report.manifestSha256=createHash('sha256').update(JSON.parse(plan.plan_json).manifest_json).digest('hex');
  assert.equal(report.manifest.run_id, runId);
  report.startedRuntime = await poll(async () => { const events=JSON.parse(await command(`import json,sys,os
from pathlib import Path
r=Path(sys.argv[1]); p=r/'runs'/sys.argv[2]/'attempts/1/events.jsonl'; events=[json.loads(x) for x in p.read_text().splitlines()] if p.is_file() else []
print(json.dumps(events))`, runId));return events.some(e=>e.type==='hello')&&events.some(e=>e.type==='metric')?events:false; }, 'Real producer hello and CPU training metric');
  assert(report.startedRuntime.some(e => e.type === 'hello' && e.payload.device === 'cpu'));
  report.before = await poll(async () => { const value=await database();return value.runs.length===1?value:false; }, 'Real ingested run registry');
  const health = await fetch(`${origin}/api/health`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
  assert.equal(health.status, 200);
  const identity = await health.json();
  const rawGet = async () => {
    const response = await fetch(`${origin}/api/runs/${runId}`, { headers: { Authorization: `Bearer ${token}`, 'X-WaveDL-Daemon-ID': identity.daemon_id }, signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    const chunks=[];let byteLength=0;const reader=response.body.getReader();
    try { while(true) {const {done,value}=await reader.read();if(done) break;byteLength+=value.byteLength;assert(byteLength<=65536);chunks.push(Buffer.from(value));} }
    finally {await reader.cancel();}
    const rawBody = new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(chunks));
    return { status: response.status, rawBody, body: JSON.parse(rawBody),bodyBytes:Buffer.byteLength(rawBody),bodySha256:createHash('sha256').update(rawBody).digest('hex') };
  };
  report.rawBefore = await rawGet();
  await dom(`(()=>{window.__cancelObservations=[];const observe=()=>{const section=document.querySelector('[aria-label="Selected run"]');const b=Array.from(section?.querySelectorAll('button')??[]).find(e=>e.textContent.trim()==='Request cancellation'||e.textContent.trim()==='Requesting…');const value={atMs:Date.now(),state:section?.querySelector('[data-slot="badge"]')?.textContent.trim(),disabled:b?.disabled??null,status:Array.from(section?.querySelectorAll('[role="status"]')??[]).map(e=>e.textContent.trim())};const last=window.__cancelObservations.at(-1);if(!last||JSON.stringify({...last,atMs:0})!==JSON.stringify({...value,atMs:0}))window.__cancelObservations.push(value);if(window.__cancelObservations.length>256)throw Error('DOM observation budget');};window.__cancelObserver=new MutationObserver(observe);window.__cancelObserver.observe(document.querySelector('[aria-label="Selected run"]'),{subtree:true,childList:true,attributes:true,characterData:true});observe();return true;})()`);
  report.browser.clickedAtMs=Date.now();
  await actions.button('Request cancellation');
  await cli('wait', '--fn', `Array.from(document.querySelectorAll('[role="status"]')).some(e=>e.textContent.includes('Cancellation: requested'))`);
  report.acknowledgedUi = await dom(`(()=>{const s=document.querySelector('[aria-label="Selected run"]');const b=Array.from(s.querySelectorAll('button')).find(e=>e.textContent.trim()==='Request cancellation');return {state:s.querySelector('[data-slot="badge"]')?.textContent.trim(),disabled:b?.disabled,status:Array.from(s.querySelectorAll('[role="status"]')).map(e=>e.textContent.trim())};})()`);
  assert.equal(report.acknowledgedUi.disabled, true);
  await cli('scrollintoview', 'xpath=//button[normalize-space(.)="Request cancellation"]');
  const point = await dom(`(()=>{const b=Array.from(document.querySelector('[aria-label="Selected run"]').querySelectorAll('button')).find(e=>e.textContent.trim()==='Request cancellation');const r=b.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
  await cli('mouse', 'move', String(point.x), String(point.y));
  for (let i=0;i<2;i++) { await cli('mouse', 'down'); await cli('mouse', 'up'); }
  report.rawAfter = await poll(async () => { const result=await rawGet();return result.body.state==='cancelled'?result:false; }, 'Real daemon cancellation');
  await cli('wait', '--fn', `document.querySelector('[aria-label="Selected run"] [data-slot="badge"]')?.textContent.trim()==='cancelled'`);
  report.uiTimeline = await dom(`(()=>{window.__cancelObserver.disconnect();return window.__cancelObservations;})()`);
  report.after = await poll(async () => { const value=await database();const execution=value.executions[0];const observation=execution?.latest_observation_json?JSON.parse(execution.latest_observation_json):null;return observation?.status==='terminal'&&observation?.native_state==='CANCELLED'&&execution.cancel_delivered===1?value:false; }, 'Durable backend cancellation terminal registry');
  report.runtime = JSON.parse(await command(`import json,sys,os
from pathlib import Path
r=Path(sys.argv[1]); pid=int(sys.argv[3]); p=r/'runs'/sys.argv[2]
try: os.kill(pid,0); absent=False
except ProcessLookupError: absent=True
print(json.dumps({'pid':pid,'pidAbsent':absent,'events':[json.loads(x) for x in (p/'attempts/1/events.jsonl').read_text().splitlines()],'attempts':sorted(x.name for x in (p/'attempts').iterdir())}))`, runId, String(JSON.parse(report.before.executions[0].handle_json).pid)));
  assert.equal(report.runtime.pidAbsent, true);
  const exit=report.runtime.events.find(e=>e.type==='exit');
  report.runtimeOutcome=exit?.payload.status??'unknown';
  report.nativeOutcome={status:report.rawAfter.body.evidence.backend.status,nativeState:report.rawAfter.body.evidence.backend.native_state,exitCode:report.rawAfter.body.evidence.backend.exit_code,pid:report.runtime.pid,pidAbsent:report.runtime.pidAbsent};
  report.fingerprintsAfter=await fingerprints();
  assert.deepEqual(report.fingerprintsAfter, report.fingerprints, 'Source/assets changed during browser gate');
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = redact(error.message); }
finally {
  report.cleanup = { errors: [] };
  try {
    if (opened) await cli('close');
    report.browser.closedAtMs=Date.now();
    await poll(async () => !(await boundedCommand(browser, ['session', 'list'], { env, timeout: 5000 })).split('\n').some(line=>line.trim()===session), 'Owned browser session absent', 5000);
    report.cleanup.browserSessionAbsent = true;
  } catch (error) { report.cleanup.errors.push(error.message); }
  try {
    if (fixture.exitCode === null && fixture.signalCode === null) fixture.kill('SIGINT');
    await poll(() => fixture.exitCode !== null || fixture.signalCode !== null, 'Fixture shutdown', 15000);
    assert(stdout.includes('Fixture: services-closed'));
    report.cleanup.fixtureServicesClosed = true;
    report.cleanup.fixtureExit = { code: fixture.exitCode, signal: fixture.signalCode };
    if (origin) await assert.rejects(fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(2000) }));
    report.cleanup.listenerClosed = true;
    const wire = await readFile(join(root, '.cancellation-wire.jsonl'), 'utf8');
    assert(Buffer.byteLength(wire) <= 1048576);
    report.wire = wire.trim().split('\n').filter(Boolean).map(JSON.parse);
    report.cleanup.wireFrozenAfterShutdown = true;
  } catch (error) { report.cleanup.errors.push(error.message); }
  if (report.cleanup.errors.length) report.status = 'failed';
  if (report.cleanup.errors.length === 0) {
    for (const path of [root, profile, tokenPath]) await rm(path, { recursive: true, force: true });
    for (const path of [root, profile, tokenPath]) await assert.rejects(access(path), error=>error.code==='ENOENT');
    report.cleanup.ownedPrivateRootsRemoved = true;
    report.cleanup.browserProfileRemoved = true;
    report.cleanup.privateCredentialRemoved = true;
  }
  if (report.status === 'passed') {
    try { verifyCancellationLostAckReport(report); } catch (error) { report.status='failed';report.error=error.message; }
  }
  const serialized = JSON.stringify(sanitize(report), null, 2);
  assert(!serialized.includes(token));
  await writeFile(join(owned, 'cancellation-lost-ack.json'), serialized, { mode: 0o600, flag: 'wx' });
  console.log(`Cancellation lost-ACK browser evidence: ${join(owned, 'cancellation-lost-ack.json')}`);
  if (report.status !== 'passed') { console.error(report.error ?? report.cleanup.errors.join('; ')); process.exitCode = 1; }
}
