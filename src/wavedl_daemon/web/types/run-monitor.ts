import type { RunView } from './daemon-api';
import type { Cursor, EventPage, RunEvent } from './event-stream';
import type { ClientMessage } from './i18n';
import type { MetricRecord, MetricSummary } from './metric-history';

export interface RunTransport {
  getRun(runId: string, signal: AbortSignal): Promise<RunView>;
  openEvents(runId: string, cursor: Cursor, signal: AbortSignal): Promise<Response>;
  getEventPage?(runId: string, cursor: Cursor, signal: AbortSignal): Promise<EventPage>;
  cancelRun(runId: string, signal: AbortSignal): Promise<RunView>;
  retryAutomaticPlots?(runId: string, signal: AbortSignal): Promise<RunView>;
}

export interface RunMonitorSnapshot {
  run: RunView | null;
  freshness: 'unconfirmed' | 'fresh' | 'stale';
  events: readonly RunEvent[];
  liveEvents: readonly RunEvent[];
  stream: 'connecting' | 'live' | 'reconnecting' | 'stopped' | 'error';
  message: ClientMessage | Error;
  cancellation: 'idle' | 'sending' | 'requested' | 'unknown';
  automaticPlotRetry: boolean;
  truncated: boolean;
  metrics: readonly MetricRecord[];
  summary: MetricSummary;
}

export type ReplayTargetStatus = 'none' | 'pending' | 'verified' | 'invalidated';
