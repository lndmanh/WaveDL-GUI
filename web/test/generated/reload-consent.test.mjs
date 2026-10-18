import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const configuration = await readFile(new URL('../../nuxt.config.ts', import.meta.url), 'utf8');
const packaged = new URL('../../../src/wavedl_daemon/web_assets/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('.wavedl-assets.json', packaged), 'utf8'));

test('workstation explicitly disables framework reload paths outside per-tab consent', () => {
  assert.match(configuration, /emitRouteChunkError:\s*false/);
  assert.match(configuration, /checkOutdatedBuildInterval:\s*false/);
});

test('actual packaged client does not contain Nuxt automatic chunk or outdated-build reload hooks', async () => {
  const scripts = Object.keys(manifest).filter(
    (path) => path.startsWith('_nuxt/') && path.endsWith('.js'),
  );
  assert(scripts.length > 0);
  for (const path of scripts) {
    const source = await readFile(new URL(path, packaged), 'utf8');
    assert(!source.includes('nuxt:chunk-reload'), `Automatic reload plugin present: ${path}`);
    assert(!source.includes('app:manifest:update'), `Outdated-build reload hook present: ${path}`);
  }
});
