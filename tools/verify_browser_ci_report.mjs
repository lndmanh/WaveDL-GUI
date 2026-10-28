#!/usr/bin/env node
// Read-only fail-closed guard for the real browser runner's JSON evidence.
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyLostAckEvidence } from './browser_lost_ack_evidence.mjs';
import { checkArtifactTamperEvidence } from './browser_artifact_tamper_evidence.mjs';

export const requiredCases = Object.freeze([
  'baseline', 'detach', 'reload', 'cancel', 'lost-ack',
  'artifact-tamper', 'port-reuse', 'live-port-reuse', 'authoring-parity', 'download-names', 'dataset-parity',
]);
const maxBytes = 1024 * 1024;
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function boundedFile(path) {
  const before = await lstat(path);
  assert(before.isFile() && !before.isSymbolicLink() && before.size > 0
    && before.size <= maxBytes, 'Evidence and manifest must be bounded nonempty regular files');
  // O_NOFOLLOW and fstat also defend against swapping the final path after lstat.
  // O_NONBLOCK prevents a raced FIFO from hanging the CI guard before fstat.
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    assert(stat.dev === before.dev && stat.ino === before.ino,
      'Evidence identity changed during open');
    assert(stat.isFile() && stat.size > 0 && stat.size <= maxBytes,
      'Evidence and manifest must be bounded nonempty regular files');
    const bytes = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    assert(length > 0 && length <= maxBytes, 'Evidence grew beyond its size limit');
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}

function checkRecord(record, hash, browser, directory) {
  assert(record && typeof record === 'object' && !Array.isArray(record), 'Invalid case record');
  assert(requiredCases.includes(record.name), 'Unknown browser acceptance case');
  assert.equal(record.status, 'passed', `${record.name}: not passed (skips are forbidden)`);
  for (const field of ['error', 'shutdownError', 'skipped', 'skip', 'skipReason', 'explicitFixtureWebAssets', 'authoringEventDiagnostic', 'datasetFailurePrefixEvidence']) {
    assert(!Object.hasOwn(record, field), `${record.name}: failure or skip evidence present`);
  }
  assert.equal(record.browser, browser, `${record.name}: browser version differs`);
  assert.equal(record.driverReadinessMode, 'sync-exposure-poll-and-two-controller-dom-observations',
    `${record.name}: current bounded driver readiness proof missing`);
  assert.deepEqual(record.browserViewport, {width: 1280, height: 900},
    `${record.name}: explicit actual browser viewport proof missing`);
  assert(record.browserProfile && record.browserProfile.initiallyEmpty === true
    && record.browserProfile.path === join(directory, `${record.name}-browser-profile`),
  `${record.name}: fresh private browser profile must belong to this exact evidence workspace`);
  assert.equal(record.assetManifestSha256, hash, `${record.name}: stale or mixed static assets`);
  assert(Array.isArray(record.assertions) && record.assertions.length > 0
    && record.assertions.every((item) => typeof item === 'string' && item.length > 0),
  `${record.name}: missing executable assertions`);
  assert(typeof record.started === 'string' && Number.isFinite(Date.parse(record.started))
    && typeof record.finished === 'string' && Number.isFinite(Date.parse(record.finished)),
  `${record.name}: missing completion timestamps`);
  const cleanup = record.cleanup;
  assert(cleanup && typeof cleanup === 'object', `${record.name}: missing cleanup proof`);
  assert.deepEqual(cleanup.errors, [], `${record.name}: cleanup errors`);
  for (const field of ['browserSessionAbsent', 'fixtureServicesClosed', 'removedOwnedRoots', 'browserProfileRemoved']) {
    assert.equal(cleanup[field], true, `${record.name}: missing ${field} proof`);
  }
  assert(!Object.hasOwn(cleanup, 'retainedPrivateRoots'), `${record.name}: private roots retained`);
  if (['port-reuse', 'live-port-reuse'].includes(record.name)) {
    for (const field of ['replacementServicesClosed', 'bothDaemonRootsAbsent', 'privateCredentialRemoved']) {
      assert.equal(cleanup[field], true, `${record.name}: missing ${field} proof`);
    }
  }
  if (record.name === 'live-port-reuse') checkLiveIdentityFence(record);
  if (record.name === 'download-names') checkNativeDownloadNames(record);
  if (record.name === 'dataset-parity') checkDatasetParity(record);
  if (record.name === 'lost-ack') verifyLostAckEvidence(record);
  if (record.name === 'artifact-tamper') checkArtifactTamperEvidence(record);
}

