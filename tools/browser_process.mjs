import { spawn } from "node:child_process";

// Every invocation owns its POSIX process group. Neither argv nor unredacted
// process output is included in errors, and inherited pipes cannot stall close.
export function boundedCommand(
  binary,
  args,
  {
    cwd,
    env = process.env,
    timeout = 35000,
    termGrace = 500,
    reapTimeout = 3000,
    drainTimeout = 5000,
    stdoutLimit = 8 * 1024 * 1024,
    input,
    stdinLimit = 1024 * 1024,
    redact = () => "[suppressed]",
  } = {},
) {
  return new Promise((done, fail) => {
    if (
      !Number.isSafeInteger(stdinLimit) ||
      stdinLimit <= 0 ||
      (input !== undefined &&
        (!(typeof input === "string" || Buffer.isBuffer(input)) ||
          Buffer.byteLength(input) > stdinLimit))
    ) {
      fail(new Error("Owned command failed (stdin limit or type): [suppressed]"));
      return;
    }
    const grouped = process.platform !== "win32";
    const spawnFailure = (error) => {
      const code = ["E2BIG", "ENOENT", "EACCES", "ENOMEM", "EMFILE", "ENFILE"].includes(
        error?.code,
      )
        ? `; code=${error.code}`
        : "";
      return new Error(`Owned command failed (spawn error${code}): [suppressed]`);
    };
    let child;
    try {
      child = spawn(binary, args, {
        cwd,
        env,
        detached: grouped,
        stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });
    } catch (error) {
      fail(spawnFailure(error));
      return;
    }
    const timers = new Set();
    let stdout = "",
      stdoutBytes = 0,
      stderr = "",
      stopped,
      exited = false,
      settled = false;
    const later = (callback, ms) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        callback();
      }, ms);
      timers.add(timer);
      return timer;
    };
    const signal = (kind) => {
      try {
        if (grouped && child.pid) process.kill(-child.pid, kind);
        else child.kill(kind);
      } catch (error) {
        if (error.code !== "ESRCH") stopped ??= "owned process signal failed";
      }
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      child.stdin?.destroy();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      if (error) fail(error);
      else done(value);
    };
    let stderrSuppressed = false;
    const failure = (reason) => {
      // Classify only recognized driver failures. Never copy matching lines,
      // browser URLs, executable paths, credentials or arbitrary stderr.
      const acceptanceStage = stderr.match(
        /^WAVEDL_ACCEPTANCE_DIAGNOSTIC=(fixture-startup|browser-open|browser-readiness|scenario|cleanup)$/m,
      )?.[1];
      const category = stderrSuppressed
        ? ""
        : acceptanceStage
          ? `; diagnostic=acceptance-${acceptanceStage}`
          : /Navigation failed: net::ERR_[A-Z_]+/.test(stderr)
            ? "; diagnostic=browser-navigation"
            : /Failed to launch (?:browser|Chrome)|browserType\.launch:/.test(stderr)
              ? "; diagnostic=browser-launch"
              : /(?:socket path|Socket path).*(?:too long|exceeds)/.test(stderr)
                ? "; diagnostic=socket-path-limit"
                : "";
      const error = new Error(
        `Owned command failed (${reason}${category}): ${stderrSuppressed ? "[suppressed]" : String(redact(stderr)).slice(-1000)}`,
      );
      error.stdout = redact(stdout).slice(-20000);
      return error;
    };
    const stop = (reason) => {
      if (stopped || settled) return;
      stopped = reason;
      child.stdin?.destroy();
      signal("SIGTERM");
      later(() => signal("SIGKILL"), termGrace);
      later(() => {
        // A missing exit notification is never called successful cleanup.
        if (exited) {
          child.stdout.destroy();
          child.stderr.destroy();
        } else {
          child.unref();
          child.stdout.unref?.();
          child.stderr.unref?.();
        }
        finish(failure(`${stopped}; reaped=${exited}`));
      }, termGrace + reapTimeout);
    };
    later(() => stop("timeout"), timeout);
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > stdoutLimit) {
        stop("stdout limit");
        return;
      }
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (stderrSuppressed) return;
      if (Buffer.byteLength(stderr) + chunk.length > 65536) {
        // Never truncate a credential into a fragment before redaction.
        stderr = "";
        stderrSuppressed = true;
      } else stderr += chunk;
    });
    child.on("error", (error) => finish(spawnFailure(error)));
    child.on("exit", () => {
      exited = true;
      // exit reaps the direct child; close additionally requires pipe EOF.
      later(() => {
        stop("inherited stdio remained open after child exit");
        later(() => {
          signal("SIGKILL");
          child.stdout.destroy();
          child.stderr.destroy();
          finish(failure(stopped));
        }, termGrace);
      }, drainTimeout);
    });
    child.on("close", (code, terminalSignal) => {
      // The leader can exit on TERM before a descendant does. Do not cancel
      // escalation merely because the leader and its pipes have finished.
      if (stopped) signal("SIGKILL");
      if (stopped || code !== 0 || terminalSignal)
        finish(failure(stopped ?? `exit=${code}, signal=${terminalSignal}`));
      else finish(null, stdout.trim());
    });
    if (child.stdin) {
      child.stdin.on("error", () => stop("stdin transport error"));
      child.stdin.end(input);
    }
  });
}
