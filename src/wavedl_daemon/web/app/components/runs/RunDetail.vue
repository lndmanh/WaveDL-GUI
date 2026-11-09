<script setup lang="ts">
import { cn } from '@/lib/utils';
import { motion, useReducedMotion } from 'motion-v';
import type { Component } from 'vue';
import {
  Activity,
  ArrowLeft,
  ChartLine,
  Check,
  Clock,
  Copy,
  CornerDownRight,
  Cpu,
  Database,
  Ellipsis,
  FlaskConical,
  Maximize2,
  Minimize2,
  OctagonX,
  PanelRight,
  RefreshCcw,
  Repeat,
  RotateCcw,
  ScrollText,
  Server,
  X,
} from '@lucide/vue';
import { SHELL_PANEL_TABS, shellPanelTabTargetId } from '../../shell/constants';
import { sectionPath } from '../../shell/sections';
import type { RunView } from '~~/types/daemon-api';
import type { ShellPanelTabId } from '~~/types/shell';
import { evaluationResults } from '../../lib/evaluation-results';
import { canRequestCancellation, terminalRun } from '../../lib/run-monitor';
import { buildPlotSeries, minimumPoint } from '../../lib/plot-series';
import type { PlotSeries } from '~~/types/plot-series';
import {
  durationText,
  pathName,
  remainingSeconds,
  runCreatedAt,
  shortRunId,
} from '../../lib/run-overview';
import { runBackendMessageKeys, runCancellationMessageKeys } from '../../i18n/dynamic-keys';
import type { RunMonitorSnapshot } from '~~/types/run-monitor';
import type { Artifact } from '~~/types/artifact-client';

