import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const runner = await readFile(
  new URL("./run_auth_skew_browser_acceptance.mjs", import.meta.url),
  "utf8",
);
const fixture = await readFile(new URL("./browser_auth_skew_fixture.py", import.meta.url), "utf8");

test("auth/skew acceptance is additive and uses the real browser/daemon boundary", () => {
  assert.match(runner, /browser_auth_skew_fixture\.py/);
  assert.match(runner, /agent-browser/);
  assert.match(runner, /Connect securely/);
  assert.match(runner, /Credential expired or rejected; enter it again\./);
  assert.match(runner, /Connection identity changed/);
  assert.match(runner, /stalePlan/);
  assert.match(runner, /mutationControls/);
  assert.doesNotMatch(runner, /page\.route|setRequestInterception|fetch\s*=|vi\.mock/);
  assert.doesNotMatch(runner, /localStorage\.setItem|sessionStorage\.setItem/);
});

test("fixture faults only a post-handler response and keeps skew modes explicit", () => {
  assert.match(fixture, /await app\(scope, receive, capture\)/);
  assert.match(fixture, /status == 200/);
  assert.match(fixture, /control\.read_text/);
  assert.doesNotMatch(fixture, /health_calls == 2/);
  assert.match(fixture, /\{"401", "build", "protocol"\}/);
  assert.match(fixture, /protocol_min/);
  assert.match(fixture, /protocol_max/);
  assert.match(fixture, /base\.create_app/);
  assert.doesNotMatch(fixture, /responses\.get|requests\.mock|httpx\.MockTransport/);
});
