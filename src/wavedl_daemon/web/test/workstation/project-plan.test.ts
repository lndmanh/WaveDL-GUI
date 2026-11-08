import { describe, expect, it, vi } from 'vitest';
import { CatalogApi } from '../../app/lib/catalog-api';
import { ProjectPlan } from '../../app/lib/project-plan';
import { trainingDefaults, trainingRequestSchema } from '../../shared/schemas/training-request';
import type { FixtureResponse } from './fixture-schemas';
import { ConnectionSession } from './session-fixture';

const ids = {
  run_id: '22222222-2222-4222-8222-222222222222',
  plan_id: '33333333-3333-4333-8333-333333333333',
  request_id: '44444444-4444-4444-8444-444444444444',
};

function json(body: FixtureResponse, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function setup(
  options: {
    planResponse?: () => Response | Promise<Response>;
    runIdentity?: Partial<typeof ids>;
  } = {},
) {
  const keys: Array<string | null> = [];
  const bodies: string[] = [];
  const submissions: string[] = [];

  const session = new ConnectionSession({
    origin: 'http://localhost:8765',
    buildId: '1.8.1',
    fetcher: async (input, init) => {
      const path = new URL(String(input)).pathname;

      if (path === '/api/health')
        return json({ daemon_id: 'd', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 });

      if (path === '/api/browse/resolve')
        return json({
          root: 'data',
          relative_path: 'train.npz',
          kind: 'file',
          path: '/data/train.npz',
        });

      if (path === '/api/runs/plan') {
        keys.push(new Headers(init?.headers).get('Idempotency-Key'));
        bodies.push(String(init?.body));

        return options.planResponse?.() ?? json({ ...ids, preview: { argv: ['train'] } });
      }

      if (path === '/api/runs') submissions.push(String(init?.body));

      return json({
        ...ids,
        ...options.runIdentity,
        backend: 'local',
        operation: 'train',
        attempt: null,
        state: 'submitted',
        uncertainty: false,
        submission_requested: true,
        cancellation_requested: false,
        evidence: null,
      });
    },
  });

  expect(await session.connect('token')).toBe(true);
  const catalogue = new CatalogApi(session);
  const data = await catalogue.resolve('data', 'train.npz');
  const model = await catalogue.selectCustomModel('cnn');

  const draft = trainingRequestSchema.parse({
    backend: 'local',
    operation: 'train',
    config: { ...trainingDefaults, data_path: data.path, model: model.model },
    runtime: { python: '/usr/bin/python3', mode: 'existing', device: 'cpu', environment: {} },
    topology: { num_machines: 1, processes_per_machine: 1, machine_rank: 0 },
  });

  const keyFactory = vi.fn(() => `training-key-${keys.length}`);

  return {
    session,
    catalogue,
    data,
    model,
    draft,
    keys,
    bodies,
    submissions,
    keyFactory,
    workflow: new ProjectPlan(session, keyFactory),
  };
}

describe('training request approval lifecycle', () => {
  it('requires preparation and approval before daemon-facing actions', async () => {
    const { workflow, keys, submissions } = await setup();

    await expect(workflow.preview()).rejects.toMatchObject({
      clientMessageKey: 'validateTheTrainingDraftFirst',
    });
    await expect(workflow.submit()).rejects.toMatchObject({
      clientMessageKey: 'trainingPreviewRequired',
    });
    await expect(workflow.status()).rejects.toMatchObject({
      clientMessageKey: 'submissionPreviewRequired',
    });
    expect(workflow.key).toBe('');
    expect(keys).toEqual([]);
    expect(submissions).toEqual([]);
  });

  it('reuses the normalized request key and rotates it only when the request changes', async () => {
    const { workflow, draft, data, model, keys, bodies, keyFactory } = await setup();
    workflow.prepare(draft, data, model);
    const key = workflow.key;
    await workflow.preview();
    workflow.prepare({ ...draft, storage_map: [] }, data, model);
    expect(workflow.approved).toBeNull();
    await workflow.preview();
    expect(keys).toEqual([key, key]);
    expect(bodies[0]).toBe(bodies[1]);
    expect(keyFactory).toHaveBeenCalledTimes(1);
    workflow.prepare(
      { ...draft, config: { ...draft.config, epochs: draft.config.epochs + 1 } },
      data,
      model,
    );
    expect(workflow.key).not.toBe(key);
    await workflow.preview();
    expect(keys[2]).toBe(workflow.key);
    expect(keyFactory).toHaveBeenCalledTimes(2);
    workflow.invalidate();
    workflow.prepare(
      { ...draft, config: { ...draft.config, epochs: draft.config.epochs + 1 } },
      data,
      model,
    );
    expect(workflow.key).toBe(keys[2]);
  });

  it('does not retain a new fingerprint when key generation fails', async () => {
    const { workflow, draft, data, model, keys, keyFactory } = await setup();
    keyFactory.mockImplementationOnce(() => {
      throw new Error('Key generation failed');
    });
    expect(() => workflow.prepare(draft, data, model)).toThrow('Key generation failed');
    expect(workflow.key).toBe('');
    expect(workflow.approved).toBeNull();
    workflow.prepare(draft, data, model);
    await workflow.preview();
    expect(keyFactory).toHaveBeenCalledTimes(2);
    expect(keys).toEqual([workflow.key]);
    expect(workflow.key).not.toBe('');
  });

  it('reuses the key when retrying a failed preview of the same request', async () => {
    let attempts = 0;

    const { workflow, draft, data, model, keys } = await setup({
      planResponse: () => {
        attempts++;

        return attempts === 1 ? json({ error: 'Try again' }, 409) : json({ ...ids, preview: {} });
      },
    });

    workflow.prepare(draft, data, model);
    await expect(workflow.preview()).rejects.toThrow();
    expect(workflow.approved).toBeNull();
    workflow.prepare(draft, data, model);
    await workflow.preview();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('retains the exact daemon-approved plan object for submit and status', async () => {
    const { workflow, draft, data, model, session, submissions } = await setup();
    workflow.prepare(draft, data, model);
    const plan = await workflow.preview();
    expect(workflow.approved).toBe(plan);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.preview.argv)).toBe(true);
    const api = session.api;

    if (!api) throw new Error('Missing connected API');
    expect(api.approvedRequest(plan)).toEqual(draft);
    expect(() => api.approvedRequest({ ...plan })).toThrow();
    expect((await workflow.submit()).run_id).toBe(ids.run_id);
    expect((await workflow.status()).plan_id).toBe(ids.plan_id);
    expect(submissions).toEqual([JSON.stringify({ plan_id: ids.plan_id })]);
  });

  it('clears prior approval even when preparing the same draft', async () => {
    const { workflow, draft, data, model, submissions } = await setup();
    workflow.prepare(draft, data, model);
    await workflow.preview();
    const key = workflow.key;
    workflow.prepare(draft, data, model);
    expect(workflow.approved).toBeNull();
    expect(workflow.key).toBe(key);
    await expect(workflow.submit()).rejects.toThrow();
    await expect(workflow.status()).rejects.toThrow();
    expect(submissions).toEqual([]);
  });

  it.each(['data', 'model', 'schema', 'mismatch'])(
    'clears prior request and approval when %s validation fails',
    async (failure) => {
      const { workflow, draft, data, model, keys } = await setup();
      workflow.prepare(draft, data, model);
      await workflow.preview();
      const key = workflow.key;
      expect(() => {
        if (failure === 'data') workflow.prepare(draft, { ...data }, model);
        else if (failure === 'model') workflow.prepare(draft, data, { ...model });
        else if (failure === 'schema')
          workflow.prepare({ ...draft, config: { ...draft.config, lr: -1 } }, data, model);
        else
          workflow.prepare({ ...draft, config: { ...draft.config, model: 'other' } }, data, model);
      }).toThrow();
      expect(workflow.approved).toBeNull();
      expect(workflow.key).toBe(key);
      await expect(workflow.preview()).rejects.toMatchObject({
        clientMessageKey: 'validateTheTrainingDraftFirst',
      });
      await expect(workflow.submit()).rejects.toThrow();
      expect(keys).toHaveLength(1);
    },
  );

  it.each(['invalidate', 'same request', 'changed request', 'invalid request'])(
    'rejects a late preview after %s',
    async (change) => {
      let release = () => {};

      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      const { workflow, draft, data, model, keys } = await setup({
        planResponse: async () => {
          await gate;

          return json({ ...ids, preview: {} });
        },
      });

      workflow.prepare(draft, data, model);

      const preview = expect(workflow.preview()).rejects.toMatchObject({
        clientMessageKey: 'planningDraftChanged',
      });

      await vi.waitFor(() => expect(keys).toHaveLength(1));

      if (change === 'invalidate') workflow.invalidate();
      else if (change === 'same request') workflow.prepare(draft, data, model);
      else if (change === 'changed request')
        workflow.prepare(
          { ...draft, config: { ...draft.config, epochs: draft.config.epochs + 1 } },
          data,
          model,
        );
      else expect(() => workflow.prepare(draft, { ...data }, model)).toThrow();
      release();
      await preview;
      expect(workflow.approved).toBeNull();
      await expect(workflow.submit()).rejects.toThrow();
    },
  );

  it('requires fresh selections after reconnect before sending a preview', async () => {
    const { workflow, draft, data, model, session, catalogue, keys } = await setup();
    workflow.prepare(draft, data, model);
    const key = workflow.key;
    expect(await session.reconnect('replacement')).toBe(true);
    await expect(workflow.preview()).rejects.toMatchObject({
      clientMessageKey: 'catalogSelectionStale',
    });
    expect(keys).toEqual([]);
    expect(workflow.approved).toBeNull();
    expect(() => workflow.prepare(draft, data, model)).toThrow();
    const currentData = await catalogue.resolve('data', 'train.npz');
    const currentModel = await catalogue.selectCustomModel('cnn');
    workflow.prepare(draft, currentData, currentModel);
    await workflow.preview();
    expect(keys).toEqual([key]);
  });

  it('revokes approval on reconnect and does not revive it with stale selections', async () => {
    const { workflow, draft, data, model, session, submissions } = await setup();
    workflow.prepare(draft, data, model);
    await workflow.preview();
    expect(await session.reconnect('replacement')).toBe(true);
    expect(workflow.approved).toBeNull();
    await expect(workflow.submit()).rejects.toThrow();
    await expect(workflow.status()).rejects.toThrow();
    expect(() => workflow.prepare(draft, data, model)).toThrow();
    expect(workflow.approved).toBeNull();
    expect(submissions).toEqual([]);
  });

  it('rejects an in-flight preview across reconnect', async () => {
    let release = () => {};

    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const { workflow, draft, data, model, session, keys } = await setup({
      planResponse: async () => {
        await gate;

        return json({ ...ids, preview: {} });
      },
    });

    workflow.prepare(draft, data, model);
    const preview = expect(workflow.preview()).rejects.toThrow();
    await vi.waitFor(() => expect(keys).toHaveLength(1));
    expect(await session.reconnect('replacement')).toBe(true);
    release();
    await preview;
    expect(workflow.approved).toBeNull();
  });

  it.each(['plan_id', 'request_id'])('rejects status with a foreign %s', async (field) => {
    const { workflow, draft, data, model } = await setup({
      runIdentity: { [field]: '55555555-5555-4555-8555-555555555555' },
    });

    workflow.prepare(draft, data, model);
    await workflow.preview();
    await expect(workflow.status()).rejects.toMatchObject({ code: 'identity' });
  });
});
