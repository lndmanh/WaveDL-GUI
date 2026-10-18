import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, mkdir, symlink, rm, realpath, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentAssetDigest } from "./verify_adoption_negative_browser_report.mjs";
import { verifySupersessionReport } from "./verify_supersession_browser_report.mjs";

// This positive record exercises only the evidence contract. It is not browser proof.
function contractRecord() {
  const runId = "00000000-0000-4000-8000-000000000001";
  const hash = (text) => createHash("sha256").update(text).digest("hex");
  const file = (text) => ({ size: Buffer.byteLength(text), sha256: hash(text) });
  const metric = (step) => ({
    step,
    name: "train_loss",
    value: step,
    unit: "",
    metrics: { train_loss: step, epoch: step, total_epochs: 3 },
  });
  const event = (attempt, seq, type, payload) => ({
    run_id: runId,
    attempt,
    seq,
    type,
    payload,
    protocol: "wavedl-jsonl",
    version: 1,
  });
  const boundary = event(2, 0, "supersede", {
    source_attempt: 1,
    step: 1,
    generation: "gen-000001",
    source_seq: 0,
    reason: "resume",
  });
  const journals = {};
  for (const attempt of [1, 2]) {
    const events =
      attempt === 1
        ? [
            event(1, 0, "metric", metric(1)),
            event(1, 1, "metric", metric(2)),
            event(1, 2, "metric", metric(3)),
          ]
        : [boundary, event(2, 1, "metric", metric(2)), event(2, 2, "metric", metric(3))];
    events.push(event(attempt, 3, "exit", { status: "completed" }));
    const raw = events.map((e) => JSON.stringify(e) + "\n").join("");
    journals[attempt] = { events, raw, ...file(raw) };
  }
  const selection = { source_seq: 0 };
  const selectionRaw = JSON.stringify(selection);
  const prefix = "checkpoints/gen-000001/";
  const complete = {
    run_id: runId,
    attempt: 1,
    step: 1,
    files: { "checkpoint_selection.json": file(selectionRaw) },
  };
  const completeRaw = JSON.stringify(complete);
  const files = {
    "manifest.json": file("{}"),
    [prefix + "COMPLETE.json"]: file(completeRaw),
    [prefix + "checkpoint_selection.json"]: file(selectionRaw),
  };
  const runtimeRequests = {},
    runtimeIdentities = {};
  for (const attempt of [1, 2]) {
    runtimeRequests[attempt] = { run_id: runId };
    runtimeIdentities[attempt] = {
      run_id: runId,
      attempt,
      request_id: `00000000-0000-4000-8000-00000000000${attempt + 1}`,
    };
    for (const name of ["runtime_request.json", "runtime_identity.json", "events.jsonl"])
      files[`attempts/${attempt}/${name}`] = file(name);
  }
  files["extra.bin"] = file("x");
  const rawDocuments = Object.fromEntries([
    ["manifest.json", "{}"],
    [prefix + "COMPLETE.json", completeRaw],
    [prefix + "checkpoint_selection.json", selectionRaw],
    ["attempts/1/runtime_request.json", "runtime_request.json"],
    ["attempts/2/runtime_request.json", "runtime_request.json"],
  ]);
  const projection = [1, 2].flatMap((attempt) =>
    journals[attempt].events
      .filter((e) => e.type === "metric")
      .map((e) => ({
        run_id: runId,
        attempt,
        seq: e.seq,
        step: e.payload.step,
        name: e.payload.name,
        value: e.payload.value,
        active: attempt === 2 || e.payload.step === 1 ? 1 : 0,
        metrics_json: JSON.stringify(e.payload.metrics),
      })),
  );
  const source = {
    runId,
    generation: "gen-000001",
    selection,
    selectionRaw,
    completeRaw,
    manifest: { run_id: runId },
    runtimeRequests,
    runtimeIdentities,
    boundary,
    journals,
    files,
    rawDocuments,
  };
  const sourceBefore = structuredClone(source);
  Object.assign(source, {
    projection,
    cursors: [
      [1, 3],
      [2, 3],
    ],
    registry: {
      submission: null,
      plan: { submission_requested: 1, cancellation_requested: 0 },
      execution: {
        cancel_delivered: 0,
        handle_json: JSON.stringify({
          pid: null,
          supervisor_id: null,
          job_id: null,
          raw_json: '{"adopted":true}',
        }),
      },
    },
    stream: {
      stage: "complete",
      path: `/api/runs/${runId}/events`,
      forwarded: [[1, 0]],
      frames: [{ raw: "data: {}\n\n", sha256: hash("data: {}\n\n") }],
    },
  });
  const observation = (steps) => ({
    lineage: { attempt: 2, steps },
    canvas: true,
    canvasWidth: 900,
    canvasHeight: 600,
    paintedPixels: 100,
    paintHash: steps,
    selected: runId,
    summary: steps === 1 ? "Waiting for metrics from the current runtime." : `Epoch ${steps} / 3`,
    progress: steps === 1 ? null : steps / 3,
    text: `Epoch ${steps} / 3`,
    values:
      steps === 1
        ? {}
        : {
            "Training loss": String(steps),
            "Validation loss": "Unavailable",
            "R²": "Unavailable",
            "Learning rate": "Unavailable",
            Pearson: "Unavailable",
            "Gradient norm": "Unavailable",
            "MAE average": "Unavailable",
            "Epoch duration": "Unavailable",
            "Best R² (current attempt)": "Unavailable",
            "Elapsed training time": "Unavailable",
            Patience: "Unavailable",
          },
  });
  const request = { path: "/api/runs/adopt", method: "POST", idempotencyKeyPresent: true };
  const rawDocument = (path, value) => {
    const raw = JSON.stringify(value);
    source.rawDocuments[path] = raw;
    source.files[path] = file(raw);
  };
  for (const attempt of [1, 2]) {
    const runtime = { python: "/python", device: "cpu" };
    Object.assign(source.runtimeRequests[attempt], {
      operation: "train",
      runtime,
      run_directory: "/owned/run",
      resolved_config: {
        epochs: 3,
        output_dir: "/owned/run",
        resume: attempt === 1 ? null : "/owned/run/checkpoints/gen-000001",
      },
    });
    rawDocument(`attempts/${attempt}/runtime_request.json`, source.runtimeRequests[attempt]);
    rawDocument(`attempts/${attempt}/runtime_identity.json`, source.runtimeIdentities[attempt]);
    const events = source.journals[attempt].events;
    events.unshift(event(attempt, 0, "hello", { device: "cpu", interpreter: "/python" }));
    events.forEach((e, i) => (e.seq = i));
    source.journals[attempt].raw = events.map((e) => JSON.stringify(e) + "\n").join("");
    Object.assign(source.journals[attempt], file(source.journals[attempt].raw));
  }
  source.selection.source_seq = 1;
  source.boundary.payload.source_seq = 1;
  Object.assign(source.selection, { schema_version: 1, kind: "best" });
  Object.assign(complete, {
    schema_version: 1,
    generation: "gen-000001",
    manifest_sha256: hash(JSON.stringify(source.manifest)),
  });
  source.selectionRaw = JSON.stringify(source.selection);
  complete.files["checkpoint_selection.json"] = file(source.selectionRaw);
  source.completeRaw = JSON.stringify(complete);
  rawDocument(prefix + "checkpoint_selection.json", source.selection);
  rawDocument(prefix + "COMPLETE.json", complete);
  rawDocument("manifest.json", source.manifest);
  source.journals[2].raw = source.journals[2].events.map((e) => JSON.stringify(e) + "\n").join("");
  Object.assign(source.journals[2], file(source.journals[2].raw));
  for (const attempt of [1, 2])
    source.files[`attempts/${attempt}/events.jsonl`] = {
      size: source.journals[attempt].size,
      sha256: source.journals[attempt].sha256,
    };
  source.projection.forEach((row) => row.seq++);
  const canonical = (v) =>
    Array.isArray(v)
      ? `[${v.map(canonical).join(",")}]`
      : v && typeof v === "object"
        ? `{${Object.keys(v)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
            .join(",")}}`
        : JSON.stringify(v);
  source.projectionSha256 = hash(canonical(source.projection));
  source.cursors = [
    [1, 4],
    [2, 4],
  ];
  const allEvents = [1, 2].flatMap((a) => source.journals[a].events);
  source.stream.frames = allEvents.map((e) => {
    const raw = `id: ${e.attempt}:${e.seq}\ndata: ${JSON.stringify(e)}\n\n`;
    return { raw, sha256: hash(raw) };
  });
  source.stream.forwarded = allEvents.map((e) => [e.attempt, e.seq]);
  source.stream.cursors = source.cursors;
  const adoption = {
    adopted: true,
    attempt: 2,
    backend: "local",
    backend_status: "unknown",
    cancellation_requested: false,
    operation: "train",
    plan_id: "00000000-0000-4000-8000-000000000004",
    request_id: "00000000-0000-4000-8000-000000000005",
    run_id: runId,
    state: "supervision_lost",
    submission_requested: true,
    uncertainty: true,
  };
  source.runtimeIdentities[2].request_id = adoption.request_id;
  rawDocument("attempts/2/runtime_identity.json", source.runtimeIdentities[2]);
  Object.assign(request, {
    json: { attempt: 2, path: "/owned/run" },
    idempotencyKeySha256: hash("key"),
  });
  const body = JSON.stringify(request.json);
  Object.assign(request, { bodyBytes: Buffer.byteLength(body), bodySha256: hash(body) });
  const responseText = JSON.stringify(adoption);
  const response = {
    status: 200,
    bodyText: responseText,
    json: adoption,
    bodyBytes: Buffer.byteLength(responseText),
    bodySha256: hash(responseText),
  };
  Object.assign(source.registry.plan, {
    plan_id: adoption.plan_id,
    request_id: adoption.request_id,
    idempotency_key: "key",
    request_payload_json: body,
    plan_json: JSON.stringify({
      manifest_json: JSON.stringify(source.runtimeRequests[2]),
      argv: ["/python", "-m", "wavedl.train"],
    }),
  });
  Object.assign(source.registry.execution, {
    plan_id: adoption.plan_id,
    attempt: 2,
    owner: "owned",
    handle_json: JSON.stringify({
      pid: null,
      job_id: null,
      supervisor_id: null,
      raw_json: '{"adopted":true}',
      run_id: runId,
      attempt: 2,
      request_id: adoption.request_id,
      run_dir: "/owned/run",
      backend: "local",
      owner: "owned",
    }),
  });
  for (const key of Object.keys(sourceBefore)) sourceBefore[key] = structuredClone(source[key]);
  return {
    name: "supersession-browser",
    status: "passed",
    scope: "genuine-cpu-staged-public-supersession",
    limitation:
      "Genuine CPU checkpoint-resume journals staged through public adoption and pass-through daemon SSE into Chrome DOM/canvas only; not live Slurm requeue, native process restart, or full T35 certification.",
    runId,
    initialProfileEmpty: true,
    driverReadinessMode: "sync-exposure-poll-and-two-controller-dom-observations",
    browserRuntime: {
      userAgent: "Chrome/100",
      width: 1280,
      height: 900,
      cookies: "",
      localStorageKeys: [],
      sessionStorageKeys: [],
    },
    browserProof: {
      publicAdoption: true,
      nativeActions: true,
      domOnlyObservation: true,
      noPrivateInjection: true,
    },
    assetManifestSha256: "a".repeat(64),
    assetManifestSha256After: "a".repeat(64),
    assetInventory: { "index.html": "a".repeat(64) },
    assetInventoryAfter: { "index.html": "a".repeat(64) },
    sourceBefore,
    source,
    sourceAfter: structuredClone(source),
    adoption,
    observations: {
      restored: observation(1),
      firstCurrent: observation(2),
      complete: observation(3),
    },
    actualResponses: [
      { request, deliveredStatus: 503, response },
      { request, deliveredStatus: 200, response },
    ],
    cleanup: Object.fromEntries(
      [
        "browserClosed",
        "fixtureReaped",
        "servicesClosed",
        "processGroupAbsent",
        "listenerClosed",
        "workspaceRemoved",
        "profileRemoved",
        "tokenRemoved",
      ].map((k) => [k, true]),
    ),
  };
}

