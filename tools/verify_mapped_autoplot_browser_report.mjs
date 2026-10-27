import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { boundedFile } from './browser_files.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export async function currentMappedAssets() {
  const root = resolve(import.meta.dirname, '../src/wavedl_daemon/web_assets');
  const raw = await boundedFile(join(root, '.wavedl-assets.json'), 1024 * 1024);
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)),
    files = {};
  const discovered = [];
  async function walk(directory, prefix = '') {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      assert(!item.isSymbolicLink());
      const name = prefix + item.name;
      if (item.isDirectory()) await walk(join(directory, item.name), `${name}/`);
      else if (name !== '.wavedl-assets.json') discovered.push(name);
    }
  }
  await walk(root);
  assert.deepEqual(discovered.sort(), Object.keys(manifest).sort());
  for (const [name, sha256] of Object.entries(manifest)) {
    assert(
      !name.startsWith('/') &&
        name.split('/').every((part) => part && !['.', '..'].includes(part)) &&
        digest(sha256),
    );
    const path = join(root, name),
      info = await lstat(path);
    assert(info.isFile() && !info.isSymbolicLink());
    const bytes = await boundedFile(path, 16 * 1024 * 1024);
    assert.equal(hash(bytes), sha256, 'Current asset differs from manifest');
    files[name] = { size: bytes.length, sha256 };
  }
  return { manifestSha256: hash(raw), files };
}

