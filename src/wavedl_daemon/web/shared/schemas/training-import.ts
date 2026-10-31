import { z } from 'zod';
import type { Json, JsonObject } from './json';
import { jsonObjectSchema } from './json';

export const trainingImportSchema = jsonObjectSchema;

export const importedSelectionSchema = z.string().max(8192).refine((value) => value.trim().length > 0);

export const optionPrefixSchema = z.string().startsWith('-');

// The CLI writes these as YAML lists; the draft keeps comma-separated text.
const commaSeparated = new Set(['loss_weights', 'betas', 'milestones']);
const listFields = new Set(['import_modules', 'constraint', 'constraint_weight']);

export function normalizedTrainingValue(name: string, value: Json): Json {
  if (commaSeparated.has(name) && Array.isArray(value)) return value.join(',');

  if (listFields.has(name) && value !== null && !Array.isArray(value)) return [value];

  return value;
}

export function normalizedTrainingConfig(document: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(document).map(([name, value]) => [name, normalizedTrainingValue(name, value)]));
}
