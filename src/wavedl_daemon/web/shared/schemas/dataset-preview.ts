import { z } from 'zod';

export type PreviewValues = number | null | PreviewValues[];

export const previewValuesSchema: z.ZodType<PreviewValues> = z.lazy(() =>
  z.union([z.number().finite(), z.null(), z.array(previewValuesSchema)]),
);

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const number = z.number().finite().nullable();
const vector = z.array(number).max(512);
const tensorDimensions = z.array(integer.positive()).min(1).max(16);

const indices = z
  .array(integer)
  .max(512)
  .refine((items) => items.every((item, index) => index === 0 || item > (items[index - 1] ?? -1)));

const histogram = z.strictObject({
  feature_index: integer,
  counts: z.array(integer).length(32),
  edges: z.array(z.number().finite()).length(33),
});

export const datasetPreviewPendingSchema = z.strictObject({ status: z.literal('pending') });

export const datasetPreviewSchema = z.strictObject({
  schema_version: z.literal(1),
  format: z.enum(['npz', 'mat', 'h5', 'hdf5']),
  input_key: z
    .string()
    .min(1)
    .max(1024)
    .refine((value) => !value.includes('\0') && new TextEncoder().encode(value).length <= 1024),
  output_key: z
    .string()
    .min(1)
    .max(1024)
    .refine((value) => !value.includes('\0') && new TextEncoder().encode(value).length <= 1024),
  'input_shape': tensorDimensions,
  'output_shape': tensorDimensions,
  sample_indices: indices.min(1),
  input_sample_indices: indices.min(1),
  input_histograms: z.array(histogram).min(1).max(8),
  output_histograms: z.array(histogram).min(1).max(8),
  correlation: z.strictObject({
    feature_indices: indices.max(30),
    matrix: z.array(z.array(number).max(30)).max(30).nullable(),
  }),
  input_statistics: z.strictObject({
    feature_indices: indices.max(40),
    means: vector.max(40),
    stds: vector.max(40),
  }),
  scatter: z.strictObject({
    feature_indices: indices.max(8),
    output_index: z.literal(0),
    x: z.array(z.array(number).max(8)).max(512),
    y: vector,
  }),
  samples: z
    .array(
      z.strictObject({
        sample_index: integer,
        'feature_shape': z.array(integer.positive()).max(15),
        'shape': tensorDimensions,
        values: previewValuesSchema,
      }),
    )
    .min(1)
    .max(3),
  selection: z.strictObject({ root: z.string(), path: z.string() }),
});
