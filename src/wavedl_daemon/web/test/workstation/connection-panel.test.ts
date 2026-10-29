// @vitest-environment happy-dom
import { mountWithI18n as mount } from './mountWithI18n';
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import ConnectionPanel from '../../app/components/ConnectionPanel.vue';
import { useDaemonConnection } from '../../app/composables/useDaemonConnection';
import type { ConnectionState } from '../../app/lib/connection-session';

const initial: ConnectionState = {
  status: 'disconnected',
  health: null,
  message: null,
  revision: 0,
  buildMismatch: false,
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});
describe('connection UI ownership', () => {
  it('presents a compact connection card with one credential field and one primary action', () => {
    const wrapper = mount(ConnectionPanel, { props: { state: initial } });

    expect(wrapper.get('[data-testid="connection-card"]').exists()).toBe(true);
    expect(wrapper.get('#connection-title').text()).toBe('Connect to WaveDL');
    expect(wrapper.text()).toContain('Enter your access key to get started.');
    expect(wrapper.findAll('input')).toHaveLength(1);
    expect(wrapper.findAll('button[type="submit"]')).toHaveLength(1);
    expect(wrapper.get('#daemon-bearer').attributes('aria-describedby')).toBe('daemon-bearer-help');
    expect(wrapper.get('#keep-signed-in').exists()).toBe(true);
    wrapper.unmount();
  });

  it('reveals the typed key on request and hides it again after connecting', async () => {
    const wrapper = mount(ConnectionPanel, { props: { state: initial } });
    const reveal = wrapper.get('button[aria-label="Show access key"]');
    expect(reveal.attributes('aria-pressed')).toBe('false');
    await reveal.trigger('click');
    expect(wrapper.get('#daemon-bearer').attributes('type')).toBe('text');
    expect(wrapper.get('button[aria-label="Hide access key"]').attributes('aria-pressed')).toBe(
      'true',
    );
    await wrapper.get('#daemon-bearer').setValue('visible-token');
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() => expect(wrapper.emitted('connect')).toEqual([['visible-token', false]]));
    expect(wrapper.get('#daemon-bearer').attributes('type')).toBe('password');
    wrapper.unmount();
  });

  it('validates bearer, emits only a deliberate connect, then clears it from the DOM', async () => {
    const wrapper = mount(ConnectionPanel, { props: { state: initial } });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.emitted('connect')).toBeUndefined();
    await vi.waitFor(() => expect(wrapper.get('input').attributes('aria-invalid')).toBe('true'));
    await wrapper.get('input[type="password"]').setValue('memory-only-token');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    await vi.waitFor(() =>
      expect(wrapper.emitted('connect')).toEqual([['memory-only-token', false]]),
    );
    expect(wrapper.get('input[type="password"]').element.value).toBe('');
    wrapper.unmount();
  });
  it('passes the remembered choice with a pasted master credential', async () => {
    const wrapper = mount(ConnectionPanel, {
      props: { state: initial, keepSignedIn: true },
    });
    await flushPromises();
    await wrapper.get('input[type="password"]').setValue('memory-only-token');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    await vi.waitFor(() =>
      expect(wrapper.emitted('connect')).toEqual([['memory-only-token', true]]),
    );
    wrapper.unmount();
  });
  it('offline disables connection and identity change visibly requires clearing scope', async () => {
    const wrapper = mount(ConnectionPanel, { props: { state: { ...initial, status: 'offline' } } });
    expect(wrapper.get('input').attributes('disabled')).toBeDefined();
    await wrapper.setProps({
      state: { ...initial, status: 'skew', revision: 3, message: 'Daemon identity changed.' },
    });
    expect(wrapper.text()).toContain('WaveDL has changed');
    await wrapper.get('input[type="password"]').setValue('fresh-token');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    await vi.waitFor(() => expect(wrapper.emitted('reconnect')).toEqual([['fresh-token', false]]));
    const clear = wrapper.findAll('button').find((button) => button.text().includes('start fresh'));
    await clear?.trigger('click');
    expect(wrapper.emitted('detach')).toEqual([[]]);
    wrapper.unmount();
  });
  it('clears typed credential when the scope changes and presents authentication rejection', async () => {
    const wrapper = mount(ConnectionPanel, { props: { state: initial } });
    await wrapper.get('input[type="password"]').setValue('typed-secret');
    await wrapper.setProps({
      state: {
        status: 'authentication',
        health: null,
        revision: 1,
        message: 'Credential rejected.',
      },
    });
    await flushPromises();
    expect(wrapper.get('input[type="password"]').element.value).toBe('');
    expect(wrapper.text()).toContain('Credential rejected.');
    wrapper.unmount();
  });
  it('shows verified identity and emits detach without requesting server cancellation', async () => {
    const wrapper = mount(ConnectionPanel, {
      props: {
        state: {
          status: 'connected',
          revision: 1,
          message: null,
          health: { daemon_id: 'verified-id', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 },
        },
      },
    });
    expect(wrapper.get('[data-testid="connection-live-chip"]').text()).toContain('Connected');
    expect(wrapper.get('[data-testid="connection-live-chip"]').text()).toContain('verified-id');
    expect(wrapper.get('[data-testid="connection-live-chip"]').text()).toContain('1.8.1');
    expect(wrapper.text()).toContain('verified-id');
    expect(wrapper.find('input[type="password"]').exists()).toBe(false);
    expect(wrapper.get('#keep-signed-in').attributes('aria-checked')).toBe('false');
    await wrapper.findAll('button')[1]?.trigger('click');
    expect(wrapper.emitted('detach')).toEqual([[]]);
    expect(wrapper.emitted('cancel')).toBeUndefined();
    wrapper.unmount();
  });

  it('keeps the disconnect hedge verbatim behind a labelled, click-reachable popover', async () => {
    const wrapper = mount(ConnectionPanel, {
      attachTo: document.body,
      props: {
        state: {
          status: 'connected',
          revision: 1,
          message: null,
          health: { daemon_id: 'verified-id', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 },
        },
      },
    });
    const hedge = 'Disconnecting never stops your runs. Reconnect anytime to check on them.';
    expect(document.body.textContent).not.toContain(hedge);
    const trigger = wrapper
      .findAll('button')
      .find((button) => button.text() === 'What happens when I disconnect?');
    expect(trigger?.attributes('aria-haspopup')).toBe('dialog');
    // Assert on the first render: happy-dom's focus emulation later trips reka's
    // dismiss-on-focus-outside, which a real browser does not.
    await trigger?.trigger('click');
    expect(trigger?.attributes('aria-expanded')).toBe('true');
    expect(
      document.querySelector('[data-testid="connection-disconnect-help"]')?.textContent?.trim(),
    ).toBe(hedge);
    wrapper.unmount();
  });

  it('keeps the signed-in switch reachable after connecting and emits persistence changes', async () => {
    const wrapper = mount(ConnectionPanel, {
      props: {
        state: {
          status: 'connected',
          revision: 1,
          message: null,
          health: { daemon_id: 'verified-id', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 },
        },
        keepSignedIn: false,
      },
    });
    await wrapper.get('#keep-signed-in').trigger('click');
    expect(wrapper.emitted('update:keepSignedIn')).toEqual([[true]]);
    await wrapper.setProps({ keepSignedIn: true });
    expect(wrapper.get('#keep-signed-in').attributes('aria-checked')).toBe('true');
    await wrapper.get('#keep-signed-in').trigger('click');
    expect(wrapper.emitted('update:keepSignedIn')).toEqual([[true], [false]]);
    wrapper.unmount();
  });
  it('mounted owner strips bootstrap before fetch and removes listeners on disposal', async () => {
    window.history.replaceState(null, '', '/?bootstrap=private#secret');
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      expect(window.location.search).toBe('');
      expect(window.location.hash).toBe('');
      const body = String(input).endsWith('/api/bootstrap')
        ? {
            token_type: 'Bearer',
            access_token: `session-${'m'.repeat(35)}`,
            expires_at: Date.now() + 86_400_000,
            daemon_id: 'verified-id',
          }
        : { daemon_id: 'verified-id', build_id: '1.8.1', protocol_min: 1, protocol_max: 1 };
      return new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
      });
    });
    const remove = vi.spyOn(window, 'removeEventListener');
    const localSet = vi.fn();
    const sessionSet = vi.fn();
    vi.stubGlobal('localStorage', { setItem: localSet });
    vi.stubGlobal('sessionStorage', { setItem: sessionSet });
    const Host = defineComponent({
      setup() {
        const connection = useDaemonConnection({
          origin: window.location.origin,
          buildId: '1.8.1',
          fetcher,
        });
        return () => h('p', connection.state.value.status);
      },
    });
    const wrapper = mount(Host);
    await flushPromises();
    expect(wrapper.text()).toBe('connected');
    expect(localSet).not.toHaveBeenCalled();
    expect(sessionSet).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sessionSet.mock.calls)).not.toContain('private');
    wrapper.unmount();
    expect(remove.mock.calls.some(([event]) => event === 'online')).toBe(true);
    expect(remove.mock.calls.some(([event]) => event === 'offline')).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
