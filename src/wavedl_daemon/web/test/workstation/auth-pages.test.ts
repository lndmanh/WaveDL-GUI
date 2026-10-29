// @vitest-environment happy-dom
import { computed, defineComponent, h, KeepAlive, type VNode } from 'vue';
import { createRouter, createWebHistory, RouterView } from 'vue-router';
import { flushPromises } from '@vue/test-utils';
import { createHead } from '@unhead/vue/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountWithI18n as mount } from './mountWithI18n';
import Layout from '../../app/layouts/default.vue';
import Login from '../../app/pages/login.vue';
import Settings from '../../app/pages/settings.vue';
import authMiddleware from '../../app/middleware/auth.global';
import { useWorkstation, type WorkstationContext } from '../../app/composables/useWorkstation';
import { useWorkstationAuth } from '../../app/composables/useWorkstationAuth';
import { SESSION_CREDENTIAL_KEY } from '../../app/lib/session-credential';
import { workstationPageRetention } from '../../app/shell/page-retention';
import { CLIENT_BUILD_ID } from '../../app/lib/build-identity';
import routerOptions from '../../app/router.options';

vi.mock('../../app/composables/useAutomaticPlots', () => ({
  useAutomaticPlots: () => ({ state: computed(() => ({ status: 'stopped' })), retry: vi.fn(), stop: vi.fn(), capture: vi.fn() }),
}));
const health = { daemon_id: 'daemon-one', build_id: CLIENT_BUILD_ID, protocol_min: 1, protocol_max: 1 };
const grant = { access_token: 's'.repeat(43), daemon_id: health.daemon_id, token_type: 'Bearer', expires_at: Date.now() + 86400000 };
const json = (body: object) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
let context: WorkstationContext | undefined;
const Probe = defineComponent({ setup() { context = useWorkstation(); return () => h('span'); } });
const Work = defineComponent({ setup: () => () => h('p', { 'data-work': '' }, 'Work') });
const wrappers: Array<{ unmount(): void }> = [];
const histories: Array<{ destroy(): void }> = [];

beforeEach(() => {
  context = undefined;
  useWorkstationAuth().value = { status: 'disconnected', resumePending: true };
  for (const area of ['localStorage', 'sessionStorage']) {
    const values = new Map<string, string>();
    Object.defineProperty(window, area, { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    } });
  }
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input) => {
    const path = new URL(String(input)).pathname;
    return path === '/api/session' || path === '/api/bootstrap' ? json(grant) : json(health);
  }));
});
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  for (const history of histories.splice(0)) history.destroy();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  document.body.innerHTML = '';
});

async function open(path: string) {
  window.history.replaceState(null, '', path);
  const history = createWebHistory();
  histories.push(history);
  const router = createRouter({ ...routerOptions, history, routes: [
    { path: '/login', component: Login }, { path: '/settings', component: Settings },
    { path: '/:path(.*)*', component: Work },
  ] });
  router.beforeEach(authMiddleware);
  const visited: string[] = [];
  router.afterEach((to) => { visited.push(to.fullPath); });
  await router.push(path);
  const Host = defineComponent({ setup() { return () => h(Layout, null, {
    default: () => [h(Probe), h(RouterView, null, {
      default: ({ Component }: { Component?: VNode }) => h(KeepAlive, workstationPageRetention, { default: () => Component }),
    })],
  }); } });
  const wrapper = mount(Host, { attachTo: document.body, global: {
    plugins: [router, createHead({ document })], stubs: { AutomaticPlotStatus: true, BuildSkewPrompt: true },
  } });
  wrappers.push(wrapper);
  await flushPromises();
  return { router, wrapper, visited };
}

