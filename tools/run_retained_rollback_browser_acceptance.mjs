#!/usr/bin/env node
// Only fault injection is an HTTP response in the owned fixture. Browser storage
// uses the unmodified genuine worker, native CacheStorage, and native IndexedDB.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { access, lstat, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { boundedCommand } from "./run_retained_browser_acceptance.mjs";
import { verifyConcurrencyFixtures, verifyStorage } from "./verify_retained_concurrency_report.mjs";
import {
  rollbackLimitation,
  verifyRollbackReport,
} from "./verify_retained_rollback_browser_report.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => process.argv.find((x) => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
// Subclass the immutable validated fixture without modifying its source. The
// second inventory fetch pauses after one successful native cache.put, then
// returns HTTP 503 on explicit authenticated release. No synthetic worker/storage.
export const faultFixtureCode = `
import asyncio, secrets
import retained_concurrency_fixture as base
from starlette.responses import JSONResponse, Response
Original = base.Fixture
class FaultFixture(Original):
    async def asset(self, request):
        namespace = self._namespace(request)
        fault = list(self.assets['g4'])[1]
        if namespace != 'g4' or request.url.path != fault:
            return await super().asset(request)
        entry = dict(namespace='g4', path=fault, startISO=base._now(), endISO=None,
                     status='held', sha256=None, size=0, kind='asset', barrier=True,
                     injected='http-503')
        await self._record(entry)
        try:
            await asyncio.wait_for(self.release.wait(), 30)
        except TimeoutError:
            entry.update(endISO=base._now(), status=504)
            return Response(status_code=504)
        entry.update(endISO=base._now(), status=503)
        return Response(status_code=503, headers={'Cache-Control':'no-store'})
    async def release_handler(self, request):
        if request.headers.get('origin') != self.origin or not secrets.compare_digest(
            request.headers.get('authorization', ''), 'Bearer ' + self.token):
            return JSONResponse({'error':'unauthorized'}, status_code=403)
        if not any(t.get('injected') == 'http-503' and t['status'] == 'held' for t in self.trace):
            return JSONResponse({'error':'not held'}, status_code=409)
        self.released = True
        self.release.set()
        return JSONResponse({'released':True})
base.Fixture = FaultFixture
base.main()
`;

export const storageExpression = `(async()=>JSON.stringify(await (async()=>{
 const cacheNames=await caches.keys(), dbs=await indexedDB.databases();let records=[];
 if(dbs.some(d=>d.name==='wavedl-retained-builds-v1'))records=await new Promise((res,rej)=>{
 const q=indexedDB.open('wavedl-retained-builds-v1');q.onerror=()=>rej(q.error);q.onsuccess=()=>{
 const d=q.result,t=d.transaction('builds','readonly'),g=t.objectStore('builds').getAll();
 g.onsuccess=()=>res(g.result);g.onerror=()=>rej(g.error);t.oncomplete=()=>d.close()}});
 const cached=[];for(const name of cacheNames.filter(n=>n.startsWith('wavedl-retained-v1-'))){
 const c=await caches.open(name),assets=[];for(const k of await c.keys()){
 const b=await (await c.match(k)).arrayBuffer(),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(x=>x.toString(16).padStart(2,'0')).join('');
 assets.push({url:new URL(k.url).pathname,size:b.byteLength,sha256})}cached.push({name,assets})}
 return {records,cached,cacheNames,registrations:(await navigator.serviceWorker.getRegistrations()).map(r=>({scope:r.scope,active:r.active?.state,activeScript:r.active?.scriptURL,waiting:r.waiting?.state,installing:r.installing?.state}))}
 })()))()`;
const pageExpression = `JSON.stringify({url:location.href,timeOrigin:performance.timeOrigin,controller:navigator.serviceWorker.controller?.scriptURL,entries:Array.from(document.querySelectorAll('script[src]')).map(s=>new URL(s.src).pathname)})`;

