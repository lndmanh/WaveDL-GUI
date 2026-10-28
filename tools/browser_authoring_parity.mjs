import { openPlanDisclosure } from './browser_actions.mjs';
// Real UI-only authoring slice. No Vue/private transport state or API mutations.
import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export async function authoringParity(driver) {
  const { cli, dom, snapshot, button, fill, actions, controlExpression, registry,
    root, downloads, check, record, interpreter, python, command, repo } = driver;
  const inventory = JSON.parse(await readFile(join(repo, 'web/shared/training-options.json'), 'utf8'));
  const defaults = Object.fromEntries(inventory.map((option) => [option.name, option.default]));
  const values = async (labels) => dom(`JSON.stringify(${JSON.stringify(labels)}.map(name => {
    const label=Array.from(document.querySelectorAll('section[aria-labelledby="project-title"] label')).find(e=>e.textContent.trim()===name);
    const control=label ? document.getElementById(label.htmlFor) : null;
    return control ? (control.getAttribute('data-value') ?? control.value) : null;
  }))`);
  const select = (label, value) => actions.select(label, value);
  const expand = async (text) => {
    const isOpen = await dom(`JSON.stringify(${controlExpression('summary', text)}[0]?.getAttribute('aria-expanded') === 'true')`);
    if (!isOpen) {
      const before = await registry(root);
      await actions.expandSummary(text);
      check(JSON.stringify(await registry(root)) === JSON.stringify(before), `Expanding ${text} caused no daemon mutation`);
    }
  };
  const capturePlan = async () => {
    const state = await registry(root);
    const output = await command(python, ['-c', 'import json,sqlite3,sys; from pathlib import Path; c=sqlite3.connect((Path(sys.argv[1])/"state"/"registry.db").resolve().as_uri()+"?mode=ro",uri=True); print(json.dumps(list(c.execute("SELECT plan_id,request_payload_json,plan_json FROM plans ORDER BY plan_id"))))', root]);
    return { state, rows: JSON.parse(output) };
  };
  const noSubmit = async (description) => {
    const state = await registry(root);
    check(state.executions.length === 0 && state.control.every((row) => row.submission_requested === 0), description);
    return state;
  };
  const exportYaml = async (filename) => {
    const selector = await actions.readyControl('button', 'Download YAML');
    assert(selector, 'YAML download control missing');
    await cli('scrollintoview', selector);
    const path = join(downloads, filename);
    await cli('download', selector, path);
    const output = await command(python, ['-c', 'import json,sys,yaml; from pathlib import Path; print(json.dumps(yaml.safe_load(Path(sys.argv[1]).read_text())))', path]);
    const bytes = await readFile(path);
    return { path, config: JSON.parse(output), filename, size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') };
  };

  // Exercise backward/forward navigation using the existing genuine selections.
  await button('Use guided steps');
  await button('Previous step');
  await cli('wait', '--fn', `Array.from(document.querySelectorAll('[data-testid=selected-dataset],[data-testid=selected-model]')).some(e=>e.getClientRects().length&&e.textContent.includes('samples.npz'))`);
  await button('Next step');
  await cli('wait', '--fn', `Array.from(document.querySelectorAll('[data-testid=selected-dataset],[data-testid=selected-model]')).some(e=>e.getClientRects().length&&e.textContent.trim().startsWith('Model: cnn'))`);
  await button('Next step');
  await button('Previous step');
  await button('Show full editor');
  record.guidedSelectionsPreserved = await dom(`JSON.stringify(Array.from(document.querySelectorAll('[data-testid=selected-dataset],[data-testid=selected-model]')).some(e=>e.textContent.trim().startsWith('Dataset: ')&&e.textContent.includes('/samples.npz'))&&Array.from(document.querySelectorAll('[data-testid=selected-dataset],[data-testid=selected-model]')).some(e=>e.textContent.trim().startsWith('Model: cnn')))`);
  check(record.guidedSelectionsPreserved, 'Guided backward/forward navigation preserved genuine daemon dataset and catalogue model');

  await actions.button('Settings', false, { locator: '[data-testid="nav-settings"]' });
  await cli('wait', '--text', 'Browser preferences, not daemon administration.');
  record.downloadSettingsGuidance = await dom(`JSON.stringify(document.querySelector('#downloads-heading')?.closest('section')?.innerText)`);
  check(record.downloadSettingsGuidance.includes('Your browser chooses where'), 'Settings honestly exposes browser-owned download guidance, not an invented workstation folder preference');
  await expand('Training and optional W&B defaults');
  await fill('epochs', '19');
  await button('Save training defaults');
  await cli('wait', '--text', 'Defaults saved for new drafts on this daemon.');
  await button('Close overlay');
  await actions.button('New training run', false, { locator: '[data-testid="nav-project"]' });
  check((await values(['epochs']))[0] === '10000', 'Saved new-run preference did not mutate the existing project draft');

  const authored = { epochs: 11, patience: 4, batch_size: 8, lr: 0.003,
    seed: 37, workers: 0, precision: 'no', weight_decay: 0.002 };
  const author = async () => {
    for (const [label, value] of [['epochs', authored.epochs], ['patience', authored.patience],
      ['batch size', authored.batch_size], ['lr', authored.lr], ['seed', authored.seed]]) await fill(label, String(value));
    await expand('Optimizer, loss and scheduling');
    await fill('weight decay', String(authored.weight_decay));
    await expand('Data, checkpoints and cross-validation');
    await fill('workers', '0');
    await select('precision', 'no');
  };
  await author();
  const labels = ['epochs', 'patience', 'batch size', 'lr', 'seed', 'workers', 'precision', 'weight decay', 'Python interpreter'];
  const beforeReset = await values(labels);
  await expand('Standalone configuration export');
  const beforeResetDownload = await exportYaml('authoring-before-reset.yaml');
  await button('Reset training defaults');
  await button('Keep draft');
  check(JSON.stringify(await values(labels)) === JSON.stringify(beforeReset), 'Cancelling reset preserved all representative authored values and interpreter');
  await button('Reset training defaults');
  await button('Confirm reset');
  const resetValues = await values(['epochs', 'batch size', 'Python interpreter']);
  check(Number(resetValues[0]) === defaults.epochs && Number(resetValues[1]) === defaults.batch_size && resetValues[2] === interpreter, 'Confirmed project reset restored bundled defaults and preserved execution interpreter');
  check(await dom(`JSON.stringify(Array.from(document.querySelectorAll('[data-testid=selected-dataset],[data-testid=selected-model]')).some(e=>e.textContent.trim().startsWith('Dataset: ')&&e.textContent.includes('/samples.npz'))&&Array.from(document.querySelectorAll('[data-testid=selected-dataset],[data-testid=selected-model]')).some(e=>e.textContent.trim().startsWith('Model: cnn')))`), 'Confirmed reset preserved selected daemon dataset and catalogue model');
  record.resetContract = { restoredBundledDefaults: true, savedNewRunEpochs: 19, restoredEpochs: Number(resetValues[0]), interpreterPreserved: true };
  const afterResetDownload = await exportYaml('authoring-after-reset.yaml');
  check(afterResetDownload.config.data_path === beforeResetDownload.config.data_path && afterResetDownload.config.model === beforeResetDownload.config.model && afterResetDownload.config.epochs === defaults.epochs, 'Actual reset exports preserve dataset/model and restore bundled defaults in the unchanged browser download directory');
  await access(beforeResetDownload.path); await access(afterResetDownload.path);
  await actions.button('Settings', false, { locator: '[data-testid="nav-settings"]' });
  await expand('Training and optional W&B defaults');
  check((await values(['epochs']))[0] === '19', 'Project reset preserved separately saved browser new-run preference');
  await button('Close overlay');
  await actions.button('New training run', false, { locator: '[data-testid="nav-project"]' });
  await author();
  await expand('Standalone configuration export');

  const exported = await exportYaml('authoring-before-plan.yaml');
  check(Object.keys(exported.config).sort().join('|') === inventory.map((option) => option.name).sort().join('|'), 'Real downloaded YAML includes every training-schema inventory key');
  check(Object.entries(authored).every(([key, value]) => exported.config[key] === value), 'Real YAML bytes preserve eight representative UI-authored training values');
  check([' ', "'", '$', ';'].every((character) => exported.config.data_path.includes(character)), 'Actual selected daemon dataset path exercises spaces, quote and shell metacharacters');
  check(!['runtime', 'environment', 'token', 'access_token', 'output_dir'].some((key) => key in exported.config), 'YAML contains no runtime credentials/environment or allocated daemon output directory');
  await button('Copy standalone CLI command');
  await cli('wait', '--fn', `Array.from(document.querySelectorAll('[aria-label="Copied standalone command"]')).some(e=>e.getClientRects().length&&e.textContent.includes('wavedl.launcher'))`);
  const text = await dom(`JSON.stringify(Array.from(document.querySelectorAll('[aria-label="Copied standalone command"]')).find(e=>e.getClientRects().length&&e.textContent.includes('wavedl.launcher'))?.textContent)`);
  const argv = JSON.parse(await command(python, ['-c', 'import json,shlex,sys; print(json.dumps(shlex.split(sys.stdin.read())))'], text));
  check(argv[0] === interpreter && argv.includes(`--data_path=${exported.config.data_path}`) && argv.includes('--mixed_precision') && argv[argv.indexOf('--mixed_precision') + 1] === 'no', 'Generated POSIX command parses to exact interpreter, quoted metacharacter dataset path and precision alias');
  check(argv.includes('--output_dir') && argv[argv.indexOf('--output_dir') + 1] === './results' && !text.includes(join(root, 'runs')) && !/Bearer|access_token|Authorization/.test(text), 'Standalone command uses only explicit ./results output and no allocated daemon target or credentials');

  // Exercise export safety through the visible editor. YAML is configuration-only
  // and must omit explicit runtime environment values; the standalone command
  // must refuse that environment rather than silently dropping it.
  await expand('Explicit runtime environment');
  await fill('New environment variable', 'EXPORT_PROBE');
  await button('Add variable');
  await fill('EXPORT_PROBE', 'browser-secret-probe', {
    locator: '#env-EXPORT_PROBE',
  });
  await expand('Standalone configuration export');
  const environmentDownload = await exportYaml('authoring-environment.yaml');
  const environmentBytes = await readFile(environmentDownload.path, 'utf8');
  check(!environmentBytes.includes('browser-secret-probe') && !('environment' in environmentDownload.config),
    'YAML export omits visible runtime environment values and secrets');
  await button('Copy standalone CLI command');
  await cli('wait', '--text', 'Explicit environment values are not exported');
  const environmentRefusal = await dom(`JSON.stringify(Array.from(document.querySelectorAll('[role="status"]')).some(e => e.getClientRects().length&&e.textContent.includes('Explicit environment values are not exported'))) `);
  check(environmentRefusal, 'Standalone command visibly refuses explicit runtime environment values');
  await expand('Explicit runtime environment');
  await button('Remove EXPORT_PROBE');

  // A multi-node topology is not exportable without rendezvous configuration;
  // prove the browser surfaces the refusal and restore the draft afterwards.
  await fill('Machines', '2');
  await button('Copy standalone CLI command');
  await cli('wait', '--text', 'Multi-node standalone commands require explicit rendezvous');
  const topologyRefusal = await dom(`JSON.stringify(Array.from(document.querySelectorAll('[role="status"]')).some(e => e.getClientRects().length&&e.textContent.includes('Multi-node standalone commands require explicit rendezvous'))) `);
  check(topologyRefusal, 'Standalone command visibly refuses unsupported multi-node topology');
  await fill('Machines', '1');
  record.authoringExports = { allTrainingKeys: Object.keys(exported.config).sort(), inventoryCount: inventory.length, authoredValues: authored, yamlConfig: exported.config, parsedCommandArgv: argv, browserDownloadPath: downloads, partialFieldAuthoring: true,
    exportSafety: { environmentDownload: { filename: environmentDownload.filename, size: environmentDownload.size, sha256: environmentDownload.sha256, config: environmentDownload.config }, environmentOmitted: true, environmentCommandRefused: environmentRefusal, topologyCommandRefused: topologyRefusal } };

  const invalidPreset = join(downloads, 'invalid-preset.json');
  await writeFile(invalidPreset, JSON.stringify({ epochs: 100, import_modules: ['untrusted.custom_models'] }), { flag: 'wx', mode: 0o600 });
  await snapshot();
  await cli('upload', '#training-preset-import', invalidPreset);
  await cli('wait', '--text', 'Invalid preset.');
  check(JSON.stringify(await values(labels)) === JSON.stringify(beforeReset), 'Executable-authority preset upload is rejected without changing representative draft values');
  check((await registry(root)).plans === 0, 'Reset, exports and malformed preset import created no daemon plan');

  await button('Preview persisted plan');
  await cli('wait', '--text', 'Persisted plan for approval');
  await openPlanDisclosure({ cli, dom });
  const first = await capturePlan();
  check(first.state.plans === 1, 'First explicit preview persists exactly one unsubmitted plan');
  await fill('epochs', '12');
  check(await dom(`JSON.stringify(!document.querySelector('[aria-label="Approved normalized manifest"]')&&!Array.from(document.querySelectorAll('button')).some(e=>e.getClientRects().length&&!e.disabled&&e.textContent.trim()==='Approve and start this plan'))`), 'Editing a field revokes the old visible approval immediately');
  const unchanged = await capturePlan();
  check(JSON.stringify(first.rows) === JSON.stringify(unchanged.rows), 'Editing draft leaves original daemon plan bytes immutable');
  await fill('batch size', '0');
  await button('Preview persisted plan');
  await cli('wait', '--text', 'Review the validation errors');
  check((await registry(root)).plans === 1, 'Invalid numeric range is blocked before a second API plan is created');
  await fill('batch size', '8');
  await button('Preview persisted plan');
  await cli('wait', '--text', 'Persisted plan for approval');
  await openPlanDisclosure({ cli, dom });
  const final = await capturePlan();
  check(final.state.plans === 2 && final.rows.some((row) => JSON.stringify(row) === JSON.stringify(first.rows[0])), 'Valid revised preview persists a new plan while preserving original immutable plan');
  await openPlanDisclosure({ cli, dom });
  const approved = JSON.parse(await dom(`JSON.stringify(document.querySelector('[aria-label="Approved normalized manifest"]')?.textContent)`));
  check(approved.resolved_config.epochs === 12 && Object.entries(authored).filter(([key]) => key !== 'epochs').every(([key, value]) => approved.resolved_config[key] === value), 'Revised persisted approval exactly matches validated UI-authored representative values');
  const lateExport = await exportYaml('authoring-after-preview.yaml');
  check(lateExport.config.epochs === 12 && lateExport.config.data_path === exported.config.data_path, 'Export remains a live draft snapshot after preview, preserving dataset and browser download location');
  await access(exported.path); await access(lateExport.path);
  record.authoringDownloadEvidence = [beforeResetDownload, afterResetDownload, exported, lateExport]
    .map(({ filename, size, sha256, config }) => ({ filename, size, sha256, config }));
  record.authoringPlanEvidence = { initialRows: first.rows, finalRows: final.rows, finalApprovedManifest: approved, noSubmission: true, invalidRangeBlocked: true, malformedPresetBlocked: true, forbiddenPresetFields: ['import_modules'] };
  await noSubmit('Authoring-only parity case never requests submission or allocates an execution');
}
