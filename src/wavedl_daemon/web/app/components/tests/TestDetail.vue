<script setup lang="ts">
import { ArrowLeft, RefreshCw } from '@lucide/vue';
import { RunMonitor, terminalRun } from '../../lib/run-monitor';
import { evaluationResults } from '../../lib/evaluation-results';
import { checkpointLabel } from '../../lib/test-runs';
import { pathName, runKindOf } from '../../lib/run-overview';
import { runKindMessageKeys } from '../../i18n/dynamic-keys';
import type { DaemonApi } from '../../lib/daemon-api';
import type { ConnectionSession } from '../../lib/connection-session';
import type { RunMonitorSnapshot } from '~~/types/run-monitor';
import type { Artifact } from '~~/types/artifact-client';

const props = defineProps<{
  api: DaemonApi;
  session: ConnectionSession;
  runId: string;
  back?: { label: string; to: string };
}>();
const { t } = useI18n({ useScope: 'global' });
const { clientMessage } = useClientMessages();
const { reportFailure } = useWorkstation();
const { isActive } = usePageActive();
const labels = useRunLabels();
const titleId = useId();
const snapshot = shallowRef<RunMonitorSnapshot | null>(null);
const tab = shallowRef<string | number>('metrics');
const selectedImage = shallowRef<Artifact | null>(null);
const { connected, inventory, busy, message, downloadStatus, refresh, consume } = useRunArtifacts(
  () => props.session,
  () => props.runId,
);
const images = useArtifactImages(() => props.runId);
const clock = useNow({ controls: true, scheduler: (tick) => useIntervalFn(tick, 30_000, { immediate: false }) });
usePageActive(clock.resume, clock.pause);

watch(() => props.runId, () => {
  snapshot.value = null;
  tab.value = 'metrics';
  selectedImage.value = null;
}, { flush: 'sync' });

watch([() => props.runId, isActive, connected], ([id, active, online], _previous, onCleanup) => {
  if (!active || !online) return;
  const api = props.api;
  const monitor = new RunMonitor(id, {
    getRun: (runId, signal) => api.getRun(runId, AbortSignal.any([signal, AbortSignal.timeout(15000)])),
    openEvents: (runId, cursor, signal) => api.openEvents(runId, cursor, signal, api.daemonId),
    getEventPage: (runId, cursor, signal) => api.getEventPage(runId, cursor, signal, api.daemonId),
    cancelRun: (runId, signal) => api.cancelRun(runId, signal),
  }, 2000, (error) => reportFailure.value(error));
  const unsubscribe = monitor.subscribe((value) => { snapshot.value = value; });
  onCleanup(() => {
    unsubscribe();
    monitor.stop();
  });
  void monitor.start();
}, { immediate: true, flush: 'sync' });

const run = computed(() => snapshot.value?.run ?? null);
const dataset = computed(() => pathName(run.value?.summary?.data_path) || t('results.unknownDataset'));
const checkpoint = computed(() => checkpointLabel(run.value?.summary?.checkpoint));
const metricsReady = computed(() => connected.value && snapshot.value?.freshness === 'fresh' && run.value !== null && evaluationResults(run.value, snapshot.value.events) !== null);

// The initial inventory may have been read before the child published its files.
watch(() => run.value !== null && terminalRun(run.value), (settled) => {
  if (settled) void refresh();
});
</script>

<template>
  <section class="flex min-h-0 min-w-0 flex-1 flex-col gap-3" :aria-labelledby="titleId">
    <NuxtLink v-if="back" :to="back.to" class="inline-flex min-w-0 items-center gap-1 self-start rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
      <ArrowLeft class="size-4 shrink-0" aria-hidden="true" /><span class="truncate">{{ back.label }}</span>
    </NuxtLink>
    <header class="flex min-w-0 flex-wrap items-start justify-between gap-2">
      <div class="min-w-0 flex-1">
        <h3 :id="titleId" class="text-lg font-semibold [overflow-wrap:anywhere]">{{ t('results.testOn', { dataset }) }}</h3>
        <div v-if="run" class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">{{ t(runKindMessageKeys[runKindOf(run)]) }}</Badge>
          <span v-if="checkpoint">{{ t(checkpoint.key, checkpoint.params ?? {}) }}</span>
          <RunStateChip :run="run" :stale="snapshot?.freshness !== 'fresh'" compact />
          <span>{{ labels.created(run, clock.now.value) }}</span>
        </div>
      </div>
      <Button type="button" variant="ghost" size="icon" :aria-label="t('results.refresh')" :disabled="busy || !connected" @click="refresh"><RefreshCw aria-hidden="true" /></Button>
    </header>
    <Alert v-if="snapshot?.message" variant="warning" role="status"><AlertDescription>{{ clientMessage(snapshot.message) }}</AlertDescription></Alert>
    <Alert v-if="message" role="status"><AlertDescription>{{ t(message) }}</AlertDescription></Alert>
    <p v-if="downloadStatus" role="status" class="text-sm text-muted-foreground">{{ t(downloadStatus) }}</p>
    <Tabs v-model="tab" class="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <TabsList :aria-label="t('results.resultViews')" class="shrink-0">
        <TabsTrigger value="metrics">{{ t('results.metrics') }}</TabsTrigger>
        <TabsTrigger value="plots">{{ t('results.testPlots') }}</TabsTrigger>
        <TabsTrigger value="files">{{ t('results.files') }}</TabsTrigger>
        <TabsTrigger value="settings">{{ t('results.testSettings') }}</TabsTrigger>
      </TabsList>
      <TabsContent value="metrics" class="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
        <EvaluationResultsPanel v-if="metricsReady && snapshot" :run="run" :events="snapshot.events" :freshness="snapshot.freshness" :artifacts="inventory.files" :images="images" @preview="selectedImage = $event" />
        <EvaluationResultsSkeleton v-else-if="!run && !snapshot?.message" />
        <p v-else role="status" class="py-8 text-center text-sm text-muted-foreground">{{ t('results.metricsPending') }}</p>
      </TabsContent>
      <TabsContent value="plots" class="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
        <EvaluationPlots :artifacts="inventory.files" :images="images" :has-parameters="false" @preview="selectedImage = $event" />
      </TabsContent>
      <TabsContent value="files" class="flex min-h-0 min-w-0 flex-1 flex-col">
        <ArtifactList :artifacts="inventory.files" :checkpoints="inventory.checkpoints" :busy="busy" :images="images" fill @download="consume" @preview="selectedImage = $event" />
      </TabsContent>
      <TabsContent value="settings" class="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
        <RunConfigurationPanel v-if="run" :run="run" :active="isActive && tab === 'settings'" />
      </TabsContent>
    </Tabs>
    <ArtifactLightbox :artifacts="inventory.files" :images="images" :selected="selectedImage" @close="selectedImage = null" @download="consume" />
  </section>
</template>
