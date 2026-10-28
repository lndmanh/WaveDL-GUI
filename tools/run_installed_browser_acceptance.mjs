#!/usr/bin/env node
import { openPlanDisclosure } from './browser_actions.mjs';
// Actual installed CLI, not a checkout ASGI fixture. All mutations use the UI.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, lstat, mkdir, open, readFile, readdir, realpath, rm, statfs, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection } from "node:net";
import { boundedCommand } from "./browser_process.mjs";
import { browserLaunchArgs, browserTemporaryEnvironment } from "./browser_launch_policy.mjs";
import { createBrowserActions, xpathLiteral } from "./browser_actions.mjs";
import { openTrainingEditor } from "./browser_training_editor.mjs";
import { resultOperations } from "./browser_result_operations.mjs";
import { observeCursorStorage, SESSION_CREDENTIAL_KEY } from "./browser_cursor_storage.mjs";
import { verifyInstalledBrowserRecord } from "./verify_installed_browser_report.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
assert(process.argv.length === 6, "Usage: runner WHEEL EMPTY_PRIVATE_REPORT_DIR OFFLINE_WHEELHOUSE EXPECTED_WHEEL_SHA256");
assert(!process.env.WAVEDL_BROWSER_ASSETS, "Installed acceptance forbids asset overrides");
const originalWheel = await realpath(resolve(process.argv[2]));
const directory = await realpath(resolve(process.argv[3]));
const wheelhouse = await realpath(resolve(process.argv[4]));
const expectedWheelSha256 = process.argv[5];
assert(/^[a-f0-9]{64}$/.test(expectedWheelSha256));
const info = await lstat(resolve(process.argv[3]));
assert(info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o777) === 0o700 && info.uid === process.getuid());
assert.deepEqual(await readdir(directory), []);
const originalHandle = await open(originalWheel, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
let verifiedWheelBytes;
try {
  const before = await originalHandle.stat();
  assert(before.isFile() && before.size > 0 && before.size < 16 * 1024 * 1024);
  const buffer = Buffer.alloc(16 * 1024 * 1024 + 1);
  let size = 0;
  while (size < buffer.length) {
    const result = await originalHandle.read(buffer, size, buffer.length - size, null);
    if (!result.bytesRead) break;
    size += result.bytesRead;
  }
  const after = await originalHandle.stat();
  assert(size === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs);
  verifiedWheelBytes = buffer.subarray(0, size);
  assert.equal(createHash("sha256").update(verifiedWheelBytes).digest("hex"), expectedWheelSha256);
} finally {
  await originalHandle.close();
}
const owned = join(directory, "owned");
await mkdir(owned, { mode: 0o700 });
const ownedIdentity = await lstat(owned);
const directoryIdentity = await lstat(directory);
const input = join(owned, "input");
await mkdir(input, { mode: 0o700 });
const wheel = join(input, basename(originalWheel));
await writeFile(wheel, verifiedWheelBytes, { mode: 0o400, flag: "wx" });
const inputIdentity = await lstat(wheel);
const venv = join(owned, "venv");
const root = join(owned, "runtime");
const profile = join(owned, "browser-profile");
const downloads = join(owned, "downloads");
const tokenFile = join(owned, "private-bearer");
const masterBearer = randomBytes(32).toString("base64url");
await writeFile(tokenFile, masterBearer, { mode: 0o600, flag: "wx" });
for (const path of [root, profile, downloads]) await mkdir(path, { mode: 0o700 });
const hostPython = process.env.WAVEDL_PYTHON ?? "python3.11";
const python = join(venv, "bin/python");
const executable = join(venv, "bin/wavedl-daemon");
const browser = process.env.AGENT_BROWSER_BIN ?? "agent-browser";
const session = `wave-installed-${randomUUID().slice(0, 8)}`;
const environment = { ...process.env, OMP_NUM_THREADS: "1", MKL_NUM_THREADS: "1", PYTHONNOUSERSITE: "1" };
delete environment.PYTHONPATH;
delete environment.PYTHONHOME;
delete environment.VIRTUAL_ENV;
for (const key of Object.keys(environment)) if (key.startsWith("AGENT_BROWSER_")) delete environment[key];
const record = {
  name: "installed-wheel-browser", status: "running", stage: "preflight",
  scope: "Exact wheel in a fresh isolated native CPython venv resolved only from an offline wheelhouse; real installed daemon CLI and native browser; local CPU only, not other-platform/GPU/site or overall release certification",
  wheelSha256: expectedWheelSha256, expectedWheelSha256, started: new Date().toISOString(),
  ownedWheel: { mode: inputIdentity.mode & 0o777, beforeInstallSha256: createHash("sha256").update(await readFile(wheel)).digest("hex") },
  environment: { pythonPathRemoved: true, pythonHomeRemoved: true, userSiteDisabled: true, systemSitePackages: false, offlineResolution: true },
};
let daemon;
let origin;
let opened = false;
let stdout = "";
let daemonSpawnFailed = false;
let shutdownComplete = false;
let stderrTail = "";
const delay = ms => new Promise(done => setTimeout(done, ms));
async function freeSpace() {
  const value = await statfs(directory);
  assert(value.bavail * value.bsize >= 1024 ** 3, "At least one GiB free space required");
}
const command = (program, args, timeout = 35000, input) => boundedCommand(program, args, {
  cwd: root, env: environment, timeout, input,
});
const py = (script, args = [], timeout = 35000) => command(python, ["-c", script, ...args], timeout);
async function poll(observe, accept, timeout, name) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await observe();
    if (accept(value)) return value;
    await delay(100);
  }
  throw Object.assign(new Error(), { code: "PROBE_DEADLINE", probe: name });
}
const cli = (...args) => boundedCommand(browser, ["--session", session,
  ...(args[0] === "open" ? ["--args", browserLaunchArgs] : []), ...args], {
  cwd: root, env: browserTemporaryEnvironment({ ...environment, AGENT_BROWSER_SESSION: session }), timeout: 35000,
});
const dom = async script => JSON.parse(JSON.parse(await boundedCommand(browser,
  ["--session", session, "eval", "--stdin"], { cwd: root,
    env: browserTemporaryEnvironment({ ...environment, AGENT_BROWSER_SESSION: session }), timeout: 35000, input: script })));
