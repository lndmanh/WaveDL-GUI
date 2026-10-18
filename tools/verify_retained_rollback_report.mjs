import assert from "node:assert/strict";

export const limitation =
  "Synthetic retained admission rollback: worker-contract-shaped reservation/cache ownership with an injected asset failure; not native browser CacheStorage/IndexedDB or ordinary UI-update proof.";

const ownerPattern = /^[0-9a-f-]{36}$/;
const cachePattern = /^wavedl-retained-v1-[a-f0-9]{64}-[0-9a-f-]{36}$/;

function ownedRecord(record) {
  assert(record && ownerPattern.test(record.owner), "Owner UUID required");
  assert(cachePattern.test(record.cacheName), "Owned cache name required");
  assert(record.cacheName.endsWith(`-${record.owner}`), "Cache must belong to owner");
  assert(["ready", "pending"].includes(record.status), "Record status required");
  assert(Number.isInteger(record.reservedBytes) && record.reservedBytes > 0, "Reservation bytes required");
  assert(typeof record.buildKey === "string" && /^[a-f0-9]{64}$/.test(record.buildKey), "Build key required");
}

export function verifyRetainedRollbackReport(report) {
  assert.equal(report?.schemaVersion, 1);
  assert.equal(report.status, "passed");
  assert.equal(report.limitation, limitation);
  assert.equal(report.failure?.kind, "asset-digest-mismatch");
  assert.equal(report.failure?.phase, "fetch");
  assert(ownerPattern.test(report.failure.owner), "Failed owner required");
  assert(cachePattern.test(report.failure.cacheName), "Failed cache required");
  assert(report.failure.cacheName.endsWith(`-${report.failure.owner}`));

  const before = report.before?.records;
  const after = report.after?.records;
  assert(Array.isArray(before) && Array.isArray(after), "Before/after records required");
  assert.equal(before.length, 3, "Three admitted generations required before failure");
  assert.equal(after.length, 2, "Failed reservation must be released");
  before.forEach(ownedRecord);
  after.forEach(ownedRecord);
  assert(before.some((record) => record.owner === report.failure.owner && record.status === "pending"));
  assert(!after.some((record) => record.owner === report.failure.owner));
  const survivingOwners = before.filter((record) => record.owner !== report.failure.owner).map((record) => record.owner).sort();
  assert.deepEqual(after.map((record) => record.owner).sort(), survivingOwners, "Other owners must survive unchanged");

  assert.deepEqual(
    report.after.cacheNames.filter((name) => name !== report.foreignCacheName).sort(),
    after.map((record) => record.cacheName).sort(),
  );
  assert(!report.after.cacheNames.includes(report.failure.cacheName), "Failed cache must be deleted");
  assert.equal(report.foreignCacheDeleted, false, "Foreign cache deletion must be false");
  assert.deepEqual(report.deletedCacheNames, [report.failure.cacheName], "Only failed owner's cache may be deleted");
  assert(report.before.cacheNames.includes(report.foreignCacheName), "Foreign cache must be present before failure");
  assert(report.after.cacheNames.includes(report.foreignCacheName), "Foreign cache must remain untouched");
  assert(report.after.records.reduce((sum, record) => sum + record.reservedBytes, 0) <= 64 * 1024 * 1024);
  return { status: "passed", nativeProof: false, scope: limitation };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const report = JSON.parse(await (await import("node:fs/promises")).readFile(process.argv[2], "utf8"));
  console.log(JSON.stringify(verifyRetainedRollbackReport(report)));
}
