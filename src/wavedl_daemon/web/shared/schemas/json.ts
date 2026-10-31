import { z } from 'zod';

export type Json = null | boolean | number | string | Json[] | JsonObject;

export type JsonObject = { [key: string]: Json };

export const jsonScalarSchema = z.union([z.null(), z.string(), z.boolean(), z.number().finite()]);

export const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([jsonScalarSchema, z.array(jsonSchema), z.record(z.string(), jsonSchema)]),
);

export const jsonObjectSchema = z.record(z.string(), jsonSchema);
