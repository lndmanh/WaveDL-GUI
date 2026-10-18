#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, realpath, lstat, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { connect } from "node:net";
import { boundedCommand } from "./run_retained_browser_acceptance.mjs";
import { boundedFile } from "./verify_retained_browser_report.mjs";
import { createBrowserActions, DRIVER_READINESS_MODE } from "./browser_actions.mjs";
import { browserLaunchArgs } from "./browser_launch_policy.mjs";
import { currentAssetDigest } from "./verify_adoption_negative_browser_report.mjs";
import { verifyPreviewFaultFile, verifyPreviewFaultRecord } from "./verify_preview_fault_browser_report.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const python = process.env.WAVEDL_PYTHON ?? "python", browser = process.env.AGENT_BROWSER_BIN ?? "agent-browser";
assert(!process.env.WAVEDL_BROWSER_ASSETS);
const destination = process.argv[2] ? resolve(process.argv[2]) : await mkdtemp(join(await realpath(tmpdir()), "wavedl-preview-fault-"));
await mkdir(destination, { recursive: true, mode: 0o700 });
assert(!(await lstat(destination)).isSymbolicLink());
assert.deepEqual(await readdir(destination), []);
const root = join(destination, "fixture"), profile = join(destination, "profile"), credential = join(destination, ".token");
await mkdir(root, { mode: 0o700 }); await mkdir(profile, { mode: 0o700 });
await writeFile(credential, randomBytes(32).toString("base64url"), { mode: 0o600, flag: "wx" });
const env = { ...process.env, PYTHONPATH: join(repo, "src"), OMP_NUM_THREADS: "1", MKL_NUM_THREADS: "1", OPENBLAS_NUM_THREADS: "1", MPLBACKEND: "Agg" };
const session = `preview-fault-${randomUUID()}`;
const child = spawn(python, ["tools/browser_preview_fault_fixture.py", "--root", root, "--token-file", credential], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
let stdout = "", childError = null, childClosed = false, opened = false, origin = null;
child.stdout.on("data", chunk => { stdout = (stdout + chunk).slice(-1024 * 1024); });
child.stderr.on("data", () => {});
child.on("error", error => { childError = error; }); child.on("close", () => { childClosed = true; });
const r = { name: "dataset-preview-fault", status: "running", driverReadinessMode: DRIVER_READINESS_MODE, limitation: "Fixture-only supervised phase barriers and ordinary local file mutation; explicit Stop loading exercises the local preview UI; no remote or site certification." };
const delay = ms => new Promise(done => setTimeout(done, ms));
const command = args => {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) if (key.startsWith("AGENT_BROWSER_")) delete environment[key];
  environment.AGENT_BROWSER_SESSION = session;
  return boundedCommand(browser, ["--session", session, ...(args[0] === "open" ? ["--args", browserLaunchArgs] : []), ...args], { cwd: repo, env: environment, timeout: 35000 });
};
const dom = async script => JSON.parse(JSON.parse(await command(["eval", "-b", Buffer.from(script).toString("base64")])));
const actions = createBrowserActions({ cli: (...args) => command(args), dom, snapshot: () => command(["snapshot", "-i"]) });
const text = async name => new TextDecoder("utf-8", { fatal: true }).decode(await boundedFile(join(root, name), 2 * 1024 * 1024));
const inspect = async () => JSON.parse(await boundedCommand(python, ["tools/browser_preview_fault_fixture.py", "--root", root, "--inspect"], { cwd: repo, env }));
const poll = async (get, ok, label) => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { const value = await get().catch(() => null); if (ok(value)) return value; await delay(100); }
  throw new Error(label);
};
const processes = async () => (await text(".preview-processes.jsonl")).trim().split("\n").map(JSON.parse);
const preview = `document.querySelector('section[aria-label="Dataset visualization"]')`;
try {
  r.browser = (await boundedCommand(browser, ["--version"], { cwd: repo })).trim();
  r.initialProfileEmpty = (await readdir(profile)).length === 0;
  const deadline = Date.now() + 180000;
  let url;
  while (!(url = stdout.match(/Browser: (http:\/\/[^\s]+)/)?.[1])) { assert(!childError && !childClosed && Date.now() < deadline, "Fixture readiness failed"); await delay(100); }
  origin = new URL(url).origin;
  r.before = await inspect();
  r.assetManifestSha256 = await currentAssetDigest();
  opened = true;
  await command(["open", "--engine", "chrome", "--profile", profile, "--allowed-domains", "127.0.0.1,localhost", ...(process.env.WAVEDL_BROWSER_EXECUTABLE ? ["--executable-path", process.env.WAVEDL_BROWSER_EXECUTABLE] : []), url]);
  await command(["set", "viewport", "1280", "900"]); await command(["wait", "--text", "Connected"]);
  r.browserObserved = await dom("JSON.stringify({userAgent:navigator.userAgent,width:innerWidth,height:innerHeight,cookies:document.cookie,localStorageKeys:Object.keys(localStorage),sessionStorageKeys:Object.keys(sessionStorage)})");
  await actions.button("Datasets");
  await command(["wait", "--text", "Explore daemon datasets"]);
  await command(["click", await actions.readyControl("field", "Configured root", false, { locator: 'xpath=//*[@role="combobox" and @aria-label="Configured root"]' })]); await actions.option("datasets");
  await actions.button("Select file samples.npz");
  r.mutationReady = await poll(async () => JSON.parse(await text(".preview-ready-1.json")), Boolean, "First real child readiness timeout");
  r.pending = await dom(`JSON.stringify({loading:${preview}.innerText.includes('Loading bounded daemon preview'),canvases:${preview}.querySelectorAll('canvas').length})`);
  await boundedCommand(python, ["-c", "import sys;from pathlib import Path;p=Path(sys.argv[1]);(p/'.original-npz').write_bytes((p/'samples.npz').read_bytes());f=(p/'samples.npz').open('ab');f.write(b'owned-preview-mutation');f.close()", root], { cwd: repo, env });
  r.mutated = await inspect();
  await writeFile(join(root, ".preview-release-1"), "release", { flag: "wx" });
  await command(["wait", "--fn", `!${preview}.innerText.includes('Loading bounded daemon preview') && ${preview}.querySelectorAll('canvas').length === 0`]);
  r.refusal = await dom(`JSON.stringify({message:${preview}.querySelector('[role="status"]')?.textContent.trim(),canvases:${preview}.querySelectorAll('canvas').length,figures:${preview}.querySelectorAll('figure').length})`);
  await poll(processes, value => value?.some(p => p.phase === 1 && p.pidAbsent), "Mutation child not reaped");
  await boundedCommand(python, ["-c", "import sys;from pathlib import Path;p=Path(sys.argv[1]);(p/'samples.npz').write_bytes((p/'.original-npz').read_bytes())", root], { cwd: repo, env });
  r.restored = await inspect();
  await actions.button("Refresh preview");
  r.cancelReady = await poll(async () => JSON.parse(await text(".preview-ready-2.json")), Boolean, "Cancellation child readiness timeout");
  r.cancelPending = await dom(`JSON.stringify({loading:${preview}.innerText.includes('Loading bounded daemon preview'),canvases:${preview}.querySelectorAll('canvas').length})`);
  await actions.button("Select file samples.mat");
  await poll(processes, value => value?.some(p => p.phase === 2 && p.cancelled && p.pidAbsent), "Reselection cancellation not drained");
  await command(["wait", "--fn", `${preview}.innerText.includes('MAT') && ${preview}.querySelectorAll('canvas').length > 0`]);
  r.reselection = await dom(`JSON.stringify({format:${preview}.innerText.includes('MAT'),canvases:${preview}.querySelectorAll('canvas').length})`);
  await actions.button("Select file samples.npz");
  await command(["wait", "--fn", `${preview}.innerText.includes('NPZ') && ${preview}.querySelectorAll('canvas').length > 0`]);
  r.retry = await dom(`JSON.stringify({format:${preview}.innerText.includes('NPZ'),canvases:${preview}.querySelectorAll('canvas').length,figures:${preview}.querySelectorAll('figure').length})`);
  await actions.button("Refresh preview");
  r.stopReady = await poll(async () => JSON.parse(await text(".preview-ready-5.json")), value => value?.phase === 5, "Explicit Stop child readiness timeout");
  r.stopReady.pidAlive = await boundedCommand(python, ["-c", "import os,sys;os.kill(int(sys.argv[1]),0);print('alive')", String(r.stopReady.pid)], { cwd: repo, env }).then(value => value.trim() === "alive");
  r.stopCapacityPending = await poll(async () => JSON.parse(await text(".preview-capacity.json")), value => value?.phase === 5 && value.outstanding > 0, "Stop child capacity was not occupied");
  r.stopPending = await dom(`JSON.stringify({loading:${preview}.innerText.includes('Loading bounded daemon preview'),canvases:${preview}.querySelectorAll('canvas').length,figures:${preview}.querySelectorAll('figure').length,stopButtons:Array.from(${preview}.querySelectorAll('button')).filter(b => b.textContent.trim() === 'Stop loading' && b.getClientRects().length && !b.disabled).length})`);
  await actions.button("Stop loading", false, { scope: '//section[@aria-label="Dataset visualization"]' });
  await poll(processes, value => value?.some(p => p.phase === 5 && p.cancelled && p.pidAbsent), "Explicit Stop child not cancelled and reaped");
  r.stopCapacity = await poll(async () => JSON.parse(await text(".preview-capacity.json")), value => value?.phase === 5 && value.outstanding === 0, "Explicit Stop did not release capacity");
  r.stopResult = await dom(`JSON.stringify({loading:${preview}.innerText.includes('Loading bounded daemon preview'),message:${preview}.querySelector('[role="status"]')?.textContent.trim(),canvases:${preview}.querySelectorAll('canvas').length,figures:${preview}.querySelectorAll('figure').length,stopButtons:Array.from(${preview}.querySelectorAll('button')).filter(b => b.textContent.trim() === 'Stop loading').length})`);
  await actions.button("Refresh preview");
  await command(["wait", "--fn", `${preview}.innerText.includes('NPZ') && ${preview}.querySelectorAll('canvas').length > 0`]);
  r.stopRetry = await dom(`JSON.stringify({format:${preview}.innerText.includes('NPZ'),canvases:${preview}.querySelectorAll('canvas').length,figures:${preview}.querySelectorAll('figure').length})`);
  r.status = "passed";
} catch (error) { r.status = "failed"; r.error = String(error.message ?? error).slice(0, 1024); }
finally {
  const errors = [];
  let browserSessionAbsent = !opened;
  if (opened) {
    await command(["close"]).catch(() => {});
    const deadline = Date.now() + 30000;
    do { browserSessionAbsent = !(await boundedCommand(browser, ["session", "list"], { cwd: repo, timeout: 10000 })).split("\n").some(line => line.includes(session)); if (!browserSessionAbsent) await delay(250); } while (!browserSessionAbsent && Date.now() < deadline);
  }
  if (!browserSessionAbsent) errors.push("Browser remains");
  if (!childClosed) child.kill("SIGINT");
  const deadline = Date.now() + 15000; while (!childClosed && Date.now() < deadline) await delay(100);
  if (!childClosed) { child.kill("SIGKILL"); errors.push("Graceful fixture cleanup timeout"); }
  const servicesClosed = stdout.includes("Fixture: services-closed"); if (!servicesClosed) errors.push("Services closure unproven");
  const listenerClosed = childClosed && origin ? await new Promise(done => { const address = new URL(origin), socket = connect({ host: address.hostname, port: Number(address.port) }); socket.setTimeout(2000, () => {socket.destroy();done(false);}); socket.on("connect", () => {socket.destroy();done(false);}); socket.on("error", error => {socket.destroy();done(error.code === "ECONNREFUSED");}); }) : false;
  if (!listenerClosed) errors.push("Listener closure unproven");
  if (r.status === "passed") {
    try { r.after = await inspect(); r.processes = await processes(); r.responses = (await text(".preview-responses.jsonl")).trim().split("\n").map(JSON.parse); r.drained = JSON.parse(await text(".preview-drained.json")); }
    catch { r.status = "failed"; r.error = "Post-teardown evidence unavailable"; }
  }
  r.cleanup = { errors, browserSessionAbsent, fixtureReaped: childClosed, servicesClosed, listenerClosed, ownedRootsRemoved: false, browserProfileRemoved: false, privateCredentialRemoved: false };
  if (!errors.length) {
    for (const path of [root, profile, credential]) { await rm(path, { recursive: true, force: true }); await assert.rejects(lstat(path), e => e.code === "ENOENT"); }
    r.cleanup.ownedRootsRemoved = r.cleanup.browserProfileRemoved = r.cleanup.privateCredentialRemoved = true;
  } else { r.status = "failed"; r.retainedPrivateRoots = [root, profile, credential]; }
  if (r.status === "passed") {
    try { verifyPreviewFaultRecord(r); assert.equal(r.assetManifestSha256, await currentAssetDigest()); }
    catch { r.status = "failed"; r.error = "Strict final preview evidence verification failed"; }
  }
  const report = join(destination, "preview-fault.json"); await writeFile(report, JSON.stringify(r, null, 2), { mode: 0o600, flag: "wx" });
  console.log(`Nonsecret evidence: ${report}`);
  if (r.status === "passed") await verifyPreviewFaultFile(report); else process.exitCode = 1;
}