test("accepts a positive contract record, not independent browser proof", () =>
  verifySupersessionReport(contractRecord()));
for (const [name, change] of [
  ["overclaimed scope", (r) => (r.scope = "T35-complete")],
  ["missing limitation", (r) => delete r.limitation],
  ["dirty context", (r) => (r.browserRuntime.cookies = "cookie")],
  ["cleanup missing", (r) => (r.cleanup.tokenRemoved = false)],
  ["restored stale progress", (r) => (r.observations.restored.progress = 1)],
  ["wrong numeric metric", (r) => (r.observations.complete.values["Training loss"] = "999")],
  [
    "unchanged canvas",
    (r) => (r.observations.complete.paintHash = r.observations.restored.paintHash),
  ],
  ["source mutation", (r) => (r.sourceBefore.journals[1].sha256 = "b".repeat(64))],
  ["SSE hash", (r) => (r.source.stream.frames[0].sha256 = "b".repeat(64))],
  ["wrong cursor", (r) => (r.source.cursors[0][1] = 99)],
  ["abandoned row active", (r) => (r.source.projection[1].active = 1)],
  ["cancel control", (r) => (r.source.registry.plan.cancellation_requested = 1)],
  ["failed status", (r) => (r.status = "failed")],
  [
    "foreign valid-rehashed SSE",
    (r) => {
      const raw =
        'id: 999:999\ndata: {"run_id":"foreign","attempt":999,"seq":999,"type":"metric"}\n\n';
      r.source.stream.frames = [{ raw, sha256: createHash("sha256").update(raw).digest("hex") }];
      r.sourceAfter = structuredClone(r.source);
    },
  ],
  [
    "foreign SSE forwarded cursors",
    (r) => {
      r.source.stream.forwarded = [[999, 999]];
      r.source.stream.cursors = [[999, 999]];
      r.sourceAfter = structuredClone(r.source);
    },
  ],
  [
    "unbound parsed runtime argv",
    (r) => {
      r.source.runtimeRequests[2].argv = "FAKE";
      r.sourceBefore.runtimeRequests[2].argv = "FAKE";
      r.sourceAfter = structuredClone(r.source);
    },
  ],
  [
    "unbound parsed identity",
    (r) => {
      r.source.runtimeIdentities[2].request_id = "00000000-0000-4000-8000-000000000099";
      r.sourceBefore.runtimeIdentities[2].request_id = r.source.runtimeIdentities[2].request_id;
      r.sourceAfter = structuredClone(r.source);
    },
  ],
  [
    "garbage projection digest",
    (r) => {
      r.source.projectionSha256 = "garbage";
      r.sourceAfter = structuredClone(r.source);
    },
  ],
  [
    "foreign adoption",
    (r) => {
      r.adoption.run_id = "foreign";
      for (const c of r.actualResponses) {
        c.response.json = r.adoption;
        c.response.bodyText = JSON.stringify(r.adoption);
        c.response.bodyBytes = Buffer.byteLength(c.response.bodyText);
        c.response.bodySha256 = createHash("sha256").update(c.response.bodyText).digest("hex");
      }
    },
  ],
  [
    "unbound adoption request bytes",
    (r) => (r.actualResponses[0].request.bodySha256 = "b".repeat(64)),
  ],
  [
    "garbage asset inventory",
    (r) => {
      r.assetInventory = { garbage: "invalid" };
      r.assetInventoryAfter = r.assetInventory;
    },
  ],
  [
    "jointly forged adopted request identity",
    (r) => {
      const requestId = "00000000-0000-4000-8000-000000000099";
      r.adoption.request_id = requestId;
      for (const c of r.actualResponses) {
        c.response.json = r.adoption;
        c.response.bodyText = JSON.stringify(r.adoption);
        c.response.bodyBytes = Buffer.byteLength(c.response.bodyText);
        c.response.bodySha256 = createHash("sha256").update(c.response.bodyText).digest("hex");
      }
      r.source.registry.plan.request_id = requestId;
      const handle = JSON.parse(r.source.registry.execution.handle_json);
      handle.request_id = requestId;
      r.source.registry.execution.handle_json = JSON.stringify(handle);
      r.sourceAfter = structuredClone(r.source);
    },
  ],
  [
    "foreign adopted handle directory",
    (r) => {
      const h = JSON.parse(r.source.registry.execution.handle_json);
      h.run_dir = "/foreign";
      r.source.registry.execution.handle_json = JSON.stringify(h);
      r.sourceAfter = structuredClone(r.source);
    },
  ],
  [
    "foreign adopted handle backend",
    (r) => {
      const h = JSON.parse(r.source.registry.execution.handle_json);
      h.backend = "slurm";
      r.source.registry.execution.handle_json = JSON.stringify(h);
      r.sourceAfter = structuredClone(r.source);
    },
  ],
  [
    "foreign adopted handle owner",
    (r) => {
      const h = JSON.parse(r.source.registry.execution.handle_json);
      h.owner = "foreign";
      r.source.registry.execution.handle_json = JSON.stringify(h);
      r.sourceAfter = structuredClone(r.source);
    },
  ],
  [
    "skip flag on passed record",
    (r) => {
      r.skipped = true;
    },
  ],
  [
    "error on passed record",
    (r) => {
      r.error = "unconfirmed";
    },
  ],
])
  test(`rejects contract mutation: ${name}`, () => {
    const r = contractRecord();
    change(r);
    assert.throws(() => verifySupersessionReport(r));
  });

