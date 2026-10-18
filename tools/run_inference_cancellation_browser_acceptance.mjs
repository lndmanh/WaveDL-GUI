#!/usr/bin/env node
// Additive launcher. The shared runner must expose --case=inference-cancellation
// and emit inference-cancellation.json after invoking browser_inference_cancellation.
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import { boundedCommand } from "./run_retained_browser_acceptance.mjs";
import { verifyInferenceCancellationFile } from "./verify_inference_cancellation_browser_report.mjs";
import { boundedFile } from "./verify_retained_browser_report.mjs";

assert(process.argv[2], "Usage: run_inference_cancellation_browser_acceptance.mjs REPORT_DIR");
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requestedDestination = resolve(process.argv[2]);
const destination = join(await realpath(dirname(requestedDestination)), basename(requestedDestination));
for (let parent = dirname(destination); parent !== dirname(parent); parent = dirname(parent)) {
  const stat = await lstat(parent);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), "Report destination must not traverse symlinks");
}
try { await mkdir(destination, { mode: 0o700 }); }
catch (error) { if (error.code !== "EEXIST") throw error; }
const destinationStat = await lstat(destination);
assert(destinationStat.isDirectory() && !destinationStat.isSymbolicLink(), "Report destination must be ordinary");
assert.deepEqual(await readdir(destination), [], "Report destination must be empty");
const runnerTemporary = await mkdtemp(join(await realpath(tmpdir()), "wavedl-inference-cancel-runner-"));
let cleanupProven = false;
try {
  const output = await boundedCommand(process.execPath,
    ["tools/run_web_acceptance.mjs", "--case=inference-cancellation"],
    { cwd: repo, env: { ...process.env, TMPDIR: runnerTemporary }, timeout: 300000 });
  const summaryPath = output.match(/Nonsecret evidence: (.+\/summary\.json)/)?.[1];
  assert(summaryPath, "Shared runner must emit completed evidence");
  const inside = relative(runnerTemporary, resolve(summaryPath));
  assert(inside && inside !== ".." && !inside.startsWith(`..${sep}`) && !inside.startsWith(sep), "Evidence escaped owned runner directory");
  const summaryBytes = await boundedFile(summaryPath, 1024 * 1024);
  const summary = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(summaryBytes));
  assert.deepEqual(summary.cases.map(item => item.name), ["inference-cancellation"]);
  const record = summary.cases[0];
  assert.equal(record.status, "passed");
  assert.deepEqual(record.cleanup.errors, []);
  const sourcePath = summaryPath.replace(/\/summary\.json$/, "/inference-cancellation.json");
  const report = await verifyInferenceCancellationFile(sourcePath);
  assert.deepEqual(record, report, "Summary and dedicated report differ");
  await writeFile(join(destination, "inference-cancellation.json"), await boundedFile(sourcePath, 1024 * 1024), { flag: "wx", mode: 0o600 });
  await verifyInferenceCancellationFile(join(destination, "inference-cancellation.json"));
  cleanupProven = true;
  console.log(`Inference-cancellation browser evidence: ${join(destination, "inference-cancellation.json")}`);
} finally {
  if (cleanupProven) {
    await rm(runnerTemporary, { recursive: true, force: true });
    await assert.rejects(lstat(runnerTemporary), error => error.code === "ENOENT");
  } else console.error(`Unverified private runner evidence retained: ${runnerTemporary}`);
}
