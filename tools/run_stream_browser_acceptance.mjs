#!/usr/bin/env node
// Bounded real-browser stream subgate. The fixture owns the CPU daemon and
// deliberately ends the first SSE response after one real frame; the browser
// must reconnect from the cursor it parsed. The fixture injects an overflow
// control with that real frame's cursor, not a genuine broker capacity overflow.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  access,
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { boundedCommand } from "./run_retained_browser_acceptance.mjs";
import { browserLaunchArgs } from "./browser_launch_policy.mjs";
import {
  createBrowserActions,
  DRIVER_READINESS_MODE,
} from "./browser_actions.mjs";
import { verifyStreamBrowserReport } from "./verify_stream_browser_report.mjs";
import { fileURLToPath } from "node:url";

const repo = resolve(new URL("..", import.meta.url).pathname);
const python = process.env.WAVEDL_PYTHON ?? "python";
const browser = process.env.AGENT_BROWSER_BIN ?? "agent-browser";
const option = (name) =>
  process.argv
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.slice(name.length + 3);

export async function main() {
  const workspace = await mkdtemp(join(tmpdir(), "wavedl-stream-browser-"));
  await chmod(workspace, 0o700);
  const root = join(workspace, "root");
  const profile = join(workspace, "profile");
  const evidence = join(workspace, "stream-evidence.json");
  const report = resolve(
    option("report") ??
      join(tmpdir(), `wavedl-stream-report-${randomUUID()}.json`),
  );
  assert(
    !report.startsWith(workspace + "/"),
    "Report must be outside owned workspace",
  );
  await assert.rejects(access(report), "Report already exists");
  await mkdir(root, { mode: 0o700 });
  await mkdir(profile, { mode: 0o700 });
  const session = `wavedl-stream-${randomUUID().slice(0, 12)}`;
  const fixture = spawn(
    python,
    ["tools/browser_stream_fixture.py", "--evidence", evidence, "--root", root],
    {
      cwd: repo,
      env: { ...process.env, PYTHONPATH: join(repo, "src") },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let fixtureStarted = false;
  const fixtureClosed = new Promise((resolveClosed) =>
    fixture.once("close", resolveClosed),
  );
  const fixtureReady = new Promise((resolveReady, rejectReady) => {
    fixture.once("spawn", () => {
      fixtureStarted = true;
      resolveReady();
    });
    // Never retain the raw error: it can contain private interpreter paths.
    fixture.on("error", () =>
      rejectReady(new Error("Fixture process could not start")),
    );
  });
  let stdout = "",
    stdoutOverflow = false;
  fixture.stdout.on("data", (chunk) => {
    if (Buffer.byteLength(stdout) + chunk.length > 1024 * 1024)
      stdoutOverflow = true;
    else stdout += chunk.toString();
  });
  fixture.stderr.on("data", () => {});
  const browserEnv = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith("AGENT_BROWSER_"),
      ),
    ),
    AGENT_BROWSER_SESSION: session,
  };
  const cli = (...args) =>
    boundedCommand(browser, ["--session", session, ...args], {
      cwd: repo,
      env: browserEnv,
      timeout: 45000,
    });
  const observe = async (expression) =>
    JSON.parse(
      JSON.parse(
        await cli(
          "eval",
          "-b",
          Buffer.from(`JSON.stringify(${expression})`).toString("base64"),
        ),
      ),
    );
  const dom = async (expression) =>
    JSON.parse(
      JSON.parse(
        await cli("eval", "-b", Buffer.from(expression).toString("base64")),
      ),
    );
  const actions = createBrowserActions({
    cli,
    dom,
    snapshot: () => cli("snapshot", "-i"),
  });
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const poll = async (observeValue, accepts, description, timeout = 60000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = await observeValue();
      if (accepts(value)) return value;
      await delay(100);
    }
    throw new Error(`${description} timeout`);
  };
  let failure = null;
  const result = {
    status: "running",
    scope: "real-browser-plus-asgi-boundary",
    browserObserved: false,
    localCursor: null,
    records: [],
    cleanup: {},
  };
  result.driverReadinessMode = DRIVER_READINESS_MODE;
  let origin = null;
  let browserAttempted = false;
  try {
    await fixtureReady;
    result.assetManifestSha256 = createHash("sha256")
      .update(
        await readFile(
          join(repo, "src/wavedl_daemon/web_assets/.wavedl-assets.json"),
        ),
      )
      .digest("hex");
    browserAttempted = true;
    result.browser = await boundedCommand(browser, ["--version"], {
      cwd: repo,
      timeout: 10000,
    });
    const deadline = Date.now() + 60000;
    while (!stdout.includes("Browser: ")) {
      if (fixture.exitCode !== null)
        throw new Error("Fixture exited before readiness");
      if (stdoutOverflow) throw new Error("Fixture stdout exceeded bound");
      if (Date.now() > deadline) throw new Error("Fixture readiness timeout");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    const url = stdout.match(/Browser: (http:\/\/[^\s]+)/)?.[1];
    assert(url);
    origin = new URL(url).origin;
    result.runId = stdout.match(/Run: ([0-9a-f-]{36})/)?.[1];
    assert(/^[0-9a-f-]{36}$/.test(result.runId), "No seeded run identity");
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
    await cli("wait", "--text", "Connected");
    const row = `xpath=//section[@aria-label='Runs']//button[.//small[normalize-space()='${result.runId}']]`;
    await cli(
      "wait",
      "--fn",
      `Array.from(document.querySelectorAll('[aria-label="Runs"] small')).some(e=>e.textContent.trim()===${JSON.stringify(result.runId)})`,
    );
    const readyRow = await actions.readyControl("button", result.runId, false, {
      locator: row,
    });
    await cli("click", readyRow);
    result.browserRuntime = await observe("({userAgent:navigator.userAgent})");
    result.rendered = await poll(
      () =>
        observe(
          `({selectedRun:document.querySelector('[aria-label="Selected run"] .identity')?.textContent.trim(),historySteps:Number(document.querySelector('[aria-label="Runtime metric history"]')?.innerText.match(/lineage · ([0-9]+) steps/)?.[1]??0),historyCanvas:!!document.querySelector('[aria-label="Runtime metric history"] canvas'),diagnostics:document.querySelector('[aria-label="Runtime diagnostics"] pre')?.textContent.includes('Training runtime rank 0')??false})`,
        ),
      (value) =>
        value.selectedRun === result.runId &&
        value.historySteps > 0 &&
        value.historyCanvas &&
        value.diagnostics,
      "rendered CPU history",
    );
    // Real focus action; inspect only the public diagnostic region, not private state.
    await cli("focus", '[role="log"][aria-label="Runtime diagnostics"]');
    result.diagnosticAccessibility = await observe(
      `({role:document.activeElement?.getAttribute('role'),label:document.activeElement?.getAttribute('aria-label'),tabIndex:document.activeElement?.tabIndex,live:document.activeElement?.getAttribute('aria-live'),plainText:document.activeElement?.tagName==='PRE'&&document.activeElement.children.length===0,overflow:document.activeElement?getComputedStyle(document.activeElement).overflowY:null})`,
    );
    const evidenceData = await poll(
      async () => {
        try {
          return JSON.parse(await readFile(evidence, "utf8"));
        } catch {
          return null;
        }
      },
      (value) =>
        value?.records.length === 2 &&
        value.records[1].cursor?.seq >= 0 &&
        value.records[1].forwardedIds.some(
          (id) =>
            id[0] > value.records[1].cursor.attempt ||
            (id[0] === value.records[1].cursor.attempt &&
              id[1] > value.records[1].cursor.seq),
        ),
      "reconnect boundary",
    );
    const records = evidenceData.records;
    assert(records.some((record) => record.interrupted));
    const reconnect = records.find((record) => record.cursor?.seq >= 0);
    assert(reconnect, "Browser did not issue a cursor-bearing reconnect");
    const first = records.find((record) => record.interrupted);
    const last = first.forwardedIds.at(-1);
    const expected =
      first.controlResume ?? (last ? { attempt: last[0], seq: last[1] } : null);
    assert.deepEqual(reconnect.cursor, expected);
    result.browserObserved = true;
    result.records = records;
    result.authority = JSON.parse(
      await boundedCommand(
        python,
        [
          "-c",
          `import json,sqlite3,sys
from pathlib import Path
root=Path(sys.argv[1]); run=sys.argv[2]
c=sqlite3.connect((root/'state'/'registry.db').resolve().as_uri()+'?mode=ro',uri=True)
row=c.execute('SELECT state,event_count FROM runs WHERE run_id=?',(run,)).fetchone()
cursors=dict(c.execute('SELECT attempt,seq FROM cursors WHERE run_id=?',(run,)).fetchall())
paths=list((root/'runs').rglob('events.jsonl'))
if len(paths)>64: raise ValueError('journal count bound')
ids=[]
for path in paths:
 if path.is_symlink() or path.stat().st_size>8388608: raise ValueError('journal bound')
 for line in path.read_text(encoding='utf-8').splitlines():
  e=json.loads(line)
  if e.get('run_id')==run: ids.append([e['attempt'],e['seq']])
print(json.dumps({'state':row[0] if row else None,'eventCount':row[1] if row else None,'cursors':cursors,'journalIds':ids}))`,
          root,
          result.runId,
        ],
        { cwd: repo, timeout: 10000 },
      ),
    );
    result.byteFragmentation = records.reduce(
      (n, record) => n + record.splitBytes,
      0,
    );
    result.utf8Observed = records.some((record) => record.nonAsciiBytes > 0);
    result.limitation =
      "client cursor is observed only through next request; no private storage claim";
    result.status = "passed";
  } catch (error) {
    failure = error instanceof Error ? error.message : "acceptance failed";
    result.status = "failed";
    result.error = failure;
  } finally {
    try {
      if (browserAttempted) await cli("close");
      const deadline = Date.now() + 3000;
      let listed = browserAttempted;
      while (listed && Date.now() < deadline) {
        listed = (
          await boundedCommand(browser, ["session", "list"], {
            cwd: repo,
            env: browserEnv,
            timeout: 10000,
          })
        ).includes(session);
        if (listed) await delay(100);
      }
      assert(!listed, "Browser session remains listed");
      result.cleanup.browserClosed = true;
    } catch {
      result.cleanup.browserClosed = false;
      failure ??= "browser cleanup unconfirmed";
    }
    if (
      fixtureStarted &&
      fixture.exitCode === null &&
      fixture.signalCode === null
    )
      fixture.kill("SIGINT");
    let timer;
    try {
      await Promise.race([
        fixtureClosed,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            if (fixtureStarted) fixture.kill("SIGKILL");
            reject(new Error("Fixture cleanup timeout"));
          }, 15000);
        }),
      ]);
      result.cleanup.fixtureReaped = true;
    } catch {
      result.cleanup.fixtureReaped = false;
      failure ??= "fixture graceful reaping unconfirmed";
    } finally {
      clearTimeout(timer);
    }
    result.cleanup.servicesClosed =
      !fixtureStarted || stdout.includes("Fixture: services-closed");
    result.cleanup.listenerClosed = !fixtureStarted;
    if (origin) {
      try {
        await fetch(`${origin}/api/health`, {
          signal: AbortSignal.timeout(1000),
        });
      } catch (error) {
        result.cleanup.listenerClosed = error.cause?.code === "ECONNREFUSED";
      }
    }
    if (!result.cleanup.servicesClosed)
      failure ??= "fixture services close unconfirmed";
    if (!result.cleanup.listenerClosed)
      failure ??= "fixture listener closure unconfirmed";
    if (failure) {
      result.status = "failed";
      result.error = failure;
    }
    const removeWorkspace = !failure || !fixtureStarted;
    result.retainedWorkspace = removeWorkspace ? null : workspace;
    if (removeWorkspace) {
      await rm(workspace, { recursive: true, force: false });
      result.cleanup.ownedRootsRemoved = true;
    } else result.cleanup.ownedRootsRemoved = false;
    if (!failure) {
      try {
        verifyStreamBrowserReport(result);
      } catch {
        result.status = "failed";
        result.error = "report verification failed";
        failure = result.error;
      }
    }
    await writeFile(report, JSON.stringify(result, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
  }
  if (failure)
    throw new Error(
      `Stream browser acceptance failed; private report: ${report}`,
    );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
