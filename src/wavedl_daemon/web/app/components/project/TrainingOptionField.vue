<script setup lang="ts">
import { trainingChoiceLabel, trainingFieldMessageKeys } from '../../i18n/dynamic-keys';
import { Field as VeeField } from 'vee-validate';
import { trainingFieldMetadata } from '../../../shared/schemas/training-request';
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

const option = trainingFieldMetadata.find((item) => item.name === props.name);
const messageKeys = trainingFieldMessageKeys[props.name];
const idPrefix = useId();
const controlId = computed(() => `${idPrefix}-training-${props.name}`);
const label = computed(() => (messageKeys ? t(messageKeys.label) : props.name));
const description = computed(() => (messageKeys ? t(messageKeys.description) : props.name));

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
  <VeeField v-if="option" v-slot="{ field, errors }" :name="`config.${name}`" :keep-value="true">
    <Field
      :data-invalid="!!errors.length"
      :class="
        settingsControls
          ? '[&_input]:min-h-11 [&_textarea]:min-h-20 [&_button[role=combobox]]:min-h-11 [&_button[role=combobox]]:w-full'
          : ''
      "
    >
      <div
        v-if="option.kind !== 'boolean'"
        class="flex flex-wrap items-center justify-between gap-2"
      >
        <FieldLabel :for="controlId">{{ label }}</FieldLabel>
        <InfoChip
          v-if="description.length > 80"
          :label="t('project.fieldHelp')"
          :text="description"
        />
      </div>
      <Field v-if="option.kind === 'boolean'" orientation="horizontal" class="max-w-full">
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
        v-else-if="option.choices.length"
        :model-value="String(field.value)"
        :name="field.name"
        :disabled="disabled"
        @update:model-value="updateValue(String($event ?? ''), field.onChange, true)"
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
        v-else-if="option.multiple"
        :id="controlId"
        :data-testid="`training-field-${name}`"
        :model-value="listText(field.value)"
        :disabled="disabled"
        :aria-invalid="!!errors.length"
        @update:model-value="updateValue(listValue($event), field.onChange)"
        @blur="field.onBlur"
      />
      <Input
        v-else-if="option.kind === 'number' || option.kind === 'integer'"
        :id="controlId"
        :data-testid="`training-field-${name}`"
        type="number"
        :step="option.kind === 'integer' ? 1 : 'any'"
        :model-value="field.value"
        :disabled="disabled"
        :aria-invalid="!!errors.length"
        @update:model-value="
          updateValue($event === '' ? Number.NaN : Number($event), field.onChange)
        "
        @blur="field.onBlur"
      />
      <Input
        v-else
        :id="controlId"
        :data-testid="`training-field-${name}`"
        :model-value="field.value ?? ''"
        :disabled="disabled"
        :aria-invalid="!!errors.length"
        @update:model-value="updateValue(stringValue($event), field.onChange)"
        @blur="field.onBlur"
      />
      <InfoChip
        v-if="option.kind === 'boolean' && description.length > 80"
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
