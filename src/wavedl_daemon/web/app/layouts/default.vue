<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onScopeDispose, shallowRef, watch } from 'vue';
import { useHead, useRoute, useRouter } from '#app';
import { useI18n } from 'vue-i18n';
import { TriangleAlert } from '@lucide/vue';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useClientMessages } from '../composables/useClientMessages';
import { useAutomaticPlots } from '../composables/useAutomaticPlots';
import { useDaemonConnection } from '../composables/useDaemonConnection';
import { provideWorkstation } from '../composables/useWorkstation';
import { useWorkstationAuth } from '../composables/useWorkstationAuth';
import { provideWorkstationLocale } from '../composables/useWorkstationI18n';
import { CLIENT_BUILD_ID } from '../lib/build-identity';
import type { DaemonApiError } from '../lib/daemon-api';
import { applyAppearance, loadAppearance, type AppearancePreferences } from '../lib/preferences';
import WorkstationShell from '../components/shell/WorkstationShell.vue';
import BuildSkewPrompt from '../components/BuildSkewPrompt.vue';
import AutomaticPlotStatus from '../components/results/AutomaticPlotStatus.vue';
import { authRedirect } from '../lib/auth-routing';
import { provideShellRouting } from '../composables/useShellLayout';
import { navigationPath, runIdForPath, sectionForPath, sectionPath } from '../shell/sections';

const AdoptRunPanel = defineAsyncComponent(() => import('../components/runs/AdoptRunPanel.vue'));
const router = useRouter();
const route = useRoute();
const { t } = useI18n({ useScope: 'global' });
const { clientMessage } = useClientMessages();
// Last run opened in Experiments or Results; nav between them keeps it, a reconnect drops it.
const currentRun = shallowRef<string | null>(null);
watch(
  () => runIdForPath(route.path),
  (runId) => {
    if (runId) currentRun.value = runId;
  },
  { immediate: true },
);
provideShellRouting(
  computed(() => route.path),
  async (path, preserveRun = true) => {
    await router.push(preserveRun ? navigationPath(path, currentRun.value) : path);
    // useRoute() lags until the page renders; the router's current route does not.
    return router.currentRoute.value.path;
  },
);

const connection = useDaemonConnection({
  origin: typeof window === 'undefined' ? 'http://127.0.0.1' : window.location.origin,
  buildId: CLIENT_BUILD_ID,
});
const { state, api } = connection;
const automaticPlots = useAutomaticPlots(connection.session);
const automaticPlotState = automaticPlots.state;
const overlay = shallowRef<'adopt' | null>(null);
const auth = useWorkstationAuth();
const appearance = shallowRef(loadAppearance());
const section = computed(() => sectionForPath(route.path));
provideWorkstationLocale(computed(() => appearance.value.language));
useHead(() => ({ htmlAttrs: { lang: appearance.value.language } }));

const adoptionOpened = shallowRef(false);
const reportFailure = computed(() => {
  const revision = state.value.revision;
  return (error: DaemonApiError) => connection.session.reportFailure(error, revision);
});
const revision = computed(() => state.value.revision);

watch(
  [() => state.value.status, () => route.fullPath, () => auth.value.resumePending],
  ([status, path, resumePending]) => {
    const redirect = authRedirect(path, status, resumePending);
    if (redirect && route.fullPath !== redirect) {
      void router.replace(redirect);
    }
  },
  { immediate: true },
);

watch(
  () => state.value.revision,
  () => {
    currentRun.value = null;
  },
);
watch(overlay, (value) => {
  if (value === 'adopt') adoptionOpened.value = true;
});
watch(
  () => sectionForPath(route.path),
  // Adopt belongs to Experiments; arriving there (e.g. to open it) must not close it.
  (current) => {
    if (current !== 'experiments') overlay.value = null;
  },
);

function appearanceChanged(value: AppearancePreferences): void {
  appearance.value = value;
  refreshAppearance();
}
async function monitorRun(runId: string): Promise<void> {
  overlay.value = null;
  await router.push(sectionPath('experiments', runId));
}
const context = {
  connection,
  state,
  api,
  session: connection.session,
  automaticPlots,
  reportFailure,
  revision,
  overlay,
  appearance,
  appearanceChanged,
  monitorRun,
};
provideWorkstation(context);

let systemTheme: MediaQueryList | null = null;
function refreshAppearance(): void {
  if (typeof document !== 'undefined')
    applyAppearance(appearance.value, document.documentElement, systemTheme?.matches ?? false);
}
onMounted(() => {
  systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  systemTheme.addEventListener('change', refreshAppearance);
  refreshAppearance();
});
onScopeDispose(() => systemTheme?.removeEventListener('change', refreshAppearance));
</script>

<template>
  <WorkstationShell v-model:overlay="overlay" :status="state.status" :section="section">
    <template #adopt>
      <AdoptRunPanel
        v-if="adoptionOpened && !!api"
        :session="connection.session"
        @adopted-run-id="monitorRun"
      />
    </template>
    <AutomaticPlotStatus
      :state="automaticPlotState"
      @retry="automaticPlots.retry"
      @stop="automaticPlots.stop"
      @monitor="monitorRun"
    />
    <Alert
      v-if="section !== 'connection' && state.message"
      data-connection-notice
      role="alert"
      :variant="state.status === 'skew' ? 'warning' : 'default'"
    >
      <TriangleAlert aria-hidden="true" />
      <AlertTitle v-if="state.status === 'skew'">{{ t('shell.connectionIdentityChanged') }}</AlertTitle>
      <AlertDescription>{{ clientMessage(state.message) }}</AlertDescription>
    </Alert>
    <slot />
    <BuildSkewPrompt :visible="state.buildMismatch === true" />
  </WorkstationShell>
</template>
