import { z } from 'zod';

export type Json = null | boolean | number | string | Json[] | JsonObject;

export type JsonObject = { [key: string]: Json };

export const jsonScalarSchema = z.union([z.null(), z.string(), z.boolean(), z.number().finite()]);

// Used only while walking a bounded value; children are validated individually
// so depth/node failures retain their original diagnostic and short-circuiting.
export const jsonContainerSchema = z.record(z.string(), z.unknown());

// The transport validates every child before domain schemas use this guard.
// Keep the original object, including legal JSON members such as __proto__.
export const jsonObjectSchema = z.custom<JsonObject>((value) =>
  jsonContainerSchema.safeParse(value).success,
);

export const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    jsonScalarSchema,
    z.array(jsonSchema),
    jsonObjectSchema.refine((value) => Object.values(value).every((child) => jsonSchema.safeParse(child).success)),
  ]),
);
