#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, lstat, readdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, relative, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundedCommand } from './browser_process.mjs';
import { verifyOnnxExportFile } from './verify_onnx_export_browser_report.mjs';
import { boundedFile } from './browser_files.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert(process.argv[2], 'Usage: run_onnx_export_browser_acceptance.mjs REPORT_DIR');
const requestedDestination = resolve(process.argv[2]);
const destination = join(await realpath(dirname(requestedDestination)), basename(requestedDestination));
for (let parent = dirname(destination); parent !== dirname(parent); parent = dirname(parent)) {
  const stat = await lstat(parent);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), 'Report destination must not traverse symlinks');
}
try { await mkdir(destination, { mode: 0o700 }); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
assert((await lstat(destination)).isDirectory() && !(await lstat(destination)).isSymbolicLink(), 'Report destination must be an ordinary directory');
assert.deepEqual(await readdir(destination), [], 'Report destination must be empty');
const runnerTemporary = await mkdtemp(join(await realpath(tmpdir()), 'wavedl-onnx-runner-'));
let cleanupProven = false;
try {
  const output = await boundedCommand(process.execPath, ['tools/run_web_acceptance.mjs', '--case=onnx-export'], {
    cwd: repo, env: { ...process.env, TMPDIR: runnerTemporary }, timeout: 300000,
  });
  const summaryPath = output.match(/Nonsecret evidence: (.+\/summary\.json)/)?.[1];
  assert(summaryPath, 'Shared runner must emit completed evidence');
  const inside = relative(runnerTemporary, await realpath(summaryPath));
  assert(inside && inside !== '..' && !inside.startsWith(`..${sep}`) && !inside.startsWith(sep), 'Evidence must remain inside the owned runner directory');
  const summary = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await boundedFile(summaryPath, 1024 * 1024)));
  assert.deepEqual(summary.cases.map(item => item.name), ['onnx-export']);
  const record = summary.cases[0];
  assert.equal(record.status, 'passed');
  assert.deepEqual(record.cleanup.errors, []);
  const sourcePath = summaryPath.replace(/\/summary\.json$/, '/onnx-export.json');
  const sourceInside = relative(runnerTemporary, await realpath(sourcePath));
  assert(sourceInside && sourceInside !== '..' && !sourceInside.startsWith(`..${sep}`) && !sourceInside.startsWith(sep), 'Dedicated evidence must remain inside the owned runner directory');
  const report = await verifyOnnxExportFile(sourcePath);
  assert.deepEqual(record, report, 'Summary and dedicated report differ');
  cleanupProven = true;
  await writeFile(join(destination, 'onnx-export.json'), await boundedFile(sourcePath, 1024 * 1024), { flag: 'wx', mode: 0o600 });
  await verifyOnnxExportFile(join(destination, 'onnx-export.json'));
  console.log(`ONNX export browser evidence: ${join(destination, 'onnx-export.json')}`);
} finally {
  if (cleanupProven) await rm(runnerTemporary, { recursive: true, force: true });
  else console.error(`Unverified private runner evidence retained: ${runnerTemporary}`);
}
