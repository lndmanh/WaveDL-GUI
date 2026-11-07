import type { ProjectDraft } from '../shared/schemas/project-draft';
import type { ImportedTrainingConfig } from './training-import';

export interface PendingRunClone {
  readonly sourceRunId: string;
  readonly imported: ImportedTrainingConfig;
  readonly draft: ProjectDraft;
}
