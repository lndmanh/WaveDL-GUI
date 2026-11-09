<script setup lang="ts">
import { Maximize2 } from '@lucide/vue';
import { motion, useReducedMotion } from 'motion-v';
import { metricsChartEmptyState, type MetricsWaitingStage } from '@/lib/metrics-chart-waiting';
import type { RunView } from '~~/types/daemon-api';
import type { RunEvent } from '~~/types/event-stream';
import { CurveType, type FreeBrushConfigInterface } from '@unovis/ts';
import { VisXYContainer, VisLine, VisAxis, VisFreeBrush, VisPlotline } from '@unovis/vue';
import { ChartTooltipContent, componentToString, type ChartConfig } from '@/components/ui/chart';
import { cn } from '@/lib/utils';
import type { RuntimeMetricField } from '../../../shared/schemas/metric-history';
import { buildPlotSeries } from '../../lib/plot-series';
import { plotMetricMessageKeys } from '../../i18n/dynamic-keys';
import type { MetricRecord } from '~~/types/metric-history';
import type { PlotChannel, PlotPoint, PlotSeries } from '~~/types/plot-series';

const styles = {
  header: cn('flex shrink-0 flex-wrap items-center gap-2'),
  state: cn(
    'flex min-h-40 flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground',
    '[&_svg]:size-6',
  ),
  plot: cn(
    'absolute inset-0 aspect-auto',
    '[--vis-axis-grid-color:var(--border)] [--vis-axis-tick-label-color:var(--muted-foreground)]',
    '[--vis-axis-label-color:var(--muted-foreground)] [--vis-axis-tick-color:var(--border)]',
    '[--vis-crosshair-line-stroke-color:var(--muted-foreground)]',
    '[--vis-free-brush-selection-fill-color:var(--primary)]',
    '[--vis-free-brush-selection-stroke-color:var(--border)]',
    '[--vis-free-brush-handle-fill-color:var(--primary)]',
  ),
};

const { t } = useI18n({ useScope: 'global' });

const props = defineProps<{
  records: readonly MetricRecord[];
  run: RunView | null;
  events: readonly RunEvent[];
  unavailable?: boolean;
  lossSeries: PlotSeries | null;
  lossError: string;
  bestLoss: { step: number; value: number } | null;
}>();

const channel = shallowRef<PlotChannel>('loss');
const hiddenFields = shallowRef<readonly RuntimeMetricField[]>([]);
const zoom = shallowRef<[number, number] | null>(null);
const { isActive } = usePageActive();

function metricLabel(field: string): string {
  const key = Object.entries(plotMetricMessageKeys).find(([name]) => name === field)?.[1];

  return key === undefined ? field : t(key);
}

const projection = computed<{ series: PlotSeries | null; error: string }>(() => {
  if (channel.value === 'loss') return { series: props.lossSeries, error: props.lossError };

  try {
    return {
      series: buildPlotSeries(props.unavailable ? [] : props.records, channel.value),
      error: '',
    };
  } catch (error) {
    return {
      series: null,
      error: error instanceof Error ? error.message : t('runs.chartDataError'),
    };
  }
});

const message = computed(() => {
  const raw = projection.value.error;
  const count = /^Chart capacity exceeded \((\d+) metric records\)\.$/.exec(raw)?.[1];

  return count === undefined ? raw : t('runs.chartCapacity', { count });
});

const fields = computed(() => projection.value.series?.fields ?? []);
const reducedMotion = useReducedMotion();
const hasData = computed(() => fields.value.length > 0);

const channelLabel = computed(() =>
  channel.value === 'lr'
    ? t('runs.learningRateLower')
    : channel.value === 'loss'
      ? t('runs.lossLower')
      : t('runs.r2Lower'),
);

const hasOtherMetrics = computed(() => {
  if (hasData.value || message.value || props.unavailable) return false;

  if (props.lossSeries?.fields.length) return true;

  return buildPlotSeries(props.records, 'r2').fields.length > 0 ||
    buildPlotSeries(props.records, 'lr').fields.length > 0;
});

const emptyState = computed(() => metricsChartEmptyState(props.run, props.events, hasOtherMetrics.value));

