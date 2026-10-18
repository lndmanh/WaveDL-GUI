// Synthetic evidence contracts only: these tests do not establish browser proof.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  boundedFile,
  limitation,
  restartLimitation,
  storageLossLimitation,
  stages,
  verifyReport,
  verifySourceSnapshot,
} from "./verify_retained_browser_report.mjs";

function synthetic() {
  const hash = (n) => n.toString(16).padStart(64, "0");
  const origin = "http://127.0.0.1:12345";
  const start = Date.parse("2026-10-10T00:00:00.000Z");
  const labels = [
    ["New training run", "project-title", "Build a training run"],
    ["Settings", "downloads-heading", "Downloads"],
    ["Results", "results-title", "Published results"],
  ];
  const builds = Array.from({ length: 4 }, (_, index) => {
    const namespace = `g${index + 1}`;
    const assets = labels.map(([, marker], i) => ({
      url: `/_nuxt/${namespace}/${marker}.js`,
      sha256: hash(index * 10 + i + 100),
      size: 10,
      immutable: true,
    }));
    const generation = hash(index + 1),
      buildKey = hash(index + 10);
    return {
      namespace,
      generation,
      buildKey,
      offlineInventorySha256: hash(index + 20),
      workerSha256: hash(index + 30),
      entryUrls: [`/_nuxt/${namespace}/entry.js`],
      totalBytes: 30,
      inventory: { schema_version: 1, generation, build_key: buildKey, assets },
      workspaceChunks: Object.fromEntries(labels.map(([, marker], i) => [marker, assets[i]])),
    };
  });
  function page(index) {
    return {
      url: origin + "/",
      controller: origin + "/sw.js",
      timeOrigin: start + (index + 1) * 1000,
      entries: builds[index].entryUrls,
      headings: ["Runs"],
      text: "Runs",
    };
  }
  function storage(count) {
    const records = builds.slice(0, count).map((build, index) => {
      const owner = `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`;
      return {
        inventory: build.inventory,
        owner,
        cacheName: `wavedl-retained-v1-${build.generation}-${owner}`,
        status: "ready",
        reservedBytes: 30,
      };
    });
    return {
      records,
      cacheNames: records.map((x) => x.cacheName),
      cached: records.map((x) => ({
        name: x.cacheName,
        assets: x.inventory.assets.map(({ url, sha256, size }) => ({ url, sha256, size })),
      })),
      registrations: [{ scope: origin + "/", active: "activated" }],
    };
  }
  function visits(index, names) {
    return {
      initial: page(index),
      limitation,
      visits: names.map((label) => {
        const [, marker, heading] = labels.find((x) => x[0] === label);
        const chunk = builds[index].workspaceChunks[marker];
        return {
          label,
          initiallyMounted: false,
          chunkUrl: chunk.url,
          snapshot: `heading ${heading}`,
          nativeView: { ...page(index), headings: [heading], text: heading },
          retainedWorkerProbe: {
            url: chunk.url,
            generation: builds[index].generation,
            daemonStatus: 404,
            status: 200,
            cacheSha256: chunk.sha256,
            sha256: chunk.sha256,
            size: chunk.size,
            controller: origin + "/sw.js",
            resources: [
              {
                url: chunk.url,
                initiator: "fetch",
                startTime: 100,
                workerStart: 101,
                responseStatus: 200,
              },
            ],
          },
        };
      }),
    };
  }
  const fixtureFields = builds.map(
    ({ namespace, generation, buildKey, offlineInventorySha256, workerSha256 }) => ({
      namespace,
      generation,
      buildKey,
      offlineInventorySha256,
      workerSha256,
    }),
  );
  const report = {
    status: "passed",
    browser: "agent-browser 0.26.0",
    browserSession: "synthetic-contract",
    driverReadinessMode: "sync-exposure-poll-and-two-controller-dom-observations",
    started: new Date(start).toISOString(),
    finished: new Date(start + 10000).toISOString(),
    fixtures: structuredClone(fixtureFields),
    stages: [
      { page: page(0), storage: storage(1) },
      { approved: page(1), approvingTab: 1, previousTabs: [page(0)], storage: storage(2) },
      { approved: page(2), approvingTab: 2, previousTabs: [page(0), page(1)], storage: storage(3) },
      visits(0, ["New training run", "Settings", "Results"]),
      visits(1, ["Settings"]),
      { storage: storage(3) },
      {
        refusal: {
          ...page(2),
          timeOrigin: start + 4000,
          text: "Workstation update blocked\nUpdate blocked by retained offline builds. Existing tabs remain loaded.",
        },
        previousTabs: [page(0), page(1), page(2)],
        storage: storage(3),
      },
      visits(2, ["Settings"]),
      { storage: storage(3) },
      {
        preRestartTabs: [page(0), page(1), page(2)],
        restartedPage: {
          ...page(2),
          timeOrigin: start + 8000,
          text: "Update blocked by retained offline builds.",
        },
        storage: storage(3),
        restartProbes: [0, 1, 2].map(
          (index) => visits(index, ["Settings"]).visits[0].retainedWorkerProbe,
        ),
        profileReused: true,
        sessionAbsent: true,
        closeStarted: new Date(start + 6000).toISOString(),
        sessionAbsentAt: new Date(start + 7000).toISOString(),
        reopenedAt: new Date(start + 9000).toISOString(),
        limitation: restartLimitation,
      },
      {
        beforeLoss: storage(3),
        loss: {
          owned: storage(3).cacheNames.sort(),
          deleted: storage(3).cacheNames.sort(),
          idb: { outcome: "deleted" },
        },
        refusals: {
          immutable: { outcome: "error", name: "TypeError", marker: "Failed to fetch" },
          navigation: {
            outcome: "error",
            name: "ChromeNavigationError",
            marker: "chrome-error://chromewebdata/",
          },
        },
        afterLoss: {
          records: [],
          cacheNames: [],
          cached: [],
          registrations: [{ scope: origin + "/", active: "activated" }],
        },
        limitation: storageLossLimitation,
      },
    ],
    cleanup: {
      browserClosed: true,
      browserSessionAbsent: true,
      servicesClosed: true,
      listenerConnectionRefused: true,
      ownedDirectoryRemoved: true,
      fixtureExitCode: 0,
      fixtureSignalCode: null,
    },
    fixtureDiagnostics: { stdout: "Fixture: services-closed\n", stderr: "" },
  };
  report.stages.forEach((item, index) => {
    item.stage = stages[index];
  });
  return {
    report: structuredClone(report),
    summary: structuredClone({ builds: fixtureFields }),
    builds: structuredClone(builds),
  };
}

