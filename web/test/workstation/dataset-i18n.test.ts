// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { computed, defineComponent, h, shallowRef } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { provideWorkstationLocale } from '../../workstation/composables/useWorkstationI18n';
import type { WorkstationLocale } from '../../workstation/i18n/core';
import DatasetInfoPanel from '../../workstation/components/datasets/DatasetInfoPanel.vue';
import PreviewStatistics from '../../workstation/components/datasets/PreviewStatistics.vue';
import PreviewPlot from '../../workstation/components/datasets/PreviewPlot.vue';
import { DatasetInspectionApi } from '../../workstation/lib/dataset-inspection';
import { ConnectionSession } from '../../workstation/lib/connection-session';

const chart = vi.hoisted(() => ({ create: vi.fn(), setScale: vi.fn(), destroy: vi.fn() }));
vi.mock('uplot', () => ({
  default: class {
    scales = { x: { min: 0.25, max: 0.75 }, y: { min: 1, max: 2 } };
    constructor(...args: unknown[]) {
      chart.create(...args);
    }
    setScale = chart.setScale;
    destroy = chart.destroy;
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 640, 320),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('dataset language presentation', () => {
  it('switches header language without reinspection or changing keys, dtypes, shapes or size authority', async () => {
    const inspect = vi.spyOn(DatasetInspectionApi.prototype, 'inspect').mockResolvedValue({
      format: 'npz',
      numSamples: 7,
      inputKey: 'X',
      outputKey: 'Y',
      inputShape: [4],
      outputShape: [1],
      inputDtype: 'float32',
      outputDtype: 'float64',
      fileSize: null,
    });
    const session = new ConnectionSession({
      origin: window.location.origin,
      buildId: '1.8.1',
      fetcher: vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({
              daemon_id: 'one',
              build_id: '1.8.1',
              protocol_min: 1,
              protocol_max: 1,
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
      ),
    });
    await session.connect('token');
    const locale = shallowRef<WorkstationLocale>('vi');
    const selection = {
      root: 'data',
      relativePath: 'wave.npz',
      path: '/srv/data/wave.npz',
      kind: 'file' as const,
      daemonId: 'one',
    };
    const wrapper = mount(
      defineComponent({
        setup() {
          provideWorkstationLocale(locale);
          return () => h(DatasetInfoPanel, { session, selection });
        },
      }),
    );
    await flushPromises();
    expect(wrapper.text()).toContain('Tóm tắt thông tin tập dữ liệu');
    expect(wrapper.findAll('dd').map((item) => item.text())).toEqual([
      'NPZ',
      '7',
      'Chưa biết',
      'X',
      '4',
      'float32',
      'Y',
      '1',
      'float64',
    ]);
    const signal = inspect.mock.calls[0]?.[1];
    locale.value = 'en';
    await flushPromises();
    expect(wrapper.text()).toContain('Unknown');
    expect(inspect).toHaveBeenCalledOnce();
    expect(signal?.aborted).toBe(false);
    session.detach();
    await flushPromises();
    locale.value = 'vi';
    await flushPromises();
    expect(wrapper.text()).toContain('Kết nối lại');
    wrapper.unmount();
  });
  it('translates statistics while keeping indices and missing numeric values intact', async () => {
    const locale = shallowRef<WorkstationLocale>('vi');
    const statistics = { feature_indices: [3], means: [2.5], stds: [null] };
    const wrapper = mount(
      defineComponent({
        setup() {
          provideWorkstationLocale(locale);
          return () => h(PreviewStatistics, { statistics });
        },
      }),
      { global: { stubs: { PreviewPlot: true } } },
    );
    expect(wrapper.text()).toContain('Độ lệch chuẩn');
    expect(wrapper.findAll('tbody tr').map((row) => row.text())).toEqual(['32.5Thiếu']);
    locale.value = 'en';
    await flushPromises();
    expect(wrapper.text()).toContain('Standard deviation');
    expect(statistics).toEqual({ feature_indices: [3], means: [2.5], stds: [null] });
    wrapper.unmount();
  });
  it('rebuilds translated canvas legends without changing numerical data or zoom', async () => {
    const locale = shallowRef<WorkstationLocale>('en');
    const x = [0, 1],
      y = [1, 2];
    const wrapper = mount(
      defineComponent({
        setup() {
          provideWorkstationLocale(locale);
          const title = computed(() => (locale.value === 'en' ? 'Feature 0' : 'Đặc trưng 0'));
          return () => h(PreviewPlot, { title: title.value, x, y });
        },
      }),
    );
    expect(chart.create).toHaveBeenCalledOnce();
    locale.value = 'vi';
    await flushPromises();
    expect(chart.create).toHaveBeenCalledTimes(2);
    expect(chart.create.mock.calls[1]?.[0].series[0].label).toBe('Giá trị');
    expect(chart.create.mock.calls[1]?.[1]).toEqual([x, y]);
    expect(chart.setScale).toHaveBeenCalledWith('x', { min: 0.25, max: 0.75 });
    expect(chart.setScale).toHaveBeenCalledWith('y', { min: 1, max: 2 });
    expect(wrapper.text()).toContain('Đặt lại thu phóng');
    wrapper.unmount();
  });
});
