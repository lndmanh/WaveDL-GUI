#!/usr/bin/env node
// Public-DOM acceptance of explicit reducer-derived lifecycle response faults.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { boundedCommand } from "./run_retained_browser_acceptance.mjs";
import { browserLaunchArgs } from "./browser_launch_policy.mjs";
import { createBrowserActions, DRIVER_READINESS_MODE } from "./browser_actions.mjs";
import {
  verifyDashboardStateBrowserReport,
  stages,
  limitation,
} from "./verify_dashboard_state_browser_report.mjs";

const repo = resolve(new URL("..", import.meta.url).pathname);
const python = process.env.WAVEDL_PYTHON ?? "python";
const browser = process.env.AGENT_BROWSER_BIN ?? "agent-browser";
const reportPath = process.argv.find((arg) => arg.startsWith("--report="))?.slice(9);
assert(reportPath && reportPath.startsWith("/"), "Provide --report=/absolute/new-report.json");
await assert.rejects(access(reportPath), "Report already exists");
const workspace = await mkdtemp(join(tmpdir(), "wavedl-dashboard-browser-"));
assert(!resolve(reportPath).startsWith(workspace + "/"));
const root = join(workspace, "root"),
  profile = join(workspace, "profile"),
  stageFile = join(workspace, "stage"),
  boundary = join(workspace, "boundary.json");
await mkdir(root, { mode: 0o700 });
await mkdir(profile, { mode: 0o700 });
await writeFile(stageFile, "0", { flag: "wx", mode: 0o600 });
const fixture = spawn(
  python,
  [
    "tools/dashboard_state_browser_fixture.py",
    "--stage",
    stageFile,
    "--evidence",
    boundary,
    "--root",
    root,
    "--epochs",
    "3",
  ],
  {
    cwd: repo,
    env: { ...process.env, PYTHONPATH: join(repo, "src") },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
const fixtureClosed = new Promise((done) => fixture.once("close", done));
let stdout = "",
  spawnError = false;
fixture.on("error", () => {
  spawnError = true;
});
fixture.stdout.on("data", (chunk) => {
  if (stdout.length + chunk.length > 1048576) spawnError = true;
  else stdout += chunk;
});
fixture.stderr.on("data", () => {});
const session = `wavedl-dashboard-${randomUUID().slice(0, 12)}`;
const environment = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")),
  ),
  AGENT_BROWSER_SESSION: session,
};
const cli = (...args) =>
  boundedCommand(browser, ["--session", session, ...args], {
    cwd: repo,
    env: environment,
    timeout: 45000,
  });
const dom = async (expression) =>
  JSON.parse(
    JSON.parse(
      await cli("eval", "-b", Buffer.from(`JSON.stringify(${expression})`).toString("base64")),
    ),
  );
const actionDom = async (expression) =>
  JSON.parse(JSON.parse(await cli("eval", "-b", Buffer.from(expression).toString("base64"))));
const actions = createBrowserActions({
  cli,
  dom: actionDom,
  snapshot: () => cli("snapshot", "-i"),
});
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function poll(get, accept, label) {
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    const value = await get();
    if (accept(value)) return value;
    await delay(100);
  }
  throw new Error(`${label} timeout`);
}
async function assetProof() {
  return JSON.parse(
    await boundedCommand(
      python,
      [
        "-c",
        "import json,hashlib\nfrom pathlib import Path\nfrom tools.vendor_web_assets import inventory\np=Path('src/wavedl_daemon/web_assets'); raw=(p/'.wavedl-assets.json').read_bytes(); expected=json.loads(raw); actual=inventory(p,managed=True)\nif actual!=expected: raise ValueError('Packaged asset inventory mismatch')\nprint(json.dumps({'manifestSha256':hashlib.sha256(raw).hexdigest(),'assets':actual}))",
      ],
      { cwd: repo, timeout: 10000 },
    ),
  );
}
const result = {
  status: "failed",
  scope: "real-packaged-browser-dashboard-states",
  limitation,
  driverReadinessMode: DRIVER_READINESS_MODE,
  observations: [],
  cleanup: {},
};
let failure = null,
  origin = null;
