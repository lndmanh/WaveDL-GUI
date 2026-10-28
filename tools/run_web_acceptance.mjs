#!/usr/bin/env node
import { openPlanDisclosure } from './browser_actions.mjs';
// Real Chromium + vendored static app + real daemon. No API response mocks.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, access, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { authoringParity } from './browser_authoring_parity.mjs';
import { browserPresetImport } from './browser_preset_import.mjs';
import { fullTrainingFields } from './browser_training_fields_full.mjs';
import { trainingValidation } from './browser_training_validation.mjs';
import { submittedPlanProtection } from './browser_submitted_plan_protection.mjs';
import { downloadNameProvenance } from './browser_download_names.mjs';
import { observeCursorStorage } from './browser_cursor_storage.mjs';
import { datasetParity } from './browser_dataset_parity.mjs';
import { openTrainingEditor, editorFieldObservationExpression } from './browser_training_editor.mjs';
import { createBrowserActions, controlExpression, actionableExpression, xpathLiteral, DRIVER_READINESS_MODE, normalizeTrainingFieldLabel } from './browser_actions.mjs';
import { boundedCommand } from './browser_process.mjs';
import { retainFailurePrefixes } from './browser_failure_evidence.mjs';
import { browserLaunchArgs, browserTemporaryEnvironment } from './browser_launch_policy.mjs';
import { acceptanceDiagnostic } from './browser_acceptance_diagnostic.mjs';
import { lostAckBindingReady, verifyLostAckEvidence } from './browser_lost_ack_evidence.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cases = ['baseline', 'detach', 'reload', 'cancel', 'lost-ack', 'artifact-tamper', 'port-reuse', 'live-port-reuse', 'authoring-parity', 'download-names', 'dataset-parity'];
const selected = process.argv.find((arg) => arg.startsWith('--case='))?.slice(7) ?? 'all';
if (selected !== 'all' && ![...cases, 'autoplot-metadata-integrity', 'partial-best-fallback', 'partial-best-refusal', 'preset-import', 'wizard-progression', 'submitted-plan-authoring-protection', 'result-operations', 'onnx-export', 'inference-cancellation', 'cv-parity', 'training-fields-full', 'training-validation'].includes(selected)) throw new Error(`Choose: ${cases.join(', ')}, autoplot-metadata-integrity, partial-best-fallback, partial-best-refusal, preset-import, wizard-progression, submitted-plan-authoring-protection, result-operations, onnx-export, inference-cancellation, cv-parity, training-fields-full, training-validation, all`);
const python = process.env.WAVEDL_PYTHON ?? 'python';
const browser = process.env.AGENT_BROWSER_BIN ?? 'agent-browser';
const browserExecutable = process.env.WAVEDL_BROWSER_EXECUTABLE;
const browserHeaded = process.env.WAVEDL_BROWSER_HEADED === 'true';
if (browserExecutable) await access(browserExecutable);
const fixtureWebAssets = process.env.WAVEDL_BROWSER_ASSETS;
if (fixtureWebAssets) {
  assert(fixtureWebAssets.startsWith('/'), 'Explicit fixture assets must be absolute');
  await access(resolve(fixtureWebAssets, '.wavedl-assets.json'));
}
const version = execFileSync(browser, ['--version'], { encoding: 'utf8', timeout: 35000 }).trim();
const interpreter = execFileSync(python, ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8', timeout: 35000 }).trim();
const workspace = await realpath(await mkdtemp(join(tmpdir(), 'wavedl-browser-acceptance-')));
const evidence = { browser: version, started: new Date().toISOString(), cases: [] };
const active = new Set();
const privateSecrets = new Set();
function sanitizePrivate(value) {
  const redact = (text) => {
    for (const secret of privateSecrets) if (secret) text = text.split(secret).join('[REDACTED]');
    return text;
  };
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(sanitizePrivate);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key), sanitizePrivate(item)]));
  return value;
}
function serializePrivate(value) {
  const serialized = JSON.stringify(sanitizePrivate(value), null, 2);
  assert([...privateSecrets].every((secret) => !secret || !serialized.includes(secret)), 'Private evidence redaction self-check failed');
  return serialized;
}
{
  const sentinel = randomBytes(32).toString('base64url');
  privateSecrets.add(sentinel);
  serializePrivate({ [sentinel]: { token: sentinel, snapshot: `input ${sentinel}`, cleanup: [`message ${sentinel}`], nested: [{ [sentinel]: sentinel }] } });
  privateSecrets.delete(sentinel);
}
let shuttingDown = false;
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

// Outputs are captured in memory, never echoed with argv (bootstrap is secret).
async function command(executable, args, input, timeout = 35000) {
  if (executable === browser) {
    assert(input === undefined || (args.includes('eval') && args.includes('--stdin')), 'Only an explicit browser evaluation may receive stdin');
    const environment = { ...process.env };
    for (const key of Object.keys(environment)) if (key.startsWith('AGENT_BROWSER_')) delete environment[key];
    const sessionFlag = args.indexOf('--session');
    if (sessionFlag >= 0) environment.AGENT_BROWSER_SESSION = args[sessionFlag + 1];
    return boundedCommand(executable, args, { cwd: repo, env: browserTemporaryEnvironment(environment), timeout, input });
  }
  return await new Promise((done, fail) => {
    const environment = { ...process.env };
    if (executable === browser) {
      for (const key of Object.keys(environment)) if (key.startsWith('AGENT_BROWSER_')) delete environment[key];
      const sessionFlag = args.indexOf('--session');
      if (sessionFlag >= 0) environment.AGENT_BROWSER_SESSION = args[sessionFlag + 1];
    }
    const child = spawn(executable, args, { cwd: repo, env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 8 * 1024 * 1024) child.kill('SIGKILL');
    });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-65536); });
    child.on('error', fail);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) done(stdout.trim());
      else fail(new Error(`${executable} ${executable === browser ? args.find((arg) => ['open', 'wait', 'snapshot', 'eval', 'press', 'fill', 'select', 'download', 'network', 'scrollintoview', 'focus', 'click', 'close', 'get', 'set', 'reload', 'mouse'].includes(arg)) : args[0]} failed (${code}); ${stderr.slice(0, 300)}`));
    });
    child.stdin.end(input);
  });
}

async function stop(child, servicesClosed) {
  if (child.exitCode !== null || child.signalCode !== null) {
    if (!servicesClosed()) throw new Error('Fixture exited before confirmed service cleanup; descendants unverified');
    return;
  }
  child.kill('SIGINT');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && child.exitCode === null && child.signalCode === null) await delay(Math.min(100, deadline - Date.now()));
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    const reapDeadline = Date.now() + 3000;
    while (Date.now() < reapDeadline && child.exitCode === null && child.signalCode === null) await delay(Math.min(100, reapDeadline - Date.now()));
    throw new Error('Fixture graceful shutdown exceeded 15 seconds; owned parent was forcibly terminated, descendants unverified');
  }
  if (!servicesClosed()) throw new Error('Fixture shutdown lacks confirmed service cleanup; descendants unverified');
}

async function registry(root, timeout = 35000) {
  const script = `import json, sqlite3, sys
from pathlib import Path
p=Path(sys.argv[1])/"state"/"registry.db"
c=sqlite3.connect(p.resolve().as_uri()+"?mode=ro",uri=True)
c.row_factory=sqlite3.Row
c.execute("BEGIN")
print(json.dumps({"runs":[dict(r) for r in c.execute("SELECT run_id,state FROM runs ORDER BY run_id")],"plans":c.execute("SELECT count(*) FROM plans").fetchone()[0],"control":[dict(r) for r in c.execute("SELECT plan_id,submission_requested,cancellation_requested FROM plan_control ORDER BY plan_id")],"submissions":[dict(r) for r in c.execute("SELECT s.plan_id,s.state,p.request_id,json_extract(json_extract(p.plan_json,'$.manifest_json'),'$.run_id') AS run_id,json_extract(s.submission_handle_json,'$.run_id') AS receipt_run_id,json_extract(s.submission_handle_json,'$.request_id') AS receipt_request_id,json_extract(s.submission_handle_json,'$.supervisor_id') AS supervisor_id,json_extract(s.submission_handle_json,'$.pid') AS pid FROM submission_control s JOIN plans p ON p.plan_id=s.plan_id ORDER BY s.plan_id")],"executions":[dict(r) for r in c.execute("SELECT plan_id,attempt,state,cancel_delivered,json_extract(handle_json,'$.run_id') AS run_id,json_extract(handle_json,'$.request_id') AS request_id,json_extract(handle_json,'$.supervisor_id') AS supervisor_id,json_extract(handle_json,'$.pid') AS pid,coalesce(json_extract(latest_observation_json,'$.status'),json_extract(observation_json,'$.status')) AS observed_status FROM execution_control ORDER BY plan_id")]}))`;
  return JSON.parse(await command(python, ['-c', script, root], undefined, timeout));
}

async function pollRegistry(root, accept, description, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const snapshot = await registry(root, Math.max(1, Math.min(35000, deadline - Date.now())));
    if (Date.now() >= deadline) break;
    if (accept(snapshot)) return snapshot;
    await delay(Math.max(0, Math.min(100, deadline - Date.now())));
  }
  throw new Error(`${description} not confirmed within ${timeout}ms wall-clock deadline`);
}

async function waitRunState(root, state, timeout = 45000) {
  return pollRegistry(root, (snapshot) => {
    if (state === 'running' ? snapshot.executions.some((execution) => execution.observed_status === 'running') : snapshot.runs.some((run) => run.state === state)) return true;
    if (snapshot.runs.some((run) => ['failed', 'cancelled', 'completed'].includes(run.state))) throw new Error(`Run reached terminal state before ${state}: ${JSON.stringify(snapshot.runs)}`);
    return false;
  }, `Daemon ${state}`, timeout);
}

