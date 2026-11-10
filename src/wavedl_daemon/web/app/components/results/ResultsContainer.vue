<script setup lang="ts">
import { cn } from '@/lib/utils';
import { CircleAlert } from '@lucide/vue';
import { DaemonApiError } from '../../lib/daemon-api';
import type { DaemonApi } from '../../lib/daemon-api';
import type { RunView } from '~~/types/daemon-api';
import { evaluationResults } from '../../lib/evaluation-results';
import type { ConnectionSession } from '../../lib/connection-session';
import type { RunMonitorSnapshot } from '~~/types/run-monitor';
import type { Artifact } from '~~/types/artifact-client';

const styles = {
  root: cn('flex h-full min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden'),
  list: cn('flex min-h-0 min-w-0 flex-1 flex-col gap-3'),
  tabs: cn('flex min-h-0 min-w-0 flex-1 flex-col gap-4'),
  scrollTab: cn('min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain'),
  actions: cn('flex min-w-0 max-w-full flex-wrap items-center gap-2'),
};

const { t } = useI18n({ useScope: 'global' });
const { clientMessage } = useClientMessages();
const router = useRouter();

const props = defineProps<{
  session: ConnectionSession;
  api: DaemonApi;
  runId: string | null;
  monitor?: RunMonitorSnapshot | null;
}>();

const emit = defineEmits<{
  select: [runId: string | null];
  connectionError: [error: DaemonApiError];
  runLoaded: [run: RunView];
  unknownRun: [runId: string];
}>();

const {
  runs,
  selected: selectedMonitor,
  select: monitorSelected,
  close: closeMonitor,
  loading,
  message: runsMessage,
  page,
  staleRunIds,
  lastRefreshed,
  refresh: refreshRuns,
  pause,
  resume,
} = useRuns(props.api, (error) => emit('connectionError', error), true, { operation: ['train'] });

const {
  runs: evaluationRuns,
  staleRunIds: staleEvaluationIds,
  refresh: refreshEvaluations,
  pause: pauseEvaluations,
  resume: resumeEvaluations,
} = useRuns(props.api, (error) => emit('connectionError', error), true, {
  operation: ['test', 'plot'],
  sourceRunId: () => props.runId,
});

usePageActive(resumeEvaluations, pauseEvaluations);
const { isActive } = usePageActive(resume, pause);
const root = useTemplateRef<HTMLElement>('root');
const { width } = useElementSize(() => (isActive.value ? root.value : null));
const stacked = computed(() => width.value > 0 && width.value < 720);

const clock = useNow({
  controls: true,
  scheduler: (tick) => useIntervalFn(tick, 30_000, { immediate: false }),
});

usePageActive(() => {
  clock.now.value = new Date();
  clock.resume();
}, clock.pause);

const now = clock.now;
const tab = shallowRef<string | number>('files');
const dialogOpen = shallowRef(false);

usePageActive(undefined, () => {
  dialogOpen.value = false;
});

const dialogMode = shallowRef<'evaluate' | 'export'>('evaluate');
const selectedCheckpoint = shallowRef<string>();

const evaluationFocusTarget = computed(
  () => root.value?.querySelector<HTMLButtonElement>('[data-evaluate-trigger]') ?? null,
);

const labels = useRunLabels();
const monitor = computed(() => props.monitor ?? selectedMonitor.value);

const resultRuns = computed(() => runs.value.filter((run) => run.state !== 'planned'));

const selectedRun = computed(
  () => resultRuns.value.find((run) => run.run_id === props.runId) ?? monitor.value?.run,
);

const runName = computed(() =>
  selectedRun.value ? labels.title(selectedRun.value) : (props.runId ?? ''),
);

const evaluations = computed(() =>
  evaluationRuns.value.filter(
    (run) => run.state !== 'planned' && run.summary?.source_run_id === props.runId,
  ),
);

watch(
  () => props.runId,
  (id) => {
    dialogOpen.value = false;

    if (id) monitorSelected(id);
    else closeMonitor();
  },
  { immediate: true },
);

watch([() => monitor.value?.run, isActive], ([run, active]) => {
  if (active && run && run.run_id === props.runId) emit('runLoaded', run);
});

watch(
  () => selectedMonitor.value?.message,
  (error) => {
    if (error instanceof DaemonApiError && error.code === 'http' && error.status === 404) {
      const id = props.runId;
      closeMonitor();

      if (id) emit('unknownRun', id);
    }
  },
);

