import { afterEach, describe, expect, it, vi } from 'vitest';
import { CatalogApi } from '../../app/lib/catalog-api';
import type { Json } from '../../app/lib/daemon-api';
import {
  DatasetPreviewApi,
  DatasetPreviewPickleRequiredError,
  parseDatasetPreview,
  sampleMatrix,
  type DatasetPreview,
} from '../../app/lib/dataset-preview';
import { ConnectionSession } from './session-fixture';

const health = { daemon_id: 'daemon-one', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 };
const selection = { root: 'data', relativePath: 'train.npz' };

function histogram(count: number) {
  return {
    feature_index: 0,
    counts: Array.from({ length: 32 }, (_, index) => index === 0 ? count : 0),
    edges: Array.from({ length: 33 }, (_, index) => index),
  };
}

function preview(patch: Partial<DatasetPreview> = {}): DatasetPreview {
  return {
    schema_version: 1,
    format: 'npz',
    input_key: 'X',
    output_key: 'Y',
    input_shape: [3, 2],
    output_shape: [3, 1],
    sample_indices: [0, 1, 2],
    input_sample_indices: [0, 2],
    input_histograms: [histogram(2)],
    output_histograms: [histogram(3)],
    correlation: { feature_indices: [0], matrix: null },
    input_statistics: { feature_indices: [0], means: [3], stds: [2] },
    scatter: { feature_indices: [0], output_index: 0, x: [[1], [5]], y: [10, 30] },
    samples: [{ sample_index: 0, feature_shape: [2], shape: [2], values: [1, 2] }],
    selection: { root: selection.root, path: selection.relativePath },
    ...patch,
  };
}

function json(body: Json, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

async function setup(respond: (signal?: AbortSignal | null) => Response | Promise<Response>) {
  let observedHealth = health;
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith('/api/health')) return json(observedHealth);

    if (String(url).endsWith('/api/browse/resolve'))
      return json({ root: 'data', relative_path: 'train.npz', path: '/srv/train.npz', kind: 'file' });

    return respond(init?.signal);
  });

  const session = new ConnectionSession({ origin: 'http://localhost:8765', buildId: '1.8.1', fetcher });
  expect(await session.connect('token')).toBe(true);
  const selected = await new CatalogApi(session).resolve('data', 'train.npz');
  const requests = () => fetcher.mock.calls.filter(([url]) => String(url).endsWith('/api/datasets/preview'));

  return {
    session,
    selected,
    api: new DatasetPreviewApi(session),
    requests,
    replaceDaemon: () => { observedHealth = { ...health, daemon_id: 'different-daemon' }; },
  };
}

afterEach(() => vi.useRealTimers());

describe('dataset preview responses', () => {
  it('validates input summaries and scatter against their own rows, not the output rows', () => {
    expect(parseDatasetPreview(preview(), selection)).toEqual(preview());

    for (const patch of [
      { input_sample_indices: [1, 0] },
      { input_sample_indices: [0, 3] },
      { sample_indices: [0, 2], input_sample_indices: [0, 1] },
      { input_histograms: [histogram(3)] },
      { output_histograms: [histogram(4)] },
      { scatter: { feature_indices: [0], output_index: 0, x: [[1], [3], [5]], y: [10, 20, 30] } },
      { samples: [{ sample_index: 1, feature_shape: [2], shape: [2], values: [1, 2] }] },
      { selection: { root: 'other', path: 'train.npz' } },
      { view: 'all' },
      { identity: {} },
      { limits: {} },
    ]) {
      expect(() => parseDatasetPreview({ ...preview(), ...patch }, selection)).toThrow();
    }
  });

  it('accepts large original shapes and renders the returned downsampled shape', () => {
    const value = preview({
      input_shape: [131072, 500, 500],
      output_shape: [131072, 1],
      sample_indices: [0, 65535, 131071],
      input_sample_indices: [0, 131071],
      samples: [{
        sample_index: 0,
        feature_shape: [500, 500],
        shape: [125, 125],
        values: Array.from({ length: 125 }, () => Array.from({ length: 125 }, () => 1)),
      }],
    });

    const result = parseDatasetPreview(value, selection);
    const sample = result.samples[0];

    if (!sample) throw new Error('Missing sample fixture');
    const matrix = sampleMatrix(sample);
    expect(matrix).toHaveLength(125);
    expect(matrix.every((row) => row.length === 125)).toBe(true);
    expect(sample.feature_shape).toEqual([500, 500]);
  });
});

