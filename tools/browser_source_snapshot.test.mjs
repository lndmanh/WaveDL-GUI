import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  isGeneratedDistAlias,
  verifySourceSnapshot,
} from "./browser_source_snapshot.mjs";

test("generated distribution alias is narrowly recognized", () => {
  const root = "/owned/worktree";
  assert(isGeneratedDistAlias("web/dist", root + "/web/.output/public", root));
  assert(isGeneratedDistAlias("web/dist", ".output/public", root));
  for (const [path, target] of [
    ["web/elsewhere", ".output/public"],
    ["web/dist", "/outside/public"],
    ["web/dist/file.js", ".output/public"],
  ]) {
    assert.equal(isGeneratedDistAlias(path, target, root), false);
  }
});

test("source snapshot rejects unsafe paths, stale files, and inventory changes", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "browser-source-test-")));
  try {
    const paths = [
      "web/app/app.vue",
      "web/app/pages/~offline.vue",
      "web/public/images/bg2@0,5x.jpg",
      "tools/vendor_web_assets.py",
      "src/wavedl/__init__.py",
    ];
    const before = {};
    for (const path of paths) {
      const file = join(directory, path);
      await mkdir(join(file, ".."), { recursive: true });
      await writeFile(file, "ordinary-source");
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
    await writeFile(join(directory, paths[0]), "changed-source");
    await assert.rejects(verifySourceSnapshot(before, directory), /Current source differs/);
    await writeFile(join(directory, paths[0]), "ordinary-source");
    await writeFile(join(directory, "web/added.ts"), "new-source");
    await assert.rejects(verifySourceSnapshot(before, directory), /inventory differs/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