const datasetViews = ['Input distribution', 'Output distribution', 'Samples', 'Correlation', 'Statistics', 'Scatter'];
const datasetNames = ['samples.npz', 'samples.mat', 'samples.h5', 'samples.hdf5', 'one-row.npz'];

function checkDatasetStatistics(rows, expected) {
  assert(expected && ['inputSha256', 'outputSha256'].every(field => typeof expected[field] === 'string'
    && /^[a-f0-9]{64}$/.test(expected[field])), 'Independent canonical dataset array byte hashes missing');
  assert(Array.isArray(expected.means) && expected.means.length > 0 && expected.means.length <= 40
    && Array.isArray(expected.stds) && expected.stds.length === expected.means.length,
  'Independent bounded dataset statistics missing');
  assert(Array.isArray(rows) && rows.length === expected.means.length, 'Visible dataset statistics missing');
  for (const [index, cells] of rows.entries()) {
    assert(Array.isArray(cells) && cells.length === 3 && cells.every(cell => typeof cell === 'string')
      && cells[0] === String(index), 'Dataset statistics feature order or cells malformed');
    for (const [column, values] of [[1, expected.means], [2, expected.stds]]) {
      const wanted = values[index];
      assert(wanted === null ? cells[column] === 'Missing' : Number.isFinite(wanted)
        && cells[column].trim().length > 0 && Number.isFinite(Number(cells[column]))
        && Math.abs(Number(cells[column]) - wanted) <= 1e-10 * Math.max(1, Math.abs(wanted)),
      'Visible dataset statistics must match independent real-byte calculations');
    }
  }
}

