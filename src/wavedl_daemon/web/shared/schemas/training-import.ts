import { z } from 'zod';

export const trainingImportSchema = z.record(z.string(), z.unknown());

export type TrainingImportDocument = z.infer<typeof trainingImportSchema>;

export const importedSelectionSchema = z.string().max(8192).refine((value) => value.trim().length > 0);

export const optionPrefixSchema = z.string().startsWith('-');

// The CLI writes these as YAML lists; the draft keeps comma-separated text.
const commaSeparated = new Set(['loss_weights', 'betas', 'milestones']);
const listFields = new Set(['import_modules', 'constraint', 'constraint_weight']);

export function normalizedTrainingConfig(document: TrainingImportDocument): TrainingImportDocument {
  return Object.fromEntries(Object.entries(document).map(([name, value]): [string, TrainingImportDocument[string]] => {
    if (commaSeparated.has(name) && Array.isArray(value)) return [name, value.join(',')];

    if (listFields.has(name) && value !== null && !Array.isArray(value)) return [name, [value]];

    return [name, value];
  }));
}
