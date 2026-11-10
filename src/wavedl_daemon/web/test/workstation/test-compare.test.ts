import { describe, expect, it } from 'vitest';
import { axisDomain, axisPosition, bestValue, metricChange, parameterRows, parseCompareQuery, rankByMetric, seriesColor } from '../../app/lib/test-compare';

const ids = Array.from({ length: 10 }, (_, index) => `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`);

describe('compare query', () => {
  it('drops invalid, duplicate and excess ids while preserving URL order', () => {
    expect(parseCompareQuery([ids[0]], null)).toEqual({ ids: [], ref: null, dropped: 1 });
    const result = parseCompareQuery([...ids, ids[0], 'bad'].join(','), ids[1]);
    expect(result).toEqual({ ids: ids.slice(0, 8), ref: ids[1], dropped: 4 });
  });
  it('falls back to the first valid id', () => {
    expect(parseCompareQuery(ids.slice(0, 2).join(','), 'bad').ref).toBe(ids[0]);
    expect(parseCompareQuery(undefined, undefined)).toEqual({ ids: [], ref: null, dropped: 0 });
  });
});

describe('metric changes', () => {
  it('uses signed absolute differences for scale-free scores', () => {
    expect(metricChange('r2_score', 0.962, 0.981)).toEqual({ text: '−0.019', better: false });
    expect(metricChange('pearson_corr', 0.99, 0.98)).toEqual({ text: '+0.010', better: true });
  });
  it('uses rounded relative percentages for errors', () => {
    expect(metricChange('rmse', 0.061, 0.042)).toEqual({ text: '+45%', better: false });
    expect(metricChange('mae_avg', 0.029, 0.031)).toEqual({ text: '−6%', better: true });
  });
  it('does not invent changes for missing, equal or non-finite values or a zero denominator', () => {
    expect(metricChange('r2_score', null, 0.9)).toBeNull();
    expect(metricChange('r2_score', 0.9, null)).toBeNull();
    expect(metricChange('r2_score', 0.9, 0.9)).toBeNull();
    expect(metricChange('rmse', 1, 0)).toBeNull();
    expect(metricChange('rmse', Infinity, 1)).toBeNull();
    expect(metricChange('pearson_corr', 0.367413034, 0.36741303)).toBeNull();
    expect(metricChange('rmse', 1.001, 1)).toBeNull();
  });
});

describe('ranking and axes', () => {
  const items = [{ id: 'a', value: null }, { id: 'b', value: 2 }, { id: 'c', value: 1 }, { id: 'd', value: 1 }];
  it('sorts stably, best first, nulls last', () => {
    expect(rankByMetric(items, 'rmse')).toEqual(['c', 'd', 'b', 'a']);
    expect(rankByMetric(items, 'r2_score')).toEqual(['b', 'c', 'd', 'a']);
  });
  it('pads domains including constant and empty inputs', () => {
    expect(axisDomain([1, 1, null])).toEqual([0.99, 1.01]);
    expect(axisDomain([0, 10])).toEqual([-1, 11]);
    expect(axisDomain([null])).toEqual([0, 1]);
  });
  it('always places better values to the right and clamps', () => {
    expect(axisPosition(0, [0, 1], 'rmse')).toBe(100);
    expect(axisPosition(1, [0, 1], 'r2_score')).toBe(100);
    expect(axisPosition(2, [0, 1], 'r2_score')).toBe(100);
    expect(bestValue([null, 2, 1], 'rmse')).toBe(1);
    expect(bestValue([null], 'r2_score')).toBeNull();
    expect(seriesColor(7)).toBe('var(--chart-8)');
  });
});

it('unions parameters by name, with index fallback and nulls for missing values', () => {
  const row = (index: number, name: string, r2: number) => ({ index, name, r2, relative_l2: null, mae: null, rmse: null });
  expect(parameterRows([[row(0, 'depth', 0.9), row(1, '', 0.8)], [row(0, 'speed', 0.7), row(1, '', 0.6)]])).toEqual([
    { name: 'depth', values: [0.9, null] },
    { name: 'P1', values: [0.8, 0.6] },
    { name: 'speed', values: [null, 0.7] },
  ]);
});