async function authenticatedHealth(origin, token) {
  // Read-only public contract; credentials stay in process memory, never argv.
  const response = await fetch(`${origin}/api/health`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  assert(response.status === 200, 'Same private bearer must authenticate replacement health (401 is not an identity fence)');
  const health = await response.json();
  assert(typeof health.daemon_id === 'string' && typeof health.build_id === 'string', 'Invalid fixture health identity');
  return { daemonId: health.daemon_id, buildId: health.build_id };
}

async function runtimeEvidence(root, runId, timeout = 35000) {
  const script = `import json, sqlite3, sys
from pathlib import Path
root=Path(sys.argv[1]); run_id=sys.argv[2]
c=sqlite3.connect((root/"state"/"registry.db").resolve().as_uri()+"?mode=ro",uri=True); c.row_factory=sqlite3.Row
metric=c.execute("SELECT attempt,seq,event_json FROM event_log WHERE run_id=? AND event_type='metric' ORDER BY attempt,seq LIMIT 1",(run_id,)).fetchone()
counts={kind:c.execute("SELECT count(*) FROM event_log WHERE run_id=? AND event_type=?",(run_id,kind)).fetchone()[0] for kind in ("metric","log")}
handle=c.execute("SELECT json_extract(e.handle_json,'$.pid') AS pid FROM execution_control e JOIN plans p ON p.plan_id=e.plan_id WHERE json_extract(json_extract(p.plan_json,'$.manifest_json'),'$.run_id')=?",(run_id,)).fetchone()
matched=False
if metric:
    producer=json.loads(metric['event_json'])
    with (root/"runs"/run_id/"attempts"/str(metric['attempt'])/"events.jsonl").open('rb') as stream:
        for index in range(1000):
            raw=stream.readline(65537)
            if not raw: break
            if len(raw)>65536: raise ValueError("Journal record exceeds bound")
            if json.loads(raw)==producer: matched=True; break
print(json.dumps({"cursor":{"runId":run_id,"attempt":metric['attempt'],"seq":metric['seq'],"eventType":"metric"} if metric else None,"metrics":counts['metric'],"logs":counts['log'],"journalMatches":matched,"ownedRuntimePid":handle['pid'] if handle else None,"durableCursors":[dict(row) for row in c.execute("SELECT attempt,seq FROM cursors WHERE run_id=?",(run_id,))]}))`;
  return JSON.parse(await command(python, ['-c', script, root, runId], undefined, timeout));
}

async function scenario(name) {
  const record = { name, browser: version, driverReadinessMode: DRIVER_READINESS_MODE, pythonInterpreter: interpreter, started: new Date().toISOString(), status: 'running', assertions: [] };
  const integrity = name === 'autoplot-metadata-integrity';
  const liveReplacement = name === 'live-port-reuse';
  const partialBest = name === 'partial-best-fallback' || integrity ? 'fallback' : name === 'partial-best-refusal' ? 'refusal' : null;
  evidence.cases.push(record);
  const root = join(workspace, name === 'authoring-parity' ? "authoring parity 'quoted' $;" : name);
  const downloads = join(workspace, `${name}-downloads`);
  const browserProfile = join(workspace, `${name}-browser-profile`);
  const replacingDaemon = name === 'port-reuse' || liveReplacement;
  const replacementRoot = replacingDaemon ? join(workspace, `${name}-replacement`) : null;
  const tokenFile = replacingDaemon || name === 'reload' ? join(workspace, `${name}-private-bearer`) : null;
  let sharedToken = tokenFile ? randomBytes(32).toString('base64url') : null;
  if (sharedToken) privateSecrets.add(sharedToken);
  if (tokenFile) await writeFile(tokenFile, sharedToken, { flag: 'wx', mode: 0o600 });
  let replacement = null;
  let replacementStdout = '', replacementStderr = '';
  await mkdir(root, { mode: 0o700 });
  await mkdir(downloads, { mode: 0o700 });
  await mkdir(browserProfile, { mode: 0o700 });
  assert((await readdir(browserProfile)).length === 0, 'Owned browser profile must begin empty');
  record.browserProfile = { path: browserProfile, initiallyEmpty: true };
  // Keep macOS Unix socket paths below their length limit.
  const session = `wavetest-${randomUUID().slice(0, 12)}`;
  record.browserSession = session;
  let browserOpened = false;
  let browserClosed = false;
  let expectedBrowserOrigin = null;
  const closeOwnedBrowser = async () => {
    if (!browserOpened || browserClosed) return;
    await cli('close');
    browserClosed = true;
  };
  const cli = (...args) => command(browser, ['--session', session, ...(args[0] === 'open' ? ['--headed', String(browserHeaded), '--engine', 'chrome', '--profile', browserProfile, '--allowed-domains', '127.0.0.1,localhost', ...(browserExecutable ? ['--executable-path', browserExecutable] : []), '--args', browserLaunchArgs, '--download-path', downloads] : []), ...args]);
  const dom = async (script, timeout = 35000) => {
    const output = await command(browser, ['--session', session, 'eval', '--stdin'], script, timeout);
    return JSON.parse(JSON.parse(output));
  };
  const storageExpression = (masterToken, daemonId = '', runId = '') =>
    `(${observeCursorStorage.toString()})(localStorage, sessionStorage, document.cookie, ${JSON.stringify(daemonId)}, ${JSON.stringify(runId)}, { forbiddenToken: ${JSON.stringify(masterToken)}, origin: ${JSON.stringify(expectedBrowserOrigin)} })`;
  const healthRequestCount = async () => {
    const metadata = await readFile(join(root, '.request-metadata.jsonl'), 'utf8');
    assert(Buffer.byteLength(metadata) <= 1024 * 1024, 'Reload request metadata exceeded its byte bound');
    return metadata.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
      .filter((request) => request.method === 'GET' && request.path === '/api/health' && request.status === 200).length;
  };
  const snapshot = async () => {
    if (expectedBrowserOrigin) {
      const actual = new URL(await cli('get', 'url'));
      assert.equal(actual.origin, expectedBrowserOrigin, 'Owned browser tab left the fixture origin');
    }
    return cli('snapshot', '-i');
  };
  const actions = createBrowserActions({ cli, dom, snapshot });
  const button = (name, optional = false) => actions.button(name, optional);
  const fill = async (label, value, options = {}) => {
    const before = await registry(root);
    await actions.fill(label, value, options);
    const after = await registry(root);
    record.authoringActionRegistry ??= [];
    record.authoringActionRegistry.push({ action: 'fill', label, before, after });
    if (fixtureWebAssets) record.authoringEventDiagnostic = await dom(`JSON.stringify(document.getElementById('wavedl-event-diagnostic')?.textContent ?? null)`);
    check(true, `UI field ${label} retains authored value`);
  };
  const summary = async (text) => {
    const before = await registry(root);
    const authoredFields = ['Python interpreter', 'epochs', 'patience'].map(normalizeTrainingFieldLabel);
    const fieldValuesExpression = `JSON.stringify(${JSON.stringify(authoredFields)}.map(name => {
      // Read the draft's own fields even when a tab hides them: their values must survive.
      const label = Array.from(document.querySelectorAll('section[aria-labelledby="project-title"] label')).find(e => e.textContent.trim() === name);
      return label ? document.getElementById(label.htmlFor)?.value : null;
    }))`;
    const valuesBefore = await dom(fieldValuesExpression);
    await actions.expandSummary(text);
    check(true, `Summary ${text} deliberately expanded through its native visible control`);
    check(await dom(`JSON.stringify(!Array.from(document.querySelectorAll('button')).some(e => e.getClientRects().length && ['Waiting for daemon…', 'Stop waiting'].includes(e.textContent.trim())))`), 'Expanding training options did not trigger browser planning or request waiting');
    check(valuesBefore.every((value) => typeof value === 'string') && JSON.stringify(await dom(fieldValuesExpression)) === JSON.stringify(valuesBefore), 'Expanding training options preserved authored interpreter, epochs and patience');
    const after = await registry(root);
    record.authoringActionRegistry ??= [];
    record.authoringActionRegistry.push({ action: 'expand-summary', label: text, before, after });
    check(after.plans === before.plans && JSON.stringify(after.control) === JSON.stringify(before.control) && JSON.stringify(after.executions) === JSON.stringify(before.executions), 'Expanding training options created no persisted plan, submission intent or execution');
  };
  const check = (condition, message) => { assert(condition, message); record.assertions.push(message); };
  const captureReplacementMetadata = async () => {
    const metadata = await readFile(join(replacementRoot, '.request-metadata.jsonl'), 'utf8');
    assert(Buffer.byteLength(metadata) <= 1024 * 1024, 'Replacement request evidence exceeded byte bound');
    record.replacementAccessMetadata = metadata.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const originalRunId = record.initialRuntimeCursor.runId;
    assert(record.replacementAccessMetadata.some((request) => request.method === 'GET' && request.path === '/api/health' && request.scopeHeaderPresent && request.status === 409), 'Replacement lacks genuine old-scope health identity conflict');
    assert(record.replacementAccessMetadata.every((request) => !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && !(request.path.startsWith(`/api/runs/${originalRunId}`) && request.status >= 200 && request.status < 300)), 'Replacement accepted foreign old-run read/replay or received mutating request');
  };
  const fixture = spawn(python, ['tools/browser_daemon_fixture.py', '--root', root, '--unseeded', ...(fixtureWebAssets ? ['--web-assets', fixtureWebAssets] : []), ...(partialBest ? ['--partial-best', partialBest, '--request-metadata'] : []), ...(integrity ? ['--autoplot-metadata-integrity'] : []), ...(name === 'dataset-parity' ? ['--output-grid', '--request-metadata'] : []), ...(['training-validation', 'preset-import'].includes(name) ? ['--request-metadata'] : []), ...(name === 'reload' ? ['--request-metadata'] : []), ...(name === 'lost-ack' ? ['--drop-submit-ack'] : []), ...(name === 'artifact-tamper' ? ['--tamper-artifact'] : []), ...(tokenFile ? ['--token-file', tokenFile] : []), ...(liveReplacement ? ['--record-process-results'] : [])], {
    cwd: repo, env: { ...process.env, PYTHONPATH: join(repo, 'src'), OMP_NUM_THREADS: '1', MKL_NUM_THREADS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  active.add(fixture);
  let stdout = '', stderr = '';
  fixture.stdout.on('data', (chunk) => { stdout += chunk; });
  fixture.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000); });
  let diagnosticStage = 'fixture-startup';
  try {
    const startupDeadline = Date.now() + 45000;
    while (Date.now() < startupDeadline && !stdout.includes('Browser: ')) {
      if (fixture.exitCode !== null) throw new Error(`Fixture exited before ready: ${stderr}`);
      await delay(Math.max(0, Math.min(100, startupDeadline - Date.now())));
    }
    const url = stdout.match(/Browser: (http:\/\/[^\s]+)/)?.[1];
    assert(url, 'Fixture did not become ready within 45 seconds');
    privateSecrets.add(url);
    privateSecrets.add(new URL(url).searchParams.get('bootstrap'));
    expectedBrowserOrigin = new URL(url).origin;
    stdout = ''; // Do not persist single-use bootstrap credentials.
    browserOpened = true;
    diagnosticStage = 'browser-open';
    await cli('open', url);
    diagnosticStage = 'browser-readiness';
    const tabInventory = JSON.parse(await cli('--json', 'tab', 'list'));
    const ownedTab = tabInventory.data?.tabs?.find((tab) => {
      if (!tab.active || typeof tab.url !== 'string') return false;
      const observed = new URL(tab.url);
      const expected = new URL(url);
      return observed.origin === expected.origin && observed.pathname === expected.pathname;
    });
    assert(tabInventory.success && ownedTab && /^t[1-9][0-9]*$/.test(ownedTab.tabId), 'Owned bootstrap tab must be discoverable before native activation');
    await cli('tab', ownedTab.tabId);
    await cli('set', 'viewport', '1280', '900');
    record.browserViewport = await dom('JSON.stringify({width:innerWidth,height:innerHeight})');
    record.browserRuntime = await dom('JSON.stringify({userAgent:navigator.userAgent})');
    record.browserRuntime.executable = browserExecutable ?? 'agent-browser-managed';
    record.browserRuntime.headed = browserHeaded;
    check(record.browserViewport.width === 1280 && record.browserViewport.height === 900, 'Explicit isolated browser viewport is 1280 by 900');
    check((await command(browser, ['session', 'list'])).includes(session), 'CLI confirms owned isolated browser session');
    await cli('wait', '--text', 'Connected');
    check(!(await cli('get', 'url')).includes('bootstrap'), 'Bootstrap removed from address bar');
    const storage = await dom(`JSON.stringify(${storageExpression(sharedToken)})`);
    record.freshStorage = storage;
    check(storage.local === 0 && storage.session === 1 && storage.credential.present && storage.credential.key === 'wavedl.session.v1' && storage.credentialStorage === 'session' && storage.credential.valid && !storage.credential.masterTokenPresent && !storage.credentialInUrl && !storage.bootstrapInUrl && storage.cookies === '', 'Fresh browser stores only the bounded session envelope in sessionStorage, never the master bearer, URL credential or cookie');
    const manifest = await readFile(join(fixtureWebAssets ?? join(repo, 'src/wavedl_daemon/web_assets'), '.wavedl-assets.json'));
    if (fixtureWebAssets) record.explicitFixtureWebAssets = fixtureWebAssets;
    record.assetManifestSha256 = createHash('sha256').update(manifest).digest('hex');
    diagnosticStage = 'scenario';
    if (name === 'dataset-parity') {
      await datasetParity({ cli, dom, snapshot, button, actions, downloads, check, record,
        root, registry, python, command, repo });
      record.finalRegistry = await registry(root);
      record.snapshot = await snapshot();
      record.status = 'passed';
      return;
    }
    await actions.button('New training run', false, { locator: '[data-testid="nav-project"]' });
    if (name === 'wizard-progression') {
      const beforeInvalid = await registry(root);
      await button('Next step');
      await cli('wait', '--fn', `document.body.innerText.includes('Choose a dataset from the current daemon.')`);
      const invalidDataset = await dom(`JSON.stringify({step:document.querySelector('[aria-current="step"]')?.textContent.trim(),message:document.body.innerText.includes('Choose a dataset from the current daemon.'),plans:${beforeInvalid.plans},control:JSON.stringify(${JSON.stringify(beforeInvalid.control)})})`);
      check(invalidDataset.step?.startsWith('1.'), 'Missing dataset blocks guided progression at dataset step');
      check(invalidDataset.message === true && invalidDataset.plans === beforeInvalid.plans, 'Missing dataset creates visible validation and no durable plan');
      check(invalidDataset.control === JSON.stringify(beforeInvalid.control), 'Missing dataset creates no submission intent');
      record.wizardInvalidDataset = invalidDataset;
      record.wizardAfterInvalidDataset = await registry(root);
      assert.deepEqual(record.wizardAfterInvalidDataset, beforeInvalid);
    }
    // Guided authoring leaves the dataset details open; selecting from the real catalogue resolves daemon paths.
    const rootSnapshot = await snapshot();
    assert(rootSnapshot.includes('combobox "Search roots and paths"'), 'Search roots and paths combobox missing');
    const rootSelector = 'xpath=//*[@role="combobox" and @aria-label="Search roots and paths"]';
    const preparedRoot = await actions.readyControl('field', 'Search roots and paths', false, { locator: rootSelector });
    await cli('click', preparedRoot);
    await actions.option('datasets');
    await cli('wait', '--text', 'samples.npz');
    await button('Select file samples.npz');
    await cli('wait', '--fn', `Array.from(document.querySelectorAll('[data-testid=selected-dataset],[data-testid=selected-model]')).some(e => e.textContent.trim() === 'samples.npz') && Array.from(document.querySelectorAll('button[aria-label]')).some(e => e.getAttribute('aria-label').startsWith('Dataset: ') && e.getAttribute('aria-label').includes('/samples.npz'))`);
    await button('Next step');
    await cli('wait', '--text', 'Choose CNN');
    if (name === 'wizard-progression') {
      const beforeInvalidModel = await registry(root);
      await button('Next step');
      await cli('wait', '--fn', `document.body.innerText.includes('Choose a catalogue model or explicit custom identifier.')`);
      const invalidModel = await dom(`JSON.stringify({step:document.querySelector('[aria-current="step"]')?.textContent.trim(),message:document.body.innerText.includes('Choose a catalogue model or explicit custom identifier.'),plans:${beforeInvalidModel.plans},control:JSON.stringify(${JSON.stringify(beforeInvalidModel.control)})})`);
      check(invalidModel.step?.startsWith('2.'), 'Missing model blocks guided progression at model step');
      check(invalidModel.message === true && invalidModel.plans === beforeInvalidModel.plans, 'Missing model creates visible validation and no durable plan');
      record.wizardInvalidModel = invalidModel;
      record.wizardAfterInvalidModel = await registry(root);
      assert.deepEqual(record.wizardAfterInvalidModel, beforeInvalidModel);
    }
    await button('Choose CNN');
    await cli('wait', '--fn', `Array.from(document.querySelectorAll('[data-testid=selected-dataset],[data-testid=selected-model]')).some(e => e.textContent.trim().startsWith('Model: cnn'))`);
    try {
      record.trainingEditorReadiness = await openTrainingEditor({ button, cli, dom });
    } catch (error) {
      // Failure-only public DOM metadata. Never persist field values, raw HTML,
      // private component state or additional credentials to explain readiness.
      try {
        record.trainingEditorFailure = await dom(`JSON.stringify((()=>{
          const regions = Array.from(document.querySelectorAll('section[aria-labelledby="project-title"]'));
          const fields = regions.flatMap(region=>Array.from(region.querySelectorAll('input[name="runtime.python"]')));
          return {regions:regions.length,fieldCount:fields.length,fields:fields.slice(0,4).map(field=>({
            id:field.id,connected:field.isConnected,disabled:field.disabled,rectCount:field.getClientRects().length,
            display:getComputedStyle(field).display,visibility:getComputedStyle(field).visibility,opacity:getComputedStyle(field).opacity,
            labelCount:field.labels?.length??0,exactLabel:Array.from(field.labels??[]).some(label=>label.textContent.trim()==='Python interpreter'),
            labels:Array.from(field.labels??[]).slice(0,4).map(label=>({rectCount:label.getClientRects().length,display:getComputedStyle(label).display,visibility:getComputedStyle(label).visibility,opacity:getComputedStyle(label).opacity})),
            hiddenAncestors:Array.from((function*(node){while(node){yield node;node=node.parentElement;}})(field)).filter(node=>getComputedStyle(node).display==='none').map(node=>node.tagName).slice(0,8)
          }))};
        })())`);
        record.trainingEditorPredicateFailure = await dom(`JSON.stringify(${editorFieldObservationExpression(true)})`);
      } catch { record.trainingEditorFailure = { observationUnavailable: true }; }
      throw error;
    }
    record.authoringNavigation = 'Guided dataset and model steps, then explicit Show full editor for ordinary labelled-field authoring and immutable approval';
    const interpreterLocator = await dom(`JSON.stringify('#'+CSS.escape(${JSON.stringify(record.trainingEditorReadiness.id)}))`);
    await actions.fill('Python interpreter', interpreter, { locator: interpreterLocator });
    check(true, 'UI field Python interpreter retains authored value');
    const shortTraining = ['baseline', 'autoplot-metadata-integrity', 'partial-best-fallback', 'partial-best-refusal', 'wizard-progression', 'artifact-tamper', 'download-names', 'submitted-plan-authoring-protection', 'result-operations', 'onnx-export', 'inference-cancellation', 'cv-parity'].includes(name);
    await fill('epochs', shortTraining ? '3' : '10000');
    await fill('patience', shortTraining ? '3' : '10000');
    await summary('Data, checkpoints and cross-validation');
    await fill('workers', '0');
    await fill('batch size', '16');
    if (name === 'cv-parity') {
      await fill('cv', '2'); await fill('epochs', '1');
      const locator = await actions.readyControl('field', 'deterministic');
      const checked = `(${controlExpression('field', 'deterministic', { locator })})[0]?.getAttribute('aria-checked')`;
      const initialChecked = await dom(`JSON.stringify(${checked})`);
      check(['true', 'false'].includes(initialChecked), 'Deterministic checkbox exposes its rendered ARIA state');
      if (initialChecked !== 'true') await cli('click', locator);
      await cli('wait', '--fn', `${checked} === 'true'`);
      record.deterministicCheckboxChecked = await dom(`JSON.stringify(${checked} === 'true')`);
      check(record.deterministicCheckboxChecked === true, 'Rendered deterministic checkbox retains authored true value');
    }
    if (name === 'download-names') await fill('save every', '1');
    await actions.select('precision', 'no');
    if (name === 'wizard-progression') {
      record.wizardBeforeNavigation = await registry(root);
      await button('Use guided steps');
      await button('Next step');
      await button('Next step');
      await fill('epochs', '0');
      await button('Next step');
      await cli('wait', '--text', 'Review training and runtime validation errors before approval.');
      record.wizardInvalidTraining = await dom(`JSON.stringify({step:document.querySelector('[aria-current="step"]')?.textContent.trim(),message:document.body.innerText.includes('Review training and runtime validation errors before approval.')})`);
      record.wizardAfterInvalidTraining = await registry(root);
      await fill('epochs', '3');
      const locator = await actions.readyControl('button', 'Next step');
      await cli('dblclick', locator);
      await cli('wait', '--fn', `document.querySelector('[aria-current="step"]')?.textContent.trim().startsWith('5.')`);
      await button('Previous step');
      await button('Next step');
      const reviewBefore = await dom(`JSON.stringify({step:document.querySelector('[aria-current="step"]')?.textContent.trim(),epochs:Array.from(document.querySelectorAll('label')).find(e=>e.textContent.trim()===${JSON.stringify(normalizeTrainingFieldLabel('epochs'))})?.htmlFor && document.getElementById(Array.from(document.querySelectorAll('label')).find(e=>e.textContent.trim()===${JSON.stringify(normalizeTrainingFieldLabel('epochs'))}).htmlFor)?.value})`);
      check(reviewBefore.step?.startsWith('5.'), 'Valid dataset/model and back-forward navigation preserve guided draft through review');
      record.wizardReview = reviewBefore;
      record.wizardAfterNavigation = await registry(root);
    }
    if (name === 'preset-import') {
      await browserPresetImport({ cli, dom, snapshot, button, fill, summary, actions, controlExpression,
        registry, root, downloads, check, record, interpreter, python, command, repo });
      record.finalRegistry = await registry(root);
      record.snapshot = await snapshot();
      record.status = 'passed';
      return;
    }
    if (name === 'authoring-parity') {
      await authoringParity({ cli, dom, snapshot, button, fill, summary, actions, controlExpression,
        registry, root, downloads, check, record, interpreter, python, command, repo });
      record.finalRegistry = await registry(root);
      record.snapshot = await snapshot();
      record.status = 'passed';
      return;
    }
    if (name === 'training-fields-full') {
      await command(python, ['-c', 'from pathlib import Path; import sys,torch; p=Path(sys.argv[1]); torch.save({"model_state_dict":{}},p/"resume.pth"); code=chr(10).join(["def balance(predictions, targets):", "    return predictions.sum() * 0", "def boundary(predictions, targets):", "    return predictions.sum() * 0", ""]); compile(code,"fixture_modules.py","exec"); (p/"constraint.py").write_text(code); (p/"fixture_modules.py").write_text(code)', root]);
      await fullTrainingFields({ cli, dom, snapshot, button, fill, summary, actions, controlExpression,
        registry, root, downloads, check, record, interpreter, python, command, repo });
      record.finalRegistry = await registry(root);
      record.snapshot = await snapshot();
      record.status = 'passed';
      return;
    }
    if (name === 'training-validation') {
      await trainingValidation({ cli, dom, button, fill, summary, actions, controlExpression,
        registry, root, downloads, check, record, interpreter, python, command, repo });
      record.finalRegistry = await registry(root);
      record.snapshot = await snapshot();
      record.status = 'passed';
      return;
    }
    await button('Preview persisted plan');
    await cli('wait', '--text', 'Persisted plan for approval');
    await openPlanDisclosure({ cli, dom });
    const planned = await registry(root);
    if (name === 'wizard-progression') record.wizardPreviewRegistry = planned;
    check(planned.plans === 1 && planned.control[0].submission_requested === 0, 'Plan persisted before approval; no submission intent');
    record.approvedPlan = await dom(`JSON.stringify(document.querySelector('[aria-label="Approved normalized manifest"]')?.textContent)`);
    const approvedManifest = JSON.parse(record.approvedPlan);
    record.authoredConfiguration = {
      model: 'cnn', epochs: name === 'cv-parity' ? 1 : shortTraining ? 3 : 10000,
      patience: shortTraining ? 3 : 10000, batch_size: 16, workers: 0,
      precision: 'no', python: interpreter, device: 'cpu', dataset: 'samples.npz',
      ...(name === 'cv-parity' ? { deterministic: true } : {}),
    };
    check(['model', 'epochs', 'patience', 'batch_size', 'workers', 'precision'].every((key) => approvedManifest.resolved_config[key] === record.authoredConfiguration[key]), 'Immutable approval manifest exactly matches authored model and training values');
    if (name === 'cv-parity') check(approvedManifest.resolved_config.deterministic === record.authoredConfiguration.deterministic, 'Immutable CV approval manifest retains authored deterministic true value');
    check(approvedManifest.runtime.python === interpreter && approvedManifest.runtime.device === 'cpu' && approvedManifest.resolved_config.data_path.endsWith('/samples.npz'), 'Immutable approval manifest matches authored daemon interpreter, CPU device and selected dataset');

    if (replacingDaemon) {
      const origin = new URL(url).origin;
      const port = new URL(url).port;
      const firstHealth = await authenticatedHealth(origin, sharedToken);
      record.originalDaemon = firstHealth;
      const originalRunId = approvedManifest.run_id;
      if (liveReplacement) {
        await button('Approve and start this plan');
        await cli('wait', '--text', 'Run detail');
        check((await registry(root)).control[0].submission_requested === 1, 'Live replacement begins only after explicit approved-plan submission');
        await waitRunState(root, 'running');
        const metricsDeadline = Date.now() + 45000;
        let producer;
        while (Date.now() < metricsDeadline) {
          producer = await runtimeEvidence(root, originalRunId, Math.max(1, Math.min(35000, metricsDeadline - Date.now())));
          if (producer.cursor && producer.metrics > 0 && producer.logs > 0 && producer.journalMatches) break;
          await delay(Math.max(0, Math.min(100, metricsDeadline - Date.now())));
        }
        assert(Date.now() < metricsDeadline && producer?.cursor && producer.cursor.attempt > 0 && producer.cursor.seq >= 1 && producer.journalMatches, 'Real persisted runtime metric and matching producer journal required before replacement');
        record.initialRuntimeCursor = producer.cursor;
        record.initialMetricEvidence = { persistedMetricCount: producer.metrics, persistedLogCount: producer.logs, producerJournalMatches: producer.journalMatches, durableCursors: producer.durableCursors };
        await cli('wait', '--fn', `(() => { const history=document.querySelector('[aria-label="Runtime metric history"]'); const current=document.querySelector('[aria-label="Current runtime metrics"]'); return /Active checkpoint lineage · [1-9][0-9]* steps/.test(history?.innerText ?? '') && !!history?.querySelector('canvas') && !!current?.querySelector('[role="progressbar"]'); })()`);
        record.liveMonitorBeforeReplacement = await dom(`JSON.stringify((() => {
          const selected=document.querySelector('[aria-label="Selected run"]');
          const history=document.querySelector('[aria-label="Runtime metric history"]');
          const current=document.querySelector('[aria-label="Current runtime metrics"]');
          const diagnostics=document.querySelector('[aria-label="Runtime diagnostics"]');
          return {selectedRunId:selected?.querySelector('.identity')?.textContent.trim(), epoch:Number(current?.innerText.match(/Epoch ([0-9]+)/)?.[1] ?? 0), historySteps:Number(history?.innerText.match(/lineage · ([0-9]+) steps/)?.[1] ?? 0),historyCanvasPresent:!!history?.querySelector('canvas'),diagnosticLogPresent:!!diagnostics?.innerText.includes('Training runtime rank 0'),ownedRuntimePid:${JSON.stringify(producer.ownedRuntimePid)}};
        })())`);
        check(record.liveMonitorBeforeReplacement.selectedRunId === originalRunId && record.liveMonitorBeforeReplacement.epoch > 0 && record.liveMonitorBeforeReplacement.historySteps > 0 && record.liveMonitorBeforeReplacement.historyCanvasPresent && record.liveMonitorBeforeReplacement.diagnosticLogPresent, 'Actual browser selected run contains real nonempty epoch metrics, rendered history and runtime log before replacement');
      }
      record.beforeReplacementSnapshot = await snapshot();
      await stop(fixture, () => stdout.includes('Fixture: services-closed'));
      active.delete(fixture);
      record.originalDaemonStoppedBeforePortReuse = true;
      if (liveReplacement) {
        const nativeResults = stdout.split('\n').filter((line) => line.startsWith('Fixture process-result: ')).map((line) => JSON.parse(line.slice('Fixture process-result: '.length)));
        const nativeResult = nativeResults.find((result) => result.runId === originalRunId);
        assert(nativeResult && nativeResult.pid === record.liveMonitorBeforeReplacement.ownedRuntimePid && nativeResult.cancelled && !nativeResult.timedOut && Number.isInteger(nativeResult.returncode), 'Actual owned native result must confirm fixture-shutdown cancellation');
        let pidAbsent = false;
        try { process.kill(nativeResult.pid, 0); } catch (error) { if (error.code === 'ESRCH') pidAbsent = true; else throw error; }
        const journal = await readFile(join(root, 'runs', originalRunId, 'attempts', String(record.initialRuntimeCursor.attempt), 'events.jsonl'), 'utf8');
        const exit = journal.trim().split('\n').map((line) => JSON.parse(line)).findLast((event) => event.type === 'exit');
        record.originalTerminationBeforeRootCleanup = { cause: 'owned-fixture-shutdown', servicesClosed: stdout.includes('Fixture: services-closed'), ownedRuntimePid: nativeResult.pid, pidAbsent, nativeProcessResult: nativeResult, runtimeJournalExit: exit ?? null, runtimeOutcome: exit ? exit.payload.status : 'unknown', lastRegistry: await registry(root) };
        check(pidAbsent, 'Daemon A owned-fixture shutdown reaped its genuinely cancelled native process before root cleanup; browser stayed open');
        if (exit) check(exit.run_id === originalRunId && exit.attempt === record.initialRuntimeCursor.attempt && ['cancelled', 'failed', 'completed'].includes(exit.payload.status), 'Any available runtime exit is genuine producer evidence; native cancellation is separate from runtime outcome');
        record.transportScopeRetired = await dom(`JSON.stringify(!document.querySelector('[aria-label="Selected run"]') && !!document.querySelector('#daemon-bearer'))`);
        record.explicitReauthAttempted = false;
        if (record.transportScopeRetired) {
          record.transportRetirementBeforeReplacement = await dom(`JSON.stringify({historyAbsent:!document.querySelector('[aria-label="Runtime metric history"]'),credentialFieldEmpty:document.querySelector('#daemon-bearer')?.value === '',noEnabledCancel:!Array.from(document.querySelectorAll('button')).some(e=>e.getClientRects().length&&!e.disabled&&e.textContent.trim()==='Request cancellation'),message:document.body.innerText.slice(0,3000)})`);
          check(record.transportRetirementBeforeReplacement.historyAbsent && record.transportRetirementBeforeReplacement.credentialFieldEmpty && record.transportRetirementBeforeReplacement.noEnabledCancel, 'Actual transport failure retired old live history, memory credential and cancellation authority before replacement');
        }
      }
      await mkdir(replacementRoot, { mode: 0o700 });
      replacement = spawn(python, ['tools/browser_daemon_fixture.py', '--root', replacementRoot, '--unseeded', '--port', port, '--token-file', tokenFile, ...(liveReplacement ? ['--request-metadata'] : [])], {
        cwd: repo, env: { ...process.env, PYTHONPATH: join(repo, 'src'), OMP_NUM_THREADS: '1', MKL_NUM_THREADS: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      active.add(replacement);
      replacement.stdout.on('data', (chunk) => { replacementStdout += chunk; });
      replacement.stderr.on('data', (chunk) => { replacementStderr = (replacementStderr + chunk).slice(-2000); });
      const replacementDeadline = Date.now() + 45000;
      while (Date.now() < replacementDeadline && !replacementStdout.includes('Browser: ')) {
        if (replacement.exitCode !== null || replacement.signalCode !== null) throw new Error('Replacement fixture exited before becoming ready');
        await delay(Math.max(0, Math.min(100, replacementDeadline - Date.now())));
      }
      const replacementUrl = replacementStdout.match(/Browser: (http:\/\/[^\s]+)/)?.[1];
      assert(replacementUrl && new URL(replacementUrl).origin === origin, 'Replacement must bind the identical loopback origin within 45 seconds');
      privateSecrets.add(replacementUrl);
      privateSecrets.add(new URL(replacementUrl).searchParams.get('bootstrap'));
      record.replacementOrigins = { original: origin, replacement: new URL(replacementUrl).origin, identical: true };
      replacementStdout = ''; // Never open/store replacement bootstrap: old browser scope stays live.
      const secondHealth = await authenticatedHealth(origin, sharedToken);
      record.replacementDaemon = secondHealth;
      check(firstHealth.daemonId !== secondHealth.daemonId && firstHealth.buildId === secondHealth.buildId, 'Same origin and authenticated bearer expose the intended replacement daemon identity/build');
      record.replacementBeforeStaleSubmit = await registry(replacementRoot);
      check(record.replacementBeforeStaleSubmit.plans === 0, 'Replacement daemon starts with no plans');
      if (liveReplacement) {
        const skewAlreadyVisible = await dom(`JSON.stringify(document.body.innerText.includes('Connection identity changed'))`);
        if (!skewAlreadyVisible) {
          const retiredNow = await dom(`JSON.stringify(!document.querySelector('[aria-label="Selected run"]') && !!document.querySelector('#daemon-bearer'))`);
          if (retiredNow) {
            record.transportScopeRetired = true;
            record.transportRetirementBeforeReplacement ??= await dom(`JSON.stringify({historyAbsent:!document.querySelector('[aria-label="Runtime metric history"]'),credentialFieldEmpty:document.querySelector('#daemon-bearer')?.value === '',noEnabledCancel:!Array.from(document.querySelectorAll('button')).some(e=>e.getClientRects().length&&!e.disabled&&e.textContent.trim()==='Request cancellation')})`);
            check(record.transportRetirementBeforeReplacement.historyAbsent && record.transportRetirementBeforeReplacement.credentialFieldEmpty && record.transportRetirementBeforeReplacement.noEnabledCancel, 'Retired transport scope remains cleared before explicit reauthentication');
            // Only this generated fixture credential, supplied dynamically in
            // memory; never a user credential or a literal in source/tool logs.
            await fill('Daemon master credential', sharedToken);
            record.explicitReauthAttempted = true;
            await button('Connect securely');
          } else {
          const replayVisible = await dom(`JSON.stringify(Array.from(document.querySelectorAll('button')).some(e => e.getClientRects().length && !e.disabled && e.textContent.trim() === 'Replay / reconnect'))`);
          if (replayVisible) await button('Replay / reconnect');
          // If the ongoing SSE follow-up has already revoked the monitor,
          // await its owner-visible identity result rather than invent a call.
          }
        }
      } else await button('Approve and start this plan');
      await cli('wait', '--fn', `document.body.innerText.includes('Connection identity changed') && document.body.innerText.includes('A different WaveDL daemon is now serving this address. Sign in again.')`);
      check(await dom(`JSON.stringify(document.querySelector('#daemon-bearer')?.value === '' && Array.from(document.querySelectorAll('button')).some(e => e.getClientRects().length && e.textContent.trim() === 'Disconnect and clear scope'))`), 'Identity skew requires explicit scope clearing and fresh credential; no automatic reconnection');
      check(await dom(`JSON.stringify(!document.querySelector('[aria-label="Approved normalized manifest"]') && !Array.from(document.querySelectorAll('button')).some(e => e.getClientRects().length && !e.disabled && ['Approve and start this plan', 'Preview persisted plan', 'Request cancellation'].includes(e.textContent.trim())))`), 'Old immutable approval and mutation authority revoked after daemon replacement');
      check(await dom(`JSON.stringify(Array.from(document.querySelectorAll('[data-testid=selected-dataset],[data-testid=selected-model]')).some(e => e.textContent.trim().startsWith('Dataset: Not selected')) && !document.querySelector('[aria-label="Selected run"]') && !document.querySelector('[aria-label="Runtime metric history"]'))`), 'Old dataset selection, selected-run monitor and cursor-bearing history revoked');
      record.replacementAfterStaleSubmit = await registry(replacementRoot);
      check(record.replacementAfterStaleSubmit.plans === 0 && record.replacementAfterStaleSubmit.control.length === 0 && record.replacementAfterStaleSubmit.executions.length === 0 && record.replacementAfterStaleSubmit.runs.length === 0, 'Stale browser submission creates zero replacement plans, submission intent, executions or runs');
      if (liveReplacement) {
        record.liveIdentityFence = await dom(`JSON.stringify({identityMessage:document.body.innerText.includes('Connection identity changed'),selectedRunAbsent:!document.querySelector('[aria-label="Selected run"]'),metricHistoryAbsent:!document.querySelector('[aria-label="Runtime metric history"]'),diagnosticsAbsent:!document.querySelector('[aria-label="Runtime diagnostics"]'),noEnabledCancel:!Array.from(document.querySelectorAll('button')).some(e=>e.getClientRects().length&&!e.disabled&&e.textContent.trim()==='Request cancellation'),previewAbsent:!document.querySelector('[aria-label="Approved normalized manifest"]')})`);
        check(Object.values(record.liveIdentityFence).every((value) => value === true), 'Identity fence revokes actual nonempty monitor history, diagnostics, selected run, preview and cancellation authority');
        await captureReplacementMetadata();
        check(true, 'Replacement rejected old-scope identity and accepted no foreign old-run read/cursor replay or mutating browser request');
        record.fault = 'Real replacement after actual running metric stream; same private bearer and origin, different identity; owned fixture shutdown cancels A, not browser closure';
      } else {
        check((await registry(root)).control.every((control) => control.submission_requested === 0), 'Original persisted preview remained unsubmitted');
        record.fault = 'Real daemon replacement on identical loopback port with identical private bearer; changed identity fences stale approval (not authentication failure)';
      }
    } else if (name === 'lost-ack') {
      const approval = await dom(`JSON.stringify(document.querySelector('#approved-plan-title')?.parentElement.textContent)`);
      const planId = planned.control[0].plan_id;
      const requestId = approval.match(/request ([0-9a-f-]{36})/)?.[1];
      record.lostAckRecovery = {
        scope: 'Observed durable writer submission and verified initial runtime binding; not training completion or lifetime exactly-once proof',
        identity: { planId, runId: approvedManifest.run_id, requestId },
        before: planned,
      };
      await button('Approve and start this plan');
      await cli('wait', '--text', 'Planning status');
      const accepted = await registry(root);
      record.lostAckRecovery.accepted = accepted;
      lostAckBindingReady(accepted, record.lostAckRecovery.identity);
      check(accepted.control[0].submission_requested === 1, 'Backend accepted despite suppressed submit ACK and proxy-style 503');
      await button('Check submission status');
      await cli('wait', '--text', 'Run detail');
      const retried = await registry(root);
      record.lostAckRecovery.recovered = retried;
      // A writer's native receipt is durable before its verified runtime attempt.
      // Keep these separate: summing both tables double-counts a bound submission.
      lostAckBindingReady(retried, record.lostAckRecovery.identity);
      record.lostAckRecovery.bound = await pollRegistry(root,
        state => lostAckBindingReady(state, record.lostAckRecovery.identity),
        'Original writer submission verified runtime binding', 45000);
      check(true, 'Status recovery follows the original approved plan without duplicate execution');
      await actions.button('New training run', false, { locator: '[data-testid="nav-project"]' });
      record.lostAckRecovery.acknowledgedUi = await dom(`JSON.stringify({disabled:Array.from(document.querySelectorAll('button')).some(e => e.getClientRects().length && e.disabled && e.textContent.trim() === 'Submission acknowledged'),runId:document.querySelector('[aria-label="Acknowledged training run"]')?.textContent.includes(${JSON.stringify(approvedManifest.run_id)})?${JSON.stringify(approvedManifest.run_id)}:null})`);
      record.lostAckRecovery.acknowledged = await registry(root);
      verifyLostAckEvidence(record);
      check(true, 'Recovered acknowledgment disables duplicate approval of the existing plan');
      record.fault = 'Fixture suppresses one successful backend submit ACK and replaces it with an empty proxy-style 503 after real acceptance';
    } else if (name === 'reload') {
      const healthBeforeReload = await healthRequestCount();
      await cli('reload');
      const reloadDeadline = Date.now() + 15000;
      let reloaded = false;
      while (Date.now() < reloadDeadline) {
        const state = await dom(`JSON.stringify({connected:document.body.innerText.includes('Connected'),urlHasQuery:location.search.length>0,urlHasHash:location.hash.length>0,storage:${storageExpression(sharedToken)}})`, 5000);
        if (state.connected) {
          reloaded = true;
          check(!state.urlHasQuery && !state.urlHasHash && !state.storage.credentialInUrl && !state.storage.bootstrapInUrl, 'Reload keeps credentials out of the address bar before restoring the session');
          check(state.storage.local === 0 && state.storage.session === 1 && state.storage.credential.present && state.storage.credentialStorage === 'session', 'Reload keeps the session envelope in sessionStorage and does not opt into persistent localStorage');
          check(state.storage.credential.valid && !state.storage.credential.masterTokenPresent && !state.storage.credentialInUrl && !state.storage.bootstrapInUrl, 'Reload restores a bounded session envelope without exposing the master bearer');
          const healthAfterReload = await healthRequestCount();
          check(healthAfterReload > healthBeforeReload, 'Reload restore reruns the full handshake health check');
          record.reloadHealth = { before: healthBeforeReload, after: healthAfterReload };
          break;
        }
        await delay(100);
      }
      check(reloaded, 'Reload reconnects within a bounded deadline instead of waiting indefinitely for a login screen');
      check((await registry(root)).control[0].submission_requested === 0, 'Reload does not submit a preview');
    } else {
      await button('Approve and start this plan');
      await cli('wait', '--text', 'Run detail');
      if (name === 'wizard-progression') {
        record.wizardSubmitted = await pollRegistry(root, state=>state.plans===1 && state.executions.length===1, 'Single explicitly approved execution', 45000);
        await actions.button('New training run', false, { locator: '[data-testid="nav-project"]' });
        await button('Show full editor');
        const acknowledgement = `Array.from(document.querySelectorAll('button')).find(e=>e.getClientRects().length&&e.textContent.trim()==='Submission acknowledged')`;
        await cli('scrollintoview', 'xpath=//button[normalize-space(.)="Submission acknowledged"]');
        record.wizardAckScrolled = true;
        record.wizardAcknowledged = await dom(`JSON.stringify({disabled:(${acknowledgement})?.disabled,runId:document.querySelector('[aria-label="Acknowledged training run"]')?.textContent.includes(${JSON.stringify(approvedManifest.run_id)})?${JSON.stringify(approvedManifest.run_id)}:null})`);
        const point = await dom(`JSON.stringify((()=>{const r=(${acknowledgement}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})())`);
        await cli('mouse', 'move', String(Math.round(point.x)), String(Math.round(point.y)));
        record.wizardAckMoved = true;
        for (let click = 0; click < 2; click++) { await cli('mouse', 'down'); await cli('mouse', 'up'); }
        record.wizardAckClicked = true;
        await button('Open acknowledged run');
      }
      check((await registry(root)).control[0].submission_requested === 1, 'Explicit approval records real daemon submission intent');
      if (name === 'detach') {
        record.runningBeforeDetach = await waitRunState(root, 'running');
        await actions.button('Connection', false, { locator: '[data-testid="nav-connection"]' });
        await button('Disconnect');
        await cli('wait', '--text', 'Connect securely');
        record.snapshot = await snapshot();
        await closeOwnedBrowser();
        const after = await registry(root);
        check(after.control.every((r) => !r.cancellation_requested), 'Detach and browser close create no cancellation intent');
        check(!after.runs.some((r) => ['cancelled', 'failed'].includes(r.state)), 'Daemon remains running or naturally completed after browser close');
      } else if (name === 'cancel') {
        await waitRunState(root, 'running');
        await button('Request cancellation');
        record.terminalBackendSnapshot = await pollRegistry(root, (state) => state.executions.some((execution) => execution.observed_status === 'terminal'), 'Cancellation backend terminal state', 45000);
        await cli('wait', '--fn', `Array.from(document.querySelectorAll('[aria-label="Selected run"] [data-run-state="cancelled"]')).some(e => e.getClientRects().length)`);
        check(await dom(`JSON.stringify(document.querySelector('[aria-label="Selected run"] [data-run-state]')?.textContent.trim() === 'Cancelled')`), 'Selected run displays fresh daemon-confirmed cancelled terminal state');
        check((await registry(root)).control[0].cancellation_requested === 1, 'Cancellation intent and independently persisted terminal backend observation confirmed');
      } else {
        await pollRegistry(root, (state) => {
          if (state.runs.some((r) => r.state === 'completed')) return true;
          if (state.runs.some((r) => r.state === 'failed')) throw new Error('Real CPU training failed');
          return false;
        }, 'Real CPU completion', 90000);
        if (integrity) {
          await cli('wait', '--text', 'The daemon returned an invalid response. Reconnect to verify its identity.');
          record.integrityUi = await dom('JSON.stringify(document.body.innerText)');
          record.integrityDom = await dom(`JSON.stringify({connectionRefused:document.body.innerText.includes('The daemon returned an invalid response. Reconnect to verify its identity.'), automaticPlotControlsAbsent:!Array.from(document.querySelectorAll('button')).some(button=>button.getClientRects().length && ['Retry automatic plots','Disable automatic plots','Monitor plot run'].includes(button.textContent.trim())),verifiedRasterAbsent:!document.querySelector('img[alt="Verified published diagnostic plot"]')})`);
          assert.deepEqual(record.integrityDom, { connectionRefused: true, automaticPlotControlsAbsent: true, verifiedRasterAbsent: true });
          check(!record.integrityUi.includes('Automatic plots unavailable: the published checkpoint is incomplete.'), 'Checksum fault is not downgraded to candidate-local incomplete guidance');
          record.integrityBefore = await pollRegistry(root, state => state.plans === 1 && state.runs.length === 1 && state.runs[0].state === 'completed' && state.executions.length === 1 && state.executions[0].observed_status === 'terminal', 'Checksum refusal leaves completed training without plot', 30000);
          record.partialBestPublication = JSON.parse(await readFile(join(root, '.partial-best-proof.json'), 'utf8'));
          record.finalRegistry = await registry(root);
          assert.deepEqual(record.finalRegistry, record.integrityBefore);
          check(true, 'One completed training plan/run/execution and no cancellation after metadata integrity refusal');
          record.snapshot = await snapshot(); record.status = 'passed'; return;
        }
        await cli('wait', '--fn', `Array.from(document.querySelectorAll('[data-run-state="completed"]')).some(e => e.getClientRects().length && e.textContent.trim() === 'Completed')`);
        check(true, 'Real CPU training completed, confirmed in daemon registry and browser');
        if (partialBest) {
          if (partialBest === 'refusal') {
            await cli('wait', '--text', 'Automatic plots unavailable: the published checkpoint is incomplete.');
            record.partialBestUi = await dom('JSON.stringify(document.body.innerText)');
            record.partialBestBefore = await pollRegistry(root, state => state.plans === 1 && state.runs.length === 1 && state.runs[0].state === 'completed' && state.executions.length === 1 && state.executions[0].observed_status === 'terminal', 'Refused partial source training terminal without follow-up', 30000);
            assert.equal(record.partialBestBefore.plans, 1);
            assert.equal(record.partialBestBefore.runs.length, 1);
            assert.equal(record.partialBestBefore.executions.length, 1);
            await actions.button('Results', false, { locator: '[data-testid="nav-results"]' });
            await button('Refresh artifacts');
            await cli('wait', '--text', 'checkpoint_selection.json');
            check(await dom('JSON.stringify(document.body.innerText.includes("Connected"))'), 'Incomplete publications preserve verified connection');
          } else {
            await pollRegistry(root, state => state.plans === 2 && state.runs.length === 2 && state.executions.length === 2 && state.runs.every(run => run.state === 'completed') && state.executions.every(execution => execution.observed_status === 'terminal'), 'Fallback training and exactly one diagnostic plot completed', 90000);
          }
          record.partialBestPublication = JSON.parse(await readFile(join(root, '.partial-best-proof.json'), 'utf8'));
          assert.equal(record.partialBestPublication.runId, approvedManifest.run_id);
          assert.deepEqual(Object.keys(record.partialBestPublication.partialComplete.files), ['checkpoint_selection.json']);
          check(Number(record.partialBestPublication.partialGeneration.slice(4)) > Number(record.partialBestPublication.olderCompleteBest.slice(4)), 'Real hash-covered metadata-only best is newer than genuine complete source');
          record.partialBestPlans = JSON.parse(await command(python, ['-c', `import json,sqlite3,sys
from pathlib import Path
r=Path(sys.argv[1]); c=sqlite3.connect((r/'state/registry.db').as_uri()+'?mode=ro',uri=True)
result=[]
for row in c.execute('SELECT plan_json FROM plans ORDER BY plan_id'):
 m=json.loads(json.loads(row[0])['manifest_json']); result.append(m)
print(json.dumps(result))`, root]));
          if (partialBest === 'fallback') {
            const plot = record.partialBestPlans.find(manifest => manifest.operation === 'plot');
            assert(plot);
            const pin = plot.checkpoint_source;
            assert.equal(pin.run_id, approvedManifest.run_id);
            assert.equal(pin.generation, record.partialBestPublication.olderCompleteBest);
            const sourceRoot = join(root, 'runs', pin.run_id);
            assert.equal(pin.manifest_sha256, createHash('sha256').update(await readFile(join(sourceRoot, 'manifest.json'))).digest('hex'));
            assert.equal(pin.complete_sha256, createHash('sha256').update(await readFile(join(sourceRoot, 'checkpoints', pin.generation, 'COMPLETE.json'))).digest('hex'));
            check(true, 'Plot pins the exact older genuine best manifest and COMPLETE hash');
            await button('Monitor plot run');
            await actions.button('Results', false, { locator: '[data-testid="nav-results"]' });
            await button('Refresh artifacts');
            await cli('wait', '--text', 'View PNG');
            const png = JSON.parse(await command(python, ['-c', `import json,sys,hashlib
from pathlib import Path
from PIL import Image
r=Path(sys.argv[1])/'runs'/sys.argv[2]/'checkpoints'
for p in sorted(r.glob('gen-*/COMPLETE.json')):
 m=json.loads(p.read_text())
 if 'scatter_all.png' not in m['files']: continue
 f=p.parent/'scatter_all.png'; raw=f.read_bytes()
 if len(raw)>16777216: raise ValueError('PNG byte budget')
 with Image.open(f) as image:
  w,h=image.size
  if not 1<=w<=8192 or not 1<=h<=8192 or w*h>16777216: raise ValueError('PNG pixel budget')
  pixels=image.convert('RGBA').tobytes()
 print(json.dumps({'generation':m['generation'],'attempt':m['attempt'],'width':w,'height':h,'sha256':hashlib.sha256(raw).hexdigest(),'size':len(raw),'rgbaSha256':hashlib.sha256(pixels).hexdigest(),'inventory':m['files']['scatter_all.png']})); break
else: raise ValueError('Diagnostic PNG missing')`, root, plot.run_id]));
            assert.deepEqual(png.inventory, { size: png.size, sha256: png.sha256 });
            record.partialBestStage = 'preview-click';
            await actions.button('View PNG', false, { locator: `xpath=//*[@data-artifact-generation='${png.generation}'][@data-artifact-path='scatter_all.png']//button[normalize-space(.)='View PNG']` });
            record.partialBestStage = 'image-decode';
            await cli('wait', '--fn', 'Array.from(document.images).some(image=>image.alt==="Verified published diagnostic plot"&&image.complete&&image.naturalWidth>0)');
            record.partialBestStage = 'image-scroll';
            await cli('scrollintoview', 'img[alt="Verified published diagnostic plot"]');
            record.partialBestStage = 'pixel-verification';
            record.partialBestRaster = await dom(`(async()=>{const image=Array.from(document.images).find(i=>i.alt==='Verified published diagnostic plot'&&i.complete&&i.naturalWidth>0);if(!image||!image.src.startsWith('blob:'))throw Error('Verified raster absent');const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');context.drawImage(image,0,0);const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');return JSON.stringify({width:canvas.width,height:canvas.height,rgbaSha256:await hash(context.getImageData(0,0,canvas.width,canvas.height).data)});})()`);
            assert.deepEqual(record.partialBestRaster, { width: png.width, height: png.height, rgbaSha256: png.rgbaSha256 });
            record.partialBestStage = 'native-download';
            const pngDownload = await actions.readyControl('button', 'Download', false, { scope: `//*[@data-artifact-generation='${png.generation}'][@data-artifact-path='scatter_all.png']` });
            const pngDownloadPath = join(downloads, 'partial-best-verified.png');
            await cli('download', pngDownload, pngDownloadPath);
            const downloadedPng = await readFile(pngDownloadPath);
            record.partialBestDownload = { size: downloadedPng.length, sha256: createHash('sha256').update(downloadedPng).digest('hex') };
            assert.deepEqual(record.partialBestDownload, { size: png.size, sha256: png.sha256 });
            record.partialBestPng = png;
            check(true, 'Browser verified PNG bytes and decoded pixels match actual daemon publication');
          } else {
            assert.equal(record.partialBestPlans.length, 1);
            assert.equal(record.partialBestPlans[0].operation, 'train');
            check(true, 'No plot plan, execution, submission or cancellation persisted for all-partial sources');
          }
          record.finalRegistry = await registry(root);
          assert(record.finalRegistry.control.every(control => !control.cancellation_requested));
          assert(record.finalRegistry.executions.every(execution => !execution.cancel_delivered));
          record.snapshot = await snapshot(); record.status = 'passed'; return;
        }
        if (name === 'wizard-progression') {
          record.wizardSettled = await pollRegistry(root, state => state.plans === 2 && state.executions.length === 2 && state.runs.length === 2 && state.runs.every(run=>run.state==='completed') && state.executions.every(execution=>execution.observed_status==='terminal'), 'Wizard training and automatic plotting terminal', 90000);
          record.wizardManifest = approvedManifest;
          record.wizardPlanId = planned.control[0].plan_id;
          record.wizardSourceManifest = JSON.parse(await command(python, ['-c', `import json,sqlite3,sys
from pathlib import Path
c=sqlite3.connect((Path(sys.argv[1])/"state"/"registry.db").resolve().as_uri()+"?mode=ro",uri=True)
row=c.execute("SELECT plan_json FROM plans WHERE plan_id=?",(sys.argv[2],)).fetchone()
print(json.loads(row[0])["manifest_json"])`, root, record.wizardPlanId]));
          record.wizardDurablePlans = JSON.parse(await command(python, ['-c', `import json,sqlite3,sys
from pathlib import Path
c=sqlite3.connect((Path(sys.argv[1])/"state"/"registry.db").resolve().as_uri()+"?mode=ro",uri=True)
print(json.dumps([{ "planId":r[0],"manifest":json.loads(json.loads(r[1])["manifest_json"])} for r in c.execute("SELECT plan_id,plan_json FROM plans ORDER BY plan_id")]))`, root]));
        }
        if (name === 'cv-parity') {
          const { cvParity } = await import('./browser_cv_parity.mjs');
          await cvParity({ cli, dom, button, actions, registry, pollRegistry, root, downloads, record, python, command, approvedManifest, check });
          record.finalRegistry = await registry(root); record.snapshot = await snapshot(); record.status = 'passed'; return;
        }
        if (name === 'inference-cancellation') {
          const { inferenceCancellation } = await import('./browser_inference_cancellation.mjs');
          await inferenceCancellation({ cli, dom, button, actions, registry, pollRegistry, root, record, python, command, approvedManifest });
          record.finalRegistry = await registry(root); record.snapshot = await snapshot(); record.status = 'passed'; return;
        }
        if (name === 'onnx-export') {
          const { onnxExport } = await import('./browser_onnx_export.mjs');
          await onnxExport({ cli, dom, button, actions, registry, pollRegistry, root, downloads, record, python, command, approvedManifest, check });
          record.finalRegistry = await registry(root); record.snapshot = await snapshot(); record.status = 'passed'; return;
        }
        if (name === 'result-operations') {
          const { resultOperations } = await import('./browser_result_operations.mjs');
          await resultOperations({ cli, dom, button, actions, registry, pollRegistry, root, record, python, command, approvedManifest, check });
          record.finalRegistry = await registry(root); record.snapshot = await snapshot(); record.status = 'passed'; return;
        }
        if (name === 'submitted-plan-authoring-protection') {
          await pollRegistry(root, state => state.plans === 2 && state.executions.length === 2 && state.runs.length === 2 && state.runs.every(run => run.state === 'completed') && state.executions.every(execution => execution.observed_status === 'terminal'), 'Both training and automatic plotting backend terminal observations settled before authoring protection', 90000);
          await submittedPlanProtection({ cli, dom, button, actions, fill, registry, root, record, python, command, repo, approvedManifest, check });
          record.snapshot = await snapshot(); record.status = 'passed'; return;
        }
        if (name === 'download-names') {
          assert(approvedManifest.resolved_config.save_every === 1, 'Filename proof requires genuinely periodic producer publications');
          record.filenameProofTraining = { runId: approvedManifest.run_id, saveEvery: 1 };
          // Automatic plotting is an independent workflow. Wait for its real
          // acknowledgment and completion before checking download-only changes.
          await pollRegistry(root, (state) => state.plans === 2 && state.executions.length === 2 && state.runs.length === 2 && state.runs.every((run) => run.state === 'completed'), 'Independent automatic plotting completion', 90000);
          await downloadNameProvenance({ cli, dom, snapshot, button, registry,
            root, downloads, record, check, actions, python, command });
          record.finalRegistry = await registry(root);
          record.snapshot = await snapshot();
          record.status = 'passed';
          return;
        }
        await actions.button('Results', false, { locator: '[data-testid="nav-results"]' });
        await button('Refresh artifacts');
        await cli('wait', '--text', 'Download');
        if (name === 'artifact-tamper') record.artifactTamperStage = 'select-published-history-row';
        const row = await dom(`JSON.stringify((() => {
          const rows = Array.from(document.querySelector('#results-title').closest('section').querySelectorAll('[data-artifact-path]'));
          const row = ${name === 'artifact-tamper' ? "rows.find(row => row.getAttribute('data-artifact-path') === 'training_history.csv')" : 'rows[0]'};
          return row ? [row.dataset.artifactGeneration + ' / ' + row.dataset.artifactAttempt, row.dataset.artifactPath, row.dataset.artifactSize] : null;
        })())`);
        assert(row, 'No real published artifact row');
        const generation = row[0].split('/')[0].trim();
        const artifactPath = row[1];
        const artifactScope = `//section[@aria-labelledby="results-title"]//*[@data-artifact-generation=${xpathLiteral(row[0].split('/')[0].trim())} and @data-artifact-path=${xpathLiteral(artifactPath)}]`;
        const runId = JSON.parse(record.approvedPlan).run_id;
        const complete = JSON.parse(await readFile(join(root, 'runs', runId, 'checkpoints', generation, 'COMPLETE.json'), 'utf8'));
        const identity = complete.files[artifactPath];
        assert(identity, 'Artifact absent from completed publication');
        record.artifact = { generation, path: artifactPath, ...identity };
        if (name === 'artifact-tamper') {
          assert.equal(artifactPath, 'training_history.csv', 'Download fault must not target background checkpoint selection metadata');
          record.artifactTamperStage = 'download-control-ready';
          const selector = await actions.readyControl('button', 'Download', false, { scope: artifactScope });
          await cli('scrollintoview', selector);
          const targetPath = `/api/runs/${runId}/artifacts/${generation}/${artifactPath}`;
          const faultsBefore = (stdout.match(/Fault: artifact-tampered/g) ?? []).length;
          record.artifactTamperStage = 'arm-exact-download';
          await writeFile(join(root, '.artifact-tamper-arm'), JSON.stringify({ path: targetPath }), { flag: 'wx', mode: 0o600 });
          record.artifactTamperStage = 'native-download-click';
          await cli('click', selector);
          record.artifactTamperStage = 'wait-visible-refusal';
          await cli('wait', '--fn', `document.body.innerText.includes('Artifact verification failed or download was interrupted. No file was published.') || document.body.innerText.includes('The daemon returned an invalid response. Reconnect to verify its identity.')`);
          record.artifactTamperStage = 'verify-wire-receipt';
          const receiptPath = join(root, '.artifact-tamper-receipts.jsonl');
          const receiptDeadline = Date.now() + 5000;
          let receipts;
          do {
            const raw = await readFile(receiptPath, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
            assert(Buffer.byteLength(raw) <= 1048576, 'Artifact receipt exceeds budget');
            receipts = raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
            if (receipts.some(item => item.phase === 'complete')) break;
            await delay(50);
          } while (Date.now() < receiptDeadline);
          assert.equal(receipts.length, 2, 'Exact one-shot artifact arrival and completion required');
          assert.deepEqual(receipts[0], { phase: 'arrival', path: targetPath });
          const receipt = receipts[1];
          assert.equal(receipt.phase, 'complete'); assert.equal(receipt.path, targetPath);
          assert.equal(receipt.status, 200); assert.equal(receipt.tampered, true);
          for (const key of ['original', 'published', 'diskAfter']) assert.deepEqual(receipt[key], identity, 'Original stream and unchanged publication match COMPLETE identity');
          assert.equal(receipt.wire.size, identity.size); assert.match(receipt.wire.sha256, /^[a-f0-9]{64}$/);
          assert.notEqual(receipt.wire.sha256, identity.sha256, 'Outgoing response must actually differ from published bytes');
          record.artifactTamperReceipts = receipts;
          check((stdout.match(/Fault: artifact-tampered/g) ?? []).length > faultsBefore, 'Fixture confirms real artifact response byte was altered for this download');
          record.artifactTamperDownloads = await readdir(downloads);
          check(record.artifactTamperDownloads.length === 0, 'Same-length mismatched real artifact bytes refused before browser download');
          record.refusalUi = (await cli('get', 'text', 'body')).slice(0, 16000);
          record.fault = 'Fixture flips the first byte of the real backend artifact stream, retaining byte length';
          record.artifactTamperStage = 'verified';
        } else {
          const tree = await snapshot();
          assert(tree.includes('button "Download"'), 'Download control missing');
          const selector = await actions.readyControl('button', 'Download', false, { scope: artifactScope });
          assert(selector, 'Download DOM control missing');
          await cli('scrollintoview', selector);
          const path = join(downloads, 'verified-artifact.bin');
          await cli('download', selector, path);
          const bytes = await readFile(path);
          record.verifiedDownload = { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
          check(record.verifiedDownload.size === identity.size && record.verifiedDownload.sha256 === identity.sha256, 'Browser download bytes match real immutable publication size and SHA-256');
        }
      }
    }
    record.finalRegistry = await registry(root);
    record.snapshot ??= await snapshot();
    record.status = 'passed';
  } catch (error) {
    record.status = 'failed';
    console.error(acceptanceDiagnostic(diagnosticStage));
    // Redact all query values, bearer-like strings, and fixture-specific secrets.
    record.error = String(error.message).replace(/bootstrap=[^\s"']+/g, 'bootstrap=[REDACTED]').replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
    if (!browserClosed) {
      let observedUrl;
      try { observedUrl = new URL(await cli('get', 'url')); } catch { /* No page-content reads without a verified origin. */ }
      if (expectedBrowserOrigin && observedUrl?.origin === expectedBrowserOrigin) {
        if (fixtureWebAssets) record.authoringEventDiagnostic = await dom(`JSON.stringify(document.getElementById('wavedl-event-diagnostic')?.textContent ?? null)`).catch(() => null);
        record.snapshot = await snapshot().catch(() => 'Browser snapshot unavailable');
        record.visibleText = (await cli('get', 'text', 'body').catch(() => 'Visible text unavailable')).slice(0, 16000);
        record.browserUrl = observedUrl.href.replace(/bootstrap=[^&#\s]+/g, 'bootstrap=[REDACTED]');
        record.failurePage = await dom(`JSON.stringify({visibility:document.visibilityState,focused:document.hasFocus(),viewport:{width:innerWidth,height:innerHeight},readyState:document.readyState,buttons:Array.from(document.querySelectorAll('button')).slice(0,16).map(e=>{const r=e.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {text:e.textContent.trim(),rects:e.getClientRects().length,disabled:e.disabled,box:{x:r.x,y:r.y,width:r.width,height:r.height},centerExposed:hit===e||e.contains(hit),hit:hit?.tagName}})})`).catch(() => ({ unavailable: true }));
      } else {
        record.browserUrl = observedUrl ? observedUrl.origin : 'Unavailable';
        record.snapshot = 'Not read: fixture origin could not be verified';
        record.failurePage = { outsideFixtureOrigin: true };
      }
    }
    record.fixtureAlive = fixture.exitCode === null && fixture.signalCode === null;
    record.fixtureStderr = stderr.replace(/bootstrap=[^\s"']+/g, 'bootstrap=[REDACTED]').replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
    if (replacement) {
      record.replacementAlive = replacement.exitCode === null && replacement.signalCode === null;
      record.replacementStderr = replacementStderr.replace(/bootstrap=[^\s"']+/g, 'bootstrap=[REDACTED]').replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
      record.replacementFinalRegistry = await registry(replacementRoot).catch(() => null);
    }
    record.ownedSessionStillListed = (await command(browser, ['session', 'list']).catch(() => '')).includes(session);
    record.finalRegistry = await registry(root).catch(() => null);
    if (record.approvedPlan) {
      const runId = JSON.parse(record.approvedPlan).run_id;
      const journal = await readFile(join(root, 'runs', runId, 'attempts', '1', 'events.jsonl'), 'utf8').catch(() => '');
      record.runtimeJournalTail = journal.trim().split('\n').slice(-8).map((line) => line.slice(0, 1500));
    }
  } finally {
    record.cleanup = { errors: [] };
    try {
      await closeOwnedBrowser();
      const closeDeadline = Date.now() + 5000;
      let absent = false;
      while (Date.now() < closeDeadline) {
        const sessions = await command(browser, ['session', 'list'], undefined, Math.max(1, closeDeadline - Date.now()));
        if (!sessions.split('\n').some((line) => line.trim() === session)) { absent = true; break; }
        await delay(Math.max(0, Math.min(100, closeDeadline - Date.now())));
      }
      assert(absent, 'Owned browser session still listed five seconds after close');
      record.cleanup.browserSessionAbsent = true;
    } catch (error) { record.status = 'failed'; record.cleanup.errors.push(`Browser cleanup: ${error.message}`); }
    try {
      await stop(fixture, () => stdout.includes('Fixture: services-closed'));
      record.cleanup.fixtureServicesClosed = true;
      record.cleanup.fixtureExit = { code: fixture.exitCode, signal: fixture.signalCode };
      if (name === 'submitted-plan-authoring-protection' || name === 'wizard-progression' || name === 'preset-import') {
        await assert.rejects(fetch(`${expectedBrowserOrigin}/api/health`, { signal: AbortSignal.timeout(2000) }), error => error?.cause?.code === 'ECONNREFUSED' || error?.code === 'ECONNREFUSED');
        record.cleanup.listenerClosed = true;
      }
    } catch (error) { record.status = 'failed'; record.shutdownError = error.message; }
    active.delete(fixture);
    if (name === 'artifact-tamper' && record.cleanup.fixtureServicesClosed) {
      try {
        const raw = await readFile(join(root, '.artifact-tamper-receipts.jsonl'), 'utf8').catch(error => { if (error.code === 'ENOENT' && record.status === 'failed') return ''; throw error; });
        assert(Buffer.byteLength(raw) <= 1048576, 'Artifact receipt exceeds budget');
        const frozen = raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        if (record.artifactTamperReceipts) assert.deepEqual(frozen, record.artifactTamperReceipts, 'No late artifact fault after refusal');
        record.artifactTamperReceipts = frozen;
        record.artifactTamperDownloads = await readdir(downloads);
        assert.deepEqual(record.artifactTamperDownloads, [], 'No late download after browser closure');
        record.artifactTamperReceiptsFrozenAfterCleanup = true;
      } catch (error) { record.status = 'failed'; record.cleanup.errors.push(`Artifact fault evidence: ${error.message}`); }
    }
    if (integrity && record.cleanup.fixtureServicesClosed) {
      try {
        const lines = async file => { const raw = await readFile(join(root, file), 'utf8'); assert(Buffer.byteLength(raw) <= 1048576); return raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); };
        record.integrityWire = await lines('.metadata-integrity-requests.jsonl');
        record.integrityRequests = await lines('.request-metadata.jsonl');
        record.integrityReceipts = await lines('.plan-request-receipts.jsonl');
        record.integrityInventories = await lines('.partial-best-inventory.jsonl');
        record.integrityFrozenRegistry = await registry(root);
        record.integrityPlans = JSON.parse(await command(python, ['-c', 'import json,sqlite3,sys; from pathlib import Path; c=sqlite3.connect((Path(sys.argv[1])/"state/registry.db").resolve().as_uri()+"?mode=ro",uri=True); print(json.dumps([json.loads(json.loads(r[0])["manifest_json"]) for r in c.execute("SELECT plan_json FROM plans")]))', root]));
        assert.deepEqual(record.integrityFrozenRegistry, record.finalRegistry);
        record.integrityFrozenAfterCleanup = true;
        await assert.rejects(fetch(`${expectedBrowserOrigin}/api/health`, { signal: AbortSignal.timeout(2000) }), error => error?.cause?.code === 'ECONNREFUSED' || error?.code === 'ECONNREFUSED');
        record.cleanup.listenerClosed = true;
      } catch (error) { record.status = 'failed'; record.cleanup.errors.push(`Metadata integrity evidence: ${error.message}`); }
    }
    if (partialBest && !integrity && record.cleanup.fixtureServicesClosed) {
      try {
        record.partialBestFrozenRegistry = await registry(root);
        assert.deepEqual(record.partialBestFrozenRegistry, record.finalRegistry, 'No late plan, run or cancellation after browser closure');
        const requests = await readFile(join(root, '.request-metadata.jsonl'), 'utf8');
        assert(Buffer.byteLength(requests) <= 1048576);
        record.partialBestRequests = requests.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        const inventories = await readFile(join(root, '.partial-best-inventory.jsonl'), 'utf8');
        assert(Buffer.byteLength(inventories) <= 1048576);
        record.partialBestInventories = inventories.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        assert(record.partialBestInventories.length > 0);
        const actual = record.partialBestInventories[0];
        assert.equal(actual.status, 200);
        const partial = actual.body.generations.find(item => item.generation === record.partialBestPublication.partialGeneration);
        assert(partial);
        assert.deepEqual(partial.files, record.partialBestPublication.partialComplete.files);
        assert.equal(actual.body.generations.some(item => item.generation === record.partialBestPublication.olderCompleteBest), partialBest === 'fallback');
        const mutations = record.partialBestRequests.filter(request => request.method === 'POST');
        const expected = partialBest === 'fallback' ? 2 : 1;
        const receipts = await readFile(join(root, '.plan-request-receipts.jsonl'), 'utf8');
        assert(Buffer.byteLength(receipts) <= 1048576);
        record.partialBestPlanReceipts = receipts.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        assert.equal(record.partialBestPlanReceipts.length, expected);
        assert.equal(mutations.filter(request => request.path === '/api/runs/plan').length, expected);
        assert.equal(mutations.filter(request => request.path === '/api/runs').length, expected);
        assert(!record.partialBestRequests.some(request => request.method === 'POST' && request.path.endsWith('/cancel')));
        record.partialBestFrozenAfterCleanup = true;
      } catch (error) { record.status = 'failed'; record.cleanup.errors.push(`Partial best evidence: ${error.message}`); }
    }
    if (name === 'dataset-parity' && record.cleanup.fixtureServicesClosed) {
      try {
        const metadata = await readFile(join(root, '.request-metadata.jsonl'), 'utf8');
        assert(Buffer.byteLength(metadata) <= 1024 * 1024, 'Dataset request evidence exceeded byte bound');
        record.datasetRequests = metadata.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        record.datasetRequestsFrozenAfterCleanup = true;
      } catch (error) { record.status = 'failed'; record.cleanup.errors.push(`Dataset request evidence: ${error.message}`); }
    }
    if (name === 'training-validation' && record.cleanup.fixtureServicesClosed) {
      try {
        const requests = await readFile(join(root, '.request-metadata.jsonl'), 'utf8');
        const receipts = await readFile(join(root, '.plan-request-receipts.jsonl'), 'utf8');
        assert(Buffer.byteLength(requests) <= 1048576 && Buffer.byteLength(receipts) <= 1048576, 'Training validation request evidence exceeded byte bound');
        record.trainingValidationRequests = requests.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        record.trainingValidationReceipts = receipts.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        record.trainingValidationRequestsFrozenAfterCleanup = true;
      } catch (error) { record.status = 'failed'; record.cleanup.errors.push(`Training validation request evidence: ${error.message}`); }
    }
    if (name === 'preset-import' && record.cleanup.fixtureServicesClosed) {
      try {
        const requests = await readFile(join(root, '.request-metadata.jsonl'), 'utf8');
        const receipts = await readFile(join(root, '.plan-request-receipts.jsonl'), 'utf8');
        assert(Buffer.byteLength(requests) <= 1048576 && Buffer.byteLength(receipts) <= 1048576,
          'Preset import request evidence exceeded byte bound');
        record.presetImportRequests = requests.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        record.presetImportReceipts = receipts.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        record.presetImportDurableCounts = JSON.parse(await command(python, ['-c',
          'import json,sqlite3,sys; from pathlib import Path; c=sqlite3.connect((Path(sys.argv[1])/"state"/"registry.db").resolve().as_uri()+"?mode=ro",uri=True); names=("plans","plan_control","execution_control","submission_control","runs","runtime_provenance","event_log"); print(json.dumps({name:c.execute("SELECT COUNT(*) FROM "+name).fetchone()[0] for name in names}))', root]));
        record.presetImportRequestsFrozenAfterCleanup = true;
      } catch (error) { record.status = 'failed'; record.cleanup.errors.push(`Preset import evidence: ${error.message}`); }
    }
    if (name === 'dataset-parity' && record.status === 'failed' && record.cleanup.browserSessionAbsent && record.cleanup.fixtureServicesClosed) {
      try {
        const evidence = await retainFailurePrefixes({
          downloads,
          destination: join(workspace, 'dataset-failure-prefixes'),
          expected: record.datasetVerifiedDownloadNames ?? [],
        });
        record.datasetFailurePrefixEvidence = evidence;
        record.cleanup.datasetFailurePrefixEvidenceRetained = true;
      } catch (error) {
        record.status = 'failed';
        record.datasetFailurePrefixEvidence = error.evidence ?? { status: 'failed' };
        record.cleanup.errors.push(`Dataset failure evidence: ${error.code ?? 'EVIDENCE_FAILED'}`);
      }
    }
    if (replacement) {
      try {
        await stop(replacement, () => replacementStdout.includes('Fixture: services-closed'));
        record.cleanup.replacementServicesClosed = true;
        record.cleanup.replacementExit = { code: replacement.exitCode, signal: replacement.signalCode };
      } catch (error) { record.status = 'failed'; record.shutdownError = `${record.shutdownError ?? ''} Replacement: ${error.message}`; }
      active.delete(replacement);
    }
    if (liveReplacement && replacement && record.cleanup.browserSessionAbsent && record.cleanup.replacementServicesClosed) {
      try {
        await captureReplacementMetadata();
        record.replacementMetadataFrozenAfterCleanup = true;
        record.replacementMetadataComplete = true;
        record.replacementAfterStaleSubmit = await registry(replacementRoot);
        assert(record.replacementAfterStaleSubmit.plans === 0 && ['runs', 'control', 'executions'].every((key) => record.replacementAfterStaleSubmit[key].length === 0), 'Frozen replacement registry contains late foreign mutation');
      } catch (error) { record.status = 'failed'; record.cleanup.errors.push(`Final replacement evidence: ${error.message}`); }
    }
    if (tokenFile) {
      try {
        await rm(tokenFile);
        record.cleanup.privateCredentialRemoved = true;
      } catch (error) { record.status = 'failed'; record.cleanup.errors.push(`Private credential cleanup: ${error.message}`); }
    }
    record.finished = new Date().toISOString();
    // Only this mkdtemp-owned scenario root; never configured user storage.
    if (record.shutdownError || record.cleanup.errors.length) {
      record.cleanup.retainedPrivateRoots = [root, downloads, browserProfile, ...(replacementRoot ? [replacementRoot] : [])];
      record.cleanup.reason = 'Cleanup could not verify owned process/session shutdown; private data retained for inspection. No descendant or user process was broadly killed.';
      console.log(`${name}: private fixture/download roots retained because shutdown could not be verified`);
    } else {
      try {
        await rm(root, { recursive: true, force: true });
        await rm(downloads, { recursive: true, force: true });
        await rm(browserProfile, { recursive: true, force: true });
        try { await access(browserProfile); throw new Error('Owned browser profile remains after cleanup'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        record.cleanup.browserProfileRemoved = true;
        if (replacementRoot) {
          await rm(replacementRoot, { recursive: true, force: true });
          await Promise.all([root, downloads, replacementRoot].map(async (path) => {
            try { await access(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
            throw new Error('Owned port-reuse root remains after cleanup');
          }));
          record.cleanup.bothDaemonRootsAbsent = true;
        }
        record.cleanup.removedOwnedRoots = true;
      } catch (error) { record.status = 'failed'; record.cleanup.errors.push(`Owned root cleanup: ${error.message}`); }
    }
    const sanitizedRecord = sanitizePrivate(record);
    for (const key of Object.keys(record)) delete record[key];
    Object.assign(record, sanitizedRecord);
    if (record.cleanup.errors.length) console.error(acceptanceDiagnostic('cleanup'));
    await writeFile(join(workspace, `${name}.json`), serializePrivate(record), { mode: 0o600 });
    sharedToken = null;
    console.log(`${name}: ${record.status}`);
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of active) child.kill('SIGINT');
  process.exitCode = 130;
});
try {
  for (const name of selected === 'all' ? cases : [selected]) {
    if (shuttingDown) break;
    await scenario(name);
  }
} finally {
  evidence.finished = new Date().toISOString();
  await writeFile(join(workspace, 'summary.json'), serializePrivate(evidence), { mode: 0o600 });
  console.log(`Nonsecret evidence: ${join(workspace, 'summary.json')}`);
}
if (evidence.cases.some((record) => record.status !== 'passed')) process.exitCode = 1;
