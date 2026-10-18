import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { limitation, verifyRolloverRecord } from "./verify_adoption_rollover_browser_report.mjs";

const runId = "11111111-1111-4111-8111-111111111111";
const request1 = "22222222-2222-4222-8222-222222222222";
const request2 = "33333333-3333-4333-8333-333333333333";
const planId = "44444444-4444-4444-8444-444444444444";

async function record() {
  const bodyText = JSON.stringify({
    run_id: runId,
    request_id: request2,
    plan_id: planId,
    attempt: 2,
  });
  const request = {
    method: "POST",
    path: "/api/runs/adopt",
    bodyBytes: 2,
    bodySha256: "c".repeat(64),
    idempotencyKeyPresent: true,
    idempotencyKeySha256: "b".repeat(64),
  };
  const response = {
    status: 200,
    bodyText,
    bodyBytes: Buffer.byteLength(bodyText),
    bodySha256: createHash("sha256").update(bodyText).digest("hex"),
    json: JSON.parse(bodyText),
  };
  const asset = await readFile(resolve("src/wavedl_daemon/web_assets/.wavedl-assets.json"), "utf8");
  return {
    status: "passed",
    name: "standalone-adoption-rollover",
    adoption: { run_id: runId, request_id: request2, plan_id: planId, attempt: 2, adopted: true },
    rendered: { selectedRun: runId, diagnostics: "[1:0] [2:0]" },
    boundary: {
      records: [
        {
          path: `/api/runs/${runId}/events`,
          status: 200,
          splitBytes: 100,
          interrupted: true,
          cursor: { attempt: 0, seq: -1 },
          forwardedIds: [[1, 0]],
          controlResume: { attempt: 1, seq: 0 },
          browserObserved: false,
        },
        {
          path: `/api/runs/${runId}/events`,
          status: 200,
          splitBytes: 100,
          interrupted: false,
          cursor: { attempt: 1, seq: 0 },
          forwardedIds: [[2, 0]],
          browserObserved: false,
        },
      ],
    },
    source: {
      runId,
      manifest: { run_id: runId },
      attempts: {
        1: {
          runtimeRequest: { run_id: runId },
          runtimeIdentity: { run_id: runId, request_id: request1, attempt: 1 },
          journalExit: { type: "exit", seq: 0 },
          eventIds: [[1, 0]],
        },
        2: {
          runtimeRequest: { run_id: runId },
          runtimeIdentity: { run_id: runId, request_id: request2, attempt: 2 },
          journalExit: { type: "exit", seq: 0 },
          eventIds: [[2, 0]],
        },
      },
    },
    actualResponses: [
      { deliveredStatus: 503, request, response },
      { deliveredStatus: 200, request: { ...request }, response },
    ],
    localCursor: null,
    limitation,
    assetManifestSha256: createHash("sha256").update(asset).digest("hex"),
    cleanup: {
      errors: [],
      browserSessionAbsent: true,
      fixtureServicesClosed: true,
      fixtureListenRefused: true,
      launcherExited: true,
      removedOwnedRoots: true,
      browserProfileRemoved: true,
      privateCredentialRemoved: true,
    },
  };
}

async function checked(value) {
  const root = await mkdtemp(join(tmpdir(), "wavedl-rollover-verifier-"));
  await writeFile(join(root, "standalone-adoption-rollover.json"), "{}");
  return assert.rejects(verifyRolloverRecord(value, root));
}

test("accepts a complete two-attempt rollover record", async () => {
  const root = await mkdtemp(join(tmpdir(), "wavedl-rollover-verifier-"));
  await writeFile(join(root, "standalone-adoption-rollover.json"), "{}");
  await verifyRolloverRecord(await record(), root);
});

test("rejects missing attempt transition", async () => {
  const value = await record();
  delete value.source.attempts["2"];
  await checked(value);
});
test("rejects local cursor claim", async () => {
  const value = await record();
  value.localCursor = { attempt: 2, seq: 0 };
  await checked(value);
});
test("rejects incomplete or duplicated journal sequence", async () => {
  const value = await record();
  value.source.attempts["1"].eventIds.push([1, 0]);
  await checked(value);
});
test("rejects retry with changed idempotency key", async () => {
  const value = await record();
  value.actualResponses[1].request.idempotencyKeySha256 = "d".repeat(64);
  await checked(value);
});
test("rejects unsafe adoption identifier", async () => {
  const value = await record();
  value.adoption.plan_id = "../../plan";
  await checked(value);
});
test("rejects failed cleanup", async () => {
  const value = await record();
  value.cleanup.errors = ["retained root"];
  await checked(value);
});
test("rejects missing cleanup flag", async () => {
  const value = await record();
  delete value.cleanup.privateCredentialRemoved;
  await checked(value);
});
test("rejects an unproven listener closure", async () => {
  const value = await record();
  value.cleanup.fixtureListenRefused = false;
  await checked(value);
});
test("rejects boundary status, path and byte contradictions", async () => {
  for (const change of [
    (value) => {
      value.boundary.records[1].status = 401;
    },
    (value) => {
      value.boundary.records[1].path = "/api/runs/foreign/events";
    },
    (value) => {
      value.boundary.records[1].splitBytes = Infinity;
    },
    (value) => {
      value.boundary.records[1].interrupted = true;
    },
    (value) => {
      value.source.attempts["2"].runtimeIdentity.request_id = request1;
    },
  ]) {
    const value = await record();
    change(value);
    await checked(value);
  }
});
test("rejects stale limitation text", async () => {
  const value = await record();
  value.limitation = "Private browser cursor storage is unobservable.";
  await checked(value);
});
