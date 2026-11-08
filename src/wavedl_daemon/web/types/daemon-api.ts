import type { z } from 'zod';
import type {
  healthSchema,
  sessionGrantSchema,
  RUN_STATES,
  runViewSchema,
  planSchema,
  outputChunkSchema,
} from '../shared/schemas/daemon-api';
import type { runEvidenceSchema } from '../shared/schemas/run-evidence';
import type { MessageParams } from './i18n';

export type Health = z.output<typeof healthSchema>;

export type SessionGrant = z.output<typeof sessionGrantSchema>;

export interface IdentityPins {
  daemonId?: string;
  buildId?: string;
  protocolVersion?: number;
}

export type RunState = (typeof RUN_STATES)[number];

export interface RunProgress {
  epoch: number;
  totalEpochs: number;
  fraction: number;
}

export type RunView = Omit<z.output<typeof runViewSchema>, 'evidence' | 'progress'> & {
  evidence: z.output<typeof runEvidenceSchema> | null;
  progress?: RunProgress | null;
};

/** The approved inputs that name a run; never live state. */
export type RunSummary = NonNullable<z.output<typeof runViewSchema>['summary']>;

export type PlanView = z.output<typeof planSchema>;

export type OutputChunk = z.output<typeof outputChunkSchema>;

export interface OutputRequest {
  attempt?: number;
  offset?: number;
}

export type ApiErrorCode = 'authentication' | 'identity' | 'protocol' | 'response' | 'http';

export interface DaemonApiErrorOptions {
  status?: number;
  buildMismatch?: boolean;
  daemonIdentityChanged?: boolean;
  params?: MessageParams;
}
