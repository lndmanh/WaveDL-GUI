import { describe, expect, it } from 'vitest';
import {
  baselineValue,
  comparisonDelta,
  evaluationPlanContext,
  finiteMetric,
  parameterRanking,
  parameterScores,
  scorecardMetrics,
  trainingBaseline,
} from '../../app/lib/evaluation-scorecard';
import { MetricHistory } from '../../app/lib/metric-history';
import type { MetricRecord } from '../../types/metric-history';
import type { RunEvent } from '../../types/event-stream';

function record(
  metrics: MetricRecord['metrics'],
  overrides: Partial<MetricRecord> = {},
): MetricRecord {
  return {
    runId: 'source',
    attempt: 1,
    seq: 1,
    step: 1,
    name: 'epoch',
    value: null,
    unit: '',
    metrics,
    active: true,
    ...overrides,
  };
}

function event(attempt: number, seq: number, step: number, metrics: RunEvent['payload']): RunEvent {
  return {
    protocol: 'wavedl-run',
    version: 2,
    run_id: 'source',
    attempt,
    seq,
    type: 'metric',
    ts: '2026-10-07T00:00:00Z',
    payload: { name: 'epoch', value: null, step, metrics },
  };
}

describe('evaluation scorecard parsing', () => {
  it('keeps the four headline fields and adds relative L2 only when emitted, even null', () => {
    expect(scorecardMetrics({})).toEqual(['r2_score', 'pearson_corr', 'rmse', 'mae_avg']);
    expect(scorecardMetrics({ relative_l2: null })).toEqual([
      'r2_score',
      'pearson_corr',
      'rmse',
      'mae_avg',
      'relative_l2',
    ]);

    for (const invalid of [null, undefined, '0.9', false, Infinity, NaN])
      expect(finiteMetric(invalid)).toBeNull();
    expect(finiteMetric(-0.3)).toBe(-0.3);
  });

  it('parses all flattened parameter metric families and defaults to R² then relative L2 then MAE', () => {
    const parsed = parameterScores({
      rmse_p0: 2,
      mae_p1: 0.2,
      relative_l2_p0: 0.1,
      r2_p0: -0.5,
      r2_p1: null,
      mae_p0: 1,
    });

    expect(parsed.metrics).toEqual(['r2', 'relative_l2', 'mae', 'rmse']);
    expect(parsed.parameters).toEqual([
      { index: 0, name: 'P0', r2: -0.5, relative_l2: 0.1, mae: 1, rmse: 2 },
      { index: 1, name: 'P1', r2: null, relative_l2: null, mae: 0.2, rmse: null },
    ]);
    expect(parameterScores({ mae_p0: 1, relative_l2_p0: 2 }).metrics[0]).toBe('relative_l2');
    expect(parameterScores({ mae_p0: 1 }).metrics[0]).toBe('mae');
  });

  it('rejects misleading prefixes, suffixes, leading zeros, unsafe indices and nonnumeric values', () => {
    const parsed = parameterScores({
      r2_p01: 0.1,
      mae_per_param: [1],
      mae_p0_backup: 1,
      rmse_p9007199254740992: 1,
      r2_p0: '0.9',
      mae_p0: Infinity,
    });

    expect(parsed.parameters).toEqual([
      { index: 0, name: 'P0', r2: null, mae: null, rmse: null, relative_l2: null },
    ]);
    expect(parameterScores({ pearson_p0: 0.8 }).parameters).toEqual([]);
  });

  it('uses plan names only with an exact matching parameter count and contiguous indices', () => {
    expect(
      parameterScores({ mae_p0: 1, mae_p1: 2 }, ['Pressure', 'Speed']).parameters.map(
        (row) => row.name,
      ),
    ).toEqual(['Pressure', 'Speed']);
    expect(
      parameterScores({ mae_p0: 1, mae_p1: 2 }, ['Pressure']).parameters.map((row) => row.name),
    ).toEqual(['P0', 'P1']);
    expect(parameterScores({ mae_p4: 1 }, ['Pressure']).parameters[0]?.name).toBe('P4');
  });

  it('resolves only the exact checkpoint config and never confuses a filename substring with best checkpoint', () => {
    expect(
      evaluationPlanContext({
        resolved_config: {
          checkpoint: 'C:\\runs\\best_checkpoint\\',
          data_path: '/data/test.npz',
          param_names: ['A', 'B'],
        },
      }),
    ).toMatchObject({
      bestCheckpoint: true,
      parameterNames: ['A', 'B'],
      dataset: '/data/test.npz',
    });

    for (const checkpoint of [
      '/x/best_checkpoint_backup',
      '/x/best_checkpoint/model.bin',
      '/x/epoch_3_checkpoint',
    ])
      expect(evaluationPlanContext({ resolved_config: { checkpoint } }).bestCheckpoint).toBe(false);
    expect(evaluationPlanContext({ checkpoint: '/x/best_checkpoint' }).bestCheckpoint).toBe(false);
    expect(
      evaluationPlanContext({ resolved_config: { param_names: ['A', 2] } }).parameterNames,
    ).toEqual([]);
  });
});

