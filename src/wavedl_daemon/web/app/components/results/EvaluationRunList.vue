<script setup lang="ts">
import { Search, SearchX } from '@lucide/vue';
import { cn } from '@/lib/utils';
import { createRunFilters, pathName, runMatches, runMatchesFilters } from '../../lib/run-overview';
import type { RunView } from '~~/types/daemon-api';
import type { RunFilterState } from '~~/types/run-overview';

const props = defineProps<{
  runs: readonly RunView[];
  now: Date;
  canEvaluate: boolean;
  staleRunIds: ReadonlySet<string>;
}>();

const emit = defineEmits<{ select: [runId: string]; evaluate: [] }>();
const { t } = useI18n({ useScope: 'global' });
const labels = useRunLabels();
const query = shallowRef('');
const filters = shallowRef<RunFilterState>(createRunFilters());
const list = useTemplateRef<HTMLUListElement>('list');
const search = useTemplateRef<HTMLInputElement>('search');

const visible = computed(() =>
  props.runs.filter(
    (run) =>
      runMatchesFilters(run, filters.value, props.now) &&
      runMatches(run, query.value, [labels.operation(run)]),
  ),
);

const styles = {
  search: cn(
    'h-9 w-full rounded-[0.7rem] border-0 bg-foreground/5 py-0 pr-3 pl-[2.15rem] text-sm text-foreground outline-none',
    'placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/45',
  ),
  row: cn(
    'flex min-w-0 flex-wrap items-center gap-3 border-b border-border/50 p-4 last:border-0 hover:bg-muted/50 focus-within:bg-muted/50',
  ),
  select: cn(
    'min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
  ),
};

function clearFilters() {
  query.value = '';
  filters.value = createRunFilters();
}

function focusRow(runId: string) {
  const row = Array.from(
    list.value?.querySelectorAll<HTMLButtonElement>('button[data-run-id]') ?? [],
  ).find((button) => button.dataset.runId === runId);

  if (row) row.focus();
  else search.value?.focus();
}

function enterList(event: KeyboardEvent) {
  const first = visible.value[0];

  if (!first || event.defaultPrevented || event.isComposing) return;
  event.preventDefault();
  focusRow(first.run_id);
}

function move(event: KeyboardEvent, step: -1 | 1) {
  if (event.defaultPrevented || event.isComposing) return;
  const target = event.currentTarget;
  const runId = target instanceof HTMLElement ? target.dataset.runId : undefined;
  const index = visible.value.findIndex((run) => run.run_id === runId);

  const next =
    index < 0
      ? undefined
      : visible.value[Math.max(0, Math.min(visible.value.length - 1, index + step))];

  if (!next) return;
  event.preventDefault();
  focusRow(next.run_id);
}
</script>

<template>
  <section :aria-label="t('results.evaluations')" class="flex min-w-0 flex-col gap-3">
    <header class="flex min-w-0 flex-wrap items-center gap-2">
      <label class="relative flex min-w-0 flex-[1_1_13rem] items-center">
        <Search
          class="pointer-events-none absolute left-3 size-4 text-muted-foreground"
          aria-hidden="true"
        />
        <span class="sr-only">{{ t('runs.searchRuns') }}</span>
        <input
          ref="search"
          v-model="query"
          type="search"
          :class="styles.search"
          :placeholder="t('runs.searchPlaceholder')"
          @keydown.down="enterList"
        />
      </label>
      <RunFilterPopover v-model="filters" :runs="runs" :now="now" :show-planned="false" />
    </header>
    <div class="overflow-hidden rounded-xl border bg-surface">
      <ul v-if="visible.length" ref="list">
        <li
          v-for="run in visible"
          :key="run.run_id"
          :class="styles.row"
          @click="emit('select', run.run_id)"
        >
          <RunStateChip :run="run" :stale="staleRunIds.has(run.run_id)" />
          <button
            type="button"
            :class="styles.select"
            :data-run-id="run.run_id"
            @keydown.down="move($event, 1)"
            @keydown.up="move($event, -1)"
          >
            <span class="block truncate text-sm font-medium">{{
              pathName(run.summary?.data_path) || t('results.unknownDataset')
            }}</span>
            <span class="block text-xs text-muted-foreground"
              >{{ labels.operation(run)
              }}<template v-if="labels.created(run, now)">
                · {{ labels.created(run, now) }}</template
              ></span
            >
            <span class="sr-only">{{ run.run_id }}</span>
          </button>
        </li>
      </ul>
      <Empty v-else-if="runs.length" role="status" class="py-10">
        <EmptyHeader>
          <EmptyMedia variant="icon"><SearchX aria-hidden="true" /></EmptyMedia>
          <EmptyTitle>{{ t('runs.noMatches') }}</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <Button type="button" variant="link" size="sm" @click="clearFilters">{{
            t('runs.clearFilters')
          }}</Button>
        </EmptyContent>
      </Empty>
      <Empty v-else class="py-10">
        <EmptyDescription>{{ t('results.noEvaluations') }}</EmptyDescription>
        <EmptyContent
          ><Button type="button" :disabled="!canEvaluate" @click="emit('evaluate')">{{
            t('results.evaluate')
          }}</Button></EmptyContent
        >
      </Empty>
    </div>
  </section>
</template>
