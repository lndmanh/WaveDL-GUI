#!/usr/bin/env node
// Focused real-browser result-operation acceptance. The shared runner owns the
// daemon/browser lifecycle; this wrapper retains only one bounded JSON report.
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import { boundedCommand } from "./run_retained_browser_acceptance.mjs";
import { verifyResultOperationsFile } from "./verify_result_operations_browser_report.mjs";
import { boundedFile } from "./verify_retained_browser_report.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
assert(process.argv[2], "Usage: run_result_operations_browser_acceptance.mjs REPORT_DIR");
const requestedDestination = resolve(process.argv[2]);
// Canonicalize platform temp aliases (e.g. macOS /tmp -> /private/tmp), while
// requiring the actual destination leaf to be ordinary and empty below.
const destination = join(await realpath(dirname(requestedDestination)), basename(requestedDestination));
for (let parent = dirname(destination); parent !== dirname(parent); parent = dirname(parent)) {
  const stat = await lstat(parent);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), "Report destination must not traverse symlinks");
}
try { await mkdir(destination, { mode: 0o700 }); }
catch (error) { if (error.code !== "EEXIST") throw error; }
const destinationStat = await lstat(destination);
assert(destinationStat.isDirectory() && !destinationStat.isSymbolicLink(), "Report destination must be an ordinary directory");
assert.deepEqual(await readdir(destination), [], "Report destination must be empty");
const runnerTemporary = await mkdtemp(join(await realpath(tmpdir()), "wavedl-result-runner-"));
let cleanupProven = false;
try {
  const output = await boundedCommand(
    process.execPath,
    ["tools/run_web_acceptance.mjs", "--case=result-operations"],
    { cwd: repo, env: { ...process.env, TMPDIR: runnerTemporary }, timeout: 300000 },
  );
  const summaryPath = output.match(/Nonsecret evidence: (.+\/summary\.json)/)?.[1];
  assert(summaryPath, "Shared runner must emit completed evidence");
  const inside = relative(runnerTemporary, resolve(summaryPath));
  assert(inside && inside !== ".." && !inside.startsWith(`..${sep}`) && !inside.startsWith(sep), "Evidence must remain inside the owned runner directory");
  const summaryBytes = await boundedFile(summaryPath, 1024 * 1024);
  const summary = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(summaryBytes));
  assert.deepEqual(summary.cases.map((item) => item.name), ["result-operations"]);
  const record = summary.cases[0];
  assert.equal(record.status, "passed");
  assert.deepEqual(record.cleanup.errors, []);
  const sourcePath = summaryPath.replace(/\/summary\.json$/, "/result-operations.json");
  const report = await verifyResultOperationsFile(sourcePath);
  assert.deepEqual(record, report, "Summary and dedicated report differ");
  cleanupProven = true;
  await writeFile(join(destination, "result-operations.json"), await boundedFile(sourcePath, 1024 * 1024), {
    flag: "wx",
    mode: 0o600,
  });
  await verifyResultOperationsFile(join(destination, "result-operations.json"));
  console.log(`Result-operation browser evidence: ${join(destination, "result-operations.json")}`);
} finally {
  // Never remove potentially live fixture/profile roots after an unproven failure.
  if (cleanupProven) await rm(runnerTemporary, { recursive: true, force: true });
  else console.error(`Unverified private runner evidence retained: ${runnerTemporary}`);
}
