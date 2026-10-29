<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onScopeDispose, shallowRef, watch } from 'vue';
import { useHead, useRoute, useRouter } from '#app';
import { useAutomaticPlots } from '../composables/useAutomaticPlots';
import { useDaemonConnection } from '../composables/useDaemonConnection';
import { provideWorkstation, type WorkstationOverlay } from '../composables/useWorkstation';
import { provideWorkstationLocale } from '../composables/useWorkstationI18n';
import { CLIENT_BUILD_ID } from '../lib/build-identity';
import type { DaemonApiError } from '../lib/daemon-api';
import { applyAppearance, loadAppearance, type AppearancePreferences } from '../lib/preferences';
import WorkstationShell from '../components/shell/WorkstationShell.vue';
import ConnectionPanel from '../components/ConnectionPanel.vue';
import BuildSkewPrompt from '../components/BuildSkewPrompt.vue';
import AutomaticPlotStatus from '../components/results/AutomaticPlotStatus.vue';
import { provideShellRouting } from '../composables/useShellLayout';
import { navigationPath, runIdForPath, sectionForPath, sectionPath } from '../shell/sections';

const AdoptRunPanel = defineAsyncComponent(() => import('../components/runs/AdoptRunPanel.vue'));
const SettingsWorkspace = defineAsyncComponent(
  () => import('../components/settings/SettingsWorkspace.vue'),
);
const router = useRouter();
const route = useRoute();
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
  (path) => {
    void router.push(navigationPath(path, currentRun.value));
  },
);

const connection = useDaemonConnection({
  origin: typeof window === 'undefined' ? 'http://127.0.0.1' : window.location.origin,
  buildId: CLIENT_BUILD_ID,
});
const { state, api, keepSignedIn } = connection;
const automaticPlots = useAutomaticPlots(connection.session);
const automaticPlotState = automaticPlots.state;
const overlay = shallowRef<WorkstationOverlay>(null);
const appearance = shallowRef(loadAppearance());
const section = computed(() => sectionForPath(route.path));
provideWorkstationLocale(computed(() => appearance.value.language));
useHead(() => ({ htmlAttrs: { lang: appearance.value.language } }));

const connectionProps = computed(() => ({ state: state.value, keepSignedIn: keepSignedIn.value }));
const connectionListeners = {
  connect: connection.connect,
  reconnect: connection.reconnect,
  'update:keepSignedIn': connection.setKeepSignedIn,
  detach: connection.detach,
  refresh: connection.refresh,
};
const adoptionOpened = shallowRef(false);
const reportFailure = computed(() => {
  const revision = state.value.revision;
  return (error: DaemonApiError) => connection.session.reportFailure(error, revision);
});
const revision = computed(() => state.value.revision);

watch(
  () => state.value.revision,
  () => {
    currentRun.value = null;
  },
);
watch(overlay, (value) => {
  if (value === 'adopt') adoptionOpened.value = true;
});

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
    <template #connection>
      <ConnectionPanel v-bind="connectionProps" v-on="connectionListeners" />
    </template>
    <template #settings>
      <SettingsWorkspace
        :daemon-id="state.health?.daemon_id ?? null"
        :appearance="appearance"
        @appearance-changed="appearanceChanged"
      />
    </template>
    <template #adopt>
      <AdoptRunPanel
        v-if="adoptionOpened && !!api"
        :session="connection.session"
        @adopted-run-id="monitorRun"
      />
      <ConnectionPanel v-else v-bind="connectionProps" v-on="connectionListeners" />
    </template>
    <AutomaticPlotStatus
      :state="automaticPlotState"
      @retry="automaticPlots.retry"
      @stop="automaticPlots.stop"
      @monitor="monitorRun"
    />
    <ConnectionPanel
      v-if="!api && overlay !== 'connection' && overlay !== 'adopt'"
      v-bind="connectionProps"
      v-on="connectionListeners"
    />
    <slot />
    <BuildSkewPrompt :visible="state.buildMismatch === true" />
  </WorkstationShell>
</template>
