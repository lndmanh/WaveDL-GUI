import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { verifyCvParityRecord } from "./verify_cv_parity_browser_report.mjs";

function rawFixture() {
  const identity = { size: 200, sha256: "a".repeat(64) };
  const publication = (runId, generation, kind, fold) => ({ generation,
    classification: { kind, ...(fold ? { fold } : {}) },
    complete: { run_id: runId, attempt: 1, files: { "predictions.csv": identity } } });
  const plan = { operation: "test", run_id: "evaluation", runtime: { device: "cpu" },
    resolved_config: { save_predictions: true, export: null }, checkpoint_source: { run_id: "training", generation: "gen-000002" } };
  const artifact = { generation: "gen-000001", path: "predictions.csv", ...identity };
  return { name: "cv-parity", status: "passed", driverReadinessMode: "sync-exposure-poll-and-two-controller-dom-observations",
    cleanup: { errors: [], browserSessionAbsent: true, fixtureServicesClosed: true, fixtureExit: { code: null, signal: "SIGINT" }, removedOwnedRoots: true },
    authoredConfiguration: { deterministic: true }, deterministicCheckboxChecked: true,
    approvedPlan: JSON.stringify({ run_id: "training", resolved_config: { cv: 2, epochs: 1, deterministic: true }, runtime: { device: "cpu" } }),
    sourceGenerationClassifications: [1, 2, 3].map((n) => ({ value: `gen-00000${n}`, label: n === 3 ? "cross validation summary" : `cross validation fold ${n}`, disabled: n === 3 })),
    summaryRefusal: { summaryDisabled: true, help: true }, foldEvaluationPlan: plan,
    noAutomaticFoldPlot: { plans: 1, runs: [{ run_id: "training", state: "completed" }] },
    predictionsDownload: artifact, cvParity: { sourcePublications: [publication("training", "gen-000001", "cross_validation_fold", 1), publication("training", "gen-000002", "cross_validation_fold", 2), publication("training", "gen-000003", "cross_validation_summary")],
      summary: { folds: 2, fold_results: [{ fold: 1 }, { fold: 2 }] }, selectedFold: 2, resultManifest: plan,
      resultPublications: [publication("evaluation", "gen-000001", "result")], artifact, predictionRows: 32 },
    finalRegistry: { plans: 2, runs: ["training", "evaluation"].map(run_id => ({ run_id, state: "completed" })), control: [1, 2].map(() => ({ submission_requested: 1, cancellation_requested: 0 })), executions: [1, 2].map(() => ({ observed_status: "terminal" })) } };
}
function fixture() {
  const r = rawFixture();
  const hash = text => createHash("sha256").update(text).digest("hex");
  const ids = { training: "11111111-1111-4111-8111-111111111111", evaluation: "22222222-2222-4222-8222-222222222222" };
  let encoded = JSON.stringify(r);
  for (const [old, id] of Object.entries(ids)) encoded = encoded.split(old).join(id);
  const value = JSON.parse(encoded);
  const approved = JSON.parse(value.approvedPlan);
  approved.run_id = ids.training;
  value.approvedPlan = JSON.stringify(approved);
  value.cleanup.browserProfileRemoved = true;
  value.finalRegistry.control.forEach((item, index) => { item.plan_id = String(index); });
  const d = value.cvParity;
  d.summaryText = JSON.stringify(d.summary);
  d.sourcePublications[2].complete.files["cv_summary.json"] = { size: Buffer.byteLength(d.summaryText), sha256: hash(d.summaryText) };
  d.predictionRows = 96;
  d.predictionHeader = ["True_P0", "Pred_P0", "Error_P0", "AbsError_P0"];
  d.predictionText = d.predictionHeader.join(",") + "\n" + "1,2,1,1\n".repeat(96);
  const csvIdentity = { size: Buffer.byteLength(d.predictionText), sha256: hash(d.predictionText) };
  Object.assign(value.predictionsDownload, csvIdentity);
  Object.assign(d.artifact, csvIdentity);
  d.resultPublications[0].complete.files["predictions.csv"] = csvIdentity;
  d.sourceManifestText = JSON.stringify(approved);
  d.sourceManifestSha256 = hash(d.sourceManifestText);
  const prepare = (items, manifestHash) => items.forEach(item => {
    if (item.classification) {
      item.classificationText = JSON.stringify(item.classification);
      item.complete.files["checkpoint_selection.json"] = { size: Buffer.byteLength(item.classificationText), sha256: hash(item.classificationText) };
    }
    item.complete.manifest_sha256 = manifestHash;
    item.completeText = JSON.stringify(item.complete);
    item.completeSha256 = hash(item.completeText);
    item.verifiedFiles = structuredClone(item.complete.files);
  });
  prepare(d.sourcePublications, d.sourceManifestSha256);
  const selected = d.sourcePublications[1];
  value.foldEvaluationPlan.checkpoint_source = { ...value.foldEvaluationPlan.checkpoint_source,
    manifest_sha256: d.sourceManifestSha256, complete_sha256: selected.completeSha256,
    files: selected.complete.files, selection: selected.classification };
  d.resultManifest = value.foldEvaluationPlan;
  d.resultManifestText = JSON.stringify(d.resultManifest);
  d.resultManifestSha256 = hash(d.resultManifestText);
  prepare(d.resultPublications, d.resultManifestSha256);
  d.resultEvents = [ { type: "hello", payload: { device: "cpu" } }, { type: "exit", payload: { status: "completed" } }, { type: "metric", payload: { metrics: { samples: 32 } } } ].map(event => ({ ...event, run_id: ids.evaluation, attempt: 1 }));
  value.pythonInterpreter = "/tmp/venv/bin/python";
  value.foldEvaluationPlan.runtime.python = value.pythonInterpreter;
  d.resultEvents[0].payload.interpreter = value.pythonInterpreter;
  d.resultEvents[1].payload.code = 0;
  d.resultManifestText = JSON.stringify(d.resultManifest);
  d.resultManifestSha256 = hash(d.resultManifestText);
  prepare(d.resultPublications, d.resultManifestSha256);
  d.resultEvents[2].payload.metrics.samples = 96;
  value.finalRegistry.executions.forEach((item,index) => { item.plan_id = String(index); });
  d.durablePlans = [approved, value.foldEvaluationPlan].map((manifest,index) => ({ plan_id: String(index), manifest, submission_requested: 1, cancellation_requested: 0, latest_observation_json: JSON.stringify({ status: "terminal" }) }));
  return value;
}
test("CV parity accepts explicit fold publication and predictions identity", () => { verifyCvParityRecord(fixture()); });
for (const [label, mutate] of [
  ["missing authored deterministic", r => { delete r.authoredConfiguration.deterministic; }],
  ["false authored deterministic", r => { r.authoredConfiguration.deterministic = false; }],
  ["missing rendered deterministic checkbox", r => { delete r.deterministicCheckboxChecked; }],
  ["false rendered deterministic checkbox", r => { r.deterministicCheckboxChecked = false; }],
  ["missing approval deterministic", r => { const manifest = JSON.parse(r.approvedPlan); delete manifest.resolved_config.deterministic; r.approvedPlan = JSON.stringify(manifest); }],
  ["false approval deterministic", r => { const manifest = JSON.parse(r.approvedPlan); manifest.resolved_config.deterministic = false; r.approvedPlan = JSON.stringify(manifest); }],
  ["missing durable source deterministic", r => { const manifest = JSON.parse(r.cvParity.sourceManifestText); delete manifest.resolved_config.deterministic; r.cvParity.sourceManifestText = JSON.stringify(manifest); r.cvParity.sourceManifestSha256 = createHash("sha256").update(r.cvParity.sourceManifestText).digest("hex"); }],
  ["false durable source deterministic", r => { const manifest = JSON.parse(r.cvParity.sourceManifestText); manifest.resolved_config.deterministic = false; r.cvParity.sourceManifestText = JSON.stringify(manifest); r.cvParity.sourceManifestSha256 = createHash("sha256").update(r.cvParity.sourceManifestText).digest("hex"); }],
  ["missing durable training plan deterministic", r => { delete r.cvParity.durablePlans[0].manifest.resolved_config.deterministic; }],
  ["false durable training plan deterministic", r => { r.cvParity.durablePlans[0].manifest.resolved_config.deterministic = false; }],
  ["selectable summary", r => { r.sourceGenerationClassifications[2].disabled = false; }],
  ["arbitrary fold autoplot", r => { r.finalRegistry.plans = 3; }],
  ["wrong fold", r => { r.cvParity.selectedFold = 1; }],
  ["summary source", r => { r.foldEvaluationPlan.checkpoint_source.generation = "gen-000003"; }],
  ["prediction bytes mismatch", r => { r.predictionsDownload.sha256 = "b".repeat(64); }],
  ["uncompleted run", r => { r.finalRegistry.runs[1].state = "failed"; }],
  ["noncpu evaluation", r => { r.foldEvaluationPlan.runtime.device = "cuda"; }],
  ["cleanup unproven", r => { r.cleanup.removedOwnedRoots = false; }],
  ["forged source manifest hash", r => { r.cvParity.sourceManifestSha256 = "b".repeat(64); }],
  ["forged publication hash", r => { r.cvParity.sourcePublications[0].completeSha256 = "b".repeat(64); }],
  ["incorrect source pin", r => { r.foldEvaluationPlan.checkpoint_source.complete_sha256 = "b".repeat(64); }],
  ["foreign producer event", r => { r.cvParity.resultEvents[0].run_id = "foreign"; }],
  ["missing producer metric", r => { r.cvParity.resultEvents = r.cvParity.resultEvents.filter(event => event.type !== "metric"); }],
  ["duplicate plan ids", r => { r.finalRegistry.control[1].plan_id = r.finalRegistry.control[0].plan_id; }],
  ["foreign explicit assets", r => { r.explicitFixtureWebAssets = "/tmp/assets"; }],
  ["foreign final registry run", r => { r.finalRegistry.runs[0].run_id = "foreign"; }],
  ["forged summary content", r => { r.cvParity.summary.r2_mean = 999; }],
  ["foreign execution plan", r => { r.finalRegistry.executions[0].plan_id = "foreign"; }],
  ["wrong prediction schema", r => { r.cvParity.predictionHeader[0] = "arbitrary"; }],
]) test(`CV parity refuses ${label}`, () => { const r = fixture(); mutate(r); assert.throws(() => verifyCvParityRecord(r)); });
