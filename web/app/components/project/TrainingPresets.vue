<script setup lang="ts">
import { useClientMessages } from '../../composables/useClientMessages';
import { useI18n } from 'vue-i18n';
import { shallowRef, onBeforeUnmount } from 'vue';
import { Field as VeeField, useForm } from 'vee-validate';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel, FieldDescription, FieldError } from '@/components/ui/field';
import { trainingPresets, trainingPresetSchema } from '../../lib/training-presets';
import { trainingPresetMessageKeysFor } from '../../i18n/dynamic-keys';

const { clientMessage } = useClientMessages();
const { t } = useI18n({ useScope: 'global' });
const props = defineProps<{ disabled: boolean }>();
const emit = defineEmits<{ apply: [preset: z.infer<typeof trainingPresetSchema>] }>();
const { handleSubmit } = useForm({
  initialValues: { preset: 'balanced' },
  validationSchema: z.strictObject({ preset: z.enum(['fast', 'balanced', 'high_accuracy']) }),
});
const presets = trainingPresets.map((preset) => {
  const messageKeys = trainingPresetMessageKeysFor(preset.id);
  if (!messageKeys) throw new Error('Missing training preset localization.');
  return { ...preset, messageKeys };
});
const message = shallowRef('');
let importRevision = 0;
onBeforeUnmount(() => {
  importRevision++;
});
const apply = handleSubmit((value) => {
  const preset = trainingPresets.find((item) => item.id === value.preset);
  if (preset) emit('apply', preset.config);
});
async function importPreset(event: Event) {
  const revision = ++importRevision;
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const file = input.files?.[0];
  input.value = '';
  if (!file || props.disabled) return;
  if (file.size > 65536) {
    message.value = 'project.presetExceedsThe64KibLimit';
    return;
  }
  try {
    const preset = trainingPresetSchema.parse(JSON.parse(await file.text()));
    if (props.disabled || revision !== importRevision) return;
    emit('apply', preset);
    message.value = 'project.presetApplied';
  } catch {
    if (revision === importRevision) message.value = 'project.presetInvalid';
  }
}
</script>
<template>
  <section class="flex flex-col gap-4" :aria-label="t('project.trainingPresets')">
    <h2 class="text-xl font-medium">{{ t('project.trainingPresets') }}</h2>
    <p>
      {{ t('project.presetsHelp') }}
    </p>
    <form class="flex flex-col gap-3" @submit="apply">
      <VeeField v-slot="{ field, errors }" name="preset"
        ><Field :data-invalid="!!errors.length"
          ><FieldLabel for="training-preset">{{ t('project.preset') }}</FieldLabel
          ><select
            id="training-preset"
            v-bind="field"
            :disabled="disabled"
            :aria-invalid="!!errors.length"
            class="rounded-md border p-2"
          >
            <option v-for="preset in presets" :key="preset.id" :value="preset.id">
              {{ t(preset.messageKeys.label) }} — {{ t(preset.messageKeys.description) }}
            </option></select
          ><FieldError v-if="errors.length" :errors="errors.map(clientMessage)" /></Field></VeeField
      ><Button type="submit" variant="outline" class="self-start" :disabled="disabled">{{
        t('project.applyPresetToDraft')
      }}</Button>
    </form>
    <Field
      ><FieldLabel for="training-preset-import">{{
        t('project.importJsonTrainingPreset')
      }}</FieldLabel
      ><input
        id="training-preset-import"
        type="file"
        accept="application/json,.json"
        :disabled="disabled"
        @change="importPreset"
      /><FieldDescription>{{ t('project.presetImportHelp') }}</FieldDescription></Field
    >
    <p v-if="message" role="status">{{ t(message) }}</p>
  </section>
</template>
