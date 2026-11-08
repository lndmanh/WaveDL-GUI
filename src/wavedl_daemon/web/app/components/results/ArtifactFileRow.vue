<script setup lang="ts">
import { cn } from '@/lib/utils';
import {
  Download,
  Ellipsis,
  Eye,
  File,
  FileJson,
  FileSpreadsheet,
  Image,
  Package,
  ScrollText,
} from '@lucide/vue';
import { motion } from 'motion-v';
import { formatBytes, pathName, relativeTime } from '../../lib/run-overview';
import type { Artifact } from '~~/types/artifact-client';
import type { ArtifactGroupKey } from '~~/types/artifact-list';

const styles = {
  row: cn(
    'h-[38px] text-sm transition-colors motion-reduce:transition-none',
    'hover:bg-muted/50 focus-within:bg-muted/50',
  ),
  cell: cn('h-[38px] min-w-0 overflow-hidden whitespace-nowrap border-b border-border/50 px-2'),
};

const props = defineProps<{
  artifact: Artifact;
  group: ArtifactGroupKey;
  groupLabel: string;
  busy: boolean;
  now: Date;
  reducedMotion: boolean;
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
const modified = computed(() => new Date(props.artifact.modified));
const exactTime = computed(() => modified.value.toLocaleString(numberLocale.value));
const size = computed(() => formatBytes(props.artifact.size, numberLocale.value));
const modifiedTime = computed(() => relativeTime(modified.value, props.now, locale.value));

const icon = computed(() => {
  if (props.group === 'checkpoints') return Package;

  if (png.value) return Image;

  const path = props.artifact.path.toLowerCase();

  if (path.endsWith('.json')) return FileJson;

  if (path.endsWith('.csv')) return FileSpreadsheet;

  if (/\.(log|txt)$/.test(path)) return ScrollText;

  return File;
});
</script>

<template>
  <motion.tr
    :class="styles.row"
    :data-artifact-path="artifact.path"
    :data-artifact-size="artifact.size"
    :initial="reducedMotion ? false : { opacity: 0 }"
    :animate="{ opacity: 1 }"
    :transition="reducedMotion ? { duration: 0 } : { duration: 0.18, ease: [0.22, 1, 0.36, 1] }"
  >
    <td class="p-0">
      <div :class="cn(styles.cell, 'flex items-center justify-center px-0')">
        <component :is="icon" class="size-4 text-muted-foreground" aria-hidden="true" />
      </div>
    </td>
    <td class="p-0">
      <div
        :class="cn(styles.cell, 'flex min-w-0 items-center justify-start gap-2')"
        :title="artifact.path"
      >
        <span class="min-w-0 shrink-0 truncate font-semibold tracking-[-0.01em] max-w-full">{{
          name
        }}</span>
        <span v-if="folder" class="min-w-0 truncate text-xs text-muted-foreground">{{
          folder
        }}</span>
      </div>
    </td>
    <td class="hidden p-0 @min-[40rem]:table-cell">
      <div :class="cn(styles.cell, 'flex items-center text-muted-foreground')">
        <span class="truncate">{{ groupLabel }}</span>
      </div>
    </td>
    <td class="p-0">
      <div :class="cn(styles.cell, 'flex items-center text-muted-foreground tabular-nums')">
        <span class="truncate" :aria-label="t('results.fileSize', { size })">{{ size }}</span>
      </div>
    </td>
    <td class="hidden p-0 @min-[30rem]:table-cell">
      <div :class="cn(styles.cell, 'flex items-center text-muted-foreground')">
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
    </td>
    <td class="p-0">
      <div
        :class="cn(styles.cell, 'flex items-center justify-end gap-1 px-1')"
        role="group"
        :aria-label="t('results.actions')"
      >
        <DropdownMenu v-if="checkpoint">
          <DropdownMenuTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
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
        <template v-else>
          <Tooltip v-if="png">
            <TooltipTrigger as-child>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                :disabled="busy"
                :aria-label="t('results.previewFile', { path: artifact.path })"
                @click="emit('preview', artifact)"
                ><Eye aria-hidden="true"
              /></Button>
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
                ><Download aria-hidden="true"
              /></Button>
            </TooltipTrigger>
            <TooltipContent>{{ t('results.download') }}</TooltipContent>
          </Tooltip>
        </template>
      </div>
    </td>
  </motion.tr>
</template>
