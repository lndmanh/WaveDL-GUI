#!/usr/bin/env node
// Genuine private builds for retained-generation browser acceptance; no install.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const excluded = new Set([
  "node_modules",
  ".nuxt",
  ".output",
  ".cache",
  ".vite",
  ".vendor-backups",
  ".git",
]);
export const CAPS = Object.freeze({
  assets: 128,
  fileBytes: 8 * 1024 * 1024,
  totalBytes: 16 * 1024 * 1024,
  manifestBytes: 128 * 1024,
});
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const within = (candidate, parent) => candidate === parent || candidate.startsWith(parent + sep);

export function parseArguments(args) {
  if (!args.length) return {};
  if (args.length !== 2 || args[0] !== "--output" || !args[1])
    throw new Error(
      "Usage: node tools/build_retained_browser_fixtures.mjs [--output ABSOLUTE_NEW_DIRECTORY]",
    );
  if (!isAbsolute(args[1]) || resolve(args[1]) !== args[1])
    throw new Error("Output must be an absolute normalized path");
  return { output: args[1] };
}

export function validateOutputLocation(output, repo, home) {
  assert(
    isAbsolute(output) && resolve(output) === output,
    "Output must be absolute and normalized",
  );
  assert(
    output !== sep && dirname(output) !== sep,
    "Output cannot be a filesystem root or top-level directory",
  );
  for (const protectedRoot of [repo, home]) {
    assert(
      !within(protectedRoot, output),
      "Output cannot be a user/workspace root or its ancestor",
    );
  }
  assert(!within(output, repo), "Output cannot be inside the repository");
}

export function patchFixtureConfig(source, namespace) {
  assert(/^g[1-4]$/.test(namespace), "Only g1..g4 namespaces are accepted");
  const replacements = [
    [
      "  ssr: false,",
      "  ssr: false,\n  workspaceDir: '.',\n  buildDir: 'node_modules/.cache/nuxt/.nuxt',",
    ],
    [
      "  vite: { plugins: [tailwindcss()] },",
      `  vite: {
    plugins: [tailwindcss()],
    $client: {
      build: {
        rolldownOptions: {
          output: {
            entryFileNames: '_nuxt/${namespace}/[hash].js',
            chunkFileNames: '_nuxt/${namespace}/[hash].js',
            assetFileNames: '_nuxt/${namespace}/[name].[hash].[ext]',
          },
        },
      },
    },
  },`,
    ],
  ];
  assert(
    !/\b(?:buildDir|buildAssetsDir|workspaceDir)\s*:/.test(source),
    "Unexpected existing build/workspace directory override",
  );
  let result = source;
  for (const [needle, replacement] of replacements) {
    assert.equal(
      result.split(needle).length - 1,
      1,
      `Expected exactly one config anchor: ${needle}`,
    );
    result = result.replace(needle, replacement);
  }
  return result;
}

export function validateAssetUrl(url) {
  assert(typeof url === "string" && url.length <= 1024, "Invalid asset URL");
  if (url === "/") return "index.html";
  assert(
    /^\/(?:[A-Za-z0-9_@+-][A-Za-z0-9_.@+-]*\/)*[A-Za-z0-9_@+-][A-Za-z0-9_.@+-]*$/.test(url),
    "Unsafe asset URL",
  );
  assert(
    !/^\/(?:api|v1|v2|auth|events|state|tokens?|server|node_modules)(?:\/|$)/i.test(url),
    "Private/API asset URL",
  );
  assert(!["/sw.js", "/sw.mjs", "/offline-build.json"].includes(url), "Non-cacheable asset URL");
  assert(url.split("/").length <= 33, "Asset path too deep");
  return url.slice(1);
}