function checkDatasetParity(record) {
  const proof = record.datasetParity;
  assert(proof && proof.scope === 'Same-host real daemon/static app; bounded previews, not full-dataset or remote acceptance',
    'Dataset evidence must state its bounded same-host scope');
  assert(Array.isArray(proof.formats) && proof.formats.length === datasetNames.length,
    'All four dataset extensions and one-row edge fixture are mandatory');
  assert.deepEqual(proof.formats.map(item => item.name).sort(), [...datasetNames].sort(),
    'Dataset format evidence must appear exactly once each');
  const filenames = new Set();
  for (const item of proof.formats) {
    const expected = item.expected;
    const oneRow = item.name === 'one-row.npz';
    assert(expected && Number.isSafeInteger(expected.rows) && expected.rows === (oneRow ? 1 : 96)
      && JSON.stringify(expected.inputShape) === '[32]' && JSON.stringify(expected.outputShape) === '[12]'
      && expected.inputDtype === 'float32' && expected.outputDtype === 'float32',
    'Dataset independent fixture shapes, rows and dtypes differ');
    assert.deepEqual(item.header, {
      Format: item.name.split('.').at(-1).toUpperCase(), Samples: String(expected.rows),
      'Input key': 'X', 'Output key': 'y', 'Input shape': '32', 'Output shape': '12',
      'Input dtype': expected.inputDtype, 'Output dtype': expected.outputDtype, 'File size': 'Unknown',
    }, 'Actual visible header must match genuine dataset metadata');
    assert(typeof item.bounds === 'string' && (item.bounds.includes(`${expected.rows} of ${expected.rows} rows sampled`) || item.bounds.includes(`Bounded preview: ${expected.rows} of ${expected.rows} rows.`))
      && item.bounds.includes('not a full-dataset analysis'), 'Bounded dataset scope must be visible');
    checkDatasetStatistics(item.statistics, expected);
    assert(Array.isArray(item.views) && item.views.length === datasetViews.length, 'Six dataset views required');
    assert.deepEqual(item.views.map(view => view.view), datasetViews, 'Dataset views must be exact and nonduplicated');
    for (const view of item.views) {
      const unavailable = oneRow && view.view === 'Correlation';
      const count = view.view === 'Samples' ? Math.min(3, expected.rows) : view.view === 'Correlation' ? (unavailable ? 0 : 1)
        : view.view === 'Statistics' ? 2 : 8;
      assert(Array.isArray(view.figures) && view.figures.length === count, 'Dataset view chart count differs');
      for (const figure of view.figures) {
        assert(typeof figure.title === 'string' && figure.title.length > 0
          && Array.isArray(figure.canvases) && figure.canvases.length > 0
          && figure.canvases.every(canvas => Number.isSafeInteger(canvas.width) && canvas.width > 0 && canvas.width <= 8192
            && Number.isSafeInteger(canvas.height) && canvas.height > 0 && canvas.height <= 8192
            && Number.isSafeInteger(canvas.painted) && canvas.painted > 0 && canvas.painted <= canvas.width * canvas.height),
        'Actual bounded dataset canvases must contain painted pixels');
      }
      if (unavailable) {
        assert.equal(view.guidance, 'Correlation requires at least two sampled rows.');
        assert.equal(view.download, null, 'Unavailable one-row correlation must not invent a chart export');
        continue;
      }
      const file = view.download;
      const canvas = view.figures[0].canvases[0];
      assert(file && file.filename === `dataset-${item.name}-${view.view.toLowerCase().replaceAll(' ', '-')}.png`
        && file.nativeClick === true && file.targetOverridden === false && file.renamedForEvidence === true
        && typeof file.nativeFilename === 'string'
        && (view.view === 'Correlation' ? /^dataset-heatmap(?: \([1-9]\d*\))?\.png$/ : /^dataset-preview(?: \([1-9]\d*\))?\.png$/).test(file.nativeFilename)
        && Number.isSafeInteger(file.size) && file.size > 100 && file.size <= 8 * 1024 * 1024
        && file.width === canvas.width && file.height === canvas.height
        && file.decoded === true && Number.isSafeInteger(file.coloredPixels) && file.coloredPixels > 0
        && file.coloredPixels <= file.width * file.height && typeof file.sha256 === 'string'
        && /^[a-f0-9]{64}$/.test(file.sha256), 'Actual decoded bounded colored PNG export evidence required');
      assert(!filenames.has(file.filename), 'Dataset PNG evidence cannot duplicate another view or format');
      filenames.add(file.filename);
    }
  }
  const canonical = proof.formats.find(item => item.name === 'samples.npz').expected;
  for (const item of proof.formats.filter(item => item.name.startsWith('samples.'))) {
    assert.deepEqual(item.expected, canonical, 'Four real file formats must have numerically equal independent expectations');
  }
  assert(proof.interactive && typeof proof.interactive === 'object'
    && !Array.isArray(proof.interactive), 'Representative genuine dataset interactions missing');
  assert.deepEqual(Object.keys(proof.interactive).sort(), ['correlation', 'sample'],
    'Interactive acceptance is limited to representative NPZ samples and correlation');
  for (const [key, view, flag, actions] of [
    ['sample', 'Samples', 'dragChanged', ['mouse move', 'mouse down left', 'mouse move', 'mouse up left', 'Reset zoom']],
    ['correlation', 'Correlation', 'zoomAndPanChanged', ['focus', '+', 'ArrowRight', '0']],
  ]) {
    const interaction = proof.interactive[key];
    assert(interaction && interaction.file === 'samples.npz' && interaction.view === view
      && interaction[flag] === true && interaction.resetRestored === true,
    'Representative dataset interactions must use real native controls');
    assert.deepEqual(interaction.actions, actions, 'Dataset interaction native action sequence differs');
    const canvas = proof.formats.find(item => item.name === 'samples.npz').views.find(item => item.view === view).figures[0].canvases[0];
    for (const phase of ['baseline', 'changed', 'restored']) {
      const raster = interaction[phase];
      assert(raster && raster.width === canvas.width && raster.height === canvas.height
        && typeof raster.sha256 === 'string' && /^[a-f0-9]{64}$/.test(raster.sha256),
      'Dataset interaction must preserve bounded actual canvas dimensions and hash real raster bytes');
    }
    assert.notEqual(interaction.changed.sha256, interaction.baseline.sha256,
      'Native dataset interaction must change the actual public raster');
    assert.deepEqual(interaction.restored, interaction.baseline,
      'Native dataset reset must restore the exact original raster');
  }
  assert(proof.nonfinite && proof.nonfinite.missingExplicit === true, 'Nonfinite graceful view is mandatory');
  checkDatasetStatistics(proof.nonfinite.statistics, proof.nonfinite.expected);
  assert(Array.isArray(proof.nonfinite.figures) && proof.nonfinite.figures.length === 2
    && proof.nonfinite.figures.every(figure => typeof figure.title === 'string' && figure.title.length > 0
      && Array.isArray(figure.canvases) && figure.canvases.length > 0
      && figure.canvases.every(canvas => Number.isSafeInteger(canvas.width) && canvas.width > 0 && canvas.width <= 8192
        && Number.isSafeInteger(canvas.height) && canvas.height > 0 && canvas.height <= 8192
        && Number.isSafeInteger(canvas.painted) && canvas.painted > 0 && canvas.painted <= canvas.width * canvas.height)),
  'Nonfinite statistics must gracefully render real painted bounded canvases');
  assert(proof.nonfinite.statistics.some(row => row.includes('Missing'))
    && !proof.nonfinite.statistics.flat().some(cell => /NaN|Infinity/.test(cell)), 'Nonfinite statistics must be explicitly Missing');
  assert.deepEqual(proof.csvExport, {available: false, reason: 'No CSV control is exposed by the dataset workspace'},
    'Dataset report must not invent CSV acceptance');
  const refusal = proof.replacementRefusal;
  assert(refusal && refusal.reason === 'Real selected file replaced with unsupported nonnumeric arrays'
    && refusal.oldChartsCleared === true && typeof refusal.visibleMessage === 'string'
    && refusal.visibleMessage.trim().length > 0 && !refusal.visibleMessage.includes('Loading'),
  'Ordinary invalid replacement must refuse refresh and clear stale charts');
  for (const state of [proof.registryBefore, proof.registryAfter, record.finalRegistry]) {
    assert(state && state.plans === 0, 'Dataset browsing must allocate no plans');
    for (const field of ['runs', 'control', 'executions']) assert.deepEqual(state[field], [], `Dataset browsing must allocate no ${field}`);
  }
  assert.deepEqual(proof.registryAfter, proof.registryBefore, 'Dataset browsing must leave registry unchanged');
}

