import test from "node:test";
import assert from "node:assert/strict";
import { verifyEpochMetricBrowserReport } from "./verify_epoch_metric_browser_report.mjs";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { mkdtemp, realpath, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  verifyEpochMetricBrowserFile,
  epochSourceFingerprint,
  verifyEpochScreenshotPng,
  requireEpochOutputsAbsent,
} from "./verify_epoch_metric_browser_report.mjs";
import { currentAssetDigest } from "./verify_adoption_negative_browser_report.mjs";
import { boundedFile } from "./browser_files.mjs";
import { fileURLToPath } from "node:url";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const digest = "a".repeat(64);
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length, 0);
  bytes.write(type, 4);
  data.copy(bytes, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, bytes.length - 4)), bytes.length - 4);
  return bytes;
}
function screenshotPng({ width = 1280, height = 900, compressed, filter = 0 } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let row = 0; row < height; row++) raw[row * (width * 3 + 1)] = filter;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", compressed ?? deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
test("bounded Chrome PNG decoder validates pixels, chunks, CRC and dimensions", () => {
  const png = screenshotPng();
  assert.equal(verifyEpochScreenshotPng(png), true);
  for (const invalid of [
    png.subarray(0, png.length - 1),
    Buffer.concat([png, Buffer.from([1])]),
    screenshotPng({ width: 1 }),
    screenshotPng({ height: 1 }),
    screenshotPng({ filter: 5 }),
    screenshotPng({ compressed: Buffer.from("not zlib") }),
    screenshotPng({ compressed: deflateSync(Buffer.alloc(1)) }),
    screenshotPng({ compressed: deflateSync(Buffer.alloc(1280 * 900 * 4 + 900)) }),
  ])
    assert.throws(() => verifyEpochScreenshotPng(invalid));
  const badCrc = Buffer.from(png);
  badCrc[30] ^= 1;
  assert.throws(() => verifyEpochScreenshotPng(badCrc));
});

