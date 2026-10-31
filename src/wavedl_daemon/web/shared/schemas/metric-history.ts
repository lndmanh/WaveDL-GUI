import { z } from 'zod';

export const metricIntegerSchema = (minimum = 0) => z.number().refine(Number.isSafeInteger).min(minimum);

export const metricValueSchema = z.number().finite().nullable();

export const metricPayloadSchema = z.object({
  name: z.string(),
  value: metricValueSchema,
  step: metricIntegerSchema(),
  unit: z.string().optional(),
});

export const metricGenerationSchema = z.string().min(1);