function checkNativeDownloadNames(record) {
  const manifest = JSON.parse(record.approvedPlan);
  const proof = record.nativeDownloadNames;
  const training = record.filenameProofTraining;
  assert(manifest && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(manifest.run_id)
    && manifest.resolved_config?.save_every === 1 && manifest.resolved_config.epochs === 3
    && manifest.runtime?.device === 'cpu', 'Filename proof must follow genuine periodic CPU training');
  assert(training && training.runId === manifest.run_id && training.saveEvery === 1,
    'Filename producer configuration proof missing');
  assert(proof && proof.runId === manifest.run_id && proof.basename === 'checkpoint_selection.json'
    && Number.isSafeInteger(proof.publicationCount) && proof.publicationCount >= 2
    && proof.nativeClick === true && proof.readOnlyEvidence === true,
  'Native filename proof must use actual read-only clicks on independent publications');
  assert(Array.isArray(proof.downloads) && proof.downloads.length === 2,
    'Exactly two genuine native filename downloads must be evidenced');
  for (const file of proof.downloads) {
    assert(file && /^gen-\d{6,}$/.test(file.generation)
      && Number.isSafeInteger(file.attempt) && file.attempt > 0
      && file.path === proof.basename
      && file.filename === `${proof.runId}_${file.generation}_${proof.basename}`
      && Number.isSafeInteger(file.size) && file.size > 0 && file.size <= 64 * 1024
      && file.size === file.expectedSize && typeof file.sha256 === 'string'
      && /^[a-f0-9]{64}$/.test(file.sha256) && file.sha256 === file.expectedSha256,
    'Native saved filename and bounded bytes must match real immutable publication identity');
  }
  assert.equal(new Set(proof.downloads.map((file) => file.generation)).size, 2,
    'Native downloads must represent two distinct producer generations');
  const aliases = record.nativeAliasDownloads;
  assert(aliases && aliases.runId === proof.runId && aliases.fixturePublication === true
    && aliases.nativeClick === true && /^gen-\d{6,}$/.test(aliases.generation),
  'Alias proof must use a controlled real immutable publication and native clicks');
  const paths = ['left/metrics.csv', 'right/metrics.csv', 'METRICS.csv', 'a?.csv', 'a*.csv'];
  assert.deepEqual(aliases.paths, paths);
  assert.equal(aliases.downloads.length, paths.length);
  const source = proof.downloads.find((file) => file.generation === aliases.sourceGeneration);
  assert(source && source.size === aliases.sourceSize && source.sha256 === aliases.sourceSha256
    && source.attempt === aliases.attempt, 'Alias bytes must derive from genuine CPU publication');
  assert.equal(createHash('sha256').update(aliases.completeText).digest('hex'), aliases.completeSha256);
  const complete = JSON.parse(aliases.completeText);
  assert.equal(complete.run_id, proof.runId);
  assert.equal(complete.generation, aliases.generation);
  assert.equal(complete.attempt, aliases.attempt);
  assert.deepEqual(Object.keys(complete.files).sort(), [...paths].sort());
  for (const [index, path] of paths.entries()) {
    const file = aliases.downloads[index];
    const basename = path.split('/').at(-1).replace(/[?*]/g, '_');
    const pathHash = createHash('sha256').update(path).digest('hex').slice(0, 24);
    assert.equal(file.path, path);
    assert.equal(file.filename, `${proof.runId}_${aliases.generation}_${basename.slice(0, -4)}_${pathHash}.csv`);
    assert.equal(file.size, source.size);
    assert.equal(file.sha256, source.sha256);
    assert.deepEqual(complete.files[path], { size: file.size, sha256: file.sha256 });
  }
  assert.equal(new Set(aliases.downloads.map((file) => file.filename.toLowerCase())).size, paths.length);
  const state = record.finalRegistry;
  assert(state && state.plans === 2 && Array.isArray(state.runs) && state.runs.length === 2
    && new Set(state.runs.map((run) => run.run_id)).size === 2
    && state.runs.every((run) => run.state === 'completed')
    && state.runs.some((run) => run.run_id === proof.runId),
  'Training and automatic plot must both genuinely finish before native filename proof');
  assert(Array.isArray(state.executions) && state.executions.length === 2
    && Array.isArray(state.control) && state.control.length === 2
    && state.control.every((control) => control.submission_requested === 1
      && control.cancellation_requested === 0), 'Native downloads must retain exactly the two submitted producer/plot executions');
}

