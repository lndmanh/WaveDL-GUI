<script setup lang="ts">
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { datasetMessages } from '../../i18n/datasets';
import type { DatasetPreview } from '../../lib/dataset-preview';
import PreviewPlot from './PreviewPlot.vue';
const { t } = useWorkstationI18n(datasetMessages);

defineProps<{ statistics: DatasetPreview['input_statistics'] }>();
</script>

<template>
  <div class="statistics-plots">
    <PreviewPlot :title="t('meanTitle')" :x="statistics.feature_indices" :y="statistics.means" />
    <PreviewPlot :title="t('stdTitle')" :x="statistics.feature_indices" :y="statistics.stds" />
  </div>
  <div class="overflow-auto">
    <table class="statistics">
      <caption>
        {{
          t('statsCaption')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('feature') }}</th>
          <th scope="col">{{ t('mean') }}</th>
          <th scope="col">{{ t('std') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(feature, index) in statistics.feature_indices" :key="feature">
          <th scope="row">{{ feature }}</th>
          <td>{{ statistics.means[index] ?? t('missing') }}</td>
          <td>{{ statistics.stds[index] ?? t('missing') }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.statistics-plots {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: 1rem;
}
.statistics {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}
.statistics th,
.statistics td {
  padding: 0.5rem;
  text-align: left;
  border-bottom: 1px solid var(--border);
}
</style>
