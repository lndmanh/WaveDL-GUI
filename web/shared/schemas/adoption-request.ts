import { z } from 'zod';

export const adoptionFormSchema = z.object({
  attempt: z.coerce
    .number()
    .int()
    .positive('Choose a positive runtime attempt.')
    .max(Number.MAX_SAFE_INTEGER),
});

export const adoptionRequestSchema = adoptionFormSchema.extend({
  path: z
    .string()
    .min(1)
    .refine((path) => !path.includes('\0') && new TextEncoder().encode(path).length <= 4096),
});
export type AdoptionRequest = z.infer<typeof adoptionRequestSchema>;