function exportedArgv(config, interpreter, inventory) {
  const argv = [interpreter, '-m', 'wavedl.launcher', '--num_gpus', '1', '--mixed_precision', config.precision, '--cpu'];
  for (const option of inventory) {
    const value = config[option.name];
    if (value === null || value === false || (Array.isArray(value) && !value.length)) continue;
    const flag = option.name === 'import_modules' ? '--import' : `--${option.name}`;
    if (value === true) argv.push(flag);
    else if (Array.isArray(value)) argv.push(flag, ...value.map(String));
    else argv.push(`${flag}=${value}`);
  }
  return [...argv, '--output_dir', './results'];
}

function checkAuthoringParity(record, inventory) {
  const keys = inventory.map((option) => option.name).sort();
  const exports = record.authoringExports;
  assert(exports && exports.partialFieldAuthoring === true, 'Authoring parity must honestly declare representative partial field authoring');
  assert.equal(exports.inventoryCount, inventory.length, 'Authoring inventory count differs');
  assert.deepEqual(exports.allTrainingKeys, keys, 'Downloaded YAML key inventory differs');
  assert.deepEqual(Object.keys(exports.yamlConfig).sort(), keys, 'Downloaded YAML contains missing or unknown fields');
  const authored = { epochs: 11, patience: 4, batch_size: 8, lr: 0.003, seed: 37, workers: 0, precision: 'no', weight_decay: 0.002 };
  assert.deepEqual(exports.authoredValues, authored, 'Representative authored values differ');
  for (const [key, value] of Object.entries(authored)) assert.deepEqual(exports.yamlConfig[key], value, `YAML differs for ${key}`);
  assert.equal(exports.yamlConfig.model, 'cnn', 'Selected model lost in export');
  assert(typeof exports.yamlConfig.data_path === 'string'
    && exports.yamlConfig.data_path.endsWith('/samples.npz')
    && [' ', "'", '$', ';'].every((character) => exports.yamlConfig.data_path.includes(character)),
  'Exported selected dataset must exercise actual shell quoting');
  assert(typeof record.pythonInterpreter === 'string' && record.pythonInterpreter.startsWith('/'), 'Exact POSIX interpreter missing');
  assert.deepEqual(exports.parsedCommandArgv, exportedArgv(exports.yamlConfig, record.pythonInterpreter, inventory),
    'Parsed standalone command must match exact inventory values and ./results output');
  assert(typeof exports.browserDownloadPath === 'string' && exports.browserDownloadPath.endsWith('/authoring-parity-downloads'),
    'Browser-owned download directory evidence missing');
  const safety = exports.exportSafety;
  assert(safety && safety.environmentOmitted === true
    && safety.environmentCommandRefused === true
    && safety.topologyCommandRefused === true,
  'Browser export safety refusal evidence missing');
  assert(safety.environmentDownload && safety.environmentDownload.filename === 'authoring-environment.yaml'
    && Number.isSafeInteger(safety.environmentDownload.size) && safety.environmentDownload.size > 0
    && /^[a-f0-9]{64}$/.test(safety.environmentDownload.sha256)
    && !Object.hasOwn(safety.environmentDownload.config, 'environment')
    && !JSON.stringify(safety.environmentDownload.config).includes('browser-secret-probe'),
  'Environment-bearing YAML export was not proven secret-free');
  assert.deepEqual(safety.environmentDownload.config, exports.yamlConfig,
    'Explicit runtime environment must not change any exported training configuration');
  assert.equal(record.guidedSelectionsPreserved, true, 'Guided navigation selection proof missing');
  assert(typeof record.downloadSettingsGuidance === 'string' && record.downloadSettingsGuidance.includes('Your browser chooses where'),
    'Browser-owned download settings guidance missing');
  const defaults = Object.fromEntries(inventory.map((option) => [option.name, option.default]));
  assert(record.resetContract && record.resetContract.restoredBundledDefaults === true
    && record.resetContract.interpreterPreserved === true && record.resetContract.savedNewRunEpochs === 19
    && record.resetContract.restoredEpochs === defaults.epochs, 'Bundled reset and independent saved preference proof missing');
  const downloads = record.authoringDownloadEvidence;
  const downloadNames = ['authoring-before-reset.yaml', 'authoring-after-reset.yaml', 'authoring-before-plan.yaml', 'authoring-after-preview.yaml'];
  assert(Array.isArray(downloads) && downloads.length === 4
    && downloads.every((file) => file && typeof file.filename === 'string'
      && Number.isSafeInteger(file.size) && file.size > 0 && file.size <= maxBytes
      && typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256)),
  'Actual browser download metadata missing or malformed');
  assert.deepEqual(downloads.map((file) => file.filename).sort(), [...downloadNames].sort(), 'All four actual YAML downloads required');
  const configFor = (name) => downloads.find((file) => file.filename === name).config;
  assert.deepEqual(configFor('authoring-before-reset.yaml'), exports.yamlConfig, 'Before-reset browser download differs from authored draft');
  assert.deepEqual(configFor('authoring-before-plan.yaml'), exports.yamlConfig, 'Before-plan browser download differs from exported configuration');
  assert.deepEqual(configFor('authoring-after-preview.yaml'), {...exports.yamlConfig, epochs: 12}, 'After-preview browser download must be a live revised draft snapshot');
  assert.deepEqual(configFor('authoring-after-reset.yaml'), {...defaults, model: exports.yamlConfig.model, data_path: exports.yamlConfig.data_path},
    'Actual reset download must restore all bundled defaults without losing selected model/dataset');
  assert.notEqual(downloads.find((file) => file.filename === 'authoring-before-reset.yaml').sha256,
    downloads.find((file) => file.filename === 'authoring-after-reset.yaml').sha256,
    'Different reset configurations must have different actual download digests');
  const plans = record.authoringPlanEvidence;
  assert(plans && plans.noSubmission === true && plans.invalidRangeBlocked === true
    && plans.malformedPresetBlocked === true, 'Authoring validation/UI approval proof missing');
  assert.deepEqual(plans.forbiddenPresetFields, ['import_modules'], 'Executable-authority preset refusal proof missing');
  assert(Array.isArray(plans.initialRows) && plans.initialRows.length === 1
    && Array.isArray(plans.finalRows) && plans.finalRows.length === 2
    && plans.finalRows.every((row) => Array.isArray(row) && row.length === 3 && row.every((value) => typeof value === 'string'))
    && new Set(plans.finalRows.map((row) => row[0])).size === 2,
  'Authoring must persist exactly two distinct immutable plan tuples');
  assert(plans.finalRows.some((row) => JSON.stringify(row) === JSON.stringify(plans.initialRows[0])), 'Original plan bytes changed after draft edit');
  const manifest = plans.finalApprovedManifest;
  assert(plans.finalRows.some((row) => {
    const stored = JSON.parse(row[2]);
    return typeof stored.manifest_json === 'string'
      && JSON.stringify(JSON.parse(stored.manifest_json)) === JSON.stringify(manifest);
  }), 'Revised visible approval must exactly match an actual persisted plan manifest');
  assert(manifest && manifest.resolved_config && manifest.runtime?.python === record.pythonInterpreter
    && manifest.runtime.device === 'cpu' && manifest.resolved_config.model === 'cnn'
    && manifest.resolved_config.data_path === exports.yamlConfig.data_path,
  'Revised approval must retain selected model/dataset/runtime');
  for (const [key, value] of Object.entries(authored)) {
    assert.deepEqual(manifest.resolved_config[key], key === 'epochs' ? 12 : value, `Revised approval differs for ${key}`);
  }
  const state = record.finalRegistry;
  assert(state && state.plans === 2 && Array.isArray(state.control) && state.control.length === 2
    && state.control.every((row) => row.submission_requested === 0 && row.cancellation_requested === 0),
  'Authoring must never request submission or cancellation');
  assert.deepEqual(state.executions, [], 'Authoring must allocate no execution');
  assert.deepEqual(state.runs, [], 'Authoring must allocate no run');
}

