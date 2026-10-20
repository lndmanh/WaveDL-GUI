import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { requiredCases, verifyCliPath, verifySummary, verifyWorkspace } from './verify_browser_ci_report.mjs';

const inventory = JSON.parse(await readFile(new URL('../web/shared/training-options.json', import.meta.url)));
const authored = { epochs: 11, patience: 4, batch_size: 8, lr: 0.003, seed: 37, workers: 0, precision: 'no', weight_decay: 0.002 };
function authoringRecord(workspace) {
  const defaults = Object.fromEntries(inventory.map((option) => [option.name, option.default]));
  const config = {...defaults, ...authored, model: 'cnn', data_path: "/owned/authoring 'quoted' $;/samples.npz"};
  const interpreter = '/owned/python';
  const argv = [interpreter, '-m', 'wavedl.launcher', '--num_gpus', '1', '--mixed_precision', 'no', '--cpu'];
  for (const option of inventory) {
    const value = config[option.name];
    if (value === null || value === false || (Array.isArray(value) && !value.length)) continue;
    const flag = option.name === 'import_modules' ? '--import' : `--${option.name}`;
    if (value === true) argv.push(flag);
    else if (Array.isArray(value)) argv.push(flag, ...value.map(String));
    else argv.push(`${flag}=${value}`);
  }
  argv.push('--output_dir', './results');
  const manifest = {resolved_config: {...config, epochs: 12}, runtime: {python: interpreter, device: 'cpu'}};
  const initial = ['original-plan', JSON.stringify(config), JSON.stringify({manifest_json: JSON.stringify({...manifest, resolved_config: config})})];
  const final = ['revised-plan', JSON.stringify({...config, epochs: 12}), JSON.stringify({manifest_json: JSON.stringify(manifest)})];
  const downloadConfigs = [config, {...defaults, model: config.model, data_path: config.data_path}, config, {...config, epochs: 12}];
  return {
    pythonInterpreter: interpreter, guidedSelectionsPreserved: true,
    downloadSettingsGuidance: 'Your browser chooses where downloads are saved.',
    resetContract: {restoredBundledDefaults: true, interpreterPreserved: true, savedNewRunEpochs: 19, restoredEpochs: defaults.epochs},
    authoringExports: {
      allTrainingKeys: inventory.map((option) => option.name).sort(), inventoryCount: inventory.length,
      authoredValues: authored, yamlConfig: config, parsedCommandArgv: argv,
      browserDownloadPath: join(workspace, 'authoring-parity-downloads'), partialFieldAuthoring: true,
      exportSafety: {
        environmentDownload: { filename: 'authoring-environment.yaml', size: 100,
          sha256: 'b'.repeat(64), config, },
        environmentOmitted: true, environmentCommandRefused: true, topologyCommandRefused: true,
      },
    },
    authoringDownloadEvidence: ['authoring-before-reset.yaml', 'authoring-after-reset.yaml', 'authoring-before-plan.yaml', 'authoring-after-preview.yaml'].map((filename, index) => {
      const bytes = Buffer.from(JSON.stringify(downloadConfigs[index]));
      return {filename, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), config: downloadConfigs[index]};
    }),
    authoringPlanEvidence: {initialRows: [initial], finalRows: [initial, final], finalApprovedManifest: manifest, noSubmission: true, invalidRangeBlocked: true, malformedPresetBlocked: true, forbiddenPresetFields: ['import_modules']},
    finalRegistry: {plans: 2, runs: [], executions: [], control: [{submission_requested: 0, cancellation_requested: 0}, {submission_requested: 0, cancellation_requested: 0}]},
  };
}

function nativeDownloadRecord() {
  const runId = '12345678-1234-1234-1234-123456789012';
  const downloads = ['gen-000001', 'gen-000002'].map((generation) => ({
    generation, attempt: 1, path: 'checkpoint_selection.json',
    filename: `${runId}_${generation}_checkpoint_selection.json`,
    size: 100, expectedSize: 100, sha256: 'a'.repeat(64), expectedSha256: 'a'.repeat(64),
  }));
  const paths = ['left/metrics.csv', 'right/metrics.csv', 'METRICS.csv', 'a?.csv', 'a*.csv'];
  const generation = 'gen-000003';
  const completeText = JSON.stringify({ run_id: runId, generation, attempt: 1,
    files: Object.fromEntries(paths.map(path => [path, { size: 100, sha256: 'a'.repeat(64) }])) });
  const nativeAliasDownloads = { runId, generation, attempt: 1, paths,
    sourceGeneration: 'gen-000001', sourceSize: 100, sourceSha256: 'a'.repeat(64),
    completeText, completeSha256: createHash('sha256').update(completeText).digest('hex'),
    fixturePublication: true, nativeClick: true,
    downloads: paths.map(path => ({path, size: 100, sha256: 'a'.repeat(64),
      filename: `${runId}_${generation}_${path.split('/').at(-1).replace(/[?*]/g, '_').slice(0, -4)}_${createHash('sha256').update(path).digest('hex').slice(0, 24)}.csv`})) };
  return {
    approvedPlan: JSON.stringify({run_id: runId, resolved_config: {save_every: 1, epochs: 3}, runtime: {device: 'cpu'}}),
    filenameProofTraining: {runId, saveEvery: 1},
    nativeDownloadNames: {runId, basename: 'checkpoint_selection.json', publicationCount: 2, nativeClick: true, readOnlyEvidence: true, downloads},
    nativeAliasDownloads,
    finalRegistry: {plans: 2, runs: [{run_id: runId, state: 'completed'}, {run_id: 'actual-plot-run', state: 'completed'}], executions: [{}, {}], control: [{submission_requested: 1, cancellation_requested: 0}, {submission_requested: 1, cancellation_requested: 0}]},
  };
}

