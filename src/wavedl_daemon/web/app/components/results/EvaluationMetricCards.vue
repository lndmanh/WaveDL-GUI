<script setup lang="ts">
import { ArrowDownRight, ArrowUpRight, Minus } from '@lucide/vue';
import { motion } from 'motion-v';
import {
  baselineValue,
  comparisonDelta,
  finiteMetric,
  scorecardMetrics,
} from '../../lib/evaluation-scorecard';
import type { EvaluationMetric, TrainingBaseline } from '../../lib/evaluation-scorecard';
import type { JsonObject } from '~~/types/json';

const props = defineProps<{
  metrics: JsonObject;
  baseline: TrainingBaseline | null;
  comparisonLoading: boolean;
  animateEntry: boolean;
}>();

const { t, locale } = useI18n({ useScope: 'global' });

const numberFormat = computed(
  () => new Intl.NumberFormat(locale.value, { maximumSignificantDigits: 4 }),
);

const deltaFormat = computed(
  () => new Intl.NumberFormat(locale.value, { maximumSignificantDigits: 4, signDisplay: 'always' }),
);

const labels = {
  r2_score: 'results.scorecard.r2',
  pearson_corr: 'results.scorecard.pearson',
  rmse: 'results.scorecard.rmse',
  mae_avg: 'results.scorecard.mae',
  relative_l2: 'results.scorecard.relativeL2',
};

const circumference = 2 * Math.PI * 22;

const cards = computed(() =>
  scorecardMetrics(props.metrics).map((field) => {
    const value = finiteMetric(props.metrics[field]);
    const higherBetter = field === 'r2_score' || field === 'pearson_corr';
    const validation = props.baseline ? baselineValue(props.baseline, field) : null;
    const delta = comparisonDelta(value, validation, higherBetter);

    return {
      field,
      label: t(labels[field]),
      value,
      formatted:
        value === null ? t('results.scorecard.unavailable') : numberFormat.value.format(value),
      hint:
        value === null && (field === 'r2_score' || field === 'pearson_corr')
          ? t('results.scorecard.minSamples', { count: field === 'r2_score' ? 2 : 3 })
          : t(higherBetter ? 'results.scorecard.higherBetter' : 'results.scorecard.lowerBetter'),
      validation,
      delta,
      deltaLabel: delta ? deltaFormat.value.format(delta.value) : null,
      offset: circumference * (1 - Math.max(0, Math.min(1, value ?? 0))),
    };
  }),
);

function tracked(field: EvaluationMetric) {
  return field !== 'rmse' && field !== 'relative_l2';
}
</script>

<template>
  <div
    class="grid grid-cols-2 gap-3"
    :class="cards.length === 5 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'"
  >
    <motion.div
      v-for="(card, index) in cards"
      :key="card.field"
      :initial="animateEntry ? { opacity: 0, y: 6 } : false"
      :animate="{ opacity: 1, y: 0 }"
      :transition="{ duration: 0.35, delay: animateEntry ? index * 0.05 : 0 }"
      class="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4"
    >
      <h4 class="text-sm text-muted-foreground">{{ card.label }}</h4>
      <div class="flex flex-wrap items-center gap-3">
        <svg
          v-if="card.field === 'r2_score'"
          viewBox="0 0 56 56"
          class="size-14 shrink-0 -rotate-90"
          aria-hidden="true"
        >
          <circle cx="28" cy="28" r="22" fill="none" class="stroke-muted" stroke-width="6" />
          <motion.circle
            v-if="card.value !== null"
            cx="28"
            cy="28"
            r="22"
            fill="none"
            class="stroke-primary"
            stroke-width="6"
            stroke-linecap="round"
            :stroke-dasharray="circumference"
            :initial="animateEntry ? { strokeDashoffset: circumference } : false"
            :animate="{ strokeDashoffset: card.offset }"
            :transition="{ duration: animateEntry ? 0.8 : 0 }"
          />
        </svg>
        <div class="min-w-0">
          <Tooltip v-if="card.value !== null">
            <TooltipTrigger as-child>
              <span
                tabindex="0"
                class="rounded-sm break-all text-[1.7rem] leading-none font-semibold tracking-tight tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :title="String(card.value)"
                >{{ card.formatted }}</span
              >
            </TooltipTrigger>
            <TooltipContent>{{ card.value }}</TooltipContent>
          </Tooltip>
          <span v-else class="text-sm text-muted-foreground">{{ card.formatted }}</span>
          <p class="mt-1.5 text-xs text-muted-foreground">{{ card.hint }}</p>
        </div>
      </div>
      <div
        v-if="comparisonLoading || baseline"
        class="mt-auto flex min-h-10 flex-wrap items-center justify-between gap-1 border-t pt-2.5 text-xs"
      >
        <Skeleton v-if="comparisonLoading" class="h-3 w-full" />
        <template v-else-if="baseline && tracked(card.field)">
          <span class="text-muted-foreground">
            {{ t('results.scorecard.validationAtEpoch', { epoch: baseline.epoch }) }}
            <span
              class="tabular-nums"
              :title="card.validation === null ? undefined : String(card.validation)"
              >{{
                card.validation === null
                  ? t('results.scorecard.unavailable')
                  : numberFormat.format(card.validation)
              }}</span
            >
          </span>
          <span
            v-if="card.delta"
            class="inline-flex items-center gap-0.5 font-semibold tabular-nums"
            :class="
              card.delta.tone === 'better'
                ? 'text-success'
                : card.delta.tone === 'worse'
                  ? 'text-[color:color-mix(in_oklch,var(--warning)_50%,var(--foreground))]'
                  : 'text-muted-foreground'
            "
            :title="String(card.delta.value)"
          >
            <ArrowUpRight v-if="card.delta.value > 0" class="size-3" aria-hidden="true" />
            <ArrowDownRight v-else-if="card.delta.value < 0" class="size-3" aria-hidden="true" />
            <Minus v-else class="size-3" aria-hidden="true" />
            {{ card.deltaLabel }}
            <span class="sr-only">{{
              card.delta.tone === 'better'
                ? t('results.scorecard.better')
                : card.delta.tone === 'worse'
                  ? t('results.scorecard.worse')
                  : t('results.scorecard.unchanged')
            }}</span>
          </span>
        </template>
        <span v-else class="text-muted-foreground">{{ t('results.scorecard.notTracked') }}</span>
      </div>
    </motion.div>
  </div>
</template>
