import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import vm from 'node:vm';
import { IDBFactory } from 'fake-indexeddb';

const source = await readFile(new URL('../../.output/public/sw.js', import.meta.url), 'utf8');
const packaged = new URL('../../../src/wavedl_daemon/web_assets/', import.meta.url);
const metadataBytes = await readFile(new URL('offline-build.json', packaged));
const metadata = JSON.parse(metadataBytes);
const shellBytes = await readFile(new URL('index.html', packaged));
const entries = [...source.matchAll(/\[\s*\{\s*"(?:url|revision)"[^\]]*\]/g)]
  .map((match) => {
    try {
      return JSON.parse(match[0]);
    } catch {
      return undefined;
    }
  })
  .filter(
    (value) =>
      Array.isArray(value) &&
      value.length &&
      value.every((entry) => Object.keys(entry).sort().join(',') === 'revision,url'),
  );

test('packaged metadata identifies the actual compiled worker and shell', () => {
  assert.equal(entries.length, 1, 'One inspectable injected precache array');
  const tuples = entries[0]
    .map(({ url, revision }) => [url, revision])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  assert.equal(
    metadata.build_key,
    createHash('sha256').update(JSON.stringify(tuples)).digest('hex'),
  );
  const root = metadata.assets.find((asset) => asset.url === '/');
  assert.equal(root.sha256, createHash('sha256').update(shellBytes).digest('hex'));
  assert.equal(root.size, shellBytes.length);
  assert.ok(metadata.assets.every((asset) => !/^\/api(?:\/|$)/i.test(asset.url)));
});

test('every actual precache URL is served by the Python route without navigation fallback', async () => {
  const paths = entries[0].map((entry) => entry.url);
  assert.ok(paths.length > 0, 'Generated precache manifest must be inspectable');
  assert.ok(!paths.includes('404') && !paths.includes('200'));
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const exercise = `
import asyncio, json, sys
from pathlib import Path
import httpx
from starlette.applications import Starlette
from wavedl_daemon.http.static import static_routes

async def exercise():
    app = Starlette(routes=static_routes(Path('web/.output/public')))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='https://wavedl.test') as client:
        for path in json.loads(sys.argv[1]):
            # Workbox precache fetches are not HTML navigations.
            response = await client.get('/' + path.lstrip('/'), headers={'Accept': '*/*'})
            assert response.status_code == 200, (path, response.status_code)
            assert response.content, path
asyncio.run(exercise())
`;
  await promisify(execFile)(
    process.env.WAVEDL_PYTHON ?? 'python3',
    ['-c', exercise, JSON.stringify(paths)],
    {
      cwd: root,
      env: { ...process.env, PYTHONPATH: `${root}/src` },
    },
  );
});

