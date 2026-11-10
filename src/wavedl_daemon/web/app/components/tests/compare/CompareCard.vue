<script setup lang="ts">
import { CircleCheck, File, Image, MoreHorizontal } from '@lucide/vue';
import { motion } from 'motion-v';
import type { ComparedTest } from '../../../composables/useTestComparison';
import { finiteMetric } from '../../../lib/evaluation-scorecard';
import { artifactPlotLabel } from '../../../lib/artifact-plots';
import { checkpointLabel, parentTitle, testLocation } from '../../../lib/test-runs';
import { pathName } from '../../../lib/run-overview';
import { compareNumber, headlineMetrics } from '../../../lib/test-compare';
import { cn } from '../../../lib/utils';

const props = defineProps<{
  entry: ComparedTest;
  reference: ComparedTest | null;
  color: string;
  highlighted: boolean;
  parameters: { name: string; value: number | null }[];
}>();
const emit = defineEmits<{ hover: [id: string | null]; reference: [id: string]; remove: [id: string] }>();
const { t } = useI18n({ useScope: 'global' });
const images = useArtifactImages(() => props.entry.id);
const isReference = computed(() => props.entry.id === props.reference?.id);
const r2 = computed(() => finiteMetric(props.entry.metrics?.r2_score));
const dataset = computed(() => pathName(props.entry.run?.summary?.data_path) || t('results.unknownDataset'));
const checkpoint = computed(() => checkpointLabel(pathName(props.entry.run?.summary?.checkpoint)));
const plots = computed(() => {
  const featured = props.entry.plots.find((plot) => pathName(plot.path) === 'scatter_all.png');
  const histogram = props.entry.plots.find((plot) => artifactPlotLabel(plot.path)?.key === 'results.plots.errorHistogram');
  const selected = [featured, histogram].filter((plot) => plot !== undefined);
  return (selected.length ? selected : props.entry.plots.slice(0, 2)).map((artifact) => {
    const label = artifactPlotLabel(artifact.path);
    return { artifact, title: label ? t(label.key, label.params ?? {}) : pathName(artifact.path) };
  });
});
const stats = computed(() => headlineMetrics.slice(1).map(({ metric, label }) => ({ metric, label, value: finiteMetric(props.entry.metrics?.[metric]), reference: finiteMetric(props.reference?.metrics?.[metric]) })));
const styles = {
  card: cn('compare-card relative min-w-0 snap-start self-stretch overflow-hidden rounded-2xl border bg-background'),
  eyebrow: cn('text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground'),
  meta: cn('flex min-w-0 items-center justify-end gap-1 text-xs font-medium'),
  badge: cn('inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-primary/10 px-2.5 py-1 text-xs leading-4 font-semibold text-primary ring-1 ring-inset ring-primary/20'),
};
function fraction(value: number | null) { return `${Math.max(0, Math.min(1, value ?? 0)) * 100}%`; }
</script>

