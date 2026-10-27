// @vitest-environment happy-dom
import { mountWithI18n as mount } from './mountWithI18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, shallowRef } from 'vue';
import { provideWorkstationLocale } from '../../app/composables/useWorkstationI18n';
import type { WorkstationLocale } from '../../app/i18n/core';
import MetricsChart from '../../app/components/runs/MetricsChart.vue';
import MetricSummary from '../../app/components/runs/MetricSummary.vue';
import RunDetail from '../../app/components/runs/RunDetail.vue';
import type { MetricRecord } from '../../app/lib/metric-history';
import type { RunMonitorSnapshot } from '../../app/lib/run-monitor';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  destroy: vi.fn(),
  setData: vi.fn(),
  setSize: vi.fn(),
  setScale: vi.fn(),
}));
vi.mock('uplot', () => ({
  default: class {
    constructor(...args: unknown[]) {
      mocks.create(...args);
    }
    destroy = mocks.destroy;
    setData = mocks.setData;
    setSize = mocks.setSize;
    setScale = mocks.setScale;
    scales = { x: { min: 0.25, max: 0.75 } };
  },
}));
const rows: MetricRecord[] = [
  {
    runId: 'run',
    attempt: 1,
    seq: 1,
    step: 1,
    name: 'epoch',
    value: 1,
    unit: '',
    metrics: { train_loss: 2, r2: 0.5, lr: 0.01 },
    sourceGeneration: null,
    active: true,
  },
];
let frames: Map<number, FrameRequestCallback>;
let resize: ResizeObserverCallback;
let disconnect: ReturnType<typeof vi.fn>;
async function renderFrame() {
  await nextTick();
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(0);
  await nextTick();
}
beforeEach(() => {
  vi.clearAllMocks();
  frames = new Map();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
  disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 600,
  } as DOMRect);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('chart lifecycle', () => {
  it('updates Vietnamese chart text reactively, preserving data, channel and zoom', async () => {
    const locale = shallowRef<WorkstationLocale>('vi');
    const wrapper = mount(
      defineComponent({
        setup() {
          provideWorkstationLocale(locale);
          return () => h(MetricsChart, { records: rows });
        },
      }),
    );
    await renderFrame();
    expect(wrapper.text()).toContain('Lịch sử số liệu');
    expect(mocks.create.mock.calls.at(-1)?.[0].series[1].label).toBe('Mất mát huấn luyện');
    const originalData = mocks.create.mock.calls.at(-1)?.[1];
    locale.value = 'en';
    await nextTick();
    expect(wrapper.text()).toContain('Metric history');
    expect(mocks.create.mock.calls.at(-1)?.[0].series[1].label).toBe('Training loss');
    expect(mocks.create.mock.calls.at(-1)?.[1]).toBe(originalData);
    expect(mocks.setScale).toHaveBeenCalledWith('x', { min: 0.25, max: 0.75 });
    expect(wrapper.get('[role="tab"][data-state="active"]').text()).toBe('Loss');
    expect(rows[0]?.metrics).toEqual({ train_loss: 2, r2: 0.5, lr: 0.01 });
    wrapper.unmount();
  });
  it('RunDetail fences retained metrics for stale, pending and attemptless runtime scope', async () => {
    const snapshot: RunMonitorSnapshot = {
      run: {
        run_id: 'run',
        request_id: 'request',
        plan_id: 'plan',
        backend: 'local',
        operation: 'train',
        attempt: 1,
        state: 'running',
        uncertainty: false,
        submission_requested: true,
        cancellation_requested: false,
        evidence: {},
      },
      freshness: 'fresh',
      events: [],
      liveEvents: [],
      stream: 'live',
      message: '',
      cancellation: 'idle',
      truncated: false,
      metrics: rows,
      summary: { progress: null, best: null, latest: null },
    };
    const wrapper = mount(RunDetail, { props: { snapshot } });
    const chart = wrapper.getComponent(MetricsChart);
    expect(chart.props('records')).toEqual(rows);
    await wrapper.setProps({
      snapshot: {
        ...snapshot,
        run: { ...snapshot.run!, state: 'supervision_lost', uncertainty: true },
      },
    });
    expect(chart.props('records')).toEqual(rows);
    expect(chart.props('unavailable')).toBe(false);
    expect(wrapper.getComponent(MetricSummary).props('unconfirmed')).toBe(true);
    expect(wrapper.text()).toContain('Last known runtime metrics');
    await wrapper.setProps({ snapshot });
    expect(wrapper.getComponent(MetricSummary).props('unconfirmed')).toBe(false);
    await wrapper.setProps({ snapshot: { ...snapshot, freshness: 'stale' } });
    expect(chart.props('records')).toEqual([]);
    expect(chart.props('unavailable')).toBe(true);
    await wrapper.setProps({
      snapshot: { ...snapshot, run: { ...snapshot.run!, evidence: { native_pending: true } } },
    });
    expect(chart.props('records')).toEqual([]);
    await wrapper.setProps({ snapshot: { ...snapshot, run: { ...snapshot.run!, attempt: null } } });
    expect(chart.props('records')).toEqual([]);
    await wrapper.setProps({ snapshot });
    expect(chart.props('records')).toEqual(rows);
    wrapper.unmount();
  });
  it('creates raw external plot, replaces data, coalesces resize and destroys on unmount', async () => {
    const wrapper = mount(MetricsChart, { props: { records: rows } });
    await renderFrame();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ records: [{ ...rows[0]!, step: 2 }] });
    resize([], {} as ResizeObserver);
    resize([], {} as ResizeObserver);
    expect(frames.size).toBe(1);
    await renderFrame();
    expect(mocks.setData).toHaveBeenCalledWith([[2], [2], [null]]);
    resize([], {} as ResizeObserver);
    wrapper.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });
  it('clears stale or native-pending history and renders only newly confirmed data', async () => {
    const wrapper = mount(MetricsChart, { props: { records: rows } });
    await renderFrame();
    await wrapper.setProps({ unavailable: true });
    await renderFrame();
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('Earlier history is not live progress');
    await wrapper.setProps({ unavailable: false, records: [] });
    await renderFrame();
    expect(mocks.create).toHaveBeenCalledOnce();
    await wrapper.setProps({ records: rows });
    await renderFrame();
    expect(mocks.create).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
  it('changes channel with an accessible tab panel and rebuilds series labels', async () => {
    const wrapper = mount(MetricsChart, { props: { records: rows } });
    await renderFrame();
    await wrapper.findAll('[role="tab"]')[1]!.trigger('keydown', { key: 'Enter' });
    await renderFrame();
    expect(wrapper.get('[role="tabpanel"]').attributes('data-state')).toBe('active');
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(mocks.create.mock.calls.at(-1)?.[1]).toEqual([[1], [0.5], [null]]);
    wrapper.unmount();
  });
});
