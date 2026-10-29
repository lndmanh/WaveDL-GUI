<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useClientMessages } from '../../composables/useClientMessages';
import { computed, onMounted, shallowRef } from 'vue';
import { motion } from 'motion-v';
import { useClipboard } from '@vueuse/core';
import { Check, Copy, OctagonX, RotateCcw, ScrollText, X } from '@lucide/vue';
import { useShellLayout } from '../../composables/useShellLayout';
import { useRunLabels } from '../../composables/useRunLabels';
import { Button } from '@/components/ui/button';
import {
  canRequestCancellation,
  nativePending,
  type RunMonitorSnapshot,
} from '../../lib/run-monitor';
import { pathName, runCreatedAt, shortRunId } from '../../lib/run-overview';
import RunStateChip from './RunStateChip.vue';
import LogPanel from './LogPanel.vue';
import MetricSummary from './MetricSummary.vue';
import MetricsChart from './MetricsChart.vue';
import EvaluationResultsPanel from '../results/EvaluationResultsPanel.vue';
import {
  runBackendMessageKeys,
  runCancellationMessageKeys,
  runStreamMessageKeys,
} from '../../i18n/dynamic-keys';
const { t, locale } = useI18n({ useScope: 'global' });
const { clientMessage } = useClientMessages();
const shellLayout = useShellLayout();
const labels = useRunLabels();
function backendLabel(backend: string): string {
  const key = runBackendMessageKeys[backend as keyof typeof runBackendMessageKeys];
  return key === undefined ? backend : t(key);
}
const props = defineProps<{ snapshot: RunMonitorSnapshot; now?: Date }>();
defineEmits<{ cancel: []; replay: []; close: [] }>();
const logTarget = shallowRef<HTMLElement | null>(null);
onMounted(() => {
  logTarget.value = document.querySelector<HTMLElement>('#shell-panel-tab-logs');
});
const { copy, copied, isSupported: canCopy } = useClipboard({ copiedDuring: 1600 });
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
const created = computed(() => {
  const run = props.snapshot.run;
  const date = run ? runCreatedAt(run) : null;
  if (!run || !date) return null;
  return {
    text: new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(
      date,
    ),
    relative: labels.created(run, props.now ?? new Date()),
  };
});
/** Approved inputs first, then where and how it executes. */
const facts = computed(() => {
  const run = props.snapshot.run;
  if (!run) return [];
  const summary = run.summary;
  return [
    summary?.name ? summary.model : null,
    pathName(summary?.data_path) || null,
    summary?.epochs ? t('runs.epochCount', { count: summary.epochs }) : null,
    summary?.cv ? t('runs.cvFolds', { count: summary.cv }) : null,
    summary?.source_run_id ? t('runs.fromRun', { id: shortRunId(summary.source_run_id) }) : null,
    labels.operation(run),
    backendLabel(run.backend),
    pending.value
      ? t('runs.nativePending')
      : t('runs.attempt', { attempt: run.attempt ?? t('runs.notAllocated') }),
  ].filter((fact): fact is string => typeof fact === 'string' && fact !== '');
});
const streamLabel = computed(() => t(runStreamMessageKeys[props.snapshot.stream]));
</script>
<template>
  <section class="run-detail" :aria-label="t('runs.selected')">
    <motion.header
      class="run-hero"
      :initial="{ opacity: 0, y: 12 }"
      :animate="{ opacity: 1, y: 0 }"
      :transition="{ type: 'spring', stiffness: 300, damping: 30 }"
    >
      <div class="run-hero-bar">
        <h2 class="run-hero-eyebrow">{{ t('runs.detail') }}</h2>
        <span
          class="run-stream"
          :data-stream="snapshot.stream"
          :title="t('runs.eventConnection', { status: streamLabel })"
          ><i aria-hidden="true" /><span class="sr-only">{{
            t('runs.eventConnection', { status: streamLabel })
          }}</span
          ><span aria-hidden="true">{{ streamLabel }}</span></span
        >
        <Button
          variant="ghost"
          size="icon"
          class="run-hero-close"
          :aria-label="t('runs.close')"
          :title="t('runs.close')"
          @click="$emit('close')"
          ><X aria-hidden="true"
        /></Button>
      </div>
      <template v-if="snapshot.run">
        <h3 class="run-hero-title">{{ labels.title(snapshot.run) }}</h3>
        <ul class="run-hero-facts">
          <li v-for="fact in facts" :key="fact">{{ fact }}</li>
          <li v-if="created" :title="created.relative ?? undefined">
            {{ t('runs.createdAt', { time: created.text }) }}
          </li>
        </ul>
        <div class="run-hero-status">
          <RunStateChip
            :run="snapshot.run"
            :stale="snapshot.freshness !== 'fresh'"
            :progress="metricSummary.progress"
            :explanation="pending ? t('runs.pendingNote') : undefined"
          />
          <span class="run-hero-id"
            ><code class="identity">{{ snapshot.run.run_id }}</code
            ><Button
              v-if="canCopy"
              variant="ghost"
              size="icon"
              class="run-hero-copy"
              :aria-label="t('runs.copyRunId')"
              :title="t('runs.copyRunId')"
              @click="copy(snapshot.run.run_id)"
              ><Check v-if="copied" aria-hidden="true" /><Copy v-else aria-hidden="true" /></Button
          ></span>
          <span class="sr-only" role="status" aria-live="polite">{{
            copied ? t('runs.runIdCopied') : ''
          }}</span>
        </div>
      </template>
      <div class="run-hero-actions">
        <Button
          variant="outline"
          class="run-hero-cancel"
          :disabled="!canCancel"
          @click="$emit('cancel')"
          ><OctagonX aria-hidden="true" />{{
            snapshot.cancellation === 'sending' ? t('runs.requesting') : t('runs.requestCancel')
          }}</Button
        ><Button variant="outline" @click="$emit('replay')"
          ><RotateCcw aria-hidden="true" />{{ t('runs.replay') }}</Button
        ><Button
          v-if="logTarget"
          variant="outline"
          data-testid="run-open-logs"
          @click="shellLayout.setActiveTab('logs')"
          ><ScrollText aria-hidden="true" />{{ t('runs.logs') }}</Button
        >
      </div>
      <div
        v-if="
          snapshot.message ||
          snapshot.cancellation !== 'idle' ||
          snapshot.freshness !== 'fresh'
        "
        class="run-hero-notes"
      >
        <p v-if="snapshot.freshness !== 'fresh'" class="sr-only" role="status" aria-live="polite">
          {{ t('runs.lifecycleNote') }}
        </p>
        <p v-if="snapshot.message" role="status">
          {{ clientMessage(snapshot.message) }}
        </p>
        <p v-if="snapshot.cancellation !== 'idle'" role="status">
          {{
            t('runs.cancellation', { status: t(runCancellationMessageKeys[snapshot.cancellation]) })
          }}
        </p>
      </div>
    </motion.header>
    <MetricSummary
      :summary="metricSummary"
      :records="chartRecords"
      :unconfirmed="metricsUnconfirmed"
    />
    <MetricsChart :records="chartRecords" :unavailable="metricsUnavailable" />
    <EvaluationResultsPanel
      class="run-detail-card"
      :run="snapshot.run"
      :events="snapshot.events"
      :freshness="snapshot.freshness"
    />
    <Teleport v-if="logTarget && snapshot.events.length" to="#shell-panel-tab-logs" defer>
      <LogPanel :events="snapshot.events" :truncated="snapshot.truncated" panel />
    </Teleport>
    <LogPanel
      v-else-if="!logTarget"
      class="run-detail-card"
      :events="snapshot.events"
      :truncated="snapshot.truncated"
    />
  </section>
