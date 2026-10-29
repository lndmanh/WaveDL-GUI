// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountWithI18n as mount } from './mountWithI18n';
import { flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { ConnectionSession } from './session-fixture';
import { CatalogApi } from '../../app/lib/catalog-api';
import ProjectContainer from '../../app/components/project/ProjectContainer.vue';
import RunPipeline from '../../app/components/project/RunPipeline.vue';
import DatasetPathPicker from '../../app/components/datasets/DatasetPathPicker.vue';
import ModelInspector from '../../app/components/project/ModelInspector.vue';
import {
  activeBlock,
  builderForm,
  builderStubs,
  button,
  installMemoryStorage,
  jsonResponse,
  modelCatalogue,
} from './project-builder-fixture';

const ids = {
  plan_id: '11111111-1111-4111-8111-111111111111',
  run_id: '22222222-2222-4222-8222-222222222222',
  request_id: '33333333-3333-4333-8333-333333333333',
};
const run = {
  ...ids,
  backend: 'local',
  operation: 'train',
  state: 'submitted',
  attempt: null,
  uncertainty: false,
  submission_requested: true,
  cancellation_requested: false,
  evidence: null,
};

const cleanups: (() => void)[] = [];
beforeEach(() => {
  installMemoryStorage();
});
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

async function setup() {
  const calls: string[] = [];
  let release: ((value: Response) => void) | undefined;
  let holdPlan = false;
  const session = new ConnectionSession({
    origin: window.location.origin,
    buildId: '1.8.1',
    fetcher: async (input) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      if (path === '/api/health')
        return jsonResponse({
          daemon_id: 'daemon-a',
          build_id: '1.8.1',
          protocol_min: 1,
          protocol_max: 1,
        });
      if (path === '/api/models') return jsonResponse(modelCatalogue);
      if (path === '/api/browse/resolve')
        return jsonResponse({
          root: 'data',
          relative_path: 'train.npz',
          path: '/data/train.npz',
          kind: 'file',
        });
      if (path === '/api/runs/plan') {
        if (holdPlan)
          return new Promise<Response>((resolve) => {
            release = resolve;
          });
        return jsonResponse({ ...ids, preview: { manifest_json: '{}' } });
      }
      if (path === '/api/runs') return jsonResponse(run);
      throw new Error(`Unexpected route ${path}`);
    },
  });
  expect(await session.connect('credential')).toBe(true);
  const wrapper = mount(ProjectContainer, {
    props: { session },
    attachTo: document.body,
    global: { stubs: builderStubs },
  });
  cleanups.push(() => {
    wrapper.unmount();
    session.detach();
  });
  await flushPromises();
  const catalogue = new CatalogApi(session);
  async function selectData() {
    wrapper
      .getComponent(DatasetPathPicker)
      .vm.$emit('select', await catalogue.resolve('data', 'train.npz'));
    await nextTick();
  }
  async function selectModel() {
    wrapper
      .getComponent(ModelInspector)
      .vm.$emit('custom', await catalogue.selectCustomModel('custom_model'));
    await nextTick();
  }
  function tab(block: string) {
    return wrapper.get(`[role="tab"][id$="-tab-${block}"]`);
  }
  function createPlan() {
    const found = builderForm(wrapper)
      .findAll('button[type="submit"]')
      .find((entry) => entry.text().includes('Create plan'));
    if (!found) throw new Error('Missing Create plan');
    return found;
  }
  function readiness() {
    return wrapper.get('ul[aria-label="Readiness"]');
  }
  return {
    wrapper,
    session,
    calls,
    selectData,
    selectModel,
    tab,
    createPlan,
    readiness,
    holdPlan() {
      holdPlan = true;
    },
    release() {
      if (!release) throw new Error('No pending plan');
      release(jsonResponse({ ...ids, preview: { manifest_json: '{}' } }));
    },
  };
}

