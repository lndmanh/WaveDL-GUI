import type { TrainingRequest } from '../shared/schemas/training-request';

export type AutomaticRuntime = Pick<TrainingRequest, 'backend' | 'runtime' | 'topology'>;

export type HostAccelerator = 'cuda' | 'mps' | 'cpu' | 'unknown';
