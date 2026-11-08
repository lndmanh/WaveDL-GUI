<script setup lang="ts">
import type { ConnectionSession } from '../../lib/connection-session';
import { sampleMatrix } from '../../lib/dataset-preview';
import { datasetPreviewMessageKeys, datasetPreviewTabMessageKeys } from '../../i18n/dynamic-keys';
import type { DataSelection } from '~~/types/catalog-api';

const { t } = useI18n({ useScope: 'global' });
const { clientMessage } = useClientMessages();

const props = defineProps<{ session: ConnectionSession; selection: DataSelection | null }>();

const tabs = [
  ['input', datasetPreviewTabMessageKeys.input],
  ['output', datasetPreviewTabMessageKeys.output],
  ['sample', datasetPreviewTabMessageKeys.sample],
  ['correlation', datasetPreviewTabMessageKeys.correlation],
  ['statistics', datasetPreviewTabMessageKeys.statistics],
  ['scatter', datasetPreviewTabMessageKeys.scatter],
] as const;

type Tab = (typeof tabs)[number][0];

const activeTab = shallowRef<Tab>('input');

const { data, loading, available, message, load, stop, trust } = useDatasetPreview(
  () => props.session,
  () => props.selection,
);

const sampledRows = computed(() => {
  if (!data.value) return 0;

  return activeTab.value === 'output' || activeTab.value === 'correlation'
    ? data.value.sample_indices.length
    : data.value.input_sample_indices.length;
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
  <section class="min-w-0" :aria-label="t('datasets.previewTitle')">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3>{{ t('datasets.previewTitle') }}</h3>
      <Button
        variant="outline"
        size="sm"
        :disabled="loading || !selection || !available"
        @click="load"
        >{{ t('datasets.refreshPreview') }}</Button
      >
      <Button v-if="loading" variant="ghost" size="sm" @click="stop">{{
        t('datasets.stopPreview')
      }}</Button>
    </div>
    <Empty v-if="loading" role="status" class="py-8">
      <EmptyHeader>
        <EmptyMedia><LoadingSpinner compact /></EmptyMedia>
        <EmptyDescription>{{ t('datasets.previewLoading') }}</EmptyDescription>
      </EmptyHeader>
    </Empty>
    <Alert v-else-if="message?.kind === 'pickle'" variant="warning" role="status" class="mt-4">
      <AlertTitle>{{ t('datasets.pickleTitle') }}</AlertTitle>
      <AlertDescription class="gap-3">
        <p>{{ t('datasets.pickleWarning') }}</p>
        <p>{{ t('datasets.pickleResources') }}</p>
        <Button
          type="button"
          class="h-auto max-w-full whitespace-normal text-left"
          :disabled="!available"
          @click="trust"
          >{{ t('datasets.trustPickle') }}</Button
        >
      </AlertDescription>
    </Alert>
    <p v-else-if="message" role="status">
      {{ message.kind === 'key' ? t(message.key) : clientMessage(message.value) }}
    </p>
    <p v-else-if="!selection" role="status">{{ t('datasets.selectDataset') }}</p>
    <template v-if="data">
      <p class="text-muted-foreground text-sm">
        {{ data.format.toUpperCase() }} · {{ data.input_key }} {{ data.input_shape.join(' × ') }} →
        {{ data.output_key }} {{ data.output_shape.join(' × ') }}
      </p>
      <div class="flex flex-wrap gap-2 mb-3" :aria-label="t('datasets.previewScope')">
        <Badge variant="outline" data-testid="preview-bounds">
          {{
            t('datasets.previewBounds', {
              count: sampledRows,
              total: data.input_shape[0] ?? 0,
            })
          }}
        </Badge>
        <Badge variant="secondary">{{ t('datasets.previewFeatureCap') }}</Badge>
        <Badge variant="secondary">{{ t('datasets.previewCorrelationCap') }}</Badge>
        <Badge variant="secondary">{{ t('datasets.previewStatisticsCap') }}</Badge>
        <Badge variant="secondary">{{ t('datasets.previewSampleCap') }}</Badge>
        <InfoChip
          :label="t('datasets.previewNotFullChip')"
          :text="t('datasets.previewNotFull')"
          uncertain
        />
      </div>
      <Tabs :model-value="activeTab" @update:model-value="selectTab">
        <TabsList class="flex h-auto flex-wrap" :aria-label="t('datasets.previewView')">
          <TabsTrigger v-for="[key, label] in tabs" :key="key" :value="key">{{
            t(label)
          }}</TabsTrigger>
        </TabsList>
        <TabsContent :key="activeTab" :value="activeTab">
          <div
            v-if="activeTab === 'input' || activeTab === 'output'"
            class="grid grid-cols-[repeat(auto-fit,_minmax(min(100%,_320px),_1fr))] gap-6"
          >
            <PreviewPlot
              v-for="plot in plots"
              :key="plot.id"
              :title="t('datasets.featureTitle', { feature: plot.feature })"
              :x="plot.x"
              :y="plot.y"
              histogram
            />
          </div>
          <div v-else-if="activeTab === 'sample'" class="flex flex-col gap-5">
            <div v-for="{ sample, matrix, x, y } in matrices" :key="sample.sample_index">
              <Badge variant="outline" class="self-start">
                {{
                  t('datasets.sampleHelp', {
                    sample: sample.sample_index,
                    original: sample.feature_shape.join(' × ') || t('datasets.scalar'),
                    preview: sample.shape.join(' × '),
                  })
                }}
              </Badge>
              <PreviewPlot
                v-if="sample.shape.length === 1"
                :x="x"
                :y="y"
                :title="t('datasets.sampleTitle', { sample: sample.sample_index })"
              />
              <PreviewHeatmap
                v-else
                :matrix="matrix"
                :title="t('datasets.sampleTitle', { sample: sample.sample_index })"
              />
            </div>
          </div>
          <template v-else-if="activeTab === 'correlation'">
            <PreviewHeatmap
              v-if="data.correlation.matrix"
              :matrix="data.correlation.matrix"
              :title="t('datasets.correlationTitle')"
              correlation
            />
            <p v-else role="status">
              {{
                t(
                  data.sample_indices.length < 2
                    ? datasetPreviewMessageKeys.correlationInsufficientRows
                    : datasetPreviewMessageKeys.correlationMissing,
                )
              }}
            </p>
            <p class="text-muted-foreground text-xs">
              {{
                t('datasets.featureOrder', {
                  features: data.correlation.feature_indices.join(', '),
                })
              }}
            </p>
          </template>
          <PreviewStatistics
            v-else-if="activeTab === 'statistics'"
            :statistics="data.input_statistics"
          />
          <div
            v-else
            class="grid grid-cols-[repeat(auto-fit,_minmax(min(100%,_320px),_1fr))] gap-6"
          >
            <PreviewPlot
              v-for="plot in scatterPlots"
              :key="plot.id"
              :title="t('datasets.scatterTitle', { feature: plot.feature })"
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
