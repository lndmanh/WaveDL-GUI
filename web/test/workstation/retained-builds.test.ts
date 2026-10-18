import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import {
  inventoryGeneration,
  isOfflineAssetPath,
  RETAINED_BUILD_CACHE_PREFIX,
  RETAINED_BUILD_DATABASE,
  RETAINED_BUILD_LIMITS,
  RetainedBuildStore,
  sha256Bytes,
  type OfflineBuildInventory,
  type RetainedCacheStorage,
} from '../../workstation/service-worker/retained-builds';

const origin = 'https://workstation.example';

class MemoryCaches implements RetainedCacheStorage {
  buckets = new Map<string, Map<string, Response>>();
  deleted: string[] = [];
  rejectDeletion = false;
  beforeKeys?: () => Promise<void>;
  afterKeys?: () => Promise<void>;
  async keys() {
    await this.beforeKeys?.();
    const names = [...this.buckets.keys()];
    await this.afterKeys?.();
    return names;
  }
  async has(name: string) {
    return this.buckets.has(name);
  }
  async open(name: string) {
    let bucket = this.buckets.get(name);
    if (!bucket) {
      bucket = new Map();
      this.buckets.set(name, bucket);
    }
    const entries = bucket;
    return {
      async match(url: string) {
        return entries.get(url)?.clone();
      },
      async put(url: string, response: Response) {
        entries.set(url, response.clone());
      },
    };
  }
  async delete(name: string) {
    this.deleted.push(name);
    if (this.rejectDeletion) throw new Error('cache deletion unavailable');
    return this.buckets.delete(name);
  }
}

async function fixture(key: string, paths: Record<string, string> = {}) {
  const bodies = {
    '/': `<html>${key}</html>`,
    [`/_nuxt/${key}.js`]: `export default '${key}'`,
    ...paths,
  };
  const assets = await Promise.all(
    Object.entries(bodies).map(async ([url, body]) => {
      const bytes = new TextEncoder().encode(body);
      return {
        url,
        sha256: await sha256Bytes(bytes),
        size: bytes.byteLength,
        immutable: url.startsWith('/_nuxt/'),
      };
    }),
  );
  const inventory: OfflineBuildInventory = {
    schema_version: 1,
    build_key: await sha256Bytes(new TextEncoder().encode(key)),
    generation: await inventoryGeneration(assets),
    assets,
  };
  const fetcher: typeof fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    const path = new URL(url).pathname;
    const body = Object.entries(bodies).find(([entry]) => entry === path)?.[1];
    const type =
      path === '/'
        ? 'text/html'
        : path.endsWith('.js')
          ? 'application/javascript'
          : path.endsWith('.svg')
            ? 'image/svg+xml'
            : 'application/octet-stream';
    return body === undefined
      ? new Response('missing', { status: 404 })
      : new Response(body, { headers: { 'Content-Type': type } });
  };
  return { inventory, fetcher };
}

function harness(caches = new MemoryCaches(), indexedDB = new IDBFactory()) {
  return {
    caches,
    indexedDB,
    store: (fetcher: typeof fetch, currentBuildKey?: string) =>
      new RetainedBuildStore({ indexedDB, caches, origin, fetcher, currentBuildKey }),
  };
}