function openEvaluation(checkpoint?: string, mode: 'evaluate' | 'export' = 'evaluate') {
  if (!isActive.value) return;
  selectedCheckpoint.value = checkpoint;
  dialogMode.value = mode;
  dialogOpen.value = true;
}

// Stay on this run's results: the new evaluation appears in the Evaluations tab, newest first.
function evaluationStarted() {
  tab.value = 'evaluations';
  void refreshEvaluations(0);
}

function choose(runId: string | null) {
  if (isActive.value && runId !== props.runId) emit('select', runId);
}

const {
  session,
  connected,
  scopeGeneration,
  inventory,
  busy,
  message,
  downloadStatus,
  refresh,
  consume,
} = useRunArtifacts(
  () => props.session,
  () => props.runId,
);

const images = useArtifactImages(() => props.runId);
const selectedImage = shallowRef<Artifact | null>(null);
const shownMetrics = new Set<string>();
const shownFiles = new Set<string>();

watch(
  [scopeGeneration, isActive],
  () => {
    selectedImage.value = null;
  },
  { flush: 'sync' },
);

// Cached pages still observe router changes; only the active run may consume this intent.
watch(
  [() => router.currentRoute.value, () => props.runId, isActive, connected, inventory, busy],
  ([route, runId, active, online, items, working]) => {
    if (
      !active ||
      !online ||
      working ||
      !runId ||
      route.path !== `/results/${runId}` ||
      route.query.evaluate !== 'best_checkpoint' ||
      !items.checkpoints.length
    )
      return;

    const checkpoint = items.checkpoints.find((item) => item.name === 'best_checkpoint');
    openEvaluation(checkpoint?.name);
    const query = { ...route.query };
    delete query.evaluate;
    void router.replace({ path: route.path, query, hash: route.hash });
  },
  { immediate: true, flush: 'post' },
);

// The page fills the window like Experiments, so secondary panels live in tabs, not below the table.
const isEvaluation = computed(() => selectedRun.value?.operation === 'test');

const metricsReady = computed(() => {
  const snapshot = monitor.value;

  if (!connected.value || !snapshot?.run || snapshot.run.run_id !== props.runId) return false;

  return (
    snapshot.freshness === 'fresh' && evaluationResults(snapshot.run, snapshot.events) !== null
  );
});

const hasCvSummary = computed(() =>
  inventory.value.files.some((artifact) => artifact.path === 'cv_summary.json'),
);

watch(
  [() => props.runId, isEvaluation],
  ([, evaluation]) => {
    tab.value = evaluation ? 'metrics' : 'files';
  },
  { immediate: true },
);

