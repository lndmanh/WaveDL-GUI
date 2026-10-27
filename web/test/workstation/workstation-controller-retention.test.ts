// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { computed, defineComponent, h, onMounted, onScopeDispose, shallowRef } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHead, renderDOMHead } from '@unhead/vue/client';
import WorkstationController from '../../app/components/WorkstationController.vue';
import { useDaemonConnection } from '../../app/composables/useDaemonConnection';
import { useWorkstationI18n } from '../../app/composables/useWorkstationI18n';
import { defineMessages } from '../../app/i18n/core';
import { defaultAppearance, saveAppearance } from '../../app/lib/preferences';

let capturedConnection: ReturnType<typeof useDaemonConnection> | undefined;
const authorityCalls = vi.hoisted(() => ({ fetch: vi.fn(), dispose: vi.fn() }));
vi.mock('#app', async () => {
  const { useHead } = await import('@unhead/vue');
  return { useHead };
});
vi.mock('../../app/composables/useDaemonConnection', async () => {
  const { ConnectionSession } = await import('../../app/lib/connection-session');
  const vue = await import('vue');
  return {
    useDaemonConnection: () => {
      const session = new ConnectionSession({
        origin: window.location.origin,
        buildId: 'controller-test',
        fetcher: async (input) => {
          authorityCalls.fetch(String(input));
          return new Response(
            JSON.stringify({
              daemon_id: 'daemon-one',
              build_id: 'controller-test',
              protocol_min: 1,
              protocol_max: 1,
            }),
            { headers: { 'content-type': 'application/json' } },
          );
        },
      });
      const state = vue.shallowRef(session.snapshot());
      const api = vue.shallowRef(session.api);
      const unsubscribe = session.subscribe((value) => {
        state.value = value;
        api.value = session.api;
      });
      vue.onScopeDispose(() => {
        unsubscribe();
        session.detach();
        authorityCalls.dispose();
      });
      capturedConnection = {
        state: vue.shallowReadonly(state),
        api: vue.shallowReadonly(api),
        canMutate: vue.computed(() => state.value.status === 'connected'),
        session,
        connect: (token: string) => session.connect(token),
        reconnect: (token: string) => session.reconnect(token),
        detach: () => session.detach(),
        refresh: () => session.refresh(),
      };
      return capturedConnection;
    },
  };
});
vi.mock('../../app/composables/useAutomaticPlots', async () => {
  const vue = await import('vue');
  return {
    useAutomaticPlots: () => ({
      state: vue.shallowReadonly(vue.shallowRef({ status: 'idle' })),
      retry: vi.fn(),
      stop: vi.fn(),
      capture: vi.fn(),
    }),
  };
});

const messages = defineMessages(
  { label: 'Selected publication' },
  { label: 'Bản công bố đã chọn' },
);
const sections = ['experiments', 'datasets', 'results', 'settings'] as const;
const Shell = defineComponent({
  emits: ['navigate'],
  setup(_props, { emit, slots }) {
    return () =>
      h('main', [
        ...sections.map((section) =>
          h('button', { 'data-nav': section, onClick: () => emit('navigate', section) }, section),
        ),
        slots.default?.(),
      ]);
  },
});
const Settings = defineComponent({
  emits: ['appearanceChanged'],
  setup(_props, { emit }) {
    return () =>
      h(
        'button',
        {
          'data-language': 'vi',
          onClick: () => emit('appearanceChanged', { ...defaultAppearance, language: 'vi' }),
        },
        'Switch language',
      );
  },
});

beforeEach(() => {
  const items = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => {
        items.set(key, value);
      },
      removeItem: (key: string) => {
        items.delete(key);
      },
      clear: () => items.clear(),
    },
  });
});

afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  document.documentElement.removeAttribute('lang');
  document.documentElement.removeAttribute('style');
});

