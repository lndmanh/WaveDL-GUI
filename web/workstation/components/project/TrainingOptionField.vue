<script setup lang="ts">
import { useClientMessages } from '../../composables/useClientMessages';
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { projectMessages } from '../../i18n/project';
import { trainingFieldMessages, trainingFieldMessageKeys } from '../../i18n/training-fields';
import { Field as VeeField } from 'vee-validate';
import { computed, useId } from 'vue';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel, FieldDescription, FieldError } from '@/components/ui/field';
import type { Json } from '../../lib/daemon-api';
import { trainingFieldMetadata } from '../../../shared/schemas/training-request';

const { clientMessage } = useClientMessages();
const { translateKnownMessage } = useWorkstationI18n(projectMessages);
const { t: fieldMessage } = useWorkstationI18n(trainingFieldMessages);
const props = defineProps<{ name: string; disabled: boolean }>();
const option = trainingFieldMetadata.find((item) => item.name === props.name);
const messageKeys = Object.entries(trainingFieldMessageKeys).find(
  ([name]) => name === props.name,
)?.[1];
const idPrefix = useId();
const controlId = computed(() => `${idPrefix}-training-${props.name}`);
const label = computed(() => (messageKeys ? fieldMessage(messageKeys.label) : props.name));
function listText(value: Json): string {
  return Array.isArray(value) ? value.join('\n') : '';
}
function listValue(value: string | number): (string | number)[] {
  if (!option || String(value).trim() === '') return [];
  return String(value)
    .split('\n')
    .map((item) =>
      option.kind === 'number' ? (item.trim() === '' ? Number.NaN : Number(item)) : item,
    );
}
function stringValue(value: string | number): string | null {
  return value === '' && option?.default === null ? null : String(value);
}
</script>
<template>
  <VeeField v-if="option" v-slot="{ field, errors }" :name="`config.${name}`">
    <Field :data-invalid="!!errors.length">
      <FieldLabel :for="controlId">{{ label }}</FieldLabel>
      <Checkbox
        v-if="option.kind === 'boolean'"
        :id="controlId"
        :aria-label="label"
        :model-value="field.value"
        :disabled="disabled"
        :aria-invalid="!!errors.length"
        @update:model-value="field.onChange"
        @blur="field.onBlur"
      />
      <select
        v-else-if="option.choices.length"
        :id="controlId"
        v-bind="field"
        :disabled="disabled"
        :aria-invalid="!!errors.length"
        class="option-select"
      >
        <option v-for="choice in option.choices" :key="choice" :value="choice">{{ choice }}</option>
      </select>
      <Textarea
        v-else-if="option.multiple"
        :id="controlId"
        :model-value="listText(field.value)"
        :disabled="disabled"
        :aria-invalid="!!errors.length"
        @update:model-value="field.onChange(listValue($event))"
        @blur="field.onBlur"
      />
      <Input
        v-else-if="option.kind === 'number' || option.kind === 'integer'"
        :id="controlId"
        type="number"
        :step="option.kind === 'integer' ? 1 : 'any'"
        :model-value="field.value"
        :disabled="disabled"
        :aria-invalid="!!errors.length"
        @update:model-value="field.onChange($event === '' ? Number.NaN : Number($event))"
        @blur="field.onBlur"
      />
      <Input
        v-else
        :id="controlId"
        :model-value="field.value ?? ''"
        :disabled="disabled"
        :aria-invalid="!!errors.length"
        @update:model-value="field.onChange(stringValue($event))"
        @blur="field.onBlur"
      />
      <FieldDescription
        >{{ messageKeys ? fieldMessage(messageKeys.description) : name
        }}{{
          option.multiple ? translateKnownMessage(' Enter one value per line.') : ''
        }}</FieldDescription
      >
      <FieldError v-if="errors.length" :errors="errors.map(clientMessage)" />
    </Field>
  </VeeField>
</template>
<style scoped>
.option-select {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px;
  background: var(--background);
  width: 100%;
}
</style>
