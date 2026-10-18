// Full real-browser authoring slice. It deliberately stops at plan preview:
// no training execution, remote host, or Windows path is exercised here.
import assert from "node:assert/strict";
import { readFile, access, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

export async function packagedAssetHashes(repo) {
  const base = join(repo, "src/wavedl_daemon/web_assets");
  const files = JSON.parse(await readFile(join(base, ".wavedl-assets.json"), "utf8"));
  const hashes = {};
  assert.equal(Object.keys(files).length, 37);
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
    button,
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
    await readFile(join(repo, "web/shared/training-options.json"), "utf8"),
  );
  const beforeAssets = await packagedAssetHashes(repo);
  const value = {
    import_modules: [`${root}/fixture_modules.py`],
    pretrained: true,
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
  const labelFor = (name) => name.replaceAll("_", " ");
  const details = {
    "Optimizer, loss and scheduling": [
      "weight_decay",
      "grad_clip",
      "grad_accum_steps",
      "huber_delta",
      "loss_weights",
      "momentum",
      "nesterov",
      "betas",
      "scheduler_patience",
      "min_lr",
      "scheduler_factor",
      "warmup_epochs",
      "step_size",
      "milestones",
    ],
    "Data, checkpoints and cross-validation": [
      "workers",
      "cache_validate",
      "single_channel",
      "cv_bins",
      "resume",
      "save_every",
      "fresh",
    ],
    "Custom models and physical constraints": [
      "import_modules",
      "pretrained",
      "constraint",
      "constraint_file",
      "constraint_weight",
      "constraint_reduction",
    ],
    "Optional experiment logging": ["wandb", "wandb_watch", "project_name", "run_name"],
  };
  assert.equal(
    Object.keys(value).length,
    44,
    "Authored inventory must have exactly 44 editable values",
  );
  for (const text of Object.keys(details)) {
    const open = await dom(
      `JSON.stringify(${controlExpression("summary", text)}[0]?.closest('details')?.open)`,
    );
    if (!open) await actions.expandSummary(text);
  }
  const checkBox = async (name) => {
    const locator = await actions.readyControl("field", labelFor(name));
    const expression = `(${controlExpression("field", labelFor(name), { locator })})[0]?.getAttribute('aria-checked')`;
    const checked = await dom(`JSON.stringify(${expression})`);
    assert(["true", "false"].includes(checked), "Boolean control must expose its ARIA state");
    if (checked !== "true") await cli("click", locator);
    await cli("wait", "--fn", `${expression} === 'true'`);
  };
  for (const option of options.filter((item) => !["model", "data_path"].includes(item.name))) {
    const authored = value[option.name];
    assert.notEqual(authored, undefined, `Missing authoring case ${option.name}`);
    if (option.name !== "cv") {
      assert.notDeepEqual(authored, option.default, `${option.name} must be authored nondefault`);
    } else {
      assert.equal(authored, 0, "Complete regular-training authoring keeps CV disabled");
    }
    if (option.kind === "boolean") await checkBox(option.name);
    else if (option.choices.length) await actions.select(labelFor(option.name), String(authored));
    else if (option.multiple) await fill(labelFor(option.name), authored.join("\n"));
    else await fill(labelFor(option.name), String(authored));
    const observation = await dom(
      `JSON.stringify(${controlExpression("field", labelFor(option.name))}.filter(e=>e.getClientRects().length).map(e=>({id:e.id,label:${JSON.stringify(labelFor(option.name))},tag:e.tagName,value:e.getAttribute('aria-checked')??e.value})))`,
    );
    assert.equal(observation.length, 1);
    const expected =
      option.kind === "boolean" ? "true" : option.multiple ? authored.join("\n") : String(authored);
    assert.equal(observation[0].value, expected);
    nativeActions.push({
      name: option.name,
      action: option.kind === "boolean" ? "click" : option.choices.length ? "select" : "fill",
      observation: observation[0],
    });
  }
  await actions.expandSummary("Standalone configuration export");
  const yamlPath = join(downloads, "full-training-fields.yaml");
  await cli("download", await actions.readyControl("button", "Download YAML"), yamlPath);
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
    ),
    "Full browser YAML preserves each authored nondefault field",
  );
  await button("Copy standalone CLI command");
  await cli(
    "wait",
    "--fn",
    `Array.from(document.querySelectorAll('pre')).some(e=>e.getClientRects().length&&e.textContent.includes('wavedl.launcher'))`,
  );
  const text = await dom(
    'JSON.stringify(Array.from(document.querySelectorAll("pre")).find(e=>e.getClientRects().length&&e.textContent.includes("wavedl.launcher"))?.textContent)',
  );
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
    "All 44 field edits and exports create no durable plan",
  );
  await button("Preview persisted plan");
  await cli("wait", "--text", "Persisted plan for approval");
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
          .filter((name) => !["model", "data_path"].includes(name))
          .sort(),
      ),
    ),
    inventoryCount: options.length,
    controlCount: 44,
    inventory: options,
    nativeActions,
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
