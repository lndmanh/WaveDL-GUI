import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const source = await readFile(new URL("./run_catalogue_fault_browser_acceptance.mjs", import.meta.url), "utf8");

test("catalogue runner creates owner-private fixture and browser profile under a normal umask", { skip: process.platform === "win32" ? "POSIX mode and uid witness; not a Windows ACL certification" : false }, async () => {
  const destination = await mkdtemp(join(tmpdir(), "wavedl-catalogue-permissions-test-"));
  const previousUmask = process.umask(0o022);
  try {
    // Execute the runner's real filesystem setup without starting a daemon or browser.
    const start = source.indexOf("const destination = ");
    const end = source.indexOf("const ownedToken = ");
    assert(start >= 0 && end > start);
    const setup = source.slice(start, end);
    const bindings = {
      process: { argv: ["node", "catalogue-runner", destination] },
      resolve: value => value,
      mkdir, mkdtemp, readdir, join, tmpdir, assert,
    };
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const paths = await new AsyncFunction(...Object.keys(bindings), `${setup}; return [root, profile];`)(...Object.values(bindings));
    for (const path of paths) {
      const metadata = await stat(path);
      assert.equal(metadata.mode & 0o777, 0o700, `${path} must be owner-private`);
      assert.equal(metadata.uid, process.getuid());
      assert.deepEqual(await readdir(path), []);
    }
  } finally {
    process.umask(previousUmask);
    await rm(destination, { recursive: true, force: true });
  }
});

test("catalogue browser commands use the shared Linux temporary-directory policy", () => {
  assert.match(source, /import \{ browserLaunchArgs, browserTemporaryEnvironment \} from "\.\/browser_launch_policy\.mjs"/);
  assert.match(source, /env: browserTemporaryEnvironment\(\{ \.\.\.environment, AGENT_BROWSER_SESSION: session \}\)/);
});
