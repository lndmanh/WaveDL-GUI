import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { diagnosticIdentities } from "./run_genuine_broker_overflow_browser_acceptance.mjs";

test("extracts only public diagnostic line headers, not payload cursor strings", () => {
  assert.deepEqual(diagnosticIdentities("2026-10-15T00:00:00Z [1:0] hello: {}\n2026-10-15T00:00:01Z [1:1] log: fake [99:22]\n[2:44]\n2026-10-15T00:00:02Z [2:0] hello: {}"), [[1, 0], [1, 1], [2, 0]]);
});
test("diagnostic extraction is bounded", () => {
  assert.throws(() => diagnosticIdentities("x".repeat(512 * 1024 + 1)));
  assert.throws(() => diagnosticIdentities(null));
});
test("positive health control sends the task-owned bearer", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("./run_genuine_broker_overflow_browser_acceptance.mjs", import.meta.url), "utf8");
  assert.match(source, /Authorization: `Bearer \$\{bearer\}`/);
});

test("positive health control sends the task-owned bearer", async () => {
  const source = await readFile(
    new URL("./run_genuine_broker_overflow_browser_acceptance.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /Authorization: `Bearer \$\{bearer\}`/);
});
