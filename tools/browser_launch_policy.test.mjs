import assert from "node:assert/strict";
import { test } from "node:test";
import { browserLaunchArgs, browserLaunchPolicy, browserTemporaryEnvironment } from "./browser_launch_policy.mjs";

test("only Linux browser children receive a short Chromium socket temporary base", () => {
  const original = Object.freeze({ TMPDIR: "/private/long-owned-reports", TEMP: "preserve", AGENT_BROWSER_SESSION: "owned", WAVEDL_SECRET: "private-sentinel" });
  assert.deepEqual(browserTemporaryEnvironment(original, "linux"), { ...original, TMPDIR: "/tmp" });
  for (const platform of ["darwin", "win32"]) {
    const result = browserTemporaryEnvironment(original, platform);
    assert.deepEqual(result, original);
    assert.notEqual(result, original);
  }
  assert.equal(original.TMPDIR, "/private/long-owned-reports");
});

test("exact Chrome benchmark options survive comma-separated CLI parsing", () => {
  assert.equal(
    browserLaunchArgs,
    "--disable-gpu,--disable-optimization-guide-model-downloads-for-benchmarking",
  );
  assert.deepEqual(browserLaunchArgs.split(","), [
    "--disable-gpu",
    "--disable-optimization-guide-model-downloads-for-benchmarking",
  ]);
  // No embedded value commas, feature-list values, escaping, or bare arguments.
  for (const option of browserLaunchArgs.split(",")) {
    assert.match(option, /^--[a-z-]+$/);
    assert(!option.includes("="));
    assert(!option.includes("\\"));
    assert(!option.includes("disable-features"));
  }
});

test("launch options preserve security and caller-owned profile boundaries", () => {
  for (const forbidden of [
    "no-sandbox",
    "disable-setuid-sandbox",
    "disable-web-security",
    "ignore-certificate-errors",
    "ignore-https-errors",
    "remote-debugging",
    "user-data-dir",
  ]) {
    assert(!browserLaunchArgs.includes(forbidden));
  }
});

test("immutable nonsecret metadata describes the benchmark switch only", () => {
  assert.deepEqual(browserLaunchPolicy, {
    scope: "test-owned-browser",
    optimizationGuideModelDownloads: "disabled-for-benchmarking",
  });
  assert(Object.isFrozen(browserLaunchPolicy));
  assert.throws(() => {
    browserLaunchPolicy.scope = "user-browser";
  }, TypeError);
  assert.throws(() => {
    browserLaunchPolicy.profile = "/private/profile";
  }, TypeError);
  assert(
    browserLaunchArgs
      .split(",")
      .includes("--disable-optimization-guide-model-downloads-for-benchmarking"),
  );
});
