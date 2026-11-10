<script setup lang="ts">
import { metricChange } from '../../../lib/test-compare';
import type { HeadlineMetric } from '../../../lib/test-compare';
import { cn } from '../../../lib/utils';
const props = defineProps<{ metric: HeadlineMetric; value: number | null; reference: number | null; hero?: boolean }>();
const { t } = useI18n({ useScope: 'global' });
const change = computed(() => metricChange(props.metric, props.value, props.reference));
const label = computed(() => change.value ? t('results.compare.changeLabel', { value: change.value.text, direction: t(`results.compare.${change.value.better ? 'better' : 'worse'}`) }) : '');
const styles = { chip: cn('compare-change inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold leading-tight tabular-nums') };
</script>

<template>
  <span v-if="change" :class="[styles.chip, change.better ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive', hero ? 'mt-2 px-2.5 py-1 text-xs' : '']" :aria-label="label" :title="label">
    <template v-if="hero">{{ change.better ? '▲' : '▼' }} {{ change.text.replace(/^[+−]/, '') }} · {{ t(`results.compare.${change.better ? 'better' : 'worse'}`) }}</template>
    <template v-else>{{ change.text }}</template>
  </span>
</template>
