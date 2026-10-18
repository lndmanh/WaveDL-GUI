#!/usr/bin/env node
// Executable SYNTHETIC contract gate. Never native browser acceptance.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const scope = "Synthetic retained-store concurrency: fake-indexeddb transaction model, in-memory CacheStorage, injected fetch. Not native browser/worker/HTTP or ordinary UI-approval proof.";
export const names = Object.freeze([
  "reconciles cache enumeration with concurrent reservations so active older builds remain readable",
  "ignores a concurrently rolled-back bucket captured by stale cache enumeration",
  "serializes concurrent admissions with transaction-model IndexedDB and protects pending ownership",
  "counts in-flight reservations against capacity and never cleans another installer",
  "rolls back only its own reservation/cache when fetched bytes mismatch",
]);

export async function runSyntheticConcurrency() {
  const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const expression = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const output = await new Promise((resolveOutput, reject) => {
    const grouped = process.platform !== "win32";
    const child = spawn(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "test/workstation/retained-builds.test.ts", "--testNamePattern", expression, "--reporter=json"], { cwd: resolve(repository, "web"), detached: grouped, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", failed;
    const signal = (kind) => { try { if (grouped && child.pid) process.kill(-child.pid, kind); else child.kill(kind); } catch {} };
    const timeout = setTimeout(() => { failed = "Synthetic concurrency gate timed out"; signal("SIGKILL"); }, 30000);
    child.stdout.on("data", (chunk) => { stdout += chunk; if (Buffer.byteLength(stdout) > 1024 * 1024) { failed = "Synthetic output exceeded bound"; signal("SIGKILL"); } });
    child.stderr.on("data", (chunk) => { if (Buffer.byteLength(stderr) < 65536) stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code, terminalSignal) => {
      clearTimeout(timeout);
      if (failed || code !== 0 || terminalSignal) reject(new Error(failed ?? `Synthetic gate failed: ${stderr.slice(-1000)}`));
      else resolveOutput(stdout);
    });
  });
  const result = JSON.parse(output);
  assert.equal(result.success, true);
  assert.equal(result.numPassedTests, names.length, "Every selected synthetic contract must pass");
  assert.equal(result.numFailedTests, 0);
  const passed = result.testResults.flatMap((suite) => suite.assertionResults.filter((item) => item.status === "passed").map((item) => item.title));
  assert.deepEqual(passed.sort(), [...names].sort(), "Selected synthetic contracts must match exactly");
  return { status: "passed", nativeProof: false, scope, passedTests: passed };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runSyntheticConcurrency(), null, 2));
}
