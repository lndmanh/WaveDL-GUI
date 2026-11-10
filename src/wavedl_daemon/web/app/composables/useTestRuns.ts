import type { MaybeRefOrGetter } from 'vue';
import type { DaemonApi, DaemonApiError } from '../lib/daemon-api';

/** Parent-scoped lists must never fall back to an unfiltered list of all tests. */
export function useTestRuns(
  api: DaemonApi,
  reportFailure: (error: DaemonApiError) => void,
  scope: { sourceRunId?: MaybeRefOrGetter<string | null> },
) {
  const list = useRuns(api, reportFailure, true, {
    operation: ['test', 'plot'],
    sourceRunId: scope.sourceRunId,
    enabled: () => toValue(scope.sourceRunId) != null,
  });

  usePageActive(list.resume, list.pause);

  return {
    runs: list.runs,
    loading: list.loading,
    page: list.page,
    message: list.message,
    refresh: list.refresh,
    staleRunIds: list.staleRunIds,
  };
}