<template>
  <article :id="`compare-${entry.id}`" :class="[styles.card, { 'is-reference ring-1 ring-primary/30': isReference }]" :aria-label="entry.run ? parentTitle(entry.run) ?? entry.id : entry.id" @mouseenter="emit('hover', entry.id)" @mouseleave="emit('hover', null)" @focusin="emit('hover', entry.id)" @focusout="emit('hover', null)">
    <motion.div class="pointer-events-none absolute inset-0 z-0 rounded-2xl" :initial="false" :animate="{ backgroundColor: highlighted ? 'color-mix(in oklab, var(--primary) 7%, transparent)' : 'color-mix(in oklab, var(--primary) 0%, transparent)' }" :transition="{ duration: 0.18 }" />
    <div class="compare-card-summary relative p-4">
      <header class="flex min-w-0 items-center justify-between gap-2">
        <h2 class="flex min-w-0 items-center gap-2 text-sm font-semibold"><span class="size-2.5 shrink-0 rounded-full" :style="{ background: color }" aria-hidden="true" /><span class="truncate" :title="entry.run ? parentTitle(entry.run) ?? entry.id : entry.id">{{ entry.run ? parentTitle(entry.run) ?? entry.id : entry.id }}</span></h2>
        <DropdownMenu>
          <DropdownMenuTrigger as-child><Button variant="ghost" size="icon" class="size-7 shrink-0" :aria-label="t('results.compare.actions')"><MoreHorizontal class="size-4" aria-hidden="true" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem :disabled="isReference" @select="emit('reference', entry.id)">{{ t('results.compare.setReference') }}</DropdownMenuItem>
            <DropdownMenuItem v-if="entry.run" as-child><NuxtLink :to="testLocation(entry.run)">{{ t('results.compare.openTest') }}</NuxtLink></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem @select="emit('remove', entry.id)">{{ t('results.compare.remove') }}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <div class="mt-4 grid grid-cols-[auto_minmax(0,1fr)] items-end gap-4">
        <div><div :class="styles.eyebrow">{{ t('results.compare.r2Score') }}</div><div class="compare-hero mt-1 text-[44px] leading-none font-semibold tracking-tight tabular-nums">{{ compareNumber(r2) }}</div>
          <div class="compare-badge-slot mt-2 flex h-6 items-center">
            <span v-if="isReference" :class="styles.badge">★ {{ t('results.compare.reference') }}</span>
            <CompareChange v-else metric="r2_score" :value="r2" :reference="finiteMetric(reference?.metrics?.r2_score)" hero />
          </div>
        </div>
        <dl class="grid min-w-0 gap-2 pb-1 text-right">
          <div class="min-w-0"><dt :class="styles.eyebrow">{{ t('results.compare.testData') }}</dt><dd :class="styles.meta"><File class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" /><span class="truncate" :title="dataset">{{ dataset }}</span></dd></div>
          <div class="min-w-0"><dt :class="styles.eyebrow">{{ t('results.compare.checkpoint') }}</dt><dd :class="styles.meta"><CircleCheck class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" /><span class="truncate">{{ checkpoint ? t(checkpoint.key, checkpoint.params ?? {}) : '—' }}</span></dd></div>
        </dl>
      </div>
      <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div class="h-full rounded-full" :style="{ width: fraction(r2), background: color }" /></div>
    </div>
    <dl class="compare-card-stats relative grid grid-cols-3 divide-x border-y">
      <div v-for="stat in stats" :key="stat.metric" class="compare-stat min-w-0 px-2 py-3"><dt :class="styles.eyebrow">{{ stat.label }}</dt><dd class="compare-stat-value mt-1 flex min-h-7 flex-nowrap items-center gap-1.5 whitespace-nowrap text-lg font-semibold tracking-tight tabular-nums"><span class="min-w-0 truncate" :title="compareNumber(stat.value)">{{ compareNumber(stat.value) }}</span><CompareChange v-if="!isReference" :metric="stat.metric" :value="stat.value" :reference="stat.reference" /></dd></div>
    </dl>
    <section v-if="parameters.length" class="compare-card-parameters relative px-4 pt-4" :aria-label="t('results.compare.r2ByParameter')">
      <h3 :class="styles.eyebrow">{{ t('results.compare.r2ByParameter') }}</h3>
      <div class="mt-2 grid grid-cols-[minmax(0,auto)_minmax(32px,1fr)_auto] items-center gap-x-2 gap-y-2 text-xs">
        <template v-for="parameter in parameters" :key="parameter.name"><span class="max-w-28 truncate" :title="parameter.name">{{ parameter.name }}</span><div class="h-1.5 overflow-hidden rounded-full bg-muted" :title="`${parameter.name}: ${compareNumber(parameter.value)}`"><div class="h-full rounded-full" :style="{ width: fraction(parameter.value), background: color }" /></div><span class="font-semibold tabular-nums">{{ compareNumber(parameter.value) }}</span></template>
      </div>
    </section>
    <div class="compare-card-plots relative space-y-3 p-4">
      <div v-if="plots.length" class="grid grid-cols-2 items-start gap-2">
        <figure v-for="plot in plots" :key="plot.artifact.path" class="min-w-0 overflow-hidden rounded-lg border bg-card p-1"><ArtifactImage :artifact="plot.artifact" :images="images" :alt="plot.title" /><figcaption class="px-1 py-1 text-[11px] text-muted-foreground">{{ plot.title }}</figcaption></figure>
      </div>
      <div v-else class="flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground"><Image class="size-5" aria-hidden="true" />{{ t('results.compare.noPlots') }}</div>
      <p v-if="entry.error" class="text-xs text-muted-foreground" role="status">{{ t(entry.error) }}</p>
    </div>
  </article>
</template>

<style scoped>
.compare-card { display: grid; grid-row: span 4; grid-template-rows: subgrid; }
/* Keep inline-size containment inside the subgrid: it disables inherited tracks on the card itself. */
.compare-card-summary { grid-row: 1; container: compare-card / inline-size; }
.compare-card-stats { grid-row: 2; container: compare-card / inline-size; }
.compare-card-parameters { grid-row: 3; }
.compare-card-plots { grid-row: 4; }
@container compare-card (max-width: 319px) {
  .compare-hero { font-size: 38px; }
  .compare-stat { padding-inline: 4px; }
  .compare-stat-value { font-size: 16px; gap: 2px; }
  .compare-stat-value :deep(.compare-change) { font-size: 9px; padding-inline: 4px; }
}
</style>
