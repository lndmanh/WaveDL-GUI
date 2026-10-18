#!/usr/bin/env node
// Genuine abrupt daemon loss, same owned database, explicit browser reauthentication.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, lstat, realpath, readdir, readFile, rm } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { boundedCommand } from "./run_retained_browser_acceptance.mjs";
import { createBrowserActions, DRIVER_READINESS_MODE } from "./browser_actions.mjs";
import { browserLaunchArgs } from "./browser_launch_policy.mjs";
import { currentAssetDigest } from "./verify_adoption_negative_browser_report.mjs";
import { verifyDaemonRestartRecord, verifyDaemonRestartFile, limitation } from "./verify_daemon_restart_browser_report.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const python = process.env.WAVEDL_PYTHON ?? "python",
  browser = process.env.AGENT_BROWSER_BIN ?? "agent-browser";
let destination = process.argv[2]
  ? resolve(process.argv[2])
  : await mkdtemp(join(tmpdir(), "wavedl-daemon-restart-"));
await mkdir(destination, { recursive: true, mode: 0o700 });
assert(!(await lstat(destination)).isSymbolicLink());
assert.deepEqual(await readdir(destination), []);
// Python fingerprints resolve ancestor links (for example macOS /tmp).
// Use the same canonical root for argv, cleanup and report ownership checks.
destination = await realpath(destination);
assert(!process.env.WAVEDL_BROWSER_ASSETS);
const root = join(destination, "fixture"),
  profile = join(destination, "profile"),
  credential = join(destination, ".token");
await mkdir(root, { mode: 0o700 });
await mkdir(profile, { mode: 0o700 });
const token = randomBytes(32).toString("base64url"),
  tag = randomUUID(),
  session = `restart-${randomUUID()}`;
await writeFile(credential, token, { mode: 0o600, flag: "wx" });
const env = {
  ...process.env,
  PYTHONPATH: join(repo, "src"),
  OMP_NUM_THREADS: "1",
  MKL_NUM_THREADS: "1",
  OPENBLAS_NUM_THREADS: "1",
  MPLBACKEND: "Agg",
  BROWSER_RESTART_FIXTURE_TAG: tag,
};
const delay = (ms) => new Promise((done) => setTimeout(done, ms)),
  children = [];
