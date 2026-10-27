import { describe, expect, it } from 'vitest';
import { evaluationResults } from '../../app/lib/evaluation-results';
import type { RunEvent } from '../../app/lib/event-stream';
import type { RunView } from '../../app/lib/daemon-api';
const view: RunView = {
  run_id: '22222222-2222-4222-8222-222222222222',
  plan_id: '11111111-1111-4111-8111-111111111111',
  request_id: '33333333-3333-4333-8333-333333333333',
  backend: 'local',
  operation: 'test',
  attempt: 2,
  state: 'completed',
  uncertainty: false,
  submission_requested: true,
  cancellation_requested: false,
  evidence: null,
};
const event: RunEvent = {
  protocol: 'wavedl-jsonl',
  version: 1,
  run_id: view.run_id,
  attempt: 2,
  seq: 5,
  type: 'metric',
  ts: '2026-10-08T00:00:00Z',
  payload: { name: 'evaluation', metrics: { r2: null, mae_avg: 0.1 } },
};
describe('evaluation provenance', () => {
  it('accepts exact structured runtime results without parsing logs', () => {
    expect(evaluationResults(view, [event])).toEqual({ r2: null, mae_avg: 0.1 });
  });
  it('rejects old attempts, foreign runs, logs and pending native scopes', () => {
    expect(
      evaluationResults(view, [
        { ...event, attempt: 1 },
        { ...event, run_id: 'foreign' },
        { ...event, type: 'log' },
      ]),
    ).toBeNull();
    expect(evaluationResults({ ...view, evidence: { native_pending: true } }, [event])).toBeNull();
  });
});
