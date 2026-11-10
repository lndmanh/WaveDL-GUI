<script setup lang="ts">
import { ChevronLeft, ChevronRight, CircleAlert, RefreshCw } from '@lucide/vue';
import { createRunFilters, pathName, RUN_KINDS, runMatchesFilters } from '../../lib/run-overview';
import { isCompareEligible, parentTitle, testLocation } from '../../lib/test-runs';
import type { DaemonApi, DaemonApiError } from '../../lib/daemon-api';

const props = defineProps<{ api: DaemonApi }>();
const emit = defineEmits<{ connectionError: [error: DaemonApiError] }>();
const { t } = useI18n({ useScope: 'global' });
const { clientMessage } = useClientMessages();
const { isActive } = usePageActive();
const { runs, loading, page, message, refresh, staleRunIds } = useTestRuns(
  props.api,
  (error) => emit('connectionError', error),
);
const selection = shallowRef<string[]>([]);
const trainingRun = shallowRef('all');
const dataset = shallowRef('all');
const filters = ref(createRunFilters());
const testKinds = RUN_KINDS.filter((kind) => kind !== 'training');
const clock = useNow({
  controls: true,
  scheduler: (tick) => useIntervalFn(tick, 30_000, { immediate: false }),
});
usePageActive(() => {
  clock.now.value = new Date();
  clock.resume();
}, clock.pause);
const now = clock.now;

const trainingRuns = computed(() => {
  const options = new Map<string, string>();

  for (const run of runs.value) {
    const id = run.summary?.source_run_id;

    if (id) options.set(id, parentTitle(run) ?? id);
  }

  return [...options].sort((left, right) => left[1].localeCompare(right[1]));
});
const datasets = computed(() => [...new Set(runs.value.map((run) => pathName(run.summary?.data_path)).filter(Boolean))].sort((left, right) => left.localeCompare(right)));
const visible = computed(() => runs.value.filter((run) =>
  (trainingRun.value === 'all' || run.summary?.source_run_id === trainingRun.value) &&
  (dataset.value === 'all' || `dataset:${pathName(run.summary?.data_path)}` === dataset.value) &&
  runMatchesFilters(run, filters.value, now.value),
));
const emptyMessage = computed(() => runs.value.length ? t('runs.noMatches') : t('results.noTestsYet'));

watch(runs, (loaded) => {
  selection.value = selection.value.filter((id) => {
    const run = loaded.find((item) => item.run_id === id);

    return !run || isCompareEligible(run);
  });
});

function select(id: string) {
  const run = runs.value.find((item) => item.run_id === id);

  if (isActive.value && run) void navigateTo(testLocation(run));
}

function compare() {
  const first = selection.value[0];

  if (!isActive.value || !first || selection.value.length < 2 || selection.value.length > 8) return;
  void navigateTo({ path: '/tests/compare', query: { ids: selection.value.join(','), ref: first } });
}
</script>

<template>
  <section class="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden" :aria-label="t('results.testsPageTitle')">
    <header class="shrink-0">
      <h1 class="text-xl font-semibold">{{ t('results.testsPageTitle') }}</h1>
    </header>
    <Alert v-if="message" variant="warning" role="status" class="shrink-0">
      <CircleAlert aria-hidden="true" />
      <AlertDescription>{{ clientMessage(message) }}</AlertDescription>
    </Alert>
    <TestList
      v-model:selection="selection"
      :runs="visible"
      :loading="loading"
      :now="now"
      :selected-id="null"
      :stale-run-ids="staleRunIds"
      :empty-message="emptyMessage"
      show-training-run
      class="flex-1"
      @select="select"
      @compare="compare"
    >
      <template #filters>
        <Select v-model="trainingRun">
          <SelectTrigger class="w-full min-w-0 sm:w-44" :aria-label="t('results.filterTrainingRun')">
            <SelectValue :placeholder="t('results.filterTrainingRun')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{{ t('results.filterTrainingRun') }} · {{ t('results.filterAll') }}</SelectItem>
            <SelectItem v-for="[id, name] in trainingRuns" :key="id" :value="id">{{ name }}</SelectItem>
          </SelectContent>
        </Select>
        <Select v-model="dataset">
          <SelectTrigger class="w-full min-w-0 sm:w-44" :aria-label="t('results.filterDataset')">
            <SelectValue :placeholder="t('results.filterDataset')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{{ t('results.filterDataset') }} · {{ t('results.filterAll') }}</SelectItem>
            <SelectItem v-for="name in datasets" :key="name" :value="`dataset:${name}`">{{ name }}</SelectItem>
          </SelectContent>
        </Select>
        <RunFilterPopover v-model="filters" :runs="runs" :now="now" :show-planned="false" :allowed-kinds="testKinds" status-and-kind-only :label="t('results.filterStatus')" />
      </template>
    </TestList>
    <footer class="flex shrink-0 flex-wrap items-center justify-between gap-2">
      <div v-if="page > 0 || runs.length >= 50" class="flex items-center gap-1">
        <Button type="button" variant="ghost" size="icon" :disabled="loading || page === 0" :aria-label="t('runs.previous')" @click="refresh(Math.max(0, page - 50))"><ChevronLeft aria-hidden="true" /></Button>
        <span class="text-xs text-muted-foreground">{{ t('runs.page', { page: Math.floor(page / 50) + 1 }) }}</span>
        <Button type="button" variant="ghost" size="icon" :disabled="loading || runs.length < 50" :aria-label="t('runs.next')" @click="refresh(page + 50)"><ChevronRight aria-hidden="true" /></Button>
      </div>
      <Button type="button" variant="ghost" size="icon" class="ml-auto" :disabled="loading" :aria-label="t('runs.refresh')" @click="refresh()"><RefreshCw :class="{ 'animate-spin motion-reduce:animate-none': loading }" aria-hidden="true" /></Button>
    </footer>
  </section>
</template>
