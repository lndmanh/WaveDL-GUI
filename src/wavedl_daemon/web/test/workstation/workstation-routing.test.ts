// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRouter, createMemoryHistory, RouterView, useRoute } from 'vue-router';
import { computed, defineComponent, h, KeepAlive, nextTick, shallowRef, type VNode } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountWithI18n as mount } from './mountWithI18n';
import ExperimentsPage from '../../app/pages/experiments/[[runId]].vue';
import NewPage from '../../app/pages/new.vue';
import DatasetsPage from '../../app/pages/datasets.vue';
import ResultsPage from '../../app/pages/results/[[runId]].vue';
import WorkstationShell from '../../app/components/shell/WorkstationShell.vue';
import { sectionForPath, sectionPath } from '../../app/shell/sections';
import { workstationPageRetention } from '../../app/shell/page-retention';
import { provideShellRouting } from '../../app/composables/useShellLayout';
import { DaemonApi } from '../../app/lib/daemon-api';
import { ConnectionSession, type ConnectionState } from '../../app/lib/connection-session';

const state = shallowRef<ConnectionState>({
  status: 'connected', health: null, message: null, revision: 1, buildMismatch: false,
});
const api = shallowRef(new DaemonApi(window.location.origin));
const session = new ConnectionSession({ origin: window.location.origin, buildId: 'routing-test' });
const context = {
  state, api, session,
  reportFailure: vi.fn(), monitorRun: vi.fn(),
  automaticPlots: { capture: vi.fn() },
};
vi.mock('../../app/composables/useWorkstation', () => ({
  useWorkstation: () => context,
}));

function workspace(name: string) {
  return defineComponent({
    setup() {
      const draft = shallowRef('');
      return () => h('section', { 'data-instance': name }, [
        h('input', {
          value: draft.value,
          onInput: (event: Event) => {
            if (event.target instanceof HTMLInputElement) draft.value = event.target.value;
          },
        }),
      ]);
    },
  });
}

function redirectFor(file: string): string {
  const source = readFileSync(resolve(process.cwd(), 'app/pages', file), 'utf8');
  const redirect = source.match(/redirect:\s*'([^']+)'/)?.[1];
  if (!redirect) throw new Error('Redirect metadata missing');
  return redirect;
}

function createWorkstationRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', redirect: redirectFor('index.vue') },
      { path: '/experiments', component: ExperimentsPage },
      { path: '/new', component: NewPage },
      { path: '/datasets', component: DatasetsPage },
      { path: '/results', component: ResultsPage },
      { path: '/:slug(.*)*', redirect: redirectFor('[...slug].vue') },
    ],
  });
}

const wrappers: Array<{ unmount(): void }> = [];
beforeEach(() => {
  state.value = { ...state.value, revision: 1 };
});
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  document.body.innerHTML = '';
});

async function open(path: string) {
  const router = createWorkstationRouter();
  await router.push(path);
  await router.isReady();
  const Host = defineComponent({
    setup() {
      const route = useRoute();
      provideShellRouting(computed(() => route.path), async (path) => {
        await router.push(path);
        return router.currentRoute.value.path;
      });
      const overlay = shallowRef<'adopt' | null>(null);
      return () => h(WorkstationShell, {
        status: 'connected',
        section: sectionForPath(route.path),
        overlay: overlay.value,
        'onUpdate:overlay': (value: 'adopt' | null) => {
          overlay.value = value;
        },
      }, {
        default: () => h(RouterView, null, {
          default: ({ Component }: { Component?: VNode }) =>
            h(KeepAlive, workstationPageRetention, { default: () => Component }),
        }),
      });
    },
  });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: {
      plugins: [router],
      stubs: {
        RunsWorkspace: workspace('experiments'),
        ProjectContainer: workspace('project'),
        DatasetsWorkspace: workspace('datasets'),
        ResultsContainer: workspace('results'),
      },
    },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return { router, wrapper };
}

describe('workstation route foundation with real work pages', () => {
  it.each(['/', '/nope/deep'])('redirects %s to experiments using page metadata', async (path) => {
    const { router, wrapper } = await open(path);
    expect(router.currentRoute.value.path).toBe('/experiments');
    expect(wrapper.findAll('[data-work-page]')).toHaveLength(1);
    expect(wrapper.get('[data-testid="nav-experiments"]').attributes('aria-current')).toBe('page');
  });

  it('pushes navigation, updates the rail, and leaves exactly one work page in the DOM', async () => {
    const { router, wrapper } = await open('/experiments');
    for (const section of ['datasets', 'project', 'results', 'experiments']) {
      await wrapper.get(`[data-testid="nav-${section}"]`).trigger('click');
      await flushPromises();
      expect(router.currentRoute.value.path).toBe(
        section === 'project' ? '/new' : `/${section}`,
      );
      expect(wrapper.findAll('[data-work-page]')).toHaveLength(1);
      expect(wrapper.get('[data-work-page]').attributes('data-work-page')).toBe(section);
      expect(wrapper.get(`[data-testid="nav-${section}"]`).attributes('aria-current')).toBe('page');
    }
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/results');
    expect(wrapper.findAll('[data-work-page]')).toHaveLength(1);
  });

  it('retains all four component instances and drafts, and resets only daemon-scoped children on revision change', async () => {
    const { router, wrapper } = await open('/experiments');
    const sections = ['experiments', 'project', 'datasets', 'results'];
    const instances = new Map<string, Element>();
    for (const section of sections) {
      await router.push(section === 'project' ? '/new' : `/${section}`);
      await flushPromises();
      await wrapper.get('[data-instance] input').setValue(`draft-${section}`);
      instances.set(section, wrapper.get('[data-instance]').element);
      expect(wrapper.findAll('[data-work-page]')).toHaveLength(1);
    }
    for (const section of sections) {
      await router.push(section === 'project' ? '/new' : `/${section}`);
      await flushPromises();
      expect(wrapper.get('[data-instance]').element).toBe(instances.get(section));
      expect(wrapper.get<HTMLInputElement>('[data-instance] input').element.value).toBe(`draft-${section}`);
      expect(wrapper.findAll('[data-work-page]')).toHaveLength(1);
    }
    state.value = { ...state.value, revision: 2 };
    await nextTick();
    for (const section of sections) {
      await router.push(section === 'project' ? '/new' : `/${section}`);
      await flushPromises();
      const element = wrapper.get('[data-instance]').element;
      const value = wrapper.get<HTMLInputElement>('[data-instance] input').element.value;
      if (section === 'project') {
        expect(element).toBe(instances.get(section));
        expect(value).toBe('draft-project');
      } else {
        expect(element).not.toBe(instances.get(section));
        expect(value).toBe('');
      }
      expect(wrapper.findAll('[data-work-page]')).toHaveLength(1);
    }
    expect(sectionPath('project')).toBe('/new');
  });
});
