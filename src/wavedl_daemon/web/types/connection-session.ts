import type { ClientMessage } from './i18n';
import type { Health } from './daemon-api';

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'authentication'
  | 'skew'
  | 'offline'
  | 'error';

export interface ConnectionState {
  status: ConnectionStatus;
  health: Health | null;
  message: ClientMessage | Error | null;
  revision: number;
  buildMismatch: boolean;
}

export interface ConnectionOptions {
  origin: string;
  buildId: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  online?: boolean;
}

export interface WorkOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}
