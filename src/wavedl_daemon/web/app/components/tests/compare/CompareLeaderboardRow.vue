<script setup lang="ts">
import { motion } from 'motion-v';
import type { ComparedTest } from '../../../composables/useTestComparison';
import { finiteMetric } from '../../../lib/evaluation-scorecard';
import { axisPosition, compareNumber } from '../../../lib/test-compare';
import type { HeadlineMetric } from '../../../lib/test-compare';
import { pathName } from '../../../lib/run-overview';
import { checkpointLabel, parentTitle } from '../../../lib/test-runs';
import { cn } from '../../../lib/utils';
const props = defineProps<{
  entry: ComparedTest;
  rank: number;
  color: string;
  referenceId: string | null;
  highlighted: boolean;
  mobileMetric: string;
  axes: { metric: HeadlineMetric; label: string; domain: [number, number]; reference: number | null; best: number | null }[];
}>();
const emit = defineEmits<{ hover: [id: string | null]; jump: [id: string] }>();
const { t } = useI18n({ useScope: 'global' });
const detailLabel = computed(() => {
  const checkpoint = checkpointLabel(props.entry.run?.summary?.checkpoint);

  return [
    pathName(props.entry.run?.summary?.data_path) || t('results.unknownDataset'),
    checkpoint ? t(checkpoint.key, checkpoint.params ?? {}) : null,
  ].filter(Boolean).join(' · ');
});
const cells = computed(() => props.axes.map((axis) => {
  const value = finiteMetric(props.entry.metrics?.[axis.metric]);
  const point = value === null ? null : axisPosition(value, axis.domain, axis.metric);
  const reference = axis.reference === null ? null : axisPosition(axis.reference, axis.domain, axis.metric);
  return { ...axis, value, point, reference, stem: point !== null && reference !== null ? { left: `${Math.min(point, reference)}%`, width: `${Math.abs(point - reference)}%`, background: props.color } : null };
}));
const styles = { row: cn('lb-grid relative w-full cursor-pointer gap-3 rounded-lg px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]'), cell: cn('lb-metric grid min-w-0 grid-cols-[minmax(0,1fr)_48px] items-center gap-2 pr-1') };
</script>

<template>
  <button type="button" :class="styles.row" @click="emit('jump', entry.id)" @mouseenter="emit('hover', entry.id)" @mouseleave="emit('hover', null)" @focus="emit('hover', entry.id)" @blur="emit('hover', null)">
    <motion.span class="pointer-events-none absolute inset-0 rounded-lg" :initial="false" :animate="{ backgroundColor: highlighted ? 'color-mix(in oklab, var(--primary) 9%, transparent)' : 'color-mix(in oklab, var(--primary) 0%, transparent)' }" :transition="{ duration: 0.18 }" />
    <span class="relative text-xs font-semibold text-muted-foreground tabular-nums">{{ rank }}</span>
    <span class="relative flex min-w-0 items-center gap-2"><span class="size-2.5 shrink-0 rounded-full" :style="{ background: color }" aria-hidden="true" /><span class="min-w-0"><span class="block truncate text-[13px] font-semibold">{{ entry.run ? parentTitle(entry.run) ?? entry.id : entry.id }}</span><span class="block truncate text-[11px] text-muted-foreground" :title="detailLabel">{{ detailLabel }}<span v-if="entry.id === referenceId" :aria-label="t('results.compare.reference')"> · ★</span></span></span></span>
    <span v-for="cell in cells" :key="cell.metric" :class="[styles.cell, { 'mobile-selected': cell.metric === mobileMetric }]">
      <span class="relative h-5" :title="`${cell.label}: ${compareNumber(cell.value)}`" aria-hidden="true">
        <span class="absolute inset-x-0 top-1/2 h-px bg-border" />
        <span v-if="cell.reference !== null" class="absolute inset-y-0 border-l border-dashed border-primary/60" :style="{ left: `${cell.reference}%` }" />
        <span v-if="cell.stem" class="absolute top-1/2 h-0.5 opacity-35" :style="cell.stem" />
        <span v-if="cell.point !== null" class="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background" :style="{ left: `${cell.point}%`, background: color }" />
      </span>
      <span class="relative text-right text-xs tabular-nums" :class="{ 'font-bold': cell.value !== null && cell.value === cell.best }"><span class="sr-only">{{ cell.label }} </span><span v-if="cell.value !== null && cell.value === cell.best" class="block text-[9px] leading-tight font-bold text-success">{{ t('results.compare.best') }}</span>{{ compareNumber(cell.value) }}</span>
    </span>
  </button>
</template>
