import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { verifyTrainingFieldsRecord } from "./verify_training_fields_browser_report.mjs";

const inventory = JSON.parse(
  readFileSync(new URL("../web/shared/training-options.json", import.meta.url), "utf8"),
);
function fixture() {
  const yaml = Object.fromEntries(
    inventory.map((option) => [
      option.name,
      option.name === "model"
        ? "cnn"
        : option.name === "data_path"
          ? "/fixture/samples.npz"
          : option.multiple
            ? option.kind === "number"
              ? [0.2, 0.8]
              : ["/fixture/module.py"]
            : option.kind === "boolean"
              ? true
              : option.choices.length
                ? option.choices.find((item) => item !== option.default)
                : typeof option.default === "number"
                  ? option.default + 1
                  : "authored",
    ]),
  );
  yaml.precision = "no";
  yaml.cv = 0;
  const authored = Object.fromEntries(
    Object.entries(yaml).filter(([name]) => !["model", "data_path"].includes(name)),
  );
  const yamlText =
    Object.entries(yaml)
      .map(([name, value]) => `${name}: ${JSON.stringify(value)}`)
      .join("\n") + "\n";
  const commandText = "synthetic command for verifier unit test, not runtime evidence";
  const hash = (text) => createHash("sha256").update(text).digest("hex");
  const runtime = { python: "/fixture/python", mode: "selected", device: "cpu", environment: {} };
  const state = {
    plans: 1,
    runs: [],
    control: [
      {
        plan_id: "11111111-1111-4111-8111-111111111111",
        submission_requested: 0,
        cancellation_requested: 0,
      },
    ],
    executions: [],
  };
  const manifest = {
    run_id: "22222222-2222-4222-8222-222222222222",
    runtime,
    resolved_config: yaml,
  };
  const assets = Object.fromEntries(
    Array.from({ length: 32 }, (_, index) => [`file-${index}`, "a".repeat(64)]),
  );
  return {
    name: "training-fields-full",
    browser: "agent-browser 0.26",
    browserViewport: { width: 1280, height: 900 },
    browserRuntime: { userAgent: "Chrome/120", headed: false },
    browserProfile: { initiallyEmpty: true },
    freshStorage: { local: [], session: [], cookies: "" },
    status: "passed",
    driverReadinessMode: "sync-exposure-poll-and-two-controller-dom-observations",
    pythonInterpreter: runtime.python,
    assetManifestSha256: "a".repeat(64),
    finalRegistry: state,
    cleanup: {
      errors: [],
      browserSessionAbsent: true,
      fixtureServicesClosed: true,
      browserProfileRemoved: true,
      removedOwnedRoots: true,
      fixtureExit: { code: null, signal: "SIGINT" },
    },
    fullTrainingFields: {
      planId: state.control[0].plan_id,
      beforeAssets: assets,
      afterAssets: assets,
      inventorySha256: hash(JSON.stringify(inventory)),
      controlInventorySha256: hash(JSON.stringify(Object.keys(authored).sort())),
      inventoryCount: 46,
      controlCount: 44,
      inventory,
      authored,
      yaml,
      yamlText,
      yamlSha256: hash(yamlText),
      commandText,
      commandSha256: hash(commandText),
      nativeActions: inventory
        .filter((option) => option.name in authored)
        .map((option) => ({
          name: option.name,
          action: option.kind === "boolean" ? "click" : option.choices.length ? "select" : "fill",
          observation: {
            id: `field-${option.name}`,
            label: option.name.replaceAll("_", " "),
            value:
              option.kind === "boolean"
                ? "true"
                : option.multiple
                  ? yaml[option.name].join("\n")
                  : String(yaml[option.name]),
          },
        })),
      argv: [
        runtime.python,
        "-m",
        "wavedl.launcher",
        "--mixed_precision",
        "no",
        "--output_dir",
        "./results",
        "--model=cnn",
        "--data_path=/fixture/samples.npz",
      ],
      request: { config: yaml, runtime },
      approvedManifest: manifest,
      persistedManifest: manifest,
      parsedExports: {
        fields: 46,
        yaml,
        command: yaml,
        runtime: yaml,
        yaml_runtime: yaml,
        precision_conflict_rejected: true,
      },
      state,
      beforeState: { plans: 0, control: [], executions: [] },
      executionRequested: false,
      postAssetManifestSha256: "a".repeat(64),
    },
  };
}
test("full fields verifier accepts complete internally consistent record", () =>
  verifyTrainingFieldsRecord(fixture()));
