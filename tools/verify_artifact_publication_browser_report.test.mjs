import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  verifyArtifactPublicationRecord,
  readBoundedReport,
} from "./verify_artifact_publication_browser_report.mjs";
const hash = (s) => createHash("sha256").update(s).digest("hex");
function positive() {
  const runId = "00000000-0000-4000-8000-000000000001",
    generation = "gen-000001",
    member = "pytorch_model.bin";
  const identity = { size: 10, sha256: hash("0123456789") };
  const manifest = { size: 10, sha256: "a".repeat(64) };
  const complete = {
    run_id: runId,
    attempt: 1,
    manifest_sha256: manifest.sha256,
    files: { [member]: identity },
  };
  const completeText = JSON.stringify(complete);
  const original = {
    generations: [{ generation, attempt: 1, step: 1, files: { [member]: identity } }],
  };
  const delivered = structuredClone(original);
  delivered.generations[0].files[member].size = 67108865;
  const boundary = {
    kind: "oversized-inventory",
    status: 200,
    authenticated: true,
    path: `/api/runs/${runId}/artifacts`,
    member,
    generation,
    original,
    delivered,
  };
  for (const p of ["original", "delivered"]) {
    boundary[p + "Text"] = JSON.stringify(boundary[p]);
    boundary[p + "Bytes"] = Buffer.byteLength(boundary[p + "Text"]);
    boundary[p + "Sha256"] = hash(boundary[p + "Text"]);
  }
  const before = {
    registry: {
      runs: [{ run_id: runId, state: "completed" }],
      plans: [{}],
      plan_control: [{ submission_requested: 1, cancellation_requested: 0 }],
      execution_control: [
        {
          cancel_delivered: 0,
          observation_json: JSON.stringify({ status: "terminal", exit_code: 0 }),
        },
      ],
      event_log: [
        {
          event_json: JSON.stringify({
            run_id: runId,
            type: "exit",
            payload: { status: "completed" },
          }),
        },
      ],
    },
    files: {
      [`${runId}/manifest.json`]: manifest,
      [`${runId}/attempts/1/runtime_identity.json`]: manifest,
      [`${runId}/attempts/1/events.jsonl`]: manifest,
      [`${runId}/checkpoints/${generation}/${member}`]: identity,
      [`${runId}/checkpoints/${generation}/COMPLETE.json`]: {
        size: completeText.length,
        sha256: hash(completeText),
      },
    },
  };
  const traversal = structuredClone(boundary);
  traversal.delivered = structuredClone(original);
  traversal.delivered.generations[0].files = {'../manifest.json':identity};
  traversal.deliveredText = JSON.stringify(traversal.delivered);
  traversal.deliveredBytes = Buffer.byteLength(traversal.deliveredText);
  traversal.deliveredSha256 = hash(traversal.deliveredText);
  const activeFiles = {'active.html':identity,'active.svg':identity};
  const activeComplete = {...complete,generation:'gen-000002',step:999,files:activeFiles};
  const completeTextActive = JSON.stringify(activeComplete);
  const safetyBefore = structuredClone(before);
  for (const [name,record] of Object.entries(activeFiles)) safetyBefore.files[`${runId}/checkpoints/gen-000002/${name}`]=record;
  safetyBefore.files[`${runId}/checkpoints/gen-000002/COMPLETE.json`]={size:Buffer.byteLength(completeTextActive),sha256:hash(completeTextActive)};
  for (const g of ['gen-999998','gen-999999']) safetyBefore.files[`${runId}/checkpoints/${g}/unpublished.html`]=identity;
  safetyBefore.files[`${runId}/checkpoints/gen-999999/COMPLETE.json`]={size:18,sha256:hash('{"schema_version":')};
  const safetyInventory = {generations:[...original.generations,{generation:'gen-000002',attempt:1,step:999,files:activeFiles}]};
  const safetyCases = {
    traversal:{boundary:traversal,refused:true,downloads:[]},
    fixture:{generation:'gen-000002',completeText:completeTextActive,incomplete:['gen-999998','gen-999999']},
    before:safetyBefore,after:structuredClone(safetyBefore),inventory:safetyInventory,
    refusedPaths:['gen-999998/unpublished.html','gen-999999/unpublished.html',`${generation}/%252e%252e/manifest.json`].map(suffix=>({suffix,status:404,bytes:10,sha256:hash('not found!')})),
    publicRows:safetyInventory.generations.flatMap(g=>Object.keys(g.files).map(member=>({generation:`${g.generation} / ${g.attempt}`,member,buttons:['Download']}))),
    attachments:Object.keys(activeFiles).map(member=>({member,status:200,...identity,download:{name:`provenance-${member}`,...identity},headers:{'content-type':'application/octet-stream','content-disposition':`attachment; filename="${member}"`,'content-security-policy':"sandbox; default-src 'none'",'x-content-type-options':'nosniff'}})),
    publicDom:{executed:false,activeEmbeds:0},
  };
  return {
    name: "artifact-publication-oversized-inventory",
    status: "passed",
    driverReadinessMode: "sync-exposure-poll-and-two-controller-dom-observations",
    assertions: ["a", "b", "c", "d"],
    runId,
    assetManifestSha256: "b".repeat(64),
    boundary: [boundary],
    before,
    after: structuredClone(before),
    publication: { complete, completeText, size: completeText.length, sha256: hash(completeText) },
    realArtifactResponse: { status: 200, generation, member, ...identity },
    publicDom: { refused: true, previewImages: 0, downloadLinks: 0 },
    downloadNames: [],
    cleanup: {
      errors: [],
      browserSessionAbsent: true,
      fixtureServicesClosed: true,
      launcherExited: true,
      listenerRefused: true,
      runtimePidsAbsent: true,
      removedOwnedRoots: true,
      browserProfileRemoved: true,
      privateCredentialRemoved: true,
    },
    safetyCases,
  };
}
test("accepts complete contract fixture (not browser evidence)", () =>
  verifyArtifactPublicationRecord(positive()));
