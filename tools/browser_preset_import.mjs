import { openPlanDisclosure, normalizeTrainingFieldLabel, CONTROL_VALUE_SOURCE } from './browser_actions.mjs';
// Real Chromium file-input coverage for the training-config import gate. The
// JSON preset importer was replaced by config import (YAML or JSON, same path).
// The caller supplies the same public-DOM driver used by browser_authoring_parity.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DRAFT_LABELS = [
  'epochs', 'patience', 'batch size', 'lr', 'seed', 'workers', 'precision',
  'weight decay', 'Python interpreter',
];
const IMPORT_INPUT = '#training-config-import';
const NOTICE = '[role="status"][data-tone]';

async function draftSnapshot(dom) {
  return dom(`JSON.stringify((() => {
    const valueOf = ${CONTROL_VALUE_SOURCE};
    const form = document.querySelector('section[aria-labelledby="project-title"] form[role="tabpanel"]');
    const labels = ${JSON.stringify(DRAFT_LABELS.map(name => [name, normalizeTrainingFieldLabel(name)]))};
    const fields = Object.fromEntries(labels.map(([name, text]) => {
      const label = Array.from(form?.querySelectorAll('label') ?? []).find((node) => node.textContent.trim() === text);
      const control = label ? document.getElementById(label.htmlFor) : null;
      return [name, control ? { value: valueOf(control), checked: control.checked ?? null } : null];
    }));
    const dataset = Array.from(document.querySelectorAll('[data-testid="selected-dataset"]')).map((node) => node.textContent.trim());
    const models = Array.from(document.querySelectorAll('[data-testid="model-card"]'))
      .filter((node) => Array.from(node.querySelectorAll('[aria-label]')).some((mark) => mark.getAttribute('aria-label') === 'In use'))
      .map((node) => node.getAttribute('data-model-entry'));
    const custom = Array.from(document.querySelectorAll('[data-testid="selected-model"]')).map((node) => node.textContent.trim());
    const controls = Array.from(form?.querySelectorAll('input,select,textarea,[role="checkbox"],[role="switch"],[role="radio"],[role="combobox"]') ?? [])
      .filter((node) => node.type !== 'file' && node.type !== 'search')
      .map((node) => ({ id: node.id, name: node.getAttribute('name'), role: node.getAttribute('role'),
        value: node.getAttribute('data-value') ?? node.value ?? null, checked: node.checked ?? node.getAttribute('aria-checked') ?? null }));
    return { fields, selection: { dataset, models, custom }, controls };
  })())`);
}
async function planRows({ command, python, root }) {
  const script = 'import json,sqlite3,sys; from pathlib import Path; c=sqlite3.connect((Path(sys.argv[1]) / "state" / "registry.db").resolve().as_uri()+"?mode=ro",uri=True); print(json.dumps(list(c.execute("SELECT plan_id,request_payload_json,plan_json FROM plans ORDER BY plan_id"))))';
  return JSON.parse(await command(python, ['-c', script, root]));
}

async function registryAndRows(driver) {
  return { registry: await driver.registry(driver.root), rows: await planRows(driver) };
}

