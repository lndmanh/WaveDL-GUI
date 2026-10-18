import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundedFile } from './verify_retained_browser_report.mjs';

const name = 'cached-build-replacement';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const limitation = 'Same production source with controlled genuine factory build identity; old controlled page, actual controller object and unchanged loaded entry URLs/packaged byte hashes only. No cache-hit or loaded-response-byte proof, matching-new-client update, remote forwarding, released-binary or complete F15 claim.';
const empty = value => {
  assert.equal(value.plans, 0);
  for (const key of ['runs', 'control', 'executions']) assert.deepEqual(value[key], []);
};

export function verifyCachedBuildReplacementRecord(record, { assetHash, directory, browser, assets }) {
  for (const key of ['error', 'shutdownError', 'skip', 'skipped', 'skipReason', 'failed', 'retainedWorkspace', 'explicitFixtureWebAssets']) assert(!Object.hasOwn(record, key));
  assert.equal(record.name, name);
  assert.equal(record.status, 'passed');
  assert.equal(record.browser, browser);
  assert.equal(record.assetManifestSha256, assetHash);
  assert.equal(record.driverReadinessMode, 'sync-exposure-poll-and-two-controller-dom-observations');
  assert.deepEqual(record.browserViewport, { width: 1280, height: 900 });
  assert.deepEqual(record.browserProfile, { path: join(directory, `${name}-browser-profile`), initiallyEmpty: true });
  assert.deepEqual(record.freshStorage, { local: [], session: [], cookies: '' });
  assert(Number.isFinite(Date.parse(record.started)) && Date.parse(record.finished) >= Date.parse(record.started));
  assert(record.assertions.length > 10 && record.assertions.every(value => typeof value === 'string' && value.length));
  assert.equal(record.buildReplacementLimitation, limitation);
  assert.equal(record.buildReplacementIdentityObserver, 'Read-only QA closure retains original ServiceWorker object and counts controllerchange; no app, network or reload interception.');
  for (const key of ['buildReplacementControllerBefore', 'buildReplacementControllerAfter']) assert.deepEqual(record[key], { originalControllerPresent: true, sameControllerObject: true, controllerChanges: 0 });
  assert.equal(record.originalDaemonStoppedBeforePortReuse, true);
  const origin = new URL(record.replacementOrigins.original);
  assert.equal(origin.origin, record.replacementOrigins.original);
  assert.equal(origin.protocol, 'http:');
  assert.equal(origin.hostname, '127.0.0.1');
  assert.equal(record.replacementOrigins.replacement, origin.origin);
  assert.equal(record.replacementOrigins.identical, true);
  assert(record.originalDaemon.daemonId !== record.replacementDaemon.daemonId);
  assert.equal(record.replacementDaemon.buildId, record.originalDaemon.buildId + '-qa-controlled-replacement');
  const old = record.buildReplacementOldPage;
  assert(Number.isFinite(old.timeOrigin) && old.timeOrigin > 0);
  assert.equal(old.controller, origin.origin + '/sw.js');
  assert(old.entries.length > 0 && old.entries.length <= 32);
  assert.deepEqual(record.buildReplacementAfterPage, old);
  assert.deepEqual(Object.keys(record.buildReplacementEntryHashes).sort(), [...old.entries].sort());
  for (const path of old.entries) {
    assert(path.startsWith('/_nuxt/') && !path.includes('..'));
    assert.equal(record.buildReplacementEntryHashes[path], assets[path.slice(1)]);
    assert(digest(record.buildReplacementEntryHashes[path]));
  }
  const cursor = record.initialRuntimeCursor;
  assert(cursor.eventType === 'metric' && positive(cursor.attempt) && positive(cursor.seq));
  const manifest = JSON.parse(record.approvedPlan);
  assert.equal(cursor.runId, manifest.run_id);
  assert.equal(manifest.operation, 'train');
  const metrics = record.initialMetricEvidence;
  assert(positive(metrics.persistedMetricCount) && positive(metrics.persistedLogCount));
  assert.equal(metrics.producerJournalMatches, true);
  assert(metrics.durableCursors.some(value => value.attempt === cursor.attempt && value.seq >= cursor.seq));
  const monitor = record.liveMonitorBeforeReplacement;
  assert.equal(monitor.selectedRunId, cursor.runId);
  assert(positive(monitor.historySteps) && monitor.epoch > 0);
  assert.equal(monitor.historyCanvasPresent, true);
  assert.equal(monitor.diagnosticLogPresent, true);
  const termination = record.originalTerminationBeforeRootCleanup;
  assert.equal(termination.cause, 'owned-fixture-shutdown');
  assert.equal(termination.servicesClosed, true);
  assert.equal(termination.pidAbsent, true);
  assert.equal(termination.ownedRuntimePid, monitor.ownedRuntimePid);
  assert(positive(termination.ownedRuntimePid));
  const native = termination.nativeProcessResult;
  assert.equal(native.runId, cursor.runId);
  assert.equal(native.attempt, cursor.attempt);
  assert.equal(native.pid, termination.ownedRuntimePid);
  assert.equal(native.cancelled, true);
  assert.equal(native.timedOut, false);
  assert(Number.isSafeInteger(native.returncode));
  for (const key of ['identityMessage', 'selectedRunAbsent', 'metricHistoryAbsent', 'diagnosticsAbsent', 'noEnabledCancel', 'previewAbsent']) assert.equal(record.liveIdentityFence[key], true);
  assert.deepEqual(record.buildReplacementFreshConnect, { identityMessage: true, credentialEmpty: true, selectedRunAbsent: true, historyAbsent: true, approvalAbsent: true, noEnabledMutations: true });
  for (const key of ['replacementBeforeStaleSubmit', 'replacementAfterStaleSubmit', 'buildReplacementAfterExplicitConnect']) empty(record[key]);
  assert.equal(record.replacementMetadataComplete, true);
  assert.equal(record.replacementMetadataFrozenAfterCleanup, true);
  assert.equal(record.buildReplacementFrozenAfterCleanup, true);
  const requests = record.replacementAccessMetadata;
  assert(requests.length > 0 && requests.length < 8192);
  assert(requests.every(request => request.method === 'GET'));
  assert(requests.some(request => request.path === '/api/health' && request.scopeHeaderPresent === true && request.status === 409));
  assert(requests.filter(request => request.path === '/api/health' && request.scopeHeaderPresent === false && request.status === 200).length >= 2);
  assert(!requests.some(request => request.path.startsWith(`/api/runs/${cursor.runId}`) && request.status >= 200 && request.status < 300));
  const health = record.buildReplacementHealthReceipts;
  assert(health.length >= 2 && health.length <= 64);
  for (const receipt of health) assert.deepEqual(receipt, { status: 200, daemonId: record.replacementDaemon.daemonId, buildId: record.replacementDaemon.buildId, scoped: false });
  const cleanup = record.cleanup;
  assert.deepEqual(cleanup.errors, []);
  assert(!Object.hasOwn(cleanup, 'retainedPrivateRoots'));
  for (const key of ['browserSessionAbsent', 'fixtureServicesClosed', 'replacementServicesClosed', 'removedOwnedRoots', 'browserProfileRemoved', 'bothDaemonRootsAbsent', 'privateCredentialRemoved']) assert.equal(cleanup[key], true);
  for (const key of ['fixtureExit', 'replacementExit']) assert((cleanup[key].code === 0 && cleanup[key].signal === null) || (cleanup[key].code === null && cleanup[key].signal === 'SIGINT'));
  return record;
}

