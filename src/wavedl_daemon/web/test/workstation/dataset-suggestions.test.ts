import { expect, test } from 'vitest';
import {
  datasetFormat,
  datasetInputDimensions,
  datasetOutputValues,
  datasetSuggestions,
  loadDatasetSuggestions,
  MAX_FAILED_DATASET_SUGGESTIONS,
  MAX_RECENT_DATASET_RUNS,
} from '../../app/lib/dataset-suggestions';
import type { RunView } from '../../types/daemon-api';
import { CatalogApi } from '../../app/lib/catalog-api';
import { locateRequestSchema } from '../../shared/schemas/workstation-controls';
import { ConnectionSession } from './session-fixture';

function run(id: string, path: string | null, created: string | null = null): RunView {
  return {
    run_id: id,
    plan_id: id,
    request_id: id,
    backend: 'local',
    operation: 'train',
    attempt: 1,
    state: 'completed',
    uncertainty: false,
    submission_requested: true,
    cancellation_requested: false,
    evidence: null,
    created_at: created,
    summary: {
      name: null,
      model: null,
      data_path: path,
      epochs: null,
      cv: null,
      source_run_id: null,
    },
  };
}

test('groups newest-first paths and counts each run once', () => {
  const suggestions = datasetSuggestions([
    run('2', '/data/new.hdf5', '2026-04-01'),
    run('3', '/data/old.npz', '2026-03-01'),
    run('3', '/data/old.npz', '2026-03-01'),
    run('1', '/data/old.npz', '2026-01-01'),
  ]);

  expect(suggestions.map((item) => [item.name, item.count, item.format])).toEqual([
    ['new.hdf5', 1, 'H5'],
    ['old.npz', 2, 'NPZ'],
  ]);
  expect(suggestions[1]?.lastUsed?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
});

test('ignores unsupported files and missing summaries, preserves distinct full paths in API order', () => {
  expect(
    datasetSuggestions([
      run('1', '/data/readme.txt'),
      run('2', null),
      run('3', '/a/train.mat'),
      run('4', '/b/train.mat'),
    ]).map((item) => item.path),
  ).toEqual(['/a/train.mat', '/b/train.mat']);
  expect(datasetSuggestions([])).toEqual([]);
});

test('handles windows paths and preserves API order with invalid or missing dates', () => {
  const suggestions = datasetSuggestions([
    run('3', '/data/dated.h5', '2026-01-01'),
    run('1', 'C:\\data\\train.NPZ', 'invalid'),
    run('2', 'C:/data/train.NPZ'),
  ]);

  expect(suggestions[0]?.name).toBe('dated.h5');
  expect(suggestions[1]?.path).toBe('C:\\data\\train.NPZ');
  expect(suggestions[1]?.name).toBe('train.NPZ');
  expect(suggestions[1]?.count).toBe(2);
  expect(suggestions[1]?.lastUsed).toBeNull();
});

function history(count: number, path: (index: number) => string = (index) => `/data/${index}.npz`) {
  return Array.from({ length: count }, (_, index) =>
    run(
      `11111111-1111-4111-8111-${String(count - index).padStart(12, '0')}`,
      path(index),
      new Date(Date.UTC(2026, 0, count - index)).toISOString(),
    ),
  );
}

async function setupSuggestions(
  runs: RunView[],
  missing: (path: string) => boolean = () => false,
  onPage: (offset: number) => void = () => {},
) {
  const pages: number[] = [];
  const rootReads: string[] = [];
  const rootResolutions: string[] = [];
  const fileResolutions: string[] = [];
  const controller = new AbortController();
  const session = new ConnectionSession({
    origin: 'http://localhost:8765',
    buildId: '1.8.1',
    fetcher: async (input, init) => {
      const url = new URL(String(input));
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });

      if (url.pathname === '/api/health')
        return json({ daemon_id: 'daemon', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 });

      if (url.pathname === '/api/runs') {
        const offset = Number(url.searchParams.get('offset'));
        const limit = Number(url.searchParams.get('limit'));
        pages.push(offset);
        expect(limit).toBe(100);
        onPage(offset);

        return json({ runs: runs.slice(offset, offset + limit) });
      }

      if (url.pathname === '/api/browse') {
        rootReads.push(url.pathname);

        return json({ roots: [{ id: 'data' }, { id: 'scratch' }] });
      }

      if (url.pathname === '/api/browse/resolve') {
        const body = locateRequestSchema.parse(JSON.parse(String(init?.body)));

        if (body.path) {
          fileResolutions.push(body.path);

          if (missing(body.path)) return json({ detail: 'missing' }, 404);
        } else rootResolutions.push(body.root);

        return json({
          root: body.root,
          relative_path: body.path,
          path: `/${body.root}${body.path ? `/${body.path}` : ''}`,
          kind: body.path ? 'file' : 'directory',
        });
      }

      return json({ detail: 'missing' }, 404);
    },
  });
  expect(await session.connect('token')).toBe(true);

  async function load() {
    const roots = await new CatalogApi(session).roots(controller.signal);

    return loadDatasetSuggestions(session, roots, controller.signal);
  }

  return { session, controller, pages, rootReads, rootResolutions, fileResolutions, load };
}

