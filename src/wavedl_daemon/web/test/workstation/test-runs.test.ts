import { describe, expect, it } from 'vitest';
import {
  checkpointLabel,
  isCompareEligible,
  isTestRun,
  parentTitle,
  testLocation,
} from '../../app/lib/test-runs';
import type { RunView } from '../../types/daemon-api';

const id = '11111111-1111-1111-1111-111111111111';
const sourceId = '22222222-2222-2222-2222-222222222222';
const summary = {
  name: null,
  model: null,
  data_path: 'test.csv',
  epochs: null,
  cv: null,
  source_run_id: sourceId,
};
const evaluation = {
  r2_score: 0.95,
  rmse: 0.1,
  mae_avg: 0.08,
  pearson_corr: null,
  relative_l2: null,
};

function run(overrides: Partial<RunView> = {}): RunView {
  return {
    plan_id: id,
    run_id: id,
    request_id: id,
    backend: 'local',
    operation: 'test',
    attempt: 1,
    state: 'completed',
    uncertainty: false,
    submission_requested: true,
    cancellation_requested: false,
    evidence: null,
    summary,
    evaluation,
    ...overrides,
  };
}

describe('checkpointLabel', () => {
  it.each([
    { name: 'best_checkpoint', expected: { key: 'results.versionBest' } },
    { name: 'interrupted_checkpoint', expected: { key: 'results.versionInterrupted' } },
    { name: 'epoch_0_checkpoint', expected: { key: 'results.versionEpoch', params: { epoch: 0 } } },
    { name: 'epoch_0040_checkpoint', expected: { key: 'results.versionEpoch', params: { epoch: 40 } } },
    { name: 'epoch_123_checkpoint', expected: { key: 'results.versionEpoch', params: { epoch: 123 } } },
    { name: 'epoch_40', expected: null },
    { name: 'epoch_-1_checkpoint', expected: null },
    { name: 'epoch_1.5_checkpoint', expected: null },
    { name: 'epoch_1_checkpoint/weights.pt', expected: null },
    { name: 'custom_checkpoint', expected: null },
    { name: '', expected: null },
    { name: null, expected: null },
    { name: undefined, expected: null },
  ])('labels $name', ({ name, expected }) => {
    expect(checkpointLabel(name)).toEqual(expected);
  });
});

describe('test run identity', () => {
  it.each([
    { operation: 'train', expected: false },
    { operation: 'test', expected: true },
    { operation: 'plot', expected: true },
  ] satisfies { operation: RunView['operation']; expected: boolean }[])(
    'classifies $operation',
    ({ operation, expected }) => expect(isTestRun(run({ operation }))).toBe(expected),
  );

  it('prefers the parent name, falls back to its model, and handles older daemons', () => {
    expect(
      parentTitle(run({ summary: { ...summary, source_name: 'Experiment', source_model: 'MLP' } })),
    ).toBe('Experiment');
    expect(
      parentTitle(run({ summary: { ...summary, source_name: null, source_model: 'MLP' } })),
    ).toBe('MLP');
    expect(parentTitle(run())).toBeNull();
    expect(parentTitle(run({ summary: null }))).toBeNull();
    expect(parentTitle(run({ summary: undefined }))).toBeNull();
  });
});

describe('isCompareEligible', () => {
  it.each([
    { label: 'completed test with evaluation', overrides: {}, expected: true },
    { label: 'running test', overrides: { state: 'running' }, expected: false },
    { label: 'failed test', overrides: { state: 'failed' }, expected: false },
    { label: 'cancelled test', overrides: { state: 'cancelled' }, expected: false },
    { label: 'uncertain test', overrides: { uncertainty: true }, expected: false },
    { label: 'plot run', overrides: { operation: 'plot' }, expected: false },
    { label: 'training run', overrides: { operation: 'train' }, expected: false },
    { label: 'export-only test', overrides: { evaluation: null }, expected: false },
    { label: 'older daemon', overrides: { evaluation: undefined }, expected: false },
  ] satisfies { label: string; overrides: Partial<RunView>; expected: boolean }[])(
    '$label',
    ({ overrides, expected }) => expect(isCompareEligible(run(overrides))).toBe(expected),
  );
});

describe('testLocation', () => {
  it.each([
    { label: 'child test', overrides: {}, expected: `/results/${sourceId}?test=${id}` },
    {
      label: 'child plot',
      overrides: { operation: 'plot' },
      expected: `/results/${sourceId}?test=${id}`,
    },
    {
      label: 'orphan',
      overrides: { summary: { ...summary, source_run_id: null } },
      expected: `/tests/${id}`,
    },
    { label: 'missing summary', overrides: { summary: undefined }, expected: `/tests/${id}` },
    { label: 'null summary', overrides: { summary: null }, expected: `/tests/${id}` },
    { label: 'training run', overrides: { operation: 'train' }, expected: `/results/${id}` },
  ] satisfies { label: string; overrides: Partial<RunView>; expected: string }[])(
    'routes $label',
    ({ overrides, expected }) => expect(testLocation(run(overrides))).toBe(expected),
  );
});
