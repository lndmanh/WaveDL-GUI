// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  createBrowserActions,
  normalizeTrainingFieldLabel,
} from '../../../tools/browser_actions.mjs';

const rect = { x: 10, y: 10, width: 40, height: 20 };

function setup({ initiallyVisible = false, nestedInactiveTab = false, reveal = true } = {}) {
  document.body.innerHTML = '';
  const panel = document.createElement('div');
  panel.setAttribute('role', 'tabpanel');
  panel.dataset.state = nestedInactiveTab ? 'inactive' : 'active';
  const tab = document.createElement('button');
  tab.id = 'outer-tab-trigger';
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-controls', 'panel-content');
  panel.id = 'panel-content';

  const content = document.createElement('div');
  content.id = 'field-content';
  content.dataset.slot = 'collapsible-content';
  content.dataset.state = initiallyVisible ? 'open' : 'closed';
  const trigger = document.createElement('button');
  trigger.setAttribute('data-slot', 'collapsible-trigger');
  trigger.setAttribute('aria-controls', 'field-content');
  const field = document.createElement('input');
  field.id = 'target-field';
  field.setAttribute('aria-label', 'Epochs');
  const label = document.createElement('label');
  label.htmlFor = field.id;
  label.textContent = 'Epochs';
  content.append(field, label);
  panel.append(trigger, content);
  document.body.append(tab, panel);

  let openedCollapsible = 0;
  let openedTab = 0;
  const visible = () =>
    initiallyVisible ||
    (reveal &&
      content.dataset.state === 'open' &&
      (!nestedInactiveTab || panel.dataset.state === 'active'));
  Object.defineProperty(field, 'getClientRects', {
    value: () => (visible() ? [rect] : []),
  });
  Object.defineProperty(field, 'getBoundingClientRect', { value: () => rect });
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => field,
  });

  const evaluate = (expression) => {
    const result = Function(
      'document',
      'innerWidth',
      'innerHeight',
      'getComputedStyle',
      'CSS',
      'XPathResult',
      `return (${expression})`,
    )(
      document,
      800,
      600,
      () => ({ visibility: 'visible', opacity: '1', pointerEvents: 'auto' }),
      { escape: (value) => value },
      {},
    );
    return typeof result === 'string' ? JSON.parse(result) : result;
  };
  const cli = async (...args) => {
    if (args[0] === 'click') {
      const target = document.querySelector(args[1]);
      if (target === trigger) {
        openedCollapsible++;
        if (reveal) content.dataset.state = 'open';
      } else if (target === tab) {
        openedTab++;
        panel.dataset.state = 'active';
      }
      return;
    }
    if (args[0] === 'wait' && args[1] === '--fn' && !evaluate(args[2]))
      throw new Error('Readiness wait condition was false');
  };
  const actions = createBrowserActions({
    cli,
    dom: async (expression) => evaluate(expression),
    snapshot: async () => {},
  });
  return {
    actions,
    openedCollapsible: () => openedCollapsible,
    openedTab: () => openedTab,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  delete document.elementFromPoint;
});

describe('browser action field exposure', () => {
  it('resolves legacy CLI names to the exact current English visible label', () => {
    expect(normalizeTrainingFieldLabel('lr')).toBe('Learning rate');
    expect(normalizeTrainingFieldLabel('batch size')).toBe('Batch size');
    expect(normalizeTrainingFieldLabel('Learning rate')).toBe('Learning rate');
  });

  it('opens only the target field’s nearest collapsible and confirms the field is exposed', async () => {
    const state = setup();
    await expect(
      state.actions.readyControl('field', 'epochs', false, { locator: '#target-field' }),
    ).resolves.toBe('#target-field');
    expect(state.openedCollapsible()).toBe(1);
    expect(state.openedTab()).toBe(0);
  });

  it('fails as not exposed after opening only the target’s own panel when an outer tab remains inactive', async () => {
    const state = setup({ nestedInactiveTab: true });
    await expect(
      state.actions.readyControl('field', 'epochs', false, { locator: '#target-field' }),
    ).rejects.toThrow('epochs is not exposed in the DOM');
    expect(state.openedCollapsible()).toBe(1);
    expect(state.openedTab()).toBe(0);
  });

  it('asserts a default-visible field without revealing a collapsible or tab', async () => {
    const state = setup({ initiallyVisible: true });
    await expect(
      state.actions.readyControl('field', 'epochs', false, { locator: '#target-field' }),
    ).resolves.toBe('#target-field');
    expect(state.openedCollapsible()).toBe(0);
    expect(state.openedTab()).toBe(0);
  });

  it('does not auto-reveal Essentials to heal a default-visible field regression', async () => {
    const state = setup({ nestedInactiveTab: true });
    document.getElementById('field-content')!.dataset.state = 'open';
    document.getElementById('outer-tab-trigger')!.dataset.testid = 'training-tab-essentials';
    await expect(
      state.actions.readyControl('field', 'epochs', false, { locator: '#target-field' }),
    ).rejects.toThrow('epochs is not exposed in the DOM');
    expect(state.openedTab()).toBe(0);
    expect(state.openedCollapsible()).toBe(0);
  });
});
