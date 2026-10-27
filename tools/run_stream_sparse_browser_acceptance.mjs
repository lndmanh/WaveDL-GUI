#!/usr/bin/env node
// Bounded injected faults; browser evidence comes only from public DOM/requests.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { boundedCommand } from "./browser_process.mjs";
import { browserLaunchArgs } from "./browser_launch_policy.mjs";
import { createBrowserActions } from "./browser_actions.mjs";
import { verifyStreamSparseBrowserReport } from "./verify_stream_sparse_browser_report.mjs";

const repo = resolve(new URL("..", import.meta.url).pathname);
const python = process.env.WAVEDL_PYTHON ?? "python";
const browser = process.env.AGENT_BROWSER_BIN ?? "agent-browser";
const reportPath =
  process.argv.find((arg) => arg.startsWith("--report="))?.slice(9) ??
  join(tmpdir(), `wavedl-sparse-${randomUUID()}.json`);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await assert.rejects(access(reportPath), "Report already exists");
  const workspace = await mkdtemp(join(tmpdir(), "wavedl-sparse-browser-"));
  assert(!resolve(reportPath).startsWith(workspace + "/"));
  const root = join(workspace, "root");
  const profile = join(workspace, "profile");
  const evidence = join(workspace, "evidence.json");
  const release = join(workspace, "rendered.release");
  await mkdir(root, { mode: 0o700 });
  await mkdir(profile, { mode: 0o700 });
  const session = `wavedl-sparse-${randomUUID().slice(0, 12)}`;
  const fixture = spawn(
    python,
    [
      "tools/stream_sparse_browser_fixture.py",
      "--evidence",
      evidence,
      "--release",
      release,
      "--root",
      root,
    ],
    {
      cwd: repo,
      env: { ...process.env, PYTHONPATH: join(repo, "src") },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const fixtureClosed = new Promise((r) => fixture.once("close", r));
  let spawnFailed = false;
  fixture.on("error", () => {
    spawnFailed = true;
  });
  let stdout = "",
    stdoutOverflow = false;
  fixture.stdout.on("data", (chunk) => {
    if (stdout.length + chunk.length > 1048576) stdoutOverflow = true;
    else stdout += chunk.toString();
  });
  fixture.stderr.on("data", () => {});
  const browserEnv = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")),
    ),
    AGENT_BROWSER_SESSION: session,
  };
  const cli = (...args) =>
    boundedCommand(browser, ["--session", session, ...args], {
      cwd: repo,
      env: browserEnv,
      timeout: 45000,
    });
  const dom = async (expression) =>
    JSON.parse(JSON.parse(await cli("eval", "-b", Buffer.from(expression).toString("base64"))));
  const observe = (expression) => dom(`JSON.stringify(${expression})`);
  const actions = createBrowserActions({ cli, dom, snapshot: () => cli("snapshot", "-i") });
  const poll = async (get, accepts, label) => {
    const end = Date.now() + 60000;
    while (Date.now() < end) {
      const value = await get();
      if (accepts(value)) return value;
      await delay(100);
    }
    throw new Error(`${label} timeout`);
  };
  const result = {
    status: "failed",
    scope: "real-packaged-browser-sparse-stream",
    browserObserved: false,
    localCursor: null,
    records: [],
    limitation:
      "attempt rollover and post-rejection local cursor are unclaimed; Unicode annotation, event omission and controls are bounded fixture faults; ASGI byte splits do not assert browser network chunk boundaries",
    cleanup: {},
  };
  let failure = null,
    origin = null;
  try {
    await poll(
      () => stdout,
      (v) => {
        if (spawnFailed || stdoutOverflow || fixture.exitCode !== null)
          throw new Error("Fixture failed readiness");
        return v.includes("Browser: ");
      },
      "fixture readiness",
    );
    const url = stdout.match(/Browser: (http:\/\/[^\s]+)/)?.[1];
    result.runId = stdout.match(/Run: ([0-9a-f-]{36})/)?.[1];
    assert(url && result.runId);
    origin = new URL(url).origin;
    result.assetManifestSha256 = createHash("sha256")
      .update(await readFile(join(repo, "src/wavedl_daemon/web_assets/.wavedl-assets.json")))
      .digest("hex");
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
    await cli("click", await actions.readyControl("button", result.runId, false, { locator: row }));
    result.browserRuntime = await observe("({userAgent:navigator.userAgent})");
    result.rendered = await poll(
      () =>
        observe(
          `({selectedRun:document.querySelector('[aria-label="Selected run"] .identity')?.textContent.trim(),diagnostics:document.querySelector('[aria-label="Runtime diagnostics"] pre')?.textContent||''})`,
        ),
      (v) =>
        v.selectedRun === result.runId &&
        v.diagnostics.includes("QA split UTF-8: sóng 波 🌊") &&
        /\[1:2\]/.test(v.diagnostics),
      "sparse Unicode DOM",
    );
    await writeFile(release, "observed\n", { flag: "wx", mode: 0o600 });
    result.rejection = await poll(
      () =>
        observe(
          `({message:document.querySelector('[role="alert"]')?.innerText||'',selectedCleared:!document.querySelector('[aria-label="Selected run"]'),credentialEmpty:document.querySelector('#daemon-bearer')?.value===''})`,
        ),
      (v) =>
        v.message.includes("Daemon identity, build or protocol changed.") &&
        v.selectedCleared &&
        v.credentialEmpty,
      "protocol retirement DOM",
    );
    result.records = (
      await poll(
        async () => {
          try {
            return JSON.parse(await readFile(evidence, "utf8"));
          } catch {
            return null;
          }
        },
        (v) => v?.records.length === 2 && v.records[1].controlFault === "ahead-uncommitted-cursor",
        "control boundary",
      )
    ).records;
    result.authority = JSON.parse(
      await boundedCommand(
        python,
        [
          "-c",
          "import json,sqlite3,sys\nfrom pathlib import Path\nr=Path(sys.argv[1]); run=sys.argv[2]\nc=sqlite3.connect((r/'state'/'registry.db').as_uri()+'?mode=ro',uri=True)\npaths=list((r/'runs').rglob('events.jsonl'))\nif len(paths)>64: raise ValueError('journal count')\nids=[]\nfor p in paths:\n if p.is_symlink() or p.stat().st_size>8388608: raise ValueError('journal bound')\n for line in p.read_text(encoding='utf-8').splitlines():\n  e=json.loads(line)\n  if e.get('run_id')==run: ids.append([e['attempt'],e['seq']])\nprint(json.dumps({'cursors':dict(c.execute('SELECT attempt,seq FROM cursors WHERE run_id=?',(run,)).fetchall()),'journalIds':ids}))",
          root,
          result.runId,
        ],
        { cwd: repo, timeout: 10000 },
      ),
    );
    result.browserObserved = true;
    result.status = "passed";
  } catch (error) {
    failure = error instanceof Error ? error.message : "acceptance failed";
    result.error = failure;
  } finally {
    try {
      await cli("close");
      const end = Date.now() + 3000;
      let listed = true;
      while (listed && Date.now() < end) {
        listed = (
          await boundedCommand(browser, ["session", "list"], {
            cwd: repo,
            env: browserEnv,
            timeout: 10000,
          })
        ).includes(session);
        if (listed) await delay(100);
      }
      assert(!listed, "Browser remains listed");
      result.cleanup.browserClosed = true;
    } catch {
      result.cleanup.browserClosed = false;
      failure ??= "Browser cleanup unconfirmed";
    }
    if (fixture.exitCode === null && fixture.signalCode === null) fixture.kill("SIGINT");
    let timer;
    try {
      await Promise.race([
        fixtureClosed,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            fixture.kill("SIGKILL");
            reject(new Error("Fixture cleanup timeout"));
          }, 15000);
        }),
      ]);
      result.cleanup.fixtureReaped = true;
    } catch {
      result.cleanup.fixtureReaped = false;
      failure ??= "Fixture cleanup unconfirmed";
    } finally {
      clearTimeout(timer);
    }
    result.cleanup.servicesClosed = stdout.includes("Fixture: services-closed");
    result.cleanup.listenerClosed = false;
    if (origin)
      try {
        await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) });
      } catch (error) {
        result.cleanup.listenerClosed = error.cause?.code === "ECONNREFUSED";
      }
    if (!result.cleanup.servicesClosed || !result.cleanup.listenerClosed)
      failure ??= "Daemon cleanup unconfirmed";
    if (failure)
      try {
        result.records = JSON.parse(await readFile(evidence, "utf8")).records;
      } catch {
        /* missing fixture evidence remains explicit */
      }
    if (!failure) {
      await rm(workspace, { recursive: true, force: false });
      result.cleanup.ownedRootsRemoved = true;
    } else result.retainedWorkspace = workspace;
    if (failure) {
      result.status = "failed";
      result.error = failure;
    }
    if (!failure)
      try {
        verifyStreamSparseBrowserReport(result);
      } catch {
        result.status = "failed";
        result.error = failure = "Report verification failed";
      }
    await writeFile(reportPath, JSON.stringify(result, null, 2), { flag: "wx", mode: 0o600 });
  }
  if (failure) throw new Error(`Sparse browser acceptance failed; private report: ${reportPath}`);
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