describe('validation baseline', () => {
  it('selects active minimum val_loss, not maximum R², and takes all fields from the same epoch', () => {
    const best = trainingBaseline([
      record({ epoch: 1, val_loss: 0.4, val_r2: 0.99, val_pearson: 0.98, val_mae_avg: 0.1 }),
      record({ epoch: 2, val_loss: 0.2, val_r2: 0.8, val_pearson: 0.9, val_mae_avg: 0.3 }),
      record({ epoch: 3, val_loss: 0.1, val_r2: 1 }, { active: false }),
      record({ epoch: 4, val_loss: null, val_r2: 1 }),
    ]);

    expect(best).toEqual({
      epoch: 2,
      validationLoss: 0.2,
      r2_score: 0.8,
      pearson_corr: 0.9,
      mae_avg: 0.3,
    });

    if (!best) throw new Error('Missing baseline');
    expect(baselineValue(best, 'rmse')).toBeNull();
    expect(baselineValue(best, 'relative_l2')).toBeNull();
    expect(baselineValue(best, 'r2_score')).toBe(0.8);
  });

  it('keeps the first loss tie and does not invent missing validation fields or epochs', () => {
    expect(
      trainingBaseline([
        record({ epoch: 3, val_loss: 0.2 }),
        record({ epoch: 4, val_loss: 0.2, val_r2: 1 }),
      ]),
    ).toEqual({ epoch: 3, validationLoss: 0.2, r2_score: null, pearson_corr: null, mae_avg: null });
    expect(
      trainingBaseline([record({ val_loss: 0.2 }), record({ epoch: 1, val_loss: null })]),
    ).toBeNull();
  });

  it('respects MetricHistory resume invalidation and duplicate-step replacement', () => {
    const history = new MetricHistory('source');
    history.apply(event(1, 1, 1, { epoch: 1, val_loss: 0.5, val_r2: 0.8 }));
    history.apply(event(1, 2, 2, { epoch: 2, val_loss: 0.01, val_r2: 0.99 }));
    history.apply(event(2, 1, 2, { epoch: 2, val_loss: 0.4, val_r2: 0.85 }));
    history.apply(event(2, 2, 2, { epoch: 2, val_loss: 0.3, val_r2: 0.9 }));
    expect(trainingBaseline(history.metrics({ activeOnly: false }))).toMatchObject({
      epoch: 2,
      validationLoss: 0.3,
      r2_score: 0.9,
    });
  });

  it('uses metric direction and a strict greater-than-one-percent warning threshold', () => {
    expect(comparisonDelta(0.89, 0.9, true)?.tone).toBe('worse');
    expect(comparisonDelta(101, 100, false)?.tone).toBe('unchanged');
    expect(comparisonDelta(0.891, 0.9, true)?.tone).toBe('unchanged');
    expect(comparisonDelta(101.01, 100, false)?.tone).toBe('worse');
    expect(comparisonDelta(99.9, 100, false)?.tone).toBe('better');
    expect(comparisonDelta(-0.1, -0.2, true)?.tone).toBe('better');
    expect(comparisonDelta(0.1, 0, false)?.tone).toBe('worse');
    expect(comparisonDelta(null, 1, true)).toBeNull();
    expect(comparisonDelta(1, null, true)).toBeNull();
  });
});

describe('per-parameter comparison', () => {
  it('does not label unavailable parameters or an unopposed score weakest', () => {
    for (const metrics of [{ r2_p0: null, r2_p1: null }, { r2_p0: 0.9, r2_p1: null }]) {
      const parsed = parameterScores(metrics);
      expect(parameterRanking(parsed.parameters, 'r2', false).every((row) => !row.weakest)).toBe(true);
    }
  });

  const rows = parameterScores({
    r2_p0: 0.9,
    r2_p1: -0.5,
    r2_p2: null,
    relative_l2_p0: 0.1,
    relative_l2_p1: 0.4,
    mae_p0: 2,
    mae_p1: 200,
  }).parameters;

  it('uses an absolute clamped R² scale and sorts weakest finite score first', () => {
    const ranked = parameterRanking(rows, 'r2', true);
    expect(ranked.map((row) => row.index)).toEqual([1, 0, 2]);
    expect(ranked[0]).toMatchObject({ fraction: 0, weakest: true });
    expect(ranked[1]?.fraction).toBe(0.9);
    expect(
      parameterRanking(parameterScores({ r2_p0: 3 }).parameters, 'r2', false)[0]?.fraction,
    ).toBe(1);
  });

  it('uses max-relative Relative L2 bars and never ranks absolute errors across units', () => {
    const ranked = parameterRanking(rows, 'relative_l2', true);
    expect(ranked.map((row) => row.index)).toEqual([1, 0, 2]);
    expect(ranked[0]).toMatchObject({ fraction: 1, weakest: true });
    expect(ranked[1]?.fraction).toBe(0.25);
    const absolute = parameterRanking(rows, 'mae', true);
    expect(absolute.map((row) => row.index)).toEqual([0, 1, 2]);
    expect(absolute.every((row) => !row.weakest)).toBe(true);
  });
});
