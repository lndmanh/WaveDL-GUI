#!/usr/bin/env node
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { verifyWizardProgression } from './browser_wizard_progression.mjs';

export const REPORT_NAME = 'wizard-progression-browser.json';
const MAX = 256 * 1024;
export async function readWizardEvidence(path) {
  path = resolve(path);
  for (let parent = dirname(path); parent !== dirname(parent); parent = dirname(parent)) {
    const stat = await lstat(parent);
    assert(stat.isDirectory() && !stat.isSymbolicLink());
  }
  const before = await lstat(path);
  assert(before.isFile() && !before.isSymbolicLink() && before.size > 0 && before.size <= MAX);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    assert.equal(stat.ino, before.ino); assert.equal(stat.dev, before.dev); assert.equal(stat.size, before.size);
    assert.equal(stat.mtimeMs, before.mtimeMs);
    assert.equal(stat.ctimeMs, before.ctimeMs);
    const bytes = Buffer.alloc(MAX + 1); let size = 0;
    for (;;) { const chunk = await file.read(bytes, size, bytes.length - size, null); size += chunk.bytesRead; if (!chunk.bytesRead || size === bytes.length) break; }
    assert(size > 0 && size <= MAX);
    const final = await file.stat();
    assert(final.isFile() && final.ino===stat.ino && final.dev===stat.dev && final.size===size && final.size===stat.size && final.mtimeMs===stat.mtimeMs && final.ctimeMs===stat.ctimeMs);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size));
  } finally { await file.close(); }
}
export async function verifyWizardProgressionReport(directory) {
  const root = resolve(directory);
  assert.deepEqual(await readdir(root), [REPORT_NAME]);
  return verifyWizardProgressionFile(join(root, REPORT_NAME));
}
export async function verifyWizardProgressionFile(path) {
  const value = JSON.parse(await readWizardEvidence(path));
  verifyWizardProgression(value);
  const repo = fileURLToPath(new URL('../', import.meta.url));
  const manifest = await readWizardEvidence(join(repo, 'src/wavedl_daemon/web_assets/.wavedl-assets.json'));
  assert.equal(value.assetManifestSha256, createHash('sha256').update(manifest).digest('hex'));
  return value;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await verifyWizardProgressionReport(process.argv[2]);
  console.log('wizard-progression browser report: valid');
}
