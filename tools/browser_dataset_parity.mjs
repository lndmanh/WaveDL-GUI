// Genuine bounded dataset UI acceptance. Observes public DOM/canvas and reads
// caller-owned fixture/download bytes; never injects app state or mocks APIs.
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { open, lstat, writeFile, readdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { actionableExpression, controlExpression, createBrowserActions, exposureExpression, xpathLiteral } from './browser_actions.mjs';

const views = ['Input distribution', 'Output distribution', 'Samples', 'Correlation', 'Statistics', 'Scatter'];
const preview = `document.querySelector('section[aria-label="Dataset visualization"]')`;
const header = `document.querySelector('section[aria-label="Dataset header summary"]')`;

export function datasetExportScope(view) {
  assert(views.includes(view), 'Unknown dataset export view');
  const panel = 'section[aria-label="Dataset visualization"] [role="tabpanel"]';
  if (view === 'Samples') return `${panel} > div.flex.flex-col.gap-5 > div:first-child > figure`;
  if (view === 'Correlation') return `${panel} > figure`;
  if (view === 'Statistics') return `${panel} > .statistics-plots > figure:first-child`;
  return `${panel} .preview-grid > figure:first-child`;
}

export function datasetExportReference(tree) {
  assert(typeof tree === 'string' && tree.length <= 128 * 1024, 'Invalid scoped dataset snapshot');
  const lines = tree.split('\n').filter(line=>/\bbutton "Export PNG"/.test(line));
  assert(lines.length > 0 && lines.every(line=>/^\s*- button "Export PNG" \[ref=e[1-9]\d*\]\s*$/.test(line)), 'Scoped dataset snapshot contains missing or foreign export controls');
  // Some native snapshots repeat the same literal AX ref. Only identical refs
  // are deduplicated; two different refs are never interchangeable authority.
  const refs = [...new Set(lines.map(line=>line.match(/\[ref=(e[1-9]\d*)\]/)[1]))];
  assert(refs.length === 1, 'Scoped dataset snapshot contains distinct ambiguous export refs');
  return `@${refs[0]}`;
}

export async function readyDatasetExportReference({ cli, dom, actions, view }) {
  const scope = '(//section[@aria-label="Dataset visualization"]//figure)[1]';
  const locator = await actions.readyControl('button', 'Export PNG', false, { scope });
  const cssScope = datasetExportScope(view);
  const tree = await cli('snapshot', '-i', '-s', cssScope);
  const reference = datasetExportReference(tree);
  assert((await cli('get', 'text', reference)).trim() === 'Export PNG', 'Scoped dataset export ref has stale or foreign native text');
  const expression = `JSON.stringify((()=>{
    const roots = Array.from(document.querySelectorAll(${JSON.stringify(cssScope)}));
    const first = document.evaluate(${JSON.stringify(scope)},document,null,XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue;
    const targets = ${controlExpression('button', 'Export PNG', { locator })};
    if (roots.length !== 1 || roots[0] !== first || !roots[0].isConnected || targets.length !== 1 || !roots[0].contains(targets[0])) return false;
    const buttons = Array.from(roots[0].querySelectorAll('button')).filter(element=>element.getAttribute('aria-label') === 'Export PNG' || element.textContent.trim() === 'Export PNG');
    if (buttons.length !== 1 || buttons[0] !== targets[0] || targets[0].textContent.trim() !== 'Export PNG') return false;
    return ${exposureExpression('button', 'Export PNG', { locator })};
  })())`;
  const valid = value=>value && typeof value === 'object' && ['x','y','width','height','viewportWidth','viewportHeight'].every(key=>Number.isFinite(value[key])) && value.width>0 && value.height>0 && value.viewportWidth>0 && value.viewportHeight>0;
  // Both independent observations occur after scoped snapshot AND native text.
  const before = await dom(expression);
  assert(valid(before), 'Dataset export failed first scoped exposure observation');
  const after = await dom(expression);
  assert(valid(after), 'Dataset export failed second scoped exposure observation');
  assert.deepEqual(after, before, 'Dataset export changed between scoped exposure observations');
  return { reference, cssScope, locator, exposure: after, nativeText: 'Export PNG' };
}

export function nativeDragPoints(rect, viewport) {
  const points = [.2, .8].map(fraction=>({ x: Math.round(rect.x + rect.width * fraction), y: Math.round(rect.y + rect.height * fraction) }));
  assert(rect.width > 0 && rect.height > 0 && points.every(point=>Number.isSafeInteger(point.x)&&Number.isSafeInteger(point.y)&&point.x>=0&&point.y>=0&&point.x<viewport.width&&point.y<viewport.height), 'Native sample drag requires finite integer points inside the viewport');
  assert(points[0].x !== points[1].x && points[0].y !== points[1].y, 'Native sample drag requires a nonzero rectangular selection');
  return points;
}

export function parseNativePngName(name) {
  const match = /^(dataset-preview|dataset-heatmap)(?: \(([1-9]\d{0,5})\))?\.png$/.exec(name);
  assert(match, 'Unexpected native dataset PNG filename');
  return { kind: match[1], ordinal: match[2] ? Number(match[2]) : 0 };
}

export function redactNativeTabs(inventory, expectedOrigin) {
  assert(inventory.success && Array.isArray(inventory.data?.tabs) && inventory.data.tabs.length <= 32, 'Native tab diagnostic inventory is invalid or exceeds its bound');
  return inventory.data.tabs.map(tab=> {
    assert(/^t[1-9]\d*$/.test(tab.tabId), 'Native tab diagnostic requires a stable public tab ID');
    let sameExpectedOrigin = false;
    try { sameExpectedOrigin = new URL(tab.url).origin === expectedOrigin; } catch { /* Foreign malformed URLs remain redacted. */ }
    return { tabId: tab.tabId, active: tab.active === true, sameExpectedOrigin, chromeDownloadsUri: /^chrome:\/\/downloads\/?(?:[?#].*)?$/.test(tab.url ?? '') ? 'chrome://downloads/' : null };
  });
}

export function diagnosticFileSignature(bytes) {
  assert(bytes.length <= 8 * 1024 * 1024, 'Unexpected completed file diagnostic exceeds its byte bound');
  const text = bytes.toString('utf8');
  return { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), pngMagic: bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])), htmlSignature: /<!doctype\s+html|<html(?:\s|>)/i.test(text.slice(0,1024)), chromeDownloadsMarker: /downloads-manager|chrome:\/\/downloads|chrome-downloads/i.test(text), titleIsDownloads: /<title>\s*Downloads\s*<\/title>/i.test(text), datasetVisualizationMarker: /Dataset visualization|dataset-preview/i.test(text) };
}

