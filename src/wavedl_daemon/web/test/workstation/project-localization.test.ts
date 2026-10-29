// @vitest-environment happy-dom
import { createTestI18n, mountWithI18n as mount } from './mountWithI18n';
import { flushPromises } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useForm } from 'vee-validate';
import { z } from 'zod';
import options from '../../shared/training-options.json';
import {
  trainingDefaults,
  trainingConfigSchema,
  trainingRequestSchema,
} from '../../shared/schemas/training-request';
import TrainingInspector from '../../app/components/project/TrainingInspector.vue';
import ProjectContainer from '../../app/components/project/ProjectContainer.vue';
import ConfigMenu from '../../app/components/project/ConfigMenu.vue';
import PlanInspector from '../../app/components/project/PlanInspector.vue';
import TrainingDefaultsSettings from '../../app/components/settings/TrainingDefaultsSettings.vue';
import { trainingFieldMessageKeys } from '../../app/i18n/dynamic-keys';
import enTrainingFields from '../../app/i18n/locales/en/training-fields.json';
import viTrainingFields from '../../app/i18n/locales/vi/training-fields.json';
import { ConnectionSession } from './session-fixture';
import { CatalogApi } from '../../app/lib/catalog-api';
import { ProjectPlan } from '../../app/lib/project-plan';
import { trainingCommand, trainingYaml } from '../../app/lib/training-export';
import {
  essentialTrainingFields,
  trainingFieldVisible,
  trainingSections,
} from '../../app/lib/training-layout';
import {
  builderStubs,
  button,
  builderForm,
  chooseSelections,
  installMemoryStorage,
  modelCatalogue,
} from './project-builder-fixture';

beforeEach(() => {
  installMemoryStorage();
});
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const englishTrainingFields = enTrainingFields as Record<
  string,
  { label: string; description: string }
>;
const vietnameseTrainingFields = viTrainingFields as Record<
  string,
  { label: string; description: string }
>;

const expectedHumanLabels: Record<string, string> = {
  model: 'Model architecture',
  import_modules: 'Registration modules',
  pretrained: 'Pretrained weights',
  batch_size: 'Batch size',
  lr: 'Learning rate',
  epochs: 'Epochs',
  patience: 'Early stopping patience',
  weight_decay: 'Weight decay',
  grad_clip: 'Gradient clipping',
  grad_accum_steps: 'Gradient accumulation steps',
  loss: 'Loss function',
  huber_delta: 'Huber delta',
  loss_weights: 'Loss weights',
  optimizer: 'Optimizer',
  momentum: 'Momentum',
  nesterov: 'Nesterov momentum',
  betas: 'Beta coefficients',
  scheduler: 'Learning rate schedule',
  scheduler_patience: 'Learning rate patience',
  min_lr: 'Minimum learning rate',
  scheduler_factor: 'Learning rate reduction factor',
  warmup_epochs: 'Warmup epochs',
  step_size: 'Scheduler step interval',
  milestones: 'Scheduler milestones',
  data_path: 'Training dataset',
  workers: 'Data loader workers',
  seed: 'Random seed',
  deterministic: 'Deterministic training',
  cache_validate: 'Cache validation',
  single_channel: 'Single-channel data',
  cv: 'Cross-validation folds',
  cv_stratify: 'Stratified cross-validation',
  cv_bins: 'Stratification bins',
  resume: 'Resume checkpoint',
  save_every: 'Checkpoint interval',
  fresh: 'Fresh training',
  compile: 'Compile model',
  precision: 'Mixed precision',
  constraint: 'Constraint expressions',
  constraint_file: 'Constraint file',
  constraint_weight: 'Constraint weights',
  constraint_reduction: 'Constraint reduction',
  wandb: 'W&B logging',
  wandb_watch: 'W&B gradient tracking',
  project_name: 'W&B project name',
  run_name: 'W&B run name',
};

