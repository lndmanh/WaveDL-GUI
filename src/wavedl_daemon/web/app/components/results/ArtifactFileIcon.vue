<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { File, FileJson, FileSpreadsheet, Image, Package, ScrollText } from '@lucide/vue';
import { cn } from '@/lib/utils';
import type { ArtifactGroupKey } from '~~/types/artifact-list';

const props = defineProps<{
  path: string;
  group: ArtifactGroupKey;
  class?: HTMLAttributes['class'];
}>();

const icon = computed(() => {
  if (props.group === 'checkpoints') return Package;

  const path = props.path.toLowerCase();

  if (path.endsWith('.png')) return Image;

  if (path.endsWith('.json')) return FileJson;

  if (path.endsWith('.csv')) return FileSpreadsheet;

  if (/\.(log|txt)$/.test(path)) return ScrollText;

  return File;
});
</script>

<template>
  <component
    :is="icon"
    :class="cn('size-4 text-muted-foreground', props.class)"
    aria-hidden="true"
  />
</template>