async function sha256(path) {
  const bytes = await readFile(path);
  return { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export async function browserPresetImport(driver) {
  const { cli, dom, snapshot, button, actions, downloads, check, record } = driver;
  const importPath = join(downloads, 'preset-import');
  const capture = async () => ({ draft: await draftSnapshot(dom), ...(await registryAndRows(driver)) });
  const notice = () => dom(`JSON.stringify(Array.from(document.querySelectorAll(${JSON.stringify(NOTICE)})).find((node) => node.getClientRects().length)?.textContent.replace(/\\s+/g, ' ').trim() ?? null)`);
  const approvedText = () => dom('JSON.stringify(document.querySelector(\'[aria-label="Approved normalized manifest"]\')?.textContent ?? null)');
  const inputCleared = () => dom(`JSON.stringify(document.querySelector(${JSON.stringify(IMPORT_INPUT)})?.value === "")`);
  const upload = async (id, content) => {
    const path = `${importPath}-${id}.json`;
    await writeFile(path, content, { flag: 'wx', mode: 0o600 });
    const digest = await sha256(path);
    await snapshot();
    await cli('upload', IMPORT_INPUT, path);
    return { filename: path, name: path.split('/').at(-1), content, ...digest };
  };
  const initial = await capture();
  check(initial.registry.plans === 0, 'Config import fixture begins without a persisted plan');

  // Establish an immutable, unsubmitted plan first. Every refusal below must
  // leave this exact SQL row and visible approval untouched.
  await actions.createPlan();
  await cli('wait', '--text', 'Persisted plan for approval');
  await openPlanDisclosure({ cli, dom });
  const planned = await capture();
  check(planned.registry.plans === 1 && planned.registry.control.every((row) => row.submission_requested === 0),
    'Config import gate starts from one real unsubmitted persisted plan');
  await openPlanDisclosure({ cli, dom });
  const approved = await approvedText();
  check(!!approved, 'Config import gate exposes an approved normalized manifest before import');

  // Files that are not a WaveDL training configuration are refused whole.
  const refusals = [];
  const refusalCases = [
    { id: 'malformed-json', category: 'malformed', content: '{"epochs":', message: 'This file is not a WaveDL training configuration.' },
    { id: 'non-mapping', category: 'malformed', content: JSON.stringify(['epochs', 22]), message: 'This file is not a WaveDL training configuration.' },
    { id: 'oversized', category: 'oversized', content: JSON.stringify({ epochs: 22, run_name: 'x'.repeat(70 * 1024) }), message: 'Configuration files are limited to 64 KiB.' },
  ];
  for (const refusal of refusalCases) {
    const file = await upload(refusal.id, refusal.content);
    await cli('wait', '--text', refusal.message);
    const after = await capture();
    const message = await notice();
    const currentApproved = await approvedText();
    const cleared = await inputCleared();
    check(message.includes(refusal.message), `${refusal.id} exposes a truthful public import refusal`);
    check(JSON.stringify(after.draft) === JSON.stringify(planned.draft), `${refusal.id} preserves the rendered draft and daemon selection`);
    check(JSON.stringify(after.rows) === JSON.stringify(planned.rows), `${refusal.id} preserves the existing immutable SQL plan bytes`);
    check(currentApproved === approved, `${refusal.id} preserves the existing visible plan approval`);
    check(after.registry.plans === 1 && after.registry.control.every((row) => row.submission_requested === 0) && after.registry.executions.length === 0,
      `${refusal.id} creates no plan, submission intent or execution`);
    check(JSON.stringify(after.registry) === JSON.stringify(planned.registry), `${refusal.id} preserves the complete durable registry observation`);
    check(cleared, `${refusal.id} clears the native file input after refusal`);
    refusals.push({ id: refusal.id, filename: file.filename, content: refusal.content.length > 4096 ? `${refusal.content.slice(0, 64)}…` : refusal.content,
      size: file.size, sha256: file.sha256, category: refusal.category,
      publicMessage: message, draftPreserved: true, approvalPreserved: true,
      planRowsPreserved: true, registryPreserved: true, inputCleared: true,
      after: { draft: after.draft, registry: after.registry, planRows: after.rows,
        approvedManifestText: currentApproved } });
  }

  const validPreset = { epochs: 23, lr: 0.002, batch_size: 24, patience: 7 };
  const valid = await upload('valid', JSON.stringify(validPreset));
  await cli('wait', '--text', `Imported ${valid.name} · 4 training values`);
  const afterValid = await capture();
  const validMessage = await notice();
  const validInputCleared = await inputCleared();
  const validApprovedText = await approvedText();
  check(validInputCleared, 'Valid native file import clears the native file input');
  check(validMessage.includes(`Imported ${valid.name}`), 'Valid native file import reports the applied training values');
  check(afterValid.registry.plans === 1 && afterValid.registry.control.every((row) => row.submission_requested === 0) && afterValid.registry.executions.length === 0,
    'Valid import does not auto-submit or allocate a second plan');
  check(afterValid.rows.length === planned.rows.length && JSON.stringify(afterValid.rows) === JSON.stringify(planned.rows),
    'Valid import leaves the existing persisted plan immutable until explicit re-preview');
  check(validApprovedText === null, 'Valid import revokes the stale visible approval for the changed draft');
  check(Number(afterValid.draft.fields.epochs.value) === validPreset.epochs && Number(afterValid.draft.fields.lr.value) === validPreset.lr
    && Number(afterValid.draft.fields['batch size'].value) === validPreset.batch_size && Number(afterValid.draft.fields.patience.value) === validPreset.patience,
  'Valid import applies typed config values to the rendered draft');
  check(JSON.stringify(afterValid.draft.selection) === JSON.stringify(planned.draft.selection)
    && Object.entries(planned.draft.fields).filter(([key]) => !['epochs', 'patience', 'batch size', 'lr'].includes(key))
      .every(([key, value]) => JSON.stringify(value) === JSON.stringify(afterValid.draft.fields[key])),
  'Valid import preserves selected daemon dataset, model, interpreter and unrelated training values');

  // Configs carrying daemon-owned, executable or invalid keys are applied in
  // part: what cannot apply is named, executable fields are refused, a dataset outside the daemon's roots is never
  // selected, nothing is planned, and Undo restores the prior draft exactly.
  const partial = [];
  const partialCases = [
    { id: 'forbidden-authority-fields', category: 'forbidden-fields', value: {
      model: 'custom.untrusted', data_path: '/tmp/retarget.npz', runtime: { python: '/tmp/x' },
      output_dir: '/tmp/output', import_modules: ['untrusted.module'], epochs: 22,
    }, applied: 1, skipped: ['runtime', 'output_dir'], missing: ['/tmp/retarget.npz'], withheld: 'Registration modules' },
    { id: 'invalid-range', category: 'invalid-range', value: { epochs: 0, batch_size: -1, patience: -1 },
      applied: 0, skipped: ['epochs', 'batch_size', 'patience'], missing: [] },
  ];
  for (const item of partialCases) {
    const before = await capture();
    const file = await upload(item.id, JSON.stringify(item.value));
    await cli('wait', '--text', `Imported ${file.name} · ${item.applied} training values`);
    const after = await capture();
    const message = await notice();
    check(item.skipped.every((key) => message.includes(key)) && message.includes(`Not applied: ${item.skipped.join(', ')}.`),
      `${item.id} names every key it did not apply`);
    check(item.missing.every((path) => message.includes(`Not found on this daemon: ${path}`)), `${item.id} names data the daemon does not serve`);
    check(!item.withheld || message.includes(`the run uses: ${item.withheld}.`), `${item.id} refuses executable registration modules by name`);
    check(JSON.stringify(after.draft.selection.dataset) === JSON.stringify(before.draft.selection.dataset)
      && after.draft.fields['Python interpreter'].value === before.draft.fields['Python interpreter'].value,
    `${item.id} keeps the daemon dataset selection and interpreter`);
    if (item.applied === 0) {
      check(JSON.stringify(after.draft.fields) === JSON.stringify(before.draft.fields), `${item.id} applies no invalid value`);
    }
    check(JSON.stringify(after.rows) === JSON.stringify(before.rows) && after.registry.plans === before.registry.plans
      && after.registry.executions.length === 0 && after.registry.control.every((row) => row.submission_requested === 0),
    `${item.id} creates no plan, submission intent or execution`);
    check(await inputCleared(), `${item.id} clears the native file input`);
    await button('Undo');
    await cli('wait', '--fn', `!Array.from(document.querySelectorAll(${JSON.stringify(NOTICE)})).some((node) => node.getClientRects().length)`);
    const undone = await capture();
    check(JSON.stringify(undone.draft) === JSON.stringify(before.draft), `${item.id} Undo restores the exact prior draft and selection`);
    partial.push({ id: item.id, filename: file.filename, content: file.content, size: file.size, sha256: file.sha256,
      category: item.category, refused: false, publicMessage: message,
      selectedModelsAfterImport: after.draft.selection, skipped: item.skipped, missing: item.missing,
      noPlan: true, undoRestored: true,
      after: { draft: after.draft, registry: after.registry, planRows: after.rows } });
  }

  await actions.createPlan();
  await cli('wait', '--text', 'Persisted plan for approval');
  await openPlanDisclosure({ cli, dom });
  const final = await capture();
  await openPlanDisclosure({ cli, dom });
  const finalApproved = await approvedText();
  const manifest = JSON.parse(finalApproved);
  check(final.registry.plans === 2 && final.registry.control.every((row) => row.submission_requested === 0) && final.registry.executions.length === 0
    && final.rows.some((row) => JSON.stringify(row) === JSON.stringify(planned.rows[0])),
  'Valid retry persists a new unsubmitted plan while retaining the original immutable row');
  check(Object.entries(validPreset).every(([key, value]) => manifest.resolved_config[key] === value),
    'Explicit re-preview manifest exactly matches the imported typed values');
  record.presetImportEvidence = {
    importer: 'training-config', baseline: { registry: planned.registry, planRows: planned.rows, draft: planned.draft,
      approvedManifest: JSON.parse(approved), approvedManifestText: approved }, refusals, partialImports: partial,
    validRetry: { filename: valid.filename, content: valid.content, size: valid.size, sha256: valid.sha256, preset: validPreset,
      publicMessage: validMessage, approvalRevoked: true,
      selectionAndRuntimePreserved: true, noAutomaticPlan: true, inputCleared: validInputCleared,
      after: { draft: afterValid.draft, registry: afterValid.registry, planRows: afterValid.rows,
        approvedManifestText: validApprovedText } },
    final: { registry: final.registry, planRows: final.rows, approvedManifest: manifest }, noSubmission: true,
  };
}
