import { z } from 'zod';

export const RETAINED_BUILD_LIMITS = {
  generations: 3,
  totalBytes: 64 * 1024 * 1024,
  buildBytes: 16 * 1024 * 1024,
  assetBytes: 8 * 1024 * 1024,
  assets: 128,
  inventoryBytes: 128 * 1024,
  securityHeaderBytes: 8 * 1024,
  assetDeadlineMs: 30_000,
} as const;
export const RETAINED_BUILD_DATABASE = 'wavedl-retained-builds-v1';
export const RETAINED_BUILD_CACHE_PREFIX = 'wavedl-retained-v1-';

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const assetSchema = z.strictObject({
  url: z.string().max(2048),
  sha256: digestSchema,
  size: z.number().int().positive().max(RETAINED_BUILD_LIMITS.assetBytes),
  immutable: z.boolean(),
});
const inventorySchema = z.strictObject({
  schema_version: z.literal(1),
  build_key: digestSchema,
  generation: digestSchema,
  assets: z.array(assetSchema).min(1).max(RETAINED_BUILD_LIMITS.assets),
});
export type OfflineBuildInventory = z.infer<typeof inventorySchema>;
type Asset = z.infer<typeof assetSchema>;
const recordSchema = z.strictObject({
  inventory: inventorySchema,
  status: z.enum(['pending', 'ready']),
  owner: z.string().uuid(),
  cacheName: z.string(),
  reservedBytes: z.number().int().positive().max(RETAINED_BUILD_LIMITS.buildBytes),
});
type BuildRecord = z.infer<typeof recordSchema>;
export interface RetainedCacheStorage {
  keys(): Promise<string[]>;
  has(name: string): Promise<boolean>;
  open(name: string): Promise<{
    match(request: string): Promise<Response | undefined>;
    put(request: string, response: Response): Promise<void>;
  }>;
  delete(name: string): Promise<boolean>;
}

export class RetainedBuildError extends Error {
  readonly code: 'capacity' | 'verification' | 'storage';
  constructor(
    message: string,
    readonly reason: 'capacity' | 'verification' | 'storage' = 'verification',
  ) {
    super(message);
    this.name = 'RetainedBuildError';
    this.code = reason;
  }
}

function assetContentType(url: string): string {
  if (url === '/') return 'text/html; charset=utf-8';
  const extension = url.slice(url.lastIndexOf('.') + 1).toLowerCase();
  const types: Record<string, string> = {
    js: 'application/javascript; charset=utf-8',
    mjs: 'application/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
    json: 'application/json',
    webmanifest: 'application/manifest+json',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    avif: 'image/avif',
    gif: 'image/gif',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
  };
  return types[extension] ?? 'application/octet-stream';
}

/** Restrict inventories to canonical public static paths, never API/state URLs. */
export function isOfflineAssetPath(path: string): boolean {
  if (path === '/') return true;
  // Service-worker update scripts are fetched by the registration algorithm,
  // not retained as application assets. Keep explicit script reads network-only.
  if (path === '/sw.js' || path === '/sw.mjs') return false;
  if (!/^\/[A-Za-z0-9_./@+-]+$/.test(path) || path.includes('//')) return false;
  if (path.split('/').some((segment) => segment === '.' || segment === '..')) return false;
  if (/^\/(?:api|v1|v2|auth|events|state|tokens?|server|node_modules)(?:\/|$)/i.test(path))
    return false;
  if (path === '/manifest.webmanifest' || (path.startsWith('/_nuxt/') && path.endsWith('.json')))
    return true;
  return /\.(?:js|mjs|css|svg|png|jpg|jpeg|webp|avif|gif|ico|woff2?|ttf|otf)$/i.test(path);
}

export async function sha256Bytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function inventoryGeneration(assets: readonly Asset[]): Promise<string> {
  const tuples = [...assets]
    .sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))
    .map((asset) => [asset.url, asset.sha256, asset.size, asset.immutable]);
  return sha256Bytes(new TextEncoder().encode(JSON.stringify(tuples)));
}

