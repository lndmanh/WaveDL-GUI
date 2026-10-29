import { parse } from 'yaml';
import { clientError } from '../i18n/client-messages';
import type { DraftConfig } from '../../shared/schemas/project-draft';
import { validDraftConfig } from './project-draft';

export const CONFIG_IMPORT_LIMIT = 64 * 1024;

export interface ImportedTrainingConfig {
  readonly config: DraftConfig;
  readonly dataPath: string | null;
  readonly model: string | null;
  /** Keys present in the file that were not applied (unknown, daemon-owned or invalid). */
  readonly skipped: readonly string[];
}

// The CLI writes these as YAML lists; the draft keeps the CLI's comma-separated text.
const commaSeparated = new Set(['loss_weights', 'betas', 'milestones']);
const listFields = new Set(['import_modules', 'constraint', 'constraint_weight']);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalized(name: string, value: unknown): unknown {
  if (commaSeparated.has(name) && Array.isArray(value)) return value.join(',');
  if (listFields.has(name) && value !== null && !Array.isArray(value)) return [value];
  return value;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() && value.length <= 8192 ? value : null;
}

/**
 * Reads a WaveDL training YAML (exported here, or a CLI experiment/effective config).
 * JSON is valid YAML, so JSON presets import through the same path.
 */
export function parseTrainingConfig(source: string): ImportedTrainingConfig {
  if (new TextEncoder().encode(source).byteLength > CONFIG_IMPORT_LIMIT)
    throw clientError('configImportTooLarge', {});
  let document: unknown;
  try {
    document = parse(source, { maxAliasCount: 0, uniqueKeys: true });
  } catch {
    throw clientError('configImportUnreadable', {});
  }
  if (!record(document)) throw clientError('configImportUnreadable', {});
  const values: Record<string, unknown> = Object.fromEntries(
    Object.entries(document).map(([name, value]) => [name, normalized(name, value)]),
  );
  // `mixed_precision` is the CLI alias of `precision`.
  if (values.precision === undefined && values.mixed_precision !== undefined)
    values.precision = values.mixed_precision;
  const config = validDraftConfig(values);
  const applied = new Set<string>(Object.keys(config));
  if (applied.has('precision') && document.mixed_precision !== undefined)
    applied.add('mixed_precision');
  const dataPath = text(document.data_path);
  const model = text(document.model);
  if (dataPath) applied.add('data_path');
  if (model) applied.add('model');
  return {
    config,
    dataPath,
    model,
    skipped: Object.keys(document).filter((name) => !applied.has(name)),
  };
}
