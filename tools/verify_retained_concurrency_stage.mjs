import assert from "node:assert/strict";

export const CONCURRENCY_LIMITS = Object.freeze({ generations: 3, totalBytes: 64 * 1024 * 1024 });

const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const ownedCache = (value) =>
  typeof value === "string" && /^wavedl-retained-v1-[a-f0-9]{64}-[0-9a-f-]{36}$/.test(value);

/**
 * Verify evidence from two real same-origin scoped service-worker installs.
 * This is deliberately a report contract: it never simulates IndexedDB,
 * CacheStorage or fetch and therefore cannot be mistaken for native proof.
 */
export function verifyConcurrencyStage(stage, { origin, builds }) {
  assert(stage?.stage === "native-concurrent-admission", "Concurrent stage marker required");
  assert(/^https?:\/\/[^/]+$/.test(origin), "Canonical origin required");
  assert(Array.isArray(builds) && builds.length >= 2 && builds.every((build) => digest(build.buildKey) && Array.isArray(build.inventory?.assets)), "Two verified producer builds required");
  assert(Array.isArray(stage.registrations) && stage.registrations.length === 2, "Two scoped registrations required");
  const scopes = new Set();
  for (const registration of stage.registrations) {
    assert(registration.origin === origin, "Registration origin mismatch");
    assert(typeof registration.scope === "string" && registration.scope.startsWith(origin + "/"), "Registration scope must be same-origin");
    assert(!scopes.has(registration.scope), "Registration scopes must be distinct");
    scopes.add(registration.scope);
    assert(registration.active === "activated" && !registration.waiting && !registration.installing, "Both workers must be activated without waiting workers");
    assert(typeof registration.scriptURL === "string" && registration.scriptURL.startsWith(origin + "/"), "Compiled worker URL required");
    assert(digest(registration.buildKey), "Worker build identity digest required");
    assert(builds.some((build) => build.buildKey === registration.buildKey), "Registration must use a verified producer build");
  }
  assert(Array.isArray(stage.installs) && stage.installs.length === 2, "Two overlapping installs required");
  const keys = new Set();
  let overlapStart = -Infinity;
  let overlapEnd = Infinity;
  for (const install of stage.installs) {
    assert(typeof install.buildKey === "string" && digest(install.buildKey), "Install build identity required");
    assert(!keys.has(install.buildKey), "Concurrent installs must use distinct builds");
    keys.add(install.buildKey);
    const build = builds.find((build) => build.buildKey === install.buildKey);
    assert(build, "Install must use a verified producer build");
    const start = Date.parse(install.started), end = Date.parse(install.finished);
    assert(Number.isFinite(start) && Number.isFinite(end) && end > start, "Install chronology required");
    overlapStart = Math.max(overlapStart, start);
    overlapEnd = Math.min(overlapEnd, end);
    assert(Array.isArray(install.fetches) && install.fetches.length > 0, "Real delayed asset fetch observations required");
    for (const fetch of install.fetches) {
      assert(fetch.url?.startsWith(origin + "/"), "Asset fetch must be same-origin");
      assert(fetch.status === 200 && fetch.redirected === false, "Asset fetch must be verified 200 without redirect");
      assert(Number.isFinite(fetch.startedAt) && Number.isFinite(fetch.finishedAt) && fetch.finishedAt > fetch.startedAt, "Asset fetch timing required");
      assert(digest(fetch.sha256) && Number.isInteger(fetch.size) && fetch.size > 0, "Fetched bytes must carry digest and size");
      const asset = build.inventory.assets.find((asset) => new URL(asset.url, origin).href === fetch.url);
      assert(asset && asset.sha256 === fetch.sha256 && asset.size === fetch.size, "Fetched bytes must match verified producer inventory");
    }
  }
  assert(overlapEnd > overlapStart, "Install intervals must genuinely overlap");
  assert(stage.overlapMs === overlapEnd - overlapStart && stage.overlapMs > 0, "Reported overlap must match install chronology");
  const records = stage.finalStorage?.records;
  assert(Array.isArray(records) && records.length <= CONCURRENCY_LIMITS.generations, "Final generation bound exceeded");
  assert(records.every((record) => record.status === "ready" && ownedCache(record.cacheName)), "Final records must be ready and owned");
  assert(new Set(records.map((record) => record.inventory?.build_key)).size === records.length, "Duplicate final build records");
  const total = records.reduce((sum, record) => sum + record.reservedBytes, 0);
  assert(records.every((record) => Number.isInteger(record.reservedBytes) && record.reservedBytes > 0), "Every byte reservation must be positive and integral");
  assert(total <= CONCURRENCY_LIMITS.totalBytes, "Final reserved bytes exceed aggregate bound");
  const deleted = stage.rollback?.deletedCacheNames ?? [];
  assert(Array.isArray(deleted) && deleted.every(ownedCache), "Rollback deletion names must be owned caches");
  assert(new Set(deleted).size === deleted.length, "Rollback deletion names must be unique");
  if (stage.rollback?.failed) {
    assert(typeof stage.rollback.owner === "string" && /^[0-9a-f-]{36}$/.test(stage.rollback.owner), "Failed owner required");
    assert(stage.rollback.cacheName && deleted.includes(stage.rollback.cacheName), "Failed install may delete only its own cache");
    assert(deleted.every((name) => name === stage.rollback.cacheName && name.endsWith(`-${stage.rollback.owner}`)), "Rollback must not delete another installer's resources");
    assert(!records.some((record) => record.owner === stage.rollback.owner), "Failed owner must not remain admitted");
  }
  assert(stage.foreignCacheDeleted === false, "Foreign cache deletion must be explicitly false");
  return { status: "passed", overlapMs: stage.overlapMs, finalGenerations: records.length, totalReservedBytes: total };
}
