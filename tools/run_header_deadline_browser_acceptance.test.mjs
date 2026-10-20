import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const source = await readFile(new URL("./run_header_deadline_browser_acceptance.mjs", import.meta.url), "utf8");

test("HEADER runner creates private fixture and profile with a normal POSIX umask", {
  skip: process.platform === "win32",
}, async () => {
  const destination = await mkdtemp(join(tmpdir(), "wavedl-header-permissions-test-"));
  const previousUmask = process.umask(0o022);
  try {
    // Exercise the actual setup without opening a browser or spawning a daemon.
    const start = source.indexOf("const destination = ");
    const end = source.indexOf("const ownedToken = ");
    assert(start >= 0 && end > start);
    const bindings = {
      process: { argv: ["node", "header-runner", destination] },
      resolve, mkdir, mkdtemp, readdir, realpath, join, tmpdir, assert,
    };
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const paths = await new AsyncFunction(...Object.keys(bindings), `${source.slice(start, end)}; return [root, profile];`)(...Object.values(bindings));
    for (const path of paths) {
      const metadata = await stat(path);
      assert.equal(metadata.mode & 0o777, 0o700);
      assert.equal(metadata.uid, process.getuid());
      assert.deepEqual(await readdir(path), []);
    }
  } finally {
    process.umask(previousUmask);
    await rm(destination, { recursive: true, force: true });
  }
});
