import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { browserPresetImport } from './browser_preset_import.mjs';

async function fixture(options = {}) {
  const downloads = await mkdtemp(join(tmpdir(), 'preset-gate-unit-'));
  let rows = [], message = '', approved = null;
  const fields = Object.fromEntries([
    ['epochs', '10000'], ['patience', '10000'], ['batch size', '16'], ['lr', '0.001'],
    ['seed', '42'], ['workers', '0'], ['precision', 'no'], ['weight decay', '0.0001'],
    ['Python interpreter', '/fixture/python'],
  ].map(([name, value]) => [name, { value, checked: null }]));
  const config = () => ({ epochs: Number(fields.epochs.value), patience: Number(fields.patience.value),
    batch_size: Number(fields['batch size'].value), lr: Number(fields.lr.value) });
  const registry = async () => ({ plans: rows.length, control: rows.map(([id]) => ({ plan_id: id, submission_requested: 0 })), executions: [] });
  const record = {}, uploads = [];
  return { downloads, record, uploads, cleanup: () => rm(downloads, { recursive: true }), driver: {
    downloads, record, python: 'fixture-python', root: '/fixture',
    check: (condition, description) => assert(condition, description), registry,
    command: async () => JSON.stringify(rows), snapshot: async () => 'Public snapshot',
    button: async (label) => {
      assert.equal(label, 'Preview persisted plan');
      approved = JSON.stringify({ resolved_config: config() });
      rows.push([`plan-${rows.length + 1}`, JSON.stringify(config()), approved]);
    },
    cli: async (action, selector, path) => {
      if (action === 'wait') return;
      assert.equal(action, 'upload');
      assert.equal(selector, '#training-preset-import');
      uploads.push(path);
      if (path.endsWith('-valid.json')) {
        const preset = JSON.parse(await readFile(path, 'utf8'));
        for (const [key, value] of Object.entries(preset)) fields[key === 'batch_size' ? 'batch size' : key].value = String(value);
        approved = null;
        message = 'Validated preset applied to the draft. Review it before planning.';
      } else {
        message = 'Invalid preset. Use a JSON object containing only typed training fields, without dataset, model, runtime or output paths.';
        if (options.draftDrift) fields.epochs.value = '99';
        if (options.approvalDrift) approved = null;
        if (options.planDrift) rows[0][1] = '{}';
      }
    },
    dom: async (script) => {
      if (script.includes('const labels')) return structuredClone({ fields, selection: ['Dataset: /fixture/samples.npz', 'Model: cnn'], controls: [] });
      if (script.includes('role="status"')) return message;
      if (script.includes('training-preset-import')) return true;
      if (script.includes('!!document.querySelector')) return !!approved;
      if (script.includes('Approved normalized manifest')) return approved;
      throw new Error(`Unexpected DOM expression: ${script}`);
    },
  } };
}

test('preset helper uploads three real refusal files and a valid retry, with immutable plan evidence', async () => {
  const item = await fixture();
  try {
    await browserPresetImport(item.driver);
    assert.equal(item.uploads.length, 4);
    assert.deepEqual(item.record.presetImportEvidence.refusals.map((row) => row.category), ['malformed', 'forbidden-fields', 'invalid-range']);
    assert.equal(item.record.presetImportEvidence.baseline.planRows.length, 1);
    assert.equal(item.record.presetImportEvidence.final.planRows.length, 2);
    assert.equal(item.record.presetImportEvidence.final.approvedManifest.resolved_config.epochs, 23);
    for (const row of item.record.presetImportEvidence.refusals) {
      assert.equal(row.sha256.length, 64);
      assert.equal(await readFile(row.filename, 'utf8'), row.content);
      assert.equal(row.size, Buffer.byteLength(row.content));
      assert.equal(row.sha256, createHash('sha256').update(row.content).digest('hex'));
      assert.deepEqual(row.after.draft, item.record.presetImportEvidence.baseline.draft);
      assert.deepEqual(row.after.registry, item.record.presetImportEvidence.baseline.registry);
      assert.deepEqual(row.after.planRows, item.record.presetImportEvidence.baseline.planRows);
      assert.equal(row.after.approvedManifestText, item.record.presetImportEvidence.baseline.approvedManifestText);
    }
    const valid = item.record.presetImportEvidence.validRetry;
    assert.equal(valid.content, await readFile(valid.filename, 'utf8'));
    assert.equal(valid.sha256, createHash('sha256').update(valid.content).digest('hex'));
    assert.equal(valid.after.draft.fields.epochs.value, '23');
    assert.equal(valid.after.approvedManifestText, null);
    assert.equal(valid.inputCleared, true);
  } finally { await item.cleanup(); }
});

for (const [key, expected] of [
  ['draftDrift', /preserves the rendered draft/],
  ['approvalDrift', /preserves the existing visible plan approval/],
  ['planDrift', /preserves the existing immutable SQL plan bytes/],
]) {
  test(`preset helper refuses a false pass when ${key} occurs`, async () => {
    const item = await fixture({ [key]: true });
    try { await assert.rejects(browserPresetImport(item.driver), expected); }
    finally { await item.cleanup(); }
  });
}
