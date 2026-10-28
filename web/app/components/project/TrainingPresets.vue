<script setup lang="ts">
import { useClientMessages } from '../../composables/useClientMessages';
import { useI18n } from 'vue-i18n';
import { shallowRef, onBeforeUnmount } from 'vue';
import { Field as VeeField, useForm } from 'vee-validate';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Field, FieldLabel, FieldDescription, FieldError } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { trainingPresets, trainingPresetSchema } from '../../lib/training-presets';
import { trainingPresetMessageKeysFor } from '../../i18n/dynamic-keys';
import InfoChip from '../common/InfoChip.vue';

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
function descriptionKey(value: unknown): string {
  const preset = presets.find((item) => item.id === value);
  return preset?.messageKeys.description ?? '';
}
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
    <p>{{ t('project.presetsHelp') }}</p>
    <div class="flex flex-wrap gap-2">
      <Badge variant="outline">{{ t('project.presetsKeepSelection') }}</Badge>
      <Badge variant="outline">{{ t('project.presetsClearApproval') }}</Badge>
      <InfoChip
        :label="t('project.presetQualification')"
        :text="t('project.presetsQualificationDetails')"
        uncertain
      />
    </div>
    <Collapsible :default-open="true">
      <CollapsibleTrigger class="flex w-full items-center justify-between text-left font-medium">
        {{ t('project.preset') }}
      </CollapsibleTrigger>
      <CollapsibleContent class="flex flex-col gap-4 pt-4">
        <form class="flex flex-col gap-3" @submit="apply">
          <VeeField v-slot="{ field, errors }" name="preset">
            <Field :data-invalid="!!errors.length">
              <FieldLabel for="training-preset">{{ t('project.preset') }}</FieldLabel>
              <Select
                :model-value="String(field.value)"
                :name="field.name"
                :disabled="disabled"
                @update:model-value="field.onChange"
              >
                <SelectTrigger
                  id="training-preset"
                  :data-value="String(field.value)"
                  :aria-invalid="!!errors.length"
                  @blur="field.onBlur"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem v-for="preset in presets" :key="preset.id" :value="preset.id">
                      {{ t(preset.messageKeys.label) }}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription v-if="field.value === 'balanced'">
                {{ t('project.balancedPresetHelp') }}
              </FieldDescription>
              <InfoChip
                v-else
                :label="t('project.presetQualification')"
                :text="t(descriptionKey(field.value))"
                uncertain
              />
              <FieldError v-if="errors.length" :errors="errors.map(clientMessage)" />
            </Field>
          </VeeField>
          <Button type="submit" variant="outline" class="self-start" :disabled="disabled">
            {{ t('project.applyPresetToDraft') }}
          </Button>
        </form>
        <Field>
          <FieldLabel for="training-preset-import">{{
            t('project.importJsonTrainingPreset')
          }}</FieldLabel>
          <input
            id="training-preset-import"
            type="file"
            accept="application/json,.json"
            :disabled="disabled"
            @change="importPreset"
          />
          <FieldDescription>{{ t('project.presetImportHelp') }}</FieldDescription>
          <div class="flex flex-wrap gap-2">
            <Badge variant="outline">{{ t('project.presetImportNoDataset') }}</Badge>
            <Badge variant="outline">{{ t('project.presetImportNoRuntime') }}</Badge>
          </div>
        </Field>
        <p v-if="message" role="status">{{ t(message) }}</p>
      </CollapsibleContent>
    </Collapsible>
  </section>
</template>
