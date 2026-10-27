#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, realpath, lstat, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { connect } from "node:net";
import { boundedCommand } from "./browser_process.mjs";
import { boundedFile } from "./browser_files.mjs";
import { createBrowserActions, DRIVER_READINESS_MODE } from "./browser_actions.mjs";
import { browserLaunchArgs, browserTemporaryEnvironment } from "./browser_launch_policy.mjs";
import { currentAssetDigest } from "./verify_adoption_negative_browser_report.mjs";
import {
  verifyPreviewBudgetFile,
  verifyPreviewBudgetRecord,
} from "./verify_preview_budget_browser_report.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const python = process.env.WAVEDL_PYTHON ?? "python";
const browser = process.env.AGENT_BROWSER_BIN ?? "agent-browser";
assert(!process.env.WAVEDL_BROWSER_ASSETS);
const destination = process.argv[2]
  ? resolve(process.argv[2])
  : await mkdtemp(join(await realpath(tmpdir()), "wavedl-preview-budget-"));
await mkdir(destination, { recursive: true, mode: 0o700 });
assert(!(await lstat(destination)).isSymbolicLink());
assert.deepEqual(await readdir(destination), []);
const root = join(destination, "fixture");
const profile = join(destination, "profile");
const credential = join(destination, ".token");
await mkdir(root, { mode: 0o700 });
await mkdir(profile, { mode: 0o700 });
const privateToken = randomBytes(32).toString("base64url");
await writeFile(credential, privateToken, { mode: 0o600, flag: "wx" });
const env = {
  ...process.env,
  PYTHONPATH: join(repo, "src"),
  OMP_NUM_THREADS: "1",
  MKL_NUM_THREADS: "1",
  OPENBLAS_NUM_THREADS: "1",
  MPLBACKEND: "Agg",
};
const session = "preview-budget-" + randomUUID();
const child = spawn(
  python,
  ["tools/browser_preview_budget_fixture.py", "--root", root, "--token-file", credential],
  { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] },
);
let stdout = "";
let stderr = "";
let childError = null;
let childClosed = false;
let opened = false;
let origin = null;
child.stdout.on("data", chunk => {
  stdout = (stdout + chunk).slice(-1024 * 1024);
});
child.stderr.on("data", chunk => {
  stderr = (stderr + chunk).slice(-65536);
});
child.on("error", error => { childError = error; });
child.on("close", () => { childClosed = true; });
const record = {
  name: "dataset-preview-budget",
  status: "running",
  driverReadinessMode: DRIVER_READINESS_MODE,
  limitation: "Fixture-only valid numeric resource witnesses; default ZIP ratio and explicit lower file/feature caps; no remote or site certification.",
};
const delay = ms => new Promise(done => setTimeout(done, ms));

function command(args) {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith("AGENT_BROWSER_")) delete environment[key];
  }
  environment.AGENT_BROWSER_SESSION = session;
  return boundedCommand(browser, [
    "--session", session,
    ...(args[0] === "open" ? ["--args", browserLaunchArgs] : []),
    ...args,
  ], { cwd: repo, env: browserTemporaryEnvironment(environment), timeout: 35000 });
}
async function dom(script) {
  const encoded = Buffer.from(script).toString("base64");
  return JSON.parse(JSON.parse(await command(["eval", "-b", encoded])));
}

const actions = createBrowserActions({
  cli: (...args) => command(args),
  dom,
  snapshot: () => command(["snapshot", "-i"]),
});

async function text(name) {
  const content = await boundedFile(join(root, name), 2 * 1024 * 1024);
  return new TextDecoder("utf-8", { fatal: true }).decode(content);
}

async function inspect() {
  const output = await boundedCommand(python, [
    "tools/browser_preview_budget_fixture.py", "--root", root, "--inspect",
  ], { cwd: repo, env });
  return JSON.parse(output);
}

async function poll(get, accept, label) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const value = await get().catch(() => null);
    if (accept(value)) return value;
    await delay(100);
  }
  throw new Error(label);
}

