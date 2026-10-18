#!/usr/bin/env node
// Native public DOM authoring, actual CPU batch scripts, simulated scheduler/copy storage.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  realpath,
  readdir,
  lstat,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { boundedCommand } from './run_retained_browser_acceptance.mjs';
import { createBrowserActions } from './browser_actions.mjs';
import { openTrainingEditor } from './browser_training_editor.mjs';
import { browserLaunchArgs } from './browser_launch_policy.mjs';
import {
  verifyMappedAutoplotFile,
  verifyMappedAutoplotNegativeReport,
  currentMappedAssets,
} from './verify_mapped_autoplot_browser_report.mjs';

const python = process.env.WAVEDL_PYTHON;
assert(python, 'Set explicit WAVEDL_PYTHON');
assert(process.argv[2], 'Pass an empty dedicated report directory');
const trainingFault = process.argv[3] ?? null;
assert(trainingFault === null || ['failed', 'uncertain'].includes(trainingFault));
const requestedReport = resolve(process.argv[2]);
const destination = join(await realpath(dirname(requestedReport)), basename(requestedReport));
try {
  await mkdir(destination, { mode: 0o700 });
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}
const destinationInfo = await lstat(destination);
assert(
  destinationInfo.isDirectory() &&
    !destinationInfo.isSymbolicLink() &&
    (await readdir(destination)).length === 0,
  'Report destination must be empty and ordinary',
);
const repo = resolve(import.meta.dirname, '..');
const workspace = await realpath(await mkdtemp(join(tmpdir(), 'wavedl-browser-mapped-')));
const root = join(workspace, 'fixture'),
  profile = join(workspace, 'browser'),
  downloads = join(workspace, 'downloads');
await Promise.all([root, profile, downloads].map((path) => mkdir(path, { mode: 0o700 })));
const session = `wavemap-${randomUUID().slice(0, 8)}`;
const browser = process.env.AGENT_BROWSER_BIN ?? 'agent-browser';
const record = {
  name: 'mapped-autoplot',
  status: 'running',
  scope:
    'Native public browser, real CPU mapped batch scripts; simulated scheduler and explicit copy visibility, not real Slurm/shared-storage/site acceptance.',
  simulatedScheduler: true,
  copyVisibility: true,
  realCluster: false,
  assertions: [],
  cleanup: { errors: [] },
};
let stdout = '',
  stderr = '',
  opened = false,
  secret = '',
  closed = false,
  origin;
const fixture = spawn(
  python,
  [
    'tools/browser_mapped_autoplot_fixture.py',
    '--root',
    root,
    ...(trainingFault ? ['--training-fault', trainingFault] : []),
  ],
  {
  cwd: repo,
  env: {
    ...process.env,
    PYTHONPATH: join(repo, 'src'),
    OMP_NUM_THREADS: '1',
    MKL_NUM_THREADS: '1',
    MPLBACKEND: 'Agg',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  },
);
fixture.stdout.on('data', (chunk) => {
  stdout += chunk;
  if (stdout.length > 4 * 1024 * 1024) fixture.kill('SIGINT');
});
fixture.stderr.on('data', (chunk) => {
  stderr = (stderr + chunk).slice(-8192);
});
fixture.on('close', () => {
  closed = true;
});
const hash = (value) => createHash('sha256').update(value).digest('hex');
async function assetInventory() {
  const assetRoot = join(repo, 'src/wavedl_daemon/web_assets');
  const manifest = await readFile(join(assetRoot, '.wavedl-assets.json'));
  const declared = JSON.parse(manifest),
    records = {};
  for (const [name, sha256] of Object.entries(declared)) {
    assert(!name.includes('..') && !name.startsWith('/'));
    const path = join(assetRoot, name),
      info = await lstat(path);
    assert(info.isFile() && !info.isSymbolicLink());
    const bytes = await readFile(path);
    assert.equal(hash(bytes), sha256);
    records[name] = { size: bytes.length, sha256 };
  }
  return { manifestSha256: hash(manifest), files: records };
}
record.assetsBefore = await currentMappedAssets();
record.browserProfileInitiallyEmpty = (await readdir(profile)).length === 0;
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('AGENT_BROWSER_')) delete env[key];
env.AGENT_BROWSER_SESSION = session;
const cli = (...args) =>
  boundedCommand(
    browser,
    [
      '--session',
      session,
      ...(args[0] === 'open'
        ? [
            '--headed',
            String(process.env.WAVEDL_BROWSER_HEADED === 'true'),
            '--engine',
            'chrome',
            '--profile',
            profile,
            '--allowed-domains',
            '127.0.0.1,localhost',
            '--args',
            browserLaunchArgs,
            '--download-path',
            downloads,
            ...(process.env.WAVEDL_BROWSER_EXECUTABLE
              ? ['--executable-path', process.env.WAVEDL_BROWSER_EXECUTABLE]
              : []),
          ]
        : []),
      ...args,
    ],
    { cwd: repo, env, timeout: 35000 },
  );
