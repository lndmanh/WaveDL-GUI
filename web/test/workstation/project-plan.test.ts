import { describe, expect, it } from 'vitest';
import {
  trainingConfigSchema,
  trainingDefaults,
  trainingFieldMetadata,
  trainingRequestSchema,
} from '../../shared/schemas/training-request';
import options from '../../shared/training-options.json';
import { ConnectionSession } from './session-fixture';
import { CatalogApi } from '../../app/lib/catalog-api';
import { ProjectPlan } from '../../app/lib/project-plan';

const ids = {
  plan_id: '11111111-1111-4111-8111-111111111111',
  run_id: '22222222-2222-4222-8222-222222222222',
  request_id: '33333333-3333-4333-8333-333333333333',
};
const health = { daemon_id: 'daemon-one', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 };
function response(value: object) {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
}
async function setup() {
  let losePlan = false;
  let loseSubmit = false;
  const keys: (string | null)[] = [];
  const requests: string[] = [];
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
  const owner = new ConnectionSession({
    origin: 'http://localhost:8765',
    buildId: '1.8.1',
    fetcher: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/health') return response(health);
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
              description: 'Network',
              best_for: 'Waves',
              supported_dims: [1],
              category: 'cnn',
              is_pretrained: false,
            },
          ],
        });
      if (path === '/api/runs/plan') {
        keys.push(new Headers(init?.headers).get('Idempotency-Key'));
        requests.push(String(init?.body));
        if (losePlan) throw new Error('Lost acknowledgment');
        return response({
          ...ids,
          preview: { manifest: { resolved_config: trainingDefaults }, warnings: [] },
        });
      }
      if (path === '/api/runs') {
        requests.push(String(init?.body));
        if (loseSubmit) throw new Error('Lost acknowledgment');
        return response(run);
      }
      if (path === `/api/runs/${ids.run_id}`) return response(run);
      throw new Error(`Unexpected route ${path}`);
    },
  });
  await owner.connect('credential');
  const catalogue = new CatalogApi(owner);
  const selections = async () => {
    const data = await catalogue.resolve('data', 'train.npz');
    const models = await catalogue.models();
    const first = models[0];
    if (!first) throw new Error('Missing model');
    return { data, model: catalogue.selectModel(first, models) };
  };
  const request = {
    backend: 'local',
    operation: 'train',
    config: { ...structuredClone(trainingDefaults), data_path: '/data/train.npz' },
    runtime: { python: '/usr/bin/python3', mode: 'existing', device: 'cpu', environment: {} },
    topology: { num_machines: 1, processes_per_machine: 1, machine_rank: 0 },
  };
  const draft = trainingRequestSchema.parse(request);
  return {
    owner,
    selections,
    draft,
    keys,
    requests,
    losePlan: (value: boolean) => {
      losePlan = value;
    },
    loseSubmit: (value: boolean) => {
      loseSubmit = value;
    },
  };
}
describe('typed training authoring', () => {
  it('covers every exported daemon-supported CLI destination without aliases or daemon-owned options', () => {
    expect(Object.keys(trainingConfigSchema.shape).sort()).toEqual(
      options.map((option) => option.name).sort(),
    );
    expect(trainingFieldMetadata.map((option) => option.name).sort()).toEqual(
      options
        .filter((option) => !['data_path', 'model'].includes(option.name))
        .map((option) => option.name)
        .sort(),
    );
    expect(trainingConfigSchema.parse(trainingDefaults)).toEqual(trainingDefaults);
  });
  it.each([
    { lr: Number.NaN },
    { lr: Infinity },
    { epochs: 0 },
    { workers: -2 },
    { batch_size: 1.5 },
    { precision: 'fp32' },
    { mixed_precision: 'fp16' },
    { output_dir: '/browser/path' },
    { betas: '0.9,nan' },
    { loss_weights: '1,Infinity' },
    { milestones: '10,x' },
  ])('rejects malformed or conflicting options %j', (patch) => {
    expect(trainingConfigSchema.safeParse({ ...trainingDefaults, ...patch }).success).toBe(false);
  });
  it('rejects reserved identity environment and out-of-range rank/topology', async () => {
    const { draft } = await setup();
    expect(
      trainingRequestSchema.safeParse({
        ...draft,
        runtime: { ...draft.runtime, environment: { WAVEDL_TOKEN: 'secret' } },
      }).success,
    ).toBe(false);
    expect(
      trainingRequestSchema.safeParse({
        ...draft,
        topology: { num_machines: 1, processes_per_machine: 1, machine_rank: 1 },
      }).success,
    ).toBe(false);
  });
  it('requires branded current-daemon selections and matching paths', async () => {
    const { owner, selections, draft } = await setup();
    const { data, model } = await selections();
    const flow = new ProjectPlan(owner);
    expect(() => flow.prepare(draft, { ...data }, model)).toThrow();
    expect(() =>
      flow.prepare(
        { ...draft, config: { ...draft.config, data_path: '/foreign/data' } },
        data,
        model,
      ),
    ).toThrow();
    owner.detach();
    expect(() => flow.prepare(draft, data, model)).toThrow();
  });
  it('retains the exact key and snapshot after lost plan acknowledgment and reconnect', async () => {
    const fixture = await setup();
    let selection = await fixture.selections();
    const flow = new ProjectPlan(fixture.owner, () => 'fixed-key');
    flow.prepare(fixture.draft, selection.data, selection.model);
    fixture.losePlan(true);
    await expect(flow.preview()).rejects.toThrow();
    fixture.losePlan(false);
    await fixture.owner.reconnect('credential');
    selection = await fixture.selections();
    flow.prepare(fixture.draft, selection.data, selection.model);
    await flow.preview();
    expect(fixture.keys).toEqual(['fixed-key', 'fixed-key']);
    expect(fixture.requests[0]).toBe(fixture.requests[1]);
  });
  it('submits only an approved immutable plan and permits outcome check after lost submit acknowledgment', async () => {
    const fixture = await setup();
    const selection = await fixture.selections();
    const flow = new ProjectPlan(fixture.owner);
    flow.prepare(fixture.draft, selection.data, selection.model);
    await expect(flow.submit()).rejects.toThrow();
    const approved = await flow.preview();
    expect(Object.isFrozen(approved.preview)).toBe(true);
    fixture.loseSubmit(true);
    await expect(flow.submit()).rejects.toThrow();
    expect(fixture.requests.at(-1)).toBe(JSON.stringify({ plan_id: ids.plan_id }));
    fixture.loseSubmit(false);
    await fixture.owner.reconnect('credential');
    expect(flow.approved).toBeNull();
    const current = await fixture.selections();
    flow.prepare(fixture.draft, current.data, current.model);
    await flow.preview();
    expect((await flow.status()).submission_requested).toBe(true);
    flow.invalidate();
    await expect(flow.submit()).rejects.toThrow();
  });
});
