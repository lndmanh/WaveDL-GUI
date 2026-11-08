<script setup lang="ts">
import { cn } from '@/lib/utils';
import { motion } from 'motion-v';
import { ArrowRight, Check, Copy, Plus, X } from '@lucide/vue';
import type { DaemonApi } from '../../lib/daemon-api';
import { pathName, shortRunId } from '../../lib/run-overview';
import { submittedRunProgress } from '../../lib/submitted-run';
import type { RunView } from '~~/types/daemon-api';

const props = defineProps<{
  api: DaemonApi | null;
  acknowledged: RunView;
  connected: boolean;
}>();

const emit = defineEmits<{ open: []; fresh: [] }>();
const { t } = useI18n({ useScope: 'global' });
const { reportFailure } = useWorkstation();
const titleId = useId();
const { copy, copied, isSupported: canCopy } = useClipboard({ copiedDuring: 1600 });

// Without a connection there is nothing to watch; the acknowledged run still renders.
// The parent re-keys this component when the connection changes, so this choice is stable.
const monitor = props.api ? useRuns(props.api, reportFailure.value, true) : null;

if (monitor) {
  monitor.select(props.acknowledged.run_id);
  usePageActive(monitor.resume, monitor.pause);
}

const run = computed(() => {
  const id = props.acknowledged.run_id;
  const live = monitor?.selected.value?.run;

  return (
    (live?.run_id === id ? live : null) ??
    monitor?.runs.value.find((candidate) => candidate.run_id === id) ??
    props.acknowledged
  );
});

const hasTrained = shallowRef(false);

watch(
  run,
  (current) => {
    // Keep the observed stage when the terminal response no longer carries its phase.
    if (
      current.state === 'running' ||
      current.state === 'stopping' ||
      current.evidence?.phase === 'running' ||
      current.activity != null ||
      (current.progress?.epoch ?? 0) > 0
    )
      hasTrained.value = true;
  },
  { immediate: true },
);

const progress = computed(() => submittedRunProgress(run.value.state, hasTrained.value));

const stepKeys = ['project.submitted', 'project.waitingForGpu', 'project.training', 'project.done'];

const stepStateKeys = {
  complete: 'project.stepComplete',
  current: 'project.stepCurrent',
  future: 'project.stepUpcoming',
  failed: 'project.failed',
  cancelled: 'project.cancelled',
};

const steps = computed(() =>
  stepKeys.map((key, index) => {
    const current = index === progress.value.step;

    const state =
      index < progress.value.step || progress.value.status === 'complete'
        ? 'complete'
        : current
          ? progress.value.status
          : 'future';

    return {
      key,
      current: current && progress.value.status !== 'complete',
      state,
      label: t(current && (state === 'failed' || state === 'cancelled') ? `project.${state}` : key),
      stateLabel: t(stepStateKeys[state]),
    };
  }),
);

const facts = computed(() => {
  const summary = run.value.summary ?? props.acknowledged.summary;

  return [
    { label: t('runs.configDataset'), value: pathName(summary?.data_path) || '—' },
    { label: t('runs.configModel'), value: summary?.model || '—' },
    { label: t('runs.configEpochs'), value: summary?.epochs ? String(summary.epochs) : '—' },
  ];
});