export async function unexpectedFilePrefix(path) {
  const info = await lstat(path);
  assert(info.isFile() && !info.isSymbolicLink(), 'Unexpected-file prefix requires an ordinary nonsymlink file');
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const opened = await file.stat();
    assert(opened.isFile() && opened.dev === info.dev && opened.ino === info.ino, 'Unexpected-file identity changed before prefix read');
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const prefix = buffer.subarray(0,bytesRead), text = prefix.toString('utf8');
    return { size: opened.size, prefixLength: bytesRead, prefixSha256: createHash('sha256').update(prefix).digest('hex'), pngMagic: prefix.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])), htmlSignature: /<!doctype\s+html|<html(?:\s|>)/i.test(text), chromeDownloadsMarker: /downloads-manager|chrome:\/\/downloads|chrome-downloads/i.test(text), worldDatasetMarker: /WorldDataset|World\s+Dataset/i.test(text) };
  } finally { await file.close(); }
}

export async function directoryCheckpoint(downloads, label, expected = [], record, boundary) {
  const names = await readdir(downloads);
  assert(names.length <= 128 && names.every(name=>name.length<=256), 'Download directory checkpoint exceeds basename bounds');
  const entries = await Promise.all(names.map(async name=> {
    try {
      const path = join(downloads,name), info = await lstat(path);
      const entry = { name, size: info.size, isFile: info.isFile(), isDirectory: info.isDirectory(), isSymbolicLink: info.isSymbolicLink() };
      if (!expected.includes(name) && info.isFile() && !info.isSymbolicLink()) entry.prefix = await unexpectedFilePrefix(path);
      return entry;
    } catch (error) { return { name, observationError: error.code ?? error.message }; }
  }));
  const checkpoint = { label, at: new Date().toISOString(), expected: [...expected], entries, ...(boundary ? { boundary } : {}) };
  (record.datasetDownloadDirectoryCheckpoints ??= []).push(checkpoint);
  record.datasetDownloadDirectoryCheckpoint = checkpoint;
  assert(names.every(name=>expected.includes(name)), `Unexpected pre-export download at ${label}; attribution diagnostic recorded`);
  return checkpoint;
}

// Observe commands already required by acceptance; do not insert a browser
// probe, snapshot or wait. A failed directory check prevents the next command.
export function datasetCommandBoundaries({ checkpoint, stage, file, view, limit = 24 }) {
  assert(Number.isSafeInteger(limit) && limit > 0 && limit <= 40, 'Dataset command boundary count must be bounded');
  let started = 0, sequence = 0;
  return async (operation, run) => {
    assert(/^[a-z][a-z-]{0,63}$/.test(operation), 'Dataset boundary operation must be a static public label');
    assert(started++ < limit, 'Dataset command boundary observation exceeds its bound');
    const detail = { file, view, operation };
    stage('dataset-command-boundary-before', detail);
    const result = await run();
    const boundary = { ...detail, sequence: ++sequence };
    stage('dataset-command-boundary-complete', boundary);
    await checkpoint(`after-first-dataset-${operation}:${boundary.sequence}`, boundary);
    return result;
  };
}

