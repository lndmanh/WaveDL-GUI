#!/usr/bin/env node
// Explicit QA storage corruption in an empty, owned Chromium profile only.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, access, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { createConnection } from "node:net";
import { boundedCommand } from "./run_retained_browser_acceptance.mjs";
import { browserLaunchArgs } from "./browser_launch_policy.mjs";
import { createBrowserActions, DRIVER_READINESS_MODE } from "./browser_actions.mjs";
import { verifyPreferencesReport } from "./verify_preferences_browser_report.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const python = process.env.WAVEDL_PYTHON ?? "python";
const browser = process.env.AGENT_BROWSER_BIN ?? "agent-browser";
const assets = join(repo, "src/wavedl_daemon/web_assets");
const reportRoot = resolve(
  process.argv[2] ?? (await mkdtemp(join(tmpdir(), "wavedl-preferences-browser-"))),
);
await mkdir(reportRoot, { recursive: true, mode: 0o700 });
assert.deepEqual(await readdir(reportRoot), [], "Report directory must be empty");
const root = join(reportRoot, "fixture"),
  profile = join(reportRoot, "browser-profile"),
  tokenFile = join(reportRoot, ".fixture-token");
await mkdir(root, { mode: 0o700 });
await mkdir(profile, { mode: 0o700 });
const token = randomBytes(32).toString("base64url");
await writeFile(tokenFile, token, { mode: 0o600 });
const session = `wave-prefs-${randomUUID().slice(0, 12)}`;
const record = {
  name: "preferences-browser-corruption",
  status: "running",
  stage: "startup",
  browser: execFileSync(browser, ["--version"], { encoding: "utf8" }).trim(),
  driverReadinessMode: DRIVER_READINESS_MODE,
  cases: [],
};
const optionsBytes = await readFile(join(repo, "web/shared/training-options.json"));
const defaults = Object.fromEntries(JSON.parse(optionsBytes).map((o) => [o.name, o.default]));
record.defaults = {
  epochs: String(defaults.epochs),
  batch_size: String(defaults.batch_size),
  workers: String(defaults.workers),
  precision: String(defaults.precision),
};
record.trainingOptionsSha256 = createHash("sha256").update(optionsBytes).digest("hex");
record.assetManifestSha256 = createHash("sha256")
  .update(await readFile(join(assets, ".wavedl-assets.json")))
  .digest("hex");
