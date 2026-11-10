<script setup lang="ts">
import { cn } from '@/lib/utils';
import { Check, ChevronLeft, ChevronRight, ChevronsUpDown, RotateCw, Search } from '@lucide/vue';
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxTrigger,
  ComboboxViewport,
} from 'reka-ui';
import { runStateMessageKeys } from '../../i18n/dynamic-keys';
import { runMatches, shortRunId } from '../../lib/run-overview';
import type { RunView } from '~~/types/daemon-api';

const styles = {
  trigger: cn('max-w-full min-w-0 justify-between gap-2 sm:w-64'),
  content: cn(
    'z-50 flex w-96 max-w-(--reka-combobox-content-available-width) flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md',
    'max-h-(--reka-combobox-content-available-height)',
  ),
  item: cn(
    'relative flex min-w-0 cursor-default items-center gap-2 rounded-sm py-2 pr-8 pl-2 text-sm outline-none select-none',
    'data-highlighted:bg-accent data-highlighted:text-accent-foreground',
  ),
};

const props = defineProps<{
  runs: readonly RunView[];
  runId: string;
  loading: boolean;
  page: number;
  staleRunIds: ReadonlySet<string>;
  now: Date;
}>();

const emit = defineEmits<{
  select: [runId: string | null];
  page: [offset: number];
  refresh: [];
}>();

const { t } = useI18n({ useScope: 'global' });
const labels = useRunLabels();
const open = shallowRef(false);
const query = shallowRef('');
const selected = computed(() => props.runs.find((run) => run.run_id === props.runId));

const title = computed(() =>
  selected.value ? labels.title(selected.value) : shortRunId(props.runId),
);

const choices = computed(() =>
  props.runs.filter((run) =>
    runMatches(run, query.value, [
      labels.title(run),
      labels.operation(run),
      t(runStateMessageKeys[run.state]),
    ]),
  ),
);

usePageActive(undefined, () => {
  open.value = false;
});

watch(open, () => {
  query.value = '';
});

watch(
  () => props.runId,
  () => {
    open.value = false;
  },
);

function choose(runId: string | null) {
  open.value = false;
  emit('select', runId);
}
</script>

<template>
  <ComboboxRoot v-model:open="open" :model-value="runId" ignore-filter class="min-w-0 max-w-full">
    <ComboboxAnchor as-child>
      <ComboboxTrigger as-child tabindex="0" :aria-label="t('results.switchRun', { name: title })">
        <Button variant="outline" :class="styles.trigger" :title="title">
          <span class="truncate">{{ title }}</span>
          <ChevronsUpDown class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Button>
      </ComboboxTrigger>
    </ComboboxAnchor>
    <ComboboxPortal>
      <ComboboxContent
        position="popper"
        align="end"
        :side-offset="4"
        :collision-padding="16"
        :class="styles.content"
        :aria-label="t('results.chooseRun')"
      >
        <div class="relative shrink-0 border-b p-2">
          <Search
            class="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <ComboboxInput v-model="query" :display-value="() => ''" as-child>
            <Input
              class="pl-8"
              :aria-label="t('results.searchRuns')"
              :placeholder="t('results.searchRunsPlaceholder')"
            />
          </ComboboxInput>
        </div>
        <ComboboxViewport class="min-h-0 max-h-80 overflow-y-auto overscroll-contain p-1">
          <ComboboxItem value="all-runs" :class="styles.item" @select="choose(null)">
            {{ t('results.allRuns') }}
          </ComboboxItem>
          <ComboboxItem
            v-for="run in choices"
            :key="run.run_id"
            :value="run.run_id"
            :text-value="labels.title(run)"
            :class="styles.item"
            @select="choose(run.run_id)"
          >
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <span class="truncate" :title="labels.title(run)">{{ labels.title(run) }}</span>
              <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <Badge variant="secondary" class="text-muted-foreground">{{
                  labels.operation(run)
                }}</Badge>
                <span inert>
                  <RunStateChip :run="run" :stale="staleRunIds.has(run.run_id)" compact />
                </span>
                <span class="text-xs text-muted-foreground">{{
                  labels.created(run, now) ?? t('runs.unavailable')
                }}</span>
              </div>
              <span class="sr-only">
                {{ t(runStateMessageKeys[run.state]) }}
                {{ staleRunIds.has(run.run_id) ? t('runs.stale') : '' }}
                {{ run.uncertainty ? t('runs.uncertain') : '' }}
              </span>
            </div>
            <ComboboxItemIndicator class="absolute right-2 flex size-4 items-center justify-center">
              <Check class="size-4" aria-hidden="true" />
            </ComboboxItemIndicator>
          </ComboboxItem>
          <Empty v-if="loading && !runs.length" role="status" class="p-3">
            <EmptyHeader>
              <EmptyMedia><LoadingSpinner compact size="sm" /></EmptyMedia>
              <EmptyDescription>{{ t('results.loadingRuns') }}</EmptyDescription>
            </EmptyHeader>
          </Empty>
          <p v-else-if="!choices.length" role="status" class="p-3 text-sm text-muted-foreground">
            {{ t('results.noMatchingRuns') }}
          </p>
        </ComboboxViewport>
        <div class="flex shrink-0 items-center justify-between gap-2 border-t p-1">
          <div v-if="page > 0 || runs.length >= 50" class="flex min-w-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              :disabled="loading || page === 0"
              :aria-label="t('runs.previous')"
              @click="emit('page', Math.max(0, page - 50))"
              ><ChevronLeft aria-hidden="true"
            /></Button>
            <span class="text-xs text-muted-foreground">{{
              t('runs.page', { page: Math.floor(page / 50) + 1 })
            }}</span>
            <Button
              variant="ghost"
              size="icon"
              :disabled="loading || runs.length < 50"
              :aria-label="t('runs.next')"
              @click="emit('page', page + 50)"
              ><ChevronRight aria-hidden="true"
            /></Button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            class="ml-auto"
            :disabled="loading"
            :aria-label="t('runs.refresh')"
            @click="emit('refresh')"
          >
            <RotateCw
              :class="{ 'animate-spin motion-reduce:animate-none': loading }"
              aria-hidden="true"
            />
          </Button>
        </div>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>
