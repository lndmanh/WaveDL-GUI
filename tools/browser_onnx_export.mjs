// Additive supported ONNX export-only subgate; ordinary public DOM approval.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { xpathLiteral } from './browser_actions.mjs';

export const onnxScope = 'Same-host CPU supported opset-17 export-only via evaluation plan; genuine training checkpoint, publication and browser download; not cancellation/CV/remote matrix';

export async function onnxExport({ cli, dom, button, actions, registry, pollRegistry,
  root, downloads, record, python, command, approvedManifest, check }) {
  const scope = '//section[@aria-labelledby="inference-title"]';
  const plan = `document.getElementById('inference-title').closest('section').querySelector('[aria-label="Approved normalized manifest"]')`;
  const observe = expression => dom(`JSON.stringify(${expression})`);
  record.onnxStage = 'settle-automatic-plot';
  await pollRegistry(root, state => state.plans === 2 && state.runs.length === 2
    && state.runs.every(run => run.state === 'completed'), 'Automatic plot settled', 90000);
  await button('Dismiss', true);
  await button('Experiments'); await button('Close', true);
  await actions.button('Refresh', false, { scope: '//section[@aria-label="Runs"]' });
  const trainingRow = `xpath=//button[contains(@class,"run-row")][.//small[normalize-space(.)=${xpathLiteral(approvedManifest.run_id)}]]`;
  await cli('wait', '--fn', `document.evaluate(${JSON.stringify(trainingRow.slice(6))},document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null).snapshotLength===1`);
  await cli('click', trainingRow); await button('Results'); await button('Refresh artifacts');
  await cli('wait', '--fn', `Array.from(document.getElementById('source-generation')?.options ?? []).some(option => option.value && !option.disabled)`);
  const options = await observe('Array.from(document.querySelector("#source-generation").options).filter(o=>o.value&&!o.disabled).map(o=>({value:o.value,label:o.textContent.trim()}))');
  const selected = options.find(option => option.label.endsWith('best'));
  assert(selected, 'Genuine published best checkpoint required');
  await actions.select('Source checkpoint generation', selected.value);
  const rootLocator = await actions.readyControl('field', 'Configured root', false,
    { locator: `xpath=${scope}//*[@role="combobox" and @aria-label="Configured root"]` });
  await cli('click', rootLocator); await actions.option('datasets');
  await actions.button('Select file samples.npz', false, { scope });
  await actions.fill('Python interpreter', record.pythonInterpreter, { scope });
  await actions.fill('Data loader workers', '0');
  await actions.fill('ONNX opset (11–17)', '17');
  await actions.select('Model export', 'onnx');
  for (const id of ['save_predictions', 'plot', 'verbose', 'no_denorm'])
    assert.equal(await observe(`document.getElementById('inference-${id}')?.getAttribute('aria-checked')`), 'false', 'Export-only de-normalized defaults required');
  record.onnxStage = 'preview-export';
  const before = await registry(root);
  await actions.button('Preview evaluation / plot plan', false, { scope });
  await cli('wait', '--fn', `${plan} !== null`);
  const approved = JSON.parse(await observe(`${plan}.textContent`));
  assert.equal(approved.operation, 'test'); assert.equal(approved.resolved_config.export, 'onnx');
  assert.equal(approved.resolved_config.export_opset, 17); assert.equal(approved.runtime.device, 'cpu');
  assert.equal(approved.checkpoint_source.run_id, approvedManifest.run_id);
  assert.equal(approved.checkpoint_source.generation, selected.value);
  const previewed = await registry(root);
  assert.equal(previewed.plans, before.plans + 1);
  assert.equal(previewed.runs.length, before.runs.length);
  assert.equal(previewed.control.filter(c => c.submission_requested === 1).length, 2);
  await actions.button('Approve and start this plan', false, { scope });
  record.onnxStage = 'actual-cpu-export';
  await pollRegistry(root, state => {
    const run = state.runs.find(run => run.run_id === approved.run_id);
    assert(!run || !['failed', 'cancelled'].includes(run.state), 'Supported CPU ONNX export failed');
    return run?.state === 'completed';
  }, 'Supported CPU ONNX export completed', 90000);
  await button('Results'); await button('Refresh artifacts');
  await cli('wait', '--fn', `Array.from(document.querySelector('#results-title').closest('section').querySelectorAll('tbody tr')).some(row=>row.cells[1]?.textContent.trim().endsWith('.onnx'))`);
  const rows = await observe(`Array.from(document.querySelector('#results-title').closest('section').querySelectorAll('tbody tr')).map(row=>Array.from(row.cells).slice(0,3).map(cell=>cell.textContent.trim()))`);
  const onnxRows = rows.filter(row => row[1].endsWith('.onnx'));
  assert.equal(onnxRows.length, 1, 'One exact published ONNX artifact required');
  const row = onnxRows[0], generation = row[0].split('/')[0].trim(), path = row[1];
  const artifactScope = `//section[@aria-labelledby="results-title"]//tbody/tr[normalize-space(td[1])=${xpathLiteral(row[0].replace(/\s+/g, ' ').trim())} and normalize-space(td[2])=${xpathLiteral(path)}]`;
  assert.deepEqual(await readdir(downloads), [], 'Download directory must begin empty');
  const download = await actions.readyControl('button', 'Download', false, { scope: artifactScope });
  await cli('download', download, join(downloads, 'verified-model.onnx'));
  const bytes = await readFile(join(downloads, 'verified-model.onnx'));
  const browserDownload = { generation, path, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  record.onnxStage = 'independent-publication-and-onnx-validation';
  const durable = JSON.parse(await command(python, ['tools/browser_onnx_export_evidence.py', root,
    approvedManifest.run_id, selected.value, approved.run_id, generation, path, join(downloads, 'verified-model.onnx')], undefined, 60000));
  assert.deepEqual(durable.artifact, browserDownload);
  record.onnxExport = { scope: onnxScope, sourceRunId: approvedManifest.run_id,
    selected, approved, before, previewed, browserDownload, durable };
  check(true, 'Explicit supported CPU ONNX approval produced verified publication and browser bytes with checker and CPU numerical comparison');
}
