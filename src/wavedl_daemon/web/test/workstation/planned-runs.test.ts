import { describe, expect, it, vi } from 'vitest';
import { DaemonApi } from '../../app/lib/daemon-api';
import { RequestApproval } from '../../app/lib/request-approval';
import { runCounts, runFilterOf } from '../../app/lib/run-overview';
import { datasetSuggestions } from '../../app/lib/dataset-suggestions';
import { canRequestCancellation, RunMonitor } from '../../app/lib/run-monitor';
import {
  loadProjectDraft,
  saveProjectDraft,
  unbindProjectDraft,
} from '../../app/lib/project-draft';
import { trainingDefaults, trainingRequestSchema } from '../../shared/schemas/training-request';
import type { RunView } from '../../types/daemon-api';
import type { FixtureResponse } from './fixture-schemas';
import { ConnectionSession } from './session-fixture';

const origin = 'http://localhost:8765';
const health = { daemon_id: 'daemon', build_id: 'build', protocol_min: 1, protocol_max: 1 };
const runId = '22222222-2222-4222-8222-222222222222';
const otherId = '55555555-5555-4555-8555-555555555555';

const plan = {
  run_id: runId,
  plan_id: '33333333-3333-4333-8333-333333333333',
  request_id: '44444444-4444-4444-8444-444444444444',
  preview: { argv: ['train'] },
};

const planned: RunView = {
  ...plan,
  backend: 'local',
  operation: 'train',
  state: 'planned',
  attempt: null,
  uncertainty: false,
  submission_requested: false,
  cancellation_requested: false,
  evidence: null,
};

const started: RunView = { ...planned, state: 'submitted', submission_requested: true };

