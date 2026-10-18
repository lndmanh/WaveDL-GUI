import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
const runner=await readFile(new URL('./run_web_acceptance.mjs',import.meta.url),'utf8');
const fixture=await readFile(new URL('./browser_daemon_fixture.py',import.meta.url),'utf8');
test('integrity case is optional and leaves the twelve-case baseline unchanged',()=>{
  const defaults=JSON.parse(runner.match(/const cases = (\[[^\]]+\])/)[1].replaceAll("'",'"'));
  assert.equal(defaults.length,12);assert(!defaults.includes('autoplot-metadata-integrity'));
  assert(runner.includes("name === 'autoplot-metadata-integrity'"));
  assert(runner.includes("...(integrity ? ['--autoplot-metadata-integrity'] : [])"));
  assert(runner.includes("name === 'partial-best-fallback' || integrity ? 'fallback'"));
  assert(runner.includes('if (partialBest && !integrity && record.cleanup.fixtureServicesClosed)'));
});
test('driver freezes arrivals, receipts, durable plans and listener cleanup before root removal',()=>{
  for(const key of ['integrityWire','integrityRequests','integrityReceipts','integrityInventories','integrityFrozenRegistry','integrityPlans','integrityFrozenAfterCleanup'])assert(runner.includes(`record.${key}`));
  assert(runner.includes('assert.deepEqual(record.integrityFrozenRegistry, record.finalRegistry)'));
  assert(runner.indexOf('record.integrityFrozenAfterCleanup = true')<runner.indexOf('record.cleanup.removedOwnedRoots = true'));
  assert(fixture.includes('"phase": "arrival"'));assert(fixture.includes('"phase": "complete"'));
  assert(fixture.includes('changed[body.index(b" ")] = 9'));assert(fixture.includes('claimed = True'));
  assert(fixture.includes('receipt["parsedWire"] = json.loads(altered)'));
  assert(!fixture.slice(fixture.indexOf('def metadata_integrity_fault'),fixture.indexOf('def request_cursor_metadata')).includes('write_bytes'));
});
