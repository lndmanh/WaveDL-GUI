import type { DraftConfig } from '../shared/schemas/project-draft';

export interface ImportedTrainingConfig {
  readonly config: DraftConfig;
  readonly dataPath: string | null;
  readonly model: string | null;
  /** Keys present in the file that were not applied (unknown, daemon-owned or invalid). */
  readonly skipped: readonly string[];
}