test("exclusive output preflight refuses existing report, screenshots, broken symlink and relative path", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "epoch-exclusive-"));
  try {
    const path = join(root, "report.json");
    await requireEpochOutputsAbsent(path);
    await assert.rejects(requireEpochOutputsAbsent("report.json"));
    for (const candidate of [path, `${path}.first.png`, `${path}.final.png`]) {
      await writeFile(candidate, "owned test");
      await assert.rejects(requireEpochOutputsAbsent(path));
      await rm(candidate);
    }
    await symlink(join(root, "missing"), `${path}.first.png`);
    await assert.rejects(requireEpochOutputsAbsent(path));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
const runId = "11111111-1111-4111-8111-111111111111",
  planId = "22222222-2222-4222-8222-222222222222",
  requestId = "33333333-3333-4333-8333-333333333333";

// Portable synthetic contract data, never browser acceptance evidence.
export function contractReport(modelPath = "/owned/epoch_metric_plateau_model.py") {
  const config = {
    epochs: 7,
    patience: 2,
    model: "epoch_metric_plateau",
    import_modules: [modelPath],
    save_every: 1,
    cv: 0,
    workers: 0,
    precision: "no",
  };
  const runtime = { python: "/owned/python", device: "cpu", mode: "existing" },
    topology = { num_machines: 1, processes_per_machine: 1, machine_rank: 0 };
  const request = { backend: "local", operation: "train", config, runtime, topology };
  const manifest = {
    run_id: runId,
    operation: "train",
    runtime: { ...runtime, container: null },
    resolved_config: config,
    run_directory: "/owned/run",
  };
  const plan = {
    target: "local",
    allocation_mode: "writer",
    script: null,
    topology,
    manifest_json: JSON.stringify(manifest),
    argv: [
      runtime.python,
      "--cpu",
      "--epochs",
      "7",
      "--patience",
      "2",
      "--model",
      config.model,
      "--import",
      config.import_modules[0],
    ],
  };
  const metrics = [1, 2, 3].map((epoch) => ({
    epoch,
    total_epochs: 7,
    patience_counter: epoch - 1,
    max_patience: 2,
    train_loss: 1,
    val_loss: 0.9,
    best_val_loss: 0.9,
    r2: 0,
    pearson: 0,
    grad_norm: 0,
    lr: 0.001,
    mae_avg: 0.1,
    mae_per_param: [0.1],
    epoch_time: 1,
    total_time: epoch,
  }));
  const events = [],
    publications = [],
    metadata = {},
    rows = [];
  const add = (type, payload) =>
    events.push({
      run_id: runId,
      attempt: 1,
      seq: events.length,
      type,
      payload,
      protocol: "wavedl-jsonl",
      version: 1,
      ts: "2026-01-01T00:00:01Z",
    });
  add("hello", {
    device: "cpu",
    allocated_devices: [],
    interpreter: runtime.python,
    prefix: "/owned",
    base_prefix: "/base",
  });
  add("state", { state: "running" });
  metrics.forEach((metric, index) => {
    add("metric", { name: "epoch", step: metric.epoch, value: metric.val_loss, metrics: metric });
    rows.push([events.at(-1).seq, JSON.stringify(metric)]);
    metadata[`epoch_${metric.epoch}_checkpoint`] = {
      epoch: metric.epoch,
      best_val_loss: metric.best_val_loss,
      patience_ctr: metric.patience_counter,
    };
    for (let repetition = 0; repetition < (index === 0 ? 2 : 1); repetition++) {
      const generation = `gen-${String(publications.length + 1).padStart(6, "0")}`;
      const files = Object.fromEntries(
        [
          "training_meta.pkl",
          "checkpoint_selection.json",
          "training_history.csv",
          "pytorch_model.bin",
        ].map((name) => [name, { sha256: digest, size: 10 }]),
      );
      const complete = {
        run_id: runId,
        attempt: 1,
        schema_version: 1,
        generation,
        step: metric.epoch,
        files,
        manifest_sha256: digest,
      };
      publications.push({
        generation,
        complete,
        completeSha256: digest,
        verifiedFiles: files,
        selectionMetadata: {
          schema_version: 1,
          kind: publications.length === 0 ? "best" : "periodic",
          source_seq: events.at(-1).seq,
        },
        trainingMetadata: metadata[`epoch_${metric.epoch}_checkpoint`],
      });
      add("artifact", {
        generation,
        path: `checkpoints/${generation}/COMPLETE.json`,
        sha256: digest,
        step: metric.epoch,
      });
    }
  });
  metadata.best_checkpoint = metadata.epoch_1_checkpoint;
  add("state", { state: "completed" });
  add("exit", { code: 0, status: "completed" });
  const observation = {
    attempt: 1,
    status: "terminal",
    exit_code: 0,
    signal: null,
    batch: { status: "success", exit_code: 0 },
  };
  const handle = {
    run_id: runId,
    request_id: requestId,
    attempt: 1,
    backend: "local",
    owner: "owner",
    supervisor_id: "supervisor",
    pid: 12345,
    run_dir: manifest.run_directory,
  };
  handle.raw_json = JSON.stringify({
    runtime_attestation: {
      run_id: runId,
      request_id: requestId,
      owner: handle.owner,
      supervisor_id: handle.supervisor_id,
      selected_python: runtime.python,
      plan_sha256: hash(JSON.stringify(plan)),
      identity: { interpreter: runtime.python, prefix: "/owned", base_prefix: "/base" },
    },
  });
  const run = {
    run_id: runId,
    state: "completed",
    attempt: 1,
    runtimeEvents: events,
    consoleMetrics: metrics,
    checkpointMetadata: metadata,
    completionFlag: "Training completed via early stopping at epoch 3\n",
    publications,
    manifest,
    projection: { current: { ...metrics[2], source_seq: rows[2][0] }, rows },
    history: metrics.map((m) => ({
      epoch: String(m.epoch),
      train_loss: "1",
      val_loss: "0.9",
      val_r2: "0",
      val_pearson: "0",
      val_mae_avg: "0.1",
      grad_norm: "0",
      lr: "0.001",
      epoch_time: "1",
      total_time: String(m.epoch),
    })),
  };
  run.runtimeJournalRaw = events.map((x) => JSON.stringify(x)).join("\n") + "\n";
  run.runtimeJournalSha256 = hash(run.runtimeJournalRaw);
  run.events = structuredClone(events);
  run.files = {
    "manifest.json": { sha256: digest, size: 100 },
    "attempts/1/events.jsonl": {
      sha256: run.runtimeJournalSha256,
      size: Buffer.byteLength(run.runtimeJournalRaw),
    },
  };
  for (const publication of publications) {
    run.files[`checkpoints/${publication.generation}/COMPLETE.json`] = {
      sha256: publication.completeSha256,
      size: 100,
    };
    for (const [name, file] of Object.entries(publication.complete.files))
      run.files[`checkpoints/${publication.generation}/${name}`] = structuredClone(file);
  }
  const evidence = {
    runs: [run],
    plans: [
      {
        plan_id: planId,
        request_id: requestId,
        request_payload_json: JSON.stringify(request),
        plan_json: JSON.stringify(plan),
      },
    ],
    control: [{ plan_id: planId, submission_requested: 1, cancellation_requested: 0 }],
    executions: [
      {
        plan_id: planId,
        attempt: 1,
        cancel_delivered: 0,
        owner: handle.owner,
        handle_json: JSON.stringify(handle),
        latest_observation_json: JSON.stringify(observation),
      },
    ],
    provenance: [
      {
        plan_id: planId,
        run_id: runId,
        attempt: 1,
        protocol_version: 1,
        event_json: JSON.stringify(events[0]),
      },
    ],
    authoring: { request, modelSha256: digest },
    planId,
    requestId,
    importedModelPath: config.import_modules[0],
    importedModelSha256: digest,
    modelSha256Postflight: digest,
    mutations: [],
    process: {
      runId,
      pid: 12345,
      pidAbsent: true,
      returncode: 0,
      cancelled: false,
      timedOut: false,
      stdout:
        `Imported custom module from: ${config.import_modules[0]}\n` +
        metrics.map((m) => "##METRICS##" + JSON.stringify(m)).join("\n"),
      stderr: "Early stopping at epoch 3 (patience=2)",
    },
  };
  evidence.boundary = ["running", "completed"].map((state) => {
    const body = {
      run_id: runId,
      request_id: requestId,
      plan_id: planId,
      operation: "train",
      backend: "local",
      attempt: 1,
      state,
      uncertainty: false,
      submission_requested: true,
      cancellation_requested: false,
      evidence: {
        confidence: "confirmed",
        runtime: {
          hello_seen: true,
          conflicting_exits: false,
          exit_seq: events.at(-1).seq,
          outcome: { status: "success", exit_code: 0 },
        },
        backend: observation,
      },
    };
    const rawBody = JSON.stringify(body);
    return {
      path: `/api/runs/${runId}`,
      method: "GET",
      status: 200,
      authenticated: true,
      scoped: true,
      browser: true,
      rawBody,
      bodySha256: hash(rawBody),
      bodyBytes: Buffer.byteLength(rawBody),
      atMs: Date.parse("2026-01-01T00:00:02Z"),
    };
  });
  const observations = [metrics[0], metrics[2]].map((metric, index) => ({
    name: index ? "final" : "first",
    runId,
    epoch: metric.epoch,
    badge: index ? "completed" : "running",
    screenshotObservation: {
      runId,
      epoch: metric.epoch,
      badge: index ? "completed" : "running",
      atMs: Date.parse("2026-01-01T00:00:02Z") + index,
    },
    metricsText: `Epoch ${metric.epoch} / 7\nBest validation loss: ${metric.best_val_loss}`,
    diagnostics: 'hello: {"device":"cpu"}',
    atMs: Date.parse("2026-01-01T00:00:02Z") + index,
    pairs: [
      ["Training loss", "1"],
      ["Validation loss", "0.9"],
      ["R²", "0"],
      ["Learning rate", "0.001"],
      ["Pearson", "0"],
      ["Gradient norm", "0"],
      ["MAE average", "0.1"],
      ["Patience", `${metric.patience_counter} / 2`],
    ],
    screenshot: { path: "/owned/report.png", sha256: digest },
  }));
  const sources = { "tools/epoch_metric_plateau_model.py": digest },
    assets = {
      manifestSha256: digest,
      assets: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`asset${i}`, digest])),
    };
  return {
    status: "passed",
    scope: "real-cpu-epoch-metric-packaged-browser",
    limitation: "stationary custom CPU model",
    sourcePreflight: sources,
    sourcePostflight: sources,
    assetPreflight: assets,
    assetPostflight: assets,
    runId,
    evidence,
    observations,
    browserRuntime: {
      engine: "chrome",
      userAgent: "Chrome/100",
      viewport: { width: 1280, height: 900 },
    },
    browserVersion: "agent-browser 0.26.0",
    browserSession: "epoch-1234",
    browserSessionsAfter: [],
    browserErrors: [],
    profileInitiallyEmpty: true,
    startedAt: "2026-01-01T00:00:00Z",
    finishedAt: "2026-01-01T00:00:04Z",
    cleanup: {
      browserClosed: true,
      browserSessionAbsent: true,
      profileRemoved: true,
      fixtureReaped: true,
      servicesClosed: true,
      listenerClosed: true,
      ownedRootsRemoved: true,
    },
  };
}

