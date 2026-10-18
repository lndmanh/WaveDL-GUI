import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, realpath, writeFile, symlink, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { faults, limitation, verifyJournalFaultBrowserReport, verifyJournalFaultBrowserFile } from "./verify_journal_fault_browser_report.mjs";
import { packagedAssetHashes } from "./browser_training_fields_full.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const packagedAssetCount = Object.keys(JSON.parse(await readFile(new URL("../src/wavedl_daemon/web_assets/.wavedl-assets.json", import.meta.url), "utf8"))).length;
const encode = (run_id, type, seq, payload) => Buffer.from(JSON.stringify({ run_id, attempt: 1, type, seq, ts: "2026-10-13T00:00:00Z", payload, protocol: "wavedl-jsonl", version: 1 }) + "\n");
function report(seed = 0) {
  const fixtureId = randomUUID(), cases = {};
  faults.forEach((fault, index) => {
    const runId = randomUUID(), planId = randomUUID(), requestId = randomUUID();
    const prefix = encode(runId, "hello", 0, { protocol_min: 1, protocol_max: 1, runtime_version: "fixture", python: "3.11.8", device: "cpu", capabilities: ["train"], interpreter: "/env/bin/python", prefix: "/env", base_prefix: "/base", container: null, allocated_devices: [] });
    const completion = encode(runId, "exit", 1, { status: "completed", code: 0 });
    const damaged = fault === "oversized-line" ? Buffer.concat([Buffer.alloc(65536, 120), Buffer.from("\n"), completion]) : fault === "oversized-tail" ? Buffer.alloc(65536, 120) : completion.subarray(0, Math.floor(completion.length / 2));
    const raw = Buffer.concat([prefix, damaged]);
    const observation = { attempt: 1, status: "terminal", native_state: "exited", exit_code: 0, signal: null, detail: "", batch: null, stage_out: null };
    cases[fault] = { runId, planId, requestId, journal: { bytes: raw.length, sha256: hash(raw), rawHex: raw.toString("hex"), prefixBytes: prefix.length, prefixSha256: hash(prefix), completionHex: completion.toString("hex"), damagedBytes: damaged.length, faultSha256: hash(raw) }, events: [JSON.parse(prefix)], cursors: [[1, 0]], registry: { state: "running", eventCount: 1, attempt: 1 }, publicRunView: { run_id: runId, plan_id: planId, request_id: requestId, backend: "local", operation: "train", attempt: 1, state: "terminal_unknown", uncertainty: true, submission_requested: true, cancellation_requested: false, evidence: { confidence: "unconfirmed", runtime: { hello_seen: true, exit_seq: -1 }, backend: observation } }, execution: { run_id: runId, plan_id: planId, request_id: requestId, backend: "local", attempt: 1, state: "submitted", submission_requested: true, cancellation_requested: false, revision: 4, handle: { run_id: runId, request_id: requestId, attempt: 1 }, observation }, bookmark: { run_id: runId, attempt: 1, offset: prefix.length, last_seq: 0, file_identity: [17, 100 + index], observed_size: fault.startsWith("oversized") ? prefix.length : raw.length, malformed_count: 0, private_owner: false, historical_hello: false } };
  });
  const snapshots = [0, 1, 2, 3].map((phase) => {
    const copy = structuredClone(cases);
    if (phase >= 2) {
      const c = copy["torn-tail"], prefix = Buffer.from(c.journal.rawHex, "hex").subarray(0, c.journal.prefixBytes), completion = Buffer.from(c.journal.completionHex, "hex"), raw = Buffer.concat([prefix, completion]);
      Object.assign(c.journal, { bytes: raw.length, rawHex: raw.toString("hex"), sha256: hash(raw) });
      c.events.push(JSON.parse(completion)); c.cursors = [[1, 1]]; c.registry = { state: "completed", eventCount: 2, attempt: 1 };
      Object.assign(c.publicRunView, { state: "completed", uncertainty: false }); c.publicRunView.evidence.confidence = "confirmed";
      c.publicRunView.evidence.runtime.exit_seq = 1;
      Object.assign(c.bookmark, { offset: raw.length, observed_size: raw.length, last_seq: 1 });
    }
    return { scope: "real-journal-bytes", limitation, fixtureId, phase, laps: 20 + seed + phase * 7, phaseStartLaps: 17 + seed + phase * 7, atMs: 1791900000000 + seed + phase * 2400, cases: copy, health: { registered_backends: ["local"], monitoring_errors: ["oversized-line", "oversized-tail"].map((fault) => ({ source: copy[fault].planId, error: "ProtocolError" })).sort((a, b) => a.source.localeCompare(b.source)), filesystem_work_outstanding: phase % 2, restart_watch_refusals: 0, restart_monitoring_errors: [], dispatch_errors: [] } };
  });
  const observations = snapshots.flatMap(({ phase }) => faults.flatMap((fault) => [0, 1].map((repeat) => { const recovered = phase >= 2 && fault === "torn-tail"; return { phase, fault, repeat, runId: cases[fault].runId, badge: recovered ? "completed" : "terminal unknown · uncertain", emptyMetrics: true, uncertain: !recovered }; })));
  const asset = { manifestSha256: "a".repeat(64), assets: Object.fromEntries(Array.from({ length: packagedAssetCount }, (_, i) => [`asset-${i}.js`, "b".repeat(64)])) };
  return { status: "passed", scope: "real-browser-journal-byte-faults", limitation, driverReadinessMode: "sync-exposure-poll-and-two-controller-dom-observations", browser: { version: "agent-browser 0.26.0", userAgent: "Mozilla/5.0 HeadlessChrome/140.0.0.0" }, assetPreflight: asset, assetPostflight: structuredClone(asset), snapshots, observations, cleanup: { errors: [], browserSessionAbsent: true, fixtureReaped: true, fixtureExit: { code: 0, signal: null }, servicesClosed: true, controlDrained: true, listenerClosed: true, rootRemoved: true, profileRemoved: true, tokenRemoved: true, workspaceRemoved: true } };
}
function rewriteJournal(c, { prefix, completion, damage } = {}) {
  const j = c.journal;
  prefix ??= Buffer.from(j.rawHex, "hex").subarray(0, j.prefixBytes);
  completion ??= Buffer.from(j.completionHex, "hex");
  damage ??= Buffer.from(j.rawHex, "hex").subarray(j.prefixBytes);
  const raw = Buffer.concat([prefix, damage]);
  Object.assign(j, { rawHex: raw.toString("hex"), bytes: raw.length, sha256: hash(raw), prefixBytes: prefix.length, prefixSha256: hash(prefix), completionHex: completion.toString("hex"), damagedBytes: damage.length, faultSha256: hash(raw) });
}
test("accepts production-shaped UUID/envelope evidence across varied phase timings", () => {
  for (const seed of [0, 13, 71]) assert.equal(verifyJournalFaultBrowserReport(report(seed)).scope, "real-browser-journal-byte-faults");
  const value = report(); value.cleanup.fixtureExit = { code: null, signal: "SIGINT" }; verifyJournalFaultBrowserReport(value);
});
const mutations = {
  "self-consistent non-64KiB damage": (r) => { const c = r.snapshots[0].cases["oversized-tail"]; rewriteJournal(c, { damage: Buffer.alloc(65535, 120) }); },
  "self-consistent altered oversized bytes": (r) => { const c = r.snapshots[0].cases["oversized-line"], damage = Buffer.from(c.journal.rawHex, "hex").subarray(c.journal.prefixBytes); damage[0] = 121; rewriteJournal(c, { damage }); },
  "self-consistent full completion behind abandoned tail": (r) => { const c = r.snapshots[0].cases["abandoned-tail"]; rewriteJournal(c, { damage: Buffer.from(c.journal.completionHex, "hex") }); },
  "boolean HELLO sequence in rehashed prefix": (r) => { const c = r.snapshots[0].cases["torn-tail"], event = structuredClone(c.events[0]); event.seq = false; rewriteJournal(c, { prefix: Buffer.from(JSON.stringify(event) + "\n") }); },
  "foreign completion UUID with correct raw hashes": (r) => { const c = r.snapshots[0].cases["torn-tail"], exit = JSON.parse(Buffer.from(c.journal.completionHex, "hex")); exit.run_id = randomUUID(); const completion = Buffer.from(JSON.stringify(exit) + "\n"); rewriteJournal(c, { completion, damage: completion.subarray(0, Math.floor(completion.length / 2)) }); },
  "duplicate envelope member with correct raw hashes": (r) => { const c = r.snapshots[0].cases["torn-tail"], prefix = Buffer.from(c.journal.rawHex, "hex").subarray(0, c.journal.prefixBytes).toString(); rewriteJournal(c, { prefix: Buffer.from(prefix.replace('"seq":0', '"seq":0,"seq":0')) }); },
  "empty journal": (r) => { r.snapshots[0].cases["torn-tail"].journal = {}; },
  "same UUID for all faults": (r) => { r.snapshots[0].cases["abandoned-tail"].runId = r.snapshots[0].cases["torn-tail"].runId; },
  "cross-kind UUID collision": (r) => { r.snapshots[0].cases["torn-tail"].planId = r.snapshots[0].cases["torn-tail"].runId; },
  "phase regression": (r) => { r.snapshots.reverse(); },
  "phase omission": (r) => { r.snapshots.pop(); },
  "insufficient laps": (r) => { r.snapshots[0].laps = r.snapshots[0].phaseStartLaps + 2; },
  "lap reset": (r) => { r.snapshots[1].phaseStartLaps = 0; },
  "time reversal": (r) => { r.snapshots[1].atMs = r.snapshots[0].atMs; },
  "foreign fixture": (r) => { r.snapshots[1].fixtureId = randomUUID(); },
  "changed identity": (r) => { r.snapshots[1].cases["torn-tail"].requestId = randomUUID(); },
  "wrong cursor": (r) => { r.snapshots[0].cases["oversized-line"].cursors = [[1, 1]]; },
  "string cursor": (r) => { r.snapshots[0].cases["torn-tail"].cursors = [[1, "0"]]; },
  "hidden completion": (r) => { r.snapshots[0].cases["oversized-line"].events.push({}); },
  "duplicate HELLO": (r) => { const c = r.snapshots[1].cases["torn-tail"]; c.events.push(c.events[0]); },
  "invented recovery": (r) => { r.snapshots[2].cases["abandoned-tail"].publicRunView.state = "completed"; },
  "recovery still uncertain": (r) => { r.snapshots[2].cases["torn-tail"].publicRunView.uncertainty = true; },
  "registry false event count": (r) => { r.snapshots[0].cases["torn-tail"].registry.eventCount = 2; },
  "raw hash mismatch": (r) => { r.snapshots[0].cases["torn-tail"].journal.sha256 = "a".repeat(64); },
  "prefix hash mismatch": (r) => { r.snapshots[0].cases["torn-tail"].journal.prefixSha256 = "a".repeat(64); },
  "invalid hex": (r) => { r.snapshots[0].cases["torn-tail"].journal.rawHex += "zz"; },
  "byte count mismatch": (r) => { r.snapshots[0].cases["torn-tail"].journal.bytes++; },
  "damage count mismatch": (r) => { r.snapshots[0].cases["oversized-tail"].journal.damagedBytes--; },
  "JSON skeleton prefix": (r) => { const j = r.snapshots[0].cases["torn-tail"].journal; j.rawHex = Buffer.from("{}\nxxx").toString("hex"); j.bytes = 6; j.prefixBytes = 3; j.sha256 = hash(Buffer.from("{}\nxxx")); j.prefixSha256 = hash(Buffer.from("{}\n")); },
  "bookmark skips damage": (r) => { const c = r.snapshots[0].cases["oversized-line"]; c.bookmark.offset = c.journal.bytes; },
  "journal inode replaced": (r) => { r.snapshots[2].cases["abandoned-tail"].bookmark.file_identity[1]++; },
  "execution foreign handle": (r) => { r.snapshots[0].cases["torn-tail"].execution.handle.run_id = randomUUID(); },
  "execution not terminal": (r) => { r.snapshots[0].cases["torn-tail"].execution.observation.status = "running"; },
  "missing health sources": (r) => { r.snapshots[0].health.monitoring_errors = []; },
  "foreign health source": (r) => { r.snapshots[0].health.monitoring_errors[0].source = randomUUID(); },
  "duplicate health source": (r) => { r.snapshots[0].health.monitoring_errors[1] = r.snapshots[0].health.monitoring_errors[0]; },
  "extra dispatch error": (r) => { r.snapshots[0].health.dispatch_errors.push({ plan_id: randomUUID(), error: "ValueError" }); },
  "missing DOM observation": (r) => { r.observations.pop(); },
  "duplicate DOM observation": (r) => { r.observations[1] = r.observations[0]; },
  "wrong selected DOM identity": (r) => { r.observations[0].runId = randomUUID(); },
  "fabricated DOM completion": (r) => { r.observations[0].badge = "completed"; },
  "metrics populated": (r) => { r.observations[0].emptyMetrics = false; },
  "DOM false certainty": (r) => { r.observations[0].uncertain = false; },
  "no browser runtime": (r) => { r.browser.userAgent = "fabricated"; },
  "changed packaged asset": (r) => { r.assetPostflight.assets["asset-0.js"] = "c".repeat(64); },
  "missing asset inventory": (r) => { r.assetPreflight.assets = {}; },
  "SIGKILL cleanup": (r) => { r.cleanup.fixtureExit = { code: null, signal: "SIGKILL" }; },
  "unclosed listener": (r) => { r.cleanup.listenerClosed = false; },
  "missing cleanup field": (r) => { delete r.cleanup.controlDrained; },
  "cleanup error": (r) => { r.cleanup.errors.push("failed"); },
  "skip marker": (r) => { r.skipReason = "browser unavailable"; },
  "overclaim scope": (r) => { r.limitation = "full F02 certified"; },
  "nonfinite number": (r) => { r.snapshots[0].atMs = Infinity; },
};
for (const [name, mutate] of Object.entries(mutations)) test(`rejects ${name}`, () => { const value = report(); mutate(value); assert.throws(() => verifyJournalFaultBrowserReport(value)); });

