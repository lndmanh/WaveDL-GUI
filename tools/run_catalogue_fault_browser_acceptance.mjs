#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, readdir, lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { boundedCommand } from "./run_retained_browser_acceptance.mjs";
import { createBrowserActions, DRIVER_READINESS_MODE } from "./browser_actions.mjs";
import { browserLaunchArgs, browserTemporaryEnvironment } from "./browser_launch_policy.mjs";
import { currentAssetDigest } from "./verify_adoption_negative_browser_report.mjs";
import { verifyCatalogueFaultRecord } from "./verify_catalogue_fault_browser_report.mjs";
import { boundedFile } from "./verify_retained_browser_report.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const python = process.env.WAVEDL_PYTHON ?? "python", browser = process.env.AGENT_BROWSER_BIN ?? "agent-browser";
assert(!process.env.WAVEDL_BROWSER_ASSETS);
const destination = process.argv[2] ? resolve(process.argv[2]) : await mkdtemp(join(tmpdir(), "wavedl-catalogue-"));
await mkdir(destination, { recursive: true, mode: 0o700 });
assert.deepEqual(await readdir(destination), []);
const root = join(destination, "fixture"), profile = join(destination, "profile"), credential = join(destination, ".token");
await mkdir(root, { mode: 0o700 }); await mkdir(profile, { mode: 0o700 });
const ownedToken = randomBytes(32).toString("base64url");
await writeFile(credential, ownedToken, { mode: 0o600, flag: "wx" });
const env = { ...process.env, PYTHONPATH: join(repo, "src"), OMP_NUM_THREADS: "1", MKL_NUM_THREADS: "1", OPENBLAS_NUM_THREADS: "1" };
const session = `catalogue-${randomUUID()}`;
const child = spawn(python, ["tools/browser_catalogue_fault_fixture.py", "--root", root, "--token-file", credential], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
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
const inspect = async () => JSON.parse(await boundedCommand(python, ["tools/browser_catalogue_fault_fixture.py", "--root", root, "--inspect"], { cwd: repo, env }));
const wait = expression => command(["wait", "--fn", expression]);
const selectRoot = async () => {
  await command(["click", await actions.readyControl("field", "Configured root", false, { locator: 'xpath=//*[@role="combobox" and @aria-label="Configured root"]' })]);
  await actions.option("datasets");
  await command(["wait", "--text", "samples.npz"]);
};
const arm = mode => writeFile(join(root, ".catalogue-control"), mode, { flag: "wx", mode: 0o600 });
const reconnect = async () => {
  if (!(await dom("JSON.stringify(!!document.querySelector('#daemon-bearer'))"))) await actions.button("Connection", false, { scope: "//header" });
  await actions.fill("Daemon bearer credential", (await readFile(credential, "utf8")).trim());
  await actions.button("Connect securely");
  await command(["wait", "--text", "Connected"]);
};
const observe = () => dom(`JSON.stringify({alerts:Array.from(document.querySelectorAll('[role="alert"],[role="status"]')).filter(e=>e.getClientRects().length).map(e=>e.textContent.trim()).filter(Boolean),files:Array.from(document.querySelectorAll('button[aria-label^="Select file "]')).filter(e=>e.getClientRects().length).length,models:Array.from(document.querySelectorAll('button')).filter(e=>e.getClientRects().length && /^Choose /.test((e.getAttribute('aria-label') || e.textContent).trim())).length,header:Array.from(document.querySelectorAll('section[aria-label="Dataset header summary"]')).some(e=>e.getClientRects().length && e.querySelector('dl')),plan:Array.from(document.querySelectorAll('[aria-label="Approved normalized manifest"]')).some(e=>e.getClientRects().length),outside:document.body.innerText.includes('../outside')})`);
const r = { name: "catalogue-header-fault", status: "running", driverReadinessMode: DRIVER_READINESS_MODE, cases: [], limitation: "Seven explicit one-shot response-boundary faults plus two native owned local child-location refusals; not root-location, remote filesystem, remote outage or Slurm certification." };
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
  r.stage = "datasets-baseline";
  r.stage = "datasets-navigation";
  await actions.button("Datasets"); await command(["wait", "--text", "Explore daemon datasets"]);
  r.stage = "datasets-select-root";
  await selectRoot();
  r.stage = "datasets-select-file";
  await actions.button("Select file samples.npz", false, { scope: '//section[@aria-label="Daemon files"]' });
  r.stage = "datasets-header-baseline";
  await wait(`Array.from(document.querySelectorAll('section[aria-label="Dataset header summary"]')).some(e=>e.getClientRects().length && e.querySelector('dl'))`);
  r.baseline = await observe();
  for (const mode of ["roots", "traversal", "header", "shape"]) {
    r.stage = `${mode}-refusal`;
    console.log(`Catalogue phase: ${mode}`);
    await arm(mode);
    if (mode === "roots") await actions.button("Reload configured roots");
    else if (mode === "traversal") await actions.button("Refresh directory");
    else await actions.button("Refresh header");
    const message = ["roots", "traversal"].includes(mode) ? "Catalogue unavailable." : "Dataset inspection refused or unavailable.";
    await wait(`Array.from(document.querySelectorAll('[role="alert"],[role="status"]')).some(e=>e.getClientRects().length && (e.textContent.includes(${JSON.stringify(message)}) || e.textContent.includes('The daemon returned an invalid response.')))`);
    const refusal = await observe();
    console.log(`Catalogue refusal observed: ${mode}`);
    r.stage = `${mode}-public-reconnect-reselection`;
    await reconnect(); await actions.button("Datasets"); await selectRoot();
    await actions.button("Select file samples.npz", false, { scope: '//section[@aria-label="Daemon files"]' });
    await wait(`Array.from(document.querySelectorAll('section[aria-label="Dataset header summary"]')).some(e=>e.getClientRects().length && e.querySelector('dl'))`);
    r.cases.push({ mode, refusal, retry: await observe(), state: await inspect() });
  }
  r.stage = "training-dataset-selection";
  await actions.button("New training run"); await selectRoot(); await actions.button("Select file samples.npz", false, { scope: '//section[@aria-label="Training dataset"]' });
  await command(["wait", "--fn", "Array.from(document.querySelectorAll('p')).some(e=>e.textContent.trim().startsWith('Dataset: ')&&e.textContent.includes('/samples.npz'))"]);
  await actions.button("Next step"); await command(["wait", "--text", "Choose CNN"]);
  for (const mode of ["claim", "malformed-model", "outage"]) {
    r.stage = `${mode}-refusal`;
    console.log(`Catalogue phase: ${mode}`);
    await arm(mode); await actions.button("Reload catalogue");
    await wait("Array.from(document.querySelectorAll('[role=\"alert\"],[role=\"status\"]')).some(e=>e.getClientRects().length && (e.textContent.includes('Model catalogue unavailable.') || e.textContent.includes('The daemon returned an invalid response.')))");
    const refusal = await observe();
    r.stage = `${mode}-public-retry`;
    if (mode === "outage") { await actions.button("Reload catalogue"); }
    else {
      await reconnect(); await actions.button("New training run"); await selectRoot(); await actions.button("Select file samples.npz", false, { scope: '//section[@aria-label="Training dataset"]' });
      await command(["wait", "--fn", "Array.from(document.querySelectorAll('p')).some(e=>e.textContent.trim().startsWith('Dataset: ')&&e.textContent.includes('/samples.npz'))"]);
      await actions.button("Next step");
    }
    await command(["wait", "--text", "Choose CNN"]);
    r.cases.push({ mode, refusal, retry: await observe(), state: await inspect() });
  }
  // Select only from a recovered genuine catalogue; never approve or submit.
  await actions.button("Choose CNN");
  await wait("Array.from(document.querySelectorAll('p')).some(e=>e.textContent.trim().startsWith('Model: cnn'))");
  r.recoveredModel = await dom(`JSON.stringify(Array.from(document.querySelectorAll('p')).some(e=>e.textContent.trim().startsWith('Model: cnn')))`);
  await actions.button("Datasets"); await selectRoot();
  for (const [mode, childName] of [["unreadable", "unreadable-location"], ["oversized", "oversized-location"]]) {
    r.stage = `${mode}-native-folder-refusal`;
    console.log(`Catalogue phase: ${mode}`);
    await actions.button(childName, false, { scope: '//section[@aria-label="Daemon files"]' });
    await wait(`Array.from(document.querySelectorAll('[role="alert"],[role="status"]')).some(e=>e.getClientRects().length && e.textContent.includes('Catalogue unavailable.'))`);
    const refusal = await observe();
    r.stage = `${mode}-public-root-retry`;
    await actions.button("Reload configured roots", false, { scope: '//section[@aria-label="Daemon files"]' });
    await selectRoot();
    await actions.button("Select file samples.npz", false, { scope: '//section[@aria-label="Daemon files"]' });
    await wait(`Array.from(document.querySelectorAll('section[aria-label="Dataset header summary"]')).some(e=>e.getClientRects().length && e.querySelector('dl'))`);
    r.cases.push({ mode, refusal, retry: await observe(), state: await inspect(), recovery: "public-reload-roots-reselect-root-and-file" });
  }
  r.responses = new TextDecoder("utf-8", { fatal: true }).decode(await boundedFile(join(root, ".catalogue-responses.jsonl"), 2 * 1024 * 1024)).trim().split("\n").map(JSON.parse);
  r.after = await inspect(); r.status = "passed";
  assert.equal(await currentAssetDigest(), r.assetManifestSha256);
  r.finalStorage = await dom("JSON.stringify({cookies:document.cookie,localStorageKeys:Object.keys(localStorage),sessionStorageKeys:Object.keys(sessionStorage)})");
} catch (error) {
  r.status = "failed"; r.failureCommand = r.command;
  r.error = `Catalogue browser acceptance failed at ${r.stage ?? "unknown"}: ${String(error.message ?? error).slice(0, 300)}`;
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
  r.cleanup = { browserAbsent, fixtureReaped: closed, servicesClosed: stdout.includes("Fixture: services-closed"), listenerClosed, nativePermissionsRestored: stdout.includes("Fixture: native-permissions-restored"), ownedRemoved: false };
  r.cleanup.errors = [];
  if (browserAbsent && closed && r.cleanup.servicesClosed && listenerClosed && r.cleanup.nativePermissionsRestored) {
    try { for (const path of [root, profile, credential]) { await rm(path, { force: true, recursive: true }); await assert.rejects(lstat(path), e => e.code === "ENOENT"); } r.cleanup.ownedRemoved = true; }
    catch { r.cleanup.errors.push("Owned path removal unconfirmed"); }
  } else r.cleanup.errors.push("Service or browser cleanup unconfirmed");
  if (r.cleanup.errors.length) { r.status = "failed"; r.error ??= "Cleanup failed"; r.retainedPrivateRoots = [root, profile, credential]; }
  if (r.status === "passed") { try { verifyCatalogueFaultRecord(r); } catch (error) { r.status = "failed"; r.error = `Strict verification: ${error.message}`; } }
  const serialized = JSON.stringify(r, null, 2);
  assert(!serialized.includes(ownedToken), "Credential in report refused");
  const report = join(destination, "catalogue-fault.json"); await writeFile(report, serialized, { mode: 0o600, flag: "wx" });
  console.log(`Nonsecret evidence: ${report}`); if (r.status !== "passed") { console.error(r.error); process.exitCode = 1; }
}
