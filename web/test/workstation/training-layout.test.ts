import { describe, expect, it } from 'vitest';
import {
  changedFromDefault,
  compactNumber,
  essentialTrainingFields,
  matchingPreset,
  trainingFieldVisible,
  trainingRecipes,
  trainingSections,
  type TrainingFieldName,
} from '../../app/lib/training-layout';
import { trainingPresets } from '../../app/lib/training-presets';
import { trainingDefaults, type TrainingConfig } from '../../shared/schemas/training-request';

function config(changes: Partial<TrainingConfig> = {}): TrainingConfig {
  return { ...trainingDefaults, ...changes };
}

describe('training setting relevance', () => {
  it.each<[TrainingFieldName, Partial<TrainingConfig>[], Partial<TrainingConfig>[]]>([
    ['momentum', [{ optimizer: 'sgd' }, { optimizer: 'rmsprop' }], [{}, { optimizer: 'adam' }]],
    ['nesterov', [{ optimizer: 'sgd' }], [{}, { optimizer: 'rmsprop' }]],
    [
      'betas',
      [{}, { optimizer: 'adam' }, { optimizer: 'nadam' }, { optimizer: 'radam' }],
      [{ optimizer: 'sgd' }, { optimizer: 'rmsprop' }],
    ],
    ['scheduler_patience', [{}], [{ scheduler: 'cosine' }, { scheduler: 'step' }]],
    [
      'scheduler_factor',
      [{}, { scheduler: 'step' }, { scheduler: 'multistep' }, { scheduler: 'exponential' }],
      [{ scheduler: 'cosine' }, { scheduler: 'onecycle' }, { scheduler: 'linear_warmup' }],
    ],
    [
      'min_lr',
      [{}, { scheduler: 'cosine' }, { scheduler: 'cosine_restarts' }],
      [{ scheduler: 'step' }, { scheduler: 'onecycle' }],
    ],
    ['step_size', [{ scheduler: 'step' }], [{}, { scheduler: 'multistep' }]],
    ['milestones', [{ scheduler: 'multistep' }], [{}, { scheduler: 'step' }]],
    ['warmup_epochs', [{ scheduler: 'linear_warmup' }], [{}, { scheduler: 'cosine' }]],
    ['huber_delta', [{ loss: 'huber' }], [{}, { loss: 'smooth_l1' }]],
    ['loss_weights', [{ loss: 'weighted_mse' }], [{}, { loss: 'huber' }]],
    ['cv_stratify', [{ cv: 5 }], [{}]],
    ['cv_bins', [{ cv: 5, cv_stratify: true }], [{}, { cv: 5 }]],
    [
      'constraint_weight',
      [{ constraint: ['y0 > 0'] }, { constraint_file: 'rules.py' }],
      [{}, { constraint_file: '' }],
    ],
    [
      'constraint_reduction',
      [{ constraint: ['y0 > 0'] }, { constraint_file: 'rules.py' }],
      [{}],
    ],
    ['wandb_watch', [{ wandb: true }], [{}]],
    ['project_name', [{ wandb: true }], [{}]],
    ['run_name', [{ wandb: true }], [{}]],
  ])('shows %s only when the current choices read it', (name, visible, hidden) => {
    for (const changes of visible) expect(trainingFieldVisible(name, config(changes))).toBe(true);
    for (const changes of hidden) expect(trainingFieldVisible(name, config(changes))).toBe(false);
  });

  it('always shows settings without a relevance rule', () => {
    for (const name of [...essentialTrainingFields, 'seed', 'workers', 'import_modules'] as const)
      expect(trainingFieldVisible(name, config({ optimizer: 'sgd', scheduler: 'step' }))).toBe(
        true,
      );
  });

  it('never hides a value changed from its default', () => {
    expect(trainingFieldVisible('momentum', config({ momentum: 0.5 }))).toBe(true);
    expect(trainingFieldVisible('betas', config({ optimizer: 'sgd', betas: '0.8,0.9' }))).toBe(
      true,
    );
    expect(trainingFieldVisible('run_name', config({ run_name: 'trial' }))).toBe(true);
    expect(trainingFieldVisible('cv_bins', config({ cv_bins: 4 }))).toBe(true);
    expect(trainingFieldVisible('constraint_weight', config({ constraint_weight: [0.3] }))).toBe(
      true,
    );
    expect(changedFromDefault('constraint_weight', config({ constraint_weight: [0.1] }))).toBe(
      false,
    );
    expect(changedFromDefault('huber_delta', config())).toBe(false);
  });

  it('lists every non-selection field exactly once, leaving pretrained to the Model block', () => {
    const listed = [...essentialTrainingFields, ...trainingSections.flatMap((s) => s.fields)];
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed).not.toContain('pretrained');
    expect(new Set([...listed, 'pretrained', 'data_path', 'model'])).toEqual(
      new Set(Object.keys(trainingDefaults)),
    );
  });
});

describe('training recipes', () => {
  it('recognises the CLI defaults and keeps matching after untouched fields change', () => {
    expect(matchingPreset(config())).toBe('defaults');
    expect(matchingPreset(config({ seed: 7, wandb: true }))).toBe('defaults');
  });

  it.each(trainingPresets.map((preset) => preset.id))('recognises the %s preset', (id) => {
    const preset = trainingPresets.find((candidate) => candidate.id === id);
    expect(matchingPreset(config(preset?.config))).toBe(id);
  });

  it('reports a custom mix as no recipe', () => {
    expect(matchingPreset(config({ epochs: 333 }))).toBeNull();
    const balanced = trainingPresets.find((preset) => preset.id === 'balanced');
    expect(matchingPreset(config({ ...balanced?.config, lr: 0.002 }))).toBeNull();
  });

  it('builds the defaults recipe over the same fields as the presets', () => {
    const [defaults, ...presets] = trainingRecipes;
    expect(defaults?.id).toBe('defaults');
    for (const preset of presets)
      expect(Object.keys(preset.config).sort()).toEqual(Object.keys(defaults?.config ?? {}).sort());
    expect(defaults?.config).toMatchObject({ epochs: trainingDefaults.epochs, lr: trainingDefaults.lr });
  });
});

describe('compact number formatting', () => {
  it.each([
    [0.0003, '3e-4'],
    [0.001, '1e-3'],
    [1e-6, '1e-6'],
    [1.5e-5, '1.5e-5'],
    [-0.0005, '-5e-4'],
    [0.01, '0.01'],
    [0.5, '0.5'],
    [0, '0'],
    [1000, '1000'],
    [999999, '999999'],
    [1e6, '1e6'],
    [2.5e7, '2.5e7'],
    [0.1 + 0.2, '0.3'],
    [123.4567891, '123.457'],
    [Number.NaN, '—'],
    [Number.POSITIVE_INFINITY, '—'],
  ])('formats %s as %s', (value, expected) => {
    expect(compactNumber(value)).toBe(expected);
  });
});