const dom = async (code) => {
  try {
    return JSON.parse(JSON.parse(await cli('eval', '-b', Buffer.from(code).toString('base64'))));
  } catch (error) {
    record.failedObservation = code;
    throw error;
  }
};
const snapshot = () => cli('snapshot', '-i');
const actions = createBrowserActions({ cli, dom, snapshot });
const check = (value, message) => {
  assert(value, message);
  record.assertions.push(message);
};
const inspectScript = `import hashlib,json,sqlite3,sys
from pathlib import Path
root=Path(sys.argv[1]); c=sqlite3.connect((root/'state'/'registry.db').resolve().as_uri()+'?mode=ro',uri=True)
plans=[]
for plan_id,request_id,key,request_json,raw in c.execute('SELECT plan_id,request_id,idempotency_key,request_payload_json,plan_json FROM plans ORDER BY plan_id'):
 p=json.loads(raw); m=json.loads(p['manifest_json']); r=Path(m['run_directory']); publications=[]
 for complete in sorted((r/'checkpoints').glob('*/COMPLETE.json')):
  raw=complete.read_bytes(); item=json.loads(raw); verified={}; runtime=Path(m['working_directory'])/'checkpoints'/complete.parent.name
  runtime_matches=(runtime/'COMPLETE.json').read_bytes()==raw
  for name,wanted in item['files'].items():
   body=(complete.parent/name).read_bytes()
   verified[name]={'size':len(body),'sha256':hashlib.sha256(body).hexdigest()}
   if verified[name] != wanted: raise ValueError('Publication bytes differ')
   runtime_matches=runtime_matches and (runtime/name).read_bytes()==body
  metadata=(complete.parent/'checkpoint_selection.json').read_text() if (complete.parent/'checkpoint_selection.json').exists() else None
  publications.append({'generation':complete.parent.name,'completeSha256':hashlib.sha256(raw).hexdigest(),'completeText':raw.decode(),'publication':item,'verifiedFiles':verified,'runtimeViewMatches':runtime_matches,'selectionText':metadata,'selection':json.loads(metadata) if metadata else None})
 state=c.execute('SELECT state FROM runs WHERE run_id=?',(m['run_id'],)).fetchone()
 manifest=(r/'manifest.json').read_bytes() if (r/'manifest.json').exists() else None
 marker=r/'approved-registration-loaded.json'
 plans.append({'planId':plan_id,'requestId':request_id,'idempotencyKey':key,'request':json.loads(request_json),'manifest':m,'manifestText':manifest.decode() if manifest else None,'manifestSha256':hashlib.sha256(manifest).hexdigest() if manifest else None,'state':state[0] if state else None,'publications':publications,'registrationExecution':json.loads(marker.read_bytes()) if marker.exists() else None})
print(json.dumps({'plans':plans,'controls':[list(r) for r in c.execute('SELECT plan_id,submission_requested,cancellation_requested FROM plan_control ORDER BY plan_id')]}))`;
const inspect = async () =>
  JSON.parse(
    await boundedCommand(python, ['-c', inspectScript, root], { cwd: repo, env, timeout: 15000 }),
  );
