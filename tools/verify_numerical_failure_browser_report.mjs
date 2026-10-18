import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const unique = (items, key) => assert.equal(new Set(items.map(item => item[key])).size, items.length, `Duplicate ${key}`);
const identity = item => { assert(object(item)); assert(Number.isSafeInteger(item.size) && item.size > 0); assert(digest(item.sha256)); };

// Enumerate actual bytes, including all packaged assets and all harness dependencies.
export async function numericalSourceFingerprint() {
  const entries = {};
  async function walk(relative) {
    for (const name of (await readdir(join(repo, relative))).sort()) {
      if (['node_modules', '.nuxt', '.output', '__pycache__', '.pytest_cache', '.git', 'dist'].includes(name)) continue;
      const path = join(relative, name), info = await lstat(join(repo, path));
      assert(!info.isSymbolicLink(), `Source inventory symlink: ${path}`);
      if (info.isDirectory()) await walk(path);
      else if (info.isFile() && !name.endsWith('.pyc')) entries[path] = hash(await readFile(join(repo, path)));
    }
  }
  for (const directory of ['src/wavedl', 'src/wavedl_daemon', 'web', 'tools']) await walk(directory);
  return Object.fromEntries(Object.entries(entries).sort(([left], [right]) => left.localeCompare(right)));
}

function manifest(plan) { assert(object(plan)); const envelope = JSON.parse(plan.plan_json); return JSON.parse(envelope.manifest_json); }
function runtime(run, failed, python) {
  assert(Array.isArray(run.runtimeEvents) && run.runtimeEvents.length > 0);
  for (const event of run.runtimeEvents) { assert.equal(event.run_id, run.run_id); assert.equal(event.attempt, 1); }
  unique(run.runtimeEvents, 'seq');
  const hello = run.runtimeEvents.filter(event => event.type === 'hello');
  assert.equal(hello.length, 1); assert.equal(hello[0].payload.device, 'cpu');
  assert.equal(hello[0].payload.interpreter, python);
  const exits = run.runtimeEvents.filter(event => event.type === 'exit');
  assert.equal(exits.length, 1); assert.equal(exits[0].payload.status, failed ? 'failed' : 'completed');
  assert.equal(exits[0].payload.code, failed ? 1 : 0);
  assert(run.events.some(event => event.type === 'exit' && event.run_id === run.run_id && event.payload.status === exits[0].payload.status));
  if (failed) {
    assert.equal(run.runtimeEvents.filter(event => event.type === 'error' && event.payload.code === 'OPERATION_FAILED').length, 1);
    assert(!run.runtimeEvents.some(event => ['artifact', 'metric'].includes(event.type)));
    assert(!run.events.some(event => ['artifact', 'metric'].includes(event.type)));
    assert.deepEqual(run.publications, []);
    assert(!Object.keys(run.files).some(path => /(^|\/)(predictions\.csv|COMPLETE\.json)$/.test(path) || path.startsWith('checkpoints/') || path.startsWith('outputs/')));
    assert(!run.directories.some(path => path.startsWith('checkpoints/gen-')));
  }
}

