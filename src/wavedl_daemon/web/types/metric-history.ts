import type { MetricDetails } from '../shared/schemas/metric-history';
import type { RunProgress } from './daemon-api';

export interface MetricRecord {
  runId: string;
  attempt: number;
  seq: number;
  step: number;
  name: string;
  value: number | null;
  unit: string;
  metrics: MetricDetails;
  active: boolean;
}

export interface MetricSummary {
  progress: RunProgress | null;
  best: number | null;
  latest: MetricRecord | null;
  /** Present only when the selected runtime has emitted metrics. */
  current?: RuntimeMetricSummary;
}

export interface MetricHealth {
  label: string;
  value: string;
  status: string;
  severity: 'good' | 'warning' | 'error';
}

export interface RuntimeMetricSummary {
  trainLoss: number | null;
  validationLoss: number | null;
  r2: number | null;
  bestR2: number | null;
  learningRate: number | null;
  pearson: number | null;
  gradientNorm: number | null;
  mae: number | null;
  epochSeconds: number | null;
  elapsedSeconds: number | null;
  patience: { used: number; maximum: number; fraction: number } | null;
  parameters: { name: string; value: number | null }[];
  health: MetricHealth[];
}

export type NumericPoint = Pick<MetricRecord, 'attempt' | 'seq' | 'step' | 'value'>;