function datasetRecord() {
  const views = ['Input distribution', 'Output distribution', 'Samples', 'Correlation', 'Statistics', 'Scatter'];
  const expectedFor = rows => ({rows, inputShape: [32], outputShape: [12], inputDtype: 'float32', outputDtype: 'float32', inputSha256: 'b'.repeat(64), outputSha256: 'c'.repeat(64), means: Array(32).fill(1), stds: Array(32).fill(rows === 1 ? 0 : 2)});
  const statisticsFor = expected => expected.means.map((mean, index) => [String(index), mean === null ? 'Missing' : String(mean), expected.stds[index] === null ? 'Missing' : String(expected.stds[index])]);
  const state = {plans: 0, runs: [], control: [], executions: []};
  const formats = ['samples.npz', 'samples.mat', 'samples.h5', 'samples.hdf5', 'one-row.npz'].map(name => {
    const rows = name === 'one-row.npz' ? 1 : 96;
    const expected = expectedFor(rows);
    return {name, expected, statistics: statisticsFor(expected),
      header: {Format: name.split('.').at(-1).toUpperCase(), Samples: String(rows), 'Input key': 'X', 'Output key': 'y', 'Input shape': '32', 'Output shape': '12', 'Input dtype': 'float32', 'Output dtype': 'float32', 'File size': 'Unknown'},
      bounds: `Bounded preview: ${rows} of ${rows} rows. This is not a full-dataset analysis`,
      views: views.map(view => {
        const unavailable = rows === 1 && view === 'Correlation';
        const count = view === 'Samples' ? Math.min(3, rows) : view === 'Correlation' ? (unavailable ? 0 : 1) : view === 'Statistics' ? 2 : 8;
        return {view, figures: Array.from({length: count}, (_, index) => ({title: `${view} ${index}`, canvases: [{width: 500, height: 260, painted: 1200}]})),
          ...(unavailable ? {guidance: 'Correlation requires at least two sampled rows.', download: null} : {download: {filename: `dataset-${name}-${view.toLowerCase().replaceAll(' ', '-')}.png`, nativeFilename: view === 'Correlation' ? 'dataset-heatmap.png' : 'dataset-preview.png', nativeClick: true, targetOverridden: false, renamedForEvidence: true, width: 500, height: 260, size: 1024, sha256: 'a'.repeat(64), decoded: true, coloredPixels: 100}})};
      }),
    };
  });
  const nonfiniteExpected = expectedFor(96);
  nonfiniteExpected.means[0] = nonfiniteExpected.stds[0] = null;
  const raster = {width: 500, height: 260, sha256: 'e'.repeat(64)};
  const interaction = (view, flag, actions) => ({file: 'samples.npz', view, [flag]: true, resetRestored: true, actions,
    baseline: {...raster}, changed: {...raster, sha256: 'f'.repeat(64)}, restored: {...raster}});
  return {datasetParity: {
    scope: 'Same-host real daemon/static app; bounded previews, not full-dataset or remote acceptance', formats,
    interactive: {
      sample: interaction('Samples', 'dragChanged', ['mouse move', 'mouse down left', 'mouse move', 'mouse up left', 'Reset zoom']),
      correlation: interaction('Correlation', 'zoomAndPanChanged', ['focus', '+', 'ArrowRight', '0']),
    },
    nonfinite: {expected: nonfiniteExpected, statistics: statisticsFor(nonfiniteExpected), missingExplicit: true, figures: structuredClone(formats[0].views[4].figures)},
    csvExport: {available: false, reason: 'No CSV control is exposed by the dataset workspace'},
    replacementRefusal: {reason: 'Real selected file replaced with unsupported nonnumeric arrays', visibleMessage: 'Unsupported dataset dtype', oldChartsCleared: true},
    registryBefore: structuredClone(state), registryAfter: structuredClone(state),
  }, finalRegistry: structuredClone(state)};
}

function lostAckRecord() {
  const identity = {planId: '11111111-1111-4111-8111-111111111111',
    runId: '22222222-2222-4222-8222-222222222222', requestId: '33333333-3333-4333-8333-333333333333'};
  const source = {plan_id: identity.planId, run_id: identity.runId, request_id: identity.requestId,
    state: 'submitted', receipt_run_id: identity.runId, receipt_request_id: identity.requestId,
    supervisor_id: 'a'.repeat(43), pid: 1234};
  const accepted = {plans: 1, runs: [], control: [{plan_id: identity.planId,
    submission_requested: 1, cancellation_requested: 0}], submissions: [source], executions: []};
  const before = structuredClone(accepted);
  before.control[0].submission_requested = 0;
  before.submissions = [];
  const bound = structuredClone(accepted);
  bound.executions = [{plan_id: identity.planId, run_id: identity.runId,
    request_id: identity.requestId, supervisor_id: source.supervisor_id, pid: source.pid, attempt: 1}];
  return {approvedPlan: JSON.stringify({run_id: identity.runId}), lostAckRecovery: {
    scope: 'Observed durable writer submission and verified initial runtime binding; not training completion or lifetime exactly-once proof',
    identity, before, accepted, recovered: structuredClone(accepted), bound,
    acknowledged: structuredClone(bound), acknowledgedUi: {disabled: true, runId: identity.runId},
  }};
}