test("accepts complete synthetic contract and genuine SIGINT shutdown variant", () => {
  const { report, summary, builds } = synthetic();
  assert.equal(verifyReport(report, summary, builds).status, "passed");
  report.cleanup.fixtureExitCode = null;
  report.cleanup.fixtureSignalCode = "SIGINT";
  assert.equal(verifyReport(report, summary, builds).status, "passed");
});

test("rejects missing/mixed stages, fixture identities, failed and skipped evidence", () => {
  for (const mutate of [
    (r) => r.stages.pop(),
    (r) => r.stages.reverse(),
    (r) => {
      r.fixtures[0].generation = "bad";
    },
    (r) => {
      r.status = "failed";
    },
    (r) => {
      r.stages[3].skipped = true;
    },
    (r) => {
      r.error = "failure";
    },
    (r) => {
      r.browser = "simulated";
    },
  ]) {
    const { report, summary, builds } = synthetic();
    mutate(report);
    assert.throws(() => verifyReport(report, summary, builds));
  }
});

test("rejects implicit old-client reload, wrong entries, controller and chronology", () => {
  for (const mutate of [
    (r) => {
      r.stages[2].previousTabs[0].timeOrigin += 1;
    },
    (r) => {
      r.stages[3].visits[0].nativeView.entries = r.stages[2].approved.entries;
    },
    (r) => {
      r.stages[4].initial.controller = "http://example.org/sw.js";
    },
    (r) => {
      r.finished = r.started;
    },
  ]) {
    const { report, summary, builds } = synthetic();
    mutate(report);
    assert.throws(() => verifyReport(report, summary, builds));
  }
});

test("rejects partial/orphan caches, extra G4, wrong cached bytes and registration", () => {
  for (const mutate of [
    (r) => {
      r.stages[8].storage.records[0].status = "partial";
    },
    (r) => r.stages[8].storage.cacheNames.push("orphan"),
    (r) => r.stages[6].storage.records.push({ status: "ready" }),
    (r) => {
      r.stages[8].storage.cached[0].assets[0].sha256 = "bad";
    },
    (r) => {
      r.stages[8].storage.records[0].inventory.assets[0].sha256 = "bad";
    },
    (r) => {
      r.stages[6].storage.registrations[0].waiting = "installed";
    },
  ]) {
    const { report, summary, builds } = synthetic();
    mutate(report);
    assert.throws(() => verifyReport(report, summary, builds));
  }
});

test("rejects already-mounted, missing native heading, wrong chunk and HTTP-cache-only probe", () => {
  for (const mutate of [
    (r) => {
      r.stages[3].visits[0].initiallyMounted = true;
    },
    (r) => {
      r.stages[3].visits[0].nativeView.headings = [];
    },
    (r) => {
      r.stages[3].visits[0].chunkUrl = "/api/runs";
    },
    (r) => {
      r.stages[3].visits[0].retainedWorkerProbe.resources[0].workerStart = 0;
    },
    (r) => {
      r.stages[3].visits[0].retainedWorkerProbe.resources[0].url = "/different.js";
    },
    (r) => {
      r.stages[3].visits[0].retainedWorkerProbe.daemonStatus = 200;
    },
    (r) => {
      r.stages[3].visits[0].retainedWorkerProbe.size += 1;
    },
    (r) => {
      r.stages[3].limitation = "The native lazy module traversed the worker";
    },
  ]) {
    const { report, summary, builds } = synthetic();
    mutate(report);
    assert.throws(() => verifyReport(report, summary, builds));
  }
});

