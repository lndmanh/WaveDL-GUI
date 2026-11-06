import type { ProjectBlock } from '../shared/schemas/project-draft';
import type { TrainingRequest } from '../shared/schemas/training-request';
import type { RuntimeSetup } from '../shared/schemas/host-profile';
import type { DataSelection, ModelSelection } from './catalog-api';

export interface PipelineBlock {
  readonly id: ProjectBlock;
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  /** complete: ready; attention: usable but worth a look; pending: needs input. */
  readonly state: 'complete' | 'attention' | 'pending';
}

export interface DraftSummary {
  readonly savedAt: number;
  readonly steps: readonly {
    readonly label: string;
    readonly value: string;
    readonly done: boolean;
  }[];
  readonly changes: readonly string[];
}

export interface DraftSnapshot {
  readonly block: ProjectBlock;
  readonly data: DataSelection | null;
  readonly model: ModelSelection | null;
  readonly request: TrainingRequest;
  readonly setup: RuntimeSetup;
}
