import assert from "node:assert/strict";
import { test } from "node:test";
import { boundedCommand } from "./browser_process.mjs";

const shortBounds = { timeout: 5000, termGrace: 50, reapTimeout: 1000, drainTimeout: 100 };
const run = (source, options = {}) =>
  boundedCommand(process.execPath, ["-e", source], { ...shortBounds, ...options });

test("normal owned command exits, drains output, and remains import safe", async () => {
  assert.equal(await run("process.stdout.write('finished\\n')"), "finished");
});

test("large stdin bypasses argv limits without changing the payload", async () => {
  const input = "private-sentinel" + " ".repeat(262144);
  assert.equal(await run(
    "let n=0;process.stdin.on('data',s=>n+=s.length);process.stdin.on('end',()=>console.log(n))",
    { input },
  ), String(Buffer.byteLength(input)));
});

test("stdin limit rejects before spawning without disclosing input", async () => {
  await assert.rejects(run("process.exit(0)", {
    input: "private-sentinel", stdinLimit: 2,
  }), error => {
    assert.match(error.message, /stdin limit/);
    assert(!error.message.includes("private-sentinel"));
    return true;
  });
});

for (const stdinLimit of [NaN, Infinity, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1])
  test(`invalid stdin limit rejects: ${stdinLimit}`, async () => {
    await assert.rejects(run("process.exit(0)", { input: "private-sentinel", stdinLimit }), /stdin limit/);
  });

for (const location of ["argument", "environment"]) test(
  `oversized ${location} failure reports only allowlisted spawn errno`,
  { skip: process.platform === "win32" },
  async () => {
    const privateValue = "private-sentinel".repeat(512 * 1024);
    await assert.rejects(boundedCommand(process.execPath,
      location === "argument" ? ["-e", "", privateValue] : ["-e", ""], {
        ...shortBounds,
        env: location === "environment" ? { ...process.env, WAVEDL_QA_LARGE: privateValue } : process.env,
      }), error => {
        assert.match(error.message, /spawn error; code=E2BIG/);
        assert(!error.message.includes("private-sentinel"));
        return true;
      });
  },
);

test("blocked stdin still observes the command deadline", async () => {
  await assert.rejects(run("setInterval(()=>{},1000)", {
    input: "x".repeat(1024 * 1024), timeout: 200,
  }), /timeout/);
});

test("unreaped child cannot retain a blocked stdin handle in its caller", {
  skip: process.platform === "win32",
}, async () => {
  const helper = new URL("./browser_process.mjs", import.meta.url).href;
  const source = `(async()=>{
    const {boundedCommand}=await import(${JSON.stringify(helper)});
    const originalKill=process.kill.bind(process);let ownedGroup;
    process.kill=(pid,signal)=>{
      if(pid<0){ownedGroup=pid;throw Object.assign(new Error('denied'),{code:'EPERM'});}
      return originalKill(pid,signal);
    };
    try{await boundedCommand(process.execPath,['-e','setInterval(()=>{},1000)'],{
      input:'x'.repeat(1048576),timeout:80,termGrace:10,reapTimeout:30
    });throw new Error('unexpected success');}
    catch(error){if(!error.message.includes('reaped=false'))throw error;}
    finally{process.kill=originalKill;}
    console.log('owned-group='+ownedGroup);
    process.once('beforeExit',()=>{try{originalKill(ownedGroup,'SIGKILL');}catch{}});
  })().catch(()=>{process.exitCode=1});`;
  let output;
  try {
    output = await run(source, { timeout: 1500, redact: text => text });
    assert.match(output, /^owned-group=-\d+$/);
  } catch (error) {
    // Only the exact process group created by this isolated probe is eligible.
    const group = String(error.stdout ?? "").match(/owned-group=(-\d+)/)?.[1];
    if (group) {
      try { process.kill(Number(group), "SIGKILL"); }
      catch (cleanupError) { if (cleanupError.code !== "ESRCH") throw cleanupError; }
    }
    throw error;
  }
});

test("early stdin close is a bounded sanitized transport failure", async () => {
  await assert.rejects(run("require('node:fs').closeSync(0);setInterval(()=>{},1000)", {
    input: "private-sentinel".repeat(65536), timeout: 500,
  }), error => {
    assert.match(error.message, /(?:stdin transport error|timeout)/);
    assert(!error.message.includes("private-sentinel"));
    return true;
  });
});

for (const [stderr, expected] of [
  ["Navigation failed: net::ERR_CONNECTION_REFUSED private-sentinel http://private/path", "browser-navigation"],
  ["Failed to launch browser /private/secret private-sentinel", "browser-launch"],
  ["socket path /private/secret is too long private-sentinel", "socket-path-limit"],
  ["unrecognized private-sentinel /private/secret", null],
]) test(`driver diagnostic is finite and sanitized: ${expected ?? "unknown"}`, async () => {
  await assert.rejects(run(`process.stderr.write(${JSON.stringify(stderr)});process.exitCode=1`), error => {
    assert(!error.message.includes("private-sentinel"));
    assert(!error.message.includes("/private/"));
    if (expected) assert(error.message.includes(`diagnostic=${expected}`));
    else assert(!error.message.includes("diagnostic="));
    assert(error.message.endsWith("[suppressed]"));
    return true;
  });
});

for (const stage of ["fixture-startup", "browser-open", "browser-readiness", "scenario", "cleanup"])
  test(`exact shared-runner diagnostic preserves only ${stage}`, async () => {
    const stderr = `private-sentinel /private/secret\nWAVEDL_ACCEPTANCE_DIAGNOSTIC=${stage}\nprivate-sentinel`;
    await assert.rejects(run(`process.stderr.write(${JSON.stringify(stderr)});process.exitCode=1`), error => {
      assert(error.message.includes(`diagnostic=acceptance-${stage}`));
      assert(!error.message.includes("private-sentinel"));
      assert(!error.message.includes("/private/"));
      return true;
    });
  });

for (const stderr of [
  "prefix WAVEDL_ACCEPTANCE_DIAGNOSTIC=browser-open",
  "WAVEDL_ACCEPTANCE_DIAGNOSTIC=browser-open private-sentinel",
  "WAVEDL_ACCEPTANCE_DIAGNOSTIC=browser-open/secret",
  "WAVEDL_ACCEPTANCE_DIAGNOSTIC=private-sentinel",
]) test(`forged shared-runner diagnostics remain suppressed: ${stderr}`, async () => {
  await assert.rejects(run(`process.stderr.write(${JSON.stringify(stderr)});process.exitCode=1`), error => {
    assert(!error.message.includes("diagnostic="));
    assert(error.message.endsWith("[suppressed]"));
    return true;
  });
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
