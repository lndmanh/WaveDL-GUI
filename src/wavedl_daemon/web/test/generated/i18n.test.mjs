import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const output = fileURLToPath(new URL('../../.output/public/', import.meta.url));
const scripts = readdirSync(join(output, '_nuxt'))
  .filter((file) => file.endsWith('.js'))
  .map((file) => readFileSync(join(output, '_nuxt', file), 'utf8'));

test('bundled translations need no locale JSON endpoint', () => {
  assert.equal(existsSync(join(output, '_i18n')), false);
  assert.ok(scripts.some((source) => source.includes('Choose a model')));
  assert.ok(scripts.some((source) => source.includes('Chọn mô hình')));
  // Nuxt i18n retains a dormant server-loader function, but the SPA selects
  // client resources unconditionally and neither locale has a file loader.
  assert.ok(scripts.some((source) => source.includes('dynamicResourcesSSG:!0')));
  assert.ok(scripts.some((source) => /\{en:\[\],vi:\[\]\}/.test(source)));
});

test('runtime message compilation stays within the daemon CSP', () => {
  assert.ok(scripts.some((source) => source.includes('jit:!0')));
  for (const source of scripts) {
    assert.doesNotMatch(source, /new\s+Function\s*\(|\beval\s*\(/);
  }
});
