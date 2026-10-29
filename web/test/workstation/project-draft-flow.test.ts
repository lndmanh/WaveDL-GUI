// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { mountWithI18n as mount } from './mountWithI18n';
import { ConnectionSession } from './session-fixture';
import { CatalogApi } from '../../app/lib/catalog-api';
import { parseJson } from '../../app/lib/daemon-api';
import { projectDraftSchema } from '../../shared/schemas/project-draft';
import ProjectContainer from '../../app/components/project/ProjectContainer.vue';
import ConfigMenu from '../../app/components/project/ConfigMenu.vue';
import RunPipeline from '../../app/components/project/RunPipeline.vue';
import StartPanel from '../../app/components/project/StartPanel.vue';
import {
  activeBlock,
  builderForm,
  builderStubs,
  button,
  chooseSelections,
  installMemoryStorage,
  jsonResponse,
  modelCatalogue,
} from './project-builder-fixture';

const draftKey = 'wavedl.training-draft.v1.daemon-a';
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
const savedDraft = projectDraftSchema.parse({
  version: 1,
  daemonId: 'daemon-a',
  savedAt: Date.now() - 5 * 60 * 1000,
  block: 'training',
  dataset: { root: 'data', relativePath: 'train.npz' },
  model: { id: 'cnn', custom: false },
  backend: 'local',
  config: { epochs: 17, lr: 0.003 },
  runtime: { python: '/usr/bin/python3', mode: 'existing', device: 'cuda' },
  topology: { num_machines: 1 },
  storage_map: [],
});

let storage = new Map<string, string>();
const cleanups: (() => void)[] = [];
beforeEach(() => {
  storage = installMemoryStorage();
});
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

function stored(): unknown {
  const raw = storage.get(draftKey);
  return raw === undefined ? undefined : parseJson(raw);
}

