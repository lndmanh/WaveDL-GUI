import type { RuntimeMetricField } from '../shared/schemas/metric-history';

export type PlotChannel = 'loss' | 'r2' | 'lr';

export interface PlotPoint {
  step: number;
  values: Partial<Record<RuntimeMetricField, number | null>>;
}

export interface PlotSeries {
  points: readonly PlotPoint[];
  fields: readonly RuntimeMetricField[];
  pointCount: number;
}
