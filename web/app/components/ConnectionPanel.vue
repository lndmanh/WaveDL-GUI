<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, shallowRef, watch } from 'vue';
import { Field as VeeField, useForm } from 'vee-validate';
import { motion, MotionConfig, useReducedMotion } from 'motion-v';
import {
  ArrowRight,
  AudioWaveform,
  Check,
  Eye,
  EyeOff,
  HelpCircle,
  KeyRound,
  RefreshCw,
  Terminal,
  TriangleAlert,
  Unplug,
} from '@lucide/vue';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
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
const { handleSubmit, resetForm } = useForm<DaemonCredentialValues>({
  initialValues: { token: '' },
  validationSchema: daemonCredentialSchema,
});
const { t } = useI18n({ useScope: 'global' });
const { clientMessage } = useClientMessages();
const reducedMotion = useReducedMotion();
const keepSignedIn = computed(() => props.keepSignedIn);
const revealed = shallowRef(false);
const shakes = shallowRef(0);
const busy = computed(
  () => props.state.status === 'connecting' || props.state.status === 'offline',
);
const connected = computed(() => props.state.status === 'connected');
const tone = computed<'idle' | 'busy' | 'ready' | 'warn'>(() => {
  if (connected.value) return 'ready';
  if (props.state.status === 'connecting') return 'busy';
  return props.state.message ? 'warn' : 'idle';
});
const heading = computed(() =>
  connected.value ? t('shell.connectedToYourDaemon') : t('shell.connectToYourDaemon'),
);
const subtitle = computed(() =>
  connected.value ? t('shell.connectedSubtitle') : t('shell.executionBelongsToTheDaemon'),
);
const daemonId = computed(() => props.state.health?.daemon_id ?? '');
const shortDaemonId = computed(() =>
  daemonId.value.length > 16
    ? `${daemonId.value.slice(0, 8)}…${daemonId.value.slice(-4)}`
    : daemonId.value,
);
// Rejected keys surface under the field; everything else gets a notice above it.
const rejection = computed(() =>
  props.state.status === 'authentication' && props.state.message ? props.state.message : null,
);
const notice = computed(() => (rejection.value ? null : props.state.message));
const spring = { type: 'spring', stiffness: 260, damping: 26 } as const;
const submit = handleSubmit((values) => {
  const token = values.token;
  resetForm({ values: { token: '' } });
  revealed.value = false;
  if (props.state.revision > 0) emit('reconnect', token, keepSignedIn.value);
  else emit('connect', token, keepSignedIn.value);
});
watch(
  () => props.state.revision,
  () => resetForm({ values: { token: '' } }),
);
watch(rejection, (message) => {
  if (message) shakes.value += 1;
});
</script>

