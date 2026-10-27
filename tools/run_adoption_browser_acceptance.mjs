#!/usr/bin/env node
// Real Chromium, real local wavedl.launcher run, and the public adoption UI.
// This is intentionally separate from the retained twelve-case runner.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, access, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { boundedCommand } from "./browser_process.mjs";
import { createBrowserActions, DRIVER_READINESS_MODE } from "./browser_actions.mjs";
import { browserLaunchArgs } from "./browser_launch_policy.mjs";
import { verifyAdoptionRecord } from "./verify_adoption_browser_report.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const python = process.env.WAVEDL_PYTHON ?? "python";
const browser = process.env.AGENT_BROWSER_BIN ?? "agent-browser";
const executable = process.env.WAVEDL_BROWSER_EXECUTABLE;
const headed = process.env.WAVEDL_BROWSER_HEADED === "true";
const reportRoot = resolve(
  process.argv[2] ?? (await mkdtemp(join(tmpdir(), "wavedl-adoption-browser-"))),
);
await mkdir(reportRoot, { recursive: true, mode: 0o700 });
const root = join(reportRoot, "fixture");
const profile = join(reportRoot, "browser-profile");
const tokenFile = join(reportRoot, ".fixture-token");
await mkdir(root, { mode: 0o700 });
await mkdir(profile, { mode: 0o700 });
await writeFile(tokenFile, randomBytes(32).toString("base64url"), { mode: 0o600 });
assert.equal((await readdir(profile)).length, 0);
const version = execFileSync(browser, ["--version"], { encoding: "utf8" }).trim();
const session = `wave-adopt-${randomUUID().slice(0, 12)}`;
const child = spawn(
  python,
  ["tools/browser_adoption_fixture.py", "--root", root, "--token-file", tokenFile],
  {
    cwd: repo,
    env: {
      ...process.env,
      PYTHONPATH: join(repo, "src"),
      OMP_NUM_THREADS: "1",
      MKL_NUM_THREADS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let stdout = "",
  stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stderr.on("data", (chunk) => {
  stderr = (stderr + chunk).slice(-65536);
});
const waitForUrl = async () => {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const match = stdout.match(/Browser: (http:\/\/[^\s]+)/);
    if (match) return match[1];
    if (child.exitCode !== null)
      throw new Error(`Fixture exited before readiness (${child.exitCode})`);
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Fixture readiness timeout (private output suppressed)");
};
const command = (args, timeout = 35000) => {
  const env = { ...process.env, AGENT_BROWSER_SESSION: session };
  for (const key of Object.keys(env))
    if (key.startsWith("AGENT_BROWSER_") && key !== "AGENT_BROWSER_SESSION") delete env[key];
  // Never retain argv, base64 DOM programs, bootstrap URL, or secret output.
  record.stage = `browser:${args[0]}`;
  if (args[0] === "wait" && args[1] === "--text") record.stage += `:${args[2]}`;
  const launchArgs = args[0] === "open" ? ["--args", browserLaunchArgs] : [];
  return boundedCommand(browser, ["--session", session, ...launchArgs, ...args], {
    cwd: repo,
    timeout,
    env,
  });
};
const dom = async (script) =>
  JSON.parse(JSON.parse(await command(["eval", "-b", Buffer.from(script).toString("base64")])));
const snapshot = () => command(["snapshot", "-i"]);
const actions = createBrowserActions({ cli: (...args) => command(args), dom, snapshot });
const record = {
  name: "standalone-adoption",
  browser: version,
  driverReadinessMode: DRIVER_READINESS_MODE,
  assertions: [],
  status: "running",
};
const check = (value, message) => {
  assert(value, message);
  record.assertions.push(message);
};
let opened = false;
try {
  const url = await waitForUrl();
  opened = true; // A partial open can own a live session even if the CLI fails.
  await command([
    "open",
    "--headed",
    String(headed),
    "--engine",
    "chrome",
    "--profile",
    profile,
    "--allowed-domains",
    "127.0.0.1,localhost",
    ...(executable ? ["--executable-path", executable] : []),
    url,
  ]);
  const tabs = JSON.parse(await command(["--json", "tab", "list"]));
  const origin = new URL(url).origin;
  const ownedTab = tabs.data?.tabs?.find(
    (tab) => tab.active && typeof tab.url === "string" && new URL(tab.url).origin === origin,
  );
  assert(
    tabs.success && /^t[1-9][0-9]*$/.test(ownedTab?.tabId),
    "Owned fixture tab was not discoverable",
  );
  await command(["tab", ownedTab.tabId]);
  await command(["set", "viewport", "1280", "900"]);
  record.browserViewport = await dom("JSON.stringify({width:innerWidth,height:innerHeight})");
  record.browserProfile = { path: profile, initiallyEmpty: true };
  record.browserRuntime = { executable: executable ?? "agent-browser-managed", headed };
  record.fixtureOrigin = origin;
  await command(["wait", "--text", "Connected"]);
  check(
    await dom(
      "JSON.stringify(document.cookie === '' && Object.keys(localStorage).length === 0 && Object.keys(sessionStorage).length === 0)",
    ),
    "Fresh browser has no persisted authentication",
  );
  record.navigationReadiness = await dom(
    "JSON.stringify({adoptButtons:Array.from(document.querySelectorAll('button')).filter(e=>e.getClientRects().length&&e.textContent.trim()==='Adopt standalone run').length,connected:document.body.innerText.includes('Connected')})",
  );
  assert.equal(
    record.navigationReadiness.adoptButtons,
    1,
    "Adoption navigation is visibly exposed after connection",
  );
  await command(["find", "role", "button", "click", "--name", "Adopt standalone run", "--exact"]);
  await command(["wait", "--text", "Adopt a standalone run"]);
  const rootControl = await actions.readyControl("field", "Configured root", false, {
    locator: 'xpath=//*[@role="combobox" and @aria-label="Configured root"]',
  });
  await command(["click", rootControl]);
  await actions.option("datasets");
  await command(["wait", "--text", "standalone"]);
  await command([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Select directory standalone",
    "--exact",
  ]);
  await command(["wait", "--text", "Selected directory:"]);
  await actions.fill("Runtime attempt", "1");
  record.sourceBefore = JSON.parse(
    await readFile(join(root, ".adoption-source-before.json"), "utf8"),
  );
  record.assetManifestSha256 = createHash("sha256")
    .update(await readFile(join(repo, "src/wavedl_daemon/web_assets/.wavedl-assets.json")))
    .digest("hex");
  await command(["find", "role", "button", "click", "--name", "Confirm adoption", "--exact"]);
  const capturePrefix = async () => {
    const text = await readFile(join(root, ".adoption-response.json"), "utf8");
    assert(Buffer.byteLength(text) <= 262144, "Adoption response evidence exceeds bound");
    return text
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  };
  record.actualResponses = await capturePrefix();
  await command(["wait", "--fn", "document.body.innerText.includes('Retained request:')"]);
  record.postFirstAdoptionDom = await dom(
    "JSON.stringify({retained:document.body.innerText.includes('Retained request:'),retry:Array.from(document.querySelectorAll('button')).filter(e=>e.getClientRects().length&&e.textContent.trim()==='Retry retained adoption').length,connected:document.body.innerText.includes('Connected'),bodyBytes:document.body.innerText.length})",
  );
  assert(
    record.postFirstAdoptionDom.retained && record.postFirstAdoptionDom.retry === 1,
    "Lost acknowledgement retains the same public retry control",
  );
  const firstCapture = JSON.parse(
    (await readFile(join(root, ".adoption-response.json"), "utf8")).trim().split("\n")[0],
  );
  assert.equal(
    firstCapture.deliveredStatus,
    503,
    "First adoption acknowledgement was lost after real registration",
  );
  await command([
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Retry retained adoption",
    "--exact",
  ]);
  record.actualResponses = await capturePrefix();
  await command(["wait", "--text", "supervision lost"]);
  await command(["find", "role", "button", "click", "--name", "Adopt standalone run", "--exact"]);
  await command(["wait", "--text", "Daemon ownership confirmed"]);
  const adoption = await dom(
    "JSON.stringify({ack:document.body.innerText.includes('No process was submitted or cancelled.')})",
  );
  check(
    adoption.ack,
    "Adoption acknowledgement explicitly denies process submission and cancellation",
  );
  const capture = (await readFile(join(root, ".adoption-response.json"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(capture.length, 2, "Fixture captured exactly the lost ACK and retry response");
  assert.equal(capture[0].response.status, 200);
  assert.equal(capture[0].deliveredStatus, 503);
  assert.equal(capture[1].response.status, 200);
  assert.deepEqual(
    capture[0].request,
    capture[1].request,
    "Retry reused the exact frozen request bytes",
  );
  record.actualResponses = capture;
  const registryScript = `import json,sqlite3,sys
from pathlib import Path
c=sqlite3.connect((sys.argv[1]+'/state/registry.db')); c.row_factory=sqlite3.Row
p=c.execute("SELECT p.plan_id,p.request_id,pc.submission_requested,pc.cancellation_requested,p.plan_json FROM plans p JOIN plan_control pc ON p.plan_id=pc.plan_id ORDER BY p.created_at DESC LIMIT 1").fetchone()
e=c.execute("SELECT state,handle_json,latest_observation_json FROM execution_control ORDER BY updated_at DESC LIMIT 1").fetchone()
plan=json.loads(p['plan_json']); manifest=json.loads(plan['manifest_json']); run=Path(manifest['run_directory']);
print(json.dumps({'planId':p['plan_id'],'requestId':p['request_id'],'submissionRequested':bool(p['submission_requested']),'cancellationRequested':bool(p['cancellation_requested']),'plan':plan,'execution':dict(e),'provenance':{'manifestExists':(run/'manifest.json').is_file(),'runtimeRequestExists':(run/'attempts'/'1'/'runtime_request.json').is_file(),'checkpointExists':any(run.glob('**/*checkpoint*'))}}))`;
  const registry = JSON.parse(
    await boundedCommand(python, ["-c", registryScript, root], { cwd: repo }),
  );
  const actualResponse = capture[1]?.response?.json;
  assert(actualResponse, "Fixture did not capture actual adoption JSON");
  record.adoption = actualResponse;
  const retryRegistry = JSON.parse(
    await boundedCommand(python, ["-c", registryScript, root], { cwd: repo }),
  );
  record.retry = {
    sameRequestId: retryRegistry.requestId === registry.requestId,
    sameRunId: JSON.parse(retryRegistry.plan.manifest_json).run_id === record.adoption.run_id,
  };
  const handle = JSON.parse(registry.execution.handle_json);
  record.registry = {
    runState:
      registry.execution.state === "local_lost" ? "supervision_lost" : registry.execution.state,
    adoptedHandle: handle.raw_json,
    submissionHandle: registry.submissionHandle ?? null,
    runtimeHandle: handle.pid ?? handle.supervisor_id ?? null,
    submissionRequested: registry.submissionRequested,
    cancellationRequested: registry.cancellationRequested,
  };
  record.noCancellationRequest = !registry.cancellationRequested;
  const manifest = JSON.parse(registry.plan.manifest_json);
  record.manifest = {
    runId: manifest.run_id,
    attempt: 1,
    sha256: createHash("sha256").update(registry.plan.manifest_json).digest("hex"),
  };
  record.provenance = registry.provenance;
  record.source = JSON.parse(
    await boundedCommand(
      python,
      ["tools/browser_adoption_fixture.py", "--root", root, "--inspect"],
      { cwd: repo },
    ),
  );
  assert.deepEqual(
    record.source.source,
    record.sourceBefore.source,
    "Adoption or retry changed standalone source bytes",
  );
  const actualExecution = record.source.registry.execution;
  const actualHandle = JSON.parse(actualExecution.handle_json);
  assert.equal(actualHandle.pid, null);
  assert.equal(actualHandle.supervisor_id, null);
  assert.equal(actualHandle.job_id, null);
  assert.equal(JSON.parse(actualHandle.raw_json).adopted, true);
  assert.equal(record.source.registry.submission, null);
  record.registry.submissionHandle = record.source.registry.submission;
  check(
    record.registry.adoptedHandle === '{"adopted":true}',
    "Registry retains adoption marker without a runtime PID",
  );
  check(
    record.registry.submissionHandle === null && record.registry.runtimeHandle === null,
    "Adoption created no submission or runtime handle",
  );
  check(
    record.retry.sameRequestId && record.retry.sameRunId,
    "Repeated confirmation preserves standalone request and run identity",
  );
  check(record.noCancellationRequest, "Registry contains no cancellation intent");
  check(
    record.registry.runState === "supervision_lost",
    "Adopted completed journal does not imply live supervision",
  );
  check(
    record.manifest.runId === record.adoption.run_id,
    "Approved manifest retains standalone run identity",
  );
  check(
    record.provenance.manifestExists &&
      record.provenance.runtimeRequestExists &&
      record.provenance.checkpointExists,
    "Manifest, runtime request, and checkpoint provenance remain on the adopted run",
  );
  check(
    record.source.source.runId === record.adoption.run_id &&
      record.source.source.checkpoints.length > 0,
    "Independent source evidence binds the adopted identity to COMPLETE checkpoint bytes",
  );
  record.status = "passed";
} catch (error) {
  record.status = "failed";
  record.failureStage = record.stage;
  record.failureOrigin = record.fixtureOrigin ?? null;
  record.error = String(error.message ?? error);
  try {
    const prefix = await readFile(join(root, ".adoption-response.json"), "utf8");
    assert(Buffer.byteLength(prefix) <= 262144, "Failure capture exceeds bound");
    record.actualResponses = prefix
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    record.failureCaptureUnavailable = true;
  }
} finally {
  const cleanupErrors = [];
  let browserSessionAbsent = !opened;
  if (opened) {
    try {
      const listOwned = async () =>
        !(await boundedCommand(browser, ["session", "list"], { cwd: repo, timeout: 10000 }))
          .split("\n")
          .some((line) => line.includes(session));
      await command(["close"], 10000).catch(() => undefined);
      const deadline = Date.now() + 30000;
      while (!(browserSessionAbsent = await listOwned()) && Date.now() < deadline)
        await new Promise((done) => setTimeout(done, 250));
      if (!browserSessionAbsent) {
        await command(["close"], 10000).catch(() => undefined);
        const retryDeadline = Date.now() + 30000;
        while (!(browserSessionAbsent = await listOwned()) && Date.now() < retryDeadline)
          await new Promise((done) => setTimeout(done, 250));
      }
      assert(browserSessionAbsent, "Owned browser session remains after bounded close retries");
    } catch (error) {
      cleanupErrors.push(String(error.message));
    }
  }
  if (child.exitCode === null) child.kill("SIGINT");
  const deadline = Date.now() + 15000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline)
    await new Promise((done) => setTimeout(done, 100));
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    cleanupErrors.push("Fixture graceful shutdown exceeded deadline");
  }
  const fixtureServicesClosed = stdout.includes("Fixture: services-closed");
  if (!fixtureServicesClosed) cleanupErrors.push("Fixture services shutdown not confirmed");
  record.cleanup = {
    errors: cleanupErrors,
    browserSessionAbsent,
    fixtureServicesClosed,
    launcherExited: stdout.includes("Standalone:"),
    removedOwnedRoots: false,
    browserProfileRemoved: false,
    privateCredentialRemoved: false,
  };
  if (!cleanupErrors.length) {
    try {
      await rm(root, { recursive: true, force: true });
      await rm(profile, { recursive: true, force: true });
      await rm(tokenFile, { force: true });
      for (const path of [root, profile]) {
        try {
          await access(path);
          throw new Error("Owned root remains after removal");
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      record.cleanup.removedOwnedRoots = true;
      record.cleanup.browserProfileRemoved = true;
      record.cleanup.privateCredentialRemoved = true;
    } catch (error) {
      record.cleanup.errors.push(String(error.message));
      record.status = "failed";
    }
  } else {
    record.cleanup.retainedPrivateRoots = [root, profile, tokenFile];
    record.status = "failed";
  }
  await writeFile(join(reportRoot, "standalone-adoption.json"), JSON.stringify(record, null, 2), {
    mode: 0o600,
  });
  console.log(`Nonsecret evidence: ${join(reportRoot, "standalone-adoption.json")}`);
}
if (record.status !== "passed") process.exitCode = 1;
if (record.status === "passed") verifyAdoptionRecord(record, reportRoot);
