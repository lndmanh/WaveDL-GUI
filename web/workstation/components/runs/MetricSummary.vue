<script setup lang="ts">
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { runMessages } from '../../i18n/runs';
import { computed } from 'vue';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import type { MetricSummary } from '../../lib/metric-history';
import MetricHealthPanel from './MetricHealthPanel.vue';
import PerParameterMetrics from './PerParameterMetrics.vue';

const { t } = useWorkstationI18n(runMessages);
const props = defineProps<{ summary: MetricSummary; unconfirmed?: boolean }>();
function display(value: number | null | undefined, suffix = ''): string {
  return value == null ? t('unavailable') : `${value}${suffix}`;
}
const metrics = computed(() => {
  const current = props.summary.current;
  if (!current) return [];
  return [
    { label: t('trainLoss'), value: display(current.trainLoss) },
    { label: t('valLoss'), value: display(current.validationLoss) },
    { label: t('r2'), value: display(current.r2) },
    { label: t('lr'), value: display(current.learningRate) },
    { label: t('pearson'), value: display(current.pearson) },
    { label: t('gradNorm'), value: display(current.gradientNorm) },
    { label: t('mae'), value: display(current.mae) },
    { label: t('epochDuration'), value: display(current.epochSeconds, ' s') },
    { label: t('bestR2'), value: display(current.bestR2) },
    { label: t('elapsed'), value: display(current.elapsedSeconds, ' s') },
    {
      label: t('patience'),
      value: current.patience
        ? `${current.patience.used} / ${current.patience.maximum}`
        : t('unavailable'),
    },
  ];
});
</script>
<template>
  <section :aria-label="t('currentMetrics')">
    <Card>
      <CardHeader>
        <CardTitle>{{ unconfirmed ? t('lastKnownRuntime') : t('currentRuntime') }}</CardTitle>
        <CardDescription>{{ unconfirmed ? t('lastKnownNote') : t('latestNote') }}</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-4">
        <p v-if="summary.progress">
          {{ t('epoch', { epoch: summary.progress.epoch, total: summary.progress.totalEpochs }) }}
          <progress :value="summary.progress.fraction" max="1" :aria-label="t('epochProgress')" />
        </p>
        <p v-if="summary.best !== null">{{ t('bestVal', { value: summary.best }) }}</p>
        <dl v-if="metrics.length" class="metric-grid">
          <div v-for="metric in metrics" :key="metric.label">
            <dt>{{ metric.label }}</dt>
            <dd>{{ metric.value }}</dd>
          </div>
        </dl>
        <p v-if="summary.latest && !summary.current">
          {{ summary.latest.name }}: {{ display(summary.latest.value) }} {{ summary.latest.unit }}
        </p>
        <template v-if="summary.current">
          <PerParameterMetrics :parameters="summary.current.parameters" />
          <MetricHealthPanel :health="summary.current.health" />
        </template>
        <Empty v-if="!summary.latest && !summary.progress">
          <EmptyDescription>{{ t('waitingRuntime') }}</EmptyDescription>
        </Empty>
      </CardContent>
    </Card>
  </section>
</template>
<style scoped>
.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 1.25rem;
}
.metric-grid dt {
  font-size: 0.8rem;
  color: var(--muted-foreground);
}
.metric-grid dd {
  margin: 0.25rem 0 0;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
</style>