const styles = {
  card: cn('@container h-full min-h-0 min-w-0 gap-0 overflow-hidden py-0'),
  header: cn('flex shrink-0 flex-col gap-3 px-4 py-3'),
  facts: cn(
    'flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground',
    '[&>li]:inline-flex [&>li]:min-w-0 [&>li]:items-center [&>li]:gap-1.5 [&>li]:wrap-anywhere',
    '[&>li>svg]:size-3.5 [&>li>svg]:shrink-0 [&>li>svg]:text-muted-foreground/70',
    "[&>li[data-tone='warning']]:text-warning [&>li[data-tone='warning']>svg]:text-warning",
  ),
  factLink: cn(
    'rounded-sm text-foreground underline decoration-border underline-offset-3 transition-colors',
    'hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  ),
};

const operationIcons: Readonly<Record<RunView['operation'], Component>> = {
  train: Activity,
  test: FlaskConical,
  plot: ChartLine,
};

interface RunFact {
  key: string;
  icon: Component;
  text: string;
  /** Screen-reader prefix naming what the value is; omitted when the text says it. */
  label?: string;
  title?: string;
  to?: string;
  tone?: 'warning';
}

const { t, locale } = useI18n({ useScope: 'global' });
const { clientMessage } = useClientMessages();
const { state: connectionState, session } = useWorkstation();
const navigate = useShellNavigation();
const shellLayout = useShellLayout();
const { isCanvasExpanded, isCompanionShowing, panelTabs } = shellLayout;
const { isActive } = usePageActive();
const labels = useRunLabels();
const reducedMotion = useReducedMotion();

function backendLabel(backend: string): string {
  const key = Object.entries(runBackendMessageKeys).find(([name]) => name === backend)?.[1];

  return key === undefined ? backend : t(key);
}

const props = withDefaults(
  defineProps<{
    snapshot: RunMonitorSnapshot;
    now?: Date;
    back?: boolean;
    animateEntrance?: boolean;
  }>(),
  { back: false, animateEntrance: true },
);

const artifactResourcesActive = computed(
  () =>
    props.snapshot.run?.state !== 'planned' &&
    (props.snapshot.run?.operation === 'test' ||
      (isCompanionShowing.value && shellLayout.resolvedActiveTab.value === 'artifacts')),
);

const runArtifacts = useRunArtifacts(
  session,
  () => props.snapshot.run?.run_id ?? null,
  artifactResourcesActive,
);

const { inventory: resultInventory, scopeGeneration: artifactScope } = runArtifacts;

const images = useArtifactImages(() =>
  artifactResourcesActive.value ? (props.snapshot.run?.run_id ?? null) : null,
);

const selectedImage = shallowRef<Artifact | null>(null);

const shownEvaluations = new Set<string>();

watch(
  [artifactScope, isActive],
  () => {
    selectedImage.value = null;
  },
  { flush: 'sync' },
);

const title = useTemplateRef<HTMLElement>('title');

function focusTitle() {
  title.value?.focus({ preventScroll: true });
}

defineExpose({ focusTitle });

defineEmits<{ cancel: []; replay: []; close: []; changed: [message?: string]; deleted: [] }>();

const planned = computed(() => props.snapshot.run?.state === 'planned');

const panelTargets = shallowReactive<Record<ShellPanelTabId, HTMLElement | null>>({
  metrics: null,
  health: null,
  configuration: null,
  logs: null,
  artifacts: null,
});

const parkedPanel = shallowRef<HTMLElement | null>(null);

onMounted(() => {
  parkedPanel.value = document.createElement('div');

  for (const tab of SHELL_PANEL_TABS)
    panelTargets[tab.id] = document.getElementById(shellPanelTabTargetId(tab.id));
});

const { copy, copied, isSupported: canCopy } = useClipboard({ copiedDuring: 1600 });

const metricsUnavailable = computed(
  () => props.snapshot.freshness !== 'fresh' || props.snapshot.run?.attempt == null,
);

// The first authority fetch and event connection are still pending, so missing
// metrics mean "not loaded yet" rather than "unavailable".
const metricsLoading = computed(
  () =>
    props.snapshot.freshness === 'unconfirmed' ||
    (props.snapshot.freshness === 'fresh' && props.snapshot.stream === 'connecting'),
);

const chartRecords = computed(() => (metricsUnavailable.value ? [] : props.snapshot.metrics));

// Share the causal loss projection and its minimum between the strip and chart.
const lossProjection = computed<{ series: PlotSeries | null; error: string }>(() => {
  try {
    return { series: buildPlotSeries(chartRecords.value, 'loss'), error: '' };
  } catch (error) {
    return {
      series: null,
      error: error instanceof Error ? error.message : t('runs.chartDataError'),
    };
  }
});

const bestLoss = computed(() =>
  lossProjection.value.series ? minimumPoint(lossProjection.value.series, 'val_loss') : null,
);

const healthIssues = computed(() =>
  metricsUnavailable.value
    ? 0
    : (props.snapshot.summary.current?.health.filter((row) => row.severity !== 'good').length ?? 0),
);

const metricsUnconfirmed = computed(
  () =>
    props.snapshot.run?.uncertainty === true || props.snapshot.run?.state === 'supervision_lost',
);

const waitingForMetrics = computed(() => {
  const run = props.snapshot.run;

  if (metricsLoading.value) return true;

  return (
    props.snapshot.freshness === 'fresh' &&
    run !== null &&
    !terminalRun(run) &&
    run.state !== 'terminal_unknown' &&
    !metricsUnconfirmed.value
  );
});

const metricSummary = computed(() =>
  metricsUnavailable.value
    ? { progress: null, best: null, latest: null }
    : {
        ...props.snapshot.summary,
        progress: props.snapshot.summary.progress ?? props.snapshot.run?.progress ?? null,
      },
);

const canEvaluate = computed(() => {
  const run = props.snapshot.run;

  return run?.operation === 'train' && run.state === 'completed' && !run.uncertainty;
});

function evaluateOnTestData() {
  const run = props.snapshot.run;

  if (!run || !canEvaluate.value || connectionState.value.status !== 'connected') return;
  void navigate?.(`/results/${run.run_id}?evaluate=best_checkpoint`, false);
}

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

// Only facts that tell runs apart; defaults (local backend, first attempt) stay in Configuration.
const facts = computed<RunFact[]>(() => {
  const run = props.snapshot.run;

  if (!run) return [];
  const summary = run.summary;
  const dataset = pathName(summary?.data_path);

  const schedule = [
    summary?.epochs ? t('runs.epochCount', { count: summary.epochs }) : null,
    summary?.cv ? t('runs.cvFolds', { count: summary.cv }) : null,
  ].filter((part): part is string => part !== null);

  const result: RunFact[] = [];

  if (summary?.name && summary.model)
    result.push({ key: 'model', icon: Cpu, text: summary.model, label: t('runs.columnModel') });

  if (dataset)
    result.push({ key: 'dataset', icon: Database, text: dataset, label: t('runs.columnDataset') });

  if (schedule.length > 0)
    result.push({ key: 'schedule', icon: Repeat, text: schedule.join(' · ') });

  if (summary?.source_run_id)
    result.push({
      key: 'source',
      icon: CornerDownRight,
      text: t('runs.fromRun', { id: shortRunId(summary.source_run_id) }),
      title: summary.source_run_id,
      to: sectionPath('experiments', summary.source_run_id),
    });

  if (run.backend !== 'local')
    result.push({ key: 'backend', icon: Server, text: backendLabel(run.backend) });

  if (run.attempt !== null && run.attempt > 1)
    result.push({
      key: 'attempt',
      icon: RefreshCcw,
      text: t('runs.attempt', { attempt: run.attempt }),
      tone: 'warning',
    });

  if (created.value)
    result.push({
      key: 'created',
      icon: Clock,
      text: created.value.relative ?? created.value.text,
      label: t('runs.columnCreated'),
      title: created.value.text,
    });

  return result;
});

const percent = computed(() =>
  metricSummary.value.progress
    ? new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 0 }).format(
        Math.min(1, Math.max(0, metricSummary.value.progress.fraction)),
      )
    : '',
);

