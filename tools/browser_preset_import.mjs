import { openPlanDisclosure, normalizeTrainingFieldLabel } from './browser_actions.mjs';
// Real Chromium file-input coverage for the JSON training-preset authority gate.
// The caller supplies the same public-DOM driver used by browser_authoring_parity.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DRAFT_LABELS = [
  'epochs', 'patience', 'batch size', 'lr', 'seed', 'workers', 'precision',
  'weight decay', 'Python interpreter',
];

async function draftSnapshot(dom) {
  return dom(`JSON.stringify((() => {
    const form = Array.from(document.querySelectorAll('form')).find((node) =>
      Array.from(node.querySelectorAll('button')).some((button) => button.textContent.trim() === 'Preview persisted plan'));
    const labels = ${JSON.stringify(DRAFT_LABELS.map(name => [name, normalizeTrainingFieldLabel(name)]))};
    const fields = Object.fromEntries(labels.map(([name, text]) => {
      const label = Array.from(form?.querySelectorAll('label') ?? []).find((node) => node.textContent.trim() === text);
      const control = label ? document.getElementById(label.htmlFor) : null;
      return [name, control ? { value: control.getAttribute('data-value') ?? control.value, checked: control.checked ?? null } : null];
    }));
    const text = Array.from(document.querySelectorAll('[data-testid="selected-dataset"],[data-testid="selected-model"]')).map((node) => node.textContent.trim());
    const controls = Array.from(form?.querySelectorAll('input,select,textarea,[role="checkbox"],[role="combobox"]') ?? [])
      .map((node) => ({ id: node.id, name: node.getAttribute('name'), role: node.getAttribute('role'),
        value: node.getAttribute('data-value') ?? node.value ?? null, checked: node.checked ?? node.getAttribute('aria-checked') ?? null }));
    return { fields, selection: text, controls };
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
  const { cli, dom, snapshot, button, downloads, check, record } = driver;
  const importPath = join(downloads, 'preset-import');
  const capture = async () => ({ draft: await draftSnapshot(dom), ...(await registryAndRows(driver)) });
  const initial = await capture();
  check(initial.registry.plans === 0, 'Preset gate fixture begins without a persisted plan');

  // Establish an immutable, unsubmitted plan first. Every refusal below must
  // leave this exact SQL row and visible approval untouched.
  await button('Preview persisted plan');
  await cli('wait', '--text', 'Persisted plan for approval');
  await openPlanDisclosure({ cli, dom });
  const planned = await capture();
  check(planned.registry.plans === 1 && planned.registry.control.every((row) => row.submission_requested === 0),
    'Preset gate starts from one real unsubmitted persisted plan');
  await openPlanDisclosure({ cli, dom });
  const approved = await dom('JSON.stringify(document.querySelector(\'[aria-label="Approved normalized manifest"]\')?.textContent)');
  check(!!approved, 'Preset gate exposes an approved normalized manifest before import');
  const refusals = [];
  const refusalCases = [
    { id: 'malformed-json', category: 'malformed', bytes: '{"epochs":', contentType: 'text/plain' },
    { id: 'forbidden-authority-fields', category: 'forbidden-fields', value: {
      model: 'custom.untrusted', data_path: '/tmp/retarget.npz', runtime: { python: '/tmp/x' },
      output_dir: '/tmp/output', import_modules: ['untrusted.module'], epochs: 22,
    } },
    { id: 'invalid-range', category: 'invalid-range', value: { epochs: 0, batch_size: -1, patience: -1 } },
  ];
  for (const refusal of refusalCases) {
    const path = `${importPath}-${refusal.id}.json`;
    const content = refusal.bytes ?? JSON.stringify(refusal.value);
    await writeFile(path, content, { flag: 'wx', mode: 0o600 });
    const digest = await sha256(path);
    await snapshot();
    await cli('upload', '#training-preset-import', path);
    await cli('wait', '--text', 'Invalid preset.');
    const after = await capture();
    const message = await dom('JSON.stringify(Array.from(document.querySelectorAll(\'[role="status"]\')).find((node) => node.getClientRects().length)?.textContent ?? null)');
    const inputCleared = await dom('JSON.stringify(document.querySelector(\'#training-preset-import\')?.value === "")');
    const currentApproved = await dom('JSON.stringify(document.querySelector(\'[aria-label="Approved normalized manifest"]\')?.textContent)');
    check(message.includes('Invalid preset.'), `${refusal.id} exposes a truthful public invalid-preset refusal`);
    check(JSON.stringify(after.draft) === JSON.stringify(planned.draft), `${refusal.id} preserves the rendered draft and daemon selection`);
    check(JSON.stringify(after.rows) === JSON.stringify(planned.rows), `${refusal.id} preserves the existing immutable SQL plan bytes`);
    check(currentApproved === approved, `${refusal.id} preserves the existing visible plan approval`);
    check(after.registry.plans === 1 && after.registry.control.every((row) => row.submission_requested === 0) && after.registry.executions.length === 0,
      `${refusal.id} creates no plan, submission intent or execution`);
    check(JSON.stringify(after.registry) === JSON.stringify(planned.registry), `${refusal.id} preserves the complete durable registry observation`);
    check(inputCleared, `${refusal.id} clears the native file input after refusal`);
    refusals.push({ id: refusal.id, filename: path, content, ...digest, category: refusal.category,
      publicMessage: message, draftPreserved: true, approvalPreserved: true,
      planRowsPreserved: true, registryPreserved: true, inputCleared: true,
      after: { draft: after.draft, registry: after.registry, planRows: after.rows,
        approvedManifestText: currentApproved } });
  }

  const validPreset = { epochs: 23, lr: 0.002, batch_size: 24, patience: 7 };
  const validPath = `${importPath}-valid.json`;
  const validContent = JSON.stringify(validPreset);
  await writeFile(validPath, validContent, { flag: 'wx', mode: 0o600 });
  const validDigest = await sha256(validPath);
  await snapshot();
  await cli('upload', '#training-preset-import', validPath);
  await cli('wait', '--text', 'Validated preset applied to the draft.');
  const afterValid = await capture();
  const validMessage = await dom('JSON.stringify(Array.from(document.querySelectorAll(\'[role="status"]\')).find((node) => node.getClientRects().length)?.textContent ?? null)');
  const validInputCleared = await dom('JSON.stringify(document.querySelector(\'#training-preset-import\')?.value === "")');
  const validApprovedText = await dom('JSON.stringify(document.querySelector(\'[aria-label="Approved normalized manifest"]\')?.textContent ?? null)');
  check(validInputCleared, 'Valid native file retry clears the native file input');
  check(validMessage.includes('Validated preset applied'), 'Valid native file retry reports validated preset application');
  check(afterValid.registry.plans === 1 && afterValid.registry.control.every((row) => row.submission_requested === 0) && afterValid.registry.executions.length === 0,
    'Valid import does not auto-submit or allocate a second plan');
  check(afterValid.rows.length === planned.rows.length && JSON.stringify(afterValid.rows) === JSON.stringify(planned.rows),
    'Valid import leaves the existing persisted plan immutable until explicit re-preview');
  check(!await dom('JSON.stringify(!!document.querySelector(\'[aria-label="Approved normalized manifest"]\'))'),
    'Valid import revokes the stale visible approval for the changed draft');
  check(afterValid.draft.fields.epochs.value === String(validPreset.epochs) && afterValid.draft.fields.lr.value === String(validPreset.lr)
    && afterValid.draft.fields['batch size'].value === String(validPreset.batch_size),
  'Valid import applies typed preset values to the rendered draft');
  check(JSON.stringify(afterValid.draft.selection) === JSON.stringify(planned.draft.selection)
    && Object.entries(planned.draft.fields).filter(([key]) => !['epochs', 'patience', 'batch size', 'lr'].includes(key))
      .every(([key, value]) => JSON.stringify(value) === JSON.stringify(afterValid.draft.fields[key])),
  'Valid import preserves selected daemon dataset, model, interpreter and unrelated training values');
  await button('Preview persisted plan');
  await cli('wait', '--text', 'Persisted plan for approval');
  await openPlanDisclosure({ cli, dom });
  const final = await capture();
  await openPlanDisclosure({ cli, dom });
  const finalApproved = await dom('JSON.stringify(document.querySelector(\'[aria-label="Approved normalized manifest"]\')?.textContent)');
  const manifest = JSON.parse(finalApproved);
  check(final.registry.plans === 2 && final.registry.control.every((row) => row.submission_requested === 0) && final.registry.executions.length === 0
    && final.rows.some((row) => JSON.stringify(row) === JSON.stringify(planned.rows[0])),
  'Valid retry persists a new unsubmitted plan while retaining the original immutable row');
  check(Object.entries(validPreset).every(([key, value]) => manifest.resolved_config[key] === value),
    'Explicit valid retry preview manifest exactly matches the imported typed values');
  record.presetImportEvidence = {
    baseline: { registry: planned.registry, planRows: planned.rows, draft: planned.draft,
      approvedManifest: JSON.parse(approved), approvedManifestText: approved }, refusals,
    validRetry: { filename: validPath, content: validContent, ...validDigest, preset: validPreset,
      publicMessage: validMessage, approvalRevoked: true,
      selectionAndRuntimePreserved: true, noAutomaticPlan: true, inputCleared: validInputCleared,
      after: { draft: afterValid.draft, registry: afterValid.registry, planRows: afterValid.rows,
        approvedManifestText: validApprovedText } },
    final: { registry: final.registry, planRows: final.rows, approvedManifest: manifest }, noSubmission: true,
  };
}