describe('project presentation localization', () => {
  it('keeps coexisting hidden project and settings control IDs unique and control names reactive', async () => {
    const i18n = createTestI18n('en');
    const owner = new ConnectionSession({
      origin: window.location.origin,
      buildId: '1.8.1',
      fetcher: async () => {
        throw new Error('Disconnected');
      },
    });
    const host = defineComponent({
      setup: () => () =>
        h('main', [
          h('div', { style: { display: 'none' } }, [h(ProjectContainer, { session: owner })]),
          h(TrainingDefaultsSettings, { daemonId: 'daemon-one' }),
        ]),
    });
    const wrapper = mount(host, { attachTo: document.body }, i18n);
    await flushPromises();
    const controls = wrapper.findAll('[id*="-training-"]');
    const ids = controls.map((control) => control.attributes('id'));
    expect(new Set(ids).size).toBe(ids.length);
    // The builder's switch and the settings checkbox for the same option coexist.
    expect(wrapper.findAll('[id$="-training-deterministic"]')).toHaveLength(2);
    expect(wrapper.findAll('[role="switch"][id*="-training-"]').length).toBeGreaterThan(0);
    const accessibleNames = () => {
      const switches = wrapper.findAll('[role="switch"][id*="-training-"]').map((control) => {
        const label = wrapper.get(`label[for="${control.attributes('id')}"]`).text();
        expect(label).not.toBe('');
        return label;
      });
      const checkboxes = wrapper.findAll('[role="checkbox"][id*="-training-"]').map((control) => {
        const label = wrapper.get(`label[for="${control.attributes('id')}"]`).text();
        expect(control.attributes('aria-label')).toBe(label);
        expect(label).not.toBe('');
        return label;
      });
      return { switches, checkboxes };
    };
    const english = accessibleNames();
    i18n.global.locale.value = 'vi';
    await nextTick();
    expect(controls.map((control) => control.attributes('id'))).toEqual(ids);
    const vietnamese = accessibleNames();
    expect(vietnamese.switches).not.toEqual(english.switches);
    const deterministic = (locale: string) => {
      const control = wrapper.get('[role="switch"][id$="-training-deterministic"]');
      expect(wrapper.get(`label[for="${control.attributes('id')}"]`).text()).toBe(locale);
      for (const checkbox of wrapper.findAll('[role="checkbox"][id$="-training-deterministic"]'))
        expect(checkbox.attributes('aria-label')).toBe(locale);
    };
    deterministic('Chế độ xác định');
    i18n.global.locale.value = 'en';
    await nextTick();
    deterministic('Deterministic training');
    wrapper.unmount();
    owner.detach();
  });

  it('has explicit Vietnamese labels and descriptions for all 46 CLI destinations, including selection-owned fields', () => {
    expect(options).toHaveLength(46);
    expect(Object.keys(trainingFieldMessageKeys).sort()).toEqual(
      options.map((option) => option.name).sort(),
    );
    for (const [name, keys] of Object.entries(trainingFieldMessageKeys)) {
      const option = options.find((option) => option.name === name);
      expect(option).toBeDefined();
      expect(keys).toEqual({
        label: `training.${name}.label`,
        description: `training.${name}.description`,
      });
      expect(englishTrainingFields[name]?.label).toBe(expectedHumanLabels[name]);
      expect(englishTrainingFields[name]?.description).toBe(
        option?.description.replace(/\.?\s*Available:\s*\(\)/, '').trim(),
      );
      expect(vietnameseTrainingFields[name]?.label).not.toBe(englishTrainingFields[name]?.label);
      expect(vietnameseTrainingFields[name]?.description).not.toBe(
        englishTrainingFields[name]?.description,
      );
    }
  });

  it('reactively translates all editable controls while retaining draft values and CLI option values', async () => {
    const i18n = createTestI18n('en');
    let snapshot = () => '';
    const host = defineComponent({
      setup() {
        const { values } = useForm({
          initialValues: { config: structuredClone(trainingDefaults) },
          validationSchema: z.object({ config: trainingConfigSchema }),
        });
        snapshot = () => JSON.stringify(values);
        return () => h(TrainingInspector, { disabled: false });
      },
    });
    const wrapper = mount(host, undefined, i18n);
    await flushPromises();
    await wrapper.get('[id$="-training-batch_size"]').setValue('37');
    const draft = snapshot();
    const choiceValues = () =>
      wrapper
        .findAll('[data-field] [data-value], [data-field] option')
        .map((choice) => choice.attributes('data-value') ?? choice.attributes('value'));
    const values = choiceValues();
    expect(values.length).toBeGreaterThan(0);
    // Every setting relevant to the defaults is rendered; selection-owned fields are not.
    const expected = [
      ...essentialTrainingFields,
      ...trainingSections.flatMap((section) => section.fields),
    ].filter((name) => trainingFieldVisible(name, trainingDefaults));
    const rendered = wrapper.findAll('[data-field]').map((row) => row.attributes('data-field'));
    expect(rendered.sort()).toEqual([...expected].sort());
    for (const name of ['data_path', 'model', 'pretrained'])
      expect(wrapper.find(`[data-field="${name}"]`).exists()).toBe(false);
    i18n.global.locale.value = 'vi';
    await nextTick();
    for (const name of expected) {
      const keys = trainingFieldMessageKeys[name];
      if (!keys) throw new Error(`Missing field ${name}`);
      const control = wrapper.get(`[data-field="${name}"] [id$="-training-${name}"]`);
      expect(wrapper.get(`label[for="${control.attributes('id')}"]`).text()).toBe(
        vietnameseTrainingFields[name]?.label,
      );
      const description = wrapper.find(`[id$="-training-${name}-description"]`);
      if (description.exists())
        expect(description.text()).toContain(vietnameseTrainingFields[name]?.description);
    }
    expect(wrapper.get('[data-testid="training-tab-essentials"]').text()).not.toContain('Epochs');
    expect(snapshot()).toBe(draft);
    expect(choiceValues()).toEqual(values);
    i18n.global.locale.value = 'en';
    await nextTick();
    const batch = wrapper.get('[id$="-training-batch_size"]');
    expect(wrapper.get(`label[for="${batch.attributes('id')}"]`).text()).toBe('Batch size');
    expect(wrapper.get<HTMLInputElement>('[id$="-training-batch_size"]').element.value).toBe('37');
    expect(snapshot()).toBe(draft);
    wrapper.unmount();
  });

  it('keeps a persisted approval and exact submission body across a live locale switch', async () => {
    const i18n = createTestI18n('en');
    const ids = {
      plan_id: '11111111-1111-4111-8111-111111111111',
      run_id: '22222222-2222-4222-8222-222222222222',
      request_id: '33333333-3333-4333-8333-333333333333',
    };
    const calls: { path: string; body: string }[] = [];
    const manifest = JSON.stringify({
      config: { model: 'custom_model', data_path: '/data/English name.npz' },
      warning: 'Do not translate daemon evidence',
    });
    const owner = new ConnectionSession({
      origin: window.location.origin,
      buildId: '1.8.1',
      fetcher: async (input, init) => {
        const path = new URL(String(input)).pathname;
        calls.push({ path, body: String(init?.body ?? '') });
        const response = (value: object) =>
          new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
        if (path === '/api/health')
          return response({
            daemon_id: 'daemon-one',
            build_id: '1.8.1',
            protocol_min: 1,
            protocol_max: 1,
          });
        if (path === '/api/models') return response(modelCatalogue);
        if (path === '/api/browse/resolve')
          return response({
            root: 'data',
            relative_path: 'English name.npz',
            path: '/data/English name.npz',
            kind: 'file',
          });
        if (path === '/api/runs/plan')
          return response({ ...ids, preview: { manifest_json: manifest } });
        if (path === '/api/runs')
          return response({
            ...ids,
            backend: 'local',
            operation: 'train',
            state: 'submitted',
            attempt: null,
            uncertainty: false,
            submission_requested: true,
            cancellation_requested: false,
            evidence: null,
          });
        throw new Error(`Unexpected route ${path}`);
      },
    });
    await owner.connect('credential');
    const catalogue = new CatalogApi(owner);
    const data = await catalogue.resolve('data', 'English name.npz');
    const model = await catalogue.selectCustomModel('custom_model');
    const invalidate = vi.spyOn(ProjectPlan.prototype, 'invalidate');
    const host = defineComponent({
      setup: () => () => h(ProjectContainer, { session: owner }),
    });
    const wrapper = mount(host, { global: { stubs: builderStubs } }, i18n);
    await flushPromises();
    await chooseSelections(wrapper, data, model);
    await wrapper.get('input[name="runtime.python"]').setValue('/usr/bin/python3');
    await builderForm(wrapper).trigger('submit');
    await vi.waitFor(() => expect(wrapper.getComponent(PlanInspector).props('plan')).not.toBeNull());
    const preview = wrapper.getComponent(PlanInspector).props('plan');
    const draft = wrapper.getComponent(ConfigMenu).props('draft');
    const yaml = trainingYaml(draft);
    const command = trainingCommand(draft);
    const invalidations = invalidate.mock.calls.length;
    const requests = calls.length;
    i18n.global.locale.value = 'vi';
    await nextTick();
    expect(invalidate.mock.calls.length).toBe(invalidations);
    expect(calls).toHaveLength(requests);
    expect(wrapper.getComponent(PlanInspector).props('plan')).toBe(preview);
    // Daemon-reported names are shown as reported, never translated.
    expect(wrapper.get('[data-testid="selected-dataset"]').text()).toBe('English name.npz');
    expect(wrapper.get('[data-testid="selected-dataset"]').text()).not.toContain('daemon-one');
    expect(wrapper.text()).toContain('data / English name.npz');
    expect(wrapper.get('[data-testid="guide-step-0"]').attributes('title')).toBe(
      'English name.npz · data',
    );
    await wrapper.get('[data-testid="plan-raw-disclosure"]').trigger('click');
    expect(wrapper.get('[data-testid="approved-manifest"]').text()).toContain(
      '/data/English name.npz',
    );
    expect(wrapper.get('[data-testid="approved-manifest"]').attributes('aria-label')).toBe(
      i18n.global.t('project.approvedNormalizedManifest'),
    );
    expect(wrapper.text()).toContain('Do not translate daemon evidence');
    expect(wrapper.get('#approved-plan-title').text()).toBe('Kế hoạch đã lưu để phê duyệt');
    expect(trainingYaml(wrapper.getComponent(ConfigMenu).props('draft'))).toBe(yaml);
    expect(trainingCommand(wrapper.getComponent(ConfigMenu).props('draft'))).toBe(command);
    await wrapper.getComponent(PlanInspector).get('button.plan-approve').trigger('click');
    await vi.waitFor(() =>
      expect(calls.filter((call) => call.path === '/api/runs')).toHaveLength(1),
    );
    expect(calls.find((call) => call.path === '/api/runs')?.body).toBe(
      JSON.stringify({ plan_id: ids.plan_id }),
    );
    await flushPromises();
    expect(wrapper.text()).toContain(`${ids.run_id} · Đã gửi`);
    wrapper.unmount();
    owner.detach();
    invalidate.mockRestore();
  });

  it('reports a stored exporter rejection without changing the draft or exposing credentials', async () => {
    await exportRejection();
  });

  // Known bug: ProjectContainer.announce stores the translated title, so a notice already on
  // screen keeps its original language. Remove `.fails` once notices translate live.
  it('translates a stored exporter rejection live', async () => {
    const { wrapper, i18n, original } = await exportRejection();
    i18n.global.locale.value = 'vi';
    await nextTick();
    expect(wrapper.get('.run-notice[role="status"]').text()).toContain('Chọn rõ CPU hoặc CUDA');
    expect(JSON.stringify(wrapper.getComponent(ConfigMenu).props('draft'))).toBe(original);
  });
});

