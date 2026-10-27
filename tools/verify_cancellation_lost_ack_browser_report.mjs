import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { boundedFile } from './browser_files.mjs';
import { verifySourceSnapshot } from './browser_source_snapshot.mjs';
import { currentAssetDigest } from './verify_adoption_negative_browser_report.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const sha = /^[a-f0-9]{64}$/;
const scope = 'seeded genuine Local CPU runtime; no browser authoring claim';
const harnessPaths = ['tools/run_cancellation_lost_ack_browser_acceptance.mjs', 'tools/browser_daemon_fixture.py', 'tools/verify_cancellation_lost_ack_browser_report.mjs'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const finiteTime = value => assert(Number.isFinite(value) && value > 0, 'Bounded local clock observation required');
const json = text => {
  assert(typeof text === 'string' && Buffer.byteLength(text) <= 65536);
  return JSON.parse(text);
};

export function verifyCancellationLostAckReport(report) {
  assert.equal(report.name, 'cancellation-lost-ack');
  assert.equal(report.status, 'passed');
  assert.equal(report.scope, scope);
  assert.equal(report.clockScope, 'same-host Date.now milliseconds; observations ordered against completed public GETs');
  for (const key of ['error', 'skip', 'skipped', 'skipReason', 'shutdownError', 'retainedPrivateRoots', 'explicitFixtureWebAssets']) assert(!Object.hasOwn(report, key));
  assert.deepEqual(report.cleanup.errors, []);
  for (const key of ['browserSessionAbsent','fixtureServicesClosed','listenerClosed','wireFrozenAfterShutdown','ownedPrivateRootsRemoved']) assert.equal(report.cleanup[key], true);
  for (const key of ['browserProfileRemoved', 'privateCredentialRemoved']) assert.equal(report.cleanup[key], true);
  assert((report.cleanup.fixtureExit.code === 0 && report.cleanup.fixtureExit.signal === null) || (report.cleanup.fixtureExit.code === null && report.cleanup.fixtureExit.signal === 'SIGINT'));
  assert.equal(report.browser.initialProfileEmpty, true);
  assert.match(report.browser.session, /^wavecancel-[a-f0-9]{8}$/);
  assert.equal(report.browser.engine, 'chrome');
  assert.equal(report.browser.version, 'agent-browser 0.26.0');
  assert.match(report.browser.userAgent, /Chrome\/[0-9]+/);
  assert.equal(report.browser.width, 1280);
  assert.equal(report.browser.height, 900);
  for (const key of ['startedAtMs', 'connectedAtMs', 'clickedAtMs', 'closedAtMs']) finiteTime(report.browser[key]);
  assert(report.browser.startedAtMs <= report.browser.connectedAtMs && report.browser.connectedAtMs <= report.browser.clickedAtMs && report.browser.clickedAtMs <= report.browser.closedAtMs);
  assert.match(report.fingerprints.assetManifestSha256, sha);
  assert(Object.keys(report.fingerprints.assets).length >= 20);
  assert(Object.keys(report.fingerprints.sources).length >= 20);
  for (const map of [report.fingerprints.assets, report.fingerprints.sources]) for (const hash of Object.values(map)) assert.match(hash, sha);
  assert.deepEqual(Object.keys(report.fingerprints.harnessSources).sort(), [...harnessPaths].sort());
  for (const hash of Object.values(report.fingerprints.harnessSources)) assert.match(hash, sha);
  assert.deepEqual(report.fingerprintsAfter, report.fingerprints);
  assert.match(report.manifestSha256, sha);
  const { runId, planId, requestId } = report.identity;
  for (const id of [runId,planId,requestId]) assert.match(id, uuid);
  assert.equal(report.manifest.run_id, runId);
  assert.equal(report.manifest.operation, 'train');
  assert.equal(report.manifest.runtime.device, 'cpu');
  for (const snapshot of [report.before, report.after]) {
    for (const key of ['runs','plans','controls','executions']) assert.equal(snapshot[key].length, 1);
    assert.equal(snapshot.plans[0].plan_id,planId);
    assert.equal(snapshot.plans[0].request_id,requestId);
    assert.equal(snapshot.runs[0].run_id,runId);
    assert.equal(snapshot.controls[0].plan_id,planId);
    assert.equal(snapshot.executions[0].plan_id,planId);
    assert.equal(snapshot.controls[0].submission_requested,1);
  }
  assert.deepEqual(report.after.plans,report.before.plans);
  const plan = JSON.parse(report.before.plans[0].plan_json);
  assert.equal(plan.target, 'local');
  assert.deepEqual(JSON.parse(plan.manifest_json), report.manifest);
  assert.equal(report.manifestSha256, createHash('sha256').update(plan.manifest_json).digest('hex'));
  assert.equal(report.before.controls[0].cancellation_requested,0);
  assert.equal(report.after.controls[0].cancellation_requested,1);
  assert.equal(report.before.executions[0].cancel_delivered,0);
  assert.equal(report.after.executions[0].cancel_delivered,1);
  assert(['running', 'cancelled'].includes(report.after.runs[0].state), 'Raw runtime projection is not native cancellation authority');
  assert.equal(report.before.runs[0].state, 'running');
  assert.equal(report.acknowledgedUi.disabled,true);
  assert(report.acknowledgedUi.status.some(text=>text.includes('Cancellation: requested')));
  assert(Array.isArray(report.wire) && report.wire.length > 0 && report.wire.length <= 4096);
  for (const [index, item] of report.wire.entries()) {
    assert.equal(item.sequence, index + 1, 'Wire must be an ordered gap-free prefix');
    finiteTime(item.atMs);
    if (index) assert(item.atMs >= report.wire[index - 1].atMs);
    assert.equal(typeof item.browser, 'boolean');
    assert.equal(item.bodySha256, digest(item.rawBody));
    assert.equal(item.bodyBytes, Buffer.byteLength(item.rawBody));
    assert.equal(item.deliveredBodySha256, digest(item.deliveredRawBody));
    assert.equal(item.deliveredBodyBytes, Buffer.byteLength(item.deliveredRawBody));
    if (item.originalStatus !== item.deliveredStatus) assert.equal(item.method, 'POST');
  }
  const cancels=report.wire.filter(item=>item.method==='POST'&&item.path===`/api/runs/${runId}/cancel`);
  assert.equal(cancels.length,1,'Repeated clicks must not issue another cancellation POST');
  const cancel=cancels[0];
  assert.equal(cancel.originalStatus,202);
  assert.equal(cancel.deliveredStatus,503);
  assert.equal(cancel.authenticated,true);
  assert.equal(cancel.scoped,true);
  assert.equal(cancel.browser, true);
  assert.equal(cancel.deliveredRawBody, '');
  assert(cancel.atMs >= report.browser.clickedAtMs && cancel.atMs <= report.browser.closedAtMs);
  const committed=JSON.parse(cancel.rawBody);
  assert.equal(committed.cancellation_requested,true);
  for (const value of [committed,report.rawBefore.body,report.rawAfter.body]) {
    assert.equal(value.run_id,runId);assert.equal(value.plan_id,planId);assert.equal(value.request_id,requestId);
  }
  assert.equal(report.rawBefore.status,200);
  assert.equal(report.rawBefore.body.state,'running');
  assert.equal(report.rawBefore.body.cancellation_requested,false);
  assert.equal(report.rawAfter.status,200);
  assert.equal(report.rawAfter.body.state,'cancelled');
  assert.equal(report.rawAfter.body.cancellation_requested,true);
  assert.equal(report.rawAfter.body.uncertainty, false);
  for (const body of [report.rawBefore.body, report.rawAfter.body, committed]) {
    assert.equal(body.backend, 'local'); assert.equal(body.operation, 'train'); assert.equal(body.attempt, 1);
  }
  for (const raw of [report.rawBefore,report.rawAfter]) assert.deepEqual(JSON.parse(raw.rawBody),raw.body);
  for (const raw of [report.rawBefore, report.rawAfter]) {
    assert.equal(raw.bodySha256, digest(raw.rawBody));
    assert.equal(raw.bodyBytes, Buffer.byteLength(raw.rawBody));
    assert(report.wire.some(item => item.method === 'GET' && item.originalStatus === 200 && item.rawBody === raw.rawBody && item.browser === false), 'Raw probe must bind recorded GET bytes');
  }
  const preProbe = report.wire.find(item => item.method === 'GET' && item.browser === false && item.rawBody === report.rawBefore.rawBody);
  const postProbe = report.wire.find(item => item.method === 'GET' && item.browser === false && item.rawBody === report.rawAfter.rawBody);
  assert(preProbe.sequence < cancel.sequence && postProbe.sequence > cancel.sequence);
  const polls=report.wire.filter(item=>item.method==='GET'&&item.path===`/api/runs/${runId}`&&item.sequence>cancel.sequence&&item.originalStatus===200);
  assert(polls.length>0,'Suppressed ACK must be recovered via real GET');
  assert(polls.every(item=>item.authenticated&&item.scoped));
  assert(polls.some(item=>JSON.parse(item.rawBody).cancellation_requested===true));
  assert(report.wire.every(item => item.method === 'GET' || item === cancel), 'No other mutation allowed');
  const runResponses = report.wire.filter(item => item.path === `/api/runs/${runId}/cancel` || item.path === `/api/runs/${runId}`);
  let attemptBound = false;
  for (const item of runResponses) {
    const body = json(item.rawBody);
    for (const [key, value] of Object.entries({run_id: runId, plan_id: planId, request_id: requestId})) assert.equal(body[key], value);
    assert.equal(body.backend, 'local'); assert.equal(body.operation, 'train');
    if (body.attempt === null) {
      assert.equal(attemptBound, false, 'Confirmed runtime attempt cannot revert to unbound');
      assert.equal(item.method, 'GET');
      assert.equal(item.originalStatus, 200, 'Unbound prefix requires a successful public GET');
      assert(item.sequence < preProbe.sequence && item.sequence < cancel.sequence, 'Unbound observation must precede the confirmed pre-cancel probe');
      const nativeRunning = body.state === 'running';
      if (!nativeRunning) assert(body.state === 'submission_unknown' || body.state === 'observation_unavailable', 'Unbound prefix requires an unconfirmed submission or unavailable observation');
      assert.equal(body.uncertainty, !nativeRunning);
      assert.equal(body.cancellation_requested, false);
      assert.equal(body.evidence.current_runtime_attempt, null);
      assert.equal(body.evidence.last_runtime_attempt, null);
      assert.equal(body.evidence.confidence, nativeRunning ? 'confirmed' : 'unconfirmed');
      assert.equal(body.evidence.runtime.hello_seen, false);
      assert.equal(body.evidence.runtime.state, null);
      assert.equal(body.evidence.runtime.exit_seq, -1);
      assert.equal(body.evidence.runtime.outcome, null);
      if (nativeRunning) {
        // A local owned submission can be executing before its writer binds a
        // runtime attempt. This confirms native execution, never runtime hello.
        assert.equal(body.evidence.native_pending, false);
        assert.equal(body.evidence.native_identity, null);
        assert.deepEqual(body.evidence.runtime, { hello_seen: false, state: null,
          state_seq: -1, exit_seq: -1, outcome: null, conflicting_exits: false });
        assert.deepEqual(body.evidence.backend, { status: 'running', native_state: null,
          exit_code: null, signal: null, detail: '', batch: null, stage_out: null,
          native_identity: null });
      } else assert.equal(body.evidence.backend, null);
    } else {
      assert.equal(body.attempt, 1);
      attemptBound = true;
    }
    assert.equal(item.authenticated, true); assert.equal(item.scoped, true);
    if (item !== cancel) { assert.equal(item.deliveredStatus, item.originalStatus); assert.equal(item.deliveredRawBody, item.rawBody); }
  }
  assert(polls.some(item => item.browser === true && JSON.parse(item.rawBody).cancellation_requested === true), 'Browser public GET must recover the lost ACK');
  const recovered = polls.find(item => item.browser === true && item.deliveredStatus === 200 && JSON.parse(item.rawBody).cancellation_requested === true);
  assert(recovered);
  const terminal=polls.find(item=>item.browser===true&&item.deliveredStatus===200&&JSON.parse(item.rawBody).state==='cancelled');
  assert(terminal);
  const terminalBody = json(terminal.rawBody);
  assert.equal(terminalBody.uncertainty, false);
  assert.equal(terminalBody.evidence.backend.status, 'terminal');
  assert.equal(terminalBody.evidence.backend.native_state, 'CANCELLED');
  assert(Number.isInteger(terminalBody.evidence.backend.exit_code));
  assert(report.uiTimeline.some(item=>item.state==='running'));
  assert(report.uiTimeline.some(item=>item.state==='cancelled'));
  assert(Array.isArray(report.uiTimeline) && report.uiTimeline.length <= 256);
  for (const [index, item] of report.uiTimeline.entries()) {
    finiteTime(item.atMs);
    assert(item.atMs >= report.browser.connectedAtMs && item.atMs <= report.browser.closedAtMs);
    if (index) assert(item.atMs >= report.uiTimeline[index - 1].atMs);
    if (item.status?.some(text => text.includes('Cancellation: requested'))) {
      assert.equal(item.disabled, true);
      assert(item.atMs >= Math.floor(recovered.atMs), 'Acknowledged UI requires a recovered public GET prefix');
    }
  }
  assert(report.uiTimeline.every(item=>item.state!=='cancelled'||item.atMs>=Math.floor(terminal.atMs)),'Same-host wall-clock DOM observation must follow real terminal GET');
  assert.equal(report.runtime.pid,JSON.parse(report.before.executions[0].handle_json).pid);
  const handle = JSON.parse(report.before.executions[0].handle_json);
  assert.equal(handle.backend, 'local'); assert.equal(handle.attempt, 1);
  assert.equal(handle.run_id, runId); assert.equal(handle.request_id, requestId);
  assert.equal(handle.run_dir, report.manifest.run_directory);
  const attestation = JSON.parse(handle.raw_json).runtime_attestation;
  assert.equal(attestation.run_id, runId); assert.equal(attestation.request_id, requestId);
  assert.equal(attestation.plan_sha256, digest(report.before.plans[0].plan_json));
  assert.equal(attestation.selected_python, report.manifest.runtime.python);
  assert.equal(attestation.identity.interpreter, report.manifest.runtime.python);
  assert.equal(attestation.supervisor_id, handle.supervisor_id);
  assert.equal(attestation.owner, handle.owner);
  assert(Number.isSafeInteger(report.runtime.pid) && report.runtime.pid > 0);
  assert.deepEqual(JSON.parse(report.after.executions[0].handle_json), JSON.parse(report.before.executions[0].handle_json));
  assert.equal(report.runtime.pidAbsent,true);
  assert.deepEqual(report.runtime.attempts,['1']);
  const hello=report.startedRuntime.find(e=>e.type==='hello');
  assert.equal(hello.run_id,runId);assert.equal(hello.attempt,1);assert.equal(hello.payload.device,'cpu');
  assert.equal(hello.payload.interpreter,report.manifest.runtime.python);
  assert(report.runtime.events.every(e=>e.run_id===runId&&e.attempt===1));
  assert.deepEqual(report.runtime.events.slice(0, report.startedRuntime.length), report.startedRuntime);
  assert(report.runtime.events.length >= 1 && report.runtime.events.length <= 4096);
  assert(report.startedRuntime.every(e => e.run_id === runId && e.attempt === 1));
  assert.equal(report.rawAfter.body.evidence.backend.status,'terminal');
  assert.equal(report.rawAfter.body.evidence.backend.native_state,'CANCELLED');
  assert(Number.isInteger(report.rawAfter.body.evidence.backend.exit_code));
  const observation = JSON.parse(report.after.executions[0].latest_observation_json);
  for (const key of ['attempt', 'status', 'native_state', 'exit_code']) assert.equal(observation[key], report.rawAfter.body.evidence.backend[key]);
  assert.deepEqual(report.nativeOutcome, {status:'terminal',nativeState:'CANCELLED',exitCode:observation.exit_code,pid:report.runtime.pid,pidAbsent:true});
  const exit = report.runtime.events.find(event => event.type === 'exit');
  assert.equal(report.runtimeOutcome, exit ? exit.payload.status : 'unknown');
  assert.equal(report.limitation, 'Same-host wall-clock DOM observations are bounded against completed public GETs, not a complete causal proof. Runtime journal outcome is independent of native cancellation; absent exit means unknown. No browser authoring, scheduler, remote, GPU, Windows or site certification.');
  return true;
}

export async function verifyCancellationLostAckFile(path) {
  const bytes = await boundedFile(path, 2 * 1024 * 1024);
  const report = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  verifyCancellationLostAckReport(report);
  assert.equal(report.fingerprints.assetManifestSha256, await currentAssetDigest());
  const manifest = await boundedFile(fileURLToPath(new URL('../src/wavedl_daemon/web_assets/.wavedl-assets.json', import.meta.url)), 1024 * 1024);
  assert.deepEqual(report.fingerprints.assets, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifest)));
  await verifySourceSnapshot(report.fingerprints.sources, fileURLToPath(new URL('..', import.meta.url)));
  for (const name of harnessPaths) assert.equal(report.fingerprints.harnessSources[name], digest(await boundedFile(fileURLToPath(new URL(`../${name}`, import.meta.url)), 1024 * 1024)), `Current gate source differs: ${name}`);
  return report;
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  assert(process.argv[2], 'Usage: verify_cancellation_lost_ack_browser_report.mjs REPORT_FILE');
  await verifyCancellationLostAckFile(process.argv[2]);
  console.log('cancellation lost-ACK report: verified');
}
