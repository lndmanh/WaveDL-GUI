import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { lstat, readdir, readlink } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { boundedFile } from "./browser_files.mjs";
import { currentAssetDigest } from "./verify_adoption_negative_browser_report.mjs";
import { isGeneratedDistAlias } from "./browser_source_snapshot.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const excluded = new Set([
  "node_modules",
  ".nuxt",
  ".output",
  ".cache",
  ".vite",
  ".vendor-backups",
  ".git",
  "__pycache__",
  "web_assets",
]);
const harnessSources = [
  "tools/epoch_metric_plateau_model.py",
  "tools/epoch_metric_browser_fixture.py",
  "tools/epoch_metric_browser_evidence.py",
  "tools/run_epoch_metric_browser_acceptance.mjs",
  "tools/verify_epoch_metric_browser_report.mjs",
  "tools/browser_daemon_fixture.py",
  "tools/browser_numerical_failure_fixture.py",
  "tools/browser_actions.mjs",
  "tools/browser_launch_policy.mjs",
  "tools/browser_asset_proof.mjs",
  "tools/browser_training_editor.mjs",
  "tools/browser_process.mjs",
  "tools/browser_files.mjs",
  "tools/verify_adoption_negative_browser_report.mjs",
  "tools/browser_source_snapshot.mjs",
  "tools/vendor_web_assets.py",
  "unit_tests/test_runtime_training.py",
];

/** Exact current web + Python runtime/daemon + acceptance harness inventory. */
export async function epochSourceFingerprint(repo = repository) {
  const paths = [...harnessSources];
  async function visit(directory, pythonOnly) {
    const directoryStat = await lstat(directory);
    assert(directoryStat.isDirectory() && !directoryStat.isSymbolicLink());
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (excluded.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (
        entry.isSymbolicLink() &&
        isGeneratedDistAlias(relative(repo, path), await readlink(path), repo)
      )
        continue;
      assert(!entry.isSymbolicLink(), "Source symlink forbidden");
      if (entry.isDirectory()) await visit(path, pythonOnly);
      else {
        assert(entry.isFile(), "Ordinary source files required");
        if (!pythonOnly || entry.name.endsWith(".py"))
          paths.push(relative(repo, path).split(sep).join("/"));
      }
      assert(paths.length <= 4096, "Source inventory bound exceeded");
    }
  }
  await visit(join(repo, "web"), false);
  await visit(join(repo, "src/wavedl"), true);
  await visit(join(repo, "src/wavedl_daemon"), true);
  const result = {};
  let size = 0;
  for (const path of [...new Set(paths)].sort()) {
    const bytes = await boundedFile(join(repo, path), 32 * 1024 * 1024, true);
    size += bytes.length;
    assert(size <= 128 * 1024 * 1024);
    result[path] = hash(bytes);
  }
  return result;
}

const hash = (x) => createHash("sha256").update(x).digest("hex");
const close = (a, b) => Math.abs(Number(a) - Number(b)) <= 1e-9;
const uuid = (x) =>
  typeof x === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(x);

export async function requireEpochOutputsAbsent(reportPath) {
  assert(
    typeof reportPath === "string" && reportPath.startsWith("/"),
    "Absolute report path required",
  );
  for (const path of [reportPath, `${reportPath}.first.png`, `${reportPath}.final.png`]) {
    await assert.rejects(
      lstat(path),
      (error) => error.code === "ENOENT",
      "New exclusive report and screenshot paths required",
    );
  }
}