export function verifyMappedAutoplotReport(report) {
  assert.equal(report.name, 'mapped-autoplot');
  assert.equal(report.status, 'passed');
  assert.equal(report.simulatedScheduler, true);
  assert.equal(report.copyVisibility, true);
  assert.equal(report.realCluster, false);
  assert.equal(
    report.scope,
    'Native public browser, real CPU mapped batch scripts; simulated scheduler and explicit copy visibility, not real Slurm/shared-storage/site acceptance.',
  );
  for (const key of [
    'error',
    'fixtureFailure',
    'failureSnapshot',
    'failedObservation',
    'skipped',
    'skip',
    'skipReason',
    'retainedPrivateRoots',
  ])
    assert(!Object.hasOwn(report, key), 'Failure evidence present');
  assert.equal(report.browserProfileInitiallyEmpty, true);
  assert.deepEqual(report.freshStorage, { local: [], session: [], cookies: '' });
  assert(/^wavemap-[a-f0-9-]{8}$/.test(report.browserSession));
  assert.equal(report.browserRuntime.width, 1280);
  assert.equal(report.browserRuntime.height, 900);
  assert(
    typeof report.browserRuntime.userAgent === 'string' &&
      report.browserRuntime.userAgent.includes('Chrome/'),
  );
  assert(digest(report.assetManifestSha256));
  assert.equal(report.assetsBefore.manifestSha256, report.assetManifestSha256);
  assert.deepEqual(report.assetsBefore, report.assetsAfter);
  assert(Object.keys(report.assetsBefore.files).length > 20);
  for (const file of Object.values(report.assetsBefore.files))
    assert(Number.isSafeInteger(file.size) && file.size > 0 && digest(file.sha256));
  assert.deepEqual(report.cleanup.errors, []);
  for (const key of [
    'servicesClosed',
    'browserSessionAbsent',
    'listenerRefused',
    'removedOwnedRoots',
    'browserProfileRemoved',
  ])
    assert.equal(report.cleanup[key], true, key);
  assert.deepEqual(report.cleanup.fixtureExit, { code: 0, signal: null });
  assert.deepEqual(
    report.beforeRetry,
    report.durable,
    'Retry changed durable source/plan/publication',
  );
  assert.equal(report.durable.plans.length, 2);
  assert.equal(report.durable.controls.length, 2);
  assert(
    report.durable.controls.every(
      (item) => item.length === 3 && uuid(item[0]) && item[1] === 1 && item[2] === 0,
    ),
  );
  const training = report.durable.plans.find((item) => item.manifest.operation === 'train');
  const plot = report.durable.plans.find((item) => item.manifest.operation === 'plot');
  assert(
    training &&
      plot &&
      uuid(training.planId) &&
      uuid(plot.planId) &&
      training.planId !== plot.planId,
  );
  assert.deepEqual(training.manifest, report.approvedTraining);
  assert.notEqual(training.manifest.run_id, plot.manifest.run_id);
  assert.notEqual(training.requestId, plot.requestId);
  assert.deepEqual(
    report.durable.controls.map((item) => item[0]).sort(),
    [training.planId, plot.planId].sort(),
    'Control rows must belong exactly to the two durable plans',
  );
  for (const plan of [training, plot]) {
    assert.equal(plan.state, 'completed');
    assert(uuid(plan.manifest.run_id));
    assert(uuid(plan.requestId));
    assert.equal(hash(plan.manifestText), plan.manifestSha256);
    assert.deepEqual(JSON.parse(plan.manifestText), plan.manifest);
    assert.notEqual(plan.manifest.run_directory, plan.manifest.working_directory);
    assert.equal(
      plan.manifest.run_directory,
      join(report.fixture.host, 'runs', plan.manifest.run_id),
    );
    assert.equal(
      plan.manifest.working_directory,
      join(report.fixture.compute, 'runs', plan.manifest.run_id),
    );
    assert.deepEqual(plan.manifest.storage_map, [
      { host_root: report.fixture.host, execution_root: report.fixture.compute },
    ]);
    assert.equal(
      plan.manifest.resolved_config.data_path,
      join(report.fixture.compute, 'samples.npz'),
    );
    assert.deepEqual(plan.manifest.resolved_config.import_modules, [
      join(report.fixture.compute, 'registration.py'),
    ]);
    assert.equal(plan.manifest.runtime.python, report.fixture.python);
    assert.equal(plan.manifest.runtime.device, 'cpu');
    assert(plan.publications.length > 0);
    for (const publication of plan.publications) {
      assert.equal(hash(publication.completeText), publication.completeSha256);
      assert.deepEqual(JSON.parse(publication.completeText), publication.publication);
      assert.equal(publication.publication.run_id, plan.manifest.run_id);
      assert.equal(publication.publication.manifest_sha256, plan.manifestSha256);
      assert.deepEqual(publication.verifiedFiles, publication.publication.files);
      assert.equal(publication.runtimeViewMatches, true);
      for (const identity of Object.values(publication.publication.files))
        assert(Number.isSafeInteger(identity.size) && identity.size > 0 && digest(identity.sha256));
      if (publication.selectionText !== null) {
        assert.deepEqual(JSON.parse(publication.selectionText), publication.selection);
        const record = publication.publication.files['checkpoint_selection.json'];
        assert.equal(record.size, Buffer.byteLength(publication.selectionText));
        assert.equal(record.sha256, hash(publication.selectionText));
      }
    }
    assert.deepEqual(plan.registrationExecution, {
      module: join(report.fixture.compute, 'registration.py'),
      cwd: plan.manifest.working_directory,
    });
  }
  const pin = plot.manifest.checkpoint_source;
  assert.equal(pin.run_id, training.manifest.run_id);
  assert.equal(pin.manifest_sha256, training.manifestSha256);
  const source = training.publications.find((item) => item.generation === pin.generation);
  assert(source);
  assert.equal(source.selection.kind, 'best');
  assert.equal(pin.complete_sha256, source.completeSha256);
  assert.deepEqual(pin.files, source.publication.files);
  assert.equal(
    plot.idempotencyKey,
    `web-autoplot-v1:${training.manifest.run_id}:${training.requestId}:${source.generation}`,
  );
  assert.equal(
    plot.manifest.resolved_config.checkpoint,
    join(report.fixture.compute, 'runs', training.manifest.run_id, 'checkpoints', pin.generation),
  );
  assert.equal(report.selectedArtifact.runId, plot.manifest.run_id);
  assert.equal(report.selectedArtifact.path, 'scatter_all.png');
  const rasterPublication = plot.publications.find(
    (item) => item.generation === report.selectedArtifact.generation,
  );
  assert(rasterPublication);
  assert.deepEqual(rasterPublication.publication.files['scatter_all.png'], {
    size: report.selectedArtifact.size,
    sha256: report.selectedArtifact.sha256,
  });
  assert(
    report.raster.length === 1 &&
      report.raster.every(
        (image) =>
          Number.isSafeInteger(image.width) &&
          image.width > 0 &&
          Number.isSafeInteger(image.height) &&
          image.height > 0,
      ),
  );
  const decoded = report.decodedPublication;
  assert.deepEqual(
    Object.keys(decoded).sort(),
    ['width', 'height', 'pixelFormat', 'rgbaSha256', 'sourceSize', 'sourceSha256'].sort(),
  );
  assert.equal(decoded.pixelFormat, 'RGBA');
  assert(digest(decoded.rgbaSha256));
  assert(
    decoded.width <= 8192 && decoded.height <= 8192 && decoded.width * decoded.height <= 16777216,
  );
  const { alt, viewportIntersection, ...pixels } = report.raster[0];
  assert.equal(alt, 'Verified published diagnostic plot');
  assert.equal(viewportIntersection, true);
  const { sourceSize, sourceSha256, ...decodedPixels } = decoded;
  assert.equal(sourceSize, report.selectedArtifact.size);
  assert.equal(sourceSha256, report.selectedArtifact.sha256);
  assert.deepEqual(pixels, decodedPixels, 'Rendered pixels differ from selected publication');
  assert.equal(report.batchResults.length, 2);
  assert.equal(new Set(report.batchResults.map((item) => item.job)).size, 2);
  for (const result of report.batchResults) {
    assert.equal(result.returncode, 0);
    assert.equal(result.timedOut, false);
    assert.equal(result.cancelled, false);
    assert.equal(result.copiedRuntimePublication, true);
    const plan = report.durable.plans.find(
      (item) => item.manifest.run_directory === result.hostRun,
    );
    assert(plan);
    assert.equal(result.runtimeRun, plan.manifest.working_directory);
    assert.equal(result.requestId, plan.requestId);
  }
  assert(
    Array.isArray(report.boundary) && report.boundary.length >= 4 && report.boundary.length <= 8,
  );
  for (const request of report.boundary) {
    assert.equal(request.method, 'POST');
    assert(['/api/runs/plan', '/api/runs'].includes(request.path));
    assert.equal(hash(request.bodyText), request.bodySha256);
    assert.deepEqual(JSON.parse(request.bodyText), request.body);
    assert.equal(request.originalAccepted, true);
  }
  const plans = report.boundary.filter((item) => item.path === '/api/runs/plan');
  assert.equal(plans.length, 2);
  assert.equal(new Set(plans.map((item) => item.idempotencyKey)).size, 2);
  assert(
    plans.every(
      (item) =>
        typeof item.idempotencyKey === 'string' &&
        item.idempotencyKey &&
        item.deliveredStatus === 200 &&
        !item.droppedAck,
    ),
  );
  for (const request of plans) {
    assert.deepEqual(request.body.storage_map, training.manifest.storage_map);
    assert.equal(request.body.config.data_path, join(report.fixture.host, 'samples.npz'));
    assert.deepEqual(request.body.config.import_modules, [report.fixture.registration]);
    assert.equal(request.body.backend, 'slurm');
    assert.equal(request.body.runtime.python, report.fixture.python);
    const durable = report.durable.plans.find(
      (plan) => plan.manifest.operation === request.body.operation,
    );
    assert(durable);
    assert.equal(request.idempotencyKey, durable.idempotencyKey);
    assert.deepEqual(request.body, durable.request);
  }
  const sourceRequest = plans.find((item) => item.body.operation === 'train');
  const plotRequest = plans.find((item) => item.body.operation === 'plot');
  assert(sourceRequest && plotRequest);
  assert.deepEqual(plotRequest.body.checkpoint_source, {
    run_id: training.manifest.run_id,
    generation: source.generation,
  });
  const submits = report.boundary.filter((item) => item.path === '/api/runs');
  assert(submits.length >= 2 && submits.length <= 3);
  assert.equal(submits.filter((item) => item.droppedAck).length, 1);
  const dropped = submits.find((item) => item.droppedAck);
  assert.equal(dropped.body.plan_id, plot.planId);
  assert.equal(dropped.deliveredStatus, 503);
  assert(submits.every((item) => [training.planId, plot.planId].includes(item.body.plan_id)));
  assert.equal(submits.filter((item) => item.body.plan_id === training.planId).length, 1);
  assert(submits.every((item) => item.deliveredStatus === (item.droppedAck ? 503 : 202)));
  for (const submit of submits) assert.deepEqual(submit.body, { plan_id: submit.body.plan_id });
  const plotSubmits = submits.filter((item) => item.body.plan_id === plot.planId);
  assert(
    plotSubmits.every(
      (item) =>
        item.bodySha256 === dropped.bodySha256 && item.idempotencyKey === dropped.idempotencyKey,
    ),
  );
  assert.equal(report.screenshot.name, 'mapped-raster.png');
  assert(digest(report.screenshot.sha256));
  assert(
    Number.isSafeInteger(report.screenshot.size) &&
      report.screenshot.size > 0 &&
      report.screenshot.size < 4 * 1024 * 1024,
  );
  return true;
}