test("file guard verifies exact current packaged assets and rejects bad files", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "wavedl-journal-verifier-test-")));
  try {
    const path = join(root, "report.json"), value = report();
    const repo = new URL("../", import.meta.url).pathname;
    value.assetPreflight = { manifestSha256: hash(await readFile(new URL("../src/wavedl_daemon/web_assets/.wavedl-assets.json", import.meta.url))), assets: await packagedAssetHashes(repo) };
    value.assetPostflight = structuredClone(value.assetPreflight);
    await writeFile(path, JSON.stringify(value)); await verifyJournalFaultBrowserFile(path);
    await assert.rejects(verifyJournalFaultBrowserFile(join(root, "missing")));
    await symlink(path, join(root, "link")); await assert.rejects(verifyJournalFaultBrowserFile(join(root, "link")));
    await writeFile(path, Buffer.from([0xff])); await assert.rejects(verifyJournalFaultBrowserFile(path));
    await writeFile(path, "{}"); await assert.rejects(verifyJournalFaultBrowserFile(path));
    await writeFile(path, '{"status":"failed","status":"passed"}'); await assert.rejects(verifyJournalFaultBrowserFile(path), /Duplicate JSON member/);
    await writeFile(path, Buffer.alloc(4 * 1024 * 1024 + 1, 32)); await assert.rejects(verifyJournalFaultBrowserFile(path));
    value.assetPreflight.manifestSha256 = "d".repeat(64); value.assetPostflight = structuredClone(value.assetPreflight);
    await writeFile(path, JSON.stringify(value)); await assert.rejects(verifyJournalFaultBrowserFile(path));
  } finally { await rm(root, { recursive: true, force: true }); }
});
