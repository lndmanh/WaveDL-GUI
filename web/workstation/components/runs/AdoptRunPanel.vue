<script setup lang="ts">
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { resultsMessages } from '../../i18n/results';
import { useClientMessages } from '../../composables/useClientMessages';
import { computed, onBeforeUnmount, shallowRef, toRaw, useId, watch } from 'vue';
import { Field as VeeField, useForm } from 'vee-validate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel, FieldError, FieldDescription } from '@/components/ui/field';
import { adoptionFormSchema } from '../../../shared/schemas/adoption-request';
import { AdoptionError, AdoptionWorkflow, type AdoptionStatus } from '../../lib/adoption';
import type { ConnectionSession } from '../../lib/connection-session';
import type { DataSelection } from '../../lib/catalog-api';
import BrowseContainer from '../catalog/BrowseContainer.vue';

const { t, translateKnownMessage } = useWorkstationI18n(resultsMessages);
const { clientMessage } = useClientMessages();
const props = defineProps<{ session: ConnectionSession }>();
const emit = defineEmits<{ adoptedRunId: [runId: string] }>();
const attemptId = useId();
const { handleSubmit } = useForm({
  validationSchema: adoptionFormSchema,
  initialValues: { attempt: 1 },
});
const directory = shallowRef<DataSelection | null>(null);
const status = shallowRef<AdoptionStatus>('draft');
const message = shallowRef('');
const connected = shallowRef(false);
const busy = shallowRef(false);
const frozenPath = shallowRef('');
const frozenAttempt = shallowRef<number | null>(null);
const canAdopt = computed(() => connected.value && !!directory.value && !busy.value);
const workflow = shallowRef(new AdoptionWorkflow(props.session));
let unsubscribe: (() => void) | undefined;
let alive = true;
function select(value: DataSelection) {
  if (busy.value) return;
  if (value.kind !== 'directory') {
    message.value = 'Choose the run directory, not a file.';
    return;
  }
  directory.value = value;
}
function submit(event: Event) {
  if (busy.value) return;
  const currentWorkflow = workflow.value;
  const validatedSubmit = handleSubmit(async (values) => {
    if (
      !alive ||
      workflow.value !== currentWorkflow ||
      toRaw(props.session) !== currentWorkflow.session ||
      busy.value ||
      !directory.value
    )
      return;
    busy.value = true;
    message.value = '';
    try {
      currentWorkflow.prepare(directory.value, values.attempt);
      frozenPath.value = currentWorkflow.request?.path ?? '';
      frozenAttempt.value = currentWorkflow.request?.attempt ?? null;
      status.value = 'pending';
      const result = await currentWorkflow.adopt();
      if (
        !alive ||
        workflow.value !== currentWorkflow ||
        toRaw(props.session) !== currentWorkflow.session
      )
        return;
      message.value =
        'Daemon ownership confirmed. This does not establish live supervision, runtime capability, or successful completion. No process was submitted or cancelled.';
      emit('adoptedRunId', result.run_id);
    } catch (error) {
      if (
        alive &&
        workflow.value === currentWorkflow &&
        toRaw(props.session) === currentWorkflow.session
      )
        message.value =
          error instanceof AdoptionError
            ? error.message
            : 'Choose a current daemon directory and positive attempt before adoption.';
    } finally {
      if (
        alive &&
        workflow.value === currentWorkflow &&
        toRaw(props.session) === currentWorkflow.session
      ) {
        status.value = currentWorkflow.status;
        busy.value = false;
      }
    }
  });
  void validatedSubmit(event);
}
watch(
  () => toRaw(props.session),
  (session) => {
    unsubscribe?.();
    workflow.value = new AdoptionWorkflow(session);
    directory.value = null;
    status.value = 'draft';
    message.value = '';
    busy.value = false;
    frozenPath.value = '';
    frozenAttempt.value = null;
    let revision = -1;
    unsubscribe = session.subscribe((state) => {
      connected.value = state.status === 'connected';
      if (revision !== state.revision) directory.value = null;
      revision = state.revision;
    });
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  alive = false;
  unsubscribe?.();
  // Stop observing only; adoption never calls server cancellation.
});
</script>

<template>
  <section class="flex flex-col gap-5" :aria-label="t('adoptAria')" :aria-busy="busy">
    <header>
      <h2 class="text-lg font-semibold">{{ t('adoptTitle') }}</h2>
      <p class="text-sm text-muted-foreground">{{ t('adoptHelp') }}</p>
    </header>
    <BrowseContainer
      :session="session"
      allow-directory
      :label="t('standaloneDirectory')"
      @select="select"
    />
    <p v-if="directory" class="break-all text-sm">
      {{ t('selectedDirectory', { path: directory.path }) }}
    </p>
    <p
      v-if="frozenPath && status === 'acknowledgement_unknown'"
      role="status"
      class="break-all text-sm"
    >
      {{ t('retainedRequest', { path: frozenPath, attempt: frozenAttempt ?? '' }) }}
    </p>
    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <VeeField v-slot="{ field, errors }" name="attempt">
        <Field :data-invalid="!!errors.length">
          <FieldLabel :for="attemptId">{{ t('runtimeAttempt') }}</FieldLabel>
          <Input
            :id="attemptId"
            v-bind="field"
            type="number"
            min="1"
            step="1"
            :disabled="busy || status === 'acknowledgement_unknown'"
            :aria-invalid="!!errors.length"
          />
          <FieldDescription>{{ t('attemptHelp') }}</FieldDescription>
          <FieldError
            v-if="errors.length"
            :errors="errors.map((error) => translateKnownMessage(clientMessage(error)))"
          />
        </Field>
      </VeeField>
      <Button type="submit" :disabled="!canAdopt">{{
        busy
          ? t('waiting')
          : status === 'acknowledgement_unknown'
            ? t('retryAdoption')
            : t('confirmAdoption')
      }}</Button>
    </form>
    <p v-if="message" :role="status === 'confirmed' ? 'status' : 'alert'" class="text-sm">
      {{ translateKnownMessage(clientMessage(message)) }}
    </p>
  </section>
</template>
