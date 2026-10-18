import assert from "node:assert/strict";
import test from "node:test";
import { verifyConcurrencyStage } from "./verify_retained_concurrency_stage.mjs";

const h = (n) => n.toString(16).padStart(64, "0");
function fixture() {
  const origin = "http://127.0.0.1:41001";
  const builds = [h(1), h(2)].map((buildKey, i) => ({ buildKey, inventory: { assets: [{ url: `/_nuxt/g${i + 1}.js`, sha256: h(i + 10), size: 10 }] } }));
  const registrations = builds.map(({ buildKey }, i) => ({ origin, scope: `${origin}/concurrent/${i}/`, active: "activated", scriptURL: `${origin}/sw-${buildKey}.js`, buildKey }));
  const installs = builds.map(({ buildKey }, i) => ({ buildKey, started: `2026-10-11T00:00:0${i}.000Z`, finished: "2026-10-11T00:00:05.000Z", fetches: [{ url: `${origin}/_nuxt/g${i + 1}.js`, status: 200, redirected: false, startedAt: i, finishedAt: i + 2, sha256: h(i + 10), size: 10 }] }));
  return { origin, builds, stage: { stage: "native-concurrent-admission", registrations, installs, overlapMs: 4_000, finalStorage: { records: builds.map(({ buildKey }, i) => ({ status: "ready", owner: `00000000-0000-0000-0000-00000000000${i + 1}`, cacheName: `wavedl-retained-v1-${buildKey}-00000000-0000-0000-0000-00000000000${i + 1}`, reservedBytes: 10, inventory: { build_key: buildKey } })) }, rollback: { failed: false, deletedCacheNames: [] }, foreignCacheDeleted: false } };
}

test("accepts synthetic overlap evidence contract, not native proof", () => {
  const value = fixture();
  assert.equal(verifyConcurrencyStage(value.stage, value).status, "passed");
});

test("rejects fabricated/non-overlap and unsafe rollback evidence", () => {
  for (const mutate of [
    (v) => (v.stage.overlapMs = 0),
    (v) => (v.stage.installs[1].started = "2026-10-11T00:00:06.000Z"),
    (v) => (v.stage.installs[0].fetches[0].status = 404),
    (v) => (v.stage.registrations[1].scope = v.stage.registrations[0].scope),
    (v) => (v.stage.foreignCacheDeleted = true),
    (v) => v.stage.rollback.deletedCacheNames.push("wavedl-retained-v1-foreign-00000000-0000-0000-0000-000000000000"),
  ]) {
    const value = fixture();
    mutate(value);
    assert.throws(() => verifyConcurrencyStage(value.stage, value));
  }
});
