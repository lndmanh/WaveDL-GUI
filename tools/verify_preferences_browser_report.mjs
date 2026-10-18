#!/usr/bin/env node
import assert from "node:assert/strict";
import { constants } from "node:fs";
import { lstat, open, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const maxBytes = 256 * 1024;
const omittedTrainingPreferences = new Set(["model", "data_path", "import_modules", "resume", "constraint", "constraint_file", "constraint_weight", "constraint_reduction", "run_name", "project_name"]);
export const trainingPreferenceNames = JSON.parse(await readFile(new URL("../web/shared/training-options.json", import.meta.url))).map(option => option.name).filter(name => !omittedTrainingPreferences.has(name));
async function readBounded(path) {
  const before = await lstat(path);
  assert(before.isFile() && !before.isSymbolicLink() && before.size > 0 && before.size <= maxBytes);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    assert(stat.dev === before.dev && stat.ino === before.ino && stat.isFile());
    const bytes = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < bytes.length) {
      const result = await handle.read(bytes, size, bytes.length - size, null);
      if (!result.bytesRead) break;
      size += result.bytesRead;
    }
    const after = await handle.stat();
    assert(after.dev === before.dev && after.ino === before.ino && after.size === before.size && after.mtimeMs === before.mtimeMs && size === before.size);
    assert(size > 0 && size <= maxBytes);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)));
  } finally {
    await handle.close();
  }
}
export function verifyPreferencesRecord(record, directory) {
  assert.equal(record.name, "preferences-browser-corruption");
  assert.equal(record.status, "passed");
  for (const field of ["error", "skip", "skipped", "skipReason", "failureStage"])
    assert(!Object.hasOwn(record, field), "Failure or skip evidence cannot pass acceptance");
  assert.equal(
    record.driverReadinessMode,
    "sync-exposure-poll-and-two-controller-dom-observations",
  );
  assert.deepEqual(record.freshStorage, { keys: [], unrelated: null, session: 0, cookies: "" });
  assert(
    typeof record.daemonId === "string" &&
      record.daemonId.length > 0 &&
      record.daemonId.length <= 256,
  );
  assert.equal(record.cases.length, 2);
  assert.deepEqual(
    record.cases.map((c) => c.mode),
    ["malformed", "oversized"],
  );
  const keys = [
    "qa-unrelated",
    "wavedl.appearance.v1",
    "wavedl.training-defaults.v1." + encodeURIComponent(record.daemonId),
  ].sort();
  for (const [index, item] of record.cases.entries()) {
    assert.equal(item.seedBytes, index === 0 ? 1 : 65537);
    assert.deepEqual(item.appearance, {
      theme: "system",
      language: "en",
      guide: "true",
      rootLanguage: "en",
    });
    assert.deepEqual(item.trainingDefaults, record.defaults);
    assert.deepEqual(item.draft, { epochs: record.defaults.epochs, device: "cpu" });
    assert.deepEqual(item.storage, { keys, unrelated: "preserve-me", session: 0, cookies: "" });
  }
  const appearance = { language: "vi", dark: true, fontSize: "20px", primary: "oklch(0.55 0.18 300)", preferences: { theme: "dark", accent: "violet", zoom: 125, language: "vi", showProjectGuide: false } };
  assert.deepEqual(record.appearanceSaved, appearance);
  assert.deepEqual(record.appearanceAfterRestart, appearance);
  assert.equal(record.trainingSaved.epochs, 17);
  assert.equal(record.trainingSaved.wandb, true);
  assert.equal(record.trainingSaved.wandb_watch, true);
  assert.deepEqual(record.trainingAfterRestart, record.trainingSaved);
  assert.equal(record.savedGuideDefaultApplied, true);
  assert.deepEqual(Object.keys(record.trainingSaved).sort(), [...trainingPreferenceNames].sort());
  assert.deepEqual(record.savedDefaultDraft, { epochs: "17", wandb: "true", wandb_watch: "true" });
  assert.deepEqual(record.afterReset, { trainingRemoved: true, stalePreference: "unavailable-old-cache-location", unrelated: "preserve-me" });
  assert.deepEqual(record.finalStorage, { keys: ["qa-unrelated", "wavedl.appearance.v1", "wavedl.legacy.cache-directory"], unrelated: "preserve-me", session: 0, cookies: "" });
  assert(Array.isArray(record.settingsControls) && record.settingsControls.includes("Reset training defaults"));
  assert(record.settingsControls.every(name => typeof name === "string" && !/(?:delete|clear|remove).{0,24}cache/i.test(name)));
  assert.deepEqual(record.sourceBefore, record.sourceAfter);
  assert(Object.hasOwn(record.sourceBefore, "retained-run-cache/previous-run.cache"));
  assert(Object.keys(record.sourceBefore).length >= 3);
  for (const [path, digest] of Object.entries(record.sourceBefore)) {
    assert(!path.startsWith("/") && !path.split("/").includes(".."));
    assert(Number.isSafeInteger(digest.size) && digest.size > 0);
    assert(/^[a-f0-9]{64}$/.test(digest.sha256));
  }
  assert.deepEqual(record.cleanup, {
    errors: [],
    browserSessionAbsent: true,
    fixtureReaped: true,
    servicesClosed: true,
    listenerClosed: true,
    ownedRootsRemoved: true,
  });
  assert(
    typeof record.assetManifestSha256 === "string" &&
      /^[a-f0-9]{64}$/.test(record.assetManifestSha256),
  );
  assert(
    typeof record.trainingOptionsSha256 === "string" &&
      /^[a-f0-9]{64}$/.test(record.trainingOptionsSha256),
  );
  assert(typeof record.limitation === "string" && record.limitation.includes("No exported YAML"));
  return record;
}
export async function verifyPreferencesReport(directory) {
  const root = resolve(directory);
  assert.deepEqual((await readdir(root)).sort(), ["preferences-browser.json"]);
  const record = await readBounded(join(root, "preferences-browser.json"));
  const repo = fileURLToPath(new URL("../", import.meta.url));
  const options = await readFile(join(repo, "web/shared/training-options.json"));
  assert.equal(record.trainingOptionsSha256, createHash("sha256").update(options).digest("hex"));
  const defaults = Object.fromEntries(JSON.parse(options).map((o) => [o.name, o.default]));
  assert.deepEqual(
    record.defaults,
    Object.fromEntries(
      ["epochs", "batch_size", "workers", "precision"].map((n) => [n, String(defaults[n])]),
    ),
  );
  assert.equal(
    record.assetManifestSha256,
    createHash("sha256")
      .update(await readFile(join(repo, "src/wavedl_daemon/web_assets/.wavedl-assets.json")))
      .digest("hex"),
  );
  return verifyPreferencesRecord(record, root);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (!process.argv[2]) throw new Error("Usage: verify_preferences_browser_report.mjs REPORT_DIR");
  await verifyPreferencesReport(process.argv[2]);
  console.log("preferences browser report: valid");
}