function artifactTamperRecord() {
  const runId = '11111111-1111-4111-8111-111111111111';
  const identity = {size: 123, sha256: 'a'.repeat(64)};
  const artifact = {generation: 'gen-000001', path: 'training_history.csv', ...identity};
  const path = `/api/runs/${runId}/artifacts/${artifact.generation}/${artifact.path}`;
  return {artifact, approvedPlan: JSON.stringify({run_id: runId}),
    artifactTamperStage: 'verified', artifactTamperDownloads: [],
    artifactTamperReceiptsFrozenAfterCleanup: true,
    refusalUi: 'Artifact verification failed or download was interrupted. No file was published.',
    artifactTamperReceipts: [{phase: 'arrival', path}, {phase: 'complete', path, status: 200,
      tampered: true, original: {...identity}, published: {...identity}, diskAfter: {...identity},
      wire: {size: identity.size, sha256: 'b'.repeat(64)}}]};
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'wavedl-report-guard-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, 'wavedl-browser-acceptance-owned');
  await mkdir(workspace);
  const manifest = join(root, 'manifest.json');
  const bytes = Buffer.from('{"index.html":"generated-build"}\n');
  await writeFile(manifest, bytes);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const summary = {
    browser: 'agent-browser 0.26.0',
    finished: '2026-10-09T00:01:00.000Z',
    cases: requiredCases.map((name) => ({
      name, browser: 'agent-browser 0.26.0', status: 'passed',
      driverReadinessMode: 'sync-exposure-poll-and-two-controller-dom-observations',
      browserViewport: {width: 1280, height: 900},
      browserProfile: {path: join(workspace, `${name}-browser-profile`), initiallyEmpty: true},
      started: '2026-10-09T00:00:00.000Z', finished: '2026-10-09T00:01:00.000Z',
      assertions: ['Executable runner assertion'], assetManifestSha256: hash,
      ...(name === 'authoring-parity' ? authoringRecord(workspace) : {}),
      ...(name === 'download-names' ? nativeDownloadRecord() : {}),
      ...(name === 'dataset-parity' ? datasetRecord() : {}),
      ...(name === 'lost-ack' ? lostAckRecord() : {}),
      ...(name === 'artifact-tamper' ? artifactTamperRecord() : {}),
      ...(name === 'live-port-reuse' ? {
        initialRuntimeCursor: { runId: 'owned-run', attempt: 1, seq: 3, eventType: 'metric' },
        initialMetricEvidence: { persistedMetricCount: 1, persistedLogCount: 1, producerJournalMatches: true, durableCursors: [{attempt: 1, seq: 3}] },
        liveMonitorBeforeReplacement: {
          selectedRunId: 'owned-run', epoch: 1, historySteps: 1,
          historyCanvasPresent: true, diagnosticLogPresent: true,
          ownedRuntimePid: 42,
        },
        originalTerminationBeforeRootCleanup: {
          cause: 'owned-fixture-shutdown', servicesClosed: true, ownedRuntimePid: 42,
          pidAbsent: true, runtimeJournalExit: { run_id: 'owned-run', attempt: 1, seq: 4, type: 'exit', payload: { status: 'cancelled', code: 130 } },
          runtimeOutcome: 'cancelled',
          nativeProcessResult: {
            runId: 'owned-run', attempt: 1, pid: 42,
            returncode: -2, cancelled: true, timedOut: false,
          },
        },
        originalDaemon: { daemonId: 'original', buildId: 'same-build' },
        replacementDaemon: { daemonId: 'replacement', buildId: 'same-build' },
        originalDaemonStoppedBeforePortReuse: true,
        replacementOrigins: { original: 'http://127.0.0.1:8765', replacement: 'http://127.0.0.1:8765', identical: true },
        replacementMetadataComplete: true,
        replacementMetadataFrozenAfterCleanup: true,
        transportScopeRetired: false, explicitReauthAttempted: false,
        liveIdentityFence: {
          identityMessage: true, selectedRunAbsent: true, metricHistoryAbsent: true,
          diagnosticsAbsent: true, noEnabledCancel: true, previewAbsent: true,
        },
        replacementAccessMetadata: [{ method: 'GET', path: '/api/health', status: 409, scopeHeaderPresent: true }],
        replacementAfterStaleSubmit: { plans: 0, runs: [], control: [], executions: [] },
      } : {}),
      cleanup: {
        errors: [], browserSessionAbsent: true, fixtureServicesClosed: true,
        removedOwnedRoots: true,
        browserProfileRemoved: true,
        ...(['port-reuse', 'live-port-reuse'].includes(name) ? {
          replacementServicesClosed: true, bothDaemonRootsAbsent: true,
          privateCredentialRemoved: true,
        } : {}),
      },
    })),
  };
  const summaryPath = join(workspace, 'summary.json');
  const save = async () => {
    await writeFile(summaryPath, JSON.stringify(summary));
    for (const record of summary.cases) {
      await writeFile(join(workspace, `${record.name}.json`), JSON.stringify(record));
    }
  };
  await save();
  return { root, workspace, manifest, summary, summaryPath, save, hash };
}

test('accepts exactly twelve passed cases tied to the generated build and cleanup', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await verifyWorkspace(f.root, f.manifest), {
    cases: 12, assetManifestSha256: f.hash,
  });
});

for (const [name, mutate] of [
  ['missing writer history', r => { delete r.lostAckRecovery; }],
  ['foreign recovery request', r => { r.lostAckRecovery.recovered.submissions[0].request_id = 'foreign'; }],
  ['duplicate writer submission', r => { r.lostAckRecovery.accepted.submissions.push(r.lostAckRecovery.accepted.submissions[0]); }],
  ['unbound final execution', r => { r.lostAckRecovery.bound.executions = []; }],
  ['rotated runtime attempt', r => { r.lostAckRecovery.acknowledged.executions[0].attempt = 2; }],
]) test(`aggregate rejects lost ACK ${name}`, async t => {
  const f = await fixture(t);
  mutate(f.summary.cases.find(record => record.name === 'lost-ack'));
  await f.save();
  await assert.rejects(verifySummary(f.summaryPath, f.manifest));
});

for (const [name, mutate] of [
  ['legacy fault without receipt', r => { delete r.artifactTamperReceipts; }],
  ['metadata consumer fault', r => { r.artifact.path = 'checkpoint_selection.json'; }],
  ['uncorrupted response', r => { r.artifactTamperReceipts[1].wire.sha256 = r.artifact.sha256; }],
  ['disk mutation', r => { r.artifactTamperReceipts[1].diskAfter.sha256 = 'c'.repeat(64); }],
]) test(`aggregate rejects artifact ${name}`, async t => {
  const f = await fixture(t);
  mutate(f.summary.cases.find(record => record.name === 'artifact-tamper'));
  await f.save();
  await assert.rejects(verifySummary(f.summaryPath, f.manifest));
});

test('accepts the owned report workspace directly through the CLI path helper', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await verifyCliPath(f.workspace, f.manifest), {
    cases: 12, assetManifestSha256: f.hash,
  });
});

test('accepts actual browser collision suffixes independently of descriptive dataset evidence aliases', async (t) => {
  const f = await fixture(t);
  const proof = f.summary.cases.find(record => record.name === 'dataset-parity').datasetParity;
  proof.formats[0].views[0].download.nativeFilename = 'dataset-preview (1).png';
  proof.formats[0].views[3].download.nativeFilename = 'dataset-heatmap (29).png';
  await f.save();
  assert.equal((await verifyWorkspace(f.root, f.manifest)).cases, 12);
});