watch(hasCvSummary, (available) => {
  if (!available && tab.value === 'cv') tab.value = 'files';
});
</script>
<template>
  <section ref="root" :class="styles.root" aria-labelledby="results-title">
    <div class="flex shrink-0 flex-wrap items-center justify-between gap-4">
      <div>
        <h2 id="results-title" class="text-xl font-semibold">
          {{ t('results.publishedResults') }}
        </h2>
        <InfoChip :label="t('results.exactIdentity')" :text="t('results.resultsHelp')" />
      </div>
      <div v-if="runId" :class="styles.actions">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger as-child>
              <span
                :tabindex="inventory.checkpoints.length ? undefined : 0"
                class="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Button
                  data-evaluate-trigger
                  type="button"
                  :disabled="!connected || !inventory.checkpoints.length"
                  @click="openEvaluation()"
                  >{{ t('results.evaluate') }}</Button
                >
              </span>
            </TooltipTrigger>
            <TooltipContent v-if="!inventory.checkpoints.length">{{
              t('results.noCheckpoints')
            }}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <ResultsRunSwitcher
          :runs="resultRuns"
          :run-id="runId"
          :loading="loading"
          :page="page"
          :stale-run-ids="staleRunIds"
          :now="now"
          @select="choose"
          @page="refreshRuns"
          @refresh="refreshRuns()"
        />
        <Button
          data-testid="results-refresh"
          variant="outline"
          :disabled="!runId || busy || !session.api"
          @click="refresh"
          >{{ busy ? t('results.working') : t('results.refresh') }}</Button
        >
      </div>
    </div>
    <Alert v-if="message" class="shrink-0"
      ><AlertTitle>{{ t('results.artifactStatus') }}</AlertTitle
      ><AlertDescription>{{ t(message) }}</AlertDescription></Alert
    >
    <p v-if="downloadStatus" role="status" class="shrink-0 text-sm text-muted-foreground">
      {{ t(downloadStatus) }}
    </p>
    <Alert v-if="runsMessage" variant="warning" role="status" class="shrink-0">
      <CircleAlert aria-hidden="true" />
      <AlertDescription>{{ clientMessage(runsMessage) }}</AlertDescription>
    </Alert>
    <div v-if="!runId" :class="styles.list">
      <MotionConfig reduced-motion="user">
        <RunList
          :runs="resultRuns"
          :show-planned-filter="false"
          :loading="loading"
          :page="page"
          :stale-run-ids="staleRunIds"
          :last-refreshed="lastRefreshed"
          :selected-run-id="null"
          :folded="false"
          :stacked="stacked"
          :now="now"
          @refresh="refreshRuns()"
          @page="refreshRuns"
          @select="choose"
        />
      </MotionConfig>
    </div>
    <template v-else>
      <Tabs v-model="tab" :class="styles.tabs">
        <TabsList :aria-label="t('results.resultViews')" class="shrink-0">
          <TabsTrigger v-if="isEvaluation" value="metrics">{{ t('results.metrics') }}</TabsTrigger>
          <TabsTrigger value="files">{{ t('results.files') }}</TabsTrigger>
          <TabsTrigger value="evaluations"
            >{{ t('results.evaluations')
            }}<Badge variant="secondary" class="ml-1.5 tabular-nums">{{
              evaluations.length
            }}</Badge></TabsTrigger
          >
          <TabsTrigger v-if="hasCvSummary" value="cv">{{
            t('results.crossValidation')
          }}</TabsTrigger>
        </TabsList>
        <TabsContent v-if="isEvaluation" value="metrics" :class="styles.scrollTab">
          <EvaluationResultsPanel
            v-if="metricsReady && monitor"
            :key="runId"
            :artifacts="inventory.files"
            :images="images"
            :animate-entry="!shownMetrics.has(runId)"
            :run="monitor.run"
            :events="monitor.events"
            :freshness="monitor.freshness"
            @preview="selectedImage = $event"
            @vue:mounted="shownMetrics.add(runId)"
          />
          <EvaluationResultsSkeleton v-else />
        </TabsContent>
        <TabsContent value="files" class="flex min-h-0 min-w-0 flex-1 flex-col">
          <ArtifactList
            :key="runId"
            :artifacts="inventory.files"
            :busy="busy"
            :images="images"
            :animate-entry="!shownFiles.has(runId)"
            :checkpoints="inventory.checkpoints"
            checkpoint-actions
            fill
            @evaluate="openEvaluation($event)"
            @export="openEvaluation($event, 'export')"
            @download="consume"
            @preview="selectedImage = $event"
            @vue:mounted="shownFiles.add(runId)"
          />
        </TabsContent>
        <TabsContent v-if="hasCvSummary" value="cv" :class="styles.scrollTab">
          <CvSummaryPanel
            v-if="connected"
            :key="scopeGeneration"
            :session="session"
            :artifacts="inventory.files"
          />
        </TabsContent>
        <TabsContent value="evaluations" :class="styles.scrollTab">
          <EvaluationRunList
            :runs="evaluations"
            :now="now"
            :can-evaluate="connected && !!inventory.checkpoints.length"
            :stale-run-ids="staleEvaluationIds"
            @select="choose"
            @evaluate="openEvaluation()"
          />
        </TabsContent>
      </Tabs>
      <ArtifactLightbox
        :artifacts="inventory.files"
        :images="images"
        :selected="selectedImage"
        @close="selectedImage = null"
        @download="consume"
      />
      <EvaluateDialog
        v-if="connected && isActive"
        :key="`${runId}:${scopeGeneration}`"
        v-model:open="dialogOpen"
        :session="session"
        :run-id="runId"
        :run-name="runName"
        :checkpoints="inventory.checkpoints"
        :checkpoint="selectedCheckpoint"
        :mode="dialogMode"
        :focus-target="evaluationFocusTarget"
        @run-selected="evaluationStarted"
      />
    </template>
  </section>
</template>
