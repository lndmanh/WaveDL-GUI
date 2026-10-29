<script setup lang="ts">
import { computed, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { Field as VeeField } from 'vee-validate';
import { RotateCcw } from '@lucide/vue';
import { FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useClientMessages } from '../../composables/useClientMessages';
import { trainingChoiceLabel, trainingFieldMessageKeys } from '../../i18n/dynamic-keys';
import { trainingDefaults, trainingFieldMetadata } from '../../../shared/schemas/training-request';
import type { Json } from '../../lib/daemon-api';
import type { TrainingFieldName } from '../../lib/training-layout';
import NumberField from './NumberField.vue';
import SegmentedControl from './SegmentedControl.vue';

const props = defineProps<{ name: TrainingFieldName; disabled: boolean }>();
const { t } = useI18n({ useScope: 'global' });
const { clientMessage } = useClientMessages();
const option = trainingFieldMetadata.find((item) => item.name === props.name);
const keys = trainingFieldMessageKeys[props.name];
const idPrefix = useId();
const controlId = `${idPrefix}-training-${props.name}`;
const descriptionId = `${controlId}-description`;
const label = computed(() => (keys ? t(keys.label) : props.name));
// Many CLI help strings restate the label ("Optimizer for training"); drop those.
const description = computed(() => {
  const text = keys ? t(keys.description) : '';
  const plain = (value: string) =>
    value
      .toLocaleLowerCase()
      .replace(/ (for training|mode)$/, '')
      .trim();
  return plain(text) === plain(label.value) ? '' : text;
});
const defaultValue = trainingDefaults[props.name];
/** Example values shown inside free-text fields; technical, so never translated. */
const examples: Partial<Record<TrainingFieldName, readonly string[]>> = {
  betas: ['0.9', '0.999'],
  milestones: ['30', '60', '90'],
  loss_weights: ['1.0', '2.0', '1.0'],
  constraint: ['y0 > 0', 'y2 - y0 * y1'],
  constraint_weight: ['0.1', '1.0'],
  import_modules: ['my_models', 'lab.custom_layers'],
  resume: ['/data/runs/previous-run'],
  constraint_file: ['/data/constraints.py'],
  project_name: ['DL-Training'],
  run_name: ['resnet18-baseline'],
};
const placeholder = computed(() => {
  const values = examples[props.name];
  return values ? t('builder.example', { value: values.join(option?.multiple ? '\n' : ', ') }) : undefined;
});
const segmented = computed(() => !!option && option.choices.length > 0 && option.choices.length <= 3);
const stepStyle = computed(() =>
  props.name === 'batch_size'
    ? 'double'
    : ['lr', 'min_lr', 'weight_decay'].includes(props.name)
      ? 'decade'
      : 'linear',
);
const minimum = computed(() =>
  option?.kind === 'integer' && !['seed', 'workers'].includes(props.name)
    ? ['patience', 'cv', 'save_every', 'warmup_epochs', 'scheduler_patience'].includes(props.name)
      ? 0
      : 1
    : undefined,
);

function changed(value: Json | undefined): boolean {
  return JSON.stringify(value) !== JSON.stringify(defaultValue);
}
function listText(value: Json | undefined): string {
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
function textValue(value: string | number): string | null {
  return value === '' && defaultValue === null ? null : String(value);
}
function numeric(value: Json | undefined): number | null {
  return typeof value === 'number' ? value : null;
}
function stringValue(value: Json | undefined): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}
function choiceValue(value: unknown, fallback: Json | undefined): string | undefined {
  return typeof value === 'string' && value ? value : typeof fallback === 'string' ? fallback : undefined;
}
</script>
<template>
  <VeeField v-if="option" v-slot="{ field, errors }" :name="`config.${name}`" :keep-value="true">
    <div class="training-row" :data-invalid="errors.length ? true : undefined" :data-field="name">
      <div class="surface-row" :class="option.multiple ? 'flex-wrap' : ''">
        <span
          class="training-row-dot"
          :data-changed="changed(field.value)"
          :aria-label="changed(field.value) ? t('builder.changedFromDefault') : undefined"
          :role="changed(field.value) ? 'img' : undefined"
        />
        <div class="min-w-0 flex-1">
          <label :for="controlId" class="block text-[0.9rem] font-medium leading-tight">
            {{ label }}
          </label>
          <p
            v-if="description"
            :id="descriptionId"
            class="mt-0.5 line-clamp-2 text-xs text-muted-foreground"
          >
            {{ description }}{{ option.multiple ? t('project.enterOneValuePerLine') : '' }}
          </p>
        </div>
        <button
          v-if="changed(field.value)"
          type="button"
          class="training-row-reset"
          :disabled="disabled"
          :aria-label="t('builder.resetSetting', { label })"
          :title="t('builder.resetSetting', { label })"
          @click="field.onChange(defaultValue)"
        >
          <RotateCcw aria-hidden="true" />
        </button>
        <div class="flex shrink-0 items-center" :class="option.multiple ? 'w-full' : ''">
          <Switch
            v-if="option.kind === 'boolean'"
            :id="controlId"
            :data-testid="`training-field-${name}`"
            :model-value="field.value === true"
            :disabled="disabled"
            :aria-invalid="!!errors.length"
            :aria-describedby="descriptionId"
            @update:model-value="field.onChange"
          />
          <SegmentedControl
            v-else-if="segmented && option"
            :id="controlId"
            :model-value="choiceValue(field.value, defaultValue)"
            :options="option.choices.map((choice) => ({ value: choice, label: trainingChoiceLabel(name, choice, t) }))"
            :disabled="disabled"
            :label="label"
            :test-id="`training-field-${name}`"
            @update:model-value="field.onChange"
          />
          <Select
            v-else-if="option.choices.length"
            :model-value="choiceValue(field.value, defaultValue)"
            :name="field.name"
            :disabled="disabled"
            @update:model-value="field.onChange"
          >
            <SelectTrigger
              :id="controlId"
              class="min-w-44"
              :data-testid="`training-field-${name}`"
              :data-value="String(field.value)"
              :aria-invalid="!!errors.length"
              :aria-describedby="descriptionId"
              @blur="field.onBlur"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="choice in option.choices" :key="choice" :value="choice">
                  {{ trainingChoiceLabel(name, choice, t) }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Textarea
            v-else-if="option.multiple"
            :id="controlId"
            class="min-h-20 font-mono text-xs"
            :data-testid="`training-field-${name}`"
            :model-value="listText(field.value)"
            :placeholder="placeholder"
            :disabled="disabled"
            :aria-invalid="!!errors.length"
            :aria-describedby="descriptionId"
            @update:model-value="field.onChange(listValue($event))"
            @blur="field.onBlur"
          />
          <NumberField
            v-else-if="option.kind === 'number' || option.kind === 'integer'"
            :id="controlId"
            :label="label"
            :test-id="`training-field-${name}`"
            :model-value="numeric(field.value)"
            :integer="option.kind === 'integer'"
            :step="stepStyle"
            :min="minimum"
            :disabled="disabled"
            :invalid="!!errors.length"
            :described-by="descriptionId"
            @update:model-value="field.onChange"
            @blur="field.onBlur"
          />
          <Input
            v-else
            :id="controlId"
            class="w-64 max-w-full"
            :data-testid="`training-field-${name}`"
            :model-value="stringValue(field.value)"
            :placeholder="placeholder"
            :disabled="disabled"
            :aria-invalid="!!errors.length"
            :aria-describedby="descriptionId"
            @update:model-value="field.onChange(textValue($event))"
            @blur="field.onBlur"
          />
        </div>
      </div>
      <FieldError
        v-if="errors.length"
        class="px-4 pb-3 pl-8"
        :errors="errors.map(clientMessage)"
      />
    </div>
  </VeeField>
</template>
<style>
.training-row + .training-row {
  border-top: 0.5px solid color-mix(in srgb, var(--foreground) 12%, transparent);
}
.training-row-dot {
  flex: none;
  width: 0.4rem;
  height: 0.4rem;
  margin-left: -0.35rem;
  border-radius: 999px;
  background: transparent;
  transition:
    background-color 200ms ease,
    transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
  transform: scale(0.4);
}
.training-row-dot[data-changed='true'] {
  background: var(--primary);
  transform: scale(1);
}
.training-row-reset {
  display: grid;
  width: 1.75rem;
  height: 1.75rem;
  flex: none;
  place-items: center;
  border-radius: 999px;
  color: var(--muted-foreground);
  animation: reset-in 260ms cubic-bezier(0.22, 1, 0.36, 1);
}
.training-row-reset:hover:not(:disabled) {
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 10%, transparent);
}
.training-row-reset svg {
  width: 0.85rem;
  height: 0.85rem;
}
@keyframes reset-in {
  from {
    opacity: 0;
    transform: rotate(-90deg) scale(0.6);
  }
}
.training-row[data-invalid] .surface-row {
  background: color-mix(in srgb, #bc2836 5%, transparent);
}
</style>