test('resolves four newest datasets without requesting another page and shares catalog locations', async () => {
  const fixture = await setupSuggestions(history(305, (index) => `/data/${index % 5}.npz`));
  const suggestions = await fixture.load();

  expect(fixture.pages).toEqual([0]);
  expect(suggestions.map((item) => [item.path, item.count])).toEqual([
    ['/data/0.npz', 20],
    ['/data/1.npz', 20],
    ['/data/2.npz', 20],
    ['/data/3.npz', 20],
  ]);
  expect(fixture.fileResolutions).toEqual(['0.npz', '1.npz', '2.npz', '3.npz']);
  expect(fixture.rootReads).toHaveLength(1);
  expect(fixture.rootResolutions).toEqual(['data', 'scratch']);
});

test('caps recent run scanning even when repeated datasets leave room for more suggestions', async () => {
  const fixture = await setupSuggestions(history(MAX_RECENT_DATASET_RUNS + 5, (index) =>
    index < MAX_RECENT_DATASET_RUNS ? '/data/repeated.npz' : '/data/older.npz',
  ));

  expect((await fixture.load()).map((item) => item.path)).toEqual(['/data/repeated.npz']);
  expect(fixture.pages).toEqual([0, 100, 200]);
  expect(fixture.fileResolutions).toEqual(['repeated.npz']);
});

test('stops at a short page without requesting an empty page', async () => {
  const fixture = await setupSuggestions(history(105, (index) =>
    index < 100 ? '/data/newest.npz' : '/data/older.npz',
  ));

  expect((await fixture.load()).map((item) => item.path)).toEqual([
    '/data/newest.npz', '/data/older.npz',
  ]);
  expect(fixture.pages).toEqual([0, 100]);
  expect(fixture.fileResolutions).toEqual(['newest.npz', 'older.npz']);
  expect(fixture.rootResolutions).toEqual(['data', 'scratch']);
});

test('deduplicates failed paths across pages and slash styles before resolving older candidates', async () => {
  const fixture = await setupSuggestions(history(205, (index) => {
    if (index < 100) return '/data/missing.npz';
    if (index < 200) return '/data\\missing.npz';

    return '/data/valid.npz';
  }), (path) => path === 'missing.npz');

  expect((await fixture.load()).map((item) => item.path)).toEqual(['/data/valid.npz']);
  expect(fixture.pages).toEqual([0, 100, 200]);
  expect(fixture.fileResolutions).toEqual(['missing.npz', 'valid.npz']);
  expect(fixture.rootResolutions).toEqual(['data', 'scratch']);
});