function parseInventory(value: unknown): OfflineBuildInventory {
  const parsed = inventorySchema.safeParse(value);
  if (!parsed.success) throw new RetainedBuildError('Invalid offline build inventory');
  const inventory = parsed.data;
  if (
    new TextEncoder().encode(JSON.stringify(inventory)).byteLength >
    RETAINED_BUILD_LIMITS.inventoryBytes
  ) {
    throw new RetainedBuildError('Oversized offline build inventory');
  }
  const urls = new Set<string>();
  for (const asset of inventory.assets) {
    if (!isOfflineAssetPath(asset.url) || urls.has(asset.url)) {
      throw new RetainedBuildError('Unsafe or duplicate offline asset URL');
    }
    urls.add(asset.url);
    if (asset.url === '/' && asset.immutable) {
      throw new RetainedBuildError('Navigation shell must not be immutable');
    }
  }
  if (!urls.has('/') || bytesReserved(inventory) > RETAINED_BUILD_LIMITS.buildBytes) {
    throw new RetainedBuildError('Missing shell or oversized offline build');
  }
  return inventory;
}

function bytesReserved(inventory: OfflineBuildInventory): number {
  return inventory.assets.reduce((total, asset) => total + asset.size, 0);
}

function parseRecords(values: unknown[]): BuildRecord[] {
  if (values.length > RETAINED_BUILD_LIMITS.generations)
    throw new RetainedBuildError('Retained build metadata exceeds capacity', 'storage');
  const records = values.map((value) => {
    const parsed = recordSchema.safeParse(value);
    if (!parsed.success) throw new RetainedBuildError('Retained build metadata is corrupt');
    const record = parsed.data;
    parseInventory(record.inventory);
    if (
      record.reservedBytes !== bytesReserved(record.inventory) ||
      record.cacheName !==
        `${RETAINED_BUILD_CACHE_PREFIX}${record.inventory.generation}-${record.owner}`
    )
      throw new RetainedBuildError('Retained build metadata is corrupt');
    return record;
  });
  if (
    records.reduce((sum, record) => sum + record.reservedBytes, 0) >
    RETAINED_BUILD_LIMITS.totalBytes
  ) {
    throw new RetainedBuildError('Retained build metadata exceeds byte capacity', 'storage');
  }
  return records;
}

function resultOf<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new RetainedBuildError('IndexedDB request failed'));
  });
}

function completion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new RetainedBuildError('IndexedDB transaction aborted'));
    transaction.onerror = () =>
      reject(transaction.error ?? new RetainedBuildError('IndexedDB transaction failed'));
  });
}

