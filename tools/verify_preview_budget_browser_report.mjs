import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { boundedFile } from "./verify_retained_browser_report.mjs";
import { currentAssetDigest } from "./verify_adoption_negative_browser_report.mjs";

const limits = {
  max_file_bytes: 32768,
  max_decompressed_bytes: 67108864,
  max_elements: 8388608,
  max_sample_rows: 512,
  max_input_features: 64,
  max_output_features: 256,
  max_preview_elements: 16384,
  max_output_bytes: 200000,
  max_zip_ratio: 100,
  max_variables: 128,
  max_header_bytes: 16384,
};

function verifyPaintedPreview(observation) {
  assert.equal(observation.connected, true);
  assert.equal(observation.loading, false);
  assert(observation.canvases > 0 && observation.figures > 0);
  assert.equal(observation.rasters.length, observation.canvases);
  for (const raster of observation.rasters) {
    assert.equal(raster.painted, true);
    for (const dimension of [raster.width, raster.height]) {
      assert(Number.isSafeInteger(dimension) && dimension > 0 && dimension <= 4096);
    }
  }
}

function verifyProcess(process) {
  assert(Number.isSafeInteger(process.pid) && process.pid > 0);
  assert.equal(process.pidAbsent, true);
  assert.equal(process.cancelled, false);
  assert.equal(process.timedOut, false);
  assert.equal(process.stdoutTruncated, false);
  assert.equal(process.stdoutBytes, Buffer.byteLength(process.stdoutText));
  assert(process.stdoutBytes <= 1048576);
  assert.equal(
    process.stdoutSha256,
    createHash("sha256").update(process.stdoutText).digest("hex"),
  );
  assert.equal(process.originalArgv[1], "-m");
  assert.equal(process.originalArgv[2], "wavedl.core.dataset_preview");
  const identityIndex = process.originalArgv.indexOf("--expected-identity") + 1;
  const expected = JSON.parse(process.originalArgv[identityIndex]);
  const refusedPaths = { 2: "compressed.npz", 4: "features.npz" };
  assert.equal(expected.root_id, "datasets");
  assert.equal(expected.relative_path, refusedPaths[process.phase] ?? "samples.npz");
  assert.equal(
    process.originalArgv[process.originalArgv.indexOf("--path") + 1],
    expected.path,
  );
  for (const [name, value] of Object.entries(limits)) {
    const flag = "--" + name.replaceAll("_", "-");
    const index = process.originalArgv.indexOf(flag);
    assert(index > 0);
    assert.equal(process.originalArgv[index + 1], String(value));
  }
  const decoded = JSON.parse(process.stdoutText);
  if ([2, 4].includes(process.phase)) {
    assert.equal(process.returncode, 1);
    assert.deepEqual(decoded, { error: "Dataset preview refused", code: "too_large" });
  } else {
    assert.equal(process.returncode, 0);
    assert.deepEqual(decoded.input_shape, [96, 32]);
    assert.deepEqual(decoded.output_shape, [96, 1]);
    assert.equal(decoded.limits.max_sample_rows, 512);
  }
}

function verifyResponse(response) {
  assert.equal(response.method, "POST");
  assert.equal(response.path, "/api/datasets/preview");
  assert.deepEqual(response.request, {
    root: "datasets", path: response.request.path, view: "all",
  });
  assert.equal(response.requestComplete, true);
  assert.equal(response.responseComplete, true);
  assert.deepEqual(JSON.parse(response.requestText), response.request);
  assert.deepEqual(JSON.parse(response.responseText), response.response);
  for (const kind of ["request", "response"]) {
    const text = response[kind + "Text"];
    assert.equal(response[kind + "Bytes"], Buffer.byteLength(text));
    assert.equal(response[kind + "Sha256"], createHash("sha256").update(text).digest("hex"));
  }
  if (response.status === 413) {
    assert.deepEqual(response.response, { error: "Request too large" });
  } else {
    assert.deepEqual(response.response.input_shape, [96, 32]);
    assert.deepEqual(response.response.output_shape, [96, 1]);
    assert.equal(response.response.limits.max_sample_rows, 512);
  }
}

