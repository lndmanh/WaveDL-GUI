#!/usr/bin/env node
// Real daemon, real CPU producer, normal HTTP bytes and public native controls.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp,mkdir,readdir,realpath,lstat,rm,writeFile,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { randomUUID,randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { connect } from 'node:net';
import { boundedCommand } from './browser_process.mjs';
import { createBrowserActions,DRIVER_READINESS_MODE } from './browser_actions.mjs';
import { browserLaunchArgs } from './browser_launch_policy.mjs';
import { currentAssetDigest } from './verify_adoption_negative_browser_report.mjs';
import { reconnectLimitation,verifyReconnectFile,verifyReconnectRecord } from './verify_reconnect_browser_report.mjs';

const repo=fileURLToPath(new URL('../',import.meta.url)),python=process.env.WAVEDL_PYTHON??'python',browser=process.env.AGENT_BROWSER_BIN??'agent-browser';
assert(!process.env.WAVEDL_BROWSER_ASSETS);
const destination=process.argv[2]?resolve(process.argv[2]):await mkdtemp(join(await realpath(tmpdir()),'wavedl-reconnect-'));
await mkdir(destination,{recursive:true,mode:0o700});assert(!(await lstat(destination)).isSymbolicLink());assert.deepEqual(await readdir(destination),[]);
const root=join(destination,'fixture'),profile=join(destination,'profile'),credential=join(destination,'.token');
await mkdir(root,{mode:0o700});await mkdir(profile,{mode:0o700});
const token=randomBytes(32).toString('base64url');await writeFile(credential,token,{mode:0o600,flag:'wx'});
const env={...process.env,PYTHONPATH:join(repo,'src'),OMP_NUM_THREADS:'1',MKL_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1',MPLBACKEND:'Agg'};
const session=`reconnect-${randomUUID()}`,r={name:'same-daemon-reconnect',status:'running',driverReadinessMode:DRIVER_READINESS_MODE,limitation:reconnectLimitation};
const child=spawn(python,['tools/browser_reconnect_fixture.py','--root',root,'--token-file',credential],{cwd:repo,env,stdio:['ignore','pipe','pipe']});
let stdout='',childClosed=false,opened=false,origin=null,childError=null;
let stdoutOverflow=false;
child.stdout.on('data',chunk=>{if(Buffer.byteLength(stdout)+chunk.length>1024*1024){stdoutOverflow=true;}else stdout+=chunk;});child.stderr.on('data',()=>{});child.on('close',()=>{childClosed=true;});
child.on('error',error=>{childError=error;});
const delay=ms=>new Promise(done=>setTimeout(done,ms));
const command=args=>{const environment={...process.env};for(const key of Object.keys(environment))if(key.startsWith('AGENT_BROWSER_'))delete environment[key];environment.AGENT_BROWSER_SESSION=session;return boundedCommand(browser,['--session',session,...(args[0]==='open'?['--args',browserLaunchArgs]:[]),...args],{cwd:repo,env:environment,timeout:35000});};
const dom=async script=>JSON.parse(JSON.parse(await command(['eval','-b',Buffer.from(script).toString('base64')])));
const actions=createBrowserActions({cli:(...args)=>command(args),dom,snapshot:()=>command(['snapshot','-i'])});
const inspect=async()=>JSON.parse(await boundedCommand(python,['tools/browser_reconnect_fixture.py','--root',root,'--inspect'],{cwd:repo,env}));
const requests=async()=>{const text=await readFile(join(root,'.request-metadata.jsonl'),'utf8');assert(Buffer.byteLength(text)<=1024*1024);return text.trim().split('\n').filter(Boolean).map(JSON.parse);};
const health=async()=>{const response=await fetch(`${origin}/api/health`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(5000)});assert.equal(response.status,200);const h=await response.json();return {daemon_id:h.daemon_id,build_id:h.build_id,protocol_min:h.protocol_min,protocol_max:h.protocol_max};};
const observation=`JSON.stringify((()=>{const selected=document.querySelector('[aria-label="Selected run"]'),history=document.querySelector('[aria-label="Runtime metric history"]'),current=document.querySelector('[aria-label="Current runtime metrics"]'),log=document.querySelector('[aria-label="Runtime diagnostics"]');return {selectedRunId:selected?.querySelector('.identity')?.textContent.trim(),state:selected?.querySelector('[data-slot="badge"]')?.textContent.trim(),steps:Number(history?.innerText.match(/lineage · ([0-9]+) steps/)?.[1]??0),canvas:!!history?.querySelector('canvas'),runtimeLog:log?.innerText.includes('Training runtime rank 0')??false,currentMetrics:!!current?.querySelector('progress'),diagnosticIds:Array.from((log?.innerText??'').matchAll(/\\[([0-9]+:[0-9]+)\\]/g),m=>m[1])};})())`;
try {
  r.browser=(await boundedCommand(browser,['--version'],{cwd:repo})).trim();r.initialProfileEmpty=(await readdir(profile)).length===0;
  const deadline=Date.now()+180000;let url;while(!(url=stdout.match(/Browser: (http:\/\/[^\s]+)/)?.[1])){assert(!childError&&!childClosed&&!stdoutOverflow&&Date.now()<deadline,'Fixture readiness failed');await delay(100);}
  origin=new URL(url).origin;r.assetManifestSha256=await currentAssetDigest();opened=true;
  await command(['open','--engine','chrome','--profile',profile,'--allowed-domains','127.0.0.1,localhost',...(process.env.WAVEDL_BROWSER_EXECUTABLE?['--executable-path',process.env.WAVEDL_BROWSER_EXECUTABLE]:[]),url]);
  await command(['set','viewport','1280','900']);await command(['wait','--text','Connected']);
  r.browserObserved=await dom('JSON.stringify({userAgent:navigator.userAgent,width:innerWidth,height:innerHeight,cookies:document.cookie,localStorageKeys:Object.keys(localStorage),sessionStorageKeys:Object.keys(sessionStorage)})');
  r.stage='wait-real-runtime';const runtimeDeadline=Date.now()+45000;
  while(!r.authorityBefore){try{const value=await inspect();if(value.metricSteps.length>0)r.authorityBefore=value;}catch(error){r.runtimeReadinessFailures??=[];assert(r.runtimeReadinessFailures.length<32);r.runtimeReadinessFailures.push(String(error.message).slice(0,256));}assert(Date.now()<runtimeDeadline,'Real runtime metrics not ready');if(!r.authorityBefore)await delay(100);}
  const id=r.authorityBefore.runId;
  // Select by the real run identity, scoped to the visible public run list.
  const runLocator=`xpath=//section[@aria-label="Runs"]//button[.//small[normalize-space(.)='${id}']]`;
  const select=async()=>{await command(['click',await actions.readyControl('button',id,false,{locator:runLocator})]);};
  r.stage='select-real-run';await select();await command(['wait','--fn',`document.querySelector('[aria-label="Runtime metric history"]')?.innerText.match(/lineage · [1-9][0-9]* steps/) && document.querySelector('[aria-label="Runtime diagnostics"]')?.innerText.includes('Training runtime rank 0')`]);
  r.renderedBefore=await dom(observation);r.authorityBefore=await inspect();r.healthBefore=await health();r.requestsBefore=await requests();
  await actions.button('Connection',false,{scope:'//nav[@aria-label="Sections"]'});await actions.button('Disconnect');await command(['wait','--text','Connect securely']);
  r.detached=await dom(`JSON.stringify({selectedRunAbsent:!document.querySelector('[aria-label="Selected run"]'),historyAbsent:!document.querySelector('[aria-label="Runtime metric history"]'),diagnosticsAbsent:!document.querySelector('[aria-label="Runtime diagnostics"]'),credentialEmpty:document.querySelector('#daemon-bearer')?.value===''} )`);
  r.authorityDetached=await inspect();
  const detachedDeadline=Date.now()+30000;
  while(Date.now()<detachedDeadline){const next=await inspect();if(next.eventIds.length>r.authorityBefore.eventIds.length){r.detachedAdvanced=next;break;}await delay(250);}
  assert(r.detachedAdvanced,'Real producer did not advance while browser authority was detached');
  assert.deepEqual(r.detachedAdvanced.controls,r.authorityBefore.controls);
  await actions.fill('Daemon bearer credential',token);await actions.button('Connect securely');await command(['wait','--text','Connected']);
  await actions.button('Experiments');await select();await command(['wait','--fn',`Number(document.querySelector('[aria-label="Runtime metric history"]')?.innerText.match(/lineage · ([0-9]+) steps/)?.[1]??0)>=${r.renderedBefore.steps} && document.querySelector('[aria-label="Runtime diagnostics"]')?.innerText.includes('Training runtime rank 0')`]);
  r.renderedAfter=await dom(observation);r.authorityAfter=await inspect();r.healthAfter=await health();r.status='passed';
}catch(error){r.status='failed';r.error=String(error.message??error).split(token).join('[REDACTED]').slice(0,1024);}
finally {
  const errors=[];if(stdoutOverflow)errors.push('Fixture stdout exceeded budget');let browserSessionAbsent=!opened;
  if(opened){await command(['close']).catch(error=>errors.push(`Browser close: ${error.message}`));const deadline=Date.now()+30000;do{try{browserSessionAbsent=!(await boundedCommand(browser,['session','list'],{cwd:repo,timeout:10000})).split('\n').some(line=>line.includes(session));}catch(error){errors.push(`Browser session proof: ${error.message}`);break;}if(!browserSessionAbsent)await delay(250);}while(!browserSessionAbsent&&Date.now()<deadline);}
  if(!browserSessionAbsent)errors.push('Browser remains');if(!childClosed)child.kill('SIGINT');const deadline=Date.now()+15000;while(!childClosed&&Date.now()<deadline)await delay(100);if(!childClosed){child.kill('SIGKILL');errors.push('Graceful fixture cleanup timeout');}
  const servicesClosed=stdout.includes('Fixture: services-closed');if(!servicesClosed)errors.push('Services closure unproven');
  const listenerClosed=childClosed&&origin?await new Promise(done=>{const address=new URL(origin),socket=connect({host:address.hostname,port:Number(address.port)});socket.setTimeout(2000,()=>{socket.destroy();done(false);});socket.on('connect',()=>{socket.destroy();done(false);});socket.on('error',e=>{socket.destroy();done(e.code==='ECONNREFUSED');});}):false;if(!listenerClosed)errors.push('Listener closure unproven');
  try{r.requestsAfter=await requests();r.requestsFrozenAfterCleanup=true;r.processResults=stdout.split('\n').filter(line=>line.startsWith('Fixture process-result: ')).map(line=>JSON.parse(line.slice('Fixture process-result: '.length))).map(p=>{let pidAbsent=false;try{process.kill(p.pid,0);}catch(e){if(e.code==='ESRCH')pidAbsent=true;else throw e;}return {...p,pidAbsent};});}catch{errors.push('Frozen evidence unavailable');}
  r.cleanup={errors,browserSessionAbsent,fixtureReaped:childClosed,servicesClosed,listenerClosed,ownedRootsRemoved:false,browserProfileRemoved:false,privateCredentialRemoved:false};
  if(!errors.length){for(const path of [root,profile,credential]){await rm(path,{recursive:true,force:true});await assert.rejects(lstat(path),e=>e.code==='ENOENT');}r.cleanup.ownedRootsRemoved=r.cleanup.browserProfileRemoved=r.cleanup.privateCredentialRemoved=true;}else{r.status='failed';r.retainedPrivateRoots=[root,profile,credential];}
  if(r.status==='passed'){try{verifyReconnectRecord(r);assert.equal(r.assetManifestSha256,await currentAssetDigest());}catch(error){r.status='failed';r.error=String(error.message).slice(0,1024);}}
  const report=join(destination,'reconnect.json');const serialized=JSON.stringify(r,null,2);assert(!serialized.includes(token));await writeFile(report,serialized,{mode:0o600,flag:'wx'});console.log(`Nonsecret evidence: ${report}`);if(r.status==='passed')await verifyReconnectFile(report);else process.exitCode=1;
}
