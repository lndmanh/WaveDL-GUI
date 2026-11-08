import { z } from 'zod';
import { trainingConfigBaseSchema } from './training-request';

export const appearanceSchema = z.strictObject({
  theme: z.enum(['system', 'light', 'dark']),
  accent: z.enum(['neutral', 'blue', 'violet', 'green']),
  zoom: z.union([z.literal(90), z.literal(100), z.literal(110), z.literal(125)]),
  language: z.enum(['en', 'vi']),
});

/** No paths, executable code, credentials, model selection or submitted authority. */
// Preferences are editable draft values, not a submission. Preserve existing
// CV combinations so the form can explain incompatibilities without data loss.
export const trainingPreferencesSchema = trainingConfigBaseSchema.omit({
  model: true,
  data_path: true,
  import_modules: true,
  resume: true,
  constraint: true,
  constraint_file: true,
  constraint_weight: true,
  constraint_reduction: true,
  run_name: true,
  project_name: true,
});

export const appearanceEnvelope = z.strictObject({ version: z.literal(1), preferences: appearanceSchema });

// Saved before the guided project wizard was retired; the flag is read and dropped.
export const legacyAppearanceEnvelope = z.strictObject({
  version: z.literal(1),
  preferences: appearanceSchema.extend({ showProjectGuide: z.boolean() }),
});

// z.object strips the retired key that the strict schema would reject.
export const legacyAppearancePreferencesSchema = z.object(appearanceSchema.shape);

export const trainingEnvelope = z.strictObject({
  version: z.literal(1),
  daemonId: z.string().min(1).max(256),
  preferences: trainingPreferencesSchema,
});

export const keepSignedInSchema = z.boolean();
