// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  createBrowserActions,
  normalizeTrainingFieldLabel,
  trainingChoiceLabel,
} from '../../../tools/browser_actions.mjs';

const rect = { x: 10, y: 10, width: 40, height: 20 };

interface SetupOptions {
  /** The field's section starts open. */
  sectionOpen?: boolean;
  /** The field's builder block starts active. */
  blockActive?: boolean;
  /** Using the section trigger actually opens the section. */
  reveal?: boolean;
  /** An unrelated ancestor hides the field. */
  otherwiseHidden?: boolean;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

/** The builder shape: pipeline tabs controlling one form whose inspectors use v-show. */
function setup({
  sectionOpen = false,
  blockActive = true,
  reveal = true,
  otherwiseHidden = false,
}: SetupOptions = {}) {
  document.body.innerHTML = '';
  const strip = element('div', { 'data-testid': 'project-stepper' });
  const form = element('form', { id: 'builder-panel', role: 'tabpanel' });
  const inspectors = [element('section'), element('section')];
  const tabs = inspectors.map((_, index) =>
    element('button', {
      id: `builder-tab-${index}`,
      role: 'tab',
      'aria-controls': form.id,
      'data-testid': `guide-step-${index}`,
    }),
  );
  strip.append(...tabs);
  form.append(...inspectors);
  const activate = (index: number) =>
    inspectors.forEach((inspector, position) => {
      inspector.style.display = position === index ? '' : 'none';
    });
  activate(blockActive ? 1 : 0);

  const trigger = element('button', {
    'data-slot': 'collapsible-trigger',
    'aria-controls': 'field-content',
  });
  const content = element('div', {
    id: 'field-content',
    'data-slot': 'collapsible-content',
    'data-state': sectionOpen ? 'open' : 'closed',
  });
  const wrapper = element('div');
  if (otherwiseHidden) wrapper.style.display = 'none';
  const field = element('input', { id: 'target-field' });
  const label = element('label', { for: field.id });
  label.textContent = 'Epochs';
  wrapper.append(field, label);
  content.append(wrapper);
  inspectors[1]?.append(trigger, content);
  document.body.append(strip, form);

  const opened: string[] = [];
  const visible = () =>
    !otherwiseHidden &&
    content.dataset.state === 'open' &&
    inspectors[1]?.style.display !== 'none';
  Object.defineProperty(field, 'getClientRects', { value: () => (visible() ? [rect] : []) });
  Object.defineProperty(field, 'getBoundingClientRect', { value: () => rect });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => field });

  const evaluate = (expression: string): unknown => {
    const result: unknown = Function(
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
      { escape: (value: string) => value },
      {},
    );
    return typeof result === 'string' ? JSON.parse(result) : result;
  };
  const cli = async (...args: string[]) => {
    if (args[0] === 'click') {
      const target = args[1] ? document.querySelector(args[1]) : null;
      const tab = tabs.findIndex((candidate) => candidate === target);
      if (target === trigger) {
        opened.push('section');
        if (reveal) content.dataset.state = 'open';
      } else if (tab >= 0) {
        opened.push('block');
        activate(tab);
      }
      return;
    }
    if (args[0] === 'wait' && args[1] === '--fn' && args[2] && !evaluate(args[2]))
      throw new Error('Readiness wait condition was false');
  };
  const actions = createBrowserActions({
    cli,
    dom: async (expression: string) => evaluate(expression),
    snapshot: async () => {},
  });
  return { actions, opened: () => opened };
}

afterEach(() => {
  document.body.innerHTML = '';
  Reflect.deleteProperty(document, 'elementFromPoint');
});

describe('browser action field exposure', () => {
  it('resolves legacy CLI names to the exact current English visible label', () => {
    expect(normalizeTrainingFieldLabel('lr')).toBe('Learning rate');
    expect(normalizeTrainingFieldLabel('batch size')).toBe('Batch size');
    expect(normalizeTrainingFieldLabel('Learning rate')).toBe('Learning rate');
  });

  it('names segmented choices by the label the builder renders', () => {
    expect(trainingChoiceLabel('precision', 'no')).toBe('Full (fp32)');
    expect(trainingChoiceLabel('precision', 'bf16')).toBe('bf16');
    expect(trainingChoiceLabel('constraint_reduction', 'mae')).toBe('MAE');
  });

  it('opens only the field’s own section when its block is already shown', async () => {
    const state = setup();
    await expect(
      state.actions.readyControl('field', 'epochs', false, { locator: '#target-field' }),
    ).resolves.toBe('#target-field');
    expect(state.opened()).toEqual(['section']);
  });

  it('opens the field’s builder block before its section', async () => {
    const state = setup({ blockActive: false });
    await expect(
      state.actions.readyControl('field', 'epochs', false, { locator: '#target-field' }),
    ).resolves.toBe('#target-field');
    expect(state.opened()).toEqual(['block', 'section']);
  });

  it('asserts a default-visible field without opening a block or section', async () => {
    const state = setup({ sectionOpen: true });
    await expect(
      state.actions.readyControl('field', 'epochs', false, { locator: '#target-field' }),
    ).resolves.toBe('#target-field');
    expect(state.opened()).toEqual([]);
  });

  it('uses a section trigger once and fails when it does not expose the field', async () => {
    const state = setup({ reveal: false });
    await expect(
      state.actions.readyControl('field', 'epochs', false, { locator: '#target-field' }),
    ).rejects.toThrow('epochs is not exposed in the DOM');
    expect(state.opened()).toEqual(['section']);
  });

  it('does not heal a field hidden by anything other than a block or section', async () => {
    const state = setup({ sectionOpen: true, otherwiseHidden: true });
    await expect(
      state.actions.readyControl('field', 'epochs', false, { locator: '#target-field' }),
    ).rejects.toThrow('epochs is not exposed in the DOM');
    expect(state.opened()).toEqual([]);
  });
});
