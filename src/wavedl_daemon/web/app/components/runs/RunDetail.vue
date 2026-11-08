<script setup lang="ts">
import { cn } from '@/lib/utils';
import { motion, useReducedMotion } from 'motion-v';
import {
  ArrowLeft,
  Copy,
  Ellipsis,
  Maximize2,
  Minimize2,
  OctagonX,
  PanelRight,
  RotateCcw,
  ScrollText,
  X,
} from '@lucide/vue';
import { SHELL_PANEL_TABS, shellPanelTabTargetId } from '../../shell/constants';
import type { ShellPanelTabId } from '~~/types/shell';
import { evaluationResults } from '../../lib/evaluation-results';
import { canRequestCancellation } from '../../lib/run-monitor';
import { buildPlotSeries, minimumPoint } from '../../lib/plot-series';
import type { PlotSeries } from '~~/types/plot-series';
import {
  durationText,
  pathName,
  remainingSeconds,
  runCreatedAt,
  shortRunId,
} from '../../lib/run-overview';
import {
  runBackendMessageKeys,
  runCancellationMessageKeys,
  runStreamMessageKeys,
} from '../../i18n/dynamic-keys';
import type { RunMonitorSnapshot } from '~~/types/run-monitor';

const styles = {
  card: cn('@container h-full min-h-0 min-w-0 gap-0 overflow-hidden py-0'),
  header: cn('flex shrink-0 flex-col gap-3 px-4 py-3'),
  stream: cn(
    'size-2 shrink-0 rounded-full bg-muted-foreground/40',
    "[&[data-stream='live']]:bg-success",
    "[&[data-stream='connecting']]:bg-warning [&[data-stream='reconnecting']]:bg-warning",
    "[&[data-stream='error']]:bg-destructive",
  ),
  facts: cn(
    "flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground [&>li+li]:before:mr-2 [&>li+li]:before:content-['·'] [&>li]:min-w-0 [&>li]:wrap-anywhere",
  ),
};

const { t, locale } = useI18n({ useScope: 'global' });
const { clientMessage } = useClientMessages();
const { state: connectionState } = useWorkstation();
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

const title = useTemplateRef<HTMLElement>('title');

function focusTitle() {
  title.value?.focus({ preventScroll: true });
}

defineExpose({ focusTitle });

defineEmits<{ cancel: []; replay: []; close: [] }>();

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
    t('runs.attempt', { attempt: run.attempt ?? t('runs.notAllocated') }),
  ].filter((fact): fact is string => fact !== null && fact !== undefined && fact !== '');
});

