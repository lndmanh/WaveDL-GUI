import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const runner = await readFile(new URL('./run_web_acceptance.mjs', import.meta.url), 'utf8');
const helper = await readFile(new URL('./browser_submitted_plan_protection.mjs', import.meta.url), 'utf8');
const focused = await readFile(new URL('./run_submitted_plan_browser_acceptance.mjs', import.meta.url), 'utf8');
test('submitted protection reuses the owned browser and real daemon, explicitly only', () => {
  assert.match(runner, /browser_daemon_fixture\.py/);
  const defaults = runner.match(/const cases = \[([^\]]+)\]/)[1];
  assert.doesNotMatch(defaults, /submitted-plan-authoring-protection/);
  assert.match(focused, /run_web_acceptance\.mjs.*--case=submitted-plan-authoring-protection/);
  assert.match(focused, /verifySubmittedPlanReport/);
  assert.match(focused, /wavedl-submitted-runner-/);
  assert.match(focused, /TMPDIR: runnerTemporary/);
  assert.match(runner, /assert\.rejects\(fetch/);
  assert.match(runner, /ECONNREFUSED/);
});
test('submitted authoring observations follow actual UI events and read-only storage', () => {
  assert.match(helper, /mode=ro/);
  assert.doesNotMatch(helper, /\?\? plans\[0\]/);
  for (const table of ['raw.plans', 'raw.plan_control', 'raw.execution_control']) assert(helper.includes(`hash(JSON.stringify(${table}))`));
  assert.match(helper, /await fill\('epochs', '4'\)/);
  assert.match(helper, /await button\('Confirm reset'\)/);
  assert.match(helper, /await button\('Open acknowledged run'\)/);
  for (const key of ['planSha256', 'manifestSha256', 'controlSha256', 'executionSha256']) assert(helper.includes(key));
  assert.doesNotMatch(helper, /dispatchEvent|localStorage\.setItem|sessionStorage\.setItem|page\.route|vi\.mock/);
});
