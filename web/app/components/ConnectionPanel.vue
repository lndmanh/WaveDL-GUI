<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, watch } from 'vue';
import { Field as VeeField, useForm } from 'vee-validate';
import { Cable, Info } from '@lucide/vue';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useClientMessages } from '../composables/useClientMessages';
import type { ConnectionState } from '../lib/connection-session';
import {
  daemonCredentialSchema,
  type DaemonCredentialValues,
} from '#shared/schemas/daemon-connection';

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
const heading = computed(() =>
  connected.value ? t('shell.connectedToYourDaemon') : t('shell.connectToYourDaemon'),
);
const daemonId = computed(() => props.state.health?.daemon_id ?? '');
const shortDaemonId = computed(() =>
  daemonId.value.length > 16
    ? `${daemonId.value.slice(0, 8)}…${daemonId.value.slice(-4)}`
    : daemonId.value,
);
const messageTitle = computed(() =>
  props.state.status === 'skew'
    ? t('shell.connectionIdentityChanged')
    : t('shell.connectionStatus'),
);
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
  <section
    class="connection-panel mx-auto grid w-full max-w-xl flex-1 place-items-center px-4 py-8 sm:px-8"
    aria-labelledby="connection-title"
  >
    <div
      class="connection-surface w-full rounded-xl border border-border/70 bg-card/90 shadow-sm"
      data-testid="connection-card"
    >
      <div class="flex flex-col gap-4 px-6 pb-5 pt-7 sm:px-8">
        <div class="flex items-center gap-4">
          <span
            class="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/15"
          >
            <Cable class="size-5" aria-hidden="true" />
          </span>
          <div class="min-w-0">
            <p class="mb-1 text-xs font-medium tracking-wide text-muted-foreground">
              {{ t('shell.connection') }}
            </p>
            <h1 id="connection-title" class="text-xl font-semibold tracking-tight sm:text-2xl">
              {{ heading }}
            </h1>
          </div>
        </div>
        <p class="max-w-md leading-relaxed text-sm text-muted-foreground">
          {{ t('shell.executionBelongsToTheDaemon') }}
        </p>
      </div>

      <div class="px-6 pb-6 sm:px-8">
        <Alert v-if="state.message" role="alert" class="mb-5">
          <AlertTitle>{{ messageTitle }}</AlertTitle>
          <AlertDescription>{{ clientMessage(state.message) }}</AlertDescription>
        </Alert>

        <div v-if="connected && state.health" class="flex flex-col gap-4">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <div
                  tabindex="0"
                  aria-describedby="connection-full-id"
                  class="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-sm"
                  data-testid="connection-live-chip"
                  :aria-label="t('shell.connectedDaemonIdentity', { daemonId: daemonId })"
                >
                  <span class="size-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                  <span class="font-medium">{{ t('shell.connected') }}</span>
                  <span class="min-w-0 truncate font-mono text-xs text-muted-foreground">{{
                    shortDaemonId
                  }}</span>
                  <span class="shrink-0 text-xs text-muted-foreground">{{
                    state.health.build_id
                  }}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent class="max-w-xs break-all">{{
                t('shell.fullDaemonIdentity', { daemonId })
              }}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <span id="connection-full-id" class="sr-only">{{
            t('shell.fullDaemonIdentity', { daemonId })
          }}</span>
          <div class="flex flex-wrap gap-2">
            <Button type="button" variant="outline" @click="emit('refresh')">
              {{ t('shell.verifyConnection') }}
            </Button>
            <Button type="button" variant="outline" @click="emit('detach')">
              {{ t('shell.disconnect') }}
            </Button>
          </div>
        </div>

        <form v-else class="flex flex-col gap-5" @submit="submit">
          <FieldGroup>
            <VeeField v-slot="{ field, errors }" name="token">
              <Field :data-invalid="!!errors.length" :data-disabled="busy">
                <FieldLabel for="daemon-bearer">
                  {{ t('shell.daemonMasterCredential') }}
                </FieldLabel>
                <Input
                  id="daemon-bearer"
                  v-bind="field"
                  type="password"
                  autocomplete="off"
                  :aria-invalid="!!errors.length"
                  :disabled="busy"
                  aria-describedby="daemon-bearer-help"
                />
                <FieldDescription id="daemon-bearer-help">
                  {{ t('shell.credentialHelp') }}
                </FieldDescription>
                <FieldError v-if="errors.length" :errors="errors.map(clientMessage)" />
              </Field>
            </VeeField>
          </FieldGroup>
          <div class="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" class="sm:min-w-40" :disabled="busy">
              <Cable data-icon="inline-start" aria-hidden="true" />
              {{
                state.status === 'connecting' ? t('shell.connecting2') : t('shell.connectSecurely')
              }}
            </Button>
            <Button
              v-if="state.revision > 0"
              type="button"
              variant="outline"
              :disabled="state.status === 'connecting'"
              @click="emit('detach')"
            >
              {{ t('shell.disconnectAndClearScope') }}
            </Button>
          </div>
        </form>
      </div>

      <div class="flex flex-col items-stretch gap-3 border-t px-6 py-5 sm:px-8">
        <Field orientation="horizontal" class="items-start">
          <Checkbox
            id="keep-signed-in"
            :model-value="keepSignedIn"
            :disabled="busy"
            aria-describedby="keep-signed-in-help"
            @update:model-value="emit('update:keepSignedIn', $event === true)"
          />
          <div class="grid gap-1">
            <FieldLabel for="keep-signed-in">
              {{ t('shell.keepMeSignedInOnThisBrowser') }}
            </FieldLabel>
            <FieldDescription id="keep-signed-in-help">
              {{ t('shell.sessionStorageHelp') }}
            </FieldDescription>
          </div>
        </Field>
        <Popover v-if="state.revision > 0">
          <PopoverTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="self-start text-muted-foreground"
            >
              <Info data-icon="inline-start" aria-hidden="true" />
              {{ t('shell.disconnectHelpLabel') }}
            </Button>
          </PopoverTrigger>
          <PopoverContent class="max-w-xs text-sm" data-testid="connection-disconnect-help">{{
            t('shell.disconnectHelp')
          }}</PopoverContent>
        </Popover>
      </div>
    </div>
  </section>
</template>
