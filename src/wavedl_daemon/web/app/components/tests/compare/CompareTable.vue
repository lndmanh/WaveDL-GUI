<script setup lang="ts">
import type { ComparedTest } from '../../../composables/useTestComparison';
import { finiteMetric } from '../../../lib/evaluation-scorecard';
import { bestValue, compareNumber, headlineMetrics, parameterRows } from '../../../lib/test-compare';
import { checkpointLabel, parentTitle } from '../../../lib/test-runs';
import { pathName } from '../../../lib/run-overview';
import { cn } from '../../../lib/utils';

const props = defineProps<{ entries: ComparedTest[]; colors: ReadonlyMap<string, string>; referenceId: string | null }>();
const { t } = useI18n({ useScope: 'global' });
function detailLabel(entry: ComparedTest): string {
  const checkpoint = checkpointLabel(entry.run?.summary?.checkpoint);

  return [
    pathName(entry.run?.summary?.data_path) || t('results.unknownDataset'),
    checkpoint ? t(checkpoint.key, checkpoint.params ?? {}) : null,
  ].filter(Boolean).join(' · ');
}
const rows = computed(() => [
  ...headlineMetrics.map(({ metric, label }) => {
    const values = props.entries.map((entry) => finiteMetric(entry.metrics?.[metric]));
    return { name: label, values, best: bestValue(values, metric) };
  }),
  ...parameterRows(props.entries.map((entry) => entry.parameters)).map((row) => ({
    ...row,
    name: `${row.name} · R²`,
    best: bestValue(row.values, 'r2_score'),
  })),
]);
const styles = {
  header: cn('min-w-48 px-4 py-3 text-left text-xs font-medium text-muted-foreground'),
  cell: cn('px-4 py-3 text-sm tabular-nums'),
};
</script>

<template>
  <div class="overflow-x-auto rounded-2xl border" tabindex="0" :aria-label="t('results.compare.table')">
    <table class="w-full border-collapse text-left">
      <caption class="sr-only">{{ t('results.compare.table') }}</caption>
      <thead class="border-b bg-muted/30">
        <tr>
          <th scope="col" :class="styles.header">{{ t('results.compare.metric') }}</th>
          <th v-for="entry in entries" :key="entry.id" scope="col" :class="styles.header">
            <span class="flex items-center gap-2">
              <span class="size-2.5 shrink-0 rounded-full" :style="{ background: colors.get(entry.id) ?? 'transparent' }" aria-hidden="true" />
              <span class="text-foreground">{{ entry.run ? parentTitle(entry.run) ?? entry.id : entry.id }}</span>
            </span>
            <span class="mt-1 block max-w-64 truncate text-xs font-normal" :title="detailLabel(entry)">{{ detailLabel(entry) }}</span>
            <span v-if="entry.id === referenceId" class="mt-1 block text-primary">★ {{ t('results.compare.reference') }}</span>
          </th>
        </tr>
      </thead>
      <tbody class="divide-y">
        <tr v-for="row in rows" :key="row.name">
          <th scope="row" :class="[styles.cell, 'font-medium']">{{ row.name }}</th>
          <td v-for="(value, index) in row.values" :key="index" :class="[styles.cell, { 'font-bold': value !== null && value === row.best }]">
            {{ compareNumber(value) }}
            <span v-if="value !== null && value === row.best" class="sr-only"> {{ t('results.compare.best') }}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
