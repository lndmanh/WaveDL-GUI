<script setup lang="ts">
import { cn } from '@/lib/utils';
import { useReducedMotion } from 'motion-v';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search, SearchX } from '@lucide/vue';
import { artifactGroupOf } from '../../lib/artifact-list';
import { pathName } from '../../lib/run-overview';
import type { Artifact, Checkpoint } from '~~/types/artifact-client';
import type { ArtifactColumnId, ArtifactGroupKey, ArtifactSort } from '~~/types/artifact-list';

const styles = {
  search: cn(
    'h-9 w-full rounded-[0.7rem] border-0 bg-foreground/5 py-0 pr-3 pl-[2.15rem] text-sm text-foreground outline-none',
    'placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/45',
  ),
  card: cn(
    'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.25rem] border border-border/60 bg-surface',
    'shadow-[0_1px_2px_rgb(0_0_0_/_0.04)]',
  ),
  header: cn(
    'sticky top-0 z-2 h-8 bg-surface text-left text-xs font-semibold text-muted-foreground',
  ),
  sortButton: cn(
    'flex h-8 w-full min-w-0 items-center gap-1 overflow-hidden px-2 text-left outline-none',
    'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
  ),
  groupRow: cn(
    'flex h-6 items-center overflow-hidden px-2 text-[0.65rem] font-semibold tracking-[0.07em] whitespace-nowrap text-muted-foreground uppercase',
  ),
};

type ArtifactColumn = {
  id: ArtifactColumnId;
  labelKey: string;
  initialDirection: ArtifactSort['direction'];
  class: string;
};

const props = defineProps<{
  artifacts: readonly Artifact[];
  busy: boolean;
  imageUrl?: string | null;
  previewPath?: string | null;
  checkpoints?: readonly Checkpoint[];
  checkpointActions?: boolean;
  /** Stretch to the parent's height and scroll inside, like the Experiments run table. */
  fill?: boolean;
}>();

const emit = defineEmits<{
  download: [artifact: Artifact];
  preview: [artifact: Artifact];
  closePreview: [];
  evaluate: [checkpoint: string];
  export: [checkpoint: string];
}>();

const { t, locale } = useI18n({ useScope: 'global' });
const query = shallowRef('');
const filter = shallowRef<ArtifactGroupKey | 'all'>('all');
const sort = shallowRef<ArtifactSort>({ column: 'type', direction: 'asc' });
const pageSize = 50;
const page = shallowRef(1);
const viewport = useTemplateRef<HTMLDivElement>('viewport');
const reducedMotion = useReducedMotion();

const clock = useNow({
  controls: true,
  scheduler: (tick) => useIntervalFn(tick, 60_000, { immediate: false }),
});

const { isActive } = usePageActive(() => {
  clock.now.value = new Date();
  clock.resume();
}, clock.pause);

const now = clock.now;
const skipEntrance = computed(() => reducedMotion.value || !isActive.value);
let previewTrigger: HTMLElement | null = null;

const groupDefinitions: readonly { key: ArtifactGroupKey; label: string }[] = [
  { key: 'checkpoints', label: 'results.groupCheckpoints' },
  { key: 'plots', label: 'results.groupPlots' },
  { key: 'metrics', label: 'results.groupMetricsLogs' },
  { key: 'other', label: 'results.groupOther' },
];

const groupOrder = new Map(groupDefinitions.map((group, index) => [group.key, index]));
const groupLabelKeys = new Map(groupDefinitions.map((group) => [group.key, group.label]));

const columns: readonly ArtifactColumn[] = [
  { id: 'name', labelKey: 'results.columnFile', initialDirection: 'asc', class: '' },
  {
    id: 'type',
    labelKey: 'results.columnType',
    initialDirection: 'asc',
    class: 'hidden w-36 @min-[40rem]:table-cell',
  },
  { id: 'size', labelKey: 'results.columnSize', initialDirection: 'desc', class: 'w-24' },
  {
    id: 'modified',
    labelKey: 'results.modified',
    initialDirection: 'desc',
    class: 'hidden w-32 @min-[30rem]:table-cell',
  },
];

