import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export function verifyAuthSkewReport(report) {
  assert.equal(report.status, "passed");
  assert.equal(report.scenario, "same-daemon-auth-skew");
  assert(["received", "element-retired-after-delivered-401"].includes(
    report.authenticationClickAcknowledgement,
  ), "Missing or unknown authentication click acknowledgement");
  assert(/^[a-f0-9]{64}$/.test(report.assetManifestSha256));
  assert(/(?:Headless)?Chrome\/\d+/.test(report.browserRuntime?.userAgent));
  assert(typeof report.browserRuntime?.headed === "boolean");
  assert(typeof report.browserRuntime?.executable === "string");
  assert(typeof report.pythonInterpreter === "string" && report.pythonInterpreter.startsWith("/"));
  assert(
    report.beforeFault.historySteps > 0 &&
      report.beforeFault.historyCanvas &&
      report.beforeFault.diagnostics,
  );
  assert.equal(report.beforeFault.selectedRun, report.approvedRunId);
  assert.equal(report.faultEvidence.length, 3);
  assert.deepEqual(
    report.faultEvidence.map((e) => e.mode),
    ["401", "build", "protocol"],
  );
  for (const e of report.faultEvidence) {
    assert.equal(e.endpoint, "/api/health");
    assert.equal(e.realStatus, 200);
    assert.equal(e.faultStatus, e.mode === "401" ? 401 : 200);
    assert.equal(e.protocolMin, 1);
    assert.equal(e.protocolMax, 1);
    assert(typeof e.daemonId === "string" && e.daemonId.length > 0);
    assert(typeof e.buildId === "string" && e.buildId.length > 0);
  }
  assert.equal(new Set(report.faultEvidence.map((e) => e.daemonId)).size, 1);
  assert.equal(new Set(report.faultEvidence.map((e) => e.buildId)).size, 1);
  assert(report.revoked.authMessage && report.revoked.reconnectPrompt);
  assert(
    !report.revoked.stalePlan && !report.revoked.staleHistory && !report.revoked.staleSelectedRun,
  );
  assert.equal(report.revoked.mutationControls, 0);
  assert(report.reauthed.connected && !report.reauthed.authMessage);
  assert.equal(report.reauthed.mutationControls, 0);
  assert.equal(report.revoked.storage.session, 0);
  assert.equal(report.revoked.storage.credential.present, false);
  assert.equal(report.revoked.storage.credential.key, "wavedl.session.v1");
  assert.equal(report.reauthed.storage.session, 1);
  assert.equal(report.reauthed.storage.credential.present, true);
  assert.equal(report.reauthed.storage.credential.key, "wavedl.session.v1");
  assert.equal(report.reauthed.storage.credential.masterTokenPresent, false);
  for (const state of [report.revoked, report.reauthed]) {
    assert.equal(state.storage.cookies, "");
    assert.deepEqual(Object.keys(state.storage).sort(), [
      "bootstrapInUrl", "cookies", "credential", "credentialInUrl", "credentialStorage", "entries", "local", "session", "valid",
    ]);
    assert.equal(state.storage.valid, true);
    assert.equal(state.storage.credentialInUrl, false);
    assert.equal(state.storage.bootstrapInUrl, false);
    assert(Array.isArray(state.storage.entries));
    assert.equal(state.storage.local, state.storage.entries.length);
    assert(state.storage.local <= 1);
    for (const entry of state.storage.entries) {
      assert.deepEqual(Object.keys(entry).sort(), ["cursor", "key"]);
      assert.equal(entry.key, `wavedl:cursor:v1:${encodeURIComponent(report.faultEvidence[0].daemonId)}:${encodeURIComponent(report.approvedRunId)}`);
      const value = entry.cursor;
      assert.deepEqual(Object.keys(value).sort(), ["attempt", "seq"]);
      assert(Number.isSafeInteger(value.attempt) && value.attempt >= 0);
      assert(Number.isSafeInteger(value.seq) && value.seq >= -1);
      assert(value.attempt !== 0 || value.seq === -1);
    }
    assert.deepEqual(Object.keys(state.storage.credential).sort(), [
      "daemonIdMatches", "expiresAtValid", "key", "masterTokenPresent", "originMatches", "present", "tokenInUrl", "valid",
    ]);
    assert.equal(state.storage.credential.tokenInUrl, false);
  }
  assert.equal(report.revoked.storage.credentialStorage, null);
  assert.equal(report.reauthed.storage.credentialStorage, "session");
  assert.deepEqual(
    report.skewObservations.map((e) => [e.mode, e.refused, e.recovery]),
    [
      ["build", true, true],
      ["protocol", true, true],
    ],
  );
  assert.equal(report.ownedArtifactsRetained, false);
  assert.equal(report.registryBeforeFault.plans, 1);
  assert.equal(report.registryBeforeFault.control.length, 1);
  assert.equal(report.registryBeforeFault.control[0][1], 1);
  assert.equal(report.registryBeforeFault.control[0][2], 0);
  const original = report.registryBeforeFault.control[0];
  assert.equal(original[3], "train");
  assert.equal(original[4], report.approvedRunId);
  const recovered = report.registryAfterRecovery.control.find((row) => row[0] === original[0]);
  assert.deepEqual(recovered, original);
  assert(report.registryAfterRecovery.plans >= report.registryBeforeFault.plans);
  assert.deepEqual(
    report.derivedPlanIds,
    report.registryAfterRecovery.control
      .filter((row) => row[0] !== original[0])
      .map((row) => row[0]),
  );
  assert.equal(
    report.registryAfterRecovery.plans - report.registryBeforeFault.plans,
    report.derivedPlanIds.length,
  );
  assert.equal(report.registryBeforeFault.manifests.length, report.registryBeforeFault.plans);
  assert.equal(report.registryAfterRecovery.manifests.length, report.registryAfterRecovery.plans);
  const derived = report.registryAfterRecovery.control.filter((row) => row[0] !== original[0]);
  assert(
    derived.length <= 1 &&
      derived.every(
        (row) =>
          row[3] === "plot" &&
          row[5] === report.approvedRunId &&
          /^gen-[0-9]{6,}$/.test(row[6]) &&
          row[2] === 0,
      ),
  );
  for (const registry of [report.registryBeforeFault, report.registryAfterRecovery]) {
    assert.equal(registry.plans, registry.control.length);
    assert.equal(new Set(registry.control.map((row) => row[0])).size, registry.plans);
    assert.equal(new Set(registry.manifests.map((entry) => entry.planId)).size, registry.plans);
    for (const row of registry.control) {
      assert.equal(row.length, 7);
      const entry = registry.manifests.find((entry) => entry.planId === row[0]);
      assert(entry && typeof entry.manifestJson === "string");
      const manifest = JSON.parse(entry.manifestJson);
      assert.equal(manifest.operation, row[3]);
      assert.equal(manifest.run_id, row[4]);
      assert.equal(manifest.checkpoint_source?.run_id ?? null, row[5]);
      assert.equal(manifest.checkpoint_source?.generation ?? null, row[6]);
      if (row[0] !== original[0]) {
        assert.equal(row[1], 1);
        assert.equal(manifest.operation, "plot");
        assert.equal(manifest.checkpoint_source?.run_id, report.approvedRunId);
        assert(/^gen-[0-9]{6,}$/.test(manifest.checkpoint_source?.generation));
        assert(/^[a-f0-9]{64}$/.test(manifest.checkpoint_source?.manifest_sha256));
        assert(/^[a-f0-9]{64}$/.test(manifest.checkpoint_source?.complete_sha256));
      }
    }
  }
  const originalManifest = report.registryBeforeFault.manifests.find(
    (entry) => entry.planId === original[0],
  );
  assert.deepEqual(
    report.registryAfterRecovery.manifests.find((entry) => entry.planId === original[0]),
    originalManifest,
  );
  if (derived.length === 0)
    assert.deepEqual(report.registryAfterRecovery, report.registryBeforeFault);
  assert.deepEqual(report.cleanup, {
    browserClosed: true,
    servicesClosed: true,
    fixtureReaped: true,
    listenerClosed: true,
    ownedRootsRemoved: true,
    browserProfileRemoved: true,
    privateCredentialRemoved: true,
    workspaceRemoved: true,
  });
  assert.equal(
    report.tokenObservation,
    "Storage is checked in-page for equality with the private master bearer; neither raw token is returned or recorded",
  );
  assert(
    report.assertions.some((value) => value.includes("real authenticated request returned 401")),
  );
  for (const mode of ["build", "protocol"])
    assert(
      report.assertions.some((value) => value.startsWith(`${mode} skew refused live authority`)),
    );
  return true;
}

