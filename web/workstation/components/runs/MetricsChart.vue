<script setup lang="ts">
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { runMessages } from '../../i18n/runs';
import { computed, onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { MetricRecord } from '../../lib/metric-history';
import {
  buildPlotSeries,
  PLOT_LABELS,
  type PlotChannel,
  type PlotSeries,
} from '../../lib/plot-series';

const { t, translateKnownMessage, locale } = useWorkstationI18n(runMessages);
const props = defineProps<{ records: readonly MetricRecord[]; unavailable?: boolean }>();
const channel = shallowRef<PlotChannel>('loss');
const host = useTemplateRef<HTMLDivElement>('host');
const plot = shallowRef<uPlot | null>(null);
const mounted = shallowRef(false);
const renderError = shallowRef('');
let observer: ResizeObserver | null = null;
let frame: number | null = null;
const projection = computed<{ series: PlotSeries | null; error: string }>(() => {
  try {
    return {
      series: buildPlotSeries(props.unavailable ? [] : props.records, channel.value),
      error: '',
    };
  } catch (error) {
    return {
      series: null,
      error: error instanceof Error ? error.message : runMessages.en.chartDataError,
    };
  }
});
const message = computed(() => {
  const raw = projection.value.error || renderError.value;
  const capacity = /^Chart capacity exceeded \((\d+) metric records\)\.$/.exec(raw);
  return capacity ? t('chartCapacity', { count: capacity[1]! }) : translateKnownMessage(raw);
});
function selectChannel(value: string | number) {
  if (value === 'loss' || value === 'r2' || value === 'lr') channel.value = value;
}
function destroyPlot() {
  plot.value?.destroy();
  plot.value = null;
}
function renderPlot() {
  frame = null;
  if (!mounted.value || !host.value) return;
  const series = projection.value.series;
  if (!series || series.pointCount === 0 || props.unavailable) {
    destroyPlot();
    return;
  }
  const width = Math.floor(host.value.getBoundingClientRect().width);
  if (width <= 0) return;
  try {
    renderError.value = '';
    if (plot.value) {
      plot.value.setSize({ width, height: 300 });
      plot.value.setData(series.data);
      return;
    }
    const colors = getComputedStyle(host.value);
    const primary = colors.getPropertyValue('--primary').trim() || '#007aff';
    const secondary = colors.getPropertyValue('--chart-2').trim() || '#7b6dba';
    const muted = colors.getPropertyValue('--muted-foreground').trim() || '#737373';
    const border = colors.getPropertyValue('--border').trim() || '#e5e5e5';
    plot.value = new uPlot(
      {
        width,
        height: 300,
        scales: { x: { time: false } },
        axes: [
          { label: t('step'), stroke: muted, grid: { stroke: border } },
          { stroke: muted, grid: { stroke: border } },
        ],
        series: [
          { label: t('step') },
          ...series.fields.map((field, index) => ({
            label: translateKnownMessage(PLOT_LABELS[field] ?? field),
            stroke: index === 0 ? primary : secondary,
            width: 2,
            spanGaps: false,
            points: { show: (chart: uPlot) => chart.data[0].length === 1, size: 5 },
          })),
        ],
        cursor: { drag: { x: true, y: false } },
      },
      series.data,
      host.value,
    );
  } catch {
    destroyPlot();
    renderError.value = runMessages.en.chartRenderError;
  }
}
function scheduleRender() {
  if (!mounted.value || frame !== null) return;
  frame = requestAnimationFrame(renderPlot);
}
function resetZoom() {
  const data = projection.value.series?.data;
  if (data) plot.value?.setData(data);
}
watch(
  channel,
  () => {
    destroyPlot();
    scheduleRender();
  },
  { flush: 'post' },
);
watch(projection, scheduleRender, { flush: 'post' });
// Rebuild library-owned text without re-projecting records or losing a user's zoom.
watch(
  locale,
  () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    const viewport = plot.value?.scales?.x;
    const range =
      viewport?.min != null && viewport.max != null
        ? { min: viewport.min, max: viewport.max }
        : null;
    destroyPlot();
    renderPlot();
    if (range) plot.value?.setScale('x', range);
  },
  { flush: 'post' },
);
onMounted(() => {
  mounted.value = true;
  observer = new ResizeObserver(scheduleRender);
  if (host.value) observer.observe(host.value);
  scheduleRender();
});
onBeforeUnmount(() => {
  mounted.value = false;
  observer?.disconnect();
  observer = null;
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  destroyPlot();
});
</script>

<template>
  <section class="metrics-chart" :aria-label="t('runtimeHistory')">
    <div class="chart-heading">
      <div>
        <h3>{{ t('history') }}</h3>
        <p>{{ t('lineage', { count: projection.series?.pointCount ?? 0 }) }}</p>
      </div>
      <Button variant="ghost" size="sm" :disabled="!plot" @click="resetZoom">{{
        t('resetZoom')
      }}</Button>
    </div>
    <Tabs :model-value="channel" @update:model-value="selectChannel">
      <TabsList :aria-label="t('channel')">
        <TabsTrigger value="loss">{{ t('loss') }}</TabsTrigger>
        <TabsTrigger value="r2">{{ t('r2') }}</TabsTrigger>
        <TabsTrigger value="lr">{{ t('lr') }}</TabsTrigger>
      </TabsList>
      <TabsContent :value="channel" force-mount>
        <p v-if="message" role="status">{{ message }}</p>
        <p v-else-if="unavailable" role="status">
          {{ t('notLive') }}
        </p>
        <p v-else-if="!projection.series?.pointCount" role="status">
          {{
            t('waitingChannel', {
              channel:
                channel === 'lr'
                  ? t('learningRateLower')
                  : channel === 'loss'
                    ? t('lossLower')
                    : t('r2Lower'),
            })
          }}
        </p>
        <div
          ref="host"
          class="chart-host"
          :hidden="unavailable || !!message || !projection.series?.pointCount"
        />
      </TabsContent>
    </Tabs>
    <p class="chart-note">
      {{ t('chartNote') }}
    </p>
  </section>
</template>

<style scoped>
.metrics-chart {
  min-width: 0;
  margin-block: 1.5rem;
}
.chart-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}
.chart-heading h3 {
  margin: 0;
}
.chart-heading p,
.chart-note {
  color: var(--muted-foreground);
  font-size: 0.8rem;
}
.chart-heading p {
  margin: 0.25rem 0 0;
}
.chart-host {
  width: 100%;
  min-width: 0;
  min-height: 340px;
}
.chart-host :deep(.uplot) {
  font-family: inherit;
}
.chart-host :deep(.u-legend) {
  font-size: 0.8rem;
}
</style>
