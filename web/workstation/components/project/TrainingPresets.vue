<script setup lang="ts">
import { useClientMessages } from '../../composables/useClientMessages';
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { projectMessages } from '../../i18n/project';
import { shallowRef, onBeforeUnmount } from 'vue';
import { Field as VeeField, useForm } from 'vee-validate';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel, FieldDescription, FieldError } from '@/components/ui/field';
import { trainingPresets, trainingPresetSchema } from '../../lib/training-presets';

const { clientMessage } = useClientMessages();
const { translateKnownMessage } = useWorkstationI18n(projectMessages);
const props = defineProps<{ disabled: boolean }>();
const emit = defineEmits<{ apply: [preset: z.infer<typeof trainingPresetSchema>] }>();
const { handleSubmit } = useForm({
  initialValues: { preset: 'balanced' },
  validationSchema: z.strictObject({ preset: z.enum(['fast', 'balanced', 'high_accuracy']) }),
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
    message.value = 'Preset exceeds the 64 KiB limit.';
    return;
  }
  try {
    const preset = trainingPresetSchema.parse(JSON.parse(await file.text()));
    if (props.disabled || revision !== importRevision) return;
    emit('apply', preset);
    message.value = 'Validated preset applied to the draft. Review it before planning.';
  } catch {
    if (revision === importRevision)
      message.value =
        'Invalid preset. Use a JSON object containing only typed training fields, without dataset, model, runtime or output paths.';
  }
}
</script>
<template>
  <section class="flex flex-col gap-4" :aria-label="translateKnownMessage('Training presets')">
    <h2 class="text-xl font-medium">{{ translateKnownMessage('Training presets') }}</h2>
    <p>
      {{
        translateKnownMessage(
          'Presets update this same draft. Dataset, model and execution settings stay selected; any plan approval is invalidated. Timings and accuracy depend on your data and hardware.',
        )
      }}
    </p>
    <form class="flex flex-col gap-3" @submit="apply">
      <VeeField v-slot="{ field, errors }" name="preset"
        ><Field :data-invalid="!!errors.length"
          ><FieldLabel for="training-preset">{{ translateKnownMessage('Preset') }}</FieldLabel
          ><select
            id="training-preset"
            v-bind="field"
            :disabled="disabled"
            :aria-invalid="!!errors.length"
            class="rounded-md border p-2"
          >
            <option v-for="preset in trainingPresets" :key="preset.id" :value="preset.id">
              {{ translateKnownMessage(preset.label) }} —
              {{ translateKnownMessage(preset.description) }}
            </option></select
          ><FieldError v-if="errors.length" :errors="errors.map(clientMessage)" /></Field></VeeField
      ><Button type="submit" variant="outline" class="self-start" :disabled="disabled">{{
        translateKnownMessage('Apply preset to draft')
      }}</Button>
    </form>
    <Field
      ><FieldLabel for="training-preset-import">{{
        translateKnownMessage('Import JSON training preset')
      }}</FieldLabel
      ><input
        id="training-preset-import"
        type="file"
        accept="application/json,.json"
        :disabled="disabled"
        @change="importPreset"
      /><FieldDescription>{{
        translateKnownMessage(
          'Configuration only, 64 KiB maximum. This is not a dataset upload; the selected daemon dataset stays unchanged. Runtime environment and credentials cannot be imported. YAML export is supported separately.',
        )
      }}</FieldDescription></Field
    >
    <p v-if="message" role="status">{{ translateKnownMessage(message) }}</p>
  </section>
</template>
