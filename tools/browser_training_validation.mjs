import { openPlanDisclosure, planReadinessExpression, CONTROL_VALUE_SOURCE } from './browser_actions.mjs';
// Real-browser negative authoring and runtime validation.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { packagedAssetHashes } from "./browser_training_fields_full.mjs";

// Draft fields are read wherever their builder block is: every block stays mounted.
const projectControl = (label) => `(()=>{const labels=Array.from(document.querySelectorAll('section[aria-labelledby="project-title"] label')).filter(e=>e.textContent.trim()===${JSON.stringify(label)});return labels.length===1?document.getElementById(labels[0].htmlFor):null;})()`;
const fieldValid = (label) => `${projectControl(label)}?.getAttribute('aria-invalid') !== 'true'`;

// The strip's review action on an invalid draft: the builder opens the Plan
// block, keeps its own "Create plan" disabled and marks the field invalid.
// Nothing is sent to the daemon.
export async function requestInvalidPlan({ actions, cli }, label) {
  await actions.reviewPlan();
  await cli("wait", "--fn", `(()=>{const state=${planReadinessExpression()};return state.step==='guide-step-4'&&state.createPlan?.disabled===true&&${projectControl(label)}?.getAttribute('aria-invalid')==='true';})()`);
}

export async function cvResumeRefusal(driver, receipts, observation) {
  const { fill, registry, root, cli, dom } = driver;
  const selector = join(root, "private-resume-checkpoint.pth");
  const beforeState = await registry(root);
  const beforeReceiptCount = (await receipts()).length;
  await fill("Cross-validation folds", "2");
  await fill("Resume checkpoint", selector);
  await requestInvalidPlan(driver, "Resume checkpoint");
  const observed = await observation("Resume checkpoint");
  const error = "Cross-validation does not support nondefault --resume.";
  assert.equal(observed.value, selector);
  assert.equal(observed.invalid, "true");
  assert.equal(observed.error.trim(), error);
  const pathDisclosed = await dom(`JSON.stringify(document.body.innerText.includes(${JSON.stringify(selector)}))`);
  assert.equal(pathDisclosed, false);
  const afterState = await registry(root);
  const afterReceiptCount = (await receipts()).length;
  assert.deepEqual(afterState, beforeState);
  assert.equal(afterReceiptCount, beforeReceiptCount);
  await fill("Resume checkpoint", "");
  await cli("wait", "--fn", fieldValid("Resume checkpoint"));
  const corrected = await observation("Resume checkpoint");
  assert.equal(corrected.value, "");
  assert.equal(corrected.invalid, "false");
  assert.equal(corrected.error, "");
  return { version: 1, selector, cv: 2, observed, corrected, pathDisclosed,
    beforeState, afterState, beforeReceiptCount, afterReceiptCount };
}

