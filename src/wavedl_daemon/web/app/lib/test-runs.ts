import { checkpointNameSchema } from '../../shared/schemas/artifacts';
import type { RunView } from '~~/types/daemon-api';

export function isTestRun(run: RunView): boolean {
  return run.operation !== 'train';
}

export function checkpointLabel(
  name: string | null | undefined,
): { key: string; params?: Record<string, number> } | null {
  const checkpoint = checkpointNameSchema.safeParse(name);

  if (!checkpoint.success) return null;

  if (checkpoint.data === 'best_checkpoint') return { key: 'results.versionBest' };

  if (checkpoint.data === 'interrupted_checkpoint') return { key: 'results.versionInterrupted' };

  return {
    key: 'results.versionEpoch',
    params: { epoch: Number(checkpoint.data.slice('epoch_'.length, -'_checkpoint'.length)) },
  };
}

export function parentTitle(run: RunView): string | null {
  return run.summary?.source_name ?? run.summary?.source_model ?? null;
}

export function isCompareEligible(run: RunView): boolean {
  return (
    run.operation === 'test' &&
    run.state === 'completed' &&
    !run.uncertainty &&
    run.evaluation != null
  );
}

export function testLocation(run: RunView): string {
  if (!isTestRun(run)) return `/results/${run.run_id}`;

  const sourceRunId = run.summary?.source_run_id;

  return sourceRunId ? `/results/${sourceRunId}?test=${run.run_id}` : `/tests/${run.run_id}`;
}
