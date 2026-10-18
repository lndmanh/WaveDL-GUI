import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { verifyAdoptionRecord } from "./verify_adoption_browser_report.mjs";

const runId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const planId = "11111111-1111-4111-8111-111111111111";
const digest = { size: 1, sha256: "e".repeat(64) };

function fixture() {
  const adoption = {
    plan_id: planId,
    run_id: runId,
    request_id: requestId,
    operation: "train",
    backend: "local",
    attempt: 1,
    state: "supervision_lost",
    uncertainty: true,
    submission_requested: true,
    cancellation_requested: false,
    backend_status: "unknown",
    adopted: true,
  };
  const source = {
    runId,
    requestId,
    attempt: 1,
    manifest: { run_id: runId },
    runtimeRequest: { run_id: runId },
    runtimeIdentity: { run_id: runId, request_id: requestId, attempt: 1 },
    journalExit: { type: "exit", payload: { status: "completed" } },
    files: Object.fromEntries(
      [
        "manifest.json",
        "attempts/1/runtime_request.json",
        "attempts/1/runtime_identity.json",
        "attempts/1/events.jsonl",
        "checkpoints/1/COMPLETE.json",
        "checkpoints/1/model.bin",
      ].map((path) => [path, { ...digest }]),
    ),
    checkpoints: [
      {
        run_id: runId,
        attempt: 1,
        manifest_sha256: digest.sha256,
        files: { "model.bin": { ...digest } },
      },
    ],
  };
  const bodyText = JSON.stringify(adoption);
  const request = {
    method: "POST",
    path: "/api/runs/adopt",
    idempotencyKeyPresent: true,
    idempotencyKeySha256: "b".repeat(64),
    bodySha256: "c".repeat(64),
    bodyBytes: 2,
    json: { path: "/tmp/run", attempt: 1 },
  };
  const response = {
    status: 200,
    bodyText,
    json: adoption,
    bodySha256: createHash("sha256").update(bodyText).digest("hex"),
    bodyBytes: Buffer.byteLength(bodyText),
  };
  return {
    name: "standalone-adoption",
    status: "passed",
    driverReadinessMode: "sync-exposure-poll-and-two-controller-dom-observations",
    browserViewport: { width: 1280, height: 900 },
    browserProfile: { path: "/x/browser-profile", initiallyEmpty: true },
    assertions: Array.from({ length: 8 }, (_, i) => `a${i}`),
    assetManifestSha256: "a".repeat(64),
    adoption,
    actualResponses: [
      { deliveredStatus: 503, request, response },
      { deliveredStatus: 200, request, response },
    ],
    sourceBefore: { returncode: 0, cancelled: false, timedOut: false, source },
    source: {
      source,
      registry: {
        submission: null,
        execution: {
          handle_json: JSON.stringify({
            pid: null,
            supervisor_id: null,
            job_id: null,
            raw_json: '{"adopted":true}',
          }),
          cancel_delivered: 0,
        },
      },
    },
    retry: { sameRequestId: true, sameRunId: true },
    registry: {
      runState: "supervision_lost",
      adoptedHandle: '{"adopted":true}',
      submissionHandle: null,
      runtimeHandle: null,
      submissionRequested: true,
      cancellationRequested: false,
    },
    noCancellationRequest: true,
    manifest: { runId, attempt: 1, sha256: "a".repeat(64) },
    provenance: {
      manifestExists: true,
      runtimeRequestExists: true,
      checkpointExists: true,
    },
    cleanup: {
      errors: [],
      browserSessionAbsent: true,
      fixtureServicesClosed: true,
      launcherExited: true,
      removedOwnedRoots: true,
      browserProfileRemoved: true,
      privateCredentialRemoved: true,
    },
  };
}

test("complete independently captured adoption evidence passes", () => {
  assert.doesNotThrow(() => verifyAdoptionRecord(fixture(), "/x"));
});

for (const [name, mutate] of [
  [
    "false uncertainty",
    (r) => {
      r.adoption.uncertainty = false;
    },
  ],
  [
    "runtime handle",
    (r) => {
      r.registry.runtimeHandle = "pid";
    },
  ],
  [
    "retry acknowledgement still lost",
    (r) => {
      r.actualResponses[1].deliveredStatus = 503;
    },
  ],
  [
    "identity-only source",
    (r) => {
      r.source.source = r.sourceBefore.source = { runId, requestId };
    },
  ],
  [
    "missing journal",
    (r) => {
      delete r.source.source.files["attempts/1/events.jsonl"];
    },
  ],
  [
    "unfinished journal",
    (r) => {
      r.source.source.journalExit.payload.status = "failed";
    },
  ],
  [
    "empty checkpoints",
    (r) => {
      r.source.source.checkpoints = [];
    },
  ],
  [
    "checkpoint from another run",
    (r) => {
      r.source.source.checkpoints[0].run_id = planId;
    },
  ],
  [
    "checkpoint manifest mismatch",
    (r) => {
      r.source.source.checkpoints[0].manifest_sha256 = "f".repeat(64);
    },
  ],
  [
    "missing COMPLETE bytes",
    (r) => {
      delete r.source.source.files["checkpoints/1/COMPLETE.json"];
    },
  ],
  [
    "missing checkpoint file bytes",
    (r) => {
      delete r.source.source.files["checkpoints/1/model.bin"];
    },
  ],
  [
    "invalid COMPLETE digest",
    (r) => {
      r.source.source.files["checkpoints/1/COMPLETE.json"].sha256 = "bad";
    },
  ],
  [
    "foreign source path",
    (r) => {
      r.source.source.files["../outside"] = digest;
    },
  ],
]) {
  test(`rejects ${name}`, () => {
    const record = fixture();
    mutate(record);
    assert.throws(() => verifyAdoptionRecord(record, "/x"));
  });
}