const elapsed = computed(() => metricSummary.value.current?.elapsedSeconds ?? null);

// Last-known evidence must not read as a live countdown.
const remaining = computed(() =>
  metricsUnconfirmed.value ? null : remainingSeconds(metricSummary.value.progress, elapsed.value),
);

const hasEvaluation = computed(
  () =>
    props.snapshot.run !== null &&
    props.snapshot.freshness === 'fresh' &&
    evaluationResults(props.snapshot.run, props.snapshot.events) !== null,
);
</script>
<template>
  <!-- Hidden KeepAlive mounts leave motion-v at its initial opacity; enter only on activation. -->
  <motion.div
    v-if="isActive"
    as-child
    :initial="animateEntrance ? { opacity: 0, y: 12 } : false"
    :animate="{ opacity: 1, y: 0 }"
    :transition="reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 30 }"
  >
    <Card :class="styles.card" :aria-label="t('runs.selected')">
      <header :class="styles.header">
        <div class="flex flex-wrap items-center gap-2">
          <div class="flex min-w-[min(100%,14rem)] flex-1 flex-wrap items-center gap-2">
            <div class="flex min-w-0 max-w-full items-center gap-2">
              <h3
                ref="title"
                tabindex="-1"
                class="min-w-0 truncate text-lg font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :title="snapshot.run ? labels.title(snapshot.run) : undefined"
              >
                {{ snapshot.run ? labels.title(snapshot.run) : t('runs.loadingRuns') }}
              </h3>
              <Badge v-if="snapshot.run" variant="outline" class="shrink-0 text-muted-foreground">
                <component :is="operationIcons[snapshot.run.operation]" aria-hidden="true" />
                {{ labels.operation(snapshot.run) }}
              </Badge>
            </div>
            <RunStateChip
              v-if="snapshot.run"
              :run="snapshot.run"
              :stale="snapshot.freshness !== 'fresh'"
            />
            <Badge
              v-if="healthIssues > 0"
              as="button"
              type="button"
              variant="outline"
              class="cursor-pointer"
              @click="shellLayout.setActiveTab('health')"
            >
              <span class="size-1.5 rounded-full bg-warning" aria-hidden="true" />
              {{ t('runs.healthWarnings', { count: healthIssues }, healthIssues) }}
            </Badge>
          </div>
          <TooltipProvider>
            <div class="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1">
              <div v-if="!planned" class="flex items-center gap-1">
                <Tooltip v-if="canEvaluate">
                  <TooltipTrigger as-child>
                    <Button
                      variant="outline"
                      size="sm"
                      :disabled="connectionState.status !== 'connected'"
                      @click="evaluateOnTestData"
                    >
                      <FlaskConical aria-hidden="true" />{{ t('runs.evaluateOnTestData') }}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{{ t('runs.evaluateOnTestDataHint') }}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-8"
                      :aria-label="t('runs.replay')"
                      @click="$emit('replay')"
                      ><RotateCcw aria-hidden="true"
                    /></Button>
                  </TooltipTrigger>
                  <TooltipContent>{{ t('runs.replay') }}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      variant="outline"
                      size="icon"
                      class="size-8 text-destructive"
                      :disabled="!canCancel"
                      :aria-label="
                        snapshot.cancellation === 'sending'
                          ? t('runs.requesting')
                          : t('runs.requestCancel')
                      "
                      @click="$emit('cancel')"
                      ><OctagonX aria-hidden="true"
                    /></Button>
                  </TooltipTrigger>
                  <TooltipContent>{{ t('runs.requestCancel') }}</TooltipContent>
                </Tooltip>
              </div>
              <Separator orientation="vertical" class="mx-1 h-5 shrink-0" />
              <div class="flex items-center gap-1">
                <Tooltip v-if="isCanvasExpanded && panelTabs.length > 0">
                  <TooltipTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-8"
                      :aria-label="t('shell.openCompanionPanel')"
                      :aria-pressed="isCompanionShowing"
                      aria-controls="shell-companion"
                      @click="shellLayout.togglePanel()"
                    >
                      <PanelRight aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{{ t('shell.openCompanionPanel') }}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-8"
                      :aria-label="
                        t(isCanvasExpanded ? 'runs.collapseDetail' : 'runs.expandDetail')
                      "
                      :aria-pressed="isCanvasExpanded"
                      @click="shellLayout.toggleCanvasExpanded()"
                    >
                      <Minimize2 v-if="isCanvasExpanded" aria-hidden="true" />
                      <Maximize2 v-else aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{{
                    t(isCanvasExpanded ? 'runs.collapseDetail' : 'runs.expandDetail')
                  }}</TooltipContent>
                </Tooltip>
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <DropdownMenuTrigger as-child>
                        <Button
                          variant="ghost"
                          size="icon"
                          class="size-8"
                          :aria-label="t('runs.moreActions')"
                          ><Ellipsis aria-hidden="true"
                        /></Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent>{{ t('runs.moreActions') }}</TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      v-if="snapshot.run && canCopy"
                      @select="copy(snapshot.run.run_id)"
                      ><Copy aria-hidden="true" />{{ t('runs.copyRunId') }}</DropdownMenuItem
                    >
                    <DropdownMenuItem
                      v-if="!planned && panelTargets.logs"
                      data-testid="run-open-logs"
                      @select="shellLayout.setActiveTab('logs')"
                      ><ScrollText aria-hidden="true" />{{
                        t('runs.openLogsPanel')
                      }}</DropdownMenuItem
                    >
                  </DropdownMenuContent>
                </DropdownMenu>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-8 text-muted-foreground"
                      :aria-label="back ? t('runs.back') : t('runs.close')"
                      @click="$emit('close')"
                    >
                      <component :is="back ? ArrowLeft : X" aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{{ back ? t('runs.back') : t('runs.close') }}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </TooltipProvider>
        </div>
        <ul v-if="snapshot.run" :class="styles.facts">
          <li
            v-for="fact in facts"
            :key="fact.key"
            :data-tone="fact.tone"
            :title="fact.to ? undefined : fact.title"
          >
            <component :is="fact.icon" aria-hidden="true" />
            <span v-if="fact.label" class="sr-only">{{ fact.label }}:</span>
            <NuxtLink v-if="fact.to" :to="fact.to" :title="fact.title" :class="styles.factLink">{{
              fact.text
            }}</NuxtLink>
            <template v-else>{{ fact.text }}</template>
          </li>
          <li class="ml-auto">
            <Badge
              v-if="canCopy"
              as="button"
              type="button"
              variant="outline"
              class="cursor-pointer font-mono font-normal text-muted-foreground"
              :aria-label="t('runs.copyRunId')"
              :title="t('runs.copyRunId')"
              @click="copy(snapshot.run.run_id)"
            >
              {{ shortRunId(snapshot.run.run_id) }}
              <Check v-if="copied" class="text-success" aria-hidden="true" />
              <Copy v-else aria-hidden="true" />
            </Badge>
            <Badge
              v-else
              variant="outline"
              class="font-mono font-normal text-muted-foreground"
              :title="snapshot.run.run_id"
            >
              {{ shortRunId(snapshot.run.run_id) }}
            </Badge>
          </li>
        </ul>
        <div
          v-if="metricSummary.progress"
          class="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs tabular-nums"
        >
          <span>{{
            t('runs.epoch', {
              epoch: metricSummary.progress.epoch,
              total: metricSummary.progress.totalEpochs,
            })
          }}</span>
          <Progress
            class="h-1.5 min-w-20 flex-1"
            :model-value="metricSummary.progress.fraction * 100"
            :aria-label="t('runs.epochProgress')"
            :aria-valuetext="percent"
          />
          <span class="text-muted-foreground">
            <span v-if="elapsed !== null">{{ durationText(elapsed, locale) }}</span>
            <span v-if="elapsed !== null && remaining !== null" aria-hidden="true"> · </span>
            <span v-if="remaining !== null" :title="t('runs.remainingNote')"
              >≈ {{ durationText(remaining, locale) }} {{ t('runs.remaining') }}</span
            >
          </span>
        </div>
        <span class="sr-only" role="status" aria-live="polite">{{
          copied ? t('runs.runIdCopied') : ''
        }}</span>
        <div
          v-if="
            snapshot.message || snapshot.cancellation !== 'idle' || snapshot.freshness !== 'fresh'
          "
          class="flex flex-col gap-[0.35rem] text-muted-foreground text-[0.82rem] [&:not(:has(p:not(.sr-only)))]:contents"
        >
          <p v-if="snapshot.freshness !== 'fresh'" class="sr-only" role="status" aria-live="polite">
            {{ t('runs.lifecycleNote') }}
          </p>
          <p v-if="snapshot.message" role="status">{{ clientMessage(snapshot.message) }}</p>
          <p v-if="snapshot.cancellation !== 'idle'" role="status">
            {{
              t('runs.cancellation', {
                status: t(runCancellationMessageKeys[snapshot.cancellation]),
              })
            }}
          </p>
        </div>
      </header>
      <Separator />
      <div v-if="planned && snapshot.run" class="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        <PlannedRunActions
          :run="snapshot.run"
          @changed="$emit('changed', $event)"
          @deleted="$emit('deleted')"
        />
        <RunConfigurationPanel :key="snapshot.run.run_id" :run="snapshot.run" :active="isActive" />
      </div>
      <div
        v-else-if="snapshot.run?.operation === 'test'"
        class="min-h-0 flex-1 overflow-y-auto p-4"
      >
        <EvaluationResultsPanel
          v-if="hasEvaluation && snapshot.run"
          :key="snapshot.run.run_id"
          :run="snapshot.run"
          :events="snapshot.events"
          :freshness="snapshot.freshness"
          :artifacts="resultInventory.files"
          :images="images"
          :animate-entry="!shownEvaluations.has(snapshot.run.run_id)"
          @preview="selectedImage = $event"
          @vue:mounted="shownEvaluations.add(snapshot.run.run_id)"
        />
        <Empty v-else role="status" class="min-h-48">
          <EmptyHeader>
            <EmptyMedia><LoadingSpinner compact /></EmptyMedia>
            <EmptyTitle>{{ t('runs.evaluation') }}</EmptyTitle>
            <EmptyDescription>{{ t('runs.waitingEvaluation') }}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
      <div v-else class="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <RunStats
          :summary="metricSummary"
          :records="chartRecords"
          :best-loss="bestLoss"
          :loading="metricsLoading"
        />
        <Separator />
        <div class="flex min-h-0 flex-1 flex-col p-4">
          <MetricsChart
            :run="snapshot.run"
            :events="snapshot.events"
            :records="chartRecords"
            :unavailable="metricsUnavailable"
            :loading="metricsLoading"
            :loss-series="lossProjection.series"
            :loss-error="lossProjection.error"
            :best-loss="bestLoss"
          />
        </div>
      </div>
    </Card>
  </motion.div>
  <ArtifactLightbox
    :artifacts="resultInventory.files"
    :images="images"
    :selected="selectedImage"
    @close="selectedImage = null"
    @download="runArtifacts.consume"
  />
  <!-- Keep companion content mounted, but park it off-document while this page is cached. -->
  <template v-if="parkedPanel && !planned">
    <Teleport
      v-for="panel in SHELL_PANEL_TABS"
      :key="panel.id"
      :to="isActive && panelTargets[panel.id] ? panelTargets[panel.id] : parkedPanel"
      defer
    >
      <div class="min-w-0 p-4">
        <MetricSummary
          v-if="panel.id === 'metrics'"
          :summary="metricSummary"
          :unconfirmed="metricsUnconfirmed"
          :waiting="waitingForMetrics"
        />
        <MetricHealthPanel
          v-else-if="panel.id === 'health'"
          :health="metricSummary.current?.health ?? []"
          :waiting="waitingForMetrics"
        />
        <RunConfigurationPanel
          v-else-if="panel.id === 'configuration' && snapshot.run"
          :key="snapshot.run.run_id"
          :run="snapshot.run"
          :active="
            isActive &&
            isCompanionShowing &&
            shellLayout.resolvedActiveTab.value === 'configuration'
          "
        />
        <LogPanel
          v-else-if="panel.id === 'logs'"
          :run="snapshot.run"
          :events="snapshot.events"
          :truncated="snapshot.truncated"
          :active="isActive && isCompanionShowing && shellLayout.resolvedActiveTab.value === 'logs'"
          panel
        />
        <RunArtifactsPanel
          v-else-if="panel.id === 'artifacts' && snapshot.run"
          :run-id="snapshot.run.run_id"
          :resources="runArtifacts"
          :images="images"
          :active="
            isActive && isCompanionShowing && shellLayout.resolvedActiveTab.value === 'artifacts'
          "
          @preview="selectedImage = $event"
        />
      </div>
    </Teleport>
  </template>
</template>