async function exportRejection() {
  const i18n = createTestI18n('en');
  const owner = new ConnectionSession({
    origin: window.location.origin,
    buildId: '1.8.1',
    fetcher: async (input) => {
      const path = new URL(String(input)).pathname;
      const response = (value: object) =>
        new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
      if (path === '/api/health')
        return response({
          daemon_id: 'daemon-one',
          build_id: '1.8.1',
          protocol_min: 1,
          protocol_max: 1,
        });
      if (path === '/api/models') return response(modelCatalogue);
      throw new Error(`Unexpected route ${path}`);
    },
  });
  await owner.connect('credential');
  const wrapper = mount(
    ProjectContainer,
    { props: { session: owner }, attachTo: document.body, global: { stubs: builderStubs } },
    i18n,
  );
  cleanups.push(() => {
    wrapper.unmount();
    owner.detach();
  });
  await flushPromises();
  await wrapper.get('input[name="runtime.python"]').setValue('/usr/bin/python3');
  await wrapper.get('[data-testid="device-auto"]').trigger('click');
  await wrapper.get('#new-env-name').setValue('API_TOKEN');
  await button(wrapper, 'Add variable').trigger('click');
  await wrapper.get('#env-API_TOKEN').setValue('super-secret-value');
  const draft = trainingRequestSchema.parse(wrapper.getComponent(ConfigMenu).props('draft'));
  expect(draft.runtime.device).toBe('auto');
  const original = JSON.stringify(wrapper.getComponent(ConfigMenu).props('draft'));
  await wrapper.get('[data-testid="config-menu"]').trigger('keydown', { key: 'Enter' });
  await flushPromises();
  const copy = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (item) => item.textContent?.includes('Copy standalone CLI command'),
  );
  if (!copy) throw new Error('Missing copy command item');
  copy.click();
  await vi.waitFor(() =>
    expect(wrapper.get('.run-notice[role="status"]').text()).toContain(
      'Choose explicit CPU or CUDA for a reproducible standalone command.',
    ),
  );
  expect(wrapper.get('.run-notice').attributes('data-tone')).toBe('warning');
  expect(wrapper.text()).not.toContain('super-secret-value');
  expect(JSON.stringify(wrapper.getComponent(ConfigMenu).props('draft'))).toBe(original);
  return { wrapper, i18n, original };
}