export function verifyEpochMetricBrowserReport(report) {
  assert.equal(report.status, "passed");
  assert(!Object.hasOwn(report, "error") && !Object.hasOwn(report, "retainedWorkspace"));
  assert.equal(report.scope, "real-cpu-epoch-metric-packaged-browser");
  assert(report.limitation.includes("stationary custom CPU model"));
  assert.deepEqual(report.sourcePreflight, report.sourcePostflight);
  assert.deepEqual(report.assetPreflight, report.assetPostflight);
  assert.match(report.assetPreflight?.manifestSha256 ?? "", /^[a-f0-9]{64}$/);
  assert(Object.keys(report.assetPreflight.assets ?? {}).length > 20);
  assert.match(report.browserRuntime?.userAgent ?? "", /Chrome\/\d+/);
  assert.equal(report.browserRuntime.engine, "chrome");
  assert.deepEqual(report.browserRuntime.viewport, { width: 1280, height: 900 });
  assert.equal(report.browserVersion, "agent-browser 0.26.0");
  assert.equal(report.profileInitiallyEmpty, true);
  assert.deepEqual(report.cleanup, {
    browserClosed: true,
    browserSessionAbsent: true,
    profileRemoved: true,
    fixtureReaped: true,
    servicesClosed: true,
    listenerClosed: true,
    ownedRootsRemoved: true,
  });
  assert.deepEqual(report.browserErrors, []);
  assert.match(report.browserSession, /^epoch-[a-f0-9-]+$/);
  assert(
    Array.isArray(report.browserSessionsAfter) &&
      report.browserSessionsAfter.every((session) => typeof session === "string"),
  );
  assert(
    !report.browserSessionsAfter.includes(report.browserSession),
    "Owned browser session remains open",
  );
  assert(
    Number.isFinite(Date.parse(report.startedAt)) &&
      Number.isFinite(Date.parse(report.finishedAt)) &&
      Date.parse(report.finishedAt) > Date.parse(report.startedAt),
  );
  assert(uuid(report.runId) && report.evidence.runs.length === 1);
  const run = report.evidence.runs[0];
  assert.equal(run.run_id, report.runId);
  const events = run.runtimeEvents;
  assert(events.length > 0 && events[0].type === "hello");
  assert.equal(events[0].payload.device, "cpu");
  const metricEvents = events.filter((e) => e.type === "metric");
  const metrics = metricEvents.map((e) => e.payload.metrics);
  assert.deepEqual(
    metrics.map((m) => m.epoch),
    [1, 2, 3],
  );
  assert.deepEqual(
    metrics.map((m) => m.patience_counter),
    [0, 1, 2],
  );
  assert(
    metrics.every(
      (m) =>
        Number.isFinite(m.val_loss) &&
        close(m.val_loss, metrics[0].val_loss) &&
        close(m.best_val_loss, metrics[0].val_loss),
    ),
  );
  assert.equal(events.at(-1).payload.status, "completed");
  assert.equal(events.at(-1).payload.code, 0);
  assert.equal(run.completionFlag, "Training completed via early stopping at epoch 3\n");
  assert.deepEqual(run.events, events);
  assert.deepEqual(run.consoleMetrics, metrics);
  assert.equal(run.history.length, 3);
  assert.equal(run.history.at(-1).epoch, "3");
  const config = report.evidence.authoring.request.config;
  assert.equal(config.epochs, 7);
  assert.equal(config.patience, 2);
  assert.equal(config.model, "epoch_metric_plateau");
  const modelPath = config.import_modules?.[0];
  assert.match(modelPath ?? "", /epoch_metric_plateau_model\.py$/);
  const modelSha = report.evidence.authoring.modelSha256;
  assert.equal(modelSha, report.sourcePreflight["tools/epoch_metric_plateau_model.py"]);
  assert.equal(report.evidence.importedModelPath, modelPath);
  assert.equal(report.evidence.importedModelSha256, modelSha);
  assert.equal(report.evidence.modelSha256Postflight, modelSha);
  for (const metric of metrics) {
    const meta = run.checkpointMetadata[`epoch_${metric.epoch}_checkpoint`];
    assert(meta);
    assert.equal(meta.epoch, metric.epoch);
    assert(close(meta.best_val_loss, metric.best_val_loss));
    assert.equal(meta.patience_ctr, metric.patience_counter);
  }
  assert(run.publications.length > 0);
  for (const p of run.publications) {
    assert.deepEqual(p.complete.files, p.verifiedFiles);
    assert.equal(p.complete.run_id, report.runId);
  }
  const seqs = metricEvents.map((e) => e.seq);
  assert.deepEqual(
    seqs,
    [...seqs].sort((a, b) => a - b),
  );
  assert.equal(new Set(seqs).size, seqs.length);
  assert.equal(run.projection.current.epoch, 3);
  assert.equal(run.projection.current.source_seq, seqs.at(-1));
  assert.equal(run.projection.current.patience_counter, 2);
  assert.deepEqual(
    report.observations.map((o) => o.name),
    ["first", "final"],
  );
  assert(report.observations[0].metricsText.includes("Best validation loss:"));
  assert.deepEqual(
    report.observations.map((o) => o.epoch),
    [1, 3],
  );
  assert.equal(report.observations[0].badge, "running");
  assert(report.observations[0].pairs.some(([n, v]) => n === "Patience" && v === "0 / 2"));
  assert.equal(report.observations[1].badge, "completed");
  assert(report.observations[1].pairs.some(([n, v]) => n === "Patience" && v === "2 / 2"));
  for (const o of report.observations) assert.match(o.screenshot.sha256, /^[a-f0-9]{64}$/);
  assert(report.evidence.boundary.length > 0);
  for (const row of report.evidence.boundary) {
    assert.equal(row.method, "GET");
    assert.equal(row.status, 200);
    assert.equal(row.authenticated, true);
    assert.equal(row.scoped, true);
    assert.equal(row.browser, true);
    assert.equal(hash(row.rawBody), row.bodySha256);
    const body = JSON.parse(row.rawBody);
    assert.equal(body.run_id, report.runId);
    assert.equal(body.plan_id, report.evidence.planId);
    assert.equal(body.request_id, report.evidence.requestId);
    assert.equal(body.operation, "train");
  }
  assert.deepEqual(report.evidence.mutations, []);
  assert.equal(report.evidence.process.pidAbsent, true);
  assert.equal(report.evidence.process.returncode, 0);
  assert.equal(report.evidence.process.cancelled, false);
  assert.equal(report.evidence.process.timedOut, false);
  verifyLineage(report, run, events, metrics);
  return true;
}

