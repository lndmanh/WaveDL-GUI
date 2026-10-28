// @vitest-environment happy-dom
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mountWithI18n as mount } from './mountWithI18n';
import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { useForm } from 'vee-validate';
import { z } from 'zod';
import TrainingFields from '../../app/components/project/TrainingFields.vue';
import {
  trainingConfigSchema,
  trainingDefaults,
  trainingFieldMetadata,
  trainingRequestSchema,
  type TrainingConfig,
} from '../../shared/schemas/training-request';
import { trainingCommand, trainingYaml } from '../../app/lib/training-export';
import { ConnectionSession } from './session-fixture';
import { CatalogApi } from '../../app/lib/catalog-api';
import { ProjectPlan } from '../../app/lib/project-plan';
import type { Json } from '../../app/lib/daemon-api';
import { chooseSelectOption } from './select-interaction';

// An explicit inventory, not values generated from metadata: newly added fields
// must acquire a deliberate authoring case before this acceptance test passes.
const authored: TrainingConfig = {
  model: 'resnet18',
  import_modules: ['custom.models', 'custom.constraints'],
  pretrained: true,
  batch_size: 17,
  lr: 0.000123456789,
  epochs: 23,
  patience: 7,
  weight_decay: 0.00023456789,
  grad_clip: 2.75,
  grad_accum_steps: 3,
  loss: 'weighted_mse',
  huber_delta: 0.75,
  loss_weights: '1.25,2.5',
  optimizer: 'sgd',
  momentum: 0.85,
  nesterov: true,
  betas: '0.8,0.98',
  scheduler: 'multistep',
  scheduler_patience: 6,
  min_lr: 0.000000123456789,
  scheduler_factor: 0.75,
  warmup_epochs: 2,
  step_size: 8,
  milestones: '4,8,16',
  data_path: "/data/authored's dataset.npz",
  workers: 2,
  seed: 1234,
  deterministic: true,
  cache_validate: 'size',
  single_channel: true,
  // This regular-training fixture exercises every unsupported-in-CV control.
  // Nondefault CV authoring is covered separately by cv-compatibility.test.ts.
  cv: 0,
  cv_stratify: true,
  cv_bins: 7,
  resume: "/checkpoints/authored's resume.pth",
  save_every: 4,
  fresh: true,
  compile: true,
  precision: 'no',
  constraint: ['custom.constraints.balance', 'custom.constraints.boundary'],
  constraint_file: '/constraints/physical constraints.py',
  constraint_weight: [0.125, 0.875],
  constraint_reduction: 'mae',
  wandb: true,
  wandb_watch: true,
  project_name: 'authored experiment',
  run_name: "run 'one'; $(never executed)",
};

function editor() {
  const form: { current?: ReturnType<typeof useForm<{ config: TrainingConfig }>> } = {};
  const host = defineComponent({
    setup() {
      form.current = useForm<{ config: TrainingConfig }>({
        initialValues: { config: structuredClone(trainingDefaults) },
        validationSchema: z.object({ config: trainingConfigSchema }),
      });
      return () => h(TrainingFields, { disabled: false });
    },
  });
  const wrapper = mount(host);
  if (!form.current) throw new Error('Form did not mount');
  return { wrapper, form: form.current };
}

async function authorEveryControl() {
  const { wrapper, form } = editor();
  await flushPromises();
  expect(trainingFieldMetadata).toHaveLength(44);
  expect(Object.keys(authored).sort()).toEqual(Object.keys(trainingDefaults).sort());
  for (const option of trainingFieldMetadata) {
    const value = Object.entries(authored).find(([name]) => name === option.name)?.[1];
    if (option.name === 'cv') expect(value).toBe(0);
    else
      expect(value, `${option.name} must have an authored nondefault`).not.toEqual(option.default);
    const control = wrapper.get(`[id$="-training-${option.name}"]`);
    if (option.kind === 'boolean') {
      await control.trigger('click');
      expect(control.attributes('aria-checked')).toBe('true');
    } else if (option.choices.length) {
      await chooseSelectOption(control, String(value));
    } else {
      await control.setValue(Array.isArray(value) ? value.join('\n') : String(value));
    }
    await flushPromises();
    expect(Object.entries(form.values.config).find(([name]) => name === option.name)?.[1]).toEqual(
      value,
    );
  }
  // These two fields are catalogue-owned rather than TrainingFields controls;
  // the plan case below obtains actual branded selections before preparing.
  const config = trainingConfigSchema.parse({
    ...form.values.config,
    model: authored.model,
    data_path: authored.data_path,
  });
  expect(config).toEqual(authored);
  expect((await form.validate()).valid).toBe(true);
  wrapper.unmount();
  return config;
}

