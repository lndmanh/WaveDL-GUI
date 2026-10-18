import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { verifyMappedAutoplotReport } from './verify_mapped_autoplot_browser_report.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
function proof() {
  const fixture = {
    host: '/host',
    compute: '/compute',
    registration: '/host/registration.py',
    python: '/venv/python',
  };
  const trainingManifest = {
    run_id: id(1),
    operation: 'train',
    run_directory: `/host/runs/${id(1)}`,
    working_directory: `/compute/runs/${id(1)}`,
    storage_map: [{ host_root: '/host', execution_root: '/compute' }],
    resolved_config: {
      data_path: '/compute/samples.npz',
      import_modules: ['/compute/registration.py'],
    },
    runtime: { python: '/venv/python', device: 'cpu' },
  };
  const trainingText = JSON.stringify(trainingManifest),
    selectionText = '{"schema_version":1,"kind":"best"}';
  const files = {
    'checkpoint_selection.json': { size: selectionText.length, sha256: hash(selectionText) },
    'pytorch_model.bin': { size: 8, sha256: hash('weights!') },
  };
  const complete = { run_id: id(1), attempt: 1, manifest_sha256: hash(trainingText), files };
  const completeText = JSON.stringify(complete);
  const source = {
    generation: 'gen-000001',
    completeText,
    completeSha256: hash(completeText),
    publication: complete,
    selectionText,
    selection: JSON.parse(selectionText),
  };
  const plotManifest = {
    ...structuredClone(trainingManifest),
    run_id: id(2),
    operation: 'plot',
    run_directory: `/host/runs/${id(2)}`,
    working_directory: `/compute/runs/${id(2)}`,
    checkpoint_source: {
      run_id: id(1),
      generation: source.generation,
      manifest_sha256: hash(trainingText),
      complete_sha256: hash(completeText),
      files,
    },
    resolved_config: {
      ...trainingManifest.resolved_config,
      checkpoint: `/compute/runs/${id(1)}/checkpoints/gen-000001`,
    },
  };
  const plotText = JSON.stringify(plotManifest),
    png = { size: 123, sha256: hash('pngfixture') };
  const plotComplete = {
    run_id: id(2),
    attempt: 1,
    manifest_sha256: hash(plotText),
    files: { 'scatter_all.png': png },
  };
  const plotCompleteText = JSON.stringify(plotComplete);
  const durable = {
    controls: [
      [id(3), 1, 0],
      [id(4), 1, 0],
    ],
    plans: [
      {
        planId: id(3),
        manifest: trainingManifest,
        manifestText: trainingText,
        manifestSha256: hash(trainingText),
        state: 'completed',
        publications: [source],
      },
      {
        planId: id(4),
        manifest: plotManifest,
        manifestText: plotText,
        manifestSha256: hash(plotText),
        state: 'completed',
        publications: [
          {
            generation: 'gen-000001',
            completeText: plotCompleteText,
            completeSha256: hash(plotCompleteText),
            publication: plotComplete,
            selection: null,
            selectionText: null,
          },
        ],
      },
    ],
  };
  const request = {
    backend: 'slurm',
    config: { data_path: '/host/samples.npz', import_modules: ['/host/registration.py'] },
    runtime: { python: '/venv/python' },
    storage_map: trainingManifest.storage_map,
  };
  const boundary = (path, body, key, status = 200, droppedAck = false) => ({
    method: 'POST',
    path,
    body,
    bodyText: JSON.stringify(body),
    bodySha256: hash(JSON.stringify(body)),
    idempotencyKey: key,
    deliveredStatus: status,
    originalAccepted: true,
    droppedAck,
  });
  const assets = {
    manifestSha256: hash('assets'),
    files: Object.fromEntries(
      Array.from({ length: 25 }, (_, index) => [
        `file${index}.js`,
        { size: 8, sha256: hash('filedata') },
      ]),
    ),
  };
  const report = {
    name: 'mapped-autoplot',
    status: 'passed',
    scope:
      'Native public browser, real CPU mapped batch scripts; simulated scheduler and explicit copy visibility, not real Slurm/shared-storage/site acceptance.',
    simulatedScheduler: true,
    copyVisibility: true,
    realCluster: false,
    fixture,
    browserProfileInitiallyEmpty: true,
    freshStorage: { local: [], session: [], cookies: '' },
    browserSession: 'wavemap-1234abcd',
    browserRuntime: { width: 1280, height: 900, userAgent: 'Chrome/154' },
    assetManifestSha256: assets.manifestSha256,
    assetsBefore: assets,
    assetsAfter: structuredClone(assets),
    cleanup: {
      errors: [],
      servicesClosed: true,
      browserSessionAbsent: true,
      listenerRefused: true,
      removedOwnedRoots: true,
      browserProfileRemoved: true,
      fixtureExit: { code: 0, signal: null },
    },
    approvedTraining: trainingManifest,
    beforeRetry: structuredClone(durable),
    durable,
    selectedArtifact: { runId: id(2), generation: 'gen-000001', path: 'scatter_all.png', ...png },
    raster: [
      {
        width: 1200,
        height: 900,
        alt: 'Verified published diagnostic plot',
        pixelFormat: 'RGBA',
        rgbaSha256: hash('pixels'),
        viewportIntersection: true,
      },
    ],
    decodedPublication: {
      width: 1200,
      height: 900,
      pixelFormat: 'RGBA',
      rgbaSha256: hash('pixels'),
      sourceSize: png.size,
      sourceSha256: png.sha256,
    },
    batchResults: [1, 2].map((number) => ({
      job: String(22000 + number),
      returncode: 0,
      timedOut: false,
      cancelled: false,
      copiedRuntimePublication: true,
      hostRun: `/host/runs/${id(number)}`,
      runtimeRun: `/compute/runs/${id(number)}`,
    })),
    boundary: [
      boundary('/api/runs/plan', { ...request, operation: 'train' }, id(5)),
      boundary('/api/runs', { plan_id: id(3) }, '', 202),
      boundary(
        '/api/runs/plan',
        {
          ...request,
          operation: 'plot',
          checkpoint_source: { run_id: id(1), generation: 'gen-000001' },
        },
        id(6),
      ),
      boundary('/api/runs', { plan_id: id(4) }, '', 503, true),
      boundary('/api/runs', { plan_id: id(4) }, '', 202),
    ],
  };
  for (const plan of report.durable.plans) {
    const isTraining = plan.manifest.operation === 'train';
    plan.requestId = id(isTraining ? 7 : 8);
    plan.idempotencyKey = isTraining ? id(5) : `web-autoplot-v1:${id(1)}:${id(7)}:gen-000001`;
    const request = report.boundary.find(
      (item) => item.path === '/api/runs/plan' && item.body.operation === plan.manifest.operation,
    );
    request.idempotencyKey = plan.idempotencyKey;
    plan.request = structuredClone(request.body);
    plan.registrationExecution = {
      module: '/compute/registration.py',
      cwd: plan.manifest.working_directory,
    };
    for (const publication of plan.publications) {
      publication.verifiedFiles = structuredClone(publication.publication.files);
      publication.runtimeViewMatches = true;
    }
  }
  report.beforeRetry = structuredClone(report.durable);
  report.batchResults.forEach((item, index) => {
    item.requestId = id(index === 0 ? 7 : 8);
  });
  report.screenshot = { name: 'mapped-raster.png', size: 1234, sha256: hash('screenshot') };
  return report;
}

