<script setup lang="ts">
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { runMessages } from '../../i18n/runs';
import { computed } from 'vue';
import type { RunView } from '../../lib/daemon-api';
import type { RunEvent } from '../../lib/event-stream';
import { evaluationResults } from '../../lib/evaluation-results';

const { t, translateKnownMessage } = useWorkstationI18n(runMessages);
const props = defineProps<{
  run: RunView | null;
  events: readonly RunEvent[];
  freshness: 'fresh' | 'stale' | 'unconfirmed';
}>();
const metrics = computed(() => {
  if (!props.run || props.freshness !== 'fresh') return null;
  return evaluationResults(props.run, props.events);
});
const rows = computed(() =>
  Object.entries(metrics.value ?? {}).map(([name, value]) => ({
    name,
    label: translateKnownMessage(name.replaceAll('_', ' ')),
    value: value === null ? t('notAvailable') : JSON.stringify(value),
  })),
);
</script>

<template>
  <section v-if="metrics" class="flex flex-col gap-4" aria-labelledby="evaluation-title">
    <div>
      <h3 id="evaluation-title" class="text-lg font-semibold">{{ t('evaluation') }}</h3>
      <p class="text-sm text-muted-foreground">
        {{ t('structuredResults', { attempt: run?.attempt ?? '' }) }}
      </p>
    </div>
    <dl class="grid gap-3 sm:grid-cols-2">
      <div v-for="row in rows" :key="row.name" class="flex flex-col gap-1">
        <dt class="text-sm text-muted-foreground">{{ row.label }}</dt>
        <dd class="break-words font-mono text-sm">{{ row.value }}</dd>
      </div>
    </dl>
  </section>
</template>
