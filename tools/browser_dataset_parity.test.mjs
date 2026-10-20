import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { mkdtemp, writeFile, symlink, truncate, rm, readdir, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { pngEvidence, downloadedBytes, nativeDragPoints, parseNativePngName, completedNativePng, redactNativeTabs, diagnosticFileSignature, unexpectedFilePrefix, directoryCheckpoint, datasetCommandBoundaries, datasetExportScope, datasetExportReference, readyDatasetExportReference } from './browser_dataset_parity.mjs';
import { createBrowserActions } from './browser_actions.mjs';
import { settledDatasetRefusalExpression } from './browser_dataset_parity.mjs';
import { retainFailurePrefixes } from './browser_failure_evidence.mjs';

test('Dataset replacement waits through transient loading for a settled refusal without old charts or tabs', () => {
  const status = { textContent: 'Loading bounded daemon preview…' };
  const refresh = { textContent: 'Refresh preview', disabled: true };
  const stop = { textContent: 'Stop preview', disabled: false };
  let buttons = [refresh, stop], figure = null, tab = null;
  const panel = {
    querySelectorAll: selector=>selector === 'button' ? buttons : [status],
    querySelector: selector=>selector === 'figure' ? figure : tab,
  };
  const observe = ()=>runInNewContext(settledDatasetRefusalExpression(), { document: { querySelector: ()=>panel } });
  assert.equal(observe(), false, 'Cleared charts during loading are not refusal');
  status.textContent = 'The daemon request failed. Verify connectivity and the operation outcome before retrying.';
  assert.equal(observe(), false, 'Status alone cannot bypass in-flight public controls');
  refresh.disabled = false;
  buttons = [refresh];
  assert.equal(observe(), true);
  assert.equal(observe(), true, 'Durable failure remains ready on a later observation');
  figure = {};
  assert.equal(observe(), false, 'Old charts must still fail closed');
  figure = null;
  tab = {};
  assert.equal(observe(), false, 'Old tabs must still fail closed');
  tab = null;
  status.textContent = '';
  assert.equal(observe(), false);
});

test('Dataset failure retention excludes thirty declared downloads without exempting unknown files', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'wavedl-known-downloads-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const expected = Array.from({length:30},(_,index)=>`verified-${index}.png`);
  for (const name of expected) await writeFile(join(root,name),Buffer.from('verified'));
  const destinationRoot = await realpath(await mkdtemp(join(tmpdir(), 'wavedl-known-evidence-')));
  t.after(()=>rm(destinationRoot,{recursive:true,force:true}));
  const evidence = await retainFailurePrefixes({ downloads: root, destination: join(destinationRoot,'known-only'), expected });
  assert.equal(evidence.files.length,0);
  await writeFile(join(root,'unknown-0.html'),Buffer.from('unknown'));
  const unknown = await retainFailurePrefixes({ downloads: root, destination: join(destinationRoot,'one-unknown'), expected });
  assert.equal(unknown.files.length,1, 'Unknown download must still be retained');
  for (let index=1;index<17;index++) await writeFile(join(root,`unknown-${index}.html`),Buffer.from('unknown'));
  await assert.rejects(retainFailurePrefixes({ downloads: root, destination: join(destinationRoot,'unknown-overflow'), expected }), { code:'EVIDENCE_FILE_BOUND' });
});

function exportDriver(options = {}) {
  const calls = [];
  let reads = 0;
  const target = { isConnected: options.disconnected !== true, disabled: options.disabled === true, textContent: 'Export PNG', getClientRects: ()=>[{}], matches: ()=>false, getAttribute: ()=>null, contains: node=>node===target, getBoundingClientRect: ()=>({x:10 + (options.changedGeometry && reads > 1 ? 1 : 0),y:20,width:100,height:30}) };
  const root = { isConnected: true, contains: node=>node===target, querySelectorAll: ()=>options.hiddenDuplicate ? [target,{textContent:'Export PNG',getAttribute:()=>null}] : [target] };
  const document = {
    querySelectorAll: ()=>options.noUniqueScope ? [root,root] : [root],
    evaluate: (_xpath,_doc,_resolver,type)=>type===1 ? {singleNodeValue:options.foreignRoot ? {} : root} : {snapshotLength:options.duplicateTarget ? 2 : 1,snapshotItem:()=>target},
    elementFromPoint: ()=>target,
  };
  const driver = {
    view:'Input distribution',
    actions:{readyControl:async (...args)=>{calls.push(['readyControl',...args]);return 'xpath=(//section[@aria-label="Dataset visualization"]//figure)[1]//button[normalize-space(.)="Export PNG"]';}},
    cli:async (...args)=>{calls.push(args);return args[0]==='snapshot' ? options.tree ?? '- button "Export PNG" [ref=e45]\n- button "Export PNG" [ref=e45]' : options.text ?? 'Export PNG\n';},
    dom:async expression=>{calls.push(['dom',expression]);reads++;return JSON.parse(runInNewContext(expression,{document,XPathResult:{FIRST_ORDERED_NODE_TYPE:1,ORDERED_NODE_SNAPSHOT_TYPE:2},innerWidth:800,innerHeight:600,getComputedStyle:()=>({visibility:'visible',opacity:'1',pointerEvents:'auto'})}));},
  };
  return {driver,calls};
}

