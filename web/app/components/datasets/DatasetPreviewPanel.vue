<script setup lang="ts">
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { useClientMessages } from '../../composables/useClientMessages';
import { datasetMessages } from '../../i18n/datasets';
import { computed, onBeforeUnmount, shallowRef, toRaw, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { DataSelection } from '../../lib/catalog-api';
import type { ConnectionSession } from '../../lib/connection-session';
import { DatasetPreviewApi, sampleMatrix, type DatasetPreview } from '../../lib/dataset-preview';
import PreviewPlot from './PreviewPlot.vue';
import PreviewHeatmap from './PreviewHeatmap.vue';
import PreviewStatistics from './PreviewStatistics.vue';

const { t, translateKnownMessage } = useWorkstationI18n(datasetMessages);
const { clientMessage } = useClientMessages();

const props = defineProps<{ session: ConnectionSession; selection: DataSelection | null }>();
const tabs = [
  ['input', 'inputDistribution'],
  ['output', 'outputDistribution'],
  ['sample', 'samples'],
  ['correlation', 'correlation'],
  ['statistics', 'statistics'],
  ['scatter', 'scatter'],
] as const;
type Tab = (typeof tabs)[number][0];
const activeTab = shallowRef<Tab>('input');
const data = shallowRef<DatasetPreview | null>(null);
const loading = shallowRef(false);
const available = shallowRef(false);
const message = shallowRef('');
let request: AbortController | null = null;
let sequence = 0;
let unsubscribe: (() => void) | null = null;
function revoke() {
  sequence++;
  request?.abort();
  request = null;
  data.value = null;
  loading.value = false;
}
function stop() {
  if (!loading.value) return;
  revoke();
  message.value = 'Preview loading stopped. Refresh preview to retry.';
}
async function load() {
  revoke();
  message.value = '';
  const selection = props.selection ? toRaw(props.selection) : null;
  if (!selection) return;
  if (!available.value) {
    message.value = 'Reconnect and select this dataset again to preview.';
    return;
  }
  const controller = new AbortController();
  request = controller;
  const current = sequence;
  loading.value = true;
  try {
    const result = await new DatasetPreviewApi(toRaw(props.session)).preview(
      selection,
      'all',
      controller.signal,
    );
    if (current === sequence && !controller.signal.aborted) data.value = result;
  } catch (error) {
    if (current === sequence && !controller.signal.aborted)
      message.value = error instanceof Error ? error.message : 'Dataset preview unavailable.';
  } finally {
    if (current === sequence) {
      loading.value = false;
      request = null;
    }
  }
}
watch(
  () => props.session,
  (session) => {
    unsubscribe?.();
    revoke();
    const connection = toRaw(session);
    let revision = connection.snapshot().revision;
    unsubscribe = connection.subscribe((state) => {
      available.value = state.status === 'connected';
      if (state.revision !== revision || state.status !== 'connected') {
        revision = state.revision;
        revoke();
        message.value = 'Reconnect and select this dataset again to preview.';
      }
    });
  },
  { immediate: true },
);
watch(() => [props.selection, props.session], load, { immediate: true });
onBeforeUnmount(() => {
  unsubscribe?.();
  revoke();
});
function selectTab(value: string | number) {
  const tab = tabs.find(([key]) => key === value);
  if (tab) activeTab.value = tab[0];
}
const histograms = computed(() =>
  activeTab.value === 'input'
    ? (data.value?.input_histograms ?? [])
    : (data.value?.output_histograms ?? []),
);
const plots = computed(() =>
  histograms.value.map((histogram) => ({
    id: histogram.feature_index,
    feature: histogram.feature_index,
    x: histogram.counts.map(
      (_, index) => (histogram.edges[index] ?? 0) / 2 + (histogram.edges[index + 1] ?? 0) / 2,
    ),
    y: histogram.counts,
  })),
);
const scatterPlots = computed(() => {
  const scatter = data.value?.scatter;
  if (!scatter) return [];
  return scatter.feature_indices.map((feature, column) => {
    const points = scatter.x
      .flatMap((row, index) => {
        const x = row[column];
        const y = scatter.y[index];
        return x == null || y == null ? [] : [{ x, y }];
      })
      .sort((a, b) => a.x - b.x);
    return {
      id: feature,
      feature,
      x: points.map((item) => item.x),
      y: points.map((item) => item.y),
    };
  });
});
const matrices = computed(
  () =>
    data.value?.samples.map((sample) => {
      const matrix = sampleMatrix(sample);
      return { sample, matrix, x: matrix[0]?.map((_, index) => index) ?? [], y: matrix[0] ?? [] };
    }) ?? [],
);
</script>

<template>
  <section class="dataset-preview" :aria-label="t('previewTitle')">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3>{{ t('previewTitle') }}</h3>
      <Button
        variant="outline"
        size="sm"
        :disabled="loading || !selection || !available"
        @click="load"
        >{{ t('refreshPreview') }}</Button
      >
      <Button v-if="loading" variant="ghost" size="sm" @click="stop">{{ t('stopPreview') }}</Button>
    </div>
    <p v-if="loading" role="status">{{ t('previewLoading') }}</p>
    <p v-else-if="message" role="status">{{ clientMessage(translateKnownMessage(message)) }}</p>
    <p v-else-if="!selection" role="status">{{ t('selectDataset') }}</p>
    <template v-if="data">
      <p class="text-muted-foreground text-sm">
        {{ data.format.toUpperCase() }} · {{ data.input_key }} {{ data.input_shape.join(' × ') }} →
        {{ data.output_key }} {{ data.output_shape.join(' × ') }}
      </p>
      <p class="text-muted-foreground text-sm">
        {{
          t('previewBounds', { count: data.sample_indices.length, total: data.input_shape[0] ?? 0 })
        }}
      </p>
      <Tabs :model-value="activeTab" @update:model-value="selectTab">
        <TabsList class="flex h-auto flex-wrap" :aria-label="t('previewView')">
          <TabsTrigger v-for="[key, label] in tabs" :key="key" :value="key">{{
            t(label)
          }}</TabsTrigger>
        </TabsList>
        <TabsContent :key="activeTab" :value="activeTab">
          <div v-if="activeTab === 'input' || activeTab === 'output'" class="preview-grid">
            <PreviewPlot
              v-for="plot in plots"
              :key="plot.id"
              :title="t('featureTitle', { feature: plot.feature })"
              :x="plot.x"
              :y="plot.y"
              histogram
            />
          </div>
          <div v-else-if="activeTab === 'sample'" class="flex flex-col gap-5">
            <div v-for="{ sample, matrix, x, y } in matrices" :key="sample.sample_index">
              <p class="text-muted-foreground text-xs">
                {{
                  t('sampleHelp', {
                    sample: sample.sample_index,
                    original: sample.feature_shape.join(' × ') || t('scalar'),
                    preview: sample.shape.join(' × '),
                  })
                }}
              </p>
              <PreviewPlot
                v-if="sample.shape.length === 1"
                :x="x"
                :y="y"
                :title="t('sampleTitle', { sample: sample.sample_index })"
              />
              <PreviewHeatmap
                v-else
                :matrix="matrix"
                :title="t('sampleTitle', { sample: sample.sample_index })"
              />
            </div>
          </div>
          <template v-else-if="activeTab === 'correlation'">
            <PreviewHeatmap
              v-if="data.correlation.matrix"
              :matrix="data.correlation.matrix"
              :title="t('correlationTitle')"
              correlation
            />
            <p v-else role="status">
              {{
                t(
                  data.sample_indices.length < 2
                    ? 'correlationInsufficientRows'
                    : 'correlationMissing',
                )
              }}
            </p>
            <p class="text-muted-foreground text-xs">
              {{ t('featureOrder', { features: data.correlation.feature_indices.join(', ') }) }}
            </p>
          </template>
          <PreviewStatistics
            v-else-if="activeTab === 'statistics'"
            :statistics="data.input_statistics"
          />
          <div v-else class="preview-grid">
            <PreviewPlot
              v-for="plot in scatterPlots"
              :key="plot.id"
              :title="t('scatterTitle', { feature: plot.feature })"
              :x="plot.x"
              :y="plot.y"
              scatter
            />
          </div>
        </TabsContent>
      </Tabs>
    </template>
  </section>
</template>

<style scoped>
.dataset-preview {
  min-width: 0;
  margin-block: 1.5rem;
}
.preview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: 1.5rem;
}
</style>