test('accepts genuinely unknown producer outcome independently of native cancellation', async (t) => {
  const f = await fixture(t);
  const r = f.summary.cases.find((record) => record.name === 'live-port-reuse');
  r.originalTerminationBeforeRootCleanup.runtimeJournalExit = null;
  r.originalTerminationBeforeRootCleanup.runtimeOutcome = 'unknown';
  r.originalTerminationBeforeRootCleanup.nativeProcessResult.returncode = 143;
  r.transportScopeRetired = true;
  r.explicitReauthAttempted = true;
  r.transportRetirementBeforeReplacement = {historyAbsent: true, credentialFieldEmpty: true, noEnabledCancel: true};
  await f.save();
  assert.equal((await verifyWorkspace(f.root, f.manifest)).cases, 12);
});
for (const [status, code] of [['completed', 0], ['failed', 1]]) {
  test(`accepts genuine ${status} producer outcome independently of cancelled native result`, async (t) => {
    const f = await fixture(t);
    const termination = f.summary.cases.find((r) => r.name === 'live-port-reuse').originalTerminationBeforeRootCleanup;
    termination.runtimeJournalExit.payload = {status, code};
    termination.runtimeOutcome = status;
    await f.save();
    assert.equal((await verifyWorkspace(f.root, f.manifest)).cases, 12);
  });
}

for (const [name, mutate] of [
  ['historical eleven-case report', (s) => { s.cases = s.cases.filter((r) => r.name !== 'dataset-parity'); }],
  ['historical ten-case report', (s) => { s.cases = s.cases.filter((r) => r.name !== 'download-names'); }],
  ['historical nine-case report', (s) => { s.cases = s.cases.filter((r) => r.name !== 'authoring-parity'); }],
  ['missing case', (s) => s.cases.pop()],
  ['empty summary', (s) => { s.cases = []; }],
  ['duplicate case', (s) => { s.cases[1] = structuredClone(s.cases[0]); }],
  ['unknown case', (s) => { s.cases[0].name = 'unknown'; }],
  ['failed case', (s) => { s.cases[0].status = 'failed'; }],
  ['skipped case', (s) => { s.cases[0].status = 'skipped'; }],
  ['skip flag on passed case', (s) => { s.cases[0].skipped = false; }],
  ['error on passed case', (s) => { s.cases[0].error = 'failure'; }],
  ['shutdown error', (s) => { s.cases[0].shutdownError = 'unverified'; }],
  ['missing cleanup', (s) => { delete s.cases[0].cleanup; }],
  ['cleanup errors', (s) => { s.cases[0].cleanup.errors.push('error'); }],
  ['retained private roots', (s) => { s.cases[0].cleanup.retainedPrivateRoots = []; }],
  ['no assertions', (s) => { s.cases[0].assertions = []; }],
  ['unfinished summary', (s) => { delete s.finished; }],
  ['unfinished case', (s) => { delete s.cases[0].finished; }],
  ['untested browser', (s) => { s.browser = 'agent-browser 0.27.0'; }],
  ['mixed browser', (s) => { s.cases[0].browser = 'agent-browser 0.25.0'; }],
  ['missing bounded driver mode', (s) => { delete s.cases[0].driverReadinessMode; }],
  ['wrong driver mode', (s) => { s.cases[0].driverReadinessMode = 'two-render-frames'; }],
  ['missing actual viewport', (s) => { delete s.cases[0].browserViewport; }],
  ['wrong actual viewport', (s) => { s.cases[0].browserViewport.width = 0; }],
  ['nonempty initial browser profile', (s) => { s.cases[0].browserProfile.initiallyEmpty = false; }],
  ['foreign browser profile path', (s) => { s.cases[0].browserProfile.path = '/user/baseline-browser-profile'; }],
  ['stale assets', (s) => { s.cases[0].assetManifestSha256 = '0'.repeat(64); }],
  ['diagnostic build cannot certify baseline', (s) => { s.cases[0].explicitFixtureWebAssets = '/private/tmp/diagnostic-build'; }],
  ['instrumented event trace cannot certify baseline', (s) => { s.cases[0].authoringEventDiagnostic = '[]'; }],
  ['private failure prefixes cannot certify a passing case', (s) => { s.cases[0].datasetFailurePrefixEvidence = { status: 'retained' }; }],
]) {
  test(`rejects ${name}`, async (t) => {
    const f = await fixture(t);
    mutate(f.summary);
    await f.save();
    await assert.rejects(verifyWorkspace(f.root, f.manifest));
  });
}

