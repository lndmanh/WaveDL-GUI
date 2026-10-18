import { describe, expect, it } from 'vitest';
import { MetricHistory } from '../../workstation/lib/metric-history';
import type { RunEvent } from '../../workstation/lib/event-stream';
import type { JsonObject, RunView } from '../../workstation/lib/daemon-api';

const runId = '00000000-0000-4000-8000-000000000001';
function event(seq: number, attempt = 1, type = 'metric', payload: JsonObject = {}): RunEvent {
  return {
    protocol: 'wavedl-jsonl',
    version: 1,
    run_id: runId,
    attempt,
    seq,
    type,
    ts: '2026-10-07T00:00:00Z',
    payload: type === 'metric' ? { name: 'epoch', value: 1, step: seq, ...payload } : payload,
  };
}
function restore(attempt: number, source: number, step: number, sourceSeq?: number): RunEvent {
  return event(0, attempt, 'supersede', {
    source_attempt: source,
    step,
    generation: `gen-${attempt}`,
    ...(sourceSeq === undefined ? {} : { source_seq: sourceSeq }),
  });
}
function scope(attempt: number | null, pending = false): RunView {
  return {
    plan_id: runId,
    run_id: runId,
    request_id: runId,
    backend: 'local',
    operation: 'train',
    attempt,
    state: 'running',
    uncertainty: false,
    submission_requested: true,
    cancellation_requested: false,
    evidence: { native_pending: pending },
  };
}
describe('numeric replay', () => {
  it('summarizes the real producer snapshot simultaneously without inventing missing fields', () => {
    const history = new MetricHistory(runId);
    history.apply(
      event(1, 1, 'metric', {
        metrics: {
          epoch: 2,
          total_epochs: 10,
          train_loss: 0.4,
          val_loss: 0.5,
          best_val_loss: 0.49,
          r2: 0.8,
          pearson: 0.9,
          grad_norm: 2,
          lr: 0.001,
          mae_avg: 0.2,
          mae_per_param: [0.1, null, 0.3],
          epoch_time: 3.2,
          total_time: 6.4,
          patience_counter: 1,
          max_patience: 5,
        },
      }),
    );
    expect(history.summary().current).toMatchObject({
      trainLoss: 0.4,
      validationLoss: 0.5,
      r2: 0.8,
      bestR2: 0.8,
      learningRate: 0.001,
      pearson: 0.9,
      gradientNorm: 2,
      mae: 0.2,
      epochSeconds: 3.2,
      elapsedSeconds: 6.4,
      patience: { used: 1, maximum: 5, fraction: 0.2 },
      parameters: [
        { name: 'P1', value: 0.1 },
        { name: 'P2', value: null },
        { name: 'P3', value: 0.3 },
      ],
    });
    expect(history.summary().current?.health.map((row) => row.status)).toEqual([
      'Moderate',
      'Normal',
      'Stable',
      'OK',
      'Plateau',
    ]);
    history.apply(
      event(2, 1, 'metric', { metrics: { r2: null, total_time: null, train_loss: 0 } }),
    );
    expect(history.summary().current).toMatchObject({
      trainLoss: 0,
      validationLoss: null,
      r2: null,
      bestR2: 0.8,
      elapsedSeconds: null,
      patience: null,
      parameters: [],
      health: [],
    });
  });
  it('withdraws replaced best R² and resets all current summaries across runtime boundaries', () => {
    const history = new MetricHistory(runId);
    history.apply(event(1, 1, 'metric', { metrics: { r2: 0.9, total_time: 99 } }));
    history.apply(event(2, 1, 'metric', { metrics: { r2: 0.5 } }));
    history.apply(event(3, 1, 'metric', { step: 1, metrics: { r2: null } }));
    expect(history.summary().current?.bestR2).toBe(0.5);
    history.apply(restore(2, 1, 2, 2));
    expect(history.summary().current).toBeUndefined();
    history.apply(event(1, 2, 'metric', { step: 3, metrics: { r2: -0.3 } }));
    expect(history.summary().current?.bestR2).toBe(-0.3);
    expect(history.summary().current?.elapsedSeconds).toBeNull();
    history.apply(event(4, 1, 'metric', { metrics: { r2: 1, total_time: 1000 } }));
    expect(history.summary().current?.bestR2).toBe(-0.3);
    history.setScope(scope(null, true));
    expect(history.summary().current).toBeUndefined();
    history.setScope(scope(3));
    history.apply(event(0, 3, 'hello'));
    expect(history.summary().current).toBeUndefined();
  });
  it('supports named parameter MAE and nulls without stale alternative-field fallback', () => {
    const history = new MetricHistory(runId);
    history.apply(
      event(1, 1, 'metric', {
        metrics: {
          r2: null,
          val_r2: 1,
          total_time: null,
          elapsed_time: 20,
          per_param_mae: { density: 0, speed: null },
        },
      }),
    );
    expect(history.summary().current).toMatchObject({
      r2: null,
      elapsedSeconds: null,
      parameters: [
        { name: 'density', value: 0 },
        { name: 'speed', value: null },
      ],
    });
    history.apply(event(2, 1, 'metric', { metrics: { MAE_Phys_P1: null, MAE_Phys_P2: 4 } }));
    expect(history.summary().current?.parameters).toEqual([
      { name: 'MAE_Phys_P1', value: null },
      { name: 'MAE_Phys_P2', value: 4 },
    ]);
  });
  it('requires explicit best loss before deriving convergence', () => {
    const history = new MetricHistory(runId);
    history.apply(
      event(1, 1, 'metric', {
        metrics: {
          epoch: 1,
          total_epochs: 5,
          val_loss: 1,
          best_val_loss: null,
        },
      }),
    );
    expect(history.summary().current?.health).toEqual([]);
  });
  it.each([
    {
      lr: 1e-8,
      grad_norm: 101,
      patience_counter: 9,
      expected: ['Very Low', 'Exploding', 'Critical', 'Diverging'],
    },
    {
      lr: 0.1,
      grad_norm: 1e-8,
      patience_counter: 6,
      expected: ['High', 'Vanishing', 'Elevated', 'Diverging'],
    },
  ])(
    'matches Qt health warnings only from emitted operands: $expected',
    ({ expected, ...details }) => {
      const history = new MetricHistory(runId);
      history.apply(
        event(1, 1, 'metric', {
          metrics: {
            ...details,
            max_patience: 10,
            epoch: 3,
            total_epochs: 5,
            val_loss: 1,
            best_val_loss: 0.5,
          },
        }),
      );
      expect(history.summary().current?.health.map((row) => row.status)).toEqual(expected);
      const copy = history.summary().current;
      if (copy) copy.health.length = 0;
      expect(history.summary().current?.health).toHaveLength(4);
    },
  );
  it('projects emitted detail fields without coercion and preserves numeric nulls', () => {
    const history = new MetricHistory(runId);
    history.apply(
      event(1, 1, 'metric', {
        metrics: {
          train_loss: 2,
          val_loss: null,
          mae_per_param: [null, 3],
          per_param_mae: { p0: null },
          epoch: 1,
          total_epochs: 4,
        },
      }),
    );
    expect(history.series('train_loss')).toEqual([{ attempt: 1, seq: 1, step: 1, value: 2 }]);
    expect(history.series('val_loss')[0]?.value).toBeNull();
    expect(history.series('missing')).toEqual([]);
    expect(history.series('mae_per_param')).toEqual([]);
    expect(history.series('epoch')[0]?.value).toBe(1);
  });
  it('keeps sparse sequences, ignores duplicates and replaces repeated steps', () => {
    const history = new MetricHistory(runId);
    history.apply(event(3));
    history.apply(event(9));
    history.apply(event(9));
    history.apply(event(12, 1, 'metric', { step: 9, value: null }));
    expect(history.metrics().map((row) => [row.step, row.value])).toEqual([
      [3, 1],
      [9, null],
    ]);
    expect(history.size).toBe(3);
  });
  it('restores the exact source branch and replaces its abandoned tail without freezing', () => {
    const history = new MetricHistory(runId);
    for (let step = 1; step <= 3; step++) history.apply(event(step));
    history.apply(restore(2, 1, 1));
    history.apply(event(1, 2, 'metric', { step: 2, value: 20 }));
    history.apply(restore(3, 1, 3));
    history.apply(event(1, 3, 'metric', { step: 4, value: 30 }));
    history.apply(restore(4, 2, 2));
    history.apply(event(1, 4, 'metric', { step: 3, value: 40 }));
    history.apply(event(4, 1, 'metric', { step: 5, value: 99 }));
    expect(history.metrics().map((row) => [row.step, row.value])).toEqual([
      [1, 1],
      [2, 20],
      [3, 40],
    ]);
    expect(history.metrics().at(-1)?.sourceGeneration).toBe('gen-4');
  });
  it('excludes delayed same-step events using the checkpoint sequence across nested branches', () => {
    const batch = [
      event(1),
      event(2),
      restore(2, 1, 2, 2),
      event(1, 2, 'metric', { step: 3, value: 20 }),
      event(3, 1, 'metric', { step: 2, value: 99 }),
      restore(3, 2, 3, 1),
      event(2, 2, 'metric', { step: 3, value: 98 }),
    ];
    const live = new MetricHistory(runId),
      replay = new MetricHistory(runId);
    batch.forEach((item) => live.apply(item));
    [...batch]
      .sort((a, b) => a.attempt - b.attempt || a.seq - b.seq)
      .forEach((item) => replay.apply(item));
    expect(live.metrics()).toEqual(replay.metrics());
    expect(live.metrics().map((row) => row.value)).toEqual([1, 1, 20]);
  });
  it('requires source authority, not a checkpoint artifact claiming an absent step', () => {
    const history = new MetricHistory(runId);
    expect(() => history.apply(restore(2, 1, 0))).toThrow('absent step');
    history.apply(event(0, 1, 'hello'));
    history.apply(restore(2, 1, 0));
    history.apply(event(1, 2, 'artifact', { kind: 'checkpoint', step: 8 }));
    expect(() => history.apply(restore(3, 2, 8))).toThrow('absent step');
    history.acknowledgeGeneration(2, 8, 'gen-3');
    history.apply(restore(3, 2, 8));
  });
  it.each([true, '1', Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid values atomically: %s',
    (value) => {
      const history = new MetricHistory(runId);
      expect(() => history.apply(event(1, 1, 'metric', { value }))).toThrow();
      expect(history.size).toBe(0);
      history.apply(event(1));
      expect(history.size).toBe(1);
    },
  );
  it('rejects foreign ownership, invalid details and source sequences', () => {
    const history = new MetricHistory(runId);
    expect(() => history.apply({ ...event(1), run_id: 'other' })).toThrow('ownership');
    expect(() => history.apply(event(1, 1, 'metric', { metrics: { train_loss: true } }))).toThrow(
      'numeric',
    );
    history.apply(event(1));
    expect(() => history.apply(restore(2, 1, 1, -1))).toThrow('boundary');
    history.apply(restore(2, 1, 1, 1));
    expect(() => history.apply({ ...restore(2, 1, 1), seq: 1 })).toThrow('already');
  });
  it('suppresses native pending and predecessor summaries while retaining historic points', () => {
    const history = new MetricHistory(runId);
    history.setScope(scope(1));
    history.apply(
      event(1, 1, 'metric', { metrics: { epoch: 1, total_epochs: 4, best_val_loss: 0.5 } }),
    );
    expect(history.summary().progress?.fraction).toBe(0.25);
    expect(history.summary().best).toBe(0.5);
    history.setScope(scope(null, true));
    expect(history.metrics({ live: true })).toEqual([]);
    expect(history.metrics()).toHaveLength(1);
    expect(history.summary().latest).toBeNull();
    history.setScope(scope(2));
    history.apply(restore(2, 1, 1));
    expect(history.summary().latest).toBeNull();
    history.apply(
      event(1, 2, 'metric', {
        step: 2,
        metrics: { epoch: 2, total_epochs: 4, best_val_loss: null },
      }),
    );
    expect(history.summary().progress?.fraction).toBe(0.5);
    expect(history.summary().best).toBeNull();
  });
  it('bounds retention explicitly without partially applying a rejected point', () => {
    const history = new MetricHistory(runId, { maxPoints: 2 });
    history.apply(event(1));
    history.apply(event(2));
    expect(() => history.apply(event(3))).toThrow('capacity');
    expect(history.size).toBe(2);
    history.apply(event(3, 1, 'log')); // Failed metric did not advance its cursor.
    const rows = history.metrics();
    if (rows[0]) rows[0].metrics.train_loss = 99;
    expect(history.metrics()[0]?.metrics.train_loss).toBeUndefined();
  });
  it('ingests 100k points incrementally within a measurable linear-work budget', () => {
    const history = new MetricHistory(runId, { maxPoints: 100_000 });
    const start = performance.now();
    for (let seq = 0; seq < 100_000; seq++) history.apply(event(seq));
    const elapsed = performance.now() - start;
    expect(history.size).toBe(100_000);
    expect(history.metrics()).toHaveLength(100_000);
    expect(elapsed).toBeLessThan(10_000);
  }, 20_000);
});
