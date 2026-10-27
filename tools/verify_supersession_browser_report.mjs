#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { boundedFile } from "./browser_files.mjs";
import { pathToFileURL } from "node:url";
import { currentAssetDigest } from "./verify_adoption_negative_browser_report.mjs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function verifySupersessionReport(report) {
  assert(report && typeof report === "object" && !Array.isArray(report));
  assert.equal(report.name, "supersession-browser");
  assert.equal(report.status, "passed");
  for (const key of ["error", "skip", "skipped", "skipReason"]) assert(!Object.hasOwn(report, key));
  assert.equal(report.scope, "genuine-cpu-staged-public-supersession");
  assert.equal(
    report.limitation,
    "Genuine CPU checkpoint-resume journals staged through public adoption and pass-through daemon SSE into Chrome DOM/canvas only; not live Slurm requeue, native process restart, or full T35 certification.",
  );
  assert.equal(report.initialProfileEmpty, true);
  assert.equal(
    report.driverReadinessMode,
    "sync-exposure-poll-and-two-controller-dom-observations",
  );
  assert.deepEqual(report.browserRuntime, {
    userAgent: report.browserRuntime.userAgent,
    width: 1280,
    height: 900,
    cookies: "",
    localStorageKeys: [],
    sessionStorageKeys: [],
  });
  assert.match(report.browserRuntime.userAgent, /Chrome\/[0-9]+/);
  assert.deepEqual(report.browserProof, {
    publicAdoption: true,
    nativeActions: true,
    domOnlyObservation: true,
    noPrivateInjection: true,
  });
  assert.match(report.assetManifestSha256, /^[a-f0-9]{64}$/);
  assert.equal(report.assetManifestSha256After, report.assetManifestSha256);
  assert(report.assetInventory && Object.keys(report.assetInventory).length > 0);
  assert.deepEqual(report.assetInventoryAfter, report.assetInventory);
  for (const value of Object.values(report.assetInventory)) assert.match(value, /^[a-f0-9]{64}$/);
  assert(uuid.test(report.runId));
  assert.deepEqual(report.observations.restored?.lineage, { attempt: 2, steps: 1 });
  assert.deepEqual(report.observations.firstCurrent?.lineage, { attempt: 2, steps: 2 });
  assert.deepEqual(report.observations.complete?.lineage, { attempt: 2, steps: 3 });
  assert.deepEqual(Object.keys(report.observations).sort(), [
    "complete",
    "firstCurrent",
    "restored",
  ]);
  for (const observation of Object.values(report.observations)) {
    assert(
      observation.canvas &&
        Number.isSafeInteger(observation.canvasWidth) &&
        observation.canvasWidth > 0 &&
        observation.canvasWidth <= 8192 &&
        Number.isSafeInteger(observation.canvasHeight) &&
        observation.canvasHeight > 0 &&
        observation.canvasHeight <= 8192,
    );
    assert(
      Number.isSafeInteger(observation.paintedPixels) &&
        observation.paintedPixels > 0 &&
        observation.paintedPixels <= observation.canvasWidth * observation.canvasHeight,
    );
    assert(
      Number.isSafeInteger(observation.paintHash) &&
        observation.paintHash > 0 &&
        observation.paintHash <= 2 ** 32 - 1,
    );
    assert(typeof observation.summary === "string" && typeof observation.text === "string");
    assert(observation.values && typeof observation.values === "object");
  }
  assert.notEqual(report.observations.restored.paintHash, report.observations.complete.paintHash);
  assert.notEqual(
    report.observations.restored.paintHash,
    report.observations.firstCurrent.paintHash,
  );
  assert.notEqual(
    report.observations.firstCurrent.paintHash,
    report.observations.complete.paintHash,
  );
  assert(report.observations.complete.text.includes("Epoch 3 / 3"));
  const source = report.source;
  assert(source && source.runId === report.runId);
  assert.deepEqual(report.sourceAfter, source);
  assert(
    source.files &&
      Object.keys(source.files).length >= 10 &&
      Object.keys(source.files).length <= 4096,
  );
  assert(source.rawDocuments && Object.keys(source.rawDocuments).length >= 5);
  for (const [path, raw] of Object.entries(source.rawDocuments)) {
    assert(typeof raw === "string");
    assert.deepEqual(source.files[path], {
      size: Buffer.byteLength(raw),
      sha256: createHash("sha256").update(raw).digest("hex"),
    });
  }
  const markerPaths = Object.keys(source.files)
    .filter((path) => path.endsWith("/COMPLETE.json"))
    .sort();
  assert.deepEqual(
    Object.keys(source.rawDocuments)
      .filter((path) => path.endsWith("/COMPLETE.json"))
      .sort(),
    markerPaths,
  );
  for (const path of markerPaths) {
    const marker = JSON.parse(source.rawDocuments[path]);
    assert.equal(path, `checkpoints/${marker.generation}/COMPLETE.json`);
    assert.equal(marker.schema_version, 1);
    assert.equal(marker.run_id, report.runId);
    assert(
      [1, 2].includes(marker.attempt) &&
        Number.isSafeInteger(marker.step) &&
        marker.step >= 1 &&
        marker.step <= 3,
    );
    assert.equal(marker.manifest_sha256, source.files["manifest.json"].sha256);
    const prefix = path.slice(0, -"COMPLETE.json".length);
    for (const [name, record] of Object.entries(marker.files)) {
      assert(name && !/[\\/]/.test(name) && name !== "." && name !== "..");
      assert.deepEqual(record, source.files[prefix + name]);
    }
    const selection = JSON.parse(source.rawDocuments[prefix + "checkpoint_selection.json"]);
    assert.equal(selection.schema_version, 1);
    assert(["best", "periodic", "final"].includes(selection.kind));
    assert(Number.isSafeInteger(selection.source_seq) && selection.source_seq >= 0);
    const selected = source.journals[String(marker.attempt)].events[selection.source_seq];
    assert(
      selected &&
        ["metric", "artifact"].includes(selected.type) &&
        selected.payload.step === marker.step,
    );
  }
  for (const [path, file] of Object.entries(source.files)) {
    assert(
      path &&
        !path.startsWith("/") &&
        !path.includes("\\") &&
        path.split("/").every((p) => p && p !== "." && p !== ".."),
    );
    assert(Number.isSafeInteger(file.size) && file.size > 0 && file.size <= 64 * 1024 * 1024);
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(source.manifest?.run_id, report.runId);
  assert(typeof source.completeRaw === "string" && typeof source.selectionRaw === "string");
  const complete = JSON.parse(source.completeRaw);
  const marker = Object.entries(source.files).find(
    ([path, file]) =>
      path.endsWith(`/${source.generation}/COMPLETE.json`) &&
      file.sha256 === createHash("sha256").update(source.completeRaw).digest("hex"),
  );
  assert(marker, "Selected COMPLETE bytes absent from immutable source inventory");
  assert.equal(complete.run_id, report.runId);
  assert.equal(complete.attempt, 1);
  assert.equal(complete.step, 1);
  const prefix = marker[0].slice(0, -"COMPLETE.json".length);
  const selectionFile = source.files[prefix + "checkpoint_selection.json"];
  assert.equal(
    selectionFile?.sha256,
    createHash("sha256").update(source.selectionRaw).digest("hex"),
  );
  assert.deepEqual(JSON.parse(source.selectionRaw), source.selection);
  assert(complete.files && Object.keys(complete.files).length > 0);
  for (const [name, file] of Object.entries(complete.files))
    assert.deepEqual(source.files[prefix + name], file);
  for (const attempt of [1, 2]) {
    assert.deepEqual(
      JSON.parse(source.rawDocuments[`attempts/${attempt}/runtime_request.json`]),
      source.runtimeRequests[attempt],
    );
    assert.deepEqual(
      JSON.parse(source.rawDocuments[`attempts/${attempt}/runtime_identity.json`]),
      source.runtimeIdentities[attempt],
    );
    assert.equal(source.runtimeRequests?.[attempt]?.run_id, report.runId);
    assert.equal(source.runtimeIdentities?.[attempt]?.run_id, report.runId);
    assert.equal(source.runtimeIdentities?.[attempt]?.attempt, attempt);
    assert(uuid.test(source.runtimeIdentities[attempt].request_id));
    assert(
      source.files[`attempts/${attempt}/runtime_request.json`] &&
        source.files[`attempts/${attempt}/runtime_identity.json`],
    );
    const request = source.runtimeRequests[attempt];
    assert.equal(request.operation, "train");
    assert.equal(request.runtime.device, "cpu");
    assert.equal(request.resolved_config.epochs, 3);
    assert.equal(request.resolved_config.output_dir, request.run_directory);
    assert.equal(source.journals[String(attempt)].events[0].type, "hello");
    assert.equal(source.journals[String(attempt)].events[0].payload.device, "cpu");
    assert.equal(
      source.journals[String(attempt)].events[0].payload.interpreter,
      request.runtime.python,
    );
  }
  assert.deepEqual(JSON.parse(source.rawDocuments["manifest.json"]), source.manifest);
  assert.equal(source.runtimeRequests[1].resolved_config.resume, null);
  assert.equal(
    source.runtimeRequests[2].resolved_config.resume,
    `${source.runtimeRequests[2].run_directory}/checkpoints/${source.generation}`,
  );
  assert.equal(source.runtimeRequests[1].run_directory, source.runtimeRequests[2].run_directory);
  assert.notEqual(source.runtimeIdentities[1].request_id, source.runtimeIdentities[2].request_id);
  assert(
    sourceBeforeEquivalent(report.sourceBefore, source),
    "source bytes changed between pre-adoption and final inspection",
  );
  assert(source.selection && Number.isSafeInteger(source.selection.source_seq));
  assert(
    source.stream?.stage === "complete" &&
      source.stream.path === `/api/runs/${report.runId}/events` &&
      Array.isArray(source.stream.forwarded) &&
      source.stream.forwarded.length > 0,
  );
  assert(Array.isArray(source.stream.frames) && source.stream.frames.length > 0);
  for (const frame of source.stream.frames) {
    assert(typeof frame.raw === "string" && frame.raw.includes("data: "));
    assert.equal(frame.sha256, createHash("sha256").update(frame.raw).digest("hex"));
  }
  const allEvents = [1, 2].flatMap((attempt) => source.journals[String(attempt)].events);
  const frames = source.stream.frames.map((frame) => {
    const lines = frame.raw.trim().split("\n");
    assert.equal(lines.length, 2);
    assert(lines[0].startsWith("id: ") && lines[1].startsWith("data: "));
    return { id: lines[0].slice(4), event: JSON.parse(lines[1].slice(6)) };
  });
  assert.deepEqual(
    frames,
    allEvents.map((event) => ({ id: `${event.attempt}:${event.seq}`, event })),
  );
  assert.deepEqual(
    source.stream.forwarded,
    allEvents.map((event) => [event.attempt, event.seq]),
  );
  assert.deepEqual(source.stream.cursors, source.cursors);
  assert(source.registry && source.registry.submission === null);
  assert.equal(source.registry.plan.submission_requested, 1);
  assert.equal(source.registry.plan.cancellation_requested, 0);
  assert.equal(source.registry.execution.cancel_delivered, 0);
  const handle = JSON.parse(source.registry.execution.handle_json);
  assert.equal(handle.pid, null);
  assert.equal(handle.supervisor_id, null);
  assert.equal(handle.job_id, null);
  assert.deepEqual(JSON.parse(handle.raw_json), { adopted: true });
  const payload = source.boundary?.payload;
  assert.deepEqual(payload, {
    source_attempt: 1,
    step: 1,
    generation: source.generation,
    source_seq: source.selection.source_seq,
    reason: "resume",
  });
  for (const attempt of [1, 2]) {
    const events = source.journals?.[String(attempt)]?.events;
    assert(Array.isArray(events) && events.length > 1);
    events.forEach((event, seq) => {
      assert.equal(event.run_id, report.runId);
      assert.equal(event.attempt, attempt);
      assert.equal(event.seq, seq);
      assert.equal(event.protocol, "wavedl-jsonl");
      assert.equal(event.version, 1);
      assert(typeof event.type === "string");
    });
    assert.equal(events.at(-1).type, "exit");
    const journal = source.journals[String(attempt)];
    assert(typeof journal.raw === "string" && journal.raw.endsWith("\n"));
    assert.equal(journal.size, Buffer.byteLength(journal.raw));
    assert.equal(journal.sha256, createHash("sha256").update(journal.raw).digest("hex"));
    assert.deepEqual(
      journal.raw
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line)),
      events,
    );
    assert.deepEqual(source.files[`attempts/${attempt}/events.jsonl`], {
      size: journal.size,
      sha256: journal.sha256,
    });
    for (const event of events.filter(
      (e) => e.type === "artifact" && e.payload.kind === "checkpoint",
    )) {
      const artifact = event.payload;
      assert.equal(artifact.path, `checkpoints/${artifact.generation}/COMPLETE.json`);
      assert.deepEqual(source.files[artifact.path], {
        size: artifact.size,
        sha256: artifact.sha256,
      });
      const marker = JSON.parse(source.rawDocuments[artifact.path]);
      assert.equal(marker.attempt, attempt);
      assert.equal(marker.step, artifact.step);
      assert.equal(marker.generation, artifact.generation);
    }
  }
  assert.equal(source.journals["2"].events.filter((e) => e.type === "supersede").length, 1);
  assert.deepEqual(
    source.journals["2"].events.find((e) => e.type === "supersede"),
    source.boundary,
  );
  const selectedMetric = source.journals["1"].events[source.selection.source_seq];
  assert(
    selectedMetric && selectedMetric.type === "metric" && selectedMetric.payload.step === 1,
    "source_seq must identify the published step metric",
  );
  for (const attempt of [1, 2]) {
    assert.match(source.journals[String(attempt)].sha256, /^[a-f0-9]{64}$/);
    assert.equal(source.journals[String(attempt)].events.at(-1).payload?.status, "completed");
  }
  assert(Array.isArray(source.projection) && source.projection.length > 0);
  assert.equal(
    source.projectionSha256,
    createHash("sha256").update(canonical(source.projection)).digest("hex"),
  );
  assert(source.projection.every((row) => row.run_id === report.runId));
  const metricEvents = [1, 2].flatMap((attempt) =>
    source.journals[String(attempt)].events
      .filter((e) => e.type === "metric")
      .map((e) => ({ attempt, e })),
  );
  assert.equal(source.projection.length, metricEvents.length);
  for (const { attempt, e } of metricEvents) {
    const row = source.projection.find((r) => r.attempt === attempt && r.seq === e.seq);
    assert(row, "projection row missing journal metric");
    assert.deepEqual(
      {
        run_id: row.run_id,
        attempt: row.attempt,
        seq: row.seq,
        step: row.step,
        name: row.name,
        value: row.value,
      },
      {
        run_id: report.runId,
        attempt,
        seq: e.seq,
        step: e.payload.step,
        name: e.payload.name,
        value: e.payload.value,
      },
    );
    assert.equal(
      row.active,
      (attempt === 1 && e.payload.step === 1) || (attempt === 2 && e.payload.step > 1) ? 1 : 0,
    );
    assert.deepEqual(JSON.parse(row.metrics_json), e.payload.metrics);
  }
  assert.deepEqual(
    new Set(
      source.projection.filter((row) => row.active).map((row) => `${row.attempt}:${row.step}`),
    ),
    new Set(["1:1", "2:2", "2:3"]),
  );
  assert.deepEqual(
    source.journals["1"].events.filter((e) => e.type === "metric").map((e) => e.payload.step),
    [1, 2, 3],
  );
  assert.deepEqual(
    source.journals["2"].events.filter((e) => e.type === "metric").map((e) => e.payload.step),
    [2, 3],
  );
  assert.deepEqual(report.observations.restored.values, {});
  assert.equal(report.observations.restored.progress, null);
  assert(
    report.observations.restored.summary.includes("Waiting for metrics from the current runtime."),
  );
  for (const [key, step] of [
    ["firstCurrent", 2],
    ["complete", 3],
  ]) {
    const observation = report.observations[key];
    const currentEvents = source.journals["2"].events.filter(
      (e) => e.type === "metric" && e.payload.step <= step,
    );
    const latest = currentEvents.at(-1).payload;
    assert.equal(observation.selected, report.runId);
    assert.equal(observation.progress, latest.metrics.epoch / latest.metrics.total_epochs);
    assert(observation.summary.includes(`Epoch ${step} / 3`));
    assert.deepEqual(observation.values, displayValues(latest, currentEvents));
  }
  assert.equal(report.observations.restored.selected, report.runId);
  assert.equal(source.cursors?.length, 2);
  assert.deepEqual(
    source.cursors,
    [1, 2].map((attempt) => [attempt, source.journals[String(attempt)].events.at(-1).seq]),
  );
  assert(Array.isArray(report.actualResponses) && report.actualResponses.length === 2);
  assert.equal(report.actualResponses[0].deliveredStatus, 503);
  assert.equal(report.actualResponses[1].response?.status, 200);
  assert.deepEqual(report.actualResponses[0].request, report.actualResponses[1].request);
  for (const response of report.actualResponses) {
    assert.equal(response.request?.path, "/api/runs/adopt");
    assert.equal(response.request?.method, "POST");
    assert.equal(response.request?.idempotencyKeyPresent, true);
    assert.equal(response.response.status, 200);
    assert.equal(response.response.bodyBytes, Buffer.byteLength(response.response.bodyText));
    assert.equal(
      response.response.bodySha256,
      createHash("sha256").update(response.response.bodyText).digest("hex"),
    );
    assert.deepEqual(JSON.parse(response.response.bodyText), response.response.json);
    assert.deepEqual(response.response.json, report.adoption);
    const requestText = JSON.stringify(response.request.json);
    assert.equal(response.request.bodyBytes, Buffer.byteLength(requestText));
    assert.equal(
      response.request.bodySha256,
      createHash("sha256").update(requestText).digest("hex"),
    );
    assert.deepEqual(response.request.json, {
      attempt: 2,
      path: source.runtimeRequests[2].run_directory,
    });
    assert.match(response.request.idempotencyKeySha256, /^[a-f0-9]{64}$/);
  }
  const adoption = report.adoption;
  assert.equal(adoption.request_id, source.runtimeIdentities[2].request_id);
  assert.deepEqual(adoption, {
    adopted: true,
    attempt: 2,
    backend: "local",
    backend_status: "unknown",
    cancellation_requested: false,
    operation: "train",
    plan_id: source.registry.plan.plan_id,
    request_id: source.registry.plan.request_id,
    run_id: report.runId,
    state: "supervision_lost",
    submission_requested: true,
    uncertainty: true,
  });
  assert.deepEqual(
    JSON.parse(source.registry.plan.request_payload_json),
    report.actualResponses[0].request.json,
  );
  assert.equal(
    createHash("sha256").update(source.registry.plan.idempotency_key).digest("hex"),
    report.actualResponses[0].request.idempotencyKeySha256,
  );
  assert.equal(handle.run_id, report.runId);
  assert.equal(handle.attempt, 2);
  assert.equal(handle.request_id, adoption.request_id);
  assert.equal(handle.run_dir, source.runtimeRequests[2].run_directory);
  assert.equal(handle.backend, "local");
  assert(
    typeof source.registry.execution.owner === "string" &&
      source.registry.execution.owner.length > 0 &&
      source.registry.execution.owner.length <= 256,
  );
  assert.equal(handle.owner, source.registry.execution.owner);
  assert.equal(source.registry.execution.plan_id, adoption.plan_id);
  assert.equal(source.registry.execution.attempt, 2);
  const plan = JSON.parse(source.registry.plan.plan_json);
  assert.deepEqual(JSON.parse(plan.manifest_json), source.runtimeRequests[2]);
  assert.deepEqual(plan.argv, [source.runtimeRequests[2].runtime.python, "-m", "wavedl.train"]);
  for (const field of [
    "browserClosed",
    "fixtureReaped",
    "servicesClosed",
    "processGroupAbsent",
    "listenerClosed",
    "workspaceRemoved",
    "profileRemoved",
    "tokenRemoved",
  ])
    assert.equal(report.cleanup?.[field], true, `cleanup ${field}`);
  assert(!Object.hasOwn(report, "retainedWorkspace"));
  return report;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function displayValues(payload, events) {
  const get = (...names) => {
    for (const name of names) {
      const value = payload.metrics[name] ?? (payload.name === name ? payload.value : null);
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    return null;
  };
  const show = (value, suffix = "") => (value == null ? "Unavailable" : `${value}${suffix}`);
  const r2s = events
    .map((e) => e.payload.metrics.r2 ?? e.payload.metrics.val_r2)
    .filter((v) => typeof v === "number" && Number.isFinite(v));
  const values = {
    "Training loss": show(get("train_loss")),
    "Validation loss": show(get("val_loss")),
    "R²": show(get("r2", "val_r2")),
    "Learning rate": show(get("lr")),
    Pearson: show(get("pearson", "val_pearson")),
    "Gradient norm": show(get("grad_norm")),
    "MAE average": show(get("mae_avg", "val_mae_avg")),
    "Epoch duration": show(get("epoch_time"), " s"),
    "Best R² (current attempt)": show(r2s.length ? Math.max(...r2s) : null),
    "Elapsed training time": show(get("total_time", "elapsed_time"), " s"),
    Patience:
      Number.isSafeInteger(payload.metrics.patience_counter) &&
      Number.isSafeInteger(payload.metrics.max_patience) &&
      payload.metrics.max_patience > 0
        ? `${payload.metrics.patience_counter} / ${payload.metrics.max_patience}`
        : "Unavailable",
  };
  const parameters = payload.metrics.mae_per_param;
  if (Array.isArray(parameters))
    parameters.forEach((v, i) => {
      values[`P${i + 1}`] = show(v);
    });
  else if (payload.metrics.per_param_mae)
    for (const [name, v] of Object.entries(payload.metrics.per_param_mae)) values[name] = show(v);
  return values;
}

function sourceBeforeEquivalent(before, source) {
  if (!before || typeof before !== "object") return false;
  for (const key of [
    "runId",
    "generation",
    "selection",
    "boundary",
    "journals",
    "files",
    "manifest",
    "runtimeRequests",
    "runtimeIdentities",
    "completeRaw",
    "selectionRaw",
    "rawDocuments",
  ]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(source[key])) return false;
  }
  return true;
}

export async function verifySupersessionFile(path) {
  const before = await currentAssetDigest();
  const verified = verifySupersessionReport(
    JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(await boundedFile(path, 8 * 1024 * 1024)),
    ),
  );
  assert.equal(verified.assetManifestSha256, before);
  const inventory = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      await boundedFile(
        new URL("../src/wavedl_daemon/web_assets/.wavedl-assets.json", import.meta.url).pathname,
        1024 * 1024,
      ),
    ),
  );
  assert.deepEqual(verified.assetInventory, inventory);
  assert.equal(verified.assetManifestSha256, await currentAssetDigest());
  return verified;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await verifySupersessionFile(process.argv[2]);
    console.log("supersession report: valid");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