for (const [name, mutate] of [
  [
    "missing browser context",
    (r) => {
      delete r.browserRuntime;
    },
  ],
  [
    "foreign viewport",
    (r) => {
      r.browserViewport.width = 800;
    },
  ],
  [
    "nonempty initial profile",
    (r) => {
      r.browserProfile.initiallyEmpty = false;
    },
  ],
  [
    "retained private roots",
    (r) => {
      r.cleanup.retainedPrivateRoots = ["/private"];
    },
  ],
  [
    "explicit skipped execution",
    (r) => {
      r.skipped = true;
    },
  ],
  [
    "stale inventory metadata",
    (r) => {
      r.fullTrainingFields.inventory = structuredClone(r.fullTrainingFields.inventory);
      r.fullTrainingFields.inventory[0].default = "foreign";
    },
  ],
  [
    "wrong inventory digest",
    (r) => {
      r.fullTrainingFields.inventorySha256 = "b".repeat(64);
    },
  ],
  [
    "wrong control inventory digest",
    (r) => {
      r.fullTrainingFields.controlInventorySha256 = "b".repeat(64);
    },
  ],
  [
    "foreign plan identity",
    (r) => {
      r.fullTrainingFields.planId = "33333333-3333-4333-8333-333333333333";
    },
  ],
  [
    "changed packaged file",
    (r) => {
      r.fullTrainingFields.afterAssets = {
        ...r.fullTrainingFields.afterAssets,
        "file-0": "b".repeat(64),
      };
    },
  ],
  [
    "partial field authoring",
    (r) => {
      delete r.fullTrainingFields.authored.lr;
    },
  ],
  [
    "default masquerading as authored",
    (r) => {
      r.fullTrainingFields.authored.lr = 0.001;
    },
  ],
  [
    "missing native action",
    (r) => {
      r.fullTrainingFields.nativeActions.pop();
    },
  ],
  [
    "duplicate native action",
    (r) => {
      r.fullTrainingFields.nativeActions[0] = r.fullTrainingFields.nativeActions[1];
    },
  ],
  [
    "wrong boolean action",
    (r) => {
      r.fullTrainingFields.nativeActions.find((item) => item.name === "compile").action = "fill";
    },
  ],
  [
    "wrong field observation",
    (r) => {
      r.fullTrainingFields.nativeActions[0].observation.value = "forged";
    },
  ],
  [
    "wrong label association",
    (r) => {
      r.fullTrainingFields.nativeActions[0].observation.label = "wrong";
    },
  ],
  [
    "wrong yaml hash",
    (r) => {
      r.fullTrainingFields.yamlSha256 = "b".repeat(64);
    },
  ],
  [
    "wrong command hash",
    (r) => {
      r.fullTrainingFields.commandSha256 = "b".repeat(64);
    },
  ],
  [
    "wrong YAML content",
    (r) => {
      r.fullTrainingFields.yamlText += 'secret: "token"\n';
    },
  ],
  [
    "partial CLI parse",
    (r) => {
      r.fullTrainingFields.parsedExports.command = {};
    },
  ],
  [
    "wrong bootstrap values",
    (r) => {
      r.fullTrainingFields.parsedExports.runtime = {};
    },
  ],
  [
    "wrong yaml bootstrap",
    (r) => {
      r.fullTrainingFields.parsedExports.yaml_runtime = {};
    },
  ],
  [
    "missing precision conflict",
    (r) => {
      r.fullTrainingFields.parsedExports.precision_conflict_rejected = false;
    },
  ],
  [
    "foreign runtime",
    (r) => {
      r.pythonInterpreter = "/foreign/python";
    },
  ],
  [
    "wrong dataset",
    (r) => {
      r.fullTrainingFields.yaml.data_path = "/foreign/data";
    },
  ],
  [
    "wrong precision alias",
    (r) => {
      r.fullTrainingFields.argv[4] = "fp16";
    },
  ],
  [
    "secret export",
    (r) => {
      r.fullTrainingFields.commandText += " Bearer";
      r.fullTrainingFields.commandSha256 = createHash("sha256")
        .update(r.fullTrainingFields.commandText)
        .digest("hex");
    },
  ],
  [
    "submission intent",
    (r) => {
      r.fullTrainingFields.state.control[0].submission_requested = 1;
    },
  ],
  [
    "cancellation intent",
    (r) => {
      r.fullTrainingFields.state.control[0].cancellation_requested = 1;
    },
  ],
  [
    "execution allocation",
    (r) => {
      r.fullTrainingFields.state.executions.push({});
    },
  ],
  [
    "auto preview on authoring",
    (r) => {
      r.fullTrainingFields.beforeState.plans = 1;
    },
  ],
  [
    "incorrect registry",
    (r) => {
      r.finalRegistry = {};
    },
  ],
  [
    "assets changed during acceptance",
    (r) => {
      r.fullTrainingFields.postAssetManifestSha256 = "b".repeat(64);
    },
  ],
  [
    "foreign fixture assets",
    (r) => {
      r.explicitFixtureWebAssets = "/fixture/assets";
    },
  ],
  [
    "unclosed browser",
    (r) => {
      r.cleanup.browserSessionAbsent = false;
    },
  ],
  [
    "unclosed fixture",
    (r) => {
      r.cleanup.fixtureServicesClosed = false;
    },
  ],
  [
    "missing cleanup",
    (r) => {
      r.cleanup.removedOwnedRoots = false;
    },
  ],
])
  test(`full fields verifier rejects ${name}`, () => {
    const r = fixture();
    mutate(r);
    assert.throws(() => verifyTrainingFieldsRecord(r));
  });