test('synthetic semantic report fixture passes; not browser acceptance', () =>
  assert.equal(verifyMappedAutoplotReport(proof()), true));
for (const [name, mutate] of [
  [
    'unrelated control identity',
    (report) => {
      report.durable.controls[0][0] = id(9);
      report.beforeRetry = structuredClone(report.durable);
    },
  ],
  [
    'request identity reused',
    (report) => {
      report.durable.plans[1].requestId = report.durable.plans[0].requestId;
      report.beforeRetry = structuredClone(report.durable);
    },
  ],
  [
    'autoplot key not source bound',
    (report) => {
      report.durable.plans[1].idempotencyKey = 'foreign';
      report.beforeRetry = structuredClone(report.durable);
    },
  ],
  [
    'durable request not approved',
    (report) => {
      report.durable.plans[1].request.config.data_path = '/foreign';
      report.beforeRetry = structuredClone(report.durable);
    },
  ],
  [
    'scheduler request not bound',
    (report) => {
      report.batchResults[1].requestId = id(9);
    },
  ],
  [
    'rendered pixels not selected PNG',
    (report) => {
      report.raster[0].rgbaSha256 = hash('foreign');
    },
  ],
  [
    'rendered dimensions not selected PNG',
    (report) => {
      report.raster[0].width++;
    },
  ],
  [
    'foreign image label',
    (report) => {
      report.raster[0].alt = 'foreign';
    },
  ],
  [
    'raster outside viewport',
    (report) => {
      report.raster[0].viewportIntersection = false;
    },
  ],
  [
    'multiple rendered sources',
    (report) => {
      report.raster.push(structuredClone(report.raster[0]));
    },
  ],
  [
    'decoder source identity mismatch',
    (report) => {
      report.decodedPublication.sourceSha256 = hash('foreign');
    },
  ],
  [
    'retry response still unknown',
    (report) => {
      report.boundary.at(-1).deliveredStatus = 503;
    },
  ],
])
  test(`rejects ${name}`, () => {
    const report = proof();
    mutate(report);
    assert.throws(() => verifyMappedAutoplotReport(report));
  });
