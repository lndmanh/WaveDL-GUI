#!/usr/bin/env node
// Public native browser clicks and read-only DOM observations; private fixture
// commands operate only on this invocation's owner-checked temporary directory.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { boundedCommand } from "./run_retained_browser_acceptance.mjs";
import { browserLaunchArgs } from "./browser_launch_policy.mjs";
import { createBrowserActions, DRIVER_READINESS_MODE, xpathLiteral } from "./browser_actions.mjs";
import { packagedAssetHashes } from "./browser_training_fields_full.mjs";
import { boundedFile } from "./verify_retained_browser_report.mjs";
import { limitation, verifyStorageFaultBrowserReport } from "./verify_storage_fault_browser_report.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function absent(path) {
  try { await lstat(path); return false; }
  catch (error) { if (error.code === "ENOENT") return true; throw error; }
}

// lstat every ancestor: realpath alone would silently follow a linked parent.
export async function validateReportPath(path) {
  assert(typeof path === "string" && isAbsolute(path), "Provide --report=/absolute/new-report.json");
  assert.equal(resolve(path), path, "Report path must be canonical");
  assert(!path.endsWith(sep), "Report destination must be a new file");
  let parent = dirname(path);
  for (;;) {
    const metadata = await lstat(parent);
    assert(metadata.isDirectory() && !metadata.isSymbolicLink(), "Report parent must be an ordinary directory chain");
    const next = dirname(parent);
    if (next === parent) break;
    parent = next;
  }
  assert(await absent(path), "Report destination must not already exist, including dangling links");
  return path;
}

export function runRowLocator(runId) {
  assert.match(runId, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  return `xpath=//section[@aria-label='Runs']//button[.//small[normalize-space(.)=${xpathLiteral(runId)}]]`;
}

export const selectedObservationExpression = `(() => {
  const details = document.querySelectorAll('section[aria-label="Selected run"]');
  if (details.length !== 1) return null;
  const detail = details[0];
  const metrics = detail.querySelector('section[aria-label="Current runtime metrics"]');
  const history = detail.querySelector('section.metrics-chart');
  const badge = detail.querySelector('[data-slot="badge"]')?.textContent.trim();
  return {runId: detail.querySelector('.identity')?.textContent.trim(), badge,
    emptyMetrics: !!metrics && !!history && !detail.querySelector('progress, [role="progressbar"], canvas, .uplot') &&
      !metrics.querySelector('dl, dd') && metrics.textContent.includes('Waiting for metrics from the current runtime.'),
    uncertain: typeof badge === 'string' && /uncertain|unknown/i.test(badge)};
})()`;

export function sessionAbsent(output, session) {
  return !output.split(/\r?\n/).some((line) => line.trim().replace(/^→\s*/, "") === session);
}

export async function waitForSessionAbsence(readSessions, session, timeout = 5000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await readSessions(Math.max(1, deadline - Date.now()));
    if (Date.now() < deadline && sessionAbsent(last, session)) return true;
    await delay(Math.min(100, Math.max(1, deadline - Date.now())));
  }
  throw new Error(`Owned browser session remained present after bounded close wait: ${session}`);
}

async function listenerRefused(origin) {
  const url = new URL(origin);
  return new Promise((done, fail) => {
    const socket = connect({ host: url.hostname, port: Number(url.port) });
    socket.setTimeout(1000);
    socket.once("connect", () => { socket.destroy(); done(false); });
    socket.once("timeout", () => { socket.destroy(); fail(new Error("Listener probe timed out")); });
    socket.once("error", (error) => { socket.destroy(); if (error.code === "ECONNREFUSED") done(true); else fail(new Error(`Listener probe failed: ${error.code}`)); });
  });
}

