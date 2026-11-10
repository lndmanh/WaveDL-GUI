<script setup lang="ts">
import { ArrowLeft, OctagonX, RefreshCw } from '@lucide/vue';
import { canRequestCancellation, RunMonitor, terminalRun } from '../../lib/run-monitor';
import { runMonitorTransport } from '../../lib/run-monitor-transport';
import { evaluationResults } from '../../lib/evaluation-results';
import { checkpointLabel } from '../../lib/test-runs';
import { pathName, runKindOf } from '../../lib/run-overview';
import { runCancellationMessageKeys, runKindMessageKeys } from '../../i18n/dynamic-keys';
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
let monitor: RunMonitor | null = null;
let initialTabPending = true;
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
  initialTabPending = true;
  snapshot.value = null;
  tab.value = 'metrics';
  selectedImage.value = null;
}, { flush: 'sync' });

watch([() => props.runId, isActive, connected], ([id, active, online], _previous, onCleanup) => {
  if (!active || !online) return;
  const current = new RunMonitor(id, runMonitorTransport(props.api), 2000, (error) => reportFailure.value(error));
  monitor = current;
  const unsubscribe = current.subscribe((value) => { snapshot.value = value; });
  onCleanup(() => {
    unsubscribe();
    current.stop();
    if (monitor === current) monitor = null;
  });
  void current.start();
}, { immediate: true, flush: 'sync' });

const run = computed(() => snapshot.value?.run ?? null);
const canCancel = computed(() => connected.value && snapshot.value?.freshness === 'fresh' && canRequestCancellation(run.value, snapshot.value?.cancellation ?? 'idle'));
const settled = computed(() => run.value !== null && terminalRun(run.value));
const explanation = computed(() => run.value?.evidence?.reason || undefined);

async function cancel(): Promise<void> {
  if (isActive.value && canCancel.value) await monitor?.cancel();
}

watch(() => run.value?.operation, (operation) => {
  if (operation === undefined || !initialTabPending) return;
  initialTabPending = false;
  if (operation === 'plot') tab.value = 'plots';
}, { flush: 'sync' });
const dataset = computed(() => pathName(run.value?.summary?.data_path) || t('results.unknownDataset'));
const checkpoint = computed(() => checkpointLabel(run.value?.summary?.checkpoint));
const hasMetrics = computed(() => run.value !== null && snapshot.value !== null && evaluationResults(run.value, snapshot.value.events) !== null);
const metricsReady = computed(() => connected.value && snapshot.value?.freshness === 'fresh' && hasMetrics.value);

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
          <RunStateChip :run="run" :stale="snapshot?.freshness !== 'fresh'" :explanation="explanation" compact />
          <span>{{ labels.created(run, clock.now.value) }}</span>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <Button v-if="run && !settled && run.state !== 'planned'" type="button" variant="outline" class="text-destructive" :disabled="!canCancel" @click="cancel">
          <OctagonX aria-hidden="true" />{{ snapshot?.cancellation === 'sending' ? t('runs.requesting') : t('runs.requestCancel') }}
        </Button>
        <Button type="button" variant="ghost" size="icon" :aria-label="t('results.refresh')" :disabled="busy || !connected" @click="refresh"><RefreshCw aria-hidden="true" /></Button>
      </div>
    </header>
    <p v-if="explanation" role="status" class="text-sm text-muted-foreground [overflow-wrap:anywhere]">{{ explanation }}</p>
    <p v-if="snapshot && snapshot.cancellation !== 'idle'" role="status" class="text-sm text-muted-foreground">{{ t('runs.cancellation', { status: t(runCancellationMessageKeys[snapshot.cancellation]) }) }}</p>
    <Alert v-if="snapshot?.message" variant="warning" role="status"><AlertDescription>{{ clientMessage(snapshot.message) }}</AlertDescription></Alert>
    <Alert v-if="message" role="status"><AlertDescription>{{ t(message) }}</AlertDescription></Alert>
    <p v-if="downloadStatus" role="status" class="text-sm text-muted-foreground">{{ t(downloadStatus) }}</p>
    <Tabs v-model="tab" class="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <TabsList :aria-label="t('results.resultViews')" class="h-auto w-full shrink-0 flex-wrap">
        <TabsTrigger value="metrics">{{ t('results.metrics') }}</TabsTrigger>
        <TabsTrigger value="plots">{{ t('results.testPlots') }}</TabsTrigger>
        <TabsTrigger value="files">{{ t('results.files') }}</TabsTrigger>
        <TabsTrigger value="settings">{{ t('results.testSettings') }}</TabsTrigger>
        <TabsTrigger value="logs">{{ t('runs.runtimeDiagnostics') }}</TabsTrigger>
      </TabsList>
      <TabsContent value="metrics" class="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
        <EvaluationResultsPanel v-if="metricsReady && snapshot" :run="run" :events="snapshot.events" :freshness="snapshot.freshness" :artifacts="inventory.files" :images="images" @preview="selectedImage = $event" />
        <EvaluationResultsSkeleton v-else-if="!run && !snapshot?.message" />
        <p v-else role="status" class="py-8 text-center text-sm text-muted-foreground">{{ t(settled && !hasMetrics ? 'results.metricsNotProduced' : 'results.metricsPending') }}</p>
      </TabsContent>
      <TabsContent value="plots" class="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
        <EvaluationPlots :artifacts="inventory.files" :images="images" :has-parameters="false" @preview="selectedImage = $event" />
      </TabsContent>
      <TabsContent value="files" class="flex min-h-0 min-w-0 flex-1 flex-col">
        <ArtifactList :artifacts="inventory.files" :checkpoints="inventory.checkpoints" :busy="busy" :images="images" fill @download="consume" @preview="selectedImage = $event" />
      </TabsContent>
      <TabsContent value="logs" class="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
        <LogPanel v-if="snapshot" :run="run" :events="snapshot.events" :truncated="snapshot.truncated" :active="isActive && tab === 'logs'" panel />
      </TabsContent>
      <TabsContent value="settings" class="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
        <RunConfigurationPanel v-if="run" :run="run" :active="isActive && tab === 'settings'" />
      </TabsContent>
    </Tabs>
    <ArtifactLightbox :artifacts="inventory.files" :images="images" :selected="selectedImage" @close="selectedImage = null" @download="consume" />
  </section>
</template>
