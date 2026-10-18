<script setup lang="ts">
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { runMessages } from '../../i18n/runs';
import { Badge } from '@/components/ui/badge';
import type { MetricHealth } from '../../lib/metric-history';
const { t, translateKnownMessage } = useWorkstationI18n(runMessages);
defineProps<{ health: readonly MetricHealth[] }>();
function displayHealthValue(row: MetricHealth): string {
  if (row.label === 'Overfitting' && row.value.startsWith('Gap: '))
    return t('gap', { value: row.value.slice(5) });
  if (row.label === 'Convergence' && row.value.startsWith('Epoch '))
    return t('healthEpoch', { value: row.value.slice(6) });
  return row.value;
}
</script>
<template>
  <section :aria-label="t('health')" class="flex flex-col gap-2">
    <h4>{{ t('health') }}</h4>
    <p class="text-muted-foreground text-sm">
      {{ t('healthNote') }}
    </p>
    <dl class="flex flex-col gap-2">
      <div v-for="row in health" :key="row.label" class="flex flex-wrap items-center gap-2">
        <dt>{{ translateKnownMessage(row.label) }}</dt>
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
            >{{ translateKnownMessage(row.status) }}</Badge
          >
        </dd>
      </div>
    </dl>
    <p v-if="!health.length" class="text-muted-foreground text-sm">
      {{ t('noHealth') }}
    </p>
  </section>
</template>
