// @vitest-environment happy-dom
import { computed, defineComponent, h, KeepAlive, shallowRef, type VNode } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountWithI18n as mount } from './mountWithI18n';
import NewPage from '../../app/pages/new.vue';
import DatasetsPage from '../../app/pages/datasets.vue';
import ExperimentsPage from '../../app/pages/experiments/[[runId]].vue';
import ResultsPage from '../../app/pages/results/[[runId]].vue';
import StartPanel from '../../app/components/project/StartPanel.vue';
import RunDetail from '../../app/components/runs/RunDetail.vue';
import ResultsContainer from '../../app/components/results/ResultsContainer.vue';
import RunsWorkspace from '../../app/components/runs/RunsWorkspace.vue';
import PreviewPlot from '../../app/components/datasets/PreviewPlot.vue';
import MetricsChart from '../../app/components/runs/MetricsChart.vue';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger } from '../../app/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '../../app/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../app/components/ui/tooltip';
import { workstationPageRetention } from '../../app/shell/page-retention';
import { DaemonApi, type RunView } from '../../app/lib/daemon-api';
import { ConnectionSession } from './session-fixture';
import type { RunMonitorSnapshot } from '../../app/lib/run-monitor';

const id = '11111111-1111-4111-8111-111111111111';
const run: RunView = {
  run_id: id, plan_id: id, request_id: id, backend: 'local', operation: 'train',
  attempt: 1, state: 'running', uncertainty: false, submission_requested: true,
  cancellation_requested: false, evidence: null,
};
function json(body: object) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}
const session = new ConnectionSession({
  origin: window.location.origin, buildId: 'test',
  fetcher: async (input) => String(input).endsWith('/api/health')
    ? json({ daemon_id: 'd', build_id: 'test', protocol_min: 1, protocol_max: 1 })
    : String(input).endsWith('/api/browse') ? json({ roots: [] })
      : json({ generations: [{ generation: 'gen-000001', attempt: 1, step: 0,
        files: { 'private.onnx': { size: 5, sha256: 'a'.repeat(64) } } }] }),
});
const api = shallowRef(new DaemonApi(window.location.origin));
const context = {
  api, session, state: shallowRef({ status: 'connected', revision: 1, health: null }),
  reportFailure: computed(() => vi.fn()), monitorRun: vi.fn(), automaticPlots: { capture: vi.fn() },
};
vi.mock('../../app/composables/useWorkstation', () => ({ useWorkstation: () => context }));
const snapshot: RunMonitorSnapshot = {
  run, freshness: 'fresh', events: [{ run_id: id, attempt: 1, seq: 1, type: 'log',
    ts: '2026-10-29T00:00:00Z', payload: { message: 'retained log' } }],
  liveEvents: [], metrics: [], summary: { progress: null, best: null, latest: null },
  stream: 'live', message: '', cancellation: 'idle', truncated: false,
};
const continued = vi.fn();
const plotDestroyed = vi.hoisted(() => vi.fn());
vi.mock('uplot', () => ({ default: class {
  scales = {};
  destroy = plotDestroyed;
  setScale = vi.fn();
} }));
const Draft = defineComponent({ setup: () => () => h(StartPanel, {
  summary: { savedAt: Date.now(), steps: [], changes: [] }, dragging: false, onContinue: continued,
}) });
const Detail = defineComponent({ setup: () => () => h(RunDetail, { snapshot }) });
const Plots = defineComponent({ setup: () => () => h('div', [
  h(PreviewPlot, { title: 'Preview', x: [0, 1], y: [1, 2] }),
  h(MetricsChart, { records: [] }),
]) });
const control = shallowRef('select');
const Controls = defineComponent({ setup: () => () => control.value === 'select'
  ? h(Select, { open: true }, { default: () => [
    h(SelectTrigger, null, { default: () => 'Select' }),
    h(SelectContent, null, { default: () => h(SelectGroup, null, {
      default: () => h(SelectItem, { value: 'test' }, { default: () => 'Item' }),
    }) }),
  ] })
  : control.value === 'dropdown-menu' ? h(DropdownMenu, { open: true }, { default: () => [
    h(DropdownMenuTrigger, null, { default: () => 'Menu' }),
    h(DropdownMenuContent, null, { default: () => h(DropdownMenuGroup, null, {
      default: () => h(DropdownMenuItem, null, { default: () => 'Item' }),
    }) }),
  ] }) : h(TooltipProvider, null, { default: () => h(Tooltip, { open: true }, { default: () => [
    h(TooltipTrigger, null, { default: () => 'Help' }),
    h(TooltipContent, null, { default: () => 'Explanation' }),
  ] }) }),
});
const wrappers: Array<{ unmount(): void }> = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks(); continued.mockClear(); document.body.innerHTML = '';
  vi.unstubAllGlobals(); plotDestroyed.mockClear();
});
async function open(path: string, live = false, plots = false, controls = false) {
  vi.spyOn(api.value, 'getRun').mockResolvedValue(run);
  document.body.innerHTML = '<div id="shell-panel-tab-logs"></div><div id="shell-panel-tab-artifacts"></div>';
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/new', component: NewPage }, { path: '/datasets', component: DatasetsPage },
    { path: '/experiments/:runId?', component: ExperimentsPage },
    { path: '/results/:runId?', component: ResultsPage },
  ] });
  await router.push(path); await router.isReady();
  const Host = defineComponent({ setup: () => () => h(RouterView, null, {
    default: ({ Component }: { Component?: VNode }) =>
      h(KeepAlive, workstationPageRetention, { default: () => Component }),
  }) });
  const wrapper = mount(Host, { attachTo: document.body, global: {
    plugins: [router], stubs: { ProjectContainer: Draft, DatasetsWorkspace: controls ? Controls : plots ? Plots : true,
      ...(live ? {} : { RunsWorkspace: Detail }),
      MetricsChart: !plots, CvSummaryPanel: true, ResultOperationForm: true },
  } });
  wrappers.push(wrapper); await flushPromises();
  return { router, wrapper };
}
describe('kept-alive work page activity', () => {
  it('keeps content that remounts on reconnect while its page is hidden paused until shown', async () => {
    const { router } = await open(`/experiments/${id}`);
    const panel = () => document.getElementById('shell-panel-tab-logs')?.textContent ?? '';
    expect(panel()).toContain('retained log');
    await router.push('/datasets'); await flushPromises();
    expect(panel()).not.toContain('retained log');
    context.state.value = { ...context.state.value, revision: 2 };
    try {
      await flushPromises();
      expect(panel()).not.toContain('retained log');
      await router.push(`/experiments/${id}`); await flushPromises();
      expect(panel()).toContain('retained log');
    } finally {
      context.state.value = { ...context.state.value, revision: 1 };
    }
  });

  it('does not fetch or stream for a run workspace remounted on reconnect while hidden', async () => {
    vi.spyOn(api.value, 'listRuns').mockResolvedValue([run]);
    const streams = vi.spyOn(api.value, 'openEvents').mockImplementation(async (_id, _cursor, signal) =>
      new Response(new ReadableStream<Uint8Array>({ start(controller) {
        signal.addEventListener('abort', () => controller.close(), { once: true });
      } })),
    );
    const { router } = await open(`/experiments/${id}`, true);
    await router.push('/datasets'); await flushPromises();
    const lists = vi.mocked(api.value.listRuns).mock.calls.length;
    const opened = streams.mock.calls.length;
    context.state.value = { ...context.state.value, revision: 2 };
    try {
      await flushPromises();
      expect(api.value.listRuns).toHaveBeenCalledTimes(lists);
      expect(streams).toHaveBeenCalledTimes(opened);
      await router.push(`/experiments/${id}`); await flushPromises();
      expect(vi.mocked(api.value.listRuns).mock.calls.length).toBeGreaterThan(lists);
      expect(streams.mock.calls.length).toBeGreaterThan(opened);
    } finally {
      context.state.value = { ...context.state.value, revision: 1 };
    }
  });

  it('pauses Enter while New run is inactive and resumes exactly once without remounting', async () => {
    const { router, wrapper } = await open('/new');
    const instance = wrapper.getComponent(StartPanel).element;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(continued).toHaveBeenCalledTimes(1);
    await router.push('/datasets'); await flushPromises();
    // KeepAlive detaches inactive pages, so their CSS animations cannot run either.
    expect(document.body.contains(instance)).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(continued).toHaveBeenCalledTimes(1);
    await router.push('/new'); await flushPromises();
    expect(wrapper.getComponent(StartPanel).element).toBe(instance);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(continued).toHaveBeenCalledTimes(2);
  });
  it('parks logs outside the shared panel and restores the same content node', async () => {
    const { router } = await open(`/experiments/${id}`);
    const panel = document.getElementById('shell-panel-tab-logs');
    const node = panel?.firstElementChild;
    expect(panel?.textContent).toContain('retained log');
    await router.push('/datasets'); await flushPromises();
    expect(panel?.childElementCount).toBe(0);
    await router.push(`/experiments/${id}`); await flushPromises();
    expect(panel?.firstElementChild).toBe(node);
  });
  it('parks artifacts and restores their DOM and container instance', async () => {
    await session.connect('token');
    const { router, wrapper } = await open(`/results/${id}`);
    const instance = wrapper.getComponent(ResultsContainer).element;
    await wrapper.get('[data-testid="results-refresh"]').trigger('click'); await flushPromises();
    const panel = document.getElementById('shell-panel-tab-artifacts');
    const node = panel?.firstElementChild;
    expect(panel?.textContent).toContain('private.onnx');
    await router.push('/datasets'); await flushPromises();
    expect(panel?.childElementCount).toBe(0);
    await router.push(`/results/${id}`); await flushPromises();
    expect(panel?.firstElementChild).toBe(node);
    expect(wrapper.getComponent(ResultsContainer).element).toBe(instance);
  });
  it('pauses polling and streams, then resumes the retained cursor without duplicate events', async () => {
    vi.useFakeTimers();
    vi.spyOn(api.value, 'listRuns').mockResolvedValue([run]);
    let channel: ReadableStreamDefaultController<Uint8Array> | undefined;
    const streams = vi.spyOn(api.value, 'openEvents').mockImplementation(async (_id, _cursor, signal) =>
      new Response(new ReadableStream<Uint8Array>({ start(controller) {
        channel = controller;
        signal.addEventListener('abort', () => controller.close(), { once: true });
      } })),
    );
    function send(seq: number) {
      channel?.enqueue(new TextEncoder().encode(`id: 1:${seq}\ndata: ${JSON.stringify({
        protocol: 'wavedl-jsonl', version: 1, run_id: id, attempt: 1, seq, type: 'log',
        ts: '2026-10-29T00:00:00Z', payload: { message: `line-${seq}` },
      })}\n\n`));
    }
    const { router, wrapper } = await open(`/experiments/${id}`, true);
    const instance = wrapper.getComponent(RunsWorkspace).element;
    send(0); await flushPromises();
    await vi.advanceTimersByTimeAsync(2000);
    const requests = vi.mocked(api.value.getRun).mock.calls.length;
    expect(requests).toBeGreaterThan(1);
    await router.push('/datasets'); await flushPromises();
    expect(streams.mock.calls[0]?.[2].aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(6000);
    expect(api.value.getRun).toHaveBeenCalledTimes(requests);
    expect(streams).toHaveBeenCalledTimes(1);
    await router.push(`/experiments/${id}`); await flushPromises();
    expect(wrapper.getComponent(RunsWorkspace).element).toBe(instance);
    expect(streams).toHaveBeenCalledTimes(2);
    expect(streams.mock.calls[1]?.[1]).toEqual({ attempt: 1, seq: 0 });
    send(1); await flushPromises(); await vi.advanceTimersByTimeAsync(250);
    const panel = document.getElementById('shell-panel-tab-logs');
    expect(panel?.textContent?.match(/line-0/g)).toHaveLength(1);
    expect(panel?.textContent?.match(/line-1/g)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(vi.mocked(api.value.getRun).mock.calls.length).toBeGreaterThan(requests);
  });
  it('disconnects both chart observers while hidden and reconnects on return', async () => {
    const observers: Array<{ observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      constructor() { observers.push(this); }
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 300));
    const { router } = await open('/datasets', false, true);
    expect(observers).toHaveLength(2);
    expect(observers.every((observer) => observer.observe.mock.calls.length === 1)).toBe(true);
    await router.push('/new'); await flushPromises();
    expect(observers.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(true);
    expect(plotDestroyed).toHaveBeenCalledTimes(1);
    await router.push('/datasets'); await flushPromises();
    expect(observers).toHaveLength(4);
    expect(observers.slice(2).every((observer) => observer.observe.mock.calls.length === 1)).toBe(true);
  });
  it('keeps a pending cancellation acknowledgement across pause and never resends it on return', async () => {
    vi.spyOn(api.value, 'listRuns').mockResolvedValue([run]);
    vi.spyOn(api.value, 'openEvents').mockImplementation(async (_id, _cursor, signal) =>
      new Response(new ReadableStream({ start(controller) {
        signal.addEventListener('abort', () => controller.close(), { once: true });
      } })),
    );
    let acknowledge: ((value: RunView) => void) | undefined;
    const cancel = vi.spyOn(api.value, 'cancelRun').mockImplementation(() =>
      new Promise<RunView>((resolve) => { acknowledge = resolve; }),
    );
    const { router, wrapper } = await open(`/experiments/${id}`, true);
    wrapper.getComponent(RunDetail).vm.$emit('cancel'); await flushPromises();
    expect(cancel).toHaveBeenCalledTimes(1);
    await router.push('/datasets'); await flushPromises();
    expect(cancel.mock.calls[0]?.[1]?.aborted).toBe(false);
    acknowledge?.({ ...run, cancellation_requested: true, state: 'stopping' });
    await flushPromises();
    await router.push(`/experiments/${id}`); await flushPromises();
    expect(wrapper.getComponent(RunDetail).props('snapshot').cancellation).toBe('requested');
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it.each(['select', 'dropdown-menu', 'tooltip'])('pauses %s floating content while its page is inactive', async (kind) => {
    control.value = kind;
    const { router } = await open('/datasets', false, false, true);
    expect(document.querySelector(`[data-slot="${kind}-content"]`)).not.toBeNull();
    await router.push('/new'); await flushPromises();
    expect(document.querySelector(`[data-slot="${kind}-content"]`)).toBeNull();
    await router.push('/datasets'); await flushPromises();
    expect(document.querySelector(`[data-slot="${kind}-content"]`)).not.toBeNull();
  });
});
