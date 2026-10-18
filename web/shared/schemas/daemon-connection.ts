import { z } from 'zod';

/** Only bearer syntax is shared; credentials never become persisted drafts. */
export const daemonCredentialSchema = z.object({
  token: z
    .string()
    .min(1, 'Enter the daemon bearer credential.')
    .max(4096, 'The credential is too long.')
    .regex(/^[A-Za-z0-9._~+/=-]+$/, 'Enter a valid bearer credential.'),
});

export type DaemonCredentialValues = z.infer<typeof daemonCredentialSchema>;