test('Dataset ref readiness preserves XPath baseline then scopes snapshot/text before two independent public observations', async () => {
  const {driver,calls} = exportDriver();
  const target = await readyDatasetExportReference(driver);
  assert.equal(target.reference,'@e45');
  assert.deepEqual(calls.map(call=>call[0]),['readyControl','snapshot','get','dom','dom']);
  assert.deepEqual(calls[1],['snapshot','-i','-s',datasetExportScope(driver.view)]);
  assert.deepEqual(calls[2],['get','text','@e45']);
  assert.equal(calls[0][4].scope,'(//section[@aria-label="Dataset visualization"]//figure)[1]');
  assert.equal(calls[3][1],calls[4][1]);
  assert.equal(datasetExportReference('- button "Export PNG" [ref=e45]\n- button "Export PNG" [ref=e45]'),'@e45');
  assert.equal(datasetExportReference('- button "Reset zoom" [ref=e44]\n- button "Export PNG" [ref=e45]\n- button "Reset zoom" [ref=e44]\n- button "Export PNG" [ref=e45]'),'@e45');
  assert.equal(datasetExportReference('- button "Reset view" [ref=e44]\n- button "Export PNG" [ref=e45]'),'@e45');
  assert.equal(datasetExportReference('- button "Other chart action" [ref=e44]\n- button "Export PNG" [ref=e45]'),'@e45');
});

