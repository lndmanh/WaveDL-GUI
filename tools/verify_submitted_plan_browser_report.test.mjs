#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';
import { verifySubmittedPlanRecord } from './verify_submitted_plan_browser_report.mjs';

function fixture() {
  const id = '11111111-1111-4111-8111-111111111111';
  const run = '22222222-2222-4222-8222-222222222222';
  const common = { plans: 2, executions: 2, planId: id, runId: run, state: 'completed', submissionRequested: 1, cancellationRequested: 0, cancelDelivered: 0, planSha256: 'a'.repeat(64), manifestSha256: 'b'.repeat(64), controlSha256: 'c'.repeat(64), executionSha256: 'd'.repeat(64) };
  const ui = (epochs, batchSize) => ({ epochs, batchSize, dataPath: '/owned/samples.npz', model: 'cnn', python: '/usr/bin/python3', device: 'cpu', approvalVisible: false, approveEnabled: false, acknowledgedRun: run, openAcknowledgedEnabled: true, resetConfirmationVisible: false });
  return { name: 'submitted-plan-authoring-protection', status: 'passed', driverReadinessMode: 'sync-exposure-poll-and-two-controller-dom-observations', freshStorage: { local: [], session: [], cookies: '' }, assetManifestSha256: 'c'.repeat(64), trainingOptionsSha256: 'd'.repeat(64), defaults: { epochs: '1000', batchSize: '128' }, runId: run, planId: id, pythonInterpreter: '/usr/bin/python3', authored: { epochs: '3', model: 'cnn', device: 'cpu', workers: '0', precision: 'no', dataPath: '/owned/samples.npz', python: '/usr/bin/python3' }, accepted: { ...common, manifest: { config: { epochs: 3, model: 'cnn', data_path: '/owned/samples.npz' }, device: 'cpu', python: '/usr/bin/python3' } }, afterEdit: common, afterReset: common, afterNavigation: common, editedUi: ui('4', '16'), resetUi: ui('1000', '128'), navigation: { runId: run, runDetailVisible: true }, cleanup: { errors: [], browserSessionAbsent: true, fixtureReaped: true, servicesClosed: true, listenerClosed: true, ownedRootsRemoved: true }, limitation: 'One real local CPU completed run; no GPU, Windows, Slurm or release acceptance.' };
}
test('submitted-plan verifier accepts a protected completed run', () => verifySubmittedPlanRecord(fixture()));
for (const [name, mutate] of [
  ['new plan', (r) => (r.afterEdit.plans = 3)],
  ['cancel intent', (r) => (r.afterReset.cancellationRequested = 1)],
  ['changed publication', (r) => (r.afterNavigation.planSha256 = 'e'.repeat(64))],
  ['changed execution row', (r) => (r.afterReset.executionSha256 = 'e'.repeat(64))],
  ['changed control row', (r) => (r.afterEdit.controlSha256 = 'e'.repeat(64))],
  ['lost acknowledgement UI', (r) => (r.resetUi.acknowledgedRun = null)],
  ['missing cleanup', (r) => delete r.cleanup.listenerClosed],
]) test(`rejects ${name}`, () => { const record = fixture(); mutate(record); assert.throws(() => verifySubmittedPlanRecord(record)); });
