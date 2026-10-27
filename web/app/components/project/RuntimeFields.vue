<script setup lang="ts">
import { useClientMessages } from '../../composables/useClientMessages';
import { useI18n } from 'vue-i18n';
import { Field as VeeField } from 'vee-validate';
import { useId } from 'vue';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel, FieldError, FieldDescription } from '@/components/ui/field';
import {
  runtimeValueMessageKeys,
  runtimeValues,
  runtimeFieldMessageKeys,
  type RuntimeValue,
} from '../../i18n/dynamic-keys';

const { clientMessage } = useClientMessages();
const { t } = useI18n({ useScope: 'global' });
defineProps<{ disabled: boolean }>();
const idPrefix = useId();
function controlId(name: string): string {
  return `${idPrefix}-runtime-${name.replaceAll('.', '-')}`;
}
function runtimeValueLabel(value: string): string {
  if (!(runtimeValues as readonly string[]).includes(value)) return value;
  const key = runtimeValueMessageKeys[value as RuntimeValue];
  return key ? t(key) : value;
}
const textFields = [
  {
    name: 'runtime.python',
    label: runtimeFieldMessageKeys.pythonInterpreter,
    description: runtimeFieldMessageKeys.interpreterDescription,
  },
];
const choices = [
  { name: 'backend', label: runtimeFieldMessageKeys.backend, values: ['local', 'slurm'] },
  {
    name: 'runtime.mode',
    label: runtimeFieldMessageKeys.mode,
    values: ['existing', 'selected', 'bundled', 'container'],
  },
  {
    name: 'runtime.device',
    label: runtimeFieldMessageKeys.device,
    values: ['cpu', 'mps', 'cuda', 'auto'],
  },
];
const counts = [
  { name: 'topology.num_machines', label: runtimeFieldMessageKeys.machines, min: 1 },
  {
    name: 'topology.processes_per_machine',
    label: runtimeFieldMessageKeys.processesPerMachine,
    min: 1,
  },
  { name: 'topology.machine_rank', label: runtimeFieldMessageKeys.machineRank, min: 0 },
];
</script>
<template>
  <fieldset class="grid gap-5 sm:grid-cols-2">
    <legend class="mb-4 font-medium">{{ t('project.executionEnvironment') }}</legend>
    <VeeField
      v-for="item in textFields"
      :key="item.name"
      v-slot="{ field, errors }"
      :name="item.name"
      ><Field :data-invalid="!!errors.length"
        ><FieldLabel :for="controlId(item.name)">{{ t(item.label) }}</FieldLabel
        ><Input
          :id="controlId(item.name)"
          :name="field.name"
          :model-value="field.value"
          :disabled="disabled"
          :aria-invalid="!!errors.length"
          @update:model-value="field.onChange"
          @blur="field.onBlur"
          :aria-describedby="`${controlId(item.name)}-description`" /><FieldDescription
          :id="`${controlId(item.name)}-description`"
          >{{ t(item.description) }}</FieldDescription
        ><FieldError v-if="errors.length" :errors="errors.map(clientMessage)" /></Field
    ></VeeField>
    <VeeField v-for="item in choices" :key="item.name" v-slot="{ field, errors }" :name="item.name"
      ><Field :data-invalid="!!errors.length"
        ><FieldLabel :for="controlId(item.name)">{{ t(item.label) }}</FieldLabel
        ><select
          :id="controlId(item.name)"
          v-bind="field"
          :disabled="disabled"
          :aria-invalid="!!errors.length"
          class="runtime-select"
        >
          <option v-for="value in item.values" :key="value" :value="value">
            {{ runtimeValueLabel(value) }}
          </option></select
        ><FieldError v-if="errors.length" :errors="errors.map(clientMessage)" /></Field
    ></VeeField>
    <VeeField v-for="item in counts" :key="item.name" v-slot="{ field, errors }" :name="item.name"
      ><Field :data-invalid="!!errors.length"
        ><FieldLabel :for="controlId(item.name)">{{ t(item.label) }}</FieldLabel
        ><Input
          :id="controlId(item.name)"
          type="number"
          step="1"
          :min="item.min"
          :model-value="field.value"
          :disabled="disabled"
          :aria-invalid="!!errors.length"
          @update:model-value="field.onChange($event === '' ? Number.NaN : Number($event))"
          @blur="field.onBlur" /><FieldError
          v-if="errors.length"
          :errors="errors.map(clientMessage)" /></Field
    ></VeeField>
    <p class="sm:col-span-2 text-sm text-muted-foreground">
      {{ t('project.runtimeHelp') }}
    </p>
  </fieldset>
</template>
