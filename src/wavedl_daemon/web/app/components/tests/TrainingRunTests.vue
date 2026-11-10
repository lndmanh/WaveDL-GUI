<script setup lang="ts">
import { ChevronLeft, ChevronRight, RefreshCw } from '@lucide/vue';
import { DaemonApiError, isUuid } from '../../lib/daemon-api';
import { isCompareEligible, isTestRun, trainingTestsQuery } from '../../lib/test-runs';
import type { DaemonApi } from '../../lib/daemon-api';
import type { ConnectionSession } from '../../lib/connection-session';
import type { TrainingBaseline } from '../../lib/evaluation-scorecard';
import type { RunView } from '~~/types/daemon-api';

const props = defineProps<{
  api: DaemonApi;
  session: ConnectionSession;
  sourceRunId: string;
  sourceName: string;
  runs: readonly RunView[];
  loading: boolean;
  page: number;
  staleRunIds: ReadonlySet<string>;
  now: Date;
  baseline: TrainingBaseline | null;
}>();
const emit = defineEmits<{ refresh: [offset?: number] }>();
const { t } = useI18n({ useScope: 'global' });
const { clientMessage } = useClientMessages();
const { reportFailure } = useWorkstation();
const { isActive } = usePageActive();
const router = useRouter();
const root = useTemplateRef<HTMLElement>('root');
const { width } = useElementSize(root);
const stacked = computed(() => width.value < 1024);
const requestedId = computed(() => {
  const value = router.currentRoute.value.query.test;

  return typeof value === 'string' ? value : null;
});
const validatedId = shallowRef<string | null>(null);
const selection = shallowRef<string[]>([]);
const validationError = shallowRef<Error | null>(null);
const retry = shallowRef(0);
const back = computed(() => {
  const route = router.currentRoute.value;
  const query = trainingTestsQuery(route.query);

  return { label: `${props.sourceName} › ${t('results.tests')}`, to: router.resolve({ path: route.path, query, hash: route.hash }).href };
});

function removeInvalidTest() {
  const route = router.currentRoute.value;
  const query = trainingTestsQuery(route.query);
  void router.replace({ path: route.path, query, hash: route.hash });
}

watch([requestedId, () => props.sourceRunId, isActive, retry], async ([id, sourceId, active], _previous, onCleanup) => {
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  validatedId.value = null;
  validationError.value = null;

  if (!active || !id) return;

  if (!isUuid(id)) {
    removeInvalidTest();

    return;
  }

  const listed = props.runs.find((run) => run.run_id === id && run.summary?.source_run_id === sourceId && isTestRun(run));

  if (listed) {
    validatedId.value = id;

    return;
  }

  try {
    const run = await props.api.getRun(id, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]));

    if (controller.signal.aborted) return;

    if (isTestRun(run) && run.summary?.source_run_id === sourceId) validatedId.value = id;
    else removeInvalidTest();
  } catch (error) {
    if (controller.signal.aborted) return;

    if (error instanceof DaemonApiError && error.status === 404) removeInvalidTest();
    else {
      validationError.value = error instanceof Error ? error : new Error(String(error));

      if (error instanceof DaemonApiError) reportFailure.value(error);
    }
  }
}, { immediate: true, flush: 'sync' });

watch(() => props.sourceRunId, () => { selection.value = []; }, { flush: 'sync' });
watch(() => props.runs, (runs) => {
  selection.value = selection.value.filter((id) => {
    const run = runs.find((item) => item.run_id === id);

    return !run || isCompareEligible(run);
  });
});

function select(id: string) {
  if (!isActive.value) return;
  const route = router.currentRoute.value;
  void router.push({ path: route.path, query: { ...route.query, tab: 'tests', test: id }, hash: route.hash });
}

function compare() {
  const first = selection.value[0];

  if (!first || selection.value.length < 2 || selection.value.length > 8 || !isActive.value) return;
  void router.push({ path: '/tests/compare', query: { ids: selection.value.join(','), ref: first } });
}
</script>

<template>
  <div ref="root" class="min-h-0 min-w-0 flex-1">
    <div class="grid h-full min-h-0 min-w-0 gap-4" :class="requestedId && !stacked ? 'grid-cols-[minmax(0,5fr)_minmax(0,6fr)]' : 'grid-cols-1'">
      <div v-show="!requestedId || !stacked" class="flex min-h-0 min-w-0 flex-col gap-3">
        <TestList v-model:selection="selection" :runs="runs" :loading="loading" :now="now" :selected-id="requestedId" :baseline="baseline" :stale-run-ids="staleRunIds" @select="select" @compare="compare" />
        <footer class="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <div v-if="page > 0 || runs.length >= 50" class="flex items-center gap-1">
            <Button type="button" variant="ghost" size="icon" :disabled="loading || page === 0" :aria-label="t('runs.previous')" @click="emit('refresh', Math.max(0, page - 50))"><ChevronLeft aria-hidden="true" /></Button>
            <span class="text-xs text-muted-foreground">{{ t('runs.page', { page: Math.floor(page / 50) + 1 }) }}</span>
            <Button type="button" variant="ghost" size="icon" :disabled="loading || runs.length < 50" :aria-label="t('runs.next')" @click="emit('refresh', page + 50)"><ChevronRight aria-hidden="true" /></Button>
          </div>
          <Button type="button" variant="ghost" size="icon" class="ml-auto" :disabled="loading" :aria-label="t('runs.refresh')" @click="emit('refresh')"><RefreshCw :class="{ 'animate-spin motion-reduce:animate-none': loading }" aria-hidden="true" /></Button>
        </footer>
      </div>
      <TestDetail v-if="validatedId" :api="api" :session="session" :run-id="validatedId" :back="back" />
      <div v-else-if="requestedId" class="flex min-h-0 min-w-0 flex-col gap-3">
        <NuxtLink :to="back.to" class="text-sm text-muted-foreground hover:text-foreground">{{ back.label }}</NuxtLink>
        <Alert v-if="validationError" variant="warning" role="status"><AlertDescription>{{ clientMessage(validationError) }}<Button type="button" variant="outline" size="sm" @click="retry++">{{ t('results.refresh') }}</Button></AlertDescription></Alert>
        <p v-else role="status" class="text-sm text-muted-foreground">{{ t('results.loadingRuns') }}</p>
      </div>
    </div>
  </div>
</template>
