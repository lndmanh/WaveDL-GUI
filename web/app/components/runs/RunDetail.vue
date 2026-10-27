<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useClientMessages } from '../../composables/useClientMessages';
import { computed } from 'vue';
import { Button } from '@/components/ui/button';
import {
  canRequestCancellation,
  nativePending,
  type RunMonitorSnapshot,
} from '../../lib/run-monitor';
import StateBadge from './StateBadge.vue';
import LogPanel from './LogPanel.vue';
import MetricSummary from './MetricSummary.vue';
import MetricsChart from './MetricsChart.vue';
import EvaluationResultsPanel from '../results/EvaluationResultsPanel.vue';
import {
  runBackendMessageKeys,
  runCancellationMessageKeys,
  runOperationMessageKeys,
  runStreamMessageKeys,
} from '../../i18n/dynamic-keys';
const { t } = useI18n({ useScope: 'global' });
const { clientMessage } = useClientMessages();
function backendLabel(backend: string): string {
  const key = runBackendMessageKeys[backend as keyof typeof runBackendMessageKeys];
  return key === undefined ? backend : t(key);
}
const props = defineProps<{ snapshot: RunMonitorSnapshot }>();
defineEmits<{ cancel: []; replay: []; close: [] }>();
const pending = computed(() => props.snapshot.run !== null && nativePending(props.snapshot.run));
const metricsUnavailable = computed(
  () =>
    props.snapshot.freshness !== 'fresh' || pending.value || props.snapshot.run?.attempt == null,
);
const chartRecords = computed(() => (metricsUnavailable.value ? [] : props.snapshot.metrics));
const metricsUnconfirmed = computed(
  () =>
    props.snapshot.run?.uncertainty === true || props.snapshot.run?.state === 'supervision_lost',
);
const metricSummary = computed(() =>
  metricsUnavailable.value ? { progress: null, best: null, latest: null } : props.snapshot.summary,
);
const canCancel = computed(() =>
  canRequestCancellation(props.snapshot.run, props.snapshot.cancellation),
);
</script>
<template>
  <section class="run-detail" :aria-label="t('runs.selected')">
    <div class="toolbar">
      <h2>{{ t('runs.detail') }}</h2>
      <Button variant="outline" @click="$emit('close')">{{ t('runs.close') }}</Button>
    </div>
    <template v-if="snapshot.run"
      ><p class="identity">{{ snapshot.run.run_id }}</p>
      <StateBadge :run="snapshot.run" :stale="snapshot.freshness !== 'fresh'" />
      <p>
        {{ backendLabel(snapshot.run.backend) }} ·
        {{ t(runOperationMessageKeys[snapshot.run.operation]) }} ·
        {{
          pending
            ? t('runs.nativePending')
            : t('runs.attempt', { attempt: snapshot.run.attempt ?? t('runs.notAllocated') })
        }}
      </p>
      <p v-if="pending">
        {{ t('runs.pendingNote') }}
      </p></template
    >
    <p>{{ t('runs.eventConnection', { status: t(runStreamMessageKeys[snapshot.stream]) }) }}</p>
    <p v-if="snapshot.freshness !== 'fresh'" role="status">
      {{ t('runs.lifecycleNote') }}
    </p>
    <p v-if="snapshot.message" role="status">
      {{ clientMessage(snapshot.message) }}
    </p>
    <p v-if="snapshot.cancellation !== 'idle'" role="status">
      {{ t('runs.cancellation', { status: t(runCancellationMessageKeys[snapshot.cancellation]) }) }}
    </p>
    <div class="toolbar">
      <Button variant="outline" :disabled="!canCancel" @click="$emit('cancel')">
        {{
          snapshot.cancellation === 'sending' ? t('runs.requesting') : t('runs.requestCancel')
        }}</Button
      ><Button variant="outline" @click="$emit('replay')">{{ t('runs.replay') }}</Button>
    </div>
    <MetricSummary :summary="metricSummary" :unconfirmed="metricsUnconfirmed" />
    <MetricsChart :records="chartRecords" :unavailable="metricsUnavailable" />
    <EvaluationResultsPanel
      :run="snapshot.run"
      :events="snapshot.events"
      :freshness="snapshot.freshness"
    />
    <LogPanel :events="snapshot.events" :truncated="snapshot.truncated" />
  </section>
</template>
<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.identity {
  overflow-wrap: anywhere;
  font-size: 0.8rem;
  color: var(--muted-foreground);
}
</style>
