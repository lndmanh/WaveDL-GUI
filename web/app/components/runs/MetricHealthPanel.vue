<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { Badge } from '@/components/ui/badge';
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
  <section :aria-label="t('runs.health')" class="flex flex-col gap-2">
    <h4>{{ t('runs.health') }}</h4>
    <p class="text-muted-foreground text-sm">
      {{ t('runs.healthNote') }}
    </p>
    <dl class="flex flex-col gap-2">
      <div v-for="row in health" :key="row.label" class="flex flex-wrap items-center gap-2">
        <dt>{{ translated(metricHealthLabelMessageKeys, row.label) }}</dt>
        <dd class="flex items-center gap-2">
          {{ displayHealthValue(row) }}
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
