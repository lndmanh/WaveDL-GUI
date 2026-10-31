import { z } from 'zod';

export const artifactPathSchema = z.string().max(4096).refine((value) =>
  !/[\\:%]/.test(value) &&
  !Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) &&
  value.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
);

const integer = z.number().refine(Number.isSafeInteger);

export const inventorySchema = z.strictObject({
  generations: z.array(z.strictObject({
    generation: z.string().regex(/^gen-\d{6,}$/),
    attempt: integer.refine((value) => value >= 1),
    step: integer.refine((value) => value >= 0),
    files: z.record(artifactPathSchema, z.strictObject({
      size: integer.refine((value) => value >= 0),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    })),
  })).max(4096),
});

export const selectionMetadataSchema = z.strictObject({
  schema_version: z.literal(1),
  kind: z.enum(['best', 'periodic', 'interrupted', 'cross_validation_fold', 'cross_validation_summary']),
  fold: integer.refine((value) => value >= 1).optional(),
  source_seq: integer.refine((value) => value >= 0).optional(),
}).refine((value) => value.fold === undefined || value.kind === 'cross_validation_fold');
