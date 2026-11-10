import type { MaybeRefOrGetter } from 'vue';
import { ArtifactClient } from '../lib/artifact-client';
import { DaemonApiError } from '../lib/daemon-api';
import type { DaemonApi } from '../lib/daemon-api';
import { evaluationResults } from '../lib/evaluation-results';
import { evaluationPlanContext, parameterScores } from '../lib/evaluation-scorecard';
import type { ParameterScores } from '../lib/evaluation-scorecard';
import { isCompareEligible } from '../lib/test-runs';
import type { Artifact } from '~~/types/artifact-client';
import type { RunView } from '~~/types/daemon-api';
import type { Cursor } from '~~/types/event-stream';
import type { JsonObject } from '~~/types/json';

export interface ComparedTest {
  id: string;
  run: RunView | null;
  metrics: JsonObject | null;
  parameters: ParameterScores[];
  plots: Artifact[];
  error: string | null;
}

/** Settled results only; each replay is bounded and independent of the selected-run monitor. */
export function useTestComparison(api: DaemonApi, ids: MaybeRefOrGetter<string[]>) {
  const { session, state, reportFailure } = useWorkstation();
  const { isActive } = usePageActive();
  const entries = shallowRef<ComparedTest[]>([]);
  const invalidIds = shallowRef<string[]>([]);
  const loading = shallowRef(false);
  const retry = shallowRef(0);
  const cache = new Map<string, ComparedTest>();

  watch([() => toValue(ids).join(','), isActive, retry], async (_value, _previous, onCleanup) => {
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    if (!isActive.value) return;
    const requested = [...toValue(ids)];
    loading.value = true;
    invalidIds.value = [];

    const loaded = await Promise.all(requested.map(async (id): Promise<ComparedTest | null> => {
      const cached = cache.get(id);
      if (cached) return cached;
      const entry: ComparedTest = { id, run: null, metrics: null, parameters: [], plots: [], error: null };

      try {
        entry.run = await api.getRun(id, controller.signal);
        if (!isCompareEligible(entry.run)) return null;
        entry.metrics = entry.run.evaluation ?? null;
      } catch (error) {
        if (error instanceof DaemonApiError && error.status === 404) return null;
        if (error instanceof DaemonApiError) reportFailure.value(error);
        entry.error = 'results.compare.loadFailed';
        return entry;
      }

      let names: string[] = [];
      try {
        const plan = await api.getRunPlan(id, controller.signal);
        names = evaluationPlanContext(plan.preview.spec).parameterNames;
      } catch {
        if (!controller.signal.aborted) entry.error = 'results.compare.detailsFailed';
      }

      try {
        let cursor: Cursor = { attempt: 0, seq: -1 };
        let metrics: JsonObject | null = null;
        let complete = false;

        for (let index = 0; index < 256; index++) {
          const page = await api.getEventPage(id, cursor, controller.signal, state.value.health?.daemon_id);
          metrics = evaluationResults(entry.run, page.events) ?? metrics;
          cursor = page.next_cursor;
          if (!page.more) { complete = true; break; }
        }
        if (!complete) throw new Error('Incomplete replay');
        entry.metrics = metrics ?? entry.metrics;
        entry.parameters = parameterScores(entry.metrics ?? {}, names).parameters;
      } catch {
        if (!controller.signal.aborted) entry.error = 'results.compare.detailsFailed';
      }

      try {
        const inventory = await new ArtifactClient(session).list(id, controller.signal);
        entry.plots = inventory.files.filter((artifact) => artifact.path.toLowerCase().endsWith('.png'));
      } catch {
        if (!controller.signal.aborted) entry.error = 'results.compare.detailsFailed';
      }
      if (!controller.signal.aborted) cache.set(id, entry);
      return entry;
    }));

    if (controller.signal.aborted) return;
    invalidIds.value = requested.filter((_id, index) => loaded[index] === null);
    entries.value = loaded.filter((entry): entry is ComparedTest => entry !== null);
    loading.value = false;
  }, { immediate: true });

  return { entries, invalidIds, loading, refresh: () => { cache.clear(); retry.value++; } };
}