export function verifyMappedAutoplotNegativeReport(report, fault) {
  assert(['failed', 'uncertain'].includes(fault));
  assert.equal(report.name, 'mapped-autoplot');
  assert.equal(report.status, 'passed');
  assert.equal(
    report.scope,
    'Native public browser, real CPU mapped batch scripts; simulated scheduler and explicit copy visibility, not real Slurm/shared-storage/site acceptance.',
  );
  assert.equal(report.simulatedScheduler, true);
  assert.equal(report.copyVisibility, true);
  assert.equal(report.realCluster, false);
  assert.equal(report.browserProfileInitiallyEmpty, true);
  assert.deepEqual(report.freshStorage, { local: [], session: [], cookies: '' });
  assert(/^wavemap-[a-f0-9-]{8}$/.test(report.browserSession));
  assert.equal(report.browserRuntime.width, 1280);
  assert.equal(report.browserRuntime.height, 900);
  assert(report.browserRuntime.userAgent.includes('Chrome/'));
  assert(digest(report.assetManifestSha256));
  assert.deepEqual(report.assetsBefore, report.assetsAfter);
  assert(Object.keys(report.assetsBefore.files).length > 20);
  for (const file of Object.values(report.assetsBefore.files)) {
    assert(Number.isSafeInteger(file.size) && file.size > 0);
    assert(digest(file.sha256));
  }
  assert.equal(report.fixture.trainingFault, fault);
  assert.equal(report.negative.trainingFault, fault);
  assert.equal(report.negative.automaticPlotPlanCount, 0);
  assert.equal(report.negative.retryVisible, false);
  assert.equal(report.negative.plans.plans.length, 1);
  const [training] = report.negative.plans.plans;
  assert.equal(training.manifest.operation, 'train');
  assert.equal(training.state, null);
  assert.deepEqual(training.manifest, report.negative.approvedTraining);
  assert.equal(training.manifest.run_id, report.negative.observedRun.run_id);
  assert.equal(training.requestId, report.negative.observedRun.request_id);
  assert.equal(training.manifest.backend ?? 'slurm', report.negative.observedRun.backend);
  assert.equal(report.negative.observedRun.operation, 'train');
  assert(
    fault === 'failed'
      ? report.negative.observedRun.state === 'failed'
      : ['running', 'observation_unavailable'].includes(report.negative.observedRun.state),
  );
  assert.equal(
    report.negative.observedRun.uncertainty,
    fault === 'uncertain',
  );
  assert(report.negative.publicText.includes('Run detail'));
  assert(report.negative.publicText.includes(training.manifest.run_id));
  assert(!report.negative.publicText.includes('Retry automatic plots'));
  assert(Array.isArray(report.negative.samples) && report.negative.samples.length >= 20);
  assert(Number.isSafeInteger(report.negative.observationMs) && report.negative.observationMs >= 6500);
  let previousElapsed = -1;
  for (const sample of report.negative.samples) {
    assert(Number.isSafeInteger(sample.elapsedMs) && sample.elapsedMs >= previousElapsed);
    assert.equal(sample.planCount, 1);
    previousElapsed = sample.elapsedMs;
  }
  assert.deepEqual(report.cleanup.errors, []);
  for (const key of [
    'servicesClosed',
    'browserSessionAbsent',
    'listenerRefused',
    'removedOwnedRoots',
    'browserProfileRemoved',
  ]) assert.equal(report.cleanup[key], true, key);
  assert.deepEqual(report.cleanup.fixtureExit, { code: 0, signal: null });
}

export async function verifyMappedAutoplotNegativeFile(path, fault) {
  const report = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(await boundedFile(path, 2 * 1024 * 1024)),
  );
  verifyMappedAutoplotNegativeReport(report, fault);
  assert.deepEqual(report.assetsAfter, await currentMappedAssets(), 'Stale or mixed packaged asset inventory');
  return report;
}

export async function verifyMappedAutoplotFile(path) {
  const report = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(await boundedFile(path, 2 * 1024 * 1024)),
  );
  verifyMappedAutoplotReport(report);
  assert.deepEqual(
    report.assetsAfter,
    await currentMappedAssets(),
    'Stale or mixed packaged asset inventory',
  );
  const screenshot = await boundedFile(
    join(resolve(path, '..'), report.screenshot.name),
    4 * 1024 * 1024,
  );
  assert.equal(screenshot.length, report.screenshot.size);
  assert.equal(hash(screenshot), report.screenshot.sha256);
  assert(screenshot.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  return report;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  await verifyMappedAutoplotFile(process.argv[2]);
  console.log('mapped autoplot browser report: verified');
}
