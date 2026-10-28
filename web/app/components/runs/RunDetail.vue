<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useClientMessages } from '../../composables/useClientMessages';
import { computed, onMounted, shallowRef } from 'vue';
import { useShellLayout } from '../../composables/useShellLayout';
import { Button } from '@/components/ui/button';
import {
  canRequestCancellation,
  nativePending,
  type RunMonitorSnapshot,
} from '../../lib/run-monitor';
import RunStateChip from './RunStateChip.vue';
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
const shellLayout = useShellLayout();
function backendLabel(backend: string): string {
  const key = runBackendMessageKeys[backend as keyof typeof runBackendMessageKeys];
  return key === undefined ? backend : t(key);
}
const props = defineProps<{ snapshot: RunMonitorSnapshot }>();
defineEmits<{ cancel: []; replay: []; close: [] }>();
const logTarget = shallowRef<HTMLElement | null>(null);
onMounted(() => {
  logTarget.value = document.querySelector<HTMLElement>('#shell-panel-tab-logs');
});
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
      <RunStateChip
        :run="snapshot.run"
        :stale="snapshot.freshness !== 'fresh'"
        :progress="metricSummary.progress"
        :explanation="pending ? t('runs.pendingNote') : undefined"
      />
      <p>
        {{ backendLabel(snapshot.run.backend) }} ·
        {{ t(runOperationMessageKeys[snapshot.run.operation]) }} ·
        {{
          pending
            ? t('runs.nativePending')
            : t('runs.attempt', { attempt: snapshot.run.attempt ?? t('runs.notAllocated') })
        }}
      </p>
    </template>
    <p>{{ t('runs.eventConnection', { status: t(runStreamMessageKeys[snapshot.stream]) }) }}</p>
    <p v-if="snapshot.freshness !== 'fresh'" class="sr-only" role="status" aria-live="polite">
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
      ><Button variant="outline" @click="$emit('replay')">{{ t('runs.replay') }}</Button
      ><Button
        v-if="logTarget"
        variant="outline"
        data-testid="run-open-logs"
        @click="shellLayout.setActiveTab('logs')"
        >{{ t('runs.logs') }}</Button
      >
    </div>
    <MetricSummary
      :summary="metricSummary"
      :records="chartRecords"
      :unconfirmed="metricsUnconfirmed"
    />
    <MetricsChart :records="chartRecords" :unavailable="metricsUnavailable" />
    <EvaluationResultsPanel
      :run="snapshot.run"
      :events="snapshot.events"
      :freshness="snapshot.freshness"
    />
    <Teleport v-if="logTarget && snapshot.events.length" to="#shell-panel-tab-logs" defer>
      <LogPanel :events="snapshot.events" :truncated="snapshot.truncated" panel />
    </Teleport>
    <LogPanel v-else-if="!logTarget" :events="snapshot.events" :truncated="snapshot.truncated" />
  </section>
</template>
<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  min-width: 0;
}
.run-detail {
  min-width: 0;
  max-width: 100%;
}
.run-detail :deep([data-slot='card']) {
  min-width: 0;
  max-width: 100%;
}
.identity {
  overflow-wrap: anywhere;
  font-size: 0.8rem;
  color: var(--muted-foreground);
}
</style>
