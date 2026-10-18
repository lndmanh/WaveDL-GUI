#!/usr/bin/env node
// Fail-closed verifier for the standalone adoption browser acceptance report.
import assert from "node:assert/strict";
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const maxBytes = 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function readBounded(path) {
  const before = await lstat(path);
  assert(before.isFile() && !before.isSymbolicLink() && before.size > 0 && before.size <= maxBytes);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    assert(stat.dev === before.dev && stat.ino === before.ino && stat.isFile());
    const bytes = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < bytes.length) {
      const result = await handle.read(bytes, size, bytes.length - size, null);
      if (!result.bytesRead) break;
      size += result.bytesRead;
    }
    assert(size > 0 && size <= maxBytes);
    return JSON.parse(bytes.subarray(0, size).toString("utf8"));
  } finally {
    await handle.close();
  }
}

export function verifyAdoptionRecord(record, directory) {
  assert(record && typeof record === "object" && !Array.isArray(record));
  assert.equal(record.name, "standalone-adoption");
  assert.equal(record.status, "passed");
  assert.equal(
    record.driverReadinessMode,
    "sync-exposure-poll-and-two-controller-dom-observations",
  );
  assert.deepEqual(record.browserViewport, { width: 1280, height: 900 });
  assert(record.browserProfile?.initiallyEmpty === true);
  assert.equal(record.browserProfile.path, join(directory, "browser-profile"));
  assert(Array.isArray(record.assertions) && record.assertions.length >= 8);
  assert(
    typeof record.assetManifestSha256 === "string" &&
      /^[a-f0-9]{64}$/.test(record.assetManifestSha256),
  );
  assert(record.actualResponses?.length === 2);
  assert.equal(record.actualResponses[0].deliveredStatus, 503);
  assert.equal(record.actualResponses[0].response.status, 200);
  assert.equal(record.actualResponses[1].response.status, 200);
  assert.equal(record.actualResponses[1].deliveredStatus, 200);
  assert.deepEqual(record.actualResponses[0].request, record.actualResponses[1].request);
  for (const capture of record.actualResponses) {
    assert.equal(capture.request.path, "/api/runs/adopt");
    assert.equal(capture.request.method, "POST");
    assert.equal(capture.request.idempotencyKeyPresent, true);
    assert(/^[a-f0-9]{64}$/.test(capture.request.idempotencyKeySha256));
    assert(/^[a-f0-9]{64}$/.test(capture.request.bodySha256));
    assert(Number.isInteger(capture.request.bodyBytes) && capture.request.bodyBytes > 0);
    assert.equal(capture.request.json?.attempt, 1);
    assert.equal(
      capture.response.bodySha256,
      createHash("sha256").update(capture.response.bodyText).digest("hex"),
    );
    assert.equal(capture.response.bodyBytes, Buffer.byteLength(capture.response.bodyText));
    assert.deepEqual(JSON.parse(capture.response.bodyText), capture.response.json);
    assert.deepEqual(capture.response.json, record.adoption);
  }
  assert(record.sourceBefore?.source && record.source?.source);
  assert.deepEqual(
    record.sourceBefore.source,
    record.source.source,
    "Standalone bytes changed during adoption",
  );
  // The report must carry independent, file-level evidence.  Merely repeating
  // runId/requestId (or a set of registry booleans) is not provenance: a
  // broken fixture could manufacture those values without ever reading the
  // completed standalone run.
  const source = record.source.source;
  assert(source.manifest && source.runtimeRequest && source.runtimeIdentity);
  assert.equal(source.manifest.run_id, record.adoption.run_id);
  assert.equal(source.runtimeRequest.run_id, record.adoption.run_id);
  assert.equal(source.runtimeIdentity.run_id, record.adoption.run_id);
  assert.equal(source.runtimeIdentity.request_id, record.adoption.request_id);
  assert.equal(source.runtimeIdentity.attempt, 1);
  assert.equal(source.journalExit?.type, "exit");
  assert.equal(source.journalExit?.payload?.status, "completed");
  assert(Array.isArray(source.checkpoints) && source.checkpoints.length > 0);
  assert(source.files && typeof source.files === "object" && !Array.isArray(source.files));
  for (const [path, digest] of Object.entries(source.files)) {
    assert(path && !path.startsWith("/") && !path.includes("\\"));
    assert(path.split("/").every((part) => part && part !== "." && part !== ".."));
    assert(
      digest &&
        Number.isInteger(digest.size) &&
        digest.size >= 0 &&
        digest.size <= 64 * 1024 * 1024,
    );
    assert(/^[a-f0-9]{64}$/.test(digest.sha256));
  }
  for (const path of [
    "manifest.json",
    "attempts/1/runtime_request.json",
    "attempts/1/runtime_identity.json",
    "attempts/1/events.jsonl",
  ]) {
    const digest = source.files[path];
    assert(digest && Number.isInteger(digest.size) && digest.size > 0);
    assert(/^[a-f0-9]{64}$/.test(digest.sha256));
  }
  const checkpointPaths = Object.keys(source.files).filter((path) =>
    path.endsWith("/COMPLETE.json"),
  );
  assert.equal(checkpointPaths.length, source.checkpoints.length);
  for (const [index, checkpoint] of source.checkpoints.entries()) {
    assert.equal(checkpoint.run_id, record.adoption.run_id);
    assert.equal(checkpoint.attempt, 1);
    assert(checkpoint.manifest_sha256 === source.files["manifest.json"].sha256);
    assert(
      checkpoint.files && typeof checkpoint.files === "object" && !Array.isArray(checkpoint.files),
    );
    assert(Object.keys(checkpoint.files).length > 0);
    const prefix = checkpointPaths.sort()[index].slice(0, -"COMPLETE.json".length);
    for (const [name, digest] of Object.entries(checkpoint.files)) {
      assert(name && name !== "." && name !== ".." && !/[\\/]/.test(name));
      assert(digest && Number.isInteger(digest.size) && digest.size >= 0);
      assert(/^[a-f0-9]{64}$/.test(digest.sha256));
      assert.deepEqual(
        source.files[prefix + name],
        digest,
        "Missing independently read checkpoint bytes",
      );
    }
  }
  assert.equal(record.source.registry.submission, null);
  assert.equal(record.sourceBefore.returncode, 0);
  assert.equal(record.sourceBefore.cancelled, false);
  assert.equal(record.sourceBefore.timedOut, false);
  const handle = JSON.parse(record.source.registry.execution.handle_json);
  assert.equal(handle.pid, null);
  assert.equal(handle.supervisor_id, null);
  assert.equal(handle.job_id, null);
  assert.deepEqual(JSON.parse(handle.raw_json), { adopted: true });
  assert.equal(record.source.registry.execution.cancel_delivered, 0);
  assert(record.adoption && typeof record.adoption === "object");
  for (const field of ["plan_id", "run_id", "request_id"])
    assert(uuid.test(record.adoption[field]));
  assert.equal(record.adoption.attempt, 1);
  assert.equal(record.adoption.state, "supervision_lost");
  assert.equal(record.adoption.uncertainty, true);
  assert.equal(record.adoption.submission_requested, true);
  assert.equal(record.adoption.cancellation_requested, false);
  assert.equal(record.adoption.backend_status, "unknown");
  assert.equal(record.adoption.adopted, true);
  assert.equal(record.source.source.runId, record.adoption.run_id);
  assert.equal(record.source.source.requestId, record.adoption.request_id);
  assert.equal(record.retry?.sameRequestId, true);
  assert.equal(record.retry?.sameRunId, true);
  assert.equal(record.registry?.runState, "supervision_lost");
  assert.equal(record.registry?.adoptedHandle, '{"adopted":true}');
  assert.equal(record.registry?.submissionHandle, null);
  assert.equal(record.registry?.runtimeHandle, null);
  assert.equal(record.registry?.submissionRequested, true);
  assert.equal(record.registry?.cancellationRequested, false);
  assert.equal(record.noCancellationRequest, true);
  assert.equal(record.manifest?.runId, record.adoption.run_id);
  assert.equal(record.manifest?.attempt, 1);
  assert(
    typeof record.manifest?.sha256 === "string" && /^[a-f0-9]{64}$/.test(record.manifest.sha256),
  );
  assert.deepEqual(record.provenance, {
    manifestExists: true,
    runtimeRequestExists: true,
    checkpointExists: true,
  });
  assert(record.cleanup && record.cleanup.errors?.length === 0);
  for (const field of [
    "browserSessionAbsent",
    "fixtureServicesClosed",
    "launcherExited",
    "removedOwnedRoots",
    "browserProfileRemoved",
    "privateCredentialRemoved",
  ])
    assert.equal(record.cleanup[field], true);
  assert(!Object.hasOwn(record.cleanup, "retainedPrivateRoots"));
  return record;
}

export async function verifyAdoptionReport(directory) {
  const root = resolve(directory);
  const entries = await readdir(root);
  assert.deepEqual(
    entries.sort(),
    ["standalone-adoption.json"],
    "Unexpected private evidence in report root",
  );
  const record = verifyAdoptionRecord(await readBounded(join(root, entries[0])), root);
  const manifest = await readFile(
    fileURLToPath(new URL("../src/wavedl_daemon/web_assets/.wavedl-assets.json", import.meta.url)),
  );
  assert.equal(
    record.assetManifestSha256,
    createHash("sha256").update(manifest).digest("hex"),
    "Not current packaged assets",
  );
  return record;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const directory = process.argv[2];
  if (!directory) throw new Error("Usage: verify_adoption_browser_report.mjs REPORT_DIR");
  await verifyAdoptionReport(directory);
  console.log("standalone adoption report: valid");
}
