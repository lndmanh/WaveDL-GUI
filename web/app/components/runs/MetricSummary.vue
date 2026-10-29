<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, useId } from 'vue';
import { TrendingDown, TrendingUp } from '@lucide/vue';
import InfoChip from '../common/InfoChip.vue';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import { Progress } from '@/components/ui/progress';
import type { MetricRecord, MetricSummary } from '../../lib/metric-history';
import { durationText, remainingSeconds } from '../../lib/run-overview';
import MetricHealthPanel from './MetricHealthPanel.vue';
import PerParameterMetrics from './PerParameterMetrics.vue';

const { t, locale } = useI18n({ useScope: 'global' });
const props = defineProps<{
  summary: MetricSummary;
  unconfirmed?: boolean;
  records?: readonly MetricRecord[];
}>();
const gradient = `${useId()}-spark`;
// Whether a rising value is good news; null means direction carries no verdict.
const channels: readonly { name: string; risingIsBetter: boolean | null }[] = [
  { name: 'train_loss', risingIsBetter: false },
  { name: 'val_loss', risingIsBetter: false },
  { name: 'r2', risingIsBetter: true },
  { name: 'lr', risingIsBetter: null },
];
function series(index: number): (number | null)[] {
  const channel = channels[index]?.name;
  if (!channel) return [];
  return (props.records ?? []).slice(-60).map((record) => {
    const value = record.metrics[channel] ?? (record.name === channel ? record.value : null);
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  });
}
function sparkline(index: number): { line: string; area: string } | null {
  const values = series(index);
  const numeric = values.filter((value): value is number => value !== null);
  if (numeric.length < 2) return null;
  const min = Math.min(...numeric);
  const span = Math.max(...numeric) - min || 1;
  const x = (position: number) => (position / Math.max(values.length - 1, 1)) * 120;
  const y = (value: number) => 30 - ((value - min) / span) * 26;
  const line = values
    .map((value, position) =>
      value === null
        ? ''
        : `${position === 0 || values[position - 1] === null ? 'M' : 'L'}${x(position)},${y(value)}`,
    )
    .join(' ');
  // The fill follows the last unbroken stretch so gaps never shade missing data.
  let start = values.length - 1;
  while (start > 0 && values[start - 1] !== null) start--;
  const tail = values.slice(start);
  const area =
    tail.length > 1
      ? `M${x(start)},32 ${tail.map((value, offset) => `L${x(start + offset)},${y(value ?? min)}`).join(' ')} L${x(values.length - 1)},32 Z`
      : '';
  return { line, area };
}
function trend(index: number): { text: string; tone: 'good' | 'bad' | 'neutral'; rising: boolean } | null {
  const numeric = series(index).filter((value): value is number => value !== null);
  const latest = numeric[numeric.length - 1];
  const previous = numeric[numeric.length - 2];
  const channel = channels[index];
  if (latest === undefined || previous === undefined || !channel || latest === previous)
    return null;
  const rising = latest > previous;
  const format = new Intl.NumberFormat(locale.value, {
    maximumSignificantDigits: 2,
    signDisplay: 'always',
    ...(channel.name === 'r2' || previous === 0 ? {} : { style: 'percent' }),
  });
  const change = channel.name === 'r2' || previous === 0 ? latest - previous : (latest - previous) / Math.abs(previous);
  return {
    text: format.format(change),
    rising,
    tone: channel.risingIsBetter === null ? 'neutral' : rising === channel.risingIsBetter ? 'good' : 'bad',
  };
}
function display(value: number | null | undefined, suffix = ''): string {
  return value == null
    ? t('runs.unavailable')
    : `${new Intl.NumberFormat(locale.value, { maximumSignificantDigits: 4 }).format(value)}${suffix}`;
}
const metrics = computed(() => {
  const current = props.summary.current;
  if (!current) return [];
  const exactValues = [
    current.trainLoss,
    current.validationLoss,
    current.r2,
    current.learningRate,
    current.pearson,
    current.gradientNorm,
    current.mae,
    current.epochSeconds,
    current.bestR2,
    current.elapsedSeconds,
    current.patience ? `${current.patience.used} / ${current.patience.maximum}` : null,
  ];
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
  ].map((metric, index) => ({ ...metric, exact: exactValues[index] }));
});
const kpis = computed(() =>
  metrics.value.slice(0, 4).map((metric, index) => {
    const change = trend(index);
    return {
      ...metric,
      spark: sparkline(index),
      trend: change && {
        ...change,
        label: [
          t('runs.changeFromPrevious', { value: change.text }),
          change.tone === 'good' ? t('runs.improving') : change.tone === 'bad' ? t('runs.worsening') : '',
        ]
          .filter(Boolean)
          .join(', '),
      },
    };
  }),
);
const percent = computed(() =>
  props.summary.progress
    ? new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 0 }).format(
        Math.min(1, Math.max(0, props.summary.progress.fraction)),
      )
    : '',
);
const elapsed = computed(() => props.summary.current?.elapsedSeconds ?? null);
// Last-known evidence must not read as a live countdown.
const remaining = computed(() =>
  props.unconfirmed ? null : remainingSeconds(props.summary.progress, elapsed.value),
);
</script>
<template>
  <section class="metric-summary" :aria-label="t('runs.currentMetrics')">
    <header class="metric-summary-head">
      <h3>{{ unconfirmed ? t('runs.lastKnownRuntime') : t('runs.currentRuntime') }}</h3>
      <InfoChip
        v-if="unconfirmed"
        :label="t('runs.lastKnownRuntime')"
        :text="t('runs.lastKnownNote')"
        uncertain
      />
      <InfoChip v-else :label="t('runs.currentRuntime')" :text="t('runs.latestNote')" uncertain />
    </header>
    <div
      v-if="summary.progress || summary.best !== null"
      class="progress-band"
      :data-unconfirmed="unconfirmed ? 'true' : undefined"
    >
      <div v-if="summary.progress" class="progress-main">
        <div class="progress-heading">
          <span class="progress-epoch">{{
            t('runs.epoch', { epoch: summary.progress.epoch, total: summary.progress.totalEpochs })
          }}</span>
          <span class="progress-percent" aria-hidden="true">{{ percent }}</span>
        </div>
        <Progress
          class="progress-bar"
          :model-value="summary.progress.fraction * 100"
          :aria-label="t('runs.epochProgress')"
        />
      </div>
      <dl class="progress-stats">
        <div v-if="elapsed !== null">
          <dt>{{ t('runs.elapsed') }}</dt>
          <dd>{{ durationText(elapsed, locale) }}</dd>
        </div>
        <div v-if="remaining !== null" :title="t('runs.remainingNote')">
          <dt>{{ t('runs.remaining') }}</dt>
          <dd>≈ {{ durationText(remaining, locale) }}</dd>
        </div>
        <div v-if="summary.best !== null">
          <dt>{{ t('runs.bestValShort') }}</dt>
          <dd>
            <p :title="String(summary.best)">
              <span class="sr-only">{{ t('runs.bestVal', { value: display(summary.best) }) }}</span
              ><span aria-hidden="true">{{ display(summary.best) }}</span>
            </p>
          </dd>
        </div>
      </dl>
    </div>
    <dl v-if="kpis.length" class="kpi-grid">
      <div v-for="(metric, index) in kpis" :key="metric.label" class="kpi-tile">
        <dt>{{ metric.label }}</dt>
        <dd :title="metric.exact == null ? undefined : String(metric.exact)">
          {{ metric.value }}
        </dd>
        <span
          v-if="metric.trend"
          class="kpi-trend"
          :data-tone="metric.trend.tone"
          role="img"
          :aria-label="metric.trend.label"
          ><TrendingUp v-if="metric.trend.rising" aria-hidden="true" /><TrendingDown
            v-else
            aria-hidden="true"
          /><span aria-hidden="true">{{ metric.trend.text }}</span></span
        >
        <svg
          v-if="metric.spark"
          class="sparkline"
          viewBox="0 0 120 32"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient :id="`${gradient}-${index}`" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stop-color="currentColor" stop-opacity="0.22" />
              <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
            </linearGradient>
          </defs>
          <path v-if="metric.spark.area" :d="metric.spark.area" :fill="`url(#${gradient}-${index})`" />
          <path
            :d="metric.spark.line"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
          />
        </svg>
      </div>
    </dl>
    <details v-if="metrics.length > 4" class="metric-spec" open>
      <summary>{{ t('runs.allMetrics') }}</summary>
      <dl class="metric-spec-list">
        <div v-for="metric in metrics.slice(4)" :key="metric.label">
          <dt>{{ metric.label }}</dt>
          <dd :title="metric.exact == null ? undefined : String(metric.exact)">
            {{ metric.value }}
          </dd>
        </div>
      </dl>
    </details>
    <p v-if="summary.latest && !summary.current" class="metric-latest" :title="String(summary.latest.value)">
      {{ summary.latest.name }}: {{ display(summary.latest.value) }} {{ summary.latest.unit }}
    </p>
    <div v-if="summary.current" class="metric-insights">
      <PerParameterMetrics :parameters="summary.current.parameters" />
      <MetricHealthPanel :health="summary.current.health" />
    </div>
    <Empty v-if="!summary.latest && !summary.progress" class="metric-waiting">
      <EmptyDescription>{{ t('runs.waitingRuntime') }}</EmptyDescription>
    </Empty>
  </section>
