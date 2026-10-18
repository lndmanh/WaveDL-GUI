import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { join, relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';

// Exercise the actual wrapper acceptance/finally body with owned dependency
// fakes. This checks wrapper disposition only, not browser acceptance.
const source = await readFile(new URL('./run_inference_cancellation_browser_acceptance.mjs', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('let cleanupProven = false;'));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function run(options = {}) {
  const removed = [], written = [], retained = [];
  const report = { name: 'inference-cancellation', status: 'passed', cleanup: { errors: [] } };
  const deps = {
    assert, join, relative, resolve, sep, TextDecoder, process: { execPath: 'node', env: {} },
    runnerTemporary: '/owned/runner', destination: '/owned/report', repo: '/repo',
    boundedCommand: async (_, __, opts) => {
      assert.equal(opts.env.TMPDIR, '/owned/runner');
      if (options.commandFails) throw new Error('runner failed');
      return `Nonsecret evidence: ${options.escape ? '/foreign' : '/owned/runner/scenario'}/summary.json`;
    },
    boundedFile: async path => Buffer.from(JSON.stringify(path.endsWith('summary.json')
      ? { cases: [{ ...report, ...(options.mismatch ? { status: 'failed' } : {}) }] }
      : report)),
    verifyInferenceCancellationFile: async () => {
      if (options.verifierFails) throw new Error('invalid report');
      return report;
    },
    writeFile: async (path, _, opts) => { assert.equal(opts.flag, 'wx'); assert.equal(opts.mode, 0o600); written.push(path); },
    rm: async path => removed.push(path),
    lstat: async () => { throw Object.assign(new Error('absent'), { code: 'ENOENT' }); },
    console: { log: () => {}, error: message => retained.push(message) },
  };
  let error;
  try { await new AsyncFunction(...Object.keys(deps), body)(...Object.values(deps)); }
  catch (caught) { error = caught; }
  return { removed, written, retained, error };
}

test('verified exact report is exclusively copied and owned runner root removed', async () => {
  const result = await run();
  assert.equal(result.error, undefined);
  assert.deepEqual(result.written, ['/owned/report/inference-cancellation.json']);
  assert.deepEqual(result.removed, ['/owned/runner']);
  assert.deepEqual(result.retained, []);
});
for (const option of ['commandFails', 'escape', 'mismatch', 'verifierFails']) {
  test(`retains private evidence without copying after ${option}`, async () => {
    const result = await run({ [option]: true });
    assert(result.error);
    assert.deepEqual(result.removed, []);
    assert.deepEqual(result.written, []);
    assert.equal(result.retained.length, 1);
  });
}