async function processes() {
  return (await text(".preview-processes.jsonl")).trim().split("\n").map(JSON.parse);
}

const preview = "document.querySelector('section[aria-label=\"Dataset visualization\"]')";

/** Read actual painted canvas pixels without modifying the page or its state. */
function observePreview() {
  return dom("JSON.stringify((() => {" +
    "const section = " + preview + ";" +
    "const canvases = Array.from(section.querySelectorAll('canvas'));" +
    "return {" +
      "message: section.querySelector('[role=\"status\"]')?.textContent.trim() ?? null," +
      "canvases: canvases.length," +
      "figures: section.querySelectorAll('figure').length," +
      "loading: section.innerText.includes('Loading bounded daemon preview')," +
      "connected: document.body.innerText.split('\\n').some(t => t.trim() === 'Connected')," +
      "rasters: canvases.map(canvas => ({" +
        "width: canvas.width," +
        "height: canvas.height," +
        "painted: canvas.width > 0 && canvas.height > 0 &&" +
          "canvas.width <= 4096 && canvas.height <= 4096 &&" +
          "canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)" +
            ".data.some((value, index) => index % 4 === 3 && value > 0)," +
      "}))," +
    "};" +
  "})())");
}

async function selectSafePreview() {
  await actions.button("Select file samples.npz");
  await command(["wait", "--fn",
    preview + ".innerText.includes('NPZ') && " +
    preview + ".querySelectorAll('canvas').length > 0",
  ]);
  return observePreview();
}

async function listenerIsClosed() {
  if (!childClosed || !origin) return false;
  return new Promise(done => {
    const address = new URL(origin);
    const socket = connect({ host: address.hostname, port: Number(address.port) });
    const finish = closed => {
      socket.destroy();
      done(closed);
    };
    socket.setTimeout(2000, () => finish(false));
    socket.on("connect", () => finish(false));
    socket.on("error", error => finish(error.code === "ECONNREFUSED"));
  });
}

