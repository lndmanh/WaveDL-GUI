#!/usr/bin/env node
// Four REAL generated builds, one daemon origin and one owned native browser.
// Browser eval is observational only: no SDK calls, state injection or writes.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createBrowserActions, DRIVER_READINESS_MODE } from "./browser_actions.mjs";
import { createActiveDraftProof, frozenAssetProof } from "./browser_retained_active_draft.mjs";

// Every invocation owns its POSIX process group. Neither argv nor unredacted
// process output is included in errors, and inherited pipes cannot stall close.
export function boundedCommand(
  binary,
  args,
  {
    cwd,
    env = process.env,
    timeout = 35000,
    termGrace = 500,
    reapTimeout = 3000,
    drainTimeout = 5000,
    stdoutLimit = 8 * 1024 * 1024,
    redact = () => "[suppressed]",
  } = {},
) {
  return new Promise((done, fail) => {
    const grouped = process.platform !== "win32";
    const child = spawn(binary, args, {
      cwd,
      env,
      detached: grouped,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timers = new Set();
    let stdout = "",
      stdoutBytes = 0,
      stderr = "",
      stopped,
      exited = false,
      settled = false;
    const later = (callback, ms) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        callback();
      }, ms);
      timers.add(timer);
      return timer;
    };
    const signal = (kind) => {
      try {
        if (grouped && child.pid) process.kill(-child.pid, kind);
        else child.kill(kind);
      } catch (error) {
        if (error.code !== "ESRCH") stopped ??= "owned process signal failed";
      }
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      if (error) fail(error);
      else done(value);
    };
    let stderrSuppressed = false;
    const failure = (reason) => {
      const error = new Error(`Owned command failed (${reason}): ${stderrSuppressed ? "[suppressed]" : String(redact(stderr)).slice(-1000)}`);
      error.stdout = redact(stdout).slice(-20000);
      return error;
    };
    const stop = (reason) => {
      if (stopped || settled) return;
      stopped = reason;
      signal("SIGTERM");
      later(() => signal("SIGKILL"), termGrace);
      later(() => {
        // A missing exit notification is never called successful cleanup.
        if (exited) {
          child.stdout.destroy();
          child.stderr.destroy();
        } else {
          child.unref();
          child.stdout.unref?.();
          child.stderr.unref?.();
        }
        finish(failure(`${stopped}; reaped=${exited}`));
      }, termGrace + reapTimeout);
    };
    later(() => stop("timeout"), timeout);
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > stdoutLimit) {
        stop("stdout limit");
        return;
      }
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (stderrSuppressed) return;
      if (Buffer.byteLength(stderr) + chunk.length > 65536) {
        // Never truncate a credential into a fragment before redaction.
        stderr = "";
        stderrSuppressed = true;
      } else stderr += chunk;
    });
    child.on("error", () => finish(failure("spawn error")));
    child.on("exit", () => {
      exited = true;
      // exit reaps the direct child; close additionally requires pipe EOF.
      later(() => {
        stop("inherited stdio remained open after child exit");
        later(() => {
          signal("SIGKILL");
          child.stdout.destroy();
          child.stderr.destroy();
          finish(failure(stopped));
        }, termGrace);
      }, drainTimeout);
    });
    child.on("close", (code, terminalSignal) => {
      // The leader can exit on TERM before a descendant does. Do not cancel
      // escalation merely because the leader and its pipes have finished.
      if (stopped) signal("SIGKILL");
      if (stopped || code !== 0 || terminalSignal)
        finish(failure(stopped ?? `exit=${code}, signal=${terminalSignal}`));
      else finish(null, stdout.trim());
    });
  });
}

