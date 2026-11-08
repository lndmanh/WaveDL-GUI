import { describe, expect, test } from 'vitest';
import { submittedRunProgress } from '../../app/lib/submitted-run';

describe('submittedRunProgress', () => {
  test('maps queued and pending states to waiting step', () => {
    expect(submittedRunProgress('planned', false)).toEqual({ step: 1, status: 'current' });
    expect(submittedRunProgress('pending', false)).toEqual({ step: 1, status: 'current' });
    expect(submittedRunProgress('submitted', false)).toEqual({ step: 1, status: 'current' });
    expect(submittedRunProgress('queued', false)).toEqual({ step: 1, status: 'current' });
    expect(submittedRunProgress('held', false)).toEqual({ step: 1, status: 'current' });
  });

  test('maps running and stopping states to training step', () => {
    expect(submittedRunProgress('running', false)).toEqual({ step: 2, status: 'current' });
    expect(submittedRunProgress('stopping', true)).toEqual({ step: 2, status: 'current' });
  });

  test('maps completed state to done step with complete status', () => {
    expect(submittedRunProgress('completed', true)).toEqual({ step: 3, status: 'complete' });
  });

  test('maps failure or cancellation before training to waiting step', () => {
    expect(submittedRunProgress('failed', false)).toEqual({ step: 1, status: 'failed' });
    expect(submittedRunProgress('cancelled', false)).toEqual({ step: 1, status: 'cancelled' });
  });

  test('maps failure or cancellation during training to training step', () => {
    expect(submittedRunProgress('failed', true)).toEqual({ step: 2, status: 'failed' });
    expect(submittedRunProgress('cancelled', true)).toEqual({ step: 2, status: 'cancelled' });
  });
});
