<script setup lang="ts">
import { cn } from '@/lib/utils';
import { Download, Ellipsis, Eye } from '@lucide/vue';
import { formatBytes, pathName, relativeTime } from '../../lib/run-overview';
import type { ArtifactImages } from '../../composables/useArtifactImages';
import type { Artifact } from '~~/types/artifact-client';
import type { ArtifactGroupKey } from '~~/types/artifact-list';

const styles = {
  card: cn(
    'group/artifact flex min-w-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-surface',
    'shadow-[0_1px_2px_rgb(0_0_0_/_0.04)] transition-colors motion-reduce:transition-none',
    'hover:border-border focus-within:border-ring/60',
  ),
  preview: cn(
    'relative block aspect-[4/3] w-full overflow-hidden border-b border-border/50 bg-white p-0',
    'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
    '[&_img]:bg-white',
  ),
  tile: cn(
    'relative flex aspect-[4/3] items-center justify-center border-b border-border/50 bg-muted/30',
  ),
  badge: cn(
    'absolute right-3 bottom-3 max-w-[calc(100%-1.5rem)] truncate rounded-md border border-border/60',
    'bg-background/80 px-1.5 py-0.5 text-[0.6rem] font-semibold tracking-wide text-muted-foreground uppercase',
  ),
};

const props = defineProps<{
  artifact: Artifact;
  group: ArtifactGroupKey;
  groupLabel: string;
  busy: boolean;
  now: Date;
  images: ArtifactImages;
  checkpoint?: string;
}>();

const emit = defineEmits<{
  download: [artifact: Artifact];
  preview: [artifact: Artifact];
  evaluate: [checkpoint: string];
  export: [checkpoint: string];
}>();

const { t, locale } = useI18n({ useScope: 'global' });
const numberLocale = computed(() => (locale.value === 'vi' ? 'vi-VN' : 'en-US'));
const name = computed(() => pathName(props.artifact.path));
const folder = computed(() => props.artifact.path.slice(0, -name.value.length));
const png = computed(() => props.artifact.path.toLowerCase().endsWith('.png'));

const extension = computed(() => {
  const index = name.value.lastIndexOf('.');

  return index > 0 && index < name.value.length - 1 ? name.value.slice(index + 1) : '';
});

const modified = computed(() => new Date(props.artifact.modified));
const exactTime = computed(() => modified.value.toLocaleString(numberLocale.value));
const size = computed(() => formatBytes(props.artifact.size, numberLocale.value));
const modifiedTime = computed(() => relativeTime(modified.value, props.now, locale.value));
</script>

<template>
  <article
    :class="styles.card"
    :data-artifact-path="artifact.path"
    :data-artifact-size="artifact.size"
  >
    <button
      v-if="png"
      type="button"
      :class="styles.preview"
      :aria-label="t('results.previewFile', { path: artifact.path })"
      :title="t('results.previewFile', { path: artifact.path })"
      @click="emit('preview', artifact)"
    >
      <ArtifactImage :artifact="artifact" :images="images" :alt="name" class="rounded-none" />
    </button>
    <div v-else :class="styles.tile">
      <ArtifactFileIcon
        :path="artifact.path"
        :group="group"
        class="size-12 text-muted-foreground/70"
      />
      <span :class="styles.badge" :title="groupLabel">{{ extension || groupLabel }}</span>
    </div>
    <div class="flex min-w-0 flex-1 flex-col gap-2.5 p-3">
      <div class="min-w-0">
        <p class="truncate text-sm font-semibold tracking-[-0.01em]" :title="name">{{ name }}</p>
        <p v-if="folder" class="mt-0.5 truncate text-xs text-muted-foreground" :title="folder">
          {{ folder }}
        </p>
        <span class="sr-only">{{ groupLabel }}</span>
      </div>
      <div
        class="mt-auto flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
      >
        <span class="shrink-0 tabular-nums" :aria-label="t('results.fileSize', { size })">{{
          size
        }}</span>
        <span aria-hidden="true" class="text-border">·</span>
        <Tooltip>
          <TooltipTrigger as-child>
            <time
              :datetime="artifact.modified"
              :aria-label="`${t('results.modified')} ${exactTime}`"
              tabindex="0"
              class="min-w-0 truncate rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >{{ modifiedTime }}</time
            >
          </TooltipTrigger>
          <TooltipContent>{{ exactTime }}</TooltipContent>
        </Tooltip>
      </div>
      <div
        class="flex min-w-0 items-center justify-end gap-0.5 border-t border-border/50 pt-2"
        role="group"
        :aria-label="t('results.actions')"
      >
        <Tooltip v-if="png">
          <TooltipTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              :aria-label="t('results.previewFile', { path: artifact.path })"
              @click="emit('preview', artifact)"
              ><Eye aria-hidden="true"
            /></Button>
          </TooltipTrigger>
          <TooltipContent>{{ t('results.viewPng') }}</TooltipContent>
        </Tooltip>
        <DropdownMenu v-if="checkpoint">
          <DropdownMenuTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              :disabled="busy"
              :aria-label="t('results.checkpointActions', { path: artifact.path })"
              ><Ellipsis aria-hidden="true"
            /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem @select="emit('evaluate', checkpoint)">{{
              t('results.evaluateAction')
            }}</DropdownMenuItem>
            <DropdownMenuItem @select="emit('export', checkpoint)">{{
              t('results.exportOnnxAction')
            }}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem @select="emit('download', artifact)">{{
              t('results.download')
            }}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip v-else>
          <TooltipTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              :disabled="busy"
              :aria-label="t('results.downloadFile', { path: artifact.path })"
              @click="emit('download', artifact)"
              ><Download aria-hidden="true"
            /></Button>
          </TooltipTrigger>
          <TooltipContent>{{ t('results.download') }}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  </article>
</template>
