#!/usr/bin/env node
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { lstat, open, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** Never serialize error messages: command failures can include bootstrap URLs. */
export function keyboardFailureCategory(error) {
  if (error?.code === 'ERR_ASSERTION') return 'assertion';
  if (error?.code === 'ENOENT') return 'missing-resource';
  return 'operation-failed';
}

export function verifyKeyboardRecord(r) {
  assert.equal(r.name, 'keyboard-browser');
  assert.equal(r.status, 'passed');
  assert.equal(r.browser, 'agent-browser 0.26.0');
  assert.equal(r.scope, 'Native keyboard-only local form and inline reset confirmation; no modal exists in these active surfaces; not blanket accessibility or remote certification');
  for (const key of ['error', 'skipped', 'skip', 'failureFocus', 'failureCategory']) {
    assert(!Object.hasOwn(r, key));
  }
  assert(/^[a-f0-9]{64}$/.test(r.assetManifestSha256));
  assert(Number.isFinite(Date.parse(r.started)) && Date.parse(r.finished) >= Date.parse(r.started));
  assert.deepEqual(r.freshStorage, { local: [], session: [], cookies: '' });
  assert(Array.isArray(r.actions) && r.actions.length > 15 && r.actions.length < 1000);
  assert(r.actions.every(a => a.command === 'press' && ['Tab', 'Shift+Tab', 'Enter', 'Escape', 'ControlOrMeta+a', '0', '1', '7', 'd'].includes(a.key)), 'Only native keyboard actions are allowed');
  for (const key of ['Tab', 'Shift+Tab', 'Enter', 'Escape', '0', '1', '7']) {
    assert(r.actions.some(a => a.key === key));
  }
  assert.deepEqual(r.checkpoints.map(c => c.stage), ['connected', 'invalid-guided-next', 'dataset-model-selected', 'invalid-field-corrected', 'keep-draft']);
  for (const checkpoint of r.checkpoints) {
    assert.deepEqual(checkpoint.registry, {
      plans: 0,
      runs: 0,
      plan_control: 0,
      execution_control: 0,
      submission_control: 0,
    });
  }
  for (const name of ['New training run', 'Next step', 'Configured root', 'Select file samples.npz', 'Choose CNN', 'Show full editor', 'epochs', 'Reset training defaults', 'Confirm reset']) {
    const visit = r.visits.find(v => v.target === name);
    assert(visit && visit.name === name && visit.visible && visit.focusVisible, `Visible keyboard focus required for ${name}`);
  }
  assert.equal(r.missingDataset.alert, true);
  assert(r.missingDataset.step.startsWith('1.'));
  assert.equal(r.rootPopupOpen.listboxes, 1);
  assert.equal(r.rootPopupOpen.expanded, 'true');
  assert(typeof r.rootTrigger.id === 'string' && r.rootTrigger.id.length > 0);
  assert.equal(r.rootPopupClosed, true);
  assert.equal(r.rootPopupReturn.id, r.rootTrigger.id);
  assert(r.rootPopupReturn.focusVisible && r.rootPopupReturn.visible);
  assert(r.selectedDataset.includes('/samples.npz'));
  assert(r.selectedModel.includes('Model: cnn'));
  assert.equal(r.invalidField.value, '0');
  assert.equal(r.invalidField.invalid, 'true');
  assert(r.invalidField.visible && typeof r.invalidField.description === 'string' && r.invalidField.description.trim());
  assert.equal(r.invalidField.errorVisible, true);
  assert.equal(r.invalidField.errorRole, 'alert');
  assert.equal(r.invalidField.label, 'epochs');
  assert.equal(r.reverseTraversal.returned.name, 'epochs');
  assert.notEqual(r.reverseTraversal.afterTab.id, r.reverseTraversal.returned.id);
  assert.equal(r.correctedField.value, '17');
  assert.notEqual(r.correctedField.invalid, 'true');
  assert.deepEqual(r.confirmationOpened, { present: true, modals: 0, epochs: '17' });
  assert.deepEqual(r.afterEscape, r.confirmationOpened, 'Escape does not invent modal dismissal');
  assert.deepEqual(r.confirmationDismissed, { present: false, modals: 0, epochs: '17' });
  for (const [field, name] of [['confirmFocus', 'Confirm reset'], ['keepDraftFocus', 'Keep draft'], ['reverseConfirmationFocus', 'Confirm reset']]) {
    assert.equal(r[field].name, name);
    assert(r[field].withinConfirmation && r[field].visible && r[field].focusVisible);
  }
  assert.equal(r.returnedToReset.name, 'Reset training defaults');
  assert(r.returnedToReset.visible && r.returnedToReset.focusVisible);
  assert.equal(r.limitations.modalDialogsExercised, false);
  assert.equal(r.limitations.noPlanApprovalOrTraining, true);
  assert(r.limitations.confirmationKind.includes('no focus trap'));
  assert(r.invalidField.describedBy === null || typeof r.invalidField.describedBy === 'string');
  if (r.invalidField.describedBy === null) {
    assert(r.limitations.fieldErrorAssociation.includes('no aria-describedby'));
  } else {
    assert(r.limitations.fieldErrorAssociation.includes('Recorded actual aria-describedby'));
  }
  assert.equal(r.fixtureDiagnostic.spawnFailed, false);
  assert.equal(r.fixtureDiagnostic.reaped, true);
  assert.deepEqual(r.cleanup, { errors: [], browserSessionAbsent: true, servicesClosed: true, fixtureReaped: true, listenerClosed: true, ownedRootsRemoved: true });
  return r;
}

export async function verifyKeyboardFile(path) {
  const before = await lstat(path);
  assert(before.isFile() && !before.isSymbolicLink() && before.size > 0 && before.size <= 256 * 1024);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes;
  try {
    const stat = await handle.stat();
    assert(stat.isFile() && stat.dev === before.dev && stat.ino === before.ino && stat.size === before.size);
    const buffer = Buffer.alloc(256 * 1024 + 1);
    let size = 0;
    while (size < buffer.length) {
      const read = await handle.read(buffer, size, buffer.length - size, null);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    const after = await handle.stat();
    assert(size === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs);
    bytes = buffer.subarray(0, size);
  } finally {
    await handle.close();
  }
  const r = verifyKeyboardRecord(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  const assets = await readFile(new URL('../src/wavedl_daemon/web_assets/.wavedl-assets.json', import.meta.url));
  assert.equal(r.assetManifestSha256, createHash('sha256').update(assets).digest('hex'), 'Report must match current vendored assets');
  return r;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert(process.argv.length === 3);
    await verifyKeyboardFile(process.argv[2]);
    console.log('Keyboard browser report verified');
  } catch {
    console.error('Keyboard browser evidence rejected');
    process.exitCode = 1;
  }
}
