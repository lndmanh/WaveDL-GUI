#!/usr/bin/env node
// Observational native-browser proof of genuinely trained stationary CPU epochs.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  access,
  readdir,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { boundedCommand } from "./browser_process.mjs";
import { browserLaunchArgs } from "./browser_launch_policy.mjs";
import { frozenAssetProof } from "./browser_asset_proof.mjs";
import { createBrowserActions } from "./browser_actions.mjs";
import {
  epochSourceFingerprint,
  verifyEpochMetricBrowserReport,
  verifyEpochMetricBrowserFile,
  requireEpochOutputsAbsent,
  verifyEpochScreenshotPng,
} from "./verify_epoch_metric_browser_report.mjs";

const repo = resolve(new URL("..", import.meta.url).pathname);
const python = process.env.WAVEDL_PYTHON ?? "python";
const browser = process.env.AGENT_BROWSER_BIN ?? "agent-browser";
const browserExecutable = process.env.WAVEDL_BROWSER_EXECUTABLE;
if (browserExecutable)
  assert(browserExecutable.startsWith("/"), "Absolute browser executable required");
const reportPath = process.argv.find((x) => x.startsWith("--report="))?.slice(9);
assert(reportPath?.startsWith("/"), "New absolute --report required");
await requireEpochOutputsAbsent(reportPath);
const workspace = await realpath(await mkdtemp(join(tmpdir(), "wavedl-epoch-browser-")));
const root = join(workspace, "root"),
  profile = join(workspace, "profile");
await mkdir(root, { mode: 0o700 });
await mkdir(profile, { mode: 0o700 });
const session = `epoch-${randomUUID().slice(0, 12)}`;
const env = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")),
  ),
  AGENT_BROWSER_SESSION: session,
  ...(browserExecutable ? { AGENT_BROWSER_EXECUTABLE_PATH: browserExecutable } : {}),
};
const command = (binary, args, options = {}) =>
  boundedCommand(binary, args, { cwd: repo, env, ...options });
const cli = async (...args) => {
  try {
    return await command(browser, ["--session", session, ...args], { timeout: 45000 });
  } catch (error) {
    // Identify the operation without logging URL/bootstrap or other private argv.
    throw new Error(`Browser ${args[0]} failed: ${error.message}`);
  }
};
const dom = async (expression) =>
  JSON.parse(
    JSON.parse(
      await cli("eval", "-b", Buffer.from(`JSON.stringify(${expression})`).toString("base64")),
    ),
  );
const actions = createBrowserActions({
  cli,
  dom: async (expression) =>
    JSON.parse(JSON.parse(await cli("eval", "-b", Buffer.from(expression).toString("base64")))),
  snapshot: () => cli("snapshot", "-i"),
});
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function poll(get, accept, label, timeout = 300000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await get();
    if (accept(value)) return value;
    await delay(150);
  }
  throw Error(`${label} timeout`);
}
const selected = () =>
  dom(
    `(()=>{const d=document.querySelector('[aria-label="Selected run"]'),m=d?.querySelector('[aria-label="Current runtime metrics"]');const text=m?.innerText||'';return {runId:d?.querySelector('.identity')?.textContent.trim(),badge:d?.querySelector('[data-slot="badge"]')?.textContent.trim(),epoch:Number(text.match(/Epoch (\\d+) \\/ 7/)?.[1]),text:d?.innerText||'',metricsText:text,pairs:Array.from(m?.querySelectorAll('dl.metric-grid>div')||[]).map(e=>[e.querySelector('dt')?.textContent.trim(),e.querySelector('dd')?.textContent.trim()]),diagnostics:d?.querySelector('[aria-label="Runtime diagnostics"]')?.textContent||''}})()`,
  );
const sha = (body) => createHash("sha256").update(body).digest("hex");
const sources = () => epochSourceFingerprint();
const result = {
  status: "failed",
  scope: "real-cpu-epoch-metric-packaged-browser",
  limitation:
    "One stationary custom CPU model, three actual epochs, attempt one, patience two. Bounded CPU matrix work paces observation, not a throughput test. Model source pre/post hashes attest unchanged owned bytes, not cryptographic TOCTOU pinning. No GPU, remote, scheduler, reload or crash claim.",
  startedAt: new Date().toISOString(),
  browserSession: session,
  observations: [],
  cleanup: {},
};
let stdout = "",
  stderr = "",
  fixture,
  closed,
  origin,
  failure,
  outputOverflow = false;
