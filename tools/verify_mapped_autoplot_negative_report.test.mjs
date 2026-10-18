import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyMappedAutoplotNegativeReport } from './verify_mapped_autoplot_browser_report.mjs';

function report(fault = 'failed') {
  const runId = '00000000-0000-4000-8000-000000000001';
  const requestId = '00000000-0000-4000-8000-000000000002';
  const manifest = { operation: 'train', run_id: runId, backend: 'slurm' };
  const assets = {
    manifestSha256: 'a'.repeat(64),
    files: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`f${i}`, { size: 1, sha256: 'b'.repeat(64) }])),
  };
  return {
    name: 'mapped-autoplot',
    status: 'passed',
    scope: 'Native public browser, real CPU mapped batch scripts; simulated scheduler and explicit copy visibility, not real Slurm/shared-storage/site acceptance.',
    simulatedScheduler: true,
    copyVisibility: true,
    realCluster: false,
    browserProfileInitiallyEmpty: true,
    freshStorage: { local: [], session: [], cookies: '' },
    browserSession: 'wavemap-1234abcd',
    browserRuntime: { width: 1280, height: 900, userAgent: 'Chrome/150' },
    assetManifestSha256: assets.manifestSha256,
    assetsBefore: assets,
    assetsAfter: structuredClone(assets),
    fixture: { trainingFault: fault },
    negative: {
      trainingFault: fault,
      automaticPlotPlanCount: 0,
      retryVisible: false,
      approvedTraining: manifest,
      publicText: `Run detail\n${runId}\nTraining failed. No automatic plot is available.`,
      observationMs: 6500,
      samples: Array.from({ length: 20 }, (_, i) => ({ elapsedMs: i * 350, planCount: 1 })),
      plans: {
        plans: [
          {
            state: null,
            manifest,
            requestId,
          },
        ],
      },
      observedRun: {
        run_id: runId,
        request_id: requestId,
        backend: 'slurm',
        operation: 'train',
        state: fault === 'failed' ? 'failed' : 'observation_unavailable',
        uncertainty: fault === 'uncertain',
      },
    },
    cleanup: { errors: [], servicesClosed: true, browserSessionAbsent: true, listenerRefused: true, removedOwnedRoots: true, browserProfileRemoved: true, fixtureExit: { code: 0, signal: null } },
  };
}

for (const fault of ['failed', 'uncertain']) {
  test(`strict negative mapped autoplot verifier accepts ${fault}`, () => {
    verifyMappedAutoplotNegativeReport(report(fault), fault);
  });
}

test('strict negative verifier rejects a fabricated plot plan', () => {
  const value = report('failed');
  value.negative.automaticPlotPlanCount = 1;
  assert.throws(() => verifyMappedAutoplotNegativeReport(value, 'failed'));
});

test('strict negative verifier rejects retry visibility', () => {
  const value = report('uncertain');
  value.negative.retryVisible = true;
  assert.throws(() => verifyMappedAutoplotNegativeReport(value, 'uncertain'));
});

test('strict negative verifier rejects wrong durable state', () => {
  const value = report('failed');
  value.negative.plans.plans[0].state = 'completed';
  assert.throws(() => verifyMappedAutoplotNegativeReport(value, 'failed'));
});

const mutations = [
  ['name', (value) => (value.name = 'forged')],
  ['status', (value) => (value.status = 'failed')],
  ['scope', (value) => (value.scope = 'fake')],
  ['scheduler flag', (value) => (value.simulatedScheduler = false)],
  ['copy visibility', (value) => (value.copyVisibility = false)],
  ['profile freshness', (value) => (value.browserProfileInitiallyEmpty = false)],
  ['storage freshness', (value) => (value.freshStorage.local = ['secret'])],
  ['browser session', (value) => (value.browserSession = 'forged')],
  ['browser dimensions', (value) => (value.browserRuntime.width = 1)],
  ['asset inventory', (value) => delete value.assetsAfter.files.f0],
  ['approved identity', (value) => (value.negative.approvedTraining.run_id = 'wrong')],
  ['observed identity', (value) => (value.negative.observedRun.run_id = 'wrong')],
  ['public run detail', (value) => (value.negative.publicText = 'no details')],
  ['sample count', (value) => (value.negative.samples = value.negative.samples.slice(0, 1))],
  ['sample plan count', (value) => (value.negative.samples[0].planCount = 2)],
  ['sample monotonicity', (value) => (value.negative.samples[1].elapsedMs = -1)],
  ['observation duration', (value) => (value.negative.observationMs = 1)],
  ['cleanup proof', (value) => (value.cleanup.servicesClosed = false)],
  ['fixture exit', (value) => (value.cleanup.fixtureExit.code = 1)],
];

for (const [label, mutate] of mutations) {
  test(`strict negative verifier rejects ${label} mutation`, () => {
    const value = report('failed');
    mutate(value);
    assert.throws(() => verifyMappedAutoplotNegativeReport(value, 'failed'));
  });
}
