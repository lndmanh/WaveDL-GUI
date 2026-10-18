#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { boundedFile } from "./verify_retained_browser_report.mjs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { packagedAssetHashes } from "./browser_training_fields_full.mjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const trainingInventory = JSON.parse(readFileSync(
  new URL("../web/shared/training-options.json", import.meta.url), "utf8"));
const configKeys = trainingInventory.map((option) => option.name).sort();

export const validationInputs = [
  ["batch size", "0", "8"], ["batch size", "1.5", "8"], ["lr", "0", "0.003"],
  ["lr", "", "0.003"], ["workers", "-2", "0"], ["loss weights", "1,Infinity", "1,1"],
  ["milestones", "2,3.5", "2,3"], ["cv", "1", "0"],
  ["Python interpreter", "python", null], ["cv-compile", "true", "false"],
  ["cv-nesterov", "0", "0.9"], ["cv-plateau", "1", "0.5"],
];
const emptyState = { plans: 0, runs: [], control: [], executions: [] };

export function verifyTrainingValidationRecord(record) {
  assert.equal(record.name, "training-validation");
  assert.equal(record.status, "passed");
  const v = record.trainingValidation;
  assert(v && Array.isArray(v.invalid) && Array.isArray(v.unsupported));
  // Version 2 adds mandatory public CV/resume refusal evidence. Historical
  // versionless reports retain their original scope and cannot pass this guard.
  assert.equal(v.schemaVersion, 2);
  const resume = v.cvResumeRefusal;
  assert(resume);
  assert.equal(resume.version, 1);
  assert.equal(resume.cv, 2);
  assert.equal(resume.selector, join(dirname(record.selectedDatasetPath), "private-resume-checkpoint.pth"));
  assert.equal(resume.pathDisclosed, false);
  assert.deepEqual(resume.beforeState, emptyState);
  assert.deepEqual(resume.afterState, emptyState);
  assert.equal(resume.beforeReceiptCount, 0);
  assert.equal(resume.afterReceiptCount, 0);
  assert.equal(resume.observed.invalid, "true");
  assert.equal(resume.observed.value, resume.selector);
  assert.equal(resume.observed.error.trim(), "Cross-validation does not support nondefault --resume.");
  assert(typeof resume.observed.id === "string" && resume.observed.id.length > 0);
  assert.equal(resume.corrected.id, resume.observed.id);
  assert.equal(resume.corrected.value, "");
  assert.equal(resume.corrected.invalid, "false");
  assert.equal(resume.corrected.error, "");
  const safety = v.standaloneExport;
  assert(safety);
  for (const key of ["environmentOmitted", "environmentRefusal", "topologyRefusal"])
    assert.equal(safety[key], true);
  assert.deepEqual(safety.beforeState, emptyState);
  assert.deepEqual(safety.afterState, emptyState);
  assert.equal(safety.beforeReceiptCount, 0);
  assert.equal(safety.afterReceiptCount, 0);
  assert.equal(safety.environmentDownload.filename, "training-validation-environment.yaml");
  assert(Number.isSafeInteger(safety.environmentDownload.bytes) && safety.environmentDownload.bytes > 0);
  assert.deepEqual(Object.keys(safety.environmentDownload.config).sort(), configKeys);
  assert(!JSON.stringify(safety.environmentDownload.config).includes("browser-secret-probe"));
  assert.equal(safety.environmentDownload.config.model, "cnn");
  assert.equal(safety.environmentDownload.config.data_path, record.selectedDatasetPath);
  assert.deepEqual(v.invalid.map((x) => x.name), [
    "batch size", "batch size", "lr", "lr", "workers", "loss weights", "milestones",
    "cv", "Python interpreter", "cv-compile", "cv-nesterov", "cv-plateau",
  ]);
  assert(v.invalid.every((x) => x.submitted === false && x.beforePlans === x.afterPlans));
  assert(v.invalid.every((x) => x.ariaInvalid === "true" && x.corrected?.invalid === "false"));
  assert(v.invalid.every((x) => typeof x.observed?.id === "string" && x.observed.id.length &&
    x.observed.invalid === x.ariaInvalid && x.observed.value === x.value &&
    typeof x.error === "string" && x.error.length > 0));
  assert(v.invalid.every((x) => x.beforeReceiptCount === x.afterReceiptCount));
  for (const [index, [name, value, correction]] of validationInputs.entries()) {
    const item = v.invalid[index];
    assert.equal(item.name, name);
    assert.equal(item.value, value);
    assert(item.observed.value === value ||
      (typeof value === "string" && item.observed.value === Number(value)));
    assert.equal(item.corrected.value, correction ?? record.pythonInterpreter);
    assert.equal(item.corrected.id, item.observed.id);
    assert.equal(item.corrected.error, "");
    assert.equal(item.observed.error, item.error);
    assert.deepEqual(item.beforeState, emptyState);
    assert.deepEqual(item.afterState, emptyState);
    assert.equal(item.beforeReceiptCount, 0);
    assert.equal(item.afterReceiptCount, 0);
  }
  assert(v.unsupported.length === 3);
  assert(v.unsupported.every((x) => x.afterReceiptCount === x.beforeReceiptCount + 1));
  assert.deepEqual(v.unsupported.map((x) => [x.label, x.value]), [
    ["Runtime mode", "bundled"], ["Runtime mode", "container"], ["Device", "mps"],
  ]);
  for (const [index, item] of v.unsupported.entries()) {
    assert.deepEqual(item.beforeState, emptyState);
    assert.deepEqual(item.afterState, emptyState);
    assert.equal(item.refusalVisible, true);
    assert.equal(item.beforeReceiptCount, index);
    assert.equal(item.afterReceiptCount, index + 1);
  }
  assert(v.successfulPreview === true);
  assert.equal(v.afterState.plans, v.beforeState.plans + 2);
  assert.equal(v.afterState.executions.length, 0);
  assert(v.afterState.control.every((x) => x.submission_requested === 0));
  assert.equal(v.beforeState.plans, 0);
  assert.deepEqual(v.beforeState, emptyState);
  assert.deepEqual(v.afterState.runs, []);
  assert.equal(v.afterState.control.length, 2);
  assert(v.afterState.control.some(row => row.plan_id === v.planId));
  assert(v.afterState.control.every(row => row.cancellation_requested === 0));
  assert.deepEqual(v.approvedManifest, v.persistedManifest);
  const expected = { batch_size: 8, lr: 0.003, workers: 0, cv: 0, compile: false,
    nesterov: false, momentum: 0.9, scheduler: "plateau", scheduler_factor: 0.5,
    precision: "no", epochs: 10000, patience: 10000, resume: null };
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(v.request.config[key], value);
    assert.deepEqual(v.persistedManifest.resolved_config[key], value);
  }
  assert(Object.keys(v.request.config).length >= Object.keys(expected).length);
  assert.equal(v.request.config.model, "cnn");
  assert.equal(v.request.config.data_path, v.persistedManifest.resolved_config.data_path);
  assert.equal(configKeys.length, 46);
  assert.deepEqual(Object.keys(v.request.config).sort(), configKeys);
  assert.deepEqual(Object.keys(v.persistedManifest.resolved_config).sort(),
    [...configKeys, "output_dir"].sort());
  for (const key of configKeys)
    assert.deepEqual(v.request.config[key], v.persistedManifest.resolved_config[key]);
  assert(typeof v.request.runtime.python === "string" && v.request.runtime.python.startsWith("/"));
  assert(/^[0-9a-f-]{36}$/.test(v.planId));
  assert(typeof v.persistedManifest.run_id === "string" &&
    /^[0-9a-f-]{36}$/.test(v.persistedManifest.run_id));
  assert.equal(v.persistedManifest.resolved_config.data_path, record.selectedDatasetPath);
  assert.equal(v.persistedManifest.resolved_config.output_dir,
    join(dirname(record.selectedDatasetPath), "runs", v.persistedManifest.run_id));
  assert.equal(v.persistedManifest.resolved_config.model, "cnn");
  assert(v.persistedManifest.resolved_config.data_path.endsWith("/samples.npz"));
  assert.equal(v.persistedManifest.runtime.python, record.pythonInterpreter);
  assert.equal(v.request.runtime.python, record.pythonInterpreter);
  assert.equal(v.request.runtime.device, "cpu");
  assert.equal(v.request.runtime.mode, "existing");
  const recovery = v.cvResumeRecovery;
  assert(recovery);
  assert.equal(recovery.version, 1);
  assert.notEqual(recovery.planId, v.planId);
  assert(/^[0-9a-f-]{36}$/.test(recovery.planId));
  assert.deepEqual(recovery.afterState, v.afterState);
  assert.deepEqual(recovery.beforeState, {plans:1,runs:[],executions:[],
    control:v.afterState.control.filter(row => row.plan_id === v.planId)});
  assert.deepEqual(recovery.originalPlanRow, recovery.preservedPlanRow);
  assert.equal(recovery.originalPlanRow[0], v.planId);
  assert.deepEqual(JSON.parse(recovery.originalPlanRow[1]), v.request);
  assert.deepEqual(JSON.parse(JSON.parse(recovery.originalPlanRow[2]).manifest_json), v.persistedManifest);
  assert.deepEqual(recovery.approvedManifest, recovery.persistedManifest);
  assert.deepEqual(recovery.request, {...v.request, config:{...v.request.config,cv:2}});
  const recoveredConfig = {...v.persistedManifest.resolved_config,cv:2,
    output_dir:join(dirname(record.selectedDatasetPath), "runs", recovery.persistedManifest.run_id)};
  assert.deepEqual(recovery.persistedManifest.resolved_config, recoveredConfig);
  assert.notEqual(recovery.persistedManifest.run_id, v.persistedManifest.run_id);
  assert.deepEqual(recovery.persistedManifest.runtime, v.persistedManifest.runtime);
  assert.deepEqual(v.afterState.control.map(row => row.plan_id).sort(), [v.planId,recovery.planId].sort());
  assert.equal(recovery.beforeReceiptCount, 4);
  assert.equal(recovery.afterReceiptCount, 5);
  assert.equal(v.finalReceiptCount, v.unsupported.reduce((n, x) => n + 1, 0) + 2);
  assert(record.trainingValidationRequests && record.trainingValidationReceipts);
  assert.equal(record.trainingValidationReceipts.length, v.finalReceiptCount);
  assert.deepEqual(record.trainingValidationReceipts, [0,1,2,3,4].map((sequence) =>
    ({sequence, method:"POST", path:"/api/runs/plan"})));
  assert.equal(record.trainingValidationRequestsFrozenAfterCleanup, true);
  const plans = record.trainingValidationRequests.filter((x) =>
    x.method === "POST" && x.path === "/api/runs/plan");
  assert.deepEqual(plans.map((x) => x.status), [400, 400, 400, 200, 200]);
  assert(plans.every((x) => x.scopeHeaderPresent === true));
  const readonly = record.trainingValidationRequests.filter((x) =>
    x.method === "POST" && ["/api/browse/resolve", "/api/datasets/inspect"].includes(x.path));
  assert.deepEqual(readonly.map((x) => [x.path, x.status, x.scopeHeaderPresent, x.cursor]), [
    ["/api/browse/resolve", 200, true, {}],
    ["/api/datasets/inspect", 200, true, {}],
  ]);
  assert.deepEqual(record.trainingValidationRequests.filter((x) =>
    !["GET","HEAD"].includes(x.method) &&
    !(x.method === "POST" &&
      ["/api/browse/resolve","/api/datasets/inspect"].includes(x.path))), plans);
  assert(record.cleanup && Array.isArray(record.cleanup.errors));
  assert.deepEqual(record.cleanup.errors, []);
  for (const name of ["browserSessionAbsent", "fixtureServicesClosed",
    "browserProfileRemoved", "removedOwnedRoots"]) assert.equal(record.cleanup[name], true);
  assert((record.cleanup.fixtureExit.code === 0 && record.cleanup.fixtureExit.signal === null) ||
    (record.cleanup.fixtureExit.code === null && record.cleanup.fixtureExit.signal === "SIGINT"));
  for (const name of ["failure","error","skipped","shutdownError"]) assert.equal(record[name], undefined);
  assert.equal(Object.keys(v.beforeAssets).length, 37);
  assert(Object.values(v.beforeAssets).every((x) => /^[a-f0-9]{64}$/.test(x)));
  assert.deepEqual(v.beforeAssets, v.afterAssets);
  assert.equal(v.postAssetManifestSha256, record.assetManifestSha256);
  assert.deepEqual(record.finalRegistry, v.afterState);
  return record;
}
export async function verifyTrainingValidationFile(path) {
  const record = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
    await boundedFile(path, 1024 * 1024),
  ));
  verifyTrainingValidationRecord(record);
  const bytes = await readFile(new URL("../src/wavedl_daemon/web_assets/.wavedl-assets.json", import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), record.assetManifestSha256);
  assert.deepEqual(record.trainingValidation.afterAssets,
    await packagedAssetHashes(fileURLToPath(new URL("../", import.meta.url))));
  return record;
}
if (process.argv[1]?.endsWith("verify_training_validation_browser_report.mjs")) {
  await verifyTrainingValidationFile(process.argv[2]);
  console.log("Training validation browser report verified");
}
