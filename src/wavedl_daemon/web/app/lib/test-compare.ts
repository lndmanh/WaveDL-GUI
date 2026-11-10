import { isUuid } from './daemon-api';
import type { ParameterScores } from './evaluation-scorecard';

export type HeadlineMetric = 'r2_score' | 'rmse' | 'mae_avg' | 'pearson_corr';

export const headlineMetrics: { metric: HeadlineMetric; label: string }[] = [
  { metric: 'r2_score', label: 'R²' },
  { metric: 'rmse', label: 'RMSE' },
  { metric: 'mae_avg', label: 'MAE' },
  { metric: 'pearson_corr', label: 'Pearson' },
];

export function parseCompareQuery(ids: unknown, ref: unknown): { ids: string[]; ref: string | null; dropped: number } {
  const candidates = typeof ids === 'string' ? ids.split(',') : [];
  const kept: string[] = [];
  let dropped = ids === undefined || ids === null || typeof ids === 'string' ? 0 : 1;

  for (const id of candidates) {
    if (!isUuid(id) || kept.includes(id) || kept.length === 8) dropped++;
    else kept.push(id);
  }

  return { ids: kept, ref: typeof ref === 'string' && kept.includes(ref) ? ref : kept[0] ?? null, dropped };
}

export function lowerIsBetter(metric: HeadlineMetric): boolean {
  return metric === 'rmse' || metric === 'mae_avg';
}

export function metricChange(metric: HeadlineMetric, value: number | null, reference: number | null): { text: string; better: boolean } | null {
  if (value === null || reference === null || !Number.isFinite(value) || !Number.isFinite(reference) || value === reference) return null;
  const difference = value - reference;
  const lower = lowerIsBetter(metric);

  if (lower && reference === 0) return null;
  const rounded = lower ? Math.round(Math.abs(difference / reference) * 100) : Number(Math.abs(difference).toFixed(3));
  // Do not label floating-point noise as an improvement while displaying a zero change.
  if (rounded === 0) return null;
  const amount = lower ? `${rounded}%` : rounded.toFixed(3);

  return { text: `${difference < 0 ? '−' : '+'}${amount}`, better: lower ? difference < 0 : difference > 0 };
}

export function rankByMetric(items: readonly { id: string; value: number | null }[], metric: HeadlineMetric): string[] {
  return [...items].sort((left, right) => {
    if (left.value === null) return right.value === null ? 0 : 1;
    if (right.value === null) return -1;

    return lowerIsBetter(metric) ? left.value - right.value : right.value - left.value;
  }).map((item) => item.id);
}

export function axisDomain(values: readonly (number | null)[]): [number, number] {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));

  if (!finite.length) return [0, 1];
  const minimum = Math.min(...finite);
  const maximum = Math.max(...finite);
  const padding = (maximum - minimum) * 0.1 || 0.01;

  return [minimum - padding, maximum + padding];
}

export function axisPosition(value: number, domain: [number, number], metric: HeadlineMetric): number {
  const position = domain[0] === domain[1] ? 50 : Math.max(0, Math.min(100, (value - domain[0]) / (domain[1] - domain[0]) * 100));

  return lowerIsBetter(metric) ? 100 - position : position;
}

export function bestValue(values: readonly (number | null)[], metric: HeadlineMetric): number | null {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));

  return finite.length ? (lowerIsBetter(metric) ? Math.min(...finite) : Math.max(...finite)) : null;
}

export function seriesColor(index: number): string {
  return `var(--chart-${index + 1})`;
}

export function parameterRows(scores: readonly ParameterScores[][]): { name: string; values: (number | null)[] }[] {
  const rows = new Map<string, (number | null)[]>();

  scores.forEach((parameters, testIndex) => {
    for (const parameter of parameters) {
      const name = parameter.name || `P${parameter.index}`;
      const values = rows.get(name) ?? Array.from({ length: scores.length }, () => null);
      values[testIndex] = parameter.r2;
      rows.set(name, values);
    }
  });

  return [...rows].map(([name, values]) => ({ name, values }));
}

export function compareNumber(value: number | null): string {
  return value === null ? '—' : value.toFixed(3);
}
