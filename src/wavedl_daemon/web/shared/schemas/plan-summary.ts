import { z } from 'zod';
import { jsonObjectSchema, jsonScalarSchema } from './json';
import { storageMappingSchema } from './storage-mapping';

const optionalText = z.string().optional().catch(undefined);
const runtimeSchema = z.object({
  python: optionalText,
  mode: optionalText,
  device: optionalText,
  container: z.string().nullable().optional().catch(undefined),
  environment: z.record(z.string(), z.string()).optional().catch(undefined),
});
const planReviewSchema = z.object({
  operation: optionalText,
  resolved_config: jsonObjectSchema.catch({}).default({}),
  runtime: runtimeSchema.catch(() => runtimeSchema.parse({})),
  run_directory: optionalText,
  working_directory: optionalText,
  storage_map: z.array(storageMappingSchema).optional().catch(undefined),
});

export const planManifestSchema = jsonObjectSchema.transform((manifest) => ({
  manifest,
  review: planReviewSchema.parse(manifest),
}));

const topologySchema = z.object({
  num_machines: z.number().int().positive().optional().catch(undefined),
  processes_per_machine: z.number().int().positive().optional().catch(undefined),
});

export const planPreviewContextSchema = z.object({
  target: optionalText,
  topology: topologySchema.catch({}).default({}),
  resources: z
    .array(z.tuple([z.string(), jsonScalarSchema]))
    .optional()
    .catch(undefined),
  environment: z
    .array(z.tuple([z.string(), z.string()]))
    .optional()
    .catch(undefined),
  warnings: z.array(z.string()).optional().catch(undefined),
});