const poll = async (accept, description) => {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const data = await inspect();
    assert(
      !data.plans.some((plan) => ['failed', 'cancelled'].includes(plan.state)),
      'Actual runtime failed',
    );
    if (accept(data)) return data;
    await delay(100);
  }
  throw Error(description);
};
try {
  const deadline = Date.now() + 45000;
  while (
    (!stdout.includes('Browser: ') || !stdout.includes('Fixture: {')) &&
    Date.now() < deadline
  ) {
    assert(fixture.exitCode === null, `Fixture startup failed: ${stderr}`);
    await delay(50);
  }
  const url = stdout.match(/Browser: (http:\/\/\S+)/)?.[1];
  assert(url, 'Fixture startup timeout');
  secret = new URL(url).searchParams.get('bootstrap');
  origin = new URL(url).origin;
  const fixtureInfo = JSON.parse(
    stdout
      .split('\n')
      .find((line) => line.startsWith('Fixture: {'))
      .slice('Fixture: '.length),
  );
  record.fixture = fixtureInfo;
  record.assetManifestSha256 = createHash('sha256')
    .update(await readFile(join(repo, 'src/wavedl_daemon/web_assets/.wavedl-assets.json')))
    .digest('hex');
  opened = true;
  await cli('open', url);
  const inventory = JSON.parse(await cli('--json', 'tab', 'list'));
  const owned = inventory.data?.tabs?.find(
    (tab) => tab.active && new URL(tab.url).origin === new URL(url).origin,
  );
  assert(owned?.tabId, 'Owned bootstrap tab required');
  await cli('tab', owned.tabId);
  await cli('set', 'viewport', '1280', '900');
  await cli('wait', '--text', 'Connected');
  record.browserRuntime = await dom(
    'JSON.stringify({userAgent:navigator.userAgent,width:innerWidth,height:innerHeight})',
  );
  record.browserSession = session;
  record.freshStorage = await dom(
    'JSON.stringify({local:Object.keys(localStorage),session:Object.keys(sessionStorage),cookies:document.cookie})',
  );
  assert.deepEqual(record.freshStorage, { local: [], session: [], cookies: '' });
  check(!(await cli('get', 'url')).includes('bootstrap'), 'Bootstrap removed from browser URL');
  await actions.button('New training run');
  const configured = await actions.readyControl('field', 'Configured root', false, {
    locator: 'xpath=//*[@role="combobox" and @aria-label="Configured root"]',
  });
  await cli('click', configured);
  await actions.option('datasets');
  await cli('wait', '--text', 'samples.npz');
  await actions.button('Select file samples.npz');
  await actions.button('Next step');
  await cli('wait', '--text', 'Choose CNN');
  await actions.button('Choose CNN');
  await openTrainingEditor({ button: (name) => actions.button(name), cli, dom });
  await actions.fill('Python interpreter', fixtureInfo.python);
  await actions.select('Configured backend', 'slurm');
  await actions.fill('epochs', '1');
  await actions.fill('patience', '1');
  await actions.expandSummary('Data, checkpoints and cross-validation');
  await actions.fill('workers', '0');
  await actions.fill('batch size', '8');
  await actions.select('precision', 'no');
  await actions.expandSummary('Advanced: explicit storage mappings');
  await actions.button('Add mapping');
  await actions.fill('Host root', fixtureInfo.host);
  await actions.fill('Execution root', fixtureInfo.compute);
  await actions.expandSummary('Custom models and physical constraints');
  await actions.fill('import modules', fixtureInfo.registration);
  check(
    (await inspect()).plans.length === 0,
    'Native public authoring creates no durable plan before preview',
  );
  // Validation/inspection settles asynchronously after the final native edit.
  // Wait only for the public enabled action; an actual invalid draft still
  // times out and retains its failure evidence instead of being submitted.
  await cli(
    'wait',
    '--fn',
    "Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()==='Preview persisted plan' && !button.disabled)",
  );
  await actions.button('Preview persisted plan');
  await cli('wait', '--text', 'Persisted plan for approval');
  const approved = JSON.parse(
    await dom(
      `JSON.stringify(document.querySelector('[aria-label="Approved normalized manifest"]')?.textContent)`,
    ),
  );
  check(
    approved.resolved_config.data_path === join(fixtureInfo.compute, 'samples.npz') &&
      approved.resolved_config.import_modules[0] === join(fixtureInfo.compute, 'registration.py'),
    'Public approval maps data and registration exactly once',
  );
  record.approvedTraining = approved;
  await actions.button('Approve and start this plan');
  await cli('wait', '--text', 'Run detail');
  if (trainingFault) {
    const settled = async () => {
      try {
        const observations = (await readFile(join(root, '.run-observations.jsonl'), 'utf8'))
          .trim().split('\n').map((line) => JSON.parse(line));
        const latest = observations.at(-1);
        return latest && (trainingFault === 'failed'
          ? latest.state === 'failed'
          : latest.uncertainty === true) ? latest : null;
      } catch { return null; }
    };
    const faultDeadline = Date.now() + 120000;
    let observedRun;
    while (Date.now() < faultDeadline) {
      observedRun = await settled();
      if (observedRun && stdout.includes('Batch: ') &&
          (trainingFault === 'failed' || stdout.includes('Fault: scheduler-read-unavailable')))
        break;
      await delay(100);
    }
    assert(observedRun, 'Genuine public run GET must observe the settled fault');
    const observationStarted = Date.now();
    const samples = [];
    while (Date.now() - observationStarted < 6500) {
      const durable = await inspect();
      assert.equal(durable.plans.length, 1, 'No late automatic plot plan');
      samples.push({ elapsedMs: Date.now() - observationStarted, planCount: durable.plans.length });
      await delay(250);
    }
    const negative = await dom(
      `JSON.stringify({text:document.body.innerText, retry:Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()==='Retry automatic plots'), plans:${JSON.stringify(await inspect())}})`,
    );
    const snapshotText = await cli('get', 'text', 'body');
    check(
      negative.plans.plans.length === 1 &&
        negative.plans.plans[0].manifest.operation === 'train' &&
        !negative.plans.plans.some((plan) => plan.manifest.operation === 'plot'),
      `No automatic plot plan persisted for ${trainingFault} training state`,
    );
    check(
      !negative.retry && !snapshotText.includes('Retry automatic plots'),
      `Public run detail offers no automatic plot retry for ${trainingFault} training state`,
    );
    check(trainingFault === 'failed' ? observedRun.state === 'failed' : observedRun.uncertainty,
      'Genuine public run state retains the injected failure or uncertainty');
    record.negative = {
      trainingFault,
      observedRun,
      samples,
      observationMs: Date.now() - observationStarted,
      approvedTraining: record.approvedTraining,
      publicText: snapshotText,
      plans: negative.plans,
      automaticPlotPlanCount: negative.plans.plans.filter(
        (plan) => plan.manifest.operation === 'plot',
      ).length,
      retryVisible: negative.retry,
    };
    record.assetsAfter = await currentMappedAssets();
    record.status = 'passed';
  } else {
  await cli('wait', '--text', 'Retry automatic plots');
  check(
    stdout.includes('Fault: plot-submit-ack-dropped'),
    'Genuine accepted automatic plot acknowledgment was lost',
  );
  const beforeRetry = await poll(
    (data) => data.plans.length === 2 && data.plans.every((plan) => plan.state === 'completed'),
    'Both actual mapped runtimes complete before retry',
  );
  record.beforeRetry = beforeRetry;
  await actions.button('Retry automatic plots');
  await cli('wait', '--text', 'Monitor plot run');
  const afterRetry = await inspect();
  check(
    JSON.stringify(afterRetry) === JSON.stringify(beforeRetry),
    'Public automatic retry reuses identical two durable plans/publications',
  );
  const training = afterRetry.plans.find((plan) => plan.manifest.operation === 'train'),
    plot = afterRetry.plans.find((plan) => plan.manifest.operation === 'plot');
  assert(training && plot);
  const pin = plot.manifest.checkpoint_source;
  const source = training.publications.find((item) => item.generation === pin.generation);
  check(
    pin.run_id === training.manifest.run_id &&
      pin.manifest_sha256 === training.manifestSha256 &&
      pin.complete_sha256 === source.completeSha256,
    'Automatic plot pins exact runtime source manifest and COMPLETE publication',
  );
  check(
    JSON.stringify(plot.manifest.resolved_config.import_modules) ===
      JSON.stringify(training.manifest.resolved_config.import_modules) &&
      plot.manifest.resolved_config.checkpoint ===
        join(fixtureInfo.compute, 'runs', training.manifest.run_id, 'checkpoints', pin.generation),
    'Automatic derived runtime preserves approved imports and mapped source generation',
  );
  await actions.button('Monitor plot run');
  await actions.button('Results');
  await actions.button('Refresh artifacts');
  await cli('wait', '--text', 'View PNG');
  const publication = plot.publications.find((item) =>
    Object.hasOwn(item.publication.files, 'scatter_all.png'),
  );
  assert(publication);
  record.selectedArtifact = {
    runId: plot.manifest.run_id,
    generation: publication.generation,
    path: 'scatter_all.png',
    ...publication.publication.files['scatter_all.png'],
  };
  const artifactRow = `//tr[td[normalize-space(.)='${publication.generation} / ${publication.publication.attempt}']][td[normalize-space(.)='scatter_all.png']]`;
  await actions.button('View PNG', false, {
    locator: `xpath=${artifactRow}//button[normalize-space(.)='View PNG']`,
  });
  await cli(
    'wait',
    '--fn',
    'Array.from(document.querySelectorAll("img")).some(image=>image.getClientRects().length && image.complete && image.naturalWidth>0 && image.src.startsWith("blob:"))',
  );
  await cli('scrollintoview', 'img[alt="Verified published diagnostic plot"]');
  await cli(
    'wait',
    '--fn',
    '(()=>{const image=document.querySelector(\'img[alt="Verified published diagnostic plot"]\');if(!image)return false;const r=image.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth})()',
  );
  const pngPath = join(
    plot.manifest.run_directory,
    'checkpoints',
    publication.generation,
    'scatter_all.png',
  );
  record.decodedPublication = JSON.parse(
    await boundedCommand(
      python,
      [
        '-c',
        "import hashlib,io,json,sys\nfrom pathlib import Path\nfrom PIL import Image\np=Path(sys.argv[1]); raw=p.read_bytes()\nif len(raw)>16777216: raise ValueError('PNG budget')\nwith Image.open(io.BytesIO(raw)) as image:\n width,height=image.size\n if not 1<=width<=8192 or not 1<=height<=8192 or width*height>16777216: raise ValueError('Raster budget')\n image.load(); pixels=image.convert('RGBA')\n print(json.dumps({'width':width,'height':height,'pixelFormat':'RGBA','rgbaSha256':hashlib.sha256(pixels.tobytes()).hexdigest(),'sourceSize':len(raw),'sourceSha256':hashlib.sha256(raw).hexdigest()}))",
        pngPath,
      ],
      { cwd: repo, env, timeout: 15000 },
    ),
  );
  record.raster = await dom(`(async()=>{
    const images=Array.from(document.querySelectorAll('img')).filter(image=>image.getClientRects().length && image.complete && image.naturalWidth>0 && image.src.startsWith('blob:') && image.alt==='Verified published diagnostic plot');
    const results=[];
    for(const image of images){const width=image.naturalWidth,height=image.naturalHeight;if(width>8192||height>8192||width*height>16777216)throw Error('Raster budget');const rect=image.getBoundingClientRect();if(!(rect.bottom>0&&rect.top<innerHeight&&rect.right>0&&rect.left<innerWidth))throw Error('Raster outside viewport');const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');if(!context)throw Error('Raster unavailable');context.drawImage(image,0,0);const pixels=context.getImageData(0,0,width,height).data;const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pixels))).map(value=>value.toString(16).padStart(2,'0')).join('');results.push({width,height,alt:image.alt,pixelFormat:'RGBA',rgbaSha256:digest,viewportIntersection:true});}
    return JSON.stringify(results);
  })()`);
  assert.equal(record.raster.length, 1);
  const { alt, viewportIntersection, ...decodedRaster } = record.raster[0];
  assert.equal(alt, 'Verified published diagnostic plot');
  assert.equal(viewportIntersection, true);
  const { sourceSize, sourceSha256, ...publicationPixels } = record.decodedPublication;
  assert.equal(sourceSize, record.selectedArtifact.size);
  assert.equal(sourceSha256, record.selectedArtifact.sha256);
  assert.deepEqual(
    decodedRaster,
    publicationPixels,
    'Displayed pixels must match the independently decoded selected PNG',
  );
  check(
    record.raster.length > 0,
    'Browser displays a verified genuine runtime PNG with nonzero raster dimensions',
  );
  record.durable = afterRetry;
  record.boundary = (await readFile(join(root, '.boundary.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  record.batchResults = stdout
    .split('\n')
    .filter((line) => line.startsWith('Batch: '))
    .map((line) => JSON.parse(line.slice(7)));
  check(
    record.batchResults.length === 2 &&
      record.batchResults.every(
        (item) =>
          item.returncode === 0 &&
          !item.timedOut &&
          !item.cancelled &&
          item.copiedRuntimePublication,
      ),
    'Exactly two successful actual supervised CPU batch scripts with explicit copy visibility',
  );
  await cli('screenshot', join(workspace, 'mapped-raster.png'));
  const screenshot = await readFile(join(workspace, 'mapped-raster.png'));
  assert(
    screenshot.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      screenshot.length < 4 * 1024 * 1024,
  );
  await writeFile(join(destination, 'mapped-raster.png'), screenshot, { mode: 0o600, flag: 'wx' });
  record.screenshot = {
    name: 'mapped-raster.png',
    size: screenshot.length,
    sha256: hash(screenshot),
  };
  record.assetsAfter = await currentMappedAssets();
  assert.deepEqual(record.assetsAfter, record.assetsBefore);
  record.status = 'passed';
  }
} catch (error) {
  record.status = 'failed';
  record.error = String(error)
    .split(secret || '\0')
    .join('[REDACTED]');
  record.fixtureFailure = stderr;
  if (opened)
    try {
      record.failureSnapshot = await snapshot();
    } catch {}
} finally {
  if (opened)
    try {
      await cli('close');
    } catch (error) {
      record.cleanup.errors.push(String(error));
    }
  fixture.kill('SIGINT');
  const deadline = Date.now() + 15000;
  while (!closed && Date.now() < deadline) await delay(50);
  if (!closed) {
    fixture.kill('SIGKILL');
    record.cleanup.errors.push('Fixture graceful shutdown timeout');
  }
  if (!stdout.includes('Fixture: services-closed'))
    record.cleanup.errors.push('Fixture service/process cleanup unproven');
  record.cleanup.servicesClosed = stdout.includes('Fixture: services-closed');
  record.cleanup.fixtureExit = { code: fixture.exitCode, signal: fixture.signalCode };
  try {
    record.cleanup.browserSessionAbsent = !(
      await boundedCommand(browser, ['session', 'list'], { cwd: repo, env, timeout: 10000 })
    ).includes(session);
  } catch {
    record.cleanup.errors.push('Browser session absence unproven');
  }
  if (origin) {
    try {
      await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) });
      record.cleanup.errors.push('Fixture listener still accepted request');
    } catch (error) {
      if (error?.cause?.code === 'ECONNREFUSED' || error?.code === 'ECONNREFUSED')
        record.cleanup.listenerRefused = true;
      else
        record.cleanup.errors.push(
          `Fixture listener refusal unproven: ${error?.name ?? 'unknown'}`,
        );
    }
  }
  if (record.status === 'passed' && record.cleanup.errors.length === 0) {
    const info = await lstat(workspace);
    assert(
      info.isDirectory() &&
        !info.isSymbolicLink() &&
        basename(workspace).startsWith('wavedl-browser-mapped-'),
    );
    await rm(workspace, { recursive: true });
    record.cleanup.removedOwnedRoots = true;
    record.cleanup.browserProfileRemoved = true;
  }
  if (stderr && record.status !== 'passed')
    record.fixtureFailure = stderr.split(secret || '\0').join('[REDACTED]');
  if (record.cleanup.errors.length) record.status = 'failed';
  const serialized = JSON.stringify(record, null, 2);
  assert(!secret || !serialized.includes(secret), 'Bootstrap leaked into report');
  await writeFile(join(destination, 'mapped-autoplot.json'), serialized, {
    mode: 0o600,
    flag: 'wx',
  });
  if (record.status === 'passed') {
    const reportPath = join(destination, 'mapped-autoplot.json');
    if (trainingFault) {
      verifyMappedAutoplotNegativeReport(record, trainingFault);
      assert.deepEqual(record.assetsAfter, record.assetsBefore);
    } else await verifyMappedAutoplotFile(reportPath);
  }
  console.log(`Mapped browser evidence: ${join(destination, 'mapped-autoplot.json')}`);
}
if (record.status !== 'passed') process.exitCode = 1;
