import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Execute the runner's actual finally body with controlled ownership failures.
// No browser, credential, fixture, or acceptance evidence is fabricated.
const source = await readFile(new URL("./run_artifact_publication_browser_acceptance.mjs", import.meta.url), "utf8");
const body = source.slice(source.lastIndexOf("\n} finally {") + 12, source.lastIndexOf("\n}\nif (record.status"));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function cleanup(options = {}) {
  const record = { status: "passed", ...(options.record ?? {}) }, removed = [], signals = [], written = [];
  let clock = 0, unrefs = 0;
  const fixture = {
    pid: 42, exitCode: options.neverCloses ? null : 0, signalCode: null,
    kill: (s) => { signals.push(s); }, unref: () => { unrefs++; },
    stdout: { unref: () => { unrefs++; } }, stderr: { unref: () => { unrefs++; } },
  };
  const deps = {
    record, opened: false, boundedCommand: async () => "", browser: "browser",
    credentialSecret: "secret-token-text",
    session: "owned-session", repo: "/repo", fixture,
    fixturePipeClosed: !options.neverCloses,
    fixtureSpawnError: options.spawnError,
    stdoutExceeded: options.stdoutExceeded,
    stdout: options.stdout ?? "Fixture: services-closed",
    origin: undefined, root: "/owned/fixture", profile: "/owned/profile",
    tokenFile: "/owned/token", downloads: "/owned/downloads",
    evidencePath: "/owned/boundary", arm: "/owned/arm", reportRoot: "/owned",
    rm: async (p) => {
      removed.push(p);
      if (p === options.removeFailure) throw new Error("private argv must not appear");
    },
    access: async (p) => {
      if (!removed.includes(p) || p === options.removeFailure) return;
      throw Object.assign(new Error("absent"), { code: "ENOENT" });
    },
    assert, Date: { now: () => clock },
    setTimeout: (cb, ms) => { clock += ms; queueMicrotask(cb); },
    process: { platform: "darwin", kill: (_, s) => { signals.push(s); } },
    fetch: async () => {}, AbortSignal,
    writeFile: async (_, text, opts) => { assert.equal(opts.flag, "wx"); written.push(JSON.parse(text)); },
    join: (...parts) => parts.join("/"), console: { log: () => {} },
  };
  await new AsyncFunction(...Object.keys(deps), body)(...Object.values(deps));
  return { record, removed, signals, written, unrefs };
}

test("verified shutdown removes owned paths and emits passing report", async () => {
  const r = await cleanup();
  assert.equal(r.record.status, "passed");
  assert.equal(r.record.cleanup.removedOwnedRoots, true);
  assert.equal(r.removed.length, 6);
  assert.equal(r.written.length, 1);
  assert.deepEqual(r.signals, [], "Already reaped fixture must not be signalled");
});

test("report suppresses known private token and query bootstrap credentials", async () => {
  const r = await cleanup({ record: { error: "secret-token-text http://owned/?bootstrap=secret-token-text", extra: "bootstrap=other-secret" } });
  const emitted = JSON.stringify(r.written);
  assert(!emitted.includes("secret-token-text"));
  assert(!emitted.includes("other-secret"));
  assert(emitted.includes("[REDACTED]"));
});

test("one owned removal failure cannot skip remaining paths or failed report", async () => {
  const r = await cleanup({ removeFailure: "/owned/fixture" });
  assert.equal(r.removed.length, 6);
  assert.equal(r.record.status, "failed");
  assert.deepEqual(r.record.cleanup.retainedOwnedPaths, ["/owned/fixture"]);
  assert.equal(r.written.length, 1);
  assert(!JSON.stringify(r.written).includes("private argv"));
});

test("unverified fixture shutdown escalates and detaches handles, preserves roots, reports failure", async () => {
  const r = await cleanup({ neverCloses: true });
  assert.deepEqual(r.signals, ["SIGINT", "SIGKILL"]);
  assert.equal(r.unrefs, 3);
  assert.equal(r.record.cleanup.launcherExited, false);
  assert.equal(r.removed.length, 0);
  assert.equal(r.record.cleanup.retainedOwnedPaths.length, 6);
  assert.equal(r.written[0].status, "failed");
});

test("malformed process results and output overflow fail closed without skipping report", async () => {
  const r = await cleanup({ stdout: "Fixture: services-closed\nFixture process-result: not-json", stdoutExceeded: true });
  assert.equal(r.record.status, "failed");
  assert.equal(r.removed.length, 0);
  assert.deepEqual(r.record.processResults, []);
  assert.equal(r.written.length, 1);
});
