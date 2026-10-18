/// <reference lib="WebWorker" />
import type { PrecacheEntry } from 'workbox-precaching';
import {
  isOfflineAssetPath,
  RetainedBuildError,
  RetainedBuildStore,
  sha256Bytes,
} from './retained-builds';

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<PrecacheEntry | string> };

// The raw injected URL/revision tuples identify this compiled worker.
const PRECACHE_ENTRIES = self.__WB_MANIFEST;
const buildKey = sha256Bytes(
  new TextEncoder().encode(
    JSON.stringify(
      PRECACHE_ENTRIES.map((entry) => {
        if (typeof entry === 'string') throw new Error('Unrevisioned precache entry');
        return [entry.url, entry.revision ?? null];
      }).sort((left, right) => (left[0]! < right[0]! ? -1 : left[0]! > right[0]! ? 1 : 0)),
    ),
  ),
);
const store = new RetainedBuildStore({
  indexedDB,
  caches,
  origin: self.location.origin,
  fetcher: fetch,
});
let refusalQuery: Promise<'capacity' | 'verification' | null | undefined> | undefined;

async function inventory(): Promise<unknown> {
  // One total deadline covers headers and the entire body, not a fresh timeout
  // per chunk that a slowly trickling server could extend indefinitely.
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      void reader?.cancel().catch(() => undefined);
      reject(new Error('Build inventory deadline exceeded'));
    }, 30_000);
  });
  try {
    return await Promise.race([readInventory(), deadline]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }

  async function readInventory(): Promise<unknown> {
    const request = new Request(`${self.location.origin}/offline-build.json`, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    const response = await fetch(request);
    controller.signal.throwIfAborted();
    if (
      response.status !== 200 ||
      response.type === 'opaque' ||
      response.redirected ||
      (response.url && response.url !== request.url) ||
      !response.body
    ) {
      throw new Error('Unavailable build inventory');
    }
    const bodyReader = response.body.getReader();
    reader = bodyReader;
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await bodyReader.read();
        controller.signal.throwIfAborted();
        if (done) break;
        length += value.byteLength;
        if (length > 128 * 1024) throw new Error('Oversized build inventory');
        chunks.push(value);
      }
    } catch (error) {
      void bodyReader.cancel().catch(() => undefined);
      throw error;
    } finally {
      bodyReader.releaseLock();
      reader = undefined;
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        await store.install(await inventory(), await buildKey);
      } catch (error) {
        const reason =
          error instanceof RetainedBuildError && error.reason === 'capacity'
            ? 'capacity'
            : 'verification';
        try {
          const clients = await self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true,
          });
          for (const client of clients) {
            if (new URL(client.url).origin === self.location.origin) {
              client.postMessage({ type: 'WAVEDL_UPDATE_REFUSED', reason });
            }
          }
        } catch {
          /* Notification is best effort; preserve the installation failure. */
        }
        throw error; // Partial or unverified generations must never activate.
      }
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await store.navigationResponse(await buildKey);
      await self.clients.claim();
    })(),
  );
});

// Explicit approval still requires durable ready state after a worker restart.
self.addEventListener('message', (event) => {
  const source = event.source;
  if (
    event.data?.type === 'WAVEDL_QUERY_UPDATE_REFUSAL' &&
    source &&
    'url' in source &&
    source.type === 'window' &&
    URL.canParse(source.url) &&
    new URL(source.url).origin === self.location.origin &&
    event.data &&
    typeof event.data === 'object' &&
    !Array.isArray(event.data) &&
    Reflect.ownKeys(event.data).length === 1 &&
    Object.hasOwn(event.data, 'type')
  ) {
    event.waitUntil(
      (async () => {
        try {
          refusalQuery ??= (async () => {
            try {
              return await store.admissionRefusal(await inventory());
            } catch (error) {
              if (error instanceof RetainedBuildError) return 'verification';
              return undefined;
            }
          })().finally(() => {
            refusalQuery = undefined;
          });
          const reason = await refusalQuery;
          if (reason && new URL(source.url).origin === self.location.origin) {
            source.postMessage({ type: 'WAVEDL_UPDATE_REFUSAL_RESULT', reason });
          }
        } catch {}
      })(),
    );
    return;
  }
  if (event.data?.type !== 'SKIP_WAITING' || !event.source || !('url' in event.source)) return;
  if (event.source.type !== 'window') return;
  if (new URL(event.source.url).origin !== self.location.origin) return;
  event.waitUntil(
    (async () => {
      await store.navigationResponse(await buildKey);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // API state, ambiguous paths, mutations and other origins stay network-only.
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    /^\/+(?:api|v1|v2|auth|events|state|tokens?)(?:\/|$)/i.test(url.pathname) ||
    /%/.test(url.pathname) ||
    url.pathname.startsWith('//')
  )
    return;
  if (request.mode === 'navigate') {
    event.respondWith(buildKey.then((key) => store.navigationResponse(key)));
    return;
  }
  if (url.search || url.hash || !isOfflineAssetPath(url.pathname)) return;
  event.respondWith(
    (async () => {
      // Corruption is a hard failure, never a fallback to an unverified body.
      const current = await store.lookupCurrent(request, await buildKey);
      if (current) return current;
      const retained = await store.lookupImmutable(request);
      if (retained) return retained;
      // A controlled worker has already admitted at least one immutable build.
      // Missing metadata/cache bytes are storage loss, not permission to
      // resurrect an unverified response from the network.
      throw new RetainedBuildError(`Offline compatibility lost: ${url.pathname}`, 'storage');
    })(),
  );
});