export function resolveDynamicImport(from, specifier, namespace) {
  assert(/^g[1-4]$/.test(namespace), "Invalid namespace");
  assert(from.startsWith(`/_nuxt/${namespace}/`), "Importer namespace mismatch");
  assert(/^\.\/[^?#%\\]+\.js$/.test(specifier), "Dynamic import must be a local emitted JS chunk");
  const url = new URL(specifier, `http://fixture${from}`);
  assert(
    url.origin === "http://fixture" && url.pathname.startsWith(`/_nuxt/${namespace}/`),
    "Dynamic import escaped its namespace",
  );
  validateAssetUrl(url.pathname);
  return url.pathname;
}

export function isGeneratedDistAlias(relativePath, linkTarget, root) {
  return (
    relativePath === join("web", "dist") &&
    resolve(root, "web", linkTarget) === join(root, "web", ".output", "public")
  );
}

export function injectedWorkboxInventory(worker) {
  const candidates = [];
  for (const match of worker.matchAll(/\[\s*\{\s*"(?:url|revision)"\s*:/g)) {
    let depth = 0,
      quoted = false,
      escaped = false,
      end = -1;
    for (let index = match.index; index < worker.length; index++) {
      const character = worker[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
      } else if (character === '"') quoted = true;
      else if (character === "[") depth++;
      else if (character === "]" && --depth === 0) {
        end = index + 1;
        break;
      }
    }
    if (end < 0) continue;
    let entries;
    try {
      entries = JSON.parse(worker.slice(match.index, end));
    } catch {
      continue;
    }
    if (
      Array.isArray(entries) &&
      entries.length &&
      entries.every(
        (entry) =>
          entry &&
          typeof entry === "object" &&
          !Array.isArray(entry) &&
          Object.keys(entry).sort().join(",") === "revision,url",
      )
    )
      candidates.push(entries);
  }
  assert.equal(candidates.length, 1, "Expected exactly one actual injected Workbox manifest");
  const entries = candidates[0];
  const seen = new Set();
  for (const entry of entries) {
    assert(
      typeof entry.url === "string" &&
        (entry.revision === null || typeof entry.revision === "string"),
      "Invalid Workbox entry",
    );
    const normalized = entry.url.startsWith("/") ? entry.url : "/" + entry.url;
    validateAssetUrl(normalized);
    assert(!seen.has(normalized), "Duplicate Workbox URL");
    seen.add(normalized);
  }
  const tuples = entries
    .map((entry) => [entry.url, entry.revision])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { entries, buildKey: hash(JSON.stringify(tuples)) };
}

async function sourceFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (excluded.has(entry.name)) continue;
      const file = join(directory, entry.name);
      if (
        entry.isSymbolicLink() &&
        isGeneratedDistAlias(relative(root, file), await readlink(file), root)
      )
        continue;
      assert(!entry.isSymbolicLink(), `Source symlink is not copied: ${relative(root, file)}`);
      if (entry.isDirectory()) await visit(file);
      else {
        assert(entry.isFile(), "Source must contain only directories and regular files");
        files.push(file);
      }
    }
  }
  await visit(join(root, "web"));
  files.push(join(root, "tools/vendor_web_assets.py"), join(root, "src/wavedl/__init__.py"));
  return files.sort();
}

async function snapshot(root) {
  const records = {};
  for (const file of await sourceFiles(root))
    records[relative(root, file).split(sep).join("/")] = hash(await readFile(file));
  return records;
}

async function run(executable, args, cwd, logPath, timeoutMs = 180000) {
  const environment = { ...process.env, NUXT_TELEMETRY_DISABLED: "1" };
  // External overrides must not redirect build or cache paths outside the fixture.
  for (const key of Object.keys(environment))
    if (/^(NUXT_|NITRO_|VITE_)/.test(key) && key !== "NUXT_TELEMETRY_DISABLED")
      delete environment[key];
  await new Promise((done, fail) => {
    const child = spawn(executable, args, {
      cwd,
      env: environment,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "",
      reason = null;
    const kill = () => {
      if (child.pid) {
        try {
          if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") reason = error;
        }
      }
    };
    const timer = setTimeout(() => {
      reason = new Error(`Subprocess exceeded ${timeoutMs}ms`);
      kill();
    }, timeoutMs);
    const collect = (chunk) => {
      output += chunk;
      if (Buffer.byteLength(output) > 8 * 1024 * 1024) {
        reason = new Error("Subprocess output exceeded 8 MiB");
        kill();
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => {
      reason = error;
    });
    child.on("close", async (code, signal) => {
      clearTimeout(timer);
      try {
        await writeFile(logPath, output.slice(-8 * 1024 * 1024), { flag: "wx" });
        if (reason || code !== 0)
          fail(reason ?? new Error(`Subprocess failed (${code ?? signal}); see ${logPath}`));
        else done();
      } catch (error) {
        fail(error);
      }
    });
  });
}

async function stage(root, output, namespace, before) {
  const fixture = join(output, namespace);
  await mkdir(fixture);
  for (const file of Object.keys(before)) {
    const destination = join(fixture, file);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(root, file), destination, { errorOnExist: true, force: false });
    assert.equal(
      hash(await readFile(destination)),
      before[file],
      `Source changed during copy: ${file}`,
    );
  }
  await mkdir(join(fixture, "src/wavedl_daemon"), { recursive: true });
  const deps = join(fixture, "web/node_modules");
  await mkdir(join(deps, ".cache"), { recursive: true });
  for (const entry of await readdir(join(root, "web/node_modules"))) {
    if ([".cache", ".vite", ".bin"].includes(entry)) continue;
    await symlink(join(root, "web/node_modules", entry), join(deps, entry), "junction");
  }
  await symlink(join(root, "web/node_modules/.bin"), join(deps, ".bin"), "junction");
  await symlink("node_modules/.cache/nuxt/.nuxt", join(fixture, "web/.nuxt"), "dir");
  const config = join(fixture, "web/nuxt.config.ts");
  await writeFile(config, patchFixtureConfig(await readFile(config, "utf8"), namespace));
  return fixture;
}

async function verify(fixture, namespace) {
  const assetsDir = join(fixture, "src/wavedl_daemon/web_assets");
  const inventoryBytes = await readFile(join(assetsDir, "offline-build.json"));
  assert(inventoryBytes.length <= CAPS.manifestBytes);
  const inventory = JSON.parse(inventoryBytes);
  assert.equal(inventory.schema_version, 1);
  assert.match(inventory.build_key, /^[a-f0-9]{64}$/);
  assert.match(inventory.generation, /^[a-f0-9]{64}$/);
  assert(
    Array.isArray(inventory.assets) &&
      inventory.assets.length > 0 &&
      inventory.assets.length <= CAPS.assets,
  );
  const urls = new Set();
  let totalBytes = 0;
  for (const record of inventory.assets) {
    const file = join(assetsDir, validateAssetUrl(record.url));
    assert(!urls.has(record.url), "Duplicate inventory URL");
    urls.add(record.url);
    assert((await lstat(file)).isFile(), "Asset must be regular, not a symlink");
    const bytes = await readFile(file);
    assert(bytes.length > 0 && bytes.length <= CAPS.fileBytes);
    assert.equal(record.size, bytes.length);
    assert.equal(record.sha256, hash(bytes));
    assert.equal(typeof record.immutable, "boolean");
    if (record.immutable) assert(record.url.startsWith(`/_nuxt/${namespace}/`));
    totalBytes += bytes.length;
  }
  assert(totalBytes <= CAPS.totalBytes);
  assert.equal(
    inventory.generation,
    hash(JSON.stringify(inventory.assets.map((x) => [x.url, x.sha256, x.size, x.immutable]))),
  );
  const manifest = (
    await import(
      pathToFileURL(
        join(fixture, "web/node_modules/.cache/nuxt/.nuxt/dist/server/client.manifest.mjs"),
      ).href
    )
  ).default;
  const manifestFiles = [
    ...new Set(
      Object.values(manifest)
        .flatMap((x) => [x.file, ...(x.css ?? []), ...(x.assets ?? [])])
        .filter(Boolean),
    ),
  ].sort();
  assert(
    manifestFiles.length > 0 &&
      manifestFiles.every((x) => x.startsWith(`${namespace}/`) && urls.has("/_nuxt/" + x)),
  );
  const html = await readFile(join(assetsDir, "index.html"), "utf8");
  const entryUrls = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((x) => x[1]);
  assert(
    entryUrls.length > 0 &&
      entryUrls.every((x) => x.startsWith(`/_nuxt/${namespace}/`) && urls.has(x)),
  );
  const worker = await readFile(join(assetsDir, "sw.js"), "utf8");
  const precache = injectedWorkboxInventory(worker);
  assert.equal(
    inventory.build_key,
    precache.buildKey,
    "Inventory key differs from actual injected Workbox manifest",
  );
  assert.equal(precache.entries.length, urls.size, "Workbox/inventory asset count differs");
  for (const entry of precache.entries)
    assert(
      urls.has(entry.url.startsWith("/") ? entry.url : "/" + entry.url),
      "Workbox dependency absent from inventory",
    );
  const precacheNamespaces = [...worker.matchAll(/_nuxt\/g[1-4]\//g)].map((x) => x[0]);
  assert(
    precacheNamespaces.length > 0 && precacheNamespaces.every((x) => x === `_nuxt/${namespace}/`),
  );
  const dynamicImports = [];
  for (const record of inventory.assets.filter((x) => x.immutable && x.url.endsWith(".js"))) {
    const code = await readFile(join(assetsDir, record.url.slice(1)), "utf8");
    for (const match of code.matchAll(/import\([`"']([^`"']+)[`"']\)/g)) {
      const resolved = resolveDynamicImport(record.url, match[1], namespace);
      assert(urls.has(resolved), "Dynamic import dependency absent from inventory");
      dynamicImports.push({ from: record.url, specifier: match[1], resolved });
    }
  }
  assert(dynamicImports.length > 0, "Expected genuine application dynamic imports");
  return {
    namespace,
    fixture,
    assetsDir,
    buildKey: inventory.build_key,
    generation: inventory.generation,
    offlineInventorySha256: hash(inventoryBytes),
    workerSha256: hash(worker),
    entryUrls,
    manifestFiles,
    dynamicImports,
    workboxEntries: precache.entries,
    assetCount: inventory.assets.length,
    immutableAssetCount: inventory.assets.filter((x) => x.immutable).length,
    totalBytes,
    apiAuthInventoryCount: 0,
    caps: CAPS,
  };
}

export async function buildFixtures({ output } = {}) {
  const repo = await realpath(repository);
  if (output) {
    validateOutputLocation(output, repo, await realpath(homedir()));
    const parent = await realpath(dirname(output));
    assert.equal(parent, dirname(output), "Output parent must be canonical (no symlink path)");
    try {
      await lstat(output);
      throw new Error("Output already exists (including symlinks)");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await mkdir(output, { mode: 0o700 });
  } else output = await mkdtemp(join(await realpath(tmpdir()), "wavedl-retained-browser-builds."));
  console.log(`Owned fixture artifacts: ${output}`);
  const summary = {
    schemaVersion: 1,
    status: "building",
    started: new Date().toISOString(),
    output,
    builds: [],
  };
  try {
    const before = await snapshot(repo);
    await writeFile(join(output, "source-before.json"), json(before), { flag: "wx" });
    summary.sourceTreeSha256 = hash(JSON.stringify(before));
    summary.sourceFileCount = Object.keys(before).length;
    summary.sourceIdentifiers = Object.fromEntries(
      Object.entries(before).filter(([key]) =>
        /workstation\/.*\.ts$|vendor_web_assets|__init__/.test(key),
      ),
    );
    const python = process.env.WAVEDL_PYTHON ?? "python3";
    for (const namespace of ["g1", "g2", "g3", "g4"]) {
      console.log(`Generating ${namespace} from private sources`);
      const fixture = await stage(repo, output, namespace, before);
      await run(
        "npm",
        ["run", "generate"],
        join(fixture, "web"),
        join(output, `${namespace}-generate.log`),
      );
      await run(
        python,
        [join(fixture, "tools/vendor_web_assets.py")],
        fixture,
        join(output, `${namespace}-vendor.log`),
      );
      summary.builds.push(await verify(fixture, namespace));
    }
    const after = await snapshot(repo);
    await writeFile(join(output, "source-after.json"), json(after), { flag: "wx" });
    assert.equal(
      JSON.stringify(after),
      JSON.stringify(before),
      "Source changed while fixtures were building",
    );
    summary.sourceUnchanged = true;
    assert.equal(new Set(summary.builds.map((x) => x.generation)).size, 4);
    assert.equal(new Set(summary.builds.map((x) => x.buildKey)).size, 4);
    summary.status = "passed";
    summary.finished = new Date().toISOString();
    summary.note =
      "Private genuine generated builds only; no browser runtime claims or shared-cache quiescence claims.";
    await writeFile(join(output, "summary.json"), json(summary), { flag: "wx" });
    console.log(`Verified four fixture generations: ${join(output, "summary.json")}`);
    return summary;
  } catch (error) {
    summary.status = "failed";
    summary.error = String(error);
    summary.finished = new Date().toISOString();
    await writeFile(join(output, "summary.json"), json(summary), { flag: "wx" });
    throw new Error(
      `Fixture build failed; owned artifacts preserved at ${output}: ${error.message}`,
      { cause: error },
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await buildFixtures(parseArguments(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
