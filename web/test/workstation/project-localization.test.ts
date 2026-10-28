// @vitest-environment happy-dom
import { createTestI18n, mountWithI18n as mount } from './mountWithI18n';
import { flushPromises } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { useForm } from 'vee-validate';
import { z } from 'zod';
import options from '../../shared/training-options.json';
import {
  trainingDefaults,
  trainingConfigSchema,
  trainingFieldMetadata,
  trainingRequestSchema,
} from '../../shared/schemas/training-request';
import TrainingFields from '../../app/components/project/TrainingFields.vue';
import ProjectContainer from '../../app/components/project/ProjectContainer.vue';
import DatasetPathPicker from '../../app/components/datasets/DatasetPathPicker.vue';
import CustomModelSelector from '../../app/components/project/CustomModelSelector.vue';
import PlanApproval from '../../app/components/project/PlanApproval.vue';
import TrainingExport from '../../app/components/project/TrainingExport.vue';
import TrainingDefaultsSettings from '../../app/components/settings/TrainingDefaultsSettings.vue';
import { trainingFieldMessageKeys } from '../../app/i18n/dynamic-keys';
import enTrainingFields from '../../app/i18n/locales/en/training-fields.json';
import viTrainingFields from '../../app/i18n/locales/vi/training-fields.json';
import { ConnectionSession } from './session-fixture';
import { CatalogApi } from '../../app/lib/catalog-api';
import { ProjectPlan } from '../../app/lib/project-plan';
import { trainingCommand, trainingYaml } from '../../app/lib/training-export';

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
  it('keeps coexisting hidden project and settings control IDs unique and checkbox names reactive', async () => {
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
    expect(wrapper.findAll('[id$="-training-deterministic"]')).toHaveLength(2);
    for (const checkbox of wrapper.findAll('[role="checkbox"][id*="-training-"]')) {
      const id = checkbox.attributes('id');
      const label = wrapper.get(`label[for="${id}"]`);
      expect(checkbox.attributes('aria-label')).toBe(label.text());
      expect(label.text()).not.toBe('');
    }
    i18n.global.locale.value = 'vi';
    await nextTick();
    expect(controls.map((control) => control.attributes('id'))).toEqual(ids);
    for (const checkbox of wrapper.findAll('[role="checkbox"][id*="-training-"]')) {
      const id = checkbox.attributes('id');
      const label = wrapper.get(`label[for="${id}"]`);
      expect(checkbox.attributes('aria-label')).toBe(label.text());
      expect(label.text()).not.toBe('');
    }
    for (const checkbox of wrapper.findAll('[role="checkbox"][id$="-training-deterministic"]'))
      expect(checkbox.attributes('aria-label')).toBe('Chế độ xác định');
    i18n.global.locale.value = 'en';
    await nextTick();
    for (const checkbox of wrapper.findAll('[role="checkbox"][id$="-training-deterministic"]'))
      expect(checkbox.attributes('aria-label')).toBe('Deterministic training');
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
        return () => h(TrainingFields, { disabled: false });
      },
    });
    const wrapper = mount(host, undefined, i18n);
    await flushPromises();
    await wrapper.get('[id$="-training-batch_size"]').setValue('37');
    const draft = snapshot();
    const values = wrapper.findAll('option').map((option) => option.attributes('value'));
    i18n.global.locale.value = 'vi';
    await nextTick();
    for (const option of trainingFieldMetadata) {
      const keys = trainingFieldMessageKeys[option.name];
      if (!keys) throw new Error(`Missing field ${option.name}`);
      expect(wrapper.get(`label[for$="-training-${option.name}"]`).text()).toBe(
        vietnameseTrainingFields[option.name]?.label,
      );
      expect(wrapper.text()).toContain(vietnameseTrainingFields[option.name]?.description);
    }
    expect(snapshot()).toBe(draft);
    expect(wrapper.findAll('option').map((option) => option.attributes('value'))).toEqual(values);
    expect(wrapper.text()).toContain('không bao giờ xóa dữ liệu lần chạy trước');
    i18n.global.locale.value = 'en';
    await nextTick();
    expect(wrapper.get('label[for$="-training-batch_size"]').text()).toBe('Batch size');
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
    const wrapper = mount(
      host,
      {
        global: { stubs: { DatasetPathPicker: true, ModelSelector: true, DatasetInfoPanel: true } },
      },
      i18n,
    );
    wrapper.getComponent(DatasetPathPicker).vm.$emit('select', data);
    wrapper.getComponent(CustomModelSelector).vm.$emit('select', model);
    await nextTick();
    await wrapper.get('input[name="runtime.python"]').setValue('/usr/bin/python3');
    const form = wrapper
      .findAll('form')
      .find((form) => form.find('input[name="runtime.python"]').exists());
    if (!form) throw new Error('Missing editor form');
    await form.trigger('submit');
    await vi.waitFor(() => expect(wrapper.findComponent(PlanApproval).exists()).toBe(true));
    const preview = wrapper.getComponent(PlanApproval).props('plan');
    const draft = wrapper.getComponent(TrainingExport).props('draft');
    const yaml = trainingYaml(draft);
    const command = trainingCommand(draft);
    const invalidations = invalidate.mock.calls.length;
    const requests = calls.length;
    i18n.global.locale.value = 'vi';
    await nextTick();
    expect(invalidate.mock.calls.length).toBe(invalidations);
    expect(calls).toHaveLength(requests);
    expect(wrapper.getComponent(PlanApproval).props('plan')).toBe(preview);
    expect(wrapper.text()).toContain('/data/English name.npz');
    expect(wrapper.get('[data-testid="selected-dataset"]').text()).toBe('English name.npz');
    expect(wrapper.get('[data-testid="selected-dataset"]').text()).not.toContain('daemon-one');
    expect(
      wrapper
        .findAll('button[aria-label]')
        .some(
          (button) =>
            button.attributes('aria-label')?.includes('/data/English name.npz') &&
            button.attributes('aria-label')?.includes('daemon-one'),
        ),
    ).toBe(true);
    await wrapper.get('[data-testid="plan-raw-disclosure"]').trigger('click');
    expect(wrapper.text()).toContain('Do not translate daemon evidence');
    expect(wrapper.text()).toContain('Kế hoạch đã lưu để phê duyệt');
    expect(trainingYaml(wrapper.getComponent(TrainingExport).props('draft'))).toBe(yaml);
    expect(trainingCommand(wrapper.getComponent(TrainingExport).props('draft'))).toBe(command);
    await wrapper.getComponent(PlanApproval).get('button[data-slot="button"]').trigger('click');
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

  it('translates a stored exporter rejection live without changing the draft or exposing credentials', async () => {
    const i18n = createTestI18n('en');
    const draft = trainingRequestSchema.parse({
      backend: 'local',
      operation: 'train',
      config: structuredClone(trainingDefaults),
      runtime: { python: '/usr/bin/python3', mode: 'existing', device: 'auto', environment: {} },
      topology: { num_machines: 1, processes_per_machine: 1, machine_rank: 0 },
    });
    const original = JSON.stringify(draft);
    const host = defineComponent({
      setup: () => () => h(TrainingExport, { draft, disabled: false }),
    });
    const wrapper = mount(host, undefined, i18n);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Copy standalone CLI command')
      ?.trigger('click');
    expect(wrapper.get('[role="status"]').text()).toBe(
      'Choose explicit CPU or CUDA for a reproducible standalone command.',
    );
    i18n.global.locale.value = 'vi';
    await nextTick();
    expect(wrapper.get('[role="status"]').text()).toContain('Chọn rõ CPU hoặc CUDA');
    expect(JSON.stringify(draft)).toBe(original);
    wrapper.unmount();
  });
});
