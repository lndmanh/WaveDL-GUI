import { z } from 'zod';

export const cvMetricSchema = z.number().finite().nullable();

export const cvNonnegativeSchema = z.number().finite().nonnegative().nullable();

export const cvIntegerSchema = (minimum: number, maximum: number) =>
  z.number().refine(Number.isSafeInteger).min(minimum).max(maximum);

const text = z.string().max(256);
const config = z.strictObject({
  model: text,
  folds: cvIntegerSchema(2, 256),
  stratify: z.boolean(),
  stratify_bins: cvIntegerSchema(1, 1_000_000),
  batch_size: cvIntegerSchema(1, 1_000_000),
  lr: z.number().finite().positive(),
  epochs: cvIntegerSchema(1, 1_000_000),
  patience: cvIntegerSchema(0, 1_000_000),
  loss: text,
  optimizer: text,
  scheduler: text,
});

export const cvSummarySchema = z.strictObject({
  config,
  timestamp: z.string().max(64).refine((value) => Number.isFinite(Date.parse(value))),
  folds: cvIntegerSchema(2, 256),
  r2_mean: cvMetricSchema,
  r2_std: cvNonnegativeSchema,
  mae_mean: cvNonnegativeSchema,
  mae_std: cvNonnegativeSchema,
  val_loss_mean: cvNonnegativeSchema,
  val_loss_std: cvNonnegativeSchema,
  fold_results: z.array(z.object({
    fold: cvIntegerSchema(1, 256),
    best_val_loss: cvNonnegativeSchema,
    best_epoch: cvIntegerSchema(0, 1_000_000),
    r2: cvMetricSchema,
    mae_normalized: cvNonnegativeSchema,
    mae_physical: cvNonnegativeSchema,
    epochs_trained: cvIntegerSchema(1, 1_000_000),
  }).catchall(cvMetricSchema)),
}).refine((value) => value.config.folds === value.folds && value.fold_results.length === value.folds);