</template>
<style scoped>
.metric-summary {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  min-width: 0;
  padding: 1.25rem 1.4rem 1.4rem;
  border-radius: 1.25rem;
  background: var(--surface);
  box-shadow:
    0 0 0 0.5px color-mix(in srgb, var(--foreground) 10%, transparent),
    0 1px 2px rgb(0 0 0 / 0.04);
}
.metric-summary-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.metric-summary-head h3 {
  font-size: 1rem;
  font-weight: 650;
  letter-spacing: -0.015em;
}
.progress-band {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  align-items: center;
  gap: 1rem 1.5rem;
  padding: 1rem 1.1rem;
  border-radius: 1rem;
  background: color-mix(in srgb, var(--primary) 6%, transparent);
}
.progress-band[data-unconfirmed='true'] {
  background: color-mix(in srgb, var(--foreground) 4%, transparent);
}
.progress-band:not(:has(.progress-main)) {
  grid-template-columns: minmax(0, 1fr);
}
@container (max-width: 34rem) {
  .progress-band {
    grid-template-columns: minmax(0, 1fr);
  }
}
.progress-main {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-width: 0;
}
.progress-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
}
.progress-epoch {
  font-size: 1.2rem;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}
.progress-percent {
  color: var(--muted-foreground);
  font-size: 0.85rem;
  font-weight: 550;
  font-variant-numeric: tabular-nums;
}
.progress-bar {
  height: 0.45rem;
}
.progress-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(6rem, 1fr));
  gap: 0.75rem;
  margin: 0;
}
.progress-stats dt {
  color: var(--muted-foreground);
  font-size: 0.72rem;
}
.progress-stats dd {
  margin: 0.15rem 0 0;
  font-size: 0.95rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 8.5rem), 1fr));
  gap: 0.75rem;
  margin: 0;
}
.kpi-tile {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    'label trend'
    'value value'
    'spark spark';
  align-items: center;
  gap: 0.2rem 0.5rem;
  min-width: 0;
  padding: 0.85rem 0.95rem 0.6rem;
  border-radius: 1rem;
  background: color-mix(in srgb, var(--foreground) 3.5%, transparent);
}
.kpi-tile dt {
  grid-area: label;
  overflow: hidden;
  color: var(--muted-foreground);
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kpi-tile dd {
  grid-area: value;
  margin: 0;
  overflow: hidden;
  font-size: 1.45rem;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kpi-trend {
  grid-area: trend;
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  color: var(--muted-foreground);
  font-size: 0.68rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  background: color-mix(in srgb, var(--foreground) 6%, transparent);
}
.kpi-trend svg {
  width: 0.75rem;
  height: 0.75rem;
}
.kpi-trend[data-tone='good'] {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 13%, transparent);
}
.kpi-trend[data-tone='bad'] {
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 13%, transparent);
}
.sparkline {
  grid-area: spark;
  display: block;
  width: 100%;
  height: 2.25rem;
  margin-top: 0.15rem;
  color: var(--primary);
}
.metric-spec summary {
  width: fit-content;
  color: var(--muted-foreground);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}
.metric-spec summary:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
  border-radius: 0.25rem;
}
.metric-spec-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
  column-gap: 1.75rem;
  margin: 0.5rem 0 0;
}
.metric-spec-list > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.55rem 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
}
.metric-spec-list dt {
  color: var(--muted-foreground);
  font-size: 0.82rem;
}
.metric-spec-list dd {
  margin: 0;
  font-size: 0.88rem;
  font-weight: 550;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.metric-latest {
  font-variant-numeric: tabular-nums;
}
.metric-insights {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
  gap: 0.75rem;
}
.metric-waiting {
  padding-block: 2rem;
}
</style>