function worker({ inventory = metadataBytes, assetOverride, metadataStall } = {}) {
  const listeners = new Map();
  const cached = new Map();
  let activations = 0;
  let claims = 0;
  let offline = false;
  const messages = [];
  const network = [];
  let releaseMetadata;
  const origin = 'https://wavedl.test';
  const client = {
    type: 'window',
    url: `${origin}/experiments`,
    postMessage: (message) => messages.push(message),
  };
  const self = {
    location: new URL(`${origin}/sw.js`),
    registration: { scope: `${origin}/` },
    clients: {
      matchAll: async () => [
        client,
        { url: 'https://other.test/', postMessage: () => assert.fail('foreign client') },
      ],
      claim: async () => {
        claims += 1;
      },
    },
    addEventListener: (name, fn) => {
      const handlers = listeners.get(name) ?? [];
      handlers.push(fn);
      listeners.set(name, handlers);
    },
    skipWaiting: async () => {
      activations += 1;
    },
  };
  const caches = {
    has: async (name) => cached.has(name),
    open: async (name) => {
      if (!cached.has(name)) cached.set(name, new Map());
      return {
        match: async (request) =>
          cached
            .get(name)
            .get(typeof request === 'string' ? request : request.url)
            ?.clone(),
        put: async (request, response) =>
          cached
            .get(name)
            .set(typeof request === 'string' ? request : request.url, response.clone()),
        keys: async () => [...cached.get(name).keys()].map((url) => new Request(url)),
        delete: async (request) =>
          cached.get(name).delete(typeof request === 'string' ? request : request.url),
      };
    },
    keys: async () => [...cached.keys()],
    delete: async (name) => cached.delete(name),
  };
  self.caches = caches;
  class BrowserRequest extends Request {
    constructor(input, init) {
      super(typeof input === 'string' ? new URL(input, origin) : input, init);
    }
  }
  const context = vm.createContext({
    self,
    caches,
    location: self.location,
    URL,
    Request: BrowserRequest,
    Response,
    Headers,
    TextEncoder,
    TextDecoder,
    AbortController,
    crypto: webcrypto,
    indexedDB: new IDBFactory(),
    FetchEvent: class {},
    console,
    setTimeout: (callback, delay, ...args) =>
      setTimeout(callback, metadataStall && delay === 30_000 ? 0 : delay, ...args),
    clearTimeout,
    fetch: async (input) => {
      const request = input instanceof Request ? input : new BrowserRequest(input);
      network.push(request);
      if (offline) throw new TypeError('offline');
      const path = new URL(request.url).pathname;
      if (path === '/offline-build.json' && metadataStall === 'fetch') {
        return new Promise(() => {});
      }
      if (path === '/offline-build.json' && metadataStall === 'query') {
        return new Promise((resolve) => {
          releaseMetadata = () => resolve(new Response(inventory));
        });
      }
      if (path === '/offline-build.json' && metadataStall === 'body') {
        return new Response(new ReadableStream({ start() {} }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      const bytes =
        path === '/offline-build.json'
          ? inventory
          : (assetOverride?.(path) ??
            (await readFile(new URL(path === '/' ? 'index.html' : path.slice(1), packaged))));
      return new Response(bytes, {
        headers: {
          'content-type':
            path === '/'
              ? 'text/html'
              : ({
                  js: 'application/javascript',
                  css: 'text/css',
                  svg: 'image/svg+xml',
                  woff2: 'font/woff2',
                  woff: 'font/woff',
                  ico: 'image/x-icon',
                  png: 'image/png',
                  json: 'application/json',
                  webmanifest: 'application/manifest+json',
                }[path.slice(path.lastIndexOf('.') + 1)] ?? 'application/octet-stream'),
          ...(path === '/'
            ? {
                'content-security-policy': "default-src 'self'",
                'referrer-policy': 'no-referrer',
                'x-content-type-options': 'nosniff',
              }
            : {}),
        },
      });
    },
  });
  vm.runInContext(source, context);
  function request(path, mode = 'navigate', method = 'GET') {
    const request = new Request(new URL(path, origin), { method });
    Object.defineProperty(request, 'mode', { value: mode });
    let response;
    const event = {
      request,
      waitUntil: () => {},
      respondWith: (value) => {
        response = value;
      },
    };
    for (const listener of listeners.get('fetch') ?? []) listener(event);
    return response;
  }
  async function dispatch(name, details = {}) {
    const pending = [];
    for (const listener of listeners.get(name) ?? [])
      listener({
        ...details,
        waitUntil: (promise) => pending.push(promise),
      });
    await Promise.all(pending);
  }
  function fire(name, details = {}) {
    const pending = [];
    for (const listener of listeners.get(name) ?? [])
      listener({
        ...details,
        waitUntil: (promise) => pending.push(promise),
      });
    return pending;
  }
  return {
    request,
    dispatch,
    fire,
    client,
    messages,
    network,
    cached,
    indexedDB: context.indexedDB,
    install: () => dispatch('install'),
    offline: () => {
      offline = true;
    },
    activations: () => activations,
    claims: () => claims,
    releaseMetadata: () => releaseMetadata?.(),
  };
}

for (const path of [
  '/api',
  '/api?probe=1',
  '/api/health',
  '/api/runs/run/events?after=4',
  '/api/runs/run/cancel',
  '/%61pi/health',
  '/api%2fhealth',
  '/API/health',
  '//wavedl.test/api/health',
]) {
  test(`generated worker does not intercept API navigation ${path}`, () => {
    assert.equal(worker().request(path), undefined);
  });
}
test('generated worker does not intercept API reads or mutations', () => {
  const sw = worker();
  sw.offline();
  assert.equal(sw.request('/api/health', 'cors'), undefined);
  assert.equal(sw.request('/api/runs/run/cancel', 'cors', 'POST'), undefined);
  assert.equal(sw.request('/api/health'), undefined);
  assert.equal(sw.request('/api/runs/run/events?after=4'), undefined);
});
test('cold offline deep-link navigation receives the verified packaged shell', async () => {
  const sw = worker();
  await sw.install();
  sw.offline();
  for (const path of [
    '/experiments?bootstrap_token=secret',
    '/runs/11111111-1111-4111-8111-111111111111',
    '/settings/storage#offline',
  ]) {
    const response = await sw.request(path);
    assert.ok(response instanceof Response, path);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), shellBytes, path);
    assert.match(response.headers.get('content-type'), /^text\/html/, path);
    assert.equal(response.headers.get('content-security-policy'), "default-src 'self'", path);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer', path);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff', path);
  }
  assert.ok(sw.network.every((request) => !request.url.includes('bootstrap_token')));
});
test('waiting worker activates only on explicit SKIP_WAITING message', async () => {
  const sw = worker();
  assert.equal(sw.activations(), 0);
  await sw.install();
  await sw.dispatch('message', { data: { type: 'OTHER' }, source: sw.client });
  assert.equal(sw.activations(), 0);
  await sw.dispatch('message', {
    data: { type: 'SKIP_WAITING' },
    source: { type: 'window', url: 'https://other.test/' },
  });
  assert.equal(sw.activations(), 0);
  await sw.dispatch('message', { data: { type: 'SKIP_WAITING' }, source: sw.client });
  assert.equal(sw.activations(), 1);
});

