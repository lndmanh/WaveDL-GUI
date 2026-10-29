import { describe, expect, it } from 'vitest';
import { CONFIG_IMPORT_LIMIT, parseTrainingConfig } from '../../app/lib/training-import';
import { trainingYaml } from '../../app/lib/training-export';
import { trainingDefaults, trainingRequestSchema } from '../../shared/schemas/training-request';

describe('training configuration import', () => {
  it('reads a CLI YAML config, converting lists and scalars to the draft shape', () => {
    const imported = parseTrainingConfig(
      [
        '# exported by wavedl',
        'data_path: /srv/data/train.npz',
        'model: resnet18',
        'epochs: 40',
        'lr: 3.0e-4',
        'optimizer: sgd',
        'betas: [0.8, 0.99]',
        'milestones:',
        '  - 10',
        '  - 20',
        'loss_weights: [1, 2.5]',
        'import_modules: my_package.models',
        'constraint: y0 > 0',
        'constraint_weight: 0.5',
        'resume: null',
      ].join('\n'),
    );
    expect(imported.dataPath).toBe('/srv/data/train.npz');
    expect(imported.model).toBe('resnet18');
    expect(imported.config).toEqual({
      epochs: 40,
      lr: 0.0003,
      optimizer: 'sgd',
      betas: '0.8,0.99',
      milestones: '10,20',
      loss_weights: '1,2.5',
      import_modules: ['my_package.models'],
      constraint: ['y0 > 0'],
      constraint_weight: [0.5],
      resume: null,
    });
    expect(imported.config).not.toHaveProperty('data_path');
    expect(imported.config).not.toHaveProperty('model');
    expect(imported.skipped).toEqual([]);
  });

  it('accepts JSON through the same YAML path and keeps lists that are already lists', () => {
    const imported = parseTrainingConfig(
      JSON.stringify({
        batch_size: 64,
        scheduler: 'step',
        step_size: 15,
        import_modules: ['a.models', 'b.models'],
        constraint_weight: [0.1, 0.2],
        betas: '0.9,0.95',
      }),
    );
    expect(imported).toEqual({
      config: {
        batch_size: 64,
        scheduler: 'step',
        step_size: 15,
        import_modules: ['a.models', 'b.models'],
        constraint_weight: [0.1, 0.2],
        betas: '0.9,0.95',
      },
      dataPath: null,
      model: null,
      skipped: [],
    });
  });

  it('maps the CLI mixed_precision alias unless precision is given', () => {
    const alias = parseTrainingConfig('mixed_precision: fp16\n');
    expect(alias.config).toEqual({ precision: 'fp16' });
    expect(alias.skipped).toEqual([]);
    const both = parseTrainingConfig('precision: "no"\nmixed_precision: fp16\n');
    expect(both.config).toEqual({ precision: 'no' });
    expect(both.skipped).toEqual([]);
    const invalid = parseTrainingConfig('mixed_precision: fp8\n');
    expect(invalid.config).toEqual({});
    expect(invalid.skipped).toEqual(['mixed_precision']);
  });

  it('reports unknown, daemon-owned and invalid keys as skipped', () => {
    const imported = parseTrainingConfig(
      [
        'epochs: 10',
        'output_dir: ./results',
        'list_models: true',
        'config: other.yaml',
        'not_a_setting: 1',
        'lr: -1',
        'optimizer: lion',
        'betas: [0.9]',
        'data_path: ""',
        'model: 42',
      ].join('\n'),
    );
    expect(imported.config).toEqual({ epochs: 10 });
    expect(imported.dataPath).toBeNull();
    expect(imported.model).toBeNull();
    expect(imported.skipped).toEqual([
      'output_dir',
      'list_models',
      'config',
      'not_a_setting',
      'lr',
      'optimizer',
      'betas',
      'data_path',
      'model',
    ]);
  });

  it('rejects files over 64 KiB before parsing', () => {
    const source = `epochs: 10\n# ${'x'.repeat(CONFIG_IMPORT_LIMIT)}\n`;
    expect(() => parseTrainingConfig(source)).toThrow(
      expect.objectContaining({ clientMessageKey: 'configImportTooLarge' }),
    );
    // The limit is measured in UTF-8 bytes, not characters.
    const multibyte = `# ${'é'.repeat(CONFIG_IMPORT_LIMIT / 2)}\n`;
    expect(() => parseTrainingConfig(multibyte)).toThrow(
      expect.objectContaining({ clientMessageKey: 'configImportTooLarge' }),
    );
  });

  it.each([
    ['a list', '- epochs\n- 10\n'],
    ['a scalar', 'just text'],
    ['an empty file', ''],
    ['null', 'null\n'],
    ['malformed YAML', 'epochs: [10\n'],
    ['duplicate keys', 'epochs: 10\nepochs: 20\n'],
    ['YAML aliases', 'base: &base 10\nepochs: *base\n'],
  ])('rejects %s as unreadable', (_name, source) => {
    expect(() => parseTrainingConfig(source)).toThrow(
      expect.objectContaining({ clientMessageKey: 'configImportUnreadable' }),
    );
  });

  it('round-trips a downloaded YAML export', () => {
    const request = trainingRequestSchema.parse({
      backend: 'local',
      operation: 'train',
      config: {
        ...trainingDefaults,
        data_path: '/srv/data/train.npz',
        model: 'cnn_pretrained',
        epochs: 75,
        betas: '0.85,0.995',
        scheduler: 'multistep',
        milestones: '5,15',
        import_modules: ['custom.models'],
        constraint: ['y0 > 0'],
        constraint_weight: [0.25],
        run_name: 'my run',
      },
      runtime: { python: '/usr/bin/python3', mode: 'existing', device: 'cpu', environment: {} },
      topology: { num_machines: 1, processes_per_machine: 1, machine_rank: 0 },
    });
    const imported = parseTrainingConfig(trainingYaml(request));
    const { data_path: dataPath, model, ...config } = request.config;
    expect(imported).toEqual({ config, dataPath, model, skipped: [] });
  });
});