async function main() {
  assert(arg("fixtures")?.startsWith("/"), "Supply absolute --fixtures summary path");
  const summaryPath = await realpath(arg("fixtures"));
  const reportPath = resolve(
    arg("report") ?? join(tmpdir(), `wavedl-retained-rollback-${randomUUID()}.json`),
  );
  await assert.rejects(access(reportPath), "Report destination must not exist");
  const { builds } = await verifyConcurrencyFixtures(summaryPath);
  const owned = await realpath(await mkdtemp(join(tmpdir(), "wavedl-retained-rollback-")));
  const identity = await lstat(owned),
    session = `wrr-${randomUUID().slice(0, 12)}`;
  const token = randomBytes(32).toString("base64url");
  const tokenFile = join(owned, "token");
  const browser = process.env.AGENT_BROWSER_BIN ?? "agent-browser";
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("AGENT_BROWSER_")) delete env[key];
  env.AGENT_BROWSER_SESSION = session;
  const cli = (args, timeout = 35000) =>
    boundedCommand(browser, ["--session", session, ...args], { cwd: repo, env, timeout });
  const dom = async (expression) =>
    JSON.parse(JSON.parse(await cli(["eval", "-b", Buffer.from(expression).toString("base64")])));
  const poll = async (observe, ok, label, timeout = 60000) => {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      last = await observe();
      if (ok(last)) return last;
      await delay(100);
    }
    throw new Error(`${label} timed out`);
  };
  const report = {
    schemaVersion: 1,
    mode: "native-storage-install-rollback",
    status: "running",
    limitation: rollbackLimitation,
    fixtureSummary: summaryPath,
    started: new Date().toISOString(),
    cleanup: {},
  };
  let fixture,
    fixtureClose,
    fixtureClosed = false,
    origin,
    output = "",
    opened = false;
  try {
    await writeFile(tokenFile, token, { flag: "wx", mode: 0o600 });
    fixture = spawn(
      process.env.WAVEDL_PYTHON ?? "python",
      [
        "-c",
        faultFixtureCode,
        "--fixtures",
        summaryPath,
        "--root",
        join(owned, "fixture-root"),
        "--token-file",
        tokenFile,
        "--port",
        "0",
      ],
      {
        cwd: repo,
        env: { ...process.env, PYTHONPATH: join(repo, "tools") },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    fixtureClose = new Promise((r) =>
      fixture.once("close", (code) => {
        fixtureClosed = true;
        r(code);
      }),
    );
    fixture.on("error", () => {
      fixtureClosed = true;
    });
    fixture.stdout.on("data", (c) => {
      if (output.length < 65536) output += c.toString();
    });
    fixture.stderr.on("data", () => {});
    origin = await poll(
      async () => {
        if (fixtureClosed) throw new Error("Fixture exited before readiness");
        const line = output.split("\n").find((l) => l.startsWith("{"));
        return line ? JSON.parse(line).origin : null;
      },
      Boolean,
      "fixture",
    );
    assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    report.origin = origin;
    report.browser = await cli(["--version"]);
    const args = [
      "--headed",
      "false",
      "--engine",
      "chrome",
      "--profile",
      join(owned, "profile"),
      "--allowed-domains",
      "127.0.0.1,localhost",
      "--args",
      "--disable-gpu",
    ];
    if (process.env.WAVEDL_BROWSER_EXECUTABLE)
      args.push("--executable-path", process.env.WAVEDL_BROWSER_EXECUTABLE);
    opened = true;
    await cli([...args, "open", origin + "/"]);
    report.warm = await poll(
      () => dom(storageExpression),
      (v) =>
        v.records.length === 1 &&
        v.records[0].status === "ready" &&
        v.registrations[0]?.active === "activated",
      "warm g1",
    );
    verifyStorage(report.warm, [builds[0]]);
    await cli(["wait", "--fn", "!!navigator.serviceWorker.controller"]);
    report.pageBefore = await dom(pageExpression);
    report.failureAsset = builds[3].inventory.assets[1].url;
    // Hold references only to public native ServiceWorker instances for state
    // observation. No worker internals, SDK imports, storage writes, or patching.
    await dom(
      `(()=>{window.__rollbackObservation={states:[],refusals:[]};navigator.serviceWorker.addEventListener('message',e=>{if(e.data?.type==='WAVEDL_UPDATE_REFUSED')window.__rollbackObservation.refusals.push({...e.data,scriptURL:e.source?.scriptURL})});void navigator.serviceWorker.register(${JSON.stringify(origin + "/qa/g4a/sw.js")},{scope:${JSON.stringify(origin + "/qa/g4a/")}}).then(r=>{const watch=()=>{const w=r.installing;if(!w)return;window.__rollbackObservation.worker=w;window.__rollbackObservation.states.push(w.state);w.addEventListener('statechange',()=>window.__rollbackObservation.states.push(w.state))};watch();r.addEventListener('updatefound',watch)}).catch(()=>{});return JSON.stringify(true)})()`,
    );
    const status = async () =>
      (await fetch(origin + "/qa/status", { signal: AbortSignal.timeout(5000) })).json();
    report.heldTrace = await poll(
      status,
      (s) => s.trace.some((t) => t.injected === "http-503" && t.status === "held"),
      "fault held",
    );
    report.pending = await dom(storageExpression);
    verifyStorage(report.pending, [builds[0], builds[3]], true);
    const release = await fetch(origin + "/qa/release", {
      method: "POST",
      headers: { Origin: origin, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    assert(release.ok, "Authenticated fault release failed");
    report.terminal = await poll(
      () =>
        dom(
          `JSON.stringify({state:window.__rollbackObservation.worker?.state,scriptURL:window.__rollbackObservation.worker?.scriptURL,states:window.__rollbackObservation.states})`,
        ),
      (v) => v.state === "redundant",
      "failed worker redundant",
    );
    report.refusal = await poll(
      () =>
        dom(
          `JSON.stringify(window.__rollbackObservation.refusals.find(r=>r.scriptURL===${JSON.stringify(origin + "/qa/g4a/sw.js")})??null)`,
        ),
      Boolean,
      "verification refusal",
    );
    report.after = await poll(
      () => dom(storageExpression),
      (v) => v.records.length === 1 && v.cacheNames.length === 1 && v.registrations.length === 1,
      "owned rollback finished",
    );
    report.pageAfter = await dom(pageExpression);
    report.trace = await status();
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.failure = String(error.message).replaceAll(token, "[REDACTED]").slice(0, 1200);
  } finally {
    try {
      if (opened) {
        await cli(["close"]);
        report.cleanup.browserClosed = true;
        await poll(
          async () =>
            !(
              await boundedCommand(browser, ["session", "list"], { cwd: repo, env, timeout: 5000 })
            ).includes(session),
          Boolean,
          "session absent",
          15000,
        );
        report.cleanup.sessionAbsent = true;
      }
    } catch {
      report.cleanup.browserError = "Owned browser close failed";
      report.status = "failed";
    }
    if (fixture && !fixtureClosed) {
      fixture.kill("SIGINT");
      const code = await Promise.race([fixtureClose, delay(10000).then(() => null)]);
      report.cleanup.fixtureExitCode = code;
      report.cleanup.fixtureClosed = fixtureClosed;
      if (!fixtureClosed) {
        fixture.kill("SIGKILL");
        await Promise.race([fixtureClose, delay(3000)]);
      }
    }
    report.cleanup.servicesClosed = output.includes("servicesclose");
    if (origin)
      report.cleanup.listenerRefused = await new Promise((r) => {
        const u = new URL(origin),
          s = connect(Number(u.port), u.hostname);
        s.once("connect", () => {
          s.destroy();
          r(false);
        });
        s.once("error", (e) => r(e.code === "ECONNREFUSED"));
        s.setTimeout(2000, () => {
          s.destroy();
          r(false);
        });
      });
    if (
      report.cleanup.browserClosed &&
      report.cleanup.sessionAbsent &&
      report.cleanup.fixtureClosed &&
      report.cleanup.servicesClosed &&
      report.cleanup.listenerRefused &&
      report.cleanup.fixtureExitCode === 0
    ) {
      const current = await lstat(owned);
      assert(
        current.dev === identity.dev && current.ino === identity.ino && !current.isSymbolicLink(),
      );
      await rm(owned, { recursive: true });
      report.cleanup.ownedRemoved = true;
    }
    try {
      if (report.status === "passed") {
        await verifyConcurrencyFixtures(summaryPath);
        verifyRollbackReport(report, builds);
      }
    } catch (e) {
      report.status = "failed";
      report.failure = String(e.message).replaceAll(token, "[REDACTED]").slice(0, 1200);
    }
    report.finished = new Date().toISOString();
    const serialized = JSON.stringify(report, null, 2);
    assert(!serialized.includes(token));
    await writeFile(reportPath, serialized, { flag: "wx", mode: 0o600 });
  }
  console.log(JSON.stringify({ report: reportPath, status: report.status }));
  if (report.status !== "passed") process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => {
    console.error("Native rollback failed before report publication");
    process.exitCode = 1;
  });
