<script setup lang="ts">
import type { ComparedTest } from '../../../composables/useTestComparison';
import { finiteMetric } from '../../../lib/evaluation-scorecard';
import { axisDomain, bestValue, compareNumber, headlineMetrics, lowerIsBetter, rankByMetric } from '../../../lib/test-compare';
const props = defineProps<{ entries: ComparedTest[]; reference: ComparedTest | null; colors: ReadonlyMap<string, string>; hoveredId: string | null }>();
const emit = defineEmits<{ hover: [id: string | null]; jump: [id: string] }>();
const { t } = useI18n({ useScope: 'global' });
const mobileMetric = ref('r2_score');
const axes = computed(() => headlineMetrics.slice(0, 3).map(({ metric, label }) => {
  const values = props.entries.map((entry) => finiteMetric(entry.metrics?.[metric]));
  const domain = axisDomain(values);
  return { metric, label, domain, reference: finiteMetric(props.reference?.metrics?.[metric]), best: bestValue(values, metric), left: lowerIsBetter(metric) ? domain[1] : domain[0], right: lowerIsBetter(metric) ? domain[0] : domain[1] };
}));
function selectMetric(value: unknown) {
  if (typeof value === 'string' && axes.value.some((axis) => axis.metric === value)) mobileMetric.value = value;
}
const ranked = computed(() => rankByMetric(props.entries.map((entry) => ({ id: entry.id, value: finiteMetric(entry.metrics?.r2_score) })), 'r2_score').flatMap((id) => {
  const entry = props.entries.find((item) => item.id === id);
  return entry ? [entry] : [];
}));
</script>

<template>
  <section class="overflow-hidden rounded-2xl border bg-background" :aria-label="t('results.compare.ranking')">
    <div class="lb-mobile-switch px-4 pt-3">
      <ToggleGroup type="single" :model-value="mobileMetric" class="rounded-lg bg-muted p-[3px]" :aria-label="t('results.compare.metric')" @update:model-value="selectMetric"><ToggleGroupItem v-for="axis in axes" :key="axis.metric" :value="axis.metric" class="h-7 px-2 text-sm data-[state=on]:bg-background data-[state=on]:shadow-sm">{{ axis.label }}</ToggleGroupItem></ToggleGroup>
    </div>
    <div class="lb-grid gap-3 border-b px-4 py-3">
      <span /><span class="text-[10.5px] font-semibold text-muted-foreground">{{ t('results.compare.ranking') }}</span>
      <div v-for="axis in axes" :key="axis.metric" class="lb-metric pr-[57px]" :class="{ 'mobile-selected': axis.metric === mobileMetric }"><div class="flex items-center justify-between gap-1 tabular-nums"><span class="text-[10.5px] text-muted-foreground">{{ compareNumber(axis.left) }}</span><span class="text-sm font-bold tracking-wide text-primary">{{ axis.label }}</span><span class="text-[10.5px] text-muted-foreground">{{ compareNumber(axis.right) }}</span></div></div>
    </div>
    <div class="max-h-[288px] overflow-y-auto overscroll-contain px-1 py-1 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]" tabindex="0" :aria-label="t('results.compare.ranking')">
      <CompareLeaderboardRow v-for="(entry, index) in ranked" :key="entry.id" :entry="entry" :rank="index + 1" :color="colors.get(entry.id) ?? 'transparent'" :reference-id="reference?.id ?? null" :highlighted="hoveredId === entry.id" :mobile-metric="mobileMetric" :axes="axes" @hover="emit('hover', $event)" @jump="emit('jump', $event)" />
    </div>
    <footer class="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t px-4 py-3 text-[11px] text-muted-foreground"><span class="inline-flex items-center gap-1.5"><span class="h-3 border-l border-dashed border-primary/60" aria-hidden="true" />{{ t('results.compare.reference') }}</span><span>{{ t('results.compare.betterRight') }}</span><span>{{ t('results.compare.gapLegend') }}</span><span>{{ t('results.compare.jumpLegend') }}</span></footer>
  </section>
</template>

<style>
.lb-grid { display: grid; grid-template-columns: 24px minmax(140px, 1.1fr) repeat(3, minmax(0, 1fr)); align-items: center; }
.lb-mobile-switch { display: none; }
@container comparison (max-width: 639px) {
  .lb-grid { grid-template-columns: 20px minmax(0, 1fr) minmax(0, 1.25fr); }
  .lb-metric:not(.mobile-selected) { display: none; }
  .lb-mobile-switch { display: block; }
}
</style>
