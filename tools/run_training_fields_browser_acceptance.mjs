#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, lstat, readdir, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, relative, sep, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { boundedCommand } from "./browser_process.mjs";
import { verifyTrainingFieldsFile } from "./verify_training_fields_browser_report.mjs";
import { boundedFile } from "./browser_files.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export async function reportDestination(path) {
  assert(path, "Usage: run_training_fields_browser_acceptance.mjs REPORT_DIR");
  const requested = resolve(path);
  for (let parent = dirname(requested); parent !== dirname(parent); parent = dirname(parent)) {
    const stat = await lstat(parent);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), "Destination must not traverse symlinks");
  }
  const destination = join(await realpath(dirname(requested)), basename(requested));
  for (let parent = dirname(destination); parent !== dirname(parent); parent = dirname(parent)) {
    const stat = await lstat(parent);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), "Destination must not traverse symlinks");
  }
  try {
    await mkdir(destination, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  assert((await lstat(destination)).isDirectory() && !(await lstat(destination)).isSymbolicLink());
  assert.deepEqual(await readdir(destination), [], "Report destination must be empty");
  return destination;
}
export async function ownedEvidencePath(temporary, path) {
  const inside = relative(await realpath(temporary), await realpath(path));
  assert(inside && inside !== ".." && !inside.startsWith(`..${sep}`) && !inside.startsWith(sep));
  return path;
}
export async function main(path) {
  const destination = await reportDestination(path);
  const temporary = await mkdtemp(join(await realpath(tmpdir()), "wavedl-full-fields-runner-"));
  let verified = false;
  try {
    const output = await boundedCommand(
      process.execPath,
      ["tools/run_web_acceptance.mjs", "--case=training-fields-full"],
      { cwd: repo, env: { ...process.env, TMPDIR: temporary }, timeout: 600000 },
    );
    const path = output.match(/Nonsecret evidence: (.+\/summary\.json)/)?.[1];
    assert(path, "Shared runner must emit completed evidence");
    await ownedEvidencePath(temporary, path);
    const summary = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(await boundedFile(path, 1024 * 1024)),
    );
    assert.deepEqual(
      summary.cases.map((item) => item.name),
      ["training-fields-full"],
    );
    const source = path.replace(/\/summary\.json$/, "/training-fields-full.json");
    const report = await verifyTrainingFieldsFile(source);
    assert.deepEqual(summary.cases[0], report);
    await writeFile(
      join(destination, "training-fields-full.json"),
      await boundedFile(source, 1024 * 1024),
      { flag: "wx", mode: 0o600 },
    );
    await verifyTrainingFieldsFile(join(destination, "training-fields-full.json"));
    verified = true;
    console.log(
      `Full training fields browser evidence: ${join(destination, "training-fields-full.json")}`,
    );
  } finally {
    if (verified) await rm(temporary, { recursive: true, force: true });
    else console.error(`Unverified private runner evidence retained: ${temporary}`);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main(process.argv[2]);
