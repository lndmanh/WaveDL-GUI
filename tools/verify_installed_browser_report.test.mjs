import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { verifyInstalledBrowserRecord, verifyInstalledBrowserFile } from "./verify_installed_browser_report.mjs";

const expectedWheelSha256 = "a".repeat(64);

function fixture() {
  const prefix = "/private/owned/venv";
  const python = prefix + "/bin/python";
  const sha256 = "a".repeat(64);
  const assets = Object.fromEntries(Array.from({ length: 32 }, (_, index) => [`asset-${index}`, sha256]));
  assets[".wavedl-assets.json"] = sha256;
  const file = { size: 100, sha256 };
  const id = index => `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
  const training = { operation: "train", run_id: id(5), resolved_config: { model: "cnn", epochs: 3, workers: 0 }, runtime: { device: "cpu", python } };
  const approved = { operation: "test", run_id: id(7), checkpoint_source: { run_id: id(5), generation: "gen-000001" } };
  const plot = { operation: "plot", run_id: id(6), checkpoint_source: { run_id: id(5), generation: "gen-000001" } };
  const abandoned = { operation: "test", run_id: id(8) };
  const plans = [training, plot, approved, abandoned].map((manifest, index) => ({ plan_id: id(index + 1), manifest, submission_requested: index === 3 ? 0 : 1, cancellation_requested: 0 }));
  const publication = { generation: "gen-000001", completeSha256: sha256, complete: { files: { "predictions.csv": file } }, verifiedFiles: { "predictions.csv": file } };
  const evaluation = { runId: approved.run_id, state: "completed", publications: [publication], events: [
    { type: "exit", run_id: approved.run_id, payload: { status: "completed" } },
    { type: "metric", payload: { name: "evaluation", metrics: { mse: 1 } } },
  ] };
  const submissions = plans.slice(0, 3).map((plan, index) => ({ plan_id: plan.plan_id, run_id: plan.manifest.run_id, request_id: id(index + 9), pid: index + 1, supervisor_id: `supervisor-${index}` }));
  const state = { plans: 4, runs: submissions.map(row => ({ run_id: row.run_id, state: "completed" })), submissions,
    control: plans.map(({ plan_id, submission_requested, cancellation_requested }) => ({ plan_id, submission_requested, cancellation_requested })),
    executions: submissions.map(row => ({ ...row, observed_status: "terminal", cancel_delivered: 0 })) };
  return {
    name: "installed-wheel-browser", status: "passed", browser: "agent-browser 0.26.0", wheelSha256: expectedWheelSha256, expectedWheelSha256,
    ownedWheel: { mode: 0o400, beforeInstallSha256: expectedWheelSha256, afterOriginsSha256: expectedWheelSha256, finalSha256: expectedWheelSha256 },
    started: "2026-10-20T00:00:00Z", finished: "2026-10-20T00:01:00Z",
    scope: "fresh isolated native CPython venv from offline wheelhouse; local CPU only",
    environment: { pythonPathRemoved: true, pythonHomeRemoved: true, userSiteDisabled: true, systemSitePackages: false, offlineResolution: true },
    installation: { prefix, python, console: prefix + "/bin/wavedl-daemon", modules: Object.fromEntries(["wavedl", "wavedl.core.protocol", "wavedl_daemon", "wavedl_daemon.cli"].map(name => [name, prefix + "/lib/" + name])),
      noCheckoutPath: true, observedSystemSitePackages: false, qtAbsent: true, cwdOutsideCheckout: true, pipCheck: true, assetCount: 33, assets, assetManifestSha256: sha256 },
    installBudget: { minimumFreeBytes: 2 * 1024 ** 3, samples: 20, offlineOnly: true, terminalExit: 0 },
    pythonInterpreter: python, bootstrap: { removed: true, local: [], session: [], cookies: "" },
    trainingManifest: training,
    previewRegistry: { plans: 1, submissions: [], executions: [], control: [{ submission_requested: 0, cancellation_requested: 0 }] },
    trainingSettled: { plans: 2, runs: [{ state: "completed" }, { state: "completed" }] },
    resultOperations: { sourceRunId: training.run_id, approved, selected: { value: "gen-000001" },
      refusal: { before: {}, after: {}, invalid: "true" }, durable: { plans, runs: [{ runId: training.run_id, state: "completed", publications: [{ generation: "gen-000001" }] }, evaluation] } },
    predictions: { generation: "gen-000001", runId: approved.run_id, expected: file, actual: file }, finalRegistry: state,
    cleanupRegistry: structuredClone(state), daemonExit: { code: 130, signal: null },
    staticClient: { path: "/settings/storage", shell: true, apiStatus: 401, apiType: "application/json" }, runtimePids: [1, 2, 3],
    cleanup: { errors: [], browserAbsent: true, daemonReaped: true, applicationShutdownComplete: true, listenerAbsent: true, daemonPidAbsent: true, runtimePidsAndGroupsAbsent: true, storageClosed: true, ownedRootsRemoved: true },
  };
}
test("accepts exact installed-runtime and native-browser evidence boundary", () => verifyInstalledBrowserRecord(fixture(), expectedWheelSha256));
for (const [name, mutate] of [
  ["wrong wheel", record => record.wheelSha256 = "0".repeat(64)],
  ["failure", record => record.status = "failed"],
  ["skip", record => record.skipped = true],
  ["checkout origin", record => record.installation.modules.wavedl = "/checkout/src/wavedl.py"],
  ["traversal masked by venv prefix", record => record.installation.modules.wavedl = record.installation.prefix + "/../../checkout/src/wavedl.py"],
  ["console traversal", record => record.installation.console = record.installation.prefix + "/../../host/bin/wavedl-daemon"],
  ["interpreter traversal", record => record.installation.python = record.installation.prefix + "/../../host/python"],
  ["modified owned wheel", record => record.ownedWheel.finalSha256 = "0".repeat(64)],
  ["writable owned wheel", record => record.ownedWheel.mode = 0o600],
  ["editable path", record => record.installation.noCheckoutPath = false],
  ["inherited site", record => record.environment.systemSitePackages = true],
  ["observed inherited site", record => record.installation.observedSystemSitePackages = true],
  ["unknown expected hash", record => record.expectedWheelSha256 = "0".repeat(64)],
  ["early writer", record => record.previewRegistry.submissions.push({})],
  ["missing writer boundary", record => delete record.previewRegistry.submissions],
  ["foreign runtime binding", record => record.finalRegistry.executions[0].supervisor_id = "foreign"],
  ["rotated plan runtime identities", record => {
    const ids = record.finalRegistry.submissions.map(row => row.run_id);
    for (const rows of [record.finalRegistry.submissions, record.finalRegistry.executions]) {
      rows.forEach((row, index) => { row.run_id = ids[(index + 1) % ids.length]; });
    }
    record.cleanupRegistry = structuredClone(record.finalRegistry);
  }],
  ["foreign final training run", record => record.finalRegistry.runs[0].run_id = "00000000-0000-4000-8000-000000000099"],
  ["foreign evaluation plan", record => record.resultOperations.durable.plans[2].manifest.run_id = "00000000-0000-4000-8000-000000000099"],
  ["foreign automatic plot", record => record.resultOperations.durable.plans[1].manifest.checkpoint_source.run_id = "00000000-0000-4000-8000-000000000099"],
  ["unpublished plot checkpoint", record => record.resultOperations.durable.plans[1].manifest.checkpoint_source.generation = "gen-999999"],
  ["duplicate durable plan", record => record.resultOperations.durable.plans[3].plan_id = record.resultOperations.durable.plans[0].plan_id],
  ["foreign execution plan", record => record.finalRegistry.executions[0].plan_id = "00000000-0000-4000-8000-000000000099"],
  ["foreign runtime pid", record => record.runtimePids[0] = 99999],
  ["contradictory exit", record => record.daemonExit.signal = "SIGINT"],
  ["missing date", record => delete record.started],
  ["late mutation after shutdown", record => record.cleanupRegistry.plans = 5],
  ["abnormal daemon exit", record => record.daemonExit.code = 1],
  ["no shutdown witness", record => record.cleanup.applicationShutdownComplete = false],
  ["held dispatch lock", record => record.cleanup.storageClosed = false],
  ["disk margin exceeded", record => record.installBudget.minimumFreeBytes = 100],
  ["missing assets", record => record.installation.assetCount = 32],
  ["wrong interpreter", record => record.trainingManifest.runtime.python = "/host/python"],
  ["early submission", record => record.previewRegistry.control[0].submission_requested = 1],
  ["training failed", record => record.trainingSettled.runs[0].state = "failed"],
  ["foreign checkpoint", record => record.resultOperations.approved.checkpoint_source.run_id = "foreign"],
  ["no evaluation metric", record => record.resultOperations.durable.runs[1].events.pop()],
  ["download mismatch", record => record.predictions.actual = { size: 99, sha256: "b".repeat(64) }],
  ["API route returned shell", record => record.staticClient.apiType = "text/html"],
  ["orphan process", record => record.cleanup.runtimePidsAndGroupsAbsent = false],
  ["cleanup failure", record => record.cleanup.errors.push("failure")],
]) test(`rejects ${name}`, () => {
  const record = structuredClone(fixture());
  mutate(record);
  assert.throws(() => verifyInstalledBrowserRecord(record, expectedWheelSha256));
});
test("runner starts the real console outside checkout and verifies static API separation", async () => {
  const source = await readFile(new URL("./run_installed_browser_acceptance.mjs", import.meta.url), "utf8");
  assert(source.includes('spawn(executable, ["serve"'));
  assert(source.includes('"--run-root"') && source.includes('"--state-root"') && source.includes('"--browse-root"'));
  assert(source.includes("delete environment.PYTHONPATH") && source.includes("delete environment.PYTHONHOME"));
  assert(source.includes("--no-cache-dir") && source.includes("--no-index") && source.includes("--only-binary=:all:"));
  assert(!source.includes("--system-site-packages") && !source.includes("sys.path.remove") && !source.includes("sys.path.insert"));
  assert(!source.includes("browser_daemon_fixture.py") && !source.includes("dispatchEvent"));
  assert(source.includes("include-system-site-packages = false"));
  assert(source.includes("fetch('/api/unknown',{cache:'no-store',headers:{accept:'text/html'}})"));
  assert(source.includes("Unresolved native ownership requires retained roots"));
  assert(source.includes('mode: 0o400, flag: "wx"'));
  assert(source.includes("Provides-Extra") && source.includes("Requires-Dist") && source.includes("importlib.util.find_spec(name) is None"));
});
test("actual installed runner registry SQL preserves the separate writer boundary", async t => {
  const source = await readFile(new URL("./run_installed_browser_acceptance.mjs", import.meta.url), "utf8");
  const script = source.match(/const registryScript = `([\s\S]*?)`;/)?.[1];
  assert(script);
  const directory = await mkdtemp(join(tmpdir(), "wavedl-installed-registry-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const python = process.env.WAVEDL_PYTHON ?? "python3.11";
  execFileSync(python, ["-c", `import sqlite3,sys
from pathlib import Path
p=Path(sys.argv[1])/'state';p.mkdir();c=sqlite3.connect(p/'registry.db')
c.executescript('CREATE TABLE runs(run_id,state); CREATE TABLE plans(plan_id,request_id,plan_json); CREATE TABLE plan_control(plan_id,submission_requested,cancellation_requested); CREATE TABLE submission_control(plan_id,state,submission_handle_json); CREATE TABLE execution_control(plan_id,cancel_delivered,handle_json,latest_observation_json,observation_json);');c.close()`, directory], { timeout: 10000 });
  const snapshot = JSON.parse(execFileSync(python, ["-c", script, directory], { encoding: "utf8", timeout: 10000 }));
  assert.deepEqual(snapshot, { plans: 0, runs: [], control: [], submissions: [], executions: [] });
});
test("installed evidence reader rejects symlinks, oversized and invalid UTF-8 input", async t => {
  const directory = await mkdtemp(join(tmpdir(), "wavedl-installed-reader-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "report.json");
  await writeFile(path, JSON.stringify(fixture()));
  await verifyInstalledBrowserFile(path, expectedWheelSha256);
  await assert.rejects(verifyInstalledBrowserFile(path, "0".repeat(64)));
  const link = join(directory, "link.json");
  await symlink(path, link);
  await assert.rejects(verifyInstalledBrowserFile(link, expectedWheelSha256));
  await writeFile(path, Buffer.from([0xff]));
  await assert.rejects(verifyInstalledBrowserFile(path, expectedWheelSha256));
  await writeFile(path, Buffer.alloc(1024 * 1024 + 1));
  await assert.rejects(verifyInstalledBrowserFile(path, expectedWheelSha256));
});