for (const field of ["error", "skip", "skipped", "skipReason", "failureStage"])
  test(`rejects passed evidence containing ${field}`, () => {
    const record = positive();
    record[field] = false;
    assert.throws(() => verifyArtifactPublicationRecord(record));
  });
for (const [name, mutate] of [
  ["missing evidence", (r) => (r.boundary = [])],
  ["missing safety cases", (r) => delete r.safetyCases],
  ["unsafe preview", (r) => (r.safetyCases.publicDom.activeEmbeds=1)],
  ["active execution", (r) => (r.safetyCases.publicDom.executed=true)],
  ["active inline response", (r) => (r.safetyCases.attachments[0].headers['content-disposition']='inline')],
  ["active browser bytes differ", (r) => (r.safetyCases.attachments[0].download.sha256='c'.repeat(64))],
  ["active preview offered", (r) => r.safetyCases.publicRows.find(x=>x.member==='active.svg').buttons.push('View PNG')],
  ["incomplete listed", (r) => r.safetyCases.inventory.generations.push({generation:'gen-999998',attempt:1,step:0,files:{}})],
  ["traversal accepted", (r) => (r.safetyCases.refusedPaths[2].status=200)],
  ["traversal refusal missing", (r) => (r.safetyCases.traversal.refused=false)],
  ["traversal fault differs", (r) => (r.safetyCases.traversal.boundary.deliveredSha256='c'.repeat(64))],
  ["safety authority changed", (r) => (r.safetyCases.after.registry.plan_control[0].cancellation_requested=1)],
  ["artifact GET observed", (r) => r.boundary.push({ kind: "artifact-get" })],
  ["unauthenticated inventory", (r) => (r.boundary[0].authenticated = false)],
  ["upstream failure", (r) => (r.boundary[0].status = 403)],
  [
    "false oversized claim",
    (r) => (r.boundary[0].delivered.generations[0].files["pytorch_model.bin"].size = 67108864),
  ],
  ["modified digest", (r) => (r.boundary[0].originalSha256 = "c".repeat(64))],
  ["missing actual download proof", (r) => delete r.realArtifactResponse],
  ["wrong actual bytes", (r) => (r.realArtifactResponse.sha256 = "c".repeat(64))],
  ["COMPLETE mismatch", (r) => (r.publication.sha256 = "c".repeat(64))],
  ["authority mutated", (r) => (r.after.registry.plan_control[0].cancellation_requested = 1)],
  [
    "checkpoint changed",
    (r) =>
      (r.after.files[`${r.runId}/checkpoints/gen-000001/pytorch_model.bin`].sha256 = "c".repeat(
        64,
      )),
  ],
  [
    "runtime failure",
    (r) => (r.before.registry.runs[0].state = r.after.registry.runs[0].state = "failed"),
  ],
  ["public refusal missing", (r) => (r.publicDom.refused = false)],
  ["download published", (r) => r.downloadNames.push("artifact.bin")],
  ["preview published", (r) => (r.publicDom.previewImages = 1)],
  ["session retained", (r) => (r.cleanup.browserSessionAbsent = false)],
  ["listener retained", (r) => (r.cleanup.listenerRefused = false)],
  ["profile retained", (r) => (r.cleanup.browserProfileRemoved = false)],
  ["credential retained", (r) => (r.cleanup.privateCredentialRemoved = false)],
  ["runtime alive", (r) => (r.cleanup.runtimePidsAbsent = false)],
  ["cleanup failure", (r) => r.cleanup.errors.push("failed")],
])
  test(`rejects ${name}`, () => {
    const r = positive();
    mutate(r);
    assert.throws(() => verifyArtifactPublicationRecord(r));
  });
test("bounded no-follow report reader rejects empty, symlink, and oversize files", async () => {
  const root = await mkdtemp(join(tmpdir(), "artifact-report-test-"));
  try {
    await writeFile(join(root, "empty"), "");
    await assert.rejects(readBoundedReport(join(root, "empty")));
    await writeFile(join(root, "large"), Buffer.alloc(1048577));
    await assert.rejects(readBoundedReport(join(root, "large")));
    await writeFile(join(root, "ordinary"), "{}");
    await symlink(join(root, "ordinary"), join(root, "link"));
    await assert.rejects(readBoundedReport(join(root, "link")));
    await writeFile(
      join(root, "invalid-utf8"),
      Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125]),
    );
    await assert.rejects(readBoundedReport(join(root, "invalid-utf8")));
    assert.deepEqual(await readBoundedReport(join(root, "ordinary")), {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