async function setup() {
  let plans = 0;
  let latest = { plan_id: ids.plan_id, request_id: ids.request_id };
  const calls: { path: string; body: string }[] = [];
  const session = new ConnectionSession({
    origin: window.location.origin,
    buildId: '1.8.1',
    fetcher: async (input, init) => {
      const path = new URL(String(input)).pathname;
      calls.push({ path, body: String(init?.body ?? '') });
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
        // Each new request key gets its own plan, as the daemon does.
        plans++;
        latest =
          plans === 1
            ? { plan_id: ids.plan_id, request_id: ids.request_id }
            : {
                plan_id: `${ids.plan_id.slice(0, -1)}${plans}`,
                request_id: `${ids.request_id.slice(0, -1)}${plans}`,
              };
        return jsonResponse({ ...ids, ...latest, preview: { manifest_json: '{}' } });
      }
      if (path === '/api/runs') return jsonResponse({ ...run, ...latest });
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
  async function select() {
    await chooseSelections(
      wrapper,
      await catalogue.resolve('data', 'train.npz'),
      await catalogue.selectCustomModel('custom_model'),
    );
  }
  function formHidden() {
    return builderForm(wrapper).attributes('style')?.includes('display: none') ?? false;
  }
  function epochs() {
    return wrapper.get<HTMLInputElement>('[id$="-training-epochs"]').element.value;
  }
  function python() {
    return wrapper.get<HTMLInputElement>('input[name="runtime.python"]').element.value;
  }
  return { wrapper, session, calls, select, formHidden, epochs, python };
}

describe('run builder draft persistence', () => {
  it('autosaves meaningful edits after the debounce and never stores environment values', async () => {
    const { wrapper, select, formHidden } = await setup();
    expect(wrapper.findComponent(StartPanel).exists()).toBe(false);
    expect(formHidden()).toBe(false);
    // Untouched defaults are not worth a draft.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(stored()).toBeUndefined();

    await select();
    await wrapper.get('input[name="runtime.python"]').setValue('/usr/bin/python3');
    await wrapper.get('[id$="-training-epochs"]').setValue('17');
    await wrapper.get('#new-env-name').setValue('API_TOKEN');
    await button(wrapper, 'Add variable').trigger('click');
    await wrapper.get('#env-API_TOKEN').setValue('super-secret-value');
    expect(wrapper.getComponent(ConfigMenu).props('draft').runtime.environment).toEqual({
      API_TOKEN: 'super-secret-value',
    });
    // Saving is debounced, not immediate.
    expect(stored()).toBeUndefined();
    await vi.waitFor(() => expect(stored()).toBeDefined());
    const draft = projectDraftSchema.parse(stored());
    expect(draft.daemonId).toBe('daemon-a');
    expect(draft.dataset).toEqual({ root: 'data', relativePath: 'train.npz' });
    expect(draft.model).toEqual({ id: 'custom_model', custom: true });
    expect(draft.config.epochs).toBe(17);
    expect(draft.runtime).toEqual({ python: '/usr/bin/python3', mode: 'existing', device: 'cpu' });
    const raw = storage.get(draftKey) ?? '';
    expect(raw).not.toContain('super-secret-value');
    expect(raw).not.toContain('API_TOKEN');
    expect(raw).not.toContain('environment');
    expect(wrapper.find('.draft-saved[role="status"]').text()).toBe('Draft saved');
  });

  // Known bug: the 'connecting' publish carries the new revision while disconnected, so the
  // later 'connected' publish never reaches loadProjectDraft. Remove `.fails` once fixed.
  it('offers the saved draft again when the mounted builder reconnects', async () => {
    const { wrapper, session, select, formHidden } = await setup();
    await select();
    await wrapper.get('[id$="-training-epochs"]').setValue('17');
    await vi.waitFor(() => expect(stored()).toBeDefined());
    expect(await session.connect('credential')).toBe(true);
    await flushPromises();
    expect(wrapper.findComponent(StartPanel).exists()).toBe(true);
    expect(formHidden()).toBe(true);
  });

  it('offers a saved draft on a fresh connection and holds the builder until the user chooses', async () => {
    storage.set(draftKey, JSON.stringify(savedDraft));
    const { wrapper, calls, formHidden } = await setup();
    const panel = wrapper.getComponent(StartPanel);
    expect(panel.text()).toContain('Pick up where you left off');
    expect(panel.text()).toContain('train.npz');
    expect(panel.text()).toContain('cnn');
    expect(panel.text()).toContain('NVIDIA GPU');
    expect(wrapper.get('[data-testid="continue-draft"]').text()).toBe('Continue draft');
    expect(wrapper.find('[data-testid="start-fresh"]').exists()).toBe(true);
    expect(formHidden()).toBe(true);
    // The strip only previews the draft: block navigation and planning wait for a choice.
    expect(wrapper.getComponent(RunPipeline).props('reviewDisabled')).toBe(true);
    await wrapper.get('[role="tab"][id$="-tab-runtime"]').trigger('click');
    expect(activeBlock(wrapper)).toBe('dataset');
    // An offered draft is never overwritten while it waits.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(stored()).toEqual(savedDraft);
    expect(calls.some((call) => call.path === '/api/browse/resolve')).toBe(false);
  });

  it('does not offer a stored draft that carries environment values or belongs to another daemon', async () => {
    storage.set(
      draftKey,
      JSON.stringify({
        ...savedDraft,
        runtime: { ...savedDraft.runtime, environment: { API_TOKEN: 'leaked' } },
      }),
    );
    const first = await setup();
    expect(first.wrapper.findComponent(StartPanel).exists()).toBe(false);
    expect(first.wrapper.text()).not.toContain('leaked');
    cleanups.splice(0).forEach((cleanup) => cleanup());

    storage.set(draftKey, JSON.stringify({ ...savedDraft, daemonId: 'daemon-b' }));
    const second = await setup();
    expect(second.wrapper.findComponent(StartPanel).exists()).toBe(false);
  });

  it('continues a draft by restoring training values and re-resolving the dataset and model', async () => {
    storage.set(draftKey, JSON.stringify(savedDraft));
    const { wrapper, calls, formHidden, epochs, python } = await setup();
    await wrapper.get('[data-testid="continue-draft"]').trigger('click');
    await vi.waitFor(() =>
      expect(wrapper.get('[data-testid="selected-dataset"]').text()).toBe('train.npz'),
    );
    await flushPromises();
    expect(wrapper.findComponent(StartPanel).exists()).toBe(false);
    expect(formHidden()).toBe(false);
    const resolve = calls.filter((call) => call.path === '/api/browse/resolve');
    expect(resolve).toHaveLength(1);
    expect(parseJson(resolve[0]?.body ?? '')).toEqual({ root: 'data', path: 'train.npz' });
    expect(wrapper.get('[data-testid="guide-step-0"]').attributes('data-state')).toBe('complete');
    expect(wrapper.get('[data-testid="guide-step-1"]').text()).toContain('CNN');
    expect(activeBlock(wrapper)).toBe('training');
    expect(epochs()).toBe('17');
    expect(python()).toBe('/usr/bin/python3');
    const draft = wrapper.getComponent(ConfigMenu).props('draft');
    expect(draft.config.data_path).toBe('/data/train.npz');
    expect(draft.config.model).toBe('cnn');
    expect(draft.config.lr).toBe(0.003);
    expect(draft.runtime.device).toBe('cuda');
    expect(draft.runtime.environment).toEqual({});
    expect(draft.topology.num_machines).toBe(1);
    // Continuing resumes autosave of the restored draft.
    await wrapper.get('[id$="-training-epochs"]').setValue('18');
    await vi.waitFor(() => expect(projectDraftSchema.parse(stored()).config.epochs).toBe(18));
  });

  it('continues with Return from the start panel', async () => {
    storage.set(draftKey, JSON.stringify(savedDraft));
    const { wrapper, epochs } = await setup();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await vi.waitFor(() => expect(wrapper.findComponent(StartPanel).exists()).toBe(false));
    await flushPromises();
    expect(epochs()).toBe('17');
  });

  it('starts fresh by clearing the stored draft and every restored choice', async () => {
    storage.set(draftKey, JSON.stringify(savedDraft));
    const { wrapper, calls, formHidden, epochs, python } = await setup();
    await wrapper.get('[data-testid="start-fresh"]').trigger('click');
    await flushPromises();
    expect(storage.has(draftKey)).toBe(false);
    expect(wrapper.findComponent(StartPanel).exists()).toBe(false);
    expect(formHidden()).toBe(false);
    expect(activeBlock(wrapper)).toBe('dataset');
    expect(epochs()).not.toBe('17');
    expect(python()).toBe('');
    expect(wrapper.get('[data-testid="guide-step-0"]').text()).toContain('Not selected');
    expect(wrapper.get('[data-testid="guide-step-1"]').text()).toContain('Not selected');
    expect(calls.some((call) => call.path === '/api/browse/resolve')).toBe(false);
    // Defaults alone do not recreate the draft.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(storage.has(draftKey)).toBe(false);
  });

  it('clears the draft on acknowledgment, then starts another run with every value kept', async () => {
    const { wrapper, select, epochs, python } = await setup();
    await select();
    await wrapper.get('input[name="runtime.python"]').setValue('/usr/bin/python3');
    await wrapper.get('[id$="-training-epochs"]').setValue('17');
    await vi.waitFor(() => expect(stored()).toBeDefined());
    await builderForm(wrapper).trigger('submit');
    await vi.waitFor(() => expect(wrapper.find('#approved-plan-title').exists()).toBe(true));
    await button(wrapper, 'Approve and start this plan').trigger('click');
    const success = '[aria-label="Acknowledged training run"]';
    await vi.waitFor(() => expect(wrapper.find(success).exists()).toBe(true));
    expect(wrapper.get(success).text()).toContain('Daemon acknowledged the run');
    expect(wrapper.get(success).text()).toContain(ids.run_id);
    expect(storage.has(draftKey)).toBe(false);
    expect(wrapper.get('[data-testid="guide-step-4"]').text()).toContain('Submitted');
    // The acknowledged state itself is not saved back as a draft.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(storage.has(draftKey)).toBe(false);

    await button(wrapper, 'Start another run').trigger('click');
    await nextTick();
    expect(activeBlock(wrapper)).toBe('model');
    expect(wrapper.find(success).exists()).toBe(false);
    expect(wrapper.find('#approved-plan-title').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Daemon acknowledged this exact plan.');
    expect(wrapper.getComponent(RunPipeline).props('reviewLabel')).toBe('Create plan');
    expect(wrapper.get('[data-testid="guide-step-0"]').text()).toContain('train.npz');
    expect(wrapper.get('[data-testid="guide-step-1"]').text()).toContain('custom_model');
    expect(epochs()).toBe('17');
    expect(python()).toBe('/usr/bin/python3');
    expect(wrapper.text()).toContain('Ready to plan');
    expect(wrapper.emitted('submitted')).toHaveLength(1);
  });

  it('plans and approves an edited draft after an earlier run was acknowledged', async () => {
    const { wrapper, select } = await setup();
    await select();
    await wrapper.get('input[name="runtime.python"]').setValue('/usr/bin/python3');
    await builderForm(wrapper).trigger('submit');
    await vi.waitFor(() => expect(wrapper.find('#approved-plan-title').exists()).toBe(true));
    await button(wrapper, 'Approve and start this plan').trigger('click');
    await vi.waitFor(() =>
      expect(wrapper.find('[aria-label="Acknowledged training run"]').exists()).toBe(true),
    );

    await wrapper.get('[id$="-training-epochs"]').setValue('21');
    // The earlier run stays reachable while the edited draft is a new, unlocked plan.
    expect(wrapper.text()).toContain('Open acknowledged run');
    expect(wrapper.getComponent(RunPipeline).props('reviewLabel')).toBe('Create plan');
    await builderForm(wrapper).trigger('submit');
    await vi.waitFor(() => expect(wrapper.find('#approved-plan-title').exists()).toBe(true));
    const approve = button(wrapper, 'Approve and start this plan');
    expect(approve.attributes('disabled')).toBeUndefined();
    await approve.trigger('click');
    await vi.waitFor(() => expect(wrapper.emitted('submitted')).toHaveLength(2));
  });
});
