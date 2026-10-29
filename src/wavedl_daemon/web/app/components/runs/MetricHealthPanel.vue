<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { Badge } from '@/components/ui/badge';
import InfoChip from '../common/InfoChip.vue';
import type { MetricHealth } from '../../lib/metric-history';
import {
  metricHealthLabelMessageKeys,
  metricHealthStatusMessageKeys,
} from '../../i18n/dynamic-keys';
const { t } = useI18n({ useScope: 'global' });
defineProps<{ health: readonly MetricHealth[] }>();
function translated<const Mapping extends Readonly<Record<string, string>>>(
  mapping: Mapping,
  value: string,
): string {
  if (!Object.hasOwn(mapping, value)) return value;
  return t(mapping[value as keyof Mapping]);
}
function displayHealthValue(row: MetricHealth): string {
  if (row.label === 'Overfitting' && row.value.startsWith('Gap: '))
    return t('runs.gap', { value: row.value.slice(5) });
  if (row.label === 'Convergence' && row.value.startsWith('Epoch '))
    return t('runs.healthEpoch', { value: row.value.slice(6) });
  return row.value;
}
</script>
<template>
  <section :aria-label="t('runs.health')" class="insight-card">
    <div class="insight-head">
      <h4 class="insight-title">{{ t('runs.health') }}</h4>
      <InfoChip :label="t('runs.health')" :text="t('runs.healthNote')" uncertain />
    </div>
    <dl class="health-list">
      <div v-for="row in health" :key="row.label" class="health-row" :data-severity="row.severity">
        <dt><i aria-hidden="true" />{{ translated(metricHealthLabelMessageKeys, row.label) }}</dt>
        <dd>
          <span class="health-value">{{ displayHealthValue(row) }}</span>
          <Badge
            :variant="
              row.severity === 'error'
                ? 'destructive'
                : row.severity === 'warning'
                  ? 'outline'
                  : 'secondary'
            "
            >{{ translated(metricHealthStatusMessageKeys, row.status) }}</Badge
          >
        </dd>
      </div>
    </dl>
    <p v-if="!health.length" class="text-muted-foreground text-sm">
      {{ t('runs.noHealth') }}
    </p>
  </section>
</template>
<style scoped>
.insight-card {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-width: 0;
  padding: 0.95rem 1rem;
  border-radius: 1rem;
  background: color-mix(in srgb, var(--foreground) 3.5%, transparent);
}
.insight-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.insight-title {
  font-size: 0.85rem;
  font-weight: 650;
}
.health-list {
  display: flex;
  flex-direction: column;
  margin: 0;
}
.health-row {
  --tone: var(--success);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem 0.75rem;
  padding: 0.45rem 0;
  font-size: 0.82rem;
}
.health-row + .health-row {
  border-top: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
}
.health-row[data-severity='warning'] {
  --tone: var(--warning);
}
.health-row[data-severity='error'] {
  --tone: var(--color-destructive);
}
.health-row dt {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.health-row dt i {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: var(--tone);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--tone) 18%, transparent);
}
.health-row dd {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
}
.health-value {
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}
</style>
