#!/usr/bin/env node
// Dedicated same-daemon authentication/skew acceptance.  This is additive to
// run_web_acceptance.mjs and deliberately owns its browser profile and daemon.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { access, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { boundedCommand } from "./run_retained_browser_acceptance.mjs";
import { createBrowserActions } from "./browser_actions.mjs";
import { browserLaunchArgs } from "./browser_launch_policy.mjs";
import { observeCursorStorage } from "./browser_cursor_storage.mjs";
import {
  editorFieldObservationExpression,
  editorFieldReadyExpression,
  openTrainingEditor,
} from "./browser_training_editor.mjs";

const repo = resolve(new URL("..", import.meta.url).pathname);
const python = process.env.WAVEDL_PYTHON ?? "python";
const browser = process.env.AGENT_BROWSER_BIN ?? "agent-browser";
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

function command(binary, args, { timeout = 35000, env = process.env } = {}) {
  return boundedCommand(binary, args, { cwd: repo, timeout, env });
}

async function main() {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "wavedl-auth-skew-")));
  const reportArg = process.argv.find((arg) => arg.startsWith("--report="))?.slice(9);
  const reportPath = reportArg
    ? resolve(reportArg)
    : join(tmpdir(), `wavedl-auth-skew-report-${randomUUID()}.json`);
  assert(
    !reportPath.startsWith(`${workspace}/`),
    "Report must remain outside the disposable owned workspace",
  );
  await assert.rejects(access(reportPath), "Report path must not already exist");
  const root = join(workspace, "daemon-root");
  const profile = join(workspace, "browser-profile");
  const token = randomBytes(32).toString("base64url");
  const secrets = new Set([token]);
  const redact = (text) => {
    for (const secret of secrets) if (secret) text = text.split(secret).join("[REDACTED]");
    return text.replace(/([?&]bootstrap=)[^\s"&#]+/g, "$1[REDACTED]");
  };
  const tokenFile = join(workspace, "private-bearer");
  const session = `wavedl-auth-skew-${randomUUID().slice(0, 12)}`;
  await mkdir(root, { mode: 0o700 });
  await mkdir(profile, { mode: 0o700 });
  await writeFile(tokenFile, token, { flag: "wx", mode: 0o600 });
  await access(tokenFile);
  const fixture = spawn(
    python,
    ["tools/browser_auth_skew_fixture.py", "--root", root, "--token-file", tokenFile, "--unseeded"],
    {
      cwd: repo,
      env: { ...process.env, PYTHONPATH: join(repo, "src") },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  let stdoutOverflow = false;
  fixture.stdout.on("data", (chunk) => {
    if (Buffer.byteLength(stdout) + chunk.length > 1024 * 1024) {
      stdoutOverflow = true;
      return;
    }
    stdout += chunk;
  });
  fixture.stderr.on("data", (chunk) => {
    stderr = redact((stderr + chunk).slice(-4096));
  });
  const report = {
    status: "running",
    scenario: "same-daemon-auth-skew",
    responseBoundary:
      "explicit owned control file arms one real authenticated GET /api/health response fault",
    fixture: "tools/browser_auth_skew_fixture.py",
    browserSession: session,
    workspace,
    reportPath,
    assertions: [],
  };
  const cli = (...args) =>
    command(
      browser,
      [
        "--session",
        session,
        ...(args[0] === "open"
          ? [
              "--headed",
              String(process.env.WAVEDL_BROWSER_HEADED === "true"),
              "--engine",
              "chrome",
              "--profile",
              profile,
              ...(process.env.WAVEDL_BROWSER_EXECUTABLE
                ? ["--executable-path", process.env.WAVEDL_BROWSER_EXECUTABLE]
                : []),
              "--allowed-domains",
              "127.0.0.1,localhost",
              "--args",
              browserLaunchArgs,
            ]
          : []),
        ...args,
      ],
      {
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")),
          ),
          AGENT_BROWSER_SESSION: session,
        },
      },
    );
  const dom = async (expression) =>
    JSON.parse(JSON.parse(await cli("eval", "-b", Buffer.from(expression).toString("base64"))));
  const observe = async (expression) => dom(`JSON.stringify(${expression})`);
  const actions = createBrowserActions({ cli, dom, snapshot: () => cli("snapshot", "-i") });
  const button = (name) =>
    actions.button(name, false, name === "Connection" ? { scope: "//header" } : {});
  const waitFor = async (expression, description, timeout = 45000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await observe(expression)) return;
      await delay(200);
    }
    throw new Error(`${description} did not become true`);
  };
  const authorityRegistry = async () =>
    JSON.parse(
      await command(python, [
        "-c",
        `import json, sqlite3, sys
from pathlib import Path
c=sqlite3.connect((Path(sys.argv[1])/'state'/'registry.db').resolve().as_uri()+'?mode=ro',uri=True)
rows=c.execute("SELECT pc.plan_id,pc.submission_requested,pc.cancellation_requested,json_extract(json_extract(p.plan_json,'$.manifest_json'),'$.operation'),json_extract(json_extract(p.plan_json,'$.manifest_json'),'$.run_id'),json_extract(json_extract(p.plan_json,'$.manifest_json'),'$.checkpoint_source.run_id'),json_extract(json_extract(p.plan_json,'$.manifest_json'),'$.checkpoint_source.generation') FROM plan_control pc JOIN plans p ON p.plan_id=pc.plan_id ORDER BY pc.plan_id").fetchall()
manifests=[{'planId':r[0],'manifestJson':json.loads(r[1])['manifest_json']} for r in c.execute('SELECT plan_id,plan_json FROM plans ORDER BY plan_id')]
print(json.dumps({'plans':len(rows), 'control':rows, 'manifests':manifests}))`,
        root,
      ]),
    );
  let failure;
  let origin;
  report.stage = "startup";
  try {
    report.assetManifestSha256 = createHash("sha256")
      .update(await readFile(join(repo, "src/wavedl_daemon/web_assets/.wavedl-assets.json")))
      .digest("hex");
    const deadline = Date.now() + 45000;
    while (!stdout.includes("Browser: ")) {
      if (fixture.exitCode !== null) throw new Error(`Fixture exited before ready: ${stderr}`);
      if (Date.now() >= deadline) throw new Error("Fixture startup timed out");
      await delay(100);
    }
    const url = stdout.match(/Browser: (http:\/\/[^\s]+)/)?.[1];
    assert(url, "Fixture did not publish a bootstrap URL");
    secrets.add(url);
    secrets.add(new URL(url).searchParams.get("bootstrap"));
    origin = new URL(url).origin;
    report.stage = "bootstrap";
    await cli("open", url);
    await waitFor(
      "document.body.innerText.includes('Connected')",
      "initial authenticated connection",
    );
    const before = await observe(`({
      connected: document.body.innerText.includes('Connected'),
      storage: (${observeCursorStorage.toString()})(localStorage, sessionStorage, document.cookie, '', ''),
      oldHistory: !!document.querySelector('[aria-label="Runtime metric history"] canvas'),
      oldPlan: !!document.querySelector('[aria-label="Approved normalized manifest"]'),
    })`);
    assert.equal(before.storage.local, 0, "Bearer must not be persisted in localStorage");
    assert.equal(before.storage.session, 0, "Bearer must not be persisted in sessionStorage");
    assert.equal(before.storage.cookies, "", "Bearer must not be persisted as a cookie");
    report.assertions.push(
      "bootstrap exchanged through the real daemon and browser memory remained storage-free",
    );
    report.browserRuntime = await observe("({userAgent:navigator.userAgent})");
    report.browserRuntime.executable =
      process.env.WAVEDL_BROWSER_EXECUTABLE ?? "agent-browser-managed";
    report.browserRuntime.headed = process.env.WAVEDL_BROWSER_HEADED === "true";
    report.stage = "authoring";

    // Establish genuine nonempty authority through the normal labelled editor,
    // persisted approval and CPU runtime before testing retirement.
    await button("New training run");
    const rootSelector = 'xpath=//*[@role="combobox" and @aria-label="Configured root"]';
    const preparedRoot = await actions.readyControl("field", "Configured root", false, {
      locator: rootSelector,
    });
    await cli("click", preparedRoot);
    await actions.option("datasets");
    await cli("wait", "--text", "samples.npz");
    await button("Select file samples.npz");
    await cli(
      "wait",
      "--fn",
      "Array.from(document.querySelectorAll('p')).some(e => e.textContent.trim().startsWith('Dataset: ') && e.textContent.includes('/samples.npz'))",
    );
    await button("Next step");
    await cli("wait", "--text", "Choose CNN");
    await button("Choose CNN");
    await cli(
      "wait",
      "--fn",
      "Array.from(document.querySelectorAll('p')).some(e => e.textContent.trim().startsWith('Model: cnn'))",
    );
    report.trainingEditorReadiness = await openTrainingEditor({ button, cli, dom });
    const interpreter = await command(python, ["-c", "import sys; print(sys.executable)"]);
    report.pythonInterpreter = interpreter;
    await cli("wait", "--fn", editorFieldReadyExpression());
    let interpreterLocator = null;
    const editorDeadline = Date.now() + 15000;
    while (Date.now() < editorDeadline && !interpreterLocator) {
      const state = await observe(editorFieldObservationExpression(true));
      if (state?.visible && state.association && typeof state.id === "string" && state.id)
        interpreterLocator = `#${state.id.replace(/[^A-Za-z0-9_-]/g, "\\$&")}`;
      if (!interpreterLocator) await delay(200);
    }
    assert(
      typeof interpreterLocator === "string" && interpreterLocator.startsWith("#"),
      "Current visible Python interpreter field was not re-observed",
    );
    try {
      await actions.fill("Python interpreter", interpreter, { locator: interpreterLocator });
    } catch (error) {
      report.trainingEditorFailure = await observe(
        `(() => { const fields = Array.from(document.querySelectorAll('section[aria-labelledby="project-title"] label')).filter(e => e.textContent.trim() === 'Python interpreter'); return { labels: fields.length, visible: fields.filter(e => e.getClientRects().length).length, fields: fields.map(e => ({ for: e.htmlFor, visible: !!e.getClientRects().length, controlCount: document.querySelectorAll('#' + CSS.escape(e.htmlFor)).length })) }; })()`,
      );
      throw error;
    }
    const fillStable = async (label, value) => {
      let lastError;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          await actions.fill(label, value);
          const observed = await observe(
            `(() => { const label = Array.from(document.querySelectorAll('label')).find(e => e.textContent.trim() === ${JSON.stringify(label)} && e.getClientRects().length); const field = label && document.getElementById(label.htmlFor); return { count: label ? 1 : 0, id: label?.htmlFor ?? null, value: field?.value ?? null, visible: !!field?.getClientRects().length }; })()`,
          );
          if (observed.count === 1 && observed.visible && observed.value === String(value))
            return observed;
          lastError = new Error(`UI field ${label} did not retain authored value`);
        } catch (error) {
          lastError = error;
        }
        await delay(250);
      }
      report.trainingFieldFailure = await observe(
        `(() => Array.from(document.querySelectorAll('label')).filter(e => e.textContent.trim() === ${JSON.stringify(label)}).map(e => ({for:e.htmlFor,visible:!!e.getClientRects().length,value:document.getElementById(e.htmlFor)?.value ?? null})))()`,
      );
      throw lastError;
    };
    await fillStable("epochs", "3");
    await fillStable("patience", "3");
    await actions.expandSummary("Data, checkpoints and cross-validation");
    await fillStable("workers", "0");
    await fillStable("batch size", "16");
    await actions.select("precision", "no");
    await button("Preview persisted plan");
    await cli("wait", "--text", "Persisted plan for approval");
    const approved = await observe(
      "document.querySelector('[aria-label=\"Approved normalized manifest\"]')?.textContent",
    );
    const manifest = JSON.parse(approved);
    assert(
      manifest.run_id && manifest.runtime.device === "cpu",
      "Genuine persisted CPU approval required",
    );
    report.approvedRunId = manifest.run_id;
    await button("Approve and start this plan");
    report.stage = "nonempty-history";
    await cli("wait", "--text", "Run detail");
    await waitFor(
      "(() => { const history=document.querySelector('[aria-label=\"Runtime metric history\"]'); const current=document.querySelector('[aria-label=\"Current runtime metrics\"]'); return /Active checkpoint lineage · [1-9][0-9]* steps/.test(history?.innerText ?? '') && !!history?.querySelector('canvas') && !!current?.querySelector('progress'); })()",
      "real nonempty runtime metric history",
      60000,
    );
    report.beforeFault = await observe(`({
      selectedRun: document.querySelector('[aria-label="Selected run"] .identity')?.textContent.trim(),
      historySteps: Number(document.querySelector('[aria-label="Runtime metric history"]')?.innerText.match(/lineage · ([0-9]+) steps/)?.[1] ?? 0),
      historyCanvas: !!document.querySelector('[aria-label="Runtime metric history"] canvas'),
      diagnostics: !!document.querySelector('[aria-label="Runtime diagnostics"]')?.innerText.includes('Training runtime rank 0'),
    })`);
    assert.equal(report.beforeFault.selectedRun, manifest.run_id);
    assert(
      report.beforeFault.historySteps > 0 &&
        report.beforeFault.historyCanvas &&
        report.beforeFault.diagnostics,
    );
    report.registryBeforeFault = await authorityRegistry();
    assert.equal(report.registryBeforeFault.plans, 1);
    assert.equal(report.registryBeforeFault.control[0][1], 1);
    assert.equal(report.registryBeforeFault.control[0][2], 0);
    report.assertions.push(
      "persisted approved CPU training produced real nonempty selected-run metrics and diagnostics before the 401",
    );
    report.stage = "authentication-fault";
    await button("Connection");
    report.connectionNavigation = await observe(`({
      panelPresent: !!document.querySelector('section[aria-labelledby="connection-title"]'),
      navCurrent: Array.from(document.querySelectorAll('nav[aria-label="Sections"] button')).find(e => e.getAttribute('aria-current') === 'page')?.textContent.trim(),
      authenticationNotice: document.body.innerText.includes('Credential expired or rejected; enter it again.'),
      identityNotice: document.body.innerText.includes('Connection identity changed'),
    })`);
    await waitFor(
      "!!document.querySelector('section[aria-labelledby=\"connection-title\"]')",
      "connection panel",
    );
    await waitFor(
      "Array.from(document.querySelectorAll('button')).some(e => e.getClientRects().length && e.textContent.trim() === 'Verify connection')",
      "connection verification action",
    );
    const verifyLocator = await actions.readyControl("button", "Verify connection", false, {
      scope: '//section[@aria-labelledby="connection-title"]',
    });
    await writeFile(join(root, ".auth-skew-control"), "401", { flag: "wx", mode: 0o600 });
    await cli("click", verifyLocator);
    await waitFor(
      "document.body.innerText.includes('Credential expired or rejected; enter it again.')",
      "explicit authentication failure state",
    );
    const fault = JSON.parse((await readFile(join(root, ".auth-skew-evidence.jsonl"), "utf8")).trim().split("\n")[0]);
    const storageExpression = `(${observeCursorStorage.toString()})(localStorage, sessionStorage, document.cookie, ${JSON.stringify(fault.daemonId)}, ${JSON.stringify(manifest.run_id)})`;
    const revoked = await observe(`({
      authMessage: document.body.innerText.includes('Credential expired or rejected; enter it again.'),
      reconnectPrompt: document.body.innerText.includes('Daemon bearer credential'),
      stalePlan: !!document.querySelector('[aria-label="Approved normalized manifest"]'),
      staleHistory: !!document.querySelector('[aria-label="Runtime metric history"] canvas'),
      staleSelectedRun: !!document.querySelector('[aria-label="Selected run"]'),
      mutationControls: Array.from(document.querySelectorAll('button')).filter(e => e.getClientRects().length && !e.disabled && /Approve and start|Cancel run|Preview persisted plan/.test(e.textContent)).length,
      storage: ${storageExpression},
    })`);
    report.revoked = revoked;
    assert(
      revoked.authMessage && revoked.reconnectPrompt,
      "401 must require explicit reauthentication",
    );
    assert(
      !revoked.stalePlan && !revoked.staleHistory,
      "401 must retire old plan/history authority",
    );
    assert(!revoked.staleSelectedRun, "401 must remove the old selected-run authority");
    assert.equal(revoked.mutationControls, 0, "401 state must expose no stale mutation controls");
    assert.equal(revoked.storage.session, 0, "401 must not persist credentials in sessionStorage");
    assert.equal(revoked.storage.cookies, "", "401 must not persist credentials in cookies");
    assert(
      revoked.storage.valid,
      "401 may retain only scoped numeric cursor watermark entries",
    );
    report.assertions.push(
      "real authenticated request returned 401 and displayed explicit reauthentication with no stale mutation controls",
    );
    report.tokenObservation =
      "behavioral authority retirement only; private token bytes are not inspected";
    report.historyPlanPrecondition =
      "normal UI persisted approval and submitted CPU runtime with nonempty rendered metric history";

    await actions.fill("Daemon bearer credential", token);
    await button("Connect securely");
    await waitFor(
      "document.body.innerText.includes('Connected')",
      "same-daemon explicit reauthentication",
    );
    const reauthed = await observe(`({
      connected: document.body.innerText.includes('Connected'),
      authMessage: document.body.innerText.includes('Credential expired or rejected; enter it again.'),
      mutationControls: Array.from(document.querySelectorAll('button')).filter(e => e.getClientRects().length && !e.disabled && /Approve and start|Cancel run|Preview persisted plan/.test(e.textContent)).length,
      storage: ${storageExpression},
    })`);
    report.reauthed = reauthed;
    assert(
      reauthed.connected && !reauthed.authMessage,
      "Fresh credential must restore the same daemon scope",
    );
    assert.equal(reauthed.mutationControls, 0, "Reauthentication must not revive a stale plan");
    assert.equal(reauthed.storage.session, 0, "Reauthentication remains memory-only");
    assert.equal(reauthed.storage.cookies, "", "Reauthentication remains cookie-free");
    assert(reauthed.storage.valid, "Reauthentication may persist only scoped numeric cursors");
    report.assertions.push("browser storage contains only bounded daemon/run cursor watermarks; credentials, bootstrap, paths and raw events are not persisted or copied into storage evidence");
    report.assertions.push(
      "same daemon explicitly reauthenticated without reviving stale plan authority",
    );
    for (const mode of ["build", "protocol"]) {
      report.stage = `${mode}-skew`;
      await writeFile(join(root, ".auth-skew-control"), mode, { flag: "wx", mode: 0o600 });
      await button("Verify connection");
      await waitFor(
        "document.body.innerText.includes('Connection identity changed')",
        `${mode} skew notice`,
      );
      await waitFor(
        "document.body.innerText.includes('Daemon identity, build or protocol changed.')",
        `${mode} scope refusal`,
      );
      report.skewObservations ??= [];
      report.skewObservations.push({
        mode,
        refused: await observe("document.body.innerText.includes('Connection identity changed')"),
        recovery: false,
      });
      await button("Disconnect and clear scope");
      await actions.fill("Daemon bearer credential", token);
      await button("Connect securely");
      await waitFor(
        "document.body.innerText.includes('Connected to ')",
        `${mode} explicit recovery`,
      );
      report.skewObservations.at(-1).recovery = true;
      report.assertions.push(
        `${mode} skew refused live authority and recovered only after deliberate clear-scope and credential entry`,
      );
    }
    report.registryAfterRecovery = await authorityRegistry();
    const originalControl = report.registryBeforeFault.control.find(
      (row) => row[0] === report.registryBeforeFault.control[0][0],
    );
    const recoveredOriginal = report.registryAfterRecovery.control.find(
      (row) => row[0] === originalControl[0],
    );
    assert.deepEqual(
      recoveredOriginal,
      originalControl,
      "Original approved plan control changed across auth/skew recovery",
    );
    report.derivedPlanIds = report.registryAfterRecovery.control
      .filter((row) => row[0] !== originalControl[0])
      .map((row) => row[0]);
    const derived = report.registryAfterRecovery.control.filter(
      (row) => row[0] !== originalControl[0],
    );
    assert(
      derived.length <= 1 &&
        derived.every(
          (row) =>
            row[3] === "plot" &&
            row[5] === manifest.run_id &&
            /^gen-[0-9]{6,}$/.test(row[6]) &&
            row[2] === 0,
        ),
      "New plan lacks exact automatic plot lineage to the approved train",
    );
    report.faultEvidence = (await readFile(join(root, ".auth-skew-evidence.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert(
      report.registryAfterRecovery.plans >= report.registryBeforeFault.plans,
      "Durable plan count regressed across auth/skew recovery",
    );
    report.assertions.push(
      "read-only durable registry confirms no stale plan, submission or cancellation mutation across refusal and recovery",
    );
    report.status = "passed";
  } catch (error) {
    failure = error instanceof Error ? error.message : "acceptance failed";
    report.status = "failed";
    report.error = failure;
  } finally {
    report.fixtureStdoutOverflow = stdoutOverflow;
    report.cleanup = {};
    try {
      await cli("close");
      const deadline = Date.now() + 3000;
      let listed = true;
      while (listed && Date.now() < deadline) {
        listed = (await command(browser, ["session", "list"])).includes(session);
        if (listed) await delay(100);
      }
      assert(!listed, "Owned browser session still listed after bounded close poll");
      report.cleanup.browserClosed = true;
    } catch {
      report.cleanup.browserClosed = false;
      failure ??= "Owned browser cleanup unconfirmed";
    }
    const closed =
      fixture.exitCode !== null || fixture.signalCode !== null
        ? Promise.resolve()
        : new Promise((resolveClose) => fixture.once("close", resolveClose));
    fixture.kill("SIGINT");
    let timer;
    try {
      await Promise.race([
        closed,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            fixture.kill("SIGKILL");
            reject(new Error("Daemon graceful cleanup timed out; descendants unverified"));
          }, 15000);
        }),
      ]);
      report.cleanup.fixtureReaped = true;
    } catch {
      fixture.kill("SIGKILL");
      try {
        await Promise.race([
          closed,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("Owned daemon reaping timed out")), 3000);
          }),
        ]);
        report.cleanup.fixtureReaped = true;
      } catch {
        report.cleanup.fixtureReaped = false;
      }
      failure ??= "Daemon graceful shutdown failed; descendants unverified";
    } finally {
      clearTimeout(timer);
    }
    report.cleanup.servicesClosed = !stdoutOverflow && stdout.includes("Fixture: services-closed");
    if (!report.cleanup.servicesClosed) failure ??= "Fixture cleanup lacks services-close evidence";
    if (origin) {
      try {
        await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) });
        report.cleanup.listenerClosed = false;
      } catch (error) {
        report.cleanup.listenerClosed = error.cause?.code === "ECONNREFUSED";
      }
      if (!report.cleanup.listenerClosed) failure ??= "Owned listener closure unconfirmed";
    }
    if (failure) {
      report.status = "failed";
      report.error = failure;
    }
    report.ownedArtifactsRetained = !!failure;
    if (!failure) {
      await rm(workspace, { recursive: true, force: false });
      const absent = async (path) => {
        try {
          await access(path);
          return false;
        } catch (error) {
          return error.code === "ENOENT";
        }
      };
      report.cleanup.ownedRootsRemoved = await absent(root);
      report.cleanup.browserProfileRemoved = await absent(profile);
      report.cleanup.privateCredentialRemoved = await absent(tokenFile);
      report.cleanup.workspaceRemoved = await absent(workspace);
      if (
        !report.cleanup.ownedRootsRemoved ||
        !report.cleanup.browserProfileRemoved ||
        !report.cleanup.privateCredentialRemoved ||
        !report.cleanup.workspaceRemoved
      )
        failure = "Owned acceptance artifacts remained after successful run";
    } else {
      report.cleanup.ownedRootsRemoved = false;
      report.cleanup.browserProfileRemoved = false;
      report.cleanup.privateCredentialRemoved = false;
      report.cleanup.workspaceRemoved = false;
    }
    await writeFile(reportPath, `${redact(JSON.stringify(report))}\n`, { flag: "wx", mode: 0o600 });
  }
  process.stdout.write(`${redact(JSON.stringify(report))}\n`);
  if (failure) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
