<script setup lang="ts">
import { Field as VeeField, useForm } from 'vee-validate';
import { appearanceSchema } from '../../../shared/schemas/preferences';
import {
  defaultAppearance,
  loadAppearance,
  saveAppearance,
  applyAppearance,
} from '../../lib/preferences';
import { appearanceControlMessageKeys } from '../../i18n/dynamic-keys';
import type { AppearancePreferences } from '~~/types/preferences';

const props = defineProps<{ appearance?: AppearancePreferences }>();
const emit = defineEmits<{ changed: [value: AppearancePreferences] }>();
const { clientMessage } = useClientMessages();
const { t } = useI18n({ useScope: 'global' });

const { values, resetForm } = useForm({
  validationSchema: appearanceSchema,
  initialValues: props.appearance ?? loadAppearance(),
});

const autosave = useAutosaveForm({
  schema: appearanceSchema,
  values: () => values,
  save: (value) => {
    const saved = saveAppearance(value);
    applyAppearance(
      value,
      document.documentElement,
      window.matchMedia('(prefers-color-scheme: dark)').matches,
    );
    emit('changed', value);

    return saved;
  },
});

const { status } = autosave;

function controlChange(
  name: string,
  value: string,
  change: (value: string | number) => void,
): void {
  change(name === 'zoom' ? Number(value) : value);
  autosave.queue(true);
}

function resetDefaults(): void {
  resetForm({ values: { ...defaultAppearance } });
  autosave.queue(true);
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
    options: [90, 100, 110, 125].map((value) => ({ value, label: 'shell.settingsScalePercent' })),
  },
  {
    name: 'language',
    label: 'shell.language',
    options: [
      { value: 'en', label: 'shell.settingsEnglish' },
      { value: 'vi', label: 'shell.settingsVietnamese' },
    ],
  },
];
</script>

<template>
  <section aria-labelledby="appearance-heading" class="flex flex-col gap-6">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div class="space-y-1.5">
        <h2 id="appearance-heading" class="text-xl font-semibold tracking-tight">
          {{ t('shell.settingsGeneral') }}
        </h2>
        <p class="text-sm text-muted-foreground">{{ t('shell.appearanceSummary') }}</p>
      </div>
      <SettingsSaveStatus :status="status" />
    </header>
    <Card>
      <CardContent>
        <form @submit.prevent @focusout="autosave.flush">
          <FieldGroup class="gap-0">
            <VeeField
              v-for="control in controls"
              :key="control.name"
              v-slot="{ field, errors }"
              :name="control.name"
            >
              <Field
                :data-invalid="!!errors.length"
                class="gap-3 border-b py-5 first:pt-0 last:border-0 last:pb-0 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(10rem,16rem)] sm:items-center"
              >
                <div class="space-y-1">
                  <FieldLabel :for="`preference-${control.name}`">{{
                    t(control.label)
                  }}</FieldLabel>
                  <FieldDescription v-if="control.name === 'language'">{{
                    t('shell.languageHelp')
                  }}</FieldDescription>
                </div>
                <div class="space-y-2">
                  <Select
                    :model-value="String(field.value)"
                    @update:model-value="
                      controlChange(control.name, String($event ?? ''), field.onChange)
                    "
                  >
                    <SelectTrigger
                      :id="`preference-${control.name}`"
                      :name="field.name"
                      :aria-invalid="!!errors.length"
                      class="min-h-11 w-full"
                      @blur="field.onBlur"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem
                          v-for="option in control.options"
                          :key="option.value"
                          :value="String(option.value)"
                          class="min-h-11"
                        >
                          {{ t(option.label, { value: option.value }) }}
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldError v-if="errors.length" :errors="errors.map(clientMessage)" />
                </div>
              </Field>
            </VeeField>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
    <div>
      <SettingsResetDialog
        :label="t('shell.settingsResetDefaults')"
        :description="t('shell.settingsResetAppearanceHelp')"
        @confirm="resetDefaults"
      />
    </div>
  </section>
</template>
