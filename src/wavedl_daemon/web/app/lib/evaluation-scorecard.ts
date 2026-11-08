import { inferenceConfigSchema } from '../../shared/schemas/result-request';
import { jsonNumberSchema, jsonStringSchema } from '../../shared/schemas/json';
import { object } from './daemon-api';
import { pathName } from './run-overview';
import type { Json, JsonObject } from '~~/types/json';
import type { MetricRecord } from '~~/types/metric-history';

export type EvaluationMetric = 'r2_score' | 'pearson_corr' | 'rmse' | 'mae_avg' | 'relative_l2';

export type ParameterMetric = 'r2' | 'relative_l2' | 'mae' | 'rmse';

export interface ParameterScores {
  index: number;
  name: string;
  r2: number | null;
  relative_l2: number | null;
  mae: number | null;
  rmse: number | null;
}

export interface TrainingBaseline {
  epoch: number;
  validationLoss: number;
  r2_score: number | null;
  pearson_corr: number | null;
  mae_avg: number | null;
}

export function finiteMetric(value: Json | null | undefined): number | null {
  const result = jsonNumberSchema.safeParse(value);

  return result.success ? result.data : null;
}

export function scorecardMetrics(metrics: JsonObject): EvaluationMetric[] {
  const fields: EvaluationMetric[] = ['r2_score', 'pearson_corr', 'rmse', 'mae_avg'];

  if (Object.hasOwn(metrics, 'relative_l2')) fields.push('relative_l2');

  return fields;
}

export function evaluationPlanContext(manifest: JsonObject | undefined) {
  const config = object(manifest?.resolved_config) ? manifest.resolved_config : {};
  const checkpoint = jsonStringSchema.safeParse(config.checkpoint).data ?? null;
  const dataset = jsonStringSchema.safeParse(config.data_path).data ?? null;
  const names = inferenceConfigSchema.shape.param_names.safeParse(config.param_names).data;
  const parameterNames = names ?? [];

  return {
    checkpoint,
    dataset,
    parameterNames,
    bestCheckpoint: checkpoint !== null && pathName(checkpoint) === 'best_checkpoint',
  };
}

/** Parse only the daemon's flattened parameter fields, retaining explicit nulls. */
export function parameterScores(metrics: JsonObject, names: readonly string[] = []) {
  const rows = new Map<number, ParameterScores>();
  const available = new Set<ParameterMetric>();

  for (const [key, value] of Object.entries(metrics)) {
    const match = /^(r2|relative_l2|mae|rmse)_p(0|[1-9]\d*)$/.exec(key);

    if (!match) continue;
    const field = match[1];
    const index = Number(match[2]);

    if (!Number.isSafeInteger(index) || !isParameterMetric(field)) continue;
    available.add(field);

    const row = rows.get(index) ?? {
      index,
      name: `P${index}`,
      r2: null,
      relative_l2: null,
      mae: null,
      rmse: null,
    };

    row[field] = finiteMetric(value);
    rows.set(index, row);
  }

  const parameters = [...rows.values()].sort((left, right) => left.index - right.index);

  const named =
    names.length === parameters.length && parameters.every((row, index) => row.index === index);

  if (named) {
    for (const row of parameters) row.name = names[row.index] ?? row.name;
  }

  const order: ParameterMetric[] = ['r2', 'relative_l2', 'mae', 'rmse'];

  return { parameters, metrics: order.filter((metric) => available.has(metric)) };
}

export function isParameterMetric(value: unknown): value is ParameterMetric {
  return value === 'r2' || value === 'relative_l2' || value === 'mae' || value === 'rmse';
}

/** Best checkpoint follows validation loss, not the greatest observed R². */
export function trainingBaseline(records: readonly MetricRecord[]): TrainingBaseline | null {
  let best: TrainingBaseline | null = null;

  for (const record of records) {
    if (!record.active) continue;
    const loss = finiteMetric(record.metrics.val_loss);
    const epoch = finiteMetric(record.metrics.epoch);

    if (loss === null || epoch === null || !Number.isSafeInteger(epoch) || epoch < 0) continue;

    if (best && loss >= best.validationLoss) continue;
    best = {
      epoch,
      validationLoss: loss,
      r2_score: finiteMetric(record.metrics.val_r2),
      pearson_corr: finiteMetric(record.metrics.val_pearson),
      mae_avg: finiteMetric(record.metrics.val_mae_avg),
    };
  }

  return best;
}

export function baselineValue(baseline: TrainingBaseline, field: EvaluationMetric): number | null {
  if (field === 'rmse' || field === 'relative_l2') return null;

  return baseline[field];
}

export function comparisonDelta(
  test: number | null,
  validation: number | null,
  higherBetter: boolean,
) {
  if (test === null || validation === null) return null;
  const value = test - validation;
  const relative = Math.abs(value) / Math.max(Math.abs(validation), 1e-12);
  const improvement = higherBetter ? value > 0 : value < 0;
  // Both directions share the 1% band, so a negligible change never reads as a win or a loss.
  const significant = relative - 0.01 > Number.EPSILON * 8;
  const tone = !significant ? 'unchanged' : improvement ? 'better' : 'worse';

  return { value, tone };
}

export function parameterRanking(
  rows: readonly ParameterScores[],
  field: ParameterMetric,
  weakestFirst: boolean,
) {
  const scaleFree = field === 'r2' || field === 'relative_l2';
  const finite = rows.flatMap((row) => (row[field] === null ? [] : [row[field]]));

  const target =
    finite.length > 1 ? (field === 'r2' ? Math.min(...finite) : Math.max(...finite)) : null;

  const maximum = Math.max(0, ...finite.map(Math.abs));

  const weakest =
    scaleFree && target !== null ? rows.find((row) => row[field] === target)?.index : undefined;

  const ranked = rows.map((row) => {
    const value = row[field];

    const fraction =
      value === null
        ? 0
        : field === 'r2'
          ? Math.max(0, Math.min(1, value))
          : Math.abs(value) / (maximum || 1);

    return { ...row, value, fraction, weakest: row.index === weakest };
  });

  if (scaleFree && weakestFirst)
    ranked.sort((left, right) => {
      if (left.value === null) return right.value === null ? left.index - right.index : 1;

      if (right.value === null) return -1;

      return (
        (field === 'r2' ? left.value - right.value : right.value - left.value) ||
        left.index - right.index
      );
    });

  return ranked;
}
