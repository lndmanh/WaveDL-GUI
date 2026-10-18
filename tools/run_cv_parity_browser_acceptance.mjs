#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, lstat, readdir, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, relative, sep, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { boundedCommand } from "./run_retained_browser_acceptance.mjs";
import { verifyCvParityFile } from "./verify_cv_parity_browser_report.mjs";
import { boundedFile } from "./verify_retained_browser_report.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
assert(process.argv[2], "Usage: run_cv_parity_browser_acceptance.mjs REPORT_DIR");
const requested = resolve(process.argv[2]);
const destination = join(await realpath(dirname(requested)), basename(requested));
for (let parent = dirname(destination); parent !== dirname(parent); parent = dirname(parent)) {
  const stat = await lstat(parent);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), "Destination must not traverse symlinks");
}
try { await mkdir(destination, { mode: 0o700 }); }
catch (error) { if (error.code !== "EEXIST") throw error; }
assert((await lstat(destination)).isDirectory() && !(await lstat(destination)).isSymbolicLink());
assert.deepEqual(await readdir(destination), [], "Report destination must be empty");
const temporary = await mkdtemp(join(await realpath(tmpdir()), "wavedl-cv-runner-"));
let verified = false;
try {
  const output = await boundedCommand(process.execPath, ["tools/run_web_acceptance.mjs", "--case=cv-parity"], { cwd: repo, env: { ...process.env, TMPDIR: temporary }, timeout: 300000 });
  const path = output.match(/Nonsecret evidence: (.+\/summary\.json)/)?.[1];
  assert(path, "Shared runner must emit completed evidence");
  const inside = relative(temporary, await realpath(path));
  assert(inside && inside !== ".." && !inside.startsWith(`..${sep}`) && !inside.startsWith(sep));
  const summary = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await boundedFile(path, 1024 * 1024)));
  assert.deepEqual(summary.cases.map(item => item.name), ["cv-parity"]);
  const source = path.replace(/\/summary\.json$/, "/cv-parity.json");
  const report = await verifyCvParityFile(source);
  assert.deepEqual(summary.cases[0], report);
  verified = true;
  await writeFile(join(destination, "cv-parity.json"), await boundedFile(source, 1024 * 1024), { flag: "wx", mode: 0o600 });
  await verifyCvParityFile(join(destination, "cv-parity.json"));
  console.log(`CV parity browser evidence: ${join(destination, "cv-parity.json")}`);
} finally {
  if (verified) await rm(temporary, { recursive: true, force: true });
  else console.error(`Unverified private runner evidence retained: ${temporary}`);
}
