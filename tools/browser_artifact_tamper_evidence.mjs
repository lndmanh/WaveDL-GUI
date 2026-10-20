import assert from 'node:assert/strict';

export function checkArtifactTamperEvidence(record) {
  assert.equal(record.name, 'artifact-tamper');
  assert.equal(record.artifactTamperStage, 'verified', 'Native click and visible refusal must complete');
  assert.equal(record.artifactTamperReceiptsFrozenAfterCleanup, true, 'Fault receipts must be frozen after service shutdown');
  const artifact = record.artifact;
  assert.equal(artifact?.path, 'training_history.csv', 'Fault must target a download, not checkpoint metadata');
  assert.match(artifact.generation, /^gen-[0-9]{6,}$/);
  assert(Number.isSafeInteger(artifact.size) && artifact.size > 0 && artifact.size <= 1048576);
  assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
  const runId = JSON.parse(record.approvedPlan).run_id;
  assert.match(runId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  const path = `/api/runs/${runId}/artifacts/${artifact.generation}/${artifact.path}`;
  const receipts = record.artifactTamperReceipts;
  assert(Array.isArray(receipts) && receipts.length === 2, 'Exact one-shot fault requires arrival and completion');
  assert.deepEqual(receipts[0], {phase: 'arrival', path});
  const receipt = receipts[1];
  assert.equal(receipt.phase, 'complete'); assert.equal(receipt.path, path);
  assert.equal(receipt.status, 200); assert.equal(receipt.tampered, true);
  const identity = {size: artifact.size, sha256: artifact.sha256};
  for (const key of ['original', 'published', 'diskAfter']) assert.deepEqual(receipt[key], identity, `Artifact ${key} differs from immutable identity`);
  assert.equal(receipt.wire?.size, artifact.size);
  assert.match(receipt.wire.sha256, /^[a-f0-9]{64}$/);
  assert.notEqual(receipt.wire.sha256, artifact.sha256, 'Outgoing fault must differ from real publication');
  assert(typeof record.refusalUi === 'string' && /Artifact verification failed or download was interrupted\. No file was published\.|The daemon returned an invalid response\. Reconnect to verify its identity\./.test(record.refusalUi), 'Actual browser refusal missing');
  assert.deepEqual(record.artifactTamperDownloads, [], 'Refused artifact must not publish a browser download');
  return true;
}