function json(value: FixtureResponse, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function client(handler: typeof fetch) {
  const fetcher = vi.fn<typeof fetch>(async (input, init) =>
    new URL(String(input)).pathname === '/api/health' ? json(health) : handler(input, init),
  );

  const api = new DaemonApi(origin, {}, fetcher);
  api.setToken('token');

  return { api, fetcher };
}

describe('planned run transport', () => {
  it('replans in place with PUT, one key header, and an approved immutable request', async () => {
    const { api, fetcher } = client(async () => json(plan));
    const request = { config: { epochs: 5 } };
    const approved = await api.replan(runId, request, 'same-request');
    const call = fetcher.mock.lastCall;
    expect(String(call?.[0])).toBe(`${origin}/api/runs/${runId}/plan`);
    expect(call?.[1]?.method).toBe('PUT');
    const headers = new Headers(call?.[1]?.headers);
    expect(headers.get('Idempotency-Key')).toBe('same-request');
    expect(headers.get('X-WaveDL-Daemon-ID')).toBe('daemon');
    expect(call?.[1]?.body).toBe(JSON.stringify(request));
    request.config.epochs = 99;
    expect(api.approvedRequest(approved)).toEqual({ config: { epochs: 5 } });
    expect(Object.isFrozen(approved.preview)).toBe(true);
  });

  it('rejects a replan response for another run and malformed inputs', async () => {
    const { api, fetcher } = client(async () => json({ ...plan, run_id: otherId }));
    await expect(api.replan(runId, {}, 'key')).rejects.toMatchObject({ code: 'response' });
    fetcher.mockClear();
    await expect(api.replan('bad', {}, 'key')).rejects.toMatchObject({ code: 'identity' });
    await expect(api.replan(runId, {}, 'bad\r\nkey')).rejects.toMatchObject({ code: 'response' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('approves only freshly fetched plan objects and revokes them with the connection', async () => {
    const { api } = client(async (input) =>
      json(new URL(String(input)).pathname === '/api/runs' ? started : plan),
    );

    const unapproved = await api.getRunPlan(runId);
    await expect(api.submit(unapproved)).rejects.toMatchObject({ code: 'identity' });
    const approved = await api.approveRunPlan(runId);
    await expect(api.submit(approved)).resolves.toMatchObject({ state: 'submitted' });
    await expect(api.submit({ ...approved })).rejects.toMatchObject({ code: 'identity' });
    expect(() => api.approvedRequest(approved)).toThrow();
    api.clearToken();
    api.setToken('replacement');
    await expect(api.submit(approved)).rejects.toMatchObject({ code: 'identity' });
  });

  it('checks fetched plan ownership and rejects credentials changing during the read', async () => {
    const wrong = client(async () => json({ ...plan, run_id: otherId }));
    await expect(wrong.api.approveRunPlan(runId)).rejects.toMatchObject({ code: 'response' });
    let change: () => void = () => undefined;

    const { api } = client(async () => {
      change();

      return json(plan);
    });

    change = () => {
      api.clearToken();
    };

    await expect(api.approveRunPlan(runId)).rejects.toMatchObject({ code: 'authentication' });
  });

  it('deletes with DELETE and accepts the empty 204 without parsing JSON', async () => {
    const { api, fetcher } = client(async () => new Response(null, { status: 204 }));
    await expect(api.deleteRun(runId)).resolves.toBeUndefined();
    expect(fetcher.mock.lastCall?.[1]?.method).toBe('DELETE');
    expect(fetcher.mock.lastCall?.[1]?.body).toBeUndefined();
    expect(String(fetcher.mock.lastCall?.[0])).toBe(`${origin}/api/runs/${runId}`);
    fetcher.mockClear();
    await expect(api.deleteRun('invalid')).rejects.toMatchObject({ code: 'identity' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([404, 409])('preserves delete and replan conflict status %s', async (status) => {
    const { api } = client(async () => new Response(null, { status }));
    await expect(api.deleteRun(runId)).rejects.toMatchObject({ status });
    await expect(api.replan(runId, {}, 'key')).rejects.toMatchObject({ status });
  });
});

const errors: Parameters<RequestApproval['preview']>[0] = {
  requestRequired: 'validateTheTrainingDraftFirst',
  validationRequired: 'catalogSelectionStale',
  draftChanged: 'planningDraftChanged',
};

async function approvalFixture(putStatus = 200, getStatus = 200, state = 'planned') {
  const mutations: Array<{ method: string | undefined; path: string; key: string | null }> = [];

  const session = new ConnectionSession({
    origin,
    buildId: 'build',
    fetcher: async (input, init) => {
      const path = new URL(String(input)).pathname;

      if (path === '/api/health') return json(health);

      if (init?.method === 'PUT' || init?.method === 'POST') {
        mutations.push({
          method: init.method,
          path,
          key: new Headers(init.headers).get('Idempotency-Key'),
        });

        if (init.method === 'PUT' && putStatus !== 200)
          return new Response(null, { status: putStatus });

        return json(plan);
      }

      if (getStatus !== 200) return new Response(null, { status: getStatus });

      return json({ ...planned, state });
    },
  });

  expect(await session.connect('token')).toBe(true);
  let generation = 0;
  const approval = new RequestApproval(session, () => `key-${++generation}`);
  const bind = vi.fn<(id: string | null) => void>();
  approval.prepare({ config: { epochs: 5 } });

  return { approval, bind, mutations };
}

describe('draft-owned plan binding', () => {
  it('creates once, edits in place, and rotates the key only for changed content', async () => {
    const { approval, bind, mutations } = await approvalFixture();
    await approval.preview(errors, undefined, { runId: null, bind });
    expect(bind).toHaveBeenLastCalledWith(runId);
    const key = approval.key;
    approval.invalidate();
    approval.prepare({ config: { epochs: 5 } });
    await approval.preview(errors, undefined, { runId, bind });
    expect(approval.key).toBe(key);
    approval.invalidate();
    approval.prepare({ config: { epochs: 6 } });
    await approval.preview(errors, undefined, { runId, bind });
    expect(mutations.map((item) => item.method)).toEqual(['POST', 'PUT', 'PUT']);
    expect(mutations.map((item) => item.key)).toEqual([key, key, approval.key]);
    expect(approval.key).not.toBe(key);
  });

  it.each([
    { put: 404, get: 200, state: 'planned' },
    { put: 409, get: 200, state: 'submitted' },
    { put: 409, get: 404, state: 'planned' },
  ])('unbinds and creates once after a gone/started plan: %j', async ({ put, get, state }) => {
    const { approval, bind, mutations } = await approvalFixture(put, get, state);
    await approval.preview(errors, undefined, { runId, bind });
    expect(bind.mock.calls).toEqual([[null], [runId]]);
    expect(mutations.map((item) => item.method)).toEqual(['PUT', 'POST']);
    expect(mutations[0]?.key).toBe(mutations[1]?.key);
  });

  it('does not manufacture another row for an idempotency conflict on a still-planned run', async () => {
    const { approval, bind, mutations } = await approvalFixture(409);
    await expect(approval.preview(errors, undefined, { runId, bind })).rejects.toMatchObject({
      status: 409,
    });
    expect(mutations.map((item) => item.method)).toEqual(['PUT']);
    expect(bind).not.toHaveBeenCalled();
    expect(approval.approved).toBeNull();
  });

  it('does not fall back after invalid requests or unavailable status authority', async () => {
    for (const [put, get] of [
      [400, 200],
      [409, 503],
    ]) {
      const { approval, bind, mutations } = await approvalFixture(put, get);
      await expect(approval.preview(errors, undefined, { runId, bind })).rejects.toBeInstanceOf(
        Error,
      );
      expect(mutations).toHaveLength(1);
      expect(bind).not.toHaveBeenCalled();
    }
  });
});

it('polls planned authority without requesting a journal and accepts a rotated plan identity', async () => {
  vi.useFakeTimers();
  let current: RunView = planned;
  const openEvents = vi.fn(async () => new Response(''));
  const failure = vi.fn();

  const monitor = new RunMonitor(
    runId,
    {
      getRun: async () => current,
      openEvents,
      cancelRun: async () => current,
    },
    50,
    failure,
  );

  const running = monitor.start();

  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.snapshot().run?.state).toBe('planned');
    expect(openEvents).not.toHaveBeenCalled();
    current = { ...planned, plan_id: otherId, request_id: otherId };
    await vi.advanceTimersByTimeAsync(100);
    expect(monitor.snapshot().run?.plan_id).toBe(otherId);
    expect(monitor.snapshot().freshness).toBe('fresh');
    expect(failure).not.toHaveBeenCalled();
    expect(openEvents).not.toHaveBeenCalled();
    current = { ...current, state: 'submitted', submission_requested: true };
    await vi.advanceTimersByTimeAsync(100);
    expect(monitor.snapshot().run?.state).toBe('submitted');
    expect(openEvents).toHaveBeenCalled();
    expect(failure).not.toHaveBeenCalled();
  } finally {
    monitor.stop();
    await running;
    vi.useRealTimers();
  }
});

it('persists binding with the draft, preserves older drafts, and unbinds without losing configuration', () => {
  const values = new Map<string, string>();

  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };

  const request = trainingRequestSchema.parse({
    backend: 'local',
    operation: 'train',
    config: { ...trainingDefaults, data_path: '/data/train.npz', model: 'cnn' },
    runtime: { python: '/usr/bin/python3', mode: 'existing', device: 'cpu', environment: {} },
    topology: { num_machines: 1, processes_per_machine: 1, machine_rank: 0 },
  });

  const snapshot = { block: 'plan', data: null, model: null, request, setup: 'manual' };
  expect(
    saveProjectDraft(
      'daemon',
      { ...snapshot, block: 'plan', setup: 'manual', plannedRunId: runId },
      storage,
    ),
  ).toBe(true);
  expect(loadProjectDraft('daemon', storage)?.plannedRunId).toBe(runId);
  unbindProjectDraft('daemon', otherId, storage);
  expect(loadProjectDraft('daemon', storage)?.plannedRunId).toBe(runId);
  unbindProjectDraft('daemon', runId, storage);
  const restored = loadProjectDraft('daemon', storage);
  expect(restored?.plannedRunId).toBeUndefined();
  expect(restored?.config.epochs).toBe(request.config.epochs);
  expect(saveProjectDraft('daemon', { ...snapshot, block: 'plan', setup: 'manual' }, storage)).toBe(
    true,
  );
  expect(loadProjectDraft('daemon', storage)?.plannedRunId).toBeUndefined();
});

it('counts planned rows in All and Planned but excludes them from used datasets and cancellation', () => {
  expect(runFilterOf(planned)).toBe('planned');
  expect(runCounts([planned])).toEqual({ all: 1, planned: 1, live: 0, completed: 0, attention: 0 });
  expect(canRequestCancellation(planned, 'idle')).toBe(false);
  expect(
    datasetSuggestions([
      {
        ...planned,
        summary: {
          name: null,
          data_path: '/data/train.npz',
          model: 'cnn',
          epochs: 5,
          cv: 1,
          source_run_id: null,
        },
      },
    ]),
  ).toEqual([]);
});
