// Native Chrome filename/byte proof from two real, immutable publications.
// The caller owns the private browser session and download directory cleanup.
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { open, lstat, readdir, realpath } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { xpathLiteral } from './browser_actions.mjs';

const BYTE_LIMIT = 64 * 1024;
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

async function boundedBytes(path) {
  const info = await lstat(path);
  assert(info.isFile() && !info.isSymbolicLink(), 'Evidence must be an ordinary file');
  assert(info.size <= BYTE_LIMIT, 'Download-name evidence exceeded 64 KiB');
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const opened = await file.stat();
    assert(opened.isFile() && opened.dev === info.dev && opened.ino === info.ino, 'Evidence file identity changed before open');
    assert(opened.size <= BYTE_LIMIT, 'Opened evidence exceeds its byte bound');
    const buffer = Buffer.alloc(BYTE_LIMIT + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    assert(length <= BYTE_LIMIT, 'Evidence grew beyond its byte bound');
    const final = await file.stat();
    assert(final.size === length && final.mtimeMs === opened.mtimeMs, 'Evidence changed during bounded read');
    return buffer.subarray(0, length);
  } finally {
    await file.close();
  }
}

// Lifecycle observations may continue to settle without any new intent.
function intentSnapshot(state) {
  return { plans: state.plans, control: state.control,
    executionPlans: state.executions.map((item) => item.plan_id).sort() };
}

/**
 * Run after real CPU completion, with the approved training run selected.
 * Caller must settle automatic-plot plan creation before this read-only case.
 */
