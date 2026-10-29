// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import {
  trainingConfigSchema,
  trainingDefaults,
  trainingRequestSchema,
  type TrainingConfig,
  type TrainingRequest,
} from '../../shared/schemas/training-request';
import { ConnectionSession } from './session-fixture';
import { CatalogApi } from '../../app/lib/catalog-api';
import { ProjectPlan } from '../../app/lib/project-plan';
import {
  applyTrainingPreferences,
  defaultTrainingPreferences,
  loadTrainingPreferences,
  saveTrainingPreferences,
} from '../../app/lib/preferences';
import { trainingFieldVisible } from '../../app/lib/training-layout';
import {
  markedInvalid,
  revealTrainingControl,
  trainingFieldName,
  setTrainingControl,
  trainingControl,
  trainingEditor as editor,
} from './training-editor';

const unsupported: { name: keyof TrainingConfig; value: string | number | boolean }[] = [
  { name: 'resume', value: '/private/checkpoint.pth' },
  { name: 'save_every', value: 0 },
  { name: 'fresh', value: true },
  { name: 'compile', value: true },
  { name: 'wandb', value: true },
  { name: 'wandb_watch', value: true },
  { name: 'project_name', value: 'private-project' },
  { name: 'run_name', value: 'private-run' },
];

const dependentCases: {
  name: keyof TrainingConfig;
  patch: Partial<TrainingConfig>;
  correction: string | number;
}[] = [
  { name: 'optimizer', patch: { nesterov: true, optimizer: 'adam' }, correction: 'sgd' },
  { name: 'momentum', patch: { nesterov: true, optimizer: 'sgd', momentum: 0 }, correction: 0.9 },
  {
    name: 'scheduler_factor',
    patch: { scheduler: 'plateau', scheduler_factor: -0.1 },
    correction: 0.5,
  },
  {
    name: 'scheduler_factor',
    patch: { scheduler: 'plateau', scheduler_factor: 1 },
    correction: 0.5,
  },
  {
    name: 'scheduler_factor',
    patch: { scheduler: 'plateau', scheduler_factor: 1.5 },
    correction: 0.5,
  },
];

