// @vitest-environment happy-dom
import { computed, defineComponent, h, onScopeDispose, shallowReadonly, shallowRef } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHead, renderDOMHead } from '@unhead/vue/client';
import { mountWithI18n as mount } from './mountWithI18n';
import WorkstationLayout from '../../app/layouts/default.vue';
import { useShellNavigation } from '../../app/composables/useShellLayout';
import { useWorkstation, type WorkstationContext } from '../../app/composables/useWorkstation';
import { defaultAppearance, saveAppearance } from '../../app/lib/preferences';

const calls = vi.hoisted(() => ({ connect: vi.fn(), dispose: vi.fn(), plots: vi.fn() }));
let captured: WorkstationContext | undefined;
vi.mock('../../app/composables/useDaemonConnection', async () => {
  const { ConnectionSession } = await import('./session-fixture');
  return {
    useDaemonConnection: () => {
      calls.connect();
      const session = new ConnectionSession({
        origin: window.location.origin, buildId: 'layout-test',
        fetcher: async () => new Response(JSON.stringify({
          daemon_id: 'daemon-one', build_id: 'layout-test', protocol_min: 1, protocol_max: 1,
        }), { headers: { 'content-type': 'application/json' } }),
      });
      const state = shallowRef(session.snapshot());
      const api = shallowRef(session.api);
      const unsubscribe = session.subscribe((next) => {
        state.value = next;
        api.value = session.api;
      });
      onScopeDispose(() => { unsubscribe(); session.detach(); calls.dispose(); });
      return {
        state: shallowReadonly(state), api: shallowReadonly(api), session,
        canMutate: computed(() => state.value.status === 'connected'),
        keepSignedIn: shallowRef(false), setKeepSignedIn: vi.fn(),
        connect: (token: string) => session.connect(token),
        reconnect: (token: string) => session.reconnect(token),
        detach: () => session.detach(), refresh: () => session.refresh(),
      };
    },
  };
});
vi.mock('../../app/composables/useAutomaticPlots', () => ({
  useAutomaticPlots: () => {
    calls.plots();
    return {
      state: shallowReadonly(shallowRef({ status: 'stopped' })),
      retry: vi.fn(), stop: vi.fn(), capture: vi.fn(),
    };
  },
}));

const Probe = defineComponent({
  setup() {
    captured = useWorkstation();
    return () => h('output', { 'data-context': '' }, captured?.revision.value ?? '');
  },
});
const Settings = defineComponent({
  emits: ['appearanceChanged'],
  setup(_props, { emit }) {
    return () => h('button', {
      'data-language': 'en',
      onClick: () => emit('appearanceChanged', defaultAppearance),
    }, 'Change language');
  },
});
const Shell = defineComponent({
  props: { overlay: String, section: String },
  emits: ['update:overlay'],
  setup(props, { emit, slots }) {
    return () => h('main', [
      h('output', { 'data-section': '' }, props.section),
      h('button', { 'data-settings': '', onClick: () => emit('update:overlay', 'settings') }, 'Settings'),
      slots.default?.(),
      props.overlay === 'settings' ? slots.settings?.() : [],
    ]);
  },
});

beforeEach(() => {
  captured = undefined;
  vi.clearAllMocks();
  const items = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => { items.set(key, value); },
      removeItem: (key: string) => { items.delete(key); },
      clear: () => items.clear(),
    },
  });
});
afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('lang');
  document.documentElement.removeAttribute('style');
});

describe('workstation layout ownership and retained locale', () => {
  it('preserves saved document language across deferred head renders and reopening', async () => {
    expect(saveAppearance({ ...defaultAppearance, language: 'vi', theme: 'dark', zoom: 125 })).toBe(true);
    for (let reopen = 0; reopen < 2; reopen++) {
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/:path(.*)*', component: Probe }],
      });
      await router.push('/datasets');
      const head = createHead({ document });
      const fallback = head.push({ htmlAttrs: { lang: 'en' } });
      const wrapper = mount(WorkstationLayout, {
        slots: { default: () => h(Probe) },
        global: {
          plugins: [router, head],
          stubs: {
            WorkstationShell: Shell, SettingsWorkspace: Settings,
            ConnectionPanel: true, BuildSkewPrompt: true, AutomaticPlotStatus: true,
          },
        },
      });
      try {
        await flushPromises();
        fallback.patch({ htmlAttrs: { lang: 'en' } });
        await renderDOMHead(head);
        expect(document.documentElement.lang).toBe('vi');
        expect(document.documentElement.classList.contains('dark')).toBe(true);
        expect(document.documentElement.style.fontSize).toBe('20px');
        expect(wrapper.get('[data-section]').text()).toBe('datasets');
        expect(calls.connect).toHaveBeenCalledTimes(reopen + 1);
        expect(calls.plots).toHaveBeenCalledTimes(reopen + 1);
        if (!captured) throw new Error('Layout did not provide its context');
        await captured.connection.connect('token');
        await captured.monitorRun('training-run');
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/experiments/training-run');
        await router.push('/results');
        await captured.monitorRun('submitted-run');
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/experiments/submitted-run');
        await router.push('/results');
        expect(calls.connect).toHaveBeenCalledTimes(reopen + 1);
        const revision = captured.revision.value;
        captured.connection.detach();
        await flushPromises();
        expect(captured.revision.value).toBeGreaterThan(revision);
        await wrapper.get('[data-settings]').trigger('click');
        await flushPromises();
        await wrapper.get('[data-language]').trigger('click');
        await renderDOMHead(head);
        expect(document.documentElement.lang).toBe('en');
      } finally {
        wrapper.unmount();
        fallback.dispose();
      }
      expect(calls.dispose).toHaveBeenCalledTimes(reopen + 1);
    }
  });

  it('carries the current run between Experiments and Results navigation', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:path(.*)*', component: Probe }],
    });
    await router.push('/experiments/11111111-1111-4111-8111-111111111111');
    let navigate: ((path: string) => void) | null = null;
    const Navigator = defineComponent({
      setup() {
        navigate = useShellNavigation();
        return () => h('span');
      },
    });
    const wrapper = mount(WorkstationLayout, {
      slots: { default: () => [h(Probe), h(Navigator)] },
      global: {
        plugins: [router, createHead({ document })],
        stubs: {
          WorkstationShell: Shell, SettingsWorkspace: Settings,
          ConnectionPanel: true, BuildSkewPrompt: true, AutomaticPlotStatus: true,
        },
      },
    });
    try {
      await flushPromises();
      if (!navigate || !captured) throw new Error('Layout did not provide navigation');
      const go = async (path: string) => { navigate?.(path); await flushPromises(); };
      await go('/results');
      expect(router.currentRoute.value.path).toBe('/results/11111111-1111-4111-8111-111111111111');
      await go('/datasets');
      expect(router.currentRoute.value.path).toBe('/datasets');
      await go('/experiments');
      expect(router.currentRoute.value.path).toBe('/experiments/11111111-1111-4111-8111-111111111111');
      await router.push('/results/22222222-2222-4222-8222-222222222222');
      await go('/experiments');
      expect(router.currentRoute.value.path).toBe('/experiments/22222222-2222-4222-8222-222222222222');
      await captured.connection.connect('token');
      captured.connection.detach();
      await flushPromises();
      await go('/results');
      expect(router.currentRoute.value.path).toBe('/results');
    } finally {
      wrapper.unmount();
    }
  });

  it('fails clearly when a page requests context outside the layout', () => {
    expect(() => mount(Probe)).toThrow('useWorkstation() must be called inside the workstation layout.');
  });
});
