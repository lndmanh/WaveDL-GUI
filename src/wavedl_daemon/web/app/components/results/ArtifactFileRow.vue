<script setup lang="ts">
import { cn } from '@/lib/utils';
import { Download, Eye, File, FileJson, FileSpreadsheet, Image, Package, ScrollText } from '@lucide/vue';
import { motion } from 'motion-v';
import { artifactGroupOf } from '../../lib/artifact-list';
import { formatBytes, pathName, relativeTime } from '../../lib/run-overview';
import type { Artifact } from '~~/types/artifact-client';

const styles = {
  row: cn(
    'grid min-w-0 grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2.5',
    'transition-colors hover:bg-muted/40 focus-within:bg-muted/40 motion-reduce:transition-none',
    '@min-[40rem]:grid-cols-[1rem_minmax(0,1fr)_15rem_auto]',
  ),
  metadata: cn(
    'col-start-2 row-start-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums',
    '@min-[40rem]:col-start-3 @min-[40rem]:row-start-1',
  ),
  actions: cn(
    'col-start-3 row-span-2 row-start-1 flex items-center gap-1',
    '@min-[40rem]:col-start-4 @min-[40rem]:row-span-1',
  ),
};

const props = defineProps<{
  artifact: Artifact;
  busy: boolean;
  now: Date;
  reducedMotion: boolean;
}>();
const emit = defineEmits<{ download: [artifact: Artifact]; preview: [artifact: Artifact] }>();
const { t, locale } = useI18n({ useScope: 'global' });
const numberLocale = computed(() => locale.value === 'vi' ? 'vi-VN' : 'en-US');
const name = computed(() => pathName(props.artifact.path));
const folder = computed(() => props.artifact.path.slice(0, -name.value.length));
const png = computed(() => props.artifact.path.toLowerCase().endsWith('.png'));
const modified = computed(() => new Date(props.artifact.modified));
const exactTime = computed(() => modified.value.toLocaleString(numberLocale.value));
const size = computed(() => formatBytes(props.artifact.size, numberLocale.value));
const modifiedTime = computed(() => relativeTime(modified.value, props.now, locale.value, 'short'));
const icon = computed(() => {
  if (artifactGroupOf(props.artifact.path) === 'checkpoints') return Package;

  if (png.value) return Image;

  const path = props.artifact.path.toLowerCase();

  if (path.endsWith('.json')) return FileJson;

  if (path.endsWith('.csv')) return FileSpreadsheet;

  if (/\.(log|txt)$/.test(path)) return ScrollText;

  return File;
});
</script>

<template>
  <motion.div
    as-child
    :initial="reducedMotion ? false : { opacity: 0, y: 4 }"
    :animate="{ opacity: 1, y: 0 }"
    :transition="reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 30 }"
  >
    <li
      :class="styles.row"
      :data-artifact-path="artifact.path"
      :data-artifact-size="artifact.size"
    >
      <component :is="icon" class="size-4 self-start text-muted-foreground" aria-hidden="true" />
      <div class="min-w-0" :title="artifact.path">
        <p class="truncate text-sm font-medium">{{ name }}</p>
        <p v-if="folder" class="truncate text-xs text-muted-foreground">{{ folder }}</p>
      </div>
      <div :class="styles.metadata">
        <span class="shrink-0" :aria-label="t('results.fileSize', { size })">{{ size }}</span>
        <Tooltip>
          <TooltipTrigger as-child>
            <time
              :datetime="artifact.modified"
              :title="exactTime"
              :aria-label="`${t('results.modified')} ${exactTime}`"
              tabindex="0"
              class="min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >{{ modifiedTime }}</time>
          </TooltipTrigger>
          <TooltipContent>{{ exactTime }}</TooltipContent>
        </Tooltip>
      </div>
      <div :class="styles.actions" role="group" :aria-label="t('results.actions')">
        <Tooltip v-if="png">
          <TooltipTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              :disabled="busy"
              :aria-label="t('results.previewFile', { path: artifact.path })"
              @click="emit('preview', artifact)"
            ><Eye aria-hidden="true" /></Button>
          </TooltipTrigger>
          <TooltipContent>{{ t('results.viewPng') }}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              :disabled="busy"
              :aria-label="t('results.downloadFile', { path: artifact.path })"
              @click="emit('download', artifact)"
            ><Download aria-hidden="true" /></Button>
          </TooltipTrigger>
          <TooltipContent>{{ t('results.download') }}</TooltipContent>
        </Tooltip>
      </div>
    </li>
  </motion.div>
</template>
