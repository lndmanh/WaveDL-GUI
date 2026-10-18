import assert from "node:assert/strict";
import { test } from "node:test";
import { browserLaunchArgs, browserLaunchPolicy } from "./browser_launch_policy.mjs";

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
