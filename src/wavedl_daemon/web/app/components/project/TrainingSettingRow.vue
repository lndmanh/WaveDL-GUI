<script setup lang="ts">
import { cn } from '@/lib/utils';
import { Field as VeeField } from 'vee-validate';
import { RotateCcw } from '@lucide/vue';
import { trainingChoiceLabel } from '../../i18n/dynamic-keys';
import { trainingDefaults } from '../../../shared/schemas/training-request';
import {
  fieldListText,
  fieldText,
  nullableNumberValue,
  trainingFieldAdapter,
} from '../../lib/field-adaptation';
import type { Json } from '~~/types/json';
import type { TrainingFieldName } from '~~/types/training-layout';

const props = defineProps<{ name: TrainingFieldName; disabled: boolean }>();
const { t } = useI18n({ useScope: 'global' });
const { clientMessage } = useClientMessages();
const defaultValue = trainingDefaults[props.name];
const { option, kind, messages, listValue, textValue, choiceValue } = trainingFieldAdapter(
  props.name,
  defaultValue,
);
const translated = computed(() => messages(t, ''));
const idPrefix = useId();
const controlId = `${idPrefix}-training-${props.name}`;
const descriptionId = `${controlId}-description`;
const label = computed(() => translated.value.label);

// Many CLI help strings restate the label ("Optimizer for training"); drop those.
const description = computed(() => {
  const text = translated.value.description;

  const plain = (value: string) =>
    value
      .toLocaleLowerCase()
      .replace(/ (for training|mode)$/, '')
      .trim();

  return plain(text) === plain(label.value) ? '' : text;
});

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

  return values
    ? t('builder.example', { value: values.join(option?.multiple ? '\n' : ', ') })
    : undefined;
});

const segmented = computed(
  () => !!option && option.choices.length > 0 && option.choices.length <= 3,
);

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

const projectStyles = {
  trainingRow: cn(
    '[&_+_.training-row]:[border-top:0.5px_solid_color-mix(in_srgb,_var(--foreground)_12%,_transparent)]',
    '[&[data-invalid]_.surface-row]:[background:color-mix(in_srgb,_#bc2836_5%,_transparent)]',
  ),
  trainingRowDot: cn(
    'flex-none size-[0.4rem] ml-[-0.35rem] rounded-full bg-transparent',
    '[transition:background-color_200ms_ease,_transform_300ms_cubic-bezier(0.34,_1.56,_0.64,_1)] [transform:scale(0.4)]',
    "[&[data-changed='true']]:bg-primary [&[data-changed='true']]:[transform:scale(1)]",
  ),
  trainingRowReset: cn(
    'grid size-7 flex-none place-items-center rounded-full text-muted-foreground',
    '[animation:reset-in_260ms_cubic-bezier(0.22,_1,_0.36,_1)] [&:hover:not(:disabled)]:text-primary',
    '[&:hover:not(:disabled)]:[background:color-mix(in_srgb,_var(--primary)_10%,_transparent)] [&_svg]:size-[0.85rem]',
  ),
};
</script>
<template>
  <VeeField v-if="option" v-slot="{ field, errors }" :name="`config.${name}`" :keep-value="true">
    <div
      :class="cn('training-row', projectStyles.trainingRow)"
      :data-invalid="errors.length ? true : undefined"
      :data-field="name"
    >
      <div class="surface-row" :class="option.multiple ? 'flex-wrap' : ''">
        <span
          :class="projectStyles.trainingRowDot"
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
          :class="projectStyles.trainingRowReset"
          :disabled="disabled"
          :aria-label="t('builder.resetSetting', { label })"
          :title="t('builder.resetSetting', { label })"
          @click="field.onChange(defaultValue)"
        >
          <RotateCcw aria-hidden="true" />
        </button>
        <div class="flex shrink-0 items-center" :class="option.multiple ? 'w-full' : ''">
          <Switch
            v-if="kind === 'boolean'"
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
            :model-value="choiceValue(field.value)"
            :options="
              option.choices.map((choice) => ({
                value: choice,
                label: trainingChoiceLabel(name, choice, t),
              }))
            "
            :disabled="disabled"
            :label="label"
            :test-id="`training-field-${name}`"
            @update:model-value="field.onChange"
          />
          <Select
            v-else-if="kind === 'choice'"
            :model-value="choiceValue(field.value)"
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
            v-else-if="kind === 'list'"
            :id="controlId"
            class="min-h-20 font-mono text-xs"
            :data-testid="`training-field-${name}`"
            :model-value="fieldListText(field.value)"
            :placeholder="placeholder"
            :disabled="disabled"
            :aria-invalid="!!errors.length"
            :aria-describedby="descriptionId"
            @update:model-value="field.onChange(listValue($event))"
            @blur="field.onBlur"
          />
          <NumberField
            v-else-if="kind === 'number'"
            :id="controlId"
            :label="label"
            :test-id="`training-field-${name}`"
            :model-value="nullableNumberValue(field.value)"
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
            :model-value="fieldText(field.value)"
            :placeholder="placeholder"
            :disabled="disabled"
            :aria-invalid="!!errors.length"
            :aria-describedby="descriptionId"
            @update:model-value="field.onChange(textValue($event))"
            @blur="field.onBlur"
          />
        </div>
      </div>
      <FieldError v-if="errors.length" class="px-4 pb-3 pl-8" :errors="errors.map(clientMessage)" />
    </div>
  </VeeField>
</template>