for (const [name, mutate] of [
  ['missing dataset proof', r => { delete r.datasetParity; }],
  ['missing interactive proof', r => { delete r.datasetParity.interactive; }],
  ['invented all-format interaction scope', r => { r.datasetParity.interactive.allFormats = true; }],
  ...['sample', 'correlation'].flatMap(key => [
    [`${key} missing`, r => { delete r.datasetParity.interactive[key]; }],
    [`${key} false native interaction`, r => { r.datasetParity.interactive[key][key === 'sample' ? 'dragChanged' : 'zoomAndPanChanged'] = false; }],
    [`${key} false reset`, r => { r.datasetParity.interactive[key].resetRestored = false; }],
    [`${key} wrong file`, r => { r.datasetParity.interactive[key].file = 'samples.mat'; }],
    [`${key} wrong actions`, r => { r.datasetParity.interactive[key].actions.pop(); }],
    [`${key} wrong view`, r => { r.datasetParity.interactive[key].view = 'Scatter'; }],
    [`${key} unchanged raster`, r => { r.datasetParity.interactive[key].changed.sha256 = r.datasetParity.interactive[key].baseline.sha256; }],
    [`${key} unrestored raster`, r => { r.datasetParity.interactive[key].restored.sha256 = 'f'.repeat(64); }],
    ...['baseline', 'changed', 'restored'].flatMap(phase => [
      [`${key} missing ${phase}`, r => { delete r.datasetParity.interactive[key][phase]; }],
      [`${key} invalid ${phase} hash`, r => { r.datasetParity.interactive[key][phase].sha256 = 'bad'; }],
      [`${key} changed ${phase} dimensions`, r => { r.datasetParity.interactive[key][phase].width = 8193; }],
    ]),
  ]),
  ['missing extension', r => { r.datasetParity.formats.splice(2, 1); }],
  ['duplicate extension', r => { r.datasetParity.formats[2] = structuredClone(r.datasetParity.formats[0]); }],
  ['forged extension', r => { r.datasetParity.formats[2].name = 'samples.csv'; }],
  ['missing view', r => { r.datasetParity.formats[0].views.pop(); }],
  ['duplicate view', r => { r.datasetParity.formats[0].views[1] = structuredClone(r.datasetParity.formats[0].views[0]); }],
  ['forged header samples', r => { r.datasetParity.formats[0].header.Samples = '512'; }],
  ['forged header shape', r => { r.datasetParity.formats[0].header['Input shape'] = '16'; }],
  ['invented header file size', r => { r.datasetParity.formats[0].header['File size'] = '1024'; }],
  ['missing actual statistics', r => { delete r.datasetParity.formats[0].statistics; }],
  ['forged actual mean', r => { r.datasetParity.formats[0].statistics[0][1] = '123'; }],
  ['forged expected numbers across formats', r => { r.datasetParity.formats[1].expected.means[0] = 123; r.datasetParity.formats[1].statistics[0][1] = '123'; }],
  ['missing canonical input byte hash', r => { delete r.datasetParity.formats[0].expected.inputSha256; }],
  ['invalid canonical output byte hash', r => { r.datasetParity.formats[0].expected.outputSha256 = 'invalid'; }],
  ['different real input array bytes across formats', r => { r.datasetParity.formats[1].expected.inputSha256 = 'd'.repeat(64); }],
  ['different real output array bytes across formats', r => { r.datasetParity.formats[1].expected.outputSha256 = 'd'.repeat(64); }],
  ['nonfinite missing canonical array byte hash', r => { delete r.datasetParity.nonfinite.expected.inputSha256; }],
  ['empty statistic masquerading as zero', r => { r.datasetParity.formats[4].statistics[0][2] = ''; }],
  ['unbounded canvas', r => { r.datasetParity.formats[0].views[0].figures[0].canvases[0].width = 8193; }],
  ['blank canvas', r => { r.datasetParity.formats[0].views[0].figures[0].canvases[0].painted = 0; }],
  ['missing PNG decode', r => { delete r.datasetParity.formats[0].views[0].download.decoded; }],
  ['missing native PNG click', r => { delete r.datasetParity.formats[0].views[0].download.nativeClick; }],
  ['non-native PNG click', r => { r.datasetParity.formats[0].views[0].download.nativeClick = false; }],
  ['missing native PNG name', r => { delete r.datasetParity.formats[0].views[0].download.nativeFilename; }],
  ['descriptive alias mistaken for native PNG name', r => { const file = r.datasetParity.formats[0].views[0].download; file.nativeFilename = file.filename; }],
  ['wrong native plot PNG name', r => { r.datasetParity.formats[0].views[0].download.nativeFilename = 'dataset-heatmap.png'; }],
  ['wrong native heatmap PNG name', r => { r.datasetParity.formats[0].views[3].download.nativeFilename = 'dataset-preview.png'; }],
  ['invalid browser native suffix', r => { r.datasetParity.formats[0].views[0].download.nativeFilename = 'dataset-preview (0).png'; }],
  ['missing native PNG override declaration', r => { delete r.datasetParity.formats[0].views[0].download.targetOverridden; }],
  ['overridden native PNG target', r => { r.datasetParity.formats[0].views[0].download.targetOverridden = true; }],
  ['missing descriptive PNG evidence alias declaration', r => { delete r.datasetParity.formats[0].views[0].download.renamedForEvidence; }],
  ['blank PNG raster', r => { r.datasetParity.formats[0].views[0].download.coloredPixels = 0; }],
  ['forged PNG dimensions', r => { r.datasetParity.formats[0].views[0].download.width = 1; }],
  ['oversized PNG', r => { r.datasetParity.formats[0].views[0].download.size = 8 * 1024 * 1024 + 1; }],
  ['invalid PNG hash', r => { r.datasetParity.formats[0].views[0].download.sha256 = 'invalid'; }],
  ['duplicated PNG evidence', r => { r.datasetParity.formats[0].views[1].download = structuredClone(r.datasetParity.formats[0].views[0].download); }],
  ['missing nonfinite case', r => { delete r.datasetParity.nonfinite; }],
  ['unsafe nonfinite statistics', r => { r.datasetParity.nonfinite.statistics[0][1] = 'NaN'; }],
  ['missing graceful nonfinite figures', r => { delete r.datasetParity.nonfinite.figures; }],
  ['blank nonfinite figure', r => { r.datasetParity.nonfinite.figures[0].canvases[0].painted = 0; }],
  ['missing one-row case', r => { r.datasetParity.formats.pop(); }],
  ['invented one-row correlation', r => { r.datasetParity.formats[4].views[3].figures.push({}); }],
  ['missing insufficient-row correlation', r => { delete r.datasetParity.formats[4].views[3].guidance; }],
  ['missing CSV unavailable declaration', r => { delete r.datasetParity.csvExport; }],
  ['invented CSV export', r => { r.datasetParity.csvExport.available = true; }],
  ['false pinned-identity replacement claim', r => { r.datasetParity.replacementRefusal.reason = 'Selected identity changed'; }],
  ['replacement does not clear old charts', r => { r.datasetParity.replacementRefusal.oldChartsCleared = false; }],
  ['missing replacement visible error', r => { delete r.datasetParity.replacementRefusal.visibleMessage; }],
  ['loading mistaken for replacement refusal', r => { r.datasetParity.replacementRefusal.visibleMessage = 'Loading preview'; }],
  ['missing registry before', r => { delete r.datasetParity.registryBefore; }],
  ['missing final registry', r => { delete r.finalRegistry; }],
  ...['plans', 'runs', 'control', 'executions'].flatMap(field => ['registryBefore', 'registryAfter'].map(stage => [`${stage} creates ${field}`, r => { r.datasetParity[stage][field] = field === 'plans' ? 1 : [{}]; }])),
]) {
  test(`rejects dataset ${name}`, async (t) => {
    const f = await fixture(t);
    mutate(f.summary.cases.find(record => record.name === 'dataset-parity'));
    await f.save();
    await assert.rejects(verifyWorkspace(f.root, f.manifest));
  });
}

