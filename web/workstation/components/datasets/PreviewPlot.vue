<script setup lang="ts">
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { datasetMessages } from '../../i18n/datasets';
import { usePreviewExport } from '../../composables/usePreviewExport';
import { onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { Button } from '@/components/ui/button';

const { t, translateKnownMessage, locale } = useWorkstationI18n(datasetMessages);

const props = defineProps<{
  title: string;
  x: readonly number[];
  y: readonly (number | null)[];
  scatter?: boolean;
  histogram?: boolean;
}>();
const host = useTemplateRef<HTMLDivElement>('host');
const plot = shallowRef<uPlot | null>(null);
const message = shallowRef('');
const {
  exportMessage,
  exporting,
  exportPng: requestPng,
  resetExport,
} = usePreviewExport('dataset-preview.png');
let observer: ResizeObserver | null = null;
let mounted = false;
let pan: { clientX: number; min: number; max: number } | null = null;
function dispose() {
  plot.value?.destroy();
  plot.value = null;
}
function render(preserveView = false) {
  const savedScales =
    preserveView && plot.value
      ? Object.entries(plot.value.scales).flatMap(([key, scale]) =>
          scale.min !== undefined && scale.max !== undefined
            ? [{ key, min: scale.min, max: scale.max }]
            : [],
        )
      : [];
  if (!mounted || !host.value) return;
  resetExport();
  dispose();
  const width = Math.floor(host.value.getBoundingClientRect().width);
  if (!width) return;
  try {
    plot.value = new uPlot(
      {
        width,
        height: 260,
        scales: { x: { time: false } },
        series: [
          { label: t('value') },
          {
            label: props.title,
            stroke: props.scatter ? undefined : '#007aff',
            width: 2,
            paths: props.scatter
              ? () => null
              : props.histogram
                ? uPlot.paths.bars?.({ size: [0.95, 100] })
                : undefined,
            fill: props.histogram ? '#007aff' : undefined,
            points: { show: props.scatter ?? false, stroke: '#007aff', fill: '#007aff', size: 5 },
          },
        ],
        cursor: { drag: { x: true, y: true } },
      },
      [[...props.x], [...props.y]],
      host.value,
    );
    for (const scale of savedScales)
      plot.value.setScale(scale.key, { min: scale.min, max: scale.max });
    message.value = '';
  } catch {
    message.value = 'Chart unavailable in this browser.';
  }
}
function reset() {
  plot.value?.setData([[...props.x], [...props.y]]);
}
function startPan(event: PointerEvent) {
  const scale = plot.value?.scales.x;
  if (!event.shiftKey || scale?.min === undefined || scale.max === undefined) return;
  event.preventDefault();
  event.stopPropagation();
  pan = { clientX: event.clientX, min: scale.min, max: scale.max };
  host.value?.setPointerCapture(event.pointerId);
}
function movePan(event: PointerEvent) {
  if (!pan || !plot.value) return;
  const width = plot.value.bbox.width / window.devicePixelRatio;
  const offset = ((event.clientX - pan.clientX) / width) * (pan.max - pan.min);
  if (Number.isFinite(offset))
    plot.value.setScale('x', { min: pan.min - offset, max: pan.max - offset });
}
function endPan() {
  pan = null;
}
function exportPng() {
  requestPng(host.value?.querySelector('canvas'));
}
watch(
  () => [props.x, props.y, props.scatter, props.histogram],
  () => {
    render();
  },
  { flush: 'post' },
);
watch(
  () => [locale.value, props.title],
  () => render(true),
  { flush: 'post' },
);
onMounted(() => {
  mounted = true;
  observer = new ResizeObserver(() => render());
  if (host.value) observer.observe(host.value);
  render();
});
onBeforeUnmount(() => {
  mounted = false;
  pan = null;
  observer?.disconnect();
  dispose();
});
</script>

<template>
  <figure class="preview-plot">
    <figcaption>{{ title }}</figcaption>
    <div
      ref="host"
      class="plot-host"
      @pointerdown.capture="startPan"
      @pointermove="movePan"
      @pointerup="endPan"
      @pointercancel="endPan"
      @lostpointercapture="endPan"
    />
    <p v-if="message" role="status">{{ translateKnownMessage(message) }}</p>
    <p v-if="exportMessage" role="status" aria-live="polite">
      {{ translateKnownMessage(exportMessage) }}
    </p>
    <div class="flex flex-wrap gap-2">
      <Button variant="ghost" size="sm" :disabled="!plot" @click="reset">{{
        t('resetZoom')
      }}</Button>
      <Button variant="ghost" size="sm" :disabled="!plot || exporting" @click="exportPng">{{
        t('exportPng')
      }}</Button>
    </div>
    <p class="text-muted-foreground text-xs">
      {{ t('plotHelp') }}
    </p>
  </figure>
</template>

<style scoped>
.preview-plot {
  min-width: 0;
  margin: 0;
}
.plot-host {
  min-width: 0;
  min-height: 290px;
}
</style>
