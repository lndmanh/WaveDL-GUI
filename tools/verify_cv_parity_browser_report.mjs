#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { boundedFile } from "./verify_retained_browser_report.mjs";

export function verifyCvParityRecord(record) {
  assert.equal(record.name, "cv-parity");
  assert.equal(record.status, "passed");
  assert.equal(record.driverReadinessMode, "sync-exposure-poll-and-two-controller-dom-observations");
  assert.deepEqual(record.cleanup.errors, []);
  assert.equal(record.cleanup.browserSessionAbsent, true);
  assert.equal(record.cleanup.fixtureServicesClosed, true);
  assert(record.cleanup.fixtureExit && (record.cleanup.fixtureExit.code !== null || record.cleanup.fixtureExit.signal));
  assert.equal(record.cleanup.removedOwnedRoots, true);
  assert.equal(record.cleanup.browserProfileRemoved, true);
  assert(record.cleanup.fixtureExit.code === 0 && record.cleanup.fixtureExit.signal === null || record.cleanup.fixtureExit.code === null && record.cleanup.fixtureExit.signal === "SIGINT");
  assert.equal(record.explicitFixtureWebAssets, undefined);
  const approved = JSON.parse(record.approvedPlan);
  assert.equal(approved.resolved_config.cv, 2);
  assert.equal(approved.resolved_config.epochs, 1);
  assert.equal(record.authoredConfiguration?.deterministic, true);
  assert.equal(record.deterministicCheckboxChecked, true);
  assert.equal(approved.resolved_config.deterministic, true);
  assert.equal(approved.runtime.device, "cpu");
  assert.equal(record.noAutomaticFoldPlot.plans, 1);
  assert.equal(record.noAutomaticFoldPlot.runs.length, 1);
  const options = record.sourceGenerationClassifications.filter(option => option.value);
  assert.equal(options.length, 3);
  assert.equal(options.filter(option => option.disabled).length, 1);
  assert(options.find(option => option.disabled).label.includes("summary"));
  assert.deepEqual(record.summaryRefusal, { summaryDisabled: true, help: true });
  const durable = record.cvParity;
  const hash = text => createHash("sha256").update(text).digest("hex");
  assert.equal(hash(durable.sourceManifestText), durable.sourceManifestSha256);
  assert.equal(hash(durable.resultManifestText), durable.resultManifestSha256);
  const sourceManifest = JSON.parse(durable.sourceManifestText);
  assert.equal(sourceManifest.resolved_config.deterministic, true);
  assert.deepEqual(sourceManifest, approved);
  assert.deepEqual(JSON.parse(durable.resultManifestText), record.foldEvaluationPlan);
  assert.equal(durable.sourcePublications.length, 3);
  const folds = durable.sourcePublications.filter(item => item.classification.kind === "cross_validation_fold");
  assert.deepEqual(folds.map(item => item.classification.fold).sort(), [1, 2]);
  assert.equal(durable.sourcePublications.filter(item => item.classification.kind === "cross_validation_summary").length, 1);
  assert.equal(durable.summary.folds, 2);
  const summaryPublication = durable.sourcePublications.find(item => item.classification.kind === "cross_validation_summary");
  assert.deepEqual(JSON.parse(durable.summaryText), durable.summary);
  assert.deepEqual(summaryPublication.complete.files["cv_summary.json"], { size: Buffer.byteLength(durable.summaryText), sha256: hash(durable.summaryText) });
  assert.deepEqual(durable.summary.fold_results.map(item => item.fold), [1, 2]);
  const plan = record.foldEvaluationPlan;
  assert.deepEqual(durable.resultManifest, plan);
  assert.equal(plan.operation, "test");
  assert.equal(plan.runtime.device, "cpu");
  assert.equal(plan.resolved_config.save_predictions, true);
  assert.equal(plan.resolved_config.export, null);
  assert.equal(plan.checkpoint_source.run_id, approved.run_id);
  const selected = folds.find(item => item.generation === plan.checkpoint_source.generation);
  assert(selected);
  assert.equal(durable.selectedFold, selected.classification.fold);
  assert.equal(durable.selectedFold, 2);
  assert.equal(plan.checkpoint_source.manifest_sha256, durable.sourceManifestSha256);
  assert.equal(plan.checkpoint_source.complete_sha256, selected.completeSha256);
  assert.deepEqual(plan.checkpoint_source.files, selected.complete.files);
  assert.deepEqual(plan.checkpoint_source.selection, selected.classification);
  assert(options.find(option => option.value === selected.generation && !option.disabled));
  const identity = value => {
    assert(Number.isSafeInteger(value.size) && value.size > 0);
    assert(/^[a-f0-9]{64}$/.test(value.sha256));
  };
  for (const [runId, publications] of [[approved.run_id, durable.sourcePublications], [plan.run_id, durable.resultPublications]]) {
    assert(publications.length > 0);
    for (const item of publications) {
      assert(/^gen-\d{6,}$/.test(item.generation));
      assert.equal(hash(item.completeText), item.completeSha256);
      assert.deepEqual(JSON.parse(item.completeText), item.complete);
      assert.deepEqual(item.verifiedFiles, item.complete.files);
      if (item.classification) {
        assert.deepEqual(JSON.parse(item.classificationText), item.classification);
        assert.deepEqual(item.complete.files["checkpoint_selection.json"], { size: Buffer.byteLength(item.classificationText), sha256: hash(item.classificationText) });
      }
      assert.equal(item.complete.manifest_sha256, runId === approved.run_id ? durable.sourceManifestSha256 : durable.resultManifestSha256);
      assert.equal(item.complete.run_id, runId);
      assert.equal(item.complete.attempt, 1);
      for (const value of Object.values(item.complete.files)) identity(value);
      assert(Object.keys(item.complete.files).every(path => !/[\\:%]/.test(path) && path.split("/").every(part => part && part !== "." && part !== "..")));
    }
  }
  identity(record.predictionsDownload);
  assert.deepEqual(record.predictionsDownload, durable.artifact);
  const publication = durable.resultPublications.find(item => item.generation === durable.artifact.generation);
  assert.deepEqual(publication.complete.files[durable.artifact.path], { size: durable.artifact.size, sha256: durable.artifact.sha256 });
  assert(Number.isSafeInteger(durable.predictionRows) && durable.predictionRows > 1);
  assert.equal(durable.predictionRows, 96);
  assert.deepEqual(durable.predictionHeader, ["True_P0", "Pred_P0", "Error_P0", "AbsError_P0"]);
  assert.equal(Buffer.byteLength(durable.predictionText), durable.artifact.size);
  assert.equal(hash(durable.predictionText), durable.artifact.sha256);
  const csvRows = durable.predictionText.trimEnd().split("\n").map(row => row.split(","));
  assert.deepEqual(csvRows[0], durable.predictionHeader);
  assert.equal(csvRows.length, 97);
  assert(csvRows.slice(1).every(row => row.length === 4 && row.every(cell => cell.trim() !== "" && Number.isFinite(Number(cell)))));
  assert.equal(record.finalRegistry.plans, 2, "No arbitrary automatic fold plot may be planned");
  assert.equal(record.finalRegistry.runs.length, 2);
  assert(record.finalRegistry.runs.every(run => run.state === "completed"));
  assert(record.finalRegistry.control.every(control => control.submission_requested === 1 && control.cancellation_requested === 0));
  assert.equal(record.finalRegistry.executions.length, 2);
  assert(record.finalRegistry.executions.every(execution => execution.observed_status === "terminal"));
  assert.equal(new Set(record.finalRegistry.control.map(item => item.plan_id)).size, 2);
  assert.equal(new Set(record.finalRegistry.runs.map(item => item.run_id)).size, 2);
  assert.deepEqual(record.finalRegistry.runs.map(item => item.run_id).sort(), [approved.run_id, plan.run_id].sort());
  assert.equal(durable.durablePlans.length, 2);
  const durableSourcePlan = durable.durablePlans.find((item) => item.manifest.run_id === approved.run_id);
  assert.equal(durableSourcePlan?.manifest.resolved_config.deterministic, true);
  assert.deepEqual(durable.durablePlans.map(item => item.manifest.run_id).sort(), [approved.run_id, plan.run_id].sort());
  assert.deepEqual(record.finalRegistry.control.map(item => item.plan_id).sort(), durable.durablePlans.map(item => item.plan_id).sort());
  assert.deepEqual(record.finalRegistry.executions.map(item => item.plan_id).sort(), durable.durablePlans.map(item => item.plan_id).sort());
  for (const item of durable.durablePlans) {
    assert.deepEqual(item.manifest, item.manifest.run_id === approved.run_id ? approved : plan);
    assert.equal(item.submission_requested, 1);
    assert.equal(item.cancellation_requested, 0);
    assert.equal(JSON.parse(item.latest_observation_json ?? item.observation_json).status, "terminal");
  }
  for (const id of [approved.run_id, plan.run_id]) assert(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id));
  const events = durable.resultEvents;
  assert(events.every(event => event.run_id === plan.run_id && event.attempt === 1));
  assert.equal(events.find(event => event.type === "hello").payload.device, "cpu");
  assert.equal(events.find(event => event.type === "hello").payload.interpreter, record.pythonInterpreter);
  assert.equal(plan.runtime.python, record.pythonInterpreter);
  assert.equal(events.find(event => event.type === "exit").payload.status, "completed");
  assert.equal(events.find(event => event.type === "exit").payload.code, 0);
  assert(events.some(event => event.type === "metric" && event.payload.metrics.samples === durable.predictionRows));
  return record;
}

export async function verifyCvParityFile(path) {
  const record = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await boundedFile(path, 1024 * 1024)));
  verifyCvParityRecord(record);
  const assets = await readFile(new URL("../src/wavedl_daemon/web_assets/.wavedl-assets.json", import.meta.url));
  assert.equal(createHash("sha256").update(assets).digest("hex"), record.assetManifestSha256, "Report must bind current packaged assets");
  return record;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyCvParityFile(process.argv[2]);
  console.log("CV browser parity report verified");
}