test("portable synthetic positive contract", () =>
  assert.equal(verifyEpochMetricBrowserReport(contractReport()), true));

const mutations = {
  browserSessionStillOpen: (r) => r.browserSessionsAfter.push(r.browserSession),
  browserSessionProofMissing: (r) => delete r.browserSessionsAfter,
  browserSessionProofInvalid: (r) => r.browserSessionsAfter.push({ session: r.browserSession }),
  passedError: (r) => (r.error = "unexpected"),
  retainedWorkspace: (r) => (r.retainedWorkspace = "/owned"),
  ingestedEvents: (r) => r.evidence.runs[0].events.pop(),
  journalInventory: (r) => (r.evidence.runs[0].files["attempts/1/events.jsonl"].sha256 = digest),
  manifestInventory: (r) => (r.evidence.runs[0].files["manifest.json"].sha256 = "b".repeat(64)),
  completeInventory: (r) =>
    (r.evidence.runs[0].files["checkpoints/gen-000001/COMPLETE.json"].sha256 = "b".repeat(64)),
  checkpointInventory: (r) =>
    (r.evidence.runs[0].files["checkpoints/gen-000001/training_meta.pkl"].sha256 = "b".repeat(64)),
  postScreenshotEpoch: (r) => (r.observations[0].screenshotObservation.epoch = 2),
  postScreenshotBadge: (r) => (r.observations[0].screenshotObservation.badge = "completed"),
  postScreenshotRun: (r) => (r.observations[0].screenshotObservation.runId = requestId),
  postScreenshotTime: (r) => (r.observations[0].screenshotObservation.atMs = 1),
  scope: (r) => (r.scope = "fixture"),
  status: (r) => (r.status = "failed"),
  chrome: (r) => (r.browserRuntime.userAgent = "Firefox"),
  viewport: (r) => (r.browserRuntime.viewport.width = 1),
  version: (r) => (r.browserVersion = "agent-browser 0.25.0"),
  profile: (r) => (r.profileInitiallyEmpty = false),
  cleanup: (r) => (r.cleanup.browserSessionAbsent = false),
  browserErrors: (r) => r.browserErrors.push("error"),
  timestamps: (r) => (r.finishedAt = r.startedAt),
  session: (r) => (r.browserSession = "other"),
  duplicateRun: (r) => r.evidence.runs.push(r.evidence.runs[0]),
  runId: (r) => (r.runId = requestId),
  duplicatePlan: (r) => r.evidence.plans.push(r.evidence.plans[0]),
  planId: (r) => (r.evidence.plans[0].plan_id = requestId),
  requestId: (r) => (r.evidence.plans[0].request_id = planId),
  cancellation: (r) => (r.evidence.control[0].cancellation_requested = 1),
  delivery: (r) => (r.evidence.executions[0].cancel_delivered = 1),
  attempt: (r) => (r.evidence.executions[0].attempt = 2),
  pid: (r) => r.evidence.process.pid++,
  alive: (r) => (r.evidence.process.pidAbsent = false),
  exit: (r) => (r.evidence.process.returncode = 1),
  timeout: (r) => (r.evidence.process.timedOut = true),
  epochs: (r) => (r.evidence.authoring.request.config.epochs = 3),
  model: (r) => (r.evidence.importedModelSha256 = "b".repeat(64)),
  sequence: (r) => (r.evidence.runs[0].runtimeEvents[1].seq = 99),
  provenance: (r) => (r.evidence.provenance[0].event_json = "{}"),
  journal: (r) => (r.evidence.runs[0].runtimeJournalRaw += "{}\n"),
  console: (r) => (r.evidence.process.stdout = ""),
  history: (r) => (r.evidence.runs[0].history[1].val_loss = "7"),
  metadata: (r) => (r.evidence.runs[0].checkpointMetadata.epoch_2_checkpoint.patience_ctr = 9),
  projection: (r) => (r.evidence.runs[0].projection.current.source_seq = 99),
  publication: (r) => (r.evidence.runs[0].publications[0].complete.attempt = 2),
  selection: (r) => (r.evidence.runs[0].publications[0].selectionMetadata.source_seq = 99),
  finalBadge: (r) => (r.observations[1].badge = "running"),
  firstEpoch: (r) => (r.observations[0].epoch = 3),
  visibleLoss: (r) => (r.observations[0].pairs[1][1] = "8"),
  screenshot: (r) => (r.observations[0].screenshot.sha256 = "invalid"),
  rawHash: (r) => (r.evidence.boundary[0].bodySha256 = digest),
  rawBytes: (r) => r.evidence.boundary[0].bodyBytes++,
  path: (r) => (r.evidence.boundary[0].path = "/api/runs/other"),
  boundaryAuth: (r) => (r.evidence.boundary[0].authenticated = false),
  sourceMutation: (r) => (r.sourcePostflight = {}),
  assetMutation: (r) => (r.assetPostflight = {}),
};
for (const [name, mutate] of Object.entries(mutations))
  test(`independently rejects ${name}`, () => {
    const report = structuredClone(contractReport());
    mutate(report);
    assert.throws(() => verifyEpochMetricBrowserReport(report));
  });

