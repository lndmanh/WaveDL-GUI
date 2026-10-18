import { ArtifactClient, type Artifact } from './artifact-client';
import type { ConnectionSession } from './connection-session';
import { object, parseJson } from './daemon-api';

export const CV_SUMMARY_BUDGET = 1024 * 1024;
export type CvMetric = number | null;
export interface CvFold {
  fold: number;
  best_epoch: number;
  epochs_trained: number;
  best_val_loss: CvMetric;
  r2: CvMetric;
  mae_normalized: CvMetric;
  mae_physical: CvMetric;
  targets: readonly { index: number; r2: CvMetric; mae: CvMetric }[];
}
export interface CvSummary {
  timestamp: string;
  folds: number;
  r2_mean: CvMetric;
  r2_std: CvMetric;
  mae_mean: CvMetric;
  mae_std: CvMetric;
  val_loss_mean: CvMetric;
  val_loss_std: CvMetric;
  fold_results: readonly CvFold[];
}
const invalid = (): never => {
  throw new Error('Invalid cross-validation summary.');
};
function metric(value: unknown): CvMetric {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
    ? value
    : invalid();
}
function nonnegative(value: unknown): CvMetric {
  const result = metric(value);
  return result === null || result >= 0 ? result : invalid();
}
function integer(value: unknown, min: number, max: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : invalid();
}

/** Exact current Python producer schema; target labels are indices, not inferred names. */
export function parseCvSummary(value: unknown): CvSummary {
  if (!object(value)) return invalid();
  const keys = [
    'config',
    'timestamp',
    'folds',
    'r2_mean',
    'r2_std',
    'mae_mean',
    'mae_std',
    'val_loss_mean',
    'val_loss_std',
    'fold_results',
  ];
  if (Object.keys(value).sort().join() !== keys.sort().join() || !object(value.config))
    return invalid();
  const config = value.config;
  const configKeys = [
    'model',
    'folds',
    'stratify',
    'stratify_bins',
    'batch_size',
    'lr',
    'epochs',
    'patience',
    'loss',
    'optimizer',
    'scheduler',
  ];
  if (Object.keys(config).sort().join() !== configKeys.sort().join()) return invalid();
  for (const key of ['model', 'loss', 'optimizer', 'scheduler'])
    if (typeof config[key] !== 'string' || config[key].length > 256) return invalid();
  if (typeof config.stratify !== 'boolean') return invalid();
  for (const key of ['stratify_bins', 'batch_size', 'epochs']) integer(config[key], 1, 1_000_000);
  integer(config.patience, 0, 1_000_000);
  if (typeof config.lr !== 'number' || !Number.isFinite(config.lr) || config.lr <= 0)
    return invalid();
  const folds = integer(value.folds, 2, 256);
  if (
    config.folds !== folds ||
    typeof value.timestamp !== 'string' ||
    value.timestamp.length > 64 ||
    !Number.isFinite(Date.parse(value.timestamp))
  )
    return invalid();
  if (!Array.isArray(value.fold_results) || value.fold_results.length !== folds) return invalid();
  const seen = new Set<number>();
  let targetCount: number | undefined;
  const fold_results = value.fold_results.map((raw): CvFold => {
    if (!object(raw)) return invalid();
    const base = [
      'fold',
      'best_val_loss',
      'best_epoch',
      'r2',
      'mae_normalized',
      'mae_physical',
      'epochs_trained',
    ];
    const targetKeys = Object.keys(raw).filter((key) => !base.includes(key));
    if (
      targetKeys.length > 512 ||
      targetKeys.some((key) => !/^(r2|mae)_target_(0|[1-9]\d*)$/.test(key))
    )
      return invalid();
    const count = targetKeys.length / 2;
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count * folds > 4096 ||
      (targetCount !== undefined && count !== targetCount)
    )
      return invalid();
    targetCount = count;
    const targets = Array.from({ length: count }, (_, index) => ({
      index,
      r2: metric(raw[`r2_target_${index}`]),
      mae: nonnegative(raw[`mae_target_${index}`]),
    }));
    const fold = integer(raw.fold, 1, folds);
    if (seen.has(fold)) return invalid();
    seen.add(fold);
    const epochs_trained = integer(raw.epochs_trained, 1, 1_000_000);
    return {
      fold,
      epochs_trained,
      best_epoch: integer(raw.best_epoch, 0, epochs_trained),
      best_val_loss: nonnegative(raw.best_val_loss),
      r2: metric(raw.r2),
      mae_normalized: nonnegative(raw.mae_normalized),
      mae_physical: nonnegative(raw.mae_physical),
      targets,
    };
  });
  return {
    timestamp: value.timestamp,
    folds,
    r2_mean: metric(value.r2_mean),
    r2_std: nonnegative(value.r2_std),
    mae_mean: nonnegative(value.mae_mean),
    mae_std: nonnegative(value.mae_std),
    val_loss_mean: nonnegative(value.val_loss_mean),
    val_loss_std: nonnegative(value.val_loss_std),
    fold_results,
  };
}

export async function loadCvSummary(
  session: ConnectionSession,
  artifact: Artifact,
  signal?: AbortSignal,
): Promise<CvSummary> {
  const client = new ArtifactClient(session);
  client.assertSelection(artifact);
  if (artifact.path !== 'cv_summary.json' || artifact.size > CV_SUMMARY_BUDGET)
    throw new Error('Select a cross-validation summary within the 1 MiB limit.');
  const blob = await client.verifiedBlob(artifact, signal);
  signal?.throwIfAborted();
  const text = await blob.text();
  signal?.throwIfAborted();
  client.assertSelection(artifact);
  const summary = parseCvSummary(parseJson(text));
  signal?.throwIfAborted();
  client.assertSelection(artifact);
  return summary;
}
