#!/usr/bin/env node
// Read-only evidence guard, not a browser runner or independent browser proof.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, readlink } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  injectedWorkboxInventory,
  isGeneratedDistAlias,
  validateAssetUrl,
} from "./build_retained_browser_fixtures.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const stages = Object.freeze([
  "g1",
  "g2",
  "g3",
  "old-g1-lazy-views",
  "old-g2-unvisited-view",
  "retained-storage-after-native-lazy-views",
  "g4-capacity-refusal",
  "old-g3-unvisited-view-after-refusal",
  "final-retained-storage",
  "browser-restart-durability",
  "browser-storage-loss-refusal",
]);
export const limitation =
  "Native unvisited workspace rendering and a separate real no-store static GET through the retained worker are proven. HTML prefetch/module caching means the actual lazy module-loader request is not claimed to have traversed the worker.";
export const restartLimitation =
  "Owned Chrome close/reopen durability only; previous documents were closed, not preserved or restored. No legacy transition, storage-loss recovery, or concurrency proof.";
export const storageLossLimitation =
  "Live same-origin owned cache/IDB loss only; registration remains active. No legacy transition, automatic recovery, or concurrent admission proof.";
const labels = {
  "New training run": ["project-title", "Build a training run"],
  Settings: ["downloads-heading", "Downloads"],
  Results: ["results-title", "Published results"],
};
const excludedSourceDirectories = new Set([
  "node_modules",
  ".nuxt",
  ".output",
  ".cache",
  ".vite",
  ".vendor-backups",
  ".git",
]);

export async function verifySourceSnapshot(before, repo) {
  assert(
    before &&
      typeof before === "object" &&
      !Array.isArray(before) &&
      Object.keys(before).length > 0 &&
      Object.keys(before).length <= 4096,
    "Bounded source snapshot required",
  );
  for (const [path, hash] of Object.entries(before)) {
    assert(
      /^(?:web\/(?:[A-Za-z0-9_.~@,+-]+\/)*[A-Za-z0-9_.~@,+-]+|tools\/vendor_web_assets\.py|src\/wavedl\/__init__\.py)$/.test(
        path,
      ) &&
        path
          .split("/")
          .every(
            (segment) =>
              segment !== "." && segment !== ".." && !excludedSourceDirectories.has(segment),
          ) &&
        sha(hash),
      "Unsafe source snapshot path or digest",
    );
  }
  const currentFiles = [];
  async function visit(directory) {
    assert((await lstat(directory)).isDirectory(), "Source directory must be ordinary");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (excludedSourceDirectories.has(entry.name)) continue;
      const file = join(directory, entry.name);
      if (
        entry.isSymbolicLink() &&
        isGeneratedDistAlias(relative(repo, file), await readlink(file), repo)
      )
        continue;
      assert(!entry.isSymbolicLink(), "Source symlinks forbidden");
      if (entry.isDirectory()) await visit(file);
      else {
        assert(entry.isFile(), "Source must be ordinary files");
        currentFiles.push(relative(repo, file).split(sep).join("/"));
        assert(currentFiles.length <= 4096, "Source file count exceeds bound");
      }
    }
  }
  await visit(join(repo, "web"));
  currentFiles.push("tools/vendor_web_assets.py", "src/wavedl/__init__.py");
  assert.deepEqual(
    currentFiles.sort(),
    Object.keys(before).sort(),
    "Current source inventory differs from producer snapshot",
  );
  let totalSourceBytes = 0;
  for (const path of currentFiles) {
    const content = await boundedFile(join(repo, path), 32 * 1024 * 1024, true);
    totalSourceBytes += content.length;
    assert(totalSourceBytes <= 128 * 1024 * 1024, "Source snapshot exceeds aggregate byte bound");
    assert.equal(digest(content), before[path], `Current source differs: ${path}`);
  }
}

