#!/usr/bin/env node
// Legacy worker close/reopen acceptance.  The runner owns only its temporary
// fixture/profile and never mutates the checkout or a user browser profile.
import assert from "node:assert/strict";
import { cp, lstat, mkdir, readFile, readdir, rm, writeFile, rename, realpath, open } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { boundedCommand } from "./run_retained_browser_acceptance.mjs";
import { createBrowserActions, DRIVER_READINESS_MODE } from "./browser_actions.mjs";
import { openTrainingEditor } from "./browser_training_editor.mjs";
import { browserLaunchArgs } from "./browser_launch_policy.mjs";
import { verifyLegacyTransitionRecord } from "./verify_legacy_transition_report.mjs";

// Keep subprocess lifecycle bounded for the live phase (the transition driver
// delegates browser/fixture invocations through this exact helper).
export { boundedCommand };

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const currentAssets = join(repo, "src/wavedl_daemon/web_assets");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function readBoundedFile(path, limit = 128 * 1024 * 1024) {
  const before = await lstat(path);
  assert(before.isFile() && !before.isSymbolicLink() && before.size <= limit);
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await fd.stat();
    assert(stat.dev === before.dev && stat.ino === before.ino && stat.isFile());
    const buffer = Buffer.alloc(before.size + 1);
    let count = 0;
    while (count < buffer.length) {
      const result = await fd.read(buffer, count, buffer.length - count, null);
      if (!result.bytesRead) break;
      count += result.bytesRead;
    }
    assert(count === before.size && count <= limit);
    return buffer.subarray(0, count);
  } finally { await fd.close(); }
}

export async function inventoryAssets(root) {
  assert(!(await lstat(root)).isSymbolicLink());
  const manifestBytes = await readBoundedFile(join(root, ".wavedl-assets.json"), 1024 * 1024);
  const manifest = JSON.parse(manifestBytes);
  assert(manifest && !Array.isArray(manifest) && Object.keys(manifest).length <= 1024);
  const files = [];
  for (const [relative, expected] of Object.entries(manifest)) {
    assert(relative && !relative.startsWith("/") && !relative.includes("\\"));
    assert(relative.split("/").every(part => part && part !== "." && part !== ".."));
    for (let index = 1; index < relative.split("/").length; index++) {
      const ancestor = join(root, ...relative.split("/").slice(0, index));
      const stat = await lstat(ancestor);
      assert(stat.isDirectory() && !stat.isSymbolicLink());
    }
    const path = join(root, relative);
    const stat = await lstat(path);
    assert(stat.isFile() && !stat.isSymbolicLink(), `asset is not an ordinary file: ${relative}`);
    const bytes = await readBoundedFile(path);
    assert(bytes.length <= 128 * 1024 * 1024);
    const digest = sha256(bytes);
    assert.equal(digest, expected, `manifest digest mismatch: ${relative}`);
    files.push({ path: relative, size: bytes.length, sha256: digest, symlink: false });
  }
  const actual = [];
  async function walk(base, prefix = "") {
    for (const name of await readdir(base)) {
      const path = join(base, name), stat = await lstat(path), relative = prefix + name;
      assert(!stat.isSymbolicLink());
      if (stat.isDirectory()) await walk(path, relative + "/");
      else { assert(stat.isFile()); actual.push(relative); }
    }
  }
  await walk(root);
  assert.deepEqual(actual.sort(), [".wavedl-assets.json", ...Object.keys(manifest)].sort());
  return { sha256: sha256(manifestBytes), size: manifestBytes.length, text:manifestBytes.toString("utf8"), manifestFiles: files };
}

