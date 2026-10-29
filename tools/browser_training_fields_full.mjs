import { openPlanDisclosure, normalizeTrainingFieldLabel, trainingChoiceLabel, CONTROL_VALUE_SOURCE } from './browser_actions.mjs';
// Full real-browser authoring slice. It deliberately stops at plan preview:
// no training execution, remote host, or Windows path is exercised here.
import assert from "node:assert/strict";
import { readFile, readdir, access, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative, sep } from "node:path";

export async function packagedAssetHashes(repo) {
  const base = join(repo, "src/wavedl_daemon/web_assets");
  const files = JSON.parse(await readFile(join(base, ".wavedl-assets.json"), "utf8"));
  const hashes = {};
  // The manifest must name exactly the packaged files: no stale or unlisted asset.
  const present = (await readdir(base, { recursive: true, withFileTypes: true }))
    .filter((entry) => !entry.isDirectory())
    .map((entry) => relative(base, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .filter((name) => name !== ".wavedl-assets.json");
  assert.deepEqual(present.sort(), Object.keys(files).sort());
  for (const [name, expected] of Object.entries(files)) {
    assert(
      name &&
        !name.startsWith("/") &&
        name.split("/").every((part) => part && part !== "." && part !== ".."),
    );
    const path = join(base, name);
    const metadata = await lstat(path);
    assert(metadata.isFile() && !metadata.isSymbolicLink() && metadata.size <= 32 * 1024 * 1024);
    hashes[name] = createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
    assert.equal(hashes[name], expected);
  }
  return hashes;
}

export async function fullTrainingFields(driver) {
  const {
    cli,
    dom,
    fill,
    actions,
    controlExpression,
    registry,
    root,
    downloads,
    check,
    record,
    python,
    command,
    repo,
  } = driver;
  const options = JSON.parse(
    await readFile(join(repo, "src/wavedl_daemon/web/shared/training-options.json"), "utf8"),
  );
  const beforeAssets = await packagedAssetHashes(repo);
  const value = {
    import_modules: [`${root}/fixture_modules.py`],
    batch_size: 17,
    lr: 0.000123456789,
    epochs: 23,
    patience: 7,
    weight_decay: 0.00023456789,
    grad_clip: 2.75,
    grad_accum_steps: 3,
    loss: "weighted_mse",
    huber_delta: 0.75,
    loss_weights: "1.25,2.5",
    optimizer: "sgd",
    momentum: 0.85,
    nesterov: true,
    betas: "0.8,0.98",
    scheduler: "multistep",
    scheduler_patience: 6,
    min_lr: 0.000000123456789,
    scheduler_factor: 0.75,
    warmup_epochs: 2,
    step_size: 8,
    milestones: "4,8,16",
    workers: 2,
    seed: 1234,
    deterministic: true,
    cache_validate: "size",
    single_channel: true,
    // This regular-training inventory includes resume/compile/tracking controls;
    // CV has a separate supported-options/refusal contract.
    cv: 0,
    cv_stratify: true,
    cv_bins: 7,
    resume: `${root}/resume.pth`,
    save_every: 4,
    fresh: true,
    compile: true,
    precision: "no",
    constraint: ["balance", "boundary"],
    constraint_file: `${root}/constraint.py`,
    constraint_weight: [0.125, 0.875],
    constraint_reduction: "mae",
    wandb: true,
    wandb_watch: true,
    project_name: "browser authored",
    run_name: "browser authored run",
  };
  const before = await registry(root);
  assert.equal(before.plans, 0);
  assert.deepEqual(before.control, []);
  assert.deepEqual(before.executions, []);
  assert.equal(options.length, 46);
  const nativeActions = [];
  const enablingActions = [];
  const labelFor = (name) => normalizeTrainingFieldLabel(name);
  // `pretrained` belongs to the Model block, where it is the ImageNet-weights
  // switch of a model with a weighted variant. The selected CNN has none, so
  // the builder offers no control for it and it keeps its default.
  const modelOwned = ["pretrained"];
  assert.equal(
    Object.keys(value).length,
    43,
    "Authored inventory must have exactly 43 Training-block values",
  );
  check(
    await dom(`JSON.stringify(!document.querySelector('[data-testid="model-weights-cnn"]') && !Array.from(document.querySelectorAll('section[aria-labelledby="project-title"] label')).some(e => e.textContent.trim() === ${JSON.stringify(labelFor("pretrained"))}))`),
    "The selected CNN offers no pretrained-weights control and Training has no pretrained setting",
  );
  // The builder renders a setting only while the current choices read it (or it
  // differs from its default), so dependent settings are authored after the
  // choice that exposes them; later choices then move on to their final values.
  const enabling = {
    huber_delta: ["loss", "huber"],
    loss_weights: ["loss", "weighted_mse"],
    momentum: ["optimizer", "sgd"],
    nesterov: ["optimizer", "sgd"],
    warmup_epochs: ["scheduler", "linear_warmup"],
    step_size: ["scheduler", "step"],
    milestones: ["scheduler", "multistep"],
    cv_stratify: ["cv", 2],
    cv_bins: ["cv", 2],
  };
  const order = [
    "import_modules", "batch_size", "lr", "epochs", "patience", "weight_decay", "grad_clip",
    "grad_accum_steps", "betas", "scheduler_patience", "min_lr", "scheduler_factor",
    "huber_delta", "loss_weights", "loss", "momentum", "nesterov", "optimizer",
    "warmup_epochs", "step_size", "milestones", "scheduler",
    "workers", "seed", "deterministic", "cache_validate", "single_channel",
    "cv_stratify", "cv_bins", "cv", "resume", "save_every", "fresh", "compile", "precision",
    "constraint", "constraint_file", "constraint_weight", "constraint_reduction",
    "wandb", "wandb_watch", "project_name", "run_name",
  ];
  const optionFor = (name) => options.find((item) => item.name === name);
  assert.deepEqual(
    [...order].sort(),
    options.map((item) => item.name).filter((name) => !["model", "data_path", ...modelOwned].includes(name)).sort(),
  );
  const checkBox = async (name) => {
    const locator = await actions.readyControl("field", labelFor(name));
    const expression = `(${controlExpression("field", labelFor(name), { locator })})[0]?.getAttribute('aria-checked')`;
    const checked = await dom(`JSON.stringify(${expression})`);
    assert(["true", "false"].includes(checked), "Boolean control must expose its ARIA state");
    if (checked !== "true") await cli("click", locator);
    await cli("wait", "--fn", `${expression} === 'true'`);
  };
  const author = async (option, authored) => {
    if (option.kind === "boolean") await checkBox(option.name);
    else if (option.choices.length) await actions.select(labelFor(option.name), String(authored));
    else if (option.multiple) await fill(labelFor(option.name), authored.join("\n"));
    else await fill(labelFor(option.name), String(authored));
    const observation = await dom(
      `JSON.stringify(${controlExpression("field", labelFor(option.name))}.filter(e=>e.getClientRects().length).map(e=>({id:e.id,label:${JSON.stringify(labelFor(option.name))},tag:e.tagName,value:${CONTROL_VALUE_SOURCE}(e)})))`,
    );
    assert.equal(observation.length, 1);
    // Few-choice settings are segmented controls that show the choice's label.
    const segmented = option.choices.length > 0 && option.choices.length <= 3;
    const expected =
      option.kind === "boolean"
        ? "true"
        : option.multiple
          ? authored.join("\n")
          : segmented
            ? trainingChoiceLabel(option.name, String(authored))
            : String(authored);
    assert.equal(observation[0].value, expected);
    return observation[0];
  };
  for (const name of order) {
    const option = optionFor(name);
    const authored = value[name];
    assert.notEqual(authored, undefined, `Missing authoring case ${name}`);
    if (name !== "cv") {
      assert.notDeepEqual(authored, option.default, `${name} must be authored nondefault`);
    } else {
      assert.equal(authored, 0, "Complete regular-training authoring keeps CV disabled");
    }
    const enabler = enabling[name];
    if (enabler) {
      const [controlling, setting] = enabler;
      enablingActions.push({ name, enabling: controlling, value: setting,
        observation: await author(optionFor(controlling), setting) });
    }
    nativeActions.push({
      name,
      action: option.kind === "boolean" ? "click" : option.choices.length ? "select" : "fill",
      observation: await author(option, authored),
    });
  }
  const yamlPath = join(downloads, "full-training-fields.yaml");
  await cli("download", await actions.configMenuItem("Download YAML"), yamlPath);
  await access(yamlPath);
  const yamlText = await readFile(yamlPath, "utf8");
  const yaml = JSON.parse(
    await command(python, [
      "-c",
      "import json,sys,yaml; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))",
      yamlPath,
    ]),
  );
  check(
    Object.keys(yaml).length === options.length,
    "Full browser export contains all 46 training destinations",
  );
  check(
    Object.entries(value).every(
      ([name, authored]) => JSON.stringify(yaml[name]) === JSON.stringify(authored),
    ) && yaml.pretrained === optionFor("pretrained").default,
    "Full browser YAML preserves each authored nondefault field and the model-owned pretrained default",
  );
  await actions.copyStandaloneCommand();
  const text = await actions.copiedCommand();
  check(text.includes("wavedl.launcher"), "Copied standalone command was handed to the browser clipboard");
  const argv = JSON.parse(
    await command(
      python,
      ["-c", "import json,shlex,sys; print(json.dumps(shlex.split(sys.stdin.read())))"],
      text,
    ),
  );
  check(
    argv.includes("--mixed_precision") && argv[argv.indexOf("--mixed_precision") + 1] === "no",
    "Full browser command retains explicit precision",
  );
  check(
    (await registry(root)).plans === 0,
    "All 43 field edits and exports create no durable plan",
  );
  await actions.createPlan();
  await cli("wait", "--text", "Persisted plan for approval");
  await openPlanDisclosure({ cli, dom });
  const approved = JSON.parse(
    await dom(
      'JSON.stringify(document.querySelector("[aria-label=\\"Approved normalized manifest\\"]")?.textContent)',
    ),
  );
  check(
    Object.entries(value).every(
      ([name, authored]) =>
        JSON.stringify(approved.resolved_config[name]) === JSON.stringify(authored),
    ),
    "Persisted preview manifest retains all browser-authored nondefaults",
  );
  const rows = JSON.parse(
    await command(python, [
      "-c",
      'import json,sqlite3,sys; from pathlib import Path; c=sqlite3.connect((Path(sys.argv[1])/"state"/"registry.db").resolve().as_uri()+"?mode=ro",uri=True); print(json.dumps(list(c.execute("SELECT plan_id,request_payload_json,plan_json FROM plans"))))',
      root,
    ]),
  );
  assert.equal(rows.length, 1);
  const planId = rows[0][0];
  const request = JSON.parse(rows[0][1]);
  const persistedManifest = JSON.parse(JSON.parse(rows[0][2]).manifest_json);
  assert.deepEqual(request.config, yaml);
  assert.deepEqual(persistedManifest, approved);
  check(
    true,
    "All 46 YAML destinations exactly equal the actual persisted plan request and browser manifest",
  );
  const parsedExports = JSON.parse(
    await command(
      python,
      [join(repo, "tools/verify_training_exports.py")],
      JSON.stringify({ request, yaml: await readFile(yamlPath, "utf8"), command: text }),
    ),
  );
  assert.deepEqual(parsedExports.yaml_runtime, yaml);
  assert.deepEqual(parsedExports.runtime, yaml);
  check(
    true,
    "Downloaded YAML and copied POSIX command parse and bootstrap to all 46 persisted configuration values",
  );
  const finalState = await registry(root);
  assert.equal(finalState.executions.length, 0);
  assert(
    finalState.control.every(
      (row) => row.submission_requested === 0 && row.cancellation_requested === 0,
    ),
  );
  const assets = await readFile(join(repo, "src/wavedl_daemon/web_assets/.wavedl-assets.json"));
  const hash = (text) => createHash("sha256").update(text).digest("hex");
  assert.equal(hash(assets), record.assetManifestSha256);
  const afterAssets = await packagedAssetHashes(repo);
  assert.deepEqual(afterAssets, beforeAssets);
  record.fullTrainingFields = {
    planId,
    beforeAssets,
    afterAssets,
    inventorySha256: hash(JSON.stringify(options)),
    controlInventorySha256: hash(
      JSON.stringify(
        options
          .map((item) => item.name)
          .filter((name) => !["model", "data_path", ...modelOwned].includes(name))
          .sort(),
      ),
    ),
    inventoryCount: options.length,
    controlCount: 43,
    modelOwned,
    inventory: options,
    nativeActions,
    enablingActions,
    authored: value,
    yamlText,
    yamlSha256: hash(yamlText),
    commandText: text,
    commandSha256: hash(text),
    yaml,
    argv,
    request,
    parsedExports,
    approvedManifest: approved,
    persistedManifest,
    state: finalState,
    beforeState: before,
    executionRequested: false,
    postAssetManifestSha256: hash(assets),
  };
}
