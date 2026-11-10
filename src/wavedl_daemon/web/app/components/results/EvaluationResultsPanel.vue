<script setup lang="ts">
import { Check, Copy } from '@lucide/vue';
import { MotionConfig, motion } from 'motion-v';
import { evaluationResults } from '../../lib/evaluation-results';
import { finiteMetric, parameterScores } from '../../lib/evaluation-scorecard';
import { pathName } from '../../lib/run-overview';
import { checkpointLabel } from '../../lib/test-runs';
import type { ArtifactImages } from '../../composables/useArtifactImages';
import type { Artifact } from '~~/types/artifact-client';
import type { RunView } from '~~/types/daemon-api';
import type { RunEvent } from '~~/types/event-stream';

const props = withDefaults(
  defineProps<{
    run: RunView | null;
    events: readonly RunEvent[];
    freshness: 'fresh' | 'stale' | 'unconfirmed';
    artifacts: readonly Artifact[];
    images: ArtifactImages;
    animateEntry?: boolean;
  }>(),
  { animateEntry: false },
);

// Capture the mount's entry intent; option changes and later parent updates never restart it.
const animateEntry = props.animateEntry;
const emit = defineEmits<{ preview: [artifact: Artifact] }>();
const { t, locale } = useI18n({ useScope: 'global' });
const { copy, copied, isSupported: canCopy } = useClipboard({ copiedDuring: 1600 });
const copyFailed = shallowRef(false);

const metrics = computed(() =>
  props.run && props.freshness === 'fresh' ? evaluationResults(props.run, props.events) : null,
);

const { context, baseline, comparisonLoading } = useEvaluationContext(
  () => props.run,
  () => metrics.value !== null,
);

const parameters = computed(() =>
  parameterScores(metrics.value ?? {}, context.value.parameterNames),
);

const artifacts = computed(() =>
  props.artifacts.filter((artifact) => artifact.runId === props.run?.run_id),
);

const facts = computed(() => {
  const result: string[] = [];
  const checkpoint = pathName(context.value.checkpoint);
  const dataset = pathName(context.value.dataset ?? props.run?.summary?.data_path);
  const samples = finiteMetric(metrics.value?.n_samples ?? metrics.value?.num_samples);

  if (checkpoint) {
    const label = checkpointLabel(checkpoint);
    result.push(t('results.scorecard.checkpoint', { name: label ? t(label.key, label.params ?? {}) : checkpoint }));
  }

  if (dataset) result.push(t('results.scorecard.dataset', { name: dataset }));

  if (samples !== null && Number.isSafeInteger(samples) && samples >= 0)
    result.push(
      t('results.scorecard.samples', {
        count: new Intl.NumberFormat(locale.value).format(samples),
      }),
    );

  return result;
});

async function copyMetrics() {
  if (!metrics.value) return;
  copyFailed.value = false;

  try {
    await copy(JSON.stringify(metrics.value, null, 2));
  } catch {
    copyFailed.value = true;
  }
}
</script>

<template>
  <section v-if="metrics" class="flex min-w-0 flex-col gap-5" aria-labelledby="evaluation-title">
    <TooltipProvider :delay-duration="280">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 id="evaluation-title" class="text-lg font-semibold">
            {{ t('results.scorecard.title') }}
          </h3>
          <p
            v-if="facts.length"
            class="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]"
          >
            {{ facts.join(' · ') }}
          </p>
        </div>
        <Button v-if="canCopy" type="button" variant="outline" size="sm" @click="copyMetrics"
          ><Check v-if="copied" aria-hidden="true" /><Copy v-else aria-hidden="true" />{{
            copied ? t('results.scorecard.metricsCopied') : t('results.scorecard.copyMetrics')
          }}</Button
        >
        <span class="sr-only" aria-live="polite">{{
          copyFailed
            ? t('results.scorecard.copyFailed')
            : copied
              ? t('results.scorecard.metricsCopied')
              : ''
        }}</span>
      </div>
      <MotionConfig reduced-motion="user">
        <EvaluationMetricCards
          :metrics="metrics"
          :baseline="baseline"
          :comparison-loading="comparisonLoading"
          :animate-entry="animateEntry"
        />
        <motion.div
          :initial="animateEntry ? { opacity: 0, y: 6 } : false"
          :animate="{ opacity: 1, y: 0 }"
          :transition="{ duration: 0.35, delay: animateEntry ? 0.18 : 0 }"
        >
          <EvaluationPlots
            :artifacts="artifacts"
            :images="images"
            :has-parameters="parameters.parameters.length > 0"
            @preview="emit('preview', $event)"
          >
            <EvaluationParameters
              v-if="parameters.parameters.length"
              :key="run?.run_id"
              :parameters="parameters.parameters"
              :metrics="parameters.metrics"
            />
          </EvaluationPlots>
        </motion.div>
      </MotionConfig>
    </TooltipProvider>
  </section>
</template>