test("CLI contract: bounded fatal UTF-8 and ordinary ancestor file checks", async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "wavedl-supersession-guard-"));
  const cli = (path) =>
    spawnSync(process.execPath, ["tools/verify_supersession_browser_report.mjs", path], {
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
  try {
    const positive = contractRecord();
    positive.assetManifestSha256 = positive.assetManifestSha256After = await currentAssetDigest();
    positive.assetInventory = positive.assetInventoryAfter = JSON.parse(
      await readFile(
        new URL("../src/wavedl_daemon/web_assets/.wavedl-assets.json", import.meta.url),
        "utf8",
      ),
    );
    const valid = join(directory, "valid.json");
    await writeFile(valid, JSON.stringify(positive));
    assert.equal(cli(valid).status, 0, "Positive contract CLI must reach validation");
    for (const [name, content] of [
      ["failed.json", JSON.stringify({ ...positive, status: "failed" })],
      [
        "stale.json",
        JSON.stringify({
          ...positive,
          assetManifestSha256: "a".repeat(64),
          assetManifestSha256After: "a".repeat(64),
        }),
      ],
      ["invalid-utf8.json", Buffer.from([0xff])],
      ["oversized.json", Buffer.alloc(8 * 1024 * 1024 + 1, 32)],
    ]) {
      const path = join(directory, name);
      await writeFile(path, content);
      assert.equal(cli(path).status, 1, name);
    }
    assert.equal(cli(join(directory, "missing.json")).status, 1);
    const link = join(directory, "linked.json");
    await symlink(valid, link);
    assert.equal(cli(link).status, 1);
    const real = join(directory, "real");
    await mkdir(real);
    await writeFile(join(real, "valid.json"), JSON.stringify(positive));
    const parent = join(directory, "parent");
    await symlink(real, parent);
    assert.equal(cli(join(parent, "valid.json")).status, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects synthetic boundary without public DOM, projection, cleanup, and asset evidence", () => {
  const base = {
    status: "passed",
    source: {
      runId: "00000000-0000-4000-8000-000000000001",
      selection: { source_seq: 4 },
      boundary: {
        payload: { source_attempt: 1, step: 1, source_seq: 4, generation: "gen-000001" },
      },
      journals: {
        1: {
          events: [
            { run_id: "00000000-0000-4000-8000-000000000001", attempt: 1, seq: 0 },
            { run_id: "00000000-0000-4000-8000-000000000001", attempt: 1, seq: 1, type: "exit" },
          ],
        },
        2: {
          events: [
            {
              run_id: "00000000-0000-4000-8000-000000000001",
              attempt: 2,
              seq: 0,
              type: "supersede",
              payload: { source_attempt: 1, step: 1, source_seq: 4, generation: "gen-000001" },
            },
            { run_id: "00000000-0000-4000-8000-000000000001", attempt: 2, seq: 1, type: "exit" },
          ],
        },
      },
    },
  };
  assert.throws(() => verifySupersessionReport(base));
});
