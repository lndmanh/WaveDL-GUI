<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useClientMessages } from '../composables/useClientMessages';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { ConnectionState } from '../lib/connection-session';

const props = withDefaults(defineProps<{ state: ConnectionState; keepSignedIn?: boolean }>(), {
  keepSignedIn: false,
});
const emit = defineEmits<{
  connect: [token: string, keepSignedIn: boolean];
  reconnect: [token: string, keepSignedIn: boolean];
  'update:keepSignedIn': [keepSignedIn: boolean];
  detach: [];
  refresh: [];
}>();
const { handleSubmit, resetForm, setFieldError } = useForm<DaemonCredentialValues>({
  initialValues: { token: '' },
  validationSchema: daemonCredentialSchema,
});
const { t } = useI18n({ useScope: 'global' });
const { clientMessage } = useClientMessages();
const keepSignedIn = computed(() => props.keepSignedIn);
const busy = computed(
  () => props.state.status === 'connecting' || props.state.status === 'offline',
);
const connected = computed(() => props.state.status === 'connected');
const submit = handleSubmit((values) => {
  const token = values.token;
  resetForm({ values: { token: '' } });
  if (props.state.revision > 0) emit('reconnect', token, keepSignedIn.value);
  else emit('connect', token, keepSignedIn.value);
});
watch(
  () => props.state.revision,
  () => resetForm({ values: { token: '' } }),
);
watch(
  () => props.state.status,
  (status) => {
    if (status === 'authentication' && props.state.message)
      setFieldError('token', clientMessage(props.state.message));
  },
);
</script>

<template>
  <section class="connection-panel" aria-labelledby="connection-title">
    <p class="eyebrow">{{ t('shell.yourComputeYourWorkspace2') }}</p>
    <h1 id="connection-title" class="heading">
      {{ t('shell.connectToYourDaemon') }}
    </h1>
    <p class="introduction">
      {{ t('shell.connectionHelp') }}
    </p>
    <Alert v-if="state.message" role="alert" class="mb-6">
      <AlertTitle>{{
        state.status === 'skew' ? t('shell.connectionIdentityChanged') : t('shell.connectionStatus')
      }}</AlertTitle>
      <AlertDescription>{{ clientMessage(state.message) }}</AlertDescription>
    </Alert>
    <div v-if="connected && state.health" class="flex flex-col gap-4" aria-live="polite">
      <p>
        {{
          t('shell.connectedToDaemonidBuildBuildid', {
            daemonId: state.health.daemon_id,
            buildId: state.health.build_id,
          })
        }}
      </p>
      <div class="flex flex-wrap gap-3">
        <Button variant="outline" @click="emit('refresh')">{{
          t('shell.verifyConnection')
        }}</Button>
        <Button variant="outline" @click="emit('detach')">{{ t('shell.disconnect') }}</Button>
      </div>
    </div>
    <form v-else class="flex flex-col gap-5" @submit="submit">
      <FieldGroup>
        <VeeField v-slot="{ field, errors }" name="token">
          <Field :data-invalid="!!errors.length" :data-disabled="busy">
            <FieldLabel for="daemon-bearer">{{ t('shell.daemonMasterCredential') }}</FieldLabel>
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
              t('shell.credentialHelp')
            }}</FieldDescription>
            <FieldError v-if="errors.length" :errors="errors.map(clientMessage)" />
          </Field>
        </VeeField>
      </FieldGroup>
      <div class="flex flex-wrap gap-3">
        <Button type="submit" :disabled="busy"
          ><Cable data-icon="inline-start" aria-hidden="true" />{{
            state.status === 'connecting' ? t('shell.connecting2') : t('shell.connectSecurely')
          }}</Button
        >
        <Button
          v-if="state.revision > 0"
          type="button"
          variant="outline"
          :disabled="state.status === 'connecting'"
          @click="emit('detach')"
          >{{ t('shell.disconnectAndClearScope') }}</Button
        >
      </div>
    </form>
    <Field orientation="horizontal" class="items-start mt-5">
      <Checkbox
        id="keep-signed-in"
        :model-value="keepSignedIn"
        :disabled="busy"
        aria-describedby="keep-signed-in-help"
        @update:model-value="emit('update:keepSignedIn', $event === true)"
      />
      <div class="grid gap-1">
        <FieldLabel for="keep-signed-in">{{ t('shell.keepMeSignedInOnThisBrowser') }}</FieldLabel>
        <FieldDescription id="keep-signed-in-help">{{
          t('shell.sessionStorageHelp')
        }}</FieldDescription>
      </div>
    </Field>
    <p class="offline-note">
      {{ t('shell.disconnectHelp') }}
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