function checkLiveIdentityFence(record) {
  const cursor = record.initialRuntimeCursor;
  assert(cursor && typeof cursor.runId === 'string' && cursor.runId.length > 0
    && Number.isSafeInteger(cursor.attempt) && cursor.attempt > 0
    && Number.isSafeInteger(cursor.seq) && cursor.seq >= 1 && cursor.eventType === 'metric',
  'Live replacement requires a real positive producer metric cursor');
  const metric = record.initialMetricEvidence;
  assert(metric && Number.isSafeInteger(metric.persistedMetricCount) && metric.persistedMetricCount > 0
    && Number.isSafeInteger(metric.persistedLogCount) && metric.persistedLogCount > 0
    && metric.producerJournalMatches === true, 'Missing persisted metric/log producer proof');
  assert(Array.isArray(metric.durableCursors) && metric.durableCursors.some((item) =>
    item.attempt === cursor.attempt && Number.isSafeInteger(item.seq) && item.seq >= cursor.seq),
  'Live metric cursor must be covered by an independently persisted daemon cursor');
  const monitor = record.liveMonitorBeforeReplacement;
  assert(monitor && monitor.selectedRunId === cursor.runId
    && Number.isFinite(monitor.epoch) && monitor.epoch > 0
    && Number.isSafeInteger(monitor.historySteps) && monitor.historySteps > 0
    && monitor.historyCanvasPresent === true && monitor.diagnosticLogPresent === true,
  'Live browser monitor must show actual selected-run metrics and logs before replacement');
  const termination = record.originalTerminationBeforeRootCleanup;
  assert(termination && termination.cause === 'owned-fixture-shutdown'
    && termination.servicesClosed === true && termination.pidAbsent === true
    && Number.isSafeInteger(termination.ownedRuntimePid) && termination.ownedRuntimePid > 0
    && termination.ownedRuntimePid === monitor.ownedRuntimePid,
  'Original owned runtime must be terminal and absent before its root is removed');
  const nativeResult = termination.nativeProcessResult;
  assert(nativeResult && nativeResult.runId === cursor.runId
    && nativeResult.attempt === cursor.attempt && nativeResult.pid === termination.ownedRuntimePid
    && Number.isSafeInteger(nativeResult.returncode)
    && nativeResult.cancelled === true && nativeResult.timedOut === false,
  'Original native runtime completion must independently match the live run, attempt and PID');
  const exit = termination.runtimeJournalExit;
  if (exit === null) {
    assert.equal(termination.runtimeOutcome, 'unknown', 'Absent runtime EXIT must remain explicitly unknown');
  } else {
    assert(exit && exit.type === 'exit' && exit.run_id === cursor.runId
      && exit.attempt === cursor.attempt && Number.isSafeInteger(exit.seq) && exit.seq > cursor.seq
      && ['completed', 'failed', 'cancelled'].includes(exit.payload?.status)
      && Number.isSafeInteger(exit.payload?.code) && exit.payload.code >= 0
      && (exit.payload.status === 'completed' ? exit.payload.code === 0 : exit.payload.code > 0)
      && termination.runtimeOutcome === exit.payload.status,
    'Available runtime EXIT must be genuine identified terminal producer evidence');
  }
  assert.equal(record.originalDaemonStoppedBeforePortReuse, true, 'Original daemon must stop before replacement');
  const origins = record.replacementOrigins;
  assert(origins && origins.identical === true && origins.original === origins.replacement,
    'Replacement must use exactly the original origin');
  const origin = new URL(origins.original);
  assert(origin.origin === origins.original && origin.protocol === 'http:'
    && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname),
  'Replacement origin must remain loopback');
  assert.equal(record.replacementMetadataComplete, true, 'Replacement metadata must be final after service cleanup');
  assert.equal(record.replacementMetadataFrozenAfterCleanup, true,
    'Replacement metadata must be frozen after browser and replacement service closure');
  assert(typeof record.transportScopeRetired === 'boolean'
    && typeof record.explicitReauthAttempted === 'boolean', 'Transport retirement branch must be explicit');
  if (record.transportScopeRetired) {
    assert.equal(record.explicitReauthAttempted, true, 'Retired transport needs deliberate fresh reauthentication');
    for (const field of ['historyAbsent', 'credentialFieldEmpty', 'noEnabledCancel']) {
      assert.equal(record.transportRetirementBeforeReplacement?.[field], true,
        `Transport retirement missing ${field}`);
    }
  } else assert.equal(record.explicitReauthAttempted, false, 'Live scope must not invent reauthentication');
  assert(record.originalDaemon && record.replacementDaemon
    && typeof record.originalDaemon.daemonId === 'string' && record.originalDaemon.daemonId.length > 0
    && typeof record.replacementDaemon.daemonId === 'string' && record.replacementDaemon.daemonId.length > 0
    && record.originalDaemon.daemonId !== record.replacementDaemon.daemonId
    && typeof record.originalDaemon.buildId === 'string' && record.originalDaemon.buildId.length > 0
    && record.originalDaemon.buildId === record.replacementDaemon.buildId,
  'Live port replacement must change daemon identity without changing build identity');
  const fence = record.liveIdentityFence;
  for (const field of ['identityMessage', 'selectedRunAbsent', 'metricHistoryAbsent',
    'diagnosticsAbsent', 'noEnabledCancel', 'previewAbsent']) {
    assert.equal(fence?.[field], true, `Live identity fence missing ${field}`);
  }
  const requests = record.replacementAccessMetadata;
  assert(Array.isArray(requests) && requests.length > 0, 'Replacement boundary metadata missing');
  assert(requests.some((request) => request.method === 'GET' && request.path === '/api/health'
    && request.scopeHeaderPresent === true && request.status === 409),
  'Replacement must reject old daemon scope during browser health preflight');
  assert(requests.every((request) => !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)
    && !(request.path?.startsWith(`/api/runs/${cursor.runId}`)
      && request.status >= 200 && request.status < 300)),
  'Stale live browser must not mutate or successfully read its old run on replacement');
  const after = record.replacementAfterStaleSubmit;
  assert(after && after.plans === 0, 'Replacement must have zero plans');
  for (const field of ['runs', 'control', 'executions']) {
    assert.deepEqual(after[field], [], `Replacement must have zero ${field}`);
  }
}

