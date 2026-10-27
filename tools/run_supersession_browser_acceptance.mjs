#!/usr/bin/env node
// Real CPU launcher/resume -> public adoption -> journal/SQLite/SSE -> frozen UI.
// Browser programs below observe public DOM/canvas only; no application injection.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm, access, lstat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { TextDecoder } from "node:util";
import { StringDecoder } from "node:string_decoder";
import { boundedCommand } from "./browser_process.mjs";
import { currentAssetDigest } from "./verify_adoption_negative_browser_report.mjs";
import { verifySupersessionReport } from "./verify_supersession_browser_report.mjs";
import { createBrowserActions, DRIVER_READINESS_MODE } from "./browser_actions.mjs";
import { browserLaunchArgs } from "./browser_launch_policy.mjs";

const repo = resolve(new URL("..", import.meta.url).pathname);
const python = process.env.WAVEDL_PYTHON ?? "python";
const browser = process.env.AGENT_BROWSER_BIN ?? "agent-browser";
const reportArg = process.argv.find((a) => a.startsWith("--report="))?.slice(9);
assert(reportArg?.startsWith("/"), "Provide --report=/absolute/new.json");
const report = resolve(reportArg);
await access(report)
  .then(() => {
    throw Error("Report already exists");
  })
  .catch((e) => {
    if (e.code !== "ENOENT") throw e;
  });
// Validate frozen assets before allocating any private fixture material.
const assetManifestSha256 = await currentAssetDigest();
const work = await mkdtemp(join(tmpdir(), "wavedl-supersession-browser-"));
assert(!report.startsWith(work + "/"), "Report cannot be inside disposable workspace");
const root = join(work, "root"),
  profile = join(work, "profile"),
  tokenFile = join(work, "token");
await mkdir(root, { mode: 0o700 });
await mkdir(profile, { mode: 0o700 });
await writeFile(tokenFile, randomBytes(32).toString("base64url"), { mode: 0o600, flag: "wx" });
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) =>
      !k.startsWith("AGENT_BROWSER_") &&
      !k.startsWith("WAVEDL_") &&
      !["PYTHONPATH", "PYTHONHOME"].includes(k),
  ),
);
const pythonEnv = {
  ...cleanEnv,
  PYTHONPATH: `${repo}:${join(repo, "src")}`,
  OMP_NUM_THREADS: "1",
  MKL_NUM_THREADS: "1",
  PYTHONUNBUFFERED: "1",
};
const session = `wave-sup-${randomUUID().slice(0, 12)}`;
const env = { ...cleanEnv, AGENT_BROWSER_SESSION: session };
const record = {
  name: "supersession-browser",
  status: "failed",
  observations: {},
  cleanup: {},
  scope: "genuine-cpu-staged-public-supersession",
  limitation:
    "Genuine CPU checkpoint-resume journals staged through public adoption and pass-through daemon SSE into Chrome DOM/canvas only; not live Slurm requeue, native process restart, or full T35 certification.",
  initialProfileEmpty: (await readdir(profile)).length === 0,
  driverReadinessMode: DRIVER_READINESS_MODE,
  assetManifestSha256,
};
const deadline = Date.now() + 420000;
const remaining = () => {
  const ms = deadline - Date.now();
  assert(ms > 0, "Case budget exhausted");
  return ms;
};
const cli = (...args) => {
  record.lastBrowserCommand = args[0] === "wait" ? `wait:${args[1]}` : args[0];
  return boundedCommand(browser, ["--session", session, ...args], {
    cwd: repo,
    env,
    timeout: Math.min(45000, remaining()),
    stdoutLimit: 4 * 1024 * 1024,
  });
};
const dom = async (script) =>
  JSON.parse(JSON.parse(await cli("eval", "-b", Buffer.from(script).toString("base64"))));