describe('retained offline builds', () => {
  it('recovers quota refusal read-only from v1 metadata without closing older connections', async () => {
    const h = harness();
    const builds = await Promise.all(['a', 'b', 'c', 'd'].map((key) => fixture(key)));
    const first = builds[0]!;
    const old = h.store(first.fetcher);
    for (const build of builds.slice(0, 3)) {
      await h.store(build.fetcher).install(build.inventory, build.inventory.build_key);
    }
    const fetcher = vi.fn(first.fetcher);
    const restarted = h.store(fetcher);
    const buckets = [...h.caches.buckets.keys()];
    await expect(restarted.admissionRefusal(builds[3]!.inventory)).resolves.toBe('capacity');
    await expect(restarted.admissionRefusal(first.inventory)).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect([...h.caches.buckets.keys()]).toEqual(buckets);
    expect(h.caches.deleted).toEqual([]);
    expect(await (await old.navigationResponse(first.inventory.build_key)).text()).toBe(
      '<html>a</html>',
    );
    const request = h.indexedDB.open(RETAINED_BUILD_DATABASE, 1);
    const database = await new Promise<IDBDatabase>((resolve) => {
      request.onsuccess = () => resolve(request.result);
    });
    expect(database.version).toBe(1);
    expect([...database.objectStoreNames]).toEqual(['builds']);
    database.close();
  });

  it('counts pending cleanup debt without mutating it and rejects identity/schema corruption', async () => {
    const h = harness();
    const build = await fixture('a');
    await h.store(build.fetcher).install(build.inventory, build.inventory.build_key);
    h.caches.rejectDeletion = true;
    for (const key of ['b', 'c']) {
      const failed = await fixture(key);
      await expect(
        h
          .store(async () => new Response('wrong'))
          .install(failed.inventory, failed.inventory.build_key),
      ).rejects.toThrow();
    }
    const candidate = await fixture('d');
    const restarted = h.store(vi.fn());
    await expect(restarted.admissionRefusal(candidate.inventory)).resolves.toBe('capacity');
    await expect(
      restarted.admissionRefusal({ ...candidate.inventory, generation: '0'.repeat(64) }),
    ).rejects.toThrow('identity');
    await expect(
      restarted.admissionRefusal({ ...candidate.inventory, secret: 'invalid' }),
    ).rejects.toThrow('inventory');
    const pending = await fixture('b');
    await expect(restarted.admissionRefusal(pending.inventory)).rejects.toThrow('reserved');
    h.caches.buckets.set(`${RETAINED_BUILD_CACHE_PREFIX}unknown`, new Map());
    await expect(restarted.admissionRefusal(candidate.inventory)).rejects.toThrow('unaccounted');
  });
  it('invokes injected global fetch without a store receiver', async () => {
    const h = harness();
    const build = await fixture('native-fetch');
    const receiverChecked: typeof fetch = async function (this: unknown, ...args) {
      if (this !== undefined) throw new TypeError('Illegal invocation');
      return build.fetcher(...args);
    };
    await h.store(receiverChecked).install(build.inventory, build.inventory.build_key);
    expect(h.caches.buckets.size).toBe(1);
  });

  it('aborts a stalled network fetch at the total deadline and releases confirmed cleanup quota', async () => {
    const h = harness();
    const build = await fixture('stall-fetch');
    let started: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    let signal: AbortSignal | undefined;
    let finish: ((response: Response) => void) | undefined;
    const stalled: typeof fetch = async (input) => {
      if (input instanceof Request) signal = input.signal;
      started?.();
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    };
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const store = h.store(stalled);
      const installing = store.install(build.inventory, build.inventory.build_key);
      const refused = expect(installing).rejects.toThrow('deadline');
      await entered;
      await vi.advanceTimersByTimeAsync(RETAINED_BUILD_LIMITS.assetDeadlineMs);
      await refused;
      expect(signal?.aborted).toBe(true);
      expect(h.caches.buckets.size).toBe(0);
      // Even a fetcher that ignores abort and resolves late cannot populate the cache.
      finish?.(await build.fetcher(new Request(`${origin}/`)));
      await vi.advanceTimersByTimeAsync(0);
      expect(h.caches.buckets.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      await expect(store.navigationResponse()).rejects.toThrow('unavailable');
    } finally {
      vi.useRealTimers();
    }
    await h.store(build.fetcher).install(build.inventory, build.inventory.build_key);
  });

  it('cancels a stalled response stream without awaiting cancellation and retains uncertain cleanup debt', async () => {
    const h = harness();
    h.caches.rejectDeletion = true;
    const build = await fixture('stall-stream');
    let started: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    let cancelled = false;
    const stalled: typeof fetch = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('<'));
            started?.();
          },
          cancel() {
            cancelled = true;
            return new Promise<void>(() => {});
          },
        }),
        { headers: { 'Content-Type': 'text/html' } },
      );
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const store = h.store(stalled);
      const installing = store.install(build.inventory, build.inventory.build_key);
      const refused = expect(installing).rejects.toThrow('deadline');
      await entered;
      await vi.advanceTimersByTimeAsync(RETAINED_BUILD_LIMITS.assetDeadlineMs);
      await refused;
      expect(cancelled).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      expect(h.caches.buckets.size).toBe(1);
      await expect(store.navigationResponse()).rejects.toThrow('unavailable');
      await expect(
        h.store(build.fetcher).install(build.inventory, build.inventory.build_key),
      ).rejects.toThrow('reserved');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reconciles cache enumeration with concurrent reservations so active older builds remain readable', async () => {
    const h = harness();
    const first = await fixture('first');
    const second = await fixture('second');
    const old = h.store(first.fetcher);
    await old.install(first.inventory, first.inventory.build_key);
    let started: (() => void) | undefined;
    let release: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: typeof fetch = async (...args) => {
      started?.();
      await pending;
      return second.fetcher(...args);
    };
    let installing: Promise<void> | undefined;
    h.caches.beforeKeys = async () => {
      h.caches.beforeKeys = undefined;
      installing = h.store(slow).install(second.inventory, second.inventory.build_key);
      await entered;
    };
    try {
      expect(
        await (await old.lookupImmutable(new Request(`${origin}/_nuxt/first.js`)))?.text(),
      ).toContain('first');
      expect(h.caches.deleted).toEqual([]);
    } finally {
      release?.();
      await installing;
    }
  });

  it('ignores a concurrently rolled-back bucket captured by stale cache enumeration', async () => {
    const h = harness();
    const first = await fixture('first');
    const second = await fixture('rollback');
    const old = h.store(first.fetcher);
    await old.install(first.inventory, first.inventory.build_key);
    let started: (() => void) | undefined;
    let release: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const broken: typeof fetch = async () => {
      started?.();
      await pending;
      return new Response('wrong shell', { headers: { 'Content-Type': 'text/html' } });
    };
    let refused: Promise<void> | undefined;
    h.caches.beforeKeys = async () => {
      h.caches.beforeKeys = undefined;
      const installing = h.store(broken).install(second.inventory, second.inventory.build_key);
      refused = expect(installing).rejects.toThrow();
      await entered;
      h.caches.afterKeys = async () => {
        h.caches.afterKeys = undefined;
        // First enumeration captured G2's owned bucket, but reconciliation sees
        // the reservation and bucket removed by G2's legitimate owned rollback.
        release?.();
        await refused;
      };
    };
    try {
      expect(
        await (await old.lookupImmutable(new Request(`${origin}/_nuxt/first.js`)))?.text(),
      ).toContain('first');
      expect(h.caches.buckets.size).toBe(1);
      expect(h.caches.deleted).toHaveLength(1);
    } finally {
      release?.();
      await refused;
    }
    await h.store(second.fetcher).install(second.inventory, second.inventory.build_key);
  });

  it('refuses admission and lookup after metadata loss without deleting orphan retained caches', async () => {
    const h = harness();
    const first = await fixture('first');
    await h.store(first.fetcher).install(first.inventory, first.inventory.build_key);
    // Independent database factory models lost IDB data with surviving CacheStorage.
    const lost = harness(h.caches, new IDBFactory());
    const second = await fixture('second');
    let fetched = false;
    const fetcher: typeof fetch = async (...args) => {
      fetched = true;
      return second.fetcher(...args);
    };
    const store = lost.store(fetcher);
    await expect(store.install(second.inventory, second.inventory.build_key)).rejects.toMatchObject(
      { code: 'storage' },
    );
    await expect(store.lookupImmutable(new Request(`${origin}/_nuxt/first.js`))).rejects.toThrow(
      'unaccounted',
    );
    expect(fetched).toBe(false);
    expect(h.caches.deleted).toEqual([]);
    expect(h.caches.buckets.size).toBe(1);
  });

  it('ignores other cache namespaces without deleting their resources', async () => {
    const h = harness();
    await h.caches.open('another-app-cache');
    const build = await fixture('a');
    await h.store(build.fetcher).install(build.inventory, build.inventory.build_key);
    expect(h.caches.buckets.size).toBe(2);
    expect(h.caches.deleted).toEqual([]);
  });

  it('bounds persisted public security headers independently of asset bytes', async () => {
    const h = harness();
    const build = await fixture('a');
    const fetcher: typeof fetch = async (...args) => {
      const response = await build.fetcher(...args);
      response.headers.set('Content-Security-Policy', `default-src ${'x'.repeat(8192)}`);
      return response;
    };
    await expect(
      h.store(fetcher).install(build.inventory, build.inventory.build_key),
    ).rejects.toThrow('security headers');
    expect(h.caches.buckets.size).toBe(0);
    await h.store(build.fetcher).install(build.inventory, build.inventory.build_key);
  });

  it('keeps failed cleanup charged as pending debt and blocks unbounded orphan caches', async () => {
    const caches = new MemoryCaches();
    caches.rejectDeletion = true;
    const h = harness(caches);
    for (const key of ['a', 'b', 'c']) {
      const build = await fixture(key);
      const broken: typeof fetch = async (...args) => {
        const response = await build.fetcher(...args);
        const input = args[0];
        const url = input instanceof Request ? input.url : String(input);
        if (new URL(url).pathname.endsWith('.js')) {
          const text = await response.text();
          return new Response(text.replace('export', 'xxxxxx'), {
            headers: { 'Content-Type': 'application/javascript' },
          });
        }
        return response;
      };
      await expect(
        h.store(broken).install(build.inventory, build.inventory.build_key),
      ).rejects.toThrow('digest');
      await expect(
        h.store(build.fetcher).install(build.inventory, build.inventory.build_key),
      ).rejects.toThrow('reserved');
    }
    const fourth = await fixture('d');
    await expect(
      h.store(fourth.fetcher).install(fourth.inventory, fourth.inventory.build_key),
    ).rejects.toThrow('capacity');
    expect(h.caches.buckets.size).toBe(3);
    expect(h.caches.deleted).toHaveLength(3);
  });

  it('preserves public security headers but strips cookie and authentication headers', async () => {
    const h = harness();
    const build = await fixture('secure');
    const fetcher: typeof fetch = async (...args) => {
      const response = await build.fetcher(...args);
      response.headers.set('Content-Security-Policy', "default-src 'self'");
      response.headers.set('Referrer-Policy', 'no-referrer');
      response.headers.set('X-Content-Type-Options', 'nosniff');
      response.headers.set('Set-Cookie', 'session=private');
      response.headers.set('Authorization', 'Bearer private');
      return response;
    };
    const store = h.store(fetcher);
    await store.install(build.inventory, build.inventory.build_key);
    const shell = await store.navigationResponse();
    expect(shell.headers.get('Content-Security-Policy')).toBe("default-src 'self'");
    expect(shell.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(shell.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(shell.headers.has('Set-Cookie')).toBe(false);
    expect(shell.headers.has('Authorization')).toBe(false);
  });

  it('refuses valid JavaScript bytes returned with HTML MIME and rolls back only its own cache', async () => {
    const h = harness();
    const first = await fixture('first');
    await h.store(first.fetcher).install(first.inventory, first.inventory.build_key);
    const build = await fixture('wrong-mime');
    const fetcher: typeof fetch = async (...args) => {
      const response = await build.fetcher(...args);
      response.headers.set('Content-Type', 'text/html');
      return response;
    };
    await expect(
      h.store(fetcher).install(build.inventory, build.inventory.build_key),
    ).rejects.toThrow('MIME');
    expect(h.caches.buckets.size).toBe(1);
    expect(h.caches.deleted).toHaveLength(1);
  });

  it('refuses corrupt over-capacity metadata before reading retained caches', async () => {
    const h = harness();
    const build = await fixture('a');
    const store = h.store(build.fetcher);
    await store.install(build.inventory, build.inventory.build_key);
    const request = h.indexedDB.open(RETAINED_BUILD_DATABASE, 1);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const extras = await Promise.all(['b', 'c', 'd'].map((key) => fixture(key)));
    const transaction = database.transaction('builds', 'readwrite');
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    for (const extra of extras) {
      const owner = crypto.randomUUID();
      transaction.objectStore('builds').add({
        inventory: extra.inventory,
        status: 'pending',
        owner,
        cacheName: `${RETAINED_BUILD_CACHE_PREFIX}${extra.inventory.generation}-${owner}`,
        reservedBytes: extra.inventory.assets.reduce((sum, asset) => sum + asset.size, 0),
      });
    }
    await done;
    database.close();
    await expect(store.lookupImmutable(new Request(`${origin}/_nuxt/a.js`))).rejects.toThrow(
      'capacity',
    );
    expect(h.caches.deleted).toEqual([]);
  });

  it('verifies bytes and keeps G1 assets available after G2 admission and restart', async () => {
    const h = harness();
    const first = await fixture('g1');
    const second = await fixture('g2');
    await h.store(first.fetcher).install(first.inventory, first.inventory.build_key);
    await h.store(second.fetcher).install(second.inventory, second.inventory.build_key);
    const restarted = h.store(second.fetcher, second.inventory.build_key);
    expect(await (await restarted.navigationResponse()).text()).toContain('g2');
    expect(
      await (await restarted.lookupImmutable(new Request(`${origin}/_nuxt/g1.js`)))?.text(),
    ).toContain('g1');
    expect(
      await (await restarted.lookupCurrent(new Request(`${origin}/_nuxt/g2.js`)))?.text(),
    ).toContain('g2');
    expect(h.caches.deleted).toEqual([]);
  });

  it('refuses fourth generation without deleting any admitted cache', async () => {
    const h = harness();
    for (const key of ['a', 'b', 'c']) {
      const build = await fixture(key);
      await h.store(build.fetcher).install(build.inventory, build.inventory.build_key);
    }
    const fourth = await fixture('d');
    await expect(
      h.store(fourth.fetcher).install(fourth.inventory, fourth.inventory.build_key),
    ).rejects.toThrow('capacity');
    expect(h.caches.buckets.size).toBe(3);
    expect(h.caches.deleted).toEqual([]);
    const oldest = await h
      .store(fourth.fetcher)
      .lookupImmutable(new Request(`${origin}/_nuxt/a.js`));
    expect(await oldest?.text()).toContain("'a'");
  });

  it('rolls back only its own reservation/cache when fetched bytes mismatch', async () => {
    const h = harness();
    const first = await fixture('good');
    await h.store(first.fetcher).install(first.inventory, first.inventory.build_key);
    const second = await fixture('bad');
    const badFetch: typeof fetch = async () => new Response('wrong');
    await expect(
      h.store(badFetch).install(second.inventory, second.inventory.build_key),
    ).rejects.toThrow();
    expect(h.caches.buckets.size).toBe(1);
    expect(h.caches.deleted).toHaveLength(1);
    await h.store(second.fetcher).install(second.inventory, second.inventory.build_key);
    expect(h.caches.buckets.size).toBe(2);
  });

  it('rejects reused immutable URLs whose digest changes before fetching', async () => {
    const h = harness();
    const first = await fixture('a', { '/_nuxt/shared.js': 'one' });
    await h.store(first.fetcher).install(first.inventory, first.inventory.build_key);
    const second = await fixture('b', { '/_nuxt/shared.js': 'two' });
    let fetched = false;
    const fetcher: typeof fetch = async (...args) => {
      fetched = true;
      return second.fetcher(...args);
    };
    await expect(
      h.store(fetcher).install(second.inventory, second.inventory.build_key),
    ).rejects.toThrow('collision');
    expect(fetched).toBe(false);
    expect(h.caches.deleted).toEqual([]);
  });

  it('verifies an existing ready build instead of replacing its cache', async () => {
    const h = harness();
    const build = await fixture('a');
    await h.store(build.fetcher).install(build.inventory, build.inventory.build_key);
    await h.store(build.fetcher).install(build.inventory, build.inventory.build_key);
    expect(h.caches.buckets.size).toBe(1);
    const bucket = [...h.caches.buckets.values()][0];
    bucket?.set(`${origin}/_nuxt/a.js`, new Response('corrupted'));
    await expect(
      h.store(build.fetcher).install(build.inventory, build.inventory.build_key),
    ).rejects.toThrow();
    expect(h.caches.deleted).toEqual([]);
  });

  it('reports eviction and corruption without network fallback', async () => {
    const h = harness();
    const build = await fixture('a');
    const store = h.store(build.fetcher);
    await store.install(build.inventory, build.inventory.build_key);
    const bucket = [...h.caches.buckets.values()][0];
    bucket?.set(`${origin}/_nuxt/a.js`, new Response('corrupted'));
    await expect(store.lookupImmutable(new Request(`${origin}/_nuxt/a.js`))).rejects.toThrow();
    h.caches.buckets.clear();
    await expect(store.navigationResponse()).rejects.toThrow('evicted');
  });

  it.each([
    '/api/state.js',
    '/%61pi/state.js',
    '/_nuxt/a.js?token=secret',
    '//api/state.js',
    '/a/../x.js',
    '/favicon.svg#state',
    '/sw.js',
    '/sw.mjs',
  ])('rejects unsafe inventory path %s', async (url) => {
    expect(isOfflineAssetPath(url)).toBe(false);
    const h = harness();
    const build = await fixture('a');
    const bad = {
      ...build.inventory,
      assets: [
        ...build.inventory.assets,
        { url, size: 1, immutable: true, sha256: '0'.repeat(64) },
      ],
    };
    await expect(h.store(build.fetcher).install(bad, bad.build_key)).rejects.toThrow();
    expect(h.caches.buckets.size).toBe(0);
  });

  it('never serves query, cross-origin, API, POST or nonimmutable old assets', async () => {
    const h = harness();
    const build = await fixture('a', { '/favicon.svg': '<svg/>' });
    const store = h.store(build.fetcher);
    await store.install(build.inventory, build.inventory.build_key);
    for (const request of [
      new Request(`${origin}/_nuxt/a.js?x=1`),
      new Request('https://elsewhere.example/_nuxt/a.js'),
      new Request(`${origin}/api/state.js`),
      new Request(`${origin}/%5Fnuxt/a.js`),
      new Request(`${origin}/favicon.svg`),
      new Request(`${origin}/_nuxt/a.js`, { method: 'POST' }),
    ])
      expect(await store.lookupImmutable(request)).toBeUndefined();
  });

  it('checks generation, build identity, bounds and strict schema before reservation', async () => {
    const h = harness();
    const build = await fixture('a');
    const store = h.store(build.fetcher);
    await expect(store.install(build.inventory, '0'.repeat(64))).rejects.toThrow('identity');
    await expect(
      store.install({ ...build.inventory, generation: '0'.repeat(64) }, build.inventory.build_key),
    ).rejects.toThrow('identity');
    await expect(
      store.install({ ...build.inventory, token: 'secret' }, build.inventory.build_key),
    ).rejects.toThrow('inventory');
    await expect(
      store.install(
        {
          ...build.inventory,
          assets: build.inventory.assets.map((asset) => ({ ...asset, size: 8 * 1024 * 1024 + 1 })),
        },
        build.inventory.build_key,
      ),
    ).rejects.toThrow('inventory');
    expect(h.caches.buckets.size).toBe(0);
  });

  it('serializes concurrent admissions with transaction-model IndexedDB and protects pending ownership', async () => {
    const h = harness();
    const build = await fixture('a');
    let release: (() => void) | undefined;
    let started: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const slowFetch: typeof fetch = async (...args) => {
      started?.();
      await pending;
      return build.fetcher(...args);
    };
    const installing = h.store(slowFetch).install(build.inventory, build.inventory.build_key);
    await entered;
    await expect(
      h.store(build.fetcher).install(build.inventory, build.inventory.build_key),
    ).rejects.toThrow('reserved');
    expect(h.caches.deleted).toEqual([]);
    release?.();
    await installing;
    expect(h.caches.buckets.size).toBe(1);
    expect([...h.caches.buckets.keys()][0]).toMatch(new RegExp(`^${RETAINED_BUILD_CACHE_PREFIX}`));
  });

  it('counts in-flight reservations against capacity and never cleans another installer', async () => {
    const h = harness();
    const installs: Promise<void>[] = [];
    const releases: (() => void)[] = [];
    for (const key of ['a', 'b', 'c']) {
      const build = await fixture(key);
      let release: (() => void) | undefined;
      let started: (() => void) | undefined;
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      const slow: typeof fetch = async (...args) => {
        started?.();
        await wait;
        return build.fetcher(...args);
      };
      installs.push(h.store(slow).install(build.inventory, build.inventory.build_key));
      await entered;
      if (release) releases.push(release);
    }
    const fourth = await fixture('d');
    await expect(
      h.store(fourth.fetcher).install(fourth.inventory, fourth.inventory.build_key),
    ).rejects.toThrow('capacity');
    expect(h.caches.deleted).toEqual([]);
    releases.forEach((release) => release());
    await Promise.all(installs);
    expect(h.caches.buckets.size).toBe(3);
  });
});
