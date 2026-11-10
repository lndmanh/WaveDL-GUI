import type { MaybeRefOrGetter } from 'vue';
import { clientError } from '../i18n/client-messages';
import { DaemonApi, DaemonApiError } from '../lib/daemon-api';
import { RunMonitor } from '../lib/run-monitor';
import { shouldPollRuns } from '../lib/run-overview';
import type { ClientMessage } from '~~/types/i18n';
import type { RunOperation, RunView } from '~~/types/daemon-api';
import type { RunMonitorSnapshot } from '~~/types/run-monitor';

const LIST_REFRESH_INTERVAL = 10_000;

export function useRuns(
  api: DaemonApi,
  reportFailure: (error: DaemonApiError) => void,
  initiallyPaused = false,
  filter: {
    operation?: readonly RunOperation[];
    sourceRunId?: MaybeRefOrGetter<string | null>;
    enabled?: MaybeRefOrGetter<boolean>;
  } = {},
) {
  const runs = shallowRef<readonly RunView[]>([]);
  const selected = shallowRef<RunMonitorSnapshot | null>(null);
  const loading = shallowRef(false);
  const message = shallowRef<ClientMessage | Error>('');
  const page = shallowRef(0);
  const staleRunIds = shallowRef<ReadonlySet<string>>(new Set());
  const lastRefreshed = shallowRef<string | null>(null);
  let detailRevision = 0;
  let listAbort: AbortController | null = null;
  let monitor: RunMonitor | null = null;
  let unsubscribe: (() => void) | null = null;
  let disposed = false;
  let paused = initiallyPaused;
  const hasLiveRuns = computed(() => shouldPollRuns(runs.value));

  const listRefresh = useIntervalFn(
    () => {
      if (!paused && !disposed && !loading.value && hasLiveRuns.value) void refresh(page.value);
    },
    LIST_REFRESH_INTERVAL,
    { immediate: false },
  );

  function syncRefreshTimer(): void {
    if (paused || disposed || !hasLiveRuns.value) listRefresh.pause();
    else if (!listRefresh.isActive.value) listRefresh.resume();
  }

  watch(hasLiveRuns, syncRefreshTimer);
  watch(
    [() => toValue(filter.sourceRunId) ?? null, () => toValue(filter.enabled) ?? true],
    () => {
      listAbort?.abort();
      runs.value = [];
      staleRunIds.value = new Set();
      lastRefreshed.value = null;
      message.value = '';
      loading.value = false;
      page.value = 0;

      if (!paused && !disposed) void refresh(0);
    },
    { flush: 'sync' },
  );

  async function refresh(offset = page.value): Promise<void> {
    listAbort?.abort();

    if (toValue(filter.enabled) === false || paused || disposed) return;

    const controller = new AbortController();
    listAbort = controller;
    loading.value = true;
    const detailAtStart = detailRevision;

    try {
      const sourceRunId = toValue(filter.sourceRunId);
      const result = await api.listRuns({
        limit: 50,
        offset,
        ...(filter.operation ? { operation: filter.operation } : {}),
        ...(sourceRunId != null ? { sourceRunId } : {}),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });

      if (!controller.signal.aborted && !disposed) {
        const detail = selected.value;
        runs.value =
          detail?.run && detail.freshness === 'fresh' && detailRevision !== detailAtStart
            ? result.map((run) => (run.run_id === detail.run?.run_id ? detail.run : run))
            : result;
        staleRunIds.value =
          detail?.run && detail.freshness === 'stale' ? new Set([detail.run.run_id]) : new Set();
        lastRefreshed.value = new Date().toISOString();
        page.value = offset;
        message.value = '';
      }
    } catch (error) {
      if (!controller.signal.aborted && !disposed) {
        message.value =
          error instanceof DaemonApiError ? error : clientError('unableToRefreshRuns');
        staleRunIds.value = new Set(runs.value.map((run) => run.run_id));

        if (error instanceof DaemonApiError) reportFailure(error);
      }
    } finally {
      if (listAbort === controller && !disposed) loading.value = false;
    }
  }

  function select(runId: string): void {
    unsubscribe?.();
    monitor?.stop();
    const daemonId = api.daemonId;
    monitor = new RunMonitor(
      runId,
      {
        getRun: (id, signal) =>
          api.getRun(id, AbortSignal.any([signal, AbortSignal.timeout(15000)])),
        openEvents: (id, cursor, signal) => api.openEvents(id, cursor, signal, daemonId),
        getEventPage: (id, cursor, signal) => api.getEventPage(id, cursor, signal, daemonId),
        cancelRun: (id, signal) =>
          api.cancelRun(id, AbortSignal.any([signal, AbortSignal.timeout(15000)])),
      },
      2000,
      reportFailure,
    );
    unsubscribe = monitor.subscribe((snapshot) => {
      const previous = selected.value;
      selected.value = snapshot;

      if (
        snapshot.run &&
        (snapshot.run !== previous?.run || snapshot.freshness !== previous.freshness)
      ) {
        detailRevision++;
        const stale = new Set(staleRunIds.value);

        if (snapshot.freshness === 'fresh') {
          runs.value = runs.value.map((run) =>
            run.run_id === snapshot.run?.run_id ? snapshot.run : run,
          );
          stale.delete(snapshot.run.run_id);
        } else {
          stale.add(snapshot.run.run_id);
        }

        staleRunIds.value = stale;
      }
    });

    if (!paused) void monitor.start();
  }

  function replay(): void {
    if (monitor) select(monitor.runId);
  }

  async function cancel(): Promise<void> {
    await monitor?.cancel();
  }

  function close(): void {
    unsubscribe?.();
    unsubscribe = null;
    monitor?.stop();
    monitor = null;
    selected.value = null;
  }

  function pause(): void {
    paused = true;
    listRefresh.pause();
    listAbort?.abort();
    listAbort = null;
    monitor?.pause();
    loading.value = false;
  }

  function resume(): void {
    if (disposed) return;
    paused = false;

    // Runs can be submitted while this kept-alive page is hidden, even if its
    // cached list has no live runs. Revalidate on every activation.
    if (!loading.value) void refresh(page.value);

    syncRefreshTimer();
    const current = monitor;

    if (current) {
      void current.resume(() => !paused && !disposed && monitor === current);
      void current.start();
    }
  }

  onScopeDispose(() => {
    disposed = true;
    listRefresh.pause();
    listAbort?.abort();
    close();
  });

  if (!paused) void refresh();

  return {
    runs,
    selected,
    loading,
    message,
    page,
    staleRunIds,
    lastRefreshed,
    refresh,
    select,
    replay,
    cancel,
    close,
    pause,
    resume,
  };
}
