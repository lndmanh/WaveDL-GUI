// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cloneVNode, computed, defineComponent, h, KeepAlive, shallowRef, type VNode } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountWithI18n as mount } from './mountWithI18n';
import ExperimentsPage from '../../app/pages/experiments/[[runId]].vue';
import ResultsPage from '../../app/pages/results/[[runId]].vue';
import NewPage from '../../app/pages/new.vue';
import DatasetsPage from '../../app/pages/datasets.vue';
import RunsWorkspace from '../../app/components/runs/RunsWorkspace.vue';
import { DaemonApi, DaemonApiError, type RunView } from '../../app/lib/daemon-api';
import { ConnectionSession, type ConnectionState } from '../../app/lib/connection-session';
import { workstationPageRetention } from '../../app/shell/page-retention';
import { isUuid } from '../../app/lib/daemon-api-schemas';

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
function run(id: string): RunView {
  return {
    run_id: id, plan_id: id, request_id: id, backend: 'local', operation: 'train',
    attempt: null, state: 'planned', uncertainty: false, submission_requested: false,
    cancellation_requested: false, evidence: null,
  };
}
const api = shallowRef(new DaemonApi(window.location.origin));
const state = shallowRef<ConnectionState>({
  status: 'connected', health: null, revision: 1, message: null, buildMismatch: false,
});
const session = new ConnectionSession({ origin: window.location.origin, buildId: 'test' });
const context = {
  api, state, session, revision: computed(() => state.value.revision),
  reportFailure: computed(() => vi.fn()), monitorRun: vi.fn(),
  automaticPlots: { capture: vi.fn() },
};
vi.mock('../../app/composables/useWorkstation', () => ({ useWorkstation: () => context }));

const RunList = defineComponent({
  props: { query: String, filter: String },
  emits: ['update:query', 'update:filter', 'select'],
  setup(props, { emit }) {
    return () => h('div', { 'data-list': '' }, [
      h('input', {
        'data-query': '', value: props.query,
        onInput: (event: Event) => {
          if (event.target instanceof HTMLInputElement) emit('update:query', event.target.value);
        },
      }),
      h('button', { 'data-filter': '', onClick: () => emit('update:filter', 'running') }, props.filter),
      h('button', { 'data-first': '', onClick: () => emit('select', first) }),
      h('button', { 'data-second': '', onClick: () => emit('select', second) }),
    ]);
  },
});
const RunDetail = defineComponent({
  props: { snapshot: Object }, emits: ['close'],
  setup(_props, { emit }) {
    return () => h('button', { 'data-dismiss': '', onClick: () => emit('close') });
  },
});
const Draft = defineComponent({
  emits: ['submitted'],
  setup(_props, { emit }) {
    const draft = shallowRef('');
    return () => h('div', { 'data-draft': '' }, [
      h('input', { value: draft.value, onInput: (event: Event) => {
        if (event.target instanceof HTMLInputElement) draft.value = event.target.value;
      } }),
      h('button', { 'data-submit': '', onClick: () => emit('submitted', run(second)) }),
    ]);
  },
});
const Results = defineComponent({
  props: { runId: String }, emits: ['runSelected'],
  setup(props, { emit }) {
    return () => h('button', {
      'data-results': props.runId ?? '', onClick: () => emit('runSelected', second),
    });
  },
});
const wrappers: Array<{ unmount(): void }> = [];
beforeEach(() => {
  vi.restoreAllMocks();
  state.value = { ...state.value, revision: 1, health: null };
  context.monitorRun.mockClear();
  vi.spyOn(api.value, 'listRuns').mockResolvedValue([run(first), run(second)]);
  vi.spyOn(api.value, 'getRun').mockImplementation(async (id) => run(id));
  vi.spyOn(api.value, 'openEvents').mockImplementation(async (_id, _cursor, signal) => {
    return new Promise<Response>((resolveResponse) => {
      signal.addEventListener('abort', () => resolveResponse(new Response('')), { once: true });
    });
  });
});
afterEach(() => { for (const wrapper of wrappers.splice(0)) wrapper.unmount(); });