export async function completedNativePng({ downloads, before, kind, evidenceFilename, timeout = 30000, diagnose }) {
  assert(/^dataset-[a-z0-9.-]+\.png$/.test(evidenceFilename) && !before.includes(evidenceFilename), 'Evidence rename target must be a new scoped dataset PNG');
  assert(['dataset-preview', 'dataset-heatmap'].includes(kind), 'Unknown dataset PNG export kind');
  const baseline = new Set(before), deadline = Date.now() + timeout;
  let previous;
  do {
    const added = (await readdir(downloads)).filter(name=>!baseline.has(name));
    const completed = added.filter(name=>!name.endsWith('.crdownload'));
    if (diagnose) {
      assert(added.length <= 64 && before.length <= 128 && [...added, ...before].every(name=>name.length <= 256), 'Native PNG directory diagnostic exceeds basename bounds');
      const entries = await Promise.all(added.map(async name=> {
        try {
          const info = await lstat(join(downloads, name));
          const entry = { name, size: info.size, isFile: info.isFile(), isDirectory: info.isDirectory(), isSymbolicLink: info.isSymbolicLink(), dev: info.dev, ino: info.ino, mtimeMs: info.mtimeMs };
          if (completed.includes(name) && !/^(dataset-preview|dataset-heatmap)(?: \([1-9]\d{0,5}\))?\.png$/.test(name) && info.isFile() && !info.isSymbolicLink()) entry.prefix = await unexpectedFilePrefix(join(downloads,name));
          return entry;
        } catch (error) { return { name, observationError: error.code ?? 'unknown' }; }
      }));
      diagnose({ at: new Date().toISOString(), before: [...before], added, completed, entries });
    }
    assert(completed.length <= 1, 'Native export produced multiple unexpected completed files');
    if (completed.length) {
      const nativeFilename = completed[0];
      assert(parseNativePngName(nativeFilename).kind === kind, 'Native PNG filename does not match the actual chart export kind');
      const path = join(downloads, nativeFilename), info = await lstat(path);
      assert(info.isFile() && !info.isSymbolicLink() && info.size <= 8 * 1024 * 1024, 'Native PNG must be ordinary, bounded and nonsymlink');
      const fingerprint = `${nativeFilename}:${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`;
      if (!added.some(name=>name.endsWith('.crdownload')) && previous === fingerprint) {
        const proof = pngEvidence(await downloadedBytes(path));
        assert(Date.now() < deadline, 'Native PNG byte verification exceeded its completion deadline');
        await rename(path, join(downloads, evidenceFilename));
        return { filename: evidenceFilename, nativeFilename, nativeClick: true, targetOverridden: false, renamedForEvidence: true, ...proof };
      }
      previous = fingerprint;
    }
    // Filesystem completion polling only; never substitutes for UI readiness.
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise(resolve=>setTimeout(resolve, Math.min(150, remaining)));
  } while (Date.now() < deadline);
  throw new Error('Native dataset PNG did not complete within its bounded deadline');
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function downloadedBytes(path) {
  const limit = 8 * 1024 * 1024;
  const info = await lstat(path);
  assert(info.isFile() && !info.isSymbolicLink() && info.size <= limit, 'PNG evidence must be an ordinary bounded download');
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const initial = await file.stat();
    assert(initial.isFile() && initial.dev === info.dev && initial.ino === info.ino && initial.size <= limit, 'PNG download identity changed before open');
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const final = await file.stat();
    assert(length <= limit && length === final.size && initial.mtimeMs === final.mtimeMs, 'PNG download changed or exceeded its byte limit during read');
    return buffer.subarray(0, length);
  } finally { await file.close(); }
}