try {
  result.assetPreflight = await assetProof();
  await poll(
    () => stdout,
    (value) => {
      if (spawnError || fixture.exitCode !== null) throw new Error("Fixture readiness failed");
      return value.includes("Browser: ");
    },
    "fixture",
  );
  const url = stdout.match(/Browser: (http:\/\/[^\s]+)/)?.[1];
  result.runId = stdout.match(/Run: ([0-9a-f-]{36})/)?.[1];
  assert(url && result.runId);
  origin = new URL(url).origin;
  result.assetManifestSha256 = createHash("sha256")
    .update(await readFile(join(repo, "src/wavedl_daemon/web_assets/.wavedl-assets.json")))
    .digest("hex");
  await cli(
    "open",
    url,
    "--profile",
    profile,
    "--engine",
    "chrome",
    "--headed",
    String(process.env.WAVEDL_BROWSER_HEADED === "true"),
    ...(process.env.WAVEDL_BROWSER_EXECUTABLE
      ? ["--executable-path", process.env.WAVEDL_BROWSER_EXECUTABLE]
      : []),
    "--allowed-domains",
    "127.0.0.1,localhost",
    "--args",
    browserLaunchArgs,
  );
  await cli("wait", "--text", "Connected");
  await cli(
    "wait",
    "--fn",
    `Array.from(document.querySelectorAll('[aria-label="Runs"] small')).some(e=>e.textContent.trim()===${JSON.stringify(result.runId)})`,
  );
  await cli(
    "click",
    await actions.readyControl("button", result.runId, false, {
      locator: `xpath=//section[@aria-label='Runs']//button[.//small[normalize-space()='${result.runId}']]`,
    }),
  );
  result.browserRuntime = await dom("({userAgent:navigator.userAgent})");
  for (let index = 0; index < stages.length; index++) {
    if (index) await writeFile(stageFile, String(index));
    const expected = stages[index];
    const observed = await poll(
      () =>
        dom(
          `(()=>{const d=document.querySelector('[aria-label="Selected run"]');return {runId:d?.querySelector('.identity')?.textContent.trim(),badge:d?.querySelector('[data-slot="badge"]')?.textContent.trim(),text:d?.innerText||'',progress:!!d?.querySelector('progress'),charts:d?.querySelectorAll('canvas').length||0,cancelDisabled:Array.from(d?.querySelectorAll('button')||[]).find(b=>b.textContent.trim()==='Request cancellation')?.disabled,diagnostics:d?.querySelector('[aria-label="Runtime diagnostics"]')?.textContent||''}})()`,
        ),
      (value) =>
        value.badge === expected.badge &&
        value.runId === result.runId &&
        (!expected.emptyMetrics || (!value.progress && value.charts === 0)) &&
        (expected.name !== "running" || (value.progress && value.charts > 0)),
      expected.name,
    );
    result.observations.push({ name: expected.name, ...observed });
  }
  result.boundary = JSON.parse(await readFile(boundary, "utf8"));
  result.assetPostflight = await assetProof();
  result.status = "passed";
} catch (error) {
  failure = error.message;
  result.error = failure;
} finally {
  try {
    await cli("close");
    await poll(
      async () =>
        !(
          await boundedCommand(browser, ["session", "list"], {
            cwd: repo,
            env: environment,
            timeout: 10000,
          })
        ).includes(session),
      Boolean,
      "browser absence",
    );
    result.cleanup.browserClosed = true;
  } catch {
    failure ??= "Browser cleanup unconfirmed";
  }
  if (fixture.exitCode === null && fixture.signalCode === null) fixture.kill("SIGINT");
  let timer;
  try {
    await Promise.race([
      fixtureClosed,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Fixture graceful shutdown timeout")), 15000);
      }),
    ]);
  } catch {
    if (fixture.exitCode === null && fixture.signalCode === null) fixture.kill("SIGKILL");
    await Promise.race([fixtureClosed, delay(3000)]);
    failure ??= "Forced fixture cleanup";
  } finally {
    clearTimeout(timer);
  }
  result.cleanup.fixtureReaped = fixture.exitCode !== null || fixture.signalCode !== null;
  result.cleanup.servicesClosed = stdout.includes("Fixture: services-closed");
  result.cleanup.listenerClosed = false;
  if (origin)
    try {
      await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) });
    } catch (error) {
      result.cleanup.listenerClosed = error.cause?.code === "ECONNREFUSED";
    }
  if (!result.cleanup.servicesClosed || !result.cleanup.listenerClosed)
    failure ??= "Daemon cleanup unconfirmed";
  try {
    result.boundary = JSON.parse(await readFile(boundary, "utf8"));
  } catch {
    failure ??= "Final boundary evidence missing";
  }
  if (!failure) {
    await rm(workspace, { recursive: true, force: false });
    result.cleanup.ownedRootsRemoved = true;
  } else result.retainedWorkspace = workspace;
  if (failure) {
    result.status = "failed";
    result.error = failure;
  }
  if (!failure)
    try {
      verifyDashboardStateBrowserReport(result);
    } catch (error) {
      result.status = "failed";
      failure = result.error = error.message;
    }
  await writeFile(reportPath, JSON.stringify(result, null, 2), { flag: "wx", mode: 0o600 });
}
if (failure)
  throw new Error(`Dashboard browser acceptance failed; private report: ${reportPath}: ${failure}`);
console.log(`Dashboard state browser acceptance passed: ${reportPath}`);
