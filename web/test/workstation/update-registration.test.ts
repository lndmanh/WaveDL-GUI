import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { ref, type Ref } from 'vue';
import { UpdateConsent } from '../../workstation/lib/update-consent';

// Execute the installed registration implementation; fake only the browser's
// Workbox/controller transport. This is not real multi-tab browser acceptance.
async function registeredClient(reloadHook = true) {
  const source = await readFile(
    new URL('../../node_modules/vite-plugin-pwa/dist/client/build/vue.js', import.meta.url),
    'utf8',
  );
  const listeners = new Map<string, ((event: { isUpdate: boolean }) => void)[]>();
  const reload = vi.fn();
  const skipWaiting = vi.fn();
  let needRefresh = ref(false);
  let activate: () => Promise<void> = async () => {
    throw new Error('Not registered');
  };
  const consent = new UpdateConsent({ activate: () => activate(), reload });
  class Workbox {
    addEventListener(name: string, listener: (event: { isUpdate: boolean }) => void) {
      listeners.set(name, [...(listeners.get(name) ?? []), listener]);
    }
    async register() {
      return {};
    }
    messageSkipWaiting() {
      skipWaiting();
    }
  }
  runInNewContext(
    source
      .replace(/^import \{ ref \} from ["']vue["'];?\r?\n/m, '')
      .replace(/import\("workbox-window"\)/, 'Promise.resolve({ Workbox })')
      .replace(/export\s*\{[\s\S]*?\};?\s*$/, '') + '\ncapture(useRegisterSW(options));',
    {
      Workbox,
      ref,
      navigator: { serviceWorker: {} },
      window: { location: { reload } },
      options: {
        immediate: true,
        onNeedRefresh: () => consent.available(),
        ...(reloadHook ? { onNeedReload: () => consent.controlled() } : {}),
        onRegisterError: () => consent.registrationFailed(),
      },
      capture(registration: {
        updateServiceWorker: () => Promise<void>;
        needRefresh: Ref<boolean>;
      }) {
        activate = registration.updateServiceWorker;
        needRefresh = registration.needRefresh;
      },
    },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  function emit(name: string) {
    for (const listener of listeners.get(name) ?? []) listener({ isUpdate: true });
  }
  emit('waiting');
  return { consent, reload, skipWaiting, emit, needRefresh };
}

describe('installed PWA registration hooks', () => {
  it('does not request SKIP_WAITING or reload after refusal until a new SDK waiting callback', async () => {
    const client = await registeredClient();
    client.consent.installationRefused('verification');
    await client.consent.approve();
    client.emit('controlling');
    expect(client.skipWaiting).not.toHaveBeenCalled();
    expect(client.reload).not.toHaveBeenCalled();
    expect(client.consent.snapshot().installationRefusal).toBe('verification');
    client.emit('waiting');
    expect(client.consent.snapshot()).toMatchObject({ installationRefusal: null, failed: false });
    await client.consent.approve();
    expect(client.skipWaiting).toHaveBeenCalledOnce();
    expect(client.reload).not.toHaveBeenCalled();
    client.emit('controlling');
    expect(client.reload).toHaveBeenCalledOnce();
  });

  it('demonstrates the default SDK reloads an unapproved client on external takeover', async () => {
    const client = await registeredClient(false);
    expect(client.needRefresh.value).toBe(true);
    client.emit('controlling');
    expect(client.reload).toHaveBeenCalledOnce();
    expect(client.skipWaiting).not.toHaveBeenCalled();
  });

  it('reloads only the approving client and lets another approve after takeover', async () => {
    const a = await registeredClient();
    const b = await registeredClient();
    expect(a.needRefresh.value).toBe(true);
    expect(b.needRefresh.value).toBe(true);
    b.consent.defer();
    await a.consent.approve();
    expect(a.skipWaiting).toHaveBeenCalledOnce();
    expect(b.skipWaiting).not.toHaveBeenCalled();
    a.emit('controlling');
    b.emit('controlling');
    expect(a.reload).toHaveBeenCalledOnce();
    expect(b.reload).not.toHaveBeenCalled();
    expect(b.consent.snapshot()).toMatchObject({ available: true, dismissed: false });
    await b.consent.approve();
    b.emit('controlling');
    expect(b.reload).toHaveBeenCalledOnce();
    expect(b.skipWaiting).not.toHaveBeenCalled();
  });
});