test('Dataset structural scopes cover all six actual first-figure layouts without a generic grid assumption', () => {
  assert.match(datasetExportScope('Correlation'),/tabpanel"\] > figure$/);
  assert.match(datasetExportScope('Samples'),/> div\.flex\.flex-col\.gap-5 > div:first-child > figure$/);
  assert.match(datasetExportScope('Statistics'),/> \.statistics-plots > figure:first-child$/);
  for (const view of ['Input distribution','Output distribution','Scatter']) assert.match(datasetExportScope(view),/\.preview-grid > figure:first-child$/);
  assert.throws(()=>datasetExportScope('foreign'),/Unknown/);
});

test('Dataset scoped refs refuse missing, distinct duplicate, disabled and foreign AX controls', async () => {
  for (const tree of ['', '- button "Export PNG" [ref=e45]\n- button "Export PNG" [ref=e46]', '- button "Export PDF" [ref=e45]', '- button "Export unknown" [ref=e45]', '- button "Export PNG" [ref=e45] [disabled]']) {
    const {driver,calls} = exportDriver({tree});
    await assert.rejects(readyDatasetExportReference(driver),/Scoped dataset snapshot/);
    assert(!calls.some(call=>call[0]==='get'||call[0]==='dom'||call[0]==='click'));
  }
});

test('Dataset post-ref DOM authority refuses nonunique scope, foreign root, duplicates, disconnected/disabled and changed geometry', async () => {
  for (const option of ['noUniqueScope','foreignRoot','duplicateTarget','hiddenDuplicate','disconnected','disabled','changedGeometry']) {
    const {driver,calls} = exportDriver({[option]:true});
    await assert.rejects(readyDatasetExportReference(driver),/scoped exposure/);
    assert(!calls.some(call=>call[0]==='click'));
  }
  const {driver,calls} = exportDriver({text:'Export PDF'});
  await assert.rejects(readyDatasetExportReference(driver),/stale or foreign native text/);
  assert(!calls.some(call=>call[0]==='dom'||call[0]==='click'));
});

test('Oversized unexpected file reads only an explicitly hashed 4096-byte prefix', async (t) => {
  const root = await mkdtemp(join(tmpdir(),'wavedl-unexpected-prefix-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const path = join(root,'downloads.html'), bytes = Buffer.alloc(4096,32);
  Buffer.from('<!doctype html><html><downloads-manager>World Dataset private-authority').copy(bytes);
  await writeFile(path,bytes); await truncate(path,33619428);
  const proof = await unexpectedFilePrefix(path);
  assert.equal(proof.size,33619428); assert.equal(proof.prefixLength,4096);
  assert.equal(proof.prefixSha256,createHash('sha256').update(bytes).digest('hex'));
  assert.equal(proof.htmlSignature,true); assert.equal(proof.chromeDownloadsMarker,true); assert.equal(proof.worldDatasetMarker,true);
  assert(!JSON.stringify(proof).includes('private-authority'));
  assert(!('sha256' in proof),'Prefix digest must never be described as a full-file digest');
});

test('Pre-export directory checkpoints allow only declared diagnostic files and record attribution before refusal', async (t) => {
  const root = await mkdtemp(join(tmpdir(),'wavedl-directory-checkpoint-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const record = {};
  await directoryCheckpoint(root,'clean',[],record);
  await writeFile(join(root,'driver-catalogue.png'),fixture());
  await directoryCheckpoint(root,'declared-screenshot',['driver-catalogue.png'],record);
  await writeFile(join(root,'downloads.html'),Buffer.from('<html>private-authority</html>'));
  await assert.rejects(directoryCheckpoint(root,'after-snapshot',['driver-catalogue.png'],record), /Unexpected pre-export.*attribution/);
  assert.equal(record.datasetDownloadDirectoryCheckpoint.label,'after-snapshot');
  const unexpected = record.datasetDownloadDirectoryCheckpoint.entries.find(entry=>entry.name==='downloads.html');
  assert.equal(unexpected.prefix.htmlSignature,true);
  assert(!JSON.stringify(record).includes('private-authority'));
});

test('First-view readiness checkpoints observe existing native/public commands in completion order only', async () => {
  const calls = [], stages = [], checkpoints = [];
  const observe = datasetCommandBoundaries({
    file: 'samples.npz', view: 'Input distribution',
    stage: (name, detail)=>stages.push({ name, ...detail }),
    checkpoint: async (label, boundary)=>checkpoints.push({ label, ...boundary }),
  });
  const exposure = { x: 10, y: 20, width: 100, height: 30, viewportWidth: 800, viewportHeight: 600 };
  const actions = createBrowserActions({
    snapshot: ()=>observe('ready-control-snapshot', async ()=>calls.push('snapshot')),
    cli: (...args)=>observe(`ready-control-${args[0] === 'scrollintoview' ? 'scroll' : args[0]}`, async ()=>calls.push(args[0])),
    dom: expression=>observe('ready-control-public-dom', async ()=>{
      calls.push('dom');
      return expression.includes('.map(element =>') ? [{visible:true,disabled:false}] : exposure;
    }),
  });
  const locator = await observe('ready-control', ()=>actions.readyControl('button', 'Input distribution', false, { locator: 'xpath=//public-tab' }));
  assert.equal(locator, 'xpath=//public-tab');
  assert.deepEqual(calls, ['snapshot','dom','scrollintoview','wait','dom','dom']);
  assert.deepEqual(checkpoints.map(item=>item.operation), ['ready-control-snapshot','ready-control-public-dom','ready-control-scroll','ready-control-wait','ready-control-public-dom','ready-control-public-dom','ready-control']);
  assert.deepEqual(checkpoints.map(item=>item.sequence), [1,2,3,4,5,6,7]);
  assert(stages.every(item=>item.file==='samples.npz' && item.view==='Input distribution'));
  assert.equal(checkpoints.length, calls.length + 1, 'The opaque readiness completion gets one filesystem boundary, not an extra browser probe');
});

test('Each first-view command boundary refuses unexpected files before any subsequent export click', async (t) => {
  const root = await mkdtemp(join(tmpdir(),'wavedl-command-boundary-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const operations = ['ready-wait','header-public-dom','tabs-public-dom','bounds-public-dom','view-snapshot','ready-control-snapshot','ready-control-public-dom','ready-control-scroll','ready-control-wait','ready-control','view-click','view-wait','figures-public-raster'];
  for (const [index, failureOperation] of operations.entries()) {
    const directory = await mkdtemp(join(root,`case-${index}-`)), record = {}, calls = [];
    await writeFile(join(directory,'driver-catalogue.png'), Buffer.from('declared diagnostic'));
    const observe = datasetCommandBoundaries({
      file: 'samples.npz', view: 'Input distribution', stage: ()=>{},
      checkpoint: (label, boundary)=>directoryCheckpoint(directory,label,['driver-catalogue.png'],record,boundary),
    });
    const accept = async ()=>{
      for (const operation of operations) await observe(operation, async ()=>{
        calls.push(operation);
        if (operation===failureOperation) await writeFile(join(directory,'downloads.html'),Buffer.from('private-authority'));
      });
      calls.push('export-click');
    };
    await assert.rejects(accept(), /Unexpected pre-export.*attribution/);
    assert.deepEqual(calls,operations.slice(0,index+1));
    assert.equal(record.datasetDownloadDirectoryCheckpoint.boundary.operation,failureOperation);
    assert.equal(record.datasetDownloadDirectoryCheckpoint.boundary.sequence,index+1);
    assert(!JSON.stringify(record).includes('private-authority'));
  }
});

test('First-view boundary budget fails before executing an additional command', async () => {
  let commands = 0;
  const observe = datasetCommandBoundaries({file:'samples.npz',view:'Input distribution',stage:()=>{},checkpoint:async()=>{},limit:2});
  await observe('view-snapshot',async()=>commands++);
  await observe('view-wait',async()=>commands++);
  await assert.rejects(observe('view-click',async()=>commands++),/exceeds its bound/);
  assert.equal(commands,2);
  assert.throws(()=>datasetCommandBoundaries({limit:41}),/must be bounded/);
});

test('Native tab diagnostics preserve only stable IDs and safe origin/downloads flags', () => {
  const proof = redactNativeTabs({success:true,data:{tabs:[{tabId:'t1',active:true,url:'http://127.0.0.1:1234/?bootstrap=do-not-record',title:'private-title'},{tabId:'t2',active:false,url:'chrome://downloads/'},{tabId:'t3',active:false,url:'https://foreign.example/?token=do-not-record',title:'foreign-title'}]}},'http://127.0.0.1:1234');
  assert.equal(proof[0].sameExpectedOrigin,true);
  assert.equal(proof[1].chromeDownloadsUri,'chrome://downloads/');
  assert.equal(proof[2].sameExpectedOrigin,false);
  assert(!/do-not-record|title|foreign\.example|bootstrap|token/.test(JSON.stringify(proof)));
});
test('Unexpected HTML diagnostics emit only bounded hashes/signature booleans, never raw content', () => {
  const bytes = Buffer.from('<!doctype html><html><title>Downloads</title><downloads-manager>private-authority</downloads-manager></html>');
  const proof = diagnosticFileSignature(bytes);
  assert.equal(proof.htmlSignature,true); assert.equal(proof.chromeDownloadsMarker,true); assert.equal(proof.titleIsDownloads,true); assert.equal(proof.datasetVisualizationMarker,false); assert.equal(proof.pngMagic,false);
  assert(!JSON.stringify(proof).includes('private-authority'));
  assert.equal(diagnosticFileSignature(fixture()).pngMagic,true);
});

test('Native PNG names accept genuine Chrome basenames/ordinals and reject traversal or invented save labels', () => {
  assert.deepEqual(parseNativePngName('dataset-preview.png'),{kind:'dataset-preview',ordinal:0});
  assert.deepEqual(parseNativePngName('dataset-heatmap (12).png'),{kind:'dataset-heatmap',ordinal:12});
  for (const name of ['../dataset-preview.png','dataset-preview (0).png','dataset-preview (1000000).png','dataset-samples.npz-statistics.png','dataset-preview.png.crdownload','/dataset-preview.png']) assert.throws(()=>parseNativePngName(name), /Unexpected native/);
});

test('Completed native PNG observes actual file bytes then honestly renames only the new export for evidence', async (t) => {
  const root = await mkdtemp(join(tmpdir(),'wavedl-native-png-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'driver-catalogue.png'),Buffer.from('diagnostic'));
  const before = await readdir(root);
  await writeFile(join(root,'dataset-preview (2).png'),fixture());
  const proof = await completedNativePng({downloads:root,before,kind:'dataset-preview',evidenceFilename:'dataset-samples.npz-input-distribution.png',timeout:2000});
  assert.equal(proof.nativeFilename,'dataset-preview (2).png');
  assert.equal(proof.nativeClick,true); assert.equal(proof.targetOverridden,false); assert.equal(proof.renamedForEvidence,true);
  assert.equal(proof.decoded,true); assert.equal(proof.coloredPixels,6);
  assert.deepEqual(await readFile(join(root,proof.filename)),fixture());
  assert.deepEqual((await readdir(root)).sort(),['dataset-samples.npz-input-distribution.png','driver-catalogue.png']);
});

test('Native PNG completion fails closed on incomplete, foreign, wrong-kind and symlink exports', async (t) => {
  const root = await mkdtemp(join(tmpdir(),'wavedl-native-png-refusal-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const inspect = () => completedNativePng({downloads:root,before:[],kind:'dataset-preview',evidenceFilename:'dataset-case.png',timeout:25});
  await writeFile(join(root,'dataset-preview.png.crdownload'),fixture());
  await assert.rejects(inspect(), /did not complete/);
  await rm(join(root,'dataset-preview.png.crdownload'));
  await writeFile(join(root,'foreign.png'),fixture());
  await assert.rejects(inspect(), /Unexpected native/);
  await rm(join(root,'foreign.png'));
  await writeFile(join(root,'dataset-heatmap.png'),fixture());
  await assert.rejects(inspect(), /does not match/);
  await rm(join(root,'dataset-heatmap.png'));
  const source = join(root,'source.bin'); await writeFile(source,fixture());
  await symlink(source,join(root,'dataset-preview.png'));
  await assert.rejects(completedNativePng({downloads:root,before:['source.bin'],kind:'dataset-preview',evidenceFilename:'dataset-case.png',timeout:25}), /ordinary/);
  await assert.rejects(completedNativePng({downloads:root,before:[],kind:'dataset-preview',evidenceFilename:'../escape.png',timeout:25}), /rename target/);
});
test('Native PNG multiple-file refusal records bounded actual directory metadata before failing', async (t) => {
  const root = await mkdtemp(join(tmpdir(),'wavedl-native-png-diagnostic-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'dataset-preview.png'),fixture());
  await writeFile(join(root,'.com.google.Chrome.fixture'),Buffer.from('actual temporary bytes'));
  let probe;
  await assert.rejects(completedNativePng({downloads:root,before:[],kind:'dataset-preview',evidenceFilename:'dataset-case.png',timeout:25,diagnose:value=>{probe=value;}}), /multiple unexpected/);
  assert.deepEqual(probe.added.sort(),['.com.google.Chrome.fixture','dataset-preview.png']);
  assert(probe.entries.every(entry=>entry.isFile&&!entry.isSymbolicLink&&entry.size>0));
  assert.deepEqual(probe.before,[]);
});

test('Native drag converts fractional DOM rectangles to integer CLI coordinate strings', () => {
  const points = nativeDragPoints({x:10.25,y:20.5,width:100.5,height:200.25},{width:800,height:600});
  assert.deepEqual(points,[{x:30,y:61},{x:91,y:181}]);
  assert(points.flatMap(point=>[point.x,point.y]).every(value=>/^\d+$/.test(String(value))));
});
test('Native drag refuses nonfinite, out-of-viewport and zero-size selection coordinates', () => {
  const viewport = {width:800,height:600};
  for (const rect of [{x:NaN,y:0,width:100,height:100},{x:700,y:500,width:200,height:200},{x:0,y:0,width:0,height:100},{x:0,y:0,width:.1,height:.1}]) assert.throws(()=>nativeDragPoints(rect,viewport), /Native sample drag/);
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(kind, data) {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  result.write(kind, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, data.length + 8)), data.length + 8);
  return result;
}
function fixture(filter = 0, { width = 3, height = 2, raw, empty = false, colorType = 6, interlace = 0 } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = colorType; ihdr[12] = interlace;
  const rows = [Buffer.from([255,0,0,255,0,255,0,255,0,0,255,255]), Buffer.from([100,50,25,255,20,80,200,255,255,255,0,255])];
  if (empty) rows.forEach(row=>row.fill(0));
  const paeth = (a,b,c) => { const p=a+b-c, x=Math.abs(p-a), y=Math.abs(p-b), z=Math.abs(p-c); return x<=y&&x<=z?a:y<=z?b:c; };
  const encoded = rows.map((row,y)=> {
    const result = Buffer.alloc(row.length + 1); result[0] = filter;
    for (let x=0;x<row.length;x++) {
      const a=x>=4?row[x-4]:0, b=y?rows[y-1][x]:0, c=y&&x>=4?rows[y-1][x-4]:0;
      result[x+1]=(row[x]-(filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c)))&255;
    }
    return result;
  });
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('tEXt', Buffer.from('Description\0Independent colored RGBA fixture')), chunk('IDAT', deflateSync(raw ?? Buffer.concat(encoded))), chunk('IEND', Buffer.alloc(0))]);
}

for (let filter = 0; filter <= 4; filter++) {
  test(`PNG unfilters real RGBA filter ${filter} into six colored raster pixels`, () => {
    const proof = pngEvidence(fixture(filter));
    assert.equal(proof.decoded, true);
    assert.equal(proof.coloredPixels, 6);
    assert.equal(proof.width, 3); assert.equal(proof.height, 2);
    assert.match(proof.sha256, /^[0-9a-f]{64}$/);
  });
}
test('PNG rejects invalid signature, malformed IHDR, unsupported encoding and truncation', () => {
  const badSignature = fixture(); badSignature[0] = 0;
  assert.throws(()=>pngEvidence(badSignature), /signature/);
  const badHeader = fixture(); badHeader.writeUInt32BE(12, 8);
  assert.throws(()=>pngEvidence(badHeader), /RGBA/);
  assert.throws(()=>pngEvidence(fixture(0,{colorType:2})), /RGBA/);
  assert.throws(()=>pngEvidence(fixture(0,{interlace:1})), /RGBA/);
  const hugeChunk = fixture(); hugeChunk.writeUInt32BE(0xffffffff, 33);
  assert.throws(()=>pngEvidence(hugeChunk), /chunk exceeds/);
  const truncated = fixture().subarray(0, -1);
  assert.throws(()=>pngEvidence(truncated), /Truncated|exceeds/);
});
test('PNG rejects dimension/memory limits, invalid filters, empty raster and inflate bombs', () => {
  assert.throws(()=>pngEvidence(fixture(0,{width:0})), /dimensions/);
  assert.throws(()=>pngEvidence(fixture(0,{width:8193})), /dimensions/);
  assert.throws(()=>pngEvidence(fixture(0,{width:8192,height:8192})), /memory/);
  assert.throws(()=>pngEvidence(fixture(0,{empty:true})), /colored/);
  const raw = Buffer.alloc(26); raw[0] = 5;
  assert.throws(()=>pngEvidence(fixture(0,{raw})), /scanline filter/);
  assert.throws(()=>pngEvidence(fixture(0,{raw:Buffer.alloc(1024*1024)})), /larger|limit|size/i);
  assert.throws(()=>pngEvidence(fixture(0,{raw:Buffer.alloc(4)})), /raster length/);
});
test('PNG rejects corrupt CRC, duplicate header, malformed/missing IEND and trailing bytes', () => {
  const badCrc = fixture(); badCrc[41] ^= 1;
  assert.throws(()=>pngEvidence(badCrc), /CRC mismatch/);
  const png = fixture();
  assert.throws(()=>pngEvidence(Buffer.concat([png.subarray(0,33),png.subarray(8,33),png.subarray(33)])), /duplicate header/);
  assert.throws(()=>pngEvidence(Buffer.concat([png.subarray(0,-12),chunk('IEND',Buffer.from([0]))])), /IEND must be empty/);
  assert.throws(()=>pngEvidence(png.subarray(0,-12)), /end marker/);
  assert.throws(()=>pngEvidence(Buffer.concat([png,Buffer.from([0])])), /terminal/);
});
test('Download reader accepts ordinary bytes and rejects symlink, directory, oversized file and FIFO', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wavedl-png-contract-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const file = join(root,'ordinary.png');
  await writeFile(file,fixture());
  assert.deepEqual(await downloadedBytes(file),fixture());
  const link = join(root,'linked.png'); await symlink(file,link);
  await assert.rejects(downloadedBytes(link), /ordinary bounded/);
  await assert.rejects(downloadedBytes(root), /ordinary bounded/);
  const big = join(root,'oversized.png'); await writeFile(big,''); await truncate(big,8*1024*1024+1);
  await assert.rejects(downloadedBytes(big), /ordinary bounded/);
  if (process.platform !== 'win32') {
    const fifo = join(root,'fifo.png');
    const result = spawnSync('mkfifo',[fifo]);
    assert.equal(result.status,0,'mkfifo must create the owned contract fixture');
    await assert.rejects(downloadedBytes(fifo), /ordinary bounded/);
  }
});