export async function trainingValidation(driver) {
  const { fill, summary, button, registry, root, check, record, dom, cli, actions, interpreter,
    command, python, controlExpression, repo, downloads } = driver;
  const state = () => registry(root);
  const before = await state();
  record.trainingValidation = { schemaVersion: 2, invalid: [], unsupported: [], beforeState: before,
    beforeAssets: await packagedAssetHashes(repo) };
  const invalid = [
    ["Batch size", "0"], ["Batch size", "1.5"], ["Learning rate", "0"], ["Learning rate", ""],
    ["Data loader workers", "-2"], ["Loss weights", "1,Infinity"], ["Scheduler milestones", "2,3.5"],
    ["Cross-validation folds", "1"], ["Python interpreter", "python"],
  ];
  for (const text of ["Data loading and speed", "Cross-validation"]) {
    const open = await dom(`JSON.stringify(${controlExpression("summary", text)}[0]?.getAttribute('aria-expanded') === 'true')`);
    if (!open) await summary(text);
  }
  const receipts = async () => {
    try {
      const text = await readFile(join(root, ".plan-request-receipts.jsonl"), "utf8");
      assert(Buffer.byteLength(text) <= 1024 * 1024);
      return text.trim() ? text.trim().split("\n").map(JSON.parse) : [];
    } catch (error) {
      if (error.code === "ENOENT") throw new Error("Missing plan request receipts");
      throw error;
    }
  };
  // A valid builder number field omits aria-invalid; it reads as "false".
  const observation = async (label) => dom(`JSON.stringify((()=>{
    const e=${projectControl(label)};
    return {id:e?.id,value:${CONTROL_VALUE_SOURCE}(e),invalid:e?(e.getAttribute('aria-invalid')==='true'?'true':'false'):null,error:e?.closest('[data-field],.runtime-row,[data-slot="field"]')?.querySelector('[data-slot="field-error"]')?.textContent||''};
  })())`);
  // Loss weights and milestones are shown only for the loss/schedule that reads them.
  const enable = { "Loss weights": () => actions.select("Loss function", "weighted_mse"),
    "Scheduler milestones": () => actions.select("Learning rate schedule", "multistep") };
  for (const [name, value] of invalid) {
    const beforeCase = await state();
    const beforeReceipts = await receipts();
    await enable[name]?.();
    await fill(name, value);
    await requestInvalidPlan(driver, name);
    const observed = await observation(name);
    assert.equal(observed.invalid, "true");
    const after = await state();
    assert.deepEqual(after, beforeCase);
    check(after.plans === beforeCase.plans && after.executions.length === 0 &&
      after.control.every((x) => x.submission_requested === 0),
      name + " invalid input creates no plan or submission intent");
    record.trainingValidation.invalid.push({
      name, value, submitted: false, ariaInvalid: observed.invalid, observed,
      error: observed.error,
      beforePlans: beforeCase.plans, afterPlans: after.plans, beforeState: beforeCase, afterState: after,
      beforeReceiptCount: beforeReceipts.length, afterReceiptCount: (await receipts()).length,
    });
    assert.equal((await receipts()).length, beforeReceipts.length);
    const corrections = { "Batch size": "8", "Learning rate": "0.003", "Data loader workers": "0",
      "Loss weights": "1,1", "Scheduler milestones": "2,3", "Cross-validation folds": "0", "Python interpreter": interpreter };
    await fill(name, corrections[name]);
    await cli("wait", "--fn", fieldValid(name));
    record.trainingValidation.invalid.at(-1).corrected = await observation(name);
  }
  const checkbox = async (name, wanted) => {
    const locator = await actions.readyControl("field", name);
    const expression = `(${controlExpression("field", name, { locator })})[0]?.getAttribute('aria-checked')`;
    const current = await dom(`JSON.stringify(${expression})`);
    assert(["true", "false"].includes(current));
    if (current !== String(wanted)) await cli("click", locator);
    await cli("wait", "--fn", `${expression} === '${wanted}'`);
  };

  // Standalone export safety is exercised through the public Import / Export menu.
  // YAML is configuration-only; the command exporter must refuse secrets and
  // topologies it cannot reproduce on a standalone host.
  const exportYaml = async (filename) => {
    const selector = await actions.configMenuItem("Download YAML");
    assert(selector, "YAML download control missing");
    const path = join(downloads, filename);
    await cli("download", selector, path);
    const config = JSON.parse(await command(python, ["-c",
      "import json,sys,yaml; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))", path]));
    return { filename, config, bytes: (await readFile(path)).length };
  };
  const exportBeforeState = await state();
  const exportBeforeReceipts = (await receipts()).length;
  await summary("Explicit runtime environment");
  await fill("New environment variable", "EXPORT_PROBE");
  await button("Add variable");
  await fill("EXPORT_PROBE", "browser-secret-probe", { locator: "#env-EXPORT_PROBE" });
  const environmentDownload = await exportYaml("training-validation-environment.yaml");
  const environmentBytes = await readFile(join(downloads, environmentDownload.filename), "utf8");
  assert(!environmentBytes.includes("browser-secret-probe"));
  assert(!("environment" in environmentDownload.config));
  await actions.copyStandaloneCommand();
  await cli("wait", "--text", "Explicit environment values are not exported");
  const environmentRefusal = await dom(`JSON.stringify(Array.from(document.querySelectorAll('[role="status"]')).some(e=>e.getClientRects().length&&e.textContent.includes('Explicit environment values are not exported')))`);
  assert.equal(environmentRefusal, true);
  await button("Remove EXPORT_PROBE");
  await fill("Machines", "2");
  await actions.copyStandaloneCommand();
  await cli("wait", "--text", "Multi-node standalone commands require explicit rendezvous");
  const topologyRefusal = await dom(`JSON.stringify(Array.from(document.querySelectorAll('[role="status"]')).some(e=>e.getClientRects().length&&e.textContent.includes('Multi-node standalone commands require explicit rendezvous')))`);
  assert.equal(topologyRefusal, true);
  await fill("Machines", "1");
  const exportAfterState = await state();
  assert.deepEqual(exportAfterState, exportBeforeState);
  assert.equal((await receipts()).length, exportBeforeReceipts);
  record.trainingValidation.standaloneExport = {
    environmentOmitted: true, environmentRefusal, topologyRefusal,
    beforeState: exportBeforeState, afterState: exportAfterState,
    beforeReceiptCount: exportBeforeReceipts, afterReceiptCount: (await receipts()).length,
    environmentDownload: { filename: environmentDownload.filename, bytes: environmentDownload.bytes,
      config: environmentDownload.config },
  };
  await fill("Loss weights", "");
  await fill("Scheduler milestones", "");
  await actions.select("Loss function", "mse");
  await actions.select("Learning rate schedule", "plateau");
  await fill("Cross-validation folds", "2");
  for (const [name, field, prepare, correct] of [
    ["cv-compile", "Compile model", () => checkbox("Compile model", true), () => checkbox("Compile model", false)],
    ["cv-nesterov", "Momentum", async () => {
      await actions.select("Optimizer", "sgd"); await checkbox("Nesterov momentum", true); await fill("Momentum", "0");
    }, async () => { await checkbox("Nesterov momentum", false); await fill("Momentum", "0.9"); }],
    ["cv-plateau", "Learning rate reduction factor", async () => {
      await actions.select("Learning rate schedule", "plateau"); await fill("Learning rate reduction factor", "1");
    }, async () => { await fill("Learning rate reduction factor", "0.5"); }],
  ]) {
    const beforeReceipts = (await receipts()).length;
    await prepare();
    await requestInvalidPlan(driver, field);
    const observed = await observation(field);
    assert.equal(observed.invalid, "true");
    const after = await state();
    assert.deepEqual(after, before);
    assert.equal(after.plans, 0);
    assert.deepEqual(after.executions, []);
    assert.equal((await receipts()).length, beforeReceipts);
    await correct();
    await cli("wait", "--fn", fieldValid(field));
    const corrected = await observation(field);
    record.trainingValidation.invalid.push({
      name, value: observed.value, observed, ariaInvalid: observed.invalid, error: observed.error,
      corrected, submitted: false, beforePlans: 0, afterPlans: after.plans,
      beforeState: before, afterState: after,
      beforeReceiptCount: beforeReceipts, afterReceiptCount: (await receipts()).length,
    });
  }
  record.trainingValidation.cvResumeRefusal = await cvResumeRefusal(driver, receipts, observation);
  await fill("Cross-validation folds", "0");
  // Unsupported choices are sent to the real planner; no durable mutation is accepted.
  for (const [label, value] of [["Runtime mode", "bundled"], ["Runtime mode", "container"], ["Device", "mps"]]) {
    const beforeCase = await state();
    const beforeReceipts = (await receipts()).length;
    if (label === "Device") await actions.device(value);
    else await actions.select(label, value);
    await actions.createPlan();
    await cli("wait", "--text", "The daemon refused this plan. Correct the settings and preview again.");
    const after = await state();
    assert.deepEqual(after, beforeCase);
    const refusalVisible = await dom('JSON.stringify(document.body.innerText.includes("The daemon refused this plan. Correct the settings and preview again."))');
    record.trainingValidation.unsupported.push({
      label, value, plans: after.plans, executions: after.executions.length,
      control: after.control, beforeState: beforeCase, afterState: after, refusalVisible,
      beforeReceiptCount: beforeReceipts,
      afterReceiptCount: (await receipts()).length,
    });
    assert.equal((await receipts()).length, beforeReceipts + 1);
    check(after.plans === beforeCase.plans && after.executions.length === 0,
      label + " unsupported authoring has no durable mutation");
    if (label === "Device") await actions.device("cpu");
    else await actions.select(label, "existing");
  }
  await fill("Batch size", "8");
  await fill("Learning rate", "0.003");
  await fill("Data loader workers", "0");
  await actions.createPlan();
  await cli("wait", "--text", "Persisted plan for approval");
  await openPlanDisclosure({ cli, dom });
  const approved = JSON.parse(await dom('JSON.stringify(document.querySelector("[aria-label=\\"Approved normalized manifest\\"]")?.textContent)'));
  const rows = JSON.parse(await command(python, ["-c",
    'import json,sqlite3,sys;from pathlib import Path;c=sqlite3.connect((Path(sys.argv[1])/"state"/"registry.db").resolve().as_uri()+"?mode=ro",uri=True);print(json.dumps(list(c.execute("SELECT plan_id,request_payload_json,plan_json FROM plans"))))', root]));
  assert.equal(rows.length, 1);
  const request = JSON.parse(rows[0][1]);
  const manifest = JSON.parse(JSON.parse(rows[0][2]).manifest_json);
  assert.deepEqual(approved, manifest);
  assert.equal(request.runtime.python, interpreter);
  assert.equal(manifest.resolved_config.model, "cnn");
  assert(manifest.resolved_config.data_path.endsWith("/samples.npz"));
  assert.equal(manifest.resolved_config.data_path, join(root, "samples.npz"));
  record.selectedDatasetPath = join(root, "samples.npz");
  record.trainingValidation.approvedManifest = approved;
  record.trainingValidation.persistedManifest = manifest;
  record.trainingValidation.request = request;
  record.trainingValidation.planId = rows[0][0];
  const baselineState = await state();
  const baselineReceiptCount = (await receipts()).length;
  // Add a genuine CV recovery preview without replacing the original cv=0
  // preview evidence. Previewing is not permission to submit or train.
  await fill("Cross-validation folds", "2");
  await actions.createPlan();
  await cli("wait", "--text", "Persisted plan for approval");
  await openPlanDisclosure({ cli, dom });
  const recoveredApproval = JSON.parse(await dom('JSON.stringify(document.querySelector("[aria-label=\\"Approved normalized manifest\\"]")?.textContent)'));
  const recoveredRows = JSON.parse(await command(python, ["-c",
    'import json,sqlite3,sys;from pathlib import Path;c=sqlite3.connect((Path(sys.argv[1])/"state"/"registry.db").resolve().as_uri()+"?mode=ro",uri=True);print(json.dumps(list(c.execute("SELECT plan_id,request_payload_json,plan_json FROM plans"))))', root]));
  assert.equal(recoveredRows.length, 2);
  assert.deepEqual(recoveredRows.find(row => row[0] === rows[0][0]), rows[0]);
  const recoveryRow = recoveredRows.find(row => row[0] !== rows[0][0]);
  const recoveredRequest = JSON.parse(recoveryRow[1]);
  const recoveredManifest = JSON.parse(JSON.parse(recoveryRow[2]).manifest_json);
  assert.deepEqual(recoveredApproval, recoveredManifest);
  assert.equal(recoveredRequest.config.cv, 2);
  assert.equal(recoveredRequest.config.resume, null);
  assert.equal(recoveredManifest.resolved_config.cv, 2);
  assert.equal(recoveredManifest.resolved_config.resume, null);
  record.trainingValidation.cvResumeRecovery = {
    version: 1, planId: recoveryRow[0], request: recoveredRequest,
    approvedManifest: recoveredApproval, persistedManifest: recoveredManifest,
    beforeState: baselineState, afterState: await state(),
    beforeReceiptCount: baselineReceiptCount, afterReceiptCount: (await receipts()).length,
    originalPlanRow: rows[0], preservedPlanRow: recoveredRows.find(row => row[0] === rows[0][0]),
  };
  const final = await state();
  check(final.plans === before.plans + 2, "Corrected fields create exactly ordinary and CV recovery previews");
  check(final.executions.length === 0 && final.control.every((x) => x.submission_requested === 0),
    "Validation case never submits runtime");
  record.trainingValidation.afterState = final;
  record.trainingValidation.successfulPreview = true;
  record.trainingValidation.finalReceiptCount = (await receipts()).length;
  record.trainingValidation.afterAssets = await packagedAssetHashes(repo);
  record.trainingValidation.postAssetManifestSha256 = createHash("sha256").update(
    await readFile(join(repo, "src/wavedl_daemon/web_assets/.wavedl-assets.json"))).digest("hex");
  return record;
}
