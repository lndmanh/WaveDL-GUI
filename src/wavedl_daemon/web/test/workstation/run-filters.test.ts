import { describe, expect, it } from 'vitest';
import {
  activeRunFilterCount,
  createRunFilters,
  RUN_KINDS,
  runFilterCounts,
  runKindOf,
  runMatches,
  runMatchesFilters,
} from '../../app/lib/run-overview';
import { runKindMessageKeys } from '../../app/i18n/dynamic-keys';
import { runViewSchema } from '../../shared/schemas/daemon-api';
import type { RunState, RunSummary, RunView } from '../../types/daemon-api';
import type { RunCreatedFilter, RunKind } from '../../types/run-overview';

const now = new Date(2026, 10, 9, 12, 0, 0);
const day = 86_400_000;

function summary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    name: null,
    model: 'cnn',
    data_path: '/data/alpha.npz',
    epochs: null,
    cv: null,
    source_run_id: null,
    plot: false,
    export: null,
    ...overrides,
  };
}

function run(overrides: Partial<RunView> = {}): RunView {
  return {
    plan_id: '11111111-1111-4111-8111-111111111111',
    run_id: '22222222-2222-4222-8222-222222222222',
    request_id: '33333333-3333-4333-8333-333333333333',
    backend: 'local',
    operation: 'test',
    attempt: null,
    state: 'completed',
    uncertainty: false,
    submission_requested: true,
    cancellation_requested: false,
    evidence: null,
    created_at: now.toISOString(),
    summary: summary(),
    ...overrides,
  };
}

const training = run({ operation: 'train', state: 'running' });
const evaluation = run({ summary: summary({ model: 'transformer', data_path: '/data/beta.npz' }) });
const evaluationPlots = run({ state: 'failed', summary: summary({ plot: true }) });
const exported = run({ summary: summary({ export: 'onnx' }) });
const plotted = run({ operation: 'plot', state: 'planned' });
const runs = [training, evaluation, evaluationPlots, exported, plotted];

describe('run kinds', () => {
  it.each<[RunView, RunKind]>([
    [training, 'training'],
    [evaluation, 'evaluation'],
    [evaluationPlots, 'evaluation-plots'],
    [exported, 'onnx-export'],
    [plotted, 'plot'],
    [run({ summary: summary({ plot: true, export: 'onnx' }) }), 'onnx-export'],
    [run({ operation: 'train', summary: summary({ plot: true, export: 'onnx' }) }), 'training'],
    [run({ operation: 'plot', summary: summary({ export: 'onnx' }) }), 'plot'],
    [run({ summary: null }), 'evaluation'],
    [run({ summary: undefined }), 'evaluation'],
    [run({ summary: summary({ plot: undefined, export: undefined }) }), 'evaluation'],
  ])('derives the kind from the operation and approved output flags', (view, kind) => {
    expect(runKindOf(view)).toBe(kind);
  });

  it('has a dedicated label key for every kind', () => {
    expect(RUN_KINDS.map((kind) => runKindMessageKeys[kind])).toEqual([
      'runs.kindTraining',
      'runs.kindEvaluation',
      'runs.kindEvaluationPlots',
      'runs.kindOnnxExport',
      'runs.kindPlot',
    ]);
  });

  it('validates and preserves output flags without requiring them from older daemons', () => {
    expect(runViewSchema.parse(exported).summary).toEqual(exported.summary);
    expect(runViewSchema.parse(evaluationPlots).summary?.plot).toBe(true);
    const legacy = summary({ plot: undefined, export: undefined });
    expect(runViewSchema.safeParse(run({ summary: legacy })).success).toBe(true);
    expect(
      runViewSchema.safeParse({ ...evaluation, summary: { ...legacy, plot: 'true' } }).success,
    ).toBe(false);
    expect(
      runViewSchema.safeParse({ ...evaluation, summary: { ...legacy, export: true } }).success,
    ).toBe(false);
  });
});

