// @vitest-environment happy-dom
import { mountWithI18n as mount } from './mountWithI18n';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { useDaemonConnection } from '../../app/composables/useDaemonConnection';
import { saveKeepSignedIn } from '../../app/lib/preferences';
import { SESSION_CREDENTIAL_KEY, type SessionCredential } from '../../app/lib/session-credential';

const origin = window.location.origin;
const health = { daemon_id: 'daemon-one', build_id: 'build-a', protocol_min: 1, protocol_max: 1 };
const token = (letter: string) => `session-${letter.repeat(35)}`;
const credential = (value: string): SessionCredential => ({
  version: 1,
  daemonId: health.daemon_id,
  origin,
  token: value,
  expiresAt: Date.now() + 12 * 60 * 60 * 1000,
});
const grant = (value: string) => ({
  access_token: value,
  token_type: 'Bearer',
  expires_at: Date.now() + 12 * 60 * 60 * 1000,
  daemon_id: health.daemon_id,
});
const json = (value: object) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

function makeStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  };
}

let localStorageMock: ReturnType<typeof makeStorage>;
let sessionStorageMock: ReturnType<typeof makeStorage>;

beforeEach(() => {
  localStorageMock = makeStorage();
  sessionStorageMock = makeStorage();
  Object.defineProperty(window, 'localStorage', { configurable: true, value: localStorageMock });
  Object.defineProperty(window, 'sessionStorage', {
    configurable: true,
    value: sessionStorageMock,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorageMock.clear();
  sessionStorageMock.clear();
  window.history.replaceState(null, '', '/');
});

function host(
  fetcher: typeof fetch,
  expose: (connection: ReturnType<typeof useDaemonConnection>) => void,
) {
  return defineComponent({
    setup() {
      const connection = useDaemonConnection({ origin, buildId: health.build_id, fetcher });
      expose(connection);
      return () => h('p', connection.state.value.status);
    },
  });
}

describe('daemon connection mount ordering and storage fallback', () => {
  it.each(['session', 'local'] as const)(
    'resumes an unchanged %s envelope without writing or deleting it when storage is full',
    async (area) => {
      if (area === 'local') expect(saveKeepSignedIn(true)).toBe(true);
      const storage = area === 'local' ? localStorageMock : sessionStorageMock;
      const saved = JSON.stringify(credential(token('r')));
      storage.setItem(SESSION_CREDENTIAL_KEY, saved);
      const write = vi.spyOn(storage, 'setItem').mockImplementation(() => {
        throw new Error('quota exceeded');
      });
      const remove = vi.spyOn(storage, 'removeItem');
      const fetcher = vi.fn<typeof fetch>(async () => json(health));
      const wrapper = mount(host(fetcher, () => undefined));
      await vi.waitFor(() => expect(wrapper.text()).toBe('connected'));
      expect(write).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(storage.getItem(SESSION_CREDENTIAL_KEY)).toBe(saved);
      expect(fetcher).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    },
  );

  it('uses a bootstrap URL before a stored envelope, strips the URL first, and honors the saved choice', async () => {
    window.history.replaceState(null, '', '/?bootstrap=url-code&tab=primary#fragment');
    expect(saveKeepSignedIn(true)).toBe(true);
    const oldCredential = credential(token('o'));
    localStorageMock.setItem(SESSION_CREDENTIAL_KEY, JSON.stringify(oldCredential));
    const freshToken = token('n');
    const calls: Array<{ path: string; authorization: string | null; code?: string }> = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      expect(window.location.search).toBe('?tab=primary');
      expect(window.location.hash).toBe('');
      const url = new URL(String(input));
      const authorization = new Headers(init?.headers).get('Authorization');
      const body =
        typeof init?.body === 'string' ? (JSON.parse(init.body) as { code?: string }) : {};
      calls.push({ path: url.pathname, authorization, code: body.code });
      return url.pathname === '/api/bootstrap' ? json(grant(freshToken)) : json(health);
    });
    let connection: ReturnType<typeof useDaemonConnection> | undefined;
    const wrapper = mount(host(fetcher, (value) => (connection = value)));
    await vi.waitFor(() => expect(wrapper.text()).toBe('connected'));
    await flushPromises();

    expect(calls.map((call) => call.path)).toEqual(['/api/bootstrap', '/api/health']);
    expect(calls[0]).toMatchObject({ authorization: null, code: 'url-code' });
    expect(calls[1]?.authorization).toBe(`Bearer ${freshToken}`);
    expect(connection?.keepSignedIn.value).toBe(true);
    expect(JSON.parse(localStorageMock.getItem(SESSION_CREDENTIAL_KEY) ?? 'null')).toMatchObject({
      token: freshToken,
    });
    expect(sessionStorageMock.getItem(SESSION_CREDENTIAL_KEY)).toBeNull();
    wrapper.unmount();
  });

  it('removes a stale local envelope while opted out without inferring opt-in', async () => {
    window.history.replaceState(null, '', '/?bootstrap=one-tab-code');
    const otherTab = credential(token('q'));
    localStorageMock.setItem(SESSION_CREDENTIAL_KEY, JSON.stringify(otherTab));
    const ownToken = token('s');
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      new URL(String(input)).pathname === '/api/bootstrap' ? json(grant(ownToken)) : json(health),
    );
    let connection: ReturnType<typeof useDaemonConnection> | undefined;
    const wrapper = mount(host(fetcher, (value) => (connection = value)));
    await vi.waitFor(() => expect(wrapper.text()).toBe('connected'));

    expect(localStorageMock.getItem(SESSION_CREDENTIAL_KEY)).toBeNull();
    expect(connection?.keepSignedIn.value).toBe(false);
    expect(JSON.parse(sessionStorageMock.getItem(SESSION_CREDENTIAL_KEY) ?? 'null')).toMatchObject({
      token: ownToken,
    });
    wrapper.unmount();
  });

  it('does not resume or infer opt-in from a stale local envelope without bootstrap', async () => {
    localStorageMock.setItem(SESSION_CREDENTIAL_KEY, JSON.stringify(credential(token('q'))));
    const fetcher = vi.fn<typeof fetch>();
    let connection: ReturnType<typeof useDaemonConnection> | undefined;
    const wrapper = mount(host(fetcher, (value) => (connection = value)));
    await flushPromises();
    expect(fetcher).not.toHaveBeenCalled();
    expect(connection?.keepSignedIn.value).toBe(false);
    expect(localStorageMock.getItem(SESSION_CREDENTIAL_KEY)).toBeNull();
    wrapper.unmount();
  });

  it('strips secret query and fragment before reading a stored envelope and resumes without rotation', async () => {
    window.history.replaceState(null, '', '/?access_token=url-secret&tab=reader#fragment');
    const saved = credential(token('r'));
    sessionStorageMock.setItem(SESSION_CREDENTIAL_KEY, JSON.stringify(saved));
    const originalGet = sessionStorageMock.getItem.bind(sessionStorageMock);
    const getItem = vi.spyOn(sessionStorageMock, 'getItem').mockImplementation((key) => {
      if (key === SESSION_CREDENTIAL_KEY) {
        expect(window.location.search).toBe('?tab=reader');
        expect(window.location.hash).toBe('');
      }
      return originalGet(key);
    });
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      expect(window.location.search).toBe('?tab=reader');
      expect(window.location.hash).toBe('');
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${saved.token}`);
      return json(health);
    });
    const wrapper = mount(host(fetcher, () => undefined));
    await vi.waitFor(() => expect(wrapper.text()).toBe('connected'));

    expect(getItem).toHaveBeenCalledWith(SESSION_CREDENTIAL_KEY);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetcher.mock.calls[0]?.[0])).pathname).toBe('/api/health');
    expect(JSON.parse(sessionStorageMock.getItem(SESSION_CREDENTIAL_KEY) ?? 'null')).toMatchObject({
      token: saved.token,
    });
    wrapper.unmount();
  });

  it('keeps a bootstrap session in memory when storage reads and writes throw', async () => {
    window.history.replaceState(null, '', '/?bootstrap=memory-only-link#secret');
    vi.spyOn(localStorageMock, 'getItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    vi.spyOn(localStorageMock, 'setItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    vi.spyOn(sessionStorageMock, 'getItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    vi.spyOn(sessionStorageMock, 'setItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      expect(window.location.search).toBe('');
      expect(window.location.hash).toBe('');
      return new URL(String(input)).pathname === '/api/bootstrap'
        ? json(grant(token('m')))
        : json(health);
    });
    let connection: ReturnType<typeof useDaemonConnection> | undefined;
    const wrapper = mount(host(fetcher, (value) => (connection = value)));
    await vi.waitFor(() => expect(wrapper.text()).toBe('connected'));

    expect(connection?.api.value).not.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('moves the active envelope when the user opts in and removes the shared copy on opt-out', async () => {
    const activeToken = token('t');
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      new URL(String(input)).pathname === '/api/health' ? json(health) : json(grant(activeToken)),
    );
    let connection: ReturnType<typeof useDaemonConnection> | undefined;
    const wrapper = mount(host(fetcher, (value) => (connection = value)));
    await flushPromises();
    expect(localStorageMock.getItem('wavedl.appearance.v1')).toBeNull();
    expect(connection).toBeDefined();
    expect(await connection?.connect('master-only-token')).toBe(true);
    expect(sessionStorageMock.getItem(SESSION_CREDENTIAL_KEY)).not.toBeNull();
    expect(localStorageMock.getItem(SESSION_CREDENTIAL_KEY)).toBeNull();

    connection?.setKeepSignedIn(true);
    expect(JSON.parse(localStorageMock.getItem(SESSION_CREDENTIAL_KEY) ?? 'null')).toMatchObject({
      token: activeToken,
    });
    expect(sessionStorageMock.getItem(SESSION_CREDENTIAL_KEY)).toBeNull();
    expect(connection?.keepSignedIn.value).toBe(true);

    connection?.setKeepSignedIn(false);
    expect(localStorageMock.getItem(SESSION_CREDENTIAL_KEY)).toBeNull();
    expect(JSON.parse(sessionStorageMock.getItem(SESSION_CREDENTIAL_KEY) ?? 'null')).toMatchObject({
      token: activeToken,
    });
    expect(connection?.keepSignedIn.value).toBe(false);
    wrapper.unmount();
  });
});