/** One total deadline, not an inactivity timer renewed by trickled response bytes. */
async function withAssetDeadline<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new RetainedBuildError('Offline asset verification deadline exceeded');
      // Reject independently of fetch/cancellation: injected or stalled sources
      // may ignore AbortSignal, and a tee cancellation may never settle.
      reject(error);
      controller.abort(error);
    }, RETAINED_BUILD_LIMITS.assetDeadlineMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      expired,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function verifiedResponse(
  response: Response,
  asset: Asset,
  signal: AbortSignal,
): Promise<Response> {
  if (signal.aborted) {
    void response.body?.cancel().catch(() => undefined);
    throw signal.reason;
  }
  if (!response.ok || response.type === 'opaque' || !response.body) {
    throw new RetainedBuildError(`Unavailable offline asset: ${asset.url}`);
  }
  const mediaType = response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
  const expected =
    asset.url === '/'
      ? ['text/html']
      : /\.(?:m?js)$/i.test(asset.url)
        ? ['application/javascript', 'text/javascript', 'application/ecmascript', 'text/ecmascript']
        : /\.css$/i.test(asset.url)
          ? ['text/css']
          : undefined;
  if (expected && (!mediaType || !expected.includes(mediaType))) {
    // A tee'd cached response may keep cancellation pending until the other
    // branch is consumed. Initiate cancellation without blocking refusal.
    void response.body.cancel().catch(() => undefined);
    throw new RetainedBuildError(`Offline asset MIME mismatch: ${asset.url}`);
  }
  // Bound the extra persisted policy data independently of verified body bytes.
  const headers = new Headers({ 'Content-Type': assetContentType(asset.url) });
  for (const name of ['Content-Security-Policy', 'Referrer-Policy', 'X-Content-Type-Options']) {
    const value = response.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  let headerBytes = 0;
  headers.forEach((value, name) => {
    headerBytes += new TextEncoder().encode(`${name}: ${value}\r\n`).byteLength;
  });
  if (headerBytes > RETAINED_BUILD_LIMITS.securityHeaderBytes) {
    void response.body.cancel().catch(() => undefined);
    throw new RetainedBuildError(`Oversized offline asset security headers: ${asset.url}`);
  }
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (signal.aborted) throw signal.reason;
      if (part.done) break;
      length += part.value.byteLength;
      if (length > asset.size || length > RETAINED_BUILD_LIMITS.assetBytes) {
        throw new RetainedBuildError(`Oversized offline asset: ${asset.url}`);
      }
      chunks.push(part.value);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (length !== asset.size || (await sha256Bytes(bytes)) !== asset.sha256) {
    throw new RetainedBuildError(`Offline asset digest mismatch: ${asset.url}`);
  }
  if (signal.aborted) throw signal.reason;
  // Preserve public security policy without persisting cookies or authentication headers.
  return new Response(bytes, {
    status: 200,
    headers,
  });
}

/**
 * Admitted builds are never collected. Pending reservations count against limits,
 * including interrupted installs; storage eviction is reported as compatibility loss.
 */
export class RetainedBuildStore {
  private database: Promise<IDBDatabase>;
  private readonly caches: RetainedCacheStorage;
  private readonly origin: string;
  private readonly fetcher: typeof fetch;
  private currentBuildKey?: string;

  constructor(options: {
    indexedDB: IDBFactory;
    caches: RetainedCacheStorage;
    origin: string;
    fetcher?: typeof fetch;
    currentBuildKey?: string;
  }) {
    this.caches = options.caches;
    this.origin = new URL(options.origin).origin;
    this.fetcher = options.fetcher ?? fetch;
    this.currentBuildKey = options.currentBuildKey;
    this.database = new Promise((resolve, reject) => {
      const request = options.indexedDB.open(RETAINED_BUILD_DATABASE, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('builds', { keyPath: 'inventory.build_key' });
      request.onsuccess = () => {
        const database = request.result;
        // Browser eviction or explicit origin-storage removal must be able to
        // close the old connection. Do not reopen it implicitly: a controlled
        // worker whose authority was deleted must fail its subsequent reads.
        database.onversionchange = () => database.close();
        resolve(database);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new RetainedBuildError('Retained build database is blocked'));
    });
  }

  private async metadataRecords(): Promise<BuildRecord[]> {
    const database = await this.database;
    const transaction = database.transaction('builds', 'readonly');
    const done = completion(transaction);
    const values: unknown[] = await resultOf(
      transaction.objectStore('builds').getAll(null, RETAINED_BUILD_LIMITS.generations + 1),
    );
    await done;
    const records = parseRecords(values);
    for (const record of records) {
      if ((await inventoryGeneration(record.inventory.assets)) !== record.inventory.generation) {
        throw new RetainedBuildError('Retained build generation is corrupt');
      }
    }
    return records;
  }

  private async records(): Promise<BuildRecord[]> {
    let records = await this.metadataRecords();
    const names = (await this.caches.keys()).filter((name) =>
      name.startsWith(RETAINED_BUILD_CACHE_PREFIX),
    );
    const known = new Set(records.map((record) => record.cacheName));
    if (names.some((name) => !known.has(name))) {
      // Another installer may have reserved and opened a bucket while the first
      // snapshot's digests were verified. Reconcile the enumerated names with a
      // fresh bounded snapshot; reservations always precede bucket creation.
      records = await this.metadataRecords();
      const fresh = new Set(records.map((record) => record.cacheName));
      const unknown = names.filter((name) => !fresh.has(name));
      // A failing installer may also have completed owned rollback between
      // enumeration and reconciliation. Only surviving unknown buckets are debt.
      const surviving = unknown.length ? new Set(await this.caches.keys()) : new Set<string>();
      if (unknown.some((name) => surviving.has(name))) {
        throw new RetainedBuildError(
          'Offline compatibility lost: unaccounted retained cache',
          'storage',
        );
      }
    }
    return records;
  }

  private async cached(record: BuildRecord, asset: Asset): Promise<Response> {
    if (!(await this.caches.has(record.cacheName))) {
      throw new RetainedBuildError(
        'Offline compatibility lost: retained cache was evicted',
        'storage',
      );
    }
    const cache = await this.caches.open(record.cacheName);
    const response = await cache.match(new URL(asset.url, this.origin).href);
    if (!response)
      throw new RetainedBuildError(`Offline compatibility lost: ${asset.url}`, 'storage');
    try {
      return await withAssetDeadline((signal) => verifiedResponse(response, asset, signal));
    } catch {
      throw new RetainedBuildError(
        `Offline compatibility lost: corrupt asset ${asset.url}`,
        'storage',
      );
    }
  }

  async install(value: unknown, expectedBuildKey: string): Promise<void> {
    const inventory = parseInventory(value);
    if (
      inventory.build_key !== expectedBuildKey ||
      (await inventoryGeneration(inventory.assets)) !== inventory.generation
    ) {
      throw new RetainedBuildError('Offline build identity mismatch');
    }
    const snapshot = await this.records();
    const owner = crypto.randomUUID();
    const candidate: BuildRecord = {
      inventory,
      owner,
      cacheName: `${RETAINED_BUILD_CACHE_PREFIX}${inventory.generation}-${owner}`,
      status: 'pending',
      reservedBytes: bytesReserved(inventory),
    };
    const database = await this.database;
    const transaction = database.transaction('builds', 'readwrite');
    const done = completion(transaction);
    const store = transaction.objectStore('builds');
    let existing: BuildRecord | undefined;
    let failure: unknown;
    const request = store.getAll(null, RETAINED_BUILD_LIMITS.generations + 1);
    request.onsuccess = () => {
      try {
        const records = parseRecords(request.result);
        if (
          records.some(
            (record) => !snapshot.some((known) => JSON.stringify(known) === JSON.stringify(record)),
          )
        ) {
          throw new RetainedBuildError('Concurrent admission changed metadata; retry install');
        }
        existing = records.find((record) => record.inventory.build_key === inventory.build_key);
        if (existing) {
          if (
            existing.status !== 'ready' ||
            JSON.stringify(existing.inventory) !== JSON.stringify(inventory)
          ) {
            throw new RetainedBuildError('Build already reserved or identity conflicts');
          }
          return;
        }
        if (
          records.length >= RETAINED_BUILD_LIMITS.generations ||
          records.reduce((sum, record) => sum + record.reservedBytes, 0) + candidate.reservedBytes >
            RETAINED_BUILD_LIMITS.totalBytes
        ) {
          throw new RetainedBuildError('Retained build capacity reached', 'capacity');
        }
        for (const record of records) {
          for (const asset of inventory.assets.filter((asset) => asset.immutable)) {
            const collision = record.inventory.assets.find((old) => old.url === asset.url);
            if (collision && (collision.sha256 !== asset.sha256 || !collision.immutable)) {
              throw new RetainedBuildError('Immutable asset URL collision');
            }
          }
          for (const old of record.inventory.assets.filter((asset) => asset.immutable)) {
            const collision = inventory.assets.find((asset) => asset.url === old.url);
            if (collision && (collision.sha256 !== old.sha256 || !collision.immutable)) {
              throw new RetainedBuildError('Immutable asset URL collision');
            }
          }
        }
        store.add(candidate);
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
    try {
      await done;
    } catch (error) {
      throw failure ?? error;
    }
    if (existing) {
      for (const asset of existing.inventory.assets) await this.cached(existing, asset);
      this.currentBuildKey = expectedBuildKey;
      return;
    }
    let committed = false;
    try {
      const cache = await this.caches.open(candidate.cacheName);
      for (const asset of inventory.assets) {
        const url = new URL(asset.url, this.origin).href;
        // Native WindowOrWorkerGlobalScope.fetch rejects a store as its receiver.
        const fetcher = this.fetcher;
        const verified = await withAssetDeadline(async (signal) => {
          const response = await fetcher(
            new Request(url, { credentials: 'omit', cache: 'no-store', redirect: 'error', signal }),
          );
          if (response.redirected || (response.url && response.url !== url)) {
            void response.body?.cancel().catch(() => undefined);
            throw new RetainedBuildError('Offline asset response changed URL');
          }
          return verifiedResponse(response, asset, signal);
        });
        await cache.put(url, verified);
      }
      for (const asset of inventory.assets) await this.cached(candidate, asset);
      const commit = database.transaction('builds', 'readwrite');
      const complete = completion(commit);
      const commitStore = commit.objectStore('builds');
      const current = commitStore.get(inventory.build_key);
      current.onsuccess = () => {
        const parsed = recordSchema.safeParse(current.result);
        if (
          !parsed.success ||
          JSON.stringify(parsed.data) !== JSON.stringify(recordSchema.parse(candidate))
        ) {
          commit.abort();
          return;
        }
        commitStore.put({ ...candidate, status: 'ready' });
      };
      await complete;
      committed = true;
      this.currentBuildKey = expectedBuildKey;
    } catch (error) {
      if (!committed) {
        // Only this installer's resources may be rolled back. Never touch foreign reservations.
        await this.caches.delete(candidate.cacheName).catch(() => false);
        // Failed/uncertain deletion must remain quota-accounted. Absence is the
        // only proof that this owned reservation can safely be released.
        const absent = await this.caches
          .has(candidate.cacheName)
          .then((present) => !present)
          .catch(() => false);
        if (absent) {
          const rollback = database.transaction('builds', 'readwrite');
          const complete = completion(rollback);
          const rollbackStore = rollback.objectStore('builds');
          const current = rollbackStore.get(inventory.build_key);
          current.onsuccess = () => {
            const parsed = recordSchema.safeParse(current.result);
            if (parsed.success && parsed.data.owner === owner && parsed.data.status === 'pending')
              rollbackStore.delete(inventory.build_key);
          };
          await complete.catch(() => undefined);
        }
      }
      throw error;
    }
  }

  /**
   * Read-only admission check used by a restarted worker to explain a quota
   * refusal without reserving metadata, downloading assets, or mutating caches.
   * An already admitted identical build is never considered capacity-blocked;
   * this advisory check does not certify that cached asset bodies still exist.
   */
  async admissionRefusal(value: unknown): Promise<'capacity' | null> {
    const inventory = parseInventory(value);
    if ((await inventoryGeneration(inventory.assets)) !== inventory.generation) {
      throw new RetainedBuildError('Offline build identity mismatch');
    }
    const records = await this.records();
    const existing = records.find((record) => record.inventory.build_key === inventory.build_key);
    if (existing) {
      if (
        existing.status !== 'ready' ||
        JSON.stringify(existing.inventory) !== JSON.stringify(inventory)
      ) {
        throw new RetainedBuildError('Build already reserved or identity conflicts');
      }
      return null;
    }
    for (const record of records) {
      for (const asset of inventory.assets.filter((asset) => asset.immutable)) {
        const collision = record.inventory.assets.find((old) => old.url === asset.url);
        if (collision && (collision.sha256 !== asset.sha256 || !collision.immutable)) {
          throw new RetainedBuildError('Immutable asset URL collision');
        }
      }
      for (const old of record.inventory.assets.filter((asset) => asset.immutable)) {
        const collision = inventory.assets.find((asset) => asset.url === old.url);
        if (collision && (collision.sha256 !== old.sha256 || !collision.immutable)) {
          throw new RetainedBuildError('Immutable asset URL collision');
        }
      }
    }
    return records.length >= RETAINED_BUILD_LIMITS.generations ||
      records.reduce((sum, record) => sum + record.reservedBytes, 0) + bytesReserved(inventory) >
        RETAINED_BUILD_LIMITS.totalBytes
      ? 'capacity'
      : null;
  }

  async lookupImmutable(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url);
    if (
      request.method !== 'GET' ||
      url.origin !== this.origin ||
      url.search ||
      url.hash ||
      !isOfflineAssetPath(url.pathname)
    )
      return undefined;
    for (const record of await this.records()) {
      if (record.status !== 'ready') continue;
      const asset = record.inventory.assets.find(
        (asset) => asset.immutable && asset.url === url.pathname,
      );
      if (asset) return this.cached(record, asset);
    }
    return undefined;
  }

  async lookupCurrent(
    request: Request,
    buildKey = this.currentBuildKey,
  ): Promise<Response | undefined> {
    const url = new URL(request.url);
    if (
      request.method !== 'GET' ||
      url.origin !== this.origin ||
      url.search ||
      url.hash ||
      !isOfflineAssetPath(url.pathname)
    )
      return undefined;
    const record = (await this.records()).find(
      (record) => record.status === 'ready' && record.inventory.build_key === buildKey,
    );
    const asset = record?.inventory.assets.find((asset) => asset.url === url.pathname);
    return record && asset ? this.cached(record, asset) : undefined;
  }

  async navigationResponse(buildKey = this.currentBuildKey): Promise<Response> {
    const record = (await this.records()).find(
      (record) => record.status === 'ready' && record.inventory.build_key === buildKey,
    );
    const shell = record?.inventory.assets.find((asset) => asset.url === '/');
    if (!record || !shell)
      throw new RetainedBuildError(
        'Offline compatibility lost: current shell is unavailable',
        'storage',
      );
    return this.cached(record, shell);
  }
}