describe('CV authoring compatibility', () => {
  it.each(dependentCases)(
    'rejects incompatible CV $name with a field-specific issue',
    ({ name, patch }) => {
      const parsed = trainingConfigSchema.safeParse({ ...trainingDefaults, cv: 2, ...patch });
      expect(parsed.success).toBe(false);
      if (parsed.success) throw new Error('Dependent CV option accepted');
      expect(parsed.error.issues.map((issue) => issue.path)).toContainEqual([name]);
      expect(trainingConfigSchema.safeParse({ ...trainingDefaults, cv: 0, ...patch }).success).toBe(
        true,
      );
    },
  );

  it.each(dependentCases)(
    'clears the mounted CV $name issue after corrective editing',
    async ({ name, patch, correction }) => {
      const { wrapper, form, preview } = editor({ ...trainingDefaults, cv: 2, ...patch });
      await wrapper.trigger('submit');
      await expect.poll(() => form.errors.value[`config.${name}`]).toContain('Cross-validation');
      const control = trainingControl(wrapper, name);
      await expect.poll(() => markedInvalid(control)).toBe(true);
      expect(preview).not.toHaveBeenCalled();
      await setTrainingControl(wrapper, name, correction);
      await vi.waitFor(async () => expect((await form.validate()).valid).toBe(true));
      await wrapper.trigger('submit');
      await expect.poll(() => preview.mock.calls.length).toBe(1);
      await expect.poll(() => markedInvalid(control)).toBe(false);
      expect(form.errors.value[`config.${name}`]).toBeUndefined();
      wrapper.unmount();
    },
  );

  it('accepts deterministic CV in the schema and mounted authoring form', async () => {
    const config = { ...trainingDefaults, cv: 2, deterministic: true };
    expect(trainingConfigSchema.parse(config)).toEqual(config);
    const { wrapper, form, preview } = editor();
    await wrapper.get('[id$="-training-cv"]').setValue('2');
    await wrapper.get('[id$="-training-deterministic"]').trigger('click');
    await wrapper.trigger('submit');
    await expect.poll(() => preview.mock.calls.length).toBe(1);
    expect(form.errors.value).toEqual({});
    expect(form.values.config.deterministic).toBe(true);
    expect(markedInvalid(trainingControl(wrapper, 'deterministic'))).toBe(false);
    wrapper.unmount();
  });

  it.each([0, 0.5, 0.999])('accepts valid plateau factor %s', (scheduler_factor) => {
    expect(
      trainingConfigSchema.safeParse({ ...trainingDefaults, cv: 2, scheduler_factor }).success,
    ).toBe(true);
  });

  it.each(['step', 'multistep', 'exponential', 'cosine'])(
    'permits factor >1 for %s',
    (scheduler) => {
      expect(
        trainingConfigSchema.safeParse({
          ...trainingDefaults,
          cv: 2,
          scheduler,
          scheduler_factor: 1.5,
        }).success,
      ).toBe(true);
    },
  );

  it.each([Number.NaN, Infinity, -Infinity])(
    'rejects nonfinite dependent numeric values %s',
    (value) => {
      for (const patch of [
        { scheduler_factor: value },
        { optimizer: 'sgd', nesterov: true, momentum: value },
      ])
        expect(
          trainingConfigSchema.safeParse({ ...trainingDefaults, cv: 2, ...patch }).success,
        ).toBe(false);
    },
  );

  it('accepts positive SGD Nesterov momentum, and zero momentum when Nesterov is off', () => {
    for (const patch of [
      { optimizer: 'sgd', nesterov: true, momentum: 0.9 },
      { nesterov: false, momentum: 0 },
    ])
      expect(trainingConfigSchema.safeParse({ ...trainingDefaults, cv: 2, ...patch }).success).toBe(
        true,
      );
  });

  it.each(dependentCases)('never calls the plan API for invalid CV $name', async ({ patch }) => {
    const planTransport = vi.fn();
    const response = (value: object) =>
      new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
    const session = new ConnectionSession({
      origin: window.location.origin,
      buildId: '1.8.1',
      fetcher: async (input) => {
        const path = new URL(String(input)).pathname;
        if (path === '/api/health')
          return response({
            daemon_id: 'cv-daemon',
            build_id: '1.8.1',
            protocol_min: 1,
            protocol_max: 1,
          });
        if (path === '/api/browse/resolve')
          return response({
            root: 'data',
            relative_path: 'train.npz',
            path: '/data/train.npz',
            kind: 'file',
          });
        if (path === '/api/models')
          return response({
            source: 'bundled_metadata',
            runtime_verified: false,
            categories: { cnn: { short_description: 'CNN', models: ['cnn'] } },
            models: [
              {
                id: 'cnn',
                display_name: 'CNN',
                architecture_family: 'CNN',
                author_institution: 'Example',
                year_published: 1989,
                params_m: 1.6,
                size_mb: 6,
                short_description: 'Simple convolutional baseline',
                description: 'Network',
                best_for: 'Waves',
                pros: ['Fast'],
                cons: ['Limited capacity'],
                compute_tier: 'Edge',
                tags: ['baseline'],
                supported_dims: [2],
                is_pretrained: false,
              },
            ],
          });
        if (path === '/api/runs/plan') planTransport();
        throw new Error(`Unexpected route ${path}`);
      },
    });
    expect(await session.connect('memory-only-credential')).toBe(true);
    const catalogue = new CatalogApi(session);
    const data = await catalogue.resolve('data', 'train.npz');
    const models = await catalogue.models();
    const model = models[0];
    if (!model) throw new Error('Missing model');
    const draft: TrainingRequest = {
      backend: 'local',
      operation: 'train',
      config: { ...trainingDefaults, model: 'cnn', data_path: data.path, cv: 2, ...patch },
      runtime: { python: '/host/python', mode: 'existing', device: 'cpu', environment: {} },
      topology: { num_machines: 1, processes_per_machine: 1, machine_rank: 0 },
    };
    const flow = new ProjectPlan(session);
    expect(() => flow.prepare(draft, data, catalogue.selectModel(model, models))).toThrow();
    await expect(flow.preview()).rejects.toThrow('Validate the training draft first.');
    expect(planTransport).not.toHaveBeenCalled();
    session.detach();
  });
  it.each(unsupported)(
    'rejects nondefault $name only for CV, without echoing its value',
    ({ name, value }) => {
      const config = { ...trainingDefaults, cv: 2, [name]: value };
      const parsed = trainingConfigSchema.safeParse(config);
      expect(parsed.success).toBe(false);
      if (parsed.success) throw new Error('Unsupported option accepted');
      expect(parsed.error.issues.map((issue) => issue.path)).toContainEqual([name]);
      expect(parsed.error.issues.map((issue) => issue.message).join('\n')).not.toContain(
        String(value),
      );
      expect(trainingConfigSchema.safeParse({ ...config, cv: 0 }).success).toBe(true);
    },
  );

  it.each(unsupported)(
    'shows the $name issue on the mounted control and blocks preview until corrected',
    async ({ name, value }) => {
      const { wrapper, form, preview } = editor();
      await flushPromises();
      await wrapper.get('[id$="-training-cv"]').setValue('2');
      // W&B details appear only with W&B on; a changed value stays visible after it is off.
      const restore = await revealTrainingControl(wrapper, form, name);
      await setTrainingControl(wrapper, name, value);
      await restore();
      const control = trainingControl(wrapper, name);
      await control.trigger('blur');
      await wrapper.trigger('submit');
      await flushPromises();
      expect(preview).not.toHaveBeenCalled();
      await expect.poll(() => markedInvalid(control)).toBe(true);
      expect(form.errors.value[`config.${name}`]).toContain('Cross-validation');
      expect(wrapper.findAll('[data-slot="field-error"]').length).toBeGreaterThan(0);
      expect(
        wrapper
          .findAll('[data-slot="field-error"]')
          .map((error) => error.text())
          .join('\n'),
      ).not.toContain(String(value));
      await setTrainingControl(wrapper, name, trainingDefaults[name]);
      await vi.waitFor(async () => expect((await form.validate()).valid).toBe(true));
      await wrapper.trigger('submit');
      await flushPromises();
      await expect.poll(() => preview.mock.calls.length).toBe(1);
      // A setting returned to its default hides again when its controlling choice is off.
      const corrected = wrapper.find(`[id$="-training-${name}"]`);
      expect(corrected.exists()).toBe(
        trainingFieldVisible(trainingFieldName(name), form.values.config),
      );
      if (corrected.exists()) await expect.poll(() => markedInvalid(corrected)).toBe(false);
      wrapper.unmount();
    },
  );

  it('rejects a single fold with a CV-specific issue', () => {
    const parsed = trainingConfigSchema.safeParse({ ...trainingDefaults, cv: 1 });
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error('Single fold accepted');
    expect(parsed.error.issues).toEqual([
      expect.objectContaining({
        path: ['cv'],
        message: 'Cross-validation requires at least two folds.',
      }),
    ]);
  });

  it('shows a mounted single-fold error and accepts correcting it to two folds', async () => {
    const { wrapper, form, preview } = editor();
    await wrapper.get('[id$="-training-cv"]').setValue('1');
    await wrapper.trigger('submit');
    await flushPromises();
    expect(preview).not.toHaveBeenCalled();
    await expect.poll(() => form.errors.value['config.cv']).toContain('at least two folds');
    await expect.poll(() => markedInvalid(trainingControl(wrapper, 'cv'))).toBe(true);
    await wrapper.get('[id$="-training-cv"]').setValue('2');
    await wrapper.trigger('submit');
    await flushPromises();
    await expect.poll(() => preview.mock.calls.length).toBe(1);
    wrapper.unmount();
  });

  it.each(['bf16', 'fp16', 'no'])(
    'retains implemented CV options with precision %s',
    (precision) => {
      const config = {
        ...trainingDefaults,
        cv: 2,
        precision,
        grad_accum_steps: 3,
        pretrained: true,
        constraint: ['custom.balance'],
        constraint_file: '/host/physics.py',
        constraint_weight: [0.25],
        constraint_reduction: 'mae',
        cv_stratify: true,
        cv_bins: 7,
      };
      expect(trainingConfigSchema.parse(config)).toEqual(config);
    },
  );

  it.each(['sha256', 'fast', 'size'])(
    'accepts and retains inapplicable cache validation %s',
    (cache_validate) => {
      const config = { ...trainingDefaults, cv: 2, cache_validate };
      expect(trainingConfigSchema.parse(config)).toEqual(config);
      expect(config.save_every).toBe(50);
    },
  );

  it('reports every incompatible field independently, including config paths on a request', () => {
    const config = {
      ...trainingDefaults,
      cv: 2,
      ...Object.fromEntries(unsupported.map(({ name, value }) => [name, value])),
    };
    const parsed = trainingRequestSchema.safeParse({
      backend: 'local',
      operation: 'train',
      config,
      runtime: { python: '/host/python', mode: 'existing', device: 'cpu', environment: {} },
      topology: { num_machines: 1, processes_per_machine: 1, machine_rank: 0 },
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error('Unsupported request accepted');
    expect(parsed.error.issues.map((issue) => issue.path)).toEqual(
      unsupported.map(({ name }) => ['config', name]),
    );
  });

  it('preserves old saved CV preferences as editable values instead of silently replacing them', () => {
    const items = new Map<string, string>();
    const storage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => {
        items.set(key, value);
      },
      removeItem: (key: string) => {
        items.delete(key);
      },
    };
    const preferences = {
      ...defaultTrainingPreferences(),
      cv: 2,
      compile: true,
      save_every: 7,
      epochs: 23,
    };
    expect(saveTrainingPreferences('legacy', preferences, storage)).toBe(true);
    expect(loadTrainingPreferences('legacy', storage)).toEqual(preferences);
    const draft = applyTrainingPreferences(
      trainingDefaults,
      loadTrainingPreferences('legacy', storage),
    );
    expect(draft).toMatchObject(preferences);
    expect(trainingConfigSchema.safeParse(draft).success).toBe(false);
  });
});
