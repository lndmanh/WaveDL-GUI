import { openPlanDisclosure, datasetSelectedExpression, modelChosenExpression, planReadinessExpression, CONTROL_VALUE_SOURCE } from './browser_actions.mjs';
// Real UI-only authoring slice. No Vue/private transport state or API mutations.
import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export async function authoringParity(driver) {
  const { cli, dom, snapshot, button, fill, actions, controlExpression, registry,
    root, downloads, check, record, interpreter, python, command, repo } = driver;
  const inventory = JSON.parse(await readFile(join(repo, 'src/wavedl_daemon/web/shared/training-options.json'), 'utf8'));
  const defaults = Object.fromEntries(inventory.map((option) => [option.name, option.default]));
  const values = async (labels) => {
    const observed = [];
    for (const name of labels) {
      await actions.showTrainingField(name);
      const value = await dom(`JSON.stringify((() => {
        const label=Array.from(document.querySelectorAll('section[aria-labelledby="project-title"] label')).find(e=>e.getClientRects().length&&e.textContent.trim()===${JSON.stringify(name)});
        const control=label ? document.getElementById(label.htmlFor) : null;
        return control ? ${CONTROL_VALUE_SOURCE}(control) : null;
      })())`);
      assert(value !== null, `Visible field label is required: ${name}`);
      observed.push(value);
    }
    return observed;
  };
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
    const selector = await actions.configMenuItem('Download YAML');
    assert(selector, 'YAML download control missing');
    const path = join(downloads, filename);
    await cli('download', selector, path);
    const output = await command(python, ['-c', 'import json,sys,yaml; from pathlib import Path; print(json.dumps(yaml.safe_load(Path(sys.argv[1]).read_text())))', path]);
    const bytes = await readFile(path);
    return { path, config: JSON.parse(output), filename, size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') };
  };

  // Move between builder blocks and back using the existing genuine selections.
  const selections = `${datasetSelectedExpression('samples.npz')} && ${modelChosenExpression('cnn')}`;
  await actions.showBlock('dataset');
  await cli('wait', '--fn', `Array.from(document.querySelectorAll('[data-testid=selected-dataset]')).some(e=>e.getClientRects().length&&e.textContent.trim()==='samples.npz')`);
  await actions.showBlock('model');
  await cli('wait', '--fn', `${modelChosenExpression('cnn')} && Array.from(document.querySelectorAll('[data-testid=model-card][data-model-entry=cnn]')).some(e=>e.getClientRects().length)`);
  await actions.showBlock('training');
  await actions.showBlock('model');
  record.guidedSelectionsPreserved = await dom(`JSON.stringify(${selections})`);
  check(record.guidedSelectionsPreserved, 'Builder block navigation preserved genuine daemon dataset and catalogue model');

  await actions.button('Settings', false, { locator: '[data-testid="nav-settings"]' });
  await cli('wait', '--text', 'Browser preferences, not daemon administration.');
  // The full guidance sits behind the section's info control; open it as a user would.
  const downloadsInfo = 'xpath=//section[@aria-labelledby="downloads-heading"]//button[@aria-label="Downloads"]';
  await actions.button('Downloads', false, { locator: downloadsInfo });
  await cli('wait', '--fn', `Array.from(document.querySelectorAll('[data-slot="popover-content"]')).some(e => e.getClientRects().length && e.textContent.includes('Your browser chooses where'))`);
  record.downloadSettingsGuidance = await dom(`JSON.stringify([document.querySelector('#downloads-heading')?.closest('section')?.innerText, ...Array.from(document.querySelectorAll('[data-slot="popover-content"]')).filter(e => e.getClientRects().length).map(e => e.innerText)].join('\\n'))`);
  await actions.button('Downloads', false, { locator: downloadsInfo });
  check(record.downloadSettingsGuidance.includes('Your browser chooses where'), 'Settings honestly exposes browser-owned download guidance, not an invented workstation folder preference');
  await expand('Training and optional W&B defaults');
  await fill('Epochs', '19', { scope: '//*[@role="dialog"]' });
  await button('Save training defaults');
  await cli('wait', '--text', 'Defaults saved for new drafts on this daemon.');
  await button('Close overlay');
  await actions.openProject('continue');
  check((await values(['Epochs']))[0] === '10000', 'Saved new-run preference did not mutate the existing project draft');

  const authored = { epochs: 11, patience: 4, batch_size: 8, lr: 0.003,
    seed: 37, workers: 0, precision: 'no', weight_decay: 0.002 };
  const author = async () => {
    for (const [label, value] of [['Epochs', authored.epochs], ['Early stopping patience', authored.patience],
      ['Batch size', authored.batch_size], ['Learning rate', authored.lr], ['Random seed', authored.seed]]) await fill(label, String(value));
    await expand('Optimizer tuning');
    await fill('Weight decay', String(authored.weight_decay));
    await expand('Data loading and speed');
    await fill('Data loader workers', '0');
    await select('Mixed precision', 'no');
  };
  await author();
  const labels = ['Epochs', 'Early stopping patience', 'Batch size', 'Learning rate', 'Random seed', 'Data loader workers', 'Mixed precision', 'Weight decay', 'Python interpreter'];
  const beforeReset = await values(labels);
  const beforeResetDownload = await exportYaml('authoring-before-reset.yaml');
  await button('Reset training defaults');
  await button('Keep draft');
  check(JSON.stringify(await values(labels)) === JSON.stringify(beforeReset), 'Cancelling reset preserved all representative authored values and interpreter');
  await button('Reset training defaults');
  await button('Confirm reset');
  const resetValues = await values(['Epochs', 'Batch size', 'Python interpreter']);
  check(Number(resetValues[0]) === defaults.epochs && Number(resetValues[1]) === defaults.batch_size && resetValues[2] === interpreter, 'Confirmed project reset restored bundled defaults and preserved execution interpreter');
  check(await dom(`JSON.stringify(${selections})`), 'Confirmed reset preserved the selected dataset filename, its daemon root path and catalogue model');
  record.resetContract = { restoredBundledDefaults: true, savedNewRunEpochs: 19, restoredEpochs: Number(resetValues[0]), interpreterPreserved: true };
  const afterResetDownload = await exportYaml('authoring-after-reset.yaml');
  check(afterResetDownload.config.data_path === beforeResetDownload.config.data_path && afterResetDownload.config.model === beforeResetDownload.config.model && afterResetDownload.config.epochs === defaults.epochs, 'Actual reset exports preserve dataset/model and restore bundled defaults in the unchanged browser download directory');
  await access(beforeResetDownload.path); await access(afterResetDownload.path);
  await actions.button('Settings', false, { locator: '[data-testid="nav-settings"]' });
  await expand('Training and optional W&B defaults');
  check(await dom(`JSON.stringify((() => { const label = Array.from(document.querySelectorAll('[role="dialog"] label')).find(e => e.getClientRects().length && e.textContent.trim() === 'Epochs'); return label ? document.getElementById(label.htmlFor)?.value : null; })())`) === '19', 'Project reset preserved separately saved browser new-run preference');
  await button('Close overlay');
  await actions.openProject('continue');
  await author();

  const exported = await exportYaml('authoring-before-plan.yaml');
  check(Object.keys(exported.config).sort().join('|') === inventory.map((option) => option.name).sort().join('|'), 'Real downloaded YAML includes every training-schema inventory key');
  check(Object.entries(authored).every(([key, value]) => exported.config[key] === value), 'Real YAML bytes preserve eight representative UI-authored training values');
  check([' ', "'", '$', ';'].every((character) => exported.config.data_path.includes(character)), 'Actual selected daemon dataset path exercises spaces, quote and shell metacharacters');
  check(!['runtime', 'environment', 'token', 'access_token', 'output_dir'].some((key) => key in exported.config), 'YAML contains no runtime credentials/environment or allocated daemon output directory');
  await actions.copyStandaloneCommand();
  const text = await actions.copiedCommand();
  check(text.includes('wavedl.launcher'), 'Copied standalone command was handed to the browser clipboard');
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
  const environmentDownload = await exportYaml('authoring-environment.yaml');
  const environmentBytes = await readFile(environmentDownload.path, 'utf8');
  check(!environmentBytes.includes('browser-secret-probe') && !('environment' in environmentDownload.config),
    'YAML export omits visible runtime environment values and secrets');
  await actions.copyStandaloneCommand();
  await cli('wait', '--text', 'Explicit environment values are not exported');
  const environmentRefusal = await dom(`JSON.stringify(Array.from(document.querySelectorAll('[role="status"]')).some(e => e.getClientRects().length&&e.textContent.includes('Explicit environment values are not exported'))) `);
  check(environmentRefusal, 'Standalone command visibly refuses explicit runtime environment values');
  await expand('Explicit runtime environment');
  await button('Remove EXPORT_PROBE');

  // A multi-node topology is not exportable without rendezvous configuration;
  // prove the browser surfaces the refusal and restore the draft afterwards.
  await fill('Machines', '2');
  await actions.copyStandaloneCommand();
  await cli('wait', '--text', 'Multi-node standalone commands require explicit rendezvous');
  const topologyRefusal = await dom(`JSON.stringify(Array.from(document.querySelectorAll('[role="status"]')).some(e => e.getClientRects().length&&e.textContent.includes('Multi-node standalone commands require explicit rendezvous'))) `);
  check(topologyRefusal, 'Standalone command visibly refuses unsupported multi-node topology');
  await fill('Machines', '1');
  record.authoringExports = { allTrainingKeys: Object.keys(exported.config).sort(), inventoryCount: inventory.length, authoredValues: authored, yamlConfig: exported.config, parsedCommandArgv: argv, browserDownloadPath: downloads, partialFieldAuthoring: true,
    exportSafety: { environmentDownload: { filename: environmentDownload.filename, size: environmentDownload.size, sha256: environmentDownload.sha256, config: environmentDownload.config }, environmentOmitted: true, environmentCommandRefused: environmentRefusal, topologyCommandRefused: topologyRefusal } };

  // Config import. An unreadable file is refused without touching the draft.
  const malformedConfig = join(downloads, 'malformed-config.json');
  await writeFile(malformedConfig, '{"epochs":', { flag: 'wx', mode: 0o600 });
  await snapshot();
  await cli('upload', '#training-config-import', malformedConfig);
  await cli('wait', '--text', 'Couldn\u2019t import malformed-config.json');
  check(JSON.stringify(await values(labels)) === JSON.stringify(beforeReset), 'Unreadable config upload is refused without changing representative draft values');
  check(await dom(`JSON.stringify(document.querySelector('#training-config-import')?.value === '')`), 'Refused config upload clears the native file input');
  // A config naming executable registration modules is refused for those fields:
  // the safe values apply, the modules are named as not imported, nothing is
  // planned, and Undo restores the exact prior draft.
  const authorityConfig = join(downloads, 'executable-authority-config.json');
  await writeFile(authorityConfig, JSON.stringify({ epochs: 100, import_modules: ['untrusted.custom_models'] }), { flag: 'wx', mode: 0o600 });
  await snapshot();
  await cli('upload', '#training-config-import', authorityConfig);
  await cli('wait', '--text', 'Imported executable-authority-config.json');
  await cli('wait', '--text', 'Not imported, because they choose the code or checkpoint the run uses');
  const imported = await values(['Epochs', 'Registration modules']);
  check(imported[0] === '100' && imported[1] === '', 'Imported config applies safe values and refuses registration modules');
  check((await registry(root)).plans === 0, 'Config import requests no daemon plan');
  await button('Undo');
  const undone = await values(labels);
  check(JSON.stringify(undone) === JSON.stringify(beforeReset), 'Undo restores the representative draft');
  check((await registry(root)).plans === 0, 'Reset, exports and config imports created no daemon plan');

  await actions.createPlan();
  await cli('wait', '--text', 'Persisted plan for approval');
  await openPlanDisclosure({ cli, dom });
  const first = await capturePlan();
  check(first.state.plans === 1, 'First explicit preview persists exactly one unsubmitted plan');
  await fill('Epochs', '12');
  check(await dom(`JSON.stringify(!document.querySelector('[aria-label="Approved normalized manifest"]')&&!Array.from(document.querySelectorAll('button')).some(e=>e.getClientRects().length&&!e.disabled&&e.textContent.trim()==='Approve and start this plan'))`), 'Editing a field revokes the old visible approval immediately');
  const unchanged = await capturePlan();
  check(JSON.stringify(first.rows) === JSON.stringify(unchanged.rows), 'Editing draft leaves original daemon plan bytes immutable');
  await fill('Batch size', '0');
  await actions.reviewPlan();
  await cli('wait', '--fn', `(() => { const state = ${planReadinessExpression()}; return state.createPlan?.disabled === true && state.items.some(item => item.label === 'Training' && !item.done && item.detail.includes('to fix')); })()`);
  check((await registry(root)).plans === 1, 'Invalid numeric range is blocked before a second API plan is created');
  await fill('Batch size', '8');
  await actions.createPlan();
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
  record.authoringPlanEvidence = { initialRows: first.rows, finalRows: final.rows, finalApprovedManifest: approved, noSubmission: true, invalidRangeBlocked: true, malformedPresetBlocked: true,
    forbiddenPresetFields: ['import_modules'] };
  await noSubmit('Authoring-only parity case never requests submission or allocates an execution');
}
