import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { EDITOR_OBSERVATION_TIMEOUT_MS, MAX_EDITOR_OBSERVATIONS, editorFieldObservationExpression, editorFieldReadyExpression, openTrainingEditor } from './browser_training_editor.mjs';

function fixture(overrides = {}) {
  const label = { textContent: 'Python interpreter', htmlFor: 'runtime-id', isConnected: true, getClientRects: () => [{}] };
  const field = { id: 'runtime-id', tagName: 'INPUT', name: 'runtime.python', isConnected: true, disabled: false,
    getClientRects: () => [{}], matches: () => false, getAttribute: () => null, labels: [label] };
  const region = { isConnected: true, contains: node => node === field,
    querySelector: () => ({ textContent: 'Build a training run' }), querySelectorAll: () => [label] };
  Object.assign(label, overrides.label);
  Object.assign(field, overrides.field);
  Object.assign(region, overrides.region);
  return { document: { querySelectorAll: selector => selector === '[id]' ? (overrides.ids ?? [field]) : (overrides.regions ?? [region]) },
    getComputedStyle: node => ({ visibility: 'visible', opacity: '1', ...overrides.style?.(node) }) };
}

test('observes only the native visible uniquely associated interpreter, without its value', () => {
  const result = runInNewContext(editorFieldObservationExpression(), fixture());
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { id: 'runtime-id', label: 'Python interpreter', visible: true, association: true });
  assert(!/\.value|__vue|localStorage|dispatchEvent|\.click\(|setAttribute/.test(editorFieldObservationExpression()));
});

test('missing, ambiguous, hidden, disabled or foreign fields fail closed', () => {
  for (const changes of [
    { regions: [] }, { regions: [{}, {}] }, { ids: [] }, { ids: [{ id: 'runtime-id' }, { id: 'runtime-id' }] },
    { region: { querySelectorAll: () => [{ textContent: 'Python interpreter' }, { textContent: 'Python interpreter' }] } },
    { region: { contains: () => false } }, { region: { querySelector: () => ({ textContent: 'Different region' }) } },
    { label: { htmlFor: '' } }, { label: { getClientRects: () => [] } },
    { field: { getClientRects: () => [] } }, { field: { isConnected: false } },
    { field: { disabled: true } }, { field: { matches: () => true } },
    { field: { getAttribute: () => 'true' } }, { field: { labels: [] } },
    { field: { tagName: 'DIV' } }, { field: { name: 'unrelated' } },
    { style: () => ({ visibility: 'hidden' }) }, { style: () => ({ opacity: '0' }) },
  ]) assert.equal(runInNewContext(editorFieldReadyExpression(), fixture(changes)), false);
});

test('failure diagnostics name only the failed association check and never field values', () => {
  const result = runInNewContext(editorFieldObservationExpression(true), fixture({ field: { disabled: true, value: 'private-interpreter-path' } }));
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { refusal: 'field-disabled' });
  assert(!JSON.stringify(result).includes('private-interpreter-path'));
  const missing = runInNewContext(editorFieldObservationExpression(true), fixture({ regions: [] }));
  assert.deepEqual(JSON.parse(JSON.stringify(missing)), { refusal: 'region-count' });
});

test('mode caption is followed by target readiness and two independent readonly observations', async () => {
  const calls = [], observation = { id: 'runtime-id', label: 'Python interpreter', visible: true, association: true };
  const result = await openTrainingEditor({ button: async name => calls.push(['button', name]),
    cli: async (...args) => calls.push(args), dom: async expression => { calls.push(['dom', expression]); return observation; } });
  assert.equal(result, observation);
  assert.deepEqual(calls.map(call => call[0]), ['button', 'wait', 'wait', 'dom', 'dom']);
  assert.equal(calls[0][1], 'Show full editor');
  assert(calls[1][2].includes('Use guided steps'));
  assert.equal(calls[2][2], editorFieldReadyExpression());
  assert.equal(calls[3][1], calls[4][1]);
});

test('native readiness timeout performs no independent DOM observation', async () => {
  let reads = 0;
  await assert.rejects(openTrainingEditor({ button: async () => {}, cli: async () => { throw Error('timeout'); }, dom: async () => { reads++; } }), /timeout/);
  assert.equal(reads, 0);
});

const ready = { id: 'runtime-id', label: 'Python interpreter', visible: true, association: true };
test('transient absence resets readiness until two consecutive identical valid observations', async () => {
  for (const answers of [[false, ready, ready], [ready, false, ready, ready]]) {
    let reads = 0;
    const result = await openTrainingEditor({ button: async () => {}, cli: async () => {},
      dom: async (_expression, timeout) => {
        assert(timeout > 0 && timeout <= EDITOR_OBSERVATION_TIMEOUT_MS);
        return answers[reads++];
      } });
    assert.equal(result, ready);
    assert.equal(reads, answers.length);
  }
});

test('replacement ID needs its own consecutive valid observation pair', async () => {
  const replacement = { ...ready, id: 'replacement' };
  const answers = [ready, replacement, replacement];
  let reads = 0;
  const result = await openTrainingEditor({ button: async () => {}, cli: async () => {}, dom: async () => answers[reads++] });
  assert.equal(result, replacement);
  assert.equal(reads, 3);
});

test('persistent invalid or changing associations exhaust exactly the observation bound', async () => {
  assert.equal(MAX_EDITOR_OBSERVATIONS, 8);
  for (const answer of [() => false, () => ({ ...ready, association: false }),
    index => ({ ...ready, id: `replacement-${index}` }),
    index => index % 2 ? false : ready]) {
    let reads = 0;
    await assert.rejects(openTrainingEditor({ button: async () => {}, cli: async () => {}, dom: async () => answer(reads++) }), /association did not stabilize/);
    assert.equal(reads, MAX_EDITOR_OBSERVATIONS);
  }
});
