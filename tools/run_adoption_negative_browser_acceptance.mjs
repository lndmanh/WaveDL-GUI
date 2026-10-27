#!/usr/bin/env node
// Independent actual browser gate: ordinary fault copies, unchanged public handler.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, realpath, lstat, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { connect } from "node:net";
import { boundedCommand } from "./browser_process.mjs";
import { createBrowserActions, DRIVER_READINESS_MODE } from "./browser_actions.mjs";
import { browserLaunchArgs } from "./browser_launch_policy.mjs";
import { verifyNegativeAdoptionFile, currentAssetDigest } from "./verify_adoption_negative_browser_report.mjs";
import { boundedFile } from "./browser_files.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const python = process.env.WAVEDL_PYTHON ?? "python";
const browser = process.env.AGENT_BROWSER_BIN ?? "agent-browser";
assert(!process.env.WAVEDL_BROWSER_ASSETS, "Current packaged assets only");
const destination = process.argv[2] ? resolve(process.argv[2]) : await mkdtemp(join(await realpath(tmpdir()), "wavedl-adoption-negative-"));
await mkdir(destination, { recursive: true, mode: 0o700 });
assert(!(await lstat(destination)).isSymbolicLink());
assert.deepEqual(await readdir(destination), [], "Report directory must be empty");
const root = join(destination, "fixture"), profile = join(destination, "profile"), credential = join(destination, ".token");
await mkdir(root, { mode: 0o700 }); await mkdir(profile, { mode: 0o700 });
await writeFile(credential, randomBytes(32).toString("base64url"), { mode: 0o600, flag: "wx" });
const session = `wave-negative-${randomUUID()}`;
const child = spawn(python, ["tools/browser_adoption_negative_fixture.py", "--root", root, "--token-file", credential], {
  cwd: repo, env: { ...process.env, PYTHONPATH: join(repo, "src"), OMP_NUM_THREADS: "1", MKL_NUM_THREADS: "1", OPENBLAS_NUM_THREADS: "1", MPLBACKEND: "Agg" }, stdio: ["ignore", "pipe", "pipe"] });
