<script setup lang="ts">
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { shellSettingsMessages } from '../../i18n/shell-settings';
import { shallowRef, watch } from 'vue';
import { useForm } from 'vee-validate';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import TrainingOptionField from '../project/TrainingOptionField.vue';
import {
  loadTrainingPreferences,
  saveTrainingPreferences,
  resetTrainingPreferences,
  defaultTrainingPreferences,
  trainingPreferenceFields,
  trainingPreferencesSchema,
} from '../../lib/preferences';
const props = defineProps<{ daemonId: string | null }>();
const message = shallowRef('');
const { handleSubmit, resetForm } = useForm({
  validationSchema: z.strictObject({ config: trainingPreferencesSchema }),
  initialValues: { config: defaultTrainingPreferences() },
});
watch(
  () => props.daemonId,
  (daemonId) => {
    resetForm({
      values: {
        config: daemonId ? loadTrainingPreferences(daemonId) : defaultTrainingPreferences(),
      },
    });
    message.value = '';
  },
  { immediate: true },
);
const submit = handleSubmit((value) => {
  if (!props.daemonId) return;
  message.value = saveTrainingPreferences(
    props.daemonId,
    trainingPreferencesSchema.parse(value.config),
  )
    ? 'Defaults saved for new drafts on this daemon.'
    : 'Defaults could not be saved. Browser storage may be unavailable or full.';
});
function resetDefaults() {
  if (!props.daemonId) return;
  const reset = resetTrainingPreferences(props.daemonId);
  if (reset) resetForm({ values: { config: defaultTrainingPreferences() } });
  message.value = reset
    ? 'Training defaults reset. Existing drafts and runs are unchanged.'
    : 'Defaults could not be reset.';
}
const { translateKnownMessage } = useWorkstationI18n(shellSettingsMessages);
</script>
<template>
  <section aria-labelledby="defaults-heading" class="flex flex-col gap-4">
    <h2 id="defaults-heading" class="font-medium">
      {{ translateKnownMessage('New-run defaults') }}
    </h2>
    <p class="text-sm text-muted-foreground">
      {{
        translateKnownMessage(
          'Saved separately for each verified daemon identity, in this browser only. Dataset, model, runtime, credentials and executable-code selections are never saved here. Existing drafts, approved plans and submitted runs are unchanged.',
        )
      }}
    </p>
    <p v-if="!daemonId">
      {{ translateKnownMessage('Connect to a daemon to configure its training defaults.') }}
    </p>
    <form v-else class="flex flex-col gap-4" @submit.prevent="submit">
      <details>
        <summary class="cursor-pointer">
          {{ translateKnownMessage('Training and optional W&B defaults') }}
        </summary>
        <FieldGroup class="mt-4">
          <TrainingOptionField
            v-for="name in trainingPreferenceFields"
            :key="name"
            :name="name"
            :disabled="false"
          />
        </FieldGroup>
      </details>
      <p class="text-sm text-muted-foreground">
        {{
          translateKnownMessage(
            'W&B remains optional. Its credentials and project selection belong to the daemon host or the explicit run draft. No previous run cache is deleted.',
          )
        }}
      </p>
      <div class="flex flex-wrap gap-2">
        <Button type="submit">{{ translateKnownMessage('Save training defaults') }}</Button
        ><Button type="button" variant="outline" @click="resetDefaults">{{
          translateKnownMessage('Reset training defaults')
        }}</Button>
      </div>
      <p role="status" class="text-sm text-muted-foreground">
        {{ translateKnownMessage(message) }}
      </p>
    </form>
  </section>
</template>
