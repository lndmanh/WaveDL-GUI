#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, lstat, readdir, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, relative, sep, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { boundedCommand } from "./browser_process.mjs";
import { verifyTrainingValidationFile } from "./verify_training_validation_browser_report.mjs";
import { reportDestination, ownedEvidencePath } from "./run_training_fields_browser_acceptance.mjs";
import { boundedFile } from "./browser_files.mjs";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export async function main(path) {
  assert(path, "Usage: run_training_validation_browser_acceptance.mjs REPORT_DIR");
  const destination = await reportDestination(path);
  const temporary = await mkdtemp(join(await realpath(tmpdir()), "wavedl-validation-"));
  let verified = false;
  try {
    const output = await boundedCommand(process.execPath,
      ["tools/run_web_acceptance.mjs", "--case=training-validation"],
      { cwd: repo, env: { ...process.env, TMPDIR: temporary }, timeout: 600000 });
    const summaryPath = output.match(/Nonsecret evidence: (.+\/summary\.json)/)?.[1];
    assert(summaryPath);
    await ownedEvidencePath(temporary, summaryPath);
    const summary = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      await boundedFile(summaryPath, 1024 * 1024)));
    assert.deepEqual(summary.cases.map((x) => x.name), ["training-validation"]);
    const source = summaryPath.replace(/\/summary\.json$/, "/training-validation.json");
    const report = await verifyTrainingValidationFile(source);
    assert.deepEqual(summary.cases[0], report);
    await writeFile(join(destination, "training-validation.json"),
      await boundedFile(source, 1024 * 1024),
      { flag: "wx", mode: 0o600 });
    await verifyTrainingValidationFile(join(destination, "training-validation.json"));
    verified = true;
    console.log("Training validation browser evidence: " + join(destination, "training-validation.json"));
  } finally {
    if (verified) await rm(temporary, { recursive: true, force: true });
    else console.error("Unverified private runner evidence retained: " + temporary);
  }
}
if (process.argv[1]?.endsWith("run_training_validation_browser_acceptance.mjs"))
  await main(process.argv[2]);
