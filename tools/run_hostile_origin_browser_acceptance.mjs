#!/usr/bin/env node
// Dedicated owned browser and genuine second-port hostile page. DOM evaluation
// is observational only; attack JavaScript lives in the fixture's served page.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { boundedCommand } from "./browser_process.mjs";
import { browserLaunchArgs } from "./browser_launch_policy.mjs";
import { createBrowserActions, DRIVER_READINESS_MODE } from "./browser_actions.mjs";
import { currentMappedAssets } from "./verify_mapped_autoplot_browser_report.mjs";
import { verifyHostileOriginReport } from "./verify_hostile_origin_browser_report.mjs";
import { boundedFile } from "./browser_files.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
export async function absent(path) {
  try { await lstat(path); return false; }
  catch (error) { if (error.code === "ENOENT") return true; throw error; }
}
export async function validateReportPath(path) {
  assert(typeof path === "string" && isAbsolute(path), "Provide --report=/absolute/new-report.json");
  assert.equal(resolve(path), path, "Report path must be canonical");
  for (let parent = dirname(path);;) {
    const stat = await lstat(parent);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), "Report parent chain must not contain symlinks");
    const next = dirname(parent); if (next === parent) break; parent = next;
  }
  assert(await absent(path), "Report destination already exists");
  return path;
}
export function sessionAbsent(output, session) {
  return !output.split(/\r?\n/).some((line) => line.trim().replace(/^→\s*/, "") === session);
}
export async function waitForSessionAbsence(readSessions, session, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const output = await readSessions(Math.max(1, deadline - Date.now()));
    if (Date.now() < deadline && sessionAbsent(output, session)) return true;
    await delay(Math.min(100, Math.max(1, deadline - Date.now())));
  }
  throw new Error("Owned browser session remained present after bounded close wait");
}
export async function assertOwnedWorkspace(workspace, ownership, marker) {
  const current = await lstat(workspace);
  assert(current.isDirectory() && !current.isSymbolicLink());
  assert.equal(current.dev, ownership.dev); assert.equal(current.ino, ownership.ino);
  assert.equal(current.uid, ownership.uid); assert.equal(current.mode & 0o777, 0o700);
  assert.equal(await realpath(workspace), workspace);
  const owner = await lstat(join(workspace, ".owner"));
  assert(owner.isFile() && !owner.isSymbolicLink() && owner.uid === current.uid && (owner.mode & 0o777) === 0o600);
  assert.equal((await boundedFile(join(workspace, ".owner"), 128)).toString("utf8"), marker);
}
export function validateOrigins(daemonOrigin, attackOrigin) {
  const daemon = new URL(daemonOrigin), attack = new URL(attackOrigin);
  for (const url of [daemon, attack]) {
    assert.equal(url.protocol, "http:"); assert.equal(url.hostname, "127.0.0.1");
    assert(url.port && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash);
  }
  assert.notEqual(daemon.port, attack.port, "Hostile origin must use a genuinely different port");
}
export function hostilePageHTML(daemon, cancelPath) {
  assert.equal(new URL(daemon).origin, daemon);
  assert.match(cancelPath, /^\/api\/runs\/[a-f0-9-]{36}\/cancel$/);
  const cancel = `${daemon}${cancelPath}`;
  return `<!doctype html><title>Owned hostile origin</title><button id="simple-get">Simple GET</button><button id="simple-post">Simple POST</button><button id="native-form">Native form POST</button><button id="bearer-json">Bearer JSON POST</button><button id="cookie-only">Cookie-only GET</button><iframe name="sink" hidden></iframe><pre id="result"></pre><script>
  document.cookie='acceptance_marker=hostile; SameSite=Lax; Path=/';
  const out=document.querySelector('#result'), mark=x=>out.textContent=x;
  document.getElementById('simple-get').onclick=()=>fetch('${daemon}/api/runs?acceptance_case=simple-get',{credentials:'include'}).then(r=>mark('simple-get:'+r.status)).catch(()=>mark('simple-get:rejected'));
  document.getElementById('simple-post').onclick=()=>fetch('${cancel}?acceptance_case=simple-post',{method:'POST',credentials:'include'}).then(r=>mark('simple-post:'+r.status)).catch(()=>mark('simple-post:rejected'));
  document.getElementById('native-form').onclick=()=>{const f=document.createElement('form');f.method='POST';f.action='${cancel}?acceptance_case=form-post';f.target='sink';document.body.append(f);f.submit();mark('form-post:submitted');};
  document.getElementById('bearer-json').onclick=()=>fetch('${cancel}?acceptance_case=json-post',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','Authorization':'Bearer synthetic-attack-only'},body:'{}'}).then(r=>mark('json-post:'+r.status)).catch(()=>mark('json-post:rejected'));
  document.getElementById('cookie-only').onclick=()=>{location.href='${daemon}/api/runs?acceptance_case=cookie-only';};
  </script>`;
}
export function attackObservation(caseId, text) {
  assert(["simple-get", "simple-post", "form-post", "json-post"].includes(caseId));
  assert.equal(typeof text, "string");
  const [observedCase, outcome, extra] = text.split(":");
  assert.equal(observedCase, caseId); assert.equal(extra, undefined);
  assert.equal(outcome, caseId === "form-post" ? "submitted" : "rejected");
  return { outcome, text };
}
export function authenticatedGetControl(daemonOrigin, bearer) {
  const url = new URL("/api/runs", daemonOrigin);
  assert.equal(url.origin, daemonOrigin);
  // /api/runs strictly validates its public query schema. Observer attribution
  // is private test metadata, not an invented daemon query parameter.
  return { url: url.href, options: { headers: { Authorization: `Bearer ${bearer}`, "X-WaveDL-Acceptance-Case": "node-get" }, signal: AbortSignal.timeout(5000) } };
}
export function gracefulFixtureExit(exit, servicesClosed) {
  return servicesClosed === true && !!exit && ((exit.code === 0 && exit.signal === null) || (exit.code === null && exit.signal === "SIGINT"));
}
async function listenerRefused(origin) {
  const url = new URL(origin);
  return new Promise((done, fail) => {
    const socket = connect({ host: url.hostname, port: Number(url.port) });
    socket.setTimeout(1000);
    socket.once("connect", () => { socket.destroy(); done(false); });
    socket.once("timeout", () => { socket.destroy(); fail(new Error("Listener probe timeout")); });
    socket.once("error", (error) => { socket.destroy(); if (error.code === "ECONNREFUSED") done(true); else fail(new Error(`Listener probe failed: ${error.code}`)); });
  });
}
export async function main(reportPath) {
  await validateReportPath(reportPath);
  const workDeadline = Date.now() + 180000, finalDeadline = workDeadline + 45000;
  const workspace = await realpath(await mkdtemp(join(await realpath(tmpdir()), "wavedl-hostile-origin-")));
  await chmod(workspace, 0o700);
  const ownership = await lstat(workspace);
  assert(ownership.uid === process.getuid?.() && ownership.isDirectory() && !ownership.isSymbolicLink());
  assert(!reportPath.startsWith(workspace + sep));
  const root = join(workspace, "root"), profile = join(workspace, "profile"), tokenFile = join(root, "token");
  const marker = randomUUID(), session = `wavedl-hostile-origin-${randomUUID()}`;
  let bearer;
  const redact = (value) => bearer ? String(value).split(bearer).join("[REDACTED]") : String(value);
  const browser = process.env.AGENT_BROWSER_BIN ?? "agent-browser", python = process.env.WAVEDL_PYTHON ?? "python";
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_"))), AGENT_BROWSER_SESSION: session };
  const pythonEnv = { ...process.env, PYTHONPATH: join(repo, "src") };
  let cleaning = false, fixture, fixtureExit, fixtureError, attackServer, stdout = "", stderr = "", overflow = false, ready, browserAttempted = false, failure;
  const report = { status: "failed", scope: "real-browser-hostile-origin", driverReadinessMode: DRIVER_READINESS_MODE,
    limitation: "Isolated loopback browser acceptance only; not production, remote-host, or cross-browser certification.",
    ownership: { workspace, root, profile, session }, controls: {}, cleanup: { errors: [] } };
  const command = (binary, args, timeout = 30000, commandEnv = env) => {
    const remaining = (cleaning ? finalDeadline : workDeadline) - Date.now();
    assert(remaining > 0, "Global acceptance deadline exhausted");
    return boundedCommand(binary, args, { cwd: repo, env: commandEnv, timeout: Math.min(timeout, remaining), stdoutLimit: 1024 * 1024, redact });
  };
  const cli = (...args) => command(browser, ["--session", session, ...args]);
  const dom = async (expression) => JSON.parse(JSON.parse(await cli("eval", "-b", Buffer.from(expression).toString("base64"))));
  const poll = async (observe, accept, description) => {
    const end = Math.min(workDeadline, Date.now() + 30000);
    while (Date.now() < end) {
      assert(!fixtureError && !fixtureExit && !overflow, `Fixture unavailable during ${description}`);
      const value = await observe(); if (accept(value)) return value; await delay(75);
    }
    throw new Error(`Bounded wait failed: ${description}`);
  };
  const fixtureJson = async (name) => {
    await assertOwnedWorkspace(workspace, ownership, marker);
    const path = join(root, name), stat = await lstat(path);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 2 * 1024 * 1024);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await boundedFile(path, 2 * 1024 * 1024)));
  };
  try {
    await writeFile(join(workspace, ".owner"), marker, { flag: "wx", mode: 0o600 });
    await mkdir(root, { mode: 0o700 }); await mkdir(profile, { mode: 0o700 });
    report.assetsBefore = await currentMappedAssets();
    const version = await command(browser, ["--version"]);
    fixture = spawn(python, ["tools/hostile_origin_browser_fixture.py", "--root", root, "--port", "0"], { cwd: repo, env: pythonEnv, stdio: ["ignore", "pipe", "pipe"] });
    fixture.on("error", (error) => { fixtureError = error; });
    fixture.on("close", (code, signal) => { fixtureExit = { code, signal }; });
    fixture.stdout.on("data", (chunk) => { if (Buffer.byteLength(stdout) + chunk.length > 1024 * 1024) { overflow = true; fixture.kill("SIGINT"); } else stdout += chunk; });
    fixture.stderr.on("data", (chunk) => { if (Buffer.byteLength(stderr) + chunk.length <= 4096) stderr += chunk; });
    // The public ready line has no secret; the private file is read only after
    // its write completed. Neither bootstrap URL nor bearer enters the report.
    await poll(async () => stdout, (value) => /^Ready: \{/m.test(value), "fixture startup");
    ready = await fixtureJson("ready.json");
    assert.match(ready.cancelPath, /^\/api\/runs\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\/cancel$/);
    assert.equal(ready.tokenFile, tokenFile);
    const tokenStat = await lstat(tokenFile);
    assert(tokenStat.isFile() && !tokenStat.isSymbolicLink() && (tokenStat.mode & 0o777) === 0o600 && tokenStat.uid === ownership.uid);
    bearer = (await boundedFile(tokenFile, 128)).toString("utf8"); assert.match(bearer, /^[A-Za-z0-9_-]{32,128}$/);
    report.identity = Object.fromEntries(["daemonId", "buildId", "runId", "planId", "requestId"].map((key) => [key, ready[key]]));
    // The hostile page is task-owned and served on a genuinely different port.
    attackServer = createServer((req, res) => {
      if (req.url !== "/") { res.writeHead(404); res.end(); return; }
      const html = hostilePageHTML(ready.daemonOrigin, ready.cancelPath);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(html) }); res.end(html);
    });
    attackServer.requestTimeout = 5000; attackServer.headersTimeout = 5000;
    attackServer.maxRequestsPerSocket = 10;
    await new Promise((resolveAttack, rejectAttack) => {
      const timer = setTimeout(() => rejectAttack(new Error("Attack listener startup timeout")), 3000);
      attackServer.once("error", (error) => { clearTimeout(timer); rejectAttack(error); });
      attackServer.listen(0, "127.0.0.1", () => { clearTimeout(timer); resolveAttack(); });
    });
    const attackOrigin = `http://127.0.0.1:${attackServer.address().port}`;
    validateOrigins(ready.daemonOrigin, attackOrigin);
    report.origins = { daemon: ready.daemonOrigin, attack: attackOrigin };
    const control = authenticatedGetControl(ready.daemonOrigin, bearer);
    const response = await fetch(control.url, control.options);
    await response.arrayBuffer(); assert.equal(response.status, 200);
    report.controls.nodeAuthenticatedGet = { status: response.status, transport: "node-fetch-not-browser" };
    browserAttempted = true;
    await cli("--headed", "false", "--engine", "chrome", "--profile", profile,
      ...(process.env.WAVEDL_BROWSER_EXECUTABLE ? ["--executable-path", process.env.WAVEDL_BROWSER_EXECUTABLE] : []),
      "--allowed-domains", "127.0.0.1", "--args", browserLaunchArgs, "open", `${attackOrigin}/`);
    report.browser = { version, userAgent: await dom("JSON.stringify(navigator.userAgent)") };
    report.browser.cookieSet = await dom("JSON.stringify(document.cookie.split('; ').includes('acceptance_marker=hostile'))");
    assert.equal(report.browser.cookieSet, true);
    const actions = createBrowserActions({ cli, dom, snapshot: () => cli("snapshot", "-i") });
    const receipts = async () => {
      await assertOwnedWorkspace(workspace, ownership, marker);
      const path = join(root, "receipts.jsonl"), stat = await lstat(path);
      assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1024 * 1024);
      return new TextDecoder("utf-8", { fatal: true }).decode(await boundedFile(path, 1024 * 1024)).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    };
    const snapshot = async (name) => {
      await assertOwnedWorkspace(workspace, ownership, marker);
      await command(python, ["tools/hostile_origin_browser_fixture.py", "--snapshot-root", root, "--snapshot-name", name], 15000, pythonEnv);
      return fixtureJson(`snapshot-${name}.json`);
    };
    const storageBefore = await snapshot("before");
    const clickCase = async (label, key, caseId, outcome) => {
      const minimum = (await receipts()).length + 1;
      await actions.button(label);
      await poll(receipts, (rows) => rows.length === minimum, `${key} receipt`);
      const text = await poll(() => dom("JSON.stringify(document.querySelector('#result').textContent)"), (value) => value === `${caseId}:${outcome}`, `${key} browser result`);
      report.browser.dom ??= {}; report.browser.dom[key] = attackObservation(caseId, text);
    };
    await clickCase("Simple GET", "simpleGet", "simple-get", "rejected");
    await clickCase("Simple POST", "simplePost", "simple-post", "rejected");
    await clickCase("Native form POST", "formPost", "form-post", "submitted");
    await clickCase("Bearer JSON POST", "jsonPost", "json-post", "rejected");
    const minimum = (await receipts()).length + 1;
    await actions.button("Cookie-only GET");
    await cli("wait", "--load", "domcontentloaded");
    const cookieRows = await poll(receipts, (rows) => rows.length === minimum && rows.at(-1).status === 401, "cookie-only browser receipt");
    const text = await dom("JSON.stringify(document.body.innerText)");
    assert(text.includes("unauthorized") || text.includes("Bearer") || text.includes("Unauthorized"), "Cookie-only browser did not show genuine refusal");
    report.browser.cookieOnly = { outcome: "response", status: cookieRows.at(-1).status, text };
    const storageAfter = await snapshot("after");
    assert.deepEqual(storageBefore, storageAfter, "Attack cases changed durable storage");
    const cancelled = await fetch(`${ready.daemonOrigin}${ready.cancelPath}?acceptance_case=node-cancel`, { method: "POST", headers: { Authorization: `Bearer ${bearer}`, "X-WaveDL-Daemon-ID": ready.daemonId }, signal: AbortSignal.timeout(5000) });
    await cancelled.arrayBuffer(); assert.equal(cancelled.status, 202);
    report.controls.nodeAuthenticatedCancel = { status: cancelled.status, transport: "node-fetch-not-browser" };
    const storageAfterPositive = await snapshot("positive");
    report.evidence = { receipts: await receipts(), storageBefore, storageAfter, storageAfterPositive };
  } catch (error) { failure = redact(error.message); }
  finally {
    cleaning = true;
    const attempt = async (action) => { try { await action(); } catch (error) { report.cleanup.errors.push(redact(error.message).slice(0, 2000)); } };
    await attempt(async () => {
      if (browserAttempted) await cli("close");
      report.cleanup.browserSessionAbsent = await waitForSessionAbsence((remaining) => command(browser, ["session", "list"], remaining), session);
    });
    await attempt(async () => {
      assert(fixture, "Fixture not started");
      if (!fixtureExit && !fixtureError) fixture.kill("SIGINT");
      const end = Math.min(finalDeadline, Date.now() + 15000);
      while (!fixtureExit && !fixtureError && Date.now() < end) await delay(25);
      if (!fixtureExit && !fixtureError) {
        report.cleanup.errors.push("Fixture required SIGKILL; evidence retained"); fixture.kill("SIGKILL");
        const killEnd = Math.min(finalDeadline, Date.now() + 3000);
        while (!fixtureExit && Date.now() < killEnd) await delay(25);
        if (!fixtureExit) { fixture.unref(); fixture.stdout.destroy(); fixture.stderr.destroy(); }
      }
      report.cleanup.fixtureReaped = !!fixtureExit;
      report.cleanup.fixtureExit = fixtureExit ?? { code: null, signal: null };
      report.cleanup.servicesClosed = stdout.split(/\r?\n/).includes("Fixture: services-closed");
      assert(report.cleanup.servicesClosed, "Fixture service close evidence missing");
      assert(gracefulFixtureExit(fixtureExit, report.cleanup.servicesClosed), "Fixture did not shut down normally or via drained SIGINT");
    });
    await attempt(async () => {
      assert(attackServer, "Attack server not started");
      attackServer.closeAllConnections();
      await Promise.race([
        new Promise((done, fail) => attackServer.close((error) => error ? fail(error) : done())),
        new Promise((_, fail) => { const timer = setTimeout(() => fail(new Error("Attack server close timed out")), 2000); timer.unref(); }),
      ]);
    });
    await attempt(async () => {
      assert(report.origins, "Listener origins unavailable");
      report.cleanup.daemonListenerClosed = await listenerRefused(report.origins.daemon);
      report.cleanup.attackListenerClosed = await listenerRefused(report.origins.attack);
      assert(report.cleanup.daemonListenerClosed && report.cleanup.attackListenerClosed, "Owned listener remains open");
    });
    await attempt(async () => { report.assetsAfter = await currentMappedAssets(); assert.deepEqual(report.assetsBefore, report.assetsAfter); });
    if (!failure && report.cleanup.errors.length === 0) await attempt(async () => {
      // Validate every captured fact before deleting private evidence. Only the
      // four subsequently measured absence flags are provisional in this copy.
      verifyHostileOriginReport({ ...report, status: "passed", fixtureOutputOverflow: overflow, ownedArtifactsRetained: false,
        cleanup: { ...report.cleanup, rootRemoved: true, profileRemoved: true, tokenRemoved: true, workspaceRemoved: true } });
      await assertOwnedWorkspace(workspace, ownership, marker);
      await rm(workspace, { recursive: true, force: false });
      for (const [key, path] of Object.entries({ rootRemoved: root, profileRemoved: profile, tokenRemoved: tokenFile, workspaceRemoved: workspace })) {
        report.cleanup[key] = await absent(path); assert(report.cleanup[key]);
      }
    });
  }
  report.fixtureOutputOverflow = overflow;
  report.ownedArtifactsRetained = !!failure || report.cleanup.errors.length > 0;
  if (failure) report.failure = failure;
  if (!failure && report.cleanup.errors.length === 0) report.status = "passed";
  if (report.status === "passed") {
    try { verifyHostileOriginReport(report); }
    catch (error) { report.status = "failed"; report.failure = redact(error.message); }
  }
  const serialized = redact(JSON.stringify(report, null, 2)) + "\n";
  assert(Buffer.byteLength(serialized) <= 4 * 1024 * 1024);
  await validateReportPath(reportPath);
  await writeFile(reportPath, serialized, { flag: "wx", mode: 0o600 });
  if (report.status !== "passed") throw new Error(`Hostile-origin acceptance failed; private evidence retained at ${workspace}; report: ${reportPath}`);
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    assert(args.length === 1 && args[0].startsWith("--report="), "Provide --report=/absolute/new-report.json");
    const report = await main(args[0].slice(9));
    process.stdout.write(JSON.stringify({ status: report.status, report: args[0].slice(9) }) + "\n");
  } catch (error) { process.stderr.write(error.message + "\n"); process.exitCode = 1; }
}
