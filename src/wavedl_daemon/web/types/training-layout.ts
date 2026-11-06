import type { DraftConfig } from '../shared/schemas/project-draft';

export type TrainingFieldName = keyof DraftConfig;

export type TrainingSectionId =
  | 'optimizer'
  | 'schedule'
  | 'loss'
  | 'data'
  | 'checkpoints'
  | 'validation'
  | 'constraints'
  | 'code'
  | 'logging';