test("strict bounded file rejects malformed UTF8, symlink, oversized and directory", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "epoch-guard-"));
  try {
    const path = join(root, "report.json");
    await writeFile(path, Buffer.from([0xff]));
    await assert.rejects(verifyEpochMetricBrowserFile(path));
    await writeFile(path, "{}");
    await symlink(path, join(root, "link.json"));
    await assert.rejects(verifyEpochMetricBrowserFile(join(root, "link.json")));
    await writeFile(path, Buffer.alloc(2 * 1024 * 1024 + 1));
    await assert.rejects(verifyEpochMetricBrowserFile(path));
    await assert.rejects(verifyEpochMetricBrowserFile(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("file gate binds full current sources, assets and report-owned screenshot bytes", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "epoch-current-"));
  try {
    const repo = fileURLToPath(new URL("../", import.meta.url));
    const report = contractReport(join(repo, "tools/epoch_metric_plateau_model.py"));
    const sources = await epochSourceFingerprint();
    report.sourcePreflight = sources;
    report.sourcePostflight = structuredClone(sources);
    const modelHash = sources["tools/epoch_metric_plateau_model.py"];
    report.evidence.authoring.modelSha256 = modelHash;
    report.evidence.importedModelSha256 = modelHash;
    report.evidence.modelSha256Postflight = modelHash;
    const assets = {
      manifestSha256: await currentAssetDigest(),
      assets: JSON.parse(
        await boundedFile(join(repo, "src/wavedl_daemon/web_assets/.wavedl-assets.json")),
      ),
    };
    report.assetPreflight = assets;
    report.assetPostflight = structuredClone(assets);
    const path = join(root, "report.json");
    const png = screenshotPng();
    for (const o of report.observations) {
      o.screenshot = { path: `${path}.${o.name}.png`, sha256: hash(png) };
      await writeFile(o.screenshot.path, png);
    }
    await writeFile(path, JSON.stringify(report));
    await verifyEpochMetricBrowserFile(path);
    const cases = {
      omittedSource: (r) => {
        delete r.sourcePreflight["src/wavedl/train.py"];
        delete r.sourcePostflight["src/wavedl/train.py"];
      },
      staleSource: (r) => {
        r.sourcePreflight["src/wavedl/train.py"] = digest;
        r.sourcePostflight["src/wavedl/train.py"] = digest;
      },
      extraSource: (r) => {
        r.sourcePreflight["../outside"] = digest;
        r.sourcePostflight["../outside"] = digest;
      },
      staleAssets: (r) => {
        r.assetPreflight.manifestSha256 = digest;
        r.assetPostflight.manifestSha256 = digest;
      },
      omittedAsset: (r) => {
        delete r.assetPreflight.assets["index.html"];
        delete r.assetPostflight.assets["index.html"];
      },
      neighbor: (r) => (r.observations[0].screenshot.path = `${path}.final.png`),
      screenshotHash: (r) => (r.observations[0].screenshot.sha256 = digest),
    };
    for (const mutate of Object.values(cases)) {
      const changed = structuredClone(report);
      mutate(changed);
      await writeFile(path, JSON.stringify(changed));
      await assert.rejects(verifyEpochMetricBrowserFile(path));
    }
    await writeFile(path, JSON.stringify(report));
    await writeFile(report.observations[0].screenshot.path, "not png");
    await assert.rejects(verifyEpochMetricBrowserFile(path));
    await rm(report.observations[0].screenshot.path);
    await symlink(report.observations[1].screenshot.path, report.observations[0].screenshot.path);
    await assert.rejects(verifyEpochMetricBrowserFile(path));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects incomplete epoch evidence", () => {
  assert.throws(() =>
    verifyEpochMetricBrowserReport({
      status: "passed",
      scope: "real-cpu-epoch-metric-packaged-browser",
    }),
  );
});

test("rejects non-Chrome runtime", () => {
  const report = {
    status: "passed",
    scope: "real-cpu-epoch-metric-packaged-browser",
    limitation: "stationary custom CPU model",
    sourcePreflight: {},
    sourcePostflight: {},
    assetPreflight: {
      manifestSha256: "a".repeat(64),
      assets: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [i, "b".repeat(64)])),
    },
    assetPostflight: {
      manifestSha256: "a".repeat(64),
      assets: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [i, "b".repeat(64)])),
    },
    browserRuntime: {
      userAgent: "Firefox",
      engine: "chrome",
      viewport: { width: 100, height: 100 },
    },
    cleanup: {},
  };
  assert.throws(() => verifyEpochMetricBrowserReport(report));
});
