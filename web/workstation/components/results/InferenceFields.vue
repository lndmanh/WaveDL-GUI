<script setup lang="ts">
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { resultsMessages } from '../../i18n/results';
import { useClientMessages } from '../../composables/useClientMessages';
import { Field as VeeField } from 'vee-validate';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel, FieldError, FieldDescription, FieldGroup } from '@/components/ui/field';
const { t, translateKnownMessage } = useWorkstationI18n(resultsMessages);
const { clientMessage } = useClientMessages();
defineProps<{ disabled: boolean }>();
const numbers = [
  { name: 'batch_size', label: 'Inference batch size', min: 1, nullable: false },
  { name: 'workers', label: 'Data loader workers', min: 0, nullable: false },
  { name: 'input_channels', label: 'Input channel override', min: 1, nullable: true },
  { name: 'out_size', label: 'Output size override', min: 1, nullable: true },
  { name: 'export_opset', label: 'ONNX opset (11–17)', min: 11, nullable: false },
];
const texts = [
  { name: 'model', label: 'Optional explicit model identifier' },
  { name: 'input_key', label: 'Input array key override' },
  { name: 'output_key', label: 'Output array key override' },
];
const flags = [
  { name: 'save_predictions', label: 'Publish predictions CSV' },
  { name: 'plot', label: 'Generate plots during evaluation' },
  { name: 'verbose', label: 'Verbose per-sample output' },
  { name: 'no_denorm', label: 'Export normalized ONNX outputs (no de-normalization)' },
];
function numberValue(value: string | number, nullable: boolean): number | null {
  return value === '' ? (nullable ? null : Number.NaN) : Number(value);
}
function listValue(input: string | number): string[] | null {
  const value = String(input).trim();
  return value === '' ? null : value.split(',').map((item) => item.trim());
}
function nullableText(input: string | number): string | null {
  return input === '' ? null : String(input);
}
function formatValue(event: Event): string {
  return event.target instanceof HTMLSelectElement ? event.target.value : '';
}
</script>
<template>
  <FieldGroup>
    <VeeField
      v-for="item in numbers"
      :key="item.name"
      v-slot="{ field, errors }"
      :name="`config.${item.name}`"
      ><Field :data-invalid="!!errors.length"
        ><FieldLabel :for="`inference-${item.name}`">{{
          translateKnownMessage(item.label)
        }}</FieldLabel
        ><Input
          :id="`inference-${item.name}`"
          type="number"
          :min="item.min"
          :model-value="field.value ?? ''"
          :disabled="disabled"
          :aria-invalid="!!errors.length"
          @update:model-value="field.onChange(numberValue($event, item.nullable))" /><FieldError
          v-if="errors.length"
          :errors="errors.map((error) => translateKnownMessage(clientMessage(error)))" /></Field
    ></VeeField>
    <VeeField
      v-for="item in texts"
      :key="item.name"
      v-slot="{ field, errors }"
      :name="`config.${item.name}`"
      ><Field :data-invalid="!!errors.length"
        ><FieldLabel :for="`inference-${item.name}`">{{
          translateKnownMessage(item.label)
        }}</FieldLabel
        ><Input
          :id="`inference-${item.name}`"
          :model-value="field.value ?? ''"
          :disabled="disabled"
          :aria-invalid="!!errors.length"
          @update:model-value="field.onChange(nullableText($event))"
          @blur="field.onBlur" /><FieldError
          v-if="errors.length"
          :errors="errors.map((error) => translateKnownMessage(clientMessage(error)))" /></Field
    ></VeeField>
    <VeeField v-slot="{ field, errors }" name="config.format"
      ><Field :data-invalid="!!errors.length"
        ><FieldLabel for="inference-format">{{ t('datasetFormat') }}</FieldLabel
        ><select
          id="inference-format"
          :value="field.value"
          :disabled="disabled"
          :aria-invalid="!!errors.length"
          @change="field.onChange(formatValue($event))"
        >
          <option v-for="value in ['auto', 'npz', 'mat', 'hdf5']" :key="value" :value="value">
            {{ value === 'auto' ? t('auto') : value }}
          </option></select
        ><FieldError
          v-if="errors.length"
          :errors="errors.map((error) => translateKnownMessage(clientMessage(error)))" /></Field
    ></VeeField>
    <VeeField v-slot="{ field, errors }" name="config.import_modules">
      <Field :data-invalid="!!errors.length" :data-disabled="disabled">
        <FieldLabel for="inference-import-modules">{{ t('importModules') }}</FieldLabel>
        <Input
          id="inference-import-modules"
          :model-value="field.value?.join(', ') ?? ''"
          :disabled="disabled"
          :aria-invalid="!!errors.length"
          @update:model-value="field.onChange(listValue($event) ?? [])"
          @blur="field.onBlur"
        />
        <FieldDescription>{{ t('importModulesHelp') }}</FieldDescription>
        <FieldError
          v-if="errors.length"
          :errors="errors.map((error) => translateKnownMessage(clientMessage(error)))"
        />
      </Field>
    </VeeField>
    <VeeField v-slot="{ field, errors }" name="config.param_names"
      ><Field :data-invalid="!!errors.length"
        ><FieldLabel for="inference-parameters">{{ t('parameters') }}</FieldLabel
        ><Input
          id="inference-parameters"
          :model-value="field.value?.join(', ') ?? ''"
          :disabled="disabled"
          :aria-invalid="!!errors.length"
          @update:model-value="field.onChange(listValue($event))"
          @blur="field.onBlur" /><FieldError
          v-if="errors.length"
          :errors="errors.map((error) => translateKnownMessage(clientMessage(error)))" /></Field
    ></VeeField>
    <VeeField v-slot="{ field, errors }" name="config.plot_format"
      ><Field :data-invalid="!!errors.length"
        ><FieldLabel for="inference-plot-formats">{{ t('formats') }}</FieldLabel
        ><Input
          id="inference-plot-formats"
          :model-value="field.value?.join(', ') ?? ''"
          :disabled="disabled"
          :aria-invalid="!!errors.length"
          @update:model-value="field.onChange(listValue($event))"
          @blur="field.onBlur" /><FieldDescription>{{ t('formatHelp') }}</FieldDescription
        ><FieldError
          v-if="errors.length"
          :errors="errors.map((error) => translateKnownMessage(clientMessage(error)))" /></Field
    ></VeeField>
    <VeeField
      v-for="item in flags"
      :key="item.name"
      v-slot="{ field, errors }"
      :name="`config.${item.name}`"
      ><Field orientation="horizontal" :data-invalid="!!errors.length"
        ><Checkbox
          :id="`inference-${item.name}`"
          :aria-label="translateKnownMessage(item.label)"
          :model-value="field.value"
          :disabled="disabled"
          :aria-invalid="!!errors.length"
          @update:model-value="field.onChange($event === true)" /><FieldLabel
          :for="`inference-${item.name}`"
          >{{ translateKnownMessage(item.label) }}</FieldLabel
        ><FieldError
          v-if="errors.length"
          :errors="errors.map((error) => translateKnownMessage(clientMessage(error)))" /></Field
    ></VeeField>
  </FieldGroup>
</template>