export async function downloadNameProvenance(driver) {
  const { cli, dom, snapshot, actions, button, registry,
    root, downloads, record, check, python, command } = driver;
  const runId = JSON.parse(record.approvedPlan).run_id;
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(runId), 'Approved run UUID missing');
  const before = await registry(root);
  assert(before.runs.some((run) => run.run_id === runId && run.state === 'completed'), 'Filename proof requires a genuinely completed producer run');

  const directory = await lstat(downloads);
  assert(directory.isDirectory() && !directory.isSymbolicLink(), 'Download directory must be caller-owned and ordinary');
  if (process.platform !== 'win32') assert((directory.mode & 0o077) === 0, 'Native downloads must remain in a private directory');
  if (typeof process.getuid === 'function') assert(directory.uid === process.getuid(), 'Native downloads must remain in an owned directory');
  assert(dirname(resolve(downloads)) === dirname(resolve(root)), 'Download evidence must share the caller private fixture workspace');
  const workspace = await lstat(await realpath(dirname(downloads)));
  assert(workspace.isDirectory(), 'Caller workspace must be an ordinary directory');
  if (process.platform !== 'win32') assert((workspace.mode & 0o077) === 0, 'Caller workspace must be private');
  if (typeof process.getuid === 'function') assert(workspace.uid === process.getuid(), 'Caller workspace must be owned');
  assert(await realpath(downloads) === join(await realpath(dirname(downloads)), basename(downloads)), 'Download directory must resolve inside the caller workspace');
  assert((await readdir(downloads)).length === 0, 'Native filename case requires an empty private download directory');

  await actions.button('Results', false, { locator: '[data-testid="nav-results"]' });
  await button('Refresh artifacts');
  await cli('wait', '--text', 'Download');
  const basenameWanted = 'checkpoint_selection.json';
  const rowsExpression = `Array.from(document.querySelector('#results-title').closest('section').querySelectorAll('[data-artifact-path]')).filter(row => row.getAttribute('data-artifact-path') === ${JSON.stringify(basenameWanted)})`;
  const rows = await dom(`JSON.stringify(${rowsExpression}.map(row => ({ identity: row.getAttribute('data-artifact-generation') + ' / ' + row.getAttribute('data-artifact-attempt'), path: row.getAttribute('data-artifact-path') })))`);
  assert(Array.isArray(rows), 'Published artifact rows unavailable');
  const publications = [];
  for (const row of rows) {
    const match = /^(gen-\d{6,})\s*\/\s*(\d+)$/.exec(row.identity);
    assert(match && row.path === basenameWanted, 'Unexpected publication identity in visible artifact row');
    const generation = match[1];
    const attempt = Number(match[2]);
    const complete = JSON.parse((await boundedBytes(join(root, 'runs', runId, 'checkpoints', generation, 'COMPLETE.json'))).toString('utf8'));
    assert(complete.run_id === runId && complete.generation === generation && complete.attempt === attempt, 'Visible artifact ownership disagrees with real COMPLETE publication');
    const identity = complete.files?.[row.path];
    assert(identity && Number.isSafeInteger(identity.size) && identity.size > 0 && identity.size <= BYTE_LIMIT && /^[0-9a-f]{64}$/.test(identity.sha256), 'Selection metadata lacks bounded immutable byte identity');
    const source = await boundedBytes(join(root, 'runs', runId, 'checkpoints', generation, row.path));
    assert(source.length === identity.size && createHash('sha256').update(source).digest('hex') === identity.sha256, 'Producer source bytes disagree with COMPLETE');
    publications.push({ generation, attempt, path: row.path, identity });
  }
  assert(new Set(publications.map((item) => item.generation)).size >= 2, 'Real producer must publish checkpoint_selection.json in at least two generations; no synthetic fallback');
  const selected = publications.filter((item, index, all) => all.findIndex((other) => other.generation === item.generation) === index).slice(0, 2);
  const expectedNames = selected.map((item) => `${runId}_${item.generation}_${basename(item.path)}`);
  assert(new Set(expectedNames).size === 2, 'Independent publications must have distinct save labels');

  const evidence = [];
  const deadline = Date.now() + 45000;
  for (const [index, publication] of selected.entries()) {
    const filename = expectedNames[index];
    await snapshot();
    const scope = `//section[@aria-labelledby="results-title"]//*[@data-artifact-generation=${xpathLiteral(publication.generation)} and @data-artifact-path=${xpathLiteral(publication.path)}]`;
    const selector = await actions.readyControl('button', 'Download', false, { scope });
    assert(selector, 'Exact independent publication download control missing or disabled');
    await cli('scrollintoview', selector);
    await snapshot();
    // Do not use CLI download <path>: Chrome must choose the app anchor label.
    await cli('click', selector);
    let stable = null;
    let previous = null;
    while (Date.now() < deadline) {
      const names = await readdir(downloads);
      assert(names.every((name) => expectedNames.includes(name) || expectedNames.some((expected) => name === `${expected}.crdownload`)), 'Unexpected filename in private native-download directory');
      if (names.includes(filename) && !names.includes(`${filename}.crdownload`)) {
        const info = await lstat(join(downloads, filename));
        assert(info.isFile() && !info.isSymbolicLink() && info.size <= BYTE_LIMIT, 'Native download must be a bounded ordinary file');
        const fingerprint = `${info.size}:${info.mtimeMs}`;
        if (previous === fingerprint) {
          const bytes = await boundedBytes(join(downloads, filename));
          stable = { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
          break;
        }
        previous = fingerprint;
      }
      await pause(Math.max(0, Math.min(150, deadline - Date.now())));
    }
    assert(stable && Date.now() < deadline, 'Native downloads did not stabilize within the shared 45-second deadline');
    check(stable.size === publication.identity.size && stable.sha256 === publication.identity.sha256, `Native ${publication.generation} download bytes match real COMPLETE size and SHA-256`);
    evidence.push({ generation: publication.generation, attempt: publication.attempt,
      path: publication.path, filename, ...stable,
      expectedSize: publication.identity.size, expectedSha256: publication.identity.sha256 });
  }
  const saved = (await readdir(downloads)).sort();
  check(JSON.stringify(saved) === JSON.stringify([...expectedNames].sort()), 'Chrome saved two distinct native filenames containing the full approved run UUID, generation and same basename');
  check(JSON.stringify(intentSnapshot(await registry(root))) === JSON.stringify(intentSnapshot(before)), 'Native artifact downloads created no daemon plans, submission/cancellation intents or executions');
  record.nativeDownloadNames = { runId, basename: basenameWanted,
    publicationCount: publications.length, nativeClick: true, readOnlyEvidence: true, downloads: evidence };
  // A controlled immutable publication derives alias members from actual CPU
  // metadata bytes; no response, inventory, browser state or API is fabricated.
  const aliasPublication = JSON.parse(await command(python, ['-c', `import json,sys,tempfile,hashlib
from pathlib import Path
from wavedl.core.layout import RunLayout
from wavedl.core.generations import publish_generation
root=Path(sys.argv[1]); run_id=sys.argv[2]; original=sys.argv[3]; attempt=int(sys.argv[4])
layout=RunLayout(root/'runs'/run_id,run_id)
source=layout.checkpoints/original/'checkpoint_selection.json'
payload=source.read_bytes()
with tempfile.TemporaryDirectory(prefix='alias-source-',dir=root) as temporary:
    staging=Path(temporary)
    paths=['left/metrics.csv','right/metrics.csv','METRICS.csv','a?.csv','a*.csv']
    for name in paths:
        target=staging/name; target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(payload)
    published=publish_generation(layout,staging,attempt=attempt,step=0)
    complete=(published.path/'COMPLETE.json').read_text()
    print(json.dumps({'generation':published.generation,'attempt':attempt,'paths':paths,'sourceGeneration':original,'sourceSize':len(payload),'sourceSha256':hashlib.sha256(payload).hexdigest(),'completeText':complete,'completeSha256':hashlib.sha256(complete.encode()).hexdigest()}))`, root, runId, selected[0].generation, String(selected[0].attempt)]));
  const aliasComplete = JSON.parse(aliasPublication.completeText);
  assert(aliasComplete.run_id === runId && aliasComplete.generation === aliasPublication.generation);
  await button('Refresh artifacts');
  await cli('wait', '--text', 'left/metrics.csv');
  const aliasEvidence = [];
  for (const path of aliasPublication.paths) {
    const basename = path.split('/').at(-1).replace(/[?*]/g, '_');
    const extension = '.csv';
    const stem = basename.slice(0, -extension.length);
    const filename = `${runId}_${aliasPublication.generation}_${stem}_${createHash('sha256').update(path).digest('hex').slice(0, 24)}${extension}`;
    const identity = aliasComplete.files[path];
    const source = await boundedBytes(join(root, 'runs', runId, 'checkpoints', aliasPublication.generation, path));
    assert(source.length === identity.size && createHash('sha256').update(source).digest('hex') === identity.sha256);
    await snapshot();
    const scope = `//section[@aria-labelledby="results-title"]//*[@data-artifact-generation=${xpathLiteral(aliasPublication.generation)} and @data-artifact-path=${xpathLiteral(path)}]`;
    const selector = await actions.readyControl('button', 'Download', false, { scope });
    assert(selector, 'Alias download row must be a real enabled public control');
    await cli('scrollintoview', selector);
    await snapshot();
    await cli('click', selector);
    const deadline = Date.now() + 15000;
    let downloaded;
    while (Date.now() < deadline) {
      if ((await readdir(downloads)).includes(filename)) {
        const bytes = await boundedBytes(join(downloads, filename));
        if (bytes.length === identity.size) { downloaded = bytes; break; }
      }
      await pause(100);
    }
    assert(downloaded && createHash('sha256').update(downloaded).digest('hex') === identity.sha256, 'Native alias bytes must match immutable CPU-derived publication');
    aliasEvidence.push({ path, filename, size: downloaded.length, sha256: identity.sha256 });
  }
  assert(new Set(aliasEvidence.map((item) => item.filename.toLowerCase())).size === aliasEvidence.length);
  assert.deepEqual((await readdir(downloads)).sort(), [...expectedNames, ...aliasEvidence.map((item) => item.filename)].sort());
  assert.equal(await boundedBytes(join(root, 'runs', runId, 'checkpoints', aliasPublication.generation, 'COMPLETE.json')).then((bytes) => createHash('sha256').update(bytes).digest('hex')), aliasPublication.completeSha256);
  assert.deepEqual(intentSnapshot(await registry(root)), intentSnapshot(before));
  check(true, 'Five same-generation nested, case-insensitive and sanitized aliases save distinct native filenames with exact immutable bytes and unchanged intents');
  record.nativeAliasDownloads = { ...aliasPublication, runId, fixturePublication: true, nativeClick: true, downloads: aliasEvidence };
  return record.nativeDownloadNames;
}