try {
  result.sourcePreflight = await sources();
  result.assetPreflight = await frozenAssetProof(command, python);
  result.profileInitiallyEmpty = (await readdir(profile)).length === 0;
  assert.match(result.assetPreflight.manifestSha256, /^[a-f0-9]{64}$/);
  const preflightServer = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
    response.end("<!doctype html><title>Browser preflight</title>");
  });
  await new Promise((done, fail) => {
    preflightServer.once("error", fail);
    preflightServer.listen(0, "127.0.0.1", done);
  });
  try {
    await cli(
      "open",
      `http://127.0.0.1:${preflightServer.address().port}`,
      "--profile",
      profile,
      "--engine",
      "chrome",
      "--headed",
      "false",
      "--allowed-domains",
      "127.0.0.1,localhost",
      "--args",
      browserLaunchArgs,
      ...(browserExecutable ? ["--executable-path", browserExecutable] : []),
    );
    await cli("set", "viewport", "1280", "900");
    const preflightScreenshot = join(workspace, "browser-preflight.png");
    await cli("screenshot", preflightScreenshot);
    verifyEpochScreenshotPng(await readFile(preflightScreenshot));
  } finally {
    await new Promise((done, fail) => {
      preflightServer.close((error) => (error ? fail(error) : done()));
      preflightServer.closeAllConnections();
    });
  }
  fixture = spawn(
    python,
    [
      "tools/epoch_metric_browser_fixture.py",
      "--root",
      root,
      "--epochs",
      "7",
      "--record-process-results",
    ],
    {
      cwd: repo,
      env: { ...env, PYTHONPATH: join(repo, "src") },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  closed = new Promise((done) => fixture.once("close", done));
  fixture.once("error", () => {
    failure ??= "Fixture spawn failed";
  });
  const capture = (kind) => (chunk) => {
    if (outputOverflow) return;
    const current = kind === "stdout" ? stdout : stderr;
    if (Buffer.byteLength(current) + chunk.length > 1048576) {
      outputOverflow = true;
      failure ??= "Fixture output limit exceeded";
      fixture.kill("SIGINT");
      return;
    }
    if (kind === "stdout") stdout += chunk;
    else stderr += chunk;
  };
  fixture.stdout.on("data", capture("stdout"));
  fixture.stderr.on("data", capture("stderr"));
  await poll(
    () => stdout,
    (value) => {
      if (failure || fixture.exitCode !== null || fixture.signalCode !== null)
        throw Error(failure ?? "Fixture startup failed");
      return value.includes("Browser: ");
    },
    "fixture",
  );
  const url = stdout.match(/Browser: (http:\/\/[^\s]+)/)?.[1];
  result.runId = stdout.match(/Run: ([0-9a-f-]{36})/)?.[1];
  assert(url && result.runId);
  origin = new URL(url).origin;
  await cli("open", url);
  await cli("wait", "--text", "Connected");
  await cli(
    "wait",
    "--fn",
    `Array.from(document.querySelectorAll('[aria-label="Runs"] small')).some(e=>e.textContent.trim()===${JSON.stringify(result.runId)})`,
  );
  await cli("snapshot", "-i");
  await cli(
    "click",
    await actions.readyControl("button", result.runId, false, {
      locator: `xpath=//section[@aria-label='Runs']//button[.//small[normalize-space()='${result.runId}']]`,
    }),
  );
  result.browserVersion = await command(browser, ["--version"]);
  result.browserRuntime = await dom(
    '({userAgent:navigator.userAgent,engine:"chrome",viewport:{width:innerWidth,height:innerHeight}})',
  );
  for (const [name, epoch] of [
    ["first", 1],
    ["final", 3],
  ]) {
    const observation = await poll(
      selected,
      (value) =>
        value.runId === result.runId &&
        value.epoch === epoch &&
        value.metricsText.includes("Best validation loss:") &&
        (epoch !== 3 || value.badge === "completed"),
      name,
    );
    result.observations.push({ name, atMs: Date.now(), ...observation });
    const screenshot = `${reportPath}.${name}.png`;
    await cli("screenshot", screenshot);
    const after = await selected();
    assert.equal(after.runId, observation.runId, "Screenshot selected run changed");
    assert.equal(after.epoch, observation.epoch, "Screenshot epoch changed");
    assert.equal(after.badge, observation.badge, "Screenshot lifecycle changed");
    result.observations.at(-1).screenshotObservation = {
      atMs: Date.now(),
      runId: after.runId,
      epoch: after.epoch,
      badge: after.badge,
    };
    result.observations.at(-1).screenshot = {
      path: screenshot,
      sha256: sha(await readFile(screenshot)),
    };
  }
  result.evidence = JSON.parse(
    await command(python, ["tools/epoch_metric_browser_evidence.py", root]),
  );
  const errors = JSON.parse(await cli("errors", "--json"));
  assert.equal(errors.success, true);
  assert(Array.isArray(errors.data.errors));
  result.browserErrors = errors.data.errors;
  result.assetPostflight = await frozenAssetProof(command, python);
  result.sourcePostflight = await sources();
  result.status = "passed";
} catch (error) {
  failure = error.message;
  result.error = failure;
  try {
    result.failurePage = await dom(
      "({title:document.title,text:document.body.innerText.slice(0,6000),origin:location.origin,path:location.pathname})",
    );
    result.failurePage.text = result.failurePage.text.replace(
      /bootstrap=[^\s&]+/g,
      "bootstrap=[REDACTED]",
    );
  } catch {
    result.failurePageUnavailable = true;
  }
} finally {
  try {
    await cli("close");
    const inventory = await poll(
      async () => {
        const value = JSON.parse(
          await command(browser, ["session", "list", "--json"], { timeout: 5000 }),
        );
        assert.equal(value.success, true);
        assert(Array.isArray(value.data.sessions));
        return value.data.sessions;
      },
      (value) => !value.includes(session),
      "browser session absent",
      10000,
    );
    result.browserSessionsAfter = inventory;
    result.cleanup.browserClosed = true;
    result.cleanup.browserSessionAbsent = true;
  } catch {
    failure ??= "Browser cleanup unconfirmed";
  }
  if (fixture) {
    if (fixture.exitCode === null && fixture.signalCode === null) fixture.kill("SIGINT");
    let timer;
    try {
      await Promise.race([
        closed,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error("Fixture teardown timeout")), 15000);
        }),
      ]);
    } catch {
      fixture.kill("SIGKILL");
      failure ??= "Forced fixture teardown";
    } finally {
      clearTimeout(timer);
    }
    result.cleanup.fixtureReaped = fixture.exitCode !== null || fixture.signalCode !== null;
    result.cleanup.servicesClosed = stdout.includes("Fixture: services-closed");
  }
  if (origin)
    try {
      await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) });
    } catch (error) {
      result.cleanup.listenerClosed = error.cause?.code === "ECONNREFUSED";
    }
  if (
    !result.cleanup.fixtureReaped ||
    !result.cleanup.servicesClosed ||
    !result.cleanup.listenerClosed ||
    result.evidence?.process.pidAbsent !== true
  )
    failure ??= "Daemon/native cleanup unconfirmed";
  if (!failure) {
    await rm(workspace, { recursive: true, force: false });
    await assert.rejects(access(workspace), (error) => error.code === "ENOENT");
    result.cleanup.ownedRootsRemoved = true;
    result.cleanup.profileRemoved = true;
  } else result.retainedWorkspace = workspace;
  result.finishedAt = new Date().toISOString();
  if (failure) {
    result.status = "failed";
    result.error = failure;
  } else
    try {
      verifyEpochMetricBrowserReport(result);
    } catch (error) {
      result.status = "failed";
      failure = result.error = error.message;
    }
  await writeFile(reportPath, JSON.stringify(result, null, 2), { flag: "wx", mode: 0o600 });
}
if (failure) throw Error(`Epoch browser gate failed: ${reportPath}: ${failure}`);
await verifyEpochMetricBrowserFile(reportPath);
console.log(`Epoch browser gate passed: ${reportPath}`);