describe('run filter groups', () => {
  it('starts unfiltered and creates independent, fully resettable state', () => {
    const first = createRunFilters();
    const second = createRunFilters();
    first.kinds.push('training');
    first.models.push('cnn');
    first.created = 'today';
    expect(activeRunFilterCount(first)).toBe(3);
    expect(activeRunFilterCount(second)).toBe(0);
    expect(runs.every((view) => runMatchesFilters(view, second, now))).toBe(true);
    expect(createRunFilters()).toEqual({
      kinds: [],
      states: [],
      models: [],
      datasets: [],
      created: 'any',
    });
  });

  it('combines alternatives within each group and intersects different groups', () => {
    const filters = createRunFilters();
    filters.kinds = ['training', 'evaluation-plots'];
    expect(runs.filter((view) => runMatchesFilters(view, filters, now))).toEqual([
      training,
      evaluationPlots,
    ]);
    filters.states = ['attention', 'completed'];
    expect(runs.filter((view) => runMatchesFilters(view, filters, now))).toEqual([evaluationPlots]);
    filters.models = ['cnn', 'transformer'];
    filters.datasets = ['alpha.npz', 'beta.npz'];
    expect(runs.filter((view) => runMatchesFilters(view, filters, now))).toEqual([evaluationPlots]);
    filters.datasets = ['missing.npz'];
    expect(runs.filter((view) => runMatchesFilters(view, filters, now))).toEqual([]);
    expect(activeRunFilterCount(filters)).toBe(7);
  });

  it('intersects filters with the existing case-insensitive text search and visible kind label', () => {
    const filters = createRunFilters();
    filters.kinds = ['evaluation', 'evaluation-plots'];

    const visible = runs.filter(
      (view) =>
        runMatchesFilters(view, filters, now) && runMatches(view, ' BETA.NPZ ', ['Evaluation']),
    );

    expect(visible).toEqual([evaluation]);
    expect(runMatches(exported, 'ONNX', ['ONNX export'])).toBe(true);
    expect(runMatches(evaluation, '  ')).toBe(true);
    expect(runMatches(evaluation, '22222222')).toBe(true);
    expect(runMatches(evaluation, 'transformer')).toBe(true);
  });

  it('matches models and final dataset path segments exactly, across host separators', () => {
    const filters = createRunFilters();
    filters.models = ['cnn'];
    filters.datasets = ['alpha.npz'];
    expect(
      runMatchesFilters(
        run({ summary: summary({ data_path: 'C:\\data\\alpha.npz' }) }),
        filters,
        now,
      ),
    ).toBe(true);
    expect(runMatchesFilters(run({ summary: summary({ model: 'CNN' }) }), filters, now)).toBe(
      false,
    );
    expect(
      runMatchesFilters(
        run({ summary: summary({ data_path: '/data/not-alpha.npz' }) }),
        filters,
        now,
      ),
    ).toBe(false);
    expect(runMatchesFilters(run({ summary: null }), filters, now)).toBe(false);
  });

  it.each<[RunState, 'live' | 'completed' | 'attention' | 'planned' | null]>([
    ['pending', 'live'],
    ['submitted', 'live'],
    ['queued', 'live'],
    ['held', 'live'],
    ['running', 'live'],
    ['stopping', 'live'],
    ['completed', 'completed'],
    ['failed', 'attention'],
    ['submission_unknown', 'attention'],
    ['terminal_unknown', 'attention'],
    ['observation_unavailable', 'attention'],
    ['supervision_lost', 'attention'],
    ['planned', 'planned'],
    ['cancelled', null],
  ])('uses the existing state grouping for %s', (state, group) => {
    const filters = createRunFilters();
    filters.states = ['live', 'completed', 'attention', 'planned'];
    expect(runMatchesFilters(run({ state }), filters, now)).toBe(group !== null);
    filters.states = ['live'];
    expect(runMatchesFilters(run({ state }), filters, now)).toBe(group === 'live');
  });
});

describe('creation-time filters', () => {
  it('uses local midnight for Today and includes the exact lower boundary', () => {
    const filters = { ...createRunFilters(), created: 'today' } satisfies ReturnType<
      typeof createRunFilters
    >;

    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    expect(
      runMatchesFilters(run({ created_at: new Date(midnight).toISOString() }), filters, now),
    ).toBe(true);
    expect(
      runMatchesFilters(run({ created_at: new Date(midnight - 1).toISOString() }), filters, now),
    ).toBe(false);
    expect(runMatchesFilters(run(), filters, now)).toBe(true);
  });

  it.each<[RunCreatedFilter, number]>([
    ['week', 7],
    ['month', 30],
  ])('uses a rolling %s window', (created, days) => {
    const filters = { ...createRunFilters(), created };
    const boundary = now.getTime() - days * day;
    expect(
      runMatchesFilters(run({ created_at: new Date(boundary).toISOString() }), filters, now),
    ).toBe(true);
    expect(
      runMatchesFilters(run({ created_at: new Date(boundary - 1).toISOString() }), filters, now),
    ).toBe(false);
  });

  it.each<RunCreatedFilter>(['today', 'week', 'month'])(
    'excludes unavailable, invalid and future dates from %s',
    (created) => {
      const filters = { ...createRunFilters(), created };

      for (const created_at of [
        undefined,
        null,
        'invalid',
        new Date(now.getTime() + 1).toISOString(),
      ]) {
        const view = run({ created_at });
        expect(runMatchesFilters(view, filters, now)).toBe(false);
        expect(runMatchesFilters(view, createRunFilters(), now)).toBe(true);
      }
    },
  );
});

describe('page-local filter counts', () => {
  it('counts all five kinds and existing state groups from the full loaded set', () => {
    expect(runFilterCounts(runs, now)).toEqual({
      kinds: { training: 1, evaluation: 1, 'evaluation-plots': 1, 'onnx-export': 1, plot: 1 },
      states: { all: 5, live: 1, completed: 2, attention: 1, planned: 1 },
      models: [
        { value: 'cnn', count: 4 },
        { value: 'transformer', count: 1 },
      ],
      datasets: [
        { value: 'alpha.npz', count: 4 },
        { value: 'beta.npz', count: 1 },
      ],
      created: { any: 5, today: 5, week: 5, month: 5 },
    });
    expect(
      runFilterCounts(
        runs.filter((view) => view.state !== 'planned'),
        now,
      ).states.planned,
    ).toBe(0);
  });

  it('merges dataset basenames, ignores missing values, and exposes absent kinds as zero', () => {
    const counts = runFilterCounts(
      [
        training,
        run({ summary: summary({ data_path: 'C:\\other\\alpha.npz' }) }),
        run({ summary: null }),
        run({ summary: summary({ model: '', data_path: '' }) }),
      ],
      now,
    );

    expect(counts.datasets).toEqual([{ value: 'alpha.npz', count: 2 }]);
    expect(counts.models).toEqual([{ value: 'cnn', count: 2 }]);
    expect(counts.kinds['onnx-export']).toBe(0);
    expect(runFilterCounts([], now)).toEqual({
      kinds: { training: 0, evaluation: 0, 'evaluation-plots': 0, 'onnx-export': 0, plot: 0 },
      states: { all: 0, live: 0, completed: 0, attention: 0, planned: 0 },
      models: [],
      datasets: [],
      created: { any: 0, today: 0, week: 0, month: 0 },
    });
  });
});
