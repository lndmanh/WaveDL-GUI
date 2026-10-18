import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { IDBFactory } from 'fake-indexeddb';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readonly, shallowRef } from 'vue';
import {
  installationRefusalMessage,
  installationRefusalQueryResult,
  UpdateConsent,
} from '../../workstation/lib/update-consent';
import {
  inventoryGeneration,
  RETAINED_BUILD_DATABASE,
  RETAINED_BUILD_CACHE_PREFIX,
  sha256Bytes,
} from '../../workstation/service-worker/retained-builds';

afterEach(() => vi.unstubAllGlobals());

async function pluginClient(waiting = false) {
  const source = await readFile(
    new URL('../../workstation/plugins/workstation-update.client.ts', import.meta.url),
    'utf8',
  );
  const compiled = transpileModule(source, {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText;
  const listeners = new Map<string, (event: unknown) => void>();
  class Worker {
    scriptURL = 'https://workstation.example/sw.js';
    postMessage = vi.fn();
  }
  const controller = new Worker();
  const active = new Worker();
  const ready = { active, waiting: waiting ? new Worker() : null };
  let hooks: { onNeedRefresh(): void } | undefined;
  let provided: { state: { value: { installationRefusal: string | null } } } | undefined;
  const container = {
    controller,
    ready: Promise.resolve(ready),
    addEventListener: (name: string, handler: (event: unknown) => void) =>
      listeners.set(name, handler),
    removeEventListener: vi.fn(),
  };
  runInNewContext(
    compiled
      .replace(/^import .*?;\n/gm, '')
      .replace('export default', 'capture(')
      .replace(/;\s*$/, ');')
      .replace(/import\.meta\.hot\?\.dispose/g, 'hot?.dispose'),
    {
      defineNuxtPlugin: (callback: () => unknown) => callback(),
      shallowRef,
      readonly,
      UpdateConsent,
      installationRefusalMessage,
      installationRefusalQueryResult,
      ServiceWorker: Worker,
      navigator: { serviceWorker: container },
      window: { location: { origin: 'https://workstation.example', reload: vi.fn() } },
      hot: undefined,
      useRegisterSW: (options: typeof hooks) => {
        hooks = options;
        return { updateServiceWorker: vi.fn() };
      },
      capture: (plugin: { provide: { workstationUpdate: typeof provided } }) => {
        provided = plugin.provide.workstationUpdate;
      },
    },
  );
  await Promise.resolve();
  // The imported validators execute in this test realm, so use its worker constructor.
  vi.stubGlobal('ServiceWorker', Worker);
  return { controller, active, hooks, provided, listeners, container };
}

describe('startup refusal queries', () => {
  it('queries controller/active on startup and controller changes, never the waiting worker', async () => {
    const client = await pluginClient(true);
    expect(client.controller.postMessage).toHaveBeenCalledWith({
      type: 'WAVEDL_QUERY_UPDATE_REFUSAL',
    });
    expect(client.active.postMessage).toHaveBeenCalledWith({ type: 'WAVEDL_QUERY_UPDATE_REFUSAL' });
    client.listeners.get('controllerchange')?.({});
    expect(client.controller.postMessage).toHaveBeenCalledTimes(2);
    client.listeners.get('message')?.({
      source: client.active,
      data: { type: 'WAVEDL_UPDATE_REFUSAL_RESULT', reason: 'capacity' },
    });
    expect(client.provided?.state.value.installationRefusal).toBeNull();
  });

  it('restores advisory capacity but ignores a late query after a verified waiting callback', async () => {
    const client = await pluginClient();
    const event = {
      source: client.active,
      data: { type: 'WAVEDL_UPDATE_REFUSAL_RESULT', reason: 'capacity' },
    };
    client.listeners.get('message')?.(event);
    expect(client.provided?.state.value.installationRefusal).toBe('capacity');
    client.hooks?.onNeedRefresh();
    client.listeners.get('message')?.(event);
    expect(client.provided?.state.value.installationRefusal).toBeNull();
    client.listeners.get('message')?.({
      ...event,
      data: { type: 'WAVEDL_UPDATE_REFUSED', reason: 'verification' },
    });
    expect(client.provided?.state.value.installationRefusal).toBe('verification');
  });

  it('rejects forged query results and extra payload fields', async () => {
    const client = await pluginClient();
    for (const event of [
      { source: null, data: { type: 'WAVEDL_UPDATE_REFUSAL_RESULT', reason: 'capacity' } },
      {
        source: client.active,
        data: { type: 'WAVEDL_UPDATE_REFUSAL_RESULT', reason: 'capacity', forged: true },
      },
      {
        source: { scriptURL: client.active.scriptURL },
        data: { type: 'WAVEDL_UPDATE_REFUSAL_RESULT', reason: 'capacity' },
      },
      {
        source: client.controller,
        data: { type: 'WAVEDL_UPDATE_REFUSAL_RESULT', reason: 'capacity' },
      },
    ])
      client.listeners.get('message')?.(event);
    expect(client.provided?.state.value.installationRefusal).toBeNull();
    client.listeners.get('controllerchange')?.({});
    client.listeners.get('message')?.({
      source: client.active,
      data: { type: 'WAVEDL_UPDATE_REFUSAL_RESULT', reason: 'capacity' },
    });
    expect(client.provided?.state.value.installationRefusal).toBeNull();
  });

  it('coalesces exact same-origin window queries and never responds to forged senders', async () => {
    vi.resetModules();
    const listeners = new Map<
      string,
      (event: {
        source: unknown;
        data: unknown;
        waitUntil(promise: Promise<unknown>): void;
      }) => void
    >();
    let release: ((response: Response) => void) | undefined;
    const fetcher = vi.fn(
      (_request: Request) =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const origin = 'https://workstation.example';
    vi.stubGlobal('self', {
      location: { origin },
      __WB_MANIFEST: [],
      addEventListener: (
        type: string,
        handler: typeof listeners extends Map<string, infer T> ? T : never,
      ) => listeners.set(type, handler),
    });
    const indexedDB = new IDBFactory();
    vi.stubGlobal('indexedDB', indexedDB);
    const caches = { keys: async () => [], open: vi.fn(), delete: vi.fn() };
    vi.stubGlobal('caches', caches);
    vi.stubGlobal('fetch', fetcher);
    await import('../../workstation/service-worker/sw');
    const handler = listeners.get('message')!;
    const source = { type: 'window', url: `${origin}/`, postMessage: vi.fn() };
    const pending: Promise<unknown>[] = [];
    const dispatch = (sender: unknown, data: unknown) =>
      handler({ source: sender, data, waitUntil: (promise) => pending.push(promise) });
    dispatch(null, { type: 'WAVEDL_QUERY_UPDATE_REFUSAL' });
    dispatch({ ...source, type: 'worker' }, { type: 'WAVEDL_QUERY_UPDATE_REFUSAL' });
    dispatch({ ...source, url: 'https://evil.example/' }, { type: 'WAVEDL_QUERY_UPDATE_REFUSAL' });
    dispatch(source, { type: 'WAVEDL_QUERY_UPDATE_REFUSAL', extra: true });
    expect(fetcher).not.toHaveBeenCalled();
    dispatch(source, { type: 'WAVEDL_QUERY_UPDATE_REFUSAL' });
    dispatch(source, { type: 'WAVEDL_QUERY_UPDATE_REFUSAL' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const request = fetcher.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      url: `${origin}/offline-build.json`,
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    });
    release?.(new Response('{}'));
    await Promise.all(pending);
    expect(source.postMessage).toHaveBeenCalledTimes(2);
    expect(source.postMessage).toHaveBeenCalledWith({
      type: 'WAVEDL_UPDATE_REFUSAL_RESULT',
      reason: 'verification',
    });
    const assets = [
      {
        url: '/',
        sha256: await sha256Bytes(new TextEncoder().encode('shell')),
        size: 5,
        immutable: false,
      },
    ];
    const generation = await inventoryGeneration(assets);
    const inventory = { schema_version: 1, build_key: 'd'.repeat(64), generation, assets };
    const opening = indexedDB.open(RETAINED_BUILD_DATABASE, 1);
    const database = await new Promise<IDBDatabase>((resolve) => {
      opening.onsuccess = () => resolve(opening.result);
    });
    const transaction = database.transaction('builds', 'readwrite');
    for (const key of ['a', 'b', 'c']) {
      const owner = crypto.randomUUID();
      transaction.objectStore('builds').put({
        inventory: { ...inventory, build_key: key.repeat(64) },
        status: 'ready',
        owner,
        cacheName: `${RETAINED_BUILD_CACHE_PREFIX}${generation}-${owner}`,
        reservedBytes: 5,
      });
    }
    await new Promise<void>((resolve) => {
      transaction.oncomplete = () => resolve();
    });
    source.postMessage.mockClear();
    dispatch(source, { type: 'WAVEDL_QUERY_UPDATE_REFUSAL' });
    release?.(new Response(JSON.stringify(inventory)));
    await Promise.all(pending);
    expect(source.postMessage).toHaveBeenCalledWith({
      type: 'WAVEDL_UPDATE_REFUSAL_RESULT',
      reason: 'capacity',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(caches.open).not.toHaveBeenCalled();
    expect(caches.delete).not.toHaveBeenCalled();
    source.postMessage.mockClear();
    fetcher.mockRejectedValueOnce(new TypeError('offline'));
    dispatch(source, { type: 'WAVEDL_QUERY_UPDATE_REFUSAL' });
    await Promise.all(pending);
    expect(source.postMessage).not.toHaveBeenCalled();
    database.close();
  });
});