async function main() {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const option = (name) =>
    process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const fixturesArg = option("fixtures");
  const activeDraft = process.argv.includes("--active-draft");
  assert(
    fixturesArg && fixturesArg.startsWith("/"),
    "Supply --fixtures=/absolute/path/to/summary.json",
  );
  const summaryPath = resolve(
    fixturesArg.endsWith(".json") ? fixturesArg : join(fixturesArg, "summary.json"),
  );
  const reportPath = resolve(
    option("report") ?? join(tmpdir(), `wavedl-retained-browser-report-${randomUUID()}.json`),
  );
  await assert.rejects(access(reportPath), "Report destination must not already exist");
  const python = process.env.WAVEDL_PYTHON ?? "python";
  const browser = process.env.AGENT_BROWSER_BIN ?? "agent-browser";
  const executable = process.env.WAVEDL_BROWSER_EXECUTABLE;
  if (executable) await access(executable);
  const secrets = new Set();
  const redact = (value) => {
    if (typeof value === "string") {
      for (const secret of secrets) value = value.split(secret).join("[REDACTED]");
      return value.replace(/([?&]bootstrap=)[^\s"&#]+/g, "$1[REDACTED]");
    }
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [redact(key), redact(item)]),
      );
    return value;
  };
  const report = {
    status: "running",
    started: new Date().toISOString(),
    driverReadinessMode: DRIVER_READINESS_MODE,
    fixtureSummary: summaryPath,
    stages: [],
    cleanup: {},
  };
  const delay = (ms) => new Promise((done) => setTimeout(done, ms));
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  async function command(binary, args, timeout = 35000) {
    if (activeDraft && timeout === 35000) timeout = 90000;
    const env = { ...process.env };
    if (binary === browser) {
      for (const key of Object.keys(env)) if (key.startsWith("AGENT_BROWSER_")) delete env[key];
      const index = args.indexOf("--session");
      if (index !== -1) env.AGENT_BROWSER_SESSION = args[index + 1];
    }
    try { return await boundedCommand(binary, args, { cwd: repo, env, timeout }); }
    catch (error) {
      if (binary === browser) {
        const operation = args.find(arg => ["open", "close", "tab", "eval", "snapshot", "session", "wait", "find", "click", "fill", "console", "errors"].includes(arg));
        error.message = `Native ${operation ?? "command"} during ${report.currentStep ?? "retained acceptance"}: ${error.message}`;
      }
      throw error;
    }
  }
  async function poll(observe, accept, description, timeout = 60000) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      last = await observe(Math.max(1, Math.min(35000, deadline - Date.now())));
      if (accept(last)) return last;
      await delay(Math.min(200, Math.max(0, deadline - Date.now())));
    }
    throw new Error(
      `${description} timed out; last observation: ${JSON.stringify(redact(last)).slice(0, 1500)}`,
    );
  }
  async function validateFixtures() {
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    assert.equal(summary.builds.length, 4, "Exactly four builds required");
    assert.equal(new Set(summary.builds.map((build) => build.generation)).size, 4);
    for (const [index, build] of summary.builds.entries()) {
      assert.equal(build.namespace, `g${index + 1}`);
      build.assetsDir = await realpath(build.assetsDir);
      const bytes = await readFile(join(build.assetsDir, "offline-build.json"));
      assert.equal(digest(bytes), build.offlineInventorySha256);
      assert.equal(digest(await readFile(join(build.assetsDir, "sw.js"))), build.workerSha256);
      build.inventory = JSON.parse(bytes);
      assert.equal(build.inventory.generation, build.generation);
      assert.equal(build.inventory.build_key, build.buildKey);
      assert.equal(build.inventory.assets.length, build.assetCount);
      for (const asset of build.inventory.assets) {
        assert(
          /^\/[A-Za-z0-9_./@+-]*$/.test(asset.url) && !asset.url.split("/").includes(".."),
          "Canonical static inventory URL",
        );
        const path = join(build.assetsDir, asset.url === "/" ? "index.html" : asset.url.slice(1));
        assert(
          (await realpath(path)).startsWith(`${build.assetsDir}${sep}`),
          "Asset must remain inside supplied fixture",
        );
        const content = await readFile(path);
        assert.equal(content.length, asset.size, asset.url);
        assert.equal(digest(content), asset.sha256, asset.url);
      }
    }
    report.fixtures = summary.builds.map(
      ({ namespace, generation, buildKey, offlineInventorySha256, workerSha256 }) => ({
        namespace,
        generation,
        buildKey,
        offlineInventorySha256,
        workerSha256,
      }),
    );
    return summary.builds;
  }

  let owned,
    ownedIdentity,
    fixture,
    fixtureOutput = "",
    fixtureError = "",
    browserOpened = false;
  let cli, dom, snapshot, origin;
  const session = `wrb-${randomUUID().slice(0, 12)}`;
  const tabs = [];
  const storageExpression = `(async () => JSON.stringify(await (async () => {
  const names = await caches.keys();
  const databases = await indexedDB.databases();
  const records = databases.some(db => db.name === 'wavedl-retained-builds-v1') ? await new Promise((resolve, reject) => {
    const request = indexedDB.open('wavedl-retained-builds-v1');
    request.onerror = () => reject(new Error('Read-only retained database unavailable'));
    request.onsuccess = () => { const db = request.result; const transaction = db.transaction('builds', 'readonly');
      const read = transaction.objectStore('builds').getAll(); read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(new Error('Retained record read failed')); transaction.oncomplete = () => db.close(); };
  }) : [];
  const cached = [];
  for (const name of names.filter(name => name.startsWith('wavedl-retained-v1-'))) {
    const cache = await caches.open(name); const keys = await cache.keys(); const assets = [];
    for (const key of keys) { const response = await cache.match(key); const bytes = await response.arrayBuffer();
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(v => v.toString(16).padStart(2, '0')).join('');
      assets.push({ url: new URL(key.url).pathname, sha256, size: bytes.byteLength }); }
    cached.push({ name, assets });
  }
  const registrations = await navigator.serviceWorker.getRegistrations();
  return { records, cached, cacheNames: names, registrations: registrations.map(r => ({scope:r.scope,active:r.active?.state,waiting:r.waiting?.state,installing:r.installing?.state})) };
})()))()`;
  const pageExpression = `JSON.stringify({url:location.href,timeOrigin:performance.timeOrigin,controller:navigator.serviceWorker.controller?.scriptURL,entries:Array.from(document.querySelectorAll('script[src]')).map(s=>new URL(s.src).pathname),resources:performance.getEntriesByType('resource').map(r=>({url:new URL(r.name).pathname,initiator:r.initiatorType,startTime:r.startTime,workerStart:r.workerStart,responseStatus:r.responseStatus,deliveryType:r.deliveryType,transferSize:r.transferSize})),hints:Array.from(document.querySelectorAll('link[rel="prefetch"],link[rel="modulepreload"]')).map(e=>({url:new URL(e.href).pathname,rel:e.rel})),headings:Array.from(document.querySelectorAll('h1,h2')).filter(e=>e.getClientRects().length).map(e=>e.textContent.trim()),text:document.body.innerText})`;
  async function switchTab(tab) {
    await cli("tab", String(tab.id));
  }
  async function tabListing() {
    const output = JSON.parse(await cli("tab", "--json"));
    const data = output.data ?? output;
    const result = Array.isArray(data) ? data : data.tabs;
    assert(Array.isArray(result), `Unrecognized native tab listing: ${JSON.stringify(output)}`);
    return result.map((tab) => ({ ...tab, id: tab.id ?? tab.tabId ?? tab.index }));
  }
  async function newTab(url) {
    const before = await tabListing();
    await cli("tab", "new", url);
    const after = await tabListing();
    const added = after.filter((tab) => !before.some((old) => old.id === tab.id));
    assert.equal(added.length, 1, "One owned tab created");
    tabs.push(added[0]);
    return added[0];
  }
  async function page() {
    return dom(pageExpression);
  }
  async function closeOwnedBrowser() {
    await cli("close");
    await poll(
      async (timeout) => !(await command(browser, ["session", "list"], timeout)).includes(session),
      Boolean,
      "Owned browser session absent after close",
      15000,
    );
  }
  async function unchanged(tab, before) {
    await switchTab(tab);
    const after = await page();
    assert.equal(after.timeOrigin, before.timeOrigin, "Other tab must not reload");
    assert.equal(after.url, before.url, "Other tab URL remains stable");
    assert.deepEqual(after.entries, before.entries, "Other tab entry script remains stable");
    return after;
  }
  async function swap(build) {
    const next = join(owned, `${build.namespace}-incoming`);
    await cp(build.assetsDir, next, { recursive: true, errorOnExist: true, force: false });
    await rename(join(owned, "assets"), join(owned, `${build.namespace}-previous`));
    await rename(next, join(owned, "assets"));
    const response = await fetch(`${origin}/offline-build.json`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    assert.equal(
      (await response.json()).generation,
      build.generation,
      "Daemon serves swapped fixture",
    );
  }
  function verifyStorage(value, builds) {
    assert.equal(value.records.length, builds.length);
    assert(
      value.records.every((record) => record.status === "ready"),
      "Only complete ready generations retained",
    );
    assert.deepEqual(
      value.cacheNames.filter((name) => name.startsWith("wavedl-retained-v1-")).sort(),
      value.records.map((record) => record.cacheName).sort(),
      "Owned retained cache set exactly matches ready records; no orphan/partial generation caches",
    );
    for (const build of builds) {
      const record = value.records.find(
        (record) => record.inventory.generation === build.generation,
      );
      assert(record, `Generation ${build.namespace} retained`);
      const cache = value.cached.find((cache) => cache.name === record.cacheName);
      assert(cache, "Retained cache exists");
      assert.deepEqual(
        cache.assets.map((asset) => asset.url).sort(),
        build.inventory.assets.map((asset) => asset.url).sort(),
        "Cache asset set exactly matches inventory; no missing/extra assets",
      );
      for (const asset of build.inventory.assets) {
        const cached = cache.assets.find((item) => item.url === asset.url);
        assert(
          cached && cached.sha256 === asset.sha256 && cached.size === asset.size,
          `Real retained bytes: ${asset.url}`,
        );
      }
    }
  }

  // The HTML prefetches lazy chunks. Native view success therefore does not prove
  // that the later module-loader request traversed the worker. Separately probe
  // the REAL corresponding lazy chunk through an HTTP-cache-bypassing GET and
  // observe ResourceTiming.workerStart; no application state or worker mutation.
  const lazyViews = {
    project: {
      label: "New training run",
      selector: "#project-title",
      chunkMarker: "project-title",
    },
    settings: {
      label: "Settings",
      selector: "#downloads-heading",
      chunkMarker: "downloads-heading",
    },
    results: { label: "Results", selector: "#results-title", chunkMarker: "results-title" },
  };
  async function workspaceChunk(build, view) {
    const candidates =
      build.dynamicImports?.map((item) => item.resolved) ??
      build.inventory.assets
        .filter((asset) => asset.immutable && asset.url.endsWith(".js"))
        .map((asset) => asset.url);
    const matched = [];
    for (const url of new Set(candidates)) {
      const asset = build.inventory.assets.find((asset) => asset.url === url && asset.immutable);
      assert(asset, "Declared lazy chunk must belong to validated inventory");
      const content = await readFile(join(build.assetsDir, url.slice(1)), "utf8");
      if (content.includes(view.chunkMarker)) matched.push(asset);
    }
    assert.equal(
      matched.length,
      1,
      `Exactly one genuine ${view.label} workspace chunk identified by public DOM marker`,
    );
    return matched[0];
  }
  async function retainedProbe(build, asset) {
    const external = await fetch(`${origin}${asset.url}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(external.status, 404, "Old workspace URL absent from daemon network");
    const expression = `(async () => {
    const url = new URL(${JSON.stringify(asset.url)}, location.origin).href;
    const before = performance.getEntriesByName(url, 'resource').length;
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const bytes = await response.arrayBuffer();
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(v => v.toString(16).padStart(2, '0')).join('');
    const resources = performance.getEntriesByName(url, 'resource').slice(before).map(r => ({url:new URL(r.name).pathname,initiator:r.initiatorType,startTime:r.startTime,workerStart:r.workerStart,responseStatus:r.responseStatus,deliveryType:r.deliveryType,transferSize:r.transferSize}));
    return JSON.stringify({status:response.status,sha256,size:bytes.byteLength,controller:navigator.serviceWorker.controller?.scriptURL,resources});
  })()`;
    const observed = await dom(expression, 25000);
    assert.equal(observed.status, 200, "Public old static GET succeeds");
    assert.equal(observed.sha256, asset.sha256, "Worker probe returns exact inventoried bytes");
    assert.equal(observed.size, asset.size);
    assert.equal(
      observed.controller,
      `${origin}/sw.js`,
      "Probe tab controlled by public Workstation worker",
    );
    assert(
      observed.resources.some(
        (resource) => resource.initiator === "fetch" && resource.workerStart > 0,
      ),
      "Real old static GET traversed Service Worker (not just HTTP cache)",
    );
    const storage = await dom(storageExpression);
    const record = storage.records.find(
      (record) => record.inventory.generation === build.generation && record.status === "ready",
    );
    const cached = storage.cached
      .find((cache) => cache.name === record?.cacheName)
      ?.assets.find((item) => item.url === asset.url);
    assert(
      cached && cached.sha256 === observed.sha256 && cached.size === observed.size,
      "Response matches retained generation cache bytes",
    );
    return {
      url: asset.url,
      generation: build.generation,
      daemonStatus: external.status,
      cacheSha256: cached.sha256,
      ...observed,
    };
  }
  async function lateViews(tab, baseline, build, names, actions) {
    await unchanged(tab, baseline);
    const initial = await page();
    const visits = [];
    for (const name of names) {
      const view = lazyViews[name];
      // The controller creates these async views only on first navigation. An
      // absent DOM marker, not a lack of prefetched bytes, proves unvisited UI.
      assert.equal(
        await dom(
          `JSON.stringify(document.querySelectorAll(${JSON.stringify(view.selector)}).length)`,
        ),
        0,
        `${build.namespace} ${view.label} has not previously mounted`,
      );
      const chunk = await workspaceChunk(build, view);
      const before = await page();
      await actions.button(view.label, false, { scope: '//nav[@aria-label="Sections"]' });
      await poll(
        (timeout) =>
          dom(
            `JSON.stringify(Array.from(document.querySelectorAll(${JSON.stringify(view.selector)})).some(e => e.getClientRects().length))`,
            timeout,
          ),
        Boolean,
        `${build.namespace} native ${view.label} view`,
        30000,
      );
      const observed = await unchanged(tab, baseline);
      assert(observed.headings.length, "Native lazy view renders exposed real heading");
      const probe = await retainedProbe(build, chunk);
      visits.push({
        label: view.label,
        initiallyMounted: false,
        chunkUrl: chunk.url,
        prefetchedBeforeVisit: before.resources.filter((resource) => resource.url === chunk.url),
        resourcesAddedDuringNativeVisit: observed.resources.slice(before.resources.length),
        nativeView: observed,
        retainedWorkerProbe: probe,
        snapshot: await snapshot(),
      });
    }
    return {
      initial,
      visits,
      limitation:
        "Native unvisited workspace rendering and a separate real no-store static GET through the retained worker are proven. HTML prefetch/module caching means the actual lazy module-loader request is not claimed to have traversed the worker.",
    };
  }

  try {
    const builds = await validateFixtures();
    owned = await mkdtemp(join(tmpdir(), "wavedl-retained-native-"));
    ownedIdentity = await lstat(owned);
    const root = join(owned, "daemon-root"),
      profile = join(owned, "browser-profile");
    await mkdir(root, { mode: 0o700 });
    await mkdir(profile, { mode: 0o700 });
    assert.equal((await readdir(root)).length, 0);
    assert.equal((await readdir(profile)).length, 0);
    const token = randomBytes(32).toString("base64url");
    secrets.add(token);
    const tokenFile = join(owned, "private-bearer");
    await writeFile(tokenFile, token, { flag: "wx", mode: 0o600 });
    await cp(builds[0].assetsDir, join(owned, "assets"), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    report.browser = await command(browser, ["--version"]);
    report.browserSession = session;
    cli = (...args) =>
      command(browser, [
        "--session",
        session,
        ...(args[0] === "open"
          ? [
              "--headed",
              "false",
              "--engine",
              "chrome",
              "--profile",
              profile,
              ...(executable ? ["--executable-path", executable] : []),
              "--args",
              "--disable-gpu",
            ]
          : []),
        ...args,
      ]);
    dom = async (expression, timeout = 35000) => {
      const raw = await command(
        browser,
        ["--session", session, "eval", "-b", Buffer.from(expression).toString("base64")],
        timeout,
      );
      return JSON.parse(JSON.parse(raw));
    };
    snapshot = () => cli("snapshot", "-i");
    fixture = spawn(
      python,
      [
        "tools/browser_daemon_fixture.py",
        "--root",
        root,
        "--token-file",
        tokenFile,
        "--web-assets",
        join(owned, "assets"),
        ...(activeDraft ? ["--epochs", "10000", "--request-metadata", "--record-process-results"] : ["--unseeded"]),
      ],
      {
        cwd: repo,
        env: { ...process.env, PYTHONPATH: join(repo, "src") },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    fixture.stdout.on("data", (chunk) => {
      fixtureOutput += chunk;
    });
    fixture.stderr.on("data", (chunk) => {
      fixtureError = (fixtureError + chunk).slice(-65536);
    });
    fixture.on("error", (error) => {
      fixtureError += error.message;
    });
    const bootstrap = await poll(
      async () => {
        const match = fixtureOutput.match(/Browser(?: URL)?:\s*(http:\/\/[^\s]+)/);
        if (fixture.exitCode !== null) throw new Error(`Fixture exited: ${redact(fixtureError)}`);
        return match?.[1];
      },
      Boolean,
      "Private fixture bootstrap",
      60000,
    );
    secrets.add(bootstrap);
    secrets.add(new URL(bootstrap).searchParams.get("bootstrap"));
    origin = new URL(bootstrap).origin;
    browserOpened = true;
    await cli("open", bootstrap);
    tabs.push((await tabListing()).find((tab) => tab.active) ?? (await tabListing())[0]);
    await cli("wait", "--fn", `!!document.querySelector('nav[aria-label="Sections"]')`);
    const first = await page();
    assert(
      first.entries.some((url) => builds[0].entryUrls.includes(url)),
      "Real g1 entry loaded",
    );
    const initialStorage = await poll(
      (timeout) => dom(storageExpression, timeout),
      (value) => value.records.length === 1 && value.records[0].status === "ready",
      "g1 installation",
    );
    verifyStorage(initialStorage, builds.slice(0, 1));
    report.stages.push({
      stage: "g1",
      page: first,
      storage: initialStorage,
      snapshot: await snapshot(),
    });
    const observations = [first];
    const actions = createBrowserActions({ cli, dom, snapshot });
    const activeProof = activeDraft ? createActiveDraftProof({ cli, dom, actions, command, python, root, report, fixtureOutput: () => fixtureOutput, page, switchTab, tab: tabs[0], poll }) : null;
    if (activeProof) {
      report.activeDraft.frozenAssetsBefore = await frozenAssetProof(command, python);
      await activeProof.prepare();
    }
    for (let index = 1; index <= 2; index++) {
      await swap(builds[index]);
      const approver = await newTab(`${origin}/`);
      await cli(
        "wait",
        "--fn",
        `document.body.innerText.includes('A workstation update is available')`,
      );
      const beforeApproval = await page();
      if (activeProof && index === 1) {
        await activeProof.defer();
        await switchTab(approver);
      }
      await actions.button("Update and reload");
      const approved = await poll(
        (timeout) => dom(pageExpression, timeout),
        (value) => value.entries.some((url) => builds[index].entryUrls.includes(url)),
        `${builds[index].namespace} approving tab reload`,
      );
      assert.notEqual(
        approved.timeOrigin,
        beforeApproval.timeOrigin,
        "Approving tab genuinely reloaded",
      );
      observations.push(approved);
      if (activeProof && index === 1) await activeProof.afterApproval(approved);
      const stored = await poll(
        (timeout) => dom(storageExpression, timeout),
        (value) =>
          value.records.length === index + 1 &&
          value.records.every((record) => record.status === "ready"),
        `${builds[index].namespace} ready storage`,
      );
      verifyStorage(stored, builds.slice(0, index + 1));
      const old = [];
      for (let previous = 0; previous < index; previous++)
        old.push(await unchanged(tabs[previous], observations[previous]));
      report.stages.push({
        stage: builds[index].namespace,
        approvingTab: approver.id,
        approved,
        previousTabs: old,
        storage: stored,
      });
    }
    report.stages.push({
      stage: "old-g1-lazy-views",
      ...(await lateViews(
        tabs[0],
        observations[0],
        builds[0],
        activeDraft ? ["settings", "results"] : ["project", "settings", "results"],
        actions,
      )),
    });
    report.stages.push({
      stage: "old-g2-unvisited-view",
      ...(await lateViews(tabs[1], observations[1], builds[1], ["settings"], actions)),
    });
    const lazyStorage = await dom(storageExpression);
    verifyStorage(lazyStorage, builds.slice(0, 3));
    report.stages.push({ stage: "retained-storage-after-native-lazy-views", storage: lazyStorage });
    await swap(builds[3]);
    await newTab(`${origin}/`); // Normal app registration, never registration.update().
    const refusal = await poll(
      (timeout) => dom(pageExpression, timeout),
      (value) => value.text.includes("Update blocked by retained offline builds."),
      "Public capacity refusal",
    );
    const finalStorage = await dom(storageExpression);
    verifyStorage(finalStorage, builds.slice(0, 3));
    assert(
      !finalStorage.records.some((record) => record.inventory.generation === builds[3].generation),
    );
    const oldTabs = [];
    for (let index = 0; index < 3; index++)
      oldTabs.push(await unchanged(tabs[index], observations[index]));
    report.stages.push({
      stage: "g4-capacity-refusal",
      refusal,
      storage: finalStorage,
      previousTabs: oldTabs,
    });
    report.stages.push({
      stage: "old-g3-unvisited-view-after-refusal",
      ...(await lateViews(tabs[2], observations[2], builds[2], ["settings"], actions)),
    });
    const afterRefusalStorage = await dom(storageExpression);
    verifyStorage(afterRefusalStorage, builds.slice(0, 3));
    assert(
      !afterRefusalStorage.records.some(
        (record) => record.inventory.generation === builds[3].generation,
      ),
    );
    report.stages.push({ stage: "final-retained-storage", storage: afterRefusalStorage });
    // Restart the owned Chrome session with the exact same private profile. This
    // is a real process/session boundary: no application state is injected and
    // the daemon remains on the refused G4 build. Re-open the route and prove
    // that all admitted generations (IDB records and CacheStorage bytes) still
    // serve through the retained worker.
    const profileBeforeRestart = await lstat(profile);
    const preRestartTabs = [];
    for (let index = 0; index < 3; index++)
      preRestartTabs.push(await unchanged(tabs[index], observations[index]));
    const closeStarted = new Date().toISOString();
    report.currentStep = "browser restart close";
    await closeOwnedBrowser();
    browserOpened = false;
    const sessionAbsentAt = new Date().toISOString();
    browserOpened = true; // An interrupted launch still requires bounded cleanup.
    report.currentStep = "browser restart open";
    await cli("open", `${origin}/`);
    const restartedTab = (await tabListing()).find((tab) => tab.active) ?? (await tabListing())[0];
    assert(restartedTab, "Restarted owned tab must exist");
    tabs.push(restartedTab);
    await cli("wait", "--fn", `!!document.querySelector('nav[aria-label="Sections"]')`);
    report.restartBoundary = await dom(`(async()=>JSON.stringify({timeOrigin:performance.timeOrigin,controller:navigator.serviceWorker.controller?.scriptURL,registrations:(await navigator.serviceWorker.getRegistrations()).map(r=>({scope:r.scope,active:r.active?.state,waiting:r.waiting?.state,installing:r.installing?.state})),text:document.body.innerText.slice(-3000)}))()`, 15000);
    report.currentStep = "restarted retained route poll";
    const restartedPage = await poll(
      (timeout) => dom(pageExpression, timeout),
      (value) =>
        value.controller === `${origin}/sw.js` &&
        value.url === `${origin}/` &&
        value.entries.some((url) => builds[2].entryUrls.includes(url)) &&
        value.text.includes("Update blocked by retained offline builds."),
      "Restarted retained route",
    );
    assert(
      restartedPage.text.includes("Update blocked by retained offline builds."),
      "Restarted route must preserve the capacity refusal",
    );
    report.currentStep = "restarted retained storage";
    const restartedStorage = await dom(storageExpression);
    verifyStorage(restartedStorage, builds.slice(0, 3));
    assert.deepEqual(
      restartedStorage.records,
      afterRefusalStorage.records,
      "Durable IDB records unchanged across restart",
    );
    assert.deepEqual(
      restartedStorage.cached,
      afterRefusalStorage.cached,
      "Durable cache bytes unchanged across restart",
    );
    assert(
      restartedPage.timeOrigin > Math.max(...observations.map((value) => value.timeOrigin)),
      "Restarted route is a new document, not an old live tab",
    );
    const restartProbes = [];
    for (const build of builds.slice(0, 3)) {
      const chunk = await workspaceChunk(build, lazyViews.settings);
      restartProbes.push(await retainedProbe(build, chunk));
    }
    const profileAfterRestart = await lstat(profile);
    assert(
      profileAfterRestart.isDirectory() &&
        profileAfterRestart.ino === profileBeforeRestart.ino &&
        profileAfterRestart.dev === profileBeforeRestart.dev,
      "Restart must reuse the original owned browser profile",
    );
    report.stages.push({
      stage: "browser-restart-durability",
      preRestartTabs,
      restartedPage,
      storage: restartedStorage,
      restartProbes,
      profileReused: true,
      sessionAbsent: true,
      closeStarted,
      sessionAbsentAt,
      reopenedAt: new Date().toISOString(),
      limitation:
        "Owned Chrome close/reopen durability only; previous documents were closed, not preserved or restored. No legacy transition, storage-loss recovery, or concurrency proof.",
    });
    // Exercise browser-owned storage loss from a live same-origin document.
    // Deliberately keep the registration and all documents alive: deleting the
    // retained resources must be observable as a hard worker refusal, never a
    // hidden unregister/recovery path or a network fallback.
    const beforeLoss = await dom(storageExpression);
    const lossExpression = `(async () => {
      const owned = (await caches.keys()).filter((name) => name.startsWith('wavedl-retained-v1-'));
      const deleted = [];
      for (const name of owned) if (await caches.delete(name)) deleted.push(name);
      const idb = await new Promise((resolve) => {
        let settled = false;
        const finish = (result) => { if (!settled) { settled = true; resolve(result); } };
        const request = indexedDB.deleteDatabase('wavedl-retained-builds-v1');
        request.onsuccess = () => finish({ outcome: 'deleted' });
        request.onerror = () => finish({ outcome: 'error', message: String(request.error?.message ?? request.error ?? 'unknown') });
        request.onblocked = () => finish({ outcome: 'blocked' });
        setTimeout(() => finish({ outcome: 'timeout' }), 1000);
      });
      return JSON.stringify({ owned, deleted, idb });
    })()`;
    const loss = await dom(lossExpression, 15000);
    assert.deepEqual(
      loss.owned.sort(),
      beforeLoss.cacheNames.filter((name) => name.startsWith("wavedl-retained-v1-")).sort(),
      "Storage-loss gate enumerated exactly the retained cache namespace",
    );
    assert.deepEqual(
      loss.deleted.sort(),
      loss.owned.sort(),
      "Every owned retained cache was deleted",
    );
    const oldAsset = await workspaceChunk(builds[0], lazyViews.settings);
    const refusalExpression = `(async () => {
      async function probe(path) {
        try {
          const response = await fetch(new URL(path, location.origin).href, { cache: 'no-store' });
          const body = await response.text();
          return { outcome: 'response', status: response.status, contentType: response.headers.get('Content-Type'), marker: body.slice(0, 96) };
        } catch (error) {
          return { outcome: 'error', name: error?.name ?? 'Error', marker: String(error?.message ?? error) };
        }
      }
      return JSON.stringify({ immutable: await probe(${JSON.stringify(oldAsset.url)}) });
    })()`;
    const refusals = await dom(refusalExpression, 15000);
    assert.equal(
      refusals.immutable.outcome,
      "error",
      "Lost immutable bytes must refuse, not network-fallback",
    );
    const afterLoss = await dom(storageExpression);
    await newTab(`${origin}/`);
    const navigation = await poll(
      (timeout) =>
        dom(
          "JSON.stringify({ documentURI: document.documentURI, controller: navigator.serviceWorker?.controller?.scriptURL ?? null })",
          timeout,
        ),
      (value) => value.documentURI === "chrome-error://chromewebdata/",
      "Native navigation refusal after retained storage loss",
      15000,
    );
    refusals.navigation = {
      outcome: "error",
      name: "ChromeNavigationError",
      marker: navigation.documentURI,
    };
    report.stages.push({
      stage: "browser-storage-loss-refusal",
      beforeLoss,
      loss,
      refusals,
      afterLoss,
      limitation:
        "Live same-origin owned cache/IDB loss only; registration remains active. No legacy transition, automatic recovery, or concurrent admission proof.",
    });
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.error = redact(error.stack ?? error.message);
    if (browserOpened) {
      try {
        report.failureSnapshot = await snapshot();
        report.failurePage = await page();
        report.failureStorage = await dom(storageExpression);
        report.failureConsole = await cli("console");
        report.failureErrors = await cli("errors");
      } catch (diagnosticError) {
        report.diagnosticError = redact(diagnosticError.message);
      }
    }
  } finally {
    if (browserOpened) {
      try {
        await closeOwnedBrowser();
        report.cleanup.browserClosed = true;
        report.cleanup.browserSessionAbsent = true;
      } catch (error) {
        report.cleanup.browserError = redact(error.message);
      }
    }
    if (fixture) {
      fixture.kill("SIGINT");
      try {
        await poll(
          async () => fixture.exitCode !== null || fixture.signalCode !== null,
          Boolean,
          "Owned fixture shutdown",
          15000,
        );
        assert(
          fixtureOutput.includes("Fixture: services-closed"),
          "Fixture service cleanup proof required",
        );
        report.cleanup.servicesClosed = true;
        report.cleanup.fixtureExitCode = fixture.exitCode;
        report.cleanup.fixtureSignalCode = fixture.signalCode;
        if (origin) {
          let refusal;
          try {
            await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(3000) });
          } catch (error) {
            refusal = error.cause?.code;
          }
          assert.equal(
            refusal,
            "ECONNREFUSED",
            "Closed fixture listener must refuse connection, not time out or answer health",
          );
          report.cleanup.listenerConnectionRefused = true;
        }
      } catch (error) {
        report.cleanup.fixtureError = redact(error.message);
        fixture.kill("SIGKILL");
        try {
          await poll(
            async () => fixture.exitCode !== null || fixture.signalCode !== null,
            Boolean,
            "Owned fixture forced shutdown",
            3000,
          );
          report.cleanup.fixtureForcedTerminal = true;
          report.cleanup.fixtureExitCode = fixture.exitCode;
          report.cleanup.fixtureSignalCode = fixture.signalCode;
        } catch (terminalError) {
          report.cleanup.fixtureTerminalError = redact(terminalError.message);
          fixture.unref();
          fixture.stdout.unref?.();
          fixture.stderr.unref?.();
        }
      }
    }
    report.fixtureDiagnostics = redact({ stdout: fixtureOutput, stderr: fixtureError });
    if (activeDraft && owned) {
      try { report.activeDraft.finalRequests = (await readFile(join(owned, "daemon-root/.request-metadata.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line)); }
      catch (error) { report.status = "failed"; report.activeDraftEvidenceError = redact(error.message); }
      try { report.activeDraft.frozenAssetsAfter = await frozenAssetProof(command, python); }
      catch (error) { report.status = "failed"; report.activeDraftAssetError = redact(error.message); }
    }
    if (
      owned &&
      report.cleanup.browserClosed &&
      report.cleanup.servicesClosed &&
      !report.cleanup.fixtureError
    ) {
      try {
        const current = await lstat(owned);
        assert(
          !current.isSymbolicLink() &&
            current.ino === ownedIdentity.ino &&
            current.dev === ownedIdentity.dev,
          "Cleanup must target original owned mkdtemp directory",
        );
        await rm(owned, { recursive: true, force: false });
        report.cleanup.ownedDirectoryRemoved = true;
      } catch (error) {
        report.cleanup.ownedDirectoryError = redact(error.message);
        report.cleanup.retainedOwnedDirectory = owned;
      }
    } else if (owned) report.cleanup.retainedOwnedDirectory = owned;
    if (
      report.cleanup.browserError ||
      report.cleanup.fixtureError ||
      report.cleanup.ownedDirectoryError
    )
      report.status = "failed";
    report.finished = new Date().toISOString();
    const serialized = JSON.stringify(redact(report), null, 2);
    assert(
      [...secrets].every((secret) => !secret || !serialized.includes(secret)),
      "Private report redaction self-check",
    );
    await writeFile(reportPath, serialized, { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ status: report.status, report: reportPath }));
    if (report.status !== "passed") process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
