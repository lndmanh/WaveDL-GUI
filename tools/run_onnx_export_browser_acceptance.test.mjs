import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const source = await readFile(new URL('./run_onnx_export_browser_acceptance.mjs', import.meta.url), 'utf8');
test('additive ONNX runner isolates owned lifecycle and verifies before reporting', () => {
  assert.match(source, /--case=onnx-export/);
  assert.match(source, /TMPDIR: runnerTemporary/);
  assert.match(source, /verifyOnnxExportFile/);
  assert.match(source, /flag: 'wx'/);
  assert.match(source, /boundedFile\(summaryPath, 1024 \* 1024\)/);
  assert.match(source, /assert\.deepEqual\(record, report/);
  assert.match(source, /relative\(runnerTemporary, await realpath\(summaryPath\)\)/);
  assert.match(source, /if \(cleanupProven\) await rm\(runnerTemporary/);
  assert.match(source, /Unverified private runner evidence retained/);
  assert.match(source, /Report destination must be empty/);
});