const checkpointNamesByRun = computed(() => {
  const runs = new Map<string, Map<string, number>>();

  if (!props.checkpointActions) return runs;

  for (const [index, checkpoint] of (props.checkpoints ?? []).entries()) {
    let names = runs.get(checkpoint.runId);

    if (!names) {
      names = new Map<string, number>();
      runs.set(checkpoint.runId, names);
    }

    if (!names.has(checkpoint.name)) names.set(checkpoint.name, index);
  }

  return runs;
});

const entries = computed(() =>
  props.artifacts.map((artifact) => {
    const names = checkpointNamesByRun.value.get(artifact.runId);
    let checkpoint: string | undefined;
    let firstIndex = Infinity;

    if (names) {
      // Match checkpoint inventory order, not the order of segments in the artifact path.
      for (const segment of artifact.path.split('/')) {
        const index = names.get(segment);

        if (index !== undefined && index < firstIndex) {
          checkpoint = segment;
          firstIndex = index;
        }
      }
    }

    return { artifact, group: artifactGroupOf(artifact.path), checkpoint };
  }),
);

const counts = computed(() => {
  const totals: Record<ArtifactGroupKey | 'all', number> = {
    all: 0,
    checkpoints: 0,
    plots: 0,
    metrics: 0,
    other: 0,
  };

  for (const entry of entries.value) {
    totals.all += 1;
    totals[entry.group] += 1;
  }

  return totals;
});

const filterOptions = computed<{ value: ArtifactGroupKey | 'all'; label: string }[]>(() => [
  { value: 'all', label: `${t('results.filterAll')} ${counts.value.all}` },
  ...groupDefinitions.map((group) => ({
    value: group.key,
    label: `${t(group.label)} ${counts.value[group.key]}`,
  })),
]);

const collator = computed(
  () => new Intl.Collator(locale.value, { numeric: true, sensitivity: 'base' }),
);

const visible = computed(() => {
  const needle = query.value.trim().toLowerCase();

  return entries.value.filter(
    (entry) =>
      (filter.value === 'all' || entry.group === filter.value) &&
      entry.artifact.path.toLowerCase().includes(needle),
  );
});

const grouped = computed(() => sort.value.column === 'type' && sort.value.direction === 'asc');

const ordered = computed(() => [...visible.value].sort(compareEntries));
const pageCount = computed(() => Math.max(1, Math.ceil(visible.value.length / pageSize)));

watch(
  [query, filter, sort],
  () => {
    page.value = 1;
  },
  { flush: 'sync' },
);

watch(
  pageCount,
  (count) => {
    page.value = Math.min(page.value, count);
  },
  { flush: 'sync' },
);

watch(
  page,
  () => {
    if (viewport.value) viewport.value.scrollTop = 0;
  },
  { flush: 'post' },
);

const rows = computed(() => {
  let previous: ArtifactGroupKey | null = null;

  return ordered.value.slice((page.value - 1) * pageSize, page.value * pageSize).map((entry) => {
    const startsGroup = grouped.value && entry.group !== previous;
    previous = entry.group;

    return {
      ...entry,
      heading: startsGroup ? t(groupLabelKeys.get(entry.group) ?? 'results.groupOther') : undefined,
    };
  });
});

const filtered = computed(() => filter.value !== 'all' || query.value.trim() !== '');

const previewArtifact = computed(() =>
  props.artifacts.find((artifact) => artifact.path === props.previewPath),
);

function compareEntries(
  a: { artifact: Artifact; group: ArtifactGroupKey },
  b: { artifact: Artifact; group: ArtifactGroupKey },
): number {
  const direction = sort.value.direction === 'asc' ? 1 : -1;
  const byName = collator.value.compare(pathName(a.artifact.path), pathName(b.artifact.path));
  let order = 0;

  if (sort.value.column === 'type')
    order = ((groupOrder.get(a.group) ?? 0) - (groupOrder.get(b.group) ?? 0)) * direction;
  else if (sort.value.column === 'size') order = (a.artifact.size - b.artifact.size) * direction;
  else if (sort.value.column === 'modified')
    order = (Date.parse(a.artifact.modified) - Date.parse(b.artifact.modified)) * direction || 0;
  else order = byName * direction;

  return order || byName || a.artifact.path.localeCompare(b.artifact.path);
}