describe('mounted workstation root locale navigation retention', () => {
  it('keeps saved Vietnamese document language through deferred head renders and reopening', async () => {
    expect(saveAppearance({ ...defaultAppearance, language: 'vi', theme: 'dark', zoom: 125 })).toBe(
      true,
    );
    for (let reopen = 0; reopen < 2; reopen++) {
      const head = createHead({ document });
      const shell = head.push({ htmlAttrs: { lang: 'en' }, title: 'WaveDL Workstation' });
      const wrapper = mount(WorkstationController, {
        global: {
          plugins: [head],
          stubs: {
            WorkstationShell: Shell,
            SettingsWorkspace: Settings,
            ConnectionPanel: true,
            BuildSkewPrompt: true,
            AutomaticPlotStatus: true,
          },
        },
      });
      try {
        await flushPromises();
        // The generated English shell is rendered after onMounted appearance
        // application, matching the real Nuxt startup race.
        shell.patch({ htmlAttrs: { lang: 'en' }, title: `WaveDL Workstation ${reopen}` });
        await renderDOMHead(head);
        expect(document.documentElement.lang).toBe('vi');
        expect(document.documentElement.classList.contains('dark')).toBe(true);
        expect(document.documentElement.style.fontSize).toBe('20px');
        await wrapper.get('[data-nav="settings"]').trigger('click');
        await flushPromises();
        wrapper.getComponent(Settings).vm.$emit('appearanceChanged', defaultAppearance);
        await flushPromises();
        await renderDOMHead(head);
        expect(document.documentElement.lang).toBe('en');
      } finally {
        wrapper.unmount();
        shell.dispose();
      }
    }
  });
  it('retains dataset choice, inference draft and verified publication while visiting Settings, but revokes children on daemon scope change', async () => {
    const mounts = { datasets: 0, results: 0, runs: 0 };
    const unmounts = { datasets: 0, results: 0, runs: 0 };
    const Runs = defineComponent({
      props: { initialRunId: { type: String, default: null } },
      emits: ['runSelected'],
      setup(props, { emit }) {
        const channel = shallowRef('loss');
        const zoom = shallowRef('0:100');
        const selectedRun = shallowRef<string | null>(props.initialRunId);
        const history = shallowRef('verified-history-steps-0-100');
        const { t } = useWorkstationI18n(messages);
        onMounted(() => {
          mounts.runs++;
        });
        onScopeDispose(() => {
          unmounts.runs++;
        });
        return () =>
          h('section', { 'data-workspace': 'runs' }, [
            h('input', {
              'data-channel': 'runs',
              value: channel.value,
              onInput: (event: Event) => {
                if (event.target instanceof HTMLInputElement) channel.value = event.target.value;
              },
            }),
            h('input', {
              'data-zoom': 'runs',
              value: zoom.value,
              onInput: (event: Event) => {
                if (event.target instanceof HTMLInputElement) zoom.value = event.target.value;
              },
            }),
            h(
              'button',
              {
                'data-run-select': 'runs',
                onClick: () => {
                  selectedRun.value = 'verified-run-1';
                  emit('runSelected', selectedRun.value);
                },
              },
              t('label'),
            ),
            h('output', { 'data-history': 'runs' }, history.value),
            h('output', { 'data-run-id': 'runs' }, selectedRun.value ?? 'no-run'),
          ]);
      },
    });
    function workspace(kind: 'datasets' | 'results') {
      return defineComponent({
        setup() {
          const draft = shallowRef('');
          const selected = shallowRef('');
          const approved = shallowRef(false);
          const { t } = useWorkstationI18n(messages);
          const label = computed(() => t('label'));
          onMounted(() => {
            mounts[kind]++;
          });
          onScopeDispose(() => {
            unmounts[kind]++;
          });
          return () =>
            h('section', { 'data-workspace': kind }, [
              h('input', {
                'data-draft': kind,
                value: draft.value,
                onInput: (event: Event) => {
                  if (event.target instanceof HTMLInputElement) draft.value = event.target.value;
                },
              }),
              h(
                'select',
                {
                  'data-selected': kind,
                  value: selected.value,
                  onChange: (event: Event) => {
                    if (event.target instanceof HTMLSelectElement)
                      selected.value = event.target.value;
                  },
                },
                [
                  h('option', { value: '' }, 'None'),
                  h('option', { value: 'verified-generation-1' }, label.value),
                ],
              ),
              h(
                'button',
                {
                  'data-approve': kind,
                  onClick: () => {
                    approved.value = true;
                  },
                },
                'Approve',
              ),
              h('output', { 'data-authority': kind }, approved.value ? 'retained-plan' : 'no-plan'),
            ]);
        },
      });
    }
    const wrapper = mount(WorkstationController, {
      global: {
        plugins: [createHead({ document })],
        stubs: {
          WorkstationShell: Shell,
          SettingsWorkspace: Settings,
          DatasetsWorkspace: workspace('datasets'),
          ResultsContainer: workspace('results'),
          RunsWorkspace: Runs,
          ConnectionPanel: true,
          BuildSkewPrompt: true,
          AutomaticPlotStatus: true,
        },
      },
    });
    try {
      if (!capturedConnection) throw new Error('Root did not initialize its connection.');
      await capturedConnection.connect('token');
      await flushPromises();
      expect(mounts).toEqual({ datasets: 0, results: 0, runs: 1 });
      await wrapper.get('[data-channel="runs"]').setValue('r2');
      await wrapper.get('[data-zoom="runs"]').setValue('25:50');
      await wrapper.get('[data-run-select="runs"]').trigger('click');
      const runsElement = wrapper.get('[data-workspace="runs"]').element;
      await wrapper.get('[data-nav="datasets"]').trigger('click');
      await flushPromises();
      await wrapper.get('[data-draft="datasets"]').setValue('/daemon/selected.npz');
      await wrapper.get('[data-selected="datasets"]').setValue('verified-generation-1');
      const datasetElement = wrapper.get('[data-workspace="datasets"]').element;
      await wrapper.get('[data-nav="results"]').trigger('click');
      await flushPromises();
      await wrapper.get('[data-draft="results"]').setValue('unsaved inference settings');
      await wrapper.get('[data-selected="results"]').setValue('verified-generation-1');
      await wrapper.get('[data-approve="results"]').trigger('click');
      const resultElement = wrapper.get('[data-workspace="results"]').element;
      const callsBeforeLocale = authorityCalls.fetch.mock.calls.length;
      await wrapper.get('[data-nav="settings"]').trigger('click');
      await flushPromises();
      await wrapper.get('[data-language="vi"]').trigger('click');
      await flushPromises();
      expect(document.documentElement.lang).toBe('vi');
      await wrapper.get('[data-nav="experiments"]').trigger('click');
      await flushPromises();
      expect(wrapper.get('[data-workspace="runs"]').element).toBe(runsElement);
      expect(wrapper.get<HTMLInputElement>('[data-channel="runs"]').element.value).toBe('r2');
      expect(wrapper.get<HTMLInputElement>('[data-zoom="runs"]').element.value).toBe('25:50');
      expect(wrapper.get('[data-history="runs"]').text()).toBe('verified-history-steps-0-100');
      expect(wrapper.get('[data-run-id="runs"]').text()).toBe('verified-run-1');
      expect(wrapper.get('[data-run-select="runs"]').text()).toBe('Bản công bố đã chọn');
      for (const kind of ['results', 'datasets'] as const) {
        await wrapper.get(`[data-nav="${kind}"]`).trigger('click');
        await flushPromises();
        expect(wrapper.get(`[data-workspace="${kind}"]`).element).toBe(
          kind === 'results' ? resultElement : datasetElement,
        );
        expect(wrapper.get<HTMLSelectElement>(`[data-selected="${kind}"]`).element.value).toBe(
          'verified-generation-1',
        );
        expect(wrapper.get(`[data-selected="${kind}"]`).text()).toContain('Bản công bố đã chọn');
      }
      expect(wrapper.get<HTMLInputElement>('[data-draft="datasets"]').element.value).toBe(
        '/daemon/selected.npz',
      );
      expect(wrapper.get<HTMLInputElement>('[data-draft="results"]').element.value).toBe(
        'unsaved inference settings',
      );
      expect(wrapper.get('[data-authority="results"]').text()).toBe('retained-plan');
      expect(mounts).toEqual({ datasets: 1, results: 1, runs: 1 });
      expect(unmounts).toEqual({ datasets: 0, results: 0, runs: 0 });
      expect(authorityCalls.fetch.mock.calls).toHaveLength(callsBeforeLocale);
      const revision = capturedConnection.state.value.revision;
      capturedConnection.detach();
      await flushPromises();
      expect(capturedConnection.state.value.revision).toBeGreaterThan(revision);
      expect(wrapper.find('[data-workspace="datasets"]').exists()).toBe(false);
      expect(wrapper.find('[data-workspace="results"]').exists()).toBe(false);
      expect(wrapper.find('[data-workspace="runs"]').exists()).toBe(false);
      expect(unmounts).toEqual({ datasets: 1, results: 1, runs: 1 });
      await capturedConnection.connect('replacement-token');
      await flushPromises();
      expect(mounts).toEqual({ datasets: 2, results: 2, runs: 2 });
      expect(wrapper.get('[data-run-id="runs"]').text()).toBe('no-run');
      expect(wrapper.get<HTMLInputElement>('[data-channel="runs"]').element.value).toBe('loss');
      expect(wrapper.get<HTMLInputElement>('[data-zoom="runs"]').element.value).toBe('0:100');
      expect(wrapper.get('[data-authority="results"]').text()).toBe('no-plan');
      expect(wrapper.get<HTMLSelectElement>('[data-selected="results"]').element.value).toBe('');
      expect(wrapper.get<HTMLInputElement>('[data-draft="datasets"]').element.value).toBe('');
    } finally {
      wrapper.unmount();
    }
    expect(authorityCalls.dispose).toHaveBeenCalledOnce();
  });
});