function verifyLineage(report, run, events, metrics) {
  const e = report.evidence;
  assert(uuid(e.planId) && uuid(e.requestId));
  for (const key of ["plans", "control", "executions", "provenance"])
    assert.equal(e[key].length, 1, `One ${key} row required`);
  const [planRow] = e.plans,
    [control] = e.control,
    [execution] = e.executions,
    [provenance] = e.provenance;
  for (const row of [planRow, control, execution, provenance]) assert.equal(row.plan_id, e.planId);
  assert.equal(planRow.request_id, e.requestId);
  const request = e.authoring.request,
    plan = JSON.parse(planRow.plan_json),
    manifest = JSON.parse(plan.manifest_json);
  assert.deepEqual(JSON.parse(planRow.request_payload_json), request);
  assert.equal(request.backend, "local");
  assert.equal(request.operation, "train");
  assert.equal(request.runtime.device, "cpu");
  assert.equal(request.runtime.mode, "existing");
  assert.deepEqual(request.topology, {
    num_machines: 1,
    processes_per_machine: 1,
    machine_rank: 0,
  });
  assert.equal(request.config.save_every, 1);
  assert.equal(request.config.cv, 0);
  assert.equal(request.config.workers, 0);
  assert.equal(request.config.precision, "no");
  assert.equal(request.config.import_modules.length, 1);
  assert.equal(plan.target, "local");
  assert.equal(plan.allocation_mode, "writer");
  assert.equal(plan.script, null);
  assert.deepEqual(plan.topology, request.topology);
  assert.equal(manifest.run_id, report.runId);
  assert.equal(manifest.operation, "train");
  assert.deepEqual(run.manifest, manifest);
  assert.deepEqual(manifest.runtime, { ...request.runtime, container: null });
  for (const [key, value] of Object.entries(request.config))
    assert.deepEqual(manifest.resolved_config[key], value);
  assert(plan.argv.includes("--cpu"));
  assert.equal(plan.argv[0], request.runtime.python);
  for (const [flag, value] of [
    ["--epochs", "7"],
    ["--patience", "2"],
    ["--model", "epoch_metric_plateau"],
    ["--import", request.config.import_modules[0]],
  ]) {
    assert.equal(plan.argv.filter((x) => x === flag).length, 1);
    assert.equal(plan.argv[plan.argv.indexOf(flag) + 1], value);
  }
  assert.equal(control.submission_requested, 1);
  assert.equal(control.cancellation_requested, 0);
  assert.equal(execution.attempt, 1);
  assert.equal(execution.cancel_delivered, 0);
  const handle = JSON.parse(execution.handle_json),
    observation = JSON.parse(execution.latest_observation_json),
    attestation = JSON.parse(handle.raw_json).runtime_attestation;
  assert.equal(handle.run_id, report.runId);
  assert.equal(handle.request_id, e.requestId);
  assert.equal(handle.attempt, 1);
  assert.equal(handle.backend, "local");
  assert.equal(handle.owner, execution.owner);
  assert.equal(handle.run_dir, manifest.run_directory);
  assert.equal(e.process.runId, report.runId);
  assert(Number.isSafeInteger(handle.pid) && handle.pid > 0);
  assert.equal(e.process.pid, handle.pid);
  assert.equal(observation.attempt, 1);
  assert.equal(observation.status, "terminal");
  assert.equal(observation.exit_code, 0);
  assert.equal(observation.signal, null);
  assert.equal(observation.batch.status, "success");
  assert.equal(observation.batch.exit_code, 0);
  for (const key of ["run_id", "request_id", "owner", "supervisor_id"])
    assert.equal(attestation[key], handle[key]);
  assert.equal(attestation.selected_python, request.runtime.python);
  assert.equal(attestation.plan_sha256, hash(planRow.plan_json));
  assert.equal(provenance.run_id, report.runId);
  assert.equal(provenance.attempt, 1);
  assert.equal(provenance.protocol_version, 1);
  assert.deepEqual(JSON.parse(provenance.event_json), events[0]);
  assert.equal(events.filter((x) => x.type === "hello").length, 1);
  assert.equal(events.filter((x) => x.type === "exit").length, 1);
  events.forEach((event, index) => {
    assert.equal(event.seq, index);
    assert.equal(event.run_id, report.runId);
    assert.equal(event.attempt, 1);
    assert.equal(event.protocol, "wavedl-jsonl");
    assert.equal(event.version, 1);
    assert(Number.isFinite(Date.parse(event.ts)));
    if (index) assert(Date.parse(event.ts) >= Date.parse(events[index - 1].ts));
  });
  assert.equal(events[0].payload.interpreter, request.runtime.python);
  assert.deepEqual(events[0].payload.allocated_devices, []);
  for (const key of ["interpreter", "prefix", "base_prefix"])
    assert.equal(attestation.identity[key], events[0].payload[key]);
  assert.equal(events.at(-1).type, "exit");
  assert.equal(events.at(-2).type, "state");
  assert.equal(events.at(-2).payload.state, "completed");
  assert.equal(run.state, "completed");
  assert.equal(run.attempt, 1);
  assert(sha(run.runtimeJournalSha256));
  assert.equal(hash(run.runtimeJournalRaw), run.runtimeJournalSha256);
  assert.equal(run.files["attempts/1/events.jsonl"].sha256, run.runtimeJournalSha256);
  assert.equal(run.files["attempts/1/events.jsonl"].size, Buffer.byteLength(run.runtimeJournalRaw));
  assert.deepEqual(
    run.runtimeJournalRaw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
    events,
  );
  const stdoutMetrics = e.process.stdout
    .split(/\r?\n/)
    .filter((x) => x.startsWith("##METRICS##"))
    .map((x) => JSON.parse(x.slice(11)));
  assert.deepEqual(stdoutMetrics, metrics);
  assert(
    e.process.stdout.includes(`Imported custom module from: ${request.config.import_modules[0]}`),
  );
  assert(e.process.stderr.includes("Early stopping at epoch 3 (patience=2)"));
  const metricEvents = events.filter((x) => x.type === "metric");
  metrics.forEach((metric, index) => {
    for (const key of [
      "train_loss",
      "val_loss",
      "best_val_loss",
      "r2",
      "pearson",
      "grad_norm",
      "lr",
      "mae_avg",
      "epoch_time",
      "total_time",
    ])
      assert(typeof metric[key] === "number" && Number.isFinite(metric[key]));
    assert.equal(metric.total_epochs, 7);
    assert.equal(metric.max_patience, 2);
    assert(metric.epoch_time > 0 && metric.total_time >= metric.epoch_time);
    if (index) assert(metric.total_time > metrics[index - 1].total_time);
    assert.equal(metricEvents[index].payload.name, "epoch");
    assert.equal(metricEvents[index].payload.step, metric.epoch);
    assert.equal(metricEvents[index].payload.value, metric.val_loss);
    const history = run.history[index];
    assert.equal(history.epoch, String(metric.epoch));
    for (const [field, key] of [
      ["train_loss", "train_loss"],
      ["val_loss", "val_loss"],
      ["val_r2", "r2"],
      ["val_pearson", "pearson"],
      ["grad_norm", "grad_norm"],
      ["lr", "lr"],
      ["epoch_time", "epoch_time"],
      ["total_time", "total_time"],
    ])
      assert(close(history[field], metric[key]));
    assert(Math.abs(Number(history.val_mae_avg) - metric.mae_avg) <= 1e-7);
    assert.deepEqual(run.projection.rows[index], [
      metricEvents[index].seq,
      run.projection.rows[index][1],
    ]);
    assert.deepEqual(JSON.parse(run.projection.rows[index][1]), metric);
  });
  assert.equal(run.projection.rows.length, 3);
  assert.deepEqual(run.projection.current, { ...metrics[2], source_seq: metricEvents[2].seq });
  assert.deepEqual(Object.keys(run.checkpointMetadata).sort(), [
    "best_checkpoint",
    "epoch_1_checkpoint",
    "epoch_2_checkpoint",
    "epoch_3_checkpoint",
  ]);
  assert.deepEqual(
    run.checkpointMetadata.best_checkpoint,
    run.checkpointMetadata.epoch_1_checkpoint,
  );
  assert.equal(run.publications.length, 4);
  assert.equal(events.filter((x) => x.type === "artifact").length, 4);
  run.publications.forEach((publication, index) => {
    const artifact = events.filter((x) => x.type === "artifact")[index];
    assert.equal(publication.generation, `gen-${String(index + 1).padStart(6, "0")}`);
    assert.equal(publication.complete.generation, publication.generation);
    assert.equal(publication.complete.schema_version, 1);
    assert.equal(publication.complete.attempt, 1);
    assert.equal(publication.complete.step, [1, 1, 2, 3][index]);
    assert(sha(publication.complete.manifest_sha256));
    assert.equal(publication.complete.manifest_sha256, run.files["manifest.json"].sha256);
    assert.equal(
      run.files[`checkpoints/${publication.generation}/COMPLETE.json`].sha256,
      publication.completeSha256,
    );
    for (const [name, file] of Object.entries(publication.complete.files)) {
      assert(
        name &&
          !name.startsWith("/") &&
          name.split("/").every((segment) => segment && segment !== "." && segment !== ".."),
      );
      assert.deepEqual(run.files[`checkpoints/${publication.generation}/${name}`], file);
    }
    assert.equal(artifact.payload.generation, publication.generation);
    assert.equal(artifact.payload.sha256, publication.completeSha256);
    assert.equal(artifact.payload.step, publication.complete.step);
    assert.equal(artifact.payload.path, `checkpoints/${publication.generation}/COMPLETE.json`);
    assert.equal(publication.selectionMetadata.schema_version, 1);
    assert.equal(publication.selectionMetadata.kind, index === 0 ? "best" : "periodic");
    assert.equal(publication.selectionMetadata.source_seq, artifact.seq - 1);
    assert.deepEqual(
      publication.trainingMetadata,
      run.checkpointMetadata[`epoch_${publication.complete.step}_checkpoint`],
    );
    for (const key of [
      "training_meta.pkl",
      "checkpoint_selection.json",
      "training_history.csv",
      "pytorch_model.bin",
    ])
      assert(publication.verifiedFiles[key]);
    for (const file of Object.values(publication.verifiedFiles))
      assert(sha(file.sha256) && Number.isSafeInteger(file.size) && file.size > 0);
  });
  const bodies = e.boundary.map((row) => {
    assert.equal(row.path, `/api/runs/${report.runId}`);
    const body = JSON.parse(row.rawBody);
    assert.equal(body.backend, "local");
    assert.equal(body.attempt, 1);
    assert.equal(body.cancellation_requested, false);
    assert.equal(body.submission_requested, true);
    assert.equal(row.bodyBytes, Buffer.byteLength(row.rawBody));
    assert(Number.isSafeInteger(row.atMs));
    assert(row.atMs >= Date.parse(report.startedAt) && row.atMs <= Date.parse(report.finishedAt));
    assert.equal(body.evidence.runtime.conflicting_exits, false);
    return body;
  });
  assert(bodies.some((x) => x.state === "running"));
  const final = bodies.at(-1);
  assert.equal(final.state, "completed");
  assert.equal(final.uncertainty, false);
  assert.equal(final.evidence.confidence, "confirmed");
  assert.equal(final.evidence.runtime.hello_seen, true);
  assert.equal(final.evidence.backend.status, "terminal");
  assert.equal(final.evidence.backend.exit_code, 0);
  assert.equal(final.evidence.backend.signal, null);
  assert.equal(final.evidence.runtime.exit_seq, events.at(-1).seq);
  assert.equal(final.evidence.runtime.outcome.status, "success");
  assert.equal(final.evidence.runtime.outcome.exit_code, 0);
  report.observations.forEach((o, index) => {
    const metric = metrics[index === 0 ? 0 : 2];
    assert.equal(o.runId, report.runId);
    assert.equal(o.screenshotObservation.runId, o.runId);
    assert.equal(o.screenshotObservation.epoch, o.epoch);
    assert.equal(o.screenshotObservation.badge, o.badge);
    assert(
      Number.isSafeInteger(o.screenshotObservation.atMs) &&
        o.screenshotObservation.atMs >= o.atMs &&
        o.screenshotObservation.atMs <= Date.parse(report.finishedAt),
    );
    assert(
      Number.isSafeInteger(o.atMs) &&
        o.atMs >= Date.parse(report.startedAt) &&
        o.atMs <= Date.parse(report.finishedAt),
    );
    if (index) assert(o.atMs > report.observations[0].atMs);
    assert(o.metricsText.includes(`Epoch ${metric.epoch} / 7`));
    assert(o.metricsText.includes(`Best validation loss: ${metric.best_val_loss}`));
    assert(o.diagnostics.includes("hello:") && o.diagnostics.includes('"device":"cpu"'));
    for (const [label, key] of [
      ["Training loss", "train_loss"],
      ["Validation loss", "val_loss"],
      ["R²", "r2"],
      ["Learning rate", "lr"],
      ["Pearson", "pearson"],
      ["Gradient norm", "grad_norm"],
      ["MAE average", "mae_avg"],
    ]) {
      const pairs = o.pairs.filter(([name]) => name === label);
      assert.equal(pairs.length, 1);
      assert.equal(pairs[0][1], String(metric[key]));
    }
  });
}