let stdout = "", childError = null, childClosed = false;
child.stdout.on("data", chunk => { stdout = (stdout + chunk).slice(-1024 * 1024); });
child.stderr.on("data", () => {}); // Never echo private fixture output.
child.on("error", error => { childError = error; });
child.on("close", () => { childClosed = true; });
const r = { name: "standalone-adoption-negative", status: "running", cases: [], limitation: "Local owned fault copies only; no OS foreign ownership, remote, GPU, Windows or site certification." };
r.driverReadinessMode = DRIVER_READINESS_MODE;
r.browser = (await boundedCommand(browser, ["--version"], { cwd: repo, timeout: 10000 })).trim();
r.initialProfileEmpty = (await readdir(profile)).length === 0;
const delay = ms => new Promise(done => setTimeout(done, ms));
let opened = false, origin = null;
const command = args => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("AGENT_BROWSER_")) delete env[key];
  env.AGENT_BROWSER_SESSION = session;
  return boundedCommand(browser, ["--session", session, ...(args[0] === "open" ? ["--args", browserLaunchArgs] : []), ...args], { cwd: repo, env, timeout: 35000 });
};
const dom = async script => JSON.parse(JSON.parse(await command(["eval", "-b", Buffer.from(script).toString("base64")])));
const actions = createBrowserActions({ cli: (...args) => command(args), dom, snapshot: () => command(["snapshot", "-i"]) });
const fixture = async flag => JSON.parse(await boundedCommand(python, ["tools/browser_adoption_negative_fixture.py", "--root", root, flag], { cwd: repo, env: { ...process.env, PYTHONPATH: join(repo, "src") } }));
const evidenceText = async name => new TextDecoder("utf-8", { fatal: true }).decode(await boundedFile(join(root, name), 1024 * 1024));
try {
  const deadline = Date.now() + 180000;
  let url;
  while (!(url = stdout.match(/Browser: (http:\/\/[^\s]+)/)?.[1])) {
    assert(!childError && !childClosed && Date.now() < deadline, "Fixture readiness failed");
    await delay(100);
  }
  const producer = JSON.parse(await evidenceText(".adoption-source-before.json"));
  origin = new URL(url).origin;
  r.producer = { returncode: producer.returncode, timedOut: producer.timedOut, cancelled: producer.cancelled };
  const prepared = await fixture("--prepare");
  r.before = await fixture("--inspect");
  assert.deepEqual(r.before.original, producer.source);
  r.assetManifestSha256 = await currentAssetDigest();
  opened = true;
  await command(["open", "--engine", "chrome", "--profile", profile, "--allowed-domains", "127.0.0.1,localhost", ...(process.env.WAVEDL_BROWSER_EXECUTABLE ? ["--executable-path", process.env.WAVEDL_BROWSER_EXECUTABLE] : []), url]);
  await command(["set", "viewport", "1280", "900"]);
  await command(["wait", "--text", "Connected"]);
  r.browserObserved = await dom("JSON.stringify({userAgent:navigator.userAgent,width:innerWidth,height:innerHeight,cookies:document.cookie,localStorageKeys:Object.keys(localStorage),sessionStorageKeys:Object.keys(sessionStorage)})");
  await actions.button("Adopt standalone run");
  await command(["wait", "--text", "Adopt a standalone run"]);
  await command(["click", await actions.readyControl("field", "Configured root", false, { locator: 'xpath=//*[@role="combobox" and @aria-label="Configured root"]' })]);
  await actions.option("datasets");
  for (const c of prepared.cases) {
    await actions.button(`Select directory ${c.mode}`);
    await actions.fill("Runtime attempt", "1");
    await actions.button("Confirm adoption");
    const message = c.mode === "missing-provenance" ? "Adoption acknowledgement is unknown. Reconnect and reselect the same directory and attempt, then retry the retained request." : "The daemon rejected adoption. No ownership confirmation was received.";
    await command(["wait", "--text", message]);
    const visible = await dom(`JSON.stringify(Array.from(document.querySelectorAll('[role="alert"]')).some(e=>e.getClientRects().length&&e.textContent.trim()===${JSON.stringify(message)}))`);
    assert(visible, "Truthful refusal must be visible");
    r.cases.push({ ...c, visibleMessage: message, visibleNoConfirmation: await dom("JSON.stringify(!document.body.innerText.includes('Daemon ownership confirmed.'))") });
  }
  r.responses = (await evidenceText(".adoption-response.json")).trim().split("\n").map(JSON.parse);
  r.after = await fixture("--inspect");
  r.status = "passed";
} catch (error) {
  r.status = "failed";
  r.error = String(error.message ?? error).slice(0, 1024);
} finally {
  const errors = [];
  let browserSessionAbsent = !opened;
  if (opened) {
    await command(["close"]).catch(() => {});
    const deadline = Date.now() + 30000;
    do {
      browserSessionAbsent = !(await boundedCommand(browser, ["session", "list"], { cwd: repo, timeout: 10000 })).split("\n").some(line => line.includes(session));
      if (!browserSessionAbsent) await delay(250);
    } while (!browserSessionAbsent && Date.now() < deadline);
  }
  if (!browserSessionAbsent) errors.push("Browser session remains");
  if (!childClosed) child.kill("SIGINT");
  const deadline = Date.now() + 15000;
  while (!childClosed && Date.now() < deadline) await delay(100);
  if (!childClosed) { child.kill("SIGKILL"); errors.push("Fixture graceful cleanup timed out"); }
  const servicesClosed = stdout.includes("Fixture: services-closed");
  if (!servicesClosed) errors.push("Fixture services not closed");
  let listenerClosed = false;
  if (childClosed && origin) {
    const address = new URL(origin);
    listenerClosed = await new Promise(done => {
      const socket = connect({ host: address.hostname, port: Number(address.port) });
      socket.setTimeout(2000, () => { socket.destroy(); done(false); });
      socket.on("connect", () => { socket.destroy(); done(false); });
      socket.on("error", error => { socket.destroy(); done(error.code === "ECONNREFUSED"); });
    });
  }
  if (!listenerClosed) errors.push("Listener closure unproven");
  if (r.status === "passed" && childClosed) {
    try {
      r.after = await fixture("--inspect");
      r.responses = (await evidenceText(".adoption-response.json")).trim().split("\n").map(JSON.parse);
    } catch { r.status = "failed"; r.error = "Final post-teardown evidence unavailable"; }
  }
  r.cleanup = { errors, browserSessionAbsent, fixtureReaped: childClosed, servicesClosed, listenerClosed, ownedRootsRemoved: false, browserProfileRemoved: false, privateCredentialRemoved: false };
  if (!errors.length) {
    for (const path of [root, profile, credential]) {
      await rm(path, { recursive: true, force: true });
      await assert.rejects(lstat(path), e => e.code === "ENOENT");
    }
    r.cleanup.ownedRootsRemoved = r.cleanup.browserProfileRemoved = r.cleanup.privateCredentialRemoved = true;
  } else { r.status = "failed"; r.retainedPrivateRoots = [root, profile, credential]; }
  const report = join(destination, "standalone-adoption-negative.json");
  await writeFile(report, JSON.stringify(r, null, 2), { mode: 0o600, flag: "wx" });
  console.log(`Nonsecret evidence: ${report}`);
  if (r.status === "passed") await verifyNegativeAdoptionFile(report);
  else process.exitCode = 1;
}
