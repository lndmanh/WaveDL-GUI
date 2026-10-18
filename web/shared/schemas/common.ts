import { z } from 'zod';

export const positiveIdSchema = z.coerce.number().int().positive('validation.id_required');

export const userIdSchema = z.coerce.number().int().positive('validation.user_id_required');

export const coerceDateFields = {
  createdAt: z.coerce.date().nullish(),
  updatedAt: z.coerce.date().nullish(),
};

export function nonEmptyStringSchema(messageKey: string) {
  return z.string().trim().min(1, messageKey);
}

export function requiredStringSchema(messageKey: string) {
  return z.string().min(1, messageKey);
}

export function emailFieldSchema(error = 'validation.email_required') {
  return z.email({ error });
}

export function urlFieldSchema(error = 'Must be a valid URL') {
  return z.string().trim().url({ error });
}

export function urlOrEmptyFieldSchema(error = 'Must be a valid URL') {
  return z.string().trim().url({ error }).or(z.literal(''));
}

export function maxStringSchema(max: number, error: string) {
  return z.string().max(max, error);
}


export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export const commonSchemaFragments = {
  userId: userIdSchema,
  coerceDates: coerceDateFields,
  positiveId: positiveIdSchema,
  nonEmptyString: nonEmptyStringSchema,
};
