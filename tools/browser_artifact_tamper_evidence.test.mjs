import assert from 'node:assert/strict';
import test from 'node:test';
import { checkArtifactTamperEvidence } from './browser_artifact_tamper_evidence.mjs';

export function artifactTamperRecord() {
  const runId = '11111111-1111-4111-8111-111111111111';
  const identity = {size: 123, sha256: 'a'.repeat(64)};
  const artifact = {generation: 'gen-000001', path: 'training_history.csv', ...identity};
  const path = `/api/runs/${runId}/artifacts/${artifact.generation}/${artifact.path}`;
  return {name: 'artifact-tamper', approvedPlan: JSON.stringify({run_id: runId}), artifact,
    artifactTamperStage: 'verified', artifactTamperDownloads: [],
    artifactTamperReceiptsFrozenAfterCleanup: true,
    refusalUi: 'Artifact verification failed or download was interrupted. No file was published.',
    artifactTamperReceipts: [{phase: 'arrival', path}, {phase: 'complete', path, status: 200,
      tampered: true, original: {...identity}, published: {...identity}, diskAfter: {...identity},
      wire: {size: identity.size, sha256: 'b'.repeat(64)}}]};
}

test('exact native download refusal requires genuine changed wire identity and unchanged publication', () => {
  assert.equal(checkArtifactTamperEvidence(artifactTamperRecord()), true);
});

for (const [name, mutate] of [
  ['legacy stdout-only fault', r => { delete r.artifactTamperReceipts; }],
  ['unfrozen receipts', r => { delete r.artifactTamperReceiptsFrozenAfterCleanup; }],
  ['background metadata target', r => { r.artifact.path = 'checkpoint_selection.json'; }],
  ['foreign arrival', r => { r.artifactTamperReceipts[0].path += 'foreign'; }],
  ['foreign complete', r => { r.artifactTamperReceipts[1].path += 'foreign'; }],
  ['unfinished native click', r => { r.artifactTamperStage = 'native-download-click'; }],
  ['duplicate completion', r => { r.artifactTamperReceipts.push(r.artifactTamperReceipts[1]); }],
  ['unsuccessful real response', r => { r.artifactTamperReceipts[1].status = 403; }],
  ['uncorrupted response', r => { r.artifactTamperReceipts[1].wire.sha256 = r.artifact.sha256; }],
  ['changed byte length', r => { r.artifactTamperReceipts[1].wire.size++; }],
  ['changed original', r => { r.artifactTamperReceipts[1].original.sha256 = 'c'.repeat(64); }],
  ['changed publication', r => { r.artifactTamperReceipts[1].published.sha256 = 'c'.repeat(64); }],
  ['changed disk', r => { r.artifactTamperReceipts[1].diskAfter.sha256 = 'c'.repeat(64); }],
  ['missing visible refusal', r => { r.refusalUi = 'Connected'; }],
  ['published download', r => { r.artifactTamperDownloads.push('unverified.csv'); }],
]) test(`artifact guard rejects ${name}`, () => {
  const record = artifactTamperRecord(); mutate(record);
  assert.throws(() => checkArtifactTamperEvidence(record));
});