function changeSort(column: ArtifactColumn) {
  sort.value = {
    column: column.id,
    direction:
      sort.value.column === column.id
        ? sort.value.direction === 'asc'
          ? 'desc'
          : 'asc'
        : column.initialDirection,
  };
}

function sortLabel(column: ArtifactColumn): string {
  const direction =
    sort.value.column === column.id
      ? sort.value.direction === 'asc'
        ? 'desc'
        : 'asc'
      : column.initialDirection;

  return t(direction === 'asc' ? 'runs.sortAscending' : 'runs.sortDescending', {
    column: t(column.labelKey),
  });
}

function clearFilters() {
  query.value = '';
  filter.value = 'all';
}

function preview(artifact: Artifact) {
  previewTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  emit('preview', artifact);
}

function restorePreviewFocus(event: Event) {
  if (!isActive.value) {
    event.preventDefault();

    return;
  }

  if (!previewTrigger?.isConnected || !previewTrigger.getClientRects().length) return;
  event.preventDefault();
  previewTrigger.focus({ preventScroll: true });
}
</script>

<template>
  <section
    :aria-label="t('results.publications')"
    :class="cn('@container flex min-w-0 max-w-full flex-col gap-3', fill && 'min-h-0 flex-1')"
  >
    <header v-if="artifacts.length" class="flex shrink-0 flex-wrap items-center gap-2">
      <label class="relative flex min-w-0 flex-[1_1_13rem] items-center">
        <Search
          class="pointer-events-none absolute left-[0.7rem] size-4 text-muted-foreground"
          aria-hidden="true"
        />
        <span class="sr-only">{{ t('results.searchFiles') }}</span>
        <input
          v-model="query"
          type="search"
          :class="styles.search"
          :placeholder="t('results.searchFilesPlaceholder')"
        />
      </label>
      <div
        class="min-w-0 max-w-full [&_.segmented-control-item]:shrink-0 [&_.segmented-control-item]:tabular-nums"
      >
        <SegmentedControl
          v-model="filter"
          :options="filterOptions"
          :label="t('results.filterFileType')"
        />
      </div>
    </header>
    <div :class="cn(styles.card, fill && 'flex-1')">
      <div
        ref="viewport"
        :class="
          cn(
            'min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-gutter:stable]',
            fill ? 'flex-1' : 'max-h-[min(36rem,70vh)]',
          )
        "
      >
        <TooltipProvider :delay-duration="280">
          <table class="w-full table-fixed border-collapse">
            <caption class="sr-only">
              {{
                t('results.publications')
              }}
            </caption>
            <thead :class="styles.header">
              <tr class="h-8">
                <th scope="col" class="h-8 w-9 p-0">
                  <span class="sr-only">{{ t('results.columnType') }}</span>
                </th>
                <th
                  v-for="column in columns"
                  :key="column.id"
                  scope="col"
                  :class="cn('h-8 overflow-hidden p-0', column.class)"
                  :aria-sort="
                    sort.column === column.id
                      ? sort.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  "
                >
                  <button
                    type="button"
                    :class="styles.sortButton"
                    :aria-label="sortLabel(column)"
                    :title="sortLabel(column)"
                    @click="changeSort(column)"
                  >
                    <span class="truncate">{{ t(column.labelKey) }}</span>
                    <component
                      :is="sort.direction === 'asc' ? ArrowUp : ArrowDown"
                      v-if="sort.column === column.id"
                      class="size-3 shrink-0"
                      aria-hidden="true"
                    />
                  </button>
                </th>
                <th scope="col" class="h-8 w-16 p-0">
                  <span class="sr-only">{{ t('results.actions') }}</span>
                </th>
              </tr>
            </thead>
            <tbody v-if="busy && !artifacts.length" aria-hidden="true">
              <tr v-for="row in 4" :key="row" class="h-[38px]">
                <td class="border-b border-border/50 p-0">
                  <div class="flex justify-center"><Skeleton class="size-4" /></div>
                </td>
                <td class="border-b border-border/50 px-2">
                  <Skeleton class="h-3 w-3/5" />
                </td>
                <td class="hidden border-b border-border/50 px-2 @min-[40rem]:table-cell">
                  <Skeleton class="h-3 w-2/3" />
                </td>
                <td class="border-b border-border/50 px-2"><Skeleton class="h-3 w-2/3" /></td>
                <td class="hidden border-b border-border/50 px-2 @min-[30rem]:table-cell">
                  <Skeleton class="h-3 w-2/3" />
                </td>
                <td class="border-b border-border/50 px-2"><Skeleton class="ml-auto size-6" /></td>
              </tr>
            </tbody>
            <tbody v-else>
              <template v-for="row in rows" :key="row.artifact.path">
                <tr v-if="row.heading" class="h-6">
                  <td :colspan="columns.length + 2" class="h-6 p-0">
                    <div :class="styles.groupRow">{{ row.heading }}</div>
                  </td>
                </tr>
                <ArtifactFileRow
                  :artifact="row.artifact"
                  :group="row.group"
                  :group-label="t(groupLabelKeys.get(row.group) ?? 'results.groupOther')"
                  :busy="busy"
                  :now="now"
                  :reduced-motion="skipEntrance"
                  :checkpoint="row.checkpoint"
                  @evaluate="emit('evaluate', $event)"
                  @export="emit('export', $event)"
                  @download="emit('download', $event)"
                  @preview="preview"
                />
              </template>
            </tbody>
          </table>
        </TooltipProvider>
        <p v-if="busy && !artifacts.length" role="status" class="sr-only">
          {{ t('results.loadingFiles') }}
        </p>
        <Empty v-else-if="!artifacts.length" role="status" class="py-8">
          <EmptyDescription>{{ t('results.noArtifacts') }}</EmptyDescription>
        </Empty>
        <div
          v-else-if="!visible.length"
          role="status"
          class="flex flex-col items-center gap-2 px-3 py-8 text-center text-sm text-muted-foreground"
        >
          <SearchX class="size-6" aria-hidden="true" />
          <p>{{ t('results.noMatchingFiles') }}</p>
          <Button v-if="filtered" variant="link" size="sm" @click="clearFilters">
            {{ t('results.clearFilters') }}
          </Button>
        </div>
      </div>
      <footer
        v-if="visible.length > pageSize"
        class="flex shrink-0 items-center gap-1 border-t border-border/60 px-3 py-2 text-xs text-muted-foreground"
      >
        <Button
          variant="ghost"
          size="icon"
          class="size-8"
          :disabled="busy || page === 1"
          :aria-label="t('runs.previous')"
          :title="t('runs.previous')"
          @click="page = Math.max(1, page - 1)"
          ><ChevronLeft aria-hidden="true"
        /></Button>
        <span role="status" aria-live="polite" class="tabular-nums">{{
          t('runs.page', { page })
        }}</span>
        <Button
          variant="ghost"
          size="icon"
          class="size-8"
          :disabled="busy || page === pageCount"
          :aria-label="t('runs.next')"
          :title="t('runs.next')"
          @click="page = Math.min(pageCount, page + 1)"
          ><ChevronRight aria-hidden="true"
        /></Button>
      </footer>
    </div>
    <ArtifactPreviewDialog
      :artifact="previewArtifact"
      :busy="busy"
      :image-url="imageUrl"
      :preview-path="previewPath"
      @download="emit('download', $event)"
      @close-preview="emit('closePreview')"
      @restore-focus="restorePreviewFocus"
    />
  </section>
</template>
