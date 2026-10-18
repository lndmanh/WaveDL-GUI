// Read-only consistency guard for evidence, not independent browser certification.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { boundedFile } from "./verify_retained_browser_report.mjs";
import { packagedAssetHashes } from "./browser_training_fields_full.mjs";

export const faults = Object.freeze(["torn-tail", "abandoned-tail", "oversized-line", "oversized-tail"]);
export const limitation = "Controlled terminal numerical supervisor and pid; genuine local submission, startup binding, HELLO/journal bytes, owner ingestion, SQLite, HTTP and SSE. No ML training, shared-filesystem, native-process or full F02 certification.";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const sha = /^[0-9a-f]{64}$/;
const packagedAssetCount = Object.keys(JSON.parse(readFileSync(new URL("../src/wavedl_daemon/web_assets/.wavedl-assets.json", import.meta.url), "utf8"))).length;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const integer = (value, min = 0) => assert(Number.isSafeInteger(value) && value >= min, "Invalid integer evidence");
function object(value) { assert(value && typeof value === "object" && !Array.isArray(value), "Object evidence required"); }
function clean(value, depth = 0, path = "") {
  assert(depth < 40, "Evidence nesting exceeds bound");
  if (typeof value === "number") assert(Number.isFinite(value), "Non-finite evidence");
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert(!/^(?:skip.*|failure|failed|retainedPrivateRoots|retainedOwnedDirectory)$/i.test(key) && !/Error$/.test(key), "Failure/skip evidence present");
    if (key === "errors") assert.deepEqual(child, []);
    // The only expected errors are the two real framing errors in health.
    if (key === "error") assert(/\.health\.monitoring_errors\.\d+$/.test(path) && child === "ProtocolError" && uuid.test(value.source), "Unexpected error evidence");
    clean(child, depth + 1, `${path}.${key}`);
  }
}
function hex(value, max = 128 * 1024) {
  assert(typeof value === "string" && value.length > 0 && value.length <= max * 2 && /^(?:[a-f0-9]{2})+$/.test(value), "Invalid bounded hex");
  return Buffer.from(value, "hex");
}
function json(bytes) {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const value = JSON.parse(source);
  // JSON.parse accepts duplicate members. Evidence must not rely on which
  // duplicate wins in a downstream implementation (including escaped keys).
  const stack = [];
  for (const match of source.matchAll(/"(?:[^"\\]|\\.)*"|[{}[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)) {
    const token = match[0], parent = stack.at(-1);
    if (token === "{" || token === "[") stack.push({ keys: token === "{" ? new Set() : null, key: token === "{" });
    else if (token === "}" || token === "]") stack.pop();
    else if (token === "," && parent?.keys) parent.key = true;
    else if (token === ":" && parent) parent.key = false;
    else if (token.startsWith('"') && parent?.keys && parent.key) {
      const key = JSON.parse(token); assert(!parent.keys.has(key), "Duplicate JSON member"); parent.keys.add(key);
    }
  }
  clean(value);
  return value;
}
function envelope(bytes, runId, type, seq) {
  assert.equal(bytes.at(-1), 10, "Complete event newline required");
  const event = json(bytes);
  assert.deepEqual(Object.keys(event).sort(), ["run_id", "attempt", "type", "seq", "ts", "payload", "protocol", "version"].sort());
  assert.equal(event.run_id, runId);
  assert.equal(event.protocol, "wavedl-jsonl");
  assert.equal(event.version, 1);
  assert.equal(event.attempt, 1);
  assert.equal(event.type, type);
  assert.equal(event.seq, seq);
  assert(typeof event.ts === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|\+00:00)$/.test(event.ts) && Number.isFinite(Date.parse(event.ts)));
  object(event.payload);
  if (type === "exit") assert.deepEqual(event.payload, { status: "completed", code: 0 });
  else {
    const p = event.payload;
    assert.equal(p.protocol_min, 1); assert.equal(p.protocol_max, 1);
    assert.equal(p.runtime_version, "fixture"); assert.equal(p.device, "cpu");
    assert.deepEqual(p.capabilities, ["train"]);
    for (const field of ["python", "interpreter", "prefix", "base_prefix"]) assert(typeof p[field] === "string" && p[field].length > 0);
    assert.equal(p.container, null); assert.deepEqual(p.allocated_devices, []);
  }
  return event;
}
function assets(value) {
  object(value); assert.match(value.manifestSha256, sha); object(value.assets);
  assert.equal(Object.keys(value.assets).length, packagedAssetCount);
  for (const [path, hash] of Object.entries(value.assets)) {
    assert(path && !path.startsWith("/") && path.split("/").every((part) => part && part !== "." && part !== ".."));
    assert.match(hash, sha);
  }
}
export function verifyJournalFaultBrowserReport(report) {
  object(report); clean(report);
  assert.equal(report.status, "passed");
  assert.equal(report.scope, "real-browser-journal-byte-faults");
  assert.equal(report.limitation, limitation);
  assert.equal(report.driverReadinessMode, "sync-exposure-poll-and-two-controller-dom-observations");
  object(report.browser);
  assert(typeof report.browser.version === "string" && /^agent-browser \d+\.\d+\.\d+/.test(report.browser.version));
  assert(typeof report.browser.userAgent === "string" && /(?:Headless)?Chrome\/\d+/.test(report.browser.userAgent));
  assets(report.assetPreflight); assets(report.assetPostflight);
  assert.deepEqual(report.assetPostflight, report.assetPreflight, "Packaged assets changed");
  assert(Array.isArray(report.snapshots)); assert.equal(report.snapshots.length, 4);
  const initial = report.snapshots[0]; object(initial);
  assert.match(initial.fixtureId, uuid);
  const identities = new Set([initial.fixtureId]);
  const baseline = new Map();
  let lastLaps = -1, lastAt = -1;
  report.snapshots.forEach((snapshot, phase) => {
    assert.equal(snapshot.scope, "real-journal-bytes"); assert.equal(snapshot.limitation, limitation);
    assert.equal(snapshot.fixtureId, initial.fixtureId); assert.equal(snapshot.phase, phase);
    integer(snapshot.laps); integer(snapshot.phaseStartLaps);
    assert(snapshot.phaseStartLaps >= lastLaps && snapshot.laps >= snapshot.phaseStartLaps + 3);
    assert(typeof snapshot.atMs === "number" && Number.isFinite(snapshot.atMs) && snapshot.atMs > lastAt);
    lastLaps = snapshot.laps; lastAt = snapshot.atMs;
    object(snapshot.cases); assert.deepEqual(Object.keys(snapshot.cases).sort(), [...faults].sort());
    for (const fault of faults) {
      const c = snapshot.cases[fault]; object(c);
      for (const field of ["runId", "planId", "requestId"]) {
        assert.match(c[field], uuid);
        if (phase === 0) { assert(!identities.has(c[field]), "Identity collision"); identities.add(c[field]); }
        else assert.equal(c[field], baseline.get(fault)[field], "Identity changed across phases");
      }
      const recovered = phase >= 2 && fault === "torn-tail", seq = Number(recovered);
      const state = recovered ? "completed" : "terminal_unknown";
      const j = c.journal; object(j);
      const raw = hex(j.rawHex), completion = hex(j.completionHex, 4096);
      integer(j.bytes, 1); integer(j.prefixBytes, 1); integer(j.damagedBytes, 1);
      assert.equal(j.bytes, raw.length); assert(j.prefixBytes < raw.length);
      const prefix = raw.subarray(0, j.prefixBytes);
      assert.equal(j.sha256, digest(raw)); assert.equal(j.prefixSha256, digest(prefix));
      const hello = envelope(prefix, c.runId, "hello", 0);
      const exit = envelope(completion, c.runId, "exit", 1);
      const damage = fault.endsWith("-tail") && !fault.startsWith("oversized") ? completion.subarray(0, Math.floor(completion.length / 2)) : fault === "oversized-line" ? Buffer.concat([Buffer.alloc(65536, 120), Buffer.from("\n"), completion]) : Buffer.alloc(65536, 120);
      assert.equal(j.damagedBytes, damage.length);
      assert.equal(j.faultSha256, digest(Buffer.concat([prefix, damage])));
      assert.deepEqual(raw, Buffer.concat([prefix, recovered ? completion : damage]), "Fault bytes differ from exact framing operation");
      if (phase === 0) baseline.set(fault, structuredClone(c));
      else {
        const first = baseline.get(fault);
        for (const field of ["prefixBytes", "prefixSha256", "completionHex", "damagedBytes", "faultSha256"]) assert.deepEqual(j[field], first.journal[field]);
        assert.deepEqual(prefix, hex(first.journal.rawHex).subarray(0, first.journal.prefixBytes));
        if (!recovered) assert.deepEqual(j, first.journal, "Damaged journal rewritten");
        else assert(raw.subarray(0, first.journal.bytes).equals(hex(first.journal.rawHex)), "Recovery must append only");
      }
      assert.deepEqual(c.events, recovered ? [hello, exit] : [hello]);
      assert.deepEqual(c.cursors, [[1, seq]]);
      assert.deepEqual(c.registry, { state: recovered ? "completed" : "running", eventCount: 1 + seq, attempt: 1 });
      const view = c.publicRunView; object(view);
      const execution = c.execution; object(execution);
      for (const value of [view, execution]) {
        assert.equal(value.run_id, c.runId); assert.equal(value.plan_id, c.planId); assert.equal(value.request_id, c.requestId);
        assert.equal(value.backend, "local"); assert.equal(value.attempt, 1);
        assert.equal(value.submission_requested, true); assert.equal(value.cancellation_requested, false);
      }
      assert.equal(view.state, state); assert.equal(view.uncertainty, !recovered); assert.equal(view.operation, "train");
      object(view.evidence); assert.equal(view.evidence.confidence, recovered ? "confirmed" : "unconfirmed");
      object(view.evidence.runtime);
      assert.equal(view.evidence.runtime.hello_seen, true);
      assert.equal(view.evidence.runtime.exit_seq, recovered ? 1 : -1);
      assert.equal(execution.state, "submitted"); integer(execution.revision, 1);
      object(execution.handle); assert.equal(execution.handle.run_id, c.runId); assert.equal(execution.handle.request_id, c.requestId); assert.equal(execution.handle.attempt, 1);
      object(execution.observation); assert.equal(execution.observation.status, "terminal"); assert.equal(execution.observation.attempt, 1); assert.equal(execution.observation.exit_code, 0);
      const bookmark = c.bookmark; object(bookmark);
      assert.equal(bookmark.run_id, c.runId); assert.equal(bookmark.attempt, 1); assert.equal(bookmark.last_seq, seq);
      assert.equal(bookmark.offset, recovered ? raw.length : prefix.length);
      integer(bookmark.observed_size); assert(bookmark.observed_size >= bookmark.offset && bookmark.observed_size <= raw.length);
      integer(bookmark.malformed_count); assert.equal(bookmark.malformed_count, 0);
      assert.equal(bookmark.private_owner, false); assert.equal(bookmark.historical_hello, false);
      assert(Array.isArray(bookmark.file_identity) && bookmark.file_identity.length === 2); bookmark.file_identity.forEach((n) => integer(n));
      if (phase) assert.deepEqual(bookmark.file_identity, baseline.get(fault).bookmark.file_identity, "Journal inode changed");
    }
    object(snapshot.health);
    const expected = ["oversized-line", "oversized-tail"].map((fault) => ({ source: snapshot.cases[fault].planId, error: "ProtocolError" })).sort((a, b) => a.source.localeCompare(b.source));
    assert.deepEqual(snapshot.health.monitoring_errors, expected, "Actual framing error sources required");
    assert.deepEqual(snapshot.health.registered_backends, ["local"]);
    assert.deepEqual(snapshot.health.restart_monitoring_errors, []); assert.deepEqual(snapshot.health.dispatch_errors, []);
    integer(snapshot.health.filesystem_work_outstanding); integer(snapshot.health.restart_watch_refusals);
  });
  assert(Array.isArray(report.observations)); assert.equal(report.observations.length, 32);
  const seen = new Set();
  for (const o of report.observations) {
    integer(o.phase); assert(o.phase < 4 && faults.includes(o.fault) && (o.repeat === 0 || o.repeat === 1));
    const key = `${o.phase}:${o.fault}:${o.repeat}`; assert(!seen.has(key), "Duplicate DOM observation"); seen.add(key);
    assert.equal(o.runId, baseline.get(o.fault).runId, "DOM selected identity mismatch");
    const recovered = o.phase >= 2 && o.fault === "torn-tail";
    assert.equal(o.badge, recovered ? "completed" : "terminal unknown · uncertain");
    assert.equal(o.emptyMetrics, true); assert.equal(o.uncertain, !recovered);
  }
  const cleanup = report.cleanup; object(cleanup); assert.deepEqual(cleanup.errors, []);
  for (const key of ["browserSessionAbsent", "fixtureReaped", "servicesClosed", "controlDrained", "listenerClosed", "rootRemoved", "profileRemoved", "tokenRemoved", "workspaceRemoved"]) assert.equal(cleanup[key], true, `Missing cleanup: ${key}`);
  assert((cleanup.fixtureExit?.code === 0 && cleanup.fixtureExit.signal === null) || (cleanup.fixtureExit?.code === null && cleanup.fixtureExit.signal === "SIGINT"), "Fixture must exit normally or via SIGINT");
  return { scope: report.scope, faults: [...faults] };
}
export async function verifyJournalFaultBrowserFile(path) {
  assert(typeof path === "string" && path.length > 0, "Report path required");
  const report = json(await boundedFile(path, 4 * 1024 * 1024));
  verifyJournalFaultBrowserReport(report);
  const manifest = await boundedFile(new URL("../src/wavedl_daemon/web_assets/.wavedl-assets.json", import.meta.url).pathname);
  assert.equal(report.assetPreflight.manifestSha256, digest(manifest));
  assert.deepEqual(report.assetPreflight.assets, await packagedAssetHashes(fileURLToPath(new URL("../", import.meta.url))));
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { assert.equal(process.argv.length, 3); await verifyJournalFaultBrowserFile(process.argv[2]); process.stdout.write("Journal fault browser evidence verified\n"); }
  catch (error) { process.stderr.write(`Journal fault evidence rejected: ${error.message}\n`); process.exitCode = 1; }
}
