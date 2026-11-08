import { describe, expect, it } from 'vitest';
import { planSchema } from '../../shared/schemas/daemon-api';
import { hostPath } from '../../app/lib/host-path';
import { resultOperationPrefill } from '../../app/lib/result-operation-prefill';
import { createResultOperationDefaults } from '../../app/lib/result-operation-defaults';
import { runClone } from '../../app/lib/run-clone';
import { trainingDefaults } from '../../shared/schemas/training-request';
import type { JsonObject } from '../../types/json';

const storage = [{ host_root: '/host', execution_root: '/worker' }];

const runtime = {
  python: '/worker/venv/bin/python',
  mode: 'selected',
  device: 'cuda',
  container: null,
  environment: { OMP_NUM_THREADS: '2' },
};

function plan(spec: JsonObject, target = 'slurm') {
  return planSchema.parse({
    run_id: '11111111-1111-4111-8111-111111111111',
    plan_id: '22222222-2222-4222-8222-222222222222',
    request_id: '33333333-3333-4333-8333-333333333333',
    preview: {
      spec,
      target,
      topology: { num_machines: 2, processes_per_machine: 3, machine_rank: 0 },
    },
  });
}

describe('result operation prefill', () => {
  it('inherits shared training config and runtime, without reusing dataset or source grants', () => {
    const result = resultOperationPrefill(
      plan({
        operation: 'train',
        runtime,
        storage_map: storage,
        resolved_config: {
          ...trainingDefaults,
          model: 'registered_model',
          import_modules: ['package.registration', '/worker/models/register.py'],
          data_path: '/worker/train.npz',
          batch_size: 64,
          workers: 4,
          single_channel: true,
        },
      }),
    );

    expect(result.warnings).toEqual([]);
    expect(result.draft.runtime).toEqual({
      python: '/host/venv/bin/python',
      mode: 'selected',
      device: 'cuda',
      environment: runtime.environment,
    });
    expect(result.draft.backend).toBe('slurm');
    expect(result.draft.storage_map).toEqual(storage);
    expect(result.draft.topology).toEqual({
      num_machines: 2,
      processes_per_machine: 3,
      machine_rank: 0,
    });
    expect(result.draft.config).toMatchObject({
      model: 'registered_model',
      import_modules: ['package.registration', '/host/models/register.py'],
      batch_size: 64,
      workers: 4,
      input_channels: null,
      out_size: null,
      input_key: null,
      output_key: null,
      param_names: null,
      format: 'auto',
      data_path: '',
    });
    expect(result.draft.checkpoint_source).toEqual({ run_id: '', checkpoint: '' });
    expect(result.draft.operation).toBe('test');
  });

  it('preserves genuine inference overrides when evaluating an evaluation checkpoint', () => {
    const result = resultOperationPrefill(
      plan(
        {
          runtime,
          resolved_config: {
            model: null,
            format: 'hdf5',
            input_key: 'signals',
            output_key: 'targets',
            param_names: ['thickness', 'speed'],
            input_channels: 2,
            out_size: 2,
            batch_size: 16,
            workers: 0,
            verbose: true,
            plot_format: ['png', 'pdf'],
            export: 'onnx',
            plot: true,
            no_denorm: true,
            save_predictions: true,
          },
        },
        'local',
      ),
    );

    expect(result.warnings).toEqual([]);
    expect(result.draft.config).toMatchObject({
      model: null,
      format: 'hdf5',
      input_key: 'signals',
      output_key: 'targets',
      param_names: ['thickness', 'speed'],
      input_channels: 2,
      out_size: 2,
      verbose: true,
      plot_format: ['png', 'pdf'],
      export: null,
      no_denorm: false,
      plot: false,
      save_predictions: false,
    });
  });

  it('falls back to fresh defaults for missing plans and ambiguous paths', () => {
    expect(resultOperationPrefill(null)).toEqual({
      draft: createResultOperationDefaults(),
      warnings: ['plan'],
    });

    const result = resultOperationPrefill(
      plan({
        runtime,
        storage_map: [...storage, { host_root: '/another-host', execution_root: '/worker' }],
        resolved_config: { model: 'custom', import_modules: ['/worker/models/register.py'] },
      }),
    );

    expect(result).toEqual({ draft: createResultOperationDefaults(), warnings: ['paths'] });
    result.draft.runtime.environment.PRIVATE = 'value';
    expect(resultOperationPrefill(null).draft.runtime.environment).toEqual({});
  });

  it('flags invalid runtime/config values and unsupported container images', () => {
    const result = resultOperationPrefill(
      plan({
        runtime: { ...runtime, python: 'relative/python', container: '/images/model.sif' },
        resolved_config: { workers: -1 },
      }),
    );

    expect(result.warnings).toEqual(['runtime', 'container']);
    expect(result.draft.runtime.python).toBe('');
    expect(result.draft.config.workers).toBe(0);
  });

  it('does not silently drop invalid saved environment values', () => {
    const result = resultOperationPrefill(
      plan({
        runtime: { ...runtime, environment: { OMP_NUM_THREADS: 2 } },
        resolved_config: {},
      }),
    );

    expect(result.warnings).toEqual(['runtime']);
    expect(result.draft.runtime.python).toBe('');
    expect(result.draft.runtime.environment).toEqual({});
  });

  it('keeps model registrations when training used automatic workers', () => {
    const result = resultOperationPrefill(
      plan({
        runtime,
        storage_map: storage,
        resolved_config: {
          ...trainingDefaults,
          model: 'custom_model',
          import_modules: ['/worker/register.py'],
        },
      }),
    );

    expect(result.warnings).toEqual([]);
    expect(result.draft.config.workers).toBe(0);
    expect(result.draft.config.model).toBe('custom_model');
    expect(result.draft.config.import_modules).toEqual(['/host/register.py']);
  });

  it('does not silently discard malformed saved configuration or storage mappings', () => {
    const manifests: JsonObject[] = [
      {},
      { runtime, resolved_config: [] },
      {
        runtime,
        resolved_config: {},
        storage_map: [{ host_root: '/host', execution_root: 'relative' }],
      },
    ];

    for (const spec of manifests) {
      expect(resultOperationPrefill(plan(spec))).toEqual({
        draft: createResultOperationDefaults(),
        warnings: ['plan'],
      });
    }
  });

  it('falls back safely for unsupported inference values', () => {
    const result = resultOperationPrefill(plan({ runtime, resolved_config: { batch_size: 0 } }));
    expect(result.warnings).toEqual(['config']);
    expect(result.draft.config.batch_size).toBe(128);
  });

  it('uses the shared reverse mapper for clones, including boundary and ambiguity checks', () => {
    expect(hostPath('/workerish/model.py', storage)).toEqual({
      path: '/workerish/model.py',
      ambiguous: false,
    });
    expect(
      hostPath('D:\\worker\\model.py', [{ host_root: 'C:\\host', execution_root: 'D:\\worker' }]),
    ).toEqual({ path: 'C:\\host\\model.py', ambiguous: false });

    const source = plan(
      {
        operation: 'train',
        runtime,
        storage_map: storage,
        resolved_config: {
          ...trainingDefaults,
          model: 'resnet18',
          data_path: '/worker/train.npz',
          import_modules: ['/worker/register.py'],
        },
      },
      'local',
    );

    const clone = runClone(source, 'daemon');
    expect(clone?.draft.runtime.python).toBe('/host/venv/bin/python');
    expect(clone?.imported.dataPath).toBe('/host/train.npz');
    expect(clone?.draft.config.import_modules).toEqual(['/host/register.py']);
    expect(
      runClone(
        plan(
          {
            operation: 'train',
            runtime,
            storage_map: [...storage, { host_root: '/other', execution_root: '/worker' }],
            resolved_config: {
              ...trainingDefaults,
              model: 'resnet18',
              data_path: '/worker/train.npz',
            },
          },
          'local',
        ),
        'daemon',
      ),
    ).toBeNull();
  });
});
