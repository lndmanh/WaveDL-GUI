#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { boundedFile } from "./verify_retained_browser_report.mjs";
import { packagedAssetHashes } from "./browser_training_fields_full.mjs";
const inventory = JSON.parse(
  readFileSync(new URL("../web/shared/training-options.json", import.meta.url), "utf8"),
);

export function verifyTrainingFieldsRecord(record) {
  assert.equal(record.name, "training-fields-full");
  assert.equal(record.status, "passed");
  assert.equal(
    record.driverReadinessMode,
    "sync-exposure-poll-and-two-controller-dom-observations",
  );
  assert.equal(record.explicitFixtureWebAssets, undefined);
  assert.equal(typeof record.browser, "string");
  assert(record.browser.length > 0);
  assert.equal(typeof record.browserRuntime?.userAgent, "string");
  assert(record.browserRuntime.userAgent.includes("Chrome"));
  assert.equal(typeof record.browserRuntime.headed, "boolean");
  assert.deepEqual(record.browserViewport, { width: 1280, height: 900 });
  assert.equal(record.browserProfile?.initiallyEmpty, true);
  assert.deepEqual(record.freshStorage, { local: [], session: [], cookies: "" });
  for (const name of ["failure", "error", "skip", "skipped", "shutdownError"])
    assert.equal(record[name], undefined);
  assert.equal(record.cleanup.retainedPrivateRoots, undefined);
  for (const name of [
    "browserSessionAbsent",
    "fixtureServicesClosed",
    "browserProfileRemoved",
    "removedOwnedRoots",
  ])
    assert.equal(record.cleanup[name], true);
  assert.deepEqual(record.cleanup.errors, []);
  assert(
    (record.cleanup.fixtureExit.code === 0 && record.cleanup.fixtureExit.signal === null) ||
      (record.cleanup.fixtureExit.code === null && record.cleanup.fixtureExit.signal === "SIGINT"),
  );
  const full = record.fullTrainingFields;
  assert.deepEqual(full.inventory, inventory);
  assert.equal(full.inventoryCount, 46);
  assert.equal(full.controlCount, 44);
  assert.equal(full.inventory.length, 46);
  const keys = full.inventory.map((item) => item.name).sort();
  assert.equal(new Set(keys).size, 46);
  assert.deepEqual(Object.keys(full.yaml).sort(), keys);
  const editable = keys.filter((name) => !["model", "data_path"].includes(name));
  assert.deepEqual(Object.keys(full.authored).sort(), editable);
  assert.deepEqual(full.nativeActions.map((item) => item.name).sort(), editable);
  for (const option of full.inventory.filter((item) => editable.includes(item.name))) {
    const value = full.authored[option.name];
    if (option.name === "cv") {
      assert.equal(value, 0, "Regular-training authoring must keep CV disabled");
    } else {
      assert.notDeepEqual(value, option.default);
    }
    assert.deepEqual(full.yaml[option.name], value);
    const action = full.nativeActions.find((item) => item.name === option.name);
    assert.equal(
      action.action,
      option.kind === "boolean" ? "click" : option.choices.length ? "select" : "fill",
    );
    assert.equal(action.observation.label, option.name.replaceAll("_", " "));
    assert.equal(typeof action.observation.id, "string");
    assert(action.observation.id.length > 0);
    assert.equal(
      action.observation.value,
      option.kind === "boolean" ? "true" : option.multiple ? value.join("\n") : String(value),
    );
  }
  const hash = (text) => createHash("sha256").update(text).digest("hex");
  assert.equal(full.inventorySha256, hash(JSON.stringify(full.inventory)));
  assert.equal(full.controlInventorySha256, hash(JSON.stringify(editable)));
  assert.equal(Object.keys(full.beforeAssets).length, 37);
  assert.deepEqual(full.afterAssets, full.beforeAssets);
  assert(Object.values(full.beforeAssets).every((value) => /^[a-f0-9]{64}$/.test(value)));
  assert.equal(hash(full.yamlText), full.yamlSha256);
  assert.equal(hash(full.commandText), full.commandSha256);
  const yamlFromLines = Object.fromEntries(
    full.yamlText
      .trim()
      .split("\n")
      .filter((line) => !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf(":");
        return [line.slice(0, index), JSON.parse(line.slice(index + 1))];
      }),
  );
  assert.deepEqual(yamlFromLines, full.yaml);
  assert.deepEqual(full.request.config, full.yaml);
  for (const name of ["yaml", "command", "runtime", "yaml_runtime"])
    assert.deepEqual(full.parsedExports[name], full.yaml);
  assert.equal(full.parsedExports.fields, 46);
  assert.equal(full.parsedExports.precision_conflict_rejected, true);
  assert.deepEqual(full.approvedManifest, full.persistedManifest);
  for (const name of keys)
    assert.deepEqual(full.persistedManifest.resolved_config[name], full.yaml[name]);
  assert.equal(full.request.runtime.python, record.pythonInterpreter);
  for (const name of ["python", "mode", "device", "environment"])
    assert.deepEqual(full.request.runtime[name], full.persistedManifest.runtime[name]);
  assert.equal(full.request.runtime.device, "cpu");
  assert.deepEqual(full.request.runtime.environment, {});
  assert.equal(full.argv[0], record.pythonInterpreter);
  assert.equal(full.argv[full.argv.indexOf("--mixed_precision") + 1], full.yaml.precision);
  assert.equal(full.argv[full.argv.indexOf("--output_dir") + 1], "./results");
  assert(full.argv.includes(`--model=${full.yaml.model}`));
  assert(full.argv.includes(`--data_path=${full.yaml.data_path}`));
  assert.equal(full.yaml.model, "cnn");
  assert(full.yaml.data_path.endsWith("/samples.npz"));
  assert(!/Bearer|Authorization|access_token|WAVEDL_TOKEN/.test(full.yamlText + full.commandText));
  assert.equal(full.beforeState.plans, 0);
  assert.deepEqual(full.beforeState.control, []);
  assert.deepEqual(full.beforeState.executions, []);
  assert.equal(full.state.plans, 1);
  assert.deepEqual(full.state.executions, []);
  assert.equal(full.state.control.length, 1);
  assert.equal(full.state.control[0].plan_id, full.planId);
  assert(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(full.planId));
  assert(
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      full.persistedManifest.run_id,
    ),
  );
  assert.equal(full.state.control[0].submission_requested, 0);
  assert.equal(full.state.control[0].cancellation_requested, 0);
  assert.deepEqual(record.finalRegistry, full.state);
  assert.equal(full.executionRequested, false);
  assert.equal(full.postAssetManifestSha256, record.assetManifestSha256);
  return record;
}
export async function verifyTrainingFieldsFile(path) {
  const record = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(await boundedFile(path, 1024 * 1024)),
  );
  verifyTrainingFieldsRecord(record);
  const assets = await readFile(
    new URL("../src/wavedl_daemon/web_assets/.wavedl-assets.json", import.meta.url),
  );
  assert.equal(createHash("sha256").update(assets).digest("hex"), record.assetManifestSha256);
  const inventory = JSON.parse(
    await readFile(new URL("../web/shared/training-options.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(record.fullTrainingFields.inventory, inventory);
  assert.deepEqual(
    record.fullTrainingFields.afterAssets,
    await packagedAssetHashes(fileURLToPath(new URL("../", import.meta.url))),
  );
  const full = record.fullTrainingFields;
  const python = process.env.WAVEDL_PYTHON ?? "python";
  const exports = JSON.parse(
    execFileSync(
      python,
      [fileURLToPath(new URL("./verify_training_exports.py", import.meta.url))],
      {
        input: JSON.stringify({
          request: full.request,
          yaml: full.yamlText,
          command: full.commandText,
        }),
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    ),
  );
  assert.deepEqual(exports, full.parsedExports);
  const argv = JSON.parse(
    execFileSync(
      python,
      ["-c", "import json,shlex,sys; print(json.dumps(shlex.split(sys.stdin.read())))"],
      {
        input: full.commandText,
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    ),
  );
  assert.deepEqual(argv, full.argv);
  return record;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyTrainingFieldsFile(process.argv[2]);
  console.log("Full training fields browser report verified");
}