export function pngEvidence(bytes) {
  assert(bytes.length > 100 && bytes.length <= 8 * 1024 * 1024, 'PNG download must be bounded and nonempty');
  assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Actual download must have a PNG signature');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert(width > 0 && height > 0 && width <= 8192 && height <= 8192, 'Downloaded PNG dimensions must be bounded');
  assert(bytes.readUInt32BE(8) === 13 && bytes.toString('ascii', 12, 16) === 'IHDR' && bytes[24] === 8 && bytes[25] === 6 && bytes[26] === 0 && bytes[27] === 0 && bytes[28] === 0, 'Canvas export must be an ordinary noninterlaced 8-bit RGBA PNG');
  const compressed = [];
  let ended = false, headers = 0;
  for (let offset = 8; offset < bytes.length;) {
    assert(offset + 12 <= bytes.length, 'Truncated PNG chunk');
    const size = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8);
    assert(offset + size + 12 <= bytes.length, 'PNG chunk exceeds file');
    assert(crc32(bytes.subarray(offset + 4, offset + 8 + size)) === bytes.readUInt32BE(offset + 8 + size), 'PNG chunk CRC mismatch');
    if (kind === 'IHDR') headers++;
    assert(headers === 1, 'PNG requires one initial IHDR and no duplicate header');
    if (kind === 'IDAT') compressed.push(bytes.subarray(offset + 8, offset + 8 + size));
    if (kind === 'IEND') {
      assert(size === 0 && offset + 12 === bytes.length, 'PNG IEND must be empty and terminal without trailing bytes');
      ended = true;
    }
    offset += size + 12;
  }
  assert(ended && compressed.length, 'Downloaded PNG must contain image data and end marker');
  const stride = width * 4;
  const decodedLength = (stride + 1) * height;
  assert(decodedLength <= 128 * 1024 * 1024, 'PNG decoded raster exceeds its memory limit');
  const pixels = inflateSync(Buffer.concat(compressed), { maxOutputLength: decodedLength });
  assert(pixels.length === (stride + 1) * height, 'Decoded PNG raster length differs from IHDR');
  let previous = Buffer.alloc(stride), coloredPixels = 0;
  const paeth = (a,b,c) => { const p=a+b-c, x=Math.abs(p-a), y=Math.abs(p-b), z=Math.abs(p-c); return x<=y&&x<=z?a:y<=z?b:c; };
  for (let y = 0; y < height; y++) {
    const filter = pixels[y * (stride + 1)];
    assert(filter <= 4, 'Unsupported PNG scanline filter');
    const row = Buffer.from(pixels.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? row[x - 4] : 0, b = previous[x], c = x >= 4 ? previous[x - 4] : 0;
      row[x] = (row[x] + (filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a,b,c))) & 255;
    }
    for (let x = 0; x < stride; x += 4) if (row[x + 3] && (row[x] !== row[x + 1] || row[x + 1] !== row[x + 2])) coloredPixels++;
    previous = row;
  }
  assert(coloredPixels > 0, 'Actual decoded PNG contains no colored chart raster pixels');
  return { width, height, size: bytes.length, decoded: true, coloredPixels, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export async function datasetParity(driver) {
  const { cli, dom, snapshot, button, actions, downloads, check, record, root, registry, python, command } = driver;
  const stage = (name, detail = {}) => {
    const entry = { name, at: new Date().toISOString(), ...detail };
    record.datasetStage = entry;
    (record.datasetStages ??= []).push(entry);
  };
  stage('registry-before');
  const before = await registry(root);
  const expectedOrigin = await dom('JSON.stringify(location.origin)');
  let allowedDiagnosticFiles = [];
  const checkpoint = (label, boundary)=>directoryCheckpoint(downloads,label,allowedDiagnosticFiles,record,boundary);
  const firstBoundaries = datasetCommandBoundaries({ checkpoint, stage, file: 'samples.npz', view: 'Input distribution' });
  let firstViewCompleted = false;
  const firstObserve = (operation, run)=>firstViewCompleted ? run() : firstBoundaries(operation, run);
  await checkpoint('before-datasets-navigation');
  stage('datasets-navigation-target-description-before');
  record.datasetNavigationTargets = await actions.describe('button', 'Datasets');
  stage('datasets-navigation-target-description-complete');
  stage('datasets-navigation-frame-diagnostic-before');
  record.datasetNavigationFrames = await dom(`(async()=>{
    let framesCompleted=0;
    let timer;
    const frameProbe=new Promise(resolve=>requestAnimationFrame(()=>{framesCompleted++;requestAnimationFrame(()=>{framesCompleted++;resolve('two-frames');});}));
    const outcome=await Promise.race([frameProbe,new Promise(resolve=>{timer=setTimeout(()=>resolve('diagnostic-timeout'),1000);})]);
    clearTimeout(timer);
    return JSON.stringify({outcome,framesCompleted,requestAnimationFrameFunction:Function.prototype.toString.call(requestAnimationFrame).slice(0,120),timelineCurrentTime:document.timeline.currentTime,prerendering:document.prerendering??null,visibilityState:document.visibilityState,focused:document.hasFocus()});
  })()`);
  stage('datasets-navigation-frame-diagnostic-complete', { outcome: record.datasetNavigationFrames.outcome });
  stage('datasets-navigation-direct-actionability-before');
  record.datasetNavigationActionable = await dom(`(async()=>JSON.stringify(await (${actionableExpression('button', 'Datasets')})))()`);
  stage('datasets-navigation-direct-actionability-complete', { actionable: record.datasetNavigationActionable });
  stage('datasets-navigation-before');
  await button('Datasets');
  await checkpoint('after-datasets-navigation');
  stage('datasets-navigation-clicked');
  await cli('wait', '--text', 'Explore daemon datasets');
  stage('datasets-workspace-ready');
  await snapshot();
  await checkpoint('after-configured-root-snapshot');
  stage('configured-root-snapshot');
  let rootSelector = 'xpath=//*[@role="combobox" and @aria-label="Configured root"]';
  stage('configured-root-scroll-before');
  rootSelector = await actions.readyControl('field', 'Configured root', false, { locator: rootSelector });
  await checkpoint('after-configured-root-ready');
  stage('configured-root-scroll-complete');
  stage('configured-root-actionable');
  await cli('click', rootSelector);
  await checkpoint('after-configured-root-focus');
  stage('configured-root-focused');
  await actions.option('datasets');
  await checkpoint('after-configured-root-option-click');
  stage('configured-root-option-clicked');
  stage('configured-root-catalogue-screenshot-before');
  const catalogueScreenshot = join(downloads, 'driver-catalogue.png');
  await cli('screenshot', catalogueScreenshot);
  allowedDiagnosticFiles = ['driver-catalogue.png'];
  await checkpoint('after-configured-root-screenshot');
  record.datasetCatalogueScreenshot = { filename: 'driver-catalogue.png', path: catalogueScreenshot, purpose: 'Native render diagnostic after configured root selection; not a dataset export or acceptance substitute' };
  stage('configured-root-catalogue-screenshot-complete');
  stage('configured-root-networkidle-before');
  await cli('wait', '--load', 'networkidle');
  await checkpoint('after-configured-root-network-idle');
  stage('configured-root-networkidle-complete');
  await cli('wait', '--text', 'samples.npz');
  stage('configured-root-catalogue-ready');

  // Independent numerical expectation from the real bytes, not the daemon's
  // preview implementation. These small owned fixtures fit the default bounds.
  const expectations = JSON.parse(await command(python, ['-c', `
import json,sys,os,stat,hashlib,numpy as np
from pathlib import Path
from scipy.io import loadmat
import h5py
root=Path(sys.argv[1]); results={}
for name in ['samples.npz','samples.mat','samples.h5','samples.hdf5','nonfinite.npz','one-row.npz']:
    path=root/name
    if not path.exists(): continue
    metadata=path.lstat()
    assert stat.S_ISREG(metadata.st_mode) and metadata.st_size<=8*1024*1024
    fd=os.open(path,os.O_RDONLY|os.O_NONBLOCK|getattr(os,'O_NOFOLLOW',0))
    with os.fdopen(fd,'rb') as stream:
        opened=os.fstat(stream.fileno())
        assert stat.S_ISREG(opened.st_mode) and opened.st_size<=8*1024*1024 and (opened.st_dev,opened.st_ino)==(metadata.st_dev,metadata.st_ino)
        if path.suffix=='.npz':
            with np.load(stream,allow_pickle=False) as f: x,y=f['X'].copy(),f['y'].copy()
        elif path.suffix=='.mat':
            f=loadmat(stream); x,y=f['X'],f['y']
        else:
            with h5py.File(stream,'r') as f: x,y=f['X'][:],f['y'][:]
        final=os.fstat(stream.fileno())
        assert (final.st_size,final.st_mtime_ns)==(opened.st_size,opened.st_mtime_ns)
    assert x.shape[0]<=512 and x.reshape(len(x),-1).shape[1]<=40
    a=np.ascontiguousarray(x.reshape(len(x),-1),dtype=np.float64)
    with np.errstate(all='ignore'): means,stds=a.mean(axis=0),a.std(axis=0)
    clean=lambda a:[float(v) if np.isfinite(v) else None for v in a]
    results[name]={'rows':len(x),'inputShape':list(x.shape[1:]),'outputShape':list(y.shape[1:]),'inputDtype':str(x.dtype),'outputDtype':str(y.dtype),'inputSha256':hashlib.sha256(np.ascontiguousarray(x).tobytes()).hexdigest(),'outputSha256':hashlib.sha256(np.ascontiguousarray(y).tobytes()).hexdigest(),'means':clean(means),'stds':clean(stds)}
print(json.dumps(results,allow_nan=False))
`, root]));
  assert(['samples.npz', 'samples.mat', 'samples.h5', 'samples.hdf5', 'one-row.npz', 'nonfinite.npz'].every(name => expectations[name]), 'All four genuine formats and both edge-case fixtures are required');
  const choose = async (name) => {
    stage('dataset-choice-before', { file: name });
    await button(`Select file ${name}`);
    if (!record.datasetFirstChoiceDirectoryChecked) {
      await checkpoint('after-first-dataset-choice');
      record.datasetFirstChoiceDirectoryChecked = true;
    }
    stage('dataset-choice-clicked', { file: name });
    const format = name.split('.').at(-1).toUpperCase();
    const rows = expectations[name].rows;
    await firstObserve('ready-wait', ()=>cli('wait', '--fn', `${header}?.querySelector('dd')?.textContent.trim()===${JSON.stringify(format)}&&Array.from(${header}?.querySelectorAll('dt')??[]).some(e=>e.textContent.trim()==='Samples'&&Number(e.nextElementSibling.textContent)===${rows})&&Array.from(${preview}?.querySelectorAll('p')??[]).some(e=>e.textContent.trim().startsWith(${JSON.stringify(format + ' ·')}))&&Array.from(${preview}?.querySelectorAll('p')??[]).some(e=>e.textContent.includes(${JSON.stringify(`Bounded preview: ${rows} of ${rows} rows.`)}))&&!Array.from(${preview}?.querySelectorAll('[role="status"]')??[]).some(e=>e.textContent.includes('Loading'))`));
    stage('dataset-choice-ready', { file: name });
  };
  const selectView = async (name, missingCorrelation = false) => {
    stage('dataset-view-snapshot-before', { view: name });
    await firstObserve('view-snapshot', ()=>snapshot());
    stage('dataset-view-snapshot-complete', { view: name });
    const tabLocator = `xpath=//section[@aria-label="Dataset visualization"]//*[@role="tab" and normalize-space(.)=${xpathLiteral(name)}]`;
    // The first readiness uses the same action implementation/dependencies,
    // with filesystem-only observations after its otherwise opaque commands.
    // Later 29-view acceptance stays uninstrumented to bound evidence growth.
    const readinessActions = firstViewCompleted ? actions : createBrowserActions({
      snapshot: ()=>firstObserve('ready-control-snapshot', ()=>snapshot()),
      cli: (...args)=>firstObserve(`ready-control-${args[0] === 'scrollintoview' ? 'scroll' : args[0]}`, ()=>cli(...args)),
      dom: (...args)=>firstObserve('ready-control-public-dom', ()=>dom(...args)),
    });
    const locator = await firstObserve('ready-control', ()=>readinessActions.readyControl('button', name, false, { locator: tabLocator }));
    stage('dataset-view-scroll-complete', { view: name });
    stage('dataset-view-actionable', { view: name });
    await firstObserve('view-click', ()=>cli('click', locator));
    stage('dataset-view-clicked', { view: name });
    await firstObserve('view-wait', ()=>cli('wait', '--fn', `Array.from(${preview}.querySelectorAll('[role="tab"]')).some(e=>e.textContent.trim()===${JSON.stringify(name)}&&e.getAttribute('aria-selected')==='true')&&${missingCorrelation ? `${preview}.querySelector('[role="status"]')?.textContent.includes('Correlation requires at least two sampled rows.')` : `${preview}.querySelector('figure canvas')?.width>0`}`));
    stage('dataset-view-ready', { view: name });
  };
  const tableRows = async () => dom(`JSON.stringify(Array.from(${preview}.querySelectorAll('table.statistics tbody tr')).map(row=>Array.from(row.cells).map(cell=>cell.textContent.trim())))`);
  const renderedFigures = async () => dom(`JSON.stringify(Array.from(${preview}.querySelectorAll('figure')).map(f=>({title:f.querySelector('figcaption')?.textContent.trim(),canvases:Array.from(f.querySelectorAll('canvas')).map(c=>{const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let painted=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i])painted++;return {width:c.width,height:c.height,painted};})})))`);
  const verifyStatistics = (rows, expected, description) => {
    check(rows.length === expected.means.length && rows.length <= 40, `${description}: bounded input statistics row count`);
    for (const [index, cells] of rows.entries()) {
      assert(Number(cells[0]) === index, 'Statistics feature order changed');
      for (const [column, values] of [[1, expected.means], [2, expected.stds]]) {
        const wanted = values[index];
        assert(wanted === null ? cells[column] === 'Missing' : Number.isFinite(Number(cells[column])) && Math.abs(Number(cells[column]) - wanted) <= 1e-10 * Math.max(1, Math.abs(wanted)), `${description}: statistics disagree with actual dataset bytes at feature ${index}`);
      }
    }
    check(true, `${description}: visible mean/std values match independently calculated fixture bytes`);
  };
  const formats = [];
  const knownDownloads = new Set([record.datasetCatalogueScreenshot.filename]);
  const interactive = {};
  const canvasRaster = async (timeout = 35000) => {
    const image = await dom(`JSON.stringify((()=>{
    const canvas=${preview}.querySelector('figure canvas');
    if(!canvas||canvas.width<=0||canvas.height<=0||canvas.width*canvas.height*4>8*1024*1024)throw new Error('Public canvas raster exceeds diagnostic bounds');
    const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    const chunks=[];
    for(let offset=0;offset<pixels.length;offset+=32768)chunks.push(String.fromCharCode(...pixels.subarray(offset,offset+32768)));
    return {width:canvas.width,height:canvas.height,rgba:btoa(chunks.join(''))};
  })())`, timeout);
    const pixels = Buffer.from(image.rgba, 'base64');
    assert(pixels.length === image.width * image.height * 4 && pixels.length <= 8 * 1024 * 1024, 'Public canvas RGBA transfer differs from its bounded dimensions');
    return { width: image.width, height: image.height, sha256: createHash('sha256').update(pixels).digest('hex') };
  };
  // Poll actual public raster bytes through separate native controller reads.
  // No frame/timer promise, arbitrary sleep, or private plotting state is used.
  const rasterCheckpoint = async (predicate) => {
    const deadline = Date.now() + 30000;
    let result;
    do {
      const remaining = deadline - Date.now();
      assert(remaining > 0, 'Public raster checkpoint exhausted its wall-clock deadline before observation');
      result = await canvasRaster(remaining);
      if (predicate(result)) {
        assert(Date.now() < deadline, 'Public raster checkpoint observation exceeded its wall-clock deadline');
        break;
      }
    } while (Date.now() < deadline);
    return result;
  };
  const publicGeometry = async () => dom(`JSON.stringify((()=>{
    const figure=${preview}.querySelector('figure');
    const bounds=element=>{const rect=element?.getBoundingClientRect();return rect?{x:rect.x,y:rect.y,width:rect.width,height:rect.height}:null;};
    return {figure:bounds(figure),overlay:bounds(figure.querySelector('.u-over')),canvas:bounds(figure.querySelector('canvas')),viewport:{width:innerWidth,height:innerHeight,scrollX,scrollY},title:figure.querySelector('figcaption')?.textContent.trim()};
  })())`);
  const canvasPng = async () => {
    const data = await dom(`JSON.stringify(${preview}.querySelector('figure canvas').toDataURL('image/png'))`);
    assert(data.startsWith('data:image/png;base64,') && data.length <= 12 * 1024 * 1024, 'Diagnostic public canvas PNG must be bounded');
    return Buffer.from(data.slice('data:image/png;base64,'.length), 'base64');
  };
  const retainResetDiagnostics = async (kind, phases) => {
    const images = [];
    for (const [phase, bytes] of Object.entries(phases)) {
      const filename = `dataset-parity-${kind}-${phase}.png`;
      const path = join(dirname(root), filename);
      const png = pngEvidence(bytes);
      await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
      images.push({ phase, filename, path, ...png });
    }
    return images;
  };
  for (const name of ['samples.npz', 'samples.mat', 'samples.h5', 'samples.hdf5', ...(expectations['one-row.npz'] ? ['one-row.npz'] : [])]) {
    await choose(name);
    const expected = expectations[name];
    const info = await firstObserve('header-public-dom', ()=>dom(`JSON.stringify(Object.fromEntries(Array.from(${header}.querySelectorAll('dt')).map(dt=>[dt.textContent.trim(),dt.nextElementSibling.textContent.trim()])))`));
    check(info.Format === name.split('.').at(-1).toUpperCase() && Number(info.Samples) === expected.rows && info['Input key'] === 'X' && info['Output key'] === 'y' && info['Input shape'] === expected.inputShape.join(' × ') && info['Output shape'] === expected.outputShape.join(' × ') && info['Input dtype'] === expected.inputDtype && info['Output dtype'] === expected.outputDtype && info['File size'] === 'Unknown', `${name}: genuine metadata header matches file shapes, keys and dtypes; unavailable size is honest`);
    const tabNames = await firstObserve('tabs-public-dom', ()=>dom(`JSON.stringify(Array.from(${preview}.querySelectorAll('[role="tab"]')).map(e=>e.textContent.trim()))`));
    check(JSON.stringify(tabNames) === JSON.stringify(views), `${name}: all six dataset views exposed as tabs`);
    const bounds = await firstObserve('bounds-public-dom', ()=>dom(`JSON.stringify(Array.from(${preview}.querySelectorAll('p')).find(e=>e.textContent.includes('Bounded preview:'))?.textContent.trim())`));
    check(bounds.includes(`Bounded preview: ${expected.rows} of ${expected.rows} rows.`) && bounds.includes('not a full-dataset analysis'), `${name}: bounded preview scope is visible`);
    const evidence = [];
    for (const view of views) {
      const missingCorrelation = view === 'Correlation' && expected.rows === 1;
      await selectView(view, missingCorrelation);
      const figures = await firstObserve('figures-public-raster', ()=>renderedFigures());
      firstViewCompleted = true;
      const expectedCount = view === 'Samples' ? Math.min(3, expected.rows) : view === 'Correlation' ? (missingCorrelation ? 0 : 1) : view === 'Statistics' ? 2 : view === 'Output distribution' ? Math.min(8, expected.outputShape.reduce((a,b)=>a*b,1)) : 8;
      check(figures.length === expectedCount && figures.every(f=>f.canvases.some(c=>c.width>0&&c.height>0&&c.painted>0)), `${name}/${view}: bounded real charts contain painted pixels`);
      const statistics = view === 'Statistics' ? await tableRows() : undefined;
      if (statistics) verifyStatistics(statistics, expected, name);
      if (missingCorrelation) {
        const guidance = await dom(`JSON.stringify(${preview}.querySelector('[role="status"]').textContent.trim())`);
        check(guidance === 'Correlation requires at least two sampled rows.', 'One-row dataset renders honest unavailable-correlation guidance without rejecting other views');
        evidence.push({ view, figures, guidance, download: null });
        continue;
      }
      if (name === 'samples.npz' && view === 'Correlation') {
        await snapshot();
        const canvasSelector = 'section[aria-label="Dataset visualization"] canvas[aria-label="Output feature correlation"]';
        await cli('scrollintoview', canvasSelector);
        const baseline = await canvasRaster();
        const baselineGeometry = await publicGeometry();
        const baselinePng = await canvasPng();
        await cli('focus', canvasSelector);
        await cli('press', '+');
        await cli('press', 'ArrowRight');
        const changed = await rasterCheckpoint(image=>image.sha256 !== baseline.sha256);
        const changedGeometry = await publicGeometry();
        const changedPng = await canvasPng();
        await cli('press', '0');
        const restored = await rasterCheckpoint(image=>image.sha256 === baseline.sha256);
        const restoredGeometry = await publicGeometry();
        const restoredPng = await canvasPng();
        record.datasetInteractionProbe ??= {};
        record.datasetInteractionProbe.correlation = { baseline, changed, restored, baselineGeometry, changedGeometry, restoredGeometry };
        if (restored.sha256 !== baseline.sha256) record.datasetInteractionProbe.correlation.diagnosticImages = await retainResetDiagnostics('correlation', { baseline: baselinePng, changed: changedPng, restored: restoredPng });
        check(changed.sha256 !== baseline.sha256, 'Correlation native keyboard zoom/pan changes the actual public canvas raster');
        check(restored.sha256 === baseline.sha256, 'Correlation native keyboard reset restores the original canvas raster');
        interactive.correlation = { file: name, view, baseline, changed, restored, zoomAndPanChanged: true, resetRestored: true, actions: ['focus', '+', 'ArrowRight', '0'] };
      }
      if (name === 'samples.npz' && view === 'Samples') {
        await snapshot();
        const overlay = 'xpath=(//section[@aria-label="Dataset visualization"]//figure)[1]//*[contains(concat(" ",normalize-space(@class)," ")," u-over ")]';
        await cli('scrollintoview', overlay);
        await cli('wait', '--fn', actionableExpression('button', 'plot overlay', { locator: overlay }));
        const rect = await dom(`JSON.stringify((()=>{const r=${preview}.querySelector('figure .u-over').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})())`);
        const viewport = await dom('JSON.stringify({width:innerWidth,height:innerHeight})');
        const points = nativeDragPoints(rect, viewport);
        const baseline = await canvasRaster();
        const baselineGeometry = await publicGeometry();
        const baselinePng = await canvasPng();
        await cli('mouse', 'move', String(points[0].x), String(points[0].y));
        await cli('mouse', 'down', 'left');
        try { await cli('mouse', 'move', String(points[1].x), String(points[1].y)); }
        finally { await cli('mouse', 'up', 'left'); }
        const changed = await rasterCheckpoint(image=>image.sha256 !== baseline.sha256);
        const changedGeometry = await publicGeometry();
        const changedPng = await canvasPng();
        await actions.button('Reset zoom', false, { scope: '(//section[@aria-label="Dataset visualization"]//figure)[1]' });
        const restored = await rasterCheckpoint(image=>image.sha256 === baseline.sha256);
        const restoredGeometry = await publicGeometry();
        const restoredPng = await canvasPng();
        record.datasetInteractionProbe ??= {};
        record.datasetInteractionProbe.sample = { baseline, changed, restored, baselineGeometry, changedGeometry, restoredGeometry };
        if (restored.sha256 !== baseline.sha256) record.datasetInteractionProbe.sample.diagnosticImages = await retainResetDiagnostics('sample', { baseline: baselinePng, changed: changedPng, restored: restoredPng });
        check(changed.sha256 !== baseline.sha256, 'Sample plot native mouse drag changes the actual public chart raster');
        check(restored.sha256 === baseline.sha256, 'Sample plot genuine Reset zoom restores the original chart raster');
        interactive.sample = { file: name, view, baseline, changed, restored, dragChanged: true, resetRestored: true, actions: ['mouse move', 'mouse down left', 'mouse move', 'mouse up left', 'Reset zoom'] };
      }
      const filename = `dataset-${name}-${view.toLowerCase().replaceAll(' ', '-')}.png`;
      await directoryCheckpoint(downloads, `before-export-tab-inventory:${name}:${view}`, [...knownDownloads], record);
      const beforeNames = await readdir(downloads);
      const beforeTabs = redactNativeTabs(JSON.parse(await cli('--json', 'tab', 'list')), expectedOrigin);
      await directoryCheckpoint(downloads, `after-export-tab-inventory-before-readiness:${name}:${view}`, [...knownDownloads], record);
      const target = await readyDatasetExportReference({ cli, dom, actions, view });
      await directoryCheckpoint(downloads, `before-export:${name}:${view}`, [...knownDownloads], record);
      stage('dataset-png-native-click-before', { file: name, view });
      await cli('click', target.reference);
      stage('dataset-png-native-click-complete', { file: name, view });
      const png = await completedNativePng({ downloads, before: beforeNames, kind: view === 'Correlation' ? 'dataset-heatmap' : 'dataset-preview', evidenceFilename: filename, diagnose: observation=>{
        record.datasetPngDirectoryProbe = { file: name, view, ...observation };
      } });
      stage('dataset-png-completed', { file: name, view, nativeFilename: png.nativeFilename });
      assert(png.width === figures[0].canvases[0].width && png.height === figures[0].canvases[0].height, 'Actual PNG dimensions differ from the rendered exported canvas');
      knownDownloads.add(png.filename);
      allowedDiagnosticFiles = [...knownDownloads];
      record.datasetVerifiedNativePng = { file: name, view, ...png };
      const afterTabs = redactNativeTabs(JSON.parse(await cli('--json', 'tab', 'list')), expectedOrigin);
      record.datasetPngNativeTabProbe = { file: name, view, before: beforeTabs, after: afterTabs };
      await directoryCheckpoint(downloads, `after-export-tab-inventory:${name}:${view}`, [...knownDownloads], record);
      evidence.push({ view, figures, ...(statistics ? { statistics } : {}), exportTarget: target, download: png });
    }
    formats.push({ name, header: info, expected, statistics: evidence.find(item=>item.view === 'Statistics').statistics, bounds, views: evidence });
  }
  check(['samples.mat', 'samples.h5', 'samples.hdf5'].every(name=>JSON.stringify(expectations[name])===JSON.stringify(expectations['samples.npz'])), 'All genuine format fixtures contain numerically equal data and independently validated visible statistics');
  const csv = await dom(`JSON.stringify(Array.from(${preview}.querySelectorAll('button')).filter(e=>e.getClientRects().length&&/CSV/i.test(e.textContent)).map(e=>e.textContent.trim()))`);
  // Do not invent a CSV feature: this slice currently exports rendered PNGs.
  assert(csv.length === 0, 'CSV controls were added: extend acceptance to verify their actual downloaded bytes');
  record.datasetParity = { scope: 'Same-host real daemon/static app; bounded previews, not full-dataset or remote acceptance', formats, interactive, csvExport: { available: false, reason: 'No CSV control is exposed by the dataset workspace' } };
  if (expectations['nonfinite.npz']) {
    await choose('nonfinite.npz');
    await selectView('Statistics');
    verifyStatistics(await tableRows(), expectations['nonfinite.npz'], 'nonfinite.npz');
    const rows = await tableRows();
    const figures = await renderedFigures();
    check(figures.length === 2 && figures.every(f=>f.canvases.some(c=>c.width>0&&c.height>0&&c.painted>0)), 'Nonfinite statistics retain two genuine painted bounded charts');
    check(rows.some(row=>row.includes('Missing')) && !rows.flat().some(cell=>/NaN|Infinity/.test(cell)), 'Nonfinite dataset statistics are explicitly Missing, never unsafe NaN/Infinity');
    record.datasetParity.nonfinite = { expected: expectations['nonfinite.npz'], statistics: rows, figures, missingExplicit: true };
  }
  // Cross-format transition makes public header/preview readiness distinguish
  // this normal NPZ from the preceding nonfinite NPZ; no private state probe.
  await choose('samples.hdf5');
  await choose('samples.npz');
  await selectView('Input distribution');
  // Deliberately change only the caller-owned fixture to an unsupported real
  // dataset. Refresh re-resolves paths, so valid replacement is not claimed to
  // violate a pinned historical selection identity.
  await command(python, ['-c', 'import numpy as np,sys; from pathlib import Path; np.savez(Path(sys.argv[1])/"samples.npz",X=np.full((96,32),"unsupported"),y=np.ones((96,12)))', root]);
  await button('Refresh preview');
  await cli('wait', '--fn', `${preview}.querySelector('[role="status"]')&&!${preview}.querySelector('figure')&&!${preview}.querySelector('[role="tab"]')`);
  const refusal = await dom(`JSON.stringify(${preview}.querySelector('[role="status"]').textContent.trim())`);
  check(refusal.length > 0 && !refusal.includes('Loading'), 'Unsupported real replacement refuses refresh and clears old charts/tabs');
  record.datasetParity.replacementRefusal = { reason: 'Real selected file replaced with unsupported nonnumeric arrays', visibleMessage: refusal, oldChartsCleared: true };
  const after = await registry(root);
  check(JSON.stringify(after) === JSON.stringify(before), 'Dataset inspection, six views and actual PNG exports create no plans, submissions or executions');
  record.datasetParity.registry = { before, after, unchanged: true };
  record.datasetParity.registryBefore = before;
  record.datasetParity.registryAfter = after;
}
