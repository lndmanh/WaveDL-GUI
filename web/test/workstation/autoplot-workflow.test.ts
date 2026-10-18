import { describe, expect, it } from 'vitest';
import {
  AutoPlotWorkflow,
  type AutoPlotObservation,
} from '../../workstation/lib/autoplot-workflow';
import { trainingDefaults, trainingRequestSchema } from '../../shared/schemas/training-request';
import type { RunView } from '../../workstation/lib/daemon-api';
const run: RunView = {
  run_id: '22222222-2222-4222-8222-222222222222',
  plan_id: '11111111-1111-4111-8111-111111111111',
  request_id: '33333333-3333-4333-8333-333333333333',
  backend: 'local',
  operation: 'train',
  state: 'completed',
  attempt: 1,
  uncertainty: false,
  submission_requested: true,
  cancellation_requested: false,
  evidence: null,
};
function capture(cv = 0) {
  return {
    daemonId: 'daemon',
    revision: 1,
    run,
    approvedPlan: {
      run_id: run.run_id,
      request_id: run.request_id,
      plan_id: run.plan_id,
      preview: {},
    },
    request: trainingRequestSchema.parse({
      backend: 'local',
      operation: 'train',
      config: { ...trainingDefaults, model: 'cnn', data_path: '/data/train.npz', cv },
      runtime: { python: '/venv/bin/python', mode: 'existing', device: 'cpu', environment: {} },
      topology: { num_machines: 1, processes_per_machine: 1, machine_rank: 0 },
    }),
  };
}
const observation: AutoPlotObservation = {
  daemonId: 'daemon',
  connected: true,
  revision: 1,
  freshness: 'fresh',
  run,
  publications: [
    {
      selectable: true,
      label: 'Best',
      classification: { schema_version: 1, kind: 'best' },
      artifact: {
        runId: run.run_id,
        generation: 'gen-000001',
        attempt: 1,
        step: 5,
        path: 'checkpoint_selection.json',
        size: 42,
        sha256: 'a'.repeat(64),
      },
    },
  ],
};
describe('captured automatic plot intent', () => {
  it('preserves only captured approved custom-model imports through planning and retries', () => {
    const submitted = capture();
    submitted.request.config.model = 'custom_model';
    submitted.request.config.import_modules = ['custom_models.registration', 'custom_losses'];
    const workflow = new AutoPlotWorkflow(submitted);
    submitted.request.config.import_modules.push('later_unapproved_module');
    const intent = workflow.observe(observation);
    expect(intent?.request.config).toMatchObject({
      model: 'custom_model',
      import_modules: ['custom_models.registration', 'custom_losses'],
    });
    workflow.planned();
    expect(workflow.observe(observation)).toEqual(intent);
  });
  it.each(['local', 'slurm'] as const)(
    'derives one plot process from %s distributed training without changing resource provenance',
    (backend) => {
      const submitted = capture();
      submitted.run = { ...run, backend };
      submitted.request = trainingRequestSchema.parse({
        ...submitted.request,
        backend,
        runtime: {
          ...submitted.request.runtime,
          device: 'cuda',
          environment: backend === 'local' ? { CUDA_VISIBLE_DEVICES: '2,3,4,5' } : {},
        },
        topology: {
          num_machines: backend === 'slurm' ? 2 : 1,
          processes_per_machine: 4,
          machine_rank: 0,
        },
        storage_map: [{ host_root: '/data', execution_root: '/execution' }],
      });
      const approvedRequest = structuredClone(submitted.request);
      const workflow = new AutoPlotWorkflow(submitted);
      const intent = workflow.observe({ ...observation, run: submitted.run });
      expect(intent?.request.topology).toEqual({
        num_machines: 1,
        processes_per_machine: 1,
        machine_rank: 0,
      });
      expect(intent?.request.backend).toBe(backend);
      expect(intent?.request.runtime).toEqual(approvedRequest.runtime);
      expect(intent?.request.storage_map).toEqual(approvedRequest.storage_map);
      expect(intent?.request.config.data_path).toBe(approvedRequest.config.data_path);
      expect(submitted.request).toEqual(approvedRequest);
      workflow.planned();
      expect(workflow.observe({ ...observation, run: submitted.run })).toEqual(intent);
    },
  );
  it('freezes submitted runtime/data and provides one durable retry key', () => {
    const submitted = capture();
    const workflow = new AutoPlotWorkflow(submitted);
    submitted.request.config.data_path = '/different.npz';
    const intent = workflow.observe(observation);
    expect(intent?.request.config.data_path).toBe('/data/train.npz');
    expect(intent?.request.runtime.python).toBe('/venv/bin/python');
    expect(intent?.request.operation).toBe('plot');
    workflow.planned();
    expect(workflow.observe(observation)).toEqual(intent);
    expect(new AutoPlotWorkflow(capture()).observe(observation)?.idempotencyKey).toBe(
      intent?.idempotencyKey,
    );
    workflow.submitted();
    expect(workflow.observe(observation)).toBeNull();
  });
  it('never triggers on CV, uncertain/pending/stale/foreign/incomplete or ambiguous evidence', () => {
    expect(new AutoPlotWorkflow(capture(3)).observe(observation)).toBeNull();
    for (const runUpdate of [
      { uncertainty: true },
      { state: 'running' as const },
      { evidence: { native_pending: true } },
      { cancellation_requested: true },
      { run_id: 'foreign' },
      { request_id: 'foreign' },
      { attempt: 2 },
    ])
      expect(
        new AutoPlotWorkflow(capture()).observe({ ...observation, run: { ...run, ...runUpdate } }),
      ).toBeNull();
    expect(
      new AutoPlotWorkflow(capture()).observe({ ...observation, freshness: 'stale' }),
    ).toBeNull();
    expect(
      new AutoPlotWorkflow(capture()).observe({
        ...observation,
        publications: [...observation.publications, ...observation.publications],
      }),
    ).toBeNull();
    expect(
      new AutoPlotWorkflow(capture()).observe({ ...observation, publications: [] }),
    ).toBeNull();
  });
  it('permanently disarms on detach, revision change and shutdown', () => {
    for (const update of [{ connected: false }, { revision: 2 }, { daemonId: 'other' }]) {
      const workflow = new AutoPlotWorkflow(capture());
      expect(workflow.observe({ ...observation, ...update })).toBeNull();
      expect(workflow.observe(observation)).toBeNull();
    }
    const workflow = new AutoPlotWorkflow(capture());
    workflow.stop();
    expect(workflow.observe(observation)).toBeNull();
    expect(() => workflow.submitted()).toThrow();
  });
});
