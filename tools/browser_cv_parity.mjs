import { openPlanDisclosure } from './browser_actions.mjs';
// Real Chromium CV publication/evaluation parity gate. No API mocks or state injection.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { xpathLiteral } from "./browser_actions.mjs";

export const cvParityScope =
  "CPU 2-fold cross-validation: explicit summary refusal, explicit fold evaluation, and verified predictions publication";

export async function cvParity({
  cli, dom, button, actions, registry, pollRegistry, root, downloads,
  record, approvedManifest, check, python, command,
}) {
  const observe = (expression) => dom(`JSON.stringify(${expression})`);
  const before = await registry(root);
  assert.equal(before.plans, 1, "CV completion must not automatically choose any fold for plotting");
  assert.equal(before.runs.length, 1);
  record.noAutomaticFoldPlot = before;
  await actions.button("Experiments", false, { locator: '[data-testid="nav-experiments"]' });
  await actions.button("Refresh", false, { scope: '//section[@aria-label="Runs"]' });
  const row = `xpath=//button[contains(@class,"run-row")][.//small[normalize-space(.)=${xpathLiteral(approvedManifest.run_id)}]]`;
  await cli("wait", "--fn", `document.evaluate(${JSON.stringify(row.slice(6))},document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null).snapshotLength===1`);
  await cli("click", row);
  await actions.button("Results", false, { locator: '[data-testid="nav-results"]' });
  await button("Refresh artifacts");
  await cli("wait", "--fn", '!!document.getElementById("source-generation")');
  const options = await actions.options('Source checkpoint generation');
  record.sourceGenerationClassifications = options;
  assert.equal(options.filter((option) => option.value && !option.disabled).length, 2, "Exactly two fold publications are selectable");
  const summary = options.find((option) => /summary/i.test(option.label));
  assert(summary?.disabled, "CV summary publication must be explicitly unselectable");
  const summaryRefusal = { summaryDisabled: summary.disabled, help: await observe(`(()=>{const section=document.querySelector('section[aria-labelledby="inference-title"]');const help=Array.from(section?.querySelectorAll('button[aria-label]')??[]).find(button=>button.getAttribute('aria-label').includes('Cross-validation summaries cannot be used as model weights'));return !!help?.getClientRects().length;})()`) };
  assert(summaryRefusal.summaryDisabled && summaryRefusal.help, "Summary refusal must be visible in public UI");
  record.summaryRefusal = summaryRefusal;
  const fold = options.find((option) => !option.disabled && /fold 2$/.test(option.label));
  assert(fold, "A classified CV fold publication is required");
  await actions.select("Source checkpoint generation", fold.value);
  const scope = '//section[@aria-labelledby="inference-title"]';
  const rootLocator = await actions.readyControl("field", "Search roots and paths", false, { locator: `xpath=${scope}//*[@role="combobox" and @aria-label="Search roots and paths"]` });
  await cli("click", rootLocator); await actions.option("datasets");
  await actions.button("Select file samples.npz", false, { scope });
  await actions.fill("Python interpreter", record.pythonInterpreter, { scope });
  await actions.fill("Data loader workers", "0", { scope });
  await actions.select("Model export", "");
  await cli("click", await actions.readyControl("field", "Publish predictions CSV", false, { locator: "#inference-save_predictions" }));
  await actions.select("Operation", "test");
  await actions.button("Preview evaluation / plot plan", false, { scope });
  await openPlanDisclosure({ cli, dom });
  await cli("wait", "--fn", `document.getElementById("inference-title").closest("section").querySelector('[aria-label="Approved normalized manifest"]')!==null`);
  const plan = await observe('JSON.parse(document.getElementById("inference-title").closest("section").querySelector("[aria-label=\\"Approved normalized manifest\\"]").textContent)');
  assert.equal(plan.operation, "test");
  assert.equal(plan.resolved_config.export, null);
  assert.equal(plan.resolved_config.save_predictions, true);
  assert.equal(plan.runtime.device, "cpu");
  assert.equal(plan.checkpoint_source.generation, fold.value);
  record.foldEvaluationPlan = plan;
  const previewed = await registry(root);
  assert.equal(previewed.plans, before.plans + 1);
  await actions.button("Approve and start this plan", false, { scope });
  await pollRegistry(root, (state) => state.runs.some((run) => run.run_id === plan.run_id && run.state === "completed"), "CV fold evaluation completed", 90000);
  await actions.button("Results", false, { locator: '[data-testid="nav-results"]' }); await button("Refresh artifacts");
  await cli("wait", "--fn", `Array.from(document.querySelector("#results-title").closest("section").querySelectorAll("[data-artifact-path]")).some(r=>r.getAttribute('data-artifact-path').endsWith(".csv"))`);
  const rows = await observe(`Array.from(document.querySelector("#results-title").closest("section").querySelectorAll("[data-artifact-path]")).map(r=>[r.dataset.artifactGeneration + ' / ' + r.dataset.artifactAttempt, r.dataset.artifactPath, r.dataset.artifactSize])`);
  const predictionRows = rows.filter((r) => r[1] === "predictions.csv");
  assert.equal(predictionRows.length, 1, "Exactly one predictions.csv publication row required");
  const prediction = predictionRows[0];
  assert(prediction, "Evaluation must publish a predictions CSV");
  const artifactScope = `//section[@aria-labelledby="results-title"]//*[@data-artifact-generation=${xpathLiteral(prediction[0].split('/')[0].trim())} and @data-artifact-path=${xpathLiteral(prediction[1])}]`;
  const destination = join(downloads, "verified-cv-predictions.csv");
  await cli("download", await actions.readyControl("button", "Download", false, { scope: artifactScope }), destination);
  const bytes = await readFile(destination);
  assert(bytes.length > 16 && /,/.test(bytes.toString("utf8", 0, 512)), "Prediction download must contain CSV header bytes");
  record.predictionsDownload = { generation: prediction[0].split("/")[0].trim(), path: prediction[1], size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  record.cvParity = JSON.parse(await command(python, ["tools/browser_cv_parity_evidence.py", root, approvedManifest.run_id, fold.value, plan.run_id, record.predictionsDownload.generation, prediction[1], destination], undefined, 60000));
  assert.deepEqual(record.cvParity.artifact, record.predictionsDownload);
  record.finalRegistry = await registry(root);
  check(true, "Explicit CV fold selection produced genuine CPU evaluation and verified predictions bytes");
}