export async function boundedFile(path, cap = 2 * 1024 * 1024, allowEmpty = false) {
  // Reject ancestor symlinks too; /private is the canonical macOS temporary root.
  path = resolve(path);
  for (let parent = dirname(path); parent !== dirname(parent); parent = dirname(parent)) {
    const stat = await lstat(parent);
    assert(
      stat.isDirectory() && !stat.isSymbolicLink(),
      "Evidence parent must be an ordinary directory",
    );
  }
  const before = await lstat(path);
  assert(
    before.isFile() &&
      !before.isSymbolicLink() &&
      before.size >= (allowEmpty ? 0 : 1) &&
      before.size <= cap,
    "Evidence must be a bounded nonempty regular file",
  );
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    assert(
      stat.isFile() &&
        stat.dev === before.dev &&
        stat.ino === before.ino &&
        stat.size >= (allowEmpty ? 0 : 1) &&
        stat.size <= cap,
      "Evidence changed during open",
    );
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    assert(length === stat.size && length <= cap, "Evidence size changed during read");
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}

function clean(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    assert(
      !/^(?:error|shutdownError|browserError|fixtureError|ownedDirectoryError|skip|skipped|skipReason|retainedOwnedDirectory|retainedPrivateRoots)$/.test(
        key,
      ),
      "Failure, skip or retained-private-root evidence present",
    );
    if (key === "errors") assert.deepEqual(item, [], "Evidence errors present");
    clean(item);
  }
}

function storage(value, builds, origin) {
  assert(
    value && Array.isArray(value.records) && Array.isArray(value.cached),
    "Missing retained storage",
  );
  assert.equal(value.records.length, builds.length, "Wrong retained generation count");
  assert.equal(value.cached.length, builds.length, "Extra or missing retained cache");
  const names = value.records.map((record) => record.cacheName);
  assert.equal(new Set(names).size, builds.length, "Duplicate cache names");
  assert.deepEqual(
    [...value.cacheNames].sort(),
    [...names].sort(),
    "Orphan cache or missing cache",
  );
  assert.deepEqual(
    value.registrations,
    [{ scope: origin + "/", active: "activated" }],
    "Registration must be activated without waiting/installing G4",
  );
  for (const build of builds) {
    const records = value.records.filter((item) => item.inventory?.generation === build.generation);
    assert.equal(records.length, 1, "Missing or duplicate generation");
    const record = records[0];
    assert.equal(record.status, "ready", "Partial generation retained");
    assert.deepEqual(
      record.inventory,
      build.inventory,
      "Retained inventory differs from verified fixture bytes",
    );
    assert(
      typeof record.owner === "string" && /^[a-f0-9-]{36}$/.test(record.owner),
      "Missing cache owner",
    );
    assert.equal(record.cacheName, `wavedl-retained-v1-${build.generation}-${record.owner}`);
    assert.equal(record.reservedBytes, build.totalBytes);
    const cache = value.cached.find((item) => item.name === record.cacheName);
    const expected = build.inventory.assets.map(({ url, sha256, size }) => ({ url, sha256, size }));
    assert.deepEqual(
      cache?.assets,
      expected,
      "Cached assets must match every real fixture digest and size",
    );
  }
}

