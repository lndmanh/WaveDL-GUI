import type { z } from 'zod';
import type { appearanceSchema, trainingPreferencesSchema } from '../app/lib/preferences';

export type AppearancePreferences = z.infer<typeof appearanceSchema>;

export type TrainingPreferences = z.infer<typeof trainingPreferencesSchema>;

export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
