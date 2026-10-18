import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, symlink, writeFile, rm, readdir, readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verifyCancellationLostAckFile, verifyCancellationLostAckReport } from "./verify_cancellation_lost_ack_browser_report.mjs";
import { currentAssetDigest } from "./verify_adoption_negative_browser_report.mjs";

const digest = value => createHash("sha256").update(value).digest("hex");
const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const planId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const requestId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const path = `/api/runs/${runId}`;
const repository = fileURLToPath(new URL("..", import.meta.url));

test("CI preserves twelve cases and requires additive cancellation evidence", async () => {
  const workflow = await readFile(join(repository, ".github/workflows/daemon-browser-integration.yml"), "utf8");
  for (const name of [
    "tools/run_cancellation_lost_ack_browser_acceptance.mjs",
    "tools/verify_cancellation_lost_ack_browser_report.mjs",
    "tools/verify_cancellation_lost_ack_browser_report.test.mjs",
    "unit_tests/test_cancellation_ack_fault.py",
  ]) assert.equal(workflow.split(`- "${name}"`).length - 1, 2);
  assert(workflow.includes("run: node tools/run_web_acceptance.mjs"));
  assert(workflow.includes("node --test tools/verify_cancellation_lost_ack_browser_report.test.mjs"));
  assert(workflow.includes("python -m pytest unit_tests/test_cancellation_ack_fault.py -q"));
  assert(workflow.includes("run: node tools/run_cancellation_lost_ack_browser_acceptance.mjs"));
  assert(workflow.includes("assert.equal(entries.length, 1"));
  assert(workflow.includes('verifyCancellationLostAckFile(join(process.env.TMPDIR, entries[0].name, "cancellation-lost-ack.json"))'));
  const uploads = workflow.split(/(?=^      - )/m).filter(step =>
    /^        uses: actions\/upload-artifact@[^\s]+$/m.test(step));
  assert.equal(uploads.length, 1, "Exactly one acceptance artifact upload required");
  const upload = uploads[0];
  assert(upload.includes("${{ runner.temp }}/wavedl-browser-ci/wavedl-cancel-ack-*/cancellation-lost-ack.json"));
  assert(!upload.includes("wavedl-cancel-ack-*/**"));
});

