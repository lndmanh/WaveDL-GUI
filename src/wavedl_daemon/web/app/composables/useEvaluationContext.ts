import type { MaybeRefOrGetter } from 'vue';
import { evaluationPlanContext, trainingBaseline } from '../lib/evaluation-scorecard';
import { MetricHistory } from '../lib/metric-history';
import type { TrainingBaseline } from '../lib/evaluation-scorecard';
import type { PlanView, RunView } from '~~/types/daemon-api';
import type { Cursor } from '~~/types/event-stream';

/** Independent replay: source-run metrics must never change the selected run monitor. */
export function useEvaluationContext(
  run: MaybeRefOrGetter<RunView | null>,
  enabled: MaybeRefOrGetter<boolean>,
) {
  const { api, state, revision } = useWorkstation();
  const { isActive } = usePageActive();
  const plan = shallowRef<PlanView | null>(null);
  const baseline = shallowRef<TrainingBaseline | null>(null);
  const comparisonLoading = shallowRef(false);
  const context = computed(() => evaluationPlanContext(plan.value?.preview.spec));
  // The identity whose plan and baseline are fully resolved. Hiding the page or a brief loss of
  // fresh metrics only pauses work; it never clears a finished comparison or refetches it.
  let settled: string | null = null;

  watch(
    [
      () => toValue(run)?.run_id,
      () => toValue(run)?.plan_id,
      () => toValue(run)?.request_id,
      () => toValue(run)?.attempt,
      () => toValue(run)?.summary?.source_run_id,
      () => toValue(enabled),
      api,
      revision,
      () => state.value.status,
      isActive,
    ],
    async (_value, _previous, onCleanup) => {
      const controller = new AbortController();
      onCleanup(() => controller.abort());
      comparisonLoading.value = false;
      const selected = toValue(run);
      const client = api.value;
      const daemonId = state.value.health?.daemon_id;

      const identity = selected
        ? JSON.stringify([
            selected.run_id,
            selected.plan_id,
            selected.request_id,
            selected.attempt,
            selected.summary?.source_run_id ?? null,
            daemonId ?? null,
            revision.value,
          ])
        : null;

      if (identity !== settled) {
        settled = null;
        plan.value = null;
        baseline.value = null;
      }

      if (
        !selected ||
        identity === settled ||
        !toValue(enabled) ||
        selected.operation !== 'test' ||
        !client ||
        !isActive.value ||
        state.value.status !== 'connected'
      )
        return;

      try {
        const loaded = await client.getRunPlan(selected.run_id, controller.signal);
        controller.signal.throwIfAborted();

        if (loaded.plan_id !== selected.plan_id || loaded.request_id !== selected.request_id)
          return;
        plan.value = loaded;
        const sourceId = selected.summary?.source_run_id;

        if (!context.value.bestCheckpoint || !sourceId) {
          settled = identity;

          return;
        }

        const source = await client.getRun(sourceId, controller.signal);
        controller.signal.throwIfAborted();

        if (source.operation !== 'train' || source.uncertainty) {
          settled = identity;

          return;
        }

        comparisonLoading.value = true;
        const history = new MetricHistory(sourceId, { maxPoints: 65_536 });
        let cursor: Cursor = { attempt: 0, seq: -1 };

        // Bound both memory and requests. An incomplete history cannot prove the best epoch.
        for (let pageIndex = 0; pageIndex < 256; pageIndex++) {
          const page = await client.getEventPage(sourceId, cursor, controller.signal, daemonId);
          controller.signal.throwIfAborted();

          for (const event of page.events) history.apply(event);
          cursor = page.next_cursor;

          if (!page.more) {
            baseline.value = trainingBaseline(history.metrics());
            settled = identity;

            return;
          }
        }

        // Too long to replay within the bound: stay hidden rather than retrying on every visit.
        settled = identity;
      } catch {
        // Older/deleted source runs and optional plan metadata do not invalidate results.
      } finally {
        if (!controller.signal.aborted) comparisonLoading.value = false;
      }
    },
    { immediate: true, flush: 'sync' },
  );

  return { context, baseline, comparisonLoading };
}
