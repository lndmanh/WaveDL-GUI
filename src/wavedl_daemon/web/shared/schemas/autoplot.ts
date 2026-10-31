import { z } from 'zod';

export const approvedManifestTextSchema = z.string();

export const checkpointDigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
