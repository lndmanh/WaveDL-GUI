import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./run_result_operations_browser_acceptance.mjs", import.meta.url), "utf8");
test("focused result-operation runner isolates the shared real browser and strict report", () => {
  assert.match(source, /--case=result-operations/);
  assert.match(source, /TMPDIR: runnerTemporary/);
  assert.match(source, /verifyResultOperationsFile/);
  assert.match(source, /flag: "wx"/);
  assert.match(source, /await boundedFile\(summaryPath, 1024 \* 1024\)/);
  assert.match(source, /await verifyResultOperationsFile\(sourcePath\)/);
  assert.match(source, /assert.deepEqual\(record, report/);
  assert.match(source, /if \(cleanupProven\) await rm\(runnerTemporary/);
  assert.match(source, /Unverified private runner evidence retained/);
  assert.match(source, /Report destination must be empty/);
  assert.match(source, /TextDecoder\("utf-8", \{ fatal: true \}\)/);
});
