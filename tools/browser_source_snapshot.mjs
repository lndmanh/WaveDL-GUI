import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readdir, readlink } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { boundedFile } from "./browser_files.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const excludedSourceDirectories = new Set([
  "node_modules",
  ".nuxt",
  ".output",
  ".cache",
  ".vite",
  ".vendor-backups",
  ".git",
]);

export function isGeneratedDistAlias(relativePath, linkTarget, root) {
  return (
    relativePath === join("web", "dist") &&
    resolve(root, "web", linkTarget) === join(root, "web", ".output", "public")
  );
}

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