/** Read-only guard: producer assertions are not independent browser proof. */
export async function verifyEpochMetricBrowserFile(path) {
  path = resolve(path);
  const report = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(await boundedFile(path)),
  );
  verifyEpochMetricBrowserReport(report);
  assert.equal(
    report.evidence.importedModelPath,
    join(repository, "tools/epoch_metric_plateau_model.py"),
  );
  assert.deepEqual(
    report.sourcePreflight,
    await epochSourceFingerprint(),
    "Current full source inventory differs",
  );
  assert.equal(report.assetPreflight.manifestSha256, await currentAssetDigest());
  const manifest = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      await boundedFile(join(repository, "src/wavedl_daemon/web_assets/.wavedl-assets.json")),
    ),
  );
  assert.deepEqual(report.assetPreflight.assets, manifest, "Full current asset inventory required");
  for (const observation of report.observations) {
    assert.equal(
      observation.screenshot.path,
      `${path}.${observation.name}.png`,
      "Screenshot must be report-owned neighbor",
    );
    const bytes = await boundedFile(observation.screenshot.path, 8 * 1024 * 1024);
    assert(
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      "Real PNG screenshot required",
    );
    assert(
      bytes.length > 32 && bytes.toString("ascii", 12, 16) === "IHDR",
      "PNG image header required",
    );
    assert.equal(hash(bytes), observation.screenshot.sha256);
    verifyEpochScreenshotPng(bytes);
  }
  return report;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Narrow Chrome screenshot PNG contract, bounded before decompression. */
