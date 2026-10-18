#!/usr/bin/env node
// Declared-size and traversal response faults plus explicitly fixture-created
// incomplete/active filesystem cases. No genuine oversized-file/crash claim.
import assert from "node:assert/strict";
import { constants } from "node:fs";
import { lstat, open, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
const hash = (x) => createHash("sha256").update(x).digest("hex");
const digest = /^[a-f0-9]{64}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function verifyArtifactSafetyCases(s, r) {
  assert(s && typeof s === "object");
  assert.deepEqual(s.before, s.after, "Safety cases changed durable or filesystem authority");
  assert.deepEqual(s.before.registry, r.before.registry);
  for (const [path, identity] of Object.entries(r.before.files))
    assert.deepEqual(s.before.files[path], identity, "Original training output changed");
  const t = s.traversal;
  assert.equal(t.refused, true);
  assert.deepEqual(t.downloads, []);
  const b = t.boundary;
  assert.equal(b.status, 200);
  assert.equal(b.authenticated, true);
  assert.equal(b.path, `/api/runs/${r.runId}/artifacts`);
  assert.deepEqual(b.original, r.boundary[0].original);
  for (const p of ["original", "delivered"]) {
    assert(b[p + "Bytes"] > 0 && b[p + "Bytes"] <= 262144);
    assert.equal(Buffer.byteLength(b[p + "Text"]), b[p + "Bytes"]);
    assert.equal(hash(b[p + "Text"]), b[p + "Sha256"]);
    assert.deepEqual(JSON.parse(b[p + "Text"]), b[p]);
  }
  const changed = structuredClone(b.original);
  const g = changed.generations[0];
  assert.equal(g.generation, b.generation);
  assert(g.files[b.member]);
  g.files["../manifest.json"] = g.files[b.member];
  delete g.files[b.member];
  assert.deepEqual(b.delivered, changed, "Traversal fault must change only one path");
  assert.deepEqual(s.fixture.incomplete, ["gen-999998", "gen-999999"]);
  const complete = JSON.parse(s.fixture.completeText);
  assert.equal(complete.run_id, r.runId);
  assert.equal(complete.generation, s.fixture.generation);
  assert.equal(complete.attempt, 1);
  assert.equal(complete.step, 999);
  assert.equal(complete.manifest_sha256, r.before.files[`${r.runId}/manifest.json`].sha256);
  const prefix = `${r.runId}/checkpoints/${complete.generation}/`;
  assert.deepEqual(s.before.files[prefix + "COMPLETE.json"], {size:Buffer.byteLength(s.fixture.completeText), sha256:hash(s.fixture.completeText)});
  assert.deepEqual(Object.keys(complete.files).sort(), ["active.html", "active.svg"]);
  assert.deepEqual(s.inventory.generations, [...b.original.generations, {generation:complete.generation,attempt:1,step:999,files:complete.files}]);
  assert.equal(s.before.files[`${r.runId}/checkpoints/gen-999998/COMPLETE.json`], undefined);
  assert.deepEqual(s.before.files[`${r.runId}/checkpoints/gen-999999/COMPLETE.json`], {size:18,sha256:hash('{"schema_version":')});
  for (const generation of s.fixture.incomplete)
    assert.deepEqual(s.before.files[`${r.runId}/checkpoints/${generation}/unpublished.html`], complete.files['active.html']);
  assert.equal(s.refusedPaths.length, 3);
  assert.deepEqual(s.refusedPaths.map(v=>v.suffix), ["gen-999998/unpublished.html", "gen-999999/unpublished.html", `${r.boundary[0].generation}/%252e%252e/manifest.json`]);
  for (const v of s.refusedPaths) {
    assert([400,403,404].includes(v.status));
    assert(Number.isSafeInteger(v.bytes) && v.bytes > 0 && v.bytes <= 1024);
    assert(digest.test(v.sha256));
  }
  assert.deepEqual(s.publicRows.map(row=>[row.generation,row.member]).sort(), s.inventory.generations.flatMap(g=>Object.keys(g.files).map(member=>[`${g.generation} / ${g.attempt}`,member])).sort());
  assert.deepEqual(s.attachments.map(a=>a.member), ['active.html','active.svg']);
  for (const a of s.attachments) {
    const identity = complete.files[a.member];
    assert.deepEqual(s.before.files[prefix+a.member], identity);
    assert.equal(a.status, 200);
    assert.deepEqual({size:a.size,sha256:a.sha256}, identity);
    assert.deepEqual({size:a.download.size,sha256:a.download.sha256}, identity);
    assert(typeof a.download.name === 'string' && !/[\\/]/.test(a.download.name) && a.download.name.endsWith(a.member));
    assert.deepEqual(a.headers, {'content-type':'application/octet-stream','content-disposition':`attachment; filename="${a.member}"`,'content-security-policy':"sandbox; default-src 'none'",'x-content-type-options':'nosniff'});
    assert.deepEqual(s.publicRows.find(row=>row.member===a.member)?.buttons, ['Download']);
  }
  assert.notEqual(s.attachments[0].download.name,s.attachments[1].download.name);
  assert.deepEqual(s.publicDom, {executed:false,activeEmbeds:0});
}
export function verifyArtifactPublicationRecord(r) {
  assert.equal(r.name, "artifact-publication-oversized-inventory");
  assert.equal(r.status, "passed");
  for (const field of ["error", "skip", "skipped", "skipReason", "failureStage"])
    assert(!Object.hasOwn(r, field), "Failure or skip evidence cannot pass acceptance");
  assert.equal(r.driverReadinessMode, "sync-exposure-poll-and-two-controller-dom-observations");
  assert(Array.isArray(r.assertions) && r.assertions.length >= 4);
  assert(uuid.test(r.runId));
  assert(digest.test(r.assetManifestSha256));
  assert.equal(r.boundary.length, 1);
  const b = r.boundary[0];
  assert.equal(b.kind, "oversized-inventory");
  assert.equal(b.authenticated, true);
  assert.equal(b.status, 200);
  assert.equal(b.path, `/api/runs/${r.runId}/artifacts`);
  assert(/^gen-\d{6,}$/.test(b.generation));
  assert(
    typeof b.member === "string" &&
      b.member.split("/").every((p) => p && p !== "." && p !== "..") &&
      !/[\\:%]/.test(b.member),
  );
  for (const prefix of ["original", "delivered"]) {
    assert(b[`${prefix}Bytes`] > 0 && b[`${prefix}Bytes`] <= 262144);
    assert.equal(Buffer.byteLength(b[`${prefix}Text`]), b[`${prefix}Bytes`]);
    assert.equal(hash(b[`${prefix}Text`]), b[`${prefix}Sha256`]);
    assert.deepEqual(JSON.parse(b[`${prefix}Text`]), b[prefix]);
  }
  const original = b.original.generations.find((g) => g.generation === b.generation);
  assert(original && original.files[b.member]);
  const size = original.files[b.member].size;
  assert(Number.isSafeInteger(size) && size > 0 && size < 64 * 1024 * 1024);
  const changed = structuredClone(b.original);
  changed.generations.find((g) => g.generation === b.generation).files[b.member].size =
    64 * 1024 * 1024 + 1;
  assert.deepEqual(b.delivered, changed, "Fault must change only the advertised size");
  assert.deepEqual(r.before, r.after, "Durable authority or run bytes changed");
  assert.equal(r.before.registry.runs.length, 1);
  assert.equal(r.before.registry.runs[0].run_id, r.runId);
  assert.equal(r.before.registry.runs[0].state, "completed");
  assert.equal(r.before.registry.plans.length, 1);
  assert.equal(r.before.registry.plan_control.length, 1);
  assert.equal(r.before.registry.plan_control[0].submission_requested, 1);
  assert.equal(r.before.registry.plan_control[0].cancellation_requested, 0);
  assert.equal(r.before.registry.execution_control.length, 1);
  const execution = r.before.registry.execution_control[0];
  assert.equal(execution.cancel_delivered, 0);
  const observation = JSON.parse(execution.latest_observation_json ?? execution.observation_json);
  assert.equal(observation.status, "terminal");
  assert.equal(observation.exit_code, 0);
  const files = r.before.files;
  assert(Object.keys(files).length > 4 && Object.keys(files).length <= 256);
  for (const [path, value] of Object.entries(files)) {
    assert(
      path.startsWith(r.runId + "/") && path.split("/").every((p) => p && p !== "." && p !== ".."),
    );
    assert(
      Number.isSafeInteger(value.size) &&
        value.size >= 0 &&
        value.size <= 64 * 1024 * 1024 &&
        digest.test(value.sha256),
    );
  }
  const prefix = `${r.runId}/checkpoints/${b.generation}/`;
  assert.deepEqual(files[prefix + b.member], original.files[b.member]);
  const p = r.publication;
  assert.equal(Buffer.byteLength(p.completeText), p.size);
  assert.equal(hash(p.completeText), p.sha256);
  assert.deepEqual(JSON.parse(p.completeText), p.complete);
  assert.deepEqual(files[prefix + "COMPLETE.json"], { size: p.size, sha256: p.sha256 });
  assert.equal(p.complete.run_id, r.runId);
  assert.equal(p.complete.attempt, original.attempt);
  assert.deepEqual(p.complete.files, original.files);
  assert.equal(p.complete.manifest_sha256, files[`${r.runId}/manifest.json`].sha256);
  for (const name of [
    "manifest.json",
    "attempts/1/runtime_identity.json",
    "attempts/1/events.jsonl",
  ])
    assert(files[`${r.runId}/${name}`]);
  const exit = r.before.registry.event_log
    .map((e) => JSON.parse(e.event_json))
    .find((e) => e.type === "exit");
  assert.equal(exit?.payload.status, "completed");
  assert.equal(exit.run_id, r.runId);
  assert.deepEqual(r.realArtifactResponse, {
    status: 200,
    generation: b.generation,
    member: b.member,
    ...original.files[b.member],
  });
  assert.deepEqual(r.publicDom, { refused: true, previewImages: 0, downloadLinks: 0 });
  assert.deepEqual(r.downloadNames, []);
  verifyArtifactSafetyCases(r.safetyCases, r);
  assert.deepEqual(r.cleanup.errors, []);
  for (const key of [
    "browserSessionAbsent",
    "fixtureServicesClosed",
    "launcherExited",
    "listenerRefused",
    "runtimePidsAbsent",
    "removedOwnedRoots",
    "browserProfileRemoved",
    "privateCredentialRemoved",
  ])
    assert.equal(r.cleanup[key], true, key);
  return r;
}
export async function readBoundedReport(path) {
  const before = await lstat(path);
  assert(
    before.isFile() && !before.isSymbolicLink() && before.size > 0 && before.size <= 1024 * 1024,
  );
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const first = await handle.stat();
    assert(first.isFile() && first.dev === before.dev && first.ino === before.ino);
    const bytes = Buffer.alloc(1024 * 1024 + 1);
    let n = 0;
    while (n < bytes.length) {
      const { bytesRead } = await handle.read(bytes, n, bytes.length - n, null);
      if (!bytesRead) break;
      n += bytesRead;
    }
    const after = await handle.stat();
    assert(
      n === first.size &&
        after.size === first.size &&
        after.mtimeMs === first.mtimeMs &&
        n <= 1024 * 1024,
    );
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, n)));
  } finally {
    await handle.close();
  }
}
export async function verifyArtifactPublicationReport(directory) {
  const root = resolve(directory);
  assert.deepEqual(await readdir(root), ["artifact-publication-oversized-inventory.json"]);
  const r = verifyArtifactPublicationRecord(
    await readBoundedReport(join(root, "artifact-publication-oversized-inventory.json")),
  );
  assert.equal(
    r.assetManifestSha256,
    hash(
      await readFile(
        new URL("../src/wavedl_daemon/web_assets/.wavedl-assets.json", import.meta.url),
      ),
    ),
    "Not current packaged assets",
  );
  return r;
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  await verifyArtifactPublicationReport(process.argv[2]);
  console.log("artifact publication report: valid");
}
