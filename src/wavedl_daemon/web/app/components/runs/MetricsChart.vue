<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { ChartLine, Maximize2 } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { MetricRecord } from '../../lib/metric-history';
import { buildPlotSeries, type PlotChannel, type PlotSeries } from '../../lib/plot-series';
import { plotMetricMessageKeys } from '../../i18n/dynamic-keys';
import InfoChip from '../common/InfoChip.vue';

const { t, locale } = useI18n({ useScope: 'global' });
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
      error: error instanceof Error ? error.message : t('runs.chartDataError'),
    };
  }
});
const message = computed(() => {
  const raw = projection.value.error || renderError.value;
  const capacity = /^Chart capacity exceeded \((\d+) metric records\)\.$/.exec(raw);
  return capacity ? t('runs.chartCapacity', { count: capacity[1]! }) : raw;
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
          { label: t('runs.step'), stroke: muted, grid: { stroke: border } },
          { stroke: muted, grid: { stroke: border } },
        ],
        series: [
          { label: t('runs.step') },
          ...series.fields.map((field, index) => ({
            label:
              plotMetricMessageKeys[field as keyof typeof plotMetricMessageKeys] === undefined
                ? field
                : t(plotMetricMessageKeys[field as keyof typeof plotMetricMessageKeys]),
            stroke: index === 0 ? primary : secondary,
            fill: index === 0 ? (chart: uPlot) => areaFill(chart, primary) : undefined,
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
    renderError.value = t('runs.chartRenderError');
  }
}
/** A soft wash under the primary series; non-hex theme colours simply skip it. */
function areaFill(chart: uPlot, color: string): CanvasGradient | string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return 'transparent';
  // The legend asks for its swatch before layout, while the plot box is still empty.
  const { top, height } = chart.bbox;
  if (!Number.isFinite(top) || !Number.isFinite(height) || height <= 0) return `${color}2e`;
  const gradient = chart.ctx.createLinearGradient(0, top, 0, top + height);
  gradient.addColorStop(0, `${color}2e`);
  gradient.addColorStop(1, `${color}00`);
  return gradient;
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
  <section class="metrics-chart" :aria-label="t('runs.runtimeHistory')">
    <Tabs :model-value="channel" @update:model-value="selectChannel">
      <div class="chart-heading">
        <div class="min-w-0">
          <h3>{{ t('runs.history') }}</h3>
          <p>{{ t('runs.lineage', { count: projection.series?.pointCount ?? 0 }) }}</p>
        </div>
        <div class="chart-controls">
          <TabsList class="chart-channels" :aria-label="t('runs.channel')">
            <TabsTrigger value="loss">{{ t('runs.loss') }}</TabsTrigger>
            <TabsTrigger value="r2">{{ t('runs.r2') }}</TabsTrigger>
            <TabsTrigger value="lr">{{ t('runs.lr') }}</TabsTrigger>
          </TabsList>
          <Button
            variant="ghost"
            size="icon"
            class="chart-reset"
            :disabled="!plot"
            :aria-label="t('runs.resetZoom')"
            :title="t('runs.resetZoom')"
            @click="resetZoom"
            ><Maximize2 aria-hidden="true"
          /></Button>
        </div>
      </div>
      <TabsContent :value="channel" force-mount class="chart-body">
        <p v-if="message" role="status" class="chart-state">{{ message }}</p>
        <p v-else-if="unavailable" role="status" class="chart-state">
          <InfoChip :label="t('runs.lastKnownRuntime')" :text="t('runs.notLive')" uncertain />
        </p>
        <p v-else-if="!projection.series?.pointCount" role="status" class="chart-state">
          <ChartLine aria-hidden="true" />
          {{
            t('runs.waitingChannel', {
              channel:
                channel === 'lr'
                  ? t('runs.learningRateLower')
                  : channel === 'loss'
                    ? t('runs.lossLower')
                    : t('runs.r2Lower'),
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
    <InfoChip :label="t('runs.chartDetails')" :text="t('runs.chartNote')" />
  </section>
</template>

<style scoped>
.metrics-chart {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
  padding: 1.25rem 1.4rem;
  border-radius: 1.25rem;
  background: var(--surface);
  box-shadow:
    0 0 0 0.5px color-mix(in srgb, var(--foreground) 10%, transparent),
    0 1px 2px rgb(0 0 0 / 0.04);
}
.chart-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1rem;
  margin-bottom: 0.75rem;
}
.chart-heading h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 650;
  letter-spacing: -0.015em;
}
.chart-heading p {
  margin: 0.2rem 0 0;
  color: var(--muted-foreground);
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}
.chart-controls {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.chart-channels {
  border-radius: 0.65rem;
}
.chart-reset {
  border-radius: 999px;
  color: var(--muted-foreground);
}
.chart-body {
  min-width: 0;
}
.chart-state {
  display: flex;
  min-height: 12rem;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border-radius: 1rem;
  color: var(--muted-foreground);
  font-size: 0.85rem;
  text-align: center;
  background: color-mix(in srgb, var(--foreground) 3%, transparent);
}
.chart-state svg {
  width: 1.4rem;
  height: 1.4rem;
  opacity: 0.6;
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
  font-size: 0.78rem;
  color: var(--muted-foreground);
}
.chart-host :deep(.u-select) {
  background: color-mix(in srgb, var(--primary) 12%, transparent);
}
</style>
