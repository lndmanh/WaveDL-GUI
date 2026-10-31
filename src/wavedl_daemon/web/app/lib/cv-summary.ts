import { clientError } from '../i18n/client-messages';
import { ArtifactClient, type Artifact } from './artifact-client';
import type { ConnectionSession } from './connection-session';
import { parseJson, type Json } from './daemon-api';
import { cvSummarySchema, cvMetricSchema, cvNonnegativeSchema, cvIntegerSchema } from '../../shared/schemas/cv-summary';

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
  throw clientError('invalidCrossValidationSummary', {});
};

function metric(value: Json | undefined): CvMetric {
  const parsed = cvMetricSchema.safeParse(value);

  return parsed.success ? parsed.data : invalid();
}

function nonnegative(value: Json | undefined): CvMetric {
  const parsed = cvNonnegativeSchema.safeParse(value);

  return parsed.success ? parsed.data : invalid();
}

function integer(value: Json | undefined, min: number, max: number): number {
  const parsed = cvIntegerSchema(min, max).safeParse(value);

  return parsed.success ? parsed.data : invalid();
}

/** Exact current Python producer schema; target labels are indices, not inferred names. */
export function parseCvSummary(input: Json): CvSummary {
  const parsed = cvSummarySchema.safeParse(input);

  if (!parsed.success) return invalid();
  const value = parsed.data;
  const folds = value.folds;
  const seen = new Set<number>();
  let targetCount: number | undefined;

  const fold_results = value.fold_results.map((raw): CvFold => {
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
    throw clientError('cvSummaryTooLarge', {});
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
