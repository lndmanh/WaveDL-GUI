import { describe, expect, it } from 'vitest';
import { buildPlotSeries, MAX_PLOT_RECORDS } from '../../workstation/lib/plot-series';
import { MetricHistory, type MetricRecord } from '../../workstation/lib/metric-history';
import type { RunEvent } from '../../workstation/lib/event-stream';

function record(step: number, changes: Partial<MetricRecord> = {}): MetricRecord {
  return {
    runId: 'run',
    attempt: 1,
    seq: step,
    step,
    name: 'epoch',
    value: step,
    unit: '',
    metrics: { train_loss: step / 10 },
    sourceGeneration: null,
    active: true,
    ...changes,
  };
}
function event(attempt: number, seq: number, type: string, payload: RunEvent['payload']): RunEvent {
  return {
    protocol: 'wavedl-jsonl',
    version: 1,
    run_id: 'run',
    attempt,
    seq,
    type,
    ts: '2026-10-07T00:00:00Z',
    payload,
  };
}
describe('causal uPlot adapter', () => {
  it('sorts unique sparse steps and aligns null and missing fields without interpolation', () => {
    const rows = [
      record(9, { metrics: { val_loss: 2 } }),
      record(1),
      record(5, { metrics: { train_loss: null } }),
    ];
    expect(buildPlotSeries(rows, 'loss').data).toEqual([
      [1, 5, 9],
      [0.1, null, null],
      [null, null, 2],
    ]);
    expect(rows.map((row) => row.step)).toEqual([9, 1, 5]);
  });
  it('chooses newest causal per-field value regardless of input order and ignores inactive tails', () => {
    expect(
      buildPlotSeries(
        [
          record(1, { attempt: 2, seq: 3, metrics: { train_loss: null } }),
          record(1, { seq: 100, metrics: { train_loss: 9, val_loss: 4 } }),
          record(1, { attempt: 2, seq: 2, metrics: { train_loss: 8 } }),
          record(2, { active: false }),
        ],
        'loss',
      ).data,
    ).toEqual([[1], [null], [4]]);
  });
  it('projects named records, zero and negative R² and never coerces nonfinite fields', () => {
    expect(
      buildPlotSeries(
        [
          record(1, { name: 'r2', value: -2, metrics: { val_r2: 0 } }),
          record(2, { metrics: { r2: Infinity, val_r2: '3' } }),
        ],
        'r2',
      ).data,
    ).toEqual([[1], [-2], [0]]);
    expect(buildPlotSeries([record(1, { name: 'lr', value: 0, metrics: {} })], 'lr').data).toEqual([
      [1],
      [0],
    ]);
  });
  it('rebuilds restored branches and accepts replacement metrics after restore', () => {
    const history = new MetricHistory('run');
    for (let step = 1; step <= 3; step++)
      history.apply(event(1, step, 'metric', { name: 'train_loss', value: step, step }));
    expect(buildPlotSeries(history.metrics(), 'loss').data[0]).toEqual([1, 2, 3]);
    history.apply(
      event(2, 0, 'supersede', { source_attempt: 1, step: 1, generation: 'checkpoint-1' }),
    );
    expect(buildPlotSeries(history.metrics({ activeOnly: false }), 'loss').data).toEqual([
      [1],
      [1],
      [null],
    ]);
    history.apply(event(2, 1, 'metric', { name: 'train_loss', value: 0.2, step: 2 }));
    expect(buildPlotSeries(history.metrics({ activeOnly: false }), 'loss').data).toEqual([
      [1, 2],
      [1, 0.2],
      [null, null],
    ]);
  });
  it('handles 100k steps in one fixed-field scan and reports capacity overflow explicitly', () => {
    let reads = 0;
    const rows = Array.from({ length: 100_000 }, (_, step) =>
      record(step, {
        metrics: {
          get train_loss() {
            reads++;
            return step / 100_000;
          },
          val_loss: null,
        },
      }),
    );
    const result = buildPlotSeries(rows, 'loss');
    expect(reads).toBe(100_000);
    expect(result.pointCount).toBe(100_000);
    expect(result.data[1]?.[99_999]).toBe(0.99999);
    expect(result.data[2]?.length).toBe(100_000);
    expect(() => buildPlotSeries(Array(MAX_PLOT_RECORDS + 1), 'loss')).toThrow('capacity exceeded');
  });
});