const child = spawn(
  python,
  [
    "tools/browser_daemon_fixture.py",
    "--root",
    root,
    "--epochs",
    "1",
    "--unseeded",
    "--web-assets",
    assets,
    "--token-file",
    tokenFile,
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
  spawnError = false,
  opened = false,
  origin;
child.on("error", () => {
  spawnError = true;
});
child.stdout.on("data", (chunk) => {
  stdout = (stdout + chunk).slice(-1024 * 1024);
});
child.stderr.on("data", () => undefined);
const pause = () => new Promise((r) => setTimeout(r, 100));
async function until(predicate, ms, message) {
  const end = Date.now() + ms;
  while (!(await predicate())) {
    assert(Date.now() < end, message);
    await pause();
  }
}
const command = (args, timeout = 35000) => {
  record.stage = `browser:${args[0]}${args[0] === "wait" && args[1] === "--text" ? ":" + args[2] : ""}`;
  const env = { ...process.env, AGENT_BROWSER_SESSION: session };
  for (const key of Object.keys(env))
    if (key.startsWith("AGENT_BROWSER_") && key !== "AGENT_BROWSER_SESSION") delete env[key];
  return boundedCommand(
    browser,
    ["--session", session, ...(args[0] === "open" ? ["--args", browserLaunchArgs] : []), ...args],
    { cwd: repo, timeout, env },
  );
};
const dom = async (script) =>
  JSON.parse(JSON.parse(await command(["eval", "-b", Buffer.from(script).toString("base64")])));
const actions = createBrowserActions({
  cli: (...args) => command(args),
  dom,
  snapshot: () => command(["snapshot", "-i"]),
});
async function storage() {
  return dom(
    "JSON.stringify({keys:Object.keys(localStorage).sort(),unrelated:localStorage.getItem('qa-unrelated'),session:sessionStorage.length,cookies:document.cookie})",
  );
}
async function retainedFiles() {
  return JSON.parse(
    await boundedCommand(
      python,
      [
        "-c",
        `import json,hashlib,sys
from pathlib import Path
p=Path(sys.argv[1]); print(json.dumps({str(f.relative_to(p)):{'size':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in p.rglob('*') if f.is_file() and 'state' not in f.relative_to(p).parts}))`,
        root,
      ],
      { cwd: repo, timeout: 10000 },
    ),
  );
}
try {
  await until(
    () => {
      assert(!spawnError, "Fixture spawn failed");
      assert(child.exitCode === null, "Fixture exited before ready");
      return stdout.includes("Browser: ");
    },
    180000,
    "Fixture readiness timeout",
  );
  const url = stdout.match(/Browser: (http:\/\/[^\s]+)/)[1];
  origin = new URL(url).origin;
  opened = true;
  await command([
    "open",
    "--headed",
    "false",
    "--engine",
    "chrome",
    "--profile",
    profile,
    "--allowed-domains",
    "127.0.0.1,localhost",
    url,
  ]);
  await command(["wait", "--text", "Connected"]);
  const healthResponse = await fetch(`${origin}/api/health`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert(typeof health.daemon_id === "string");
  record.daemonId = health.daemon_id;
  record.freshStorage = await storage();
  assert.deepEqual(record.freshStorage, { keys: [], unrelated: null, session: 0, cookies: "" });
  await mkdir(join(root, "retained-run-cache"), { mode: 0o700 });
  await writeFile(join(root, "retained-run-cache", "previous-run.cache"), "owned prior-run cache sentinel\n", { mode: 0o600 });
  record.sourceBefore = await retainedFiles();
  const trainingKey = "wavedl.training-defaults.v1." + encodeURIComponent(health.daemon_id);
  for (const mode of ["malformed", "oversized"]) {
    record.stage = `seed:${mode}`;
    const raw = mode === "malformed" ? "{" : " ".repeat(65537);
    await dom(
      `localStorage.setItem('wavedl.appearance.v1',${JSON.stringify(raw)});localStorage.setItem(${JSON.stringify(trainingKey)},${JSON.stringify(raw)});localStorage.setItem('qa-unrelated','preserve-me');JSON.stringify(true)`,
    );
    await command([
      "open",
      "--headed",
      "false",
      "--engine",
      "chrome",
      "--profile",
      profile,
      "--allowed-domains",
      "127.0.0.1,localhost",
      origin,
    ]);
    await command(["wait", "--text", "Connect securely"]);
    await command(["snapshot", "-i"]);
    await command(["fill", "#daemon-bearer", token]);
    await actions.button("Connect securely");
    await command(["wait", "--text", "Connected"]);
    await actions.button("Settings");
    await command(["wait", "--text", "Browser preferences, not daemon administration."]);
    const appearance = await dom(
      "JSON.stringify({theme:document.querySelector('#preference-theme')?.value,language:document.querySelector('#preference-language')?.value,guide:document.querySelector('#preference-guide')?.getAttribute('aria-checked'),rootLanguage:document.documentElement.lang})",
    );
    assert.deepEqual(appearance, {
      theme: "system",
      language: "en",
      guide: "true",
      rootLanguage: "en",
    });
    await actions.expandSummary("Training and optional W&B defaults");
    const fields = await dom(
      `JSON.stringify(Object.fromEntries(${JSON.stringify(Object.keys(record.defaults))}.map(name=>[name,Array.from(document.querySelectorAll('[id$="-training-'+name+'"]')).find(e=>e.getClientRects().length)?.value])))`,
    );
    assert.deepEqual(fields, record.defaults);
    await actions.button("New training run");
    await actions.button("Show full editor");
    const draft = await dom(
      "JSON.stringify({epochs:Array.from(document.querySelectorAll('[id$=\"-training-epochs\"]')).find(e=>e.getClientRects().length)?.value,device:Array.from(document.querySelectorAll('select')).find(e=>Array.from(e.options).some(o=>o.value==='cpu'))?.value})",
    );
    assert.equal(draft.epochs, record.defaults.epochs);
    assert.equal(draft.device, "cpu");
    const stored = await storage();
    assert.equal(stored.unrelated, "preserve-me");
    assert.equal(stored.session, 0);
    assert.equal(stored.cookies, "");
    assert.deepEqual(stored.keys, ["qa-unrelated", "wavedl.appearance.v1", trainingKey].sort());
    record.cases.push({
      mode,
      seedBytes: Buffer.byteLength(raw),
      appearance,
      trainingDefaults: fields,
      draft,
      storage: stored,
    });
  }
  // Ordinary settings actions must not migrate/delete a stale preference or
  // an existing cache. Only the explicitly corrupted current keys above are QA writes.
  const staleKey = "wavedl.legacy.cache-directory";
  const staleValue = "unavailable-old-cache-location";
  await dom(`localStorage.setItem(${JSON.stringify(staleKey)},${JSON.stringify(staleValue)});JSON.stringify(true)`);
  await actions.button("Settings");
  record.settingsControls = await dom("JSON.stringify(Array.from(document.querySelectorAll('button')).filter(e=>e.getClientRects().length).map(e=>e.getAttribute('aria-label')||e.textContent.trim()))");
  assert(!record.settingsControls.some(name => /(?:delete|clear|remove).{0,24}cache/i.test(name)));
  for (const [id, value] of [["theme", "dark"], ["accent", "violet"], ["zoom", "125"], ["language", "vi"]]) {
    await command(["snapshot", "-i"]);
    await command(["select", `#preference-${id}`, value]);
  }
  await command(["snapshot", "-i"]);
  await command(["click", "#preference-guide"]);
  await actions.button("Save appearance");
  const appliedAppearance = async () => dom("JSON.stringify({language:document.documentElement.lang,dark:document.documentElement.classList.contains('dark'),fontSize:document.documentElement.style.fontSize,primary:document.documentElement.style.getPropertyValue('--primary'),preferences:JSON.parse(localStorage.getItem('wavedl.appearance.v1')).preferences})");
  const expectedAppearance = { language: "vi", dark: true, fontSize: "20px", primary: "oklch(0.55 0.18 300)", preferences: { theme: "dark", accent: "violet", zoom: 125, language: "vi", showProjectGuide: false } };
  record.appearanceSaved = await appliedAppearance();
  assert.deepEqual(record.appearanceSaved, expectedAppearance);
  await command(["close"]);
  await command(["open", "--headed", "false", "--engine", "chrome", "--profile", profile, "--allowed-domains", "127.0.0.1,localhost", url]);
  await command(["wait", "--text", "Cài đặt"]);
  record.appearanceAfterRestart = await appliedAppearance();
  assert.deepEqual(record.appearanceAfterRestart, expectedAppearance);
  await command(["snapshot", "-i"]);
  await command(["fill", "#daemon-bearer", token]);
  await actions.button("Kết nối an toàn");
  await command(["wait", "--text", "Đã kết nối"]);
  // Return to English using exposed controls; the saved Vietnamese state above
  // is checked before this independent change.
  await actions.button("Cài đặt");
  await command(["snapshot", "-i"]);
  await command(["select", "#preference-language", "en"]);
  await actions.button("", false, { locator: "form:has(#preference-language) button[type=submit]" });
  await actions.expandSummary("Training and optional W&B defaults");
  const visibleTraining = async (name) => dom(`JSON.stringify(Array.from(document.querySelectorAll('[id$="-training-${name}"]')).find(e=>e.getClientRects().length)?.id)`);
  const epochsId = await visibleTraining("epochs");
  const wandbId = await visibleTraining("wandb");
  const watchId = await visibleTraining("wandb_watch");
  await command(["snapshot", "-i"]);
  await command(["scrollintoview", `[id=${JSON.stringify(epochsId)}]`]);
  await command(["fill", `[id=${JSON.stringify(epochsId)}]`, "17"]);
  for (const id of [wandbId, watchId]) {
    assert.equal(await dom(`JSON.stringify(document.getElementById(${JSON.stringify(id)}).getAttribute('aria-checked'))`), "false");
    await actions.readyControl("button", id, false, { locator: `[id=${JSON.stringify(id)}]` });
    await command(["click", `[id=${JSON.stringify(id)}]`]);
  }
  await actions.button("Save training defaults");
  await command(["wait", "--text", "Defaults saved for new drafts on this daemon."]);
  const readTraining = async () => dom(`JSON.stringify(JSON.parse(localStorage.getItem(${JSON.stringify(trainingKey)})).preferences)`);
  record.trainingSaved = await readTraining();
  assert.equal(record.trainingSaved.epochs, 17);
  assert.equal(record.trainingSaved.wandb, true);
  assert.equal(record.trainingSaved.wandb_watch, true);
  await command(["close"]);
  await command(["open", "--headed", "false", "--engine", "chrome", "--profile", profile, "--allowed-domains", "127.0.0.1,localhost", url]);
  await command(["wait", "--text", "Connect securely"]);
  await command(["snapshot", "-i"]);
  await command(["fill", "#daemon-bearer", token]);
  await actions.button("Connect securely");
  await command(["wait", "--text", "Connected"]);
  record.trainingAfterRestart = await readTraining();
  assert.deepEqual(record.trainingAfterRestart, record.trainingSaved);
  await actions.button("New training run");
  await command(["wait", "--text", "Use guided steps"]);
  record.savedGuideDefaultApplied = true;
  record.savedDefaultDraft = await dom("JSON.stringify(Object.fromEntries(['epochs','wandb','wandb_watch'].map(name=>{const e=Array.from(document.querySelectorAll('[id$=\"-training-'+name+'\"]')).find(e=>e.getClientRects().length);return [name,name==='epochs'?e?.value:e?.getAttribute('aria-checked')]})))");
  assert.deepEqual(record.savedDefaultDraft, { epochs: "17", wandb: "true", wandb_watch: "true" });
  await actions.button("Settings");
  await actions.button("Reset training defaults", false, { scope: "//section[@aria-labelledby='defaults-heading']" });
  await command(["wait", "--text", "Training defaults reset. Existing drafts and runs are unchanged."]);
  record.afterReset = await dom(`JSON.stringify({trainingRemoved:localStorage.getItem(${JSON.stringify(trainingKey)})===null,stalePreference:localStorage.getItem(${JSON.stringify(staleKey)}),unrelated:localStorage.getItem('qa-unrelated')})`);
  assert.deepEqual(record.afterReset, { trainingRemoved: true, stalePreference: staleValue, unrelated: "preserve-me" });
  record.finalStorage = await storage();
  assert.deepEqual(record.finalStorage, { keys: ["qa-unrelated", "wavedl.appearance.v1", staleKey].sort(), unrelated: "preserve-me", session: 0, cookies: "" });
  record.sourceAfter = await retainedFiles();
  assert.deepEqual(record.sourceAfter, record.sourceBefore);
  record.limitation =
    "Local CPU fresh-draft preference recovery and browser-restart persistence only. Guide preference is persisted; guide navigation is not exercised. W&B defaults are checked without external W&B service access. No exported YAML or cache-deletion operation is exercised; retained fixture file and owned prior-run cache sentinel hashes are unchanged.";
  record.status = "passed";
} catch (error) {
  record.status = "failed";
  record.failureStage = record.stage;
  record.error = String(error.message ?? error)
    .replaceAll(token, "[REDACTED]")
    .slice(0, 2048);
} finally {
  const errors = [];
  record.cleanup = { errors };
  try {
    if (opened) await command(["close"], 10000);
    await until(
      async () =>
        !(await boundedCommand(browser, ["session", "list"], { cwd: repo, timeout: 10000 }))
          .split("\n")
          .some((line) => line.includes(session)),
      30000,
      "Owned browser session remains",
    );
    record.cleanup.browserSessionAbsent = true;
  } catch {
    errors.push("Owned browser shutdown unconfirmed");
  }
  try {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGINT");
    await until(
      () => child.exitCode !== null || child.signalCode !== null,
      30000,
      "Fixture exit timeout",
    );
    assert(stdout.includes("Fixture: services-closed"));
    record.cleanup.fixtureReaped = true;
    record.cleanup.servicesClosed = true;
  } catch {
    errors.push("Fixture shutdown unconfirmed");
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  try {
    assert(origin);
    const address = new URL(origin);
    await new Promise((done, fail) => {
      const socket = createConnection({ host: address.hostname, port: Number(address.port) });
      socket.setTimeout(1500);
      socket.once("connect", () => {
        socket.destroy();
        fail(new Error("Listener still accepting"));
      });
      socket.once("timeout", () => {
        socket.destroy();
        fail(new Error("Listener refusal unconfirmed"));
      });
      socket.once("error", (error) => {
        socket.destroy();
        if (error.code === "ECONNREFUSED") done();
        else fail(new Error("Listener refusal unconfirmed"));
      });
    });
    record.cleanup.listenerClosed = true;
  } catch {
    errors.push("Fixture listener shutdown unconfirmed");
  }
  if (!errors.length) {
    try {
      for (const path of [root, profile, tokenFile]) {
        await rm(path, { recursive: path !== tokenFile, force: true });
        await assert.rejects(access(path), { code: "ENOENT" });
      }
      record.cleanup.ownedRootsRemoved = true;
    } catch {
      errors.push("Owned roots removal unconfirmed");
    }
  }
  if (errors.length) record.status = "failed";
  await writeFile(join(reportRoot, "preferences-browser.json"), JSON.stringify(record, null, 2), {
    mode: 0o600,
  });
}
if (record.status === "passed") await verifyPreferencesReport(reportRoot);
console.log(
  `Preferences browser report: ${join(reportRoot, "preferences-browser.json")} (${record.status})`,
);
if (record.status !== "passed") process.exitCode = 1;