test('compiled worker coalesces same-origin refusal queries and never mutates retained storage', async () => {
  const sw = worker({ metadataStall: 'query' });
  const pending = [];
  const source = sw.client;
  const event = {
    source,
    data: { type: 'WAVEDL_QUERY_UPDATE_REFUSAL' },
    waitUntil: (promise) => pending.push(promise),
  };
  pending.push(...sw.fire('message', event));
  pending.push(...sw.fire('message', event));
  assert.equal(sw.network.length, 1);
  assert.equal(sw.activations(), 0);
  assert.equal(sw.cached.size, 0);
  sw.releaseMetadata();
  await Promise.all(pending);
  assert.deepEqual(sw.messages, []);
});

test('compiled worker ignores forged query senders and leaves unavailable inventory unknown', async () => {
  const sw = worker({ metadataStall: 'fetch' });
  const pending = [];
  const dispatch = (source, data) =>
    sw.fire('message', {
      source,
      data,
      waitUntil: (promise) => pending.push(promise),
    });
  await dispatch(null, { type: 'WAVEDL_QUERY_UPDATE_REFUSAL' });
  await dispatch({ type: 'worker', url: sw.client.url }, { type: 'WAVEDL_QUERY_UPDATE_REFUSAL' });
  await dispatch(
    { type: 'window', url: 'https://other.test/' },
    { type: 'WAVEDL_QUERY_UPDATE_REFUSAL' },
  );
  await dispatch(sw.client, { type: 'WAVEDL_QUERY_UPDATE_REFUSAL', extra: true });
  assert.equal(sw.network.length, 0);
  await dispatch(sw.client, { type: 'WAVEDL_QUERY_UPDATE_REFUSAL' });
  await Promise.all(pending);
  assert.deepEqual(sw.messages, []);
});

