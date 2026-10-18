#!/usr/bin/env node
// Native-storage concurrent admission acceptance. Browser observations are read-only;
// the private release token is held by Node and is never passed through argv/eval.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { access, lstat, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { boundedCommand } from "./run_retained_browser_acceptance.mjs";
import { limitation, verifyConcurrencyFixtures, verifyConcurrencyReport, verifyStorage } from "./verify_retained_concurrency_report.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => process.argv.find((x) => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  assert(arg("fixtures")?.startsWith("/"), "Supply absolute --fixtures path");
  const summaryPath = await realpath(arg("fixtures"));
  const reportPath = resolve(arg("report") ?? join(tmpdir(), `wavedl-retained-concurrency-${randomUUID()}.json`));
  assert(summaryPath.endsWith(".json"), "Supply --fixtures=/absolute/path/to/summary.json");
  await assert.rejects(access(reportPath), "Report destination must not already exist");
  const python = process.env.WAVEDL_PYTHON ?? "python";
  const browser = process.env.AGENT_BROWSER_BIN ?? "agent-browser";
  const executable = process.env.WAVEDL_BROWSER_EXECUTABLE;
  if (executable) await access(executable);
  const owned = await realpath(await mkdtemp(join(tmpdir(), "wavedl-retained-concurrency-")));
  const ownedIdentity = await lstat(owned);
  const profile = join(owned, "profile");
  const fixtureRoot = join(owned, "fixture-root");
  const tokenFile = join(owned, "token");
  const token = randomBytes(32).toString("base64url");
  const report = { schemaVersion: 1, status: "running", limitation, fixtureSummary: summaryPath, started: new Date().toISOString(), cleanup: {} };
  let fixture;
  let fixtureOutput = "";
  const session = `wrc-${randomUUID().slice(0, 12)}`;
  let origin;
  let builds;
  let fixtureClosed = false;
  let fixtureClose;
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("AGENT_BROWSER_")) delete env[key];
  env.AGENT_BROWSER_SESSION = session;
  const command = (args, timeout = 35000) => boundedCommand(browser, ["--session", session, ...args], { cwd: repo, env, timeout });
  const poll = async (observe, ok, label, timeout = 60000) => {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      last = await observe();
      if (ok(last)) return last;
      await delay(100);
    }
    throw new Error(`${label} timed out: ${JSON.stringify(last).slice(0, 1000)}`);
  };
  const evalJson = async (expression) => JSON.parse(JSON.parse(await command(["eval", "-b", Buffer.from(expression).toString("base64")])));
  const storageExpression = `(async()=>JSON.stringify(await (async()=>{const names=await caches.keys();const dbs=await indexedDB.databases();let records=[];if(dbs.some(d=>d.name==='wavedl-retained-builds-v1'))records=await new Promise((res,rej)=>{const q=indexedDB.open('wavedl-retained-builds-v1');q.onerror=()=>rej(q.error);q.onsuccess=()=>{const d=q.result,t=d.transaction('builds','readonly'),g=t.objectStore('builds').getAll();g.onsuccess=()=>{res(g.result);d.close()};g.onerror=()=>rej(g.error)}});const cached=[];for(const n of names.filter(n=>n.startsWith('wavedl-retained-v1-'))){const c=await caches.open(n),a=[];for(const k of await c.keys()){const r=await c.match(k),b=await r.arrayBuffer(),h=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(x=>x.toString(16).padStart(2,'0')).join('');a.push({url:new URL(k.url).pathname,size:b.byteLength,sha256:h})}cached.push({name:n,assets:a})}return {records,cached,cacheNames:names,registrations:(await navigator.serviceWorker.getRegistrations()).map(r=>({scope:r.scope,active:r.active?.state,activeScript:r.active?.scriptURL,waiting:r.waiting?.state,installing:r.installing?.state}))}})()))()`;
  try {
    ({ builds } = await verifyConcurrencyFixtures(summaryPath));
    await writeFile(tokenFile, token, { flag: "wx", mode: 0o600 });
    assert.equal((await stat(tokenFile)).mode & 0o777, 0o600);
    fixture = spawn(python, ["tools/retained_concurrency_fixture.py", "--fixtures", summaryPath, "--root", fixtureRoot, "--token-file", tokenFile, "--port", "0"], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
    fixtureClose = new Promise((r) => fixture.once("close", (code) => { fixtureClosed = true; r(code); }));
    fixture.on("error", () => { fixtureClosed = true; });
    fixture.stdout.on("data", (c) => { if (fixtureOutput.length < 65536) fixtureOutput += c.toString(); });
    fixture.stderr.on("data", () => {});
    origin = await poll(async () => { if (fixture.exitCode !== null) throw new Error("Fixture exited before readiness"); const line = fixtureOutput.split("\n").find((l) => l.startsWith("{")); return line ? JSON.parse(line).origin : null; }, Boolean, "fixture origin");
    assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/, "Owned loopback fixture origin required");
    report.origin = origin;
    report.browser = await command(["--version"], 5000);
    report.runtime = { node: process.version, platform: process.platform, architecture: process.arch };
    report.allowedDomains = [new URL(origin).hostname];
    const openArgs = ["--headed", "false", "--engine", "chrome", "--profile", profile];
    if (executable) openArgs.push("--executable-path", executable);
    openArgs.push("--allowed-domains", "127.0.0.1,localhost", "--args", "--disable-gpu", "open", origin + "/");
    await command(openArgs);
    const initial = await poll(() => evalJson(storageExpression), (v) => v.records.length === 1 && v.records[0].status === "ready", "g1 warm registration");
    report.warm = initial;
    verifyStorage(initial, builds.slice(0, 1));
    const register = `Promise.all([navigator.serviceWorker.register(${JSON.stringify(origin + "/qa/g2/sw.js")},{scope:${JSON.stringify(origin + "/qa/g2/")}}),navigator.serviceWorker.register(${JSON.stringify(origin + "/qa/g3/sw.js")},{scope:${JSON.stringify(origin + "/qa/g3/")}})]).then(()=>true)`;
    await evalJson(`(()=>{void (${register}).catch(()=>{});return JSON.stringify(true)})()`);
    const status = async () => (await fetch(origin + "/qa/status", { cache: "no-store", signal: AbortSignal.timeout(5000) })).json();
    const candidateInitial = await poll(status, (s) => ["g2", "g3"].every((n) => s.inventorySeen?.includes(n)) && [1, 2].includes(s.barrierArrived?.length) && !s.released, "candidate metadata and admission", 5000);
    report.initialStatus = candidateInitial;
    const missing = ["g2", "g3"].find((n) => !candidateInitial.barrierArrived.includes(n));
    report.initialStorage = await poll(() => evalJson(storageExpression), (v) => v.records.length >= 2 && v.records.length <= 3, "initial admission snapshot", 5000);
    report.initialPage = await evalJson(`(async()=>JSON.stringify({url:location.href,text:document.body.innerText.slice(0,2048),registrations:(await navigator.serviceWorker.getRegistrations()).map(r=>({scope:r.scope,active:r.active?.state,waiting:r.waiting?.state,installing:r.installing?.state}))}))()`);
    if (missing) {
      report.retry = { namespace: missing, started: new Date().toISOString() };
      const retry = `navigator.serviceWorker.register(${JSON.stringify(origin + `/qa/${missing}/sw.js`)},{scope:${JSON.stringify(origin + `/qa/${missing}/`)}}).then(()=>true).catch(()=>false)`;
      await evalJson(`(async()=>JSON.stringify(await (${retry})))()`);
      report.retry.completed = new Date().toISOString();
    } else {
      report.retry = { namespace: null, started: null, completed: null };
    }
    const pending = await poll(status, (s) => ["g2", "g3"].every((n) => s.barrierArrived?.includes(n)) && !s.released, "both candidate barriers");
    report.pendingStatus = pending;
    report.pendingStorage = await evalJson(storageExpression);
    verifyStorage(report.pendingStorage, builds.slice(0, 3), true);
    const response = await fetch(origin + "/qa/release", { method: "POST", headers: { Authorization: `Bearer ${token}`, Origin: origin }, signal: AbortSignal.timeout(5000) });
    assert(response.ok, "Barrier release rejected");
    await poll(status, (s) => s.released === true && s.trace?.filter((x) => x.kind === "asset" && x.status === 200 && x.barrier).length === 2, "release completion");
    const finalStorage = await poll(() => evalJson(storageExpression), (v) => v.records.length === 3 && v.records.every((r) => r.status === "ready") && v.registrations.length === 3 && v.registrations.every((r) => r.active === "activated" && !r.waiting && !r.installing), "three ready records and active public registrations");
    report.final = { status: await status(), storage: finalStorage };
    verifyStorage(finalStorage, builds.slice(0, 3));
    assert.equal(finalStorage.records.filter((r) => r.status === "pending").length, 0);
    assert.equal(finalStorage.registrations.filter((r) => r.active === "activated").length, 3);
    const refusalExpression = `(async()=>{const out=[];const listener=(e)=>{const d=e?.data;if(d?.type==='WAVEDL_UPDATE_REFUSED'&&d.reason==='capacity'&&e.source?.scriptURL?.includes('/qa/g4'))out.push({type:d.type,reason:d.reason,scriptURL:e.source.scriptURL,role:e.source.scriptURL.match(/\\/qa\\/(g4[ab])\\/sw\\.js$/)?.[1]??null})};navigator.serviceWorker.addEventListener('message',listener);try{await Promise.all([navigator.serviceWorker.register(${JSON.stringify(origin + "/qa/g4a/sw.js")},{scope:${JSON.stringify(origin + "/qa/g4a/")}}),navigator.serviceWorker.register(${JSON.stringify(origin + "/qa/g4b/sw.js")},{scope:${JSON.stringify(origin + "/qa/g4b/")}})]).catch(()=>{});const until=Date.now()+5000;while(out.length<2&&Date.now()<until)await new Promise(r=>setTimeout(r,25));return JSON.stringify(out)}finally{navigator.serviceWorker.removeEventListener('message',listener)}})()`;
    const refusalMessages = await evalJson(refusalExpression);
    const capacityStatus = await status();
    report.capacity = {
      refusals: refusalMessages,
      scriptTrace: capacityStatus.trace.filter((t) => t.kind === "worker" && /^\/qa\/g4[ab]\/sw\.js$/.test(t.path)),
      inventoryTrace: capacityStatus.trace.filter((t) => t.kind === "inventory" && t.namespace === "g4"),
      postStorage: await evalJson(storageExpression),
    };
    assert.equal(report.capacity.refusals.length, 2, "Both g4 roles must report capacity refusal");
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.failure = String(error.message).replaceAll(token, "[REDACTED]").slice(0, 1200);
    if (origin) { try { report.failureStatus = await (await fetch(origin + "/qa/status", { cache: "no-store", signal: AbortSignal.timeout(5000) })).json(); } catch {} }
    try { report.failureStorage = await evalJson(storageExpression); } catch {}
    try { report.failurePage = await evalJson(`JSON.stringify({text:document.body.innerText,url:location.href})`); } catch {}
    try { report.failureBrowserConsole = (await command(["console"], 5000)).replaceAll(token, "[REDACTED]").slice(0, 12000); } catch {}
  } finally {
    try {
      await command(["close"], 10000);
      report.cleanup.browserClosed = true;
      await poll(async () => !(await boundedCommand(browser, ["session", "list"], { cwd: repo, env, timeout: 5000 })).includes(session), Boolean, "Owned session absence", 15000);
      report.cleanup.sessionAbsent = true;
    } catch { report.cleanup.browserClosed ??= false; report.cleanup.sessionAbsent = false; }
    if (fixture) {
      fixture.kill("SIGINT");
      await Promise.race([fixtureClose, delay(10000)]);
      if (!fixtureClosed) { fixture.kill("SIGTERM"); await Promise.race([fixtureClose, delay(2000)]); }
      if (!fixtureClosed) { fixture.kill("SIGKILL"); await Promise.race([fixtureClose, delay(2000)]); }
      report.cleanup.fixtureClosed = fixtureClosed;
      report.cleanup.fixtureExitCode = fixture.exitCode;
      report.cleanup.servicesClosed = fixtureOutput.split("\n").includes("servicesclose");
      if (fixtureClosed && origin) {
        const url = new URL(origin);
        report.cleanup.listenerRefused = await new Promise((r) => { const socket = connect(Number(url.port), url.hostname); socket.setTimeout(2000); socket.once("connect", () => { socket.destroy(); r(false); }); socket.once("timeout", () => { socket.destroy(); r(false); }); socket.once("error", (e) => { socket.destroy(); r(e.code === "ECONNREFUSED"); }); });
      }
    }
    if (report.cleanup.browserClosed && report.cleanup.sessionAbsent && report.cleanup.fixtureClosed && report.cleanup.servicesClosed && report.cleanup.listenerRefused) {
      const current = await lstat(owned);
      assert(current.isDirectory() && !current.isSymbolicLink() && current.dev === ownedIdentity.dev && current.ino === ownedIdentity.ino, "Owned cleanup directory identity changed");
      await rm(owned, { recursive: true, force: false });
      report.cleanup.ownedRemoved = true;
    }
    try { if (report.status === "passed") { await verifyConcurrencyFixtures(summaryPath); verifyConcurrencyReport(report, builds); } } catch (e) { report.status = "failed"; report.failure = String(e.message).replaceAll(token, "[REDACTED]").slice(0, 1200); }
    report.finished = new Date().toISOString();
    await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
  }
  console.log(JSON.stringify({ report: reportPath, status: report.status }));
  if (report.status !== "passed") process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error("Retained concurrency acceptance failed before report publication"); process.exitCode = 1; });
