export type ArtifactGroupKey = 'checkpoints' | 'plots' | 'metrics' | 'other';

export type ArtifactColumnId = 'name' | 'type' | 'size' | 'modified';

export interface ArtifactSort {
  column: ArtifactColumnId;
  direction: 'asc' | 'desc';
}
