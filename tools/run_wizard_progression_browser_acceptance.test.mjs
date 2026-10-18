import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const runner = await readFile(new URL('./run_web_acceptance.mjs', import.meta.url), 'utf8');
test('wizard progression remains additive and opt-in', () => {
  assert.match(runner, /wizard-progression/);
  const defaults = runner.match(/const cases = \[([^\]]+)\]/)[1];
  assert.doesNotMatch(defaults, /wizard-progression/);
  assert.match(runner, /if \(name === 'wizard-progression'\)/);
  assert.match(runner, /Choose a dataset from the current daemon/);
  assert.match(runner, /Choose a catalogue model or explicit custom identifier/);
});
test('wrapper confines and verifies owned evidence before exclusive copy and cleanup',async()=>{
  const wrapper=await readFile(new URL('./run_wizard_progression_browser_acceptance.mjs',import.meta.url),'utf8');
  assert.match(wrapper,/relative\(temporary, await realpath\(path\)\)/);
  assert.match(wrapper,/assert\.deepEqual\(await readdir\(target\), \[\]\)/);
  assert.match(wrapper,/assert\.deepEqual\(await verifyWizardProgressionFile\(source\), record\)/);
  assert.match(wrapper,/flag: 'wx'/);
  assert.match(wrapper,/if \(verified\) await rm\(temporary/);
  assert.doesNotMatch(wrapper,/readFile\(/);
});
