import assert from "node:assert/strict";
import { test } from "node:test";
import { boundedCommand } from "./run_retained_browser_acceptance.mjs";

const shortBounds = { timeout: 5000, termGrace: 50, reapTimeout: 1000, drainTimeout: 100 };
const run = (source, options = {}) =>
  boundedCommand(process.execPath, ["-e", source], { ...shortBounds, ...options });

test("normal owned command exits, drains output, and remains import safe", async () => {
  assert.equal(await run("process.stdout.write('finished\\n')"), "finished");
});

test("spawn failure is bounded and does not disclose argv", async () => {
  await assert.rejects(
    boundedCommand("/nonexistent-wavedl-owned-command", ["private-argument"], shortBounds),
    (error) => {
      assert.match(error.message, /spawn error/);
      assert(!error.message.includes("private-argument"));
      return true;
    },
  );
});

test("timeout escalates an owned TERM-resistant subprocess and rejects", async () => {
  await assert.rejects(
    run("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)", { timeout: 200 }),
    /timeout/,
  );
});

test("excess stdout is rejected with bounded retained output", async () => {
  await assert.rejects(
    run("process.stdout.write('x'.repeat(65536)); setInterval(() => {}, 1000)", {
      stdoutLimit: 1024,
    }),
    /stdout limit/,
  );
});

test("errors suppress secret stderr by default", async () => {
  await assert.rejects(
    run("process.stderr.write('private-bearer'); process.exitCode = 7"),
    (error) => {
      assert.match(error.message, /exit=7/);
      assert(!error.message.includes("private-bearer"));
      return true;
    },
  );
});

test("configured redaction runs before command error is exposed", async () => {
  await assert.rejects(
    run("process.stderr.write('private-bearer'); process.exitCode = 7", {
      redact: (text) => text.replaceAll("private-bearer", "[REDACTED]"),
    }),
    /\[REDACTED\]/,
  );
});

test("redacts complete bounded stderr before slicing its diagnostic tail", async () => {
  await assert.rejects(
    run(
      "process.stderr.write('x'.repeat(100) + 'private-bearer' + 'x'.repeat(995)); process.exitCode = 7",
      {
        redact: (text) => text.replaceAll("private-bearer", "[REDACTED]"),
      },
    ),
    (error) => {
      assert(!error.message.includes("bearer"));
      return true;
    },
  );
});

test("suppresses oversized stderr instead of retaining unredactable fragments", async () => {
  await assert.rejects(
    run("process.stderr.write('private-bearer' + 'x'.repeat(65530)); process.exitCode = 7", {
      redact: (text) => text.replaceAll("private-bearer", "[REDACTED]"),
    }),
    (error) => {
      assert.match(error.message, /\[suppressed\]/);
      assert(!error.message.includes("bearer"));
      return true;
    },
  );
});

test(
  "exited leader with descendant-inherited pipes has finite completion",
  { skip: process.platform === "win32" },
  async () => {
    const descendant = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)";
    const source = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: ['ignore', 1, 2] }).unref()`;
    const before = Date.now();
    await assert.rejects(run(source), /inherited stdio/);
    assert(
      Date.now() - before < 3000,
      "Inherited pipes must not extend command completion indefinitely",
    );
  },
);
