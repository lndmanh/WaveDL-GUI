#!/usr/bin/env node
// Uses only an owned daemon, private profile and packaged application assets.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { boundedCommand } from "./run_retained_browser_acceptance.mjs";
import { browserLaunchArgs } from "./browser_launch_policy.mjs";
import { createBrowserActions } from "./browser_actions.mjs";
import { coldOfflineLimitation, verifyColdOfflineFile } from "./verify_cold_offline_browser_report.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const python = process.env.WAVEDL_PYTHON;
assert(python?.startsWith("/"), "Explicit absolute WAVEDL_PYTHON required");
assert(!process.env.WAVEDL_BROWSER_ASSETS, "Only the packaged browser assets are accepted");
const reportPath = resolve(process.argv[2]);
await assert.rejects(access(reportPath), { code: "ENOENT" });
const workspace = await realpath(await mkdtemp(join(tmpdir(), "wavedl-cold-offline-")));
assert(!reportPath.startsWith(workspace + "/"));
const profile = join(workspace, "profile"), root = join(workspace, "daemon"), tokenFile = join(workspace, "token");
await mkdir(profile, { mode: 0o700 }); await mkdir(root, { mode: 0o700 });
const token = randomBytes(32).toString("base64url");
await writeFile(tokenFile, token, { mode: 0o600, flag: "wx" });
const session = `cold-offline-${randomUUID()}`;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")));
const command = (binary, args, timeout = 35000) => boundedCommand(binary, args, { cwd: repo, env, timeout });
const cli = (...args) => {
  record.command = args[0];
  return command("agent-browser", ["--session", session, ...args]);
};
const dom = async expression => JSON.parse(JSON.parse(await cli("eval", "-b", Buffer.from(expression).toString("base64"))));
const actions = createBrowserActions({ cli, dom, snapshot: () => cli("snapshot", "-i") });
const poll = async (get, accepts, label, timeout = 45000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await get();
    if (accepts(value)) return value;
    await new Promise(done => setTimeout(done, 100));
  }
  throw new Error("Bounded observation failed: " + label);
};
const child = spawn(python, ["tools/browser_daemon_fixture.py", "--root", root, "--unseeded", "--token-file", tokenFile], {
  cwd: repo, env: { ...env, PYTHONPATH: join(repo, "src") }, stdio: ["ignore", "pipe", "pipe"],
});
let output = "", overflow = false, spawnError = false, fixtureClosed = false, opened = false;
child.once("error", () => { spawnError = true; });
child.once("close", () => { fixtureClosed = true; });
child.stdout.on("data", chunk => {
  if (Buffer.byteLength(output) + chunk.length > 1048576) overflow = true;
  else if (!overflow) output += chunk;
});
child.stderr.on("data", () => {});
const record = { name: "cold-offline-browser", status: "running", limitation: coldOfflineLimitation, pages: [] };
const snapshot = async () => JSON.parse(await command(python, ["-c", `import hashlib,json,sqlite3,sys
from pathlib import Path
p=Path(sys.argv[1]); c=sqlite3.connect((p/'state/registry.db').as_uri()+'?mode=ro',uri=True)
counts={t:c.execute('SELECT COUNT(*) FROM '+t).fetchone()[0] for t in ('runs','plans','plan_control','execution_control','submission_control','event_log')}
sources={}
for name in ('samples.npz','samples.mat','samples.h5'):
 f=p/name
 if f.is_symlink() or not f.is_file() or f.stat().st_size>16777216: raise ValueError('Unsafe source')
 b=f.read_bytes(); sources[name]={'size':len(b),'sha256':hashlib.sha256(b).hexdigest()}
print(json.dumps({'counts':counts,'sources':sources}))`, root]));
const launch = async url => {
  opened = true;
  await cli("open", url, "--profile", profile, "--engine", "chrome", "--headed", "false", "--allowed-domains", "127.0.0.1,localhost", "--args", browserLaunchArgs);
};
const closeBrowser = async () => {
  if (opened) await cli("close");
  await poll(() => command("agent-browser", ["session", "list"], 10000), value => !value.split("\n").some(line => line.trim() === session), "owned browser closure", 15000);
  opened = false;
};
const stopFixture = async () => {
  if (!fixtureClosed && child.exitCode === null && child.signalCode === null) child.kill("SIGINT");
  await poll(async () => fixtureClosed, Boolean, "fixture close", 30000);
  assert(output.includes("Fixture: services-closed") && !overflow && !spawnError);
};
const listenerRefused = async () => {
  try { await fetch(record.origin + "/api/health", { signal: AbortSignal.timeout(2000) }); return false; }
  catch (error) { return error.cause?.code === "ECONNREFUSED"; }
};
try {
  record.stage = "fixture-readiness";
  const ready = await poll(async () => output, value => {
    assert(!overflow && !spawnError && child.exitCode === null);
    return value.includes("Browser: ");
  }, "daemon ready", 180000);
  const url = ready.match(/Browser: (http:\/\/\S+)/)[1];
  record.origin = new URL(url).origin;
  record.initialProfileEmpty = (await readdir(profile)).length === 0;
  record.browser = (await command("agent-browser", ["--version"])).trim();
  record.assetManifestSha256 = createHash("sha256").update(await readFile(join(repo, "src/wavedl_daemon/web_assets/.wavedl-assets.json"))).digest("hex");
  record.before = await snapshot();
  record.stage = "online-worker-admission";
  await launch(url); await cli("set", "viewport", "1280", "900");
  await cli("wait", "--text", "Connected");
  record.online = await poll(() => dom("JSON.stringify({connected:document.body.innerText.includes('Connected'),bootstrapRemoved:!location.href.includes('bootstrap'),controller:navigator.serviceWorker.controller?.scriptURL??null,timeOrigin:performance.timeOrigin,userAgent:navigator.userAgent})"), value => value.controller === record.origin + "/sw.js", "packaged worker controls online page");
  record.cache = await dom(`(async()=>{const paths=[],roots=[];for(const name of await caches.keys()){const cache=await caches.open(name);for(const req of await cache.keys()){const u=new URL(req.url);paths.push(u.pathname);if(u.pathname==='/'){const r=await cache.match(req),b=await r.arrayBuffer();roots.push({size:b.byteLength,sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('')});}}}return JSON.stringify({paths:paths.sort(),root:roots.length===1?roots[0]:null});})()`);
  await actions.button("Settings");
  record.feedback = await dom("JSON.stringify((()=>{const a=document.querySelector('section[aria-labelledby=\"about-heading\"] a');return {href:a.href,target:a.target,rel:a.rel,referrerPolicy:a.referrerPolicy};})())");
  await closeBrowser(); record.firstBrowserClosed = true;
  await stopFixture();
  assert(await listenerRefused()); record.daemonStoppedBeforeRestart = true;
  record.stage = "cold-process-navigation";
  // Reopen the owned origin before toggling offline. This lets the persisted
  // service worker perform the cold navigation without relying on about:blank,
  // which agent-browser intentionally rejects under the allowed-domain fence.
  await launch(record.origin + "/");
  record.coldStart = await poll(() => dom("JSON.stringify({controller:navigator.serviceWorker.controller?.scriptURL??null,timeOrigin:performance.timeOrigin,shell:document.body.innerText.includes('WaveDL'),navigationWorkerStart:performance.getEntriesByType('navigation')[0]?.workerStart??0})"), value => value.shell && value.controller === record.origin + "/sw.js", "cold persisted worker shell");
  for (const path of ["/experiments?offline=1", "/runs/11111111-1111-4111-8111-111111111111", "/settings/storage"]) {
    record.stage = "offline-navigation:" + path;
    await cli("open", record.origin + path);
    await cli("set", "offline", "on");
    await poll(() => dom("JSON.stringify({shell:document.body.innerText.includes('WaveDL'),controller:navigator.serviceWorker.controller?.scriptURL??null,online:navigator.onLine})"), value => value.shell && value.controller === record.origin + "/sw.js" && value.online === false, "offline verified shell navigation");
    const page = await dom(`(async()=>{const refused=async(method)=>{try{await fetch('/api/health',{method,cache:'no-store'});return false;}catch{return true;}};return JSON.stringify({path:location.pathname+location.search,href:location.href,timeOrigin:performance.timeOrigin,controller:navigator.serviceWorker.controller?.scriptURL??null,online:navigator.onLine,shell:document.body.innerText.includes('WaveDL'),offlineNotice:document.body.innerText.includes('Offline'),liveRun:!!document.querySelector('[aria-label="Selected run"]'),approvedPlan:!!document.querySelector('[aria-label="Approved normalized manifest"]'),enabledMutations:Array.from(document.querySelectorAll('button')).filter(b=>b.getClientRects().length&&!b.disabled&&/^(?:Approve and start this plan|Cancel run|Preview.*plan)$/.test(b.textContent.trim())).length,apiReadRefused:await refused('GET'),apiMutationRefused:await refused('POST'),storage:{local:Object.keys(localStorage),session:Object.keys(sessionStorage),cookies:document.cookie},scripts:Array.from(document.scripts).filter(s=>s.src).map(s=>new URL(s.src).pathname),workerResourceCount:performance.getEntriesByType('resource').filter(r=>r.workerStart>0).length});})()`);
    record.pages.push(page);
  }
  await cli("set", "offline", "off");
  record.stage = "network-restoration";
  record.onlineAgain = await poll(() => dom("JSON.stringify({online:navigator.onLine,explicitReconnect:document.body.innerText.includes('Reconnect explicitly')||document.body.innerText.includes('Connect securely'),enabledMutations:Array.from(document.querySelectorAll('button')).filter(b=>b.getClientRects().length&&!b.disabled&&/^(?:Approve and start this plan|Cancel run|Preview.*plan)$/.test(b.textContent.trim())).length,approvedPlan:!!document.querySelector('[aria-label=\"Approved normalized manifest\"]'),liveRun:!!document.querySelector('[aria-label=\"Selected run\"]')})"), value => value.online && value.explicitReconnect, "explicit reconnect after network restoration");
  record.after = await snapshot();
  record.status = "passed";
} catch (error) {
  record.status = "failed";
  record.failureCommand = record.command;
  record.error = String(error.message).replaceAll(token, "[REDACTED]").replace(/bootstrap=[^\s"&#]+/g, "bootstrap=[REDACTED]").slice(0, 1000);
  try {
    record.failureDom = JSON.parse(JSON.parse(await command("agent-browser", ["--session", session, "eval", "JSON.stringify({title:document.title,path:location.pathname,online:navigator.onLine,controller:navigator.serviceWorker.controller?.scriptURL??null,text:document.body.innerText.slice(0,1200)})"], 5000)));
  } catch { /* Preserve the original failure when the owned page is unavailable. */ }
}
finally {
  const cleanup = record.cleanup = { errors: [] };
  try { await closeBrowser(); cleanup.browserSessionAbsent = true; } catch { cleanup.errors.push("browser closure unverified"); }
  try { await stopFixture(); cleanup.fixtureReaped = true; cleanup.servicesClosed = true; }
  catch {
    cleanup.errors.push("fixture graceful closure unverified");
    if (!fixtureClosed && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    try { await poll(async () => fixtureClosed, Boolean, "forced fixture close", 5000); }
    catch { child.unref(); child.stdout.unref?.(); child.stderr.unref?.(); }
  }
  cleanup.listenerRefused = record.origin ? await listenerRefused() : false;
  if (!cleanup.listenerRefused) cleanup.errors.push("listener closure unverified");
  if (!cleanup.errors.length) {
    await rm(workspace, { recursive: true });
    await assert.rejects(lstat(workspace), { code: "ENOENT" });
    cleanup.ownedWorkspaceRemoved = true;
  } else { record.status = "failed"; record.retainedPrivateRoots = [workspace]; }
  await writeFile(reportPath, JSON.stringify(record, null, 2), { mode: 0o600, flag: "wx" });
  console.log("Cold-offline browser: " + record.status + "; report " + reportPath);
}
if (record.status === "passed") await verifyColdOfflineFile(reportPath);
else process.exitCode = 1;