const harnessPaths = ['tools/run_cancellation_lost_ack_browser_acceptance.mjs','tools/browser_daemon_fixture.py','tools/verify_cancellation_lost_ack_browser_report.mjs'];
function proof() {
  const manifest = { run_id: runId,operation:'train', run_directory: "/tmp/owned/run", runtime: { device: "cpu", python: "/usr/bin/python3" } };
  const manifestJson = JSON.stringify(manifest);
  const before = { plans: [{ plan_id: planId, request_id: requestId, plan_json: JSON.stringify({ target: "local", manifest_json: manifestJson }) }], runs: [{ run_id: runId, state: "running" }], controls: [{ plan_id: planId, submission_requested: 1, cancellation_requested: 0 }], executions: [{ plan_id: planId, cancel_delivered: 0, handle_json: '{"pid":12345}' }] };
  before.executions[0].handle_json = JSON.stringify({pid:12345,backend:"local",attempt:1,run_id:runId,request_id:requestId,run_dir:manifest.run_directory,supervisor_id:"owned-supervisor",owner:"owned-owner",raw_json:JSON.stringify({runtime_attestation:{run_id:runId,request_id:requestId,plan_sha256:digest(before.plans[0].plan_json),selected_python:manifest.runtime.python,identity:{interpreter:manifest.runtime.python},supervisor_id:"owned-supervisor",owner:"owned-owner"}})});
  const after = structuredClone(before);
  after.runs[0].state = "cancelled";
  after.controls[0].cancellation_requested = after.executions[0].cancel_delivered = 1;
  after.executions[0].latest_observation_json = JSON.stringify({attempt:1,status:"terminal",native_state:"CANCELLED",exit_code:-15});
  const body = { run_id: runId, plan_id: planId, request_id: requestId, backend:"local",operation:"train",attempt:1,uncertainty:false,state: "running", cancellation_requested: false };
  const terminal = { ...body, state: "cancelled", cancellation_requested: true, evidence: { backend: { attempt:1,status: "terminal", native_state: "CANCELLED", exit_code: -15 } } };
  const raw = body => { const rawBody = JSON.stringify(body); return { status: 200, body, rawBody, bodyBytes: Buffer.byteLength(rawBody), bodySha256: digest(rawBody) }; };
  const wire = (sequence, atMs, method, endpoint, body, browser, fault = false) => {
    const rawBody = JSON.stringify(body), deliveredRawBody = fault ? "" : rawBody;
    return { sequence, atMs, method, path: endpoint, originalStatus: method === "POST" ? 202 : 200, deliveredStatus: fault ? 503 : 200, browser, authenticated: true, scoped: true, rawBody, bodyBytes: Buffer.byteLength(rawBody), bodySha256: digest(rawBody), deliveredRawBody, deliveredBodyBytes: Buffer.byteLength(deliveredRawBody), deliveredBodySha256: digest(deliveredRawBody) };
  };
  const hello = { type: "hello", run_id: runId, attempt: 1, payload: { device: "cpu", interpreter: manifest.runtime.python } };
  const fingerprints = { assetManifestSha256: "a".repeat(64), assets: Object.fromEntries(Array.from({length:20}, (_,i)=>[`asset-${i}`, "a".repeat(64)])), sources: Object.fromEntries(Array.from({length:20}, (_,i)=>[`web/source-${i}`, "a".repeat(64)])) };
  fingerprints.harnessSources = Object.fromEntries(harnessPaths.map(name=>[name,'a'.repeat(64)]));
  return { name: "cancellation-lost-ack", status: "passed", scope: "seeded genuine Local CPU runtime; no browser authoring claim", clockScope: "same-host Date.now milliseconds; observations ordered against completed public GETs", limitation:'Same-host wall-clock DOM observations are bounded against completed public GETs, not a complete causal proof. Runtime journal outcome is independent of native cancellation; absent exit means unknown. No browser authoring, scheduler, remote, GPU, Windows or site certification.',runtimeOutcome:'unknown',nativeOutcome:{status:'terminal',nativeState:'CANCELLED',exitCode:-15,pid:12345,pidAbsent:true}, cleanup: { errors: [], browserSessionAbsent: true, fixtureServicesClosed: true, listenerClosed: true, wireFrozenAfterShutdown: true, ownedPrivateRootsRemoved: true, browserProfileRemoved: true, privateCredentialRemoved: true, fixtureExit: { code: 0, signal: null } }, browser: { initialProfileEmpty: true, session: "wavecancel-aaaaaaaa", engine: "chrome",version:'agent-browser 0.26.0', userAgent: "Chrome/130.0", width: 1280, height: 900, startedAtMs: 100, connectedAtMs: 200, clickedAtMs: 400, closedAtMs: 900 }, identity: { runId, planId, requestId }, manifest, manifestSha256: digest(manifestJson), before, after, fingerprints, fingerprintsAfter: structuredClone(fingerprints), acknowledgedUi: { disabled: true, status: ["Cancellation: requested"] }, rawBefore: raw(body), rawAfter: raw(terminal), startedRuntime: [hello], runtime: { pid: 12345, pidAbsent: true, attempts: ["1"], events: [hello] }, wire: [wire(1,300,"GET",path,body,false), wire(2,500,"POST",path+"/cancel",{...body,cancellation_requested:true},true,true), wire(3,600,"GET",path,terminal,true), wire(4,700,"GET",path,terminal,false)], uiTimeline: [{atMs:300,state:"running"},{atMs:650,state:"cancelled"}] };
}

test("accepts internally bound local CPU cancellation proof", () => assert.equal(verifyCancellationLostAckReport(proof()), true));
test("accepts stale running runtime projection with independent confirmed native cancellation", () => {const r=proof();r.after.runs[0].state='running';assert.equal(verifyCancellationLostAckReport(r),true);});

for (const [name, mutate] of [
  ["stale assets after run", r => { r.fingerprintsAfter.assetManifestSha256 = "0".repeat(64); }],
  ["forged manifest", r => { r.manifest.runtime.device = "cuda"; }],
  ["forged plan bytes", r => { r.manifestSha256 = "0".repeat(64); }],
  ["repeated cancellation", r => { r.wire.push(structuredClone(r.wire[1])); }],
  ["other mutation", r => { r.wire[0].method = "DELETE"; }],
  ["probe-only recovery", r => { r.wire[2].browser = false; }],
  ["optimistic terminal UI", r => { r.uiTimeline[1].atMs = 550; }],
  ["forged wire bytes", r => { r.wire[1].bodySha256 = "0".repeat(64); }],
  ["forged raw probe", r => { r.rawAfter.rawBody = "{}"; }],
  ["wire sequence gap", r => { r.wire[2].sequence = 9; }],
  ["foreign run recovery", r => { r.wire[2].path = "/api/runs/foreign"; }],
  ["second attempt", r => { r.runtime.attempts.push("2"); }],
  ["changed journal prefix", r => { r.runtime.events[0].payload.device = "gpu"; }],
  ["missing backend exit code", r => { delete r.rawAfter.body.evidence.backend.exit_code; }],
  ["retained credential", r => { r.cleanup.privateCredentialRemoved = false; }],
  ["abnormal fixture exit", r => { r.cleanup.fixtureExit = {code:1,signal:null}; }],
  ["nonempty initial profile", r => { r.browser.initialProfileEmpty = false; }],
  ["foreign runtime attestation", r => { const h=JSON.parse(r.before.executions[0].handle_json),raw=JSON.parse(h.raw_json); raw.runtime_attestation.run_id=planId; h.raw_json=JSON.stringify(raw); r.before.executions[0].handle_json=r.after.executions[0].handle_json=JSON.stringify(h); }],
  ["optimistic requested acknowledgement", r => { r.uiTimeline[0].status=["Cancellation: requested"]; r.uiTimeline[0].disabled=true; }],
  ["unconfirmed native cancellation", r => { r.rawAfter.body.uncertainty=true; }],
  ["forged native summary", r => { r.nativeOutcome.exitCode=0; }],
  ["optimistic runtime summary", r => { r.runtimeOutcome='cancelled'; }],
]) test(`rejects ${name}`, () => { const r = proof(); mutate(r); assert.throws(() => verifyCancellationLostAckReport(r)); });