for (const field of ['browserSessionAbsent', 'fixtureServicesClosed', 'removedOwnedRoots', 'browserProfileRemoved']) {
  for (const value of [undefined, false]) {
    test(`rejects ${field}=${value} on any required case`, async (t) => {
      const f = await fixture(t);
      f.summary.cases[4].cleanup[field] = value;
      await f.save();
      await assert.rejects(verifyWorkspace(f.root, f.manifest));
    });
  }
}
for (const name of ['port-reuse', 'live-port-reuse']) {
  for (const field of ['replacementServicesClosed', 'bothDaemonRootsAbsent', 'privateCredentialRemoved']) {
    test(`rejects missing ${name} ${field}`, async (t) => {
      const f = await fixture(t);
      delete f.summary.cases.find((record) => record.name === name).cleanup[field];
      await f.save();
      await assert.rejects(verifyWorkspace(f.root, f.manifest));
    });
  }
}

for (const [name, mutate] of [
  ['eight-case historical report', (s) => { s.cases = s.cases.filter((r) => r.name !== 'live-port-reuse'); }],
  ['missing live cursor', (s, r) => { delete r.initialRuntimeCursor; }],
  ['cursor attempt zero', (s, r) => { r.initialRuntimeCursor.attempt = 0; }],
  ['cursor sequence zero', (s, r) => { r.initialRuntimeCursor.seq = 0; }],
  ['cursor fractional sequence', (s, r) => { r.initialRuntimeCursor.seq = 0.5; }],
  ['cursor not a metric', (s, r) => { r.initialRuntimeCursor.eventType = 'log'; }],
  ['zero persisted metrics', (s, r) => { r.initialMetricEvidence.persistedMetricCount = 0; }],
  ['zero persisted logs', (s, r) => { r.initialMetricEvidence.persistedLogCount = 0; }],
  ['unverified producer journal', (s, r) => { r.initialMetricEvidence.producerJournalMatches = false; }],
  ['wrong selected live run', (s, r) => { r.liveMonitorBeforeReplacement.selectedRunId = 'other'; }],
  ['zero browser metric epoch', (s, r) => { r.liveMonitorBeforeReplacement.epoch = 0; }],
  ['zero browser history', (s, r) => { r.liveMonitorBeforeReplacement.historySteps = 0; }],
  ['missing history canvas', (s, r) => { r.liveMonitorBeforeReplacement.historyCanvasPresent = false; }],
  ['missing visible diagnostic', (s, r) => { r.liveMonitorBeforeReplacement.diagnosticLogPresent = false; }],
  ['unclosed original services', (s, r) => { r.originalTerminationBeforeRootCleanup.servicesClosed = false; }],
  ['original runtime still alive', (s, r) => { r.originalTerminationBeforeRootCleanup.pidAbsent = false; }],
  ['unknown runtime termination', (s, r) => { r.originalTerminationBeforeRootCleanup.cause = 'unknown'; }],
  ['missing owned runtime PID', (s, r) => { delete r.originalTerminationBeforeRootCleanup.ownedRuntimePid; }],
  ['nonterminal original runtime event', (s, r) => { r.originalTerminationBeforeRootCleanup.runtimeJournalExit.payload.status = 'running'; }],
  ['terminal status/code mismatch', (s, r) => { r.originalTerminationBeforeRootCleanup.runtimeJournalExit.payload.code = 0; }],
  ['missing durable cursor proof', (s, r) => { delete r.initialMetricEvidence.durableCursors; }],
  ['uncovered durable cursor', (s, r) => { r.initialMetricEvidence.durableCursors[0].seq = 2; }],
  ['wrong runtime EXIT run', (s, r) => { r.originalTerminationBeforeRootCleanup.runtimeJournalExit.run_id = 'other'; }],
  ['wrong runtime EXIT attempt', (s, r) => { r.originalTerminationBeforeRootCleanup.runtimeJournalExit.attempt = 2; }],
  ['missing runtime EXIT rather than explicit null', (s, r) => { delete r.originalTerminationBeforeRootCleanup.runtimeJournalExit; }],
  ['unknown EXIT replaced by invented cancelled outcome', (s, r) => { r.originalTerminationBeforeRootCleanup.runtimeJournalExit = null; }],
  ['native PID differs from live observed owned handle', (s, r) => { r.liveMonitorBeforeReplacement.ownedRuntimePid = 99; }],
  ['original not stopped before replacement', (s, r) => { r.originalDaemonStoppedBeforePortReuse = false; }],
  ['replacement uses different origin', (s, r) => { r.replacementOrigins.replacement = 'http://127.0.0.1:8766'; }],
  ['nonloopback replacement origin', (s, r) => { r.replacementOrigins.original = r.replacementOrigins.replacement = 'http://example.com'; }],
  ['incomplete replacement metadata', (s, r) => { delete r.replacementMetadataComplete; }],
  ['unfrozen replacement metadata', (s, r) => { delete r.replacementMetadataFrozenAfterCleanup; }],
  ['implicit transport branch', (s, r) => { delete r.transportScopeRetired; }],
  ['retired transport without explicit reauthentication', (s, r) => { r.transportScopeRetired = true; }],
  ['retired transport without cleared history', (s, r) => { r.transportScopeRetired = true; r.explicitReauthAttempted = true; }],
  ['missing native runtime result', (s, r) => { delete r.originalTerminationBeforeRootCleanup.nativeProcessResult; }],
  ['different native run', (s, r) => { r.originalTerminationBeforeRootCleanup.nativeProcessResult.runId = 'other'; }],
  ['different native attempt', (s, r) => { r.originalTerminationBeforeRootCleanup.nativeProcessResult.attempt = 2; }],
  ['different native PID', (s, r) => { r.originalTerminationBeforeRootCleanup.nativeProcessResult.pid = 99; }],
  ['missing native return code', (s, r) => { delete r.originalTerminationBeforeRootCleanup.nativeProcessResult.returncode; }],
  ['uncancelled native runtime', (s, r) => { r.originalTerminationBeforeRootCleanup.nativeProcessResult.cancelled = false; }],
  ['timed-out native runtime', (s, r) => { r.originalTerminationBeforeRootCleanup.nativeProcessResult.timedOut = true; }],
  ['unchanged daemon identity', (s, r) => { r.replacementDaemon.daemonId = r.originalDaemon.daemonId; }],
  ['different replacement build', (s, r) => { r.replacementDaemon.buildId = 'other-build'; }],
  ['no replacement request evidence', (s, r) => { r.replacementAccessMetadata = []; }],
  ['scope not sent', (s, r) => { r.replacementAccessMetadata[0].scopeHeaderPresent = false; }],
  ['accepted old health scope', (s, r) => { r.replacementAccessMetadata[0].status = 200; }],
  ['replacement mutation', (s, r) => { r.replacementAccessMetadata.push({ method: 'POST', path: '/api/plans', status: 409 }); }],
  ['accepted old run cursor', (s, r) => { r.replacementAccessMetadata.push({ method: 'GET', path: '/api/runs/owned-run/events', cursor: { attempt: 1, seq: 3 }, status: 200 }); }],
  ['replacement plan', (s, r) => { r.replacementAfterStaleSubmit.plans = 1; }],
  ['replacement run', (s, r) => { r.replacementAfterStaleSubmit.runs.push({}); }],
  ['replacement intent', (s, r) => { r.replacementAfterStaleSubmit.control.push({}); }],
  ['replacement execution', (s, r) => { r.replacementAfterStaleSubmit.executions.push({}); }],
]) {
  test(`rejects ${name}`, async (t) => {
    const f = await fixture(t);
    mutate(f.summary, f.summary.cases.find((r) => r.name === 'live-port-reuse'));
    await f.save();
    await assert.rejects(verifyWorkspace(f.root, f.manifest));
  });
}
for (const field of ['identityMessage', 'selectedRunAbsent', 'metricHistoryAbsent',
  'diagnosticsAbsent', 'noEnabledCancel', 'previewAbsent']) {
  test(`rejects missing live DOM identity fence ${field}`, async (t) => {
    const f = await fixture(t);
    delete f.summary.cases.find((r) => r.name === 'live-port-reuse').liveIdentityFence[field];
    await f.save();
    await assert.rejects(verifyWorkspace(f.root, f.manifest));
  });
}