const requestFor = (config: TrainingConfig) =>
  trainingRequestSchema.parse({
    backend: 'local',
    operation: 'train',
    config,
    runtime: {
      python: '/opt/authored python/bin/python',
      mode: 'selected',
      device: 'cpu',
      environment: {},
    },
    topology: { num_machines: 1, processes_per_machine: 2, machine_rank: 0 },
  });

describe('exhaustive training field authoring acceptance', () => {
  it('authors every one of the 44 editable controls through its DOM contract without losing precision', async () => {
    await authorEveryControl();
  });

  it('sends all 46 authored config destinations and the runtime/topology unchanged to the plan transport', async () => {
    const request = requestFor(await authorEveryControl());
    const bodies: Json[] = [];
    const response = (value: object) =>
      new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
    const session = new ConnectionSession({
      origin: window.location.origin,
      buildId: '1.8.1',
      fetcher: async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path === '/api/health')
          return response({
            daemon_id: 'authoring-daemon',
            build_id: '1.8.1',
            protocol_min: 1,
            protocol_max: 1,
          });
        if (path === '/api/browse/resolve')
          return response({
            root: 'data',
            relative_path: 'authored.npz',
            path: authored.data_path,
            kind: 'file',
          });
        if (path === '/api/models')
          return response({
            source: 'bundled_metadata',
            runtime_verified: false,
            categories: { cnn: { short_description: 'CNN', models: ['resnet18'] } },
            models: [
              {
                id: 'resnet18',
                display_name: 'ResNet18',
                architecture_family: 'CNN',
                author_institution: 'Example',
                year_published: 2015,
                params_m: 11.7,
                size_mb: 45,
                short_description: 'Residual convolutional baseline',
                description: 'Network',
                best_for: 'Waves',
                pros: ['Stable'],
                cons: ['Larger model'],
                compute_tier: 'Medium',
                tags: ['residual'],
                supported_dims: [2],
                is_pretrained: false,
              },
            ],
          });
        if (path === '/api/runs/plan') {
          bodies.push(JSON.parse(String(init?.body)));
          return response({
            plan_id: '11111111-1111-4111-8111-111111111111',
            run_id: '22222222-2222-4222-8222-222222222222',
            request_id: '33333333-3333-4333-8333-333333333333',
            preview: { manifest: { resolved_config: authored }, warnings: [] },
          });
        }
        throw new Error(`Unexpected route ${path}`);
      },
    });
    expect(await session.connect('memory-only-credential')).toBe(true);
    const catalogue = new CatalogApi(session);
    const data = await catalogue.resolve('data', 'authored.npz');
    const models = await catalogue.models();
    const model = models[0];
    if (!model) throw new Error('Missing authored model');
    const flow = new ProjectPlan(session);
    flow.prepare(request, data, catalogue.selectModel(model, models));
    await flow.preview();
    expect(bodies).toEqual([request]);
    session.detach();
  });

  it.each([
    ['batch_size', '1.5'],
    ['batch_size', '0'],
    ['lr', '0'],
    ['lr', ''],
    ['workers', '-2'],
    ['constraint_weight', '0.2\nnot-a-number'],
    ['constraint_weight', '0.2\n\n0.4'],
    ['import_modules', 'custom.models\n\nother.models'],
    ['constraint_weight', '0.2\n  \n0.4'],
    ['constraint_weight', '\n0.2'],
    ['constraint_weight', '0.2\n'],
    ['constraint', 'custom.balance\n'],
    ['betas', '0.9,1'],
    ['betas', '0.8'],
    ['loss_weights', '1,Infinity'],
    ['milestones', '2,3.5'],
    ['cv_bins', '0'],
    ['grad_accum_steps', '0'],
  ])(
    'blocks malformed/range input authored into %s (%s) with a visible field error',
    async (name, value) => {
      const { wrapper, form } = editor();
      await flushPromises();
      await wrapper.get(`[id$="-training-${name}"]`).setValue(value);
      await flushPromises();
      const validation = await form.validate();
      expect(validation.valid).toBe(false);
      await flushPromises();
      await vi.waitFor(async () => {
        await form.validate();
        expect(Object.keys(form.errors.value), JSON.stringify(validation)).not.toEqual([]);
      });
      await expect
        .poll(() => wrapper.get(`[id$="-training-${name}"]`).attributes('aria-invalid'))
        .toBe('true');
      expect(Object.keys(form.errors.value).some((key) => key.startsWith(`config.${name}`))).toBe(
        true,
      );
      const valid = Object.entries(authored).find(([key]) => key === name)?.[1];
      await wrapper
        .get(`[id$="-training-${name}"]`)
        .setValue(Array.isArray(valid) ? valid.join('\n') : String(valid));
      await vi.waitFor(async () => expect((await form.validate()).valid).toBe(true));
      await expect
        .poll(() => wrapper.get(`[id$="-training-${name}"]`).attributes('aria-invalid'))
        .toBe('false');
      wrapper.unmount();
    },
  );

  it('does not show untouched errors and roundtrips optional list/text clearing', async () => {
    const { wrapper, form } = editor();
    await flushPromises();
    for (const option of trainingFieldMetadata)
      expect(wrapper.get(`[id$="-training-${option.name}"]`).attributes('aria-invalid')).toBe(
        'false',
      );
    for (const name of [
      'import_modules',
      'constraint',
      'loss_weights',
      'resume',
      'constraint_file',
      'run_name',
    ]) {
      const value = Object.entries(authored).find(([key]) => key === name)?.[1];
      const control = wrapper.get(`[id$="-training-${name}"]`);
      await control.setValue(Array.isArray(value) ? value.join('\n') : String(value));
      await control.setValue('');
      expect(Object.entries(form.values.config).find(([key]) => key === name)?.[1]).toEqual(
        ['import_modules', 'constraint'].includes(name) ? [] : null,
      );
    }
    expect((await form.validate()).valid).toBe(true);
    wrapper.unmount();
  });

  it('keeps a single precision destination, rejects conflicting aliases and daemon-owned fields', () => {
    for (const patch of [
      { mixed_precision: 'fp16' },
      { precision: 'fp32' },
      { output_dir: '/unsafe' },
      { config: 'host.yaml' },
    ])
      expect(trainingConfigSchema.safeParse({ ...authored, ...patch }).success).toBe(false);
    for (const precision of ['bf16', 'fp16', 'no']) {
      const request = requestFor(trainingConfigSchema.parse({ ...authored, precision }));
      expect(trainingCommand(request)).toContain(`'--mixed_precision' '${precision}'`);
      expect(trainingCommand(request)).toContain(`'--precision=${precision}'`);
    }
  });

  // Opt-in because the node-only web job deliberately has no Python stack.
  // The combined acceptance job supplies its real, clean installed interpreter.
  it.runIf(Boolean(process.env.WAVEDL_TRAINING_EXPORT_PYTHON))(
    'roundtrips the DOM-authored YAML and shell export through real Python parsers and bootstrap manifests',
    async () => {
      const request = requestFor(await authorEveryControl());
      const interpreter = process.env.WAVEDL_TRAINING_EXPORT_PYTHON;
      if (!interpreter) throw new Error('Missing integration interpreter');
      const script = resolve(process.cwd(), '../tools/verify_training_exports.py');
      const result = JSON.parse(
        execFileSync(interpreter, [script], {
          input: JSON.stringify({
            request,
            yaml: trainingYaml(request),
            command: trainingCommand(request),
          }),
          encoding: 'utf8',
          timeout: 30000,
        }),
      );
      expect(result).toEqual({
        fields: 46,
        yaml: authored,
        command: authored,
        runtime: authored,
        yaml_runtime: authored,
        precision_conflict_rejected: true,
        processes: 2,
        cpu: true,
      });
    },
  );
});
