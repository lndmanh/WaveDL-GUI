<script setup lang="ts">
import { ListFilter } from '@lucide/vue';
import { runKindMessageKeys } from '../../i18n/dynamic-keys';
import {
  activeRunFilterCount,
  createRunFilters,
  RUN_KINDS,
  runFilterCounts,
} from '../../lib/run-overview';
import type { RunView } from '~~/types/daemon-api';
import type { RunCreatedFilter, RunFilterState, RunKind, RunStateGroup } from '~~/types/run-overview';

const props = defineProps<{
  runs: readonly RunView[];
  now: Date;
  showPlanned?: boolean;
  statusAndKindOnly?: boolean;
  allowedKinds?: readonly RunKind[];
  label?: string;
}>();

const filters = defineModel<RunFilterState>({ required: true });
const { t } = useI18n({ useScope: 'global' });
const id = useId();
const open = shallowRef(false);

usePageActive(undefined, () => {
  open.value = false;
});

const activeCount = computed(() => activeRunFilterCount(filters.value));
const counts = computed(() => runFilterCounts(props.runs, props.now));

const kinds = computed(() =>
  (props.allowedKinds ?? RUN_KINDS).map((value) => ({
    value,
    label: t(runKindMessageKeys[value]),
    count: counts.value.kinds[value],
  })),
);

const states = computed(() => {
  const options: { value: RunStateGroup; label: string; count: number }[] = [
    { value: 'live', label: t('runs.filterLive'), count: counts.value.states.live },
    { value: 'completed', label: t('runs.filterDone'), count: counts.value.states.completed },
    { value: 'attention', label: t('runs.filterAttention'), count: counts.value.states.attention },
  ];

  if (props.showPlanned !== false)
    options.push({
      value: 'planned',
      label: t('runs.filterPlanned'),
      count: counts.value.states.planned,
    });

  return options;
});

const models = computed(() =>
  counts.value.models.map((option) => ({ ...option, label: option.value })),
);

const datasets = computed(() =>
  counts.value.datasets.map((option) => ({ ...option, label: option.value })),
);

const createdOptions = computed<{ value: RunCreatedFilter; label: string }[]>(() => [
  { value: 'any', label: t('runs.createdAny') },
  { value: 'today', label: t('runs.createdToday') },
  { value: 'week', label: t('runs.createdWeek') },
  { value: 'month', label: t('runs.createdMonth') },
]);

function toggleValue<Value extends string>(values: readonly Value[], value: Value): Value[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function chooseCreated(value: string) {
  const option = createdOptions.value.find((item) => item.value === value);

  if (option) filters.value = { ...filters.value, created: option.value };
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="h-9 shrink-0"
        :aria-label="label ? `${label}: ${activeCount}` : t('runs.filterActive', { count: activeCount })"
      >
        <ListFilter aria-hidden="true" />
        {{ label ?? t('runs.filter') }}
        <Badge v-if="activeCount" variant="secondary" class="tabular-nums" aria-hidden="true">{{
          activeCount
        }}</Badge>
      </Button>
    </PopoverTrigger>
    <PopoverContent
      align="end"
      side="bottom"
      :collision-padding="16"
      :aria-label="label ?? t('runs.filterRuns')"
      class="flex max-h-[min(80dvh,var(--reka-popover-content-available-height))] w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden p-0"
    >
      <div class="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
        <span class="text-sm font-medium">{{ label ?? t('runs.filterRuns') }}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          :disabled="!activeCount"
          @click="filters = createRunFilters()"
        >
          {{ t('runs.clearAllFilters') }}
        </Button>
      </div>
      <Separator />
      <div class="min-h-0 overflow-y-auto overscroll-contain p-4">
        <FieldGroup class="gap-5">
          <RunFilterGroup
            :label="t('runs.filterKind')"
            :options="kinds"
            :selected="filters.kinds"
            @toggle="filters = { ...filters, kinds: toggleValue(filters.kinds, $event) }"
          />
          <RunFilterGroup
            :label="t('runs.columnState')"
            :options="states"
            :selected="filters.states"
            @toggle="filters = { ...filters, states: toggleValue(filters.states, $event) }"
          />
          <RunFilterGroup
            v-if="!statusAndKindOnly"
            :label="t('runs.columnModel')"
            :options="models"
            :selected="filters.models"
            searchable
            @toggle="filters = { ...filters, models: toggleValue(filters.models, $event) }"
          />
          <RunFilterGroup
            v-if="!statusAndKindOnly"
            :label="t('runs.columnDataset')"
            :options="datasets"
            :selected="filters.datasets"
            searchable
            @toggle="filters = { ...filters, datasets: toggleValue(filters.datasets, $event) }"
          />
          <FieldSet v-if="!statusAndKindOnly">
            <FieldLegend variant="label">{{ t('runs.columnCreated') }}</FieldLegend>
            <RadioGroup
              :model-value="filters.created"
              :aria-label="t('runs.columnCreated')"
              @update:model-value="(value) => chooseCreated(String(value))"
            >
              <Field
                v-for="option in createdOptions"
                :key="option.value"
                orientation="horizontal"
                class="gap-2"
              >
                <RadioGroupItem :id="`${id}-${option.value}`" :value="option.value" />
                <FieldLabel :for="`${id}-${option.value}`" class="min-w-0 flex-1 justify-between">
                  <span>{{ option.label }}</span>
                  <span class="shrink-0 text-xs text-muted-foreground tabular-nums">{{
                    counts.created[option.value]
                  }}</span>
                </FieldLabel>
              </Field>
            </RadioGroup>
          </FieldSet>
        </FieldGroup>
      </div>
    </PopoverContent>
  </Popover>
</template>