const emptyMessage = computed(() => t(
  emptyState.value.kind === 'terminal'
    ? 'runs.metricsNoneRecorded'
    : emptyState.value.kind === 'missing'
      ? 'runs.metricsChannelNotReported'
      : 'runs.waitingChannel',
  { channel: channelLabel.value },
));

const waitingStage = computed(() => {
  if (message.value || props.unavailable || hasData.value || emptyState.value.kind !== 'waiting') return null;

  return emptyState.value.stage;
});

const leavingStage = shallowRef<MetricsWaitingStage | null>(null);
const mounted = shallowRef(false);

onMounted(() => {
  mounted.value = true;
});

const displayedStage = computed(() => waitingStage.value ?? leavingStage.value);

const handoffSource = computed(() => ({
  runId: props.run?.run_id,
  attempt: props.run?.attempt,
  channel: channel.value,
  active: isActive.value,
  stage: waitingStage.value,
  data: !message.value && !props.unavailable && hasData.value,
}));

// Retain the mounted waiting layer only for a live, same-channel arrival of data.
// Tab changes and KeepAlive activation must never replay a chart entry animation.
watch(handoffSource, (current, previous) => {
  const sameChannel = current.runId === previous.runId &&
    current.attempt === previous.attempt && current.channel === previous.channel;

  if (!sameChannel || !current.active || !current.data) leavingStage.value = null;
  else if (mounted.value && previous.active && previous.stage !== null && !reducedMotion.value)
    leavingStage.value = previous.stage;
}, { flush: 'sync' });

function finishHandoff() {
  if (waitingStage.value === null) leavingStage.value = null;
}

const visibleFields = computed(() => {
  const visible = fields.value.filter((field) => !hiddenFields.value.includes(field));

  return visible.length ? visible : fields.value.slice(0, 1);
});

const chartData = computed(() => [...(projection.value.series?.points ?? [])]);

const chartConfig = computed<ChartConfig>(() =>
  Object.fromEntries(
    fields.value.map((field, index) => [
      field,
      {
        label: metricLabel(field),
        color: index === 0 ? 'var(--primary)' : 'var(--chart-2)',
      },
    ]),
  ),
);

const visibleConfig = computed<ChartConfig>(() =>
  Object.fromEntries(
    Object.entries(chartConfig.value).filter(([field]) =>
      visibleFields.value.some((visible) => visible === field),
    ),
  ),
);

const colors = computed(() =>
  visibleFields.value.map((field) => chartConfig.value[field]?.color ?? 'var(--primary)'),
);

const y = computed(() =>
  visibleFields.value.map((field) => (point: PlotPoint) => point.values[field] ?? undefined),
);

const best = computed(() => (channel.value === 'loss' ? props.bestLoss : null));

function selectChannel(value: string | number) {
  if (value === 'loss' || value === 'r2' || value === 'lr') {
    channel.value = value;
    hiddenFields.value = [];
    zoom.value = null;
  }
}

function toggleField(field: RuntimeMetricField) {
  if (!visibleFields.value.includes(field)) {
    hiddenFields.value = hiddenFields.value.filter((hidden) => hidden !== field);
  } else if (visibleFields.value.length > 1) {
    hiddenFields.value = [...hiddenFields.value, field];
  }
}

const zoomTo: NonNullable<FreeBrushConfigInterface<PlotPoint>['onBrushEnd']> = (
  selection,
  _event,
  userDriven,
) => {
  if (!userDriven || !selection) return;
  const [start, end] = selection;

  if (!Array.isArray(start) && !Array.isArray(end) && end > start) zoom.value = [start, end];
};

const tooltip = computed(() => {
  const template = componentToString(visibleConfig.value, ChartTooltipContent, {
    labelFormatter: (step: number) => `${t('runs.step')} ${step}`,
  });

  return (point: PlotPoint) =>
    template?.(
      Object.fromEntries(
        visibleFields.value.map((field) => [field, point.values[field] ?? t('runs.unavailable')]),
      ),
      point.step,
    ) ?? '';
});
</script>