test("rejects absent refusal and incomplete or abnormal cleanup", () => {
  for (const mutate of [
    (r) => {
      r.stages[6].refusal.text = "";
    },
    (r) => {
      r.cleanup.servicesClosed = false;
    },
    (r) => {
      r.cleanup.fixtureExitCode = 1;
    },
    (r) => {
      r.cleanup.fixtureExitCode = null;
      r.cleanup.fixtureSignalCode = "SIGKILL";
    },
    (r) => {
      r.cleanup.retainedOwnedDirectory = "/private/tmp/private";
    },
    (r) => {
      r.fixtureDiagnostics.stdout = "";
    },
  ]) {
    const { report, summary, builds } = synthetic();
    mutate(report);
    assert.throws(() => verifyReport(report, summary, builds));
  }
});

test("rejects missing or weakened restart durability evidence", () => {
  for (const mutate of [
    (r) => (r.stages[9].profileReused = false),
    (r) => (r.stages[9].sessionAbsent = false),
    (r) => r.stages[9].restartProbes.pop(),
    (r) => (r.stages[9].storage.cached[0].assets[0].sha256 = "bad"),
    (r) => (r.stages[9].limitation = "restart proves legacy transition and concurrency"),
    (r) => (r.cleanup.browserSessionAbsent = false),
  ]) {
    const { report, summary, builds } = synthetic();
    mutate(report);
    assert.throws(() => verifyReport(report, summary, builds));
  }
});

test("rejects weakened owned storage loss and network fallback evidence", () => {
  for (const mutate of [
    (r) => r.stages[10].loss.owned.push("foreign-cache"),
    (r) => r.stages[10].loss.deleted.pop(),
    (r) => (r.stages[10].loss.idb.outcome = "unattempted"),
    (r) => (r.stages[10].loss.idb.outcome = "blocked"),
    (r) => (r.stages[10].afterLoss.records = [r.stages[10].beforeLoss.records[0]]),
    (r) => (r.stages[10].refusals.navigation.marker = "Failed to fetch"),
    (r) => (r.stages[10].refusals.immutable = { outcome: "response", status: 404 }),
    (r) => (r.stages[10].refusals.navigation = { outcome: "response", status: 200 }),
    (r) => (r.stages[10].refusals.navigation.marker = undefined),
    (r) => r.stages[10].afterLoss.registrations.pop(),
    (r) => r.stages[10].afterLoss.cacheNames.push(r.stages[10].loss.owned[0]),
    (r) => (r.stages[10].limitation = "Storage loss proves automatic recovery"),
  ]) {
    const { report, summary, builds } = synthetic();
    mutate(report);
    assert.throws(() => verifyReport(report, summary, builds));
  }
});

test("bounded read rejects links, directories, empty and oversized input before reading", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "retained-guard-test-")));
  try {
    const file = join(directory, "report.json");
    await writeFile(file, "{}");
    assert.equal((await boundedFile(file)).toString(), "{}");
    const link = join(directory, "link");
    await symlink(file, link);
    await assert.rejects(boundedFile(link));
    await assert.rejects(boundedFile(directory));
    await writeFile(file, "");
    await assert.rejects(boundedFile(file));
    assert.equal((await boundedFile(file, 4, true)).length, 0);
    await writeFile(file, "12345");
    await assert.rejects(boundedFile(file, 4));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("full current source binding rejects unsafe paths, stale Vue and added source files", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "retained-source-test-")));
  try {
    const paths = [
      "web/workstation/app.vue",
      "web/app/pages/~offline.vue",
      "web/public/images/bg2@0,5x.jpg",
      "tools/vendor_web_assets.py",
      "src/wavedl/__init__.py",
    ];
    const before = {};
    for (const path of paths) {
      await mkdir(join(directory, path, ".."), { recursive: true });
      await writeFile(join(directory, path), "ordinary-source");
      before[path] = createHash("sha256").update("ordinary-source").digest("hex");
    }
    await verifySourceSnapshot(before, directory);
    await assert.rejects(
      verifySourceSnapshot({ ...before, "web/../secret": before[paths[0]] }, directory),
      /Unsafe/,
    );
    await assert.rejects(
      verifySourceSnapshot({ ...before, "web/node_modules/secret": before[paths[0]] }, directory),
      /Unsafe/,
    );
    await writeFile(join(directory, paths[0]), "changed-vue");
    await assert.rejects(verifySourceSnapshot(before, directory), /Current source differs/);
    await writeFile(join(directory, paths[0]), "ordinary-source");
    await writeFile(join(directory, "web/added.ts"), "new-source");
    await assert.rejects(verifySourceSnapshot(before, directory), /inventory differs/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