export async function verifySummary(summaryPath, manifestPath) {
  const directory = dirname(resolve(summaryPath));
  const stat = await lstat(directory);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), 'Evidence workspace must be a real directory');
  const summary = JSON.parse((await boundedFile(summaryPath)).toString('utf8'));
  const hash = createHash('sha256').update(await boundedFile(manifestPath)).digest('hex');
  assert.equal(summary.browser, 'agent-browser 0.26.0', 'Untested browser version');
  assert(typeof summary.finished === 'string' && Number.isFinite(Date.parse(summary.finished)),
    'Summary must be completed');
  assert(Array.isArray(summary.cases), 'Summary cases missing');
  assert.deepEqual(summary.cases.map((record) => record.name).sort(), [...requiredCases].sort(),
    'Exactly the twelve required cases must appear once each');
  const inventory = JSON.parse((await boundedFile(join(repo, 'web/shared/training-options.json'))).toString('utf8'));
  for (const record of summary.cases) {
    checkRecord(record, hash, summary.browser, directory);
    if (record.name === 'authoring-parity') checkAuthoringParity(record, inventory);
    const perCase = JSON.parse((await boundedFile(join(directory, `${record.name}.json`))).toString('utf8'));
    // A truncated/old case file cannot be hidden by a passing summary.
    assert.deepEqual(perCase, record, `${record.name}: per-case evidence differs from summary`);
  }
  return { cases: summary.cases.length, assetManifestSha256: hash };
}