<template>
  <section
    class="flex min-h-0 min-w-0 flex-1 flex-col gap-3"
    :aria-label="t('runs.runtimeHistory')"
  >
    <Tabs class="min-h-0 flex-1 gap-3" :model-value="channel" @update:model-value="selectChannel">
      <div :class="styles.header">
        <TabsList :aria-label="t('runs.channel')">
          <TabsTrigger value="loss">{{ t('runs.loss') }}</TabsTrigger>
          <TabsTrigger value="r2">{{ t('runs.r2') }}</TabsTrigger>
          <TabsTrigger value="lr">{{ t('runs.lr') }}</TabsTrigger>
        </TabsList>
        <div class="flex flex-wrap items-center gap-1">
          <Button
            v-for="field in fields"
            :key="field"
            variant="ghost"
            size="sm"
            :aria-pressed="visibleFields.includes(field)"
            :disabled="visibleFields.includes(field) && visibleFields.length === 1"
            :class="cn(!visibleFields.includes(field) && 'opacity-50')"
            @click="toggleField(field)"
          >
            <span
              class="h-0.5 w-3"
              :style="{ backgroundColor: chartConfig[field]?.color }"
              aria-hidden="true"
            />
            {{ metricLabel(field) }}
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon"
          class="ml-auto"
          :disabled="zoom === null"
          :aria-label="t('runs.resetZoom')"
          :title="t('runs.resetZoom')"
          @click="zoom = null"
          ><Maximize2 aria-hidden="true"
        /></Button>
      </div>
      <TabsContent :value="channel" force-mount class="m-0 flex min-h-40 min-w-0 flex-1 flex-col">
        <p v-if="message" role="status" :class="styles.state">{{ message }}</p>
        <div v-else-if="unavailable" role="status" :class="styles.state">
          <InfoChip :label="t('runs.lastKnownRuntime')" :text="t('runs.notLive')" uncertain />
        </div>
        <p v-else-if="!hasData && !waitingStage" role="status" :class="styles.state">{{ emptyMessage }}</p>
        <div v-else class="relative flex min-h-40 min-w-0 flex-1 flex-col">
          <motion.div
            v-if="hasData && isActive"
            class="absolute inset-0"
            :initial="leavingStage ? { opacity: 0 } : false"
            :animate="{ opacity: 1 }"
            :transition="{ duration: reducedMotion || !leavingStage ? 0 : 0.4 }"
          >
          <ChartContainer
            :key="channel"
            :config="chartConfig"
            :class="styles.plot"
            cursor
            @dblclick="zoom = null"
          >
            <VisXYContainer
              :data="chartData"
              :x-domain="zoom ?? undefined"
              :prevent-empty-domain="true"
              :duration="0"
            >
              <VisLine
                :x="(point: PlotPoint) => point.step"
                :y="y"
                :color="colors"
                :curve-type="CurveType.Linear"
                :interpolate-missing-data="false"
              />
              <VisAxis
                type="x"
                :label="t('runs.step')"
                :grid-line="false"
                :tick-format="(value: number) => (Number.isInteger(value) ? String(value) : '')"
              />
              <VisAxis type="y" />
              <VisPlotline
                v-if="best"
                axis="x"
                :value="best.step"
                color="var(--success)"
                :line-style="[4, 4]"
                :label-text="t('runs.bestEpoch')"
                label-color="var(--muted-foreground)"
              />
              <VisFreeBrush :on-brush-end="zoomTo" />
              <ChartTooltip />
              <ChartCrosshair
                :x="(point: PlotPoint) => point.step"
                :y="y"
                :color="colors"
                :template="tooltip"
                :hide-when-far-from-pointer="false"
              />
            </VisXYContainer>
          </ChartContainer>
          </motion.div>
          <motion.div
            v-if="displayedStage"
            class="relative flex min-h-40 flex-1"
            :initial="false"
            :animate="{ opacity: waitingStage ? 1 : 0 }"
            :transition="{ duration: reducedMotion || !leavingStage ? 0 : 0.4 }"
            :aria-hidden="!waitingStage || undefined"
            @animation-complete="finishHandoff"
          >
            <MetricsChartWaiting
              :stage="displayedStage"
              :channel-label="channelLabel"
              :visible="waitingStage !== null"
            />
          </motion.div>
        </div>
      </TabsContent>
    </Tabs>
    <p class="m-0 shrink-0 text-xs text-muted-foreground">{{ t('runs.chartNote') }}</p>
  </section>
</template>
