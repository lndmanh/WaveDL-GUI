#!/usr/bin/env node
// Native public adoption/monitor UI. No request interception or browser writes
// through eval. Fixture controls ingestion timing, not HTTP response content.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, chmod, lstat, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { boundedCommand } from "./browser_process.mjs";
import { browserLaunchArgs } from "./browser_launch_policy.mjs";
import { createBrowserActions, DRIVER_READINESS_MODE } from "./browser_actions.mjs";
import { currentMappedAssets } from "./verify_mapped_autoplot_browser_report.mjs";
import { scope, limitation, verifyGenuineBrokerOverflowReport } from "./verify_genuine_broker_overflow_browser_report.mjs";

const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
export function diagnosticIdentities(text) {
  assert(typeof text === "string" && Buffer.byteLength(text) <= 512 * 1024);
  return [...text.matchAll(/^\d{4}-\d{2}-\d{2}T[^\s]+ \[([1-9][0-9]*):([0-9]+)\] [a-z_]+:/gm)].map(m => [Number(m[1]), Number(m[2])]);
}
export async function main() {
  const python = process.env.WAVEDL_PYTHON ?? "python";
  const browser = process.env.AGENT_BROWSER_BIN ?? "agent-browser";
  const tempRoot = await realpath(tmpdir());
  const workspace = await mkdtemp(join(tempRoot, "wavedl-genuine-overflow-"));
  await chmod(workspace, 0o700);
  const workspaceOwner = await lstat(workspace);
  const root = join(workspace, "root"), profile = join(workspace, "profile"), tokenFile = join(workspace, ".token"), evidence = join(workspace, "boundary.json");
  const report = resolve(process.argv.find(a => a.startsWith("--report="))?.slice(9) ?? join(tempRoot, `wavedl-genuine-overflow-${randomUUID()}.json`));
  assert(!report.startsWith(workspace + "/")); await assert.rejects(access(report));
  await mkdir(root, {mode: 0o700}); await mkdir(profile, {mode: 0o700});
  await writeFile(tokenFile, randomBytes(32).toString("base64url"), {flag: "wx", mode: 0o600});
  const bearer = await readFile(tokenFile, "utf8");
  assert.equal((await readdir(profile)).length, 0);
  const session = `wavedl-genuine-overflow-${randomUUID()}`;
  const env = {...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("AGENT_BROWSER_"))), AGENT_BROWSER_SESSION: session};
  const cli = (...args) => boundedCommand(browser, ["--session", session, ...args], {cwd: repo, env, timeout: 45000});
  const dom = async script => JSON.parse(JSON.parse(await cli("eval", "-b", Buffer.from(script).toString("base64"))));
  const actions = createBrowserActions({cli, dom, snapshot: () => cli("snapshot", "-i")});
  const child = spawn(python, ["tools/genuine_broker_overflow_browser_fixture.py", "--root", root, "--token-file", tokenFile, "--evidence", evidence], {cwd: repo, env: {...process.env, PYTHONPATH: join(repo, "src"), OMP_NUM_THREADS: "1", MKL_NUM_THREADS: "1"}, stdio: ["ignore", "pipe", "pipe"]});
  let started = false, spawnFailed = false, stdout = "", outputOverflow = false;
  child.once("spawn", () => { started = true; }); child.on("error", () => { spawnFailed = true; });
  const closed = new Promise(done => child.once("close", (code, signal) => done({code, signal})));
  child.stdout.on("data", chunk => { if (Buffer.byteLength(stdout) + chunk.length > 1024 * 1024) outputOverflow = true; else stdout += chunk.toString(); });
  child.stderr.on("data", () => {});
  const delay = ms => new Promise(done => setTimeout(done, ms));
  const poll = async (read, accept, description, timeout = 60000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { const v = await read(); if (accept(v)) return v; await delay(100); }
    throw new Error(`${description} timeout`);
  };
  const r = {status: "running", scope, limitation, driverReadinessMode: DRIVER_READINESS_MODE, browser: {}, identity: null, assetsBefore: null, assetsAfter: null, boundary: null, authority: null, rendered: null, localCursor: null, cleanup: {}, retainedWorkspace: workspace};
  let failure = null, opened = false, origin = null;
  try {
    r.assetsBefore = await currentMappedAssets();
    r.browser.version = await boundedCommand(browser, ["--version"], {cwd: repo, timeout: 10000});
    const url = await poll(async () => {
      if (spawnFailed || child.exitCode !== null || child.signalCode !== null || outputOverflow) throw new Error("Fixture readiness failed");
      return stdout.match(/Browser: (http:\/\/[^\s]+)/)?.[1];
    }, Boolean, "Fixture readiness", 180000);
    origin = new URL(url).origin;
    opened = true;
    await cli("open", url, "--profile", profile, "--engine", "chrome", "--headed", String(process.env.WAVEDL_BROWSER_HEADED === "true"), ...(process.env.WAVEDL_BROWSER_EXECUTABLE ? ["--executable-path", process.env.WAVEDL_BROWSER_EXECUTABLE] : []), "--allowed-domains", "127.0.0.1,localhost", "--args", browserLaunchArgs);
    await cli("wait", "--text", "Connected");
    r.browser.userAgent = await dom("JSON.stringify(navigator.userAgent)");
    r.browser.freshProfile = await dom("JSON.stringify(document.cookie===''&&Object.keys(localStorage).length===0&&Object.keys(sessionStorage).length===0)");
    await actions.button("Adopt standalone run");
    await cli("wait", "--text", "Adopt a standalone run");
    const control = await actions.readyControl("field", "Configured root", false, {locator: 'xpath=//*[@role="combobox" and @aria-label="Configured root"]'});
    await cli("click", control); await actions.option("datasets");
    await cli("wait", "--text", "standalone");
    await actions.button("Select directory standalone");
    await cli("wait", "--text", "Selected directory:");
    await actions.fill("Runtime attempt", "2");
    await actions.button("Confirm adoption");
    const adopted = await poll(async () => {
      try { const lines = (await readFile(join(root, ".adoption-response.json"), "utf8")).trim().split("\n"); assert(lines.length <= 1); return JSON.parse(lines[0]).response.json; } catch { return null; }
    }, v => v?.adopted && v?.attempt === 2, "public adoption receipt");
    const healthResponse = await fetch(`${origin}/api/health`, {headers: {Authorization: `Bearer ${bearer}`}, signal: AbortSignal.timeout(5000)});
    assert.equal(healthResponse.status, 200); const health = await healthResponse.json();
    r.identity = {runId: adopted.run_id, requestId: adopted.request_id, planId: adopted.plan_id, attempt: adopted.attempt, daemonId: health.daemon_id, buildId: health.build_id};
    await actions.button("Experiments");
    const lastIds = JSON.parse(await readFile(join(root, ".adoption-source-before.json"), "utf8")).source.attempts["2"].eventIds;
    const last = lastIds.at(-1);
    await cli("wait", "--fn", `document.querySelector('[aria-label="Runtime diagnostics"] pre')?.textContent.includes(${JSON.stringify(`[${last[0]}:${last[1]}]`)})===true`);
    r.rendered = await dom("JSON.stringify({selectedRun:document.querySelector('[aria-label=\"Selected run\"] .identity')?.textContent.trim(),diagnostics:document.querySelector('[aria-label=\"Runtime diagnostics\"] pre')?.textContent||'',historyCanvas:!!document.querySelector('[aria-label=\"Runtime metric history\"] canvas'),historySteps:Number(document.querySelector('[aria-label=\"Runtime metric history\"]')?.innerText.match(/lineage · ([0-9]+) steps/)?.[1]??0),truncated:document.querySelector('[aria-label=\"Runtime diagnostics\"]')?.innerText.includes('omitted')??false})");
    r.rendered.diagnosticIds = diagnosticIdentities(r.rendered.diagnostics); delete r.rendered.diagnostics;
    r.authority = JSON.parse(await boundedCommand(python, ["tools/genuine_broker_overflow_browser_fixture.py", "--root", root, "--inspect"], {cwd: repo, env: {...process.env, PYTHONPATH: join(repo, "src")}, timeout: 10000}));
    r.boundary = JSON.parse(await readFile(evidence, "utf8"));
    r.assetsAfter = await currentMappedAssets();
    r.status = "passed";
  } catch (error) { failure = error instanceof Error ? error.message : "Acceptance failed"; r.status = "failed"; }
  finally {
    try {
      if (opened) await cli("close");
      await poll(async () => !(await boundedCommand(browser, ["session", "list"], {cwd: repo, env, timeout: 10000})).split("\n").some(line => line.includes(session)), Boolean, "owned session closure", 5000);
      r.cleanup.browserClosed = true;
    } catch { r.cleanup.browserClosed = false; failure ??= "Browser cleanup unconfirmed"; }
    if (started && child.exitCode === null && child.signalCode === null) child.kill("SIGINT");
    let timer;
    try {
      const exit = await Promise.race([closed, new Promise((_, reject) => {timer = setTimeout(() => { if (started) child.kill("SIGKILL"); reject(new Error("Fixture graceful close exceeded bound")); }, 15000);})]);
      assert((exit.code === 0 && exit.signal === null) || (exit.code === null && exit.signal === "SIGINT") || spawnFailed);
      r.cleanup.fixtureReaped = true;
    } catch { r.cleanup.fixtureReaped = false; failure ??= "Fixture cleanup unconfirmed"; } finally { clearTimeout(timer); }
    r.cleanup.servicesClosed = stdout.includes("Fixture: services-closed");
    r.cleanup.listenerClosed = false;
    if (origin) try { await fetch(`${origin}/api/health`, {signal: AbortSignal.timeout(1000)}); } catch (e) { r.cleanup.listenerClosed = e.cause?.code === "ECONNREFUSED"; }
    if (!r.cleanup.servicesClosed || !r.cleanup.listenerClosed) failure ??= "Services/listener cleanup unconfirmed";
    if (!failure) {
      try {
        const now = await lstat(workspace); assert(now.isDirectory() && !now.isSymbolicLink() && now.dev === workspaceOwner.dev && now.ino === workspaceOwner.ino && now.uid === workspaceOwner.uid);
        await rm(workspace, {recursive: true, force: false});
        for (const path of [workspace, root, profile, tokenFile]) await assert.rejects(access(path));
        Object.assign(r.cleanup, {tokenRemoved: true, profileRemoved: true, ownedRootsRemoved: true}); r.retainedWorkspace = null;
        verifyGenuineBrokerOverflowReport(r);
      } catch { failure = "Owned cleanup or report verification failed"; }
    }
    if (failure) {r.status = "failed"; r.error = failure;}
    await writeFile(report, JSON.stringify(r, null, 2), {flag: "wx", mode: 0o600});
  }
  if (failure) throw new Error(`Genuine overflow acceptance failed; private report: ${report}`);
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
