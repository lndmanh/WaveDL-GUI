import { describe, expect, it } from 'vitest';
import {
  trainingDefaults,
  trainingRequestSchema,
  reservedRuntimeVariable,
} from '../../shared/schemas/training-request';
import {
  applyTrainingPreset,
  trainingPresetSchema,
  trainingPresets,
} from '../../app/lib/training-presets';
describe('same-schema training presets and authority bounds', () => {
  it('applies valid partial presets without retargeting dataset/model or dropping advanced fields', () => {
    const original = {
      ...trainingDefaults,
      model: 'custom_net',
      data_path: '/verified/data.npz',
      constraint: ['y0'],
      constraint_weight: [0.7],
      import_modules: ['trusted.custom_models'],
      constraint_file: '/verified/constraints.py',
      resume: '/verified/checkpoint.pth',
    };
    for (const preset of trainingPresets) {
      const result = applyTrainingPreset(original, preset.config);
      expect(result.data_path).toBe(original.data_path);
      expect(result.model).toBe(original.model);
      expect(result.constraint).toEqual(['y0']);
      expect(result.import_modules).toEqual(original.import_modules);
      expect(result.constraint_file).toBe(original.constraint_file);
      expect(result.resume).toBe(original.resume);
    }
  });
  it.each([
    { epochs: 0 },
    { lr: Infinity },
    { precision: 'fp32' },
    { data_path: '/foreign' },
    { model: 'foreign' },
    { mixed_precision: 'bf16' },
    { runtime: { python: '/foreign' } },
    { output_dir: '/foreign' },
    { config: { epochs: 100, import_modules: ['foreign.module'] } },
    { model_code: '/foreign/model.py' },
  ])('rejects malformed or authority-carrying preset %j', (preset) => {
    expect(trainingPresetSchema.safeParse(preset).success).toBe(false);
  });
  it.each([
    { import_modules: ['foreign.module'] },
    { import_modules: [] },
    { import_modules: null },
    { import_modules: undefined },
    { constraint_file: '/foreign/constraints.py' },
    { constraint_file: '' },
    { constraint_file: null },
    { constraint_file: undefined },
    { resume: '/foreign/checkpoint.pth' },
    { resume: '' },
    { resume: null },
    { resume: undefined },
  ])('rejects code/checkpoint authority regardless of its value: %j', (authority) => {
    const original = structuredClone(trainingDefaults);
    const preset = { epochs: 100, ...authority };
    expect(trainingPresetSchema.safeParse(preset).success).toBe(false);
    expect(() => applyTrainingPreset(original, preset)).toThrow();
    expect(original).toEqual(trainingDefaults);
  });
  it('retains strict partial validation while allowing safe training-only values', () => {
    const preset = { epochs: 123, lr: 0.004, batch_size: 32, constraint_weight: [0.5] };
    expect(trainingPresetSchema.parse(preset)).toEqual(preset);
    expect(applyTrainingPreset(trainingDefaults, preset)).toEqual({
      ...trainingDefaults,
      ...preset,
    });
    expect(trainingPresetSchema.parse({})).toEqual({});
  });
  it.each([
    'SLURM_JOB_ID',
    'slurm_conf',
    'srun_foo',
    'SBATCH_EXPORT',
    'SCANCEL_FOO',
    'SQUEUE_FOO',
    'SACCT_FOO',
    'SCONTROL_FOO',
    'rank',
    'WORLD_SIZE',
    'master_port',
    'wavedl_token',
  ])('reserves execution authority %s case-insensitively', (name) => {
    expect(reservedRuntimeVariable(name)).toBe(true);
  });
  it('rejects Slurm CUDA visibility but permits explicit local device restriction', () => {
    const request = {
      backend: 'slurm',
      operation: 'train',
      config: trainingDefaults,
      runtime: {
        python: '/usr/bin/python3',
        mode: 'existing',
        device: 'cuda',
        environment: { CUDA_VISIBLE_DEVICES: '0' },
      },
      topology: { num_machines: 1, processes_per_machine: 1, machine_rank: 0 },
    };
    expect(trainingRequestSchema.safeParse(request).success).toBe(false);
    expect(trainingRequestSchema.safeParse({ ...request, backend: 'local' }).success).toBe(true);
  });
});