export function verifyReport(report, summary, builds, { activeDraft = false } = {}) {
  clean(report);
  assert.equal(report.status, "passed");
  assert.equal(
    report.browser,
    "agent-browser 0.26.0",
    "Actual native agent-browser version required",
  );
  assert(typeof report.browserSession === "string" && report.browserSession.length > 0);
  assert.equal(
    report.driverReadinessMode,
    "sync-exposure-poll-and-two-controller-dom-observations",
  );
  const start = Date.parse(report.started),
    end = Date.parse(report.finished);
  assert(
    Number.isFinite(start) && Number.isFinite(end) && end > start,
    "Invalid evidence chronology",
  );
  assert.deepEqual(
    report.stages.map((item) => item.stage),
    stages,
    "Exactly eleven ordered stages required",
  );
  const identities = builds.map(
    ({ namespace, generation, buildKey, offlineInventorySha256, workerSha256 }) => ({
      namespace,
      generation,
      buildKey,
      offlineInventorySha256,
      workerSha256,
    }),
  );
  assert.deepEqual(
    summary.builds.map(
      ({ namespace, generation, buildKey, offlineInventorySha256, workerSha256 }) => ({
        namespace,
        generation,
        buildKey,
        offlineInventorySha256,
        workerSha256,
      }),
    ),
    identities,
    "Producer metadata differs from verified fixture identities",
  );
  assert.deepEqual(report.fixtures, identities, "Report and verified producer fixtures differ");
  const s = report.stages;
  const baseline = [s[0].page, s[1].approved, s[2].approved];
  const url = new URL(baseline[0].url);
  assert(
    url.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(url.hostname) &&
      url.port &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password,
    "Canonical same-host native URL required",
  );
  const origin = url.origin;
  function page(value, index, stable = true) {
    assert.equal(value.url, origin + "/");
    assert.equal(value.controller, origin + "/sw.js");
    assert.deepEqual(value.entries, builds[index].entryUrls, "Wrong native entry generation");
    assert(
      Number.isFinite(value.timeOrigin) && value.timeOrigin >= start && value.timeOrigin <= end,
      "Page timeOrigin outside run",
    );
    if (stable)
      assert.equal(
        value.timeOrigin,
        baseline[index].timeOrigin,
        "An old client reloaded without approval",
      );
  }
  baseline.forEach((value, index) => page(value, index));
  assert(
    baseline[0].timeOrigin < baseline[1].timeOrigin &&
      baseline[1].timeOrigin < baseline[2].timeOrigin,
    "Approved pages must be chronologically distinct",
  );
  for (const index of [1, 2]) {
    assert(s[index].approvingTab !== undefined, "Native approving tab missing");
    assert.equal(s[index].previousTabs.length, index);
    s[index].previousTabs.forEach((value, old) => page(value, old));
  }
  assert.notEqual(s[1].approvingTab, s[2].approvingTab);
  for (const [stageIndex, count] of [
    [0, 1],
    [1, 2],
    [2, 3],
    [5, 3],
    [6, 3],
    [8, 3],
  ])
    storage(s[stageIndex].storage, builds.slice(0, count), origin);
  page(s[6].refusal, 2, false);
  assert(
    s[6].refusal.text.includes("Workstation update blocked") &&
      s[6].refusal.text.includes(
        "Update blocked by retained offline builds. Existing tabs remain loaded.",
      ),
    "Actual native capacity refusal text missing",
  );
  assert.equal(s[6].previousTabs.length, 3);
  s[6].previousTabs.forEach((value, index) => page(value, index));
  for (const [stageIndex, index, wanted] of [
    [3, 0, activeDraft ? ["Settings", "Results"] : ["New training run", "Settings", "Results"]],
    [4, 1, ["Settings"]],
    [7, 2, ["Settings"]],
  ]) {
    const stage = s[stageIndex];
    assert.equal(
      stage.limitation,
      limitation,
      "Do not claim the lazy module-loader request traversed the worker",
    );
    page(stage.initial, index);
    assert.deepEqual(
      stage.visits.map((item) => item.label),
      wanted,
      "Required native unvisited views missing",
    );
    for (const visit of stage.visits) {
      assert.equal(visit.initiallyMounted, false, "View was already mounted");
      page(visit.nativeView, index);
      const [marker, heading] = labels[visit.label];
      assert(
        visit.nativeView.headings.includes(heading) &&
          visit.nativeView.text.includes(heading) &&
          typeof visit.snapshot === "string" &&
          visit.snapshot.includes(heading),
        "Native workspace heading proof missing",
      );
      const chunk = builds[index].workspaceChunks[marker];
      assert(chunk, "Independent emitted workspace chunk missing");
      assert.equal(visit.chunkUrl, chunk.url);
      const probe = visit.retainedWorkerProbe;
      assert.equal(probe.url, chunk.url);
      assert.equal(probe.generation, builds[index].generation);
      assert.equal(probe.daemonStatus, 404);
      assert.equal(probe.status, 200);
      assert.equal(probe.sha256, chunk.sha256);
      assert.equal(probe.cacheSha256, chunk.sha256);
      assert.equal(probe.size, chunk.size);
      assert.equal(probe.controller, origin + "/sw.js");
      assert(
        Array.isArray(probe.resources) &&
          probe.resources.length > 0 &&
          probe.resources.every(
            (resource) =>
              resource.url === chunk.url &&
              resource.initiator === "fetch" &&
              Number.isFinite(resource.workerStart) &&
              resource.workerStart > 0 &&
              Number.isFinite(resource.startTime) &&
              resource.startTime >= 0 &&
              resource.responseStatus === 200,
          ),
        "Exact static no-store GET worker timing proof required",
      );
    }
  }
  const restart = s[9];
  assert.equal(restart.profileReused, true, "Original owned profile must be reused");
  assert.equal(restart.sessionAbsent, true, "Closed owned session must be absent before reopen");
  assert.equal(
    restart.limitation,
    restartLimitation,
    "Restart evidence scope must remain explicit",
  );
  const closeStarted = Date.parse(restart.closeStarted);
  const sessionAbsentAt = Date.parse(restart.sessionAbsentAt);
  const reopenedAt = Date.parse(restart.reopenedAt);
  assert(
    start <= closeStarted &&
      closeStarted <= sessionAbsentAt &&
      sessionAbsentAt <= reopenedAt &&
      reopenedAt <= end,
    "Invalid restart chronology",
  );
  assert.equal(restart.preRestartTabs.length, 3);
  restart.preRestartTabs.forEach((value, index) => page(value, index));
  page(restart.restartedPage, 2, false);
  assert(
    restart.restartedPage.timeOrigin >= sessionAbsentAt &&
      restart.restartedPage.timeOrigin > baseline[2].timeOrigin,
    "Restart route must be a fresh document after owned session close",
  );
  assert(
    restart.restartedPage.text.includes("Update blocked by retained offline builds."),
    "Restarted route refusal missing",
  );
  storage(restart.storage, builds.slice(0, 3), origin);
  assert.deepEqual(
    restart.storage.records,
    s[8].storage.records,
    "IDB records changed across restart",
  );
  assert.deepEqual(
    restart.storage.cached,
    s[8].storage.cached,
    "Retained cache bytes changed across restart",
  );
  assert.equal(restart.restartProbes.length, 3);
  restart.restartProbes.forEach((probe, index) => {
    const chunk = builds[index].workspaceChunks["downloads-heading"];
    assert.equal(probe.url, chunk.url);
    assert.equal(probe.generation, builds[index].generation);
    assert.equal(probe.daemonStatus, 404);
    assert.equal(probe.status, 200);
    assert.equal(probe.sha256, chunk.sha256);
    assert.equal(probe.cacheSha256, chunk.sha256);
    assert.equal(probe.size, chunk.size);
    assert.equal(probe.controller, origin + "/sw.js");
    assert(
      Array.isArray(probe.resources) &&
        probe.resources.length > 0 &&
        probe.resources.every(
          (resource) =>
            resource.url === chunk.url &&
            resource.initiator === "fetch" &&
            Number.isFinite(resource.workerStart) &&
            resource.workerStart > 0 &&
            Number.isFinite(resource.startTime) &&
            resource.startTime >= 0 &&
            resource.responseStatus === 200,
        ),
      "Restart static GET must traverse retained worker",
    );
  });
  const loss = s[10];
  assert.equal(loss.limitation, storageLossLimitation, "Storage-loss scope must remain explicit");
  storage(loss.beforeLoss, builds.slice(0, 3), origin);
  assert.deepEqual(
    loss.loss.owned,
    loss.beforeLoss.cacheNames.filter((name) => name.startsWith("wavedl-retained-v1-")).sort(),
    "Loss gate must enumerate only owned retained caches",
  );
  assert.deepEqual(
    loss.loss.deleted,
    loss.loss.owned,
    "Loss gate must delete every owned retained cache",
  );
  assert.equal(
    loss.loss.idb?.outcome,
    "deleted",
    "Actual IDB deletion required, not blocked/attempted loss",
  );
  for (const refusal of [loss.refusals?.immutable, loss.refusals?.navigation]) {
    assert(
      refusal && refusal.outcome === "error",
      "Storage-loss fetch must produce a read-only refusal marker",
    );
    assert(
      typeof refusal.name === "string" && typeof refusal.marker === "string",
      "Refusal marker must include error evidence",
    );
    assert(
      !("status" in refusal),
      "Storage-loss refusal must not expose a network response status",
    );
  }
  assert.deepEqual(
    loss.afterLoss.registrations,
    [{ scope: origin + "/", active: "activated" }],
    "Storage-loss gate must not unregister the active worker",
  );
  assert.deepEqual(
    loss.afterLoss.cacheNames.filter((name) => name.startsWith("wavedl-retained-v1-")),
    [],
    "Owned caches must not silently resurrect after refused reads",
  );
  assert.deepEqual(loss.afterLoss.cached, [], "Lost retained bytes must remain absent");
  assert.deepEqual(loss.afterLoss.records, [], "Lost retained metadata must remain absent");
  assert.equal(loss.refusals.navigation.name, "ChromeNavigationError");
  assert.equal(
    loss.refusals.navigation.marker,
    "chrome-error://chromewebdata/",
    "Actual native navigation must fail, not an ordinary fetch of the shell path",
  );
  const cleanup = report.cleanup;
  for (const field of [
    "browserClosed",
    "browserSessionAbsent",
    "servicesClosed",
    "listenerConnectionRefused",
    "ownedDirectoryRemoved",
  ])
    assert.equal(cleanup[field], true, `Missing ${field}`);
  assert(
    (cleanup.fixtureExitCode === 0 && cleanup.fixtureSignalCode === null) ||
      (cleanup.fixtureExitCode === null && cleanup.fixtureSignalCode === "SIGINT"),
    "Fixture did not genuinely exit cleanly or via SIGINT",
  );
  assert(
    typeof report.fixtureDiagnostics?.stdout === "string" &&
      report.fixtureDiagnostics.stdout.includes("Fixture: services-closed"),
    "Actual fixture service shutdown marker required",
  );
  return {
    status: "passed",
    stages: stages.length,
    scope:
      "Same-host retained-generation browser evidence; separate static GET probes, not lazy module-loader traversal proof",
  };
}

