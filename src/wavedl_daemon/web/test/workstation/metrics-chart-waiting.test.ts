import { describe, expect, test } from 'vitest';
import { metricsChartEmptyState, metricsWaitingStage, type MetricsWaitingStage } from '../../app/lib/metrics-chart-waiting';
import type { RunState, RunView } from '../../types/daemon-api';
import type { RunEvent } from '../../types/event-stream';

function run(overrides: Partial<RunView> = {}): RunView {
  return {
    plan_id: 'plan',
    run_id: 'run',
    request_id: 'request',
    backend: 'local',
    operation: 'train',
    attempt: 2,
    state: 'running',
    uncertainty: false,
    submission_requested: true,
    cancellation_requested: false,
    evidence: null,
    created_at: '2026-11-09T10:00:00Z',
    ...overrides,
  };
}

function event(overrides: Partial<RunEvent> = {}): RunEvent {
  return {
    protocol: 'wavedl-run',
    version: 2,
    run_id: 'run',
    attempt: 2,
    seq: 1,
    type: 'observed',
    ts: '2026-11-09T10:01:00Z',
    payload: { phase: 'running' },
    ...overrides,
  };
}

const stages: { state: RunState; step: MetricsWaitingStage['step']; titleKey: MetricsWaitingStage['titleKey'] }[] = [
  { state: 'pending', step: 0, titleKey: 'runs.metricsSubmitting' },
  { state: 'submission_unknown', step: 0, titleKey: 'runs.metricsSubmitting' },
  { state: 'submitted', step: 0, titleKey: 'runs.queued' },
  { state: 'queued', step: 0, titleKey: 'runs.queued' },
  { state: 'held', step: 0, titleKey: 'runs.metricsHeld' },
  { state: 'running', step: 1, titleKey: 'runs.metricsTraining' },
  { state: 'stopping', step: 1, titleKey: 'runs.metricsStopping' },
];

const staticStates: RunState[] = [
  'planned', 'completed', 'failed', 'cancelled', 'terminal_unknown',
  'observation_unavailable', 'supervision_lost',
];

describe('metrics waiting stages', () => {
  test.each(stages)('maps $state to its approved stage and title', ({ state, step, titleKey }) => {
    expect(metricsWaitingStage(run({ state }), [])).toEqual({
      step,
      titleKey,
      startedAt: step === 0 ? Date.parse('2026-11-09T10:00:00Z') : null,
    });
  });

  test.each(staticStates)('never animates $state', (state) => {
    expect(metricsWaitingStage(run({ state }), [])).toBeNull();
  });

  test('never animates uncertain live runs', () => {
    expect(metricsWaitingStage(run({ uncertainty: true }), [event()])).toBeNull();
  });

  test('uses the latest running observation of the current run and attempt only', () => {
    const stage = metricsWaitingStage(run(), [
      event({ seq: 2, ts: '2026-11-09T10:02:00Z' }),
      event(),
      event({ seq: 3, ts: '2026-11-09T10:03:00Z', payload: { phase: 'queued' } }),
      event({ seq: 4, ts: '2026-11-09T10:04:00Z', payload: { phase: 'held' } }),
      event({ attempt: 1, ts: '2026-11-09T10:05:00Z' }),
      event({ run_id: 'other', ts: '2026-11-09T10:06:00Z' }),
    ]);

    expect(stage?.startedAt).toBe(Date.parse('2026-11-09T10:02:00Z'));
  });

  test('does not guess training start from creation, submission, or queued observations', () => {
    const events = [event({ type: 'submitted' }), event({ payload: { phase: 'queued' } })];

    expect(metricsWaitingStage(run(), events)?.startedAt).toBeNull();
    expect(metricsWaitingStage(run({ state: 'stopping' }), [])?.startedAt).toBeNull();
    expect(metricsWaitingStage(run(), [event({ ts: 'invalid' })])?.startedAt).toBeNull();
  });

  test('uses latest current-attempt submission, then creation for submitted-stage timing', () => {
    const pending = run({ state: 'pending' });

    const events = [
      event({ type: 'submitted' }),
      event({ type: 'submitted', seq: 2, ts: '2026-11-09T10:02:00Z' }),
      event({ type: 'submitted', attempt: 1, ts: '2026-11-09T10:03:00Z' }),
      event({ ts: '2026-11-09T10:04:00Z' }),
    ];

    expect(metricsWaitingStage(pending, events)?.startedAt).toBe(Date.parse('2026-11-09T10:02:00Z'));
    expect(metricsWaitingStage(pending, [])?.startedAt).toBe(Date.parse('2026-11-09T10:00:00Z'));
    expect(metricsWaitingStage(run({ state: 'pending', created_at: null }), [])?.startedAt).toBeNull();
  });
});

describe('metrics chart empty-state selection', () => {
  test.each<RunState>(['completed', 'failed', 'cancelled'])('shows recorded-none for terminal $state even with other-channel metrics', (state) => {
    expect(metricsChartEmptyState(run({ state }), [], true)).toEqual({ kind: 'terminal' });
  });

  test.each<RunState>(['terminal_unknown', 'observation_unavailable', 'supervision_lost'])('keeps $state static even with other-channel metrics', (state) => {
    expect(metricsChartEmptyState(run({ state }), [], true)).toEqual({ kind: 'unconfirmed' });
  });

  test('prioritizes uncertainty over a terminal state or another channel', () => {
    expect(metricsChartEmptyState(run({ uncertainty: true }), [], true)).toEqual({ kind: 'unconfirmed' });
    expect(metricsChartEmptyState(run({ uncertainty: true, state: 'completed' }), [], true)).toEqual({ kind: 'unconfirmed' });
    expect(metricsChartEmptyState(null, [], false)).toEqual({ kind: 'unconfirmed' });
    expect(metricsChartEmptyState(run({ state: 'planned' }), [], false)).toEqual({ kind: 'unconfirmed' });
  });

  test('shows a static missing-channel message when another channel has points', () => {
    expect(metricsChartEmptyState(run(), [event()], true)).toEqual({ kind: 'missing' });
  });

  test('waits only for a live run with no points on other channels', () => {
    expect(metricsChartEmptyState(run(), [event()], false)).toEqual({
      kind: 'waiting',
      stage: { step: 1, titleKey: 'runs.metricsTraining', startedAt: Date.parse('2026-11-09T10:01:00Z') },
    });
  });
});