describe('dataset preview polling', () => {
  it('polls 202 to 200 with an identical body and no removed view field', async () => {
    let count = 0;
    const { api, selected, requests, session } = await setup(() =>
      ++count === 1 ? json({ status: 'pending' }, 202) : json(preview()),
    );
    vi.useFakeTimers();
    const task = api.preview(selected);
    const result = expect(task).resolves.toEqual(preview());
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);
    await result;
    expect(requests()).toHaveLength(2);
    const bodies = requests().map(([, init]) => init?.body);
    expect(bodies).toEqual([
      JSON.stringify({ root: 'data', path: 'train.npz', allow_pickle: false }),
      JSON.stringify({ root: 'data', path: 'train.npz', allow_pickle: false }),
    ]);
    expect(session.snapshot().status).toBe('connected');
    expect(vi.getTimerCount()).toBe(0);
    session.detach();
  });

  it('reports HTTP 409 as a typed pickle-required error without inspecting message text', async () => {
    const { api, selected, session } = await setup(() => json({ error: 'arbitrary text' }, 409));
    await expect(api.preview(selected)).rejects.toBeInstanceOf(DatasetPreviewPickleRequiredError);
    expect(session.snapshot().status).toBe('connected');
    session.detach();
  });

  it('forwards an explicit pickle opt-in on every poll', async () => {
    let count = 0;
    const { api, selected, requests, session } = await setup(() =>
      ++count === 1 ? json({ status: 'pending' }, 202) : json(preview()),
    );
    vi.useFakeTimers();
    const task = api.preview(selected, { allow_pickle: true });
    const result = expect(task).resolves.toEqual(preview());
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);
    await result;
    expect(requests().map(([, init]) => init?.body)).toEqual([
      JSON.stringify({ root: 'data', path: 'train.npz', allow_pickle: true }),
      JSON.stringify({ root: 'data', path: 'train.npz', allow_pickle: true }),
    ]);
    session.detach();
  });

  it('stops further requests when aborted between polls', async () => {
    const { api, selected, requests, session } = await setup(() => json({ status: 'pending' }, 202));
    vi.useFakeTimers();
    const controller = new AbortController();
    const task = api.preview(selected, { signal: controller.signal });
    const result = expect(task).rejects.toMatchObject({ code: 'stale' });
    await vi.advanceTimersByTimeAsync(0);
    expect(requests()).toHaveLength(1);
    controller.abort();
    await result;
    await vi.advanceTimersByTimeAsync(10000);
    expect(requests()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(session.snapshot().status).toBe('connected');
    session.detach();
  });

  it('stops polling when the connection scope ends', async () => {
    const { api, selected, requests, session } = await setup(() => json({ status: 'pending' }, 202));
    vi.useFakeTimers();
    const task = api.preview(selected);
    const result = expect(task).rejects.toMatchObject({ code: 'stale' });
    await vi.advanceTimersByTimeAsync(0);
    session.detach();
    await result;
    await vi.advanceTimersByTimeAsync(10000);
    expect(requests()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('allows an individual poll to take longer than the backend’s 15-second wait', async () => {
    const { api, selected, session } = await setup((signal) =>
      new Promise((resolve, reject) => {
        const finish = () => {
          signal?.removeEventListener('abort', abort);
          resolve(json(preview()));
        };

        const abort = () => {
          clearTimeout(timer);
          reject(new Error('Request aborted'));
        };

        const timer = setTimeout(finish, 16000);
        signal?.addEventListener('abort', abort, { once: true });
      }),
    );
    vi.useFakeTimers();
    const task = api.preview(selected);
    const result = expect(task).resolves.toEqual(preview());
    await vi.advanceTimersByTimeAsync(16000);
    await result;
    expect(vi.getTimerCount()).toBe(0);
    session.detach();
  });

  it('ends a pending job at the overall 20-minute deadline and clears its poll timer', async () => {
    const { api, selected, requests, session } = await setup(() => json({ status: 'pending' }, 202));
    vi.useFakeTimers();
    const task = api.preview(selected);
    const result = expect(task).rejects.toMatchObject({ code: 'request' });
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    await result;
    const count = requests().length;
    expect(count).toBeGreaterThan(1);
    await vi.advanceTimersByTimeAsync(10000);
    expect(requests()).toHaveLength(count);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not confuse a daemon-identity HTTP 409 with a trust prompt', async () => {
    const { api, selected, session, replaceDaemon } = await setup(() => json(preview()));
    replaceDaemon();
    await expect(api.preview(selected)).rejects.toMatchObject({ code: 'identity' });
    expect(session.snapshot().status).toBe('skew');
  });

  it('keeps final 400 and 503 errors local to the request', async () => {
    for (const status of [400, 503]) {
      const { api, selected, session } = await setup(() => json({ error: 'Could not preview' }, status));
      await expect(api.preview(selected)).rejects.toMatchObject({ code: 'request', status });
      expect(session.snapshot().status).toBe('connected');
      session.detach();
    }
  });
});