for (const [name, mutate] of [
  [
    'failed report',
    (report) => {
      report.status = 'failed';
    },
  ],
  [
    'real cluster claim',
    (report) => {
      report.realCluster = true;
    },
  ],
  [
    'retained private roots',
    (report) => {
      report.retainedPrivateRoots = [];
    },
  ],
  [
    'mixed assets',
    (report) => {
      report.assetsAfter.files['file0.js'].sha256 = 'a'.repeat(64);
    },
  ],
  [
    'live browser',
    (report) => {
      report.cleanup.browserSessionAbsent = false;
    },
  ],
  [
    'live listener',
    (report) => {
      report.cleanup.listenerRefused = false;
    },
  ],
  [
    'unremoved root',
    (report) => {
      report.cleanup.removedOwnedRoots = false;
    },
  ],
  [
    'cleanup error',
    (report) => {
      report.cleanup.errors.push('unproven');
    },
  ],
  [
    'duplicate submission',
    (report) => {
      report.durable.controls.push([id(10), 1, 0]);
    },
  ],
  [
    'changed retry authority',
    (report) => {
      report.beforeRetry.plans[0].state = 'running';
    },
  ],
  [
    'unattested source',
    (report) => {
      report.durable.plans[1].manifest.checkpoint_source.complete_sha256 = 'a'.repeat(64);
    },
  ],
  [
    'periodic checkpoint',
    (report) => {
      report.durable.plans[0].publications[0].selection.kind = 'periodic';
    },
  ],
  [
    'double mapped registration',
    (report) => {
      report.durable.plans[1].manifest.resolved_config.import_modules = [
        '/elsewhere/registration.py',
      ];
    },
  ],
  [
    'zero raster',
    (report) => {
      report.raster[0].width = 0;
    },
  ],
  [
    'PNG identity',
    (report) => {
      report.selectedArtifact.sha256 = 'a'.repeat(64);
    },
  ],
  [
    'batch error',
    (report) => {
      report.batchResults[0].returncode = 1;
    },
  ],
  [
    'duplicate job',
    (report) => {
      report.batchResults[1].job = report.batchResults[0].job;
    },
  ],
  [
    'no copy visibility',
    (report) => {
      report.batchResults[0].copiedRuntimePublication = false;
    },
  ],
  [
    'unapproved request',
    (report) => {
      report.boundary[0].body.config.data_path = '/elsewhere/data.npz';
    },
  ],
  [
    'lost unrelated ack',
    (report) => {
      report.boundary[3].body.plan_id = id(3);
    },
  ],
  [
    'missing lost ack',
    (report) => {
      report.boundary[3].droppedAck = false;
    },
  ],
])
  test(`rejects ${name}`, () => {
    const report = proof();
    mutate(report);
    assert.throws(() => verifyMappedAutoplotReport(report));
  });