export async function verifyWorkspace(tempDirectory, manifestPath) {
  const root = resolve(tempDirectory);
  const stat = await lstat(root);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), 'CI temporary directory must be real');
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.name.startsWith('wavedl-browser-acceptance-'));
  assert.equal(entries.length, 1, 'Require exactly one owned acceptance workspace; no missing/stale retries');
  assert(entries[0].isDirectory() && !entries[0].isSymbolicLink(), 'Acceptance workspace must not be a link');
  return verifySummary(join(root, entries[0].name, 'summary.json'), manifestPath);
}

/** Accept either the dedicated temporary-directory parent or its owned report workspace. */
export async function verifyCliPath(inputPath, manifestPath) {
  const input = resolve(inputPath);
  const stat = await lstat(input);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), 'CLI input must be a real directory');
  if (basename(input).startsWith('wavedl-browser-acceptance-')) {
    return verifySummary(join(input, 'summary.json'), manifestPath);
  }
  return verifyWorkspace(input, manifestPath);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert(process.argv.length === 3, 'Usage: node tools/verify_browser_ci_report.mjs <dedicated TMPDIR or report workspace>');
    const report = await verifyCliPath(process.argv[2], join(repo, 'src/wavedl_daemon/web_assets/.wavedl-assets.json'));
    console.log(`Browser acceptance verified: ${report.cases}/${requiredCases.length} passed; cleanup proven; assets ${report.assetManifestSha256}`);
  } catch (error) {
    // Never echo report contents, bootstrap URLs, argv, or private root paths.
    console.error(`Browser acceptance evidence rejected (${error.code ?? 'INVALID_REPORT'}); all twelve current-build cases and cleanup proof are mandatory`);
    process.exitCode = 1;
  }
}