</template>
<style scoped>
.run-detail {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
  max-width: 100%;
}
.run-detail :deep([data-slot='card']) {
  min-width: 0;
  max-width: 100%;
}
.run-hero {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  overflow: hidden;
  padding: 1.25rem 1.4rem 1.3rem;
  border-radius: 1.4rem;
  background: var(--surface);
  box-shadow:
    0 0 0 0.5px color-mix(in srgb, var(--foreground) 10%, transparent),
    0 24px 48px -32px rgb(0 0 0 / 0.35),
    0 2px 6px rgb(0 0 0 / 0.04);
}
.run-hero::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 3px;
  background: linear-gradient(90deg, #0a63d8, #5aa9ff, #35c46a);
}
.run-hero-bar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.run-hero-eyebrow {
  flex: 1;
  color: var(--muted-foreground);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.run-stream {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  color: var(--muted-foreground);
  font-size: 0.72rem;
  font-weight: 550;
  background: color-mix(in srgb, var(--foreground) 5%, transparent);
}
.run-stream > span[aria-hidden]::first-letter {
  text-transform: uppercase;
}
.run-stream i {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--foreground) 25%, transparent);
}
.run-stream[data-stream='live'] i {
  background: var(--success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 22%, transparent);
}
.run-stream[data-stream='connecting'] i,
.run-stream[data-stream='reconnecting'] i {
  background: var(--warning);
  animation: run-stream-blink 1.2s ease-in-out infinite;
}
.run-stream[data-stream='error'] i {
  background: var(--color-destructive);
}
@keyframes run-stream-blink {
  50% {
    opacity: 0.3;
  }
}
.run-hero-close {
  border-radius: 999px;
  color: var(--muted-foreground);
}
.run-hero-title {
  margin-top: -0.25rem;
  overflow-wrap: anywhere;
  font-size: clamp(1.35rem, 2.4vw, 1.75rem);
  font-weight: 650;
  letter-spacing: -0.03em;
  line-height: 1.15;
}
.run-hero-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.run-hero-facts li {
  max-width: 100%;
  overflow: hidden;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  color: var(--muted-foreground);
  font-size: 0.75rem;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: color-mix(in srgb, var(--foreground) 5%, transparent);
}
.run-hero-status {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}
.run-hero-id {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  min-width: 0;
  max-width: 100%;
}
.identity {
  overflow: hidden;
  color: var(--muted-foreground);
  font:
    0.75rem/1.4 ui-monospace,
    'SF Mono',
    monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.run-hero-copy {
  width: 1.75rem;
  height: 1.75rem;
  flex: none;
  border-radius: 0.5rem;
  color: var(--muted-foreground);
}
.run-hero-copy svg {
  width: 0.85rem;
  height: 0.85rem;
}
.run-hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding-top: 0.85rem;
  border-top: 1px solid color-mix(in srgb, var(--border) 65%, transparent);
}
.run-hero-actions :deep(button) {
  border-radius: 0.7rem;
}
.run-hero-cancel:not(:disabled) {
  color: var(--color-destructive);
}
:global(.dark) .run-hero-cancel:not(:disabled) {
  color: #ff8a8a;
}
.run-hero-notes {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  color: var(--muted-foreground);
  font-size: 0.82rem;
}
.run-hero-notes:not(:has(p:not(.sr-only))) {
  display: contents;
}
.run-detail-card {
  padding: 1.25rem 1.4rem;
  border-radius: 1.25rem;
  background: var(--surface);
  box-shadow:
    0 0 0 0.5px color-mix(in srgb, var(--foreground) 10%, transparent),
    0 1px 2px rgb(0 0 0 / 0.04);
}
@media (prefers-reduced-motion: reduce) {
  .run-stream i {
    animation: none;
  }
}
</style>