const caseDeadline = Date.now() + 10 * 60 * 1000;
let mainCase = true;
const remainingBudget = (timeout) => {
  if (!mainCase) return timeout;
  const remaining = caseDeadline - Date.now();
  assert(remaining > 0, "Bounded restart main-case deadline exceeded");
  return Math.min(timeout, remaining);
};
const launch = (port = 0, reopen = false) => {
  const child = spawn(
    python,
    [
      "tools/daemon_restart_browser_fixture.py",
      "--root",
      root,
      "--token-file",
      credential,
      "--tag",
      tag,
      "--port",
      String(port),
      ...(reopen ? ["--reopen"] : []),
    ],
    { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  const state = { child, stdout: "", stderr: "", closed: false, stdoutBytes: 0 };
  children.push(state);
  child.stdout.on("data", (x) => {
    state.stdoutBytes += x.length;
    if (state.stdoutBytes >= 1024 * 1024) {
      state.overflow = true;
    } else state.stdout += x;
  });
  child.stderr.on("data", (x) => {
    if (state.stderrSuppressed) return;
    if (Buffer.byteLength(state.stderr) + x.length > 65536) {
      state.stderr = "[suppressed]";
      state.stderrSuppressed = true;
    } else state.stderr += x;
  });
  child.on("error", (e) => (state.error = e));
  child.on("close", () => (state.closed = true));
  return state;
};
const readiness = async (state) => {
  const deadline = Math.min(Date.now() + 150000, caseDeadline);
  while (Date.now() < deadline && !state.closed && !state.error && !state.overflow) {
    const url = state.stdout.match(/Browser: (http:\/\/\S+)/)?.[1];
    if (url) return url;
    await delay(100);
  }
  throw Error(`Real daemon startup failed: ${state.stderr}`);
};
const redact = (value) => String(value).split(token).join("[REDACTED]").replace(/([?&]bootstrap=)[^\s"&#]+/g, "$1[REDACTED]");
const command = async (args, timeout = 35000) => {
  const e = { ...process.env };
  for (const key of Object.keys(e)) if (key.startsWith("AGENT_BROWSER_")) delete e[key];
  e.AGENT_BROWSER_SESSION = session;
  r.lastBrowserCommand = args[0];
  try { return await boundedCommand(
    browser,
    ["--session", session, ...(args[0] === "open" ? ["--args", browserLaunchArgs] : []), ...args],
    { cwd: repo, env: e, timeout: remainingBudget(timeout), redact },
  ); } catch (error) { r.failedBrowserCommand = args[0]; throw error; }
};
const dom = async (script, timeout = 35000) =>
  JSON.parse(JSON.parse(await command(["eval", "-b", Buffer.from(script).toString("base64")], timeout)));
const actions = createBrowserActions({
  cli: (...args) => command(args),
  dom,
  snapshot: () => command(["snapshot", "-i"]),
});
const inspect = async () =>
  JSON.parse(
    await boundedCommand(
      python,
      ["tools/daemon_restart_browser_fixture.py", "--root", root, "--inspect"],
      { cwd: repo, env, redact, timeout: remainingBudget(35000) },
    ),
  );
const r = {
  name: "owned-daemon-abrupt-restart",
  status: "running",
  limitation,
  driverReadinessMode: DRIVER_READINESS_MODE,
  contextStarted: new Date().toISOString(),
};
const sourceSnapshot = async () => {
  const result = {}, excluded = new Set(["node_modules", ".nuxt", ".output", ".cache", ".vite", ".vendor-backups", ".git"]);
  const visit = async (directory, prefix) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (excluded.has(entry.name) || entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name), key = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await visit(path, key);
      else if (entry.isFile()) result[key] = createHash("sha256").update(await readFile(path)).digest("hex");
    }
  };
  await visit(join(repo, "web"), "web");
  for (const key of ["tools/vendor_web_assets.py", "src/wavedl/__init__.py"]) result[key] = createHash("sha256").update(await readFile(join(repo, key))).digest("hex");
  return result;
};
let opened = false,
  origin;
const health = async () => {
  const response = await fetch(`${origin}/api/health`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200);
  return response.json();
};
const publicRun = async (runId) => {
  const response = await fetch(`${origin}/api/runs/${runId}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200);
  const reader = response.body.getReader(), chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      assert(bytes < 1024 * 1024, "Bounded public run response required");
      chunks.push(part.value);
    }
  } finally { await reader.cancel(); }
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  const value = JSON.parse(raw);
  assert(value && typeof value === "object" && value.run_id === runId);
  return { value, wireProof: { path: `/api/runs/${runId}`, status: response.status, raw, bytes: Buffer.byteLength(raw), sha256: createHash("sha256").update(raw).digest("hex") } };
};
const view = `JSON.stringify((()=>{const s=document.querySelector('[aria-label="Selected run"]');return {runId:s?.querySelector('.identity')?.textContent.trim(),badge:s?.querySelector('[data-slot="badge"]')?.textContent.trim(),text:s?.innerText,body:document.body.innerText,currentMetrics:!!document.querySelector('[aria-label="Current runtime metrics"] progress'),storage:{cookies:document.cookie,local:Object.keys(localStorage),session:Object.keys(sessionStorage)}};})())`;
try {
  r.sourceSnapshotBefore = await sourceSnapshot();
  r.assetBefore = await currentAssetDigest();
  r.browser = (await boundedCommand(browser, ["--version"], { cwd: repo })).trim();
  const first = launch(),
    url = await readiness(first);
  origin = new URL(url).origin;
  r.daemonPidBefore = first.child.pid;
  r.stage = "browser-open";
  r.initialProfileEmpty = (await readdir(profile)).length === 0;
  opened = true;
  await command([
    "open",
    "--engine",
    "chrome",
    "--profile",
    profile,
    "--allowed-domains",
    "127.0.0.1,localhost",
    ...(process.env.WAVEDL_BROWSER_EXECUTABLE
      ? ["--executable-path", process.env.WAVEDL_BROWSER_EXECUTABLE]
      : []),
    url,
  ]);
  await command(["set", "viewport", "1280", "900"]);
  r.viewport = await dom("JSON.stringify({width:innerWidth,height:innerHeight})");
  r.browserObserved = await dom("JSON.stringify({userAgent:navigator.userAgent,width:innerWidth,height:innerHeight})");
  r.stage = "browser-connected";
  await command(["wait", "--text", "Connected"]);
  r.stage = "runtime-metrics";
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    try {
      const proof = await inspect();
      if (proof.metricSteps.length) {
        r.before = proof;
        break;
      }
    } catch {}
    await delay(100);
  }
  assert(r.before, "Real CPU metrics required");
  const id = r.before.runId,
    locator = `xpath=//section[@aria-label="Runs"]//button[.//small[normalize-space(.)='${id}']]`;
  const select = async () =>
    command(["click", await actions.readyControl("button", id, false, { locator })]);
  r.stage = "select-run";
  await select();
  await command([
    "wait",
    "--fn",
    `document.querySelector('[aria-label="Runtime metric history"]')?.querySelector('canvas')`,
  ]);
  r.renderedBefore = await dom(view);
  r.healthBefore = await health();
  const derivedBefore = await publicRun(r.before.runId);
  r.derivedBefore = derivedBefore.value;
  r.derivedBeforeWire = derivedBefore.wireProof;
  r.stage = "capture-owned-processes";
  r.capture = JSON.parse(
    await boundedCommand(
      python,
      ["tools/daemon_restart_browser_fixture.py", "--root", root, "--tag", tag, "--capture", "--daemon-pid", String(first.child.pid)],
      { cwd: repo, env, redact },
    ),
  );
  r.daemonProofBefore = r.capture.daemon;
  r.before = await inspect();
  r.stage = "abrupt-kill";
  first.child.kill("SIGKILL");
  const killedDeadline = Date.now() + 10000;
  while (!first.closed && Date.now() < killedDeadline) await delay(50);
  assert(first.closed, "Owned daemon SIGKILL did not reap");
  r.abruptReturncode = first.child.signalCode;
  await actions.button("Connection", false, { scope: '//nav[@aria-label="Sections"]' });
  await actions.button("Verify connection");
  await command(["wait", "--text", "Connect securely"]);
  r.loss = await dom(view);
  await actions.button("Disconnect and clear scope");
  r.detached = await dom(
    `JSON.stringify({selectedAbsent:!document.querySelector('[aria-label="Selected run"]'),credentialEmpty:document.querySelector('#daemon-bearer')?.value===''} )`,
  );
  r.stage = "reopen";
  const second = launch(Number(new URL(origin).port), true);
  await readiness(second);
  r.daemonPidAfter = second.child.pid;
  r.daemonProofAfter = JSON.parse(await boundedCommand(python, ["tools/daemon_restart_browser_fixture.py", "--root", root, "--tag", tag, "--daemon-proof", "--daemon-pid", String(second.child.pid)], { cwd: repo, env }));
  r.healthAfter = await health();
  await actions.fill("Daemon bearer credential", token, { locator: "#daemon-bearer" });
  await actions.button("Connect securely");
  await command(["wait", "--text", "Connected"]);
  await actions.button("Experiments");
  await select();
  await command(["wait", "--text", "supervision lost"]);
  // Journal projections and public derived authority are independent facts.
  // A BrokenPipe runtime exit does not re-establish native process ownership.
  r.after = await inspect();
  const derivedAfter = await publicRun(r.before.runId);
  r.derivedAfter = derivedAfter.value;
  r.derivedAfterWire = derivedAfter.wireProof;
  r.renderedAfter = await dom(view);
  r.assetAfter = await currentAssetDigest();
  const frozenDerived = await publicRun(r.before.runId);
  r.frozenDerived = frozenDerived.value;
  r.frozenDerivedWire = frozenDerived.wireProof;
  r.sourceSnapshotAfter = await sourceSnapshot();
  r.contextFinished = new Date().toISOString();
  r.status = "passed";
} catch (error) {
  r.status = "failed";
  r.error = String(error.message).split(token).join("[REDACTED]").slice(0, 4096);
  r.contextFinished ??= new Date().toISOString();
} finally {
  mainCase = false;
  const errors = [];
  let browserSessionAbsent = !opened;
  if (opened) {
    await command(["close"]).catch((e) => errors.push(`Browser: ${e.message}`));
    const deadline = Date.now() + 30000;
    do {
      try {
        browserSessionAbsent = !(await boundedCommand(browser, ["session", "list"], { cwd: repo, timeout: 10000 })).split("\n").some((x) => x.includes(session));
      } catch (error) { errors.push(`Browser session proof: ${error.message}`); break; }
      if (!browserSessionAbsent) await delay(250);
    } while (!browserSessionAbsent && Date.now() < deadline);
  }
  try {
    browserSessionAbsent = !(
      await boundedCommand(browser, ["session", "list"], { cwd: repo, timeout: 10000 })
    )
      .split("\n")
      .some((x) => x.includes(session));
  } catch (e) {
    errors.push(`Browser session proof: ${e.message}`);
  }
  if (!browserSessionAbsent) errors.push("Browser session remains");
  for (const s of children) {
    if (!s.closed) s.child.kill("SIGINT");
    const deadline = Date.now() + 15000;
    while (!s.closed && Date.now() < deadline) await delay(100);
    if (!s.closed) {
      s.child.kill("SIGKILL");
      errors.push("Daemon cleanup timeout");
    }
  }
  try {
    r.processCleanup = JSON.parse(
      await boundedCommand(
        python,
        ["tools/daemon_restart_browser_fixture.py", "--root", root, "--tag", tag, "--cleanup"],
        { cwd: repo, env, timeout: 15000, redact },
      ),
    );
    r.frozen = await inspect();
  } catch (error) {
    errors.push(`Owned cleanup: ${error.message}`);
  }
  let listenerClosed = false;
  if (origin)
    listenerClosed = await new Promise((done) => {
      const u = new URL(origin),
        s = connect({ host: u.hostname, port: Number(u.port) });
      s.setTimeout(2000, () => {
        s.destroy();
        done(false);
      });
      s.on("connect", () => {
        s.destroy();
        done(false);
      });
      s.on("error", (e) => {
        s.destroy();
        done(e.code === "ECONNREFUSED");
      });
    });
  if (!listenerClosed) errors.push("Listener closure unproven");
  if (children.some((s) => s.overflow)) errors.push("Fixture output exceeded budget");
  r.cleanup = {
    errors,
    daemonsReaped: children.every((s) => s.closed),
    browserClosed: browserSessionAbsent,
    servicesClosed: children.some((s) => s.stdout.includes("Fixture: services-closed")),
    listenerClosed,
    rootsRemoved: false,
  };
  if (!errors.length && r.processCleanup?.taggedProcessesAbsent && r.processCleanup?.cachedRuntimeProcessesAbsent) {
    for (const path of [root, profile, credential]) {
      await rm(path, { recursive: true, force: true });
      await assert.rejects(lstat(path), (e) => e.code === "ENOENT");
    }
    r.cleanup.rootsRemoved = true;
  } else r.status = "failed";
  if (r.status === "passed")
    try {
      verifyDaemonRestartRecord(r);
    } catch (error) {
      r.status = "failed";
      r.error = String(error.message).slice(0, 2048);
    }
  const serialized = JSON.stringify(r, null, 2);
  assert(!serialized.includes(token));
  const report = join(destination, "daemon-restart.json");
  await writeFile(report, serialized, { mode: 0o600, flag: "wx" });
  console.log(`Nonsecret evidence: ${report}`);
  if (r.status === "passed") await verifyDaemonRestartFile(report);
  if (r.status !== "passed") process.exitCode = 1;
}