async function open(path: string) {
  function pageKey(section: string): string {
    const source = readFileSync(resolve('app/pages', section, '[[runId]].vue'), 'utf8');
    const key = source.match(/definePageMeta\(\{ key: '([^']+)' \}\)/)?.[1];
    if (!key) throw new Error('A stable Nuxt page key is required');
    return key;
  }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/experiments/:runId?', component: ExperimentsPage, meta: { key: pageKey('experiments') } },
      { path: '/results/:runId?', component: ResultsPage, meta: { key: pageKey('results') } },
      { path: '/new', component: NewPage }, { path: '/datasets', component: DatasetsPage },
    ],
  });
  context.monitorRun.mockImplementation(async (id: string) => { await router.push(`/experiments/${id}`); });
  await router.push(path);
  await router.isReady();
  const Host = defineComponent({
    setup() {
      return () => h(RouterView, null, {
        default: ({ Component, route }: { Component?: VNode; route: { meta: { key?: string } } }) =>
          h(KeepAlive, workstationPageRetention, {
            default: () => Component ? cloneVNode(Component, { key: route.meta.key }) : null,
          }),
      });
    },
  });
  const wrapper = mount(Host, { global: {
    plugins: [router], stubs: {
      RunList, RunDetail, RunOverview: true, ResultsContainer: Results,
      ProjectContainer: Draft, DatasetsWorkspace: Draft,
    },
  } });
  wrappers.push(wrapper);
  await flushPromises();
  return { router, wrapper };
}