export function verifyNumericalFailureReport(report) {
  assert(object(report)); assert.equal(report.name, 'numerical-failure'); assert.equal(report.status, 'passed');
  for (const key of ['error', 'skip', 'skipped', 'skipReason', 'shutdownError', 'retainedPrivateRoots', 'retainedOwnedPaths', 'explicitFixtureWebAssets']) assert(!Object.hasOwn(report, key));
  assert.equal(report.scope, 'same-host mounted Results CPU numerical-input failure only; not all P3');
  assert.equal(report.bootstrapConsumed, true);
  assert.equal(report.browser.trim(), 'agent-browser 0.26.0');
  assert.equal(report.profileInitiallyEmpty, true);
  assert.match(report.browserRuntime.userAgent, /(?:Headless)?Chrome\/\d+/);
  assert.equal(report.browserRuntime.width, 1280); assert.equal(report.browserRuntime.height, 900);
  assert(uuid(report.sourceRunId)); assert(digest(report.assetManifestSha256));
  assert.match(report.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert(report.selected.label.endsWith('best')); assert.match(report.selected.value, /^gen-[0-9]{6,}$/);
  assert(object(report.sourcesBefore) && Object.keys(report.sourcesBefore).length > 100);
  assert.deepEqual(report.sourcesAfter, report.sourcesBefore);
  for (const value of Object.values(report.sourcesBefore)) assert(digest(value));
  assert(Object.hasOwn(report.sourcesBefore, 'tools/verify_numerical_failure_browser_report.test.mjs'));
  assert(Object.hasOwn(report.sourcesBefore, 'src/wavedl/test.py'));
  assert(Object.hasOwn(report.sourcesBefore, 'src/wavedl_daemon/web_assets/.wavedl-assets.json'));
  assert.deepEqual(report.cases.map(item => item.name), ['nan', 'inf', 'empty']);
  assert.deepEqual(Object.keys(report.datasets).sort(), ['empty', 'inf', 'nan']);
  for (const name of ['nan', 'inf', 'empty']) {
    const data = report.datasets[name]; identity(data); assert.deepEqual(data.keys, ['X']);
    assert.deepEqual(data.shape, name === 'empty' ? [0, 32] : [4, 32]);
    assert.equal(data.nanCount, name === 'nan' ? 1 : 0); assert.equal(data.infCount, name === 'inf' ? 1 : 0);
  }
  const before = report.before, after = report.after;
  for (const snapshot of [before, after, ...report.cases.map(item => item.durable)]) {
    for (const key of ['runs', 'plans', 'control', 'executions']) { assert(Array.isArray(snapshot[key])); unique(snapshot[key], key === 'runs' ? 'run_id' : 'plan_id'); }
    assert(Array.isArray(snapshot.provenance)); unique(snapshot.provenance, 'run_id');
    assert.equal(snapshot.provenance.length, snapshot.runs.length);
    for (const row of snapshot.provenance) {
      const run = snapshot.runs.find(item => item.run_id === row.run_id);
      assert(run); assert.equal(row.attempt, 1);
      assert.deepEqual(JSON.parse(row.event_json), run.runtimeEvents.find(event => event.type === 'hello'));
      assert.equal(manifest(snapshot.plans.find(plan => plan.plan_id === row.plan_id)).run_id, row.run_id);
    }
    assert(snapshot.control.every(item => item.submission_requested === 1 && item.cancellation_requested === 0));
    assert(snapshot.executions.every(item => item.attempt === 1 && item.cancel_delivered === 0));
    assert.deepEqual(new Set(snapshot.plans.map(plan => plan.plan_id)), new Set(snapshot.control.map(plan => plan.plan_id)));
    assert.deepEqual(new Set(snapshot.plans.map(plan => plan.plan_id)), new Set(snapshot.executions.map(plan => plan.plan_id)));
  }
  assert.equal(before.runs.length, 1); assert.equal(before.plans.length, 1);
  assert.equal(after.runs.length, 4); assert.equal(after.plans.length, 4);
  const source = before.runs[0]; assert.equal(source.run_id, report.sourceRunId); assert.equal(source.state, 'completed'); assert.equal(source.manifest.operation, 'train');
  const trainManifest = manifest(before.plans[0]); assert.equal(trainManifest.run_id, report.sourceRunId); assert.equal(trainManifest.operation, 'train');
  runtime(source, false, trainManifest.runtime.python);
  assert(source.runtimeEvents.some(event => event.type === 'metric'));
  const publication = source.publications.find(item => item.generation === report.selected.value);
  assert(publication && digest(publication.completeSha256)); assert.equal(publication.complete.run_id, source.run_id);
  assert.equal(publication.complete.manifest_sha256, source.files['manifest.json'].sha256);
  assert.equal(publication.selectionMetadata.kind, 'best');
  assert(Object.hasOwn(publication.verifiedFiles, 'checkpoint_selection.json'));
  assert.deepEqual(publication.complete.files, publication.verifiedFiles);
  assert(Object.keys(publication.verifiedFiles).some(name => /(?:\.pth|pytorch_model\.bin)$/.test(name))); assert(Object.hasOwn(publication.verifiedFiles, 'scaler.pkl'));
  for (const [name, wanted] of Object.entries(publication.verifiedFiles)) { identity(wanted); assert.deepEqual(source.files[`checkpoints/${publication.generation}/${name}`], wanted); }
  assert.equal(source.files[`checkpoints/${publication.generation}/COMPLETE.json`].sha256, publication.completeSha256);
  const runIds = [source.run_id];
  for (const [index, item] of report.cases.entries()) {
    const approved = item.approved; assert.equal(approved.operation, 'test'); assert(uuid(approved.run_id)); runIds.push(approved.run_id);
    assert.equal(approved.checkpoint_source.run_id, source.run_id); assert.equal(approved.checkpoint_source.generation, report.selected.value);
    assert.equal(approved.checkpoint_source.manifest_sha256, source.files['manifest.json'].sha256);
    assert.equal(approved.checkpoint_source.complete_sha256, publication.completeSha256);
    assert.equal(approved.resolved_config.save_predictions, true);
    assert.equal(basename(approved.resolved_config.data_path), `${item.name}.npz`);
    const snapshot = item.durable; assert.equal(snapshot.runs.length, index + 2); assert.equal(snapshot.plans.length, index + 2);
    assert.deepEqual(snapshot.runs.find(run => run.run_id === source.run_id).files, source.files);
    assert.deepEqual(snapshot.runs.find(run => run.run_id === source.run_id).publications, source.publications);
    const plan = snapshot.plans.find(row => manifest(row).run_id === approved.run_id); assert(plan); assert(uuid(plan.request_id));
    assert.deepEqual(manifest(plan), approved);
    const request = JSON.parse(plan.request_payload_json);
    assert.equal(request.operation, 'test'); assert.equal(request.backend, 'local');
    assert.equal(request.runtime.python, approved.runtime.python); assert.equal(request.runtime.device, 'cpu');
    assert.equal(request.config.data_path, approved.resolved_config.data_path); assert.equal(request.config.save_predictions, true);
    for (const key of ['run_id', 'generation']) assert.equal(request.checkpoint_source[key], approved.checkpoint_source[key]);
    const execution = snapshot.executions.find(row => row.plan_id === plan.plan_id); assert(execution && execution.state === 'submitted');
    const observation = JSON.parse(execution.latest_observation_json ?? execution.observation_json);
    assert.equal(observation.status, 'terminal'); assert.equal(observation.exit_code, 1);
    const run = snapshot.runs.find(row => row.run_id === approved.run_id); assert(run && run.manifest.operation === 'test' && run.state === 'failed');
    assert.deepEqual(run.manifest, approved); runtime(run, true, approved.runtime.python);
    assert.equal(item.ui.selectedRunId, approved.run_id); assert.equal(item.ui.state, 'failed');
    assert.equal(item.ui.errorMessage, run.runtimeEvents.find(event => event.type === 'error' && event.payload.code === 'OPERATION_FAILED').payload.message);
    assert.match(item.ui.errorMessage, item.name === 'empty' ? /require nonempty input data/ : /predictions contain nonfinite values/);
    assert(item.ui.text.includes(approved.run_id) && /failed/i.test(item.ui.text) && item.ui.text.includes(item.ui.errorMessage)); assert(Number.isSafeInteger(item.ui.atMs));
    assert(Array.isArray(item.wire) && item.wire.length > 0);
    const failed = item.wire.filter(row => {
      assert.equal(row.path, `/api/runs/${approved.run_id}`); assert.equal(row.method, 'GET'); assert.equal(row.status, 200);
      assert.equal(row.authenticated, true); assert.equal(row.scoped, true); assert.equal(row.browser, true);
      assert.equal(hash(Buffer.from(row.rawBody)), row.bodySha256);
      const body = JSON.parse(row.rawBody);
      if (body.run_id !== approved.run_id || body.state !== 'failed') return false;
      assert.equal(body.plan_id, plan.plan_id); assert.equal(body.request_id, plan.request_id);
      assert.equal(body.uncertainty, false); assert.equal(body.evidence.confidence, 'confirmed');
      assert.equal(body.evidence.last_observation.exit_code, 1);
      return true;
    }); assert(failed.length > 0, 'Confirmed authenticated browser public FAILED required');
  }
  assert.equal(new Set(runIds).size, 4); assert.deepEqual(new Set(after.runs.map(run => run.run_id)), new Set(runIds));
  assert.deepEqual(after.runs.find(run => run.run_id === source.run_id).files, source.files);
  for (const item of report.cases) assert.deepEqual(after.runs.find(run => run.run_id === item.approved.run_id), item.durable.runs.find(run => run.run_id === item.approved.run_id));
  assert.equal(report.processResults.length, 4); unique(report.processResults, 'runId'); unique(report.processResults, 'pid');
  for (const result of report.processResults) {
    assert(runIds.includes(result.runId)); assert.equal(result.attempt, 1); assert(Number.isInteger(result.pid) && result.pid > 0);
    assert.equal(result.returncode, result.runId === source.run_id ? 0 : 1); assert.equal(result.cancelled, false); assert.equal(result.timedOut, false); assert.equal(result.pidAbsent, true);
    const plan = after.plans.find(row => manifest(row).run_id === result.runId);
    assert.equal(JSON.parse(after.executions.find(row => row.plan_id === plan.plan_id).handle_json).pid, result.pid);
  }
  assert.deepEqual(report.cleanup.errors, []);
  assert.deepEqual(Object.keys(report.cleanup).sort(), ['errors', 'browserSessionAbsent', 'fixtureServicesClosed', 'ownedRootRemoved', 'browserProfileRemoved', 'listenerAbsent', 'fixturePidAbsent', 'tokenRemoved', 'fixtureExit'].sort());
  for (const key of ['browserSessionAbsent', 'fixtureServicesClosed', 'ownedRootRemoved', 'browserProfileRemoved', 'listenerAbsent', 'fixturePidAbsent', 'tokenRemoved']) assert.equal(report.cleanup[key], true);
  assert((report.cleanup.fixtureExit.code === 0 && report.cleanup.fixtureExit.signal === null) || (report.cleanup.fixtureExit.code === null && report.cleanup.fixtureExit.signal === 'SIGINT'));
  return true;
}

export async function verifyNumericalFailureFile(path) {
  assert.equal(basename(path), 'numerical-failure.json');
  path = resolve(path);
  for (let parent = dirname(path); parent !== dirname(parent); parent = dirname(parent)) {
    const info = await lstat(parent); assert(info.isDirectory() && !info.isSymbolicLink());
  }
  const before = await lstat(path); assert(before.isFile() && !before.isSymbolicLink() && before.size > 0 && before.size <= 2 * 1024 * 1024);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes;
  try {
    const opened = await handle.stat();
    for (const field of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) assert.equal(opened[field], before[field]);
    assert(opened.isFile()); bytes = Buffer.alloc(opened.size + 1); let length = 0;
    while (length < bytes.length) { const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null); if (!bytesRead) break; length += bytesRead; }
    assert.equal(length, opened.size);
    const after = await handle.stat(); for (const field of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) assert.equal(after[field], opened[field]);
    bytes = bytes.subarray(0, length);
  } finally { await handle.close(); }
  const report = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  verifyNumericalFailureReport(report);
  assert.deepEqual(report.sourcesAfter, await numericalSourceFingerprint(), 'Not current frozen source/assets/harness');
  assert.equal(report.assetManifestSha256, hash(await readFile(join(repo, 'src/wavedl_daemon/web_assets/.wavedl-assets.json'))));
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await verifyNumericalFailureFile(process.argv[2]); console.log('numerical failure browser report: verified');
}
