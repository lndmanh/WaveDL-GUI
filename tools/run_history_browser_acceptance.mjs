#!/usr/bin/env node
// Numerical journal -> real daemon DB/replay -> frozen browser RunDetail chart.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { boundedCommand } from './browser_process.mjs';
import { browserLaunchArgs } from './browser_launch_policy.mjs';
import { createBrowserActions, DRIVER_READINESS_MODE } from './browser_actions.mjs';
import { verifyHistoryBrowserReport, isRefusedConnectionError } from './verify_history_browser_report.mjs';
import { currentAssetDigest } from './verify_adoption_negative_browser_report.mjs';

const repo = resolve(new URL('..', import.meta.url).pathname);
const python = process.env.WAVEDL_PYTHON ?? 'python';
const browser = process.env.AGENT_BROWSER_BIN ?? 'agent-browser';
const path = process.argv.find(a => a.startsWith('--report='))?.slice(9);
assert(path?.startsWith('/'), 'Provide --report=/absolute/new.json');
await assert.rejects(access(path));
const workspace = await mkdtemp(join(tmpdir(), 'wavedl-history-browser-'));
assert(!resolve(path).startsWith(workspace + '/'));
const root = join(workspace, 'root'), profile = join(workspace, 'profile');
await mkdir(root, { mode: 0o700 });
await mkdir(profile, { mode: 0o700 });
const fixture = spawn(python, ['tools/history_browser_fixture.py', '--root', root], {
  cwd: repo, env: { ...process.env, PYTHONPATH: join(repo, 'src') }, stdio: ['ignore', 'pipe', 'pipe'],
});
const closed = new Promise(resolve => fixture.once('close', resolve));
let stdout = '', stderr = '', spawnError = null;
fixture.on('error', e => { spawnError = e.message; });
fixture.stdout.on('data', c => { if (stdout.length + c.length < 1048576) stdout += c; else spawnError = 'stdout budget'; });
fixture.stderr.on('data', c => { if (stderr.length + c.length < 16384) stderr += c; });
const session = `wavedl-history-${randomUUID().slice(0, 12)}`;
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('AGENT_BROWSER_'))), AGENT_BROWSER_SESSION: session };
const cli = (...args) => boundedCommand(browser, ['--session', session, ...args], { cwd: repo, env, timeout: 45000 });
const dom = async expr => JSON.parse(JSON.parse(await cli('eval', '-b', Buffer.from(expr).toString('base64'))));
const observe = expr => dom(`JSON.stringify(${expr})`);
const actions = createBrowserActions({ cli, dom, snapshot: () => cli('snapshot', '-i') });
const delay = ms => new Promise(r => setTimeout(r, ms));
async function poll(get, accepts, label, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await get(); if (accepts(value)) return value; await delay(100); }
  throw Error(`${label} timeout`);
}
const result = { status: 'failed', scope: 'real-packaged-browser-100k-history',
  limitation: '100000 controlled numerical metric events, not ML epochs; backend RUNNING observations and pid are fixture-controlled. Immutable writer identity, journal, daemon ingestion/SQLite/event log/public SSE and packaged application chart are real. Supersession/native restart and isolated uPlot render-only time are not claimed.',
  observations: [], cleanup: {} };
result.initialProfileEmpty=(await readdir(profile)).length===0;
result.driverReadinessMode=DRIVER_READINESS_MODE;
const metricsDOM = `(() => {
 const h=document.querySelector('[aria-label="Runtime metric history"]');
 const s=document.querySelector('[aria-label="Current runtime metrics"]');
 const c=h?.querySelector('canvas');
 let paintedPixels=0,paintHash=2166136261;
 if(c?.width&&c?.height) {const pixels=c.getContext('2d')?.getImageData(0,0,c.width,c.height).data;
 if(pixels) for(let i=0;i<pixels.length;i+=4) {if(pixels[i+3]>0) paintedPixels++; for(let j=0;j<4;j++) paintHash=Math.imul(paintHash^pixels[i+j],16777619)>>>0;}}
 return {steps:Number(h?.innerText.match(/lineage · ([0-9]+) steps/)?.[1]??0),
 canvas:!!c,canvasWidth:c?.width??0,canvasHeight:c?.height??0,paintedPixels,paintHash,
 legend:h?.querySelector('.u-legend')?.innerText??'',
 summary:s?.innerText??'', values:Object.fromEntries(Array.from(s?.querySelectorAll('dl.metric-grid > div,[aria-label="Per-parameter MAE"] dl > div')??[]).map(e=>[e.querySelector('dt')?.textContent,e.querySelector('dd')?.textContent])),
 progress:s?.querySelector('progress')?.value??null,
 selected:document.querySelector('[aria-label="Selected run"] .identity')?.textContent.trim()}; })()`;