try {
  record.browser = (await boundedCommand(browser, ["--version"], { cwd: repo })).trim();
  record.initialProfileEmpty = (await readdir(profile)).length === 0;
  const deadline = Date.now() + 180000;
  let url;
  while (!(url = stdout.match(/Browser: (http:\/\/[^\s]+)/)?.[1])) {
    assert(!childError && !childClosed && Date.now() < deadline, "Fixture readiness failed");
    await delay(100);
  }
  origin = new URL(url).origin;
  record.before = await inspect();
  record.assetManifestSha256 = await currentAssetDigest();
  opened = true;
  await command([
    "open", "--engine", "chrome", "--profile", profile,
    "--allowed-domains", "127.0.0.1,localhost",
    ...(process.env.WAVEDL_BROWSER_EXECUTABLE
      ? ["--executable-path", process.env.WAVEDL_BROWSER_EXECUTABLE]
      : []),
    url,
  ]);
  await command(["set", "viewport", "1280", "900"]);
  await command(["wait", "--text", "Connected"]);
  record.browserObserved = await dom("JSON.stringify({" +
    "userAgent:navigator.userAgent,width:innerWidth,height:innerHeight," +
    "cookies:document.cookie,localStorageKeys:Object.keys(localStorage)," +
    "sessionStorageKeys:Object.keys(sessionStorage)})");
  await actions.button("Datasets");
  await command(["wait", "--text", "Explore daemon datasets"]);
  const configuredRoot = await actions.readyControl("field", "Configured root", false, {
    locator: "xpath=//*[@role=\"combobox\" and @aria-label=\"Configured root\"]",
  });
  await command(["click", configuredRoot]);
  await actions.option("datasets");
  record.witness = JSON.parse(await text(".preview-budget-witness.json"));
  record.initial = await selectSafePreview();
  record.refusals = [];
  for (const name of ["compressed.npz", "features.npz", "bytes.npz"]) {
    await actions.button("Select file " + name);
    await command(["wait", "--fn",
      "!" + preview + ".innerText.includes('Loading bounded daemon preview') && " +
      preview + ".querySelector('[role=\"status\"]') && " +
      preview + ".querySelectorAll('canvas').length === 0",
    ]);
    const refused = await observePreview();
    const capacity = await poll(
      async () => JSON.parse(await text(".preview-capacity.json")),
      value => value?.outstanding === 0,
      "Refusal capacity not released",
    );
    const unchanged = await inspect();
    const retry = await selectSafePreview();
    record.refusals.push({ name, refused, capacity, unchanged, retry });
  }
  record.status = "passed";
} catch (error) {
  record.status = "failed";
  record.error = String(error.message ?? error).slice(0, 1024);
} finally {
  const errors = [];
  let browserSessionAbsent = !opened;
  if (opened) {
    await command(["close"]).catch(() => {});
    const deadline = Date.now() + 30000;
    do {
      const sessions = await boundedCommand(browser, ["session", "list"], {
        cwd: repo, timeout: 10000,
      });
      browserSessionAbsent = !sessions.split("\n").some(line => line.includes(session));
      if (!browserSessionAbsent) await delay(250);
    } while (!browserSessionAbsent && Date.now() < deadline);
  }
  if (!browserSessionAbsent) errors.push("Browser remains");
  if (!childClosed) child.kill("SIGINT");
  const deadline = Date.now() + 15000;
  while (!childClosed && Date.now() < deadline) await delay(100);
  if (!childClosed) {
    child.kill("SIGKILL");
    errors.push("Graceful fixture cleanup timeout");
  }
  const servicesClosed = stdout.includes("Fixture: services-closed");
  if (!servicesClosed) errors.push("Services closure unproven");
  const listenerClosed = await listenerIsClosed();
  if (!listenerClosed) errors.push("Listener closure unproven");
  if (record.status === "passed") {
    try {
      record.after = await inspect();
      record.processes = await processes();
      record.responses = (await text(".preview-responses.jsonl"))
        .trim().split("\n").map(JSON.parse);
      record.drained = JSON.parse(await text(".preview-drained.json"));
    } catch {
      record.status = "failed";
      record.error = "Post-teardown evidence unavailable";
    }
  }
  record.cleanup = {
    errors, browserSessionAbsent, fixtureReaped: childClosed, servicesClosed,
    listenerClosed, ownedRootsRemoved: false, browserProfileRemoved: false,
    privateCredentialRemoved: false,
  };
  if (record.status === "passed" && !errors.length) {
    try {
      assert(!JSON.stringify(record).includes(privateToken));
      verifyPreviewBudgetRecord(record, { cleanupPending: true });
      assert.equal(record.assetManifestSha256, await currentAssetDigest());
    } catch {
      record.status = "failed";
      record.error = "Strict pre-cleanup preview evidence verification failed";
    }
  }
  if (record.status === "passed" && !errors.length) {
    for (const path of [root, profile, credential]) {
      await rm(path, { recursive: true, force: true });
      await assert.rejects(lstat(path), error => error.code === "ENOENT");
    }
    record.cleanup.ownedRootsRemoved = true;
    record.cleanup.browserProfileRemoved = true;
    record.cleanup.privateCredentialRemoved = true;
  } else {
    record.status = "failed";
    record.retainedPrivateRoots = [root, profile, credential];
  }
  if (record.status === "passed") {
    try {
      verifyPreviewBudgetRecord(record);
      assert.equal(record.assetManifestSha256, await currentAssetDigest());
    } catch {
      record.status = "failed";
      record.error = "Strict final preview evidence verification failed";
    }
  } else {
    record.fixtureStderrDiagnostic = stderr.slice(-8192).split(privateToken).join("[REDACTED]");
  }
  const report = join(destination, "preview-budget.json");
  const serialized = JSON.stringify(record, null, 2);
  assert(!serialized.includes(privateToken), "Private credential reached report serialization");
  await writeFile(report, serialized, { mode: 0o600, flag: "wx" });
  console.log("Nonsecret evidence: " + report);
  if (record.status === "passed") {
    await verifyPreviewBudgetFile(report);
  } else {
    process.exitCode = 1;
  }
}
