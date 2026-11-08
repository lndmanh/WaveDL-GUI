<script setup lang="ts">
import { ArrowDownWideNarrow, TriangleAlert } from '@lucide/vue';
import type { AcceptableValue } from 'reka-ui';
import { isParameterMetric, parameterRanking } from '../../lib/evaluation-scorecard';
import type { ParameterMetric, ParameterScores } from '../../lib/evaluation-scorecard';

const props = defineProps<{
  parameters: readonly ParameterScores[];
  metrics: readonly ParameterMetric[];
}>();

const { t, locale } = useI18n({ useScope: 'global' });
const selected = shallowRef<ParameterMetric | null>(null);
const weakestFirst = shallowRef(false);

const field = computed(() =>
  selected.value && props.metrics.includes(selected.value)
    ? selected.value
    : (props.metrics[0] ?? 'mae'),
);

const scaleFree = computed(() => field.value === 'r2' || field.value === 'relative_l2');
const rows = computed(() => parameterRanking(props.parameters, field.value, weakestFirst.value));

const numberFormat = computed(
  () => new Intl.NumberFormat(locale.value, { maximumSignificantDigits: 4 }),
);

const labels = {
  r2: 'results.scorecard.r2',
  relative_l2: 'results.scorecard.relativeL2',
  mae: 'results.scorecard.mae',
  rmse: 'results.scorecard.rmse',
};

function selectMetric(value: AcceptableValue | AcceptableValue[]) {
  if (isParameterMetric(value) && props.metrics.includes(value)) selected.value = value;
}
</script>

<template>
  <section
    class="min-w-0 rounded-xl border bg-card p-4"
    :aria-label="t('results.scorecard.parametersTitle')"
  >
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h4 class="text-sm font-semibold">{{ t('results.scorecard.parametersTitle') }}</h4>
      <div class="flex min-w-0 flex-wrap items-center gap-1.5">
        <ToggleGroup
          type="single"
          :model-value="field"
          size="sm"
          class="flex-wrap rounded-lg border bg-muted p-0.5"
          :aria-label="t('results.scorecard.metric')"
          @update:model-value="selectMetric"
        >
          <ToggleGroupItem
            v-for="metric in metrics"
            :key="metric"
            :value="metric"
            class="h-7 px-2 text-xs data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-xs"
            >{{ t(labels[metric]) }}</ToggleGroupItem
          >
        </ToggleGroup>
        <Button
          v-if="scaleFree && rows.length > 1"
          type="button"
          variant="ghost"
          size="icon"
          class="size-8"
          :aria-pressed="weakestFirst"
          :aria-label="t('results.scorecard.sortWeakest')"
          :title="t('results.scorecard.sortWeakest')"
          @click="weakestFirst = !weakestFirst"
        >
          <ArrowDownWideNarrow class="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
    <ul class="flex flex-col gap-3">
      <li
        v-for="row in rows"
        :key="row.index"
        class="flex flex-col gap-1.5"
        :class="!scaleFree ? 'border-b pb-2.5 last:border-b-0' : ''"
      >
        <div class="flex min-w-0 items-center justify-between gap-3 text-sm">
          <span class="flex min-w-0 items-center gap-2">
            <span class="truncate font-mono text-xs" :title="row.name">{{ row.name }}</span>
            <Badge
              v-if="row.weakest"
              variant="outline"
              class="shrink-0 gap-1 border-warning/30 bg-warning/10 text-[color:color-mix(in_oklch,var(--warning)_50%,var(--foreground))]"
              ><TriangleAlert class="size-3" aria-hidden="true" />{{
                t('results.scorecard.weakest')
              }}</Badge
            >
          </span>
          <Tooltip v-if="row.value !== null">
            <TooltipTrigger as-child
              ><span
                tabindex="0"
                class="shrink-0 font-semibold tabular-nums"
                :title="String(row.value)"
                >{{ numberFormat.format(row.value) }}</span
              ></TooltipTrigger
            >
            <TooltipContent>{{ row.value }}</TooltipContent>
          </Tooltip>
          <span v-else class="text-xs text-muted-foreground">{{
            t('results.scorecard.unavailable')
          }}</span>
        </div>
        <span
          v-if="scaleFree"
          class="block h-1.5 overflow-hidden rounded-full bg-muted"
          aria-hidden="true"
        >
          <span
            class="block h-full rounded-r"
            :class="row.weakest ? 'bg-warning' : 'bg-primary'"
            :style="{ width: `${row.fraction * 100}%` }"
          />
        </span>
      </li>
    </ul>
    <p class="mt-3 text-xs text-muted-foreground">
      {{
        field === 'r2'
          ? t('results.scorecard.r2Scale')
          : field === 'relative_l2'
            ? t('results.scorecard.relativeL2Scale')
            : t('results.scorecard.unitsDiffer')
      }}
    </p>
  </section>
</template>