test('compiled worker reports verification for malformed query inventory without activation or cache mutation', async () => {
  const sw = worker({ inventory: Buffer.from('{"invalid":true}') });
  const pending = [];
  await sw.dispatch('message', {
    source: sw.client,
    data: { type: 'WAVEDL_QUERY_UPDATE_REFUSAL' },
    waitUntil: (promise) => pending.push(promise),
  });
  await Promise.all(pending);
  assert.deepEqual(JSON.parse(JSON.stringify(sw.messages)), [
    { type: 'WAVEDL_UPDATE_REFUSAL_RESULT', reason: 'verification' },
  ]);
  assert.equal(sw.activations(), 0);
  assert.equal(sw.cached.size, 0);
});

test('activated worker claims the client so explicit updates can reload', async () => {
  const sw = worker();
  assert.equal(sw.claims(), 0);
  await sw.install();
  await sw.dispatch('activate');
  assert.equal(sw.claims(), 1);
});

test('install uses public credential-free requests and caches real immutable lazy assets', async () => {
  const sw = worker();
  await sw.install();
  assert.ok(sw.network.length > 1);
  for (const request of sw.network) {
    assert.equal(request.credentials, 'omit');
    assert.equal(request.cache, 'no-store');
    assert.equal(request.redirect, 'error');
    assert.equal(request.headers.has('authorization'), false);
  }
  sw.offline();
  const asset = metadata.assets.find((entry) => entry.immutable && entry.url.endsWith('.js'));
  assert.ok(asset, 'Actual build includes hashed JavaScript');
  const response = await sw.request(asset.url, 'cors');
  assert.equal(
    createHash('sha256')
      .update(Buffer.from(await response.arrayBuffer()))
      .digest('hex'),
    asset.sha256,
  );
  assert.match(response.headers.get('content-type'), /javascript/);
});

test('worker never intercepts foreign origins, static queries or mutations', () => {
  const sw = worker();
  assert.equal(sw.request('https://other.test/experiments'), undefined);
  assert.equal(sw.request('/_nuxt/unknown.js?token=secret', 'cors'), undefined);
  assert.equal(sw.request('/experiments', 'cors', 'POST'), undefined);
});

for (const prefix of ['auth', 'v1', 'v2', 'events', 'state', 'token', 'tokens']) {
  test(`generated worker keeps ${prefix} state and authentication navigation network-only`, () => {
    const sw = worker();
    for (const path of [
      `/${prefix}`,
      `/${prefix}?probe=1`,
      `/${prefix}/state`,
      `/${prefix.toUpperCase()}/state`,
      `/%${prefix.charCodeAt(0).toString(16)}${prefix.slice(1)}/state`,
      `/${prefix}%2fstate`,
    ]) {
      assert.equal(sw.request(path), undefined);
    }
  });
}

test('tampered metadata refuses installation without activating and emits only a safe reason', async () => {
  const sw = worker({ inventory: JSON.stringify({ ...metadata, build_key: '0'.repeat(64) }) });
  await assert.rejects(sw.install());
  assert.equal(sw.activations(), 0);
  assert.equal(sw.claims(), 0);
  assert.deepEqual(JSON.parse(JSON.stringify(sw.messages)), [
    { type: 'WAVEDL_UPDATE_REFUSED', reason: 'verification' },
  ]);
  await assert.rejects(sw.dispatch('activate'));
  await assert.rejects(
    sw.dispatch('message', { data: { type: 'SKIP_WAITING' }, source: sw.client }),
  );
  assert.equal(sw.activations(), 0);
});

test('oversized metadata and wrong asset bytes fail closed', async () => {
  const oversized = worker({ inventory: ' '.repeat(128 * 1024 + 1) });
  await assert.rejects(oversized.install());
  const corrupt = worker({ assetOverride: (path) => (path === '/' ? 'corrupt shell' : undefined) });
  await assert.rejects(corrupt.install());
  assert.equal(corrupt.claims(), 0);
});

