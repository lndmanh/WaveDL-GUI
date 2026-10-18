import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("retained gate active draft is opt-in and default keeps unseeded behavior", async () => {
  const runner = await readFile(new URL('./run_retained_browser_acceptance.mjs', import.meta.url), 'utf8');
  assert.match(runner, /process\.argv\.includes\("--active-draft"\)/);
  assert.match(runner, /"--epochs", "10000", "--request-metadata", "--record-process-results"/);
  assert.match(runner, /\["--unseeded"\]/);
  assert.match(runner, /activeDraft \? \["settings", "results"\] : \["project", "settings", "results"\]/);
});
test("active proof uses native controls and readonly runtime evidence", async () => {
  const helper = await readFile(new URL('./browser_retained_active_draft.mjs', import.meta.url), 'utf8');
  assert.match(helper, /openTrainingEditor/);
  assert.match(helper, /actions\.button\("Later"\)/);
  assert.match(helper, /actions\.fill\("epochs", "77"\)/);
  assert.match(helper, /mode=ro/);
  assert.match(helper, /os\.kill\(pid,0\)/);
  assert.doesNotMatch(helper, /__vue|__VUE|dispatchEvent|\.click\(|postMessage/);
});
