<script setup lang="ts">
import { useWorkstationI18n } from '../composables/useWorkstationI18n';
import { shellSettingsMessages } from '../i18n/shell-settings';
import { computed, watch } from 'vue';
import { Field as VeeField, useForm } from 'vee-validate';
import {
  daemonCredentialSchema,
  type DaemonCredentialValues,
} from '#shared/schemas/daemon-connection';
import { Cable } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { ConnectionState } from '../lib/connection-session';

const props = defineProps<{ state: ConnectionState }>();
const emit = defineEmits<{
  connect: [token: string];
  reconnect: [token: string];
  detach: [];
  refresh: [];
}>();
const { handleSubmit, resetForm, setFieldError } = useForm<DaemonCredentialValues>({
  initialValues: { token: '' },
  validationSchema: daemonCredentialSchema,
});
const busy = computed(
  () => props.state.status === 'connecting' || props.state.status === 'offline',
);
const connected = computed(() => props.state.status === 'connected');
const submit = handleSubmit((values) => {
  const token = values.token;
  resetForm({ values: { token: '' } });
  if (props.state.revision > 0) emit('reconnect', token);
  else emit('connect', token);
});
watch(
  () => props.state.revision,
  () => resetForm({ values: { token: '' } }),
);
watch(
  () => props.state.status,
  (status) => {
    if (status === 'authentication' && props.state.message)
      setFieldError('token', props.state.message);
  },
);
const { t, translateKnownMessage } = useWorkstationI18n(shellSettingsMessages);
</script>

<template>
  <section class="connection-panel" aria-labelledby="connection-title">
    <p class="eyebrow">{{ translateKnownMessage('YOUR COMPUTE. YOUR WORKSPACE.') }}</p>
    <h1 id="connection-title" class="heading">
      {{ translateKnownMessage('Connect to your daemon.') }}
    </h1>
    <p class="introduction">
      {{
        translateKnownMessage(
          'Your daemon runs the experiments. This browser connects only to its current origin; credentials stay in memory.',
        )
      }}
    </p>
    <Alert v-if="state.message" role="alert" class="mb-6">
      <AlertTitle>{{
        state.status === 'skew'
          ? translateKnownMessage('Connection identity changed')
          : translateKnownMessage('Connection status')
      }}</AlertTitle>
      <AlertDescription>{{ translateKnownMessage(state.message) }}</AlertDescription>
    </Alert>
    <div v-if="connected && state.health" class="flex flex-col gap-4" aria-live="polite">
      <p>
        {{
          t('Connected to {daemonId} · build {buildId}', {
            daemonId: state.health.daemon_id,
            buildId: state.health.build_id,
          })
        }}
      </p>
      <div class="flex flex-wrap gap-3">
        <Button variant="outline" @click="emit('refresh')">{{
          translateKnownMessage('Verify connection')
        }}</Button>
        <Button variant="outline" @click="emit('detach')">{{
          translateKnownMessage('Disconnect')
        }}</Button>
      </div>
    </div>
    <form v-else class="flex flex-col gap-5" @submit="submit">
      <FieldGroup>
        <VeeField v-slot="{ field, errors }" name="token">
          <Field :data-invalid="!!errors.length" :data-disabled="busy">
            <FieldLabel for="daemon-bearer">{{
              translateKnownMessage('Daemon bearer credential')
            }}</FieldLabel>
            <Input
              id="daemon-bearer"
              v-bind="field"
              type="password"
              autocomplete="off"
              :aria-invalid="!!errors.length"
              :disabled="busy"
              aria-describedby="daemon-bearer-help"
            />
            <FieldDescription id="daemon-bearer-help">{{
              translateKnownMessage(
                'Paste the credential provided by WaveDL. It is not saved to browser storage.',
              )
            }}</FieldDescription>
            <FieldError v-if="errors.length" :errors="errors.map(translateKnownMessage)" />
          </Field>
        </VeeField>
      </FieldGroup>
      <div class="flex flex-wrap gap-3">
        <Button type="submit" :disabled="busy"
          ><Cable data-icon="inline-start" aria-hidden="true" />{{
            state.status === 'connecting'
              ? translateKnownMessage('Connecting…')
              : translateKnownMessage('Connect securely')
          }}</Button
        >
        <Button
          v-if="state.revision > 0"
          type="button"
          variant="outline"
          :disabled="state.status === 'connecting'"
          @click="emit('detach')"
          >{{ translateKnownMessage('Disconnect and clear scope') }}</Button
        >
      </div>
    </form>
    <p class="offline-note">
      {{
        translateKnownMessage(
          'Disconnecting never cancels running jobs. An offline page cannot confirm live status or perform actions. A changed daemon identity requires an explicit disconnect before starting a new scope.',
        )
      }}
    </p>
  </section>
</template>

<style scoped>
.connection-panel {
  width: 100%;
  max-width: 660px;
  margin: 0 auto;
}
.eyebrow {
  color: var(--primary);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 2px;
  margin: 0 0 20px;
}
.heading {
  font-size: clamp(32px, 4vw, 46px);
  font-weight: 650;
  letter-spacing: -1.8px;
  line-height: 1.16;
  margin: 0;
}
.introduction {
  color: var(--muted-foreground);
  max-width: 510px;
  font-size: 15px;
  line-height: 1.8;
  margin: 22px 0 36px;
}
.offline-note {
  color: var(--muted-foreground);
  font-size: 12px;
  line-height: 1.7;
  margin: 24px 0 0;
}
</style>
