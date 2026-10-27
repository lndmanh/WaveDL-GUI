<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useClientMessages } from '../../composables/useClientMessages';
import { onMounted, onUnmounted, shallowRef } from 'vue';
import { Field as VeeField, useForm } from 'vee-validate';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldGroup, FieldLabel, FieldError, FieldDescription } from '@/components/ui/field';
import {
  appearanceSchema,
  loadAppearance,
  saveAppearance,
  applyAppearance,
  type AppearancePreferences,
} from '../../lib/preferences';
import { appearanceControlMessageKeys } from '../../i18n/dynamic-keys';

const props = defineProps<{ appearance?: AppearancePreferences }>();
const emit = defineEmits<{ changed: [value: AppearancePreferences] }>();
const { clientMessage } = useClientMessages();
const message = shallowRef('');
const { handleSubmit, resetForm } = useForm({
  validationSchema: appearanceSchema,
  initialValues: props.appearance ?? loadAppearance(),
});
let media: MediaQueryList | null = null;
let applied = props.appearance ?? loadAppearance();
function applySystem() {
  applyAppearance(applied, document.documentElement, media?.matches ?? false);
}
function controlChange(name: string, event: Event, change: (value: string | number) => void) {
  if (!(event.target instanceof HTMLSelectElement)) return;
  change(name === 'zoom' ? Number(event.target.value) : event.target.value);
}
onMounted(() => {
  media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', applySystem);
});
onUnmounted(() => media?.removeEventListener('change', applySystem));
const submit = handleSubmit((value) => {
  const parsed = appearanceSchema.parse(value);
  applied = parsed;
  const saved = saveAppearance(parsed);
  applyAppearance(parsed, document.documentElement, media?.matches ?? false);
  emit('changed', parsed);
  message.value = saved ? 'shell.browserPreferencesSaved' : 'shell.appearanceSessionOnly';
});
function reload() {
  resetForm({ values: applied });
  message.value = '';
}
const controls = [
  {
    name: 'theme',
    label: appearanceControlMessageKeys.appearance,
    options: [
      { value: 'system', label: appearanceControlMessageKeys.system },
      { value: 'light', label: appearanceControlMessageKeys.light },
      { value: 'dark', label: appearanceControlMessageKeys.dark },
    ],
  },
  {
    name: 'accent',
    label: appearanceControlMessageKeys.accent,
    options: [
      { value: 'neutral', label: appearanceControlMessageKeys.neutral },
      { value: 'blue', label: appearanceControlMessageKeys.blue },
      { value: 'violet', label: appearanceControlMessageKeys.violet },
      { value: 'green', label: appearanceControlMessageKeys.green },
    ],
  },
  {
    name: 'zoom',
    label: appearanceControlMessageKeys.interfaceScale,
    options: [
      { value: 90, label: '90%' },
      { value: 100, label: '100%' },
      { value: 110, label: '110%' },
      { value: 125, label: '125%' },
    ],
  },
];
const { t } = useI18n({ useScope: 'global' });
</script>
<template>
  <section aria-labelledby="appearance-heading" class="flex flex-col gap-4">
    <h2 id="appearance-heading" class="font-medium">
      {{ t('shell.appearanceAndGuidance') }}
    </h2>
    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <FieldGroup>
        <VeeField
          v-for="control in controls"
          :key="control.name"
          v-slot="{ field, errors }"
          :name="control.name"
        >
          <Field :data-invalid="!!errors.length">
            <FieldLabel :for="`preference-${control.name}`">{{ t(control.label) }}</FieldLabel>
            <select
              :id="`preference-${control.name}`"
              :name="field.name"
              :value="field.value"
              @blur="field.onBlur"
              :aria-invalid="!!errors.length"
              class="preference-select"
              @change="controlChange(control.name, $event, field.onChange)"
            >
              <option v-for="option in control.options" :key="option.value" :value="option.value">
                {{ option.label.includes('.') ? t(option.label) : option.label }}
              </option>
            </select>
            <FieldError v-if="errors.length" :errors="errors.map(clientMessage)" />
          </Field>
        </VeeField>
        <VeeField v-slot="{ field, errors }" name="language">
          <Field :data-invalid="!!errors.length">
            <FieldLabel for="preference-language">{{ t('shell.language') }}</FieldLabel>
            <select
              id="preference-language"
              class="preference-select"
              :name="field.name"
              :value="field.value"
              @blur="field.onBlur"
              :aria-invalid="!!errors.length"
              @change="controlChange('language', $event, field.onChange)"
            >
              <option value="en">English</option>
              <option value="vi">Tiếng Việt</option>
            </select>
            <FieldDescription>{{ t('shell.languageHelp') }}</FieldDescription>
          </Field>
        </VeeField>
        <VeeField v-slot="{ field, errors }" name="showProjectGuide">
          <Field orientation="horizontal" :data-invalid="!!errors.length">
            <Checkbox
              id="preference-guide"
              :aria-label="t('shell.showTheNewProjectGuide')"
              :model-value="field.value"
              @update:model-value="field.onChange"
              @blur="field.onBlur"
            />
            <FieldLabel for="preference-guide">{{ t('shell.showTheNewProjectGuide') }}</FieldLabel>
            <FieldError v-if="errors.length" :errors="errors.map(clientMessage)" />
          </Field>
        </VeeField>
      </FieldGroup>
      <div class="flex flex-wrap gap-2">
        <Button type="submit">{{ t('shell.saveAppearance') }}</Button
        ><Button type="button" variant="outline" @click="reload">{{
          t('shell.discardChanges')
        }}</Button>
      </div>
      <p role="status" class="text-sm text-muted-foreground">
        {{ message ? t(message) : '' }}
      </p>
      <p class="text-sm text-muted-foreground">
        {{ t('shell.appearanceHelp') }}
      </p>
    </form>
  </section>
</template>
<style scoped>
.preference-select {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px;
  background: var(--background);
  width: 100%;
}
</style>
