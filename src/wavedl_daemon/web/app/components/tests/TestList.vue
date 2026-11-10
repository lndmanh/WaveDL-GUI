<script setup lang="ts">
import { Search } from '@lucide/vue';
import { isCompareEligible, parentTitle } from '../../lib/test-runs';
import { runMatches } from '../../lib/run-overview';
import type { TrainingBaseline } from '../../lib/evaluation-scorecard';
import type { RunView } from '~~/types/daemon-api';

const props = defineProps<{
  runs: readonly RunView[];
  loading: boolean;
  now: Date;
  selectedId: string | null;
  selection: readonly string[];
  showTrainingRun?: boolean;
  emptyMessage?: string;
  baseline?: TrainingBaseline | null;
  staleRunIds: ReadonlySet<string>;
}>();
const emit = defineEmits<{
  select: [id: string];
  'update:selection': [ids: string[]];
  compare: [];
}>();
const { t } = useI18n({ useScope: 'global' });
const query = shallowRef('');
const list = useTemplateRef<HTMLTableElement>('list');
const visible = computed(() => props.runs.filter((run) => runMatches(run, query.value, [parentTitle(run) ?? '', run.summary?.source_model ?? ''])));
const canCompare = computed(() => props.selection.length >= 2 && props.selection.length <= 8);

function check(id: string, checked: boolean) {
  if (!checked) emit('update:selection', props.selection.filter((value) => value !== id));
  else if (!props.selection.includes(id) && props.selection.length < 8 && props.runs.some((run) => run.run_id === id && isCompareEligible(run)))
    emit('update:selection', [...props.selection, id]);
}

function focusRow(index: number) {
  list.value?.querySelectorAll<HTMLButtonElement>('button.test-row')[index]?.focus();
}

function enterList(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || !visible.value.length) return;
  event.preventDefault();
  focusRow(0);
}

function move(event: KeyboardEvent, step: -1 | 1) {
  if (event.defaultPrevented || event.isComposing) return;
  const target = event.currentTarget;
  const id = target instanceof HTMLElement ? target.dataset.testId : undefined;
  const index = visible.value.findIndex((run) => run.run_id === id);

  if (index < 0) return;
  event.preventDefault();
  focusRow(Math.max(0, Math.min(visible.value.length - 1, index + step)));
}
</script>

<template>
  <section :aria-label="t('results.tests')" class="flex min-h-0 min-w-0 flex-col gap-3">
    <header class="flex flex-wrap items-center gap-2">
      <label class="relative min-w-0 flex-[1_1_12rem]">
        <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <span class="sr-only">{{ t('results.searchTests') }}</span>
        <Input v-model="query" type="search" class="pl-9" :placeholder="t('results.searchTests')" @keydown.down="enterList" />
      </label>
      <slot name="filters" />
      <Button type="button" variant="outline" :disabled="!canCompare" @click="emit('compare')">{{ t('results.compareCount', { count: selection.length }) }}</Button>
    </header>
    <div class="min-h-0 overflow-y-auto overscroll-contain rounded-xl border bg-surface" :aria-busy="loading">
      <TooltipProvider>
        <table v-if="visible.length" ref="list" class="w-full table-fixed border-collapse" :aria-label="t('results.tests')">
          <thead v-if="showTrainingRun" class="border-b text-[0.7rem] text-muted-foreground">
            <tr>
              <th scope="col" class="w-9"><span class="sr-only">{{ t('results.compareCount', { count: selection.length }) }}</span></th>
              <th scope="col" class="w-6"><span class="sr-only">{{ t('runs.columnState') }}</span></th>
              <th scope="col" class="px-2 py-2 text-left font-medium">{{ t('results.tests') }}</th>
              <th scope="col" class="hidden w-1/4 px-2 py-2 text-left font-medium sm:table-cell">{{ t('results.filterTrainingRun') }}</th>
              <th scope="col" class="w-40 px-2 py-2 text-right font-medium">R² · RMSE · {{ t('runs.columnCreated') }}</th>
            </tr>
          </thead>
          <tbody>
            <TestListRow
              v-for="run in visible"
              :key="run.run_id"
              :run="run"
              :now="now"
              :selected="run.run_id === selectedId"
              :checked="selection.includes(run.run_id)"
              :show-training-run="showTrainingRun"
              :baseline="baseline"
              :stale="staleRunIds.has(run.run_id)"
              @select="emit('select', $event)"
              @check="check"
              @move="move"
            />
          </tbody>
        </table>
        <Empty v-else role="status" class="py-10">
          <EmptyDescription>{{ loading ? t('results.loadingRuns') : runs.length ? t('runs.noMatches') : emptyMessage ?? t('results.noTests') }}</EmptyDescription>
        </Empty>
      </TooltipProvider>
    </div>
    <p class="text-xs text-muted-foreground">{{ t('results.compareLimit') }}</p>
  </section>
</template>