const actions = createBrowserActions({ cli, dom, snapshot: () => cli("snapshot", "-i") });
const button = (name, optional = false) => actions.button(name, optional);
const registryScript = `import json,sqlite3,sys
from pathlib import Path
c=sqlite3.connect((Path(sys.argv[1])/'state'/'registry.db').as_uri()+'?mode=ro',uri=True);c.row_factory=sqlite3.Row;c.execute('BEGIN')
print(json.dumps({'plans':c.execute('SELECT count(*) FROM plans').fetchone()[0],'runs':[dict(r) for r in c.execute('SELECT run_id,state FROM runs ORDER BY run_id')],'control':[dict(r) for r in c.execute('SELECT plan_id,submission_requested,cancellation_requested FROM plan_control ORDER BY plan_id')],'submissions':[dict(r) for r in c.execute("SELECT s.plan_id,s.state,p.request_id,json_extract(json_extract(p.plan_json,'$.manifest_json'),'$.run_id') AS run_id,json_extract(s.submission_handle_json,'$.pid') AS pid,json_extract(s.submission_handle_json,'$.supervisor_id') AS supervisor_id FROM submission_control s JOIN plans p ON p.plan_id=s.plan_id ORDER BY s.plan_id")],'executions':[dict(r) for r in c.execute("SELECT plan_id,json_extract(handle_json,'$.run_id') AS run_id,json_extract(handle_json,'$.request_id') AS request_id,json_extract(handle_json,'$.pid') AS pid,json_extract(handle_json,'$.supervisor_id') AS supervisor_id,cancel_delivered,coalesce(json_extract(latest_observation_json,'$.status'),json_extract(observation_json,'$.status')) AS observed_status FROM execution_control ORDER BY plan_id")]}))`;
const registry = async () => JSON.parse(await py(registryScript, [root]));
const pollRegistry = (_root, accept, name, timeout) => poll(registry, state => {
  assert(!state.runs.some(run => ["failed", "cancelled"].includes(run.state)), "Actual installed runtime failed");
  return accept(state);
}, timeout, name);
try {
  await freeSpace();
  record.stage = "isolated-venv";
  await command(hostPython, ["-m", "venv", venv], 60000);
  record.stage = "offline-wheel-install";
  record.installBudget = JSON.parse(await py(`import json,os,shutil,signal,subprocess,sys,time
minimum=shutil.disk_usage('.').free;samples=0;deadline=time.monotonic()+300
p=subprocess.Popen([sys.executable,'-m','pip','--isolated','install','--no-index','--no-cache-dir','--only-binary=:all:','--find-links',sys.argv[1],sys.argv[2]+'[daemon]'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
try:
 while p.poll() is None:
  free=shutil.disk_usage('.').free;minimum=min(minimum,free);samples+=1
  if free<1024**3 or time.monotonic()>=deadline: raise RuntimeError('Installation resource budget exceeded')
  time.sleep(0.25)
 assert p.returncode==0,'Offline installation failed'
finally:
 if p.poll() is None:
  os.killpg(p.pid,signal.SIGTERM)
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=5)
print(json.dumps({'minimumFreeBytes':minimum,'samples':samples,'offlineOnly':True,'terminalExit':p.returncode}))`, [wheelhouse, wheel], 315000));
  await freeSpace();
  await command(python, ["-m", "pip", "--isolated", "check"], 30000);
  record.stage = "installed-origins-assets";
  record.installation = JSON.parse(await py(`import email.parser,hashlib,importlib.metadata,importlib.util,json,re,sys,zipfile
from pathlib import Path
import wavedl,wavedl.core.protocol,wavedl_daemon,wavedl_daemon.cli
prefix=Path(sys.prefix).resolve();repo=Path(sys.argv[2]).resolve();wheel=Path(sys.argv[1])
assert sys.prefix!=sys.base_prefix and not sys.flags.no_site
configuration=(prefix/'pyvenv.cfg').read_text();assert 'include-system-site-packages = false' in configuration
assert all(not p or not Path(p).resolve().is_relative_to(repo) for p in sys.path)
modules={name:str(Path(sys.modules[name].__file__).resolve()) for name in ['wavedl','wavedl.core.protocol','wavedl_daemon','wavedl_daemon.cli']}
assert all(Path(p).is_relative_to(prefix) for p in modules.values())
assert Path(importlib.metadata.distribution('wavedl').locate_file('')).resolve().is_relative_to(prefix)
console=prefix/'bin'/'wavedl-daemon';assert console.read_text().splitlines()[0]=='#!'+sys.executable
assets=Path(wavedl_daemon.__file__).parent/'web_assets';files={str(p.relative_to(assets)):p.read_bytes() for p in assets.rglob('*') if p.is_file()}
with zipfile.ZipFile(wheel) as z:
 original={n.removeprefix('wavedl_daemon/web_assets/'):z.read(n) for n in z.namelist() if n.startswith('wavedl_daemon/web_assets/') and not n.endswith('/')}
 assert files==original and len(files)==33
 assert not any(n.startswith('wavedl_gui') for n in z.namelist())
 metadata=email.parser.Parser().parsestr(z.read(next(n for n in z.namelist() if n.endswith('.dist-info/METADATA'))).decode('utf-8'))
 assert 'gui' not in metadata.get_all('Provides-Extra',[])
 assert not any(re.search(r'(?:PySide[26]|PyQt[56]|qfluentwidgets)',requirement,re.I) for requirement in metadata.get_all('Requires-Dist',[]))
 assert all(importlib.util.find_spec(name) is None for name in ['wavedl_gui','PySide6','PySide2','PyQt6','PyQt5','qfluentwidgets'])
manifest=json.loads(files['.wavedl-assets.json']);assert set(files)==set(manifest)|{'.wavedl-assets.json'}
assert all(hashlib.sha256(files[name]).hexdigest()==digest for name,digest in manifest.items())
print(json.dumps({'prefix':str(prefix),'python':sys.executable,'modules':modules,'console':str(console),'noCheckoutPath':True,'observedSystemSitePackages':False,'assetCount':len(files),'assetManifestSha256':hashlib.sha256(files['.wavedl-assets.json']).hexdigest(),'assets':{n:hashlib.sha256(b).hexdigest() for n,b in files.items()},'qtAbsent':True,'cwdOutsideCheckout':not Path.cwd().resolve().is_relative_to(repo),'pipCheck':True}))`, [wheel, repo]));
  record.ownedWheel.afterOriginsSha256 = createHash("sha256").update(await readFile(wheel)).digest("hex");
  assert.equal(record.ownedWheel.afterOriginsSha256, expectedWheelSha256);
  record.pythonInterpreter = python;
  await py(`import numpy as np,sys
from pathlib import Path
rng=np.random.default_rng(42);x=rng.normal(size=(96,32)).astype(np.float32);y=x[:,:4]*0.25
np.savez(Path(sys.argv[1])/'samples.npz',X=x,y=y)`, [root]);
  record.browser = (await command(browser, ["--version"], 10000)).trim();
  record.stage = "installed-cli-start";
  daemon = spawn(executable, ["serve", "--port", "0", "--credential-file", tokenFile, "--state-root", join(root, "state"), "--run-root", join(root, "runs"), "--browse-root", `datasets=${root}`],
    { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
  daemon.on("error", () => { daemonSpawnFailed = true; });
  daemon.stdout.on("data", bytes => { stdout = (stdout + bytes).slice(-65536); });
  daemon.stderr.on("data", bytes => {
    stderrTail = (stderrTail + bytes.toString("utf8")).slice(-2048);
    if (stderrTail.includes("Application shutdown complete.")) shutdownComplete = true;
  });
  const url = await poll(async () => {
    assert(!daemonSpawnFailed && daemon.exitCode === null, "Daemon startup failed");
    return stdout.match(/WaveDL daemon: (http:\/\/[^\s]+)/)?.[1];
  }, Boolean, 60000, "installed-cli-ready");
  origin = new URL(url).origin;
  record.daemonPid = daemon.pid;
  record.stage = "native-browser-bootstrap";
  opened = true;
  await cli("open", "--headed", "false", "--engine", "chrome", "--profile", profile, "--allowed-domains", "127.0.0.1,localhost", url);
  await cli("set", "viewport", "1280", "900");
  await cli("wait", "--text", "Connected");
  record.bootstrap = await dom(`JSON.stringify({removed:!location.href.includes('bootstrap'),credentialKey:${JSON.stringify(SESSION_CREDENTIAL_KEY)},storage:(${observeCursorStorage.toString()})(localStorage,sessionStorage,document.cookie,'','',{forbiddenToken:${JSON.stringify(masterBearer)},origin:location.origin})})`);
  record.stage = "native-ui-training-authoring";
  await actions.button("New training run", false, { locator: '[data-testid="nav-project"]' });
  const rootControl = await actions.readyControl("field", "Search roots and paths", false, { locator: 'xpath=//*[@role="combobox" and @aria-label="Search roots and paths"]' });
  await cli("click", rootControl);
  await actions.option("datasets");
  await button("Select file samples.npz");
  await button("Next step");
  await button("Choose CNN");
  const editor = await openTrainingEditor({ button, cli, dom });
  await actions.fill("Python interpreter", python, { locator: `#${editor.id}` });
  await actions.fill("epochs", "3");
  await actions.fill("patience", "3");
  await actions.expandSummary("Data, checkpoints and cross-validation");
  await actions.fill("workers", "0");
  await actions.fill("batch size", "16");
  await actions.select("precision", "no");
  await actions.select("Device", "cpu");
  await button("Preview persisted plan");
  await cli("wait", "--text", "Persisted plan for approval");
  await openPlanDisclosure({ cli, dom });
  record.trainingManifest = JSON.parse(await dom(`JSON.stringify(document.querySelector('[aria-label="Approved normalized manifest"]').textContent)`));
  record.previewRegistry = await registry();
  await button("Approve and start this plan");
  record.stage = "actual-training-and-autoplot";
  record.trainingSettled = await pollRegistry(root, state => state.plans === 2 && state.runs.length === 2 && state.runs.every(run => run.state === "completed"), "CPU training and automatic plots", 120000);
  record.stage = "native-ui-checkpoint-evaluation";
  await resultOperations({ cli, dom, button, actions, registry, pollRegistry, root, record, python,
    command: (program, args) => command(program, args), approvedManifest: record.trainingManifest,
    check: (condition, message) => assert(condition, message) });
  record.stage = "verified-native-predictions-download";
  const evaluationId = record.resultOperations.approved.run_id;
  const published = record.resultOperations.durable.runs.find(run => run.runId === evaluationId).publications;
  const publication = published.find(item => Object.hasOwn(item.complete.files, "predictions.csv"));
  assert(publication, "Actual evaluation must publish predictions.csv");
  const generation = publication.generation;
  const scope = `//section[@aria-labelledby="results-title"]//*[@data-artifact-generation=${xpathLiteral(generation)} and @data-artifact-path='predictions.csv']`;
  const download = await actions.readyControl("button", "Download", false, { scope });
  const destination = join(downloads, "verified-predictions.csv");
  await cli("download", download, destination);
  const bytes = await readFile(destination);
  record.predictions = { generation, runId: evaluationId, expected: publication.complete.files["predictions.csv"],
    actual: { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } };
  assert.deepEqual(record.predictions.actual, record.predictions.expected);
  record.stage = "installed-static-deep-link-api-separation";
  await cli("open", `${origin}/settings/storage`);
  record.staticClient = await dom(`(async()=>{const response=await fetch('/api/unknown',{cache:'no-store',headers:{accept:'text/html'}});return JSON.stringify({path:location.pathname,shell:document.title.includes('WaveDL')&&!!document.querySelector('[data-testid="workstation-nav"]'),apiStatus:response.status,apiType:response.headers.get('content-type')})})()`);
  record.finalRegistry = await registry();
  record.runtimePids = JSON.parse(await py(`import json,sqlite3,sys
from pathlib import Path
c=sqlite3.connect((Path(sys.argv[1])/'state'/'registry.db').as_uri()+'?mode=ro',uri=True)
print(json.dumps([r[0] for r in c.execute("SELECT json_extract(submission_handle_json,'$.pid') FROM submission_control") if r[0] is not None]))`, [root]));
  record.status = "passed";
} catch (error) {
  record.status = "failed";
  record.failureCategory = error?.code === "ERR_ASSERTION" ? "assertion" : error?.code === "PROBE_DEADLINE" ? "deadline" : "operation-failed";
  record.failureStage = record.stage;
} finally {
  const errors = [];
  record.cleanup = { errors };
  try {
    if (opened) await cli("close");
    await poll(async () => command(browser, ["session", "list"], 10000), text => !text.includes(session), 15000, "browser-absence");
    record.cleanup.browserAbsent = true;
  } catch { errors.push("browser-cleanup"); }
  try {
    if (daemon && daemon.exitCode === null && daemon.signalCode === null) daemon.kill("SIGINT");
    if (daemon) await poll(async () => daemon.exitCode !== null || daemon.signalCode !== null, Boolean, 30000, "daemon-exit");
    record.daemonExit = daemon ? { code: daemon.exitCode, signal: daemon.signalCode } : null;
    assert(!daemon || shutdownComplete);
    assert(!daemon || [0, 130].includes(daemon.exitCode) || daemon.signalCode === "SIGINT");
    record.cleanup.daemonReaped = true;
    record.cleanup.applicationShutdownComplete = shutdownComplete;
    if (origin) await new Promise((done, fail) => {
      const address = new URL(origin);
      const socket = createConnection({ host: address.hostname, port: Number(address.port) });
      socket.setTimeout(1500);
      socket.once("connect", () => { socket.destroy(); fail(Error()); });
      socket.once("timeout", () => { socket.destroy(); fail(Error()); });
      socket.once("error", error => { socket.destroy(); error.code === "ECONNREFUSED" ? done() : fail(Error()); });
    });
    record.cleanup.listenerAbsent = true;
    if (daemon) assert.throws(() => process.kill(daemon.pid, 0), { code: "ESRCH" });
    record.cleanup.daemonPidAbsent = true;
    if (daemon) {
      record.cleanupRegistry = await registry();
      assert(record.cleanupRegistry.submissions.every(row => Number.isSafeInteger(row.pid) && row.pid > 0 && typeof row.supervisor_id === "string" && row.supervisor_id.length > 0), "Unresolved native ownership requires retained roots");
      const pids = record.cleanupRegistry.submissions.map(row => row.pid);
      if (record.runtimePids) assert.deepEqual(pids.slice().sort(), record.runtimePids.slice().sort());
      record.runtimePids = pids;
      for (const pid of pids) {
        assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
        assert.throws(() => process.kill(-pid, 0), { code: "ESRCH" });
      }
      record.cleanup.runtimePidsAndGroupsAbsent = true;
      const storage = JSON.parse(await py(`import json,sqlite3,sys
from pathlib import Path
from wavedl_daemon.storage.ownership import acquire_dispatch_lock
root=Path(sys.argv[1])/'state'
with acquire_dispatch_lock(root/'dispatch.lock'):
 c=sqlite3.connect(root/'registry.db');assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok';c.execute('BEGIN IMMEDIATE');c.rollback();c.close()
print(json.dumps({'released':True}))`, [root]));
      assert.equal(storage.released, true);
      record.cleanup.storageClosed = true;
    }
  } catch { errors.push("daemon-cleanup"); }
  if (!errors.length) {
    try {
      const currentInput = await lstat(wheel);
      assert(!currentInput.isSymbolicLink() && currentInput.dev === inputIdentity.dev && currentInput.ino === inputIdentity.ino && (currentInput.mode & 0o777) === 0o400);
      record.ownedWheel.finalSha256 = createHash("sha256").update(await readFile(wheel)).digest("hex");
      assert.equal(record.ownedWheel.finalSha256, expectedWheelSha256);
      const now = await lstat(owned);
      const parent = await lstat(directory);
      assert(!now.isSymbolicLink() && now.ino === ownedIdentity.ino && now.dev === ownedIdentity.dev && !parent.isSymbolicLink() && parent.ino === directoryIdentity.ino && parent.dev === directoryIdentity.dev);
      assert.equal(await realpath(owned), owned);
      await rm(owned, { recursive: true, force: false });
      await assert.rejects(access(owned), { code: "ENOENT" });
      record.cleanup.ownedRootsRemoved = true;
      await assert.rejects(access(tokenFile), { code: "ENOENT" });
      record.cleanup.credentialFileRemoved = true;
    } catch { errors.push("owned-root-cleanup"); }
  }
  if (errors.length) record.status = "failed";
  record.finished = new Date().toISOString();
  if (record.status === "passed") {
    try { verifyInstalledBrowserRecord(record, expectedWheelSha256); }
    catch { record.status = "failed"; record.failureCategory = "verification"; }
  }
  await writeFile(join(directory, "installed-browser.json"), JSON.stringify(record, null, 2), { mode: 0o600, flag: "wx" });
}
console.log(`Installed browser report: ${join(directory, "installed-browser.json")} (${record.status})`);
if (record.status !== "passed") process.exitCode = 1;
