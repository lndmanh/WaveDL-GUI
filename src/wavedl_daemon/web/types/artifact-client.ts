import type { z } from 'zod';
import type { inventorySchema } from '../shared/schemas/artifacts';

export type Artifact = Readonly<z.output<typeof inventorySchema>['files'][number]> & {
  readonly runId: string;
};

export interface Checkpoint {
  readonly runId: string;
  readonly name: string;
}

export interface Inventory {
  readonly files: readonly Artifact[];
  readonly checkpoints: readonly Checkpoint[];
}