const observe = (script) => dom(`JSON.stringify(${script})`);
const actions = createBrowserActions({ cli, dom, snapshot: () => cli("snapshot", "-i") });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(get, accepts, label, ms = 60000) {
  const end = Date.now() + Math.min(ms, remaining());
  while (Date.now() < end) {
    const value = await get();
    if (accepts(value)) return value;
    await delay(100);
  }
  throw Error(`${label} timeout`);
}
async function boundedJson(path, limit = 8 * 1024 * 1024) {
  const parent = await lstat(resolve(path, ".."));
  assert(
    parent.isDirectory() && !parent.isSymbolicLink(),
    "Evidence parent must be an ordinary directory",
  );
  const stat = await lstat(path);
  assert(
    stat.isFile() && !stat.isSymbolicLink() && stat.size <= limit,
    "Evidence must be a bounded ordinary file",
  );
  const bytes = await readFile(path);
  assert(bytes.length <= limit, "Evidence exceeded read bound");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
const capture = async () =>
  (await boundedJson(join(root, ".adoption-response.json"), 262144))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((v) => JSON.parse(v));
const inspect = async () =>
  JSON.parse(
    await boundedCommand(
      python,
      ["tools/supersession_browser_fixture.py", "--root", root, "--inspect"],
      {
        cwd: repo,
        env: pythonEnv,
        timeout: Math.min(15000, remaining()),
        stdoutLimit: 8 * 1024 * 1024,
      },
    ),
  );
const metricsDOM = `(() => {
  const h=document.querySelector('[aria-label="Runtime metric history"]');
  const s=document.querySelector('[aria-label="Current runtime metrics"]');
  const c=h?.querySelector('canvas'); let paintedPixels=0,paintHash=2166136261;
  if(c?.width&&c?.height){const p=c.getContext('2d')?.getImageData(0,0,c.width,c.height).data;
    if(p)for(let i=0;i<p.length;i+=4){if(p[i+3]>0)paintedPixels++;for(let j=0;j<4;j++)paintHash=Math.imul(paintHash^p[i+j],16777619)>>>0;}}
  return {lineage:{attempt:Number(h?.innerText.match(/Attempt ([0-9]+)/i)?.[1]??document.querySelector('[aria-label="Selected run"]')?.innerText.match(/Attempt ([0-9]+)/i)?.[1]??0),steps:Number(h?.innerText.match(/lineage · ([0-9]+) steps/)?.[1]??0)},
    canvas:!!c,canvasWidth:c?.width??0,canvasHeight:c?.height??0,paintedPixels,paintHash,
    legend:h?.querySelector('.u-legend')?.innerText??'',summary:s?.innerText??'',
    values:Object.fromEntries(Array.from(s?.querySelectorAll('dl.metric-grid > div,[aria-label="Per-parameter MAE"] dl > div')??[]).map(e=>[e.querySelector('dt')?.textContent,e.querySelector('dd')?.textContent])),
    progress:s?.querySelector('progress')?.value??null,text:document.body.innerText,
    selected:document.querySelector('[aria-label="Selected run"] .identity')?.textContent.trim()??null}; })()`;
let stdout = "",
  stdoutBytes = 0,
  stderrBytes = 0,
  fixtureError = null,
  opened = false,
  origin = null;
const stdoutDecoder = new StringDecoder("utf8");
const grouped = process.platform !== "win32";
const fixture = spawn(
  python,
  ["tools/supersession_browser_fixture.py", "--root", root, "--token-file", tokenFile],
  { cwd: repo, env: pythonEnv, detached: grouped, stdio: ["ignore", "pipe", "pipe"] },
);
const closed = new Promise((resolve) => fixture.once("close", resolve));
fixture.on("error", () => {
  fixtureError = "Fixture spawn failed (private output suppressed)";
});
fixture.stdout.on("data", (b) => {
  stdoutBytes += b.length;
  if (stdoutBytes > 1048576) fixtureError = "Fixture stdout budget exceeded";
  else stdout += stdoutDecoder.write(b);
});
fixture.stderr.on("data", (b) => {
  stderrBytes += b.length;
  if (stderrBytes > 1048576) fixtureError = "Fixture stderr budget exceeded";
});
const signal = (kind) => {
  try {
    if (grouped && fixture.pid) process.kill(-fixture.pid, kind);
    else fixture.kill(kind);
  } catch (e) {
    if (e.code !== "ESRCH") fixtureError ??= "Fixture process-group signal failed";
  }
};
let failure = null;
try {
  record.assetInventory = JSON.parse(
    await boundedJson(join(repo, "src/wavedl_daemon/web_assets/.wavedl-assets.json"), 1048576),
  );
  record.stage = "fixture-readiness";
  const target = await poll(
    () => stdout,
    (v) => {
      if (fixtureError || fixture.exitCode !== null)
        throw Error(fixtureError ?? "Fixture exited before readiness");
      return /Browser: http:\/\/[^\s]+/.test(v);
    },
    "Fixture readiness",
    180000,
  );
  const url = target.match(/Browser: (http:\/\/[^\s]+)/)[1];
  origin = new URL(url).origin;
  record.urlOrigin = origin;
  record.sourceBefore = JSON.parse(
    await boundedJson(join(root, ".adoption-source-before.json")),
  ).source;
  record.runId = record.sourceBefore.runId;
  record.stage = "public-adoption";
  opened = true;
  await cli(
    "open",
    url,
    "--profile",
    profile,
    "--engine",
    "chrome",
    "--headed",
    String(process.env.WAVEDL_BROWSER_HEADED === "true"),
    ...(process.env.WAVEDL_BROWSER_EXECUTABLE
      ? ["--executable-path", process.env.WAVEDL_BROWSER_EXECUTABLE]
      : []),
    "--allowed-domains",
    "127.0.0.1,localhost",
    "--args",
    browserLaunchArgs,
  );
  const tabs = JSON.parse(await cli("--json", "tab", "list"));
  const tab = tabs.data?.tabs?.find(
    (t) => t.active && typeof t.url === "string" && new URL(t.url).origin === origin,
  );
  assert(tabs.success && /^t[1-9][0-9]*$/.test(tab?.tabId), "Owned fixture tab unavailable");
  await cli("tab", tab.tabId);
  await cli("set", "viewport", "1280", "900");
  await cli("wait", "--text", "Connected");
  record.browserRuntime = await observe(
    "({userAgent:navigator.userAgent,width:innerWidth,height:innerHeight,cookies:document.cookie,localStorageKeys:Object.keys(localStorage),sessionStorageKeys:Object.keys(sessionStorage)})",
  );
  await actions.button("Adopt standalone run");
  await cli("wait", "--text", "Adopt a standalone run");
  await cli(
    "click",
    await actions.readyControl("field", "Configured root", false, {
      locator: 'xpath=//*[@role="combobox" and @aria-label="Configured root"]',
    }),
  );
  await actions.option("datasets");
  await cli("wait", "--text", "standalone");
  await actions.button("Select directory standalone");
  await cli("wait", "--text", "Selected directory:");
  await actions.fill("Runtime attempt", "2");
  await actions.button("Confirm adoption");
  await cli("wait", "--text", "Retained request:");
  await actions.button("Retry retained adoption");
  record.actualResponses = await poll(
    capture,
    (v) => v.length === 2,
    "Retained adoption acknowledgement",
  );
  assert.equal(record.actualResponses.length, 2);
  assert.equal(record.actualResponses[0].deliveredStatus, 503);
  assert.equal(record.actualResponses[1].response.status, 200);
  assert.deepEqual(record.actualResponses[0].request, record.actualResponses[1].request);
  record.adoption = record.actualResponses[1].response.json;
  assert.equal(record.adoption.run_id, record.runId);
  // Public adoption itself selects the adopted run through the controller emit.
  // Selecting it a second time would unnecessarily replace the staged stream.
  record.stage = "adopted-run-selection";
  await poll(
    () =>
      observe(
        `document.querySelector('[aria-label="Selected run"] .identity')?.textContent.trim()??null`,
      ),
    (v) => v === record.runId,
    "Public adopted run selection",
  );
  const stage = async () =>
    JSON.parse(
      await boundedJson(join(root, ".supersession-stage.json"), 262144).catch((e) => {
        if (e.code === "ENOENT") return "{}";
        throw e;
      }),
    );
  const captureStage = async (name, steps, streamStage = name) => {
    record.stage = name;
    await poll(stage, (v) => v.stage === streamStage, `${name} SSE pause`);
    await poll(
      () => observe(metricsDOM),
      (v) => v.lineage.steps === steps && v.canvas && v.paintedPixels > 0,
      `${name} painted chart`,
    );
    await dom(
      "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(JSON.stringify(true)))))",
    );
    record.observations[name] = await observe(metricsDOM);
  };
  await captureStage("restored", 1);
  await writeFile(join(root, ".supersession-release"), "", { flag: "wx", mode: 0o600 });
  await captureStage("firstCurrent", 2, "first_current");
  await writeFile(join(root, ".supersession-release-final"), "", { flag: "wx", mode: 0o600 });
  await captureStage("complete", 3);
  record.source = await inspect();
  record.sourceAfter = await inspect();
  assert.deepEqual(
    record.sourceAfter,
    record.source,
    "Completed source/projection/registry/stream changed between independent inspections",
  );
  record.assetInventoryAfter = JSON.parse(
    await boundedJson(join(repo, "src/wavedl_daemon/web_assets/.wavedl-assets.json"), 1048576),
  );
  assert.deepEqual(record.assetInventoryAfter, record.assetInventory);
  record.assetManifestSha256After = await currentAssetDigest();
  assert.equal(record.assetManifestSha256After, record.assetManifestSha256);
  record.browserProof = {
    publicAdoption: true,
    nativeActions: true,
    domOnlyObservation: true,
    noPrivateInjection: true,
  };
  record.status = "passed";
} catch (error) {
  failure = error.message ?? String(error);
  record.error = failure;
  record.failureStage = record.stage;
  try {
    record.failureDom = await observe(
      '({text:document.body.innerText,selected:document.querySelector("[aria-label=\\"Selected run\\"] .identity")?.textContent.trim()??null})',
    );
  } catch {
    record.failureDomUnavailable = true;
  }
} finally {
  const cleanupCli = (...args) =>
    boundedCommand(browser, ["--session", session, ...args], { cwd: repo, env, timeout: 10000 });
  try {
    if (opened) await cleanupCli("close");
    const end = Date.now() + 15000;
    do {
      record.cleanup.browserClosed = !(
        await boundedCommand(browser, ["session", "list"], { cwd: repo, env, timeout: 10000 })
      ).includes(session);
      if (record.cleanup.browserClosed) break;
      await delay(100);
    } while (Date.now() < end);
  } catch {
    record.cleanup.browserClosed = false;
  }
  signal("SIGINT");
  let timer;
  await Promise.race([
    closed,
    new Promise((r) => {
      timer = setTimeout(r, 15000);
    }),
  ]);
  clearTimeout(timer);
  if (fixture.exitCode === null && fixture.signalCode === null) {
    signal("SIGKILL");
    await Promise.race([closed, delay(3000)]);
  }
  record.cleanup.fixtureReaped = fixture.exitCode !== null || fixture.signalCode !== null;
  record.cleanup.servicesClosed = stdout.includes("Fixture: services-closed");
  try {
    if (grouped && fixture.pid) {
      process.kill(-fixture.pid, 0);
      record.cleanup.processGroupAbsent = false;
    } else record.cleanup.processGroupAbsent = record.cleanup.fixtureReaped;
  } catch (e) {
    record.cleanup.processGroupAbsent = e.code === "ESRCH";
  }
  record.cleanup.listenerClosed = false;
  if (origin)
    try {
      await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) });
    } catch (e) {
      record.cleanup.listenerClosed =
        e?.cause?.code === "ECONNREFUSED" || e?.code === "ECONNREFUSED";
    }
  if (Object.values(record.cleanup).every((v) => v === true)) {
    try {
      await rm(work, { recursive: true, force: false });
      await access(work)
        .then(() => {
          throw Error("Owned workspace still exists");
        })
        .catch((e) => {
          if (e.code !== "ENOENT") throw e;
        });
      record.cleanup.workspaceRemoved = true;
      record.cleanup.profileRemoved = true;
      record.cleanup.tokenRemoved = true;
    } catch {
      record.cleanup.workspaceRemoved = false;
      record.retainedWorkspace = work;
      failure ??= "Owned workspace removal unproven";
    }
  } else {
    record.cleanup.workspaceRemoved = false;
    record.retainedWorkspace = work;
    failure ??= "Cleanup unproven; private workspace retained";
  }
  if (failure) {
    record.status = "failed";
    record.error = failure;
  }
  if (record.status === "passed")
    try {
      verifySupersessionReport(record);
    } catch (e) {
      record.status = "failed";
      record.error = e.message;
      failure = e.message;
    }
  await writeFile(report, JSON.stringify(record, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
if (record.status !== "passed")
  throw Error(`${record.error ?? "Supersession acceptance failed"}; report ${report}`);
console.log(`Passed: ${report}`);
