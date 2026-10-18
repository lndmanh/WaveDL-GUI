import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const runner = await readFile(new URL('./run_web_acceptance.mjs', import.meta.url), 'utf8');
test('cached build optional case preserves original twelve and same-build live replacement', () => {
  const cases = runner.match(/const cases = (\[[^\]]+\])/)[1];
  assert.equal(JSON.parse(cases.replaceAll("'", '"')).length, 12);
  assert(!cases.includes('cached-build-replacement'));
  assert(runner.includes("const liveReplacement = name === 'live-port-reuse' || buildReplacement"));
  assert(runner.includes("buildReplacement ? 'tools/browser_build_replacement_fixture.py' : 'tools/browser_daemon_fixture.py'"));
  assert(runner.includes("firstHealth.buildId === secondHealth.buildId"));
});
test('cached build requires old controller, explicit fresh connect refusal and pre-cleanup proof', () => {
  assert(runner.includes('navigator.serviceWorker.controller?.scriptURL === location.origin + "/sw.js"'));
  assert(runner.includes("await button('Disconnect and clear scope')"));
  assert(runner.includes('record.buildReplacementAfterExplicitConnect = await registry(replacementRoot)'));
  assert(runner.includes('assert.deepEqual(record.buildReplacementAfterPage, record.buildReplacementOldPage)'));
  assert(runner.indexOf('Cached build pre-cleanup proof:') < runner.indexOf('record.cleanup.removedOwnedRoots = true'));
  assert(runner.includes('record.buildReplacementFrozenAfterCleanup = true'));
});
test('cached build alone scopes native Python temporary directories inside each exact owned daemon root', () => {
  assert(runner.includes('...(buildReplacement ? { TMPDIR: root } : {})'));
  assert(runner.includes('...(buildReplacement ? { TMPDIR: replacementRoot } : {})'));
  const originalStart = runner.indexOf("const fixture = spawn(python");
  const replacementStart = runner.indexOf("replacement = spawn(python");
  const rootTemporary = runner.indexOf('...(buildReplacement ? { TMPDIR: root } : {})');
  const replacementTemporary = runner.indexOf('...(buildReplacement ? { TMPDIR: replacementRoot } : {})');
  assert(rootTemporary > originalStart && rootTemporary < runner.indexOf('active.add(fixture)', originalStart));
  assert(replacementTemporary > replacementStart && replacementTemporary < runner.indexOf('active.add(replacement)', replacementStart));
  assert(runner.indexOf('await mkdir(root, { mode: 0o700 })') < originalStart);
  assert(runner.indexOf('await mkdir(replacementRoot, { mode: 0o700 })') < replacementStart);
});
