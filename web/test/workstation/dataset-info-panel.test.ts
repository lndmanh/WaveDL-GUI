// @vitest-environment happy-dom
import { mountWithI18n as mount } from './mountWithI18n';
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DatasetInfoPanel from '../../app/components/datasets/DatasetInfoPanel.vue';
import { ConnectionSession } from './session-fixture';
import { CatalogApi } from '../../app/lib/catalog-api';
import { DatasetInspectionApi, type DatasetInspection } from '../../app/lib/dataset-inspection';
const selection = {
  root: 'data',
  relativePath: 'wave.npz',
  path: '/srv/data/wave.npz',
  kind: 'file' as const,
  daemonId: 'one',
};
const info: DatasetInspection = {
  format: 'npz',
  numSamples: 7,
  inputKey: 'X',
  outputKey: 'Y',
  inputShape: [4],
  outputShape: [1],
  inputDtype: 'float32',
  outputDtype: 'float64',
  fileSize: null,
};
async function session() {
  const value = new ConnectionSession({
    origin: window.location.origin,
    buildId: '1.8.1',
    fetcher: vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      const body =
        path === '/api/health'
          ? { daemon_id: 'one', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 }
          : path === '/api/browse/resolve'
            ? { root: 'data', relative_path: 'wave.npz', path: selection.path, kind: 'file' }
            : {
                schema_version: 1,
                format: 'npz',
                variables: [
                  {
                    name: 'X',
                    shape: [7, 4],
                    dtype: 'float32',
                    sample_count: 7,
                    declared_bytes: 112,
                  },
                  {
                    name: 'Y',
                    shape: [7, 1],
                    dtype: 'float64',
                    sample_count: 7,
                    declared_bytes: 56,
                  },
                ],
              };
      return new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
      });
    }),
  });
  expect(await value.connect('token')).toBe(true);
  return value;
}
afterEach(() => vi.restoreAllMocks());
describe('dataset header panel', () => {
  it('refuses old branded selection after session replacement and ignores retired events', async () => {
    const first = await session();
    const chosen = await new CatalogApi(first).resolve('data', 'wave.npz');
    const replacement = await session();
    const replacementChosen = await new CatalogApi(replacement).resolve('data', 'wave.npz');
    const inspect = vi.spyOn(DatasetInspectionApi.prototype, 'inspect');
    const wrapper = mount(DatasetInfoPanel, { props: { session: first, selection: chosen } });
    await flushPromises();
    expect(wrapper.find('dl').exists()).toBe(true);
    await wrapper.setProps({ session: replacement });
    await flushPromises();
    await expect(inspect.mock.results[1]?.value).rejects.toMatchObject({ code: 'stale' });
    expect(wrapper.find('dl').exists()).toBe(false);
    expect(wrapper.get('[role="status"]').text()).toContain('select a supported dataset again');
    expect(replacement.snapshot().status).toBe('connected');
    await wrapper.setProps({ selection: replacementChosen });
    await flushPromises();
    expect(wrapper.find('dl').exists()).toBe(true);
    first.detach();
    await flushPromises();
    expect(wrapper.find('dl').exists()).toBe(true);
    wrapper.unmount();
  });
  it('keeps reconnect guidance for a selected dataset while disconnected', async () => {
    const inspect = vi.spyOn(DatasetInspectionApi.prototype, 'inspect').mockResolvedValue(info);
    const connection = await session();
    connection.detach();
    const wrapper = mount(DatasetInfoPanel, { props: { session: connection, selection } });
    await flushPromises();
    expect(inspect).not.toHaveBeenCalled();
    expect(wrapper.find('dl').exists()).toBe(false);
    expect(wrapper.get('[role="status"]').text()).toBe(
      'Reconnect and select this dataset again to inspect its header.',
    );
    wrapper.unmount();
  });
  it('Stop cancels pending inspection without detaching the daemon and allows retry', async () => {
    let finish: ((value: DatasetInspection) => void) | undefined;
    const inspect = vi
      .spyOn(DatasetInspectionApi.prototype, 'inspect')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue({ ...info, numSamples: 9 });
    const connection = await session();
    const wrapper = mount(DatasetInfoPanel, { props: { session: connection, selection } });
    await flushPromises();
    const stop = wrapper.findAll('button').find((button) => button.text() === 'Stop inspecting');
    expect(stop).toBeDefined();
    await stop?.trigger('click');
    expect(inspect.mock.calls[0]?.[1]?.aborted).toBe(true);
    expect(connection.snapshot().status).toBe('connected');
    finish?.(info);
    await flushPromises();
    expect(wrapper.find('dl').exists()).toBe(false);
    expect(wrapper.emitted('inspected')?.every(([value]) => value === null)).toBe(true);
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(wrapper.findAll('dd')[1]?.text()).toBe('9');
    expect(wrapper.emitted('inspected')?.at(-1)).toEqual([{ ...info, numSamples: 9 }, selection]);
    wrapper.unmount();
  });
  it('renders dtype, excluded-batch shapes and unknown physical size, then clears on detach', async () => {
    vi.spyOn(DatasetInspectionApi.prototype, 'inspect').mockResolvedValue(info);
    const connection = await session();
    const wrapper = mount(DatasetInfoPanel, { props: { session: connection, selection } });
    await flushPromises();
    expect(wrapper.text()).toContain('float32');
    expect(wrapper.text()).toContain('float64');
    expect(wrapper.findAll('dd').map((item) => item.text())).toEqual([
      'NPZ',
      '7',
      'Unknown',
      'X',
      '4',
      'float32',
      'Y',
      '1',
      'float64',
    ]);
    expect(wrapper.emitted('inspected')?.at(-1)).toEqual([info, selection]);
    connection.detach();
    await flushPromises();
    expect(wrapper.find('dl').exists()).toBe(false);
    expect(wrapper.emitted('inspected')?.at(-1)).toEqual([null, selection]);
    expect(wrapper.text()).toContain('Reconnect');
    wrapper.unmount();
  });
  it('aborts stale selection work and never renders its late result', async () => {
    let finish: ((value: DatasetInspection) => void) | undefined;
    const inspect = vi.spyOn(DatasetInspectionApi.prototype, 'inspect').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const wrapper = mount(DatasetInfoPanel, { props: { session: await session(), selection } });
    await flushPromises();
    await wrapper.setProps({ selection: null });
    expect(inspect.mock.calls[0]?.[1]?.aborted).toBe(true);
    finish?.(info);
    await flushPromises();
    expect(wrapper.find('dl').exists()).toBe(false);
    expect(wrapper.emitted('inspected')?.every(([value]) => value === null)).toBe(true);
    wrapper.unmount();
  });
  it('shows recoverable refusal without fabricated values', async () => {
    vi.spyOn(DatasetInspectionApi.prototype, 'inspect').mockRejectedValue(new Error('refused'));
    const wrapper = mount(DatasetInfoPanel, { props: { session: await session(), selection } });
    await flushPromises();
    expect(wrapper.text()).toContain('refused or unavailable');
    expect(wrapper.find('dl').exists()).toBe(false);
    wrapper.unmount();
  });
});
