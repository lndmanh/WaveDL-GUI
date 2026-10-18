import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyCachedBuildReplacementRecord } from './verify_cached_build_replacement_report.mjs';
const id = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const options = { directory: '/owned', browser: 'agent-browser test', assetHash: 'a'.repeat(64), assets: { '_nuxt/entry.js': 'b'.repeat(64) } };
function valid() {
  const empty = { plans: 0, runs: [], control: [], executions: [] };
  const page = { timeOrigin: 1, controller: 'http://127.0.0.1:8420/sw.js', entries: ['/_nuxt/entry.js'] };
  return {
    name: 'cached-build-replacement', status: 'passed', browser: options.browser, assetManifestSha256: options.assetHash,
    driverReadinessMode: 'sync-exposure-poll-and-two-controller-dom-observations', browserViewport: { width: 1280, height: 900 },
    browserProfile: { path: '/owned/cached-build-replacement-browser-profile', initiallyEmpty: true }, freshStorage: { local: [], session: [], cookies: '' },
    started: '2026-10-18T00:00:00Z', finished: '2026-10-18T00:01:00Z', assertions: Array(11).fill('Verified'),
    buildReplacementLimitation: 'Same production source with controlled genuine factory build identity; old controlled page, actual controller object and unchanged loaded entry URLs/packaged byte hashes only. No cache-hit or loaded-response-byte proof, matching-new-client update, remote forwarding, released-binary or complete F15 claim.',
    buildReplacementIdentityObserver: 'Read-only QA closure retains original ServiceWorker object and counts controllerchange; no app, network or reload interception.',
    buildReplacementControllerBefore: { originalControllerPresent: true, sameControllerObject: true, controllerChanges: 0 },
    buildReplacementControllerAfter: { originalControllerPresent: true, sameControllerObject: true, controllerChanges: 0 },
    originalDaemonStoppedBeforePortReuse: true, originalDaemon: { daemonId: id(1), buildId: '1.8.1' }, replacementDaemon: { daemonId: id(2), buildId: '1.8.1-qa-controlled-replacement' },
    replacementOrigins: { original: 'http://127.0.0.1:8420', replacement: 'http://127.0.0.1:8420', identical: true },
    buildReplacementOldPage: page, buildReplacementAfterPage: structuredClone(page), buildReplacementEntryHashes: { '/_nuxt/entry.js': 'b'.repeat(64) },
    initialRuntimeCursor: { runId: id(3), attempt: 1, seq: 2, eventType: 'metric' }, approvedPlan: JSON.stringify({ operation: 'train', run_id: id(3) }),
    initialMetricEvidence: { persistedMetricCount: 1, persistedLogCount: 1, producerJournalMatches: true, durableCursors: [{ attempt: 1, seq: 2 }] },
    liveMonitorBeforeReplacement: { selectedRunId: id(3), historySteps: 1, epoch: 1, historyCanvasPresent: true, diagnosticLogPresent: true, ownedRuntimePid: 123 },
    originalTerminationBeforeRootCleanup: { cause: 'owned-fixture-shutdown', servicesClosed: true, pidAbsent: true, ownedRuntimePid: 123, nativeProcessResult: { runId: id(3), attempt: 1, pid: 123, cancelled: true, timedOut: false, returncode: 1 } },
    liveIdentityFence: { identityMessage: true, selectedRunAbsent: true, metricHistoryAbsent: true, diagnosticsAbsent: true, noEnabledCancel: true, previewAbsent: true },
    buildReplacementFreshConnect: { identityMessage: true, credentialEmpty: true, selectedRunAbsent: true, historyAbsent: true, approvalAbsent: true, noEnabledMutations: true },
    replacementBeforeStaleSubmit: structuredClone(empty), replacementAfterStaleSubmit: structuredClone(empty), buildReplacementAfterExplicitConnect: structuredClone(empty),
    replacementMetadataComplete: true, replacementMetadataFrozenAfterCleanup: true, buildReplacementFrozenAfterCleanup: true,
    replacementAccessMetadata: [{ method: 'GET', path: '/api/health', scopeHeaderPresent: true, status: 409 }, ...Array.from({ length: 2 }, () => ({ method: 'GET', path: '/api/health', scopeHeaderPresent: false, status: 200 }))],
    buildReplacementHealthReceipts: Array.from({ length: 2 }, () => ({ status: 200, daemonId: id(2), buildId: '1.8.1-qa-controlled-replacement', scoped: false })),
    cleanup: { errors: [], browserSessionAbsent: true, fixtureServicesClosed: true, replacementServicesClosed: true, removedOwnedRoots: true, browserProfileRemoved: true, bothDaemonRootsAbsent: true, privateCredentialRemoved: true, fixtureExit: { code: null, signal: 'SIGINT' }, replacementExit: { code: 0, signal: null } },
  };
}
test('accepts controlled genuine build identity refusal on cached old client', () => verifyCachedBuildReplacementRecord(valid(), options));
const attacks = [
  r => r.status = 'failed', r => r.error = '', r => r.skipped = false,
  r => r.assetManifestSha256 = '0'.repeat(64), r => r.replacementDaemon.buildId = '1.8.1',
  r => r.replacementDaemon.daemonId = id(1), r => r.replacementOrigins.replacement = 'http://127.0.0.1:9000',
  r => r.buildReplacementOldPage.controller = null, r => r.buildReplacementAfterPage.timeOrigin++,
  r => r.buildReplacementEntryHashes['/_nuxt/entry.js'] = '0'.repeat(64),
  r => r.buildReplacementFreshConnect.credentialEmpty = false, r => r.liveIdentityFence.previewAbsent = false,
  r => r.buildReplacementAfterExplicitConnect.plans = 1, r => r.replacementAfterStaleSubmit.control.push({}),
  r => r.replacementAccessMetadata.push({ method: 'POST', path: '/api/runs', status: 202 }),
  r => r.replacementAccessMetadata[0].status = 200, r => r.buildReplacementHealthReceipts[0].buildId = '1.8.1',
  r => r.originalTerminationBeforeRootCleanup.pidAbsent = false, r => r.initialMetricEvidence.producerJournalMatches = false,
  r => r.buildReplacementFrozenAfterCleanup = false, r => r.cleanup.bothDaemonRootsAbsent = false,
  r => r.cleanup.replacementExit.signal = 'SIGKILL', r => r.buildReplacementLimitation = 'Full F15',
  r => r.buildReplacementControllerAfter.sameControllerObject = false,
  r => r.buildReplacementControllerAfter.controllerChanges = 1,
  r => r.buildReplacementControllerBefore.originalControllerPresent = false,
  r => delete r.buildReplacementIdentityObserver,
];
for (const [index, mutate] of attacks.entries()) test(`rejects cached-build mutation ${index}`, () => {
  const record = valid(); mutate(record); assert.throws(() => verifyCachedBuildReplacementRecord(record, options));
});