async function workerEvidence(root) {
  const bytes = await readFile(join(root, "sw.js"));
  const text = bytes.toString("utf8");
  const workbox = text.includes("workbox:core") && text.includes("precache-v2");
  let entries = [];
  if (workbox) {
    const candidates = [];
    for (const match of text.matchAll(/\[\s*\{\s*"(?:url|revision)"\s*:/g)) {
      const tail = text.slice(match.index);
      for (let index = tail.indexOf("]"); index >= 0; index = tail.indexOf("]", index + 1)) {
        try { const value = JSON.parse(tail.slice(0, index + 1));
          if (value.length && value.every(e => Object.keys(e).sort().join(",") === "revision,url")) candidates.push(value);
          break;
        } catch { /* Find the complete literal, never evaluate worker code. */ }
      }
    }
    assert.equal(candidates.length, 1);
    entries = candidates[0];
  }
  return { sha256: sha256(bytes), size: bytes.length, sourceText:text, workbox: { precache: workbox, entries, source: "actual sw.js" } };
}

export async function preflight({ legacy, report }) {
  const legacyRoot = resolve(legacy);
  const reportRoot = resolve(report);
  await mkdir(reportRoot, { recursive: true, mode: 0o700 });
  const legacyCopy = join(reportRoot, "legacy-assets");
  const currentCopy = join(reportRoot, "current-assets");
  const sourceLegacy = await inventoryAssets(legacyRoot);
  await cp(legacyRoot, legacyCopy, { recursive: true, errorOnExist: true, force: false });
  await cp(currentAssets, currentCopy, { recursive: true, errorOnExist: true, force: false });
  const legacyManifest = await inventoryAssets(legacyCopy);
  assert.deepEqual(sourceLegacy, legacyManifest);
  const currentManifest = await inventoryAssets(currentCopy);
  const record = {
    name: "legacy-worker-transition", status: "preflight", scope: "legacy-transition-only",
    legacy: { assetManifest: legacyManifest, serviceWorker: await workerEvidence(legacyCopy), manifestFiles: legacyManifest.manifestFiles },
    current: { assetManifest: currentManifest, serviceWorker: await workerEvidence(currentCopy), manifestFiles: currentManifest.manifestFiles },
    runId: randomUUID(), note: "Asset and Workbox provenance only; browser transition requires a live acceptance run.",
  };
  await writeFile(join(reportRoot, "legacy-worker-transition.json"), JSON.stringify(record, null, 2), { mode: 0o600 });
  return record;
}

const observeStorage = `(async()=>JSON.stringify(await (async () => {
  const names = await caches.keys(), cachesRead = [];
  for (const name of names) {
    const cache = await caches.open(name), files = [];
    for (const request of await cache.keys()) {
      const response = await cache.match(request), bytes = await response.arrayBuffer();
      files.push({url:new URL(request.url).pathname + new URL(request.url).search,
        size:bytes.byteLength, sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(v=>v.toString(16).padStart(2,'0')).join('')});
    }
    cachesRead.push({name,files});
  }
  const dbs = await indexedDB.databases(); let records = [];
  if (dbs.some(db=>db.name==='wavedl-retained-builds-v1')) records = await new Promise((resolve,reject)=>{
    const request = indexedDB.open('wavedl-retained-builds-v1'); request.onerror=()=>reject(new Error('read-only database failed'));
    request.onsuccess=()=>{const db=request.result, transaction=db.transaction('builds','readonly'), read=transaction.objectStore('builds').getAll();
      read.onsuccess=()=>resolve(read.result); read.onerror=()=>reject(new Error('read-only records failed')); transaction.oncomplete=()=>db.close();};
  });
  const registrations = await navigator.serviceWorker.getRegistrations();
  return {cacheNames:names,caches:cachesRead,records,controller:navigator.serviceWorker.controller?.scriptURL ?? null,
    registrations:registrations.map(r=>({scope:r.scope,active:r.active?.state ?? null,waiting:r.waiting?.state ?? null,installing:r.installing?.state ?? null}))};
})()))()`;

async function poll(read, accept, message, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await read(); if (accept(value)) return value; await new Promise(done=>setTimeout(done,100)); }
  throw new Error(message);
}

export async function runLegacyAcceptance({ legacy, report }) {
  assert(legacy.startsWith("/") && report.startsWith("/"), "absolute scoped paths required");
  const directory = resolve(report);
  await mkdir(directory, {recursive:true,mode:0o700});
  assert.equal((await readdir(directory)).length,0,"report directory must be empty");
  const record = await preflight({legacy,report});
  const owned = join(directory,"owned"), fixtureRoot = join(owned,"fixture"), profile = join(owned,"profile"), tokenFile = join(owned,"credential"), served = join(owned,"served"), downloads = join(owned,"downloads");
  const browser = process.env.AGENT_BROWSER_BIN ?? "agent-browser", python = process.env.WAVEDL_PYTHON ?? "python";
  const session = `wave-legacy-${randomUUID().slice(0,12)}`;
  let fixture, fixtureSpawnFailed = false, output = "", opened = false, origin, stage = "fixture-create";
  const secrets = new Set();
  const redact = value => {
    let text=String(value);
    for(const secret of secrets) if(secret)text=text.split(secret).join("[REDACTED]");
    return text.replace(/([?&]bootstrap=)[^\s"'&#]+/g,"$1[REDACTED]").slice(0,500);
  };
  const env = {...process.env,AGENT_BROWSER_SESSION:session};
  for (const key of Object.keys(env)) if (key.startsWith("AGENT_BROWSER_") && key !== "AGENT_BROWSER_SESSION") delete env[key];
  const cli = (...args)=>boundedCommand(browser,["--session",session,...args],{cwd:repo,env,timeout:35000});
  const dom = async expression=>JSON.parse(JSON.parse(await cli("eval","-b",Buffer.from(expression).toString("base64"))));
  const actions = createBrowserActions({cli,dom,snapshot:()=>cli("snapshot","-i")});
  const button = name=>actions.button(name);
  const sessionAbsent = async()=>!(await boundedCommand(browser,["session","list"],{cwd:repo,env,timeout:10000})).includes(session);
  const closeBrowser = async()=>{ await cli("close"); await poll(sessionAbsent,Boolean,"owned session close timeout",15000); opened=false; };
  const launch = async url=>{
    opened=true;
    await cli("--headed",String(process.env.WAVEDL_BROWSER_HEADED === "true"),"--engine","chrome","--profile",profile,"--allowed-domains","127.0.0.1,localhost","--args",browserLaunchArgs,
      ...(process.env.WAVEDL_BROWSER_EXECUTABLE ? ["--executable-path",process.env.WAVEDL_BROWSER_EXECUTABLE] : []),"open",url);
    const tabs = JSON.parse(await cli("--json","tab","list"));
    const tab=tabs.data?.tabs?.find(t=>t.active && typeof t.url === "string" && new URL(t.url).origin===origin);
    assert(tab && /^t[1-9][0-9]*$/.test(tab.tabId)); await cli("tab",tab.tabId); await cli("set","viewport","1280","900");
  };
  try {
    await mkdir(owned,{mode:0o700}); for (const path of [fixtureRoot,profile,downloads]) await mkdir(path,{mode:0o700});
    record.initiallyEmptyProfile=(await readdir(profile)).length===0;assert(record.initiallyEmptyProfile);
    const token=randomBytes(32).toString("base64url");secrets.add(token);
    await writeFile(tokenFile,token,{mode:0o600});
    await cp(join(directory,"legacy-assets"),served,{recursive:true,errorOnExist:true,force:false});
    record.driverReadinessMode=DRIVER_READINESS_MODE;
    record.browser=(await boundedCommand(browser,["--version"],{cwd:repo,env,timeout:10000})).trim();
    fixture=spawn(python,["tools/browser_daemon_fixture.py","--root",fixtureRoot,"--unseeded","--token-file",tokenFile,"--web-assets",served],
      {cwd:repo,env:{...process.env,PYTHONPATH:join(repo,"src"),OMP_NUM_THREADS:"1",MKL_NUM_THREADS:"1"},stdio:["ignore","pipe","pipe"]});
    fixture.stdout.on("data",chunk=>{output=(output+chunk).slice(-65536);}); fixture.stderr.on("data",()=>{});
    fixture.on("error",()=>{fixtureSpawnFailed=true;});
    const bootstrap=await poll(()=>{assert(!fixtureSpawnFailed,"Fixture failed to start");assert(fixture.exitCode===null);return output.match(/Browser: (http:\/\/[^\s]+)/)?.[1];},Boolean,"fixture bootstrap timeout");
    origin=new URL(bootstrap).origin;
    secrets.add(bootstrap);secrets.add(new URL(bootstrap).searchParams.get("bootstrap"));
    assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/,"Owned loopback origin required");
    stage="legacy-public-connect"; await launch(bootstrap); await cli("wait","--text","Connected");
    const initial=await poll(()=>dom(observeStorage),s=>s.controller && s.cacheNames.some(n=>n.startsWith("workbox-precache-v2-")),"legacy worker installation timeout");
    assert(record.legacy.serviceWorker.workbox.precache,"legacy must be actual Workbox");
    const precache=initial.caches.find(c=>c.name.startsWith("workbox-precache-v2-"));
    const expected=record.legacy.serviceWorker.workbox.entries.map(e=>new URL(e.url,origin).pathname).sort();
    assert.deepEqual(precache.files.map(f=>new URL(f.url,origin).pathname).sort(),expected);
    record.initial={origin,connect:{public:true,oneTimeBootstrap:true},storage:initial};
    stage="author-legacy-draft"; await button("New training run");
    const rootSelector=await actions.readyControl("field","Configured root",false,{locator:'xpath=//*[@role="combobox" and @aria-label="Configured root"]'});
    await cli("click",rootSelector); await actions.option("datasets");
    await cli("wait","--text","samples.npz");await button("Select file samples.npz");
    await cli("wait","--fn","Array.from(document.querySelectorAll('p')).some(e=>e.textContent.trim().startsWith('Dataset: ')&&e.textContent.includes('/samples.npz'))");
    stage="legacy-model-selection";await button("Next step");await cli("wait","--text","Choose CNN");await button("Choose CNN");
    await cli("wait","--fn","Array.from(document.querySelectorAll('p')).some(e=>e.textContent.trim().startsWith('Model: cnn'))");
    stage="legacy-full-editor";await openTrainingEditor({button,cli,dom});
    const interpreter=(await boundedCommand(python,["-c","import sys;print(sys.executable)"],{cwd:repo,timeout:10000})).trim();
    stage="legacy-runtime-authoring";await actions.fill("Python interpreter",interpreter);
    stage="legacy-epochs-authoring";await actions.fill("epochs","11");
    stage="legacy-export-panel";await actions.expandSummary("Standalone configuration export");
    const download=join(downloads,"legacy-authored.yaml"), selector=await actions.readyControl("button","Download YAML");
    stage="legacy-yaml-download";await cli("download",selector,download);
    const bytes=await readBoundedFile(download,1024*1024);
    const yaml=JSON.parse(await boundedCommand(python,["-c","import json,sys,yaml; from pathlib import Path; print(json.dumps(yaml.safe_load(Path(sys.argv[1]).read_text())))",download],{cwd:repo,timeout:10000}));
    assert.equal(yaml.epochs,11); for (const key of ["runtime","environment","token","access_token","output_dir"]) assert(!Object.hasOwn(yaml,key));
    record.authoring={yaml,yamlText:bytes.toString("utf8"),filename:"legacy-authored.yaml",size:bytes.length,sha256:sha256(bytes),savedExternalBeforeClose:true};
    stage="close-before-swap";await closeBrowser();assert((await readdir(profile)).length>0);record.close={sessionAbsent:true,profilePreserved:true,allOwnedDocumentsClosed:true};
    await rename(served,join(owned,"previous"));await cp(join(directory,"current-assets"),served,{recursive:true,errorOnExist:true,force:false});
    assert.deepEqual(await inventoryAssets(served),record.current.assetManifest);
    record.swap={afterOwnedSessionClosed:true,currentOnly:true};
    stage="reopen-current";await launch(origin+"/");
    record.updateConsent={clicked:false,automaticActivation:false};
    const current=JSON.parse(await readBoundedFile(join(served,"offline-build.json"),1024*1024));
    const next=await poll(async()=>{
      const state=await dom(observeStorage);
      if (state.registrations.some(r=>r.waiting) && !record.updateConsent.clicked) {
        await cli("wait","--text","Update and reload");await button("Update and reload");record.updateConsent.clicked=true;
      }
      return state;
    },s=>s.records.some(r=>r.status==="ready" && r.inventory?.build_key===current.build_key) && s.registrations.some(r=>r.active==="activated" && !r.waiting),"current retained worker activation timeout",90000);
    const ready=next.records.find(r=>r.status==="ready" && r.inventory?.build_key===current.build_key);
    const cache=next.caches.find(c=>c.name === ready.cacheName);
    assert(cache,"ready current cache absent");
    assert.deepEqual(cache.files.map(f=>({url:f.url,sha256:f.sha256,size:f.size})).sort((a,b)=>a.url.localeCompare(b.url)),current.assets.map(a=>({url:a.url,sha256:a.sha256,size:a.size})).sort((a,b)=>a.url.localeCompare(b.url)));
    const page=await dom("JSON.stringify({entries:Array.from(document.querySelectorAll('script[src]')).map(e=>new URL(e.src).pathname),controller:navigator.serviceWorker.controller?.scriptURL,bootstrapAbsent:!location.search.includes('bootstrap'),text:document.body.innerText.includes('Disconnected')})");
    const html=(await readBoundedFile(join(served,"index.html"))).toString("utf8");
    const entryUrls=[...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m=>new URL(m[1],origin).pathname);
    assert(entryUrls.length>0 && entryUrls.every(url=>page.entries.includes(url)),"actual current document entry URLs absent");
    assert(page.bootstrapAbsent);
    record.reopen={sameProfile:true,origin,currentBuild:current,storage:next,page,entryUrls,legacyCacheDeleted:initial.cacheNames.filter(n=>!next.cacheNames.includes(n)),legacyCacheRemaining:initial.cacheNames.filter(n=>next.cacheNames.includes(n)),draftRestorationRequired:false};
    record.status="passed";
  } catch(error) {
    record.status="failed";record.failure={stage,privateOutputSuppressed:true,message:redact(error?.message??"acceptance failed")};
  } finally {
    const errors=[];let absent=!opened;
    if(opened)try{await closeBrowser();absent=true;}catch{errors.push("owned-browser-close-unconfirmed");}
    if(fixture && fixture.exitCode===null && fixture.signalCode===null)fixture.kill("SIGINT");
    let exited=!fixture||fixtureSpawnFailed;
    if(fixture&&!fixtureSpawnFailed)try{await poll(()=>fixture.exitCode!==null||fixture.signalCode!==null,Boolean,"fixture-exit",15000);exited=true;}catch{fixture.kill("SIGKILL");errors.push("fixture-graceful-exit-unconfirmed");}
    const servicesClosed=!fixture || fixtureSpawnFailed || output.includes("Fixture: services-closed");if(!servicesClosed)errors.push("services-close-unconfirmed");
    let listenerClosed=!origin;
    if(origin)listenerClosed=await new Promise(done=>{const sock=connect(Number(new URL(origin).port),"127.0.0.1");sock.setTimeout(2000);sock.once("connect",()=>{sock.destroy();done(false);});sock.once("error",error=>{sock.destroy();done(error.code==="ECONNREFUSED");});sock.once("timeout",()=>{sock.destroy();done(false);});});
    if(!listenerClosed)errors.push("fixture-listener-still-live");
    record.cleanup={errors,browserSessionAbsent:absent,fixtureExited:exited,servicesClosed,listenerClosed,ownedRemoved:false,profileRemoved:false,privateCredentialRemoved:false};
    if(absent&&exited&&servicesClosed&&listenerClosed&&errors.length===0){
      for(const path of [owned,join(directory,"legacy-assets"),join(directory,"current-assets")])await rm(path,{recursive:true,force:true});
      record.cleanup.ownedRemoved=true;record.cleanup.profileRemoved=true;record.cleanup.privateCredentialRemoved=true;
    }
    if(errors.length)record.status="failed";
    if(record.status==="passed")try{verifyLegacyTransitionRecord(record,directory);}catch{record.status="failed";record.failure={stage:"independent-record-verifier",privateOutputSuppressed:true};}
    await writeFile(join(directory,"legacy-worker-transition.json"),JSON.stringify(record,null,2),{mode:0o600});
  }
  assert.equal(record.status,"passed",`legacy acceptance failed at ${record.failure?.stage ?? "cleanup"}; private details suppressed`);
  return record;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const legacyArg = process.argv.find((arg) => arg.startsWith("--legacy="));
  const reportArg = process.argv.find((arg) => arg.startsWith("--report="));
  if (!legacyArg || !reportArg) throw new Error("Usage: run_legacy_browser_acceptance.mjs --legacy=/absolute/assets --report=/absolute/report");
  await runLegacyAcceptance({ legacy: legacyArg.slice(9), report: reportArg.slice(9) });
  console.log("legacy worker transition acceptance passed");
}
