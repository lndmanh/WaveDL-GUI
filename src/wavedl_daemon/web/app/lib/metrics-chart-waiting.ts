import { terminalRun } from './run-monitor';
import type { RunView } from '~~/types/daemon-api';
import type { RunEvent } from '~~/types/event-stream';

export interface MetricsWaitingStage {
  step: 0 | 1;
  titleKey:
    | 'runs.metricsSubmitting'
    | 'runs.queued'
    | 'runs.metricsHeld'
    | 'runs.metricsTraining'
    | 'runs.metricsStopping';
  startedAt: number | null;
}

export type MetricsChartEmptyState =
  | { kind: 'waiting'; stage: MetricsWaitingStage }
  | { kind: 'terminal' | 'missing' | 'unconfirmed' };

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);

  return Number.isFinite(parsed) ? parsed : null;
}

export function metricsWaitingStage(
  run: RunView,
  events: readonly RunEvent[],
): MetricsWaitingStage | null {
  if (run.uncertainty) return null;
  let step: MetricsWaitingStage['step'];
  let titleKey: MetricsWaitingStage['titleKey'];

  switch (run.state) {
    case 'pending':
    case 'submission_unknown':
      step = 0;
      titleKey = 'runs.metricsSubmitting';
      break;
    case 'submitted':
    case 'queued':
      step = 0;
      titleKey = 'runs.queued';
      break;
    case 'held':
      step = 0;
      titleKey = 'runs.metricsHeld';
      break;
    case 'running':
      step = 1;
      titleKey = 'runs.metricsTraining';
      break;
    case 'stopping':
      step = 1;
      titleKey = 'runs.metricsStopping';
      break;
    default:
      return null;
  }

  let startedAt: number | null = null;

  for (const event of events) {
    if (event.run_id !== run.run_id || event.attempt !== run.attempt) continue;

    // Observed also carries queued/held. "Running" is the daemon phase
    // (including Slurm CONFIGURING), not a separate trainer-start event.
    const relevant = step === 0
      ? event.type === 'submitted'
      : event.type === 'observed' && event.payload.phase === 'running';

    if (!relevant) continue;
    const candidate = timestamp(event.ts);

    if (candidate !== null && (startedAt === null || candidate > startedAt))
      startedAt = candidate;
  }

  return { step, titleKey, startedAt: startedAt ?? (step === 0 ? timestamp(run.created_at) : null) };
}

/** Only a confirmed live run with no metrics yet gets an animated waiting state. */
export function metricsChartEmptyState(
  run: RunView | null,
  events: readonly RunEvent[],
  hasOtherMetrics: boolean,
): MetricsChartEmptyState {
  if (
    run === null ||
    run.uncertainty ||
    run.state === 'terminal_unknown' ||
    run.state === 'observation_unavailable' ||
    run.state === 'supervision_lost'
  ) return { kind: 'unconfirmed' };

  if (terminalRun(run)) return { kind: 'terminal' };

  if (hasOtherMetrics) return { kind: 'missing' };
  const stage = metricsWaitingStage(run, events);

  return stage === null ? { kind: 'unconfirmed' } : { kind: 'waiting', stage };
}