const streamLabel = computed(() => t(runStreamMessageKeys[props.snapshot.stream]));

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
          <h3
            ref="title"
            tabindex="-1"
            class="min-w-[min(100%,10rem)] flex-1 truncate text-lg font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :title="snapshot.run ? labels.title(snapshot.run) : undefined"
          >
            {{ snapshot.run ? labels.title(snapshot.run) : t('runs.loadingRuns') }}
          </h3>
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
          <span
            :class="styles.stream"
            :data-stream="snapshot.stream"
            :title="t('runs.eventConnection', { status: streamLabel })"
          >
            <span class="sr-only">{{ t('runs.eventConnection', { status: streamLabel }) }}</span>
          </span>
          <div class="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1">
            <Button
              v-if="canEvaluate"
              variant="outline"
              size="sm"
              :disabled="connectionState.status !== 'connected'"
              @click="evaluateOnTestData"
              >{{ t('runs.evaluateOnTestData') }}</Button
            >
            <Button
              variant="ghost"
              size="sm"
              :aria-label="t('runs.replay')"
              :title="t('runs.replay')"
              @click="$emit('replay')"
              ><RotateCcw aria-hidden="true" /><span class="hidden @min-[48rem]:inline">{{
                t('runs.replay')
              }}</span></Button
            >
            <Button
              variant="outline"
              size="sm"
              class="text-destructive"
              :disabled="!canCancel"
              :aria-label="
                snapshot.cancellation === 'sending' ? t('runs.requesting') : t('runs.requestCancel')
              "
              :title="t('runs.requestCancel')"
              @click="$emit('cancel')"
            >
              <OctagonX aria-hidden="true" /><span class="hidden @min-[48rem]:inline">{{
                snapshot.cancellation === 'sending' ? t('runs.requesting') : t('runs.requestCancel')
              }}</span>
            </Button>
            <Button
              v-if="isCanvasExpanded && panelTabs.length > 0"
              variant="ghost"
              size="icon"
              class="size-8"
              :aria-label="t('shell.openCompanionPanel')"
              :title="t('shell.openCompanionPanel')"
              :aria-pressed="isCompanionShowing"
              aria-controls="shell-companion"
              @click="shellLayout.togglePanel()"
            >
              <PanelRight aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="size-8"
              :aria-label="t(isCanvasExpanded ? 'runs.collapseDetail' : 'runs.expandDetail')"
              :title="t(isCanvasExpanded ? 'runs.collapseDetail' : 'runs.expandDetail')"
              :aria-pressed="isCanvasExpanded"
              @click="shellLayout.toggleCanvasExpanded()"
            >
              <Minimize2 v-if="isCanvasExpanded" aria-hidden="true" />
              <Maximize2 v-else aria-hidden="true" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  class="size-8"
                  :aria-label="t('runs.moreActions')"
                  ><Ellipsis aria-hidden="true"
                /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem v-if="snapshot.run && canCopy" @select="copy(snapshot.run.run_id)"
                  ><Copy aria-hidden="true" />{{ t('runs.copyRunId') }}</DropdownMenuItem
                >
                <DropdownMenuItem
                  v-if="panelTargets.logs"
                  data-testid="run-open-logs"
                  @select="shellLayout.setActiveTab('logs')"
                  ><ScrollText aria-hidden="true" />{{ t('runs.openLogsPanel') }}</DropdownMenuItem
                >
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon"
              class="size-8 text-muted-foreground"
              :aria-label="back ? t('runs.back') : t('runs.close')"
              :title="back ? t('runs.back') : t('runs.close')"
              @click="$emit('close')"
            >
              <component :is="back ? ArrowLeft : X" aria-hidden="true" />
            </Button>
          </div>
        </div>
        <ul v-if="snapshot.run" :class="styles.facts">
          <li v-for="fact in facts" :key="fact">{{ fact }}</li>
          <li v-if="created" :title="created.relative ?? undefined">
            {{ t('runs.createdAt', { time: created.text }) }}
          </li>
          <li>
            <code>{{ shortRunId(snapshot.run.run_id) }}</code>
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
      <div v-if="snapshot.run?.operation === 'test'" class="min-h-0 flex-1 overflow-y-auto p-4">
        <EvaluationResultsPanel
          v-if="hasEvaluation"
          :run="snapshot.run"
          :events="snapshot.events"
          :freshness="snapshot.freshness"
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
        <RunStats :summary="metricSummary" :records="chartRecords" :best-loss="bestLoss" />
        <Separator />
        <div class="flex min-h-0 flex-1 flex-col p-4">
          <MetricsChart
            :records="chartRecords"
            :unavailable="metricsUnavailable"
            :loss-series="lossProjection.series"
            :loss-error="lossProjection.error"
            :best-loss="bestLoss"
          />
        </div>
      </div>
    </Card>
  </motion.div>
  <!-- Keep companion content mounted, but park it off-document while this page is cached. -->
  <template v-if="parkedPanel">
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
        />
        <MetricHealthPanel
          v-else-if="panel.id === 'health'"
          :health="metricSummary.current?.health ?? []"
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
          :active="
            isActive && isCompanionShowing && shellLayout.resolvedActiveTab.value === 'artifacts'
          "
        />
      </div>
    </Teleport>
  </template>
</template>