test('caps failed catalog resolutions without requesting older pages', async () => {
  const fixture = await setupSuggestions(history(305), () => true);

  expect(await fixture.load()).toEqual([]);
  expect(fixture.pages).toEqual([0]);
  expect(fixture.fileResolutions).toHaveLength(MAX_FAILED_DATASET_SUGGESTIONS);
  expect(fixture.fileResolutions[0]).toBe('0.npz');
  expect(fixture.rootReads).toHaveLength(1);
  expect(fixture.rootResolutions).toEqual(['data', 'scratch']);
});

test('falls back past failed paths and stops requests as soon as four resolve', async () => {
  const fixture = await setupSuggestions(history(305), (path) => ['0.npz', '1.npz'].includes(path));
  const suggestions = await fixture.load();

  expect(suggestions.map((item) => item.path)).toEqual([
    '/data/2.npz', '/data/3.npz', '/data/4.npz', '/data/5.npz',
  ]);
  expect(fixture.pages).toEqual([0]);
  expect(fixture.fileResolutions).toEqual(['0.npz', '1.npz', '2.npz', '3.npz', '4.npz', '5.npz']);
  expect(fixture.rootReads).toHaveLength(1);
  expect(fixture.rootResolutions).toEqual(['data', 'scratch']);
});

test('does not resolve catalog locations for history without dataset candidates', async () => {
  const fixture = await setupSuggestions(history(5, () => '/data/readme.txt'));

  expect(await fixture.load()).toEqual([]);
  expect(fixture.pages).toEqual([0]);
  expect(fixture.rootResolutions).toEqual([]);
  expect(fixture.fileResolutions).toEqual([]);
});

test('skips history and catalog work when there are no browse roots', async () => {
  const fixture = await setupSuggestions(history(10));

  expect(await loadDatasetSuggestions(fixture.session, [], fixture.controller.signal)).toEqual([]);
  expect(fixture.pages).toEqual([]);
  expect(fixture.rootResolutions).toEqual([]);
  expect(fixture.fileResolutions).toEqual([]);
});

test('does not start suggestion work for an aborted load', async () => {
  const fixture = await setupSuggestions(history(10));
  fixture.controller.abort();

  await expect(loadDatasetSuggestions(fixture.session, ['data'], fixture.controller.signal))
    .rejects.toThrow();
  expect(fixture.pages).toEqual([]);
  expect(fixture.fileResolutions).toEqual([]);
});

test('cancels during pagination without requesting another page', async () => {
  const fixture = await setupSuggestions(history(305, () => '/data/repeated.npz'), () => false, (offset) => {
    if (offset === 100) fixture.controller.abort();
  });

  await expect(fixture.load()).rejects.toThrow();
  expect(fixture.pages).toEqual([0, 100]);
  expect(fixture.fileResolutions).toEqual(['repeated.npz']);
});

test('cancels during catalog resolution without trying another candidate or page', async () => {
  const fixture = await setupSuggestions(history(305), (path) => {
    if (path === '1.npz') fixture.controller.abort();

    return false;
  });

  await expect(fixture.load()).rejects.toThrow();
  expect(fixture.pages).toEqual([0]);
  expect(fixture.fileResolutions).toEqual(['0.npz', '1.npz']);
});

test('formats supported file types and scalar or multidimensional sample shapes', () => {
  expect(datasetFormat('train.HDF5')).toBe('H5');
  expect(datasetFormat('train.npz.zip')).toBeNull();
  expect(datasetInputDimensions([])).toBe('1');
  expect(datasetInputDimensions([2, 1024])).toBe('2 × 1024');
  expect(datasetOutputValues([])).toBe(1);
  expect(datasetOutputValues([2, 3])).toBe(6);
  expect(datasetOutputValues([0])).toBeNull();
  expect(datasetOutputValues([Number.MAX_SAFE_INTEGER, 2])).toBeNull();
});