const projectStyles = {
  submitted: cn(
    '@container/submitted flex min-h-96 w-full flex-1 flex-col justify-center gap-11',
    'px-4 py-10 sm:min-h-[28rem] sm:px-8 sm:py-14 lg:px-12',
  ),
  header: cn(
    'flex flex-col gap-6 @min-[48rem]/submitted:flex-row',
    '@min-[48rem]/submitted:items-end @min-[48rem]/submitted:justify-between',
  ),
  actions: cn(
    'flex w-full flex-col gap-2 @min-[30rem]/submitted:w-auto @min-[30rem]/submitted:flex-row',
  ),
  rail: cn('grid grid-cols-1 @min-[30rem]/submitted:grid-cols-4'),
  step: cn(
    'relative flex min-h-16 items-start gap-4 pb-6 last:min-h-0 last:pb-0',
    '@min-[30rem]/submitted:min-h-0 @min-[30rem]/submitted:flex-col',
    '@min-[30rem]/submitted:gap-4 @min-[30rem]/submitted:pr-3 @min-[30rem]/submitted:pb-0',
    '[&:not(:last-child)::before]:absolute [&::before]:left-[0.6875rem] [&::before]:top-6',
    "[&::before]:bottom-0 [&::before]:w-0.5 [&::before]:bg-border [&::before]:[content:'']",
    '@min-[30rem]/submitted:[&::before]:left-6 @min-[30rem]/submitted:[&::before]:top-[0.6875rem]',
    '@min-[30rem]/submitted:[&::before]:right-0 @min-[30rem]/submitted:[&::before]:bottom-auto',
    '@min-[30rem]/submitted:[&::before]:h-0.5 @min-[30rem]/submitted:[&::before]:w-auto',
    "[&[data-state='complete']::before]:bg-success",
  ),
  node: cn(
    'relative grid size-6 shrink-0 place-items-center rounded-full border-2 border-border bg-surface',
    '[&_svg]:size-3.5 [&_svg]:stroke-[3]',
    "[&[data-state='complete']]:border-success [&[data-state='complete']]:bg-success [&[data-state='complete']]:text-white",
    "[&[data-state='current']]:border-primary [&[data-state='current']]:ring-4 [&[data-state='current']]:ring-primary/10",
    "[&[data-state='failed']]:border-destructive [&[data-state='failed']]:bg-destructive [&[data-state='failed']]:text-destructive-foreground",
    "[&[data-state='cancelled']]:border-muted-foreground [&[data-state='cancelled']]:text-muted-foreground",
  ),
  label: cn(
    'pt-0.5 text-sm font-semibold',
    "[&[data-state='complete']]:text-success [&[data-state='future']]:text-muted-foreground",
    "[&[data-state='current']]:text-primary",
    "[&[data-state='failed']]:text-destructive [&[data-state='cancelled']]:text-muted-foreground",
  ),
  summary: cn(
    'grid grid-cols-1 overflow-hidden rounded-xl border border-border bg-surface',
    '@min-[24rem]/submitted:grid-cols-2 @min-[48rem]/submitted:grid-cols-4',
  ),
  fact: cn(
    'min-w-0 border-b border-border px-5 py-4 last:border-b-0',
    '@min-[24rem]/submitted:odd:border-r @min-[24rem]/submitted:[&:nth-last-child(2)]:border-b-0',
    '@min-[48rem]/submitted:border-r @min-[48rem]/submitted:border-b-0 @min-[48rem]/submitted:last:border-r-0',
    '[&_dt]:text-xs [&_dt]:text-muted-foreground',
    '[&_dd]:mt-1 [&_dd]:text-sm [&_dd]:font-semibold [&_dd]:tabular-nums [&_dd]:[overflow-wrap:anywhere]',
  ),
};
</script>

<template>
  <motion.section
    :class="projectStyles.submitted"
    :aria-labelledby="titleId"
    :initial="{ opacity: 0, y: 8 }"
    :animate="{ opacity: 1, y: 0 }"
    :transition="{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }"
  >
    <header :class="projectStyles.header">
      <div class="min-w-0">
        <h2 :id="titleId" class="text-3xl font-bold tracking-[-0.035em] sm:text-4xl">
          {{ t('project.allSet') }}
        </h2>
        <p class="mt-3 text-sm text-muted-foreground">{{ t('project.allSetHelp') }}</p>
      </div>
      <div :class="projectStyles.actions">
        <Button type="button" variant="outline" @click="emit('fresh')">
          <Plus aria-hidden="true" />{{ t('builder.startNewRun') }}
        </Button>
        <Button type="button" :disabled="!connected" @click="emit('open')">
          {{ t('project.viewDetails') }}<ArrowRight aria-hidden="true" />
        </Button>
      </div>
    </header>

    <ol :class="projectStyles.rail" :aria-label="t('project.trainingProgress')">
      <li
        v-for="step in steps"
        :key="step.key"
        :class="projectStyles.step"
        :data-state="step.state"
        :aria-current="step.current ? 'step' : undefined"
      >
        <span :class="projectStyles.node" :data-state="step.state" aria-hidden="true">
          <Check v-if="step.state === 'complete'" />
          <X v-else-if="step.state === 'failed' || step.state === 'cancelled'" />
          <span
            v-else-if="step.state === 'current'"
            class="size-2 rounded-full bg-primary motion-safe:animate-pulse"
          />
        </span>
        <span :class="projectStyles.label" :data-state="step.state">{{ step.label }}</span>
        <span class="sr-only">{{ step.stateLabel }}</span>
      </li>
    </ol>

    <dl :class="projectStyles.summary">
      <div v-for="fact in facts" :key="fact.label" :class="projectStyles.fact">
        <dt>{{ fact.label }}</dt>
        <dd>{{ fact.value }}</dd>
      </div>
      <div :class="projectStyles.fact">
        <dt>{{ t('runs.configRunId') }}</dt>
        <dd class="flex min-h-7 items-center gap-2">
          <code class="min-w-0 truncate font-mono" :title="acknowledged.run_id">
            {{ shortRunId(acknowledged.run_id) }}
          </code>
          <Button
            v-if="canCopy"
            type="button"
            variant="ghost"
            size="icon"
            class="size-7 shrink-0"
            :aria-label="t('runs.copyRunId')"
            @click="copy(acknowledged.run_id)"
          >
            <Check v-if="copied" aria-hidden="true" /><Copy v-else aria-hidden="true" />
          </Button>
          <span class="sr-only" aria-live="polite">{{ copied ? t('runs.runIdCopied') : '' }}</span>
        </dd>
      </div>
    </dl>
  </motion.section>
</template>