export async function main(reportPath, mode = "query_only") {
  await validateReportPath(reportPath);
  const started = Date.now(), workDeadline = started + 250000, finalDeadline = started + 300000;
  const secrets = new Set();
  const redact = (value) => {
    let text = String(value);
    for (const secret of secrets) text = text.split(secret).join("[REDACTED]");
    return text.replace(/([?&]bootstrap=)[^\s"&#]+/g, "$1[REDACTED]");
  };
  const workspace = await realpath(await mkdtemp(join(await realpath(tmpdir()), "wavedl-journal-browser-")));
  await chmod(workspace, 0o700);
  const ownership = await lstat(workspace);
  assert(ownership.isDirectory() && !ownership.isSymbolicLink() && ownership.uid === process.getuid?.() && (ownership.mode & 0o777) === 0o700);
  assert(!reportPath.startsWith(workspace + sep), "Report must be outside owned workspace");
  const root = join(workspace, "root"), profile = join(workspace, "profile"), token = join(workspace, "token");
  const marker = randomUUID();
  const session = `wavedl-journal-${randomUUID()}`;
  const python = process.env.WAVEDL_PYTHON ?? "python";
  const browser = process.env.AGENT_BROWSER_BIN ?? "agent-browser";
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_"))), AGENT_BROWSER_SESSION: session };
  const pythonEnv = { ...process.env, PYTHONPATH: join(repo, "src") };
  let cleaning = false, fixture, fixtureExit, fixtureError, stdout = "", stderr = "", stderrSuppressed = false, outputOverflow = false, origin, browserAttempted = false;
  const report = { status: "failed", scope: "real-sqlite-storage-refusal", limitation, driverReadinessMode: DRIVER_READINESS_MODE,
    snapshots: [], browserObservations: [], cleanup: { errors: [] } };
  const command = (binary, args, timeout = 35000, commandEnv = env) => {
    const remaining = (cleaning ? finalDeadline : workDeadline) - Date.now();
    assert(remaining > 0, "Global acceptance deadline exhausted");
    return boundedCommand(binary, args, { cwd: repo, env: commandEnv, timeout: Math.min(timeout, remaining), stdoutLimit: 1024 * 1024, redact });
  };
  const cli = (...args) => command(browser, ["--session", session, ...args]);
  const dom = async (expression, timeout = 35000) => JSON.parse(JSON.parse(await command(browser, ["--session", session, "eval", "-b", Buffer.from(expression).toString("base64")], timeout)));
  const poll = async (observe, accept, description, timeout = 30000) => {
    const end = Math.min(workDeadline, Date.now() + timeout);
    while (Date.now() < end) {
      assert(!fixtureError && !fixtureExit && !outputOverflow, `Fixture stopped during ${description}: ${redact(fixtureError?.message ?? (stderrSuppressed ? "[suppressed]" : stderr)).slice(-4000)}`);
      const value = await observe();
      if (accept(value)) return value;
      await delay(50);
    }
    throw new Error(`Bounded wait failed: ${description}`);
  };
  const assetProof = async () => ({ manifestSha256: digest(await boundedFile(join(repo, "src/wavedl_daemon/web_assets/.wavedl-assets.json"))), assets: await packagedAssetHashes(repo) });
  const closeFixture = async () => {
    if (!fixture) throw new Error("Fixture was not started");
    if (!fixtureExit && !fixtureError) fixture.kill("SIGINT");
    const end = Math.min(finalDeadline, Date.now() + 15000);
    while (!fixtureExit && !fixtureError && Date.now() < end) await delay(25);
    if (!fixtureExit && !fixtureError) {
      report.cleanup.errors.push("Fixture required SIGKILL; evidence retained");
      fixture.kill("SIGKILL");
      const killEnd = Math.min(finalDeadline, Date.now() + 3000);
      while (!fixtureExit && Date.now() < killEnd) await delay(25);
      if (!fixtureExit) {
        fixture.unref(); fixture.stdout.destroy(); fixture.stderr.destroy();
      }
    }
    report.cleanup.fixtureReaped = !!fixtureExit;
    report.cleanup.fixtureExit = fixtureExit ?? { code: null, signal: null };
    assert(fixtureExit && ((fixtureExit.code === 0 && fixtureExit.signal === null) || (fixtureExit.code === null && fixtureExit.signal === "SIGINT")), "Fixture did not exit normally or via SIGINT");
    report.cleanup.servicesClosed = stdout.split(/\r?\n/).includes("Fixture: services-closed");
    report.cleanup.controlDrained = stdout.split(/\r?\n/).includes("Fixture: control-drained");
    assert(report.cleanup.servicesClosed && report.cleanup.controlDrained, "Fixture did not drain and close its services");
  };
  let failure;
  try {
    await writeFile(join(workspace, ".owner"), marker, { flag: "wx", mode: 0o600 });
    await mkdir(root, { mode: 0o700 }); await mkdir(profile, { mode: 0o700 });
    const bearer = randomUUID(); secrets.add(bearer);
    await writeFile(token, bearer, { mode: 0o600, flag: "wx" });
    report.assetPreflight = await assetProof();
    const version = await command(browser, ["--version"]);
    fixture = spawn(python, ["tools/storage_fault_browser_fixture.py", "--root", root, "--token-file", token, "--mode", mode], { cwd: repo, env: pythonEnv, stdio: ["ignore", "pipe", "pipe"] });
    fixture.on("error", (error) => { fixtureError = error; });
    fixture.on("close", (code, signal) => { fixtureExit = { code, signal }; });
    fixture.stdout.on("data", (chunk) => {
      if (Buffer.byteLength(stdout) + chunk.length > 1024 * 1024) { outputOverflow = true; fixture.kill("SIGINT"); }
      else stdout += chunk;
    });
    fixture.stderr.on("data", (chunk) => {
      if (!stderrSuppressed && Buffer.byteLength(stderr) + chunk.length <= 4096) stderr += chunk;
      else { stderr = ""; stderrSuppressed = true; }
    });
    await poll(async () => stdout, (value) => value.includes("Phase: 0\n"), "fixture startup");
    const url = stdout.match(/^Browser: (http:\/\/[^\s]+)$/m)?.[1]; assert(url, "Fixture bootstrap URL missing");
    secrets.add(url); const bootstrap = new URL(url).searchParams.get("bootstrap"); if (bootstrap) secrets.add(bootstrap);
    origin = new URL(url).origin;
    browserAttempted = true;
    await cli("--headed", "false", "--engine", "chrome", "--profile", profile,
      ...(process.env.WAVEDL_BROWSER_EXECUTABLE ? ["--executable-path", process.env.WAVEDL_BROWSER_EXECUTABLE] : []),
      "--args", browserLaunchArgs, "open", url);
    await cli("wait", "--text", "Connected");
    report.browser = { version, userAgent: await dom("JSON.stringify(navigator.userAgent)") };
    const actions = createBrowserActions({ cli, dom, snapshot: () => cli("snapshot", "-i") });
    await actions.button("Experiments");
    for (const phase of [0, 1, 2, 3]) {
      if (phase) await command(python, ["tools/storage_fault_browser_fixture.py", "--root", root, "--mode", mode, "--phase", String(phase)], 35000, pythonEnv);
      await poll(async () => stdout, (value) => value.includes(`Phase: ${phase}\n`), `fixture phase ${phase}`);
      const snapshot = JSON.parse(await boundedFile(join(root, `snapshot-${phase}.json`), 4 * 1024 * 1024));
      assert.equal(snapshot.phase, phase); report.snapshots.push(snapshot);
      for (const fault of [mode]) {
        const expected = snapshot.cases[fault].view;
        const badge = expected.state === "completed" ? "completed" : "terminal unknown · uncertain";
        assert(["completed", "terminal_unknown"].includes(expected.state));
        await actions.button(expected.run_id, false, { locator: runRowLocator(expected.run_id) });
        const matches = `(value => value && value.runId === ${JSON.stringify(expected.run_id)} && value.badge === ${JSON.stringify(badge)} && value.emptyMetrics === true && value.uncertain === ${JSON.stringify(expected.uncertainty)})(${selectedObservationExpression})`;
        await cli("wait", "--fn", matches);
        for (let repeat = 0; repeat < 2; repeat++) {
          const observed = await dom(`JSON.stringify(${selectedObservationExpression})`);
          assert.equal(observed.runId, expected.run_id); assert.equal(observed.badge, badge);
          assert.equal(observed.emptyMetrics, true); assert.equal(observed.uncertain, expected.uncertainty);
          report.browserObservations.push({ phase, fault, repeat, ...observed });
        }
      }
    }
  } catch (error) { failure = redact(error.message); }
  finally {
    cleaning = true;
    const attempt = async (action) => { try { await action(); } catch (error) { report.cleanup.errors.push(redact(error.message).slice(0, 4000)); } };
    await attempt(async () => {
      if (browserAttempted) await cli("close");
      report.cleanup.browserSessionAbsent = await waitForSessionAbsence(
        (remaining) => command(browser, ["session", "list"], remaining), session,
      );
    });
    await attempt(closeFixture);
    await attempt(async () => { assert(origin, "Fixture listener origin unavailable"); report.cleanup.listenerClosed = await listenerRefused(origin); assert(report.cleanup.listenerClosed, "Fixture listener remains open"); });
    await attempt(async () => { report.assetPostflight = await assetProof(); assert.deepEqual(report.assetPostflight, report.assetPreflight, "Packaged assets changed"); });
    // Only remove the exact owned tree after service cleanup is established.
    if (!failure && report.cleanup.errors.length === 0) await attempt(async () => {
      const current = await lstat(workspace);
      assert(current.isDirectory() && !current.isSymbolicLink() && current.dev === ownership.dev && current.ino === ownership.ino && current.uid === ownership.uid && (current.mode & 0o777) === 0o700);
      assert.equal(await realpath(workspace), workspace);
      assert.equal(await readFile(join(workspace, ".owner"), "utf8"), marker);
      await rm(workspace, { recursive: true, force: false });
      for (const [key, path] of Object.entries({ rootRemoved: root, profileRemoved: profile, tokenRemoved: token, workspaceRemoved: workspace })) {
        report.cleanup[key] = await absent(path); assert(report.cleanup[key], `${key} not verified`);
      }
    });
  }
  if (failure) report.failure = failure;
  if (!failure && report.cleanup.errors.length === 0) {
    report.status = "passed";
    try { verifyStorageFaultBrowserReport(report); }
    catch (error) { report.status = "failed"; report.failure = redact(error.message); }
  }
  const serialized = JSON.stringify(report, null, 2) + "\n";
  assert(Buffer.byteLength(serialized) <= 4 * 1024 * 1024, "Report exceeds bounded verifier size");
  await validateReportPath(reportPath);
  await writeFile(reportPath, serialized, { flag: "wx", mode: 0o600 });
  if (report.status !== "passed") throw new Error(`Journal browser acceptance failed; private evidence retained at ${workspace}; report: ${reportPath}`);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    assert(args.length === 2 && args[0].startsWith("--report=") && ["query_only", "page_quota"].includes(args[1]), "Provide --report=/absolute/new-report.json");
    const reportPath = args[0].slice(9);
    await main(reportPath, args[1]);
    process.stdout.write(`Passed: ${reportPath}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
