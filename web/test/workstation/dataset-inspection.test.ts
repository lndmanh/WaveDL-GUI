import { describe, expect, it, vi } from 'vitest';
import { ConnectionSession } from './session-fixture';
import { CatalogApi } from '../../app/lib/catalog-api';
import { DatasetInspectionApi, parseDatasetInspection } from '../../app/lib/dataset-inspection';

const health = { daemon_id: 'daemon-one', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 };
const variable = (name: string, shape = [7, 4]) => ({
  name,
  shape,
  dtype: 'float32',
  sample_count: shape[0],
  declared_bytes: 112,
});
const metadata = () => ({
  schema_version: 1,
  format: 'npz',
  variables: [variable('X'), variable('Y', [7, 1])],
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
async function setup(response: () => Promise<Response> = async () => json(metadata())) {
  let observedHealth = health;
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    if (String(url).endsWith('/api/health')) return json(observedHealth);
    if (String(url).endsWith('/api/browse/resolve'))
      return json({
        root: 'data',
        relative_path: 'wave.npz',
        path: '/srv/data/wave.npz',
        kind: 'file',
      });
    return response();
  });
  const session = new ConnectionSession({
    origin: 'http://localhost:8765',
    buildId: '1.8.1',
    fetcher,
  });
  await session.connect('private-token');
  const selection = await new CatalogApi(session).resolve('data', 'wave.npz');
  return {
    session,
    selection,
    fetcher,
    skew: () => {
      observedHealth = { ...health, daemon_id: 'another' };
    },
  };
}
describe('header-only dataset inspection', () => {
  it('uses only the branded resolved daemon path and preserves metadata conventions', async () => {
    const { session, selection, fetcher } = await setup();
    const value = await new DatasetInspectionApi(session).inspect(selection);
    expect(value).toMatchObject({
      numSamples: 7,
      inputShape: [4],
      outputShape: [1],
      inputDtype: 'float32',
      fileSize: null,
    });
    const call = fetcher.mock.calls.find(([url]) => String(url).endsWith('/api/datasets/inspect'));
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ root: 'data', path: 'wave.npz' });
    expect(call?.[1]?.headers).toBeDefined();
  });
  it('matches core/Qt key priority rather than inventory order', () => {
    const body = metadata();
    body.variables.push(variable('input_train', [7, 2]), variable('output_train', [7]));
    expect(parseDatasetInspection(body, { relativePath: 'wave.npz' })).toMatchObject({
      inputKey: 'input_train',
      outputKey: 'output_train',
      inputShape: [2],
      outputShape: [1],
    });
  });
  it.each([
    { ...metadata(), schema_version: 2 },
    { ...metadata(), format: 'mat' },
    { ...metadata(), variables: [variable('X'), variable('X')] },
    { ...metadata(), variables: [variable('X'), variable('Y', [8, 1])] },
    { ...metadata(), variables: [variable('X', [0, 1]), variable('Y', [0, 1])] },
    { ...metadata(), variables: [variable('X'), { ...variable('Y'), sample_count: true }] },
    { ...metadata(), variables: [variable('X'), { ...variable('Y'), dtype: 'a'.repeat(257) }] },
    { ...metadata(), variables: Array.from({ length: 129 }, () => variable('X')) },
    {
      ...metadata(),
      variables: [variable('X'), { ...variable('Y'), declared_bytes: 8 * 1024 ** 3 }],
    },
    { ...metadata(), extra: '<script>unsafe</script>' },
  ])('refuses malformed or incompatible metadata', (body) => {
    expect(() => parseDatasetInspection(body, { relativePath: 'wave.npz' })).toThrow(
      'cannot be mapped',
    );
  });
  it.each([422, 503])('reports refusal %i without fabricating information', async (status) => {
    const { session, selection } = await setup(async () => json({ detail: 'refused' }, status));
    await expect(new DatasetInspectionApi(session).inspect(selection)).rejects.toMatchObject({
      code: 'request',
    });
  });
  it('rejects unbranded and stale selections before network work', async () => {
    const { session, selection, fetcher } = await setup();
    const count = fetcher.mock.calls.length;
    await expect(new DatasetInspectionApi(session).inspect({ ...selection })).rejects.toMatchObject(
      { code: 'stale' },
    );
    expect(fetcher).toHaveBeenCalledTimes(count);
    await session.reconnect('private-token');
    await expect(new DatasetInspectionApi(session).inspect(selection)).rejects.toMatchObject({
      code: 'stale',
    });
  });
  it('blocks forwarded-port identity changes before inspecting', async () => {
    const { session, selection, fetcher, skew } = await setup();
    skew();
    await expect(new DatasetInspectionApi(session).inspect(selection)).rejects.toMatchObject({
      code: 'identity',
    });
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/api/datasets/inspect'))).toBe(
      false,
    );
  });
  it('discards a delayed response after detach, even if fetch ignores abort', async () => {
    let finish: ((response: Response) => void) | undefined;
    const { session, selection } = await setup(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = new DatasetInspectionApi(session).inspect(selection);
    await vi.waitFor(() => expect(finish).toBeDefined());
    session.detach();
    finish?.(json(metadata()));
    await expect(pending).rejects.toMatchObject({ code: 'stale' });
  });
  it('uses a bounded deadline and aborts pending metadata work', async () => {
    const { session, selection } = await setup(() => new Promise(() => {}));
    const perform = vi.spyOn(session, 'perform');
    const controller = new AbortController();
    const pending = new DatasetInspectionApi(session).inspect(selection, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'stale' });
    expect(perform.mock.calls[0]?.[1]).toMatchObject({
      timeoutMs: 60000,
      signal: controller.signal,
    });
    controller.abort();
    await rejected;
  });
  it('rejects an oversized response before parsing its inventory', () => {
    expect(() =>
      parseDatasetInspection(
        { ...metadata(), extra: 'a'.repeat(65536) },
        { relativePath: 'wave.npz' },
      ),
    ).toThrow('cannot be mapped');
  });
});
