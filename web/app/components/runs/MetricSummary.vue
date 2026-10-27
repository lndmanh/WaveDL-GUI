<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed } from 'vue';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import type { MetricSummary } from '../../lib/metric-history';
import MetricHealthPanel from './MetricHealthPanel.vue';
import PerParameterMetrics from './PerParameterMetrics.vue';

const { t } = useI18n({ useScope: 'global' });
const props = defineProps<{ summary: MetricSummary; unconfirmed?: boolean }>();
function display(value: number | null | undefined, suffix = ''): string {
  return value == null ? t('runs.unavailable') : `${value}${suffix}`;
}
const metrics = computed(() => {
  const current = props.summary.current;
  if (!current) return [];
  return [
    { label: t('runs.trainLoss'), value: display(current.trainLoss) },
    { label: t('runs.valLoss'), value: display(current.validationLoss) },
    { label: t('runs.r2'), value: display(current.r2) },
    { label: t('runs.lr'), value: display(current.learningRate) },
    { label: t('runs.pearson'), value: display(current.pearson) },
    { label: t('runs.gradNorm'), value: display(current.gradientNorm) },
    { label: t('runs.mae'), value: display(current.mae) },
    { label: t('runs.epochDuration'), value: display(current.epochSeconds, ' s') },
    { label: t('runs.bestR2'), value: display(current.bestR2) },
    { label: t('runs.elapsed'), value: display(current.elapsedSeconds, ' s') },
    {
      label: t('runs.patience'),
      value: current.patience
        ? `${current.patience.used} / ${current.patience.maximum}`
        : t('runs.unavailable'),
    },
  ];
});
</script>
<template>
  <section :aria-label="t('runs.currentMetrics')">
    <Card>
      <CardHeader>
        <CardTitle>{{
          unconfirmed ? t('runs.lastKnownRuntime') : t('runs.currentRuntime')
        }}</CardTitle>
        <CardDescription>{{
          unconfirmed ? t('runs.lastKnownNote') : t('runs.latestNote')
        }}</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-4">
        <p v-if="summary.progress">
          {{
            t('runs.epoch', { epoch: summary.progress.epoch, total: summary.progress.totalEpochs })
          }}
          <progress
            :value="summary.progress.fraction"
            max="1"
            :aria-label="t('runs.epochProgress')"
          />
        </p>
        <p v-if="summary.best !== null">{{ t('runs.bestVal', { value: summary.best }) }}</p>
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
          <EmptyDescription>{{ t('runs.waitingRuntime') }}</EmptyDescription>
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