let failure = null, origin = null;
try {
  result.stage='fixture-readiness';
  await poll(() => stdout, value => { if (spawnError || fixture.exitCode!==null) throw Error(`Fixture readiness failed: ${spawnError??stderr}`); return value.includes('Browser: '); }, '100k fixture', 360000);
  const url = stdout.match(/Browser: (http:\/\/[^\s]+)/)?.[1];
  result.runId = stdout.match(/Run: ([0-9a-f-]{36})/)?.[1];
  assert(url && result.runId);
  origin = new URL(url).origin;
  result.sourceSeconds = Number(stdout.match(/Source seconds: ([0-9.]+)/)?.[1]);
  result.sourceAndIngestSeconds = Number(stdout.match(/Ingest seconds: ([0-9.]+)/)?.[1]);
  result.assetManifestSha256 = await currentAssetDigest();
  result.authorityBefore = JSON.parse(await boundedCommand(python,['tools/history_browser_fixture.py','--root',root,'--inspect',result.runId],{cwd:repo,env:{...process.env,PYTHONPATH:join(repo,'src')},timeout:15000}));
  result.stage='browser-connect';
  await cli('open', url, '--profile', profile, '--engine', 'chrome', '--headed', String(process.env.WAVEDL_BROWSER_HEADED==='true'), ...(process.env.WAVEDL_BROWSER_EXECUTABLE?['--executable-path',process.env.WAVEDL_BROWSER_EXECUTABLE]:[]), '--allowed-domains','127.0.0.1,localhost','--args',browserLaunchArgs);
  await cli('set','viewport','1280','900');
  await cli('wait','--text','Connected');
  result.browserRuntime = await observe('({userAgent:navigator.userAgent,width:innerWidth,height:innerHeight,cookies:document.cookie,localStorageKeys:Object.keys(localStorage),sessionStorageKeys:Object.keys(sessionStorage)})');
  await cli('wait','--fn', `Array.from(document.querySelectorAll('[aria-label="Runs"] small')).some(e=>e.textContent.trim()===${JSON.stringify(result.runId)})`);
  const started = performance.now();
  result.stage='select-run';
  await cli('click', await actions.readyControl('button',result.runId,false,{locator:`xpath=//section[@aria-label='Runs']//button[.//small[normalize-space()='${result.runId}']]`}));
  result.stage='100k-public-DOM';
  result.observations.push(await poll(()=>observe(metricsDOM),v=>v.steps===100000&&v.canvas&&v.progress===1,'100k public history',300000));
  // Heading and canvas updates are separate Vue/rAF work. Yield two paints before final observation.
  await dom('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(JSON.stringify(true)))))');
  result.selectionToPaintedHistoryMs = performance.now()-started;
  result.observations[0] = await observe(metricsDOM);
  for (const channel of ['R²','Learning rate','Loss']) {
    result.stage=`channel-${channel}`;
    const start = performance.now();
    await cli('click',await actions.readyControl('button',channel));
    await dom('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(JSON.stringify(true)))))');
    result.observations.push({channel,channelSwitchWallMs:performance.now()-start,...await observe(metricsDOM)});
  }
  result.authority = JSON.parse(await boundedCommand(python,['tools/history_browser_fixture.py','--root',root,'--inspect',result.runId],{cwd:repo,env:{...process.env,PYTHONPATH:join(repo,'src')},timeout:15000}));
  result.assetManifestSha256After=await currentAssetDigest();
  result.status='passed';
  result.stage='verified-public-DOM';
} catch(e) { failure=e.message; result.error=failure; }
finally {
  try { await cli('close'); await poll(()=>boundedCommand(browser,['session','list'],{cwd:repo,env,timeout:10000}),v=>!v.includes(session),'browser close',5000); result.cleanup.browserClosed=true; } catch { result.cleanup.browserClosed=false; failure??='Browser cleanup unconfirmed'; }
  if(fixture.exitCode===null&&fixture.signalCode===null) fixture.kill('SIGINT');
  let timer;
  try { await Promise.race([closed,new Promise((_,reject)=>{timer=setTimeout(()=>{fixture.kill('SIGKILL');reject(Error('fixture close timeout'));},15000);})]); result.cleanup.fixtureReaped=true; } catch { result.cleanup.fixtureReaped=false; failure??='Fixture cleanup unconfirmed'; } finally { clearTimeout(timer); }
  result.cleanup.servicesClosed=stdout.includes('Fixture: services-closed');
  result.cleanup.listenerClosed=false;
  if(origin) try { await fetch(`${origin}/api/health`,{signal:AbortSignal.timeout(1000)}); } catch(error) {
    result.cleanup.listenerClosed=isRefusedConnectionError(error);
  }
  if(Object.values(result.cleanup).every(v=>v===true)) { await rm(workspace,{recursive:true,force:true}); result.cleanup.workspaceRemoved=true; } else { result.cleanup.workspaceRemoved=false; result.retainedWorkspace=workspace; failure??='Cleanup incomplete'; }
  if(failure) { result.status='failed'; result.error=failure; }
  if(result.status==='passed') try { verifyHistoryBrowserReport(result); } catch(e) {result.status='failed'; result.error=e.message; failure=e.message;}
  await writeFile(path,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
}
if(failure) throw Error(`${failure}; report ${path}`);
console.log(`Passed: ${path}`);
