<script setup lang="ts">
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { runMessages } from '../../i18n/runs';
import type { RuntimeMetricSummary } from '../../lib/metric-history';
const { t } = useWorkstationI18n(runMessages);
defineProps<{ parameters: RuntimeMetricSummary['parameters'] }>();
</script>
<template>
  <section :aria-label="t('perParam')" class="flex flex-col gap-2">
    <h4>{{ t('perParam') }}</h4>
    <dl class="flex flex-wrap gap-4">
      <div v-for="parameter in parameters" :key="parameter.name">
        <dt>{{ parameter.name }}</dt>
        <dd>{{ parameter.value === null ? t('unavailable') : parameter.value }}</dd>
      </div>
    </dl>
    <p v-if="!parameters.length" class="text-muted-foreground text-sm">
      {{ t('noPerParam') }}
    </p>
  </section>
</template>
