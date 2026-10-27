import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const runner = await readFile(new URL('./run_web_acceptance.mjs', import.meta.url), 'utf8');
const fixture = await readFile(new URL('./browser_daemon_fixture.py', import.meta.url), 'utf8');

test('partial best cases are explicit and do not expand required baseline cases', () => {
  const defaults = runner.match(/const cases = (\[[^\]]+\])/)[1];
  assert.deepEqual(JSON.parse(defaults.replaceAll("'", '"')), [
    'baseline', 'detach', 'reload', 'cancel', 'lost-ack',
    'artifact-tamper', 'port-reuse', 'live-port-reuse', 'authoring-parity',
    'download-names', 'dataset-parity',
  ]);
  for (const name of ['partial-best-fallback', 'partial-best-refusal']) {
    assert(runner.includes(name));
  }
  assert.match(runner, /partialBest \? \['--partial-best', partialBest, '--request-metadata'\]/);
});

test('fixture changes real publications and forwards untouched HTTP messages', () => {
  assert.match(fixture, /publish_generation\(\n\s+layout, staging/);
  assert.match(fixture, /item\.path\.rename\(quarantine \/ item\.generation\)/);
  assert.match(fixture, /await partial_application\(scope, receive, observe_send\)/);
  assert.match(fixture, /await send\(message\)/);
  assert.match(fixture, /terminal == \("completed",\)/);
  assert.match(fixture, /secrets\.compare_digest\(value, f"Bearer \{token\}"\.encode\(\)\)/);
});

test('runner requires source hashes, actual PNG bytes and decoded pixels plus frozen negative proof', () => {
  for (const required of [
    'pin.complete_sha256', 'pin.manifest_sha256', 'partialBestRaster',
    'rgbaSha256', 'partialBestFrozenRegistry', 'partialBestPlanReceipts',
    'partialBestInventories', 'partialBestFrozenAfterCleanup',
    'execution.cancel_delivered', 'control.cancellation_requested',
  ]) assert(runner.includes(required), required);
  assert.doesNotMatch(runner, /page\.route|vi\.mock|dispatchEvent|localStorage\.setItem/);
});
