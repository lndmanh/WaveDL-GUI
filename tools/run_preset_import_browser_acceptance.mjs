#!/usr/bin/env node
// Run the public-UI preset case in an owned temporary workspace, then publish
// only a current, strictly verified nonsecret report to the CI evidence folder.
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundedCommand } from './browser_process.mjs';
import { boundedFile } from './browser_files.mjs';
import { reportDestination, ownedEvidencePath } from './run_training_fields_browser_acceptance.mjs';
import { verifyPresetImportFile } from './verify_preset_import_browser_report.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function main(path) {
  assert(path, 'Usage: run_preset_import_browser_acceptance.mjs REPORT_DIR');
  const destination = await reportDestination(path);
  const temporary = await mkdtemp(join(await realpath(tmpdir()), 'wavedl-preset-import-'));
  let verified = false;
  try {
    const output = await boundedCommand(process.execPath,
      ['tools/run_web_acceptance.mjs', '--case=preset-import'],
      { cwd: repo, env: { ...process.env, TMPDIR: temporary }, timeout: 600000 });
    const summaryPath = output.match(/Nonsecret evidence: (.+\/summary\.json)/)?.[1];
    assert(summaryPath, 'Owned runner summary missing');
    await ownedEvidencePath(temporary, summaryPath);
    const summary = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
      await boundedFile(summaryPath, 1024 * 1024)));
    assert.deepEqual(summary.cases.map(record => record.name), ['preset-import']);
    const source = summaryPath.replace(/\/summary\.json$/, '/preset-import.json');
    const record = await verifyPresetImportFile(source);
    assert.deepEqual(summary.cases[0], record);
    const target = join(destination, 'preset-import.json');
    await writeFile(target, await boundedFile(source, 1024 * 1024), { flag: 'wx', mode: 0o600 });
    await verifyPresetImportFile(target);
    verified = true;
    console.log('Preset import browser evidence: ' + target);
  } finally {
    if (verified) await rm(temporary, { recursive: true, force: true });
    else console.error('Unverified private runner evidence retained: ' + temporary);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main(process.argv[2]);