test('rejects a summary that differs from its per-case JSON', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.workspace, 'baseline.json'), '{}');
  await assert.rejects(verifyWorkspace(f.root, f.manifest));
});

for (const [name, mutate] of [
  ['missing partial authoring declaration', (r) => { delete r.authoringExports.partialFieldAuthoring; }],
  ['unknown YAML field', (r) => { r.authoringExports.yamlConfig.access_token = 'not-real'; }],
  ['missing inventory key', (r) => { r.authoringExports.allTrainingKeys.pop(); }],
  ['wrong inventory count', (r) => { r.authoringExports.inventoryCount = 45; }],
  ['wrong authored YAML', (r) => { r.authoringExports.yamlConfig.epochs = 99; }],
  ['unquoted dataset lost', (r) => { r.authoringExports.yamlConfig.data_path = '/samples.npz'; }],
  ['wrong command interpreter', (r) => { r.authoringExports.parsedCommandArgv[0] = '/other/python'; }],
  ['wrong command precision', (r) => { r.authoringExports.parsedCommandArgv[6] = 'fp16'; }],
  ['wrong standalone output', (r) => { r.authoringExports.parsedCommandArgv[r.authoringExports.parsedCommandArgv.length - 1] = '/daemon/runs'; }],
  ['unknown command argument', (r) => { r.authoringExports.parsedCommandArgv.push('--unknown'); }],
  ['wrong download directory', (r) => { r.authoringExports.browserDownloadPath = '/arbitrary'; }],
  ['guided selection missing', (r) => { r.guidedSelectionsPreserved = false; }],
  ['download guidance missing', (r) => { delete r.downloadSettingsGuidance; }],
  ['bundled reset missing', (r) => { r.resetContract.restoredBundledDefaults = false; }],
  ['interpreter reset incorrectly', (r) => { r.resetContract.interpreterPreserved = false; }],
  ['missing YAML file metadata', (r) => { r.authoringDownloadEvidence.pop(); }],
  ['malformed YAML digest', (r) => { r.authoringDownloadEvidence[0].sha256 = 'bad'; }],
  ['empty YAML file', (r) => { r.authoringDownloadEvidence[0].size = 0; }],
  ['unknown YAML filename', (r) => { r.authoringDownloadEvidence[0].filename = 'unknown.yaml'; }],
  ['download parsed config differs', (r) => { r.authoringDownloadEvidence[0].config = {...r.authoringExports.yamlConfig, epochs: 99}; }],
  ['reset download differs', (r) => { r.authoringDownloadEvidence[1].config = {...r.authoringDownloadEvidence[1].config, epochs: 19}; }],
  ['preview download differs', (r) => { r.authoringDownloadEvidence[3].config = {...r.authoringDownloadEvidence[3].config, epochs: 11}; }],
  ['reset digest falsely unchanged', (r) => { r.authoringDownloadEvidence[1].sha256 = r.authoringDownloadEvidence[0].sha256; }],
  ['invalid range refusal missing', (r) => { r.authoringPlanEvidence.invalidRangeBlocked = false; }],
  ['forbidden preset refusal missing', (r) => { r.authoringPlanEvidence.malformedPresetBlocked = false; }],
  ['export safety evidence missing', (r) => { delete r.authoringExports.exportSafety; }],
  ['exported environment secret leaked', (r) => { r.authoringExports.exportSafety.environmentDownload.config.environment = { WAVEDL_EXPORT_PROBE: 'browser-secret-probe' }; }],
  ['executable preset proof missing', (r) => { delete r.authoringPlanEvidence.forbiddenPresetFields; }],
  ['original plan changed', (r) => { r.authoringPlanEvidence.initialRows[0] = [...r.authoringPlanEvidence.initialRows[0]]; r.authoringPlanEvidence.initialRows[0][1] += 'changed'; }],
  ['visible revised approval differs from stored plan', (r) => { r.authoringPlanEvidence.finalApprovedManifest = {...r.authoringPlanEvidence.finalApprovedManifest, unknown: true}; }],
  ['submission requested', (r) => { r.finalRegistry.control[0].submission_requested = 1; }],
  ['cancellation requested', (r) => { r.finalRegistry.control[0].cancellation_requested = 1; }],
  ['execution allocated', (r) => { r.finalRegistry.executions.push({}); }],
  ['run allocated', (r) => { r.finalRegistry.runs.push({}); }],
]) {
  test(`rejects authoring ${name}`, async (t) => {
    const f = await fixture(t);
    mutate(f.summary.cases.find((record) => record.name === 'authoring-parity'));
    await f.save();
    await assert.rejects(verifyWorkspace(f.root, f.manifest));
  });
}
test('rejects a missing per-case JSON despite a complete passing summary', async (t) => {
  const f = await fixture(t);
  await rm(join(f.workspace, 'baseline.json'));
  await assert.rejects(verifyWorkspace(f.root, f.manifest));
});

