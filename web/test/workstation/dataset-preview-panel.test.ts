// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, shallowRef } from 'vue';
import { provideWorkstationLocale } from '../../app/composables/useWorkstationI18n';
import type { WorkstationLocale } from '../../app/i18n/core';
import DatasetPreviewPanel from '../../app/components/datasets/DatasetPreviewPanel.vue';
import { ConnectionSession } from './session-fixture';
import { CatalogApi } from '../../app/lib/catalog-api';
import { DatasetPreviewApi, type DatasetPreview } from '../../app/lib/dataset-preview';

const selection = {
  root: 'data',
  relativePath: 'wave.npz',
  path: '/srv/data/wave.npz',
  kind: 'file' as const,
  daemonId: 'daemon-one',
};
const payload: DatasetPreview = {
  schema_version: 1,
  identity: { st_dev: 1, st_ino: 2, st_size: 4096, st_mtime_ns: 1780000000000000000 },
  format: 'npz',
  input_key: 'X',
  output_key: 'Y',
  input_shape: [2, 2],
  output_shape: [2, 1],
  sample_indices: [0, 1],
  input_histograms: [{ feature_index: 0, counts: [1], edges: [0, 1] }],
  output_histograms: [{ feature_index: 0, counts: [1], edges: [0, 1] }],
  correlation: { feature_indices: [0], matrix: null },
  input_statistics: { feature_indices: [0], means: [1], stds: [0] },
  scatter: { feature_indices: [0], output_index: 0, x: [[0], [1]], y: [0, 1] },
  samples: [{ sample_index: 0, feature_shape: [1, 2], shape: [1, 2], values: [[0, 1]] }],
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
async function session() {
  const session = new ConnectionSession({
    origin: window.location.origin,
    buildId: '1.8.1',
    fetcher: vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            daemon_id: 'daemon-one',
            build_id: '1.8.1',
            protocol_min: 1,
            protocol_max: 1,
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    ),
  });
  expect(await session.connect('token')).toBe(true);
  return session;
}
const global = { stubs: { PreviewPlot: true, PreviewHeatmap: true, PreviewStatistics: true } };
async function scopedSession() {
  const body = structuredClone(payload);
  const histogram = {
    feature_index: 0,
    counts: [2, ...Array<number>(31).fill(0)],
    edges: Array.from({ length: 33 }, (_, index) => index / 32),
  };
  body.input_histograms = [histogram];
  body.output_histograms = [structuredClone(histogram)];
  body.samples = [{ sample_index: 0, feature_shape: [2], shape: [2], values: [0, null] }];
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    const path = String(url);
    const response = path.endsWith('/api/health')
      ? { daemon_id: 'daemon-one', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 }
      : path.endsWith('/api/browse/resolve')
        ? { root: 'data', relative_path: 'wave.npz', path: selection.path, kind: 'file' }
        : body;
    return new Response(JSON.stringify(response), {
      headers: { 'content-type': 'application/json' },
    });
  });
  const connection = new ConnectionSession({
    origin: window.location.origin,
    buildId: '1.8.1',
    fetcher,
  });
  expect(await connection.connect('token')).toBe(true);
  const chosen = await new CatalogApi(connection).resolve('data', 'wave.npz');
  return { connection, chosen, fetcher };
}
afterEach(() => vi.restoreAllMocks());
describe('dataset preview scope and lazy views', () => {
  it.each([
    { rows: [0], reason: 'Correlation requires at least two sampled rows.' },
    { rows: [0, 1], reason: 'Correlation requires at least two output features.' },
  ])('explains why correlation is unavailable for $rows', async ({ rows, reason }) => {
    vi.spyOn(DatasetPreviewApi.prototype, 'preview').mockResolvedValue({
      ...payload,
      sample_indices: rows,
    });
    const wrapper = mount(DatasetPreviewPanel, {
      props: { session: await session(), selection },
      global,
    });
    await flushPromises();
    const tab = wrapper.findAll('[role="tab"]').find((item) => item.text() === 'Correlation');
    await tab?.trigger('mousedown', { button: 0 });
    await tab?.trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toBe(reason);
    expect(wrapper.find('preview-heatmap-stub').exists()).toBe(false);
    wrapper.unmount();
  });
  it('requires a newly branded selection on connected session replacement', async () => {
    const first = await scopedSession();
    const replacement = await scopedSession();
    const wrapper = mount(DatasetPreviewPanel, {
      props: { session: first.connection, selection: first.chosen },
      global,
    });
    await flushPromises();
    expect(wrapper.find('preview-plot-stub').exists()).toBe(true);
    const before = replacement.fetcher.mock.calls.length;
    await wrapper.setProps({ session: replacement.connection });
    await flushPromises();
    expect(wrapper.find('preview-plot-stub').exists()).toBe(false);
    expect(wrapper.get('[role="status"]').text()).toContain('Select again');
    expect(replacement.fetcher).toHaveBeenCalledTimes(before);
    await wrapper.setProps({ selection: replacement.chosen });
    await flushPromises();
    expect(wrapper.find('preview-plot-stub').exists()).toBe(true);
    first.connection.detach();
    await flushPromises();
    expect(wrapper.find('preview-plot-stub').exists()).toBe(true);
    expect(replacement.connection.snapshot().status).toBe('connected');
    wrapper.unmount();
  });
  it('does not start preview work while disconnected', async () => {
    const preview = vi.spyOn(DatasetPreviewApi.prototype, 'preview').mockResolvedValue(payload);
    const connection = await session();
    connection.detach();
    const wrapper = mount(DatasetPreviewPanel, {
      props: { session: connection, selection },
      global,
    });
    await flushPromises();
    expect(preview).not.toHaveBeenCalled();
    expect(wrapper.find('preview-plot-stub').exists()).toBe(false);
    expect(wrapper.get('[role="status"]').text()).toBe(
      'Reconnect and select this dataset again to preview.',
    );
    wrapper.unmount();
  });
  it('aborts a replaced session request and ignores its late completion', async () => {
    let finish: ((result: DatasetPreview) => void) | undefined;
    const preview = vi
      .spyOn(DatasetPreviewApi.prototype, 'preview')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockRejectedValue(new Error('Select again from the current verified daemon.'));
    const first = await session();
    const wrapper = mount(DatasetPreviewPanel, {
      props: { session: first, selection },
      global,
    });
    await flushPromises();
    const signal = preview.mock.calls[0]?.[2];
    await wrapper.setProps({ session: await session() });
    await flushPromises();
    expect(signal?.aborted).toBe(true);
    finish?.(payload);
    await flushPromises();
    expect(wrapper.find('preview-plot-stub').exists()).toBe(false);
    expect(wrapper.get('[role="status"]').text()).toContain('Select again');
    wrapper.unmount();
  });
  it('changes language without changing the selected view, API authority or preview values', async () => {
    const preview = vi.spyOn(DatasetPreviewApi.prototype, 'preview').mockResolvedValue(payload);
    const connection = await session();
    const connectionBefore = connection.snapshot();
    const locale = shallowRef<WorkstationLocale>('vi');
    const before = JSON.stringify(payload);
    const wrapper = mount(
      defineComponent({
        setup() {
          provideWorkstationLocale(locale);
          return () => h(DatasetPreviewPanel, { session: connection, selection });
        },
      }),
      { global },
    );
    await flushPromises();
    expect(wrapper.text()).toContain('Trực quan hóa tập dữ liệu');
    expect(wrapper.get('preview-plot-stub').attributes('title')).toBe('Đặc trưng 0');
    const sampleTab = wrapper.findAll('[role="tab"]').find((tab) => tab.text() === 'Mẫu');
    await sampleTab?.trigger('mousedown', { button: 0 });
    await sampleTab?.trigger('click');
    await flushPromises();
    expect(wrapper.get('preview-heatmap-stub').attributes('title')).toBe('Mẫu đầu vào 0');
    const signal = preview.mock.calls[0]?.[2];
    locale.value = 'en';
    await flushPromises();
    expect(wrapper.get('[role="tab"][data-state="active"]').text()).toBe('Samples');
    expect(wrapper.get('preview-heatmap-stub').attributes('title')).toBe('Input sample 0');
    expect(preview).toHaveBeenCalledOnce();
    expect(signal?.aborted).toBe(false);
    expect(JSON.stringify(payload)).toBe(before);
    expect(connection.snapshot()).toEqual(connectionBefore);
    wrapper.unmount();
  });
  it('mounts only the active view and clears results immediately on detach', async () => {
    vi.spyOn(DatasetPreviewApi.prototype, 'preview').mockResolvedValue(payload);
    const connection = await session();
    const wrapper = mount(DatasetPreviewPanel, {
      props: { session: connection, selection },
      global,
    });
    await flushPromises();
    expect(wrapper.findAll('preview-plot-stub')).toHaveLength(1);
    expect(wrapper.find('preview-heatmap-stub').exists()).toBe(false);
    const sampleTab = wrapper.findAll('[role="tab"]').find((tab) => tab.text() === 'Samples');
    await sampleTab?.trigger('mousedown', { button: 0 });
    await sampleTab?.trigger('click');
    await flushPromises();
    expect(wrapper.find('preview-heatmap-stub').exists()).toBe(true);
    expect(wrapper.find('preview-plot-stub').exists()).toBe(false);
    connection.detach();
    await flushPromises();
    expect(wrapper.find('preview-heatmap-stub').exists()).toBe(false);
    expect(wrapper.text()).toContain('Reconnect');
    wrapper.unmount();
  });
  it('aborts and discards an old response after selection is cleared', async () => {
    let resolve: ((result: DatasetPreview) => void) | undefined;
    const preview = vi.spyOn(DatasetPreviewApi.prototype, 'preview').mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const wrapper = mount(DatasetPreviewPanel, {
      props: { session: await session(), selection },
      global,
    });
    await flushPromises();
    const signal = preview.mock.calls[0]?.[2];
    await wrapper.setProps({ selection: null });
    expect(signal?.aborted).toBe(true);
    resolve?.(payload);
    await flushPromises();
    expect(wrapper.find('preview-plot-stub').exists()).toBe(false);
    wrapper.unmount();
  });
  it('exposes explicit Stop loading, aborts the request, and leaves no preview rendered', async () => {
    let finish: ((result: DatasetPreview) => void) | undefined;
    const preview = vi.spyOn(DatasetPreviewApi.prototype, 'preview').mockImplementation(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    const wrapper = mount(DatasetPreviewPanel, {
      props: { session: await session(), selection },
      global,
    });
    await flushPromises();
    const signal = preview.mock.calls[0]?.[2];
    const stop = wrapper.findAll('button').find((item) => item.text() === 'Stop loading');
    expect(stop).toBeDefined();
    await stop?.trigger('click');
    expect(signal?.aborted).toBe(true);
    finish?.(payload);
    await flushPromises();
    expect(wrapper.find('preview-plot-stub').exists()).toBe(false);
    expect(wrapper.get('[role="status"]').text()).toBe(
      'Preview loading stopped. Refresh preview to retry.',
    );
    wrapper.unmount();
  });
});