export function verifyEpochScreenshotPng(bytes) {
  assert(bytes.length >= 45 && bytes.length <= 8 * 1024 * 1024);
  assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  let offset = 8,
    channels,
    idatEnded = false,
    sawIend = false;
  const idat = [];
  while (offset < bytes.length) {
    assert(offset + 12 <= bytes.length, "Truncated PNG chunk");
    const length = bytes.readUInt32BE(offset),
      type = bytes.toString("ascii", offset + 4, offset + 8),
      end = offset + 12 + length;
    assert(end <= bytes.length, "Truncated PNG payload");
    assert.match(type, /^[A-Za-z]{4}$/);
    assert.equal(
      crc32(bytes.subarray(offset + 4, end - 4)),
      bytes.readUInt32BE(end - 4),
      "PNG CRC mismatch",
    );
    const data = bytes.subarray(offset + 8, end - 4);
    if (offset === 8) {
      assert.equal(type, "IHDR");
      assert.equal(length, 13);
      assert.equal(data.readUInt32BE(0), 1280);
      assert.equal(data.readUInt32BE(4), 900);
      assert.equal(data[8], 8);
      assert([2, 6].includes(data[9]));
      channels = data[9] === 2 ? 3 : 4;
      assert.equal(data[10], 0);
      assert.equal(data[11], 0);
      assert.equal(data[12], 0);
    } else if (type === "IDAT") {
      assert(!idatEnded);
      idat.push(data);
    } else {
      if (idat.length) idatEnded = true;
      assert(type !== "IHDR");
      if (type === "IEND") {
        assert.equal(length, 0);
        assert.equal(end, bytes.length);
        sawIend = true;
        break;
      }
      assert(type[0] === type[0].toLowerCase(), "Unexpected critical PNG chunk");
    }
    offset = end;
  }
  assert(sawIend && channels && idat.length);
  const stride = 1280 * channels + 1,
    expected = stride * 900;
  const result = inflateSync(Buffer.concat(idat), { maxOutputLength: expected, info: true });
  assert.equal(
    result.engine.bytesWritten,
    Buffer.concat(idat).length,
    "Trailing compressed PNG data",
  );
  assert.equal(result.buffer.length, expected, "PNG scanline size mismatch");
  for (let row = 0; row < 900; row++)
    assert(result.buffer[row * stride] <= 4, "Invalid PNG row filter");
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await verifyEpochMetricBrowserFile(process.argv[2]);
  console.log("Epoch metric browser report verified");
}
