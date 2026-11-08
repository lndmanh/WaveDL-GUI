import type { RunState } from '~~/types/daemon-api';

type SubmissionStage = 'waiting' | 'training' | 'done' | 'failed' | 'cancelled';

const submissionStages: Record<RunState, SubmissionStage> = {
  planned: 'waiting',
  pending: 'waiting',
  submission_unknown: 'waiting',
  submitted: 'waiting',
  queued: 'waiting',
  held: 'waiting',
  running: 'training',
  stopping: 'training',
  completed: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
  terminal_unknown: 'waiting',
  observation_unavailable: 'waiting',
  supervision_lost: 'waiting',
};

export interface SubmittedRunProgress {
  step: number;
  status: 'current' | 'complete' | 'failed' | 'cancelled';
}

/** Terminal outcomes belong to the last known stage, not automatically to training. */
export function submittedRunProgress(state: RunState, hasTrained: boolean): SubmittedRunProgress {
  const stage = submissionStages[state] ?? 'waiting';

  switch (stage) {
    case 'training':
      return { step: 2, status: 'current' };
    case 'done':
      return { step: 3, status: 'complete' };
    case 'failed':
    case 'cancelled':
      return { step: hasTrained ? 2 : 1, status: stage };
    case 'waiting':
      return { step: 1, status: 'current' };
  }
}
