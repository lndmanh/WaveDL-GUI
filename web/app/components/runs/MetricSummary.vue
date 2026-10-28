<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed } from 'vue';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import InfoChip from '../common/InfoChip.vue';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import { Progress } from '@/components/ui/progress';
import type { MetricRecord, MetricSummary } from '../../lib/metric-history';
import MetricHealthPanel from './MetricHealthPanel.vue';
import PerParameterMetrics from './PerParameterMetrics.vue';

const { t } = useI18n({ useScope: 'global' });
const props = defineProps<{
  summary: MetricSummary;
  unconfirmed?: boolean;
  records?: readonly MetricRecord[];
}>();
const channels = ['train_loss', 'val_loss', 'r2', 'lr'];
function sparkline(index: number): string {
  const channel = channels[index];
  if (!channel) return '';
  const values = (props.records ?? [])
    .slice(-60)
    .map((record) => record.metrics[channel] ?? (record.name === channel ? record.value : null));
  const numeric = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  if (numeric.length < 2) return '';
  const min = Math.min(...numeric);
  const span = Math.max(...numeric) - min || 1;
  return values
    .map((value, index) =>
      typeof value === 'number' && Number.isFinite(value)
        ? `${index === 0 || typeof values[index - 1] !== 'number' ? 'M' : 'L'}${(index / Math.max(values.length - 1, 1)) * 120},${28 - ((value - min) / span) * 24}`
        : '',
    )
    .join(' ');
}
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
        <InfoChip
          v-if="unconfirmed"
          :label="t('runs.lastKnownRuntime')"
          :text="t('runs.lastKnownNote')"
          uncertain
        />
        <InfoChip v-else :label="t('runs.currentRuntime')" :text="t('runs.latestNote')" uncertain />
      </CardHeader>
      <CardContent class="flex flex-col gap-4">
        <div v-if="summary.progress" class="flex flex-col gap-2">
          {{
            t('runs.epoch', { epoch: summary.progress.epoch, total: summary.progress.totalEpochs })
          }}
          <Progress
            :model-value="summary.progress.fraction * 100"
            :aria-label="t('runs.epochProgress')"
          />
        </div>
        <p v-if="summary.best !== null">{{ t('runs.bestVal', { value: summary.best }) }}</p>
        <dl v-if="metrics.length" class="metric-grid">
          <div v-for="(metric, index) in metrics.slice(0, 4)" :key="metric.label" class="kpi-tile">
            <dt>{{ metric.label }}</dt>
            <dd>{{ metric.value }}</dd>
            <svg v-if="sparkline(index)" class="sparkline" viewBox="0 0 120 32" aria-hidden="true">
              <path :d="sparkline(index)" fill="none" stroke="currentColor" stroke-width="2" />
            </svg>
          </div>
        </dl>
        <dl v-if="metrics.length > 4" class="metric-grid metric-grid-secondary">
          <div v-for="metric in metrics.slice(4)" :key="metric.label">
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
.kpi-tile {
  position: relative;
  min-height: 5.5rem;
}
.sparkline {
  display: block;
  width: 7.5rem;
  height: 2rem;
  margin-top: 0.5rem;
  color: var(--primary);
}
.metric-grid-secondary {
  opacity: 0.85;
}
</style>
