import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { retainFailurePrefixes } from "./browser_failure_evidence.mjs";

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "wavedl-failure-evidence-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const downloads = join(root, "downloads");
  await mkdir(downloads);
  return { root, downloads, destination: join(root, "evidence") };
}

test("bounded prefixes and neutral metadata", async (t) => {
  const scope = await fixture(t);
  await writeFile(join(scope.downloads, "capture.bin"), Buffer.alloc(10000, 65));
  await writeFile(join(scope.downloads, "tiny.txt"), "tiny");
  const report = await retainFailurePrefixes(scope);
  assert.equal(report.totalPrefixBytes, 4100);
  assert.deepEqual(
    report.files.map((file) => file.sourceIndex),
    [0, 1],
  );
  assert.deepEqual(Object.keys(report.files[0]).sort(), [
    "destinationPath",
    "observedSize",
    "prefixLength",
    "prefixSha256",
    "sourceIndex",
  ]);
  assert(!JSON.stringify(report).includes("capture.bin"));
  assert.equal((await lstat(scope.destination)).mode & 0o777, 0o700);
  assert.equal((await lstat(join(scope.destination, "000.bin"))).mode & 0o777, 0o600);
  assert.equal((await readFile(join(scope.destination, "000.bin"))).length, 4096);
  assert.equal((await readFile(join(scope.destination, "001.bin"))).toString(), "tiny");
  assert.equal(
    report.files[0].prefixSha256,
    createHash("sha256").update(Buffer.alloc(4096, 65)).digest("hex"),
  );
  assert.equal(report.files[0].observedSize, 10000);
  assert(!JSON.stringify(report).includes("AAAA"));
});

test("expected names skip exact verified artifacts; all others are diagnostic", async (t) => {
  const scope = await fixture(t);
  await writeFile(join(scope.downloads, "declared.png"), "verified");
  await writeFile(join(scope.downloads, "unexpected.png"), "diagnostic");
  const report = await retainFailurePrefixes({ ...scope, expected: ["declared.png"] });
  assert.equal(report.files.length, 1);
});

test("rejects source links, special entries, excessive files and existing destination", async (t) => {
  const scope = await fixture(t);
  await writeFile(join(scope.downloads, "real.bin"), "safe");
  await symlink(join(scope.downloads, "real.bin"), join(scope.downloads, "link.bin"));
  await assert.rejects(retainFailurePrefixes(scope), { code: "EVIDENCE_SOURCE_TYPE" });
  await rm(join(scope.downloads, "link.bin"));
  await mkdir(scope.destination);
  await assert.rejects(retainFailurePrefixes(scope), { code: "EEXIST" });
});

test("refuses broad, relative, noncanonical and overlapping paths", async (t) => {
  const scope = await fixture(t);
  for (const downloads of ["relative", "/", homedir(), process.cwd()]) {
    await assert.rejects(retainFailurePrefixes({ ...scope, downloads }), (error) =>
      ["EVIDENCE_PATH", "EVIDENCE_BROAD_ROOT"].includes(error.code),
    );
  }
  await assert.rejects(
    retainFailurePrefixes({ ...scope, destination: join(scope.downloads, "nested") }),
    { code: "EVIDENCE_OVERLAP" },
  );
  await assert.rejects(
    retainFailurePrefixes({ ...scope, destination: join(homedir(), "evidence") }),
    { code: "EVIDENCE_BROAD_ROOT" },
  );
  await symlink(scope.root, join(scope.root, "alias"));
  await assert.rejects(
    retainFailurePrefixes({ ...scope, destination: join(scope.root, "alias", "new") }),
    { code: "EVIDENCE_NONCANONICAL" },
  );
});

test("16 large candidates reach 64KiB; overflow refuses before any capture", async (t) => {
  const scope = await fixture(t);
  for (let i = 0; i < 16; i++)
    await writeFile(join(scope.downloads, `${i}.bin`), Buffer.alloc(8192));
  assert.equal((await retainFailurePrefixes(scope)).totalPrefixBytes, 65536);
  await writeFile(join(scope.downloads, "overflow"), "x");
  const destination = join(scope.root, "refused");
  await assert.rejects(
    retainFailurePrefixes({ ...scope, destination }),
    (error) => error.code === "EVIDENCE_FILE_BOUND" && error.evidence.destination === null,
  );
  await assert.rejects(lstat(destination), { code: "ENOENT" });
});

test("entry metadata and exclusions are bounded", async (t) => {
  const scope = await fixture(t);
  for (let i = 0; i < 129; i++) await writeFile(join(scope.downloads, `${i}.bin`), "x");
  await assert.rejects(retainFailurePrefixes(scope), { code: "EVIDENCE_ENTRY_BOUND" });
  for (const expected of [["../foreign"], [1], ["x".repeat(257)]]) {
    await assert.rejects(retainFailurePrefixes({ ...scope, expected }), {
      code: "EVIDENCE_EXPECTED",
    });
  }
});

test("FIFO and nested source refuse without opening bodies", async (t) => {
  for (const kind of ["fifo", "directory"]) {
    const scope = await fixture(t);
    const path = join(scope.downloads, "special");
    if (kind === "fifo") execFileSync("mkfifo", [path]);
    else await mkdir(path);
    await assert.rejects(retainFailurePrefixes(scope), { code: "EVIDENCE_SOURCE_TYPE" });
  }
});

test("growth and replacement during prefix read refuse with partial directory retained", async (t) => {
  // Controlled synthetic races, not browser or user filesystem modifications.
  for (const kind of ["grow", "replace"]) {
    const scope = await fixture(t);
    const path = join(scope.downloads, "secret-token-filename");
    await writeFile(path, Buffer.alloc(8192, 65));
    const originalOpen = fsPromises.open;
    let changed = false;
    fsPromises.open = async function (filePath, ...args) {
      const handle = await originalOpen.call(this, filePath, ...args);
      if (filePath !== path) return handle;
      const originalRead = handle.read.bind(handle);
      handle.read = async (...readArgs) => {
        const result = await originalRead(...readArgs);
        if (!changed) {
          changed = true;
          if (kind === "grow") await fsPromises.appendFile(path, "more");
          else {
            await fsPromises.rename(path, join(scope.downloads, "old"));
            await writeFile(path, "replacement");
          }
        }
        return result;
      };
      return handle;
    };
    syncBuiltinESMExports();
    try {
      await assert.rejects(retainFailurePrefixes(scope), (error) => {
        assert.equal(error.code, "EVIDENCE_SOURCE_CHANGED");
        assert.equal(error.evidence.destination, scope.destination);
        assert.deepEqual(error.evidence.files, []);
        assert(!JSON.stringify(error.evidence).includes("secret-token-filename"));
        return true;
      });
      assert.equal((await lstat(scope.destination)).mode & 0o777, 0o700);
    } finally {
      fsPromises.open = originalOpen;
      syncBuiltinESMExports();
    }
  }
});