<template>
  <MotionConfig reduced-motion="user">
    <section
      class="connect-stage mx-auto flex w-full flex-1 items-center justify-center px-4 py-10 sm:px-8"
      aria-labelledby="connection-title"
    >
      <div class="flex w-full max-w-[25rem] flex-col items-center" data-testid="connection-card">
        <motion.div
          class="connect-beacon"
          :data-tone="tone"
          :initial="{ opacity: 0, scale: 0.8 }"
          :animate="{ opacity: 1, scale: 1 }"
          :transition="spring"
          aria-hidden="true"
        >
          <template v-if="!reducedMotion && (tone === 'busy' || tone === 'ready')">
            <motion.span
              v-for="ring in 2"
              :key="`${tone}-${ring}`"
              class="connect-beacon-ring"
              :initial="{ opacity: 0.5, scale: 1 }"
              :animate="{ opacity: 0, scale: tone === 'busy' ? 1.9 : 1.6 }"
              :transition="{
                duration: tone === 'busy' ? 1.6 : 2.8,
                delay: ring * (tone === 'busy' ? 0.5 : 1.2),
                repeat: Infinity,
                ease: 'easeOut',
              }"
            />
          </template>
          <span class="connect-beacon-tile">
            <AudioWaveform class="size-7" />
          </span>
          <motion.span
            v-if="tone === 'ready' || tone === 'warn'"
            :key="tone"
            class="connect-beacon-badge"
            :initial="{ opacity: 0, scale: 0.4 }"
            :animate="{ opacity: 1, scale: 1 }"
            :transition="{ ...spring, delay: 0.15 }"
          >
            <Check v-if="tone === 'ready'" class="size-3" />
            <TriangleAlert v-else class="size-3" />
          </motion.span>
        </motion.div>

        <motion.div
          :key="connected ? 'connected' : 'signin'"
          class="mt-6 flex w-full flex-col items-center"
          :initial="{ opacity: 0, y: 12 }"
          :animate="{ opacity: 1, y: 0 }"
          :transition="{ ...spring, delay: 0.05 }"
        >
          <h1
            id="connection-title"
            class="text-center text-[1.65rem] font-semibold tracking-[-0.025em]"
          >
            {{ heading }}
          </h1>
          <p class="mt-1.5 text-center text-sm text-muted-foreground">{{ subtitle }}</p>

          <motion.div
            v-if="notice"
            class="mt-6 w-full"
            :initial="{ opacity: 0, y: -6 }"
            :animate="{ opacity: 1, y: 0 }"
            :transition="spring"
          >
            <Alert role="alert" :variant="state.status === 'skew' ? 'warning' : 'default'">
              <TriangleAlert aria-hidden="true" />
              <AlertTitle v-if="state.status === 'skew'">
                {{ t('shell.connectionIdentityChanged') }}
              </AlertTitle>
              <AlertDescription>{{ clientMessage(notice) }}</AlertDescription>
            </Alert>
          </motion.div>

          <div v-if="connected && state.health" class="mt-7 flex w-full flex-col gap-4">
            <TooltipProvider>
              <dl
                class="connect-list"
                data-testid="connection-live-chip"
                :aria-label="t('shell.connectedDaemonIdentity', { daemonId })"
              >
                <div class="connect-row">
                  <dt>{{ t('shell.connectionStateLabel') }}</dt>
                  <dd class="flex items-center gap-2 font-medium">
                    <span class="connect-live-dot" aria-hidden="true" />
                    {{ t('shell.connected') }}
                  </dd>
                </div>
                <div class="connect-row">
                  <dt>{{ t('shell.connectionIdLabel') }}</dt>
                  <dd class="min-w-0">
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <span
                          tabindex="0"
                          aria-describedby="connection-full-id"
                          class="block truncate rounded-sm font-mono text-xs text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                          >{{ shortDaemonId }}</span
                        >
                      </TooltipTrigger>
                      <TooltipContent class="max-w-xs break-all">{{
                        t('shell.fullDaemonIdentity', { daemonId })
                      }}</TooltipContent>
                    </Tooltip>
                  </dd>
                </div>
                <div class="connect-row">
                  <dt>{{ t('shell.connectionVersionLabel') }}</dt>
                  <dd class="text-muted-foreground tabular-nums">{{ state.health.build_id }}</dd>
                </div>
              </dl>
            </TooltipProvider>
            <span id="connection-full-id" class="sr-only">{{
              t('shell.fullDaemonIdentity', { daemonId })
            }}</span>
            <div class="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="secondary"
                class="connect-pill"
                @click="emit('refresh')"
              >
                <RefreshCw data-icon="inline-start" aria-hidden="true" />
                {{ t('shell.verifyConnection') }}
              </Button>
              <Button
                type="button"
                variant="secondary"
                class="connect-pill"
                @click="emit('detach')"
              >
                <Unplug data-icon="inline-start" aria-hidden="true" />
                {{ t('shell.disconnect') }}
              </Button>
            </div>
          </div>

          <form v-else class="mt-7 flex w-full flex-col gap-3" @submit="submit">
            <VeeField v-slot="{ field, errors }" name="token">
              <Field :data-invalid="!!errors.length || !!rejection" :data-disabled="busy">
                <FieldLabel for="daemon-bearer" class="sr-only">
                  {{ t('shell.daemonMasterCredential') }}
                </FieldLabel>
                <div
                  :key="shakes"
                  class="connect-field"
                  :data-shake="shakes > 0 && !reducedMotion"
                >
                  <KeyRound class="connect-field-icon" aria-hidden="true" />
                  <Input
                    id="daemon-bearer"
                    v-bind="field"
                    :type="revealed ? 'text' : 'password'"
                    autocomplete="off"
                    autocapitalize="off"
                    spellcheck="false"
                    :placeholder="t('shell.accessKeyPlaceholder')"
                    :aria-invalid="!!errors.length || !!rejection"
                    :disabled="busy"
                    aria-describedby="daemon-bearer-help"
                    class="connect-input"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    class="connect-reveal"
                    :disabled="busy"
                    :aria-pressed="revealed"
                    :aria-label="revealed ? t('shell.hideAccessKey') : t('shell.showAccessKey')"
                    @click="revealed = !revealed"
                  >
                    <EyeOff v-if="revealed" aria-hidden="true" />
                    <Eye v-else aria-hidden="true" />
                  </Button>
                </div>
                <FieldError v-if="errors.length" :errors="errors.slice(0, 1).map(clientMessage)" />
                <FieldError v-else-if="rejection" :errors="[clientMessage(rejection)]" />
              </Field>
            </VeeField>
            <Button type="submit" size="lg" class="connect-submit" :disabled="busy">
              <template v-if="state.status === 'connecting'">
                <Spinner size="sm" class="text-current" :label="t('shell.connecting2')" />
                {{ t('shell.connecting2') }}
              </template>
              <template v-else>
                {{ t('shell.connectSecurely') }}
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              </template>
            </Button>
            <Button
              v-if="state.revision > 0"
              type="button"
              variant="ghost"
              class="connect-pill text-muted-foreground"
              :disabled="state.status === 'connecting'"
              @click="emit('detach')"
            >
              {{ t('shell.disconnectAndClearScope') }}
            </Button>
          </form>

          <div class="connect-list mt-4 w-full">
            <div class="connect-row">
              <label for="keep-signed-in" class="flex min-w-0 flex-col gap-0.5">
                <span class="text-sm font-medium">{{ t('shell.keepMeSignedInOnThisBrowser') }}</span>
                <span id="keep-signed-in-help" class="text-xs text-muted-foreground">
                  {{ t('shell.sessionStorageHelp') }}
                </span>
              </label>
              <Switch
                id="keep-signed-in"
                :model-value="keepSignedIn"
                :disabled="busy"
                aria-describedby="keep-signed-in-help"
                @update:model-value="emit('update:keepSignedIn', $event)"
              />
            </div>
          </div>

          <p
            v-if="!connected"
            id="daemon-bearer-help"
            class="mt-6 flex items-start justify-center gap-2 text-center text-xs text-muted-foreground"
          >
            <Terminal class="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <span>{{ t('shell.credentialHelp') }}</span>
          </p>

          <Popover v-if="state.revision > 0">
            <PopoverTrigger as-child>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                class="mt-3 rounded-full text-muted-foreground"
              >
                <HelpCircle data-icon="inline-start" aria-hidden="true" />
                {{ t('shell.disconnectHelpLabel') }}
              </Button>
            </PopoverTrigger>
            <PopoverContent class="max-w-xs text-sm" data-testid="connection-disconnect-help">{{
              t('shell.disconnectHelp')
            }}</PopoverContent>
          </Popover>
        </motion.div>
      </div>
    </section>
  </MotionConfig>
