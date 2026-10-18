// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DaemonApi, type RunView } from '../../workstation/lib/daemon-api';
import { useRuns } from '../../workstation/composables/useRuns';
const id = '11111111-1111-1111-1111-111111111111';
function run(state: RunView['state'] = 'running'): RunView {
  return {
    plan_id: id,
    run_id: id,
    request_id: id,
    backend: 'local',
    operation: 'train',
    attempt: 1,
    state,
    uncertainty: false,
    submission_requested: true,
    cancellation_requested: state === 'cancelled',
    evidence: null,
  };
}
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
});
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
function setup() {
  const api = new DaemonApi(location.origin);
  let current = run();
  const list = vi.spyOn(api, 'listRuns').mockImplementation(async () => [current]);
  const get = vi.spyOn(api, 'getRun').mockImplementation(async () => current);
  const cancel = vi.spyOn(api, 'cancelRun').mockImplementation(async () => {
    current = run('cancelled');
    return current;
  });
  vi.spyOn(api, 'openEvents').mockImplementation(
    async (_id, _cursor, signal) =>
      new Response(
        new ReadableStream({
          start(controller) {
            signal?.addEventListener(
              'abort',
              () => {
                try {
                  controller.close();
                } catch {
                  /* closed */
                }
              },
              { once: true },
            );
          },
        }),
      ),
  );
  let state: ReturnType<typeof useRuns> | undefined;
  const wrapper = mount(
    defineComponent({
      setup() {
        state = useRuns(api, vi.fn());
        return () => h('div');
      },
    }),
  );
  cleanups.push(() => wrapper.unmount());
  if (!state) throw new Error('Composable was not mounted');
  return {
    state,
    list,
    get,
    cancel,
    setCurrent: (value: RunView) => {
      current = value;
    },
  };
}
describe('mounted run workspace authority', () => {
  it('merges confirmed cancellation into list without optimism before reply', async () => {
    const { state, cancel } = setup();
    await flush();
    state.select(id);
    await flush();
    let resolve: ((view: RunView) => void) | undefined;
    cancel.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const request = state.cancel();
    await flush();
    expect(state.runs.value[0]?.state).toBe('running');
    resolve?.(run('cancelled'));
    await request;
    expect(state.selected.value?.run?.state).toBe('cancelled');
    expect(state.runs.value[0]?.state).toBe('cancelled');
  });
  it('propagates stale lifecycle detail and failed list refresh markers', async () => {
    vi.useFakeTimers();
    const { state, get, list } = setup();
    await flush();
    state.select(id);
    await flush();
    get.mockRejectedValueOnce(new Error('poll interrupted'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(state.staleRunIds.value.has(id)).toBe(true);
    expect(state.runs.value[0]?.state).toBe('running');
    await vi.advanceTimersByTimeAsync(2000);
    expect(state.staleRunIds.value.has(id)).toBe(false);
    list.mockRejectedValueOnce(new Error('list interrupted'));
    await state.refresh();
    expect(state.staleRunIds.value.has(id)).toBe(true);
    expect(state.message.value).toBe('Unable to refresh runs.');
  });
  it('fences delayed list replies from overwriting newer monitored lifecycle', async () => {
    vi.useFakeTimers();
    const { state, list, setCurrent } = setup();
    await flush();
    state.select(id);
    await flush();
    let resolve: ((views: RunView[]) => void) | undefined;
    list.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const request = state.refresh();
    setCurrent(run('failed'));
    await vi.advanceTimersByTimeAsync(2000);
    resolve?.([run()]);
    await request;
    expect(state.runs.value[0]?.state).toBe('failed');
    expect(state.lastRefreshed.value).not.toBeNull();
  });
});
