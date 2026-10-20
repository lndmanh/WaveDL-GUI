#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, readdir, lstat, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { boundedCommand } from "./run_retained_browser_acceptance.mjs";
import { createBrowserActions, DRIVER_READINESS_MODE } from "./browser_actions.mjs";
import { browserLaunchArgs, browserTemporaryEnvironment } from "./browser_launch_policy.mjs";
import { currentAssetDigest } from "./verify_adoption_negative_browser_report.mjs";
import { verifyHeaderDeadlineRecord } from "./verify_header_deadline_browser_report.mjs";
import { boundedFile } from "./verify_retained_browser_report.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const python = process.env.WAVEDL_PYTHON ?? "python", browser = process.env.AGENT_BROWSER_BIN ?? "agent-browser";
assert(!process.env.WAVEDL_BROWSER_ASSETS);
const destination = process.argv[2] ? resolve(process.argv[2]) : await mkdtemp(join(await realpath(tmpdir()), "wavedl-header-deadline-"));
await mkdir(destination, { recursive: true, mode: 0o700 });
assert.deepEqual(await readdir(destination), []);
const root = join(destination, "fixture"), profile = join(destination, "profile"), credential = join(destination, ".token");
await mkdir(root, { mode: 0o700 }); await mkdir(profile, { mode: 0o700 });
const ownedToken = randomBytes(32).toString("base64url");
await writeFile(credential, ownedToken, { mode: 0o600, flag: "wx" });
const env = { ...process.env, PYTHONPATH: join(repo, "src"), OMP_NUM_THREADS: "1", MKL_NUM_THREADS: "1", OPENBLAS_NUM_THREADS: "1" };
const session = `header-deadline-${randomUUID()}`;
const child = spawn(python, ["tools/browser_header_deadline_fixture.py", "--root", root, "--token-file", credential], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
let stdout = "", closed = false, opened = false, origin = null;
child.stdout.on("data", chunk => { stdout = (stdout + chunk).slice(-1048576); });
child.stderr.on("data", () => {}); child.on("close", () => { closed = true; });
const delay = ms => new Promise(done => setTimeout(done, ms));
const command = args => {
  r.command = args[0];
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")));
  return boundedCommand(browser, ["--session", session, ...(args[0] === "open" ? ["--args", browserLaunchArgs] : []), ...args], { cwd: repo, env: browserTemporaryEnvironment({ ...environment, AGENT_BROWSER_SESSION: session }), timeout: 35000 });
};
const dom = async script => JSON.parse(JSON.parse(await command(["eval", "-b", Buffer.from(script).toString("base64")])));
const actions = createBrowserActions({ cli: (...args) => command(args), dom, snapshot: () => command(["snapshot", "-i"]) });
const inspect = async () => JSON.parse(await boundedCommand(python, ["tools/browser_header_deadline_fixture.py", "--root", root, "--inspect"], { cwd: repo, env }));
const wait = expression => command(["wait", "--fn", expression]);
const selectRoot = async () => {
  await command(["click", await actions.readyControl("field", "Configured root", false, { locator: 'xpath=//*[@role="combobox" and @aria-label="Configured root"]' })]);
  await actions.option("datasets");
  await command(["wait", "--text", "samples.npz"]);
};
const observe = () => dom(`JSON.stringify({alerts:Array.from(document.querySelectorAll('[role="alert"],[role="status"]')).filter(e=>e.getClientRects().length).map(e=>e.textContent.trim()).filter(Boolean),fields:Object.fromEntries(Array.from(document.querySelectorAll('section[aria-label="Dataset header summary"] dl dt')).filter(e=>e.getClientRects().length).map(e=>[e.textContent.trim(),e.nextElementSibling.textContent.trim()])),connected:Array.from(document.querySelectorAll('header *')).some(e=>e.getClientRects().length && e.textContent.trim()==='Connected'),header:Array.from(document.querySelectorAll('section[aria-label="Dataset header summary"]')).some(e=>e.getClientRects().length && e.querySelector('dl')),dimensions:Array.from(document.querySelectorAll('section[aria-label="Dataset header summary"] dl')).filter(e=>e.getClientRects().length).map(e=>e.textContent.trim()).join(' ')})`);
const r = { name: "header-deadline", status: "running", driverReadinessMode: DRIVER_READINESS_MODE, limitation: "Fixture-controlled single child with reduced 2s command deadline, normal 30s pool; no descendants. Not parser-specific hang, default deadline, disconnect, Stop, capacity saturation, remote filesystem or Slurm certification." };
try {
  r.stage = "fixture-ready";
  r.browser = (await boundedCommand(browser, ["--version"], { cwd: repo })).trim();
  r.initialProfileEmpty = (await readdir(profile)).length === 0;
  const deadline = Date.now() + 180000; let url;
  while (!(url = stdout.match(/Browser: (http:\/\/[^\s]+)/)?.[1])) { assert(!closed && Date.now() < deadline, "Fixture startup failed"); await delay(100); }
  origin = new URL(url).origin;
  r.before = await inspect(); r.assetManifestSha256 = await currentAssetDigest();
  opened = true;
  r.stage = "browser-open";
  await command(["open", "--engine", "chrome", "--profile", profile, "--allowed-domains", "127.0.0.1,localhost", ...(process.env.WAVEDL_BROWSER_EXECUTABLE ? ["--executable-path", process.env.WAVEDL_BROWSER_EXECUTABLE] : []), url]);
  await command(["wait", "--text", "Connected"]);
  r.browserObserved = await dom("JSON.stringify({userAgent:navigator.userAgent,cookies:document.cookie,localStorageKeys:Object.keys(localStorage),sessionStorageKeys:Object.keys(sessionStorage)})");
  r.stage = "public-dataset-selection";
  await actions.button("Datasets"); await command(["wait", "--text", "Explore daemon datasets"]);
  await selectRoot();
  await writeFile(join(root, ".header-deadline-control"), "stall-once", { flag: "wx", mode: 0o600 });
  await actions.button("Select file samples.npz", false, { scope: '//section[@aria-label="Daemon files"]' });
  await wait('Array.from(document.querySelectorAll("[role=alert],[role=status]")).some(e=>e.getClientRects().length && e.textContent.includes("Dataset inspection refused or unavailable."))');
  r.refusal = await observe();
  r.stage = "public-refresh-header";
  await actions.button("Refresh header");
  await wait('Array.from(document.querySelectorAll(\'section[aria-label="Dataset header summary"]\')).some(e=>e.getClientRects().length && e.querySelector("dl"))');
  r.retry = await observe(); r.recovery = "public-refresh-header-without-reconnect";
  const readReceipts = async name => new TextDecoder("utf-8", { fatal: true }).decode(await boundedFile(join(root, name), 524288)).trim().split("\n").map(JSON.parse);
  const receiptsDeadline = Date.now() + 5000;
  do {
    r.commands = await readReceipts(".header-deadline-commands.jsonl");
    r.http = await readReceipts(".header-deadline-http.jsonl");
    if (r.http.filter(h => h.endpoint === "/api/datasets/inspect").length >= 2) break;
    await delay(50);
  } while (Date.now() < receiptsDeadline);
  r.after = await inspect(); r.status = "passed";
  assert.equal(await currentAssetDigest(), r.assetManifestSha256);
  r.finalStorage = await dom("JSON.stringify({cookies:document.cookie,localStorageKeys:Object.keys(localStorage),sessionStorageKeys:Object.keys(sessionStorage)})");
} catch (error) {
  r.status = "failed"; r.failureCommand = r.command;
  r.error = `HEADER deadline browser acceptance failed at ${r.stage ?? "unknown"}: ${String(error.message ?? error).slice(0, 300)}`;
  // Public structure/text only: never capture input values, URLs or credentials.
  if (opened) r.failureDom = await dom(`JSON.stringify(Array.from(document.querySelectorAll('section,button,h1,h2,h3,[role="alert"],[role="status"]')).map(e=>({tag:e.tagName,label:e.getAttribute('aria-label'),text:e.matches('section')?null:e.textContent.trim().slice(0,180)})))`).catch(() => []);
}
finally {
  if (opened) await command(["close"]).catch(() => {});
  let browserAbsent = false;
  const browserDeadline = Date.now() + 30000;
  do { browserAbsent = !(await boundedCommand(browser, ["session", "list"], { cwd: repo, timeout: 10000 }).catch(() => session)).includes(session); if (!browserAbsent) await delay(250); } while (!browserAbsent && Date.now() < browserDeadline);
  if (!closed) child.kill("SIGINT");
  const deadline = Date.now() + 15000; while (!closed && Date.now() < deadline) await delay(100);
  if (!closed) { child.kill("SIGKILL"); const killDeadline = Date.now() + 3000; while (!closed && Date.now() < killDeadline) await delay(100); }
  const listenerClosed = closed && origin ? await new Promise(done => { const address = new URL(origin), socket = connect({ host: address.hostname, port: Number(address.port) }); socket.setTimeout(2000, () => { socket.destroy(); done(false); }); socket.on("connect", () => { socket.destroy(); done(false); }); socket.on("error", error => { socket.destroy(); done(error.code === "ECONNREFUSED"); }); }) : false;
  r.cleanup = { browserAbsent, fixtureReaped: closed, servicesClosed: stdout.includes("Fixture: services-closed"), listenerClosed, childrenAbsent: (r.commands?.length === 2 && r.commands.every(c => { try { process.kill(c.pid, 0); return false; } catch (e) { return e.code === "ESRCH"; } })), ownedRemoved: false };
  r.cleanup.errors = [];
  if (r.status === "passed") {
    // Verify substantive evidence before deleting private fixture receipts.
    // This projected removal flag is never persisted as actual cleanup proof.
    try { verifyHeaderDeadlineRecord({ ...r, cleanup: { ...r.cleanup, ownedRemoved: true } }); }
    catch (error) { r.status = "failed"; r.error = `Strict pre-cleanup verification: ${error.message}`; }
  }
  if (r.status === "passed" && browserAbsent && closed && r.cleanup.servicesClosed && listenerClosed && r.cleanup.childrenAbsent) {
    try { for (const path of [root, profile, credential]) { await rm(path, { force: true, recursive: true }); await assert.rejects(lstat(path), e => e.code === "ENOENT"); } r.cleanup.ownedRemoved = true; }
    catch { r.cleanup.errors.push("Owned path removal unconfirmed"); }
  } else r.cleanup.errors.push(r.status !== "passed" ? "Owned evidence retained after acceptance failure" : "Service or browser cleanup unconfirmed");
  if (r.cleanup.errors.length) { r.status = "failed"; r.error ??= "Cleanup failed"; r.retainedPrivateRoots = [root, profile, credential]; }
  if (r.status === "passed") { try { verifyHeaderDeadlineRecord(r); } catch (error) { r.status = "failed"; r.error = `Strict verification: ${error.message}`; } }
  const serialized = JSON.stringify(r, null, 2);
  assert(!serialized.includes(ownedToken), "Credential in report refused");
  const report = join(destination, "header-deadline.json"); await writeFile(report, serialized, { mode: 0o600, flag: "wx" });
  console.log(`Nonsecret evidence: ${report}`); if (r.status !== "passed") { console.error(r.error); process.exitCode = 1; }
}