describe('run URL ownership', () => {
  it('shares the response schema canonical lowercase UUID guard', () => {
    expect(isUuid(first)).toBe(true);
    expect(isUuid('abcdef12-abcd-abcd-abcd-abcdef123456')).toBe(true);
    for (const value of [null, undefined, 1, {}, [first], '', 'invalid',
      'ABCDEF12-ABCD-ABCD-ABCD-ABCDEF123456', `${first}\n`, ` ${first}`]) {
      expect(isUuid(value)).toBe(false);
    }
  });

  it('uses a constant Nuxt page key rather than the interpolated run path', () => {
    for (const section of ['experiments', 'results']) {
      const source = readFileSync(resolve('app/pages', section, '[[runId]].vue'), 'utf8');
      expect(source).toContain(`definePageMeta({ key: '${section}' })`);
    }
  });

  it('opens a deep link once, pushes selections/dismissal, and preserves the real run list across back/forward', async () => {
    const { router, wrapper } = await open('/experiments');
    const page = wrapper.get('[data-work-page]').element;
    const list = wrapper.get('[data-list]').element;
    await wrapper.get('[data-query]').setValue('retained');
    await wrapper.get('[data-filter]').trigger('click');
    await wrapper.get('[data-first]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(`/experiments/${first}`);
    expect(api.value.getRun).toHaveBeenCalledTimes(1);
    expect(wrapper.findComponent(RunsWorkspace).props('runId')).toBe(first);
    router.back(); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/experiments');
    expect(wrapper.find('[data-dismiss]').exists()).toBe(false);
    router.forward(); await flushPromises();
    expect(router.currentRoute.value.path).toBe(`/experiments/${first}`);
    expect(api.value.getRun).toHaveBeenCalledTimes(2);
    await wrapper.get('[data-second]').trigger('click'); await flushPromises();
    expect(router.currentRoute.value.path).toBe(`/experiments/${second}`);
    expect(wrapper.get('[data-work-page]').element).toBe(page);
    expect(wrapper.get('[data-list]').element).toBe(list);
    expect(wrapper.get<HTMLInputElement>('[data-query]').element.value).toBe('retained');
    expect(wrapper.get('[data-filter]').text()).toBe('running');
    await wrapper.get('[data-dismiss]').trigger('click'); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/experiments');
    router.back(); await flushPromises();
    expect(router.currentRoute.value.path).toBe(`/experiments/${second}`);
  });

  it('restores a direct experiments link and submits from New using the route hand-off', async () => {
    const { router, wrapper } = await open(`/experiments/${first}`);
    expect(wrapper.find('[data-dismiss]').exists()).toBe(true);
    expect(api.value.getRun).toHaveBeenCalledTimes(1);
    await router.push('/new'); await flushPromises();
    await wrapper.get('[data-submit]').trigger('click'); await flushPromises();
    expect(context.monitorRun).toHaveBeenLastCalledWith(second);
    expect(router.currentRoute.value.path).toBe(`/experiments/${second}`);
  });

  it.each(['experiments', 'results'])('replaces invalid and daemon-404 %s ids without adding a history entry', async (section) => {
    const { router } = await open('/new');
    await router.push(`/${section}/INVALID`); await flushPromises();
    expect(router.currentRoute.value.path).toBe(`/${section}`);
    expect(api.value.getRun).not.toHaveBeenCalled();
    router.back(); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/new');
    vi.mocked(api.value.getRun).mockRejectedValue(new DaemonApiError('http', 'missing', 404));
    await router.push(`/${section}/${first}`); await flushPromises();
    expect(router.currentRoute.value.path).toBe(`/${section}`);
    expect(api.value.getRun).toHaveBeenCalledTimes(1);
    router.back(); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/new');
  });

  it('keeps Results root and run URLs on the same page', async () => {
    const { router, wrapper } = await open('/results');
    const page = wrapper.get('[data-work-page]').element;
    const results = wrapper.get('[data-results]').element;
    await router.push(`/results/${second}`); await flushPromises();
    expect(wrapper.get('[data-results]').attributes('data-results')).toBe(second);
    expect(wrapper.get('[data-work-page]').element).toBe(page);
    expect(wrapper.get('[data-results]').element).toBe(results);
    router.back(); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/results');
  });

  it('hands a run submitted from Results to Experiments for monitoring', async () => {
    const { router, wrapper } = await open(`/results/${first}`);
    await wrapper.get('[data-results]').trigger('click'); await flushPromises();
    expect(context.monitorRun).toHaveBeenCalledWith(second);
    expect(router.currentRoute.value.path).toBe(`/experiments/${second}`);
  });

  it.each(['experiments', 'results'])('reconnect replaces a now-unknown %s run without an error loop', async (section) => {
    const { router, wrapper } = await open(`/${section}/${first}`);
    const old = wrapper.get('[data-work-page]').element.firstElementChild;
    vi.mocked(api.value.getRun).mockRejectedValue(new DaemonApiError('http', 'missing', 404));
    state.value = { ...state.value, revision: 2 };
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(`/${section}`);
    expect(api.value.getRun).toHaveBeenCalledTimes(2);
    expect(wrapper.get('[data-work-page]').element.firstElementChild).not.toBe(old);
  });

  it.each(['experiments', 'results'])('ignores late %s 404s after another run or section is selected', async (section) => {
    let rejectOld: (error: Error) => void = () => { throw new Error('No pending request'); };
    vi.mocked(api.value.getRun).mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectOld = reject;
    }));
    const { router } = await open(`/${section}/${first}`);
    await router.push(`/${section}/${second}`); await flushPromises();
    rejectOld(new DaemonApiError('http', 'missing', 404)); await flushPromises();
    expect(router.currentRoute.value.path).toBe(`/${section}/${second}`);

    vi.mocked(api.value.getRun).mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectOld = reject;
    }));
    await router.push(`/${section}/${first}`); await flushPromises();
    await router.push('/datasets'); await flushPromises();
    rejectOld(new DaemonApiError('http', 'missing', 404)); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/datasets');
  });

  it.each(['experiments', 'results'])('does not mistake a %s transport failure for an unknown run', async (section) => {
    vi.mocked(api.value.getRun).mockRejectedValue(new DaemonApiError('http', 'unavailable', 503));
    const { router } = await open(`/${section}/${first}`);
    expect(router.currentRoute.value.path).toBe(`/${section}/${first}`);
  });

  it('resets all daemon children on identity change while preserving the New draft', async () => {
    const { router, wrapper } = await open('/new');
    await wrapper.get('[data-draft] input').setValue('surviving draft');
    const draft = wrapper.get('[data-draft]').element;
    const sections = ['experiments', 'datasets', 'results'];
    const children = new Map<string, Element | null>();
    for (const section of sections) {
      await router.push(`/${section}`); await flushPromises();
      children.set(section, wrapper.get('[data-work-page]').element.firstElementChild);
    }
    state.value = { ...state.value, health: {
      daemon_id: 'new-daemon', build_id: 'test', protocol_min: 1, protocol_max: 1,
    } };
    await flushPromises();
    for (const section of sections) {
      await router.push(`/${section}`); await flushPromises();
      expect(wrapper.get('[data-work-page]').element.firstElementChild).not.toBe(children.get(section));
    }
    await router.push('/new'); await flushPromises();
    expect(wrapper.get('[data-draft]').element).toBe(draft);
    expect(wrapper.get<HTMLInputElement>('[data-draft] input').element.value).toBe('surviving draft');
  });
});