for (const stage of ['fetch', 'body']) {
  test(`stalled metadata ${stage} hits a finite deadline, aborts and refuses update`, async () => {
    // Only the browser timer is accelerated; the actual compiled worker owns
    // the deadline and abort logic, including a body that never yields a chunk.
    const sw = worker({ metadataStall: stage });
    await assert.rejects(sw.install(), /deadline|abort/i);
    assert.equal(sw.network[0].signal.aborted, true);
    assert.equal(sw.activations(), 0);
    assert.equal(sw.claims(), 0);
    assert.deepEqual(JSON.parse(JSON.stringify(sw.messages)), [
      { type: 'WAVEDL_UPDATE_REFUSED', reason: 'verification' },
    ]);
  });
}

test('evicted or corrupted root cache prevents claim, approval and shell delivery', async () => {
  const sw = worker();
  await sw.install();
  for (const cache of sw.cached.values())
    cache.set('https://wavedl.test/', new Response('corrupt root'));
  sw.offline();
  await assert.rejects(sw.dispatch('activate'));
  await assert.rejects(
    sw.dispatch('message', { data: { type: 'SKIP_WAITING' }, source: sw.client }),
  );
  await assert.rejects(sw.request('/experiments'));
  assert.equal(sw.activations(), 0);
  assert.equal(sw.claims(), 0);
  sw.cached.clear();
  await assert.rejects(sw.request('/experiments'));
});

test('corrupt known immutable cache entries never escape through network fallback', async () => {
  const sw = worker();
  await sw.install();
  const asset = metadata.assets.find((entry) => entry.immutable && entry.url.endsWith('.js'));
  const before = sw.network.length;
  for (const cache of sw.cached.values())
    cache.set(`https://wavedl.test${asset.url}`, new Response('wrong JavaScript'));
  await assert.rejects(sw.request(asset.url, 'cors'));
  assert.equal(sw.network.length, before);
});

test('lost retained metadata and caches never resurrect static resources from the network', async () => {
  const sw = worker();
  await sw.install();
  const request = sw.indexedDB.open('wavedl-retained-builds-v1', 1);
  const database = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const transaction = database.transaction('builds', 'readwrite');
  const finished = new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
  transaction.objectStore('builds').clear();
  await finished;
  database.close();
  sw.cached.clear();
  const before = sw.network.length;
  const asset = metadata.assets.find((entry) => entry.immutable && entry.url.endsWith('.js'));
  await assert.rejects(sw.request(asset.url, 'cors'), /Offline compatibility lost/);
  await assert.rejects(sw.request('/experiments'), /Offline compatibility lost/);
  assert.equal(
    sw.network.length,
    before,
    'Even an online server cannot repair lost authority implicitly',
  );
  assert.equal(sw.cached.size, 0, 'Refused reads must not recreate buckets');
});

test('uninventoried static paths are refused rather than served from an unverified fallback', async () => {
  const sw = worker();
  await sw.install();
  const before = sw.network.length;
  await assert.rejects(sw.request('/_nuxt/unadmitted.js', 'cors'), /Offline compatibility lost/);
  assert.equal(sw.network.length, before);
});

test('admitted public static assets use verified cache bytes outside the chunk directory', async () => {
  const content = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>');
  const inventory = structuredClone(metadata);
  inventory.assets.push({
    url: '/images/workstation.svg',
    sha256: createHash('sha256').update(content).digest('hex'),
    size: content.length,
    immutable: false,
  });
  inventory.generation = createHash('sha256')
    .update(
      JSON.stringify(
        inventory.assets
          .sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))
          .map(({ url, sha256, size, immutable }) => [url, sha256, size, immutable]),
      ),
    )
    .digest('hex');
  const sw = worker({
    inventory: Buffer.from(JSON.stringify(inventory)),
    assetOverride: (path) => (path === '/images/workstation.svg' ? content : undefined),
  });
  await sw.install();
  sw.offline();
  const before = sw.network.length;
  const response = await sw.request('/images/workstation.svg', 'cors');
  assert.equal(await response.text(), content.toString());
  assert.equal(sw.network.length, before);
  await assert.rejects(sw.request('/images/unadmitted.svg', 'cors'), /Offline compatibility lost/);
  assert.equal(sw.request('/sw.js', 'cors'), undefined, 'Worker update scripts stay network-only');
  assert.equal(sw.request('/sw.mjs', 'cors'), undefined);
});
