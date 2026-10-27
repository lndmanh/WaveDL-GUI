<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { RuntimeMetricSummary } from '../../lib/metric-history';
const { t } = useI18n({ useScope: 'global' });
defineProps<{ parameters: RuntimeMetricSummary['parameters'] }>();
</script>
<template>
  <section :aria-label="t('runs.perParam')" class="flex flex-col gap-2">
    <h4>{{ t('runs.perParam') }}</h4>
    <dl class="flex flex-wrap gap-4">
      <div v-for="parameter in parameters" :key="parameter.name">
        <dt>{{ parameter.name }}</dt>
        <dd>{{ parameter.value === null ? t('runs.unavailable') : parameter.value }}</dd>
      </div>
    </dl>
    <p v-if="!parameters.length" class="text-muted-foreground text-sm">
      {{ t('runs.noPerParam') }}
    </p>
  </section>
</template>