export async function verifyRetainedBrowserReport(reportPath, summaryPath, repo = repository, options = {}) {
  const report = JSON.parse(await boundedFile(reportPath));
  summaryPath = resolve(summaryPath);
  assert.equal(
    report.fixtureSummary,
    summaryPath,
    "Report must identify supplied producer summary",
  );
  const summary = JSON.parse(await boundedFile(summaryPath));
  assert.equal(summary.sourceUnchanged, true);
  const before = JSON.parse(await boundedFile(join(dirname(summaryPath), "source-before.json")));
  const after = JSON.parse(await boundedFile(join(dirname(summaryPath), "source-after.json")));
  assert.deepEqual(after, before, "Producer source changed");
  assert.equal(summary.sourceTreeSha256, digest(JSON.stringify(before)));
  assert.equal(summary.sourceFileCount, Object.keys(before).length);
  await verifySourceSnapshot(before, repo);
  const ids = summary.sourceIdentifiers;
  assert(ids && Object.keys(ids).length >= 5, "Producer source identifiers missing");
  for (const required of [
    "web/workstation/lib/build-identity.ts",
    "web/workstation/service-worker/retained-builds.ts",
    "web/workstation/service-worker/sw.ts",
    "tools/vendor_web_assets.py",
    "src/wavedl/__init__.py",
  ])
    assert(Object.hasOwn(ids, required), "Required source identity missing");
  for (const [path, hash] of Object.entries(ids)) {
    assert(
      /^(?:web\/(?:workstation|app|test\/workstation)\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.ts|tools\/vendor_web_assets\.py|src\/wavedl\/__init__\.py)$/.test(
        path,
      ) &&
        path.split("/").every((segment) => segment !== "." && segment !== "..") &&
        sha(hash),
      "Unsafe source identity",
    );
    assert.equal(before[path], hash);
    assert.equal(
      digest(await boundedFile(join(repo, path))),
      hash,
      `Current source differs: ${path}`,
    );
  }
  assert.deepEqual(
    summary.builds.map((build) => build.namespace),
    ["g1", "g2", "g3", "g4"],
  );
  for (const field of ["generation", "buildKey"])
    assert.equal(
      new Set(summary.builds.map((build) => build[field])).size,
      4,
      "Four distinct fixture identities required",
    );
  const builds = [];
  for (const build of summary.builds) {
    const assetsDir = join(dirname(summaryPath), build.namespace, "src/wavedl_daemon/web_assets");
    assert.equal(build.assetsDir, assetsDir, "Fixture path not owned by producer directory");
    assert.equal(build.fixture, join(dirname(summaryPath), build.namespace));
    for (const field of ["generation", "buildKey", "workerSha256", "offlineInventorySha256"])
      assert(sha(build[field]), "Malformed producer digest");
    const bytes = await boundedFile(join(assetsDir, "offline-build.json"), 128 * 1024);
    assert.equal(digest(bytes), build.offlineInventorySha256);
    const inventory = JSON.parse(bytes);
    assert.equal(inventory.schema_version, 1);
    assert.equal(inventory.generation, build.generation);
    assert.equal(inventory.build_key, build.buildKey);
    assert(
      Array.isArray(inventory.assets) &&
        inventory.assets.length > 0 &&
        inventory.assets.length <= 128,
    );
    assert.equal(inventory.assets.length, build.assetCount);
    assert.equal(new Set(inventory.assets.map((asset) => asset.url)).size, inventory.assets.length);
    let total = 0;
    const contents = new Map();
    for (const asset of inventory.assets) {
      const path = validateAssetUrl(asset.url);
      assert(
        sha(asset.sha256) &&
          Number.isSafeInteger(asset.size) &&
          asset.size > 0 &&
          asset.size <= 8 * 1024 * 1024,
      );
      assert.equal(typeof asset.immutable, "boolean");
      if (asset.immutable) assert(asset.url.startsWith(`/_nuxt/${build.namespace}/`));
      const content = await boundedFile(join(assetsDir, path), 8 * 1024 * 1024);
      assert.equal(content.length, asset.size);
      assert.equal(digest(content), asset.sha256);
      contents.set(asset.url, content.toString("utf8"));
      total += content.length;
    }
    assert(total <= 16 * 1024 * 1024);
    assert.equal(total, build.totalBytes);
    assert.equal(
      inventory.generation,
      digest(JSON.stringify(inventory.assets.map((x) => [x.url, x.sha256, x.size, x.immutable]))),
    );
    const worker = await boundedFile(join(assetsDir, "sw.js"), 8 * 1024 * 1024);
    assert.equal(digest(worker), build.workerSha256);
    const injected = injectedWorkboxInventory(worker.toString("utf8"));
    assert.equal(injected.buildKey, build.buildKey);
    assert.deepEqual(
      injected.entries.map((x) => (x.url.startsWith("/") ? x.url : "/" + x.url)).sort(),
      inventory.assets.map((x) => x.url).sort(),
    );
    const entries = [...contents.get("/").matchAll(/<script[^>]*src="([^"]+)"/g)].map((x) => x[1]);
    assert(
      entries.length > 0 &&
        entries.every((x) => x.startsWith(`/_nuxt/${build.namespace}/`) && contents.has(x)),
    );
    assert.deepEqual(entries, build.entryUrls);
    const workspaceChunks = {};
    for (const [marker] of Object.values(labels)) {
      const candidates = inventory.assets.filter(
        (asset) =>
          asset.immutable && asset.url.endsWith(".js") && contents.get(asset.url).includes(marker),
      );
      assert.equal(candidates.length, 1, "Unique real workspace chunk required");
      workspaceChunks[marker] = candidates[0];
    }
    builds.push({ ...build, inventory, workspaceChunks });
  }
  return verifyReport(report, summary, builds, options);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert(
      process.argv.length === 4,
      "Usage: node tools/verify_retained_browser_report.mjs REPORT.json FIXTURES/summary.json",
    );
    console.log(
      JSON.stringify(await verifyRetainedBrowserReport(process.argv[2], process.argv[3])),
    );
  } catch (error) {
    console.error(`Retained browser evidence rejected: ${error.message}`);
    process.exitCode = 1;
  }
}
