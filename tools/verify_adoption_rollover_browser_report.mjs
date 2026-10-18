#!/usr/bin/env node
// Read-only evidence guard for the standalone adoption rollover acceptance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_FILE_BYTES = 256 * 1024;
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const limitation =
  "Two genuine launcher attempts are initially adopted at attempt 2; no in-place re-adoption. Private browser cursor storage is unobservable. First disconnect is a bounded fixture overflow control, not genuine broker overflow.";

export async function boundedFile(path, limit = MAX_FILE_BYTES) {
  const info = await lstat(path);
  assert(info.isFile() && !info.isSymbolicLink(), "Evidence must be an ordinary file");
  assert(info.size <= limit, "Evidence file exceeds bound");
  return readFile(path, "utf8");
}

function assertSafeIds(record, source) {
  for (const value of [
    source.runId,
    record.adoption.run_id,
    record.adoption.request_id,
    record.adoption.plan_id,
  ])
    assert(uuid(value), "Unsafe adoption identifier");
  assert.equal(record.adoption.run_id, source.runId, "Adoption run identity mismatch");
  assert(
    uuid(source.attempts["1"].runtimeIdentity.request_id),
    "Unsafe attempt 1 request identifier",
  );
  assert(
    uuid(source.attempts["2"].runtimeIdentity.request_id),
    "Unsafe attempt 2 request identifier",
  );
}

function assertAttempt(attempt, number, runId) {
  assert(attempt && attempt.runtimeRequest && attempt.runtimeIdentity && attempt.journalExit);
  assert.equal(attempt.runtimeRequest.run_id, runId);
  assert.equal(attempt.runtimeIdentity.run_id, runId);
  assert.equal(attempt.runtimeIdentity.attempt, number);
  assert.equal(attempt.journalExit.type, "exit");
  assert.equal(attempt.journalExit.seq, attempt.eventIds.length - 1);
  assert(Array.isArray(attempt.eventIds) && attempt.eventIds.length > 0);
  attempt.eventIds.forEach((id, index) => {
    assert(
      Array.isArray(id) && id.length === 2 && id[0] === number && id[1] === index,
      "Full journal sequence required",
    );
  });
}

function assertResponses(record) {
  assert(
    Array.isArray(record.actualResponses) && record.actualResponses.length === 2,
    "Both lost-ack and retry responses required",
  );
  const [lost, retry] = record.actualResponses;
  assert.equal(lost.deliveredStatus, 503);
  assert.equal(retry.deliveredStatus, 200);
  const fields = ["method", "path", "bodySha256", "idempotencyKeySha256"];
  for (const field of fields)
    assert.equal(lost.request[field], retry.request[field], `Retry changed ${field}`);
  assert.equal(lost.request.idempotencyKeyPresent, true);
  assert.equal(retry.request.idempotencyKeyPresent, true);
  assert.equal(lost.request.path, "/api/runs/adopt");
  assert.equal(lost.request.method, "POST");
  assert(lost.request.bodyBytes <= MAX_FILE_BYTES && retry.request.bodyBytes <= MAX_FILE_BYTES);
  for (const response of [lost.response, retry.response]) {
    assert(response.bodyBytes <= MAX_FILE_BYTES && sha(response.bodySha256));
    assert.equal(response.bodySha256, createHash("sha256").update(response.bodyText).digest("hex"));
    assert.equal(response.json.run_id, record.adoption.run_id);
    assert.equal(response.json.request_id, record.adoption.request_id);
    assert.equal(response.json.plan_id, record.adoption.plan_id);
    assert.equal(response.json.attempt, 2);
  }
  assert.equal(lost.response.json.request_id, retry.response.json.request_id);
  assert.equal(lost.response.json.plan_id, retry.response.json.plan_id);
}

export async function verifyRolloverRecord(record, directory) {
  assert.equal(record.status, "passed");
  assert.equal(record.name, "standalone-adoption-rollover");
  assert.equal(record.adoption.attempt, 2);
  assert.equal(record.adoption.adopted, true);
  assert(record.rendered?.diagnostics?.includes("[2:"));
  assert.equal(record.rendered.selectedRun, record.source.runId);
  const source = record.source;
  assert(source && source.manifest && source.attempts && !Array.isArray(source.attempts));
  assert.deepEqual(Object.keys(source.attempts).sort(), ["1", "2"]);
  assert.equal(source.manifest.run_id, source.runId);
  assertSafeIds(record, source);
  assertAttempt(source.attempts["1"], 1, source.runId);
  assertAttempt(source.attempts["2"], 2, source.runId);
  assert.equal(source.attempts["2"].runtimeIdentity.request_id, record.adoption.request_id);
  assert.deepEqual(record.boundary.records[0].cursor, { attempt: 0, seq: -1 });
  assert.deepEqual(record.boundary.records[0].controlResume, { attempt: 1, seq: 0 });
  assert.deepEqual(record.boundary.records[1].cursor, { attempt: 1, seq: 0 });
  assert.equal(record.boundary.records.length, 2);
  for (const entry of record.boundary.records) {
    assert.equal(entry.path, `/api/runs/${source.runId}/events`);
    assert.equal(entry.status, 200);
    assert(
      Number.isSafeInteger(entry.splitBytes) &&
        entry.splitBytes > 0 &&
        entry.splitBytes <= 16 * 1024 * 1024,
    );
  }
  assert.equal(record.boundary.records[0].interrupted, true);
  assert.equal(record.boundary.records[1].interrupted, false);
  const forwarded = record.boundary.records.flatMap((entry) => entry.forwardedIds);
  const sourceIds = [...source.attempts["1"].eventIds, ...source.attempts["2"].eventIds];
  assert.deepEqual(
    forwarded,
    sourceIds,
    "Boundary must forward each historical event exactly once in order",
  );
  assert(record.boundary.records.every((entry) => entry.browserObserved === false));
  assert.equal(record.localCursor, null);
  assert.equal(record.limitation, limitation);
  assert(record.cleanup && record.cleanup.errors.length === 0);
  for (const key of [
    "browserSessionAbsent",
    "fixtureServicesClosed",
    "fixtureListenRefused",
    "launcherExited",
    "removedOwnedRoots",
    "browserProfileRemoved",
    "privateCredentialRemoved",
  ])
    assert.equal(record.cleanup[key], true, `Cleanup flag ${key} missing`);
  assertResponses(record);
  const assetPath = join(repository, "src/wavedl_daemon/web_assets/.wavedl-assets.json");
  const assetBytes = await boundedFile(assetPath, 8 * 1024 * 1024);
  assert.equal(
    record.assetManifestSha256,
    createHash("sha256").update(assetBytes).digest("hex"),
    "Not current packaged assets",
  );
  assert.deepEqual((await readdir(directory)).sort(), ["standalone-adoption-rollover.json"]);
  return record;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = resolve(process.argv[2]);
  const report = JSON.parse(
    await boundedFile(join(directory, "standalone-adoption-rollover.json")),
  );
  await verifyRolloverRecord(report, directory);
  console.log("standalone adoption rollover report: valid");
}
