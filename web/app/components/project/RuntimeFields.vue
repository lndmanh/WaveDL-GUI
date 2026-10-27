<script setup lang="ts">
import { useClientMessages } from '../../composables/useClientMessages';
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { projectMessages } from '../../i18n/project';
import { Field as VeeField } from 'vee-validate';
import { useId } from 'vue';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel, FieldError, FieldDescription } from '@/components/ui/field';

const { clientMessage } = useClientMessages();
const { translateKnownMessage } = useWorkstationI18n(projectMessages);
defineProps<{ disabled: boolean }>();
const idPrefix = useId();
function controlId(name: string): string {
  return `${idPrefix}-runtime-${name.replaceAll('.', '-')}`;
}
const textFields = [
  {
    name: 'runtime.python',
    label: 'Python interpreter',
    description:
      'Absolute interpreter path selected for the execution host. Explicit storage mappings rewrite host-side paths once; browser Python and browser file paths are not used.',
  },
];
const choices = [
  { name: 'backend', label: 'Configured backend', values: ['local', 'slurm'] },
  {
    name: 'runtime.mode',
    label: 'Runtime mode',
    values: ['existing', 'selected', 'bundled', 'container'],
  },
  { name: 'runtime.device', label: 'Device', values: ['cpu', 'mps', 'cuda', 'auto'] },
];
const counts = [
  { name: 'topology.num_machines', label: 'Machines', min: 1 },
  { name: 'topology.processes_per_machine', label: 'Processes per machine', min: 1 },
  { name: 'topology.machine_rank', label: 'Machine rank', min: 0 },
];
</script>
<template>
  <fieldset class="grid gap-5 sm:grid-cols-2">
    <legend class="mb-4 font-medium">{{ translateKnownMessage('Execution environment') }}</legend>
    <VeeField
      v-for="item in textFields"
      :key="item.name"
      v-slot="{ field, errors }"
      :name="item.name"
      ><Field :data-invalid="!!errors.length"
        ><FieldLabel :for="controlId(item.name)">{{ translateKnownMessage(item.label) }}</FieldLabel
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
          >{{ translateKnownMessage(item.description) }}</FieldDescription
        ><FieldError v-if="errors.length" :errors="errors.map(clientMessage)" /></Field
    ></VeeField>
    <VeeField v-for="item in choices" :key="item.name" v-slot="{ field, errors }" :name="item.name"
      ><Field :data-invalid="!!errors.length"
        ><FieldLabel :for="controlId(item.name)">{{ translateKnownMessage(item.label) }}</FieldLabel
        ><select
          :id="controlId(item.name)"
          v-bind="field"
          :disabled="disabled"
          :aria-invalid="!!errors.length"
          class="runtime-select"
        >
          <option v-for="value in item.values" :key="value" :value="value">
            {{ translateKnownMessage(value) }}
          </option></select
        ><FieldError v-if="errors.length" :errors="errors.map(clientMessage)" /></Field
    ></VeeField>
    <VeeField v-for="item in counts" :key="item.name" v-slot="{ field, errors }" :name="item.name"
      ><Field :data-invalid="!!errors.length"
        ><FieldLabel :for="controlId(item.name)">{{ translateKnownMessage(item.label) }}</FieldLabel
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
      {{
        translateKnownMessage(
          'Device, precision and topology are validated during daemon planning. Bundled/container modes and explicit MPS training are not implemented by current backends; planning refuses them. Slurm account, partition, resources, environment setup and storage mappings remain configured operator policy, not invented browser defaults.',
        )
      }}
    </p>
  </fieldset>
</template>