describe('auth middleware and real layout/pages', () => {
  it('guards later navigation and preserves the full return query', async () => {
    const { router } = await open('/settings');
    await router.push('/datasets?sort=name');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query.next).toBe('/datasets?sort=name');
    expect(router.currentRoute.value.fullPath).toContain('next=%2Fdatasets');
    await router.push('/settings');
    expect(router.currentRoute.value.path).toBe('/settings');
  });
  it('redirects after fresh mount and reacts to disconnect with replace and next', async () => {
    const { router, wrapper } = await open('/datasets');
    expect(router.currentRoute.value.fullPath).toBe('/login?next=%2Fdatasets');
    expect(wrapper.findAll('[data-testid="connection-card"]')).toHaveLength(1);
    if (!context) throw new Error('Missing context');
    await context.connection.connect('master-key');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/datasets');
    await context.connection.detach();
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/login?next=%2Fdatasets');
    expect(window.history.state.back).not.toBe('/datasets');
  });

  it('reloads a stored session without ever visiting login, including a pending health request', async () => {
    window.sessionStorage.setItem(SESSION_CREDENTIAL_KEY, JSON.stringify({ version: 1, daemonId: health.daemon_id, origin: window.location.origin, token: grant.access_token, expiresAt: grant.expires_at }));
    let finish: ((response: Response) => void) | undefined;
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => { finish = resolve; })));
    const { router, visited } = await open('/datasets');
    expect(context?.state.value.status).toBe('connecting');
    expect(router.currentRoute.value.path).toBe('/datasets');
    finish?.(json(health));
    await flushPromises();
    expect(context?.state.value.status).toBe('connected');
    expect(router.currentRoute.value.path).toBe('/datasets');
    expect(visited.some((path) => path.startsWith('/login'))).toBe(false);
  });

  it('waits for a rejected stored session before redirecting to login', async () => {
    window.sessionStorage.setItem(SESSION_CREDENTIAL_KEY, JSON.stringify({ version: 1, daemonId: health.daemon_id, origin: window.location.origin, token: grant.access_token, expiresAt: grant.expires_at }));
    let finish: ((response: Response) => void) | undefined;
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => { finish = resolve; })));
    const { router, visited } = await open('/datasets');
    expect(visited.some((path) => path.startsWith('/login'))).toBe(false);
    finish?.(new Response(null, { status: 401 }));
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/login?next=%2Fdatasets');
  });

  it.each(['offline', 'error', 'skew'])('preserves work pages after a %s resume outcome', async (outcome) => {
    window.sessionStorage.setItem(SESSION_CREDENTIAL_KEY, JSON.stringify({ version: 1, daemonId: health.daemon_id, origin: window.location.origin, token: grant.access_token, expiresAt: grant.expires_at }));
    if (outcome === 'error') vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new TypeError('network'); }));
    if (outcome === 'skew') vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => json({ ...health, daemon_id: 'other-daemon' })));
    const { router, wrapper } = await open('/datasets');
    if (outcome === 'offline') context?.session.setOnline(false);
    await flushPromises();
    expect(context?.state.value.status).toBe(outcome);
    expect(router.currentRoute.value.path).toBe('/datasets');
    expect(wrapper.find('[data-connection-notice]').exists()).toBe(true);
  });

  it('navigates to Experiments before showing adoption from another page', async () => {
    const { router, wrapper } = await open('/login');
    if (!context) throw new Error('Missing context');
    await context.connection.connect('master-key');
    await flushPromises();
    await router.push('/datasets');
    await flushPromises();
    const shell = wrapper.getComponent({ name: 'WorkstationShell' });
    const palette = shell.getComponent({ name: 'ShellCommandPalette' });
    palette.vm.$emit('navigate', 'adopt');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/experiments');
    expect(context.overlay.value).toBe('adopt');
    expect(wrapper.findAll('[data-testid="connection-card"]')).toHaveLength(0);
  });

  it('strips bootstrap and other credential URL material through router replace before requests', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input) => {
      expect(window.location.href).not.toContain('bootstrap');
      expect(JSON.stringify(window.history.state)).not.toContain('abc');
      return new URL(String(input)).pathname === '/api/bootstrap' ? json(grant) : json(health);
    }));
    const { router, visited } = await open('/datasets?bootstrap=abc&tab=preview#secret');
    expect(router.currentRoute.value.fullPath).toBe('/datasets?tab=preview');
    expect(context?.state.value.status).toBe('connected');
    expect(visited.some((path) => path.startsWith('/login'))).toBe(false);
    expect(JSON.stringify(window.history.state)).not.toContain('bootstrap');
    expect(JSON.stringify(window.history.state)).not.toContain('secret');
  });

  it.each(['/results', '//evil.example', 'https://x', '/login', 'javascript:'])('connects on login and replaces validated next %s', async (next) => {
    const { router } = await open(`/login?next=${encodeURIComponent(next)}`);
    if (!context) throw new Error('Missing context');
    await context.connection.connect('master-key');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(next === '/results' ? next : '/experiments');
    expect(window.history.state.back).toBeNull();
  });

  it('keeps the connected login view until an actual disconnect, and clears next', async () => {
    const { router, wrapper } = await open('/login?next=/results');
    if (!context) throw new Error('Missing context');
    await context.connection.connect('master-key');
    await flushPromises();
    await router.push('/login?next=/datasets');
    await flushPromises();
    expect(wrapper.text()).toContain("You're connected");
    await wrapper.get('[data-testid="nav-connection"]').trigger('click');
    await flushPromises();
    const disconnect = wrapper.findAll('button').find((button) => button.text() === 'Disconnect');
    if (!disconnect) throw new Error('Missing disconnect button');
    await disconnect.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/login');
    expect(wrapper.text()).toContain('Connect to WaveDL');
    expect(wrapper.findAll('[data-testid="connection-card"]')).toHaveLength(1);
  });

  it('clears login next after a session disconnect outside the panel', async () => {
    const { router } = await open('/login');
    if (!context) throw new Error('Missing context');
    await context.connection.connect('master-key');
    await flushPromises();
    await router.push('/login?next=/results');
    await flushPromises();
    await context.connection.detach();
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/login');
  });

  it('renders settings while disconnected and does not retain either public page', async () => {
    const { router, wrapper } = await open('/settings');
    expect(wrapper.text()).toContain('Appearance');
    expect(wrapper.find('[data-testid="connection-card"]').exists()).toBe(false);
    const firstSettings = wrapper.get('[data-settings-page]').element;
    if (!context) throw new Error('Missing context');
    await context.connection.connect('master-key');
    await flushPromises();
    expect(wrapper.get('[data-settings-page]').element).toBe(firstSettings);
    await context.connection.detach();
    await flushPromises();
    expect(wrapper.get('[data-settings-page]').element).toBe(firstSettings);
    await router.push('/login'); await flushPromises();
    const firstLogin = wrapper.get('[data-testid="connection-card"]').element;
    await wrapper.get('[data-testid="nav-settings"]').trigger('click'); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/settings');
    expect(wrapper.get('[data-settings-page]').element).not.toBe(firstSettings);
    await router.push('/login'); await flushPromises();
    expect(wrapper.get('[data-testid="connection-card"]').element).not.toBe(firstLogin);
  });
});
