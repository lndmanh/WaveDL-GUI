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
import { verifyRolloverRecord } from "./verify_adoption_rollover_browser_report.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const python = process.env.WAVEDL_PYTHON ?? "python";
const browser = process.env.AGENT_BROWSER_BIN ?? "agent-browser";
const executable = process.env.WAVEDL_BROWSER_EXECUTABLE;
const headed = process.env.WAVEDL_BROWSER_HEADED === "true";
const suppliedReportRoot = Boolean(process.argv[2]);
const reportRoot = resolve(
  process.argv[2] ?? (await mkdtemp(join(tmpdir(), "wavedl-adoption-browser-"))),
);
if (suppliedReportRoot) {
  await mkdir(reportRoot, { recursive: true, mode: 0o700 });
  assert.equal((await readdir(reportRoot)).length, 0, "Supplied report root must be empty");
}
const root = join(reportRoot, "fixture");
const profile = join(reportRoot, "browser-profile");
const tokenFile = join(reportRoot, ".fixture-token");
const token = randomBytes(32).toString("base64url");
await mkdir(root, { mode: 0o700 });
await mkdir(profile, { mode: 0o700 });
await writeFile(tokenFile, token, { mode: 0o600 });
assert.equal((await readdir(profile)).length, 0);
const version = execFileSync(browser, ["--version"], { encoding: "utf8" }).trim();
const session = `wave-adopt-${randomUUID().slice(0, 12)}`;
const child = spawn(
  python,
  [
    "tools/browser_adoption_rollover_fixture.py",
    "--root",
    root,
    "--token-file",
    tokenFile,
    "--evidence",
    join(root, ".stream-evidence.json"),
  ],
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
let childError = null;
let childClose = null;
const childClosed = new Promise((resolveClose) => {
  child.once("close", (code, signal) => {
    childClose = { code, signal };
    resolveClose(childClose);
  });
});
child.on("error", (error) => {
  childError = error;
});
child.stdout.on("data", (chunk) => {
  stdout = (stdout + chunk).slice(-1024 * 1024);
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
    if (childError) throw new Error(`Fixture spawn failed: ${childError.message}`);
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
  name: "standalone-adoption-rollover",
  browser: version,
  driverReadinessMode: DRIVER_READINESS_MODE,
  assertions: [],
  status: "running",
  runMetadata: { sessionSha256: createHash("sha256").update(session).digest("hex") },
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
  await actions.fill("Runtime attempt", "2");
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
  const responseDeadline = Date.now() + 15000;
  let captured = [];
  while (Date.now() < responseDeadline) {
    captured = await capturePrefix();
    if (captured.length >= 2) break;
    await new Promise((done) => setTimeout(done, 50));
  }
  assert(captured.length >= 2, "Retry adoption response was not durably captured");
  record.actualResponses = captured;
  const capture = (await readFile(join(root, ".adoption-response.json"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  record.adoption = capture[1].response.json;
  await command(["find", "role", "button", "click", "--name", "Experiments", "--exact"]);
  await command([
    "wait",
    "--fn",
    `document.querySelector('[aria-label="Selected run"] .identity')?.textContent.trim() === ${JSON.stringify(record.adoption.run_id)}`,
  ]);
  const lastSourceId = record.sourceBefore.source.attempts["2"].eventIds.at(-1);
  assert(Array.isArray(lastSourceId) && lastSourceId[0] === 2);
  await command(
    [
      "wait",
      "--fn",
      `document.querySelector('[aria-label="Runtime diagnostics"] pre')?.textContent.includes(${JSON.stringify(`[${lastSourceId[0]}:${lastSourceId[1]}]`)}) === true`,
    ],
    60000,
  );
  record.rendered = await dom(
    "JSON.stringify({selectedRun:document.querySelector('[aria-label=\"Selected run\"] .identity')?.textContent.trim(),diagnostics:document.querySelector('[aria-label=\"Runtime diagnostics\"] pre')?.textContent||''})",
  );
  record.boundary = JSON.parse(await readFile(join(root, ".stream-evidence.json"), "utf8"));
  record.source = record.sourceBefore.source;
  record.localCursor = null;
  record.limitation =
    "Two genuine launcher attempts are initially adopted at attempt 2; no in-place re-adoption. Private browser cursor storage is unobservable. First disconnect is a bounded fixture overflow control, not genuine broker overflow.";
  record.status = "passed";
} catch (error) {
  record.status = "failed";
  record.failureStage = record.stage;
  record.failureOrigin = record.fixtureOrigin ?? null;
  record.error = String(error.message ?? error);
  try {
    record.failureSnapshot = (await snapshot()).slice(0, 16384);
  } catch {}
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
  if (!childClose) await Promise.race([childClosed, new Promise((done) => setTimeout(done, 1000))]);
  if (!childClose) cleanupErrors.push("Fixture child close event not observed");
  const fixtureServicesClosed = stdout.includes("Fixture: services-closed");
  if (!fixtureServicesClosed) cleanupErrors.push("Fixture services shutdown not confirmed");
  let fixtureListenRefused = false;
  if (record.fixtureOrigin) {
    try {
      await fetch(record.fixtureOrigin, { signal: AbortSignal.timeout(2000) });
    } catch (error) {
      fixtureListenRefused = error.cause?.code === "ECONNREFUSED";
    }
    if (!fixtureListenRefused) cleanupErrors.push("Fixture listener still accepts connections");
  }
  record.cleanup = {
    errors: cleanupErrors,
    browserSessionAbsent,
    fixtureServicesClosed,
    fixtureListenRefused,
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
  const rawSerializedRecord = JSON.stringify(record, null, 2);
  assert(!rawSerializedRecord.includes(token), "Private fixture credential leaked into report");
  const serializedRecord = rawSerializedRecord
    .replaceAll(token, "[redacted-credential]")
    .replace(/([?&#](?:token|bootstrap|access_token)=)[^&#\\\"\s]*/gi, "$1[redacted]");
  await writeFile(join(reportRoot, "standalone-adoption-rollover.json"), serializedRecord, {
    flag: "wx",
    mode: 0o600,
  });
  console.log(`Nonsecret evidence: ${join(reportRoot, "standalone-adoption-rollover.json")}`);
}
if (record.status !== "passed") process.exitCode = 1;
if (record.status === "passed") verifyRolloverRecord(record, reportRoot);
