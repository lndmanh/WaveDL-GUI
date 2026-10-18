import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  CAPS,
  injectedWorkboxInventory,
  isGeneratedDistAlias,
  parseArguments,
  patchFixtureConfig,
  resolveDynamicImport,
  validateAssetUrl,
  validateOutputLocation,
} from "./build_retained_browser_fixtures.mjs";

const config =
  "export default defineNuxtConfig({\n  ssr: false,\n  vite: { plugins: [tailwindcss()] },\n});\n";

test("only exact web/dist generated output alias is excluded from source copies", () => {
  const root = "/Users/test/project";
  assert(isGeneratedDistAlias("web/dist", root + "/web/.output/public", root));
  assert(isGeneratedDistAlias("web/dist", ".output/public", root));
  for (const [file, target] of [
    ["web/app/dist", root + "/web/.output/public"],
    ["web/workstation/dist", root + "/web/.output/public"],
    ["web/dist", root + "/web/workstation"],
    ["web/dist", "/some/other/.output/public"],
    ["web/other-link", root + "/web/.output/public"],
  ])
    assert.equal(isGeneratedDistAlias(file, target, root), false);
});

test("CLI accepts only an optional absolute normalized new output path", () => {
  assert.deepEqual(parseArguments([]), {});
  assert.deepEqual(parseArguments(["--output", "/private/tmp/fixture-new"]), {
    output: "/private/tmp/fixture-new",
  });
  for (const args of [
    ["--unknown"],
    ["--output"],
    ["--output", "relative"],
    ["--output", "/private/tmp/../fixture"],
    ["--output", "/private/tmp/a", "--extra"],
  ])
    assert.throws(() => parseArguments(args));
});

test("output guard rejects repository, home, ancestors and broad roots", () => {
  const repo = "/Users/test/project";
  const home = "/Users/test";
  validateOutputLocation("/private/tmp/new-fixture", repo, home);
  for (const output of ["/", "/Users", home, repo, repo + "/fixture", "/Users/test/../test"])
    assert.throws(() => validateOutputLocation(output, repo, home));
});

test("config patch uses exact producer overrides and preserves source options", () => {
  for (const namespace of ["g1", "g2", "g3", "g4"]) {
    const output = patchFixtureConfig(config, namespace);
    assert(output.includes("buildDir: 'node_modules/.cache/nuxt/.nuxt'"));
    assert.equal(output.split("workspaceDir: '.'").length - 1, 1);
    assert(output.includes(`entryFileNames: '_nuxt/${namespace}/[hash].js'`));
    assert(output.includes(`chunkFileNames: '_nuxt/${namespace}/[hash].js'`));
    assert(output.includes(`assetFileNames: '_nuxt/${namespace}/[name].[hash].[ext]'`));
    assert(output.includes("plugins: [tailwindcss()]"));
    assert(output.includes("$client:") && output.includes("rolldownOptions:"));
    assert(!output.includes("buildAssetsDir") && !output.includes("rollupOptions"));
  }
});

test("config drift, duplicate anchors and unsafe namespaces fail closed", () => {
  assert.throws(() =>
    patchFixtureConfig(
      config.replace("  ssr: false,", "  ssr: false,\n  workspaceDir: '../outside',"),
      "g1",
    ),
  );
  for (const source of [
    config.replace("  ssr: false,", ""),
    config + config,
    config.replace("plugins: [tailwindcss()]", "plugins: []"),
    config.replace("  ssr: false,", "  ssr: false,\n  buildDir: 'other',"),
    config + "\n// buildAssetsDir: '/other/'",
  ])
    assert.throws(() => patchFixtureConfig(source, "g1"));
  for (const namespace of ["g0", "g5", "../g1", "g1/other", ""])
    assert.throws(() => patchFixtureConfig(config, namespace));
});

test("actual Workbox JSON is decoded and its sorted tuple key independently hashed", () => {
  const entries = [
    { url: "_nuxt/g1/lazy.js", revision: null },
    { revision: "abc", url: "/" },
  ];
  const result = injectedWorkboxInventory(
    `other([1,2]); precache(${JSON.stringify(entries)}); later([3]);`,
  );
  assert.deepEqual(result.entries, entries);
  const expected = createHash("sha256")
    .update(
      JSON.stringify([
        ["/", "abc"],
        ["_nuxt/g1/lazy.js", null],
      ]),
    )
    .digest("hex");
  assert.equal(result.buildKey, expected);
  assert.deepEqual(
    injectedWorkboxInventory('precache([{"url":"/","revision":"quote\\\" [ bracket ]"}]);').entries,
    [{ url: "/", revision: 'quote" [ bracket ]' }],
  );
});

test("Workbox extraction rejects missing, ambiguous, private and duplicate inventories", () => {
  for (const worker of [
    "precache([])",
    'bad([{"url":"/","revision":true}]);',
    'p([{"url":"/api/health","revision":null}]);',
    'p([{"url":"/","revision":null},{"url":"/","revision":"x"}]);',
    'p([{"url":"/","revision":null}]);q([{"url":"/","revision":"x"}]);',
  ])
    assert.throws(() => injectedWorkboxInventory(worker));
});

test("asset URLs reject traversal, hidden paths, credentials and runtime endpoints", () => {
  assert.equal(validateAssetUrl("/"), "index.html");
  assert.equal(validateAssetUrl("/_nuxt/g1/chunk-ab_CD.js"), "_nuxt/g1/chunk-ab_CD.js");
  assert.equal(validateAssetUrl("/manifest.webmanifest"), "manifest.webmanifest");
  for (const url of [
    "/../secret",
    "/.hidden/file",
    "/_nuxt/./chunk.js",
    "/_nuxt/%2e%2e/secret",
    "/api/health",
    "/AUTH/login",
    "/v1/session",
    "/tokens/token",
    "/sw.js",
    "/offline-build.json",
    "//remote/file.js",
    "https://remote/file.js",
    "/file.js?secret",
    "/file.js#hash",
    "/file\\name.js",
  ])
    assert.throws(() => validateAssetUrl(url));
});

test("actual relative emitted import resolves into its generation only", () => {
  assert.equal(resolveDynamicImport("/_nuxt/g3/entry.js", "./lazy.js", "g3"), "/_nuxt/g3/lazy.js");
  for (const specifier of [
    "../g2/lazy.js",
    "./nested/../../g2/lazy.js",
    "/_nuxt/g3/lazy.js",
    "https://remote/lazy.js",
    "./lazy.js?x",
    "./%2e%2e/lazy.js",
    "./lazy.css",
  ])
    assert.throws(() => resolveDynamicImport("/_nuxt/g3/entry.js", specifier, "g3"));
  assert.throws(() => resolveDynamicImport("/_nuxt/g2/entry.js", "./lazy.js", "g3"));
});

test("fixture caps match production offline inventory limits", () => {
  assert.deepEqual(CAPS, {
    assets: 128,
    fileBytes: 8388608,
    totalBytes: 16777216,
    manifestBytes: 131072,
  });
  assert(Object.isFrozen(CAPS));
});
