import assert from 'node:assert/strict';
import test from 'node:test';
import { actionableExpression, controlLocator, createBrowserActions, DRIVER_READINESS_MODE, EXPOSURE_OBSERVATION_TIMEOUT_MS, exposureExpression, MAX_EXPOSURE_OBSERVATIONS, xpathLiteral } from './browser_actions.mjs';

const stable = { x: 10, y: 10, width: 20, height: 20, viewportWidth: 800, viewportHeight: 600 };
function mock(answers = [], observations = [stable, stable]) {
  const calls = [];
  const reads = [];
  return { calls, reads, actions: createBrowserActions({
    cli: async (...args) => { calls.push(args); },
    dom: async (expression) => {
      reads.push(expression);
      return expression.includes('return { x: rect.x') ? observations.shift() : answers.shift();
    },
    snapshot: async () => { calls.push(['snapshot']); },
  }) };
}
const shown = { visible: true, disabled: false, leaf: true, id: 'control-id', locator: '#control-id' };

test('XPath text escapes both quote types without positional selectors', () => {
  assert.equal(xpathLiteral('a'), "'a'");
  assert.equal(xpathLiteral("a'b"), '"a\'b"');
  assert.equal(xpathLiteral('a\'b"c'), `concat('a', "'", 'b"c')`);
  assert(!controlLocator('button', 'Preview persisted plan').includes('nth'));
});
test('button checks exposure and two controller observations before exact atomic click', async () => {
  const { actions, calls, reads } = mock([[shown]]);
  assert.equal(await actions.button('Preview persisted plan'), true);
  assert.deepEqual(calls.map(c => c[0]), ['snapshot', 'scrollintoview', 'wait', 'find']);
  assert.deepEqual(calls.at(-1), ['find', 'role', 'button', 'click', '--name', 'Preview persisted plan', '--exact']);
  assert(calls[2][2].includes('elementFromPoint'));
  assert(!calls[2][2].includes('requestAnimationFrame'));
  assert.equal(reads.length, 3);
  assert.equal(reads[1], reads[2]);
  assert(reads[1].includes('Preview persisted plan'));
});
test('duplicate controls fail before an action even if one is hidden', async () => {
  const { actions, calls } = mock([[shown, { ...shown, visible: false }]]);
  await assert.rejects(actions.button('Connection'), /Expected one button/);
  assert.deepEqual(calls, [['snapshot']]);
});
test('optional absence performs no click or wait', async () => {
  const { actions, calls } = mock([[]]);
  assert.equal(await actions.button('Detach', true), false);
  assert.deepEqual(calls, [['snapshot']]);
});
test('transient absence waits for a named DOM control, never fixed milliseconds', async () => {
  const { actions, calls } = mock([[], [shown]]);
  await actions.button('Show full editor');
  assert.equal(calls[1][0], 'wait');
  assert.equal(calls[1][1], '--fn');
  assert(calls[1][2].includes('Show full editor'));
});
test('disabled controls fail without click', async () => {
  const { actions, calls } = mock([[{ ...shown, disabled: true }]]);
  await assert.rejects(actions.button('Approve'), /disabled/);
  assert.deepEqual(calls, [['snapshot']]);
});
test('fill uses visible control existing stable ID and reads back authored value', async () => {
  const { actions, calls } = mock([[shown], [{ ...shown, value: '11' }]]);
  await actions.fill('epochs', 11);
  assert.deepEqual(calls.at(-1), ['fill', '#control-id', '11']);
});
test('fill retains an explicitly observed field ID through discovery, exposure and readback', async () => {
  const { actions, calls, reads } = mock([[{ ...shown, labels: ['Python interpreter'] }], [{ ...shown, value: '/selected/python', labels: ['Python interpreter'] }]]);
  await actions.fill('Python interpreter', '/selected/python', { locator: '#control-id' });
  assert.deepEqual(calls.at(-1), ['fill', '#control-id', '/selected/python']);
  assert(reads.every(expression => expression.includes('#control-id')));
  assert(!reads.some(expression => expression.includes('//label')));
});
test('explicit field IDs cannot bypass the requested native label association', async () => {
  for (const labels of [[], ['Unrelated field'], ['Python interpreter', 'Python interpreter'], ['Python interpreter', 'Unrelated field']]) {
    const { actions, calls } = mock([[{ ...shown, labels }]]);
    await assert.rejects(actions.fill('Python interpreter', '/selected/python', { locator: '#control-id' }), /native label association/);
    assert(!calls.some(call => call[0] === 'fill'));
  }
});
test('explicit fill rejects native label replacement even when the typed value is retained', async () => {
  const { actions } = mock([[{ ...shown, labels: ['Python interpreter'] }], [{ ...shown, value: '/selected/python', labels: ['Unrelated field'] }]]);
  await assert.rejects(actions.fill('Python interpreter', '/selected/python', { locator: '#control-id' }), /native label association after fill/);
});
test('hidden duplicate fields cannot redirect fill to a global semantic label', async () => {
  const { actions, calls } = mock([[{ ...shown, visible: false, id: 'hidden', locator: '#hidden' }, shown], [{ ...shown, value: '11' }]]);
  await actions.fill('epochs', '11');
  assert.deepEqual(calls.at(-1), ['fill', '#control-id', '11']);
  assert(!calls.some(c => c[0] === 'find'));
  assert(calls.find(c => c[0] === 'wait')[2].includes('document.querySelectorAll("#control-id")'));
});
test('duplicate visible fields fail before fill', async () => {
  const { actions, calls } = mock([[shown, shown]]);
  await assert.rejects(actions.fill('epochs', '11'), /Expected one field/);
  assert.deepEqual(calls, [['snapshot']]);
});
test('visible field without existing stable ID fails closed', async () => {
  const { actions } = mock([[{ ...shown, id: '', locator: null }]]);
  await assert.rejects(actions.fill('epochs', '11'), /existing stable ID/);
});
test('scoped duplicate-name button clicks only the exact scoped XPath', async () => {
  const { actions, calls } = mock([[shown]]);
  const options = { scope: '//nav[@aria-label="Sections"]' };
  await actions.button('Connection', false, options);
  const locator = controlLocator('button', 'Connection', options);
  assert.deepEqual(calls.at(-1), ['click', locator]);
  assert(calls[1][1].includes('//nav[@aria-label="Sections"]'));
  assert(!calls.some(c => c[0] === 'find'));
});
test('custom exact tab locator is retained throughout readiness and native click', async () => {
  const { actions, calls, reads } = mock([[shown]]);
  const locator = 'xpath=//button[@role="tab" and normalize-space(.)="Connection"]';
  await actions.button('Connection', false, { locator });
  assert.deepEqual(calls[1], ['scrollintoview', locator]);
  assert.deepEqual(calls.at(-1), ['click', locator]);
  assert(!calls.some(call => call[0] === 'find'));
  for (const expression of [reads[0], calls[2][2], reads[1], reads[2]]) {
    assert(expression.includes(JSON.stringify(locator.slice(6))));
  }
});
test('readyControl returns supplied locator without widening to same-name global button', async () => {
  const { actions, calls, reads } = mock([[shown]]);
  const locator = 'xpath=//nav[@aria-label="Views"]//button[@role="tab" and @aria-label="Datasets"]';
  assert.equal(await actions.readyControl('button', 'Datasets', false, { locator }), locator);
  assert.deepEqual(calls[1], ['scrollintoview', locator]);
  assert(!calls.some(call => call[0] === 'click' || call[0] === 'find'));
  assert(reads.every(expression => expression.includes(JSON.stringify(locator.slice(6)))));
});
test('failed readback is not silently accepted', async () => {
  const { actions } = mock([[shown], [{ ...shown, value: '10000' }]]);
  await assert.rejects(actions.fill('epochs', '11'), /did not retain/);
});
test('custom option preserves its exact locator and clicks once after stable exposure', async () => {
  const { actions, calls } = mock([[shown]]);
  await actions.option('datasets');
  const locator = controlLocator('option', 'datasets');
  assert.deepEqual(calls.map(call => call[0]), ['snapshot', 'scrollintoview', 'wait', 'click']);
  assert.deepEqual(calls.at(-1), ['click', locator]);
  assert(!calls.some(call => call[0] === 'press' || call[0] === 'find'));
});
test('duplicate custom options fail before any native click', async () => {
  const { actions, calls } = mock([[shown, shown]]);
  await assert.rejects(actions.option('datasets'), /Expected one option/);
  assert.deepEqual(calls, [['snapshot']]);
});
test('custom option cannot bypass stable native hit-test observations', async () => {
  const { actions, calls } = mock([[shown]], Array(MAX_EXPOSURE_OBSERVATIONS).fill(false));
  await assert.rejects(actions.option('datasets'), /exposure did not stabilize/);
  assert(!calls.some(call => call[0] === 'click'));
});
test('summary retains its preflighted locator through native click and open readback', async () => {
  const { actions, calls, reads } = mock([[shown], false, true]);
  await actions.expandSummary('Data, checkpoints and cross-validation');
  const locator = controlLocator('summary', 'Data, checkpoints and cross-validation');
  assert.deepEqual(calls.find(c => c[0] === 'click'), ['click', locator]);
  assert(!calls.some(c => c[0] === 'find'));
  assert(reads.every(expression => expression.includes(JSON.stringify(locator.slice(6)))));
});
test('native exact-text non-leaf summary fails closed', async () => {
  const { actions } = mock([[{ ...shown, leaf: false }]]);
  await assert.rejects(actions.expandSummary('Advanced'), /must be a leaf/);
});
test('actionability predicate only observes public DOM', () => {
  const expression = actionableExpression('button', 'Submit');
  assert(!/setAttribute|\.click\(|dispatchEvent|__vue|localStorage/.test(expression));
});

function actionability({ outside = false, covered = false, count = 1, disabled = false, ariaDisabled = false, connected = true, width = 20, visibility = 'visible', opacity = '1', pointerEvents = 'auto' } = {}) {
  const element = { isConnected: connected, disabled,
    getClientRects: () => [{}],
    getBoundingClientRect: () => ({ x: outside ? -100 : 10, y: 10, width, height: 20 }),
    matches: () => false,
    getAttribute: () => ariaDisabled ? 'true' : null,
    contains: () => false };
  const document = {
    evaluate: () => ({ snapshotLength: count, snapshotItem: () => element }),
    elementFromPoint: () => covered ? {} : element,
  };
  const evaluate = new Function('document', 'XPathResult', 'getComputedStyle', 'innerWidth', 'innerHeight', `return ${actionableExpression('button', 'Submit')}`);
  return evaluate(document, { ORDERED_NODE_SNAPSHOT_TYPE: 7 }, () => ({ visibility, opacity, pointerEvents }), 800, 600);
}
test('stable exposed target passes synchronous readonly actionability check', () => {
  assert.equal(actionability(), true);
});
test('covered, outside, ambiguous, disabled, disconnected and invisible targets fail exposure', () => {
  for (const options of [{ covered: true }, { outside: true }, { count: 2 }, { disabled: true }, { ariaDisabled: true }, { connected: false }, { width: 0 }, { width: NaN }, { visibility: 'hidden' }, { opacity: '0' }, { pointerEvents: 'none' }]) {
    assert.equal(actionability(options), false);
  }
});
test('readiness mode accurately names controller observations, not render frames', () => {
  assert.equal(DRIVER_READINESS_MODE, 'sync-exposure-poll-and-two-controller-dom-observations');
  assert(!/Promise|requestAnimationFrame|setTimeout|await/.test(exposureExpression('button', 'Submit')));
});
test('changed geometry or viewport between independent reads prevents native click', async () => {
  for (const changed of [{ ...stable, x: 11 }, { ...stable, width: 21 }, { ...stable, viewportWidth: 799 }]) {
    const { actions, calls } = mock([[shown]], [stable, changed]);
    await assert.rejects(actions.button('Submit'), /exposure did not stabilize/);
    assert(!calls.some(call => call[0] === 'find' || call[0] === 'click'));
  }
});
test('lost exposure or ambiguity after wait prevents native click', async () => {
  for (const observations of [[false], [stable, false], [{}, {}], [{ ...stable, width: NaN }]]) {
    const { actions, calls } = mock([[shown]], observations);
    await assert.rejects(actions.button('Submit'), /exposure did not stabilize/);
    assert(!calls.some(call => call[0] === 'find' || call[0] === 'click'));
  }
});

test('transient geometry or exposure resets the pair until two consecutive stable reads', async () => {
  const moved = { ...stable, y: 100 };
  for (const observations of [[stable, moved, moved], [stable, false, stable, stable]]) {
    const count = observations.length;
    const { actions, calls, reads } = mock([[shown]], observations);
    await actions.button('Submit');
    assert.equal(reads.length, count + 1);
    assert.equal(calls.filter(call => call[0] === 'find').length, 1);
  }
});

test('continuously moving or missing exposure exhausts eight reads without any native action', async () => {
  assert.equal(MAX_EXPOSURE_OBSERVATIONS, 8);
  for (const observations of [Array.from({ length: 8 }, (_, y) => ({ ...stable, y })), Array(8).fill(false)]) {
    const { actions, calls, reads } = mock([[shown]], observations);
    await assert.rejects(actions.fill('epochs', '11'), /exposure did not stabilize/);
    assert.equal(reads.length, 9);
    assert(!calls.some(call => ['find', 'click', 'fill', 'select'].includes(call[0])));
    assert(reads.slice(1).every(expression => expression.includes('document.querySelectorAll("#control-id")')));
  }
});

test('DOM observation deadline prevents action even when the last read returns valid geometry', async () => {
  let elapsed = 0, reads = 0;
  const calls = [];
  const actions = createBrowserActions({ now: () => elapsed, snapshot: async () => {},
    cli: async (...args) => calls.push(args), dom: async (expression, timeout) => {
      if (!expression.includes('return { x: rect.x')) return [shown];
      assert(timeout > 0 && timeout <= EXPOSURE_OBSERVATION_TIMEOUT_MS);
      reads++;
      elapsed = EXPOSURE_OBSERVATION_TIMEOUT_MS;
      return stable;
    } });
  await assert.rejects(actions.button('Submit'), /exposure did not stabilize/);
  assert.equal(reads, 1);
  assert(!calls.some(call => call[0] === 'find' || call[0] === 'click'));
});

test('explicit field native label association is checked again by every exposure observation', async () => {
  const { actions, calls, reads } = mock([[{ ...shown, labels: ['Python interpreter'] }]], Array(8).fill(false));
  await assert.rejects(actions.fill('Python interpreter', '/python', { locator: '#control-id' }), /exposure did not stabilize/);
  assert(calls.find(call => call[0] === 'wait')[2].includes('element.labels'));
  assert(reads.slice(1).every(expression => expression.includes('element.labels') && expression.includes('Python interpreter')));
  assert(!calls.some(call => call[0] === 'fill'));
});
test('field stability reads use exactly the ID later filled', async () => {
  const { actions, reads, calls } = mock([[shown], [{ ...shown, value: '11' }]]);
  await actions.fill('epochs', '11');
  assert(reads[1].includes('document.querySelectorAll("#control-id")'));
  assert.equal(reads[1], reads[2]);
  assert.deepEqual(calls.at(-1), ['fill', '#control-id', '11']);
});
test('actionability wait failure cannot fall through to a click', async () => {
  const calls = [];
  const actions = createBrowserActions({
    snapshot: async () => '', dom: async () => [shown],
    cli: async (...args) => { calls.push(args); if (args[0] === 'wait') throw Error('actionability timeout'); },
  });
  await assert.rejects(actions.button('Submit'), /actionability timeout/);
  assert(!calls.some(call => call[0] === 'find'));
});