export async function verifyCachedBuildReplacementReport(path) {
  path = resolve(path);
  const directory = dirname(path);
  const decode = async file => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await boundedFile(file, 1048576)));
  const summary = await decode(path);
  for (const key of ['error', 'skip', 'skipped', 'failed']) assert(!Object.hasOwn(summary, key));
  assert.equal(summary.cases.length, 1);
  const record = summary.cases[0];
  assert.deepEqual((await readdir(directory)).sort(), [`${name}.json`, 'summary.json'].sort());
  assert.deepEqual(await decode(join(directory, `${name}.json`)), record);
  assert(Date.parse(summary.started) <= Date.parse(record.started) && Date.parse(summary.finished) >= Date.parse(record.finished));
  const root = new URL('../src/wavedl_daemon/web_assets/', import.meta.url);
  const bytes = await readFile(new URL('.wavedl-assets.json', root));
  const assets = JSON.parse(bytes);
  assert(Object.keys(assets).length > 20);
  for (const [file, expected] of Object.entries(assets)) {
    assert(file.split('/').every(part => part && part !== '.' && part !== '..') && !/[\\:%]/.test(file));
    assert.equal(hash(await boundedFile(fileURLToPath(new URL(file, root)), 16777216)), expected);
  }
  return verifyCachedBuildReplacementRecord(record, { assetHash: hash(bytes), assets, directory, browser: summary.browser });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyCachedBuildReplacementReport(process.argv[2]);
  console.log('cached controller/new controlled build evidence: valid');
}