async function currentProof() {
  const r = proof(), excluded = new Set(["node_modules", ".nuxt", ".output", ".cache", ".vite", ".vendor-backups", ".git"]);
  const sources = {};
  async function walk(prefix) {
    for (const entry of await readdir(join(repository, prefix), {withFileTypes:true})) {
      if (excluded.has(entry.name) || entry.isSymbolicLink()) continue;
      const name = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(name); else sources[name] = digest(await readFile(join(repository,name)));
    }
  }
  await walk("web");
  for (const name of ["tools/vendor_web_assets.py", "src/wavedl/__init__.py"]) sources[name] = digest(await readFile(join(repository,name)));
  r.fingerprints = {assetManifestSha256:await currentAssetDigest(), assets:JSON.parse(await readFile(join(repository,"src/wavedl_daemon/web_assets/.wavedl-assets.json"))), sources};
  r.fingerprints.harnessSources = Object.fromEntries(await Promise.all(harnessPaths.map(async name=>[name,digest(await readFile(join(repository,name)))])));
  r.fingerprintsAfter = structuredClone(r.fingerprints);
  return r;
}

test("file and CLI guards bind complete current asset/source inventory", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "cancel-ack-file-")));
  try {
    const file = join(root,"report.json"), r = await currentProof();
    await writeFile(file,JSON.stringify(r));
    await verifyCancellationLostAckFile(file);
    const cli = spawnSync(process.execPath, [fileURLToPath(new URL("./verify_cancellation_lost_ack_browser_report.mjs",import.meta.url)),file], {encoding:"utf8"});
    assert.equal(cli.status,0,cli.stderr);
    for (const mutate of [r => {delete r.fingerprints.sources["web/package.json"];},r => {r.fingerprints.sources["web/package.json"]="0".repeat(64);},r => {delete r.fingerprints.assets[Object.keys(r.fingerprints.assets)[0]];},r => {r.fingerprints.assetManifestSha256="0".repeat(64);}]) {
      const broken=structuredClone(r); mutate(broken); broken.fingerprintsAfter=structuredClone(broken.fingerprints);
      await writeFile(file,JSON.stringify(broken)); await assert.rejects(verifyCancellationLostAckFile(file));
      const denied = spawnSync(process.execPath, [fileURLToPath(new URL('./verify_cancellation_lost_ack_browser_report.mjs', import.meta.url)), file], {encoding:'utf8'});
      assert.notEqual(denied.status, 0);
    }
    await writeFile(file,Buffer.from([0x7b,0xff,0x7d])); await assert.rejects(verifyCancellationLostAckFile(file));
    await writeFile(file,""); await assert.rejects(verifyCancellationLostAckFile(file));
    await writeFile(file,Buffer.alloc(2*1024*1024+1)); await assert.rejects(verifyCancellationLostAckFile(file));
    const noArgument = spawnSync(process.execPath, [fileURLToPath(new URL('./verify_cancellation_lost_ack_browser_report.mjs', import.meta.url))], {encoding:'utf8'});
    assert.notEqual(noArgument.status,0); assert.match(noArgument.stderr,/Usage:/);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test("cancellation verifier rejects an incomplete or out-of-scope report", () => {
  assert.throws(() => verifyCancellationLostAckReport({ name: "cancellation-lost-ack", status: "passed" }));
  assert.throws(() => verifyCancellationLostAckReport({ name: "cancellation-lost-ack", status: "passed", scope: "scheduler proof" }));
});

test("cancellation verifier file gate rejects symlink evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "cancel-ack-guard-"));
  try {
    const file = join(root, "report.json");
    await writeFile(file, "{}", { flag: "wx" });
    const link = join(root, "link.json");
    await symlink(file, link);
    await assert.rejects(verifyCancellationLostAckFile(link));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
