<script setup lang="ts">
import { cn } from '@/lib/utils';
import { motion, useReducedMotion } from 'motion-v';
import type { AcceptableValue } from 'reka-ui';
import { artifactGroupOf } from '../../lib/artifact-list';
import type { Artifact } from '~~/types/artifact-client';
import type { ArtifactGroupKey } from '~~/types/artifact-list';

const styles = {
  toolbar: cn('flex min-w-0 flex-col gap-2'),
  group: cn('min-w-0 overflow-hidden rounded-lg border'),
  groupHeader: cn('flex items-center justify-between gap-3 border-b bg-muted/30 px-3 py-2'),
};

const props = defineProps<{
  artifacts: readonly Artifact[];
  busy: boolean;
  imageUrl?: string | null;
  previewPath?: string | null;
}>();
const emit = defineEmits<{
  download: [artifact: Artifact];
  preview: [artifact: Artifact];
  closePreview: [];
}>();
const { t, locale } = useI18n({ useScope: 'global' });
const id = useId();
const query = shallowRef('');
const filter = shallowRef<ArtifactGroupKey | 'all'>('all');
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
const numberLocale = computed(() => locale.value === 'vi' ? 'vi-VN' : 'en-US');
let previewTrigger: HTMLElement | null = null;

const groupDefinitions: readonly { key: ArtifactGroupKey; label: string }[] = [
  { key: 'checkpoints', label: 'results.groupCheckpoints' },
  { key: 'plots', label: 'results.groupPlots' },
  { key: 'metrics', label: 'results.groupMetricsLogs' },
  { key: 'other', label: 'results.groupOther' },
];
const filters = computed(() => [
  { value: 'all', label: t('results.filterAll') },
  ...groupDefinitions.map((group) => ({ value: group.key, label: t(group.label) })),
]);
const groups = computed(() => {
  const buckets: Record<ArtifactGroupKey, Artifact[]> = {
    checkpoints: [],
    plots: [],
    metrics: [],
    other: [],
  };
  const needle = query.value.trim().toLowerCase();

  for (const artifact of props.artifacts) {
    const key = artifactGroupOf(artifact.path);

    if (filter.value !== 'all' && filter.value !== key) continue;

    if (!artifact.path.toLowerCase().includes(needle)) continue;
    buckets[key].push(artifact);
  }

  return groupDefinitions
    .map((group) => ({ ...group, files: buckets[group.key] }))
    .filter((group) => group.files.length > 0);
});
const previewArtifact = computed(() =>
  props.artifacts.find((artifact) => artifact.path === props.previewPath),
);

function chooseFilter(value: AcceptableValue | AcceptableValue[]) {
  // Pressing the selected toggle again must not leave the filter without a selection.
  if (value === 'all' || groupDefinitions.some((group) => group.key === value)) {
    const group = groupDefinitions.find((item) => item.key === value);
    filter.value = group?.key ?? 'all';
  }
}

function preview(artifact: Artifact) {
  previewTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  emit('preview', artifact);
}

function restorePreviewFocus(event: Event) {
  if (!previewTrigger?.isConnected || !previewTrigger.getClientRects().length) return;
  event.preventDefault();
  previewTrigger.focus({ preventScroll: true });
}
</script>

<template>
  <section
    :aria-label="t('results.publications')"
    class="@container flex min-w-0 max-w-full flex-col gap-3"
  >
    <div v-if="artifacts.length" :class="styles.toolbar">
      <Input
        v-model="query"
        type="search"
        :aria-label="t('results.searchFiles')"
        :placeholder="t('results.searchFilesPlaceholder')"
      />
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        :spacing="1"
        :model-value="filter"
        :aria-label="t('results.filterFileType')"
        class="max-w-full flex-wrap justify-start"
        @update:model-value="chooseFilter"
      >
        <ToggleGroupItem v-for="option in filters" :key="option.value" :value="option.value">
          {{ option.label }}
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
    <div v-if="busy && !artifacts.length" role="status" class="overflow-hidden rounded-lg border">
      <span class="sr-only">{{ t('results.loadingFiles') }}</span>
      <ul aria-hidden="true" class="divide-y">
        <li v-for="row in 4" :key="row" class="flex items-center gap-3 px-3 py-3">
          <Skeleton class="size-4 shrink-0" />
          <div class="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton class="h-3 w-3/5" />
            <Skeleton class="h-2.5 w-2/5" />
          </div>
          <Skeleton class="size-8 shrink-0" />
        </li>
      </ul>
    </div>
    <TooltipProvider :delay-duration="280">
      <motion.div
        v-for="group in groups"
        :key="group.key"
        as-child
        :initial="skipEntrance ? false : { opacity: 0, y: 6 }"
        :animate="{ opacity: 1, y: 0 }"
        :transition="skipEntrance ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 30 }"
      >
        <section :class="styles.group" :aria-labelledby="`${id}-${group.key}`">
          <header :class="styles.groupHeader">
            <h4 :id="`${id}-${group.key}`" class="text-xs font-semibold">{{ t(group.label) }}</h4>
            <Badge variant="secondary" class="tabular-nums">
              {{ group.files.length.toLocaleString(numberLocale) }}
            </Badge>
          </header>
          <ul role="list" class="divide-y divide-border/60">
            <ArtifactFileRow
              v-for="artifact in group.files"
              :key="artifact.path"
              :artifact="artifact"
              :busy="busy"
              :now="now"
              :reduced-motion="skipEntrance"
              @download="emit('download', $event)"
              @preview="preview"
            />
          </ul>
        </section>
      </motion.div>
    </TooltipProvider>
    <Empty v-if="artifacts.length && !groups.length">
      <EmptyDescription role="status">{{ t('results.noMatchingFiles') }}</EmptyDescription>
    </Empty>
    <Empty v-else-if="!artifacts.length && !busy">
      <EmptyDescription>{{ t('results.noArtifacts') }}</EmptyDescription>
    </Empty>
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
