<script setup lang="ts" generic="Value extends string">
import type { RunFilterOption } from '~~/types/run-overview';

const props = defineProps<{
  label: string;
  options: readonly (RunFilterOption<Value> & { label: string })[];
  selected: readonly Value[];
  searchable?: boolean;
}>();

const emit = defineEmits<{ toggle: [value: Value] }>();
const { t } = useI18n({ useScope: 'global' });
const id = useId();
const query = shallowRef('');

const options = computed(() => {
  // Keep selections removable if a refresh or page change removes their last run.
  const missing = props.selected.flatMap((value) =>
    props.options.some((option) => option.value === value)
      ? []
      : [{ value, label: value, count: 0 }],
  );

  const needle = query.value.trim().toLocaleLowerCase();

  return [...props.options, ...missing].flatMap((option, index) =>
    !props.searchable || option.label.toLocaleLowerCase().includes(needle)
      ? [{ ...option, id: `${id}-${index}` }]
      : [],
  );
});
</script>

<template>
  <FieldSet class="min-w-0 gap-2">
    <FieldLegend variant="label">{{ label }}</FieldLegend>
    <Input
      v-if="searchable"
      v-model="query"
      type="search"
      :aria-label="t('runs.searchFilterValues', { group: label })"
      :placeholder="t('runs.searchFilterValues', { group: label })"
    />
    <div
      data-slot="checkbox-group"
      class="flex max-h-44 flex-col gap-1 overflow-y-auto overscroll-contain"
    >
      <Field
        v-for="option in options"
        :key="option.value"
        orientation="horizontal"
        :data-disabled="option.count === 0 && !selected.includes(option.value)"
        class="min-w-0 gap-2 py-1"
      >
        <Checkbox
          :id="option.id"
          :model-value="selected.includes(option.value)"
          :disabled="option.count === 0 && !selected.includes(option.value)"
          @update:model-value="emit('toggle', option.value)"
        />
        <FieldLabel :for="option.id" class="min-w-0 flex-1 justify-between">
          <span class="truncate" :title="option.label">{{ option.label }}</span>
          <span class="shrink-0 text-xs text-muted-foreground tabular-nums">{{
            option.count
          }}</span>
        </FieldLabel>
      </Field>
      <p v-if="!options.length" class="py-1 text-sm text-muted-foreground">
        {{ query.trim() ? t('runs.noFilterValuesMatch') : t('runs.noFilterValues') }}
      </p>
    </div>
  </FieldSet>
</template>
