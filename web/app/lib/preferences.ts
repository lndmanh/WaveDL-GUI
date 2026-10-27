import { z } from 'zod';
import { parseJson } from './daemon-api';
import {
  trainingConfigBaseSchema,
  trainingDefaults,
  type TrainingConfig,
} from '../../shared/schemas/training-request';

export const PREFERENCES_LIMIT = 64 * 1024;
export const appearanceSchema = z.strictObject({
  theme: z.enum(['system', 'light', 'dark']),
  accent: z.enum(['neutral', 'blue', 'violet', 'green']),
  zoom: z.union([z.literal(90), z.literal(100), z.literal(110), z.literal(125)]),
  language: z.enum(['en', 'vi']),
  showProjectGuide: z.boolean(),
});
export type AppearancePreferences = z.infer<typeof appearanceSchema>;
export const defaultAppearance: AppearancePreferences = {
  theme: 'system',
  accent: 'neutral',
  zoom: 100,
  language: 'en',
  showProjectGuide: true,
};
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
export type TrainingPreferences = z.infer<typeof trainingPreferencesSchema>;
export const trainingPreferenceFields = trainingPreferencesSchema.keyof().options;
export function defaultTrainingPreferences(): TrainingPreferences {
  return trainingPreferencesSchema.parse(
    Object.fromEntries(trainingPreferenceFields.map((name) => [name, trainingDefaults[name]])),
  );
}
export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
function browserStorage(): PreferenceStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
const appearanceEnvelope = z.strictObject({ version: z.literal(1), preferences: appearanceSchema });
const trainingEnvelope = z.strictObject({
  version: z.literal(1),
  daemonId: z.string().min(1).max(256),
  preferences: trainingPreferencesSchema,
});
const appearanceKey = 'wavedl.appearance.v1';
function trainingKey(daemonId: string): string {
  if (!daemonId || daemonId.length > 256 || [...daemonId].some((char) => char.charCodeAt(0) < 32))
    throw new Error('Invalid daemon identity.');
  return `wavedl.training-defaults.v1.${encodeURIComponent(daemonId)}`;
}
function boundedText(value: string): string {
  if (new TextEncoder().encode(value).byteLength > PREFERENCES_LIMIT)
    throw new Error('Preferences exceed the 64 KiB limit.');
  return value;
}
export function loadAppearance(storage = browserStorage()): AppearancePreferences {
  try {
    const raw = storage?.getItem(appearanceKey);
    return raw
      ? appearanceEnvelope.parse(parseJson(boundedText(raw))).preferences
      : { ...defaultAppearance };
  } catch {
    return { ...defaultAppearance };
  }
}
export function saveAppearance(value: AppearancePreferences, storage = browserStorage()): boolean {
  try {
    const parsed = appearanceEnvelope.parse({ version: 1, preferences: value });
    if (!storage) return false;
    storage.setItem(appearanceKey, boundedText(JSON.stringify(parsed)));
    return true;
  } catch {
    return false;
  }
}
export function loadTrainingPreferences(
  daemonId: string,
  storage = browserStorage(),
): TrainingPreferences {
  try {
    const raw = storage?.getItem(trainingKey(daemonId));
    if (!raw) return defaultTrainingPreferences();
    const parsed = trainingEnvelope.parse(parseJson(boundedText(raw)));
    return parsed.daemonId === daemonId ? parsed.preferences : defaultTrainingPreferences();
  } catch {
    return defaultTrainingPreferences();
  }
}
export function saveTrainingPreferences(
  daemonId: string,
  value: TrainingPreferences,
  storage = browserStorage(),
): boolean {
  try {
    const key = trainingKey(daemonId);
    const parsed = trainingEnvelope.parse({ version: 1, daemonId, preferences: value });
    if (!storage) return false;
    storage.setItem(key, boundedText(JSON.stringify(parsed)));
    return true;
  } catch {
    return false;
  }
}
export function resetTrainingPreferences(daemonId: string, storage = browserStorage()): boolean {
  try {
    if (!storage) return false;
    storage.removeItem(trainingKey(daemonId));
    return true;
  } catch {
    return false;
  }
}
/** Apply only when creating a fresh draft, never to a approved/submitted plan. */
export function applyTrainingPreferences(
  current: TrainingConfig,
  value: TrainingPreferences,
): TrainingConfig {
  return trainingConfigBaseSchema.parse({ ...current, ...trainingPreferencesSchema.parse(value) });
}
export function applyAppearance(
  value: AppearancePreferences,
  root: HTMLElement,
  systemDark: boolean,
): void {
  const parsed = appearanceSchema.parse(value);
  root.lang = parsed.language;
  const dark = parsed.theme === 'dark' || (parsed.theme === 'system' && systemDark);
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  root.style.fontSize = `${(16 * parsed.zoom) / 100}px`;
  const colors = {
    neutral: '',
    blue: 'oklch(0.55 0.17 255)',
    violet: 'oklch(0.55 0.18 300)',
    green: 'oklch(0.50 0.12 155)',
  };
  for (const name of ['--primary', '--ring']) {
    if (parsed.accent === 'neutral') root.style.removeProperty(name);
    else root.style.setProperty(name, colors[parsed.accent]);
  }
  if (parsed.accent === 'neutral') root.style.removeProperty('--primary-foreground');
  else root.style.setProperty('--primary-foreground', '#ffffff');
}
