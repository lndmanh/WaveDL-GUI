#!/usr/bin/env node
// Executable scoped rollback gate. This is intentionally synthetic: it models
// the current worker's ownership/rollback contract and injects a bad asset.
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { limitation, verifyRetainedRollbackReport } from "./verify_retained_rollback_report.mjs";

const arg = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const key = (n) => n.toString(16).padStart(64, "0");
const record = (buildKey, owner, status = "ready") => ({
  buildKey,
  owner,
  status,
  reservedBytes: 4096,
  cacheName: `wavedl-retained-v1-${key(buildKey)}-${owner}`,
});

export function runRetainedRollbackGate() {
  const owners = [randomUUID(), randomUUID(), randomUUID()];
  const records = [record(key(1), owners[0]), record(key(2), owners[1]), record(key(3), owners[2])];
  const failed = records[2];
  failed.status = "pending";
  const foreignCacheName = "wavedl-retained-v1-foreign-cache-00000000-0000-0000-0000-000000000000";
  const before = { records: structuredClone(records), cacheNames: records.map((item) => item.cacheName).concat(foreignCacheName) };
  const deletedCacheNames = [failed.cacheName];
  const after = { records: records.filter((item) => item.owner !== failed.owner).map((item) => ({ ...item, status: "ready" })), cacheNames: records.filter((item) => item.owner !== failed.owner).map((item) => item.cacheName).concat(foreignCacheName) };
  const report = { schemaVersion: 1, status: "passed", limitation, failure: { kind: "asset-digest-mismatch", phase: "fetch", owner: failed.owner, cacheName: failed.cacheName, asset: "/_nuxt/g3-failed.js" }, before, after, deletedCacheNames, foreignCacheName, foreignCacheDeleted: false };
  verifyRetainedRollbackReport(report);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const report = runRetainedRollbackGate();
  const destination = arg("report");
  if (destination) await writeFile(destination, JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ status: report.status, nativeProof: false, report: destination ?? null }));
}