/** Check substantive evidence before deletion, then require final cleanup on disk. */
export function verifyPreviewBudgetRecord(record, { cleanupPending = false } = {}) {
  assert.equal(record.name, "dataset-preview-budget");
  assert.equal(record.status, "passed");
  for (const key of [
    "error", "skip", "skipped", "skipReason", "retainedPrivateRoots",
    "explicitFixtureWebAssets", "authoringEventDiagnostic", "shutdownError",
    "failed", "failureStage", "failureDom", "fixtureStderrDiagnostic",
  ]) {
    assert(!Object.hasOwn(record, key));
  }
  assert.equal(
    record.driverReadinessMode,
    "sync-exposure-poll-and-two-controller-dom-observations",
  );
  assert(record.browser.includes("agent-browser"));
  assert.equal(record.initialProfileEmpty, true);
  assert.match(record.browserObserved.userAgent, /Chrome\/[0-9]+/);
  assert.deepEqual({ ...record.browserObserved, userAgent: "Chrome" }, {
    userAgent: "Chrome", width: 1280, height: 900, cookies: "",
    localStorageKeys: [], sessionStorageKeys: [],
  });
  assert.deepEqual(record.cleanup, {
    errors: [], browserSessionAbsent: true, fixtureReaped: true,
    servicesClosed: true, listenerClosed: true,
    ownedRootsRemoved: !cleanupPending,
    browserProfileRemoved: !cleanupPending,
    privateCredentialRemoved: !cleanupPending,
  });
  assert.deepEqual(record.drained, { outstanding: 0 });
  const counts = Object.fromEntries([
    "plans", "plan_control", "execution_control", "submission_control",
    "runs", "runtime_provenance", "event_log",
  ].map(name => [name, 0]));
  assert.deepEqual(record.before.counts, counts);
  assert.deepEqual(record.after, record.before);
  assert.deepEqual(Object.keys(record.before.sources).sort(), [
    "bytes.npz", "compressed.npz", "features.npz", "samples.npz",
  ]);
  for (const source of Object.values(record.before.sources)) {
    assert(Number.isSafeInteger(source.size) && source.size > 0 && source.size < 100000);
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
  }
  assert.deepEqual(record.witness.limits, limits);
  assert.deepEqual(record.witness.control, {
    input_shape: [10000, 10], output_shape: [10000, 1],
    sample_count: 512, max_zip_ratio: 10000,
  });
  assert.deepEqual(record.witness.members.map(member => member.name), ["X.npy", "y.npy"]);
  assert(record.witness.members.some(member => member.expanded > member.compressed * 100));
  for (const member of record.witness.members) {
    assert(Number.isSafeInteger(member.expanded) && member.expanded > 0 && member.expanded < 1000000);
    assert(Number.isSafeInteger(member.compressed) && member.compressed > 0);
  }
  assert(record.before.sources["compressed.npz"].size < limits.max_file_bytes);
  assert(record.before.sources["features.npz"].size < limits.max_file_bytes);
  assert(record.before.sources["bytes.npz"].size > limits.max_file_bytes);
  verifyPaintedPreview(record.initial);
  assert.deepEqual(record.refusals.map(item => item.name), [
    "compressed.npz", "features.npz", "bytes.npz",
  ]);
  for (const [index, item] of record.refusals.entries()) {
    assert.deepEqual(item.refused, {
      message: "The daemon request failed. Verify connectivity and the operation outcome before retrying.",
      canvases: 0, figures: 0, loading: false, connected: true, rasters: [],
    });
    assert.deepEqual(item.capacity, { phase: [2, 4, 5][index], outstanding: 0 });
    assert.deepEqual(item.unchanged, record.before);
    verifyPaintedPreview(item.retry);
  }
  // The file-byte gate refuses before spawning: seven requests, six children.
  assert.equal(record.processes.length, 6);
  assert.deepEqual(record.processes.map(process => process.phase), [1, 2, 3, 4, 5, 6]);
  assert.equal(new Set(record.processes.map(process => process.pid)).size, 6);
  record.processes.forEach(verifyProcess);
  assert.equal(record.responses.length, 7);
  assert.deepEqual(record.responses.map(response => response.status), [200, 413, 200, 413, 200, 413, 200]);
  assert.deepEqual(record.responses.map(response => response.request.path), [
    "samples.npz", "compressed.npz", "samples.npz", "features.npz",
    "samples.npz", "bytes.npz", "samples.npz",
  ]);
  record.responses.forEach(verifyResponse);
  const successfulResponses = record.responses.filter(response => response.status === 200);
  const successfulProcesses = record.processes.filter(process => process.returncode === 0);
  assert.equal(successfulResponses.length, successfulProcesses.length);
  successfulProcesses.forEach((process, index) => {
    const response = successfulResponses[index].response;
    const { selection, view, ...payload } = response;
    assert.deepEqual(selection, { root: "datasets", path: "samples.npz" });
    assert.equal(view, "all");
    assert.deepEqual(payload, JSON.parse(process.stdoutText));
  });
  assert.equal(
    record.limitation,
    "Fixture-only valid numeric resource witnesses; default ZIP ratio and explicit lower file/feature caps; no remote or site certification.",
  );
  return true;
}

/** Bind an ordinary bounded report to the current complete asset inventory. */
export async function verifyPreviewBudgetFile(path) {
  const content = await boundedFile(path, 8 * 1024 * 1024);
  const record = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content));
  verifyPreviewBudgetRecord(record);
  assert.equal(record.assetManifestSha256, await currentAssetDigest());
  return record;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await verifyPreviewBudgetFile(process.argv[2]);
  console.log("preview budget browser report: verified");
}