for (const [name, mutate] of [
  ['wrong approved producer', (r) => { r.filenameProofTraining.runId = 'other'; }],
  ['no periodic publication', (r) => { r.filenameProofTraining.saveEvery = 0; }],
  ['wrong basename', (r) => { r.nativeDownloadNames.basename = 'model.pt'; }],
  ['single real publication', (r) => { r.nativeDownloadNames.publicationCount = 1; }],
  ['target overridden download', (r) => { r.nativeDownloadNames.nativeClick = false; }],
  ['read-only intent proof missing', (r) => { delete r.nativeDownloadNames.readOnlyEvidence; }],
  ['only one native download', (r) => { r.nativeDownloadNames.downloads.pop(); }],
  ['same generation twice', (r) => { r.nativeDownloadNames.downloads[1] = {...r.nativeDownloadNames.downloads[0]}; }],
  ['shortened UUID filename', (r) => { r.nativeDownloadNames.downloads[0].filename = '12345678_gen-000001_checkpoint_selection.json'; }],
  ['incorrect filename generation', (r) => { r.nativeDownloadNames.downloads[0].filename = `${r.nativeDownloadNames.runId}_gen-000099_checkpoint_selection.json`; }],
  ['incorrect publication path', (r) => { r.nativeDownloadNames.downloads[0].path = 'another.json'; }],
  ['invalid attempt', (r) => { r.nativeDownloadNames.downloads[0].attempt = 0; }],
  ['oversized native metadata', (r) => { r.nativeDownloadNames.downloads[0].size = 65537; }],
  ['incorrect downloaded size', (r) => { r.nativeDownloadNames.downloads[0].size = 99; }],
  ['incorrect downloaded SHA', (r) => { r.nativeDownloadNames.downloads[0].sha256 = 'b'.repeat(64); }],
  ['invalid downloaded SHA', (r) => { r.nativeDownloadNames.downloads[0].sha256 = 'bad'; }],
  ['missing alias proof', (r) => { delete r.nativeAliasDownloads; }],
  ['alias native click absent', (r) => { r.nativeAliasDownloads.nativeClick = false; }],
  ['alias filename collision', (r) => { r.nativeAliasDownloads.downloads[1].filename = r.nativeAliasDownloads.downloads[0].filename; }],
  ['alias bytes changed', (r) => { r.nativeAliasDownloads.downloads[0].sha256 = 'b'.repeat(64); }],
  ['alias source unrelated', (r) => { r.nativeAliasDownloads.sourceGeneration = 'gen-000099'; }],
  ['alias complete tampered', (r) => { r.nativeAliasDownloads.completeText += ' '; }],
  ['plot not completed', (r) => { r.finalRegistry.runs[1].state = 'running'; }],
  ['producer not completed', (r) => { r.finalRegistry.runs[0].state = 'failed'; }],
  ['extra plan from downloads', (r) => { r.finalRegistry.plans = 3; }],
  ['extra execution from downloads', (r) => { r.finalRegistry.executions.push({}); }],
  ['cancel intent from downloads', (r) => { r.finalRegistry.control[0].cancellation_requested = 1; }],
]) {
  test(`rejects native download ${name}`, async (t) => {
    const f = await fixture(t);
    mutate(f.summary.cases.find((record) => record.name === 'download-names'));
    await f.save();
    await assert.rejects(verifyWorkspace(f.root, f.manifest));
  });
}
test('rejects manifest replacement after acceptance', async (t) => {
  const f = await fixture(t);
  await writeFile(f.manifest, '{"index.html":"new-build"}');
  await assert.rejects(verifyWorkspace(f.root, f.manifest));
});
test('rejects missing or ambiguous owned workspaces', async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.root, 'wavedl-browser-acceptance-stale'));
  await assert.rejects(verifyWorkspace(f.root, f.manifest));
  await rm(f.workspace, { recursive: true });
  await rm(join(f.root, 'wavedl-browser-acceptance-stale'), { recursive: true });
  await assert.rejects(verifyWorkspace(f.root, f.manifest));
});
test('rejects symbolic links for the workspace, summary, case and manifest', async (t) => {
  const f = await fixture(t);
  const link = join(f.root, 'workspace-link');
  await symlink(f.workspace, link);
  await assert.rejects(verifySummary(join(link, 'summary.json'), f.manifest));
  for (const path of [f.summaryPath, join(f.workspace, 'baseline.json'), f.manifest]) {
    const target = join(f.root, 'link-target');
    await writeFile(target, '{}');
    await rm(path);
    await symlink(target, path);
    await assert.rejects(verifyWorkspace(f.root, f.manifest));
    await rm(path);
    await f.save();
    await writeFile(f.manifest, '{"index.html":"generated-build"}\n');
  }
});
test('rejects oversized, empty and malformed JSON reports', async (t) => {
  const f = await fixture(t);
  for (const bytes of [Buffer.alloc(1024 * 1024 + 1, 32), Buffer.alloc(0), Buffer.from('{')]) {
    await writeFile(f.summaryPath, bytes);
    await assert.rejects(verifyWorkspace(f.root, f.manifest));
  }
});

test('rejects a FIFO without opening it or blocking', {
  skip: process.platform === 'win32' ? 'FIFO guard is tested by the mandatory Linux CI lane' : false,
  timeout: 2000,
}, async (t) => {
  const f = await fixture(t);
  await rm(f.summaryPath);
  execFileSync('mkfifo', [f.summaryPath], { timeout: 1000 });
  await assert.rejects(verifyWorkspace(f.root, f.manifest), /regular files/);
});