export async function verifyAuthSkewFile(path) {
  const limit = 1024 * 1024;
  const before = await lstat(path);
  assert(before.isFile() && !before.isSymbolicLink() && before.size > 0 && before.size <= limit);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes;
  try {
    const opened = await handle.stat();
    assert(opened.isFile() && opened.dev === before.dev && opened.ino === before.ino);
    bytes = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = await handle.read(bytes, size, bytes.length - size, null);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    const after = await handle.stat();
    assert(size === before.size && size <= limit && after.size === before.size);
    assert(after.mtimeMs === opened.mtimeMs && after.ctimeMs === opened.ctimeMs);
    bytes = bytes.subarray(0, size);
  } finally {
    await handle.close();
  }
  const report = JSON.parse(bytes.toString("utf8"));
  verifyAuthSkewReport(report);
  const manifest = await readFile(
    fileURLToPath(new URL("../src/wavedl_daemon/web_assets/.wavedl-assets.json", import.meta.url)),
  );
  assert.equal(
    report.assetManifestSha256,
    createHash("sha256").update(manifest).digest("hex"),
    "Not current packaged assets",
  );
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  assert(process.argv[2], "Provide the dedicated JSON report path");
  await verifyAuthSkewFile(process.argv[2]);
  process.stdout.write("Auth/skew browser report verified\n");
}
