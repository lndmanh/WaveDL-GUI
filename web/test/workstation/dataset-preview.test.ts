import { describe, expect, it, vi } from 'vitest';
import { CatalogApi } from '../../app/lib/catalog-api';
import { ConnectionSession } from '../../app/lib/connection-session';
import {
  DatasetPreviewApi,
  parseDatasetPreview,
  sampleMatrix,
} from '../../app/lib/dataset-preview';

export function previewFixture() {
  const histogram = {
    feature_index: 0,
    counts: [2, ...Array(31).fill(0)],
    edges: Array.from({ length: 33 }, (_, index) => index / 32),
  };
  return {
    schema_version: 1,
    identity: { st_dev: 1, st_ino: 2, st_size: 4096, st_mtime_ns: 1780000000000000000 },
    format: 'npz',
    input_key: 'X',
    output_key: 'Y',
    input_shape: [2, 2],
    output_shape: [2, 1],
    sample_indices: [0, 1],
    input_histograms: [histogram],
    output_histograms: [structuredClone(histogram)],
    correlation: { feature_indices: [0], matrix: null },
    input_statistics: { feature_indices: [0, 1], means: [0.5, null], stds: [0.5, null] },
    scatter: { feature_indices: [0], output_index: 0, x: [[0], [1]], y: [0, 1] },
    samples: [{ sample_index: 0, feature_shape: [2], shape: [2], values: [0, null] }],
    limits: {
      max_file_bytes: 67108864,
      max_decompressed_bytes: 67108864,
      max_elements: 8388608,
      max_sample_rows: 512,
      max_input_features: 65536,
      max_output_features: 256,
      max_preview_elements: 16384,
      max_output_bytes: 1048576,
      max_zip_ratio: 100,
      max_variables: 128,
      max_header_bytes: 16384,
    },
    selection: { root: 'data', path: 'wave.npz' },
    view: 'all',
  };
}
const selection = { root: 'data', relativePath: 'wave.npz' };
const health = { daemon_id: 'daemon-one', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 };
function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}
async function setup(preview: unknown = previewFixture()) {
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    const path = String(url);
    if (path.endsWith('/api/health')) return json(health);
    if (path.endsWith('/api/browse/resolve'))
      return json({
        root: 'data',
        relative_path: 'wave.npz',
        path: '/srv/data/wave.npz',
        kind: 'file',
      });
    return json(preview);
  });
  const session = new ConnectionSession({
    origin: 'http://localhost:8765',
    buildId: '1.8.1',
    fetcher,
  });
  await session.connect('token');
  const chosen = await new CatalogApi(session).resolve('data', 'wave.npz');
  return { session, chosen, fetcher, api: new DatasetPreviewApi(session) };
}
describe('bounded dataset browser contract', () => {
  it('accepts unavailable correlation for one sampled row with multiple outputs', () => {
    const body = previewFixture();
    body.input_shape = [1, 2];
    body.output_shape = [1, 2];
    body.sample_indices = [0];
    body.input_histograms[0]!.counts[0] = 1;
    body.output_histograms[0]!.counts[0] = 1;
    body.scatter.x = [[0]];
    body.scatter.y = [0];
    body.correlation.feature_indices = [0, 1];
    expect(parseDatasetPreview(body, selection, 'all').correlation.matrix).toBeNull();
    expect(() =>
      parseDatasetPreview(
        {
          ...body,
          correlation: {
            feature_indices: [0, 1],
            matrix: [
              [1, 0],
              [0, 1],
            ],
          },
        },
        selection,
        'all',
      ),
    ).toThrow('Invalid bounded');
  });
  it.each(['npz', 'mat', 'h5', 'hdf5'])(
    'accepts %s with finite/null bounded numeric data',
    (format) => {
      const path = `wave.${format}`;
      const data = parseDatasetPreview(
        { ...previewFixture(), format, selection: { root: 'data', path } },
        { root: 'data', relativePath: path },
        'all',
      );
      expect(data.input_statistics.means).toEqual([0.5, null]);
      const sample = data.samples[0];
      if (!sample) throw new Error('fixture missing');
      expect(sampleMatrix(sample)).toEqual([[0, null]]);
    },
  );
  it.each([
    (data: ReturnType<typeof previewFixture>) => {
      data.format = 'mat';
    },
    (data: ReturnType<typeof previewFixture>) => {
      data.selection.root = 'other';
    },
    (data: ReturnType<typeof previewFixture>) => {
      data.selection.path = '../wave.npz';
    },
    (data: ReturnType<typeof previewFixture>) => {
      data.view = 'sample';
    },
    (data: ReturnType<typeof previewFixture>) => {
      data.sample_indices = [0, 0];
    },
    (data: ReturnType<typeof previewFixture>) => {
      data.input_shape = [2, 65537];
    },
    (data: ReturnType<typeof previewFixture>) => {
      data.output_shape = [3, 1];
    },
    (data: ReturnType<typeof previewFixture>) => {
      data.input_histograms[0]!.counts[0] = 3;
    },
    (data: ReturnType<typeof previewFixture>) => {
      data.input_histograms[0]!.edges[2] = -3;
    },
    (data: ReturnType<typeof previewFixture>) => {
      data.input_statistics.means[0] = Infinity;
    },
    (data: ReturnType<typeof previewFixture>) => {
      data.input_statistics.stds[0] = -1;
    },
    (data: ReturnType<typeof previewFixture>) => {
      data.scatter.x = [[0]];
    },
    (data: ReturnType<typeof previewFixture>) => {
      data.samples.push(structuredClone(data.samples[0]!));
    },
    (data: ReturnType<typeof previewFixture>) => {
      data.samples[0]!.values = [0];
    },
    (data: ReturnType<typeof previewFixture>) => {
      data.limits.max_sample_rows = 513;
    },
    (data: ReturnType<typeof previewFixture>) => {
      data.limits.max_output_bytes = 10;
    },
    (data: ReturnType<typeof previewFixture>) => {
      data.input_key = 'x'.repeat(1048576);
    },
  ])('rejects malformed, retargeted or over-budget data', (mutate) => {
    const body = previewFixture();
    mutate(body);
    expect(() => parseDatasetPreview(body, selection, 'all')).toThrow('Invalid bounded');
  });
  it('sends only root-relative authority, never daemon absolute path/download URL', async () => {
    const { api, chosen, fetcher } = await setup();
    expect((await api.preview(chosen, 'all')).selection).toEqual({
      root: 'data',
      path: 'wave.npz',
    });
    const call = fetcher.mock.calls.find(([url]) => String(url).endsWith('/api/datasets/preview'));
    expect(call?.[1]?.body).toBe(JSON.stringify({ root: 'data', path: 'wave.npz', view: 'all' }));
  });
  it('refuses copied selections and stale same-daemon scopes without requests', async () => {
    const { api, chosen, fetcher, session } = await setup();
    const before = fetcher.mock.calls.length;
    await expect(api.preview({ ...chosen }, 'all')).rejects.toMatchObject({ code: 'stale' });
    expect(fetcher).toHaveBeenCalledTimes(before);
    await session.reconnect('token');
    await expect(api.preview(chosen, 'all')).rejects.toMatchObject({ code: 'stale' });
  });
  it('refuses cancelled work and malformed responses', async () => {
    const { api, chosen, session } = await setup({ ...previewFixture(), view: 'scatter' });
    await expect(api.preview(chosen, 'all')).rejects.toMatchObject({ code: 'response' });
    expect(session.api).toBeNull();
    const current = await setup();
    const controller = new AbortController();
    controller.abort();
    await expect(
      current.api.preview(current.chosen, 'all', controller.signal),
    ).rejects.toBeDefined();
  });
});
