import type { ShallowRef } from 'vue';
import { DaemonApiError } from '../lib/daemon-api';
import { LIVE_RUNS_LIMIT, LiveRunsPoller, liveCountLabel } from '../lib/live-runs';
import type { RunView } from '~~/types/daemon-api';
import type { WorkstationContext } from '~~/types/workstation';
import type { WorkstationSection } from '~~/types/shell';

export interface LiveRunsContext {
  runs: Readonly<ShallowRef<readonly RunView[]>>;
  count: ComputedRef<number>;
  countLabel: ComputedRef<string | undefined>;
  truncated: Readonly<ShallowRef<boolean>>;
  refresh(): void;
}

const liveRunsKey: InjectionKey<LiveRunsContext> = Symbol('live-runs');

export function provideLiveRuns(options: {
  api: WorkstationContext['api'];
  reportFailure: WorkstationContext['reportFailure'];
  state: WorkstationContext['state'];
  section: ComputedRef<WorkstationSection>;
}): LiveRunsContext {
  const { api, reportFailure, state, section } = options;
  const { isRailVisible } = useShellLayout();
  const visibility = useDocumentVisibility();
  const runs = shallowRef<readonly RunView[]>([]);
  const truncated = shallowRef(false);

  const poller = new LiveRunsPoller({
    list: async (signal) => {
      const client = api.value;

      if (!client) return [];

      return client.listRuns({ state: 'live', limit: LIVE_RUNS_LIMIT, signal });
    },
    onChange: (snapshot) => {
      runs.value = snapshot.runs;
      truncated.value = snapshot.truncated;
    },
    onError: (error) => {
      if (error instanceof DaemonApiError) reportFailure.value(error);
    },
  });

  watch(
    [
      () => state.value.status === 'connected',
      () => visibility.value === 'visible',
      isRailVisible,
      () => state.value.revision,
      () => section.value !== 'connection',
    ],
    ([connected, visible, railVisible, revision, shellVisible], [, , , previousRevision]) => {
      if (revision !== previousRevision || !connected) {
        poller.stop();
        runs.value = [];
        truncated.value = false;
      }

      if (connected && visible && railVisible && shellVisible) poller.start();
      else poller.stop();
    },
    { immediate: true },
  );

  onScopeDispose(() => poller.stop());

  const count = computed(() => runs.value.length);
  const countLabel = computed(() => liveCountLabel(count.value, truncated.value));

  const context: LiveRunsContext = {
    runs: shallowReadonly(runs),
    count,
    countLabel,
    truncated: shallowReadonly(truncated),
    refresh: () => poller.refresh(),
  };

  provide(liveRunsKey, context);

  return context;
}

export function useLiveRuns(): LiveRunsContext {
  const context = inject(liveRunsKey);

  if (!context) throw new Error('useLiveRuns() must be called inside the workstation layout.');

  return context;
}