describe('run builder block navigation and planning', () => {
  it('moves between blocks by click and arrow keys without gating, keeping every value', async () => {
    const { wrapper, tab } = await setup();
    expect(activeBlock(wrapper)).toBe('dataset');
    expect(wrapper.get('[data-testid="guide-step-0"]').attributes('aria-current')).toBe('step');
    // No step is gated: nothing chosen yet, every block is still reachable.
    await tab('runtime').trigger('click');
    expect(activeBlock(wrapper)).toBe('runtime');
    expect(tab('runtime').attributes('aria-selected')).toBe('true');
    expect(tab('runtime').attributes('tabindex')).toBe('0');
    expect(tab('dataset').attributes('tabindex')).toBe('-1');
    await wrapper.get('input[name="runtime.python"]').setValue('/usr/bin/python3');

    await tab('runtime').trigger('keydown', { key: 'ArrowRight' });
    expect(activeBlock(wrapper)).toBe('plan');
    await tab('plan').trigger('keydown', { key: 'ArrowRight' });
    expect(activeBlock(wrapper)).toBe('dataset');
    await tab('dataset').trigger('keydown', { key: 'ArrowLeft' });
    expect(activeBlock(wrapper)).toBe('plan');
    await tab('plan').trigger('keydown', { key: 'Home' });
    expect(activeBlock(wrapper)).toBe('dataset');
    await tab('dataset').trigger('keydown', { key: 'End' });
    expect(activeBlock(wrapper)).toBe('plan');
    await nextTick();
    expect(document.activeElement).toBe(tab('plan').element);
    await tab('plan').trigger('keydown', { key: 'Enter' });
    expect(activeBlock(wrapper)).toBe('plan');

    await tab('training').trigger('click');
    await wrapper.get('[id$="-training-epochs"]').setValue('17');
    await tab('dataset').trigger('click');
    await tab('training').trigger('click');
    // Inspectors are only hidden: switching blocks never discards an edit.
    expect(wrapper.get<HTMLInputElement>('[id$="-training-epochs"]').element.value).toBe('17');
    expect(wrapper.get<HTMLInputElement>('input[name="runtime.python"]').element.value).toBe(
      '/usr/bin/python3',
    );
    const form = builderForm(wrapper);
    expect(form.attributes('aria-labelledby')).toBe(tab('training').attributes('id'));
  });

  it('refuses missing selections and invalid runtime without planning or submitting', async () => {
    const { wrapper, calls, selectData, selectModel, tab, createPlan, readiness } = await setup();
    await tab('plan').trigger('click');
    expect(readiness().findAll('li')).toHaveLength(4);
    expect(readiness().text()).toContain('Choose a dataset');
    expect(readiness().text()).toContain('Choose a model');
    expect(wrapper.text()).toContain('A few things left');
    expect(createPlan().attributes('disabled')).toBeDefined();
    // The strip's primary action validates instead of planning while selections are missing.
    await button(wrapper, 'Create plan').trigger('click');
    await flushPromises();
    expect(activeBlock(wrapper)).toBe('plan');
    expect(calls.some((path) => path.startsWith('/api/runs'))).toBe(false);

    await selectData();
    expect(activeBlock(wrapper)).toBe('plan');
    await selectModel();
    expect(readiness().text()).toContain('train.npz');
    expect(readiness().text()).toContain('custom_model');
    // The Python interpreter is still missing, so the runtime block reports an issue.
    expect(readiness().text()).toMatch(/Runs on\d+ to fixFix/);
    expect(wrapper.get('[data-testid="guide-step-3"]').attributes('data-state')).toBe('pending');
    expect(createPlan().attributes('disabled')).toBeDefined();
    await builderForm(wrapper).trigger('submit');
    await vi.waitFor(() =>
      expect(wrapper.find('[role="alert"]').text()).toContain(
        'Review the validation errors before requesting a plan.',
      ),
    );
    expect(activeBlock(wrapper)).toBe('runtime');
    expect(calls.some((path) => path.startsWith('/api/runs'))).toBe(false);

    const fix = readiness()
      .findAll('li')
      .find((item) => item.text().includes('Runs on'));
    if (!fix) throw new Error('Missing runtime readiness');
    await tab('plan').trigger('click');
    await fix.get('button').trigger('click');
    expect(activeBlock(wrapper)).toBe('runtime');
    await wrapper.get('input[name="runtime.python"]').setValue('/usr/bin/python3');
    await tab('plan').trigger('click');
    expect(wrapper.text()).toContain('Ready to plan');
    expect(createPlan().attributes('disabled')).toBeUndefined();
    expect(calls.some((path) => path.startsWith('/api/runs'))).toBe(false);
  });

  it('auto-advances from the dataset block to the model block only while no model is chosen', async () => {
    const { wrapper, selectData, selectModel, tab } = await setup();
    await selectData();
    expect(activeBlock(wrapper)).toBe('model');
    expect(wrapper.get('[data-testid="guide-step-0"]').attributes('data-state')).toBe('complete');
    await selectModel();
    await tab('dataset').trigger('click');
    await selectData();
    expect(activeBlock(wrapper)).toBe('dataset');
  });

  it('locks planning while the daemon works, then creates, approves and acknowledges the plan', async () => {
    const fixture = await setup();
    const { wrapper, calls, tab } = fixture;
    await fixture.selectData();
    await fixture.selectModel();
    await tab('runtime').trigger('click');
    await wrapper.get('input[name="runtime.python"]').setValue('/usr/bin/python3');
    fixture.holdPlan();
    await button(wrapper, 'Create plan').trigger('click');
    await vi.waitFor(() => expect(calls).toContain('/api/runs/plan'));
    expect(activeBlock(wrapper)).toBe('plan');
    expect(wrapper.getComponent(RunPipeline).props('reviewBusy')).toBe(true);
    expect(wrapper.getComponent(RunPipeline).props('reviewDisabled')).toBe(true);
    expect(wrapper.text()).toContain('Waiting for daemon…');
    expect(button(wrapper, 'Stop waiting').exists()).toBe(true);
    expect(
      builderForm(wrapper)
        .findAll('button[type="submit"]')
        .every((entry) => entry.attributes('disabled') !== undefined),
    ).toBe(true);

    fixture.release();
    await vi.waitFor(() => expect(wrapper.find('#approved-plan-title').exists()).toBe(true));
    expect(wrapper.get('#approved-plan-title').text()).toBe('Persisted plan for approval');
    expect(wrapper.getComponent(RunPipeline).props('reviewLabel')).toBe('Review plan');
    expect(wrapper.get('[data-testid="guide-step-4"]').attributes('data-state')).toBe('complete');
    expect(calls.some((path) => path === '/api/runs')).toBe(false);

    await button(wrapper, 'Approve and start this plan').trigger('click');
    await vi.waitFor(() =>
      expect(wrapper.find('[aria-label="Acknowledged training run"]').exists()).toBe(true),
    );
    expect(calls.filter((path) => path === '/api/runs')).toHaveLength(1);
    expect(wrapper.emitted('submitted')).toHaveLength(1);
    expect(wrapper.emitted('submittedPlan')).toHaveLength(1);
    expect(wrapper.getComponent(RunPipeline).props('reviewLabel')).toBe('Open acknowledged run');
    await button(wrapper, 'Open acknowledged run').trigger('click');
    expect(wrapper.emitted('submitted')).toHaveLength(2);
  });

  it('retires a pending plan on detach without leaving the builder locked', async () => {
    const fixture = await setup();
    const { wrapper, session, calls } = fixture;
    await fixture.selectData();
    await fixture.selectModel();
    await wrapper.get('input[name="runtime.python"]').setValue('/usr/bin/python3');
    fixture.holdPlan();
    await builderForm(wrapper).trigger('submit');
    await vi.waitFor(() => expect(calls).toContain('/api/runs/plan'));
    expect(wrapper.getComponent(RunPipeline).props('reviewBusy')).toBe(true);
    session.detach();
    await flushPromises();
    expect(wrapper.getComponent(RunPipeline).props('reviewBusy')).toBe(false);
    expect(wrapper.text()).not.toContain('Waiting for daemon…');
    expect(wrapper.text()).toContain('Verified connection required');
    expect(wrapper.find('#approved-plan-title').exists()).toBe(false);
    expect(wrapper.get('[data-testid="guide-step-0"]').attributes('data-state')).toBe('pending');
    expect(wrapper.get('[data-testid="guide-step-1"]').attributes('data-state')).toBe('pending');
    expect(calls.some((path) => path === '/api/runs')).toBe(false);
  });
});
