<script setup lang="ts">
import { trainingChoiceLabel } from '../../i18n/dynamic-keys';
import {
  fieldListText,
  fieldText,
  inputChoiceValue,
  inputNumberValue,
  trainingFieldAdapter,
} from '../../lib/field-adaptation';
import { Field as VeeField } from 'vee-validate';
import { jsonStringSchema } from '../../../shared/schemas/json';
import type { Json } from '~~/types/json';

const { clientMessage } = useClientMessages();
const { t } = useI18n({ useScope: 'global' });
const props = defineProps<{ name: string; disabled: boolean; settingsControls?: boolean }>();
const emit = defineEmits<{ changed: [immediate: boolean] }>();

function updateValue(value: Json, change: (value: Json) => void, immediate = false): void {
  change(value);
  emit('changed', immediate);
}

const { option, kind, messages, listValue, textValue } = trainingFieldAdapter(props.name);
const translated = computed(() => messages(t));
const idPrefix = useId();
const controlId = computed(() => `${idPrefix}-training-${props.name}`);
const label = computed(() => translated.value.label);
const description = computed(() => translated.value.description);

const defaultText = computed(() => {
  if (
    !option ||
    option.default === null ||
    (Array.isArray(option.default) && !option.default.length)
  )
    return t('project.none');

  if (props.settingsControls && (option.default === true || option.default === false))
    return t(option.default ? 'builder.on' : 'builder.off');

  const string = jsonStringSchema.safeParse(option.default);

  if (props.settingsControls && string.success && option.choices.length)
    return trainingChoiceLabel(props.name, string.data, t);

  return Array.isArray(option.default) ? option.default.join(', ') : String(option.default);
});
</script>
<template>
  <VeeField v-if="option" v-slot="{ field, errors }" :name="`config.${name}`" :keep-value="true">
    <Field
      :data-invalid="!!errors.length"
      :class="
        settingsControls
          ? '[&_input]:min-h-11 [&_textarea]:min-h-20 [&_button[role=combobox]]:min-h-11 [&_button[role=combobox]]:w-full'
          : ''
      "
    >
      <div v-if="kind !== 'boolean'" class="flex flex-wrap items-center justify-between gap-2">
        <FieldLabel :for="controlId">{{ label }}</FieldLabel>
        <InfoChip
          v-if="description.length > 80"
          :label="t('project.fieldHelp')"
          :text="description"
        />
      </div>
      <Field v-if="kind === 'boolean'" orientation="horizontal" class="max-w-full">
        <Checkbox
          :id="controlId"
          :aria-label="label"
          :data-testid="`training-field-${name}`"
          :model-value="field.value"
          :disabled="disabled"
          :aria-invalid="!!errors.length"
          @update:model-value="updateValue($event ?? false, field.onChange, true)"
          @blur="field.onBlur"
        />
        <FieldLabel
          :for="controlId"
          :class="settingsControls ? 'min-h-11 flex-1 items-center' : ''"
          >{{ label }}</FieldLabel
        >
      </Field>
      <Select
        v-else-if="kind === 'choice'"
        :model-value="fieldText(field.value, 'stringify')"
        :name="field.name"
        :disabled="disabled"
        @update:model-value="updateValue(inputChoiceValue($event), field.onChange, true)"
      >
        <SelectTrigger
          :id="controlId"
          :data-value="String(field.value)"
          :aria-invalid="!!errors.length"
          @blur="field.onBlur"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem v-for="choice in option.choices" :key="choice" :value="choice">
              {{ settingsControls ? trainingChoiceLabel(name, choice, t) : choice }}
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <Textarea
        v-else-if="kind === 'list'"
        :id="controlId"
        :data-testid="`training-field-${name}`"
        :model-value="fieldListText(field.value)"
        :disabled="disabled"
        :aria-invalid="!!errors.length"
        @update:model-value="updateValue(listValue($event), field.onChange)"
        @blur="field.onBlur"
      />
      <Input
        v-else-if="kind === 'number'"
        :id="controlId"
        :data-testid="`training-field-${name}`"
        type="number"
        :step="option.kind === 'integer' ? 1 : 'any'"
        :model-value="field.value"
        :disabled="disabled"
        :aria-invalid="!!errors.length"
        @update:model-value="updateValue(inputNumberValue($event), field.onChange)"
        @blur="field.onBlur"
      />
      <Input
        v-else
        :id="controlId"
        :data-testid="`training-field-${name}`"
        :model-value="field.value ?? ''"
        :disabled="disabled"
        :aria-invalid="!!errors.length"
        @update:model-value="updateValue(textValue($event), field.onChange)"
        @blur="field.onBlur"
      />
      <InfoChip
        v-if="kind === 'boolean' && description.length > 80"
        :label="t('project.fieldHelp')"
        :text="description"
      />
      <FieldDescription v-if="description.length <= 80">
        {{ description }}{{ option.multiple ? t('project.enterOneValuePerLine') : '' }}
      </FieldDescription>
      <div
        v-if="settingsControls && JSON.stringify(field.value) !== JSON.stringify(option.default)"
        class="flex flex-wrap items-center justify-between gap-2"
      >
        <Badge variant="secondary">{{ t('shell.settingsModified') }}</Badge>
        <Button
          type="button"
          variant="ghost"
          class="min-h-11 text-xs"
          :disabled="disabled"
          :aria-label="t('builder.resetSetting', { label })"
          @click="updateValue(option.default, field.onChange, true)"
        >
          {{ t('shell.settingsResetField') }}
        </Button>
      </div>
      <div class="flex flex-wrap gap-2">
        <Badge variant="outline">{{ t('project.defaultValue', { value: defaultText }) }}</Badge>
        <Badge v-if="option.multiple" variant="secondary">
          {{ t('project.oneValuePerLine') }}
        </Badge>
      </div>
      <FieldError v-if="errors.length" :errors="errors.map(clientMessage)" />
    </Field>
  </VeeField>
</template>