</template>

<style>
.connect-stage {
  background: radial-gradient(
    closest-side at 50% 30%,
    color-mix(in srgb, var(--primary) 9%, transparent),
    transparent
  );
}
.connect-beacon {
  --beacon: var(--primary);
  position: relative;
  display: grid;
  width: 5rem;
  height: 5rem;
  place-items: center;
}
.connect-beacon[data-tone='idle'] {
  --beacon: var(--muted-foreground);
}
.connect-beacon[data-tone='ready'] {
  --beacon: var(--success);
}
.connect-beacon[data-tone='warn'] {
  --beacon: var(--warning);
}
.connect-beacon-tile {
  position: relative;
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  border-radius: 1.5rem;
  color: var(--beacon);
  background:
    linear-gradient(
      160deg,
      color-mix(in srgb, var(--beacon) 14%, var(--surface)),
      var(--surface) 70%
    );
  box-shadow:
    0 0 0 0.5px color-mix(in srgb, var(--foreground) 12%, transparent),
    inset 0 1px 0 rgb(255 255 255 / 0.5),
    0 18px 36px -18px color-mix(in srgb, var(--beacon) 55%, transparent),
    0 2px 6px rgb(0 0 0 / 0.05);
  transition:
    color 400ms ease,
    box-shadow 400ms ease;
}
.connect-beacon-ring {
  position: absolute;
  inset: 0;
  border-radius: 1.5rem;
  border: 1.5px solid color-mix(in srgb, var(--beacon) 55%, transparent);
}
.connect-beacon-badge {
  position: absolute;
  right: -0.3rem;
  bottom: -0.3rem;
  display: grid;
  width: 1.5rem;
  height: 1.5rem;
  place-items: center;
  border-radius: 999px;
  color: #fff;
  background: var(--beacon);
  box-shadow: 0 0 0 3px var(--background);
}
.connect-field {
  position: relative;
  display: flex;
  align-items: center;
}
.connect-field[data-shake='true'] {
  animation: connect-shake 420ms cubic-bezier(0.36, 0.07, 0.19, 0.97);
}
@keyframes connect-shake {
  20%,
  60% {
    transform: translateX(-6px);
  }
  40%,
  80% {
    transform: translateX(6px);
  }
}
.connect-field-icon {
  position: absolute;
  left: 1rem;
  width: 1rem;
  height: 1rem;
  color: var(--muted-foreground);
  pointer-events: none;
}
.connect-input {
  height: 3rem;
  padding-inline: 2.6rem 3rem;
  border-radius: 0.9rem;
  background: var(--surface);
  font-size: 0.95rem;
  box-shadow:
    0 0 0 0.5px color-mix(in srgb, var(--foreground) 6%, transparent),
    0 1px 2px rgb(0 0 0 / 0.04);
}
.connect-reveal {
  position: absolute;
  right: 0.45rem;
  border-radius: 0.6rem;
  color: var(--muted-foreground);
}
.connect-submit {
  height: 3rem;
  border-radius: 0.9rem;
  font-size: 0.95rem;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.22),
    0 8px 20px -8px color-mix(in srgb, var(--primary) 75%, transparent);
}
.connect-pill {
  height: 2.6rem;
  border-radius: 0.8rem;
}
.connect-list {
  overflow: hidden;
  border-radius: 1rem;
  background: var(--surface);
  box-shadow:
    0 0 0 0.5px color-mix(in srgb, var(--foreground) 10%, transparent),
    0 1px 2px rgb(0 0 0 / 0.04);
}
.connect-row {
  display: flex;
  min-height: 2.9rem;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.65rem 1rem;
  font-size: 0.875rem;
}
.connect-row + .connect-row {
  border-top: 0.5px solid color-mix(in srgb, var(--foreground) 10%, transparent);
}
.connect-row dt {
  flex-shrink: 0;
  color: var(--muted-foreground);
}
.connect-live-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: var(--success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 20%, transparent);
}
</style>
